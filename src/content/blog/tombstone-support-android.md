---
title: "Grave Improvements: Native Crash Postmortems via Android Tombstones"
date: "2026-03-26"
tags: ["mobile", "kotlin", "java", "android", "native", "sdk"]
draft: true
summary: Tombstones on Android provide complete context into native crashes. Starting with Android 12, these are available programmatically.
images: []
postLayout: PostLayout
canonicalUrl: https://blog.sentry.io/2026/03/26/grave-improvements/
authors: ["supervacuus"]
---

Let’s start with what a tombstone is beyond the graveyard: it's a native-code crash-dump format specific to Android. App 
developers usually retrieve it from the resulting ZIP when they issue `adb bugreport`, and it is typically serialized to text 
and protobuf encodings. In fact, tombstones have existed in Android since the very beginning, 17 years ago by now. (the 
[“Initial Contribution” commit](https://android.googlesource.com/platform/system/core/+/4f6e8d7a00cbeda1e70cc15be9c4af1018bdad53) 
with the [first `debuggerd` implementation](https://android.googlesource.com/platform/system/core/+/4f6e8d7a00cbeda1e70cc15be9c4af1018bdad53%5E!/#F46), 
which also already contained the same target directory `/data/tombstones` and the still existing maximum rotation limit 
of 10 tombstones).

So, while this useful postmortem capability existed on Android systems for nearly two decades, it was only accessible 
from outside apps using developer tools that required a debug connection to a device. It became 
programmatically accessible only in recent versions. Android 11 (SDK level 30) introduced the 
[ApplicationExitInfo](https://developer.android.com/reference/android/app/ApplicationExitInfo) (via the 
[ActivityManagerService](https://android.googlesource.com/platform/frameworks/base/+/1cdfff555f4a21f71ccc978290e2e212e2f8b168/services/core/java/com/android/server/am/ActivityManagerService.java#10213)
and [NativeTombstoneManager](https://android.googlesource.com/platform/frameworks/base.git/+/82b439be656b421a3dd52515971bad525fe2b28a/services/core/java/com/android/server/os/NativeTombstoneManager.java))
and Android 12 (SDK level 31) finally provided access to the trace input stream associated with 
[ApplicationExitInfo.REASON_CRASH_NATIVE](https://developer.android.com/reference/android/app/ApplicationExitInfo#REASON_CRASH_NATIVE).

Since version `8.30.0`, Sentry’s Android SDK handles the trace input stream associated with 
`ApplicationExitInfo.REASON_CRASH_NATIVE` on all devices running Android 12 and above. This is 
good news for all customers with native code in their packages, if a significant subset of their users runs on 
sufficiently modern devices. In particular, these customers might not be interested in instrumenting those native 
packages and only want to be informed of crashes in those packages. However, it will also be good news for those who do 
native instrumentation, as we can now dramatically improve their crash context if a crash occurs. But before we talk 
about the details, let’s step back and consider how native code has been handled on Android up until now.

## Handling native crashes on Android

Before tombstone support, the Native SDK (`sentry-native`) was used in the Android SDK as the primary native error 
reporting source. Since Android is based on Linux, a considerable part of the SDK could be reused, and for those parts 
that couldn’t, work on integrating Android-specific code began in 2019.

Specifically, the integration of `libunwindstack` (not to be confused with `libunwind`), the AOSP platform unwinder still 
used today to produce stack traces for `debuggerd` and, in turn, tombstones, was a key moment for supporting native crashes 
in Sentry's Android SDK. Why, you ask? Because the Native Development Kit (NDK) did not offer a general-purpose stack
walker (narrator: it still does not).

`libunwindstack`, however, is not part of the NDK, but part of the 
[AOSP platform code](https://android.googlesource.com/platform/system/unwinding/) and thus is not directly accessible to 
app developers via the usual means. Sentry forked a repository that patched the platform code to build with the NDK, 
and since then, maintained that fork without any changes in the upstream patched version. This provided
stack tracing capabilities inside the rather complicated ART environment, which has mixed stack-traces between classic
native code, native code that is part of the VM execution, and Java/Kotlin frames that also appear as native frames, 
since they are either interpreted, JITed, or AOTed. 

While this can already be challenging for a normal stack-walker, it is also a problem from the perspective of 
symbolication: there are more OEM builds than Sentry can realistically collect platform binaries from. So, while a 
core set of libraries will likely exist in our backend stores, we cannot rely on them being available. Thus, 
symbolication on Android happens on the client-side.

Considerable restructuring in the platform code, however, made manual upstream alignment very hard over time. In addition 
to that `libunwindstack` is a C++ library, which means, while being light on standard library usage, it still needs to 
be linked against it statically in order to ensure being isolated from ABI-incompatible versions of the standard library.

It also introduced a couple of challenges:

* the biggest issue always was size: since we must package binaries for `x86`, `x86_64`, `armeabi-v7a`, and `arm64-v8a`, 
  we currently add around 1MiB of stripped binary to every app that needs native error reporting or instrumentation. The
  sentry SDK code only accounts for 20% of that size; the rest is `libunwindstack` and the  C++ infra it depends on.
* incomplete implementation: since the library size is already significant, certain features have been excluded from the
  build: there is currently no DEX/OAT symbolication (meaning none of the Java frames are symbolicated), and there is 
  incomplete support for locating DWARF CFI in OAT frames, which often leads to dramatically shortened stack traces in 
  release builds.
* since the `inproc` backend, which handles the crashes on Android, doesn't stop any threads by design, besides the 
  crashing one, it also only provides the stack trace of the crashed thread, which, in particular, on Android is often
  way too little context to uncover the root-cause of a crash

So while all of these are fixable, the effort required is significant and would also lead to a long-term commitment to 
maintain against the moving target that is AOSP. Introducing tombstone support allows us to fix all the issues mentioned,
for users who run on Android 12+, which is a significantly growing portion of the incoming events and user-base (add 
charts here). At the same time, it opens the door to work on better solutions for edge cases.

## What tombstones give us

The problems outlined above: size, incomplete traces, missing Java symbolication, and maintenance burden, all stem from
replicating the platform crash infrastructure that already exists on the device. Tombstones fix each of them:

* **All threads, fully symbolicated.** Where the `inproc` backend could only capture the crashing thread, tombstones 
  provide stack traces and register sets for every thread at the moment of the crash. On Android, the crashing thread is
  often just the victim of a problem that originated in another thread. Seeing all of them is the difference between
  a solvable crash and an enigma.
* **Java/Kotlin frames resolved.** The platform unwinder has full access to ART internals that a forked NDK build cannot
  have. DEX/OAT symbolication, which we deliberately excluded to limit binary size, comes for free.
* **No binary overhead for stack traces.** Tombstones are produced by the platform's own `libunwindstack`, the same 
  library we have been forking and shipping. The ~1MiB binary weight for all supported ABIs drops to zero for apps 
  that rely on tombstones alone.
* **Maintenance shifted to the platform.** We consume structured output instead of tracking AOSP restructuring and 
  keeping a C++ fork buildable against the NDK.
* **Register memory context.** Memory dumps around pointer values in the crashing thread's registers show the data being
  operated on at the point of the crash. (Not yet integrated into the Sentry event payload or UI.)
* Since we now have modules and resolved symbols on the client, we can also strip non-actionable trace contents like 
  runtime-internal frames before sending.

## How to use it

It is available since version `8.30.0` of `sentry-android-core`. So if your app runs on Android 12+, and you enable 
tombstones you will automatically get more complete reports delivered for all native crashes that affect your app. If 
you used Native SDK/NDK integration, you will automatically get better stack traces for all your threads and still see 
the context you created on the native side.

If you have never used the Native SDK interfaces in your native code directly, you can evaluate your options for disabling
the NDK integration. If enough users of an app moved on to Android 12+, there is no further use in running both 
integrations.

If, however, the Native SDK interface is still in direct use, both integrations work together without any visible
degradation in UX.

If you want to turn on the feature, you can do so programmatically via `SentryAndroidOptions`:

```kotlin
SentryAndroid.init(context) { options ->
    options.isTombstoneEnabled = true
}
```

Or declaratively in your `AndroidManifest.xml`:

```xml
<meta-data android:name="io.sentry.tombstone.enable" android:value="true" />
```

!!!Screenshots!!!

## Implementation Challenges

Tombstone support touched on many layers of the SDK because native crash reporting intersects with session management, 
event deduplication, envelope caching, event enrichment, and the existing NDK integration that already handles the same 
class of crashes through a completely different mechanism.

### Sharing Infrastructure with ANR Detection

The most immediate architectural challenge was that the SDK already had an integration consuming `ApplicationExitInfo`: 
the `ANR` integration, which handles `REASON_ANR`. Both integrations need the same lifecycle: query the historical exit 
list, skip already-reported entries, distinguish the latest (enrichable) entry from older (historical) ones, persist a
"last reported" timestamp marker, wait for the previous session to flush, and block until the event is written to disk.

Duplicating this would have been the faster path, but the implementation instead extracted a generic history dispatcher 
parameterized by a policy interface. Each integration implements the policy (target reason, historical flag, report 
builder), while the dispatcher owns traversal, ordering, deduplication, and flush coordination. The envelope cache's 
timestamp marker system was similarly generalized so both ANR and tombstone markers are handled polymorphically.

This refactoring had a cascading consequence for event processing. The existing `ANR` event processor was tightly coupled 
to ANR assumptions and enriched every "backfillable" event (which are events that don't have access to the live scope of
the session they emerge from, but the scope can forensically be reconstructed) as though it were an `ANR`. With tombstones 
now also flowing through as backfillable events, the processor was generalized with an enrichment strategy interface.
`ANR`-specific logic (exception synthesis from textual thread dumps, background/foreground fingerprinting, profile-based
culprit identification) moved into a dedicated enricher. At the same time, the shared path (scope backfilling, options 
backfilling, device/OS context) became the generic default that tombstones are fully served by without needing their 
own enricher.

A considerable part of this new infrastructure can now be reused for other `ApplicationExitInfo` categories, likely even
when the resulting artifacts won't be events (but rather entries in SDK client reports).

### Coexisting with the NDK Integration

The deeper problem was that tombstones and the existing Sentry NDK integration (using 
[`sentry-native-ndk`](https://github.com/getsentry/sentry-native/blob/master/ndk/README.md)) report the same crash. The 
Native SDK catches the signal at runtime via its own signal handler and writes an envelope to the "outbox". The 
tombstone is generated by the platform's `debuggerd`, which is invoked after the Native SDK's signal handler chains to 
the previous handler, but the tombstone only arrives through `ApplicationExitInfo` on the next launch, after the process
has been killed.

If both integrations are active, every native crash produces a duplicate. We need both to get the full picture: the 
richer stack traces, thread coverage, and up-to-date memory maps from the tombstone, combined with user-supplied scope 
data from the Native SDK. So we can't simply turn one off in favor of the other.

Solving this required correlating the two events by timestamp (within a 5-second tolerance) and merging them into one. 
The correlation itself was trivial. The complexity came from the different paths the two events take before they can be 
merged.

The Native SDK serializes envelopes to a shared app directory (the "outbox"), which acts as a signal to the Android SDK 
that an envelope is ready to send. For a native crash, this signal arrives too late to be picked up by the normal outbox
sending infrastructure during the crash. So, on the next start, that infrastructure loads every envelope fully into memory, 
because its sole purpose is to send the next one. If we reused it for merge discovery, we would deserialize every queued
envelope into memory just to find the one native crash event worth merging. On a device that has been offline and 
accumulated envelopes, this means a spike in memory pressure and CPU load for what is almost always a single match.

Instead, a lightweight scan phase streams through each envelope file, parsing only item headers and extracting the 
platform and timestamp fields via streaming JSON, without deserializing the full event. A bounded input stream tracks 
position within each envelope item and skips unread bytes to correctly advance to the next item. Full deserialization 
only happens once a timestamp match is found. The resulting streaming envelope/event parsing infrastructure can likely 
be reused in other parts of the SDK.

The merged event carries a `TombstoneMerged` exception mechanism (alongside the existing `Tombstone` and `signalhandler` 
mechanisms) so the backend, developers, and customers can distinguish provenance.

### Session and `crashedLastRun` Lifecycle

Native crash reporting interacts with session tracking in ways that require careful coordination. When the tombstone 
integration processes a crash, it needs to end the previous session as crashed and set `crashedLastRun` to `true`. But 
the NDK integration has its own mechanism for this: a crash marker file checked by the session finalizer on next launch.

A dedicated marker hint (deliberately distinct from the one used for ANRs) was introduced so that the envelope cache can
recognize tombstone events during session persistence: when it sees the hint, it ends the previous session as crashed 
with the crash timestamp. The session finalizer then detects the already-crashed state and sets `crashedLastRun` 
accordingly, without re-processing the NDK crash marker. Crucially, the native crash marker file is still cleaned up 
regardless of whether the tombstone integration handled the crash. Otherwise, the NDK path would re-report it on every 
subsequent launch.

### The Protobuf Dependency Problem

Android tombstones use a protobuf format defined in AOSP 
([tombstone.proto](https://cs.android.com/android/platform/superproject/main/+/main:system/core/debuggerd/proto/tombstone.proto)). 
The initial implementation used`protobuf-javalite` for decoding, which immediately caused version conflicts for SDK 
consumers already using protobuf (usually via Firebase). Within a month of the initial release, we replaced it with 
`epitaph`, a handwritten decoder for the tombstone protobuf encoding, free of transitive dependencies and weighing 
around 30KiB. We also added a scheduled CI workflow to monitor AOSP for changes to the tombstone protobuf schema, so we 
know early if any consequential format changes land in the platform.

The unifying theme across these challenges is that native crash reporting is not a self-contained feature. It sits at 
the intersection of the SDK's event pipeline, session lifecycle, disk caching, and the existing NDK integration, each of
which had been designed with the assumption that it was the only actor in its domain.

Adding tombstone support meant teaching these components to share: the history dispatcher with `ANR` detection, the 
outbox with the `NDK` integration, the session finalizer with a new crash source, and the event processor with a new 
category of event. We chose refactoring over duplication at each of these intersection points, which made the initial 
PRs larger and the review cycles a bit longer, but left the architecture at least as clean as we found it. Especially 
the common Java SDK core did not see any behavioral changes.

## Wrap-up

Tombstone support closes a gap that has existed since Sentry first shipped native crash reporting on Android: the difference 
between what the platform knows about a crash and what the SDK could tell you. While that gap might seem arbitrary since 
we could replicate parts of the platform's own crash infrastructure inside the app, it only happened by paying the cost 
of binary size, maintenance burden, and still incomplete results. With `ApplicationExitInfo` providing programmatic
access to the same data that `debuggerd` produces, we can now offer richer crash context with less overhead and fewer 
moving parts.

Of course, the limitation is real: this only works on Android 12 and above. For older devices and apps that need 
instrumentation of their native code beyond error reporting, the NDK integration remains available, and the two coexist 
cleanly. But with Android 12+ now representing 75% (according to [apilevels.com](https://apilevels.com/), 03/2026) of 
cumulative usage distribution, the balance has tipped. For most apps, tombstone support is the primary native crash 
reporting path today, and `sentry-native-ndk` is the fallback.
