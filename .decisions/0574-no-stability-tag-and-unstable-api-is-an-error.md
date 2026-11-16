---
id: 0574
title: Doc comments carry no @stability tag until libfabrika's first release, unstableApiUsage is an error with each unstable Effect part we use named once, and apiStabilityLeak is an error only where it recounts at zero
status: accepted
date: 2026-11-15
tags: [apistabilityleak, effect, tsgo, typecheck, doc-comments, stability, since, unstable, next, tooling]
---

# 0574: Doc comments carry no @stability tag until libfabrika's first release, unstableApiUsage is an error with each unstable Effect part we use named once, and apiStabilityLeak is an error only where it recounts at zero

```jsonc
// tsconfig.base.json, a sketch, not run: the checker setting that names each unstable part on purpose
{
  "diagnosticSeverity": { "unstableApiUsage": "error" },
  "allowedUnstableApis": ["@effect/vitest", "effect/unstable/sql"]
}
```

**What this decides:** `@stability` leaves every doc block in `next/` and our tooling until
`libfabrika` first ships, and the Effect checker's `unstableApiUsage` is an error, with each
unstable Effect part we use on purpose named once, and `apiStabilityLeak` is decided by a recount.

## Context

[0565](0565-effects-own-checks-block.md) turned on all 135 checks of the Effect checker and listed
five that clash with something we decided. This rules the first: `unstableApiUsage` (16,281 hits)
against our doc tags. Every public export of ours carries `@stability unstable`, so 12,933 of the
hits are our own exports used by our own code. About 3,350 point at Effect's packages.

[0118](0118-no-since-tag-before-a-release.md) dropped `@since` because a tag that says the same
thing on every export tells a reader nothing. `@stability unstable` is that tag today. The owner
ruled on 2026-11-15 that the same reasoning holds for it. `apiStabilityLeak` (clash 2, 235 hits) shares the
root: it flags an export whose type shows a less stable type. The owner ruled on it the same day.

## Decision

**No `@stability` in `next/` and our tooling until `libfabrika` has a released version, as
`@since` already is, and `unstableApiUsage` blocks (owner, 2026-11-15).**

- Module blocks and export blocks carry no `@stability`. Their other tags stay.
- `unstableApiUsage` is `error`. Each unstable Effect part we use on purpose is named once in the
  checker's `allowedUnstableApis` setting, for example `@effect/vitest` and `effect/unstable/sql`.
  A new unstable part fails until someone adds it on purpose.
- That setting is a list of chosen dependencies, not a list that lets broken code pass, so
  [0524](0524-no-list-lets-broken-code-pass.md) does not apply (the owner's word).
- At the first release, `@stability` comes back together with `@since`, in the same sweep.
- **`apiStabilityLeak` is recounted once the tags are gone.** If it is at zero, it goes on as an
  error. If hits remain because our exports show Effect's unstable types, it stays off, and those
  hits are not swept. We use Effect's unstable APIs on purpose, to stay on its leading edge, so an
  export that shows one is the same choice as the import.

**Binding constraints**

- Nothing is added to `allowedUnstableApis` to make a hit pass. An entry is a part we chose, with
  its reason in the pull request that adds it.
- `apiStabilityLeak` is never set to `error` while a hit that is left over comes from an Effect
  unstable type. A hit from our own tags is fixed by the sweep, not left.

## Consequences

- This file changes no code. The sweep pull request removes the tags, sets the checker, and
  changes each place below. Until it lands, nothing stops a new hit.
- It removes the 12,933 hits that come from our own exports. What is left is Effect's unstable
  parts, which the setting names.
- The cost: a reader loses the `unstable` label until the first release. It said the same on every
  export.
- **Places that ask for `@stability`, changed by the sweep pull request:**
  - `oxlint-plugins/effect-jsdocs.ts` (lines 867 and 875): the `invalid-stability` and missing
    `@stability` diagnostics.
  - `oxlint-plugins/jsdocs.ts` (lines 36, 331 and 482): the rule and its two messages.
  - `oxlint-plugins/jsdocs.test.ts`: the planted blocks and the laws that need the tag.
  - `oxlint-plugins/README.md` (the `jsdocs` row, and the count line that says most blocks lack
    `@stability`).
  - [the doc comments pattern](../.patterns/doc-comments.md): its tag order, its example and its
    note on our tree.
  - [`.patterns/effect-reach-for-what-ships.md`](../.patterns/effect-reach-for-what-ships.md) and
    [`.patterns/effect-crypto-through-services.md`](../.patterns/effect-crypto-through-services.md)
    read Effect's own tags, not ours, and need no change unless the sweep finds otherwise.
  - Every `@stability` line in `next/` source.
  - `.agents/`, `.claude/` and `next/AGENTS.md` hold no `@stability`.
- **Amends** [0565](0565-effects-own-checks-block.md) (clashes 1 and 2 are ruled),
  [0118](0118-no-since-tag-before-a-release.md) and
  [0023](0023-next-follows-effects-code-style.md) (the doc comment rule loses a second tag for now).
