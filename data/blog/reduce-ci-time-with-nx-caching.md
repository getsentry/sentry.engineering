---
title: 'Reduce CI Time with Nx Caching'
date: '2023-03-31'
tags: ['sdk', 'ci', 'javascript', 'js', 'nx', 'caching']
draft: false
summary: 'By updating to Lerna 6 with Nx caching, we were able to reduce our CI run times by about 35%. '
images: [/images/reduce-ci-time-with-nx-caching/hero.jpg]
layout: PostLayout
canonicalUrl: https://sentry.engineering/blog/reduce-ci-time-with-nx-caching
authors: ['francesconovy', 'nx_jameshenry', 'nx_miroslavjonas']
---

Sentry is a very fast-moving company. In just one month we merged 165 pull requests from 19 authors and changed over 800 files, with a total of over 22,000 additions and almost 10,000 deletions. This fast pace led to about 700 pull requests with CI (continuous integration) runs in that single month.

This high speed of development and impact on build times isn't unique to Sentry. So we took the opportunity to find a way to improve build times with the Nx task runner on our [Sentry JavaScript SDK](https://github.com/getsentry/sentry-javascript) monorepo managed with Lerna.

Read below how we made an 87.5% improvement to our minimum build time and 25% improvement to our average build time, and check out our build script, linked at the bottom, to see how we achieved these improvements.

## sentry-javascript and Lerna

