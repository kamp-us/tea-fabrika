---
id: 0569
title: In next/ and our tooling, a tea Msg, Cmd and Sub and the state table are keyed on _tag, not type, through a local patch of tea that carries tea's own core change, ahead of tea's release
status: accepted
date: 2026-11-15
tags: [tea, msg, tag, union, patch, upstream, schema, next, tooling]
---

# 0569: In next/ and our tooling, a tea Msg, Cmd and Sub and the state table are keyed on _tag, not type, through a local patch of tea that carries tea's own core change, ahead of tea's release

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

**What this decides:** the key that says which case a tea Msg is.

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
- We carry one patch of tea 0.25.0 today, for demlik issue 897. tea 0.26.0 and 0.27.0 already
  ship that fix.

## Decision

**A tea Msg is keyed on `_tag` in `next/` and our tooling, now, through a local patch of tea
(owner, 2026-11-15).**

- **The patch carries tea's own core change.** tea's runtime and types read and write `_tag` on a
  Msg where they read and write `type` today. No helper, wrapper or conversion between the two keys
  is written in our code.
- **tea moves to 0.27.0 first.** That bump deletes the 0.25.0 patch, whose fix 0.27.0 ships. The
  `_tag` patch is then written against 0.27.0, as `patches/@demlik__tea@0.27.0.patch`, and its
  comment row in `pnpm-workspace.yaml` names issue 949.
- **The bump that takes tea's release deletes the patch,** as for every local patch.
- **Our Msgs follow:** each Msg union is a `Schema.TaggedUnion`, made with its maker and read with
  its own matcher ([0562](0562-nothing-teaches-the-wrong-shape.md),
  [0567](0567-a-tagged-value-is-matched.md)).
- **Scope** (widened the same day, see Amendments): a Msg, a Cmd value and the `cmd` a settled
  Msg carries, a Sub value, and `Transitions`' lookup of a state's `type`. Semantic events
  (`E extends { type: string }`) keep `type`.
- It is one of the fixes of the sev0 the owner called on 2026-11-15.

## Consequences

- This amends 0214 in part: its line "tea's Msgs and Cmds keep `type`" no longer holds for either.
- Saved letters in the ledger carry their Msg with `type`. The plan of this work says how an old
  row is read without rewriting it, and a law holds that an old letter still folds.
- The change reaches every machine in `next/`, so its slices are ordered against open work by the
  lead.
- **Not decided here:** whether semantic events move to `_tag` too.
- The plan: `docs/plan/quests/tea-msg-tag-PLAN.md`, in its own pull request.

## Amendments

- 2026-11-15, later the same day (owner): the change covers Cmds, Subs and the state table too,
  not only Msgs. The patch moves a Msg, a Cmd value and the `cmd` a settled Msg carries, a Sub
  value, and `Transitions`' lookup of a state's `type` to `_tag`. Semantic events stay on `type`,
  not ruled. Machines that compare a state's `_tag` by hand may move to `Transitions` later; that is
  not part of the patch.

- 2026-11-15, later (owner): [0578](0578-tea-cell-answers-a-step.md) adds one change to this
  patch, a pipeable `Step` for a cell's answer in place of the tuple. The rest of this file holds.
