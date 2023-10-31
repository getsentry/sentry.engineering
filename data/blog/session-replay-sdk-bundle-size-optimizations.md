---
title: 'Session Replay SDK Bundle Size Optimizations'
date: '2023-10-31'
tags: ['sdk', 'javascript', 'replay', 'session-replay']
draft: false
summary: 'An in-depth analysis of how we managed to cut the Session Replay SDK bundle size by X%.'
images: [/images/session-replay-sdk-bundle-size-optimizations/hero.jpg]
layout: PostLayout
canonicalUrl: https://sentry.engineering/blog/session-replay-sdk-bundle-size-optimizations
authors: ['francesconovy']
---

Bundle Size Overview

## Version | Bundle Size | What

7.72.0 | 75.58 KB | Before updating to rrweb 2.0
7.73.0 | 84.26 KB | After updating to rrweb 2.0
7.77.0 | 77.44 KB | New default
7.77.0 | 66.48 KB | With all tree shaking options configured

TODO FN: Update bundle size when all is done

## Steps to reduce the SDK bundle size

In order to achieve these bundle size improvements, we took a couple of steps ranging from removing unused code to build time configuration and improved tree shaking:

- Allow to remove iframe & shadow dom support via a build-time flag
- Removed canvas recording support by default (users can opt-in via a config option)
- Remove unused code from our rrweb fork
- Remove unused code in Session Replay itself
- Allow to remove the included compression worker in favor of hosting it yourself

## Primer: rrweb

[rrweb](https://github.com/rrweb-io/rrweb) is the underlying tool we use to make the recordings for Session Replay.
While we try to contribute to the main rrweb repository as much as possible, there are some changes that are very specific to our needs at Sentry,
which is why we also maintain a [forked version](https://github.com/getsentry/rrweb) of rrweb with some custom changes.

## Primer: Tree Shaking

If you do not know what tree shaking is and how it works, you can [read about it in our docs](https://docs.sentry.io/platforms/javascript/configuration/tree-shaking/).

## Allow to remove iframe & shadow dom support via a build-time flag

While rrweb allows to capture more or less everything that happens on your page, some of the things it can capture may not be necessary for some users.
For these cases, we now allow users to manually remove certain parts of the rrweb codebase they may not need at build time, reducing the bundle size.

In [getsentry/sentry-javascript#9274](https://github.com/getsentry/sentry-javascript/pull/9274) & [getsentry/rrweb#114](https://github.com/getsentry/rrweb/pull/114) we implemented the ground work to allow to tree shake iframe and shadow dom recording. This means that if, for example, you don't have any iframes on your page, you can safely opt-in to remove this code from your application.

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

This will safe you about 5 KB gzipped of bundle size!

### How to implement build-time tree shaking flags

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

And in turn, since the code inside of `if (false)` will definitely never be called, will be completely tree shaken away.

For rrweb, we used the same approach to allow to remove certain recording managers:

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

2. Now, in the place where the ShadowDomManager is usually initialized, we can do the following:

```js
const shadowDomManager =
  typeof __RRWEB_EXCLUDE_SHADOW_DOM__ === 'boolean' && __RRWEB_EXCLUDE_SHADOW_DOM__
    ? new ShadowDomManagerNoop()
    : new ShadowDomManager()
```

This means that by default, the regular `ShadowDomManager` is used. However, if you replace `__RRWEB_EXCLUDE_SHADOW_DOM__` at build time with `true`, the `ShadowDomManagerNoop` will be used, and the `ShadowDomManager` will thus be tree shaken away.

## Removed canvas recording support by default

Since we currently do not support replaying captured canvas elements, and because the canvas capturing code makes up a considerable amount of the rrweb codebase,
we decided to remove this code by default from our rrweb fork, and instead allow to opt-in to use this by passing a canvas manager into the rrweb `record()` function.

We implemented this in [getsentry/rrweb#122](https://github.com/getsentry/rrweb/pull/122), where we started to export a new `getCanvasManager` function, as well as accepting such a function in the `record()` method. With this, we can successfully tree-shake the unused canvas manager out, leading to smaller bundle size by default, unless users manually import & pass the `getCanvasManager` function.

Once we fully support capturing & replaying canvas elements in Session Replay, we will add a configuration option to `new Replay()` to opt-in to canvas recording.

## Remove unused code from rrweb

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

## Remove unused code in Session Replay

In addition to rrweb, we also identified & removed some unused code in Session Replay itself:

- Remove unused compression worker code [getsentry/sentry-javascript#9369](https://github.com/getsentry/sentry-javascript/pull/9369)
- Clean up some logs and internal checks [getsentry/sentry-javascript#9392](https://github.com/getsentry/sentry-javascript/pull/9392), [getsentry/sentry-javascript#9391](https://github.com/getsentry/sentry-javascript/pull/9391)
- Remove unused function [getsentry/sentry-javascript#9393](https://github.com/getsentry/sentry-javascript/pull/9393)

Especially the unused compression worker code safed us about 5 KB gzipped.

## Allow to host compression worker

We use a web worker to compress Session Replay recording data.
This helps to send less data over the network, and reduces the performance overhead for users of the SDK.
However, the code for the compression worker makes up about 10 KB gzipped of our bundle size - a considerable amount!

Additionally, since we have to load the worker from an inlined string due to CORS restrictions, the included worker does not work for certain environments,
because it requires a more lax [CSP](https://developer.mozilla.org/en-US/docs/Web/HTTP/CSP) setting which some applications cannot comply with.

In order to both satisfy stricter CSP environments, as well as allowing to optimize the bundle size of the SDK, we added a way to tree shake the included compression worker, and instead provide a URL to a self-hosted web worker.

Implemented in [getsentry/sentry-javascript#9409](https://github.com/getsentry/sentry-javascript/pull/9409),
we added an example web worker that users can host on their own server, and then pass in a custom `workerUrl` to `new Replay({})`.
With this setup, users safe 10 KB gzipped of their bundle size, and can serve the worker as a separate asset that can be cached independently.