The [Sentry JavaScript SDK](https://github.com/getsentry/sentry-javascript) is a monorepo managed with Lerna. We’ve been on [Lerna](https://lerna.js.org/) v3 for some time, which has been working reasonably fine for us. However, newer versions of Lerna have brought some exciting changes; in particular, it embraced [Nx](https://nx.dev/) for its task runner and therefore caching.

The way the Lerna monorepo was working was that on **each** CI run, we first installed the npm dependencies, and then built all our packages. While we were already leveraging caching to speed up dependency installation as much as possible, we still used to build each and every package from scratch, on every single CI run. But, with Lerna 6 and Nx, it is now possible to cache any script tasks from our monorepo packages.

Our focus after updating to Lerna 6 was on our build related tasks, which is also the focus of this post, but we have since also added Lerna’s caching for linting and unit tests. Luckily, extending our improvements beyond the build tasks was not too hard because the Lerna task runner doesn’t actually differentiate across names like build, test, or lint or what exactly they do. If a task, which is deterministic when it runs, exists - we can benefit from caching.

With the clear technical benefits, and a coincidental nudge from the community, we started working on these caching improvements and updating the dev flow to make contributing easier:

<blockquote class="twitter-tweet"><p lang="en" dir="ltr">Someone from the <a href="https://twitter.com/NxDevTools?ref_src=twsrc%5Etfw">@NxDevTools</a> team should work with the <a href="https://twitter.com/getsentry?ref_src=twsrc%5Etfw">@getsentry</a> team to update their <a href="https://twitter.com/lernajs?ref_src=twsrc%5Etfw">@lernajs</a> JS monorepo to use Nx caching 👀</p>&mdash; Jay 🔔 - @mastodon.social/@jaycooperbell (@JayCooperBell) <a href="https://twitter.com/JayCooperBell/status/1609987785225818113?ref_src=twsrc%5Etfw">January 2, 2023</a></blockquote> <script async src="https://platform.twitter.com/widgets.js" charset="utf-8"></script>

## Improvements we made by caching

Before we dive into the concrete changes we implemented, let’s have a look on the outcomes we were able to achieve by our improved caching strategy from just the changes to build tasks:

|                    | Time before caching | Time after caching | Time saving | % Saving |
| ------------------ | ------------------- | ------------------ | ----------- | -------- |
| Max. build time    | ~8 min              | ~8 min             | -           | -        |
| Min. build time    | ~8 min              | ~1 min             | ~7 min      | 87.5%    |
| Median build time  | ~8 min              | ~6 min             | ~2 min      | 25%      |
| Min. CI run time   | ~20 min             | ~13 min            | ~7 min      | 35%      |
| Median CI run time | ~20 min             | ~18 min            | ~2 min      | 10%      |

The table above shows that we were able to save up to 35% of total CI runtime due to the caching change. While some CI runs could not benefit from caching (depending on which files have been changed in a given pull request), in most cases at least some of the build steps could be replayed from the cache.

## Configuring caching

The core change (in [PR #6555](https://github.com/getsentry/sentry-javascript/pull/6555 'build: Update Lerna to v6 and use Nx caching for builds')) was to update Lerna to version 6.x, and set up some caching rules in nx.json. This required us to ensure we use consistent naming & dependencies for the different build scripts in our packages. We ended up aligning scripts to the following:

Which resulted in:

- <code>build:types</code>: Build type information for the package
- <code>build:transpile</code>: Transpile code to the format that we want to publish to our users
- <code>build:bundle</code>: Build CDN bundles
- <code>build:transpile:uncached</code>: Build steps that cannot/should not be cached. This includes steps that involve symlinks, as an example.
- <code>build:tarball</code>: Generate a .tar.gz archive ready to publish to NPM

With this definition, we were able to define dependencies between scripts as follows:

- <code>build:tarball:</code> depends on build:transpile and build:types
- <code>build:bundle:</code> depends on build:transpile
- <code>build:transpile:</code> depends on on build:transpile:uncached

When focused on only these build steps (not yet linting or unit testing) we created an nx.json like this (slightly simplified for clarity):

```json
{
  "tasksRunnerOptions": {
    "default": {
      "runner": "nx/tasks-runners/default",
      "options": {
        "cacheableOperations": ["build:bundle", "build:transpile", "build:types"]
      }
    }
  },
  "targetDefaults": {
    "build:bundle": {
      "dependsOn": ["^build:transpile", "build:transpile"],
      "outputs": ["{projectRoot}/build/bundles"]
    },
    "build:tarball": {
      "dependsOn": ["^build:transpile", "build:transpile", "^build:types", "build:types"],
      "outputs": []
    },
    "build:transpile": {
      "dependsOn": ["^build:transpile:uncached", "^build:transpile", "build:transpile:uncached"],
      "outputs": ["{projectRoot}/build/npm", "{projectRoot}/build/esm", "{projectRoot}/build/cjs"]
    },
    "build:types": {
      "dependsOn": ["^build:types"],
      "outputs": ["{projectRoot}/build/types", "{projectRoot}/build/npm/types"]
    }
  }
}
```

## Configuring task inputs

By default, a package cache will be considered invalid when any file inside of the package folder is changed. In order to prevent unnecessary cache misses, we need to tell the task runner about relevant inputs to our tasks.

To replicate the default behavior, we could set up an input to a task, such as `build:types`, which references all the project’s files as inputs like so:

```json
{
  "targetDefaults": {
    "build:types": {
      "inputs": ["{projectRoot}/**/*"]
      // … additional config
    }
  }
}
```

Again, this just replicates the default behavior, but what about if changes to some global configuration files should also be taken into account?

We can add those as well:

```json
{
  "targetDefaults": {
    "build:types": {
      "inputs": ["{projectRoot}/**/*", "{workspaceRoot}/*.js"]
      // … additional config
    }
  }
}
```

Now any JavaScript config file at the root of our repo can invalidate the cache for `build:types` when it changes. Nice!

## Reduce repetitive code

It can be a bit repetitive, however, to keep referencing the same kinds of patterns across lots of tasks, so to avoid duplication we can leverage `namedInputs`. They are just like variables in our code - a named alias for a value.

If we refactor the same example above to use `namedInputs`, it might look like the following:

```json
{
  "namedInputs": {
    "default": ["{projectRoot}/**/*", "sharedGlobals"],
    "sharedGlobals": ["{workspaceRoot}/*.js"]
  },
  "targetDefaults": {
    "build:types": {
      "inputs": ["default"]
      // … additional config
    }
  }
}
```

Now what we have is a `namedInput` called “default” (this is just a name we have given it, it could be called anything we want) which we can reference in the `inputs` property of any task, and avoid repeating the glob patterns over and over.

## Scoping cache invalidation further

We can take this optimization as far as we want, for example we could decide that changes to documentation and test files can’t possibly affect our build tasks. So we could set up another `namedInput` called “production” (meant to imply the code that actually gets run by our users) and exclude the .md and test files from our default set:

```json
{
  "namedInputs": {
    "default": ["{projectRoot}/**/*", "sharedGlobals"],
    "sharedGlobals": ["{workspaceRoot}/*.js"],
    "production": ["default", "!{projectRoot}/test/**/*", "!{projectRoot}/**/*.md"]
  }
  // … additional config
}
```

We could then update our inputs like so:

```json
{
  "targetDefaults": {
    "build:types": {
      "inputs": ["production"]
      // … additional config
    }
  }
}
```

What this config means is that we want to invalidate any existing cache for the `build:types` script whenever:

- Any of the shared global files change
- Any file in the project’s own directory (= the packages/xxx folder) is changed, as long as that file isn’t in the test directory of that project, and isn’t a markdown file.

For all the possibilities available for `inputs` and `namedInputs` check out the documentation [here](https://nx.dev/more-concepts/customizing-inputs#customizing-inputs-and-named-inputs 'Customizing Inputs and Named Inputs').

## Defensive vs. Fast

With caching, there is always a tradeoff between being as fast as possible, and accidentally hiding or even breaking something because of incorrect caching. We decided to generally err on the side of safe & defensive, and rather have more “unnecessary” cache invalidations than to miss an actual change. This is something to keep an eye on, and which we may adjust in the future based on further insights.

Furthermore, we also set up our CI to ensure we never use cache when running on release branches, as well as adding a nightly job that also runs CI without cache. This way, we at least have some safety net to ensure incorrect caching would remain undetected for too long - for example, if something goes wrong with restoring the correct cache in Github Actions.

You can check out our [build workflow](https://github.com/getsentry/sentry-javascript/blob/6227e441e046216e127085fcb1e5b3f94b4a9903/.github/workflows/build.yml#L198) to see how we achieved this.

And if you’re new to Sentry, you can [try it for free](https://sentry.io/signup) today or [request a demo](https://sentry.io/demo) to get started.
