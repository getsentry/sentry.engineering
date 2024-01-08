---
title: 'How to publish binaries on npm'
date: '2024-1-5'
tags: ['npm', 'binary', 'cli', 'web']
draft: false
summary: 'A comprehensive guide on how to publish binaries on npm without getting fired'
images: [/images/publishing-binaries-on-npm/hero.jpeg]
layout: PostLayout
canonicalUrl: https://sentry.engineering/blog/publishing-binaries-on-npm
authors: ['lucaforstner']
---

**This blog post is a comprehensive guide on how to distribute platform-specific binaries over npm.**

At Sentry we maintain an npm package called `@sentry/cli`, which is a JavaScript wrapper around the Sentry CLI (Command Line Interface).
The Sentry CLI is written in Rust and ships as multiple different binaries for different processor architectures and operating systems:

```
- Darwin/MacOS
- Linux (arm)
- Linux (arm64)
- Linux (i686)
- Linux (x64)
- Windows (i686)
- Windows (x64)
```

Since the `@sentry/cli` npm package needs to run the Sentry CLI binary, we need to somehow include the binaries in the npm package.
Unfortunately, our binaries are rather large (they each have around 15 MB), so we cannot reasonably include all of the binaries in a single npm package, since it would lead to about 100 MB being downloaded whenever the package is installed.
`node_modules` are already denser than a neutrino star.
If we do not want to contribute to it, we need a solution that exclusively downloads the right platform-specific binary on installation.

## Exploring Our Options

