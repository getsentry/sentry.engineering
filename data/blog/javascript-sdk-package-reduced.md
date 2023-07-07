---
title: "JavaScript SDK “Package Size is Massive” - So we reduced it by 29%"
date: '2022-07-19'
tags: ['javascript','sdk','web']
draft: false
summary: Developers started to notice just how big our JavaScript package was and yeah, we knew. We weren’t ignoring the issues; after all, we don’t want the Sentry package to be the cause of a slowdown. But to reduce our JavaScript SDK package size effectively we had to account for shipping new capabilities, like being able to manage the health of a release and performance monitoring, while maintaining a manageable bundle size. After all, new features == bigger package - usually.
images: []
layout: PostLayout
canonicalUrl: https://blog.sentry.io/2022/07/19/javascript-sdk-package-reduced/
authors: ['abhijeetprasad']
---

Developers started to notice just how big our JavaScript package was and yeah, we knew. We weren’t ignoring the issues; after all, we don’t want the Sentry package to be the cause of a slowdown. But to reduce our JavaScript SDK package size effectively we had to account for shipping new capabilities, like being able to manage the health of a release and performance monitoring, while maintaining a manageable bundle size. After all, new features == bigger package - usually. 

Refactoring to reduce bundle size and support future feature development was not the only challenge; the refactoring we needed to do would yield breaking changes to folks who wrote their own integrations. When shipping a third-party JavaScript library for tracking errors and latency issues, we better have a gosh-darn good reason for introducing breaking changes, especially to a library that helps people see and solve errors and latency issues.

