---
title: 'How to Refactor and Not Break Things'
date: '2024-04-30'
tags: ['python', 'refactoring', 'sdk']
draft: false
summary: 'How we completed a huge refactoring of a software used by thousands of developers without breaking things.'
images: ['/images/how-to-refactor-and-not-break-things/hero.jpg']
layout: PostLayout
authors: ['antonpirker']
---

In our Python SDK, we completed a huge refactoring, and I want to write down how we pulled this off without breaking (almost) anything and how we managed to stay mostly backward compatible.

## The Initial Situation

When you add Sentry to your application, it'll instrument the app and runtime to collect useful debugging information at runtime. Depending on the frameworks or libraries you use, the data is collected at different stages of process execution, and is sent to Sentry at a later stage, asynchronously. 
If your application consists of multiple services (like frontend, backend, some microservices, or worker processes consuming items from a queue) the Sentry SDK also propagates tracing information between those services. This makes it possible to link the data from all your services into one trace.

To handle all this data the SDK uses a thing called the Hub. The Hub holds a stack of so-called Scopes. All this was specified in the [Unified API](https://develop.sentry.dev/sdk/unified-api/) a long time ago. Data is sent to Sentry as events. Before sending events to Sentry the data from the Scope(s) is applied to those events. The SDK needs to make sure that only data from the right Scopes is applied to not leak data for example from one thread into the events captured by another thread.

## What We Wanted to Achieve

We wanted to make our API simpler. Remove unnecessary abstractions where possible and thus make it easier for us and for open-source contributors to write new integrations for our SDK. The Hub-based API is used in our integrations but also by power users who do custom performance instrumentations. It can be hard to wrap your head around the concepts of Hubs and Scopes. We wanted to simplify this.

## Why We Wanted to Do This

When doing a big refactoring like this the WHY is very important. We do not want to refactor just for refactoring's sake. 
In recent years [OpenTelemetry](https://opentelemetry.io/) has become more popular and we wanted to make sure Sentry is compatible with OpenTelemetry. 
We discovered that with our current Hub implementation that was not the case, so we decided to remove the Hub and switch to have only Scopes and make them behave like Contexts in OpenTelementry. This makes Sentry 100% compatible with OpenTelemetry and paves the way for the future.

## This Is a Huge Undertaking, We need a Plan!

Some goals that we wanted to achieve with the refactoring:

- Be as backward compatible as possible. If possible, our users should not need to change their custom Sentry code.
- Because we changed how we handle data, we wanted to make sure that we do not use more resources (CPU and memory) compared to before the refactoring.
- Do not break things. Behavior must stay the same.
- Do it in baby steps. Have only PRs of manageable size. (No one can review a PR with 120 files changed.)
- Because this is a massive change, we decided to make it a major version update. Sentry SDK 2.0!

## Phase I: Preparation

There is a quote by [Kent Beck](https://twitter.com/kentbeck/status/250733358307500032):

> Make the change easy, then make the easy change. (Warning, the first part might be hard)

In this first phase, we moved existing functionality away from the Hub into the Scope. We did several PRs that each moved one or two functions from the Hub into the Scope and changed the function in the Hub to call its counterpart in the Scope.

This way we had a couple of smaller PRs that each dealt with one topic and were easy to review.

After we moved all the functionality from the Hub into the Scope our extensive test suite was still all green, giving us confidence that we did not change any behavior. Because neither the top-level Sentry API nor the Hub-based API was changed this could be released in a minor version update.

This concluded the preparation of our canvas. Time to make the change.

## Phase II: New Scopes

Phase I left us with a hollow shell of a Hub and all functionality in the Scope. We now refactored the Scope. This was the biggest part. We changed how the Scope was stored in memory (it's not on the Hub anymore but saved as a Python Context Variable). We also introduced three different flavors of the Scope for better encapsulation of data. If you want to dig into details read our [develop docs on the topic](https://develop.sentry.dev/sdk/hub_and_scope_refactoring/).

After we updated the Scope the old Hub-based API could still be used, but under the hood, the new Scopes-based API was called. We did not release this phase because we wanted to first do Phase III.

Again, our test suite gave us confidence that the SDK still behaved the same as before.

## Phase III: Use New Scopes Everywhere

In the Python SDK, we have over 40 integrations for various web frameworks, databases, and other libraries. All of them still used the Hub-based API.

We updated each integration from the old Hub-based API to the new Scope-based API in a separate PR. This was pretty straightforward and done in a couple of days.

Doing this gave us insights into the look and feel of the new API. Because we now used the API in the same way as our power users would use it in the future. We found some things that we did not like and made some minor changes to the new API to make it more convenient to use. Having one PR for each integration created a lot of small PRs that were easy to review.

After we had all PRs merged, we created a release candidate and released it on PyPI so everyone could give it a try and we could gather feedback.

We updated our internal usage dashboards so we could see the adoption of the new release candidate.

## Phase IV: Load Testing and Dogfooding

We started to do load testing. We created a [sample application and ran load tests](https://github.com/getsentry/demo-flask-load-test) locally to check if the CPU and memory usage would change between the current SDK and the new 2.0 version. It did not. After the load tests, we were confident that we could use the release candidate on Sentry.io.

[Sentry.io is a very big Python code base](https://github.com/getsentry/sentry) where we use all the advanced features of the SDK. It is a perfect candidate for dogfooding because it will uncover problems very soon.

We first installed the new SDK on our Canary servers. We let it run for an hour and closely monitored CPU and memory. Everything looked good. Like with the local load tests, nothing spiked.

Time for some proper dogfooding.

We installed SDK 2.0 on **all** our servers. After running the new version for a week on Sentry.io we discovered that there was a problem in the Celery integration where the baggage header (used for propagating trace information) was handled incorrectly. [After fixing this](https://github.com/getsentry/sentry-python/pull/2993), we created a new release candidate and continued the dogfooding.

All in all, we created 6 release candidates where we each time fixed some smaller problems or made improvements.

## Finally: The Release

We fixed all issues we uncovered during dogfooding, giving us enough confidence to move forward. All data collected looked good, and CPU and memory usage was the same as before we [released version 2.0](https://github.com/getsentry/sentry-python/releases/tag/2.0.0).

On the first day, there was a [bug report](https://github.com/getsentry/sentry-python/issues/3021) from a user when using the SDK with the Starlette framework and Uvicorn as the server. We fixed the problem and released [2.0.1](https://github.com/getsentry/sentry-python/releases/tag/2.0.1) right away.

There was [one problem with propagating trace information in Celery](https://github.com/getsentry/sentry-python/issues/3068) that was caused by this refactoring.

We are now a couple of months after the 2.0 release and the bug tracker has been quiet, no other regressions were reported.

Our internal usage dashboards showed that our users (like a very popular music streaming app) were adopting the new major version and sent hundreds of millions of events to Sentry.

We are confident that the refactoring was a success and our SDK is now set up for the future. Making it easier to implement anything the future might bring.

And where does the newborn SDK go from here? The net is vast and infinite.
