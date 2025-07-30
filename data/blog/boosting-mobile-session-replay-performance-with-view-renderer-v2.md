---
title: 'Boosting Mobile Session Replay Performance with View Renderer V2'
date: '2025-07-28'
tags: ['cocoa', 'session-replay', 'mobile', 'sdk', 'replay']
draft: false
summary: 'A detailed analysis of iOS rendering bottlenecks led to a custom solution that achieved 4-5x better performance.'
images: [/images/boosting-mobile-session-replay-performance-with-view-renderer-v2/hero.jpg]
layout: PostSimple
canonicalUrl: boosting-mobile-session-replay-performance-with-view-renderer-v2
authors: ['philniedertscheider']
---

After making Session Replay GA for Mobile, the adoption rose quickly and more feedback reached us. In less great news, our Cocoa SDK users reported that the performance overhead of Session Replay on older iOS devices **made their apps unusable**.

So we went on the journey to find the culprit and found a solution that yielded **4-5x better performance** in our benchmarks 🔎📈

![Session Replay on Mobile](/images/boosting-mobile-session-replay-performance-with-view-renderer-v2/hero.jpg)

To understand what's happening under the hood of Session Replay on Mobile, let's first explore how mobile screen recording works before diving into the technical details.

# Frame Rates In A Nutshell

A screen recording is a video made up of many fast-displayed images called `frames`. Human eyes can process about 60 frames per second (`frame rate`), measured in hertz (`1 Hz` = `1 unit per second`), creating the illusion of a moving image. The frame rates vary by use case, from `24 Hz` for cinema to `144 Hz` for gaming computer displays.

Higher frame rates make videos smoother, but have downsides:

- More storage and network bandwidth required
- Less time to capture per frame available, requiring better hardware