After shipping the needed v6 updates, we [created and published a roadmap](https://github.com/getsentry/sentry-javascript/issues/4240) that ensured we could release a new major version without changing or removing parts of the Sentry SDK’s Public API (e.g. Sentry.captureException, Sentry.captureMessage). This major update would also include expanding the [tree shaking](https://webpack.js.org/guides/tree-shaking/) (dead code elimination) capabilities of the SDK, so users could further reduce the bundle size by removing code that they did not need.

## Defining success metrics and tests
To start, we decided upon a bundle size reduction goal of 30% in the minified CDN bundle size. We estimated 30% based on an analysis for quick wins (about 15%) and a more substantial refactoring (about 15%).

Figuring out what to measure to track bundle size can be a challenge as it is dependent on your application type and usage of the Sentry SDK. To make sure we had an objective and consistent measurement, we chose to track the size of our minified CDN bundle using the size-limit library by Andrey Sitnik. Using size-limit meant we could calculate the bundle size on every PR, allowing developers to see the impact of the changes they were making on bundle size.

![Github report on the size of Sentry's JS SDK](/images/javascript-sdk-package-reduced/sdk-size.png)

We chose to track the minified CDN bundle over the gzipped + minified CDN bundle because the minified bundle is more representative of the bundle executed at runtime. The bundle size at runtime has a direct relationship with parse and execution time, so minimizing the minified bundle would minimize the time Sentry blocked the main thread. It’s much easier to track the impact individual changes had against the minified bundle size versus the total gzipped & minified bundle size.

To track progress toward tree shaking, [we created a list of scenarios](https://github.com/getsentry/sentry-javascript/tree/master/scenarios/browser) and checked the [webpack bundle analyzer](https://www.npmjs.com/package/webpack-bundle-analyzer) output over time to monitor which modules were being included. This helped us validate if certain changes improved the tree shakability of our SDK.

## Scoping the roadmap
The [Sentry JavaScript v7 roadmap](https://github.com/getsentry/sentry-javascript/issues/4240#issuecomment-1035323682) had a set of steps that needed to happen right before the major, and right after. Splitting up this way was important, as we needed to lay the foundation to make it easier for the SDK developers to make breaking changes, and pulling changes out of the major development branch minimized the development time needed on the major release branch.

The major had a couple goals:

* Switching from es5 to es6 by default for built assets
* Deletion of deprecated code (less code, less bytes!)
* Removal of unnecessary abstractions (even less code, even less bytes!)
* Enablement tree shaking for transports, integrations, and stacktrace parsers
* Add tree shaking flags so users could remove Sentry logic they did not require in their production applications

A couple of asides:

* Switching our default generated JavaScript to target ES6 instead of ES5. This meant we would only support ES6 compatible browsers out of the box. Users could use compilers like [Babel](https://babeljs.io/) to down-compile our ES6 code to ES5 or below to support older browser/node versions. ES6 produces smaller code out of the box than ES5 does, so it would give automatic bundle size savings to users.
* [Deleting deprecating code was fairly straight forward](https://github.com/getsentry/sentry-javascript/pulls?q=is%3Apr+author%3AAbhiPrasad+deprecate+is%3Aclosed+milestone%3A7.0.0+) - and produced some nice bundle size wins.

## Removing Unnecessary Abstractions
One thing we realized was that abstractions, although they made the code cleaner, contributed to unnecessary bytes. For example, we had a backend class that was used to configure platform specific (node vs. browser) functionality over our common Sentry JavaScript Client.

The issue here was that we also had platform specific Client classes, that were children of a common BaseClient class. Although it was useful to extract this logic into a separate class to have cleaner separation of concerns, having all of the logic in the platform allowed specific clients to save a lot of bytes.

## Enabling Tree Shaking of Sentry Features
A request we had heard from Sentry users was the ability for users to remove the code they didn’t need, for example, remove specific integrations.In the way the Sentry JavaScript SDK was originally structured, this was not possible because we included reasonable defaults as part of the Sentry Client class that is created when a user calls Sentry.init. This meant that even if a user filtered out a default integration, it would still be included as it’s referenced in the Sentry Client class internally.

To change this, we extracted out logic that users would typically tree shake from being internal state in the Sentry Client class, to injecting dependency data into the Client class.

To illustrate this, let’s look at an example of the Sentry.init function and what it did previously.

```js
// Sentry.init() call
function init(options) {
  const client = new Client(options);
  startClient(client);
}

class Client {
  constructor(options) {
    this.options = {
       // functions chooses correct values for client
       // based on SDK set defaults and options
       transport: this.getTransport(options),
       integrations: this.getIntegrations(options),       
       ...options,
    };
    startIntegrationsAndBindClient();
  }
}
```

In the new version, we inject those values into the client constructor.

```js
function init(options) {
  const client = new Client({
    stackParser: stackParserFromStackParserOptions(options.stackParser || defaultStackParser),
    integrations: getIntegrationsToSetup(options),
    transport: options.transport || (supportsFetch() ? makeFetchTransport : makeXHRTransport),
    ...options,
  });
  startClient(client);
}
```

This allows for users to directly use a Sentry Client, and [pick exactly the dependencies they require for their application](https://docs.sentry.io/platforms/javascript/configuration/tree-shaking/#tree-shaking-default-integrations), tree shaking out the stuff they don’t use.

## Tree Shaking with Magic Strings
Other than allowing users to tree shake features, we also introduced the idea of SDK-wide magic strings that enabled users to configure with bundlers. Configuring these magic string flags would tree shake out larger SDK features without needing to make changes to Sentry.init. For example, users could remove all debug logging logic from the SDK by setting the magic string **SENTRY_DEBUG** to be false. [We’ve detailed the exact way to configure this in our docs](https://docs.sentry.io/platforms/javascript/configuration/tree-shaking/#tree-shaking-optional-code).

```js
const webpack = require("webpack");

module.exports = {
  // ... other options
  plugins: [
    new webpack.DefinePlugin({
      __SENTRY_DEBUG__: false,
    }),
    // ... other plugins
  ],
};
```

Behind the scenes, this took many iterations to figure out, especially to validate that it would [work with different bundlers](https://github.com/getsentry/sentry-javascript/pull/5155).

In the future, we want to introduce more flags so that optional code can be tree shaken out by users if not needed. Have any suggestions? We recommend [joining our Discord](https://discord.gg/j7DWKKNF), we have a channel for JavaScript. Or you could [open an issue in the JavaScript SDK GitHub repo](https://github.com/getsentry/sentry-javascript/issues/new/choose).

## Results
As of [Browser JavaScript version 7.3.1](https://github.com/getsentry/sentry-javascript/commit/f15fb00146d9a83ed36706f24c239c9d6f29a81f), the bundle size of the minified un-gzipped browser SDK is 52.67kb. This was originally 74.47kb in [version 6.16.1](https://github.com/getsentry/sentry-javascript/commit/6919d17445ad6a6692844970640011b9555cf78b), the version which we started making these changes all the way back in December. This represents a 29% decrease in bundle size.

These numbers were collected using the size-limit library, [the config of which you can see in our repository](https://github.com/getsentry/sentry-javascript/blob/master/.size-limit.js). Although we were 1% away from the goal we initially set out to accomplish, we were still very happy with where we ended up.

After installing v7 of the JavaScript SDK and enabling tree shaking, users of our NPM distribution have seen a variety of wins. [Next.js SDK users have reported a 30kb reduction in run-time JavaScript](https://twitter.com/shuding_/status/1539249024074760199). Our tests internally have shown similar wins, but the final numbers will vary based on your specific SDK being used and what features you are using from the SDK. As a reminder, Sentry supports over 103 different platforms, so regardless of if you are using [React, Angular, Vue, Ember, Next.js or another framework, Sentry has an SDK for you and your application](https://docs.sentry.io/platforms/)!

> We have been very impressed with the new Sentry JS SDK. Not only is the bundle size significantly smaller out of the box, but we were able to reduce it further through tree shaking. 
>   
> Shu Ding, Software Engineer, Vercel

After the release of v7, we had 0 confirmed bug reports, in high part due to the emphasis we put on integration testing and not changing the Public API. P.S. In case you’ve been following this journey to a smaller package size, we closed this ticket: [Package size is massive](https://github.com/getsentry/sentry-javascript/issues/2707).
