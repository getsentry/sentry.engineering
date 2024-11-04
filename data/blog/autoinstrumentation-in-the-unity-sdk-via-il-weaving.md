---
title: 'Autoinstrumentation in the Unity SDK via IL Weaving'
date: '2024-11-04'
tags: []
draft: true
summary: 'Learn how we built the autoinstrumentation in the Unity SDK via IL Weaving'
images: []
layout: PostLayout
canonicalUrl:
authors: []
---

## Outline: What we wanted to have and how we got it

Our Unity SDK was super complete from the crash reporting point of view. It had support for line numbers in C# exceptions on IL2CPP (in release mode!), captured native crashes on Windows, macOS, Linux Android and iOS, context set via C# would show up on any type of event, including minidumps, debug symbols are magically uploaded when you build the game with the editor. And more. We were confident we had the best crash reporting solution out there. Now we were looking towards offering some out-of-the-box insights into the game’s performance. Right out of the gate we hit the first question: What would auto-instrumentation for Unity games look like?

Sentry had built UX for visualization of span trees and the instrumentation for mobile and web is based around screen rendering. We wanted to take those concepts and apply them to Unity. As a result we limited the instrumentation to the game’s startup procedure and scene loading. Every game starts at some point. And every game, no matter how big or small, loads a scene. We might not be able to give insights into the entire game but we can show every developer right after installing the package, what Sentry could offer.

Our ideal scenario would be something that would work out-of-the-box with no to minimal setup from the user. As a sneak-peek and to show off what we got working without you having to read the whole thing before you get as excited as we are: This is what the Unity SDK‘s auto-instrumentation offers OOTB right now. Without a single line of code. For all Unity games.

![TraceView](/images/autoinstrumentation-in-unity-via-ilweaving/traceview.png)

## What is the Unity SDK

Unity games run on basically all platforms. To provide support for that, the Sentry SDK for Unity became an SDK of SDKs. It ships and integrates via P/Invoke (FFI) with whatever SDK is native for the targeted platform. Running on iOS? Not a problem, we’ll bring the Cocoa SDK to have you covered! Same for Android, WebGL, and all the desktops!

![What is the Unity SDK](/images/autoinstrumentation-in-unity-via-ilweaving/what-is-the-unity-sdk.png)

After all, this is how we achieved the native crash capturing support. What those SDKs also have in common, other than powering the Unity SDK, they all provide some form of auto instrumentation.
Unfortunately, this has limited use. A key factor in Unity’s success is its platform abstraction. Developers are free from worrying about platform specifics and that allows them to focus solely on Unity internals. To enable this, Unity games are typically embedded within a super thin launcher. As a result, concepts like navigation events and UI activities are generally unfamiliar to them. For instrumentation to be truly helpful and actionable, the SDK would need to operate directly within Unity.

## How the Unity lifecycle works

The game works in a super tight loop, typically updating anywhere from 30 to 60 times per second but the sky is the limit. Creating a span to measure every single tick is not feasible. We needed to look at some overarching actions like some set of logical operations we would want to capture.

![Unity Lifecycle](/images/autoinstrumentation-in-unity-via-ilweaving/unity-life-cycle.png)

## The problem of finding discrete points to start and stop transactions and spans

