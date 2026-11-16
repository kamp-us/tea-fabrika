# 0052: everything that waited on PR 1366 is unblocked

The twin's `step-rules.md` now says PR 1366 is merged. Every slice merges `origin/main` in first,
never rebases, and fixes its old "waiting on 1366" hits as part of the slice.

## Told the running coordinators (one more step, then the same reviewer rechecks)

- **Anti-slop:** all 15 judgment slices. Together their folders hold the 579 hits in 1366's files.
  - `no-unknown-type-aliases-1` gets its build for the three-line `Entry.ts`/`Runner.ts` fix.
  - The 14 anti-slop slices not yet started now count 1366's files too.
- **Effect judgment:**
  - E28, E29, E30, E36, E38, E43, E45, E46, E47, E48, E75, E76, E79;
  - the E31 to E34 reviews;
  - the rulings round, which includes E61's 170 hits.
- **Mock groups 1 to 3:** every slice a plan lists as "waits on 1366" can start, including
  transport's slice 2 (Hello, `Gateway.ts`, the lock) in group 2.
- **Reflect rest:** merges main. Its 1366 fires join their slices. Slices 10 and 14 start if main
  now has `Stub.ts`. Slice 13 still waits on 1099 and 1312.

## New coordinators

| Job | What |
|---|---|
| E60, then E100 | `unstableApiUsage` (about 3964 hits, mechanical, a build split by folder), then `apiStabilityLeak` (judgment, 0574) |
| Mechanical round 2 | E63 to E74, the rest of E62 (216), and the 79 mechanical hits PR 1501 lists as waiting on 1366, one slice per check on `fabrikalfa/effect-mech2-<check>` |
| E80 | `strictEffectProvide` (about 703), per the 0565 amendment and your entry-point ruling |
| E81, E93 | `schemaSync` (only what your "waits on the product contracts" ruling allows; the rest listed) and `deterministicKeys` (paired with the service-id swap, recorded for the integrator) |
| E82, E87, E98, E99 | E87 gets `Function.dual` everywhere. E98 takes E51's 9 runtime hits |
| E83, E85 | `preferEffectRecord`, `preferEffectArray` (ledger) |
| E84, E86, E88, E89, E90 | E86 moves the `process.env` reads into the Effect programs |
| E91, E92, E94 to E97, plus the leftovers of E77 (48) and E78 (128) | E92's browser bodies take 0565's one-line exception |

The shared brief is `effect-after-1366.md` on `fabrikalfa/twin-tools`, and the rows it reads are
in `effect-after-1366-rows.md`, copied from the sweep plan. No slice opens a PR or adds a lock.

**One question:** where does mechanical round 2 fold? Into PR 1501 (`fabrikalfa/effect-mechanical`)
before it merges, or into a second mechanical PR after 1501 lands? Until you say, its slices stay on
their own branches.

## Refusal-charge follow-up

A coordinator on `fabrikalfa/refusal-hour-charge`, from main, runs three steps:

1. A tests step writes a law: a refusal whose span crosses the hour leaves the program's writes and
   bytes unchanged. It uses the finding's setup (the clock 3 ms before the hour), pinned, and shows
   it red first.
2. A build makes it green.
3. One Opus review.

Both quota law files run whole in the box. The work goes in one draft PR that resolves finding
`2026-11-15-door-law-hour-crossing-uncovered`. Its ticket is the finding's, or 404 if main's row
names none.

Capacity: several of these may sit PENDING until running sessions finish. I recreate any that stick.
