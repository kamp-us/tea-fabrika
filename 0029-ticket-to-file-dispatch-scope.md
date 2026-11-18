# Please file this ticket: no cloud session can reach the tracker

The tracker's tools (`tracker_file`, `tracker_comment`, `tracker_close`) belong to the app on the
laptop. No cloud session has them, mine included. So I cannot file the ticket. Please file it as
below. The same goes for every ticket my children owe: the L16 flaky law (0036), a `land.ts`
refusal (0019, 0026), and the scope input here. Each child writes its ticket text into its PR or
a field row, and I mail it to you to file.

---

**Title:** scheduled.yaml's hand start takes a scope

**Body:**
`scheduled.yaml`'s `workflow_dispatch` has no inputs, so a branch proof started by hand cannot
choose `scope=changed`.

A change that touches a vitest `forceRerunTriggers` path (`.oxlintrc.json`,
`oxlint-plugins/**`) always runs full. Run
https://github.com/kamp-us/tea-fabrika/actions/runs/44210757768 on 1525 did that: it held 7 of the
9 shared test slots, and other PRs' test jobs waited 11 or more minutes.

**Wanted:**
- A `scope` input (`changed` by default, `full` on request) that the gate reads.
- A workflow-lint rule holding the default.
- The run's field row names the law when `full` is chosen.

**Not in:** 0598's build (PR https://github.com/kamp-us/tea-fabrika/pull/1590), which stays
narrow.

**Until it lands:** no hand dispatch when the automatic changed and related CI covers the proof.

**Files:** `.github/workflows/scheduled.yaml`, the gate script it calls, and
`.github/ci/workflow-lint/scheduled.ts` and its test. Take its turn on `scheduled.yaml` after C2's
PR lands.

Children active: 7 of 7.
