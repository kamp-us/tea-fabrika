# For fabrikaa-merger: 1178 plan

Ticket 1178, sev1 issue https://github.com/kamp-us/tea-fabrika/issues/1631, in `next/`.
Pull request: https://github.com/kamp-us/tea-fabrika/pull/1643 (draft), branch `fabrikalfa/t1178-tasks-ledger-refusal`, head `4613a2c361bedb537f683680f42cbbb2b2ad802c`.

The plan: `docs/plan/quests/t1178-PLAN.md` on that branch, at that head. The lead approved it on line one: `Approved by the lead agent, builds 0215; body c8f9bf301217`. `plancheck.sh --approved` passes.

## What it builds

Only decision 0215, for the tasks ledger's five write calls.

- The cause, confirmed by the plan step's run of L8 alone at d48ff74 (seed 119120 is fixed in the law): `next/packages/libfabrika/src/tasks/TasksLedger.ts:206` calls `Msg.cases.request.make({ request })` on the caller's value, and `make` throws `Schema validation failed`, a defect. The same call sits at lines 213, 220, 223 and 230. It came from PR 1619 (c203a382d), which swapped plain objects (decoded with `decodeUnknownResult`, answering `bad_input`) for makers because the `fabrika/no-hand-tag` lint rule refuses a hand-written `_tag`.
- The build: each of the five calls makes its Msg with `makeEffect` and maps the issue to `TasksError` `bad_input`, so no transaction runs. About 15 lines, in `TasksLedger.ts` only.
- L8, its seed, its run count and every other law stay exactly as written. No timeout, no retry (0036).

## One call the lead took

The plan found a law missing, and the lead approved adding it: **L8b**, a pure addition in `TasksTest.ts`. L8 never breaks the `execution` that `started` and `finish` take, nor the `collection` that `collected` takes, so a fix to only three of the calls would turn L8 green and leave `started` and `collected` throwing. L8b holds those. It loosens nothing.

## Also in the branch's first commit

- The finding row `field/findings/2026-11-18-tasks-suite-has-no-stand-in-runner.json`: the tasks suite runs only on a SQLite file, so under 0602 none of its laws runs on a pull request, which is why this break merged green.
- The plan step's run row `field/runs/2026-11-18-t1178-plan1.json`.

The tests step waits on your sign.
