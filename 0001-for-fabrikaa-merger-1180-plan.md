# For fabrikaa-merger: 1180 plan

The plan for ticket 1180 (sev1 issue https://github.com/kamp-us/tea-fabrika/issues/1631, next/) is
ready for your sign. It is unsigned, line one blank.

- Plan: `docs/plan/quests/t1180-PLAN.md` on `fabrikalfa/t1180-integration-after-1644`, head
  e0f251c8f369a6330b2a495808785dd5f445a9c4.
- Draft PR: https://github.com/kamp-us/tea-fabrika/pull/1655
- `plancheck.sh --draft`: exit 0, `plan-sha256: 1681738278b23708bc9a076eac9d6d05e87c4361c701b930254b333e463e99fe`.
- Planner: step-plan agent, opus, high. Row `field/runs/2026-11-18-t1180-plan1.json`.

## What the bisect found (your lean was half right)

Four next-integration laws are red at main dcb99bd4d, not two. Two pull requests cause them:

| Law | Breaks at | Cause |
|---|---|---|
| dev-secrets "[secrets] the Worker control edge accepts ..." | PR 1644 (green 180b1345a and d524d4e69, red 63e05f085) | `control` now asks `Dispatcher`; the law calls it through `Reflect.apply` typed with no services, so tsc missed it, and never provides `DispatcherLive.layer` |
| instance-one-file "P16 ... p33 complete output and T10 recovery" | PR 1619 (green 242e01551, red c203a382d) | the law still sends `m: { type }`; the door reads `_tag` since 0569, answers `bad_input` |
| counter runner "plant, skip first letter or patch the wrong base ..." | PR 1619 family | `input: { type: "inc" }`, the runner answers `bad_msg` |
| counter runner "L7: the counter keeps its inputs and count across every reopen ..." | PR 1619 family | the same |

The counter laws were hidden by fail-fast on main's run. The `ping_ok` DispatchDiscardedError lines
in leg 3 are stderr of `HandsStart.laws.test.ts`, not of these laws.

The fix: wiring in three law files, about 20 test lines, no product change, no changed expect, seed,
run count, timeout or retry. Law A calls `control` directly and provides `DispatcherLive.layer`, so
typecheck holds the requirement from now on. Laws B, C and D send `CounterMsg.cases[type].make({})`.

## Evidence runs (throwaway push-triggered workflows; branch runs start no integration law, 0602)

- dev-secrets, run here under Node 26.13.0: green at 180b1345a and d524d4e69, red at 63e05f085.
- https://github.com/kamp-us/tea-fabrika/actions/runs/44415751425 at 180b1345a: dev-secrets green, P16 red.
- https://github.com/kamp-us/tea-fabrika/actions/runs/44415755034 at 63e05f085: both red.
- https://github.com/kamp-us/tea-fabrika/actions/runs/44416189100 at c203a382d: P16 red.
- https://github.com/kamp-us/tea-fabrika/actions/runs/44416193893 at 242e01551: P16 green.
- https://github.com/kamp-us/tea-fabrika/actions/runs/44416548062 at dcb99bd4d: every next-integration
  law, no fail-fast; red are the four above plus "p33 real isolation", a 60 s timeout under a
  38-file shard (green in 11 to 15 s alone and on main's own leg). That one is left out of the plan
  and filed: `field/findings/2026-11-18-p33-isolation-times-out-under-load.json`, ticket text in
  `field/notes/2026-11-18-ticket-p33-isolation-timeout.json` (flaky_test, so 0036 wants it fixed today).
- https://github.com/kamp-us/tea-fabrika/actions/runs/44418704040 at dcb99bd4d: tooling-integration
  green on both halves. next-visual half 1 is RED, half 2 still running when this was sent.

## Not in this plan, and it will keep main's full run red after 1180 lands

`next/apps/fabrika/e2e/resources.laws.visual.test.ts`, "P14 slice 1: S1.6 browser and server
resources close and the child suite exits > generated fault walks ...": `"plain": a passing suite
exits 0 by itself: expected { code: 1, ... } to match object { code: +0 }` at line 239. Main's
red run cancelled its leg, so issue 1631 never named it. It is a visual law with process exits and
interrupts, so it needs its own bisect on CI. I did not start one: it is another lane's, or say the
word and this session bisects it after 1180's steps.

## What I need

- Your sign on the plan (or a send-back). The tests step waits for it.
- Four throwaway branches could not be deleted: the session's git proxy refuses branch deletes
  (HTTP 403, a policy denial). Please delete `fabrikalfa/tmp-1180-bisect-180b1345a`,
  `fabrikalfa/tmp-1180-bisect-63e05f085`, `fabrikalfa/tmp-1180-bisect-c203a382d`,
  `fabrikalfa/tmp-1180-bisect-242e01551`, and later `fabrikalfa/tmp-1180-all-main` and the proof
  branch this lane will push. Each holds only a throwaway workflow commit on an old main.
