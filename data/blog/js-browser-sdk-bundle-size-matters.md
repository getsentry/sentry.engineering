---
title: "How we trimmed the Sentry JavaScript SDK file size by 20%"
date: '2022-02-28'
tags: ['javascript','web','sdk']
draft: false
summary: SDKs naturally increase in size over time. After all, it does take more bytes to implement more features. This is not a big deal for most languages—the relative size of each new feature is small, and load times and storage aren’t big concerns for code running on a server. Larger JS bundles mean longer load times, which in turn increase user misery, which then can cause the user to leave pages entirely.
images: []
layout: PostLayout
canonicalUrl: https://blog.sentry.io/2022/02/28/js-browser-sdk-bundle-size-matters/
authors: ['abhijeetprasad','katiebyers','steveneubank']
---

SDKs naturally increase in size over time. After all, it does take more bytes to implement more features. This is not a big deal for most languages—the relative size of each new feature is small, and load times and storage aren’t big concerns for code running on a server.

On the other hand, browser-based JavaScript SDKs have to load in the browsers of our customers’ users (in what is called “bundles” of code.) Larger JS bundles mean longer load times, which in turn increase user misery, which then can cause the user to leave pages entirely.

## How much does JS bundle size really matter?
Simply put, JavaScript bundle size matters a lot. From some of the folks that help steer the ship:

> Companies with high-traffic applications save millions of dollars by tweaking and optimizing their performance. Google, for example, found out that a one-half-second delay in returning a search results page damaged user satisfaction, resulting in a 20% drop in traffic. And for a company that generates 95% of its profits from advertising, a 20% drop in traffic meant millions of dollars in lost revenue. Amazon did a similar experiment as well, and found out that even very small delays—increments of 100 milliseconds—resulted in a significant drop in revenue.
>
> \- Third-Party JavaScript, Ben Vinegar & Anton Kovalyov, 2013

And yes, [there is a lot of debate](https://medium.com/swlh/the-unhealthy-obsession-with-javascript-bundle-size-bf0945184c86) about bundle size obsession. But not everyone in the world has access to high-speed internet and the latest and greatest toys from big smartphone and laptop manufacturers. Those folks are disproportionately affected by the move towards bigger and bigger web apps with longer and longer load times.

In the future, we think we’ll see some fundamental changes to address this—and we’d like to help lead that charge—but in the meantime, we need to optimize as much as we can with the tools available. It required a lot of research, trial and error, and bikeshedding, but we’re pleased to say we are achieving measurable success.

## Why is reducing bundle size hard?
The JavaScript SDK (especially on the browser) is one of our most popular SDKs. Last year leading up to the holiday shopping season, we broke over 3 million downloads a day (via npm alone). So, we really don’t want to break something, degrading the user experience and making the lives of all our friends in support a nightmare.

To make matters even more complicated, there were a variety of ways we could approach the problem. We could make the SDK more “tree-shakeable,” reduce the number of bytes in the SDK, adopt new async loading strategies for different parts of the SDK or more. These changes could have been breaking (required SDK end-user changes) or not, so we were quickly getting overwhelmed with the scope of it all. In the end, we realized for this initiative to succeed, we needed a clear plan and a solid foundation.

To get the foundation in place, we decided to first work on release stability. Release stability covered all the work that goes into shipping our SDK in a reliable manner—checking that everything still worked as it did before.

This included unit tests, integration tests, e2e, and some new concepts for testing like “tree shake-ability” of the browser SDK. Before we started our work, testing on the JS SDK was sub-optimal. There were the infamous ember tests that constantly failed but weren’t maintained by someone on the team, browser stack integration tests that took forever (and constantly flaked), and issues with our unit test coverage for both browser and node.

To improve this, [we reactivated our old browser integration tests](https://github.com/getsentry/sentry-javascript/pull/4226), we contributed with [new browser integration tests using the Playwright framework](https://github.com/getsentry/sentry-javascript/pull/3989), and then we ran a [BUNCH of integration tests](https://github.com/getsentry/sentry-javascript/pulls?q=is%3Apr+add+integration+tests+is%3Aclosed+milestone%3A%22Release+Stability%22).

These new integration tests covered all the browser-specific public APIs and now, also tracing, where we didn’t have tracing before (still terrible coverage in Node, but “Rome wasn’t” … you get it.)

## Getting stuff done
Now having the plan was awesome, but we recognized that there were changes we could make that have little to no risk but still add a ton of value. In the week before the holiday break in December, we assembled a task force to push out some of these quick wins. The goal of this task force? To reduce the size of the minified uncompressed bundle by 15%.

Here are some of the methods we used to achieve these quick wins:

* Reducing the usage of un-minifiable Public Class Declarations
* Removing unnecessary TypeScript enums (which don’t transpile to es5 well)
* Reducing wasteful protocol code
* Removing usage of optional chaining (which doesn’t transpile to es5 well)
* Converting classes to functions + objects
* Simplifying the internal logger
* Consolidating duplicate code
* Investigating producing different types of bundles (debug, production)

The iteration speed was quick, with PRs quickly opening and closing to test out new ideas—it was awesome.

![](/images/js-browser-sdk-bundle-size-matters/gh-pr.png)

We monitored this process day by day, tracked all the PRs in a GH milestone, and made sure to add tests to increase confidence. We then shipped these changes in a new SDK version, 6.17.0

![](/images/js-browser-sdk-bundle-size-matters/tweet.png)

It’s more like 15-16%.

![](/images/js-browser-sdk-bundle-size-matters/size-diff.png)

Consider the full timeline and then how long it took the team to achieve this in Q4.

![](/images/js-browser-sdk-bundle-size-matters/timeline.png)

## What’s Next?
Now that we’ve put the foundation in place with release stability confidence and tackled the quick wins, we can proceed with shipping a new major version of the JavaScript SDK. This will further enable tree-shaking optimizations in the SDK and reduce another 15% of the bundle size. [You can read about how we reduced it by 29% in all](/blog/javascript-sdk-package-reduced). 

After we ship the major, there are a variety of next steps we can consider.

Optimize hubs and scopes, allowing us to reduce bundle size and better support micro-frontend application
Go further with tree-shaking support
Expand on async loading, making it easier to selectively load parts of the SDK
Refactor the internals even more, maybe even adopting a hook system?
Refactor the Node SDK to use async hooks instead of domains
All of these are not equal in value nor in feasibility. Nevertheless, they’re on our list of what we would like to do (PRs are welcome.)

Finally, please give us your feedback—anyone and everyone. Drop us a line on GitHub, Twitter, or our Discord. And if you’re new to Sentry, you can try it for free today or write to sales@sentry.io to get started.