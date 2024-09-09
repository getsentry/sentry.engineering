---
title: 'Preact or Svelte? An Embedded Widget Use Case'
date: '2024-09-06'
tags: ['javascript', 'sdk']
draft: false
summary: 'Preact or Svelte, which framework is best for building an embedded user feedback widget?'
images: [/images/preact-or-svelte-an-embedded-widget-use-case/hero.jpg]
layout: PostLayout
authors: ['catherinelee']
---

Sentry's [user feedback widget](https://docs.sentry.io/product/user-feedback/#user-feedback-widget) allows anyone to submit feedback quickly and easily any time they encounter something that isn’t working as expected. It’s a form with a name, email, and description fields. However, sometimes a description just isn’t enough to describe an issue in detail. Therefore, we decided to add a button that allows the user to take a screenshot of their web page and crop it, allowing the user to better illustrate their issue.

The original user feedback widget was built with vanilla JavaScript, which was a good choice at the time since it’s a basic form and button. However, incorporating screenshot and annotation features using only vanilla JSJavaScript would overly complicate and hinder code maintainability. To address this, we explored two lightweight frameworks to find a suitable solution for implementing screenshots and annotations: [Preact](https://preactjs.com/) and [Svelte](https://svelte.dev/).

We recreated the form and dialog of the existing user feedback widget to compare the bundle size, maintainability, and learning curve between the frameworks.

![Basic dialog and form for the user feedback widget](/images/preact-or-svelte-an-embedded-widget-use-case/user-feedback-form.png)

_The feedback dialog and form that we recreated with each framework_

## Preact

Preact itself has a [bundle size of 4.5kB](https://bundlephobia.com/package/preact@10.19.3). The process of learning how to use Preact was straightforward since Preact strongly resembled React, which we use for our frontend. Any differences between Preact and React are [well documented](https://preactjs.com/guide/v10/differences-to-react/), minimizing any confusion during the recreation process. When recreating the form and dialog, I combined the form into the dialog; however, a more beneficial approach would have been to keep them separate, creating individual components for repetitive elements like the form inputs. This would have enhanced code readability and maintainability. The most challenging aspect of recreating the feedback form revolved around displaying the form in the shadow DOM, which I was unfamiliar with. Shadow DOM was needed since customizable CSS was directly applied to the shadow DOM, and the future screenshot capabilities would all be within the shadow DOM. I was able to get some assistance and overcoming this challenge proved simpler than anticipated, allowing me to recreate the form and dialog while preserving the CSS themes. The final build size of this Preact implementation is **8.14kB**.

![Build size of Preact implemetation](/images/preact-or-svelte-an-embedded-widget-use-case/preact-build.png)

## Svelte

Svelte boasts an impressively small [bundle size of just 2.7kB](https://bundlephobia.com/package/svelte@4.2.9). Replicating the feedback dialog and form in Svelte was relatively straightforward since most challenges with reducing the feedback down to a few components and transitioning to a framework were addressed during the process with Preact. The learning curve for Svelte was also small. The biggest challenge I came across when creating a project with Svelte was that the recommended command to create a project, <code>npm create svelte@latest myapp</code>, used SvelteKit, a full stack framework. This realization happened after replicating the feedback widget, when running the production build to assess build size. There were a lot of files which could have SvelteKit logic, making it difficult to directly compare build sizes with the Preact implementation.

Luckily, the process of changing from using SvelteKit to pure Svelte with Vite was straightforward, and the resulting Svelte build size is 7.47kB.

![Build size of Svelte implemetation](/images/preact-or-svelte-an-embedded-widget-use-case/svelte-build.png)

## The Decision

Both the Svelte implementation and Preact implementation have similar build sizes, with Svelte having the smaller build size.

![Bundle size visualizer for Preact build](/images/preact-or-svelte-an-embedded-widget-use-case/preact-build-analyzer.png)

_Vite bundle visualizer for the Preact build — almost half the build is just the framework_

![Bundle size visualizer for Svelte build](/images/preact-or-svelte-an-embedded-widget-use-case/svelte-build-analyzer.png)

_Vite bundle visualizer for the Svelte build — majority of the build is the feedback dialog and form_

After looking at the builds more closely with the Vite bundle visualizer tool, I noticed that nearly half of the Preact implementation's build size was attributed to the framework itself. Considering our future plans to incorporate screenshots and annotation capabilities, which would significantly increase the build size, the marginal difference in framework size would become negligible, so the slightly smaller build size with Svelte would not help with the final bundle size. Additionally, Preact closely resembles React, which aligns well with our developers' familiarity with React and would greatly improve code maintainability. As a result, we chose Preact as the framework for expanding our User Feedback product to include screenshot and annotation functionalities.

## The Aftermath

In the end, adding Preact and screenshotting functionality to our user feedback widget increased the bundle size of @sentry/browser with the user feedback integration by 22.93%, from 30.81KB to 37.88KB. Although it’s a pretty large bundle size increase, using Preact allowed us to go from writing code like this:

```js
const emailEl = createElement('input', {
  id: 'email',
  type: showEmail ? 'text' : 'hidden',
  ['aria-hidden']: showEmail ? 'false' : 'true',
  name: 'email',
  required: isEmailRequired,
  className: 'form__input',
  placeholder: emailPlaceholder,
  value: defaultEmail,
})

showEmail &&
  createElement(
    'label',
    {
      htmlFor: 'email',
      className: 'form__label',
    },
    [
      createElement(
        'span',
        { className: 'form__label__text' },
        emailLabel,
        isEmailRequired &&
          createElement('span', { className: 'form__label__text--required' }, ' (required)')
      ),
      emailEl,
    ]
  ),
  !showEmail && emailEl
```

to this:

```js
{
  showEmail ? (
    <label for="email" class="form__label">
      <LabelText label={emailLabel} isRequired={isEmailRequired} />
      <input
        class="form__input"
        defaultValue={defaultEmail}
        id="email"
        name="email"
        placeholder={emailPlaceholder}
        required={isEmailRequired}
        type="text"
      ></input>
    </label>
  ) : (
    <input aria-hidden value={defaultEmail} name="email" type="hidden" />
  )
}
```

With our end goal of [adding screenshotting and cropping capabilities](https://sentry.io/changelog/user-feedback-widget-screenshots/) to our user feedback widget, using a framework was a necessity. With the use of Preact, implementing screenshotting and cropping became much easier and much more readable. One of our interns was even able to make a surprise contribution and improve on the cropping capabilities. Seeing how our feedback widget turned out in the end, I think we made a great choice in framework.

![User feedback widget with screenshotting and cropping capabilities](/images/preact-or-svelte-an-embedded-widget-use-case/user-feedback-screenshot-crop.png)

_User feedback widget with screenshotting and cropping capabilities_

You can learn more about Sentry’s User Feedback widget [here](https://docs.sentry.io/product/user-feedback/#user-feedback-widget).
