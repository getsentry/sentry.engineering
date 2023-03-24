---
title: "Distributed Tracing 101 for Full Stack Developers"
date: '2021-08-12'
tags: ['performance','web','distributed tracing']
draft: false
summary: "In today’s modern web stack it’s anything but. Full stack developers are expected to write JavaScript executing in the browser, interop with multiple database technologies, and deploy server side code on different server architectures (e.g. serverless). Without the right tools, understanding how a user interaction in the browser cascades into a 500 server error deep in your server stack is nigh-impossible. Enter: distributed tracing."
images: []
layout: PostLayout
canonicalUrl: https://blog.sentry.io/2021/08/12/distributed-tracing-101-for-full-stack-developers/
authors: ['benvinegar']
---

In the early days of the web, writing web applications was simple. Developers generated HTML on the server using a language like PHP, communicated with a single relational database like MySQL, and most interactivity was driven by static HTML form components. While debugging tools were primitive, understanding the execution flow of your code was straightforward.

In today’s modern web stack it’s anything but. Full stack developers are expected to write JavaScript executing in the browser, interop with multiple database technologies, and deploy server side code on different server architectures (e.g. serverless). Without the right tools, understanding how a user interaction in the browser cascades into a 500 server error deep in your server stack is nigh-impossible. Enter: distributed tracing.

<p align="center">
  <img src="/images/distributed-tracing-101-for-full-stack-developers/pepesilvia.gif" alt="Tracing meme"/>
  _Me trying to explain a bottleneck in my web stack in 2021._
</p>


*Distributed tracing* is a monitoring technique that links the operations and requests occurring between multiple services. This allows developers to “trace” the path of an end-to-end request as it moves from one service to another, letting them pinpoint errors or performance bottlenecks in individual services that are negatively affecting the overall system.

In this post, we’ll learn more about distributed tracing concepts, go over an end-to-end tracing example in code, and see how to use tracing metadata to add valuable context to your logging and monitoring tools. When we’re done, you’ll not only understand the fundamentals of distributed tracing, but how you can apply tracing techniques to be more effective in debugging your full stack web applications.

But first, let’s go back to the beginning: what’s distributed tracing again?

## Distributed tracing basics
Distributed tracing is a method of recording the connected operations of multiple services. Typically, these operations are initiated by requests from one service to another, where a “request” could be an actual HTTP request, or work invoked through a task queue or some other asynchronous means.

Traces are composed of two fundamental components:

* A **span** describes an operation or “work” taking place on a service. Spans can describe broad operations – for example, the operation of a web server responding to an HTTP request – or as granular as a single invocation of a function.

* A **trace** describes the end-to-end journey of one or more connected **spans**. A trace is considered to be a **distributed trace** if it connects spans (“work”) performed on multiple services.

Let’s take a look at an example of a hypothetical distributed trace.

![Distributed trace](/images/distributed-tracing-101-for-full-stack-developers/distributedtrace.png)

The diagram above illustrates how a trace begins in one service – a React application running on the browser – and continues through a call to an API web server, and even further to a background task worker. The spans in this diagram are the work performed within each service, and each span can be “traced” back to the initial work kicked off by the browser application. Lastly, since these operations occur on different services, this trace is considered to be distributed.

_Aside: Spans that describe broad operations (e.g. the full lifecycle of a web server responding to an HTTP request) are sometimes referred to as **transaction spans** or even just **transactions**._

## Trace and span identifiers
So far we’ve identified the components of a trace, but we haven’t described how those components are linked together.

First, each trace is uniquely identified with a **trace identifier**. This is done by creating a unique randomly generated value (i.e. a UUID) in the **root span** – the initial operation that kicks off the entire trace. In our example above, the root span occurs in the Browser Application.

Second, each span first needs to be uniquely identified. This is similarly done by creating a unique **span identifier** (or `span_id`) when the span begins its operation. This `span_id` creation should occur at every span (or operation) that takes place within a trace.

![Span ID diagram](/images/distributed-tracing-101-for-full-stack-developers/span-id.png)

Let’s revisit our hypothetical trace example. In the diagram above, you’ll notice that a trace identifier uniquely identifies the trace, and each span within that trace also possesses a unique span identifier.

Generating `trace_id` and `span_id` isn’t enough however. To actually connect these services, your application must propagate what’s known as a **trace context** when making a request from one service to another.

## Trace context
The trace context is typically composed of just two values:

* **Trace identifier** (or `trace_id`): the unique identifier that is generated in the root span intended to identify the entirety of the trace. This is the same trace identifier we introduced in the last section; it is propagated unchanged to every downstream service.
* **Parent identifier** (or `parent_id`): the span_id of the “parent” span that spawned the current operation.

The diagram below visualizes how a request kicked off in one service propagates the trace context to the next service downstream. You’ll notice that trace_id remains constant, while the parent_id changes between requests, pointing to the parent span that kicked off the latest operation.

![Distributed trace example](/images/distributed-tracing-101-for-full-stack-developers/distributed-trace-example.png)

With these two values, for any given operation, it is possible to determine the originating (root) service, and to reconstruct all parent/ancestor services in order that led to the current operation.

## A working example with code
To understand this all better, let’s actually implement a bare-bones tracing implementation, using the example we’ve been returning to, wherein a browser application is the initiator of a series of distributed operations connected by a trace context.

First, the browser application renders a form: for the purposes of this example, an “invite user” form. The form has a submit event handler, which fires when the form is submitted. Let’s consider this submit handler our root span, which means that when the handler is invoked, both a `trace_id` and `span_id` are generated.

Next, some work is done to gather user-inputted values from the form, then finally a `fetch` request is made to our web server to the `/inviteUser` API endpoint. As part of this fetch request, the trace context is passed as two custom HTTP headers: `trace-id` and `parent-id` (which is the current span’s `span_id`).

