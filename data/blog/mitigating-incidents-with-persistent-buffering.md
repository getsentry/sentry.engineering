---
title: 'Mitigating Incidents with Persistent Buffering'
date: '2023-06-06'
tags: ['relay', 'infrastructure', 'building-sentry']
draft: false
summary: 'TODO'
images: [/images/mitigating-incidents-with-persistent-buffering/buffer-max-memory.png]
layout: PostLayout
authors: ['oleksandrkylymnychenko']
---

[Relay](https://github.com/getsentry/relay) is a critical piece of infrastructure here at Sentry. It's designed to sit between customer's applications and the rest of our infrastructure, responding quickly to requests, processing outgoing data for things like PII and, in the cases of strictly controlled organizations acting as an opaque proxy that they can run themselves.

![](/images/mitigating-incidents-with-persistent-buffering/relay-infra.png)

From the beginning, Relay was a fully stateless service and kept all the caches and incoming traffic in the server's memory, which helps with performance and also makes sure the service does not require extra local space to function. Everything is good till an incident happens and Relay can't send out data to our inner infrastructure, or if the traffic spikes so hard that the current pool of Relays get overwhelmed and starts dropping incoming [envelopes](https://develop.sentry.dev/sdk/envelopes/). Even with the limits on how many envelopes each Relay can process simultaneously set, the service can still get Out of Memory (OOM) and we could lose everything we had cached so far.

That’s not a nice experience for our customers who can miss critical information about their apps/services/infra which can degrade the user experience overall, especially for the orgs with fewer events.

## Fixing the problem

This is where the "Persistent Buffering" initiative comes in. To make our service more reliable and our customers happier, we introduce a disk spool “state”, which allows Relay to store the data (all the incoming envelopes) to disk, and make sure those won’t get lost. It’s worth mentioning that in normal circumstances we are always using only memory and the new mode activates only when:

- the traffic spikes hard, and the number of incoming envelopes gets too high, creating memory pressure
- an incident occurs somewhere in the backend infra, and Relay can’t fetch the project configurations, which are very important and needed to know how the events must be processed, so it does not know what to do with the envelope
- if an incident happens, and Relay cannot send the processed envelopes out to the backend (e.g. Kafka cluster is down), it keeps them in memory, creating memory pressure again.

## How we built it

[TODO]

## Unexpected testing

We had an opportunity to battle-test the Minimum Viable Product (MVP) with a real incident a couple of weeks ago when the incoming configuration was broken and could not be parsed by Relay, and as a result, the incoming envelopes for the project could not be processed.

Below you can see how the incident was going (red line indicates when the initial incident ended).

And we started to spool data to the disk, which happened in batches of 2GB which were buffered in memory first:

![](/images/mitigating-incidents-with-persistent-buffering/buffer-max-memory.png)

accumulating about ~15GB of data:

![](/images/mitigating-incidents-with-persistent-buffering/buffer-max-disk.png)

The incident lasted for a few hours and once the root cause was found and fixed, Relay was able to recover and un-spool all spooled envelopes and process them in **a matter of minutes**:

![](/images/mitigating-incidents-with-persistent-buffering/time-through-relay.png)

This graph shows that it took up to **3 hours** for us to recover and then **~5 more minutes** to process all the spooled data, **without losing any incoming events**.

The MVP of persistent buffering did great in this unplanned incident testing. Since then, we have also added a few improvements:

- make the unspooling more intelligent so that it won’t create memory pressure again [PR? Code?]
- spool more proactively to avoid, again, memory pressure in the service [PR? Code?]

## Possible future

The initial support for keeping more data in the Relay (right now just in case of an incident) opens quite a few possibilities for use in the future, and all of this without connecting to Sentry to request some additional data:

- what if we could use that data to generate some kind of historical persistent state per organization (or per project), and use it to enhance the user's events, and make more connections between them
- we could also generate a better representation of user's events and provide better insides for sampling those events
- it would be possible to run some analytical functions on the historical state

To be clear, nothing above is in the works yet, and also the state between different Relay replicas is not shared, so some of the things are still limited. But we already have a base we could use to provide a more capable service to support new awesome initiatives.
