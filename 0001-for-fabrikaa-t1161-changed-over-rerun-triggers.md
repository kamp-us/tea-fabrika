# For fabrikaa: ticket 1161, should a branch proof's `scope: changed` override a rerun trigger?

Branch: `fabrikalfa/scheduled-dispatch-scope` (no pull request yet: the sev0 freeze holds CI). Plan, unsigned: `docs/plan/quests/t1161-scheduled-dispatch-scope-PLAN.md` on that branch. Today's CI, serving both versions.

## The question (yes or no)

Ticket 1161 adds a `scope` input to `scheduled.yaml`'s hand start, `changed` by default and `full` on request. The plan builds it with 0590's rules unchanged: under `changed`, a change to a `forceRerunTriggers` file (`.oxlintrc.json`, `oxlint-plugins/**`, a config, the lockfile, a `package.json`) still runs the full set (0590 point 3).

The run that prompted the ticket, https://github.com/kamp-us/tea-fabrika/actions/runs/44210757768 on PR 1525, touched `.oxlintrc.json`. So with the plan as written, that run would still be full. Should `scope: changed` instead run only the tests the change reaches, even when it touches a rerun trigger?

- **No (the plan writer's lean, about 80%; mine too).** 0590 stands. A trigger change costs about 26 to 28 minutes of legs on the four proof groups. Since 0598 those groups are the proofs' own, so it holds up only another proof started at the same time, never a pull request's tests. The ticket still adds `full` on request, with the law that needs it recorded in the run's `proof-set` record, and a default held by a lint rule.
- **Yes.** This walks back 0590 point 3 for hand starts, and needs a decision file. It also needs a third selection path in `proof.ts`, since Vitest's `--changed` returns every test once a trigger file changes. It misses the tests that read those files as text until 0591's `reads:` lands. A miss shows as a red main full run within about an hour of the merge.

The rest of the plan does not depend on the answer. Ticket 1161 builds after the kalfa stack lands, when the merger says so.
