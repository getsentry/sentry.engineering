---
title: 'Do you need an MCP to build your native app?'
date: '2026-02-18'
tags: ['ios', 'ai', 'mcp']
draft: false
summary: 'Do you need an MCP to build your native app? Surprisingly, modern agents succeed either way. The real difference is how much time, cost, and context you waste along the way.'
images: [/images/do-you-really-need-an-mcp-to-build-your-app/hero.png]
layout: PostLayout
canonicalUrl:
authors: [cameroncooke]
---

We recently [announced](https://blog.sentry.io/sentry-acquires-xcodebuildmcp) that Sentry acquired [XcodeBuildMCP](https://www.xcodebuildmcp.com/), the Model Context Protocol server I built to help AI agents navigate iOS development. One of the first questions we were asked was an uncomfortable one: is an MCP actually necessary? We're engineers building developer tools for engineers, so we did what felt natural and set out to answer it empirically.

We built and ran an eval that measured three LLMs, against three approaches, each tasked with five different coding exercises totaling 1,350 trials to find out. **We expected XcodeBuildMCP to dominate, but it didn't.**

**All three approaches we tested hit 99%+ success.** Modern models recover from errors well enough that finishing the task is basically guaranteed. What surprised us was where the real differences showed up: time, cost, and how each approach spends its context budget.

## The Context Paradox

MCP tools inject schemas, descriptions, and boilerplate into context before the agent does anything. That's useful for tool access, but context isn't free.

Context is a budget. MCP tool schemas spend it up front; when agents don't have the right information, they spend it later on failed commands and retries. The question is which spend actually pays off.

## The Experiment

As mentioned above we tested three approaches across five tasks: a smoke test (build, install, launch) and 4 coding exercises (fix tests, implement caching, refactor an API, add a deep-link feature).

1. **Shell (Unprimed):** No MCP tools, no guidance. The agent discovers scheme and simulator by running arbitrary commands.
2. **Shell (Primed):** No MCP tools, but we gave the agent an `AGENTS.md` with the exact scheme, simulator destination, and project path.
3. **MCP (Unprimed):** No `AGENTS.md`, but the agent has access to XcodeBuildMCP's full tool suite.

## Methodology

- 3 models (claude-opus, claude-sonnet, codex) × 5 tasks × 3 scenarios × 30 trials = 1,350 runs (9 baseline runs excluded from aggregates).
- Success rate is per-run.
- Time is median wall-clock seconds.
- Tokens (avg) = uncached input + cached read + output (excludes cache writes).
- Cost/Trial uses the cold-equivalent median (cached reads treated as uncached).
- "Real tool errors" exclude XcodeBuildMCP session_defaults discovery, sibling-cascade errors, and build/test failures reported through tools; averaged per run.

## Results

| Metric                       | Shell (Unprimed)  | Shell (Primed)        | MCP (Unprimed)    |
| :--------------------------- | :---------------- | :-------------------- | :---------------- |
| **Task Success Rate**        | 99.78% (+0.22 pp) | **99.56% (baseline)** | 99.78% (+0.22 pp) |
| **Median Time**              | 185s (+50%)       | **123s (baseline)**   | 133s (+8%)        |
| **Tokens (avg)**             | 400K (+17%)       | **341K (baseline)**   | 702K (+106%)      |
| **Cost/Trial (cold median)** | $1.12 (+14%)      | **$0.98 (baseline)**  | $2.30 (+135%)     |
| **Real Tool Errors (avg)**   | 1.04 (+225%)      | **0.32 (baseline)**   | 0.56 (+75%)       |

_Cost/Trial uses cold-equivalent median cost (cached reads treated as uncached). In this run, cache read rates averaged ~91% for shell and ~96% for XcodeBuildMCP, so billed cost is substantially lower than cold. Percentages are relative to Shell (Primed); Task Success Rate uses percentage-point (pp) deltas. Most readers use subscription-based agents, so token counts may be more relevant than dollar figures._

Success rates are nearly identical across all three. The story is in the time and cost columns.

## A Markdown File Beat Everything on Cost

As expected, the cheapest and fastest approach wasn't an MCP. It was a text file with four lines of build instructions. Primed shell finished 34% faster than unprimed shell, used 15% fewer tokens, and had 70% fewer real tool errors.

Why? Minimal, targeted context. Just the build command: no schema overhead, no tool descriptions, no discovery cycles. The agent knows exactly what to run and runs it.

For projects with stable build configurations, an `AGENTS.md` with your exact commands is the most direct path. Don't pay for discovery you don't need.

## XcodeBuildMCP Cuts the Build Configuration Guesswork

Building an iOS app with an agent requires getting three things right before a single line compiles: the project path, the scheme name, and a valid simulator destination. These aren't guessable. A project named "HackerNews" might have a scheme called "HackerNews", "Hacker News", or something else entirely. Simulators are identified by name, OS version, or UUID. Without guidance, the agent has to figure all of this out by running commands and reading error output.

Without priming, shell agents spend early turns doing exactly that. A real unprimed run looks like this:

```
xcodebuild test -scheme "Hacker News" -destination 'platform=iOS Simulator,name=iPhone 16,OS=18.2' ...
xcodebuild: error: The project named "HackerNews" does not contain a scheme named "Hacker News".
xcodebuild -list
xcodebuild test -scheme HackerNews -destination 'platform=iOS Simulator,name=iPhone 16,OS=18.2' ...
xcodebuild: error: Unable to find a device matching the provided destination specifier.
xcodebuild test -scheme HackerNews -destination 'platform=iOS Simulator,id=E3BD65D4-6AFC-48FA-9AF3-FE4D1EAE19DA' ...
```

Wrong scheme, wrong simulator, extra discovery, retries. Unprimed shell averaged **2.56 xcodebuild calls per trial** versus **1.25 for primed**.

XcodeBuildMCP eliminates that guesswork. Its tools don't just return data; they include actionable hints that steer the agent toward the correct next call:

```
TOOL_CALL mcp__XcodeBuildMCP-Dev__list_schemes {}
TOOL_RESULT ✅ Available schemes: HackerNews, ...
Next Steps:
1. Build the app: build_sim({ scheme: "HackerNews", simulatorName: "iPhone 16" })
2. Show build settings: show_build_settings({ scheme: "HackerNews" })
```

Result: **28% faster median time** than unprimed shell, and p90 dropped about **20%**. The tool schema overhead is real, but it removes the failed-command cycles that bloat context with error output and retries. Context spent on the right thing is cheaper than context spent recovering from the wrong thing.

## The Truncation Problem Is Worse Than It Looks

A single `xcodebuild` call in our test project regularly exceeded agent truncation limits:

```
Output too large (1.2MB). Full output saved to: .../tool-results/toolu_01BVbVcVHRR7QLzTiqqcz6Gv.txt
TOOL_CALL Bash {"command": "tail -100 /tmp/test_output.txt | grep -A 5 -B 5 \"Test Suite\\|passed\\|failed\""}
```

**49.6% of shell-unprimed** and **56.9% of shell-primed** trials hit truncation, with a median saved log of **~1.2MB**. When that happens, the agent typically runs `tail` to check the result, which means it may miss critical warnings that appeared earlier in the log. A build that "succeeded" could be emitting warnings about deprecated APIs or missing entitlements that the agent never sees.

XcodeBuildMCP's `build_sim` tool filters output, returning only warnings, errors, and status. The median build result is **~2.1KB**, a **99.8% reduction** versus the median truncated shell log:

```
⚠️ Warning: ld: warning: search path '.../Frameworks/Reaper.xcframework' not found
⚠️ Warning: warning: The CFBundleShortVersionString of an app extension ('1.0') must match that of its containing parent app ('3.10').
✅ iOS Simulator Build build succeeded for scheme HackerNews.
```

XcodeBuildMCP uses 75% more tokens than unprimed shell overall, but the composition matters. Shell agents spend a large portion of their context budget on truncated multi-megabyte build logs and diagnostic retries. XcodeBuildMCP's tokens are nearly all structured, actionable data: warnings, errors, status messages, and next-step hints. The raw token count is higher; the noise is substantially lower.

## Tool Errors: Almost Never the Problem

688 of 1,350 runs (51%) hit at least one tool error. Almost none caused task failures. Models read the error, adjusted, and moved on.

One nuance worth calling out: raw tool error counts are misleading for XcodeBuildMCP. The workflow intentionally surfaces a "missing session defaults" error the first time an agent discovers the correct setup call, and downstream failures often cascade from a single root error. The table below excludes those expected discovery errors and correctly-reported build/test failures:

| Scenario         | Raw Tool Errors (avg) | Real Tool Errors (avg) |
| :--------------- | :-------------------: | :--------------------: |
| Shell (Unprimed) |         1.04          |          1.04          |
| Shell (Primed)   |         0.32          |          0.32          |
| MCP (Unprimed)   |         1.20          |          0.56          |

XcodeBuildMCP makes recovery easier with structured error messages that often suggest the fix directly. But modern models are good enough at recovery that errors alone are rarely the bottleneck.

## Putting It All Together

The eval answers the question it set out to answer: for simple, well-scoped coding tasks, all three approaches finish successfully. A primed `AGENTS.md` is the fastest and cheapest path; XcodeBuildMCP costs more up front but removes the discovery friction that bloat unprimed runs.

What the eval couldn't measure is where XcodeBuildMCP's real ceiling is. The tasks were self-contained enough that the agent never needed to _see_ the running app. But XcodeBuildMCP isn't just a build wrapper, it gives agents a closed loop: capture a screenshot, inspect the view hierarchy, tap a button, set a breakpoint, read the console. That's a qualitatively different capability from anything a simple shell command can provide, and it's the one that matters for complex, multi-turn agentic workflows.

The honest takeaway is that finishing a task and _knowing_ you finished it correctly are different things. For the former, a AGENTS.md file is enough. For the latter, verifying UI state, catching a regression in a live session, debugging a crash the agent just triggered, you need runtime access. That's the gap the eval didn't measure, and the gap XcodeBuildMCP is designed to close.

## So What Should You Actually Do?

**For routine builds on known projects** where you only need your agent to build and install the app, creating an `AGENTS.md` with your exact build parameters is sufficient:

```markdown
# Build Instructions

## iOS Build

- Project: `HackerNews.xcodeproj`
- Scheme: `HackerNews`
- Destination: `platform=iOS Simulator,name=iPhone 17 Pro`

Run: `xcodebuild -project HackerNews.xcodeproj -scheme HackerNews -destination 'platform=iOS Simulator,name=iPhone 17 Pro' build`
```

Fastest, cheapest, no overhead.

**For a fully closed loop system:** Enable XcodeBuildMCP, your agent will be able to work autonomously and inspect and verify its own work as well as debug issues that arise:

```json
{
  "mcpServers": {
    "XcodeBuildMCP": {
      "command": "npx",
      "args": ["-y", "xcodebuildmcp@latest", "mcp"]
    }
  }
}
```

## XcodeBuildMCP v2

After we ran this eval we identified many areas of improvement for XcodeBuildMCP that we hoped would close the gap between the primed shell and XcodeBuildMCP. This actually turned out to be one of the most helpful uses of the eval, we had data and visibility we didn't have before. We made many improvements, reducing tool schema descriptions, only enabling simulator workflow by default, added stateful session support where XcodeBuildMCP remembers your project configuration, removing the need for the tools to include configuration parameters and reducing tool call overhead and much more.

We tested a pre-release version of XcodeBuildMCP v2 using the same harness and tasks (15 trials per task per agent; n=225). Because v2 wasn't shipped at time of writing, **it's not included in the headline analysis above**, but it's useful as a directional check on whether we can reduce XcodeBuildMCP's context overhead without losing the discovery benefits.

| Metric                       | Shell (Unprimed)  | Shell (Primed)        | MCP v1 (Unprimed) | MCP v2 (Unprimed)  |
| :--------------------------- | :---------------- | :-------------------- | :---------------- | :----------------- |
| **Task Success Rate**        | 99.78% (+0.22 pp) | **99.56% (baseline)** | 99.78% (+0.22 pp) | 100.00% (+0.44 pp) |
| **Median Time**              | 185s (+50%)       | **123s (baseline)**   | 133s (+8%)        | 147s (+20%)        |
| **Tokens (avg)**             | 400K (+17%)       | **341K (baseline)**   | 702K (+106%)      | 453K (+33%)        |
| **Cost/Trial (cold median)** | $1.12 (+14%)      | **$0.98 (baseline)**  | $2.30 (+135%)     | $1.27 (+30%)       |
| **Real Tool Errors (avg)**   | 1.04 (+225%)      | **0.32 (baseline)**   | 0.56 (+75%)       | 0.49 (+53%)        |

v2 cuts most of the token and cost overhead, trends toward fewer real tool errors, although in this run it is a bit slower in median wall-clock time. If these deltas hold at larger sample sizes, the core conclusion stays the same, but MCP becomes much more competitive on cost for discovery-heavy workflows.

XcodeBuildMCP 2.x is now available with further optimizations to reduce context overhead and improve reliability. It introduces a CLI mode and Agent Skills that let your agent use XcodeBuildMCP without the upfront token cost mentioned above. For details, see the [changelog](https://github.com/getsentry/XcodeBuildMCP/blob/main/CHANGELOG.md).

---

_The v1 dataset (1,350 runs) and evaluation harness are available on [GitHub](https://github.com/getsentry/xcodebuildmcp_eval); the v2 preview adds 225 runs in the same repo._
