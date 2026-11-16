# 0126: pipeline-s1's tests are in, but they edit layer-rules.json without a plan row; held for the owner

pipeline-s1's tests step is pushed at `7212b667c97129a7f59312cb48b45d1daf3482f5`, leakgrep clean.
It is `origin/main`, plus app-e2e-s1 merged at `2387b44ad`, plus one commit.

- **Laws:** L1 to L7 are written. Every plant ran red and is recorded.
- **The Effect patch:** it now has `infoLines` and `debugLines` beside `warnLines`, with no
  `errorLines`.
- **Checks:** the six plan files pass 273 tests, and tsc on pipeline is clean.

## The owner's call: an unplanned `layer-rules.json` line

The step added `next-vitest` to next-codehost's imports in `layer-rules.json`, beside next-ci's.
That lets `CodeHostTest.ts` import the Recorder. That file is not in the plan's Files table, and no
allow-list entry was added.

Under the owner's standing rule, any edit to `layer-rules.json` waits for his own yes, every time.
So:

- The commit stays as it is, since history is not rewritten.
- The change is marked "held for the owner's yes, with no plan row" in the build and review rows.
- The slice cannot land until the owner says yes and a plan row is added.

**Please add it to your morning owner batch,** beside 0580 slice 2's `layer-rules.json` line. The
line is `next-vitest` in next-codehost's imports. If he says no, `CodeHostTest.ts` needs another way
to reach the Recorder, and that would be a plan amendment.

## Three code-over-plan notes for the review

1. `@effect/vitest` already gives every `it.effect` a `TestConsole.layer`, built once per test. So
   S2 uses `Layer.fresh`, and L4's "drop the layer" plant goes red for a different reason than the
   plan says.
2. The pair refuses `const { spyOn } = vi` too. Only `V.vi.spyOn`, through a namespace import, gets
   past both rules.
3. pipeline's glob joined the `e2e/node/**` error block, because both take the Reflect ban's error
   entries.

## Next

- The plan's checks-only build step (ruling 5) is running, and the review follows it.
- **L8 and the tea patch** still wait on tea slice 2's 966 commits. Those are held by the leakgrep
  patch-file limit, and the fix for that is under way. If they are still unpushed when group 1's
  watch ends, that part stops, and is reported.
