---
title: 'Do you really need an MCP to build your app?'
date: '2026-02-18'
tags: ['ios', 'ai', 'mcp']
draft: false
summary: 'Do you really need an MCP to build your app? Surprisingly, modern agents succeed either way. The real difference is how much time, cost, and context you waste along the path.'
images: [/images/do-you-really-need-an-mcp-to-build-your-app/hero.png]
layout: PostLayout
canonicalUrl:
authors: [cameroncooke]
---

I'd spent about a year building XcodeBuildMCP. A few weeks after Sentry acquired it, my manager asked whether it was still necessary.

That's not a comfortable question when you built the thing. But we're engineers building developer tools for engineers, so we didn't just debate it. We ran an experiment.

We expected XcodeBuildMCP to dominate. We were wrong, or at least not in the way we expected.

**All three approaches we tested hit 99%+ success.** Modern models recover from errors well enough that finishing the task is basically guaranteed. What surprised us was where the real differences showed up: time, cost, and how each approach spends its context budget.

## The Context Paradox

MCP tools inject schemas, descriptions, and boilerplate into context before the agent does anything. That's useful for tool access, but context isn't free.

Context is a budget. MCP tool schemas spend it up front; when agents don't have the right information, they spend it later on failed commands and retries. The question is which spend actually pays off.

So we ran an eval across 1,350 trials to find out.

## The Experiment

We tested three approaches across 5 tasks: a smoke test (build, install, launch) and 4 coding exercises (fix tests, implement caching, refactor an API, add a deep-link feature).

1. **Shell (Unprimed):** No MCP tools, no guidance. The agent discovers scheme and simulator by running arbitrary commands.
2. **Shell (Primed):** No MCP tools, but we gave the agent an `AGENTS.md` with the exact scheme, simulator destination, and project path.
3. **MCP (Unprimed):** No `AGENTS.md`, but the agent has access to XcodeBuildMCP's full tool suite.

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

Success rates are nearly identical across all three. The story is in the time and cost columns.

## A markdown file beat everything on cost

As expected, the cheapest and fastest approach wasn't an MCP. It was a text file with four lines of build instructions. Primed shell finished 34% faster than unprimed shell, used 15% fewer tokens, and had 70% fewer real tool errors.

Why? Minimal, targeted context. Just the build command: no schema overhead, no tool descriptions, no discovery cycles. The agent knows exactly what to run and runs it.

For projects with stable build configurations, an `AGENTS.md` with your exact commands is the most direct path. Don't pay for discovery you don't need.

## XcodeBuildMCP cuts the build configuration guesswork

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

## The truncation problem is worse than it looks

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

## Tool errors: almost never the problem

688 of 1,350 runs (51%) hit at least one tool error. Almost none caused task failures. Models read the error, adjusted, and moved on.

One nuance worth calling out: raw tool error counts are misleading for XcodeBuildMCP. The workflow intentionally surfaces a "missing session defaults" error the first time an agent discovers the correct setup call, and downstream failures often cascade from a single root error. The table below excludes those expected discovery errors and correctly-reported build/test failures:

| Scenario         | Raw Tool Errors (avg) | Real Tool Errors (avg) |
| :--------------- | :-------------------: | :--------------------: |
| Shell (Unprimed) |         1.04          |          1.04          |
| Shell (Primed)   |         0.32          |          0.32          |
| MCP (Unprimed)   |         1.20          |          0.56          |

XcodeBuildMCP makes recovery easier with structured error messages that often suggest the fix directly. But modern models are good enough at recovery that errors alone are rarely the bottleneck.

## What you should actually do

**For routine builds on known projects:** Use priming. Create an `AGENTS.md` with your exact build parameters:

```markdown
# Build Instructions

## iOS Build

- Project: `HackerNews.xcodeproj`
- Scheme: `HackerNews`
- Destination: `platform=iOS Simulator,name=iPhone 17 Pro`

Run: `xcodebuild -project HackerNews.xcodeproj -scheme HackerNews -destination 'platform=iOS Simulator,name=iPhone 17 Pro' build`
```

Fastest, cheapest, no overhead.

**For discovery and complex workflows:** Enable XcodeBuildMCP:

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

Use it when:

- You want discovery to just work without maintaining `AGENTS.md` files
- Build output might exceed truncation limits (in this run, ~50-57% of shell trials did)
- You need capabilities shell commands can't reach: interactive debugging (LLDB, breakpoints, variable inspection), log capture and analysis, UI automation and screenshot capture

## Caveats

A few things this experiment doesn't resolve:

- **Session length.** Tool definitions are reinforced every turn; priming tokens may suffer from attention decay in longer sessions. XcodeBuildMCP's relative value likely increases as sessions grow.
- **Cache effects on cost.** Cache read rates averaged ~91% for shell and ~96% for XcodeBuildMCP in this run, so billed cost is substantially lower than the cold numbers suggest.
- **Complex debugging workflows.** We tested builds and refactors, not multi-hour debugging sessions. XcodeBuildMCP's value likely increases for workflows that require its unique capabilities.

We also ran a smaller follow-up on an unreleased XcodeBuildMCP v2 to reduce context overhead; see the update at the end.

## The bottom line

When my manager asked whether XcodeBuildMCP was still necessary, the honest answer turned out to be: it depends. That's less satisfying than a clear yes or no, but it's also more useful.

Modern agents are resilient enough that they'll usually finish the job regardless of how you set them up. The real question is how much time, cost, and noise you're willing to accept on the path there. Priming is the right default for most teams. XcodeBuildMCP earns its overhead when you need discovery, guaranteed diagnostics, or capabilities that shell can't reach.

## Update: XcodeBuildMCP v2

After writing this post, we tested an improved (now released) XcodeBuildMCP v2 using the same harness and tasks (15 trials per task per agent; n=225). Because v2 wasn't shipped at time of writing, **it's not included in the headline analysis above**, but it's useful as a directional check on whether we can reduce XcodeBuildMCP's context overhead without losing the discovery benefits.

| Metric (MCP Unprimed)    | v1 (Released) | v2 (Beta) | Change |
| :----------------------- | :-----------: | :-------: | :----: |
| Median time              |     133s      |   147s    |  +11%  |
| Tokens (avg)             |     702K      |   453K    |  −35%  |
| Cost/Trial (cold median) |     $2.30     |   $1.27   |  −45%  |
| Real tool errors (avg)   |     0.56      |   0.49    |  −12%  |

v2 cuts most of the token and cost overhead, trends toward fewer real tool errors, and is a bit slower in median wall-clock time in this run. If these deltas hold at larger sample sizes, the core conclusion stays the same, but MCP becomes much more competitive on cost for discovery-heavy workflows.

XcodeBuildMCP 2.x is now available with further optimizations to reduce context overhead and improve reliability. It introduces a CLI mode and Agent Skills that let your agent use XcodeBuildMCP without the upfront token cost mentioned above. For details, see the [changelog](https://github.com/getsentry/XcodeBuildMCP/blob/main/CHANGELOG.md).

---

_The v1 dataset (1,350 runs) and evaluation harness are available on [GitHub](https://github.com/getsentry/xcodebuildmcp_eval); the v2 preview adds 225 runs in the same repo._
