---
id: 0592
title: libfabrika writes output only through Effect's Console, and oxlint's no-restricted-properties refuses raw process.stdout and process.stderr writes
status: accepted
date: 2026-11-15
tags: [lint, oxlint, console, stdout, stderr, libfabrika, effect, tests, mock]
---

# 0592: libfabrika writes output only through Effect's Console

```jsonc
// Sketch: .oxlintrc.json, an override for next/packages/libfabrika/**
"no-restricted-properties": ["error",
  { "object": "process.stdout", "property": "write",
    "message": "Write through Effect's Console, so a test can see it." },
  { "object": "process.stderr", "property": "write",
    "message": "Write through Effect's Console, so a test can see it." }]
```

## Decision

The owner ruled on 2026-11-15, at 9:50 PM Pacific, on the open half of the mock-cloudflare plan's
first question:

1. **Raw `process.stdout` and `process.stderr` writes are banned across libfabrika.** The rule is
   oxlint's built-in
   [`no-restricted-properties`](https://oxc.rs/docs/guide/usage/linter/rules/eslint/no-restricted-properties),
   not a rule of ours (0040).
2. **Every write goes through Effect's `Console`.** That way a test sees all output through
   `TestConsole`, and coverage holds by construction. It follows the lead's mock-sweep ruling that
   coverage is never lost.
3. **A real exception gets a disable line with a plain written reason.** Examples are a CLI's final
   output and a crash path.

## Consequences

- The build belongs to the mock-cloudflare and mock-node-dev plans on fabrikalfa/mock-plans, and
  lands with the mock sweep's one pull request (0589).
- A test no longer spies on `process.stdout` or `process.stderr` in libfabrika. It reads
  `TestConsole` instead.
