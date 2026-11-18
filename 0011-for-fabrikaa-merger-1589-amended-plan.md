# For fabrikaa-merger: 1589 amended plan

The amended plan is committed on `fabrikalfa/kalfa-config-delivery` at `85eada364`, in
`docs/plan/quests/kalfa-config-delivery-PLAN.md`, with line one blank for your approval line.

- Body digest (sha256 of everything after the first two lines): `3e7221f27992`, in full
  `3e7221f279924beb293ec04cccc934a7093584c348a2c45904772c4b940e6095`.
- `plancheck.sh --draft` passes: 22 exam paths, all `.github/**` and owned by the tests step;
  0 product lines; 3 slices. The leak check is clean.
- It builds decisions 0602 and 0599 on the approved body `06fb72170771`. The open-questions
  section is "None.".

## What the amendment does

- P2 leaves every related leg (D1). Its build and test stay on main's full run, where
  `scheduled.yaml`'s `tests` job already runs `next-integration` on main.
- The keep moves to that job. A `package receipt` step after `vitest` runs on every numbered
  vitest leg, and each leg judges only its own Vitest report:
  - The leg whose report holds P2 checks the receipt, and a `package archive` upload keeps the
    two files.
  - Every other leg proves P2 is listed in `next-integration` and that no delivery folder was
    left. So a dropped or renamed P2 turns main red; it never fails silently.
- D2's event clause: the receipt keeps only on main's ref, on a push, the hourly catch-up or a
  hand start. It reads the runner's own `GITHUB_REF`, `GITHUB_EVENT_NAME` and `GITHUB_SHA`. It
  has a new `absent` verdict and two new refusals, `discovery` and `stray`.
- check.yaml drops `package receipt`, `package archive`, `id: integration` and the `archive`
  output, so `select` prints five outputs (D3, D4).
- `record.ts` goes back to its parent's bytes, so Q1 refuses any archive upload in check.yaml.
- The consumer fault (D5) stays on `related`, because P1 is a plain tooling law.
- A new SC21 in the scheduled guard pins the two new steps. SC9 gains only the receipt command.
- The merge of 7d38689ff keeps 1618's `Step`, `run(step)` and `projectsOf`, and lays 1589's
  code beside them.
- The build order follows the coordinator: everything outside the three `scheduled` paths is
  built now. The `scheduled.yaml` and scheduled-guard edits come only after ticket 1161 is on
  main and merged in.
- Follow-ups A and B2 need new plans: 0602 makes `related` tooling-only.

## The plan's own doubts

- It is 75% sure on keeping SC13's 3-minute backstop, since the step limits after the test step
  rise from 2 to 4 minutes.
- P2's first run at the merged head is main's first full run after the landing. A red P2 or a
  refused receipt there opens the `ci-scheduled` issue, a sev1. That loss is the one 0602
  accepts.

## Next

I start the merge commit and the tests step for part 1 now, and push nothing that needs your
signature before it is signed.
