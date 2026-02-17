---
title: 'Do you really need an MCP to build your app?'
date: '2026-02-18'
tags: ['ios', 'ai', 'mcp']
draft: false
summary: 'Do you really need an MCP to build your app? Surprisingly, modern agents succeed either way, the real difference is how much time, cost, and context you waste along the path.'
images: []
layout: PostLayout
canonicalUrl: do-you-really-need-an-mcp-to-build-your-app
authors: [cameroncooke]
---

Sentry recently [acquired **XcodeBuildMCP**](https://blog.sentry.io/sentry-acquires-xcodebuildmcp/), the Model Context Protocol server I created to help AI agents navigate iOS development. When I joined, my boss asked an uncomfortable question: is an MCP still really necessary?

We're engineers, building developer tools for engineers so we needed to answer the question empirically. We set out to test the hypothesis that an MCP was still necessary to build an app with an agent.

We expected XcodeBuildMCP to dominate on success rate. We were wrong.

**All three approaches we tested hit 99%+ success.** Modern models recover from errors so well that task completion has become table stakes. The real differentiator was something we didn't anticipate: time, cost, and a problem we're calling the Context Paradox.

## The Context Paradox

MCP tools inject schemas, descriptions, and boilerplate into context before the agent does anything. That's useful for tool access, but context isn't free.

Context is a budget. Tool schemas spend it up front; trial-and-error spends it later. The paradox is that you can waste it either way, and the results show which spend pays off.

So which matters more: structured tool access, or leaner context? We ran 1,350 trials (450 per scenario) to find out.

## The Experiment

We tested three approaches across 5 tasks: a smoke test (build, install, launch) and 4 coding exercises (fix tests, implement caching, refactor an API, add a deep-link feature).

1. **Shell (Unprimed):** No MCP tools. No help. The agent discovers scheme and simulator by running arbitrary commands.
2. **Shell (Primed):** No MCP tools, but we gave the agent an `AGENTS.md` with the exact scheme, simulator destination, and project path.
3. **MCP (Unprimed):** No AGENTS.md, but the agent has access to XcodeBuildMCP's full tool suite.

Our hypothesis: XcodeBuildMCP would win on success rate, primed shell would win on cost, and unprimed shell would struggle.

## Methodology

- 3 agents (claude-opus, claude-sonnet, codex) × 5 tasks × 3 scenarios × 30 trials = 1,350 runs (9 baseline runs excluded from aggregates).
- Success rate is per-run.
- Time is median wall-clock seconds.
- Tokens (avg) = uncached input + cached read + output (excludes cache writes).
- Cost/Trial uses the cold-equivalent median (cached reads treated as uncached).
- "Real tool errors" exclude XcodeBuildMCP session_defaults discovery, sibling-cascade errors, and build/test failures reported through tools; averaged per run.

## Results

| Metric                       | Shell (Unprimed) | Shell (Primed)   | MCP (Unprimed) |
| :--------------------------- | :--------------- | :--------------- | :------------- |
| **Task Success Rate**        | 99.78%           | 99.56%           | 99.78%         |
| **Median Time**              | 185s             | **123s** (−34%)  | 133s (−28%)    |
| **Tokens (avg)**             | 400K             | **341K** (−15%)  | 702K (+75%)    |
| **Cost/Trial (cold median)** | $1.12            | **$0.98** (−13%) | $2.30 (+105%)  |
| **Real Tool Errors (avg)**   | 1.04             | **0.32** (−70%)  | 0.56 (−47%)    |

_Cost/Trial uses cold-equivalent median cost (cached reads treated as uncached). In this run, cache read rates averaged ~91% for shell and ~96% for XcodeBuildMCP, so billed cost is substantially lower than cold. Percentages are relative to Shell (Unprimed). Most readers use subscription-based agents, so token counts may be more relevant than dollar figures._

The success rates tell one story: **modern agents are resilient.** But the time and cost columns tell another. Let's unpack what's actually happening.

## Finding 1: Priming Minimizes Context, Maximizes Speed

If you can tell the agent exactly what to run, that's the fastest and cheapest path. Primed shell completed 34% faster than unprimed shell, used 15% fewer tokens, and had 70% fewer real tool errors.

This makes sense through the lens of the Context Paradox. Priming adds _minimal, targeted_ context: just the build command. No schema overhead, no tool descriptions, no decision fatigue. The agent knows exactly what to do and does it.

**Takeaway:** For projects with stable build configurations, create an `AGENTS.md` with your exact commands. Don't pay for discovery you don't need.

## Finding 2: XcodeBuildMCP Breaks the Discovery Loop

Without priming, shell agents spend early turns on discovery. A real unprimed run (paths shortened) looks like this:

```
xcodebuild test -scheme "Hacker News" -destination 'platform=iOS Simulator,name=iPhone 16,OS=18.2' ...
xcodebuild: error: The project named "HackerNews" does not contain a scheme named "Hacker News".
xcodebuild -list
xcodebuild test -scheme HackerNews -destination 'platform=iOS Simulator,name=iPhone 16,OS=18.2' ...
xcodebuild: error: Unable to find a device matching the provided destination specifier.
xcodebuild test -scheme HackerNews -destination 'platform=iOS Simulator,id=E3BD65D4-6AFC-48FA-9AF3-FE4D1EAE19DA' ...
```

That’s the churn: wrong scheme, wrong simulator, extra discovery, and retries. Multiply this pattern a few times and you get the variance we saw: unprimed shell averaged **2.56 xcodebuild calls per trial** vs **1.25 for primed**.

XcodeBuildMCP short-circuits that guesswork _and_ nudges the agent toward the next correct action. Tools don’t just return data; they include **actionable hints** (“Next Steps”) that steer the agent away from bad guesses. Representative excerpt (paths shortened):

```
TOOL_CALL mcp__XcodeBuildMCP-Dev__list_schemes {}
TOOL_RESULT ✅ Available schemes: HackerNews, ...
Next Steps:
1. Build the app: build_sim({ scheme: "HackerNews", simulatorName: "iPhone 16" })
2. Show build settings: show_build_settings({ scheme: "HackerNews" })
```

Result: **28% faster median time** than unprimed shell, and p90 dropped about **20%**. This is the Context Paradox working in MCP's favor: yes, it adds tool schema overhead, but it _removes_ the trial-and-error cycles that bloat context with failed attempts and diagnostic output.

## Finding 3: The Truncation Problem

A single `xcodebuild` call in our test project regularly exceeded agent truncation limits. Representative excerpt from a real run (paths shortened):

```
Output too large (1.2MB). Full output saved to: .../tool-results/toolu_01BVbVcVHRR7QLzTiqqcz6Gv.txt
TOOL_CALL Bash {"command": "tail -100 /tmp/test_output.txt | grep -A 5 -B 5 \"Test Suite\\|passed\\|failed\""}
```

In this run, **49.6% of shell-unprimed** and **56.9% of shell-primed** trials hit truncation, and the median saved log was **~1.2MB**. When this happens, the agent sees only a truncated preview. It typically runs `tail` to check the result, potentially **missing critical warnings that appeared earlier in the log**. A build might "succeed" while emitting warnings about deprecated APIs or missing entitlements that the agent never sees.

XcodeBuildMCP solves this. XcodeBuildMCP's `build_sim` tool filters output, returning only warnings, errors, and status. The median XcodeBuildMCP build result here is **~2.1KB**, a **99.8% reduction** versus the median truncated shell log.

Representative XcodeBuildMCP build output (paths shortened):

```
⚠️ Warning: ld: warning: search path '.../Frameworks/Reaper.xcframework' not found
⚠️ Warning: warning: The CFBundleShortVersionString of an app extension ('1.0') must match that of its containing parent app ('3.10').
✅ iOS Simulator Build build succeeded for scheme HackerNews.
```

This is the Context Paradox in its clearest form: XcodeBuildMCP adds tool schema overhead upfront, but it _removes_ orders of magnitude of noise from tool outputs. The result isn’t fewer total tokens, XcodeBuildMCP still uses more, but a much higher signal‑to‑noise ratio in the build/test output the agent actually has to reason about.

## Tool Errors: Recovery, Not Failure

In this run, 688/1,350 runs (51.0%) hit at least one tool error. But here's the thing: they almost never caused task failures.

The nuance is that **raw tool error counts can be misleading in XcodeBuildMCP**: the XcodeBuildMCP workflow intentionally surfaces a "missing session defaults" error the first time an agent discovers the correct setup call, and downstream failures often cascade from a single root error. In the table below, **"real" tool errors exclude expected discovery errors**:

- expected XcodeBuildMCP discovery/setup errors
- build/test failures that tools correctly reported (not tool malfunctions)

| Scenario         | Raw Tool Errors (avg) | Real Tool Errors (avg) |
| :--------------- | :-------------------: | :--------------------: |
| Shell (Unprimed) |         1.04          |          1.04          |
| Shell (Primed)   |         0.32          |          0.32          |
| MCP (Unprimed)   |         1.20          |          0.56          |

Models treated errors as _information_. They read the error, adjusted, and moved on. XcodeBuildMCP makes this easier with structured messages explaining what went wrong, often suggesting a fix.

## What You Should Do

**For routine builds on known projects:** Use priming. Create an `AGENTS.md` with your exact build parameters:

```markdown
# Build Instructions

## iOS Build

- Project: `HackerNews.xcodeproj`
- Scheme: `HackerNews`
- Destination: `platform=iOS Simulator,name=iPhone 17 Pro`

Run: `xcodebuild -project HackerNews.xcodeproj -scheme HackerNews -destination 'platform=iOS Simulator,name=iPhone 17 Pro' build`
```

This is the fastest, cheapest approach for happy-path builds.

**For discovery and complex workflows:** Enable XcodeBuildMCP by adding the following to your `AGENTS.md`:

```json
{
  "mcpServers": {
    "XcodeBuildMCP": {
      "command": "npx",
      "args": ["-y", "xcodebuildmcp@latest"]
    }
  }
}
```

Use XcodeBuildMCP when:

- You want discovery to "just work" without maintaining AGENTS.md files
- Build output might exceed truncation limits (in this run, ~50–57% of shell trials did)
- You need workflows that shell commands can't reach: interactive debugging (LLDB, breakpoints, variable inspection), log capture and analysis, UI automation and screenshot capture

## Caveats

These results open questions worth investigating:

- **Session length effects.** Tool definitions are reinforced every turn; priming tokens may suffer from attention decay in longer sessions. XcodeBuildMCP's relative value likely increases as sessions grow.
- **Cache effects on cost.** In this run, cache read rates averaged ~91% for shell and ~96% for XcodeBuildMCP, so billed cost is substantially lower than the cold numbers suggest.
- **Complex debugging workflows.** We tested builds and refactors, not multi-hour debugging sessions. XcodeBuildMCP's value likely increases for workflows that require its unique capabilities like debugging and UI automation.

We also ran a smaller follow-up on an unreleased XcodeBuildMCP v2 to reduce XcodeBuildMCP's context overhead; see the update at the end.

## The Bottom Line

The Context Paradox isn't about choosing less context or more tools. It's about choosing the _right_ context for the task at hand.

For routine builds, **priming wins**. Put your build command in a markdown file and save your tokens.

For discovery and complex workflows, **XcodeBuildMCP wins**. It breaks the guessing loop, guarantees the agent sees all diagnostics, and exposes capabilities that shell commands can't reach.

Modern agents are resilient enough to recover from almost anything. The question isn't whether they'll succeed, but how much time and money you'll spend getting there.

## Update: XcodeBuildMCP v2

After writing this post, we tested an improved (unreleased) XcodeBuildMCP v2 using the same harness and tasks (15 trials per task per agent; n=225). Because v2 isn't shipped yet, **it's not included in the headline analysis above**—but it's useful as a directional check on whether we can pay down XcodeBuildMCP's context tax without giving up the "break the guessing loop" benefits.

| Metric (MCP Unprimed)    | v1 (Released) | v2 (Preview) | Change |
| :----------------------- | :-----------: | :----------: | :----: |
| Median time              |     133s      |     147s     |  +11%  |
| Tokens (avg)             |     702K      |     453K     |  −35%  |
| Cost/Trial (cold median) |     $2.30     |    $1.27     |  −45%  |
| Real tool errors (avg)   |     0.56      |     0.49     |  −12%  |

At a high level: v2 **cuts most of the MCP token/cost overhead**, and it trends toward **fewer real tool errors** while being a bit slower in median wall-clock time in this run. If these deltas hold up at larger sample sizes, the core conclusion stays the same (priming is best when you already know the right command), but MCP becomes much more competitive on cost for discovery-heavy workflows.

---

_The v1 dataset (1,350 runs) and evaluation harness are available on [GitHub](https://github.com/cameroncooke/mcp_evals); the v2 preview adds 225 runs in the same repo._
