---
title: 'Session Replay SDK Bundle Size Optimizations'
date: '2023-10-31'
tags: ['sdk', 'javascript', 'replay', 'session-replay']
draft: false
summary: 'An in-depth analysis of how we managed to cut the Session Replay SDK bundle size by 23%.'
images: [/images/session-replay-sdk-bundle-size-optimizations/hero.jpg]
layout: PostLayout
canonicalUrl: https://sentry.engineering/blog/session-replay-sdk-bundle-size-optimizations
authors: ['francesconovy']
---

[Bundle Size matters](https://blog.sentry.io/js-browser-sdk-bundle-size-matters/) - this is something we SDK engineers at Sentry are acutely aware of.
In an ideal world, you'd get all the functionality you want with no additional bundle size - oh, wouldn't that be nice?
Sadly, in reality any feature we add to the JavaScript SDK results in additional bundle size for the SDK - there is always a trade off to be made.

With [Session Replay](https://docs.sentry.io/product/session-replay/), this is especially challenging.
Session Replay allows you to capture what's going on in a users' browsers, which can help developers debug errors or other problems the user is experiencing.
While this can be incredibly helpful, there is also a considerable amount of JavaScript code required to actually make this possible - thus leading to an increased bundle size.

In version 7.73.0 of the JavaScript SDKs, we updated the underlying [rrweb](https://github.com/getsentry/rrweb) package from v1 to v2.
While this brought a host of improvements, it also came with a considerable increase in bundle size.
This tipped us over the edge to declare a bundle size emergency, and focus on bringing the additional size Session Replay adds to the SDK down as much as possible.

We're very happy to say that our efforts have been successful, and we managed to reduce the minified & gzipped bundle size compared to the rrweb 2.0 baseline by 23% (~19 KB), and by up to 35% (~29 KB) with maximum tree shaking configuration enabled.

| Version                                                                      | Bundle Size¹ | What                                     |
| ---------------------------------------------------------------------------- | ------------ | ---------------------------------------- |
| [7.72.0](https://github.com/getsentry/sentry-javascript/releases/tag/7.72.0) | 75.58 KB     | With rrweb 1.0                           |
| [7.73.0](https://github.com/getsentry/sentry-javascript/releases/tag/7.73.0) | 84.26 KB     | After updating to rrweb 2.0              |
| [7.78.0](https://github.com/getsentry/sentry-javascript/releases/tag/7.78.0) | 65.24 KB     | New default                              |
| [7.78.0](https://github.com/getsentry/sentry-javascript/releases/tag/7.78.0) | 55.48 KB     | With all tree shaking options configured |

¹Including Error & Performance Monitoring as well as Session Replay, minified & gzipped

## Steps we took to reduce bundle size

In order to achieve these bundle size improvements, we took a couple of steps ranging from removing unused code to build time configuration and improved tree shaking:

- Made it possible to remove iframe & shadow DOM support via a build-time flag
- Removed canvas recording support by default (users can opt-in via a config option, [support is coming](https://github.com/getsentry/sentry-javascript/issues/6519))
- Removed unused code from our rrweb fork
- Removed unused code in Session Replay itself
- Made it possible to remove the included compression worker in favor of hosting it yourself
- Moved to a different compression library with a smaller footprint

## Primer: rrweb

[rrweb](https://github.com/getsentry/rrweb) is the underlying tool we use to make the recordings for Session Replay.
While we try to contribute to the main rrweb repository as much as possible, there are some changes that are very specific to our needs at Sentry,
which is why we also maintain a [forked version](https://github.com/getsentry/rrweb) of rrweb with some custom changes.

## Primer: Tree Shaking

Tree shaking allows a JavaScript bundler to remove unused code from the final bundle.
If you're not familiar with how it works and the advantages tree shaking brings, you can [learn more about it in our docs](https://docs.sentry.io/platforms/javascript/configuration/tree-shaking/).

## Made it possible to remove iframe & shadow DOM support via a build-time flag

While rrweb allows you to capture more or less everything that happens on your page, some of the things it can capture may not be necessary for some users.
For these cases, we now allow users to manually remove certain parts of the rrweb codebase they may not need at build time, reducing the bundle size.

In [getsentry/sentry-javascript#9274](https://github.com/getsentry/sentry-javascript/pull/9274) & [getsentry/rrweb#114](https://github.com/getsentry/rrweb/pull/114) we implemented the ground work to allow for tree shaking iframe and shadow DOM recordings. This means that if, for example, you don't have any iframes on your page, you can safely opt-in to remove this code from your application.

In [getsentry/sentry-javascript-bundler-plugins#428](https://github.com/getsentry/sentry-javascript-bundler-plugins/pull/428) we implemented an easy way to implement these optimizations in your app. If you are using one of our bundler plugins:

- [@sentry/webpack-plugin](https://www.npmjs.com/package/@sentry/webpack-plugin)
- [@sentry/vite-plugin](https://www.npmjs.com/package/@sentry/vite-plugin)
- [@sentry/rollup-plugin](https://www.npmjs.com/package/@sentry/rollup-plugin)
- [@sentry/esbuild-plugin](https://www.npmjs.com/package/@sentry/esbuild-plugin)

You can just update to its latest version, and add this configuration to the plugin:

```js
sentryPlugin({
  bundleSizeOptimizations: {
    excludeDebugStatements: true,
    excludeReplayIframe: true,
    excludeReplayShadowDom: true,
  },
})
```

This will save you about 5 KB gzipped of bundle size!

### How we implemented build-time tree shaking flags

We already had some build-time flags for tree shaking implemented in the JavaScript SDK itself (`__SENTRY_DEBUG__` and `__SENTRY_TRACING__`). We followed the same structure for rrweb:

```js
// General tree shaking flag example
if (typeof __SENTRY_DEBUG__ === 'undefined' || __SENTRY_DEBUG__) {
  console.log('log a debug message!')
}
```

By default, this code will result in `log a debug message!` being logged.
However, if you replace the `__SENTRY_DEBUG__` constant at build time with `false`, this will result in the following code:

```js
if (typeof false === 'undefined' || false) {
  console.log('log a debug message!')
}
```

Which bundlers will optimize to the following:

```js
if (false) {
  console.log('log a debug message!')
}
```

And in turn, since the code inside of `if (false)` will definitely never be called, it will be completely tree shaken away.

For rrweb, we used the same approach to allow you to remove certain recording managers:

1. In order to avoid touching all the parts of the code that may use a manager, we added new dummy managers following the same interface but doing nothing:

```ts
interface ShadowDomManagerInterface {
  init(): void
  addShadowRoot(shadowRoot: ShadowRoot, doc: Document): void
  observeAttachShadow(iframeElement: HTMLIFrameElement): void
  reset(): void
}

class ShadowDomManagerNoop implements ShadowDomManagerInterface {
  public init() {}
  public addShadowRoot() {}
  public observeAttachShadow() {}
  public reset() {}
}
```

2. Now, in the place where the `ShadowDomManager` is usually initialized, we can do the following:

```js
const shadowDomManager =
  typeof __RRWEB_EXCLUDE_SHADOW_DOM__ === 'boolean' && __RRWEB_EXCLUDE_SHADOW_DOM__
    ? new ShadowDomManagerNoop()
    : new ShadowDomManager()
```

This means that by default, the regular `ShadowDomManager` is used. However, if you replace `__RRWEB_EXCLUDE_SHADOW_DOM__` at build time with `true`, the `ShadowDomManagerNoop` will be used, and the `ShadowDomManager` will thus be tree shaken away.

## Removed canvas recording support by default

Since we currently do [not support replaying captured canvas elements](https://github.com/getsentry/sentry-javascript/issues/6519), and because the canvas capturing code makes up a considerable amount of the rrweb codebase,
we decided to remove this code by default from our rrweb fork, and instead allow you to opt-in to use this by passing a canvas manager into the rrweb `record()` function.

We implemented this in [getsentry/rrweb#122](https://github.com/getsentry/rrweb/pull/122), where we started to export a new `getCanvasManager` function, as well as accepting such a function in the `record()` method. With this, we can successfully tree-shake the unused canvas manager out, leading to smaller bundle size by default, unless users manually import & pass the `getCanvasManager` function.

Once we fully support capturing & replaying canvas elements in Session Replay [(coming soon)](https://github.com/getsentry/sentry-javascript/issues/6519), we will add a configuration option to `new Replay()` to opt-in to canvas recording.

## Removed unused code from rrweb

Another step we took to reduce bundle size was to remove & streamline some code in our rrweb fork.
rrweb can be configured in a lot of different ways and is very flexible. However, due to its flexibility, a lot of the code is not tree shakeable, because it depends on runtime configuration.

For example, consider code like this:

```js
import { large, small } from './my-code'

function doSomething(useLarge) {
  return useLarge ? large : small
}
```

In this code snippet, even if we know we only ever call this as `doSomething(false)`, it is impossible to tree shake the `large` code away,
because statically we cannot know at build time that `useLarge` will always be `false`.

Because of this, we ended up fully removing certain parts of rrweb from our fork:

- `hooks` related code [getsentry/rrweb#126](https://github.com/getsentry/rrweb/pull/126)
- `plugins` related code [getsentry/rrweb#123](https://github.com/getsentry/rrweb/pull/123)
- Remove some functions on `record` that we don't need [getsentry/rrweb#113](https://github.com/getsentry/rrweb/pull/113)

In addition, we also made some general small improvements which we also contributed upstream to the main rrweb repository:

- Avoid unnecessary cloning of objects or arrays [getsentry/rrweb#125](https://github.com/getsentry/rrweb/pull/125)
- Avoid cloning events to add timestamp [getsentry/rrweb#124](https://github.com/getsentry/rrweb/pull/124)

## Removed unused code in Session Replay

In addition to rrweb, we also identified & removed some unused code in Session Replay itself:

- Clean up some logs and internal checks [getsentry/sentry-javascript#9392](https://github.com/getsentry/sentry-javascript/pull/9392), [getsentry/sentry-javascript#9391](https://github.com/getsentry/sentry-javascript/pull/9391)
- Remove unused function [getsentry/sentry-javascript#9393](https://github.com/getsentry/sentry-javascript/pull/9393)

## Updated library used for compression

We used to compress replay payloads with [pako](https://github.com/nodeca/pako), which, while it worked well enough, turned out to be a rather large (bundle-size wise) library for compression.
We switched over to use [fflate](https://github.com/101arrowz/fflate) in [getsentry/sentry-javascript#9436](https://github.com/getsentry/sentry-javascript/pull/9436) instead, which reduced bundle size by a few KB.

## Made it possible to host compression worker

We use a web worker to compress Session Replay recording data.
This helps to send less data over the network, and reduces the performance overhead for users of the SDK.
However, the code for the compression worker makes up about 10 KB gzipped of our bundle size - a considerable amount!

Additionally, since we have to load the worker from an inlined string due to CORS restrictions, the included worker does not work for certain environments,
because it requires a more lax [CSP](https://developer.mozilla.org/en-US/docs/Web/HTTP/CSP) setting which some applications cannot comply with.

In order to both satisfy stricter CSP environments, as well as allowing to optimize the bundle size of the SDK, we added a way to tree shake the included compression worker, and instead provide a URL to a self-hosted web worker.

Implemented in [getsentry/sentry-javascript#9409](https://github.com/getsentry/sentry-javascript/pull/9409),
we added an example web worker that users can host on their own server, and then pass in a custom `workerUrl` to `new Replay({})`.
With this setup, users save 10 KB gzipped of their bundle size, and can serve the worker as a separate asset that can be cached independently.
