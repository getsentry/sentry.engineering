---
title: "Relay as a Lambda Extension Using the Actor Model in Rust"
date: "2022-09-22"
tags: ["rust", "relay", "infrastructure"]
draft: false
summary: Relay is an open source project by Sentry that receives data from Sentry SDKs for pre-processing. We wanted to make Relay behave like an AWS Lambda Extension moving our service closer to your code, and decreasing the latency of your Lambda functions. In this blog post, I’ll share how we used the actor model to set up Relay to behave like a Lambda Extension.
images: []
postLayout: PostLayout
canonicalUrl: https://blog.sentry.io/2022/09/22/relay-as-a-lambda-extension-using-the-actor-model-in-rust/
authors: ["antonpirker"]
---

Relay is an open source project by Sentry that receives data from Sentry SDKs for pre-processing. This is done before the data is sent to an upstream Relay server or ingested and stored in the Sentry infrastructure. tl;dr - Relay is the first service to receive and handle your error and performance data from the installed Sentry SDK.

We wanted to make Relay behave like an AWS Lambda Extension moving our service closer to your code, and decreasing the latency of your Lambda functions. In this blog post, I’ll share how we used the actor model to set up Relay to behave like a Lambda Extension.

## What is Relay?

[Relay](https://docs.sentry.io/product/relay/) is a service written in Rust that pushes some functionality from the Sentry SDKs as well as the Sentry server into a proxy process. Basically, it’s a middle layer between your code and Sentry.

Relay talks to Sentry SDKs, other Relays, or the Sentry server using HTTP. Sentry runs Relays to receive data from all the Sentry SDKs out there. _If you want to know more about our data ingestion pipeline, check out our [How We Built a Distributed Ingestion Infrastructure](/blog/sentry-points-of-presence-how-we-built-a-distributed-ingestion) blog post._

Relay makes extensive use of the actor model to process data. It can run actors for storing, forwarding, processing, or caching data. Relay uses the [Actix Framework](https://actix.rs/) and its [Arbiter Class](https://actix.rs/book/actix/sec-5-arbiter.html) to run actors in its own thread.

## What is the Actor Model?

An actor, in the actor model, is the fundamental unit of computation. It has its own private internal state and is only allowed to do three operations:

- Create another actor
- Send a message
- Decide how to handle the next message it receives (based on its own private state)

The actor model is built for scale, so it’s useful when programming in large, distributed, asynchronous systems. Since Sentry is processing millions of events and transactions a day and needs to scale out and in fast, we use the actor model for Relay.

If you want a deep dive into the actor model, checkout out this [blog post and video](https://finematics.com/actor-model-explained/) from the creator of the actor model.

Because Relay uses this model, it was easy to implement the Sentry Lambda extension right inside Relay. By setting a config option, Relay can become a Lambda extension by simply running a new actor we implemented.

## What do Lambda Extensions do?

A Lambda Extension is bundled with your Lambda function and will be automatically launched by the Lambda Environment. The Lambda Extension runs in the same runtime environment as your Lambda functions.

When starting up the Lambda Extension, it first needs to register itself with the Lambda Extensions API and subsequently can receive lifecycle events from your Lambda functions and the Lambda execution environment. See the Lambda Extensions API documentation for more details. It basically boils down to:

- An HTTP request to `/register` and then
- A request to `/next` (which is a blocking HTTP request) in an infinite loop to receive lifecycle events from your Lambda functions.
- When the `SHUTDOWN` signal from the AWS service is received: exit.

## Implementing the Lambda Extension

Now that we know the actor model, and what Lambda Extension and Relay is, it’s time to build! Before we dive into the code, here’s an overview of how we’ll setup the Lambda Extension:

- First we implement an actor called `AwsExtension` that calls the `/register` endpoint on startup and if successful, sends a `NextEvent` message to itself.
- Upon receiving a NextEvent message the actor calls the `/next` endpoint to the next event with information about one Lambda function invocation.
- If the event is an `INVOKE` event, the actor processes the received data and sends a `NextEvent` message to itself to form a loop. If the event received is a `SHUTDOWN` event the actor exits.

For brevity and readability, the code was stripped down to the bare minimum.

First, we set some constants and create an error type for our extension.

```rust
const EXTENSION_NAME: &str = "sentry-lambda-extension";
const EXTENSION_NAME_HEADER: &str = "Lambda-Extension-Name";
const EXTENSION_ID_HEADER: &str = "Lambda-Extension-Identifier";
const AWS_LAMBDA_RUNTIME_API: &str = "..."; /// Needs to be read from the
                            /// environment variable with
                            /// the same name
pub struct AwsExtensionError(());
```

We define the responses that the `/next` endpoint of the Lambda Extensions API can return. For easy and efficient serializing and de-serializing we use [Serde](https://serde.rs/).

```rust
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct InvokeResponse {
    /// Unique request identifier.
    pub request_id: String,
    /// ...
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ShutdownResponse {
    /// The reason for the shutdown.
    pub shutdown_reason: String,
    /// ...
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "UPPERCASE", tag = "eventType")]
pub enum NextEventResponse {
    /// `INVOKE` response.
    Invoke(InvokeResponse),
    /// `SHUTDOWN` response.
    Shutdown(ShutdownResponse),
}
```

Now we define our extension type.

```rust
pub struct AwsExtension {
    /// The base url for the AWS Extensions API.
    base_url: Url,
    /// The extension id that will be retrieved on register
    /// and used for subsequent requests.
    extension_id: Option<String>,

    /// ...
}
```

In the implementation of the type, we add two methods, `register`, and `next_event`. This is the part where the actual Lambda Extension logic is done.

```rust
impl AwsExtension {
    /// Creates a new `AwsExtension` instance.
    pub fn new(aws_runtime_api: &str) -> Result<Self, AwsExtensionError> {
        /// Base URL of Lambda Extensions API
        let base_url = format!("http://{}/2020-01-01/extension", AWS_LAMBDA_RUNTIME_API)
            .parse()
            .map_err(|_| AwsExtensionError(()))?;
        /// For making HTTP requests.
        let reqwest_client = reqwest::Client::new();
    }

    fn register(&mut self, context: &mut Context<Self>) {
        /// Register as an Lambda Extension
        let url = format!("{}/register", self.base_url);
        let body = HashMap::from([("events", ["INVOKE", "SHUTDOWN"])]);

        let res = self
            .reqwest_client
            .post(&url)
            .header(EXTENSION_NAME_HEADER, EXTENSION_NAME)
            .json(&body)
            .send()?;

        /// ... save extension_id from res ...
        self.extension_id = ...

        /// Send NextEvent message
        context.notify(NextEvent);
    }

    fn next_event(&self, context: &mut Context<Self>) {
        let extension_id = self.extension_id.as_ref().unwrap();
        let url = format!("{}/event/next", self.base_url);

        /// Call `/event/next` and give extension ID in header
        let json = self
            .reqwest_client
            .get(&url)
            .header(EXTENSION_ID_HEADER, extension_id)
            .send()?
            .json::<NextEventResponse>()
            .await;

        match json {
            NextEventResponse::Invoke(invoke_response) => {
                /// process data received
                /// ...

                /// Send NextEvent message
                ctx.notify(NextEvent);
            }
            NextEventResponse::Shutdown(shutdown_response) => {
                /// Exit (`Controller` and `Signal` is from relay)
                Controller::from_registry().do_send(Signal(SignalType::Term));
            }
        }
    }
}
```

Now we implement the `Actor` trait for our `AwsExtension` type. Calling the `register` method on the actor’s startup, starting our extension’s lifecycle.

```rust
impl Actor for AwsExtension {
    type Context = Context<Self>;

    fn started(&mut self, context: &mut Self::Context) {
        self.register(context);
    }

    fn stopped(&mut self, _context: &mut Self::Context) {
    }
}
```

Actors talk to each other using messages, so we need to define our `NextEvent` message. This is the only message we send, and the actor sends it to itself.

```rust
struct NextEvent;

impl Message for NextEvent {
    type Result = ();
}
```

And finally, we implement a handler for the message which calls the `next_event()` method of our `AwsExtension` upon receiving a `NextEvent` message.

```rust
impl Handler<NextEvent> for AwsExtension {
    type Result = ();

    fn handle(&mut self, _message: NextEvent, context: &mut Self::Context) -> Self::Result {
        self.next_event(context);
    }
}
```

And voila, you have a Lambda Extension implemented in Rust using the actor model.

To start your actor and therefore start the lifecycle of your Lambda Extension we use the Arbiter of the Actix Framework. We start it in a separate `Arbiter` which will start the actor in its own thread, thus not interfering with the rest of Relay’s existing functionality.

```rust
use actix::prelude::*;
use aws_extension::AwsExtension;

if let Ok(aws_extension) = AwsExtension::new() {
    Arbiter::start(|_| aws_extension);
}

```

## Compiling Rust for AWS Lambda

Relay is built for Intel-based Linux systems. The minimum target system of Relay is CentOS 7. This works for AWS Lambda out of the box. If you want to know more about how we compile Relay have a look at the [Dockerfile](https://github.com/getsentry/relay/blob/master/Dockerfile) we use for compilation.

You can find details about the full Lambda Extension on Github [here](https://github.com/getsentry/relay/tree/master/relay-aws-extension), and the Relay source code [here](https://github.com/getsentry/relay/blob/master/relay-server/src/service.rs#L146-L151).

## Summary

We extended Sentry Relay so it can be used as an AWS extension. Relay is built to be extended, so the change was easy to implement and the Relay actor-based architecture makes sure that this change scales with your project. With this, we have now a good foundation for additional features we want to implement for better catering to our Serverless users.

Additionally, we want to use the same approach to use Relay as a sidecar for other platforms, bringing features to them that would not be possible without Relay. Through the AWS Lambda extension, we learned a lot that we can now apply to the sidecar approach.
