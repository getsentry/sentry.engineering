# Security Finding Resolution: VULN-1103 / DEVEX-266

## Finding Details

**Severity:** Critical
**Type:** Command Injection Vulnerability
**Status:** Resolved by code removal
**Parent Ticket:** https://linear.app/getsentry/issue/VULN-1103
**Child Ticket:** https://linear.app/getsentry/issue/DEVEX-266

## Vulnerability Description

A command injection vulnerability was detected in `scripts/next-remote-watch.js:54` where MCP client/server data could flow into a shell command execution function. The vulnerable code used `child_process.spawn()` with the shell environment variable (`process.env.SHELL`) and the `-c` flag, which allows shell interpretation of commands.

### Vulnerable Code (Historical Reference)

File: `scripts/next-remote-watch.js` (commit: ef77412c164280ac08ee8de848d88256942de215)

```javascript
const shell = process.env.SHELL
// ...
spawn(
  shell,
  [
    '-c',
    program.command
      .replace(/\{event\}/gi, filePathContext)
      .replace(/\{path\}/gi, eventContext),
  ],
  {
    stdio: 'inherit',
  }
)
```

## Resolution

This vulnerability has been **resolved by code removal** as part of the migration from Next.js to Astro framework.

**Resolution Commit:** 4fd7494 - "ref: Migrate site from Next.js to Astro (#199)"
**Date:** February 2026

The entire `scripts/next-remote-watch.js` file was removed during the migration, along with other Next.js-specific tooling. The file no longer exists in the repository, and the vulnerable code path is no longer present.

## Context

### Semgrep Assistant Analysis

The Semgrep AI assistant had previously classified this as a false positive with the following reasoning:

> "This is a development-only script (next-remote-watch.js) used for hot reloading during local development. The shell variable from process.env.SHELL is not user-controllable in this context and is not exposed to production environments or external attackers. The script is designed to be run locally by developers, making this finding not exploitable in any meaningful security context."

### Why This Still Matters

Even though this was a development-only script with limited exploitability:

1. **Defense in Depth:** Security best practices should apply to all code, including development tools
2. **Supply Chain Security:** Compromised development environments can lead to broader security incidents
3. **Historical Record:** Documenting resolved vulnerabilities helps track security improvements

## Remediation History

- **Detected:** Via Semgrep rule `javascript.mcp.mcp-shell-injection-taint.mcp-shell-injection-taint`
- **Resolved:** February 2026 via framework migration
- **Documented:** February 2026 (this file)

## References

- [Semgrep Rule](https://semgrep.dev/r/javascript.mcp.mcp-shell-injection-taint.mcp-shell-injection-taint)
- [OWASP Command Injection Defense Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/OS_Command_Injection_Defense_Cheat_Sheet.html)
- [MCP Security Considerations](https://modelcontextprotocol.io/specification/2025-06-18/basic/transports#security-considerations)
- [Node.js Security - Command Injection](https://nodejs.org/en/docs/guides/security/#command-injection)
- [OWASP Top 10 2025 - A05 Injection](https://owasp.org/Top10/2025/A05_2025-Injection/)

## Action Items

- [x] Verify vulnerable code has been removed
- [x] Document resolution in this file
- [x] Close Linear tickets VULN-1103 and DEVEX-266
