---
title: 'Mobile App Launch Profiling'
date: '2024-04-17'
tags: ['mobile', 'ios', 'android', 'profiling']
draft: false
summary: "See what's happening in your app before your first line of code can even run."
images: ['/images/mobile-app-launch-profiling/launch-profile.png']
layout: PostLayout
canonicalUrl: mobile-app-launch-profiling
authors: ['andrewmcknight']
---

If you use Sentry’s Performance monitoring on Cocoa and Android, you have the ability to see [profiles](https://docs.sentry.io/product/profiling/) of how your app runs in the wild on real end user devices. Any time an automatic or manual transaction is recorded, that profiling data is attached. But are there times where you can’t record a transaction? 🤔

# App launch performance

<aside>
💡 This post will focus on our Cocoa app launch profiling feature. You can read more about the Android counterpart by heading over to that area of our docs: https://docs.sentry.io/platforms/android/profiling/#app-start-profiling
</aside>

Apple places special focus on good [performance of an app’s launch](https://developer.apple.com/documentation/xcode/reducing-your-app-s-launch-time). They even built an entire process to enforce good performance: the [watchdog](https://developer.apple.com/documentation/xcode/addressing-watchdog-terminations). There are two ways you can monitor launch performance today:

1. Instruments. You can profile your app while launching it on any devices you have available.
2. MetricKit. You can see a histogram of app launch times in Xcode’s Organizer. This data is inexact, because you can’t correlate any specific context to problematic launches, and the way launch time is measured is out of your control:

> The launch-time metric measures the time from the user tapping the app icon on their Home screen to the app drawing its first frame to the screen. If your app still has to run code after it has drawn its first frame, but before the user can begin using the app, that time doesn’t contribute to the launch-time metric. **Extra startup activities still contribute to the user’s perception of the app’s responsiveness**.

So, if you or one of your dependencies does some work at launch time, you don’t necessarily see that in the Xcode Organizer.

# Sentry app launch profiling

Now, you can get profiling data from the moment your app starts executing code, before calls to `main` or `appDidFinishLaunching`, where the Sentry SDK is typically initialized and was previously the earliest moment a performance transaction could be recorded.

By enabling `SentryOptions.enableAppLaunchProfiling` in your configuration of `SentrySDK.startWithOptions`, the SDK will automatically profile subsequent launches of your app. If configured, the Sentry profiler is started from one of the SDK’s `+[load]` methods. If you also enabled `SentryOptions.enableTimeToFullDisplayTracing`, the profiling data will be attached to the app start transactions you can find in our [App Starts insights](https://docs.sentry.io/product/insights/mobile-vitals/app-starts/). Here’s an example of profiling data showing some work being done before `main()` is called, lined up with our app start spans:

![A flamechart showing an example launch profile, with work on the main thread before the actual call to `main()`.](/images/mobile-app-launch-profiling/launch-profile.png)

In all other cases, a dedicated “launch” transaction will be recorded, where you can access the new profiles.

# Next steps

Launch profiling can automatically record any launch after you’ve initialized it — but what about the very first launch after a user installs your app? You wouldn’t have had an opportunity to configure launch profiling yet. We considered including a workflow where you’d ship your app with a Plist key to enable launch profiling, so you’d get all the juicy details of what happens on that very first launch. This is still something we’ll consider doing in the future, but for now, we want to battle-test the feature as it is today and make sure it’s a safe and robust part of your app’s launch before adding any additional complexity.

# What’s happening in your launches?

Head over to the [docs to enable Launch Profiling](https://docs.sentry.io/platforms/apple/profiling/#enable-launch-profiling) and give app launch profiling a try in your iOS and Android apps today — and [let us know what you think](https://github.com/getsentry/sentry-cocoa/discussions/3721)!
