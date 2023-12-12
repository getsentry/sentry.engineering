---
title: 'Improving Node.js loader performance'
date: '2023-12-12'
tags: ['node.js', 'performance', 'esm', 'cjs', 'commonjs']
summary: 'CommonJS and ES modules are 2 sides of a coin. Node.js supports both of them. So, how can we improve the performance of Node.js loaders?'
images: ['/images/improving-nodejs-loader-performance/hero.jpg']
layout: PostLayout
canonicalUrl: improving-nodejs-loader-performance
authors: ['yagiznizipli']
---

Node.js supports 2 different modules. EcmaScript and CommonJS modules. ES modules are the official standard for modules in JavaScript and they are supported by all modern browsers. CommonJS modules are the modules that Node.js uses by default. They are not supported by browsers and they are not the official standard. However, they are still widely used.

## How does Node.js load the entry point?

In order to differentiate which loader to use, Node.js depends on several factors. The most important one is the file extension. If the file extension is `.mjs`, Node.js will use the ES module loader. If the file extension is `.cjs`, Node.js will use the CommonJS module loader. If the file extension is `.js`, Node.js will use the CommonJS module loader if the `package.json` file has `"type": "commonjs"` field (or simply doesn't have the `type` field). If the `package.json` file has `"type": "module"` field, Node.js will use the ES module loader.

This decision is made in `lib/internal/modules/run_main.js` file. You can see a simplified version of [the code][prior-to-optimization-run-main] below:

```js
const { readPackageScope } = require('internal/modules/package_json_reader');

function shouldUseESMLoader(mainPath) {
  // Determine the module format of the entry point.
  if (mainPath && mainPath.endsWith('.mjs')) { return true; }
  if (!mainPath || mainPath.endsWith('.cjs')) { return false; }

  const pkg = readPackageScope(mainPath);
  switch (pkg.data?.type) {
    case 'module':
      return true;
    case 'commonjs':
      return false;
    default: { // No package.json or no `type` field.
      return false;
    }
  }
}
```

`readPackageScope` traverses the directory tree upwards until it finds a `package.json` file. Prior to the optimizations done on this post, `readPackageScope` calls an internal version of `fs.readFileSync` until it finds a `package.json` file. This synchronous call makes a filesystem operation and communicates with Node.js C++ layer. This operation has performance bottlenecks depending on the value/type it returns because of the cost of serialization/deserialization of data. This is why we want to avoid calling `readPackage` a.k.a. `fs.readFileSync` inside `readPackageScope` as much as possible.

## How does Node.js parses `package.json`?

By default, `readPackage` calls an internal version `fs.readFileSync` to read the `package.json` file. This synchronous call returns a string from Node.js C++ layer, which later gets parsed using V8's `JSON.parse()` method. Depending on the validity of this JSON, Node.js checks and creates an object that's required for the remaining of the loaders to perform. These fields are `pkg.name`, `pkg.main`, `pkg.exports`, `pkg.imports` and `pkg.type`. If the JSON has faulty syntax, Node.js will throw an error and exit the process.

The output of this function is later cached at an internal `Map` to avoid calling `readPackageScope` again for the same path. This cache is stored for the rest of the process lifetime.

## Usage of `package.json` fields and the reader

Before we dive into what optimizations we can do, let's see how Node.js uses these fields. The common use cases in Node.js codebase for parsing and re-using `package.json` fields are:

- `pkg.exports` and `pkg.imports` are used to resolve different modules according to your input.
- `pkg.main` is used to resolve the entry point of the application.
- `pkg.type` is used to resolve the module format of the file.
- `pkg.name` is used if there is a self referencing require/import.

Additionally, Node.js supports an experimental version of `Subresource Integrity` checkwhich uses the result of this package.json to validate the integrity of the file.

The most important usage is that, for every `require/import` call, Node.js needs to know the module format of the file. For example, if the user require's a NPM module that uses ESM on a CommonJS (CJS) application, Node.js will need to parse the `package.json` file of that module and throw an error if the NPM package is ESM.

Because of all of these calls and usages across ESM and CJS loaders, `package.json` reader is one of the most important parts of Node.js loader implementation.

## Optimizations

### Optimizing caching layer

In order to optimize the `package.json` reader performance, I first moved the caching layer to the C++ side to make the implementation be closer to the filesystem call as much as possible. This decision forced to parse the JSON file in C++. At this point, I had 2 options:

- Use V8's `v8::JSON::Parse()` method which takes a `v8::String` as an input and returns a `v8::Value` as an output.
- Use `simdjson` library to parse the JSON file.

Since, the filesystem returns a string, converting that string into a `v8::String` just to retrieve the keys and values as a `std::string` didn't make sense. Therefore, I added `simdjson` as a dependency to Node.js and used it to parse the JSON file. This change enabled us to parse the JSON file in C++ and extract and return only the necessary fields to the JavaScript side, reducing the size of the input that needs to be serialized/deserialized.

### Avoiding serialization cost

In order to avoid returning unnecessary large objects, I changed the signature of the `readPackage` function to return only the necessary fields. This change simplified the `shouldUseESMLoader` as follows:

```js
function shouldUseESMLoader(mainPath) {
  // Determine the module format of the entry point.
  if (mainPath && mainPath.endsWith('.mjs')) { return true; }
  if (!mainPath || mainPath.endsWith('.cjs')) { return false; }

  const response = getNearestParentPackageJSONType(mainPath);

  // No package.json or no `type` field.
  if (response === undefined || response[0] === 'none') {
    return false;
  }

  const {
    0: type,
    1: filePath,
    2: rawContent,
  } = response;

  checkPackageJSONIntegrity(filePath, rawContent);

  return type === 'module';
}
```

Moving the caching layer to C++ enabled us to expose micro-functions that returns enums (integers) instead of strings to get a type of a `package.json` file.

### Reducing C++ calls to 1 to 1

The same function that was mentioned above but on ESM loader called `getPackageScopeConfig` made a lot of C++ calls in order to resolve and retrieve the applicable `package.json` file. The implementation was as follows:

```js
function getPackageScopeConfig(resolved) {
   let packageJSONUrl = new URL('./package.json', resolved);
   while (true) {
     const packageJSONPath = packageJSONUrl.pathname;
     if (packageJSONPath.endsWith('node_modules/package.json')) {
       break;
     }
     const packageConfig = packageJsonReader.read(fileURLToPath(packageJSONUrl), {
       __proto__: null,
       specifier: resolved,
       isESM: true,
     });
     if (packageConfig.exists) {
       return packageConfig;
     }

     const lastPackageJSONUrl = packageJSONUrl;
     packageJSONUrl = new URL('../package.json', packageJSONUrl);

     // Terminates at root where ../package.json equals ../../package.json
     // (can't just check "/package.json" for Windows support).
     if (packageJSONUrl.pathname === lastPackageJSONUrl.pathname) {
       break;
     }
   }
   const packageJSONPath = fileURLToPath(packageJSONUrl);
   return {
     __proto__: null,
     pjsonPath: packageJSONPath,
     exists: false,
     main: undefined,
     name: undefined,
     type: 'none',
     exports: undefined,
     imports: undefined,
   };
 }
```

`getPackageScopeConfig` function on a happy path calls C++ To summarize Node.js has a C++ 3 times from the following functions:

- `new URL(...)` calls `internalBinding('url').parse()` C++ method
- `path.fileURLToPath()` calls `new URL()` if the input is a string
- `packageJsonReader.read()` calls `fs.readFileSync()` C++ method

Moving this whole function to C++, enabled us to reduce the number of C++ calls to 1 to 1. This conversion also forced us to implement `url.fileURLToPath()` in C++.

## Results

The PR that contains these changes can be found [on Github][nodejs-pr-url].

On a real-world Svelte application, the results showed 5% faster ESM execution. It also reduced the size of the cache stored by the loader by avoiding unnecessary fields.

```
❯ hyperfine 'node ../sveltejs-realworld/node_modules/vite/dist/node/cli.js --version' 'out/Release/node ../sveltejs-realworld/node_modules/vite/dist/node/cli.js --version' -w 10
Benchmark 1: node ../sveltejs-realworld/node_modules/vite/dist/node/cli.js --version
  Time (mean ± σ):     101.4 ms ±   0.6 ms    [User: 96.6 ms, System: 10.8 ms]
  Range (min … max):   100.3 ms … 102.5 ms    28 runs

Benchmark 2: out/Release/node ../sveltejs-realworld/node_modules/vite/dist/node/cli.js --version
  Time (mean ± σ):      96.3 ms ±   0.5 ms    [User: 90.9 ms, System: 10.1 ms]
  Range (min … max):    95.6 ms …  98.1 ms    30 runs

Summary
  out/Release/node ../sveltejs-realworld/node_modules/vite/dist/node/cli.js --version ran
    1.05 ± 0.01 times faster than node ../sveltejs-realworld/node_modules/vite/dist/node/cli.js --version
```

[prior-to-optimization-run-main]: https://github.com/nodejs/node/blob/02926d3c6aaf70eba6d80423beb2d5df97e1ebc7/lib/internal/modules/run_main.js#L52
[nodejs-pr-url]: https://github.com/nodejs/node/pull/50322
