---
title: 'Improving DX: From Unreadable CSS Selectors to Clear React Component Names'
date: '2024-05-30'
tags: ['web', 'react', 'debugging']
draft: false
summary: 'How to transform unreadable CSS selectors to React component names.'
images:
  [
    /images/improving-developer-experience-from-unreadable-css-selectors-to-clear-component-names/hero.jpg,
  ]
layout: PostLayout
authors: ['catherinelee', 'ashanand']
---

Reading our own code is much easier than the output of a bundler or transpiler. The same goes for React developers reading CSS selectors generated from their CSS library of choice. CSS selectors are used all across [Sentry](https://sentry.io/for/react/) to show clicks on components. This can provide useful information like which component is the cause of rage and dead clicks, and what component was clicked in a span. However, if you’re using React, these selectors become unreadable in production due to the minification process, so your selectors end up looking like this:

`button.en302zp1.app-191aavw.e16hd6vm2[role="button"][data-test-id="common-options"]`

This makes it hard to search for specific clicks or spans, and to find that component in the codebase when using search. [We made this experience better](https://sentry.io/changelog/react-component-names-is-now-available/) by utilizing component names instead of CSS selectors, so you can easily view and search for components with one simple name, like this: `CommonOptions`. In order to do this, we first had to build on our [bundler plugin](https://www.npmjs.com/package/@sentry/bundler-plugin-core) to annotate output DOM with their component name when possible.

## Building the bundler plugin

There are three main parts that make up the system of the component name feature: The Babel plugin, the bundler plugins, and the browser SDK. The component name plugin itself is a Babel plugin; it hooks into the transform step of your bundler’s build process, in order to attach React component names as additional properties on your compiled HTML. It parses the AST (Abstract Syntax Tree) of your JSX files at build-time to determine the names of your components, and attaches them as additional properties to the compiled HTML. The Babel plugin was forked from [Fullstory's Annotate React plugin](https://github.com/fullstorydev/fullstory-babel-plugin-annotate-react), which we converted to TypeScript and modified to work better with Sentry's workflow.

The bundler plugin itself is just a medium to easily get the React annotate plugin into your project, without needing to fiddle around with your Babel configuration. This of course also means that you can install the annotate plugin directly, without using our bundler plugins. However, our bundler plugins come packaged with other very useful features that will make setting up certain workflows on Sentry a breeze, so we recommend you use them if possible!

The browser SDK is what is installed in your application’s frontend to capture events and send them to Sentry in the form of issues, spans, and replays. As of version 7.91.0, the Sentry JavaScript SDK parses your application’s HTML for the properties that were added by the plugin, and attaches them as complimentary data to your events.

One of our core values at Sentry is “For Every Developer”. In order to stay true to this, we built this feature so that it could be used with as many bundlers as possible, and with ease of access in mind so that it could be installed and set up quickly. On release, this feature works out of the box for developers using our bundler plugins for Vite, Webpack, and Rollup. We used [Unplugin](https://unplugin.unjs.io/guide/) to build this, which standardizes plugin development across multiple bundlers into one single API.

## Adding React component names into Sentry

There were many opportunities across the product where we could leverage component names: spans, breadcrumbs, [rage click issues, and dead and rage click selectors](https://blog.sentry.io/introducing-rage-and-dead-click-detection-for-session-replay/).

![React component name used in spans](/images/improving-developer-experience-from-unreadable-css-selectors-to-clear-component-names/span.png)

_In spans, React component names are used in click interactions._

![React component name used in replay breadcrumbs](/images/improving-developer-experience-from-unreadable-css-selectors-to-clear-component-names/replay-breadcrumb.png)

_In Replay breadcrumbs, React component names are used in the selector path in user click breadcrumbs. If the user clicked on a component with a component name, you can search replays by that component name._

![React component name used in rage and dead click selectors](/images/improving-developer-experience-from-unreadable-css-selectors-to-clear-component-names/rage-and-dead-selector.png)

_In rage and dead click selectors, React component names are used as part of the selector name._

![React component name used in rage click issues](/images/improving-developer-experience-from-unreadable-css-selectors-to-clear-component-names/rage-click-issue.png)

_In rage click issues, the React component name is also shown if it’s available._

The SDK had to be updated first to take in these new attributes. This involved creating a function to extract the component name from the attributes and propagating it throughout spans, UI breadcrumbs, and Replay breadcrumbs. Next, we updated Sentry’s UI to utilize these component names. In most areas, the component names just replaced the selector names, but for rage click issues, and dead and rage click selectors this was not the case. For rage click issues, the Clicked Element uses the selector name which provides useful context about the element. Hence decided to add an additional field for the component name: React Component Name. For rage and dead clicks, additional context besides the React component names are useful for debugging – for instance, `aria-label` and `data-test-id`. For that reason we decided to keep the selectors names. Since class names become minified, we decided to replace them with the react component name. Hence, rage and dead click selectors are now a combination of the component name and the additional context.

## Increased Debuggability

In addition to helping with debugging within Sentry, the annotation plugin also helps with debugging in your browser dev tools after you’ve deployed to production. Our plugin annotates all elements with the component name and source file, which makes it much easier to find the relevant code and source of the bug.

We recently had a [bug](https://github.com/getsentry/sentry/issues/69209) where the [replay inline player](https://sentry.io/changelog/issue-replay-clips/) wasn’t playing and pausing properly on first load. This was a UI issue that was found by a colleague while using Sentry, and there were no Sentry issues generated that could be used to debug this. As a result, there weren’t any relevant call stacks I could use to help locate where this bug was coming from. I also wasn’t very familiar with the inline player, so I wasn’t sure what files or components were relevant to this. Typically I would use React Developer Tools to try to find the relevant components.

![React Components developer tools showing the `data-sentry-component`, `data-sentry-element`, and `data-sentry-source-file` annotations](/images/improving-developer-experience-from-unreadable-css-selectors-to-clear-component-names/react-dev-tools.png)

I used to struggle with finding the relevant component since there are so many components to dig through, and I find it really easy to get lost in the list. With the addition of component name annotations to the bundler plugin, I no longer need to carefully search through the list to find the right component! Even `Anonymous` components have been annotated with attributes indicating their names and file. Specifically, the attributes are `data-sentry-element`, which comes from our emotion-styled components, `data-sentry-component` which comes from functional components, and `data-sentry-source-file` which is the source file of the component. From these attributes, we know that we should look into the files `replayClipPreviewPlayer.tsx` and `replayPreviewPlayer.tsx`, which house the related components `ReplayClipPreviewPlayer` and `ReplayPreviewPlayer`.

Furthermore, I was easily able to find the relevant source files and components in the Elements tab of dev tools, which was easier to use than React developer tools. It all goes to show that there are various ways to take advantage of React component names in the debugging process.

![Chrome DevTools showing the `data-sentry-component`, `data-sentry-element`, and `data-sentry-source-file` annotations within the Elements panel](/images/improving-developer-experience-from-unreadable-css-selectors-to-clear-component-names/chrome-dev-tools.png)

Eventually, we found that the bug was caused by code added to `replayPreviewPlayer.tsx` that implemented caching, causing issues with the state. With the help of component name annotations, we were able to [patch](https://github.com/getsentry/sentry/pull/69232) this bug soon after it was reported.

The annotation plugin can also help with building new features. Whenever you’re not sure where a file or component exists, simply use dev tools to inspect the relevant component to find the component name and file in production. To get full usage out of the annotations, make sure you have descriptive component names and file names. You can learn how to set up react component names for your projects [here](https://docs.sentry.io/platforms/javascript/guides/react/features/component-names/#how-to-install).
