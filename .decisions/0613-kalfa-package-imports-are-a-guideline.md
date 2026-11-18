---
id: 0613
title: A kalfa package may import another, as a guideline in kalfa/AGENTS.md and never a rule
status: accepted
date: 2026-11-18
tags: [kalfa, packages, imports, guideline, protocol]
---

# 0613: A kalfa package may import another, as a guideline in kalfa/AGENTS.md and never a rule

```text
before   rule (0601): no kalfa package imports another
after    guideline (kalfa/AGENTS.md): depend on a protocol, join Layers at the top,
         no cycles, keep the graph small
```

**What this decides:** a kalfa package may import another kalfa package, and how to do it well is a
guideline in `kalfa/AGENTS.md`, not a law.

## Context

On 2026-11-18 the owner ruled that "no kalfa package imports another" is not a rule. It stood in
[0601](0601-program-make-with-optional-pipes.md) as a bullet and as a binding constraint.

Nothing enforced it. `boundary-rules.json` already lets `kalfa-records` import `kalfa-config`, and
`layer-rules.json` and `oxlint-plugins/` hold no check for it. [0585](0585-kalfa-is-six-domain-packages.md),
[0556](0556-kalfa-holds-our-tooling-packages.md) and
[0612](0612-kalfa-ci-holds-the-ci-protocol-once.md) do not state it. 0585's line about subpaths
meeting only through the root is a different rule and stays.

This follows [0605](0605-no-record-patches-another.md): 0601's why (programs, ledger and transport
as protocol packages) is not reversed, so it stays `accepted`. The rule's home was 0601 itself, so
the two lines are removed there, in the same pull request as this record.

## Decision

**A kalfa package may import another kalfa package. What to prefer is a guideline, written in
[`kalfa/AGENTS.md`](../kalfa/AGENTS.md).**

- Removed from 0601: the bullet under "Packages and boundaries" and the binding constraint.
- That the kalfa protocol packages are implemented and joined by libfabrika (0601) is not changed.
- No lint check is added or removed: none enforced the old rule.

## Consequences

- A guideline is not a law: a reviewer may accept an import that breaks it, and says why.
- Not decided here: whether the guideline becomes a check later. It needs its false alarms measured
  first.
