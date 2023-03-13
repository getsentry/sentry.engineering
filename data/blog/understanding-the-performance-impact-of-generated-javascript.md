---
title: "Understanding the Performance Impact of Generated JavaScript"
date: '2022-07-22'
tags: ['javascript','performance','sdk']
draft: false
summary: In the modern web, the JavaScript you write is often down-compiled using a compiler like Babel to make sure your JavaScript is compatible with older browsers or environments. In addition, if you are using TypeScript (like the Sentry SDK’s do) or something similar, you’ll have to transpile your TypeScript to JavaScript. Understanding how your code is being transpiled and downcompiled is important, because your bundle size is affected by your final generated JavaScript. This post is all about the technical prep work needed to ship a 0 bug reported major issue.
images: []
layout: PostLayout
canonicalUrl: https://blog.sentry.io/2022/07/22/performance-impact-of-generated-javascript/
authors: ['abhijeetprasad','katiebyers']
---

In the modern web, the JavaScript you write is often down-compiled using a compiler like [Babel](https://babeljs.io/) to make sure your JavaScript is compatible with older browsers or environments. In addition, if you are using TypeScript (like the Sentry SDK’s do) or something similar, you’ll have to transpile your TypeScript to JavaScript.

Here we define **transpilation** as the process of converting source code of one language to another language, and **down-compilation** to be the process of converting source code to a more backward-compatible version of that source code.

Understanding how your code is being transpiled and downcompiled is important, because your bundle size is affected by your **final generated JavaScript**.

This was what helped us [reduce the size of our JavaScript SDK by 29%](https://blog.sentry.io/2022/07/19/javascript-sdk-package-reduced/) in v7 of the [Sentry JavaScript SDK](https://github.com/getsentry/sentry-javascript). This post is all about the technical prep work needed to ship a 0 bug reported major issue.

## Maintaining release stability before refactoring
The JavaScript SDKs are the largest set of SDKs at Sentry, with thousands of organizations relying on them to instrument their applications. As such, we need to make sure that the changes we make to the SDK do not introduce behavior regressions or crashes in user code.

Before the major release, we completely revamped our integration testing setup. We [introduced brand new browser based integration tests](https://github.com/getsentry/sentry-javascript/tree/master/packages/integration-tests) that ran on [Playwright](https://playwright.dev/), allowing us to test on Chrome, Safari and Firefox at the same time. We also introduced [brand new node integration tests that](https://github.com/getsentry/sentry-javascript/tree/master/packages/node-integration-tests) ran on a custom framework we built out that used the Node.js [Nock library](https://github.com/nock/nock). Having this integration test setup gave us the confidence to make large scale refactors that were required to try to reduce bundle size.

## Diving into the generated JavaScript
The changes in the major release required some Sentry-specific refactoring, but there were quick wins that we decided to start with:

* Removing usages of optional chaining
* Using const enums or string constants instead of TypeScript enums

### Removing optional chaining
[Optional chaining](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Operators/Optional_chaining) is a newer JavaScript feature, introduced with ES2020 in June 2020. This means that it must be down-compiled so that it works with older browsers.

When examining the final generated JavaScript SDK code, we noticed it produced a lot of extra bytes. For example, this small snippet:

```js
if (hey?.me) {
  console.log('me');
} 
```

Would produce a generated output like so when targeting ES6.

```js
if (hey !== null && hey !== void 0 && hey.me) {
  console.log('me');
}          
```

This is way more bytes than the equivalent short boolean short circuit:

```js
if (hey && hey.me) {
  console.log('me');
}             
```

We could switch to the boolean short circuit expression because the Sentry SDK is written in TypeScript. This gives us the confidence to rely on type coercion to make sure things are typed correctly. We removed all [usages of optional chaining in our SDKs](https://github.com/getsentry/sentry-javascript/pulls?q=is%3Apr+optional+chaining+is%3Aclosed+milestone%3A%22Tree+shaking+%2F+Bundle+Size%22) that could be used in the browser, giving us some nice bundle size wins.

### Switching from TypeScript enums to const and string enums
Another piece of bloated generated JavaScript we noticed were [TypeScript enums](https://www.typescriptlang.org/docs/handbook/enums.html). Aside from regular object access, TypeScript enums also provide [reverse mapping](https://www.typescriptlang.org/docs/handbook/enums.html#reverse-mappings), the ability to map enum values to enum names if they are not string enums.

A string enum like so:

```js
export enum Severity {
  /** JSDoc */
  Fatal = 'fatal',
  /** JSDoc */
  Error = 'error',
  /** JSDoc */
  Warning = 'warning',
  /** JSDoc */
  Log = 'log',
  /** JSDoc */
  Info = 'info',
  /** JSDoc */
  Debug = 'debug',
  /** JSDoc */
  Critical = 'critical',
}
```

Would map to something like:

```js
export var Severity;
(function (Severity) {
  /** JSDoc */
  Severity["Fatal"] = "fatal";
  /** JSDoc */
  Severity["Error"] = "error";
  /** JSDoc */
  Severity["Warning"] = "warning";
  /** JSDoc */
  Severity["Log"] = "log";
  /** JSDoc */
  Severity["Info"] = "info";
  /** JSDoc */
  Severity["Debug"] = "debug";
  /** JSDoc */
  Severity["Critical"] = "critical";
})(Severity || (Severity = {}));
```

A regular enum like so:

```js
/** SyncPromise internal states */
enum States {
  /** Pending */
  PENDING,
  /** Resolved / OK */
  RESOLVED,
  /** Rejected / Error */
  REJECTED,
}
```

Would map to something like:

```js
/** SyncPromise internal states */
var States;
(function (States) {
  /** Pending */
  States[States["PENDING"] = 0] = "PENDING";
  /** Resolved / OK */
  States[States["RESOLVED"] = 1] = "RESOLVED";
  /** Rejected / Error */
  States[States["REJECTED"] = 2] = "REJECTED";
})(States || (States = {}));
```

In this case, this was a lot of extra generated code that could be removed. For enums that were only used internally, we took advantage of [const enums](https://www.typescriptlang.org/docs/handbook/enums.html#const-enums) which automatically inlined the enum members where they were used. This meant that the enum would not generate any code. In the case of string enums, this also gzipped very well, due to the repeated strings.

Const enums could only be used internally though as the enums are removed at transpile time. This means they couldn’t be imported and used by users of the SDK. For public exported enums, we deprecated them in favor of string constants. See an [example of these enum changes](https://github.com/getsentry/sentry-javascript/pull/4280), which gave us a good amount of bundle size wins.

## Minify JavaScript Assets
An important part of getting the bundle as small as possible is minification. Minification is exactly what it sounds like: making your JavaScript assets as small as possible. In the minification process, we remove white space, comments, and other unnecessary tokens, and shorten variable and function names. Modern bundlers like Webpack will [minify your code by default](https://webpack.js.org/guides/production/#minification) in production mode. For example, the following code:

```js
// An example JS function
export function theBestFunction(arg1, arg2) {
  const bestObject = {
    key: arg1,
    veryVeryLongKey: {
      nestedKey: arg2,
    }
  }
  return bestObject;
}
```

Minifies to the snippet below (using the [terser library](https://github.com/terser/terser), which is what the Sentry SDK uses to produce minified assets).

```js
export function
theBestFunction(e,n){return{key:e,veryVeryLongKey:{nestedKey:n}}}
```

Beautified:

```js
export function theBestFunction(e, n) {
  return {
    key: e,
    veryVeryLongKey: {
      nestedKey: n
    }
  }
}
```

This reduced the number of bytes taken up by the snippet by 60% - a substantial amount of savings. This means it’s often essential to minify the JavaScript assets. Minification isn’t always as straightforward as using a library like terser, there are more complex and manual minifications you will also have to do to make sure there are no breaking changes:

* Using try-catch blocks to catch undefined objects
* Using local variables instead of object keys
* Minifying private class and method names and moving towards functions and objects

### Using try-catch blocks to minify code requiring nested object access
Not everything can be minified or shortened though. Revisit the minified code from above:

```js
export function
theBestFunction(e,n){return{key:e,veryVeryLongKey:{nestedKey:n}}}
```

[Reserved keywords](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Lexical_grammar#keywords) (e.g. function, return, and typeof) are used by the JavaScript language themselves, so cannot be minified. In addition, identifiers that are required for code to work properly like object keys or class methods are not minified. In the example above, the `veryVeryLongKey` property of the `bestObject` object cannot be minified because users need to be able to access the `{ nestedKey: arg2 }` value using the `veryVeryLongKey`.

This means if you had nested property access like an `Object.veryLongKey1.anotherLongKey.theThirdKey`, only the `anObject` variable would get minified (as it’s simply just a pointer to the object). The nested keys cannot get minified because they are needed to index the various nested objects.

We had examples of this throughout the SDK codebase, where we would do undefined checks to make sure we didn’t throw any errors.

```js
// packages/core/src/integrations/inboundfilters.ts
try {
  return (
    (event &&
      event.exception &&
      event.exception.values &&
      event.exception.values[0] &&
      event.exception.values[0].type === 'SentryError') ||
      false
  );
  } catch (_oO) {
  return false;
}
```

In the example above, exception, values, and type could never get minified, which just means extra bytes added. By just taking advantage of the try catch block, we could shorten this to a single line, and ignore the resulting TypeError that would occur if values were undefined.

```js
try {
  // @ts-ignore can't be a sentry error if undefined
  // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
  return event.exception.values[0].type === 'SentryError';
} catch (e) {
  // ignore
}
```

See some more examples of these kinds of changes in [this PR](https://github.com/getsentry/sentry-javascript/pull/4301).

P.S. Optional chaining is the more correct option here, but as established above, also was wasteful in terms of byte size.

### Alias object keys to local variables to enable minification
Another method to reduce the amount of bytes from unminifiable object keys is to alias them to local variables which will get minified. For example:

```js
function enhanceEventBefore(event: Event, url: any, line: any, column:
any): Event {
  event.exception = event.exception || {};
  event.exception.values = event.exception.values || [];
  event.exception.values[0] = event.exception.values[0] || {};
  event.exception.values[0].stacktrace = event.exception.values[0].stacktrace || {};
  event.exception.values[0].stacktrace.frames = event.exception.values[0].stacktrace.frames || [];
  // ...
}
```

Can be reduced to:

```js
function enhanceEventAfter(event: Event, url: any, line: any, column:any):Event {
  // event.exception
  const e = (event.exception = event.exception || {});
  // event.exception.values
  const ev = (e.values = e.values || []);
  // event.exception.values[0]
  const ev0 = (ev[0] = ev[0] || {});
  // event.exception.values[0].stacktrace
  const ev0s = (ev0.stacktrace = ev0.stacktrace || {});
  // event.exception.values[0].stacktrace.frames
  const ev0sf = (ev0s.frames = ev0s.frames || []);
  // ...
}
```

Comparing the two after minification, we can see that the method with the alias (enhanceEventAfter) saves some bytes compared to the method without bytes.

```js
// 352 bytes
function enhanceEventBefore(n, t, e, i) {
  n.exception = n.exception || {}, n.exception.values = 
n.exception.values || [], n.exception.values[0] =
n.exception.values[0] || {}, n.exception.values[0].stacktrace =
n.exception.values[0].stacktrace || {},
  n.exception.values[0].stacktrace.frames =
n.exception.values[0].stacktrace.frames || []
}

// 232 bytes
function enhanceEventAfter(n, t, e, i) {
  const a = n.exception = n.exception || {},
    c = a.values = a.values || [],
    h = c[0] = c[0] || {},
    o = h.stacktrace = h.stacktrace || {};
    o.frames = o.frames || []
}
```

### Converting classes to objects and functions and minimizing private fields
Just like object properties, class methods and identifiers also don’t get minified. Let’s look at an example from the Sentry codebase, the API class, which the SDK uses to manage how it sends data to a Sentry instance.

```js
export class API {
  /** The DSN as passed to Sentry.init() */
  public dsn: DsnLike;

  /** Metadata about the SDK (name, version, etc) for inclusion in envelope headers */
  public metadata: SdkMetadata;

  /** The internally used Dsn object. */
  private readonly _dsnObject: Dsn;

  /** The envelope tunnel to use. */
  private readonly _tunnel?: string;

  /** Create a new instance of API */
  public constructor(dsn: DsnLike, metadata: SdkMetadata = {}, tunnel?: string) {
    this.dsn = dsn;
    this._dsnObject = new Dsn(dsn);
    this.metadata = metadata;
    this._tunnel = tunnel;
  }

  /** Returns the Dsn object. */
  public getDsn(): Dsn {
    return this._dsnObject;
  }

  /** Does this transport force envelopes? */
  public forceEnvelope(): boolean {
    return !!this._tunnel;
  }

  /** Returns the prefix to construct Sentry ingestion API endpoints.*/
  public getBaseApiEndpoint(): string {
    const dsn = this.getDsn();
    return getBaseApiEndpoint(dsn);
  }

  /** Returns the store endpoint URL. */
  public getStoreEndpoint(): string {
    return this._getIngestEndpoint('store');
  }

  /**
  \* Returns the store endpoint URL with auth in the query string.
  \*
  \* Sending auth as part of the query string and not as custom HTTP headers avoids CORS preflight requests.*/
  public getStoreEndpointWithUrlEncodedAuth(): string {
    return `${this.getStoreEndpoint()}?${this._encodedAuth()}`;
  }

  /**
  \* Returns the envelope endpoint URL with auth in the query string.
  \*
  \* Sending auth as part of the query string and not as custom HTTP
  headers avoids CORS preflight requests.*/
  public getEnvelopeEndpointWithUrlEncodedAuth(): string {
    if (this.forceEnvelope()) {
      return this._tunnel as string;
    }
    return `${this._getEnvelopeEndpoint()}?${this._encodedAuth()}`;
  }

  /** Returns only the path component for the store endpoint. */
  public getStoreEndpointPath(): string {
    const dsn = this.getDsn();
    return `${dsn.path ? `/${dsn.path}` : ''}api/${dsn.projectId}/store/`;
  }

  /** Returns the envelope endpoint URL. */
  private _getEnvelopeEndpoint(): string {
    return this._getIngestEndpoint('envelope');
  }

  /** Returns the ingest API endpoint for target. */
  private _getIngestEndpoint(target: 'store' | 'envelope'): string {
    if (this._tunnel) {
      return this._tunnel;
    }

    const base = this.getBaseApiEndpoint();
    const dsn = this.getDsn();
    return `${base}${dsn.projectId}/${target}/`;
  }

  /** Returns a URL-encoded string with auth config suitable for a query string. */
  private _encodedAuth(): string {
    const dsn = this.getDsn();
    const auth = {
      // We send only the minimum set of required information. See
      // <https://github.com/getsentry/sentry-javascript/issues/2572>.
      sentry_key: dsn.publicKey,
      sentry_version: SENTRY_API_VERSION,
    };
    return urlEncode(auth);
  }
}
```

This gets minified to the following (with spacing added for readability):

```js
export class API {
  constructor(t, e = {}, n) {
    this.dsn = t, this.t = new Dsn(t), this.metadata = e, this.i = n
  }

  getDsn() {
    return this.t
  }

  forceEnvelope() {
    return !!this.i
  }

  getBaseApiEndpoint() {
    const t = this.getDsn();
    return a(t)
  }

  getStoreEndpoint() {
    return this.o("store")
  }

  getStoreEndpointWithUrlEncodedAuth() {
    return `${this.getStoreEndpoint()}?${this.h()}`
  }

  getEnvelopeEndpointWithUrlEncodedAuth() {
    return this.forceEnvelope() ? this.i : `${this.p()}?${this.h()}`
  }

  getStoreEndpointPath() {
    const t = this.getDsn();
    return `${t.path?`/${t.path}`:""}/api/${t.projectId}/store/`
  }

  p() {
    return this.o("envelope")
  }

  o(t) {
    if (this.i) return this.i;
      return
    `${this.getBaseApiEndpoint()}${this.getDsn().projectId}/${t}/`
  }

  h() {
    const t = {
      sentry_key: this.getDsn().publicKey,
      sentry_version: SENTRY_API_VERSION
    };
    return c(t)
  }
}
```

In our minification process, we update terser (the library we use for minification in the SDK), to minify private field and method names - those that start with an underscore. This is why `_encodedAuth()` is minified to `h()`.

Public fields and methods on the other hand are not minified. This is especially problematic with very long method names, or long method names that are used very frequently. In addition, this can cause even more problems, because now you have to start paying attention to how long your method names are.

One way to address this is to convert the class into functions + objects. The public fields on the class would become keys on an object, and you would use functions to operate on those objects. As the functions are just top level exports, they can get minified, saving bytes over time. As an example, see when we converted [our internal SDK logger class to a more functional style to save on bytes](https://github.com/getsentry/sentry-javascript/pull/4863).

Although we ended up [converting some more internal classes](https://github.com/getsentry/sentry-javascript/pull/4283) to use a more functional style to save on bytes, we couldn’t convert the biggest classes in the Sentry SDK, the Client and the Hub. This was because many users were manually importing and using these classes, so converting them would make it difficult for those users to upgrade.

## How to minify your code
There are major package size benefits to reducing the amount of generated JavaScript your package is creating. As part of our larger [Javascript SDK package reduction](https://blog.sentry.io/2022/07/19/javascript-sdk-package-reduced/), we spent a considerable effort to minify as much of our code as possible. If you’re looking to do the same, here are six improvements to consider:

1. Remove optional chaining
2. Switch from TypeScript enums to const and string enums
3. Minify JavaScript Assets
4. Use try-catch blocks to minify code requiring nested object access
5. Alias object keys to local variables to enable minification
6. Convert classes to objects and functions and minimizing private fields

## Keep up to date with Sentry’s JavaScript SDK
We highly encourage you to upgrade and give v7 a try for yourself. You can also get involved in improving the SDK by giving feedback or suggesting other bundle size improvements, [by opening a GitHub issue](https://github.com/getsentry/sentry-javascript/issues) or [reaching out on Discord](https://discord.com/invite/Ww9hbqr).