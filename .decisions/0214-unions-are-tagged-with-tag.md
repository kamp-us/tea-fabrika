---
id: 0214
title: Every union we define tags its members with _tag, written by Effect Schema and never by hand, while tea's Msgs and Cmds keep type and third-party shapes keep theirs
status: amended-in-part by [0569](0569-tea-msgs-are-keyed-on-tag.md)
date: 2026-11-01
tags: [schema, tag, union, effect-schema, tea, names]
---

# 0214: Every union we define tags its members with _tag, written by Effect Schema and never by hand, while tea's Msgs and Cmds keep type and third-party shapes keep theirs

**What this decides:** the one key that says which case a value is.

```ts
// next/packages/libfabrika/src/telemetry/Trace.ts: Effect Schema writes the `_tag`.
export const Chain = Schema.TaggedUnion({
  job: { process: ProcessId },
  spans: {},
});
```

## Context

Changed on 2026-11-01, when the owner approved Tier 1: it used to say `_tag` earns its place only
where something switches on it. See
[schema classes, not Of helpers](../docs/direction/schema-classes-not-of-helpers.md). AGENTS.md
says the same.

## Decision

**Every union we define uses `_tag`, written by Effect Schema with `Schema.TaggedUnion`,
`TaggedStruct` or `TaggedError`, never by hand.**

- A union member is a `Schema.TaggedStruct`, wrapped in `Schema.Opaque` where it has helpers
  ([0213](0213-data-is-a-schema-opaque.md)).
- tea's Msgs and Cmds keep `type`. Third-party shapes keep their own key. Since [0569](0569-tea-msgs-are-keyed-on-tag.md), a tea Msg, Cmd and Sub and the state table are keyed on `_tag`.
- In `next/`, `kind` on ledger entries is `_tag` too (ticket 32). Today's code keeps `kind` until
  that code goes.

## Consequences

- In `next/`, the lint rule `fabrika/no-hand-tag` fails a hand-written `_tag` key.

## Amendments

- 2026-11-15: [0573](0573-trusted-lint-rule-replaces-ours.md) replaces `fabrika/no-hand-tag`, the rule named here, with the anti-slop rules `no-manual-tagged-construction` and `no-manual-tagged-type`, in the cleanup of [0562](0562-nothing-teaches-the-wrong-shape.md). The rule that holds the ban changes; the ban does not.
