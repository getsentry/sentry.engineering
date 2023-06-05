---
title: 'Unmasking Session Replay'
date: '2023-06-05'
tags: ['web', 'javascript', 'sdk', 'session replay', 'privacy']
draft: false
summary: 'TODO TODO TODO TODO TODO'
images: ['/images/unmasking-session-replay/ryanalbredcht.jpg']
layout: PostLayout
canonicalUrl:
authors: ['ryanalbrecht']
---

User privacy is a major consideration in everything we build at Sentry. That's why, very early when we started building [Session Replay](https://sentry.io/for/session-replay), we made the decision that scrubbing PII (Personal Identifiable Information) would be the default mode. It would be opt-out instead of opt-in. We put the burden on web developers to unmask or unblock data only when it's safe to do so.

The most visible place where people see our privacy controls in action is when watching a replay recording. I've heard a few questions about these privacy configs lately so I spent some time exploring some different approaches, and wanted to share what I found!

A replay recording will be created whenever your customer visits your website and the Replay SDK decides to [sample](https://docs.sentry.io/platforms/javascript/session-replay/#sampling) the session. The SDK listens for changes to the rendered HTML whenever any HTML tag like a `<div>` or `<button>` is inserted, modified or removed. For inserts or modifications the SDK will serialize the changes using the [mask, unmask block or unblock settings](https://docs.sentry.io/platforms/javascript/session-replay/privacy/). The serialized data will be re-inserted into the DOM later when you're watching the saved replay.

The privacy settings will, by default, mask all text by replacing letters and numbers with `*`. Also it'll block all images, so you only see a blank space. If you're more of a visual person checkout the [docs](https://docs.sentry.io/platforms/javascript/session-replay/privacy/#masking) for some nice graphics showing the before/after.

Here's an example webpage captured with the default (full!) privacy configuration enabled:

![a web page where all text is replaced by * and images are completly removed](/images/unmasking-session-replay/full-masking.png)

You might recognize this as a page on sentry.io. You might also recognize that the user is looking at a table of data. They have clicked into the search textbox which has opened up it's own flyout on top.

# Three Approaches

Masking everything is nice and safe, but it can be hard to debug issues when everything is a series of `*`. So it's useful to unmask text and images if you know it doesn't contain any user data.

For example, our example webpage includes a list of navigation links on the left side. It can be helpful to see what item is selected so you can make sure it matches with the url. It's a basic example, but lets look at some different approaches to unmasking that sidebar. The React file that renders the sidebar html is on github, it's called [`components/sidebar/index.tsx`](https://github.com/getsentry/sentry/blob/75833f69cea56d4d0f7c7dbde6b8026b1110376f/static/app/components/sidebar/index.tsx#L376-L498).

Our goals are to be safe and maintainable. We want to be as specific as possible so nothing slips through the cracks, but also not have to revisit this or think about it every time we make a change in the future.

I'm going to refer to some [Privacy Configuration](https://docs.sentry.io/platforms/javascript/session-replay/privacy/#privacy-configuration) options as we go. Don't worry if you're not yet familiar with them, we'll take it slow together!

# 1. Use default classes

If you're looking at the docs for the first time, you might notice a few options that seem to work together:

- `mask` (default is `true`)
- `unmask` (default is `".sentry-unmask, [data-sentry-unmask]"`)

By default everything is masked because `mask:true` is set. But if we use this `unmask` selector in our HTML then we can turn off masking for parts of the page.

That means we want to put `class="sentry-unmask"` or `data-sentry-unmask` somewhere, but where?

Looking at our sidebar component there's something called the `<SidebarDropdown>` which includes the `user={config.user}` props. This component renders PII, the full name of our user, so we can't apply the class to that node. Instead we can apply the class, or `data-*` attribute to the sibling nodes:

```diff
  <SidebarWrapper aria-label={t('Primary Navigation')} collapsed={collapsed}>
    <SidebarSectionGroupPrimary>
      <SidebarSection>
        <SidebarDropdown
          user={config.user}
          ... snip ...
        />
      </SidebarSection>
-     <PrimaryItems>
+     <PrimaryItems className="sentry-unmask">
        ... snip ...
      </PrimaryItems>
    </SidebarSectionGroupPrimary>

    {hasOrganization && (
-     <SidebarSectionGroup>
+     <SidebarSectionGroup className="sentry-unmask">
        ... snip ...
      </SidebarSectionGroup>
    )
  </SidebarWrapper>
```

Or if we used the `data-*` attribute:

```diff
- <PrimaryItems>
+ <PrimaryItems data-sentry-unmask>
  ...
- <SidebarSectionGroup>
+ <SidebarSectionGroup data-sentry-unmask>
```

This could work. By going around our codebase we can explicitly mark, right in the code, what gets unmasked. On the other hand it's really easy for someone to unmask `<SidebarWrapper>` , and not notice that `<SidebarDropdown>` includes some PII. Or maybe SidebarDropdown doesn't have PII today, but tomorrow it could be added.

The problem is this strategy isn't specific enough. It would be better to add `class="sentry-unmask"` to each `<SidebarItem>`. But that's a much larger code commit, especially if we start going into more parts of the app.

# 2. List allowed classes

So what if we made a list of specific classes that we should unmask? We could update the config to include that `mask` list:

```diff
  Sentry.init({
    integrations: [
      new Replay({
+       maskAllText: true,
+       unmask: [
+         'a.sidebar-item',
+         // ... add more over time ...
+       ],
      })
    ]
  });
```

After we're doing looking at the whole app that could be a lot of classes to list out. And in the case of sentry.io we have a CSS build process, so class names look like `<a class="app-8s4it8 e88zkai5">` and will randomly change. Very bad for maintenance.

This appraoch can work, but it can be a maintenance headache. When new features get built you have to remember to come back and update the list. It's also hard to know what should be removed from the list if a feature has been changed or removed.

But it is safer, because you can be really specific about what to unmask, while leaving everything else masked for privacy.

# 3. Leverage i18n translations

On sentry.io we have a React based app and there is a translation, or i18n, layer (i18n is short for "internationalization"). Using another [privacy configuration](https://docs.sentry.io/platforms/javascript/session-replay/privacy/#privacy-configuration) option we can leverage the i18n layer for unmasking:

- `maskFn` (default is `(text) => value.replace(/[\S]/g, '*')`)

| **Note:** The docs claim that the default is `(text) => '*'.repeat(text.length)`, which is an approximation of the real statement. It's easier to understand than the regular expression, but just as safe to use!

How can we leverage i18n calls? There are two primary methods for making text translatable:

- `t("Hello")` if the string is static and saved into the code repo.
- `tct("[minutes] minutes ago", {minutes: 4})` when the text has a variable inside it.

Of course any values from the database, like your username, won't be passed through any translation function at all.

With the knowledge that any static string will not contain PII, we can hook into the `t()` method and disable masking for any text returned by `t()`!

Here's a simplified version of the [real](https://github.com/getsentry/sentry/blob/75833f69cea56d4d0f7c7dbde6b8026b1110376f/static/app/locale.tsx#L325-L345) [code](https://github.com/getsentry/sentry/blob/75833f69cea56d4d0f7c7dbde6b8026b1110376f/static/app/locale.tsx#L84-L90):

```javascript
const staticTranslations = new Set()

function t(originalText) {
  const translated = getClient().gettext(originalText)
  staticTranslations.add(translated)
  return translated
}

function isStatic(renderedText) {
  return staticTranslations.has(renderedText)
}

Sentry.init({
  integrations: [
    new Replay({
      maskFn: (renderedText) =>
        isStatic(renderedText) ? renderedText.replace(/[\S]/g, '*') : renderedText,
    }),
  ],
})
```

What's happening is:

1. Static text will pass through `t()` as it is being rendered on the screen.
2. When any HTML is inserted or modified `maskFn` will run.
3. `isStatic()` will return `true` if the text on the screen (the translated words) match something that was returned from `t()`.

And here's what the results look like:
![](/images/unmasking-session-replay/i18n-masking.png)

Maintenance of this approach is fantastic since it leverages the existing i18n system.

Unfortunately, there are some gotchas with this approach too. It's possible that your static text might match some user-input, in which case the user-input would be revealed. Also the `Set` could grow to contain all translatable strings inside it, which might be problematic.

# Conclusion

Those are just a few ideas for how to peel back the defaults. Thinking about your own website and the type of content, you might create other, more specific strategies tailored to your own site.

### Bonus Cases

You could implement a `maskFn` where only specific strings are blocked. For example, a banking website could mask any numerical value, and then use a `mask` class for the few places that show your full name and address:

```javascript
const isNumber = require('is-number')

Sentry.init({
  integrations: [
    new Replay({
      maskAllText: true,
      unmask: 'body',
      mask: '[data-user-name], [data-user-address]',
      maskFn: (text) => (isNumber(text) ? text.replace(/[\S]/g, '*') : text),
    }),
  ],
})
```

Or your maskFn could look at the current URL to enable/disable masking. A shopping website might want all product pages to be left alone, but the checkout experience is fully masked:

```javascript
function isCheckoutPath(path) {
  return path.startsWith('/checkout/')
}

Sentry.init({
  integrations: [
    new Replay({
      maskAllText: true,
      maskFn: (text) =>
        isCheckoutPath(window.location.pathname) ? text.replace(/[\S]/g, '*') : text,
    }),
  ],
})
```