When reducing the frame rate to a minimum, the recordings look like **stop motion videos**, with a great example for this style visible in this [YouTube video](https://www.youtube.com/watch?v=MEglOulvgSY). The frames are just sequential photos, yet they still feel like a moving photo — essentially a video.

**This is essentially what we are doing with Session Replay on Mobile!**

Instead of having a full screen recording, which is resource-heavy, we capture a screenshot every second instead. Every 5 seconds, these frames are combined into a video segment, creating a stop-motion-like recording. These video segments are then uploaded to Sentry and stitched into a full session replay.

Now that we know how frame rates work, let’s dive deeper into the actual problem we had to tackle.

# The Frame Is The Problem

Our investigation began with reproducing the performance issues in a controlled environment. We used an iPhone 8 running iOS 15.7 as our primary test device, since this represented the older hardware where users reported the most severe performance problems.

Using Xcode Instruments on our Sentry Cocoa SDK sample application, we immediately reproduced the reported performance issues and noticed a consistent pattern of main thread hangs **every second**.

<div align="center">
  <img src="/images/boosting-mobile-session-replay-performance-with-view-renderer-v2/xcode-instruments-app-hangs.png" alt="Xcode Instruments showing an app hang warning every second"/>
  _Xcode Instruments showing an app hang warning every second._
</div>

<div align="center">
  <img src="/images/boosting-mobile-session-replay-performance-with-view-renderer-v2/coincidence-meme.png" alt="My reaction to the Xcode Instruments report"/>
  _My reaction to the Xcode Instruments report_
</div>

On iOS each application has exactly one thread responsible for handling the entire UI view hierarchy - the main thread. When view changes occur, the hierarchy is processed by the system's render service, which converts the logical view structure into pixel data for display on the screen.

Eventually Apple introduced _ProMotion_ displays which adjust their refresh rates up to `120Hz` during interaction and down to `10Hz` when idle — the frame rate is not constant anymore.

To better understand the exact implications for time-to-render per frame in milliseconds (`ms`), consider that to hit a refresh rate of `120 Hz` the time per frame is narrow with `1000 ms / 120 = ~8.3 ms` available to update and render the view hierarchy. In contrast for `60 Hz` we can double the available time to `1000 ms / 60 = ~16.7 ms` .

_You can find a full table of refresh rates and timings in the [Apple Documentation](https://developer.apple.com/documentation/quartzcore/optimizing-promotion-refresh-rates-for-iphone-13-pro-and-ipad-pro#Understand-refresh-rates)._

<div align="center">
  <img src="/images/boosting-mobile-session-replay-performance-with-view-renderer-v2/frame-rate-timing-comparison.jpg" alt="Time per Frame Rate"/>
  _The blue boxes represent the amount of available time to calculate and render the view._
</div>

This defines our upper limit for execution time per frame, i.e. how much time we have on the main thread to perform any logic, calculations and rendering (the _workload_) before sending the graphics data to the screen.

If the workload is below that, e.g. `4 ms`, all is good and we wait for the next update. But if the workload takes longer than that, e.g. `25ms`, we have a problem — the main thread is blocked and the app hangs.

As animations are not coupled to frames but to time, the app cannot simply continue with rendering the next one afterwards. For example, if you expect a loading indicator to rotate exactly once per second, longer frame render times would slow down the animation.

To correct the timing the system **skips** the frames that should already have been rendered at this point in time (the _dropped frames)_. This correction behavior is commonly known as _frame drops_ and has the undesired side effect of intermittent frame rate changes that can be noticed as visual stutters (i.e. not scrolling smoothly).

<div align="center">
  <img src="/images/boosting-mobile-session-replay-performance-with-view-renderer-v2/frame-drops.jpg" alt="Dropped Frames"/>
  _When workload takes longer than available time, we need to drop frames_
</div>

Frame drops were also the unintended side effect for the previous implementation of Session Replay, as the once-per-second screenshot simply took too long.

# Taking Screenshots With PII In Mind

Now that we know what the issue is, we need to take a closer look at the work done by Session Replay. The capture process consists of three steps that must be executed for each screenshot:

1. **Redact**: Traverse the view hierarchy to identify UI elements that contain sensitive information and require masking.
2. **Render**: Convert the current view hierarchy into a rasterized bitmap representation ("take a screenshot") using a _view renderer_.
3. **Mask**: Apply privacy masking by combining the rendered image with the redaction geometry.

As mentioned before, accessing the view hierarchy must be done on the main thread, which means that both steps _Redact_ and _Render_ must also execute on the main thread. Only the final step _Mask_ can be performed on a background queue, since it operates solely on the image data produced by the previous steps.

This allows us to focus on the performance of the _Redact_ and _Render_ steps.

<div align="center">
  <img src="/images/boosting-mobile-session-replay-performance-with-view-renderer-v2/uikit-meme.png" alt="UIKit Meme"/>
  _Source: [@ios_memes on X](https://x.com/ios_memes/status/1483418141871030276)_
</div>

# Measuring Baseline Performance

After adding some code to calculate the execution time and adding a basic sampling mechanism to reduce variation over time, we quickly gathered our first insights using a (rather old) iPhone 8:

**The step _Render_ takes `~155ms` per frame, causing ~9-10 of 60 frames being dropped every second of using Session Replay** 💀

| 120 samples | Redact        | Render          | Total           |
| ----------- | ------------- | --------------- | --------------- |
| Min         | 3.0583 ms     | 145.3815 ms     | 151.4525 ms     |
| Avg         | 5.8453 ms     | 149.8243 ms     | 155.6732 ms     |
| p50         | 6.0484 ms     | 149.2103 ms     | 154.1397 ms     |
| p75         | 6.1136 ms     | 151.9487 ms     | 158.0255 ms     |
| p95         | **6.2567 ms** | **155.3496 ms** | **161.3549 ms** |
| Max         | 6.5138 ms     | 155.8338 ms     | 161.8351 ms     |

As the duration of _Redact_ with `~6.3ms` is comparatively small, we will optimize it in the future and focus on improving _Render_.

# Optimizing the View Renderer

Our investigation revealed that the rendering phase consumed approximately 155 milliseconds per screenshot, representing the primary performance bottleneck. The original implementation relied on Apple's high-level UIGraphicsImageRenderer API, which provides convenient abstractions but introduces significant overhead for our use case.

Here's the baseline implementation that was causing the performance issues:

```swift
func render(view: UIView) -> UIImage {
    // Setup: Create graphics context and configure rendering environment
    let screenshot = UIGraphicsImageRenderer(size: view.bounds.size).image { context in
        // Draw: Render view hierarchy into the graphics context
        view.drawHierarchy(in: view.bounds, afterScreenUpdates: false)
    }
    return screenshot
}
```

This implementation consists of two primary function blocks that each present optimization opportunities.

- **Setup**: Creates a graphical bitmap context that serves as the "canvas" for rendering operations, then converts the resulting bitmap data into a UIImage after drawing completes.
- **Draw**: Draws the view hierarchy into the context created during setup.

An additional complexity we have to consider is the coordinate system mismatch between logical points and physical pixels. iOS uses a points-based coordinate system for layout, while the actual display operates in pixels. For example, an iPhone 8 screen measures `375 × 667` points logically, but the physical display resolution is `750 × 1334` pixels due to the `2x` scale factor.

The key takeaway is that we should **avoid scaling** any graphics data unnecessarily, as scaling is a computationally intensive operation, and instead use the appropriate scale. Interestingly, during the baseline analysis, scaling the image did not have a significant impact, although it did in other performance tests.

## Idea 1: Reusing the [UIGraphicsImageRenderer](https://developer.apple.com/documentation/uikit/uigraphicsimagerenderer)

The original implementation uses a helper class provided by Apple’s framework [UIKit](https://developer.apple.com/documentation/uikit), the `UIGraphicsImageRenderer`, which takes care of setting up the low-level bitmap context and the conversion into an image.

Our default view renderer creates a new instance every single time the render method is called. The Apple documentation mentions that it uses a built-in cache and therefore recommends to reuse instances:

> After initializing an image renderer, you can use it to draw multiple images with the same configuration. An image renderer keeps a cache of Core Graphics contexts, so **reusing the same renderer can be more efficient** than creating new renderers.

Looking at the output of the benchmark test, there is no significant change compared to the baseline. This recommendation does not help and so we discarded it.

| **120 samples** | **Render (Baseline)** | **Render (UIGraphicsImageRenderer Cache)** | **± Time** | **± %**  |
| --------------- | --------------------- | ------------------------------------------ | ---------- | -------- |
| Min             | 145.3815 ms           | 146.9310 ms                                | 1.5495 ms  | +1.07 %  |
| Avg             | 149.8243 ms           | 149.5189 ms                                | -0.3054 ms | -0.20 %  |
| p50             | 149.2103 ms           | 148.0545 ms                                | -1.1558 ms | -0.77 %  |
| p75             | 151.9487 ms           | 151.6945 ms                                | -0.2542 ms | -0.17 %  |
| p95             | 155.3496 ms           | 155.3220 ms                                | -0.0276 ms | -0.02 %  |
| Max             | 155.8338 ms           | 156.0019 ms                                | 0.1681 ms  | + 0.11 % |

## Idea 2: Custom View Renderer

As mentioned before, the `UIGraphicsImageRenderer` is a class of [UIKit](https://developer.apple.com/documentation/uikit) which is built on top of [CoreAnimation](https://developer.apple.com/documentation/QuartzCore) and [CoreGraphics](https://developer.apple.com/documentation/coregraphics), also known as the [QuartzCore](https://developer.apple.com/documentation/quartzcore). Most of these are closed source but to better understand its internal implementation, we can take a look at the history of rendering to a graphical context on iOS.

Before the class was introduced with iOS 10, many developers used the predecessors [`UIGraphicsBeginImageContextWithOptions`](<https://developer.apple.com/documentation/uikit/uigraphicsbeginimagecontextwithoptions(_:_:_:)>) to create the bitmap context and [`UIGraphicsGetImageFromCurrentImageContext`](<https://developer.apple.com/documentation/uikit/uigraphicsgetimagefromcurrentimagecontext()>) to convert it into an image.

These methods are also backed by CoreGraphics, so we can go deeper and directly work with the CoreGraphics' `CGContext`, allowing us to skip most of the high-level "helper" methods and internal caching logic.

**This is now exactly what we are doing with the new `SentryGraphicsImageRenderer`.**

Our solution bypasses the high-level UIKit abstractions and works directly with CoreGraphics contexts. This approach offers fine-grained control over memory allocation patterns and eliminates the overhead introduced by UIKit's internal caching and context management logic.

```swift
let scale = (view as? UIWindow ?? view.window)?.screen.scale ?? 1
let image = SentryGraphicsImageRenderer(size: view.bounds.size, scale: scale).image { context in
    view.drawHierarchy(in: view.bounds, afterScreenUpdates: false)
}
```

To give you an rough explanation on how it works, checkout this code snippet:

```swift
let colorSpace = CGColorSpaceCreateDeviceRGB()  // Create an RGB color space for the image
let bytesPerPixel = 4                           // 4 bytes for RGBA
let bitsPerComponent = 8                        // 8 bits for each of RGB component

let pixelsPerRow = Int(size.width * scale)
let pixelsPerColumn = Int(size.height * scale)
let bytesPerRow = bytesPerPixel * pixelsPerRow

// Allocate memory for raw image data
let rawData = calloc(pixelsPerColumn * bytesPerRow, MemoryLayout<UInt8>.size)

// Create a CoreGraphics context with the allocated memory
let context = CGContext(data: rawData, width: pixelsPerRow, height: pixelsPerColumn, bitsPerComponent: bitsPerComponent, bytesPerRow: bytesPerRow, space: colorSpace, bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue)

// Fix mismatch between UIKit and CoreGraphics coordinate systems
context.translateBy(x: 0, y: size.height * scale)
context.scaleBy(x: scale, y: -1 * scale)

// Pushing context will make the context the current main context
UIGraphicsPushContext(context)

// Draw the view into the current main context
view.drawHierarchy(in: view.bounds, afterScreenUpdates: false)

// Pop the context to make the original context the current main context
UIGraphicsPopContext()

// Convert the bitmap context into a CGImage
let image = context.makeImage()
```

_You can find the full implementation of [SentryGraphicsImageRenderer](https://github.com/getsentry/sentry-cocoa/blob/13bc1aa144c7a1df38a5a1dd5862e74cbbb78175/Sources/Swift/Core/Tools/ViewCapture/SentryGraphicsImageRenderer.swift) on GitHub._

| 120 samples | **Render (Baseline)** | **Render (SentryGraphicsImageRenderer @ 2x scale)** | **± Time to Baseline** | **± % to Baseline** |
| ----------- | --------------------- | --------------------------------------------------- | ---------------------- | ------------------- |
| Min         | 145.38 ms             | 14.76 ms                                            | -130.62 ms             | -89.95 %            |
| Avg         | 149.82 ms             | 25.42 ms                                            | -124.41 ms             | -83.04 %            |
| p50         | 149.21 ms             | 24.56 ms                                            | -124.65 ms             | -83.54 %            |
| p75         | 151.95 ms             | 27.34 ms                                            | -124.61 ms             | -82.01 %            |
| p95         | 155.35 ms             | 30.32 ms                                            | -125.03 ms             | -80.48 %            |
| Max         | 155.83 ms             | 32.58 ms                                            | -123.26 ms             | -79.09 %            |

We have our first win and reduced the average time by **~125ms** or **~80%**! 🎉

As you might have noticed in the code snippet above, we had to explicitly declare the scale of the window. **This was essential** as we were able to notice a performance loss when using window scale of `1.0` instead of the screen-native scale of `2.0`:

| 120 samples | **Render (SentryGraphicsImageRenderer @ 2x scale)** | **Render (SentryGraphicsImageRenderer @ 1x scale)** | **± Time to 2x scale** | **± % to 2x scale** |
| ----------- | --------------------------------------------------- | --------------------------------------------------- | ---------------------- | ------------------- |
| Min         | 14.76 ms                                            | 27.05 ms                                            | + 12.29 ms             | + 83.28 %           |
| Avg         | 25.42 ms                                            | 38.80 ms                                            | + 13.39 ms             | + 52.67 %           |
| p50         | 24.56 ms                                            | 38.47 ms                                            | + 13.92 ms             | + 56.67 %           |
| p75         | 27.34 ms                                            | 40.37 ms                                            | + 13.02 ms             | + 47.63 %           |
| p95         | 30.32 ms                                            | 44.42 ms                                            | + 14.10 ms             | + 46.50 %           |
| Max         | 32.58 ms                                            | 48.66 ms                                            | + 16.08 ms             | + 49.37 %           |

### Idea 3: Replacing `view.drawHierarchy(in:afterScreenUpdates:)`

Now that we have optimized the block _Setup_, let’s improve _Draw._

The instance method [`view.drawHierarchy(in:afterScreenUpdates:)`](<https://developer.apple.com/documentation/uikit/uiview/drawhierarchy(in:afterscreenupdates:)>) allows us to easily render a snapshot of the **complete** view hierarchy into the current context.

The view hierarchy is a tree of `UIView` instances, each backed by a tree of `CALayer` instances, which then offers the method [`layer.render(in:)`](<https://developer.apple.com/documentation/quartzcore/calayer/render(in:)>) to directly render itself and its sublayers into the specified context.

```swift
let scale = (view as? UIWindow ?? view.window)?.screen.scale ?? 1
let image = SentryGraphicsImageRenderer(size: view.bounds.size, scale: scale).image { context in
    view.layer.render(in: context.cgContext)
}
```

Running our performance tests we can also notice faster render times compared to the baseline:

| 120 samples | **Render (Baseline)** | **Render (SentryGraphicsImageRenderer + `layer.render`)** | **± Time to Baseline** | **± % to Baseline** |
| ----------- | --------------------- | --------------------------------------------------------- | ---------------------- | ------------------- |
| Min         | 145.38 ms             | 18.53 ms                                                  | -126.85 ms             | -87.25 %            |
| Avg         | 149.82 ms             | 20.74 ms                                                  | -129.08 ms             | -86.16 %            |
| p50         | 149.21 ms             | 19.84 ms                                                  | -129.37 ms             | -86.70 %            |
| p75         | 151.95 ms             | 22.42 ms                                                  | -129.53 ms             | -85.25 %            |
| p95         | 155.35 ms             | 24.66 ms                                                  | -130.69 ms             | -84.13 %            |
| Max         | 155.83 ms             | 24.92 ms                                                  | -130.92 ms             | -84.01 %            |

But even more interesting is comparing it to `view.drawHierarchy`:

| 120 samples | **Render (SentryGraphicsImageRenderer @ 2x scale + `view.drawHierarchy`)** | **Render (SentryGraphicsImageRenderer @ 2x scale + `layer.render`)** | **± Time to `view.drawHierarchy`** | **± % to `view.drawHierarchy`** |
| ----------- | -------------------------------------------------------------------------- | -------------------------------------------------------------------- | ---------------------------------- | ------------------------------- |
| Min         | 14.76 ms                                                                   | 18.53 ms                                                             | +3.77 ms                           | +25.57 %                        |
| Avg         | 25.42 ms                                                                   | 20.74 ms                                                             | -4.68 ms                           | -18.40 %                        |
| p50         | 24.56 ms                                                                   | 19.84 ms                                                             | -4.72 ms                           | -19.20 %                        |
| p75         | 27.34 ms                                                                   | 22.42 ms                                                             | -4.92 ms                           | -18.01 %                        |
| p95         | 30.32 ms                                                                   | 24.66 ms                                                             | -5.66 ms                           | -18.67 %                        |
| Max         | 32.58 ms                                                                   | 24.92 ms                                                             | -7.66 ms                           | -23.52 %                        |

Looks like we can shave off another ~18-19% of the time on the main thread! Sounds too good to be true, right?

Because it actually is too good to be true ☹️

During testing we noticed that the rendering using `layer.render(in:)` is **incomplete**, in particular the icons used in the tab bar did not show up in the rendered screenshot at all.

<div align="center">
  <img src="/images/boosting-mobile-session-replay-performance-with-view-renderer-v2/render-comparison.png" alt="Render Failure"/>
  _Tab bar icons missing when using layer.render(in:) approach_
</div>

The impact of the missing UI is not entirely clear and we could not pinpoint the exact cause for this (with unverified assumptions it is a side effect of [SF Symbols](https://developer.apple.com/sf-symbols/) and the way fonts are rendered). We decided against adopting this behavior as the new default render method in the foreseeable future and stick with `drawHierarchy` instead.

As some of you might still prefer the even faster render times over completely rendered frames, you can still opt-in by configuring the option `options.sessionReplay.enableFastViewRenderering = true`.

# The Numbers Speak For Themselves

The optimization achieved substantial performance improvements, with the most dramatic gains on older hardware. Frame drops decreased from 9-10 frames per second to approximately 2 frames per second on iPhone 8 devices, representing a massive win!

Main thread blocking time improved from 155 milliseconds to 25 milliseconds per screenshot, an **84% reduction** that brings Session Replay overhead well within acceptable performance budgets even on resource-constrained devices.

For teams interested in more detailed information, the complete analysis results are publicly available in [pull request #4940](https://github.com/getsentry/sentry-cocoa/pull/4940) on GitHub.

The optimized view renderer was introduced through a careful rollout process designed to minimize risk while maximizing the performance benefits for users experiencing issues.

Starting with Sentry Cocoa SDK [v8.48.0](https://github.com/getsentry/sentry-cocoa/releases/tag/8.48.0), the new implementation was available as an experimental feature controlled by the `options.sessionReplay.enableExperimentalViewRenderer` flag.

This experimental approach allowed early adopters to test the new renderer in their production environments. Based on positive feedback and telemetry data, the optimized renderer became the default implementation in [v8.50.2](https://github.com/getsentry/sentry-cocoa/releases/tag/8.50.2).

# What's Next

We've already received new reports of users challenging our new implementation, especially when working with graphics heavy animations.
In addition new edge cases arose, such as supporting a different color space when capturing HDR content.

All of these are great feedback and we are working on addressing them in the upcoming releases.
If you are interested in following along, make sure to follow our [GitHub Releases](https://github.com/getsentry/sentry-cocoa/releases) and [Engineering Blog](https://sentry.engineering) to stay updated.

Thanks for reading.
