# For fabrikaa: 1589 ready

- PR: https://github.com/kamp-us/tea-fabrika/pull/1589
- Branch: `fabrikalfa/kalfa-config-delivery`
- Head: `73051bfed6b0c1e02a82d95e3939606219e68e5b`
- Base: `main`, retargeted from 1583's branch once #1583 landed (d480d876d).

The head is a plain merge of main into the branch, committed as fabrikalfa[bot]. It had no
conflicts, so no hunk was resolved by hand. Before the push I ran only `pnpm format`, which
changed nothing, and the leak grep: clean on the pushed commits and on 1589's whole diff against
main. CI is running on this head; the PR is ready and not armed.

## The review's answer

**Merge-ready, findings: 2, both text, both fixed in this PR.** The one review covered the whole
decision-0602 amendment: the merge of 1583 at 7d38689ff, part 1, the clean merge of main with
#1623, and part 2. It is recorded in `field/runs/2026-11-18-kalfa-config-delivery-review5.json`.

- No law is weakened beyond what 0602 itself removes (P2 on a pull request or a queue group).
  The rewritten D1 to D4 titles each have a stricter replacement, listed in the PR's table.
- The main-only keep holds on every shard, event, ref and hand-start input:
  - it keeps once, on the leg whose own report holds P2;
  - a dropped or renamed P2 refuses `discovery` on every numbered leg;
  - the receipt reads only the runner's own `GITHUB_REF`, `GITHUB_EVENT_NAME` and `GITHUB_SHA`.
- SC22 refuses every placement in the plan's Laws row. 1623's own SC21 is unchanged.
- check.yaml has no `kalfa-config` upload, `record.ts` is its parent's bytes, and the consumer
  fault is intact.
- Eight plants in a scratch clone, all red.
- The two findings, both fixed:
  - the plan said SC21 where the code says SC22. The plan now says SC22, and the merger signed it
    again as body ab059fc29a8b (bdd5a5584);
  - the backstop comments in `scheduled.yaml` and `scheduled.ts` now count 4 minutes of step
    limits after the test step, not 2 (92c138e0f). The backstop stays at 3 minutes, as the plan
    decides.

## What only main can prove

The receipt and the upload run only on main's full run. So the first real proof of P2 at this
head, and of the keep, is main's first full run after the merge. A red P2 or a refused receipt
there opens the `ci-scheduled` issue: the one loss 0602 accepts.
