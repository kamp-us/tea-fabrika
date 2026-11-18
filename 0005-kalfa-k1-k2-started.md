# Kalfa K1 and K2 started, read and plan only

Children active: 4 of 4 (C1, B1, K1, K2). The cap is full: nothing more starts until one ends.

| Child | Session | Started | Doing now |
|---|---|---|---|
| C1 `sev1-laneC-slot-decision` | session_01WuXcaxUHZTYruUf9piTPog | 00:15Z | decision draft amending 0595, docs draft PR, then stops |
| B1 `sev1-laneB1-shard-weights` | session_01WuXcawPcjhzbnLgWC4yego | 00:16Z | weight row refresh, full steps, draft PR |
| K1 `kalfa-K1-stack-landing` | session_01WuXcavpBKwsNsSj6LXCSf7 | 00:17Z | read and plan only: each layer's steps, reviews and CI, and the bottom-up merge plan for the README conflict with main 397e63f4 |
| K2 `kalfa-K2-config-delivery` | session_01WuXcavZhSjyQ47wG3mKvd3 | 00:17Z | read and plan only: the plan step (0585), reading `fabrikalfa/kalfa-delivery-v5` as unreviewed input |

## Hold

Both K children have the hold in writing: no commit, merge, push, ready mark or queue action on
the kalfa branches or the 18 paths until I send each "write go". I send it when you confirm the
Codex kalfa writers have stopped. K1 knows 322e6c16 is already on 1583's branch.

## My call on K2's timing

**K2 plans now and builds only after 1583 lands**, not after 1427. K2's work touches 1583 itself:
1583 adds `kalfa/config/*` and edits `.github/workflows/check.yaml`, and K2's package proof
builds on that package. Landing the bottom layer alone does not free any of K2's files. The plan
step is read-only, so it runs now against 1583's head, and its box starts from main once 1583
lands. If you want K2 building sooner, the other way is to branch it from 1583's head as a
stacked child; say so.

## Overlap found: 1583 and B1

1583 also edits `vitest.shards.full.json` and `vitest.shards.json` (two rows renamed to
`kalfa/config/src/...`) and `.github/ci/shard-rows.ts` and its test. Those are not on the
18-path list. I told B1: do not edit `shard-rows.ts` or its test, leave those two rows as on main,
and if 1583 lands first, bring its branch up to date with a plain merge of main and keep the
`kalfa/config` row names. The PRs should then merge cleanly in either order.

## Lane A and B2

Folded into K2's brief as separate commits or a follow-up PR after the package proof. Its plan
says which and why. Neither may loosen a gate.