For measuring how long something takes Sentry has two working concepts: Transactions and Spans. Transactions are single [instances of an activity or a service](https://docs.sentry.io/product/performance/transaction-summary/#what-is-a-transaction), like loading of a page or some async task. Spans are individual measurements that are nested within a transaction. Conceptionally, we're trying to find places to start and stop a big stopwatch for bigger, and very specific actions that we want to measure. And then we are looking for sup-tasks within that action that we could capture with smaller stopwatches. But how does a transaction fit within the the frame of a game? What instance of a service, that is already built into the engine, could a transaction represent?

For all its features Unity is still a blank canvas for you to create any kind of game. That means there are, other than the general lifecycle, not very many fixed points that the SDK could hook into to start and stop a span. There are a whole bunch of one-time events like button clicks but how would the SDK hook into whatever happens behind the button click? How would the SDK know when to finish the span?

## Events that are universal to all Unity games

All games need to startup and the startup procedure is the same for all Unity games and consists of loading of systems, the splash-screen (if applicable) and the loading of the initial scene. Scene loading in general is another great fixed point. Everything within Unity exists within the context of a scene. Some games load them additionally, some games swap them, some games only ever have one. But at least that one gets loaded during startup.

With this we had our transaction hooks. We know when the startup is starting and finished. And we can hook into the scene manager to time scene load and scene load finish events.

## More granularity: What to populate those transactions with?

Now that we have our overarching operation that we’re trying to time we’re now looking for smaller actions that happen within. Looking towards Unity’s lifecycle helps us out once more. The initialization happens for every GameObject during its creation or, if it is an initial part of the scene, during the scene’s loading. For all GameObjects the one method that gets invoked is the `Awake` call. But that’s user’s code. How would the SDK instrument non-SDK code without asking to user to do it for us?

## IL Weaving - The art of.. _insert pun_

When working on your Unity game you’re typically writing your code in C#. And no matter what the end-result, even tho it later gets compiled to platform native code via IL2CPP, at some point in the build process that C# code gets compiled to [Intermediate Language](https://learn.microsoft.com/en-us/dotnet/standard/managed-code) (IL). Even tho Unity might transpile the IL to C++ later on, that IL is still there, somewhere. We managed to hook the SDK into the the build pipeline to modify the generated `Assembly-CSharp.dll`.

Let’s say we have a very simple `MonoBehaviour` for demonstration purposes:

```csharp
using UnityEngine;

public class BlogMaterial : MonoBehaviour
{
    private void Awake()
    {
        Debug.Log("Hello World!");
    }
}
```

```csharp
.class public auto ansi beforefieldinit BlogMaterial
	extends [UnityEngine.CoreModule]UnityEngine.MonoBehaviour
{
	// Methods
	.method private hidebysig
		instance void Awake () cil managed
	{
		// Method begins at RVA 0x2160
		// Header size: 1
		// Code size: 11 (0xb)
		.maxstack 8

		// Debug.Log((object)"Hello World!");
		IL_0000: ldstr "Hello World!"
		IL_0005: call void [UnityEngine.CoreModule]UnityEngine.Debug::Log(object)
		// }
		IL_000a: ret
	} // end of method BlogMaterial::Awake
} // end of class BlogMaterial

```

On the left is our `BlogMaterial` and on the right is the IL code that gets generated by the compiler.

We want to wrap whatever is going on inside the `Awake` with a span. For this we created some helpers that are accessible from anywhere inside the user’s code.

```csharp
/// <summary>
/// A MonoBehaviour used to provide access to helper methods used during Performance Auto Instrumentation
/// </summary>
public partial class SentryMonoBehaviour
{
    public void StartAwakeSpan(MonoBehaviour monoBehaviour) =>
        SentrySdk.GetSpan()?.StartChild("awake", $"{monoBehaviour.gameObject.name}.{monoBehaviour.GetType().Name}");

    public void FinishAwakeSpan() => SentrySdk.GetSpan()?.Finish(SpanStatus.Ok);
}
```

Initially, we did this change manually and took a look at the resulting IL.

```csharp
private void Awake()
{
    SentryMonoBehaviour.Instance.StartAwakeSpan(this);

    Debug.Log("Hello World!");

    SentryMonoBehaviour.Instance.FinishAwakeSpan();
}
```

```csharp
	// Methods
	.method private hidebysig
		instance void Awake () cil managed
	{
		// Method begins at RVA 0x22f7
		// Header size: 1
		// Code size: 32 (0x20)
		.maxstack 8

		// SentryMonoBehaviour.Instance.StartAwakeSpan(this);
		IL_0000: call class [Sentry.Unity]Sentry.Unity.SentryMonoBehaviour [Sentry.Unity]Sentry.Unity.SentryMonoBehaviour::get_Instance()
		IL_0005: ldarg.0
		IL_0006: callvirt instance void [Sentry.Unity]Sentry.Unity.SentryMonoBehaviour::StartAwakeSpan(class [UnityEngine]UnityEngine.MonoBehaviour)
		// Debug.Log("Hello World!");
		IL_000b: ldstr "Hello World!"
		IL_0010: call void [UnityEngine.CoreModule]UnityEngine.Debug::Log(object)
		// SentryMonoBehaviour.Instance.FinishAwakeSpan();
		IL_0015: call class [Sentry.Unity]Sentry.Unity.SentryMonoBehaviour [Sentry.Unity]Sentry.Unity.SentryMonoBehaviour::get_Instance()
		IL_001a: call instance void [Sentry.Unity]Sentry.Unity.SentryMonoBehaviour::FinishAwakeSpan()
		// }
		IL_001f: ret
	} // end of method BlogMaterial::Awake
```

But the `.dll` is not just a text file. So how do we modify this? Luckily, there are libraries like [Cecil](https://github.com/jbevain/cecil) around that we can build on and that do the heavy lifting for us. Cecil basically turns this into something akin to painting by numbers:

1. Compile your code to create the “baseline”
2. Modify the source code to your desired end-result
3. Let the compiler do what it does best - translate your C# code into IL
4. Inspect the difference between the baseline and the end-result
5. Use Cecil to recreate the change

The code that modifies the `Awake` and adds the `StartSpan` functionality is three lines:

```csharp
// Adding in reverse order because we're inserting *before* the 0ths element
processor.InsertBefore(method.Body.Instructions[0], processor.Create(OpCodes.Callvirt, startAwakeSpanMethod));
processor.InsertBefore(method.Body.Instructions[0], processor.Create(OpCodes.Ldarg_0));
processor.InsertBefore(method.Body.Instructions[0], processor.Create(OpCodes.Call, getInstanceMethod));
```

You can inspect the whole setup of reading, modifying and writing the IL [here](https://github.com/getsentry/sentry-unity/blob/main/src/Sentry.Unity.Editor/AutoInstrumentation/SentryPerformanceAutoInstrumentation.cs).

And the result is this Trace View for every Unity game out-of-the-box, without the user having to write a single line of code.

![TraceView](/images/autoinstrumentation-in-unity-via-ilweaving/traceview.png)

### What do we have now?

With this we achieved two things:

1. We’re providing visible, tangible value for users right out of the box. They install the package and get to see the Performance capabilities without having to write a single line of code.
2. We have a proof of concept that it is not only possible but totally viable to inject custom SDK functionality to wrap user’s code.

## Where to go from here

What this allows us is to move on towards even more auto-instrumentation. UnityWebRequests are an obvious choice.

Maybe we can add the span to the button click after all. Start the span when a button is clicked and finish it on the start of the next frame?
