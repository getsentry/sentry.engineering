---
title: 'How we built user interaction tracking for Jetpack Compose'
date: '2023-04-21'
tags: ['Android', 'Jetpack Compose', 'Kotlin']
draft: false
summary: "Tracking user interactions for mobile can be tricky, but sentry's got you covered."
images: [/images/how-we-built-user-interaction-tracking-for-jetpack-compose/compose_hero.jpg]
layout: PostLayout
canonicalUrl: https://proandroiddev.com/how-we-built-user-interaction-tracking-for-jetpack-compose-e3b1dd24f0ae
authors: ['markushintersteiner']
---

Like you, we’ve been noticing the demonstrative shift to declarative programming for mobile UIs. Late last year, we explored this shift [on our blog](https://bit.ly/sentry-future-declarative-14), noting that while React Native and Flutter were declarative from the start, Android and iOS have both released support through Jetpack Compose and SwiftUI, respectively. Earlier this year we officially launched support for Jetpack Compose in our [Java SDK](https://bit.ly/sentry-java-sdk-14), and I [hosted an AMA](https://bit.ly/jetpack-at-sentry-ama-14) along with the rest of the team that built the integration. With such a prominent shift happening in mobile development, it’s imperative that not only developer tools keep up, but that we share our learned experiences so that we can continue to develop this space together.

Continuing our series of articles that began with our [getting started guide](https://bit.ly/jetpack-at-sentry-blog-14) earlier this year, my team and I will share our experience building our Jetpack Compose integration, starting with the user interaction tracking feature. With our SDK being open source and being early to adopt Jetpack Compose support, we want to invite you to learn from our wins and mistakes as you ramp up for the future of declarative mobile development.

## Jetpack Compose and Monitoring

In the Jetpack Compose [getting started guide](https://bit.ly/jetpack-at-sentry-blog-14) that we released earlier this year, one of the tips was to use an error and performance monitoring tool like Sentry to reduce the learning curve and ensure that your app is bug-free. In this post, we detail how we implemented the user interaction tracking feature for Jetpack Compose, which is available as part of our Android SDK.

![](/images/how-we-built-user-interaction-tracking-for-jetpack-compose/compose.png)

The final outcome: Automatically turning clicks into breadcrumbs

## Our Requirements for Declarative Programming Support

[Our Android SDK](https://docs.sentry.io/platforms/android/) gives developers deep context, like device details, threading information, and screenshots, that makes it easier to investigate an issue. It also provides breadcrumbs of user interactions (clicks, scrolls, or swipes) to fully understand what led up to a crash. And, like all of our other SDKs, our Android SDK is designed to provide this valuable information out-of-the-box without cluttering your code with Sentry SDK calls.

We had the following goals in mind when building our user interaction tracking feature for Jetpack Compose:

1.  Detect any clicks, swipes, or scrolls, globally
2.  Know which UI element a user interacted with
3.  Determine an identifier for the UI element and generate the corresponding breadcrumb
4.  Require minimal setup

## Detecting clicks, scrolls, and swipes

In Jetpack Compose UI, a click behavior is usually added via `Modifier.clickable`, where you provide a lambda expression as an argument. Scrolling and swiping work similarly. That’s a lot of API surface to cover and spread throughout the user’s code. So how could an SDK track all those calls without asking the developer to add any custom code to every invocation? The answer is some nifty combination of existing system callbacks:

1.  On Sentry SDK init, register a `ActivityLifecycleCallbacks` to get hold of the current visible `Activity`
2.  Retrieve the `Window` via `Activity.getWindow()`
3.  Set a `Window.Callback` using `window.setCallback()`

Let’s dive a bit deeper into the [Window.Callback](https://developer.android.com/reference/android/view/Window.Callback) interface. It defines several methods, but the interesting one for us is `dispatchTouchEvent`. It allows you to intercept every motion event being dispatched to an `Activity`. This is quite powerful and the basis for many features. For example, the good old [Dialog](https://cs.android.com/android/platform/superproject/+/master:frameworks/base/core/java/android/app/Dialog.java;l=776;drc=a2e45f1ed1a3f74ca413f5d4ef815d50f7399c26) uses this callback to detect clicks outside the content to trigger dialog dismissals.

What’s important to note here is that you can only set a single `Window.Callback`, thus it’s required to remember any previously set callback (e.g. by the system or other app code out of your control) and delegate all calls to it. This ensures any existing logic will still be executed, avoiding breaking any behaviour.

```kotlin
val previousCallback = window.getCallback() ?: EmptyCallback()
val newCallback = SentryWindowCallback(previousCallback)
window.setCallback(newCallback)

class SentryWindowCallback(val delegate: Window.Callback) : Window.Callback {
    override fun dispatchTouchEvent(event: MotionEvent?): Boolean {
        // our logic ...

        return delegate.dispatchTouchEvent(event)
    }
}
```

## Locating and identifying widgets

But this is only half of the job done, as we also want to know which widget the user has interacted with. For traditional Android XML layouts, this is rather easy:

1.  Iterate the View Hierarchy, and find a matching View given the touch coordinates
2.  Retrieve the numeric View ID via `view.getId()`
3.  Translate the ID back to its resource name to get a readable identifier

```kotlin
fun coordinatesWithinBounds(view: View, x: Float, y: Float): Boolean {
    view.getLocationOnScreen(coordinates)
    val vx = coordinates[0]
    val vy = coordinates[1]

    val w = view.width
    val h = view.height

    return !(x < vx || x > vx + w || y < vy || y > vy + h);
}

fun isViewTappable(view: View) {
    return view.isClickable() && view.getVisibility() == View.VISIBLE
}

val x = motionEvent.getX()
val y = motionEvent.getY()

if (coordinatesWithinBounds(view, x, y) && isViewTappable(view)) {
    val viewId = view.getId()
    return view.getContext()
      .getResources()?
      .getResourceEntryName(viewId); // e.g. button_login
)
```

As Jetpack Compose UI is not using the Android System widgets, we can’t apply the same mechanism here. If you take a look at the Android layout hierarchy, all you get is one large `AndroidComposeView` which takes care of rendering your `@Composables` and acts as a bridge between the system and Jetpack Compose runtime.

![View Hierarchy](/images/how-we-built-user-interaction-tracking-for-jetpack-compose/compose_vh.png)

Left: Traditional Android Layout, Right: Jetpack Compose UI

Our first approach was to use some Accessibility Services APIs to retrieve a description of an UI element at a specific location on the screen. The [official documentation about semantics](https://developer.android.com/jetpack/compose/semantics) provided a good starting point, and we quickly found ourselves digging into [AndroidComposeViewAccessibilityDelegateCompat](https://cs.android.com/androidx/platform/frameworks/support/+/androidx-main:compose/ui/ui/src/androidMain/kotlin/androidx/compose/ui/platform/AndroidComposeViewAccessibilityDelegateCompat.android.kt) to understand better how it works under the hood.

```kotlin
// From <https://cs.android.com/androidx/platform/frameworks/support/+/androidx-main:compose/ui/ui/src/androidMain/kotlin/androidx/compose/ui/platform/AndroidComposeViewAccessibilityDelegateCompat.android.kt>

/**
 * Hit test the layout tree for semantics wrappers.
 * The return value is a virtual view id, or InvalidId if an embedded Android View was hit.
 */
@OptIn(ExperimentalComposeUiApi::class)
@VisibleForTesting
internal fun hitTestSemanticsAt(x: Float, y: Float): Int
```

But after an early prototype, we quickly abandoned the idea as the potential performance overhead of having accessibility enabled didn’t justify the value generated. Since Compose UI elements are not part of the traditional Android View system, the Compose runtime needs to sync the “semantic tree” to the Android system accessibility service if the accessibility features are enabled. For example, any changes to the layout bounds are synced every 100ms.

```kotlin
// From <https://cs.android.com/androidx/platform/frameworks/support/+/androidx-main:compose/ui/ui/src/androidMain/kotlin/androidx/compose/ui/platform/AndroidComposeViewAccessibilityDelegateCompat.android.kt;l=2033;drc=63b4fed978b3da23879817a502899d9154d97e51>

/**
 * This suspend function loops for the entire lifetime of the Compose instance: it consumes
 * recent layout changes and sends events to the accessibility framework in batches separated
 * by a 100ms delay.
 */
suspend fun boundsUpdatesEventLoop() {
    // ...
}
```

We also had little control over what the API returned, e.g., the widget descriptions were localized, making it unsuitable for our use case.

## Diving into Compose internals

So it was time to examine how Compose works under the hood closely.

Unlike the traditional Android View system, Jetpack Compose builds the View Hierarchy for you. Your `@Composable` code “emits” all required information to build up its internal hierarchy of nodes. For Android, the tree consists of two different node types: Either `LayoutNode` (e.g. a `Box`) or `VNode` (used for Vector drawables).

The before-mentioned `AndroidComposeView` implements the `androidx.compose.ui.node.Owner` interface, which itself provides a root of type `LayoutNode`.

Unfortunately, some of these APIs are marked as internal and thus can’t be used from an outside module, as it will produce a Kotlin compiler error. We didn’t want to resort to using reflection to workaround this, so we devised another little trick: If you’re accessing the APIs via Java, you’ll get away with a compiler warning. 🙂 Granted, this is far from ideal, but it gives us some compile-time safety and lets us quickly discover breaking changes in combination with a newer version of Jetpack Compose runtime. On top of that, reflection would not have worked for obfuscated builds, as any `Class.forName()` calls during runtime wouldn’t work with renamed Compose runtime classes.

After settling on the Java workaround, we quickly encountered another issue when adding Java sources to our existing sentry-compose Kotlin multiplatform module. The build fails if you try to mix Java into an [Kotlin Multiplatform Mobile (KMM)](https://kotlinlang.org/lp/mobile/) enabled Android library. This is a [known issue](https://youtrack.jetbrains.com/issue/KT-30878), and as a temporary workaround, we created a separate JVM module called sentry-compose-helper which contains all relevant Java code.

Similar to a `View`, a `LayoutNode` also provides some APIs to retrieve its location and bounds on the screen. `LayoutNode.getCoordinates()` provides coordinates that can be fed into L`ayoutCoordinates.positionInWindow()`, which then returns an `Offset`.

```kotlin
// From: <https://cs.android.com/androidx/platform/frameworks/support/+/androidx-main:compose/ui/ui/src/commonMain/kotlin/androidx/compose/ui/layout/LayoutCoordinates.kt;l=122;drc=2a88b3e1da6387b7914f95001988f90a2a3857f1>
/**
 * The position of this layout relative to the window.
 */
fun LayoutCoordinates.positionInWindow(): Offset

You probably used  `Offset`  before, but did you know it’s actually a  `Long`  in a fancy costume? 🤡  `x`  and  `y`  are just packed into the first and last 32 bits. This Kotlin feature is called  [Inline Classes](https://kotlinlang.org/docs/inline-classes.html), and it’s a powerful trick to improve runtime performance while still providing the convenience and type safety of classes.

@Immutable
@kotlin.jvm.JvmInline
value class Offset internal constructor(internal val packedValue: Long) {
  @Stable
  val x: Float
    get() // ...

  @Stable
  val y: Float
    get() // ...
}

Since we’re accessing the Compose API in Java, we had to manually extract x and y components from the Offset.

private static boolean layoutNodeBoundsContain(@NotNull LayoutNode node, final float x, final float y) {
    final int nodeHeight = node.getHeight();
    final int nodeWidth = node.getWidth();

    // positionInWindow() returns an Offset in Kotlin
    // if accessed in Java, you'll get a long!
    final long nodePosition = LayoutCoordinatesKt.positionInWindow(node.getCoordinates());

    final int nodeX = (int) Float.intBitsToFloat((int) (nodePosition >> 32));
    final int nodeY = (int) Float.intBitsToFloat((int) (nodePosition));

    return x >= nodeX && x <= (nodeX + nodeWidth) && y >= nodeY && y <= (nodeY + nodeHeight);
}
```

## Identifying Composables

Retrieving a suitable identifier for a `LayoutNode` wasn’t straightforward either. Our first approach was to access the `sourceInformation`. When the Compose Compiler plugin processes your `@Composable` functions, it adds `sourceInformation` to your method body. This can then later get picked up by Compose tooling to e.g. link the Layout Inspector with your source code.

To illustrate this a bit better, let’s define the simplest possible `@Composable` function:

```kotlin
@Composable
fun EmptyComposable() {

}
```

Now let’s compile this code and check how the Compose Compiler plugin enriches the function body:

```java
import androidx.compose.runtime.Composer;
import androidx.compose.runtime.ComposerKt;
import androidx.compose.runtime.ScopeUpdateScope;
import kotlin.Metadata;

public final class EmptyComposableKt {
    public static final void EmptyComposable(Composer $composer, int $changed) {
        Composer $composer2 = $composer.startRestartGroup(103603534);
        ComposerKt.sourceInformation($composer2, "C(EmptyComposable):EmptyComposable.kt#llk8wg");
        if ($changed != 0 || !$composer2.getSkipping()) {
            if (ComposerKt.isTraceInProgress()) {
                ComposerKt.traceEventStart(103603534, $changed, -1, "com.example.EmptyComposable (EmptyComposable.kt:5)");
            }
            if (ComposerKt.isTraceInProgress()) {
                ComposerKt.traceEventEnd();
            }
        } else {
            $composer2.skipToGroupEnd();
        }
        ScopeUpdateScope endRestartGroup = $composer2.endRestartGroup();
        if (endRestartGroup == null) {
            return;
        }
        endRestartGroup.updateScope(new EmptyComposableKt$EmptyComposable$1($changed));
    }
}
```

Let’s focus on the `ComposerKt.sourceInformation()` call: The second argument is a String, containing information about the function name and the source file. Unfortunately, `sourceInformation` isn’t necessarily available in obfuscated release builds, thus, we also can’t take advantage of that.

After some more research, we stumbled upon the built-in `Modifier.testTag(“<identifier”>)` method, which is commonly used for writing UI tests. Turns out this is part of the accessibility semantics we already looked into earlier!

At this point, it was little to no surprise to see that those semantics are being modeled as `Modifiers` under the hood (`Modifiers` are like a secret ingredient, making Jetpack Compose so powerful!). Since `Modifiers` are directly attached to a `LayoutNode`, we can simply iterate over them and look for a suitable one.

```kotlin
fun retrieveTestTag(node: LayoutNode) : String? {
    for (modifier in node.modifiers) {
        if (modifier is SemanticsModifier) {
            val testTag: String? = modifier
                .semanticsConfiguration
                .getOrNull(SemanticsProperties.TestTag)

            if (testTag != null) {
                return testTag
            }
        }
    }
    return null
}
```

## Wrapping it up

Having finished the last piece of the puzzle, it was time to wrap it up, cover some edge cases and ship the final product. Jetpack Compose user interactions are now available, starting with the `6.10.0` version of our Android SDK.

Currently, the feature is still opt-in, so it needs to be enabled via `AndroidManifest.xml`:

```xml
<!-- AndroidManifest.xml -->
<application>
  <meta-data android:name="io.sentry.traces.user-interaction.enable" android:value="true" />
</application>
```

But after enabling it, it just works. Granted, it still requires you to provide a `Modifier.testTag(…)`, but that should already exist if you’re writing UI tests. 😉 [Check out our docs to get started](https://docs.sentry.io/platforms/android/configuration/integrations/jetpack-compose/).

## Next Steps

In a [fireside chat with Riot and Nextdoor](https://bit.ly/building-mobile-fireside-14), the topic of [Jetpack Compose and declarative programming came up](https://bit.ly/moving-to-jetpack-fireside-14), as we discussed the critical shift in the mobile space. Now is the time to get started with Jetpack Compose, and when you do, don’t forget Sentry’s got your monitoring needs. Checkout the list of resources below and let us know what you think in our [Discord](https://bit.ly/sentry-discord-14) or in our [GitHub Discussions](https://bit.ly/sentry-java-sdk-discussion-14).

## Jetpack Compose + Sentry Resources

- **Blog Post**: [Mobile: The Future is Declarative](https://bit.ly/sentry-future-declarative-14)
- **Blog Post**: [Jetpack Compose: Getting started](https://bit.ly/jetpack-at-sentry-blog-14)
- **Short Video**: [Mobile: The Future is Declarative](https://bit.ly/future-declarative-video-14)
- **Live AMA Recording**: [Jetpack Compose best practices](https://bit.ly/jetpack-at-sentry-ama-14)
- **Live Fireside Chat Recording**: [Building better mobile experiences with Nextdoor and Riot Games](https://bit.ly/building-mobile-fireside-14)
- **Sentry’s Jetpack Compose Docs**: [Jetpack Compose integration](https://bit.ly/jetpack-at-sentry-docs-14)
- **Sentry’s GitHub Discussions for Android SDK**: [https://bit.ly/sentry-java-sdk-discussion-14](https://bit.ly/sentry-java-sdk-discussion-14)
