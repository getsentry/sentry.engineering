---
title: 'Into the async void...'
date: '2024-05-27'
tags: ['async', 'void', '.net', 'sdk', 'building sentry']
summary: 'Explores how Sentry can be used to safely run async void methods within your applications'
images: [/images/into-the-async-void/hero.png]
layout: PostLayout
authors: ['jamescrosswell']
---

The Task Parallel Library (TPL) in .NET includes various constructs that let you run code asynchronously (and sometimes in parallel). The most common way to leverage these is by Tasks that you then await using the `async` and `await` keywords.

For example:

```csharp
async Task AsyncTask() => await Task.Delay(200);
await AsyncTask();
```

Typically when we write asynchronous methods, these return either `Task` (as shown above) or `Task<T>`. The only other thing that can be returned from an async method is `void`... and although the Best Practices in Asynchronous Programming strongly [discourage async void](https://learn.microsoft.com/en-us/archive/msdn-magazine/2013/march/async-await-best-practices-in-asynchronous-programming#avoid-async-void) methods, there is one situation in which they are unavoidable: when running async code from UI event handlers.

## Running asynchronous code from event handlers

Consider, for example, the following `OnClick` event handler:

```csharp
    private void OnButtonClicked(object sender, EventArgs e)
    {
        var client = new HttpClient();
        try
        {
            // client.GetAsync("https://localhost/api/foo");
        }
        catch (Exception exception)
        {
            Debug.LogWarning(ex, "Error fetching data");
        }

    }
```

We'd like to call our API method from this event handler. The `HttpClient` class that we're using for this doesn't have any `Get` method - only a `GetAsync` method.

Out of the box, there are only really two ways to do this.

### 1. Make a blocking call

We can use something like `.GetAwaiter().GetResult()` to force the method to run synchronously:

```csharp
    private void OnButtonClicked(object sender, EventArgs e)
    {
        var client = new HttpClient();
        try
        {
            client.GetAsync("https://localhost/api/foo").GetAwaiter().GetResult();
        }
        catch (Exception exception)
        {
            Debug.LogWarning(ex, "Error fetching data");
        }
    }
```

This works. The API gets called and any exceptions get caught by the `try..catch`. **_However_**, this is a [blocking call](https://docs.sentry.io/platforms/dotnet/guides/aspnetcore/#captureblockingcalls) so it will freeze your UI thread.

### 2. Make the event handler async void

The alternative is to use the standard `async` and `await` syntax. To do that, we have to make the event handler `async void` 😬

```csharp
    private async void OnButtonClicked(object sender, EventArgs e)
    {
        var client = new HttpClient();
        try
        {
            await client.GetAsync("foo");
        }
        catch (Exception exception)
        {
            Debug.LogWarning(ex, "Error fetching data");
        }
    }
```

This will compile and run. However if the async method that we're calling throws an exception for any reason, the exception handler will be ignored and the application will crash. Normally when awaiting `async` methods, if an exception occurs this gets stored on the `Task` before executing the completion. However an async void method has no `Task` to return and so the TPL throws the exception on the default `SynchronizationContext` instead, which crashes the application.

## SentrySdk.RunAsyncVoid

Neither of the above options is satisfactory. One blocks the UI thread and the other can crash our application 😱.

However, we recently added the `SentrySdk.RunAsyncVoid` helper method to the Sentry SDK for .NET, which allows you to run async void code both safely and without blocking the UI thread.

Here's an example of how to use it:

```csharp
    private void OnButtonClicked(object sender, EventArgs e)
    {
        var client = new HttpClient();

        // You can use RunAsyncVoid to call async methods safely from within MAUI event handlers.
        SentrySdk.RunAsyncVoid(
            async () => await client.GetAsync("foo"),
            ex => Debug.LogWarning(ex, "Error fetching data")
        );

        // This is an example of the same, omitting any exception handler callback. In this case, the default exception
        // handler will be used, which simply captures any exceptions and sends these to Sentry
        SentrySdk.RunAsyncVoid(async () => await client.GetAsync("foo"));
    }
```

You can see there are two overloads of the method: one that accepts an exception handler callback method that you can use to customize what happens when an exception occurs and another that simply captures any exceptions and sends these to Sentry.

### How does it work?

If all you want to do is run async methods safely from within your UI event handlers, then that's all you need to know... move on - nothing more to see here.

For the curious, however, all of Sentry's SDKs are open source so it's pretty easy to delve into [the implementation](https://github.com/getsentry/sentry-dotnet/blob/28bd2a88b2dcc24ed288d4a862a6808c6ac4bfbc/src/Sentry/SentrySdk.cs#L695-L711).

```csharp
    public static void RunAsyncVoid(Action task, Action<Exception>? handler = null)
    {
        var syncCtx = SynchronizationContext.Current;
        try
        {
            handler ??= DefaultExceptionHandler;
            SynchronizationContext.SetSynchronizationContext(new ExceptionHandlingSynchronizationContext(handler, syncCtx));
            task();
        }
        finally
        {
            SynchronizationContext.SetSynchronizationContext(syncCtx);
        }
        return;

        void DefaultExceptionHandler(Exception ex) => CaptureException(ex);
    }
```

The extension method itself is extremely simple. It saves off the current `SynchronizationContext`, sets up an `ExceptionHandlingSynchronizationContext` (which prevents the TPL from posting exceptions back to the main UI thread), runs your code (handling any exceptions) and then restores the original `SynchronizationContext`.

The `ExceptionHandlingSynchronizationContext` is where all of the magic happens:

```csharp
internal class ExceptionHandlingSynchronizationContext(Action<Exception> exceptionHandler, SynchronizationContext? innerContext)
    : SynchronizationContext
{
    public override void Post(SendOrPostCallback d, object? state)
    {
        if (state is ExceptionDispatchInfo exceptionInfo)
        {
            exceptionHandler(exceptionInfo.SourceException);
            return;
        }
        if (innerContext != null)
        {
            innerContext.Post(d, state);
            return;
        }
        base.Post(d, state);
    }
}
```

Again, this is crazy simple. It just overrides `SynchronizationContext.Post`, intercepting any Exceptions that are being dispatched to ensure these get handled by the Exception handler that was provided, rather than being posted back to the default `SynchronizationContext`. Anything else simply gets handled by either the innerContext (if this class is being used in a Wrapper pattern) or by the `SynchronizationContext` base class.

Full disclosure, I stole this code from myself 😜... I was originally mucking around with this in my spare time but it seemed like a shame not to include it in the Sentry SDK so that more people could benefit from it. If you're interested in a more detailed explanation of how the above code works then there's a deep dive at [https://www.jamescrosswell.dev/posts/catching-async-void-exceptions/](https://www.jamescrosswell.dev/posts/catching-async-void-exceptions/).

## Summary

Dealing with exceptions in async void methods has always been particularly tricky in .NET and developers have typically had to choose between a set of bad options: freeze the UI, swallow exceptions or risk crashing the app! `SentrySdk.RunAsyncVoid` lets you build UI event handlers that run asynchronous code without having to chose between responsiveness and stability - capturing exceptions in these methods and handling them the same way you would elsewhere in your codebase.
