---
id: 0569
title: In next/ and our tooling, a tea Msg, Cmd and Sub and the state table are keyed on _tag, not type
status: accepted
date: 2026-11-15
tags: [tea, msg, tag, union, patch, upstream, schema, next, tooling]
---

# 0569: In next/ and our tooling, a tea Msg, Cmd and Sub and the state table are keyed on _tag, not type

```ts
// Before: a Msg says its case with `type`, unlike every other union we have (0214).
const Msg = Schema.Union([
  Schema.Struct({ type: Schema.Literal("tick") }),
  Schema.Struct({ type: Schema.Literal("land"), pr: Schema.Number }),
]);

// After (a sketch): a Msg is a tagged union like the rest, made by its maker and read by its own
// matcher (0562, 0567). tea itself reads `_tag`, through the patch.
const Msg = Schema.TaggedUnion({
  tick: {},
  land: { pr: Schema.Number },
});
const next = Msg.match(msg, { tick: () => model, land: ({ pr }) => landed(model, pr) });
```

**What this decides:** the key that says which case a tea Msg, a Cmd, a Sub and the state table's
lookup of a state is, and how it came in: a local patch of tea, ahead of tea's own release.

## Context

- [0214](0214-unions-are-tagged-with-tag.md) tags every union we define with `_tag`, and leaves
  tea's Msgs and Cmds on `type`, because tea reads `type`.
- `@demlik/tea` is our brother project's library. Its maintainer is moving tea's core to key a Msg
  on `_tag`. The upstream issue is https://github.com/kamp-us/demlik/issues/949.
- [Patch upstream locally](../docs/direction/patch-upstream-locally.md) and
  [0054](0054-read-upstream-before-patching-it.md) say how we change a package we do not own
  without waiting: a `pnpm patch` of what the read proved, the upstream issue filed the same day,
  and the bump that takes the release deletes the patch. [0060](0060-upstream-issue-carries-the-patch.md)
  has the issue carry our diff.
- When this was written we carried one patch of tea 0.25.0, for demlik issue 897. tea 0.26.0 and
  0.27.0 already shipped that fix.

## Decision

**A tea Msg is keyed on `_tag` in `next/` and our tooling, now, through a local patch of tea
(owner, 2026-11-15).**

- **The patch carries tea's own core change.** tea's runtime and types read and write `_tag` on a
  Msg, a Cmd value, the `cmd` a settled Msg carries and a Sub value, and `Transitions` looks up a
  state's `_tag`, where they read and write `type` before the patch. No helper, wrapper or
  conversion between the two keys is written in our code. Semantic events
  (`E extends { type: string }`) keep `type`, which is not ruled. A machine that compares a state's
  `_tag` by hand may move to `Transitions` later; that is not part of the patch.
- **The patch also carries a pipeable `Step` for a cell's answer** in place of the tuple
  ([0578](0578-tea-cell-answers-a-step.md)). tea's own change and this one ride in the same patch.
- **tea moves first to a version that ships demlik issue 897's fix** (0.26.0 and 0.27.0 do),
  which deletes the 0.25.0 patch. The `_tag` patch is then written against that version, under
  `patches/`, and its comment row in `pnpm-workspace.yaml` names issue 949. The version and the
  patch are `pnpm-workspace.yaml`'s catalog entry for `@demlik/tea` and its `patchedDependencies`
  entry.
- **The bump that takes tea's release deletes the patch,** as for every local patch.
- **Our Msgs follow:** each Msg union is a `Schema.TaggedUnion`, made with its maker and read with
  its own matcher ([0562](0562-nothing-teaches-the-wrong-shape.md),
  [0567](0567-a-tagged-value-is-matched.md)).
- It is one of the fixes of the sev0 the owner called on 2026-11-15.

## Consequences

- This amends 0214 in part: its line "tea's Msgs and Cmds keep `type`" is replaced, for both.
- Saved letters in the ledger carry their Msg with `type`. The plan of this work says how an old
  row is read without rewriting it, and a law holds that an old letter still folds.
- The change reaches every machine in `next/`, so its slices are ordered against open work by the
  lead.
- **Not decided here:** whether semantic events move to `_tag` too.
- The plan: `docs/plan/quests/tea-msg-tag-PLAN.md`, in its own pull request.