```js
// browser app (JavaScript)
import uuid from 'uuid';

const traceId = uuid.v4();
const spanId = uuid.v4();

console.log('Initiate inviteUser POST request', `traceId: ${traceId}`);

fetch('/api/v1/inviteUser?email=' + encodeURIComponent(email), {
   method: 'POST',
   headers: {
       'trace-id': traceId,
       'parent-id': spanId,
   }
}).then((data) => {
   console.log('Success!');
}).catch((err) => {
   console.log('Something bad happened', `traceId: ${traceId}`);
});
```

_Note these are non-standard HTTP headers used for explanatory purposes. There is an active effort to standardize tracing HTTP headers as part of the W3C [traceparent](https://www.w3.org/TR/trace-context/) specification, which is still in the “Recommendation” phase._

On the receiving end, the API web server handles the request and extracts the tracing metadata from the HTTP request. It then queues up a job to send an email to the user, and attaches the tracing context as part of a “meta” field in the job description. Last, it returns a response with a 200 status code indicating that the method was successful.

Note that while the server returned a successful response, the actual “work” isn’t done until the background task worker picks up the newly queued job and actually delivers an email.

At some point, the queue processor begins working on the queued email job. Again, the trace and parent identifiers are extracted, just as they were earlier in the web server.

```js
// API Web Server
const Queue = require('bull');
const emailQueue = new Queue('email');
const uuid = require('uuid');

app.post("/api/v1/inviteUser", (req, res) => {
  const spanId = uuid.v4(),
    traceId = req.headers["trace-id"],
    parentId = req.headers["parent-id"];

  console.log(
    "Adding job to email queue",
    `[traceId: ${traceId},`,
    `parentId: ${parentId},`,
    `spanId: ${spanId}]`
  );

  emailQueue.add({
    title: "Welcome to our product",
    to: req.params.email,
    meta: {
      traceId: traceId,

      // the downstream span's parent_id is this span's span_id
      parentId: spanId,
    },
  });

  res.status(200).send("ok");
});

// Background Task Worker
emailQueue.process((job, done) => {
  const spanId = uuid.v4();
  const { traceId, parentId } = job.data.meta;

  console.log(
    "Sending email",
    `[traceId: ${traceId},`,
    `parentId: ${parentId},`,
    `spanId: ${spanId}]`
  );

  // actually send the email
  // ...

  done();
});
```

_If you’re interested in running this example yourself, you can find the source code on [GitHub](https://github.com/getsentry/distributed-tracing-examples)._

## Logging with distributed systems
You’ll notice that at every stage of our example, a logging call is made using console.log that additionally emits the current **trace**, **span**, and **parent** identifiers. In a perfect synchronous world – one where each service could log to the same centralized logging tool – each of these logging statements would appear sequentially:

![Log of a distributed trace](/images/distributed-tracing-101-for-full-stack-developers/log.png)

If an exception or errant behavior occurred during the course of these operations, it would be relatively trivial to use these or additional logging statements to pinpoint a source. But the unfortunate reality is that these are distributed services, which means:

* **Web servers typically handle many concurrent requests**. The web server may be performing work (and emitting logging statements) attributed to other requests.
* **Network latency can cloud the order of operations**. Requests made from upstream services might not reach their destination in the same order they were fired.
* **Background workers may have queued jobs**. Workers may have to first work through earlier queued jobs before reaching the exact job queued up in this trace.

In a more realistic example, our logging calls might look something like this, which reflects multiple operations occurring concurrently:

![Realistic log of a distributed trace](/images/distributed-tracing-101-for-full-stack-developers/realistic-log.png)

Without tracing metadata, understanding the topology of which action invoked which action would be impossible. But by emitting tracing meta information at every logging call, it’s possible to quickly filter on all logging calls within a trace by filtering on `traceId`, and to reconstruct the exact order by examining `spanId` and `parentId` relationships.

This is the power of distributed tracing: by attaching metadata describing the current operation (span id), the parent operation that spawned it (parent id), and the trace identifier (trace id), we can augment logging and telemetry data to better understand the exact sequence of events occurring in your distributed services.

## Tracing in the real world
Over the course of this article, we have been working with a somewhat contrived example. In a real distributed tracing environment, you wouldn’t generate and pass all your span and tracing identifiers manually. Nor would you rely on `console.log` (or other logging) calls to emit your tracing metadata yourself. You would use proper tracing libraries to handle the instrumentation and emitting of tracing data for you.

## OpenTelemetry
[OpenTelemetry](https://opentelemetry.io/) is a collection of open source tools, APIs, and SDKs for instrumenting, generating, and exporting telemetry data from running software. It provides language-specific implementations for most popular programming languages, including both browser [JavaScript and Node.js](https://github.com/open-telemetry/opentelemetry-js).

## Sentry

[Sentry](https://sentry.io/) is an open source application monitoring product that helps you identify errors and performance bottlenecks in your code. It provides client libraries in every major programming language which instrument your software’s code to capture both error data and tracing telemetry.

Sentry uses this telemetry in a number of ways. For example, Sentry’s [Performance Monitoring](https://sentry.io/for/performance/) feature set uses tracing data to generate waterfall diagrams that illustrate the end-to-end latency of your distributed services’ operations within a trace.

![Sentry Distributed Trace](/images/distributed-tracing-101-for-full-stack-developers/sentry-distributed-trace.png)

Sentry additionally uses tracing metadata to augment its Error Monitoring capabilities to understand how an error triggered in one service (e.g. server backend) can propagate to an error in another service (e.g. frontend).

You can learn more about [Sentry and distributed tracing here](https://sentry.io/features/distributed-tracing/).