---
title: "Sentry JavaScript SDK v8 - A Retrospective"
date: "2024-07-16"
tags: ["javascript", "sdk"]
draft: false
summary: "This post will outline learnings the Sentry SDK team had from releasing v8 of the JavaScript SDKs."
images: [../../assets/images/js-sdk-v8-retrospective/hero.jpg]
postLayout: PostLayout
canonicalUrl: https://sentry.engineering/blog/js-sdk-v8-retrospective
authors: ["francesconovy"]
---

On May 13, 2024, Sentry's JavaScript SDK team shipped [v8.0.0](https://github.com/getsentry/sentry-javascript/releases/tag/8.0.0) of the JavaScript SDKs. This major release has been in progress for many months, as the team worked to ensure that all the changes made in this version were well-tested, and that upgrading would be as easy and painless as possible for our users.

However, v8 was quite a massive release, with many changes. Primarily, `@sentry/node` has been rewritten to use OpenTelemetry under the hood. This change, in turn, required us to make a variety of smaller and larger changes to accommodate the APIs that OpenTelemetry supports. The largest of those was adjusting all the performance APIs to be compatible with OpenTelemetry.

## Changes between v7 and v8

You can read more about all the changes we did and how to migrate from v7 to v8 either in the [Browser JS Migration docs](https://docs.sentry.io/platforms/javascript/migration/v7-to-v8/) or in the [Node JS Migration docs](https://docs.sentry.io/platforms/javascript/guides/node/migration/v7-to-v8/).

This blog post does not aim to explain all the changes we made in v8. Instead, the goal of this post is to discuss takeaways we identified during and after working on this large release, and more directly, sharing things we’d do again and differently in future major releases.

## Things we want to improve in the future

### Shipping smaller majors

Our biggest takeaway was that v8 was too large. Due to the host of changes necessary to make the Sentry SDK compatible with OpenTelemetry, we included too many breaking changes in the release - leading to the changelog and migration path becoming harder than necessary to parse for users.

For future releases, we want to center them around one or few breaking changes max, making it much easier to grasp if a breaking change in a major affects you. Instead, we plan to, if necessary, release major versions more often. To summarize, instead of having few majors (e.g. every other year) with a lot of breaking changes, we rather want to have more majors (e.g. one or two per year) with fewer breaking changes.

### Versioned docs

For most changes, we managed to implement the updated methods on v7, allowing users to upgrade to the latest v7 version and use the new methods there even before updating to v8. However, for some things this was not possible, especially for the core Node SDK setup, which changed.

It is not possible to provide different docs for different versions of the SDK due to the way our docs work today. This meant that we were not able to write docs for certain v8 features before v8 actually shipped, which in turn also led to docs constantly lagging behind implementation a bit.

We are planning to implement versioned docs in the future, which will allow us to start writing docs for an upcoming major while it is still in prerelease, ensuring that the docs are fully finished by the time we do a stable release of the SDK.

### Update docs in tandem with deprecations

We shipped a lot of deprecations in v7, and included replacement variants for all the things we deprecated. However, we often lagged behind in updating our docs to reflect the new way of doing things, leading to confusion with users. Going forward, we plan to update docs right after we ship a deprecation, ensuring the code snippets on docs never lead to deprecation warnings.

### Be critical of adding deprecations

We always try to be critical when adding deprecations to the SDK codebase. However, looking back, there are certainly a few places where we deprecated things that were not _strictly necessary_ to be deprecated. We should always ask ourselves a second and third time if a deprecation is truly required before adding it. For example, we could have held back on removing the class-based integrations for one more major release, giving users more time to migrate.

### Be more active in the OpenTelemetry community

Since we heavily rely on OpenTelemetry now, we want to be active contributors in the community, as much as possible. We have already started attending meetings and plan to expand on this even more in the future.

## Things that went well

There were also a lot of things that went well during the v8 release cycle:

- We have good coverage of E2E test apps testing “real world” scenarios with the SDKs. This helped a lot with confidence building. Additionally, we also wrote some example apps to further test how things behaved.
- The general process to implement deprecations with their replacements in v7 and then just removing the deprecated methods in v8 worked well, mostly.
- Supporting backported fixes/features in v7 while working on v8 led to few issues. We ended up shipping quite a few v7 versions while working on v8, including a series of features and improvements.
- The pre-release cycle (alpha, beta, rc) of v8 helped us to uncover countless bugs, fulfilling its purpose.
- After the release of v8, we worked hard on resolving issues that came up, and resolved a series of problems (many of them coming from the integrations with OpenTelemetry) in just a few weeks.

## Onwards...

Big shoutout to the whole team that made this massive release possible! It has been quite a ride, and it was only possible due to the combined effort of the JavaScript SDK team. Now, if you'll excuse us, we'll continue to iterate on the SDK (actually, we are [already at v8.18.0](https://github.com/getsentry/sentry-javascript/releases/tag/8.18.0)).
