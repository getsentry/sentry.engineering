---
title: 'Should you, could you AOT?'
date: '2024-01-16'
tags: ['native', 'aot', '.net', 'sdk', 'building sentry']
summary: 'How ASP.NET Core application developers can make the transition from JIT (Just-in-Time) to AOT (Ahead-of-Time) compilation, using the Sentry SDK for .NET as a case study.'
images: [/images/should-you-could-you-aot/hero.jpeg]
layout: PostLayout
authors: ['jamescrosswell']
---

## What is AOT?

.NET developers have long been accustomed to JIT (Just-in-Time) compilation. This is where our applications are compiled to intermediate language (IL) bytecode that is only, at runtime, converted to the specific machine code instructions required to execute the program on a specific machine.

However with the release of .NET 8.0 it's now possible to build ASP.NET Core applications that are compiled and built AOT (Ahead-of-Time) into native machine code that can execute on a machine that does not have the .NET runtime installed (like an application written in C or Rust).

## Should you compile AOT?

The main benefit of AOT is that it allows for [faster startup times and reduced memory and disk usage](https://learn.microsoft.com/en-us/aspnet/core/fundamentals/native-aot?view=aspnetcore-8.0#why-use-native-aot-with-aspnet-core).

Why would we care about these things in ASP.NET Core however? If your web api/application runs as a single instance that can run days without restarting, then there may be no benefits to AOT compilation. However, if your application is a short-lived service that is frequently restarted (such as a serverless function or a cron job) then AOT starts to get really interesting.

For ASP.NET Core apps, this might be the case if you have a scaling policy that scales the number of instances of your application based on demand. In this case, the faster startup times and reduced memory and disk usage of AOT can translate into both a reduced operational cost and a better experience for your users, which is why there has been a lot of excitement around AOT in recent years.

## Could you compile AOT?

If the benefits of AOT are clear and compelling, the next question is whether you can use AOT. The following [ASP.NET Core features don't yet work with AOT in .NET 8.0](https://learn.microsoft.com/en-us/aspnet/core/fundamentals/native-aot?view=aspnetcore-8.0#aspnet-core-and-native-aot-compatibility):

- MVC
- Blazor Server
- SignalR
- Anything authentication other than JWT
- Session
- Spa

If none of those are deal breakers then that's a good start!

However there are some more fundamental [limitations of Native AOT deployment](https://learn.microsoft.com/en-us/dotnet/core/deploying/native-aot/?tabs=net8plus%2Cwindows#limitations-of-native-aot-deployment) that you should also understand before publishing your ASP.NET Core application using AOT compilation. It's important to understand these for two reasons:

1. The _code you write_ must respect these constraints to be AOT compatible
2. You will need to ensure that _any dependencies you use_ are also AOT compatible

The good news is that the version 4.0 beta of the Sentry SDK for .NET is AOT compatible, with a GA release happening very soon, so you can use Sentry for crash reporting and application performance monitoring in your next AOT compiled ASP.NET Core application without worry!

Moreover, a lot of work went into making this possible and, as a large open source repository, the journey of making the Sentry .NET SDK AOT compatible is a great case study for the kinds of issues you might encounter and how to overcome these when making your own transition from JIT to AOT.

The rest of this post looks at some of the main challenges we faced, how we overcame these and links to specific commits in the Sentry repository with code level implementation detail, in case you want to go deep.

# Case Study: Making Sentry AOT compatible

## Trimming 101

A prerequisite to understanding what follows is understanding trimming. If you already know what trimming is and how it relates to AOT, you can skip this section... for everyone else however, here's a high level crash course in trimming.

Traditionally `dotnet build` compiles your code into intermediate language (IL) bytecode. Later, when it's run with `dotnet run` the .NET Runtime converts that IL into machine code instructions that can be executed by the specific hardware where the runtime is being hosted.

If we want to instead compile the application Ahead-of-Time (AOT), one naive way to do this would be to take all of the IL that forms the application, plus all of the code that forms the .NET Runtime and compile it into some machine code for a particular target architecture (e.g. macOS on Arm64). However, if we did that, the resulting binary for even the simplest "Hello World" application would be absolutely huge, as it would need to include the entire .NET Runtime.

For Native AOT compilation to be practical then, the compiler needs to be able to work out which parts of .NET your application is using and which it is not, so that only the relevant code gets compiled into the resulting executable... This process of getting rid of any extraneous cruft is known as Trimming.

Trimming is relatively straight forward if your application doesn't use reflection. However, reflection allows us to dynamically execute code at runtime in ways that cannot be anticipated when the application is being compiled… and there's no way to reliably trim that kind of code. To make your solution AOT compatible then, you either have to get rid of such dynamic code or give the compiler enough additional context that it can properly deal with it.

Almost all of the difficulties we encountered in making the Sentry SDK AOT compatible were related to trimming and reflection. Since Sentry is a crash reporting and performance monitoring solution, we had some additional issues related to native debug images. However those won't be a concern for most applications, so we won't cover them in this blog post.

## Initial investigation

To get a sense for the problems we had to solve, we started by enabling the [AOT Compatibility Analyzers](https://learn.microsoft.com/en-us/dotnet/core/deploying/native-aot/?tabs=net8plus%2Cwindows#aot-compatibility-analyzers) for our solution. Once you switch these on, you'll get warnings for any code that isn't compatible with AOT compilation. If you don't receive any warnings when building your application after enabling the analyzers, you're good to go!

In our case, we were certainly not good to go... we had hundreds of warnings. Luckily, many of the warnings were related so really there were only a handful of big problems we had to solve:

1. Serialization
2. Configuration Bindings
3. Dependencies on libraries that aren't AOT compatible
4. Miscellaneous uses of reflection

## Serialization

At a high level, serialization is about taking a data structure and converting it into some bytes for storage or transmission... later deserialization is about converting those bytes back into the original data structure.

For years, the .NET community has relied on [Newtonsoft.Json](https://www.newtonsoft.com/json) to solve this. It's a great library that allows you to serialize and deserialize almost any data structure you can imagine. However, it relies heavily on reflection and it's not AOT compatible.

When compiling AOT then you'll need to use [System.Text.Json](https://learn.microsoft.com/en-us/dotnet/standard/serialization/system-text-json/source-generation?pivots=dotnet-8-0), which relies on source code generators instead of reflection. The methods in `System.Text.Json` commonly accept a `JsonSerializerContext`, which can be used to tell the serializer how to handle specific types (and also not to trim those types).

You can see an example of a [custom JsonSerializerContext that we created for the Sentry SDK here](https://github.com/getsentry/sentry-dotnet/blob/75843685494d04e0e955e2e48b40ca93d61aa8f6/src/Sentry/Internal/Extensions/JsonExtensions.cs#L888-L893):

```csharp
[JsonSerializable(typeof(GrowableArray<int>))]
[JsonSerializable(typeof(Dictionary<string, bool>))]
[JsonSerializable(typeof(Dictionary<string, object>))]
internal partial class SentryJsonContext : JsonSerializerContext
{
}
```

This custom context ensures that when we compile the Sentry SDK to a Nuget package, the compiler knows not to trim the `GrowableArray<int>`, `Dictionary<string, bool>` or `Dictionary<string, object>` types that we know get serialized by the Sentry SDK.

Not everything that is possible with Newtonsoft.Json is possible with System.Text.Json however.

For example, the Sentry SDK includes something called `Contexts` that gets sent with events such as crash reports through to the Sentry backend. It's [possible for users to add their own custom context](https://github.com/getsentry/sentry-dotnet/blob/a34e9844228142bd59f4d454f669207fa9b472cc/src/Sentry/Contexts.cs#L207-L208) as a `KeyValuePair<string, object>` and we have no idea what types they might supply as custom context. As such, we had to give users a way to supply their own `SentryJsonContext` for any custom types that they might be sending with Sentry events.

We expose the capability to do this as a [method in the SentryOptions](https://github.com/getsentry/sentry-dotnet/blob/0fde2e34300a961fd62fcfd77614ec51b11275e3/src/Sentry/SentryOptions.cs#L1067-L1077) that get used when [initializing the Sentry SDK](https://docs.sentry.io/platforms/dotnet/guides/aspnetcore/#initialize). Under the hood we simply pass that custom `JsonSerializerContext` on to `System.Text.Json` during serialization:

```csharp
public void AddJsonSerializerContext<T>(Func<JsonSerializerOptions, T> contextBuilder)
   where T : JsonSerializerContext
{
   // protect against null because user may not have nullability annotations enabled
   if (contextBuilder == null!)
   {
       throw new ArgumentNullException(nameof(contextBuilder));
   }

   JsonExtensions.AddJsonSerializerContext(contextBuilder);
}
```

That won't work 100% of the time (for example users can't supply a type as custom context that they didn't anticipate sending before compiling their applications) but it works in most cases.

## Configuration Bindings

The Sentry SDK for .NET supports the [Options Pattern](https://learn.microsoft.com/en-us/aspnet/core/fundamentals/configuration/options?view=aspnetcore-8.0) and allows you to bind settings to the `SentryOptions` from various sources (an appsettings.json file, environment variables, command line parameters etc.).

Version 3.x of the Sentry SDK relied on `ConfigureFromConfigurationOptions<T>` to enable this. However, the implementation for that class relies ultimately on [code which is not AOT compatible](https://github.com/dotnet/runtime/blob/6f9d6569684cc17015aa6fc5f9d9a5f7580ade97/src/libraries/Microsoft.Extensions.Configuration.Binder/src/ConfigurationBinder.cs#L285-L292).

AOT compiled applications can use [Configuration Binding Source Generators](https://learn.microsoft.com/en-us/dotnet/core/whats-new/dotnet-8#configuration-binding-source-generator) instead. For relatively simple configuration settings, this should work out of the box without too much trouble.

In our case, this wasn't so straightforward. After switching to the new configuration binding source generators, we were getting [SYSLIB1100 and SYSLIB1101 warnings](https://learn.microsoft.com/en-us/dotnet/fundamentals/syslib-diagnostics/syslib1100-1118) from the compiler because the [SentryOptions](https://github.com/getsentry/sentry-dotnet/blob/0fde2e34300a961fd62fcfd77614ec51b11275e3/src/Sentry/SentryOptions.cs) class that is used to configure the Sentry SDK has a number of properties that the Binding Configuration Source Generators aren't able to handle.

- Some of the properties aren't designed to be bound from configuration files - they're only supposed to be set programmatically.
- Others are designed to be bound but they're complex types that the Binding Configuration Source Generators don't know how to handle.

There are probably a number of different solutions to that problem. The solution that we landed on was to create a much simpler BindableSentryOptions class that is used for the purposes of Binding and then copy the values across from that class to our actual options class once binding completes.

If you're interested, there's a bit more detail on this and some sample code in [Pull Request #2823](https://github.com/getsentry/sentry-dotnet/pull/2823) in the sentry-dotnet repository.

## Dependencies on libraries that aren't AOT compatible

Since Sentry is an SDK, we've generally kept dependencies for the solution to a minimum and where we do have dependencies, we maintain the source code for these as GIT submodules within our solution (so that users of our SDK don't need to know about it).

The main one we struggled with was [Ben.Demystifier by Ben Adams](https://github.com/benaadams/Ben.Demystifier). This is a library that we use to create enhanced stack traces for the crash reports collected by Sentry. It's a great library but unfortunately it relies heavily on reflection and it's not AOT compatible.

The solution was two-fold:

1. Conditionally execute the code that uses Ben.Demystifier only when we know the application is running in JIT mode.
2. Suppress the AOT Compatibility Analyzers for the code that uses Ben.Demystifier with an explanation that the code never gets executed in AOT compiled applications

You can see an example of both of those things in [this code](https://github.com/getsentry/sentry-dotnet/blob/e64acac42f33c2a632361f7e6ebdb7a75afd56c2/src/Sentry/Internal/DebugStackTrace.cs#L161-L166):

```csharp
[UnconditionalSuppressMessage("Trimming", "IL2026:Members annotated with 'RequiresUnreferencedCodeAttribute' require dynamic access otherwise can break functionality when trimming application code", Justification = AotHelper.SuppressionJustification)]
private IEnumerable<SentryStackFrame> CreateFrames(StackTrace stackTrace, bool isCurrentStackTrace)
{
    var frames = (!AotHelper.IsNativeAot && _options.StackTraceMode == StackTraceMode.Enhanced)
        ? EnhancedStackTrace.GetFrames(stackTrace).Select(p => new RealStackFrame(p))
        : stackTrace.GetFrames().Select(p => new RealStackFrame(p));
```

Firstly, the `AotHelper.IsNativeAot` property is used to determine whether the application is running in JIT or AOT mode (and thus whether or not we can generate an Enhanced stack trace).

That on its own would not be enough however. Ordinarily the existence of the call to `EnhancedStackTrace.GetFrames` in the codebase would be flagged by the AOT Compatibility Analyzers as a problem. As such, we've also suppressed that warning with the `UnconditionalSuppressMessage` attribute along with a justification.

## Miscellaneous uses of Reflection

Finally, we had some random uses of reflection in our code.

Oftentimes, source code generators can be used instead of reflection. This is exactly what Microsoft have done to create AOT compatibile solutions for serialization and configuration binding. However, in some cases that's not possible.

One such case that we ran into is a block of code in the Sentry SDK that uses reflection to set `Microsoft.UI.Xaml.Application.Current.UnhandledException` to Sentry's `WinUIUnhandledExceptionHandler`. The reason we use reflection for this is that this code runs in our core Sentry SDK and we don't want that SDK to take a dependency on `Microsoft.UI.Xaml` (a dependency that is only relevant for WinUI applications).

One possible solution would be to move the code to a new/separate Sentry.UI.Xaml Nuget package and set the property via plain old assignment (rather than reflection). That way the code could be compiled AOT.

Of course, that's a very specific solution to a very specific problem. It's hard to offer generic advice for how to deal with dynamically generated code in your applications as the solution will depend on the purpose of the dynamic code… so this is one area where you'll have to bring your own context and creativity to the table.

# Conclusion

Compiling your ASP.NET Core applications AOT can yield faster startup times, reduced memory usage and reduced disk footprint. However you may need to change how your application handles serialization, configuration bindings, dependencies on external libraries, and the use of reflection in order to realize those benefits. That sounds like a lot - to get basic AOT compilation going [for the Sentry .NET SDK we had to change about 800 lines of code](https://github.com/getsentry/sentry-dotnet/pull/2732), so it wasn't too bad (given the size of that repository).

Hopefully this article has given you a sense for the kinds of challenges you might encounter when using AOT compilation in your ASP.NET Core applications and how you can overcome them.

If you're interested in learning more about AOT compilation in .NET, I'd recommend checking out the following resources:

- [The minimal API AOT compilation template](https://andrewlock.net/exploring-the-dotnet-8-preview-the-minimal-api-aot-template/)
- [Intro to Trim warnings](https://learn.microsoft.com/en-us/dotnet/core/deploying/trimming/fixing-warnings)
- [Intro to AOT warnings](https://learn.microsoft.com/en-us/dotnet/core/deploying/native-aot/fixing-warnings)
- [Creating a SourceGenerator](https://andrewlock.net/series/creating-a-source-generator/)
- [System.Text.Json source generators](https://devblogs.microsoft.com/dotnet/try-the-new-system-text-json-source-generator/)
- [Packaging Generators in Libraries](https://github.com/dotnet/roslyn/blob/main/docs/features/source-generators.cookbook.md#package-a-generator-as-a-nuget-package)
- [The new configuration binder source generator](https://andrewlock.net/exploring-the-dotnet-8-preview-using-the-new-configuration-binder-source-generator/)

Finally, we’d love to hear how you use Sentry in your own AOT compiled ASP.NET Core applications. [Start a discussion](https://github.com/getsentry/sentry-dotnet/discussions) to let us know or [raise a ticket](https://github.com/getsentry/sentry-dotnet/issues) on our repo with any questions!
