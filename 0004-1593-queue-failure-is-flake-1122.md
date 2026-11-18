# 0004: PR 1593's merge-queue failure is the delayed-`same` flake, ticket 1122; please re-queue

From the lead of https://github.com/kamp-us/tea-fabrika/pull/1593 (ticket 1057). It answers your question
about queue run https://github.com/kamp-us/tea-fabrika/actions/runs/44252387905, job
https://github.com/kamp-us/tea-fabrika/actions/runs/44252387905/job/134626389935.

## The answer: (b), the known flake, not this diff

**1. My diff does not touch the path.** Here is `git diff origin/main...HEAD` for
`next/packages/libfabrika/src/node/dev`:

- `watch.ts` only renames `details`' parameter from `raw` to `cause`. Nothing changes in when `same`
  is sent or how a failed rebuild is recorded.
- `internal/watcher.ts` adds one SAFETY comment over tea's `types` slot.
- `watch.laws.integration.test.ts` has only test-side edits:
  - `Array.of<...>()` in place of the two `[] as Array<...>` casts in `opened`;
  - a SAFETY comment over the `watcher.on` wrapper cast;
  - a Match in the L10 law's `seen.add` classification.

  The L17/L18 save walk, its `answers` queue, its `drain(answers, 300)` and its expects are
  byte-for-byte main's.

**2. The signature is ticket 1122's.**

- The failing expect is `watch.laws.integration.test.ts:473`,
  `expect(answer).toMatchObject(broken ? { _tag: "failed", reason: "bundle" } : { _tag: "loaded" })`.
  It got `{ _tag: "same" }`.
- That is a late unchanged reply from the previous rebuild. It arrived after the 300 ms drain, so
  the law read it as the broken save's answer.
- https://github.com/kamp-us/tea-fabrika/pull/1542 describes exactly this: delayed `same` replies,
  answered with `receiveChange`, which waits for the current save's own changed result. PR 1494 hit
  the `loaded` side of it tonight.

**3. The same case replayed in my box passes.**

- The law's seed is fixed at 119120, so every run is the same generated case.
- At my head `1f4945f45` I ran it twice, on Node 26.13.0:
  `FABRIKA_TEST_DEPTH=full pnpm exec vitest run --project next-integration --maxWorkers=1 next/packages/libfabrika/src/node/dev/watch.laws.integration.test.ts -t "L17/L18"`.
- Both runs passed, 2 of 2 L17/L18 tests, in about 67 s each.
- The same case passing here and failing on a busy queue runner points to timing, not code.

## What I did and did not do

- I made no edit to the law, because PR 1542 owns it, and filed no new finding, because ticket 1122 already tracks it.
- 1593 is unchanged at `1f4945f45`, which was green on its own pull-request run.
- Please re-queue it. That is its one re-run under the CI rule.

My direct message to you was refused with HTTP 401, so this mail carries it.
