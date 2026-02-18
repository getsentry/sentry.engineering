---
title: "Building Sentry: Source maps and their problems"
date: "2019-07-16"
tags: ["source maps", "debugging", "building sentry"]
draft: false
summary: "Other than Python, JavaScript is the oldest platform that Sentry properly supports, which makes sense considering many Python services (including Sentry itself) have a JavaScript front-end. The system that almost everybody uses to debug transpiled code (and the hopefully apparent subject of this blog post) is source maps. Today, we want to focus on some of the their shortcomings and why source maps cause problems for platforms like Sentry."
images: [../../assets/images/building-sentry-source-maps-and-their-problems/sourcemaps.gif]
postLayout: PostLayout
canonicalUrl: https://blog.sentry.io/2019/07/16/building-sentry-source-maps-and-their-problems/
authors: ["arminronacher"]
---

_Welcome to our [series of blog posts](/tags/building-sentry) about all the nitty-gritty details that go into building a great debug experience at scale. Today, we’re looking at the shortcomings of source maps._

Other than Python, JavaScript is the oldest platform that Sentry properly supports, which makes sense considering many Python services (including Sentry itself) have a JavaScript front-end. As the popularity of transpiling grew, the need for tools to debug transpiled code in production became obvious. The system that almost everybody uses to debug transpiled code (and the hopefully apparent subject of this blog post) is [source maps](https://docs.google.com/document/d/1U1RGAehQwRypUTovF1KRlpiOFze0b-_2gc6fAH0KY0k/edit#heading=h.djovrt4kdvga).

A lot could be said about source maps — like how well they fit into Maroon Five lyrics or how they simplify [JavaScript](https://blog.sentry.io/2015/10/29/debuggable-javascript-with-source-maps) and [Node.js](https://blog.sentry.io/2019/02/20/debug-node-source-maps) debugging. Today, we want to focus on some of the their shortcomings and why source maps cause problems for platforms like Sentry.

## Map thy token

Source maps were created to map a token (for instance, a function name) in a minified JavaScript file to a non-minified file. They have enough information to tell us, for instance, a function call in line `1` and column `4021` of a minified file was originally in line `138` and column `8`. Source maps also tell us the original file name and what the original token was called; the token currently called a might have been called `performAction` in the original file.

While helpful, the above information does not fully equip us to understand and debug errors. If you use Sentry with source maps, you should notice that we want you to upload the source maps and the minified JavaScript files. That’s because we look at the minified JavaScript source to perform some basic heuristics.

Minified JavaScript stack traces (to which Sentry often refers) contain information that provides insights into errors. For each frame in the stack trace, we get the name of the function for this frame along with the filename, line number, and column number of where exactly the interpreter was when the stack trace was generated.

Let’s take a non-minified example to understand what points where:

```js
function myFunction() {
  console.log("stack: " + new Error().stack);
}
function outerFunction() {
  myFunction();
}
outerFunction();
```

This little script produces the following stack trace in the console:

```shell
script.js:2 stack: Error
    at myFunction (file:///tmp/script.js:2:28)
    at outerFunction (file:///tmp/script.js:5:3)
    at file:///tmp/script.js:7:1
```

The exact output is different depending on the browser, but we generally get the same information. Here is the output for the first frame in the stack trace:

- `myFunction` is the name of the function. In a minified file, this is the minified function name.
- `file:///tmp/script.js` is the name of the file containing the function. If this is from a minified file, this is the name of the minified file. Note that multiple source files can merge into the same minified file.
- `2` is the line number (1 indexed). Note that this is not the line where the function was declared but where in the function we were when the stack trace was created.
- `28` is the column in the function where we were. In non-minified files, this is typically not very important, but, since minified files are generally one long line, this information plays a crucial role in pinpointing where we are within the file.

_One note here: column uses an odd unit of measurement. It’s the offset from the beginning of the line counted in UTF-16 characters. So an emoji offsets the column by `2`, but a character on the basic plane (like `a`, `ä` or `и`) would only offset it by `1`._

Here is the question that Sentry needs to be able to answer:_ if we are in that frame, but the frame is minified, how can we know what the function was originally called_? Notice that we do not know where the function was declared, so we cannot figure out where in the source map we would need to ask for the original function name.

To make this clearer, let’s imagine our script from above would have been minified as such:

```js
function f() {
  console.log("stack: " + new Error().stack);
}
function g() {
  f();
}
g();
```

And this would be the minified stack:

```shell
stack: Error
    at f (file:///tmp/script.min.js:1:37)
    at g (file:///tmp/script.min.js:1:69)
    at file:///tmp/script.min.js:1:74
```

So what does `1:37` mean? It points right to the `new Error` in the minified source. If we were to look up the token in the source map at (`0, 36`) (0 indexed), we would be able to find out that the token `new` was originally in file `script.js` on line `2` and column `28`. However, we can’t find out what `f` was called initially because, to get that information, we would need to understand what function declared `new Error`. This information is unfortunately not available in source maps.

Scope information, however, provides the details we need. We need to tell which line to which line this token is valid and what it’s parent scope is. Then, recover the original function name by going back up until we find the function scope that contains all of this.

So what does Sentry to do recover function names?

## Walking over the minified source

Sentry tries to guess function names primarily by tokenizing backward over a minified JavaScript file token by token. In the above example, we start at line 1, column 37 and then go backward token by token until we find a token named `function`. If the token on the right shares the name of the minified token we’re looking for (in this case `f`), we take the location information for `f` (in this case `line 1`, `column 9`) and look it up in the source file. Here, we find that the location is also line `1` and column `9` but in the file `script.js` instead of `script.min.js`, and it was called `myFunction` instead of `f`.

Now, as you can imagine, assuming that the function name f is not reused locally is a flawed approach, as this isn’t guaranteed. One could imagine that a local utility function declared within a function is given the same name as the function outside:

```js
function f() {
  function f() {
    console.log("x");
  }
  f();
  f();
}
```

In this case, we would recover the wrong function name. The anonymous functions and ES6 method syntax are even bigger problems with no viable solutions at the moment.

For example, this looks like an anonymous function using ES6 syntax, but the Browser will give this method the name `foo`:

```js
let foo = () => {
  throw new Error();
};
```

If the demangler goes in and shortens `foo` to `f`, we lose the original function name as we do in other cases. However, as we walk backward token by token from `new Error`, we can’t find the function with basic token scanning. We would have to parse the entire source tree and not just tokenize backward, which is much more work.

## What else could we do?

Well, our ability to recover function names could be better. For instance, function names are not considered for grouping in JavaScript at the moment. In typical situations, Sentry uses the function name as a reliable indicator for grouping, but, in JavaScript, we completely disregard this information because of the unreliability of function names. Different releases of the code might produce differently minified function names, and, when we fail to recover the original one, we produce new groups.

Firefox’s developer tools provide an interesting solution to this problem. Firefox will (optionally) parse both the minified and non-minified files with Babel and try to diff the resulting parse tree to determine scopes.

The problem is hardly new — there are other platforms supported by Sentry that have debug information better than source maps. We support [DWARF](http://dwarfstd.org/), which solves many of these problems and could theoretically be augmented to support JavaScript or WASM. The hacks piled onto this current specification are quite involved, and, honestly, we welcome an improved debug standard.

Just recently, Facebook’s [Metro bundler](https://github.com/facebook/metro) has extended the source map specification for their RAM bundle distribution format and added new Facebook and Metro extensions. Sadly, there is no standardized body that would work on improving the source map standard. After all, the specification itself is still merely a Google doc from many years ago that is floating around the internet.

## Technical implementation

From the technical side, source maps pose a few challenges that are not particularly complex. These challenges group into three points:

1. Safely fetching externally referenced source maps
2. Processing source maps in a way that is quick and is memory-efficient
3. Providing support for customer supplied source maps

### Safe fetching

When Sentry receives a stack trace, it needs to find the minified source files to find out which source maps belong to it. Typically, the source map reference is a comment at the bottom of the minified file, but it can also be supplied as a header. In either case, we need to make an HTTP request to get that file. Alternatively, customers can also upload these minified files to us — in which case, we do not need to fetch.

Fetching these files is not particularly complicated, but there are a few critical steps to consider:

- These are an untrusted source, which means we need to ensure that our HTTP client prevents these sources from doing nefarious things.
- Servers might be really slow to respond and cause load issues. Additionally, servers might try to issue bad HTTP redirects to internal resources we need to prevent.
- We need to make sure that we do not cause a strain on the customer’s infrastructure where source maps and JS files are typically located. It would not be great if an error reporting tool, upon getting thousands of error report, makes thousands of HTTP requests to get the source maps. We have multiple levels of caching in place to prevent this from happening.

### Processing source maps

We have written about this before (like [here](https://blog.sentry.io/2015/10/29/debuggable-javascript-with-source-maps) and [here](https://blog.sentry.io/2019/02/20/debug-node-source-maps)), and nothing much has changed about how we handle source map processing. We wrote a [source map library in Rust](https://blog.sentry.io/2016/10/19/fixing-python-performance-with-rust), which is optimized to quickly operate and resolve source maps once fetched.

### Customer support source maps

The last part is more of a user interface issue than a technical challenge. Source maps are easy to get wrong. Matching filenames to URLs is complicated for users, and source maps can be insufficient for processing on our side. Our preference is for customers to upload the source maps to us because it lets us do some preprocessing to ensure they work.

Currently, our approach is to let customers use the `sentry-cli` tool we provide, which parses and rewrites source maps before upload and establishes the correct references between the minified file and source map. We use the same library as we do on the server.

Once satisfied, we upload a zip archive with all files to the server. There, our file storage system picks up and stores the files until we need them.

## Improving the ecosystem

Unfortunately, the source map specification has not evolved much over the last few years. In particular, with new technologies like WASM and others, something must change for debugging tools to be able to provide a good experience.

We hope that change will be future collaboration between authors of minifiers and browser/debugger vendors that evolves the source map format to better support scopes, WASM, or non-JavaScript languages, like TypeScript and ReasonML.
