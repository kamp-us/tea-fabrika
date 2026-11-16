# 0048: 0573 PR 1's review sent it back; a type-position gap closed by 0573's own rule

PR https://github.com/kamp-us/tea-fabrika/pull/1498 is on `fabrikalfa/trusted-rules-0573` at
`d824469f2`. This is its first send-back.

## What ran

- **Tests:** L1 to L6, each red under its plant first. L7 stopped where the plan says it would:
  anti-slop's `require-readable-spacing` misses 2 class-member lines that ours flags, so
  `padding-line-between-statements` stays and there is no L7 file.
- **Build:** lint went from red to green, and typecheck is 0.
- **Review:** sent back.

## The review's faults

1. **A gap, at the plan level.** The deleted `fabrika/no-data-taggederror` visited
   `TSQualifiedName`, so it also refused `Data.TaggedError` in type positions, such as
   `typeof Data.TaggedError` and `InstanceType<ReturnType<typeof Data.TaggedError<"X">>>`. Nothing on
   the branch refuses those now: not `no-restricted-properties`, not
   `typescript/no-restricted-types`, and not `preferSchemaTaggedError`, which covers class extends
   only. The plan's L1 and `builtin-plants.ts:76` even list `typeof Data.TaggedError` as a passing
   line.
2. **Two laws can't fail as written.**
   - L4 draws only 6 of its 8 modules at seed 119120, never `fs` or `node:path/posix`.
   - L3 stays green when a checker block sets `ignoreEffectErrorsInTscExitCode: true` or
     `diagnostics: false`.

## My call on fault 1, by your standing principle

0573 says never a gap, and you already applied that to `no-context-tag`. The same principle covers
this case, so it is not a new question. The coordinator also leaned this way, at 85%.

- `fabrika/no-data-taggederror` stays until a trusted rule holds type positions.
- PR 1 swaps two rules: `no-node-filesystem` and `one-id-module`.
- The `Data.TaggedError` oxlint entries may stay beside ours as extra cover.

If you or the owner would rather accept the miss as a documented loosening (0014), say so and I
will turn the round around.

## The fix round, starting now (one fresh Opus agent)

- It merges main in first, so `edge-comment.integration.test.ts` runs in the box.
- It writes a dated plan amendment, and fixes L1 and the plant list.
- It fixes L4 (all 8 modules in every run) and L3 (fail on either flag), each red first.
- It files three finding rows:
  - `README:1151` says the 73 untyped files are under `.agents/` and `scripts/`, but 2 of them are
    root `vitest.*.test.ts`;
  - `docs/plan/quests/pr-check-file-laws-PLAN.md:486` and `:492` `git mv` two test files that this
    PR deletes;
  - L4's six of eight.
- **The plan's body changes, so it needs your re-sign.** I mail the head as soon as the amendment
  is pushed. The same reviewer then rechecks.
