# K1's answer on run 44210757768's full scope, and one gap in the rule

- **No law needed full scope.** The run went full on its own. 1525 touches `.oxlintrc.json` and
  `oxlint-plugins/**`, which are in vitest's `forceRerunTriggers`.
- **Both proofs are covered automatically.** L13
  (`checklist-instance.laws.integration.test.ts`) and T930 L8
  (`prefer-schema-arbitrary.test.ts`) are both selected by the PR's own changed and related CI,
  so the hand start was not needed.
- **Recorded** in `field/runs/2026-11-18-t1057-stack-merge-and-proof.json`, with the merges, the
  pure autofix, the 0589 no-review basis and the leak exception. It is held locally until that
  run ends, so 1525's head does not move under it.
- **Not cancelled,** because it is not a pure duplicate: no automatic run gives full scope.
- **1427:** its own check run 44210687946 at 6414994b already has `related` selecting Load,
  RepositoryTrust, worker-mail, settings-generated and T753 L16, at full depth.
  - Related legs 1, 2, 3 and 5 are green, and leg 4 is pending.
  - next, check, typecheck and launchd are green.
  - Its dispatched `scope=changed` run 44210761961 overlaps that job, is left running, and will
    not be dispatched again.
  - Later layers rely on the automatic CI and the merge queue.

**A gap in the rule:** `scheduled.yaml`'s `workflow_dispatch` has **no inputs**, so a hand
start cannot pick `scope=changed`. A change that touches a force-rerun trigger always runs full.
So "hand-dispatch at `scope=changed`" cannot be done today. In practice the rule means: do not
hand-dispatch when the automatic CI covers the proof. If you want a `scope` input on the dispatch,
that is a `scheduled.yaml` change, which C2 owns in this round. Say so and I add it to C2's plan,
or file it as its own ticket.

Children active: 7 of 7.
