---
title: 'Shipping Features Without Writing Code'
date: '2025-07-02'
tags: ['pr-comments', 'ai']
draft: false
summary: "How Cursor's background agent added C# support to Sentry with minimal prompting."
images: [/images/shipping-features-without-writing-code/hero.jpg]
layout: PostLayout
canonicalUrl: shipping-features-without-writing-code
authors: ['rajjoshi']
---

I've been riding the AI-assisted coding wave since the early days of Copilot in VS Code. Like many developers, I've jumped between tools — Cursor, Claude Code, Windsurf—always chasing that perfect developer experience. I have really felt my productivity increase as the "tab" models get substantively better.

But if I'm being honest, I've struggled to find compelling use cases for background agents. Most of the time, I'd spend more energy crafting the perfect prompt than I would have just using tab completion or just doing it myself. I remember trying to "vibe code" something, getting frustrated by the lack of progress due to bugs and ended up reverting everything and starting fresh with my own approach. The overhead of context-setting and prompt refinement often felt like more work than the actual task.

That changed recently when Sentry got access to Cursor's background agents, and I finally found a use case that made me think "okay, this is actually useful."

## Open PR Comments

For one of my first projects at Sentry, I was tasked with adding additional language support to our [Open PR Comments feature](https://sentry.engineering/blog/how-open-pr-comments-work). This feature works by parsing Git hunk headers using regex to extract function names and to notify developers for existing bugs in areas of the code they are modifying.

The existing implementation supported Python and TypeScript, and I was tasked with adding support for Ruby and PHP. But here's the thing—I had never written a single line of PHP or Ruby before this. The whole process was pretty tedious, involving lots of Stack Overflow searches, language documentation deep-dives, and trial-and-error with regex patterns.

The feature had gained significant traction, and there was an active [GitHub issue](https://github.com/getsentry/sentry/issues/69824) for additional language support with C# as one of the top requests. But the overhead for the background research was always deprioritized.

Fast forward to few weeks ago - when Sentry got access to Cursor Background agents, I thought that this seems like exactly the kind of isolated, well-defined task that a background agent might actually be good at. I had already refactored the code to be more modular, and implementing a new regex parser felt like something an agent could handle without getting lost in the weeds.

## Prompting

Here's where it gets interesting. Frankly, I was a bit skeptical and didn’t think it would really do much. I didn't overthink it. No elaborate prompt engineering, no detailed specifications. I just told the background agent:

![Original Prompt](/images/shipping-features-without-writing-code/original-prompt.png)

That's it. Two sentences and a link to a PR I had landed over a year ago.

The agent picked up the files it needed to change, understood the pattern from the existing Ruby implementation, and actually made reasonable changes. It added a new `CSharpParser` class, implemented the regex patterns for C# method signatures, and even added tests.

![Initial Agent Response](/images/shipping-features-without-writing-code/initial-agent-response.png)

But I wasn't done yet. I wanted to see how far I could push it, so I asked it to add a feature flag to control the rollout. Again, minimal prompting—and it delivered. The agent understood the existing feature flag patterns in the codebase and implemented everything correctly.

![Followup Prompt](/images/shipping-features-without-writing-code/followup.png)

## It works!

After the agent finished its work, I did what any reasonable developer would do—I wrote additional tests for my own sanity and thoroughly reviewed the implementation. And honestly? It worked. The C# parser correctly identified most method signatures, handled edge cases, and followed the established patterns in the codebase.

The whole experience was surprisingly smooth. I went from knowing zero C# to having a working, tested implementation without diving into C# documentation or wrestling with regex syntax.

I was honestly amazing and excited!:

![Final Agent Response](/images/shipping-features-without-writing-code/result.png)

## Where Background Agents Actually Shine

This experience crystallized something for me about the current state of background agents. They're not going to replace thoughtful software design or complex problem-solving anytime soon. But for isolated, well-scoped tasks—especially ones involving pattern matching or extending existing functionality—they can be genuinely helpful.

The key factors that made this work:

1. **Well-defined scope**: Add language support following an existing pattern
2. **Clear reference implementation**: The Ruby parser provided a template
3. **Isolated functionality**: The changes didn't touch core business logic
4. **Existing test infrastructure**: The agent could follow established testing patterns

I think background agents currently have power for engineers and non-technical folks alike to tackle smaller-scale problems—documentation updates, configuration changes, etc. They're particularly valuable when you're working outside your expertise area, like I was with C#.

## The Bottom Line

Will I start using background agents for everything? Probably not. But this experience showed me there's real value in reaching for them when you have the right type of problem: isolated, pattern-based, and well-scoped.

The fact that I could go from zero C# knowledge to a working implementation with minimal effort is pretty compelling. It's not magic, and it still requires review and testing, but it's a genuine productivity boost for the right use cases.

_Here’s the PR if you are curious: https://github.com/getsentry/sentry/pull/93304_