- **TL;DR: The most reliable option is to ship the binaries inside of `optionalDependencies` and download the binary via a `postinstall` script as a backup strategy. Doing only one of the two will run into problems in setups where the respective feature is disabled. Skip to [Implementation](#implementation) for details.**

There are two options to ship platform-specific binaries without having to download all of the binaries:

- **`optionalDependencies`** - All of the commonly used JavaScript package managers support the [`optionalDependencies`](https://docs.npmjs.com/cli/v10/configuring-npm/package-json#optionaldependencies) field in `package.json`.
  Package managers will generally install all of the packages listed in `optionalDependencies`, but they may opt out of it based on certain criteria.

  One of these criteria is the `os` and `cpu` fields inside the dependencies' `package.json` file.
  The package managers are smart enough to only install the dependencies when the values of these fields match the OS and architecture of the current system.
  This means we can publish individual packages, each only containing one platform-specific binary, but with `os` and `cpu` fields indicating which architecture they're intended for, and package managers will automatically only install the right one.

- **`postinstall` script** - If you include a script called `postinstall` in your `package.json`, the script will be executed right after your package was installed, even when it was installed as a dependency.

  We can use a `postinstall` script to download a binary for the current platform and store it somewhere on the system.
  For this binaries itself to be hosted somewhere.
  It can be GitHub, npm itself, or your even own hosting platform.
  Note, that you should check for the binaries' integrity after downloading from an untrusted source to avoid supply chain attacks.

Both of these approaches have drawbacks and may not work for all setups.
`optionalDependencies` can run into problems if disabled (for example, via yarn's `--ignore-optional` flag).
`postinstall` scripts can also be disabled and are likely even more problematic because it is generally recommended to disable them, due to being prone to supply chain attacks.
To maximize the likelihood of success, we found it necessary to try both approaches when installing the package.

In the next section we will implement the approaches outlined above.

## Implementation

Let's assume we want to publish a package called `my-package` which we want to distribute to three architectures: Windows x64, Linux x64, and Linux ARM.
The Linux binary executable files are called `my-binary` and the Windows binary file is called `my-binary.exe`.

1. First, we need to publish the platform-specific packages we will later use inside our `optionalDependencies`.
   The packages may include nothing but a `package.json` and their binary.
   We will call our platform-specific packages `my-package-linux-x64`, `my-package-linux-arm`, and `my-package-windows-x64`.

   Here is how their `package.json` files should look like:

   ```json
   {
     "name": "my-package-linux-x64",
     "version": "1.0.0",
     "os": ["linux"],
     "cpu": ["x64"]
   }
   ```

   ```json
   {
     "name": "my-package-linux-arm",
     "version": "1.0.0",
     "os": ["linux"],
     "cpu": ["arm"]
   }
   ```

   ```json
   {
     "name": "my-package-windows-x64",
     "version": "1.0.0",
     "os": ["win32"],
     "cpu": ["x64"]
   }
   ```

   Put the binary files in the `bin` folder inside the package to make sure the binary is included when the package is packed.
   Do not forget to make the binaries executable! (e.g. by using `$ chmod +x my-binary`)

   The file structure of the platform specific packages should look as follows:

   ```
   "my-package-linux-x64" and "my-package-linux-arm"
    ├── package.json
    └── bin/
        └── my-binary

   "my-package-windows-x64"
    ├── package.json
    └── bin/
        └── my-binary.exe
   ```

   You are now good to publish these packages.

2. Next, we will create our `postinstall` script.
   The script will download one of our published platform-specific packages and extract its binary, however, it will only download a package if the right platform-specific optional package was not already installed by a package manager.

   If a binary is downloaded, it will live directly in the root of `my-package`.

   ```js
   const fs = require('fs')
   const path = require('path')
   const zlib = require('zlib')
   const https = require('https')

   // Lookup table for all platforms and binary distribution packages
   const BINARY_DISTRIBUTION_PACKAGES = {
     'linux-x64': 'my-package-linux-x64',
     'linux-arm': 'my-package-linux-arm',
     'win32-x64': 'my-package-windows-x64',
   }

   // Adjust the version you want to install. You can also make this dynamic.
   const BINARY_DISTRIBUTION_VERSION = '1.0.0'

   // Windows binaries end with .exe so we need to special case them.
   const binaryName = process.platform === 'win32' ? 'my-binary.exe' : 'my-binary'

   // Determine package name for this platform
   const platformSpecificPackageName =
     BINARY_DISTRIBUTION_PACKAGES[`${process.platform}-${process.arch}`]

   // Compute the path we want to emit the fallback binary to
   const fallbackBinaryPath = path.join(__dirname, binaryName)

   function makeRequest(url) {
     return new Promise((resolve, reject) => {
       https
         .get(url, (response) => {
           if (response.statusCode >= 200 && response.statusCode < 300) {
             const chunks = []
             response.on('data', (chunk) => chunks.push(chunk))
             response.on('end', () => {
               resolve(Buffer.concat(chunks))
             })
           } else if (
             response.statusCode >= 300 &&
             response.statusCode < 400 &&
             response.headers.location
           ) {
             // Follow redirects
             makeRequest(response.headers.location).then(resolve, reject)
           } else {
             reject(
               new Error(
                 `npm responded with status code ${response.statusCode} when downloading the package!`
               )
             )
           }
         })
         .on('error', (error) => {
           reject(error)
         })
     })
   }

   function extractFileFromTarball(tarballBuffer, filepath) {
     // Tar archives are organized in 512 byte blocks.
     // Blocks can either be header blocks or data blocks.
     // Header blocks contain file names of the archive in the first 100 bytes, terminated by a null byte.
     // The size of a file is contained in bytes 124-135 of a header block and in octal format.
     // The following blocks will be data blocks containing the file.
     let offset = 0
     while (offset < tarballBuffer.length) {
       const header = tarballBuffer.subarray(offset, offset + 512)
       offset += 512

       const fileName = header.toString('utf-8', 0, 100).replace(/\0.*/g, '')
       const fileSize = parseInt(header.toString('utf-8', 124, 136).replace(/\0.*/g, ''), 8)

       if (fileName === filepath) {
         return tarballBuffer.subarray(offset, offset + fileSize)
       }

       // Clamp offset to the uppoer multiple of 512
       offset = (offset + fileSize + 511) & ~511
     }
   }

   async function downloadBinaryFromNpm() {
     // Download the tarball of the right binary distribution package
     const tarballDownloadBuffer = await makeRequest(
       `https://registry.npmjs.org/${platformSpecificPackageName}/-/${platformSpecificPackageName}-${BINARY_DISTRIBUTION_VERSION}.tgz`
     )

     const tarballBuffer = zlib.unzipSync(tarballDownloadBuffer)

     // Extract binary from package and write to disk
     fs.writeFileSync(
       fallbackBinaryPath,
       extractFileFromTarball(tarballBuffer, `package/bin/${binaryName}`)
     )

     // Make binary executable
     fs.chmodSync(fallbackBinaryPath, '755')
   }

   function isPlatformSpecificPackageInstalled() {
     try {
       // Resolving will fail if the optionalDependency was not installed
       require.resolve(`${platformSpecificPackageName}/bin/${binaryName}`)
       return true
     } catch (e) {
       return false
     }
   }

   if (!platformSpecificPackageName) {
     throw new Error('Platform not supported!')
   }

   // Skip downloading the binary if it was already installed via optionalDependencies
   if (!isPlatformSpecificPackageInstalled()) {
     console.log('Platform specific package not found. Will manually download binary.')
     downloadBinaryFromNpm()
   } else {
     console.log(
       'Platform specific package already installed. Will fall back to manually downloading binary.'
     )
   }
   ```

   The script could also download from GitHub releases or any other mirror, but dowloading it from npm lets us reuse the packages we have already published.

   Save this script as `install.js` in `my-package`!

3. Now we need to establish how you will access the binary inside your package's JS code.
   Here's a function you can use to get the path of downloaded binary, that considers all of our fallback mechanisms:

   ```js
   function getBinaryPath() {
     // Lookup table for all platforms and binary distribution packages
     const BINARY_DISTRIBUTION_PACKAGES = {
       'linux-x64': 'my-package-linux-x64',
       'linux-arm': 'my-package-linux-arm',
       'win32-x64': 'my-package-windows-x64',
     }

     // Windows binaries end with .exe so we need to special case them.
     const binaryName = process.platform === 'win32' ? 'my-binary.exe' : 'my-binary'

     // Determine package name for this platform
     const platformSpecificPackageName =
       BINARY_DISTRIBUTION_PACKAGES[`${process.platform}-${process.arch}`]

     try {
       // Resolving will fail if the optionalDependency was not installed
       return require.resolve(`${platformSpecificPackageName}/bin/${binaryName}`)
     } catch (e) {
       return require('path').join(__dirname, '..', binaryName)
     }
   }

   // With `getBinaryPath()` could access the binary in you JavaScript code as follows
   module.exports.runBinary = function (...args) {
     require('child_process').execFileSync(getBinaryPath(), args, {
       stdio: 'inherit',
     })
   }
   ```

4. _(You can skip this step if you do not need your binary to be accessible from the command line.)_
   For the binary to be executable from the command line, we need to provide a script that invokes it.
   Since the binary can be in two places, we create a wrapper script that locates the binary and invokes it.
   We can reuse the `getBinaryPath()` function from before.

   ```
   #!/usr/bin/env node

   require('child_process').execFileSync(getBinaryPath(), process.argv.slice(2), {
     stdio: 'inherit',
   })
   ```

   Save this script as `bin/cli` in `my-package`!
   Additionally, add a `bin` field to your package.json:

   ```jsonc
   // package.json
   {
     "bin": {
       "my-package": "bin/cli"
     }
   }
   ```

   This will cause your binary to be globally accessible when installed globally with a package manager, in addition to being directly invokable with a package manager.

   ```sh
   # Example: global installation
   $ npm i -g my-package
   $ my-package # will work from anywhere

   # Example: invocation through package manager
   $ npx my-package # will work from anywhere
   ```

5. Lastly, we must configure our main `package.json` to include the `optionalDependencies` and the `postinstall` script:

   ```jsonc
   {
     "name": "my-package",
     "version": "1.0.0",
     "bin": {
       "my-package": "bin/cli"
     },
     "scripts": {
       "postinstall": "node ./install.js"
     },
     "optionalDependencies": {
       "my-package-linux-x64": "1.0.0",
       "my-package-linux-arm": "1.0.0",
       "my-package-windows-x64": "1.0.0"
     }
   }
   ```

   To verify, the final package structure should look like the following:

   ```
   my-package
   ├── package.json
   ├── install.js
   └── bin/
       └── cli
   ```

Now we're done.
Once `my-package` is published and installed, the binaries will be downloaded alongside, and you can either access them from your JS code with the `getBinaryPath()` function or you can directly invoke the binary executables from the command line.

For a full example, take a look at the [Example Repository](https://github.com/lforst/npm-binary-example).

---

If you are actually planning to publish a binary over npm, please see some additional learnings, considerations, and resources to support your technical decisions below:

- Read this excellent write-up by Evan Wallace: [PR in esbuild repository "install using optionalDependencies"](https://github.com/evanw/esbuild/pull/1621)
  - It brings up a good few points about our manual fallback method.
    You may want to explore an additional method of downloading your platform-specific packages which involves invoking the user's package manager so eventual options and flags can be forwarded.
  - It outlines a cool optimization where esbuild's `postinstall` script will replace the JS binary wrapper with the actual binary itself to avoid overhead when running the `esbuild` command.
- Even with the approach we outlined in this guide, there are still a few things that can go wrong.
  We recommend you prepare error messages for the following cases:
  - If none of the `optionalDependencies` packages are found on the file system, we recommend printing a warning that enabling `optionalDependencies` is recommended for your package.
  - If at least one of your platform-specific package is on the user's file system but it is not the correct package for the user's system architecture, it likely means that after installation, the packages were moved from one architecture to another architecture.
    This usually happens when users move their `node_modules` into a VM or a docker image.
- We haven't found a reliable way to ship binaries if both `optionalDependencies` and `postinstall` scripts are disabled, except for directly including all of the platform-specific binaries in the package.
- Depending on how your package is intended to be used you could run the install script when the package is invoked.
  This comes with obvious drawbacks like slower start-up times and that your entire API will have to be asynchronous.
- When manually downloading the binary you can store it in a central location to cache for subsequent dependency installations.
  This can speed up local development and install times for your package's users.
- Don't forget to set the executable bits on your binaries.
  (Small pitfall: When binaries are uploaded and downloaded over GitHub's upload/download action, the executable flags will be lost.)
- The `postinstall` script can potentially become annoying for your own development because it will run whenever you install your own (dev) dependencies.
  You can make your life easier by adding a conditional to the `postinstall` script that only holds in your dev environment, like, for example, the existence of a specific file or environment variable.
