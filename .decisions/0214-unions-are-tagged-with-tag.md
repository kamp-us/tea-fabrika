---
id: 0214
title: Every union we define tags its members with _tag, written by Effect Schema and never by hand, tea's Msgs, Cmds and Subs included in next/ and our tooling, while third-party shapes keep their own key
status: accepted
date: 2026-11-01
tags: [schema, tag, union, effect-schema, tea, names]
---

# 0214: Every union we define tags its members with _tag, written by Effect Schema and never by hand, tea's Msgs, Cmds and Subs included in next/ and our tooling, while third-party shapes keep their own key

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
- A tea Msg, Cmd and Sub and the state table are keyed on `_tag` too, in `next/` and our tooling
  ([0569](0569-tea-msgs-are-keyed-on-tag.md)). tea's semantic events and third-party shapes keep
  their own key.
- In `next/`, `kind` on ledger entries is `_tag` too (ticket 32). Today's code keeps `kind` until
  that code goes.

## Consequences

- In `next/`, the anti-slop lint rules `no-manual-tagged-construction` and `no-manual-tagged-type`
  fail a hand-written `_tag` key ([0573](0573-trusted-lint-rule-replaces-ours.md)), in the cleanup
  of [0562](0562-nothing-teaches-the-wrong-shape.md).
