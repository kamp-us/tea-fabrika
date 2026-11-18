Approved by the lead agent, builds 0598-merge-line-leaves-scheduled-groups; body 39ca50eaa1ca
Plancheck-Version: 3

```yaml
# A sketch: the whole idea, today's CI. Decision 0598, amending 0595.
# check.yaml: next, select and related keep only the run's `check-<pr>` group; no job group.
# scheduled.yaml:
env:
  GAP_MINUTES: 60
  MAIN_SLOTS: 5               # a setting (0069): main's full run, scheduled-main-1..5
  PROOF_SLOTS: &proof-slots 4 # a setting: branch proofs, scheduled-proof-1..4; the two add up to 9
jobs:
  gate/select/report: { concurrency: { group: scheduled-control } }  # unchanged
  tests:   # main: scheduled-main-<pin>, 5 at once; a branch's full set: scheduled-proof-<pin>, 4 at once
  changed: # scheduled-proof-<proof.ts's rotation of PROOF_SLOTS groups by run number>, 4 at once
```

# Build 0598: the merge line leaves the scheduled job groups (Sev 1 issue 1333, lane C2)

Today's version: CI tooling only (`.github/`), plus one glossary row. Ticket: to be filed (a ready
title and body are in the report). Builds
[0598](https://github.com/kamp-us/tea-fabrika/pull/1586) (on branch
`fabrikalfa/decision-0598-merge-line-slots`, not on main yet), which amends
[0595](../../../.decisions/0595-scheduled-runs-share-slots.md). Also follows
[0581](../../../.decisions/0581-main-full-run-starts-on-push-and-hourly.md),
[0590](../../../.decisions/0590-a-branch-proof-run-runs-only-what-its-change-reaches.md) and
[0069](../../../.decisions/0069-choices-are-settings.md). 0595's status line
(`amended-in-part by 0598`) is already in pull request 1586's diff, so this plan does not touch
`.decisions/`.

## Doubt first: three edits outside the coordinator's grant

**Answered 2026-11-18, before approval:** the coordinator of issue 1333 said yes to all four
edits marked "Needs the owning lane's yes" below (related.ts's `run`, related-selection.test.ts's
run argument and loop, check.yaml `select`'s `slots:` and `RUN_NUMBER:`, and
wiring.test-support.ts). Each edit is held to exactly the lines this plan lists; every other line
of check.yaml's `select` block stays as it is, since another lane later adds outputs after
`plants`. The fallback below is not taken. The two lint replacements named under "Is anything
loosened?" go in the pull request's description under their own heading, and the review confirms
that each replacement holds at least what the old rule held for every case 0598 keeps.

The coordinator lifted the hold and granted, in `.github/ci/related.ts`, only "its import and use
of proof.ts `slots`", and in `.github/ci/related-selection.test.ts` only "its nine-group
assertion". Removing just those leaves dead code and one red test, because `slots(run)` is also the
only thing that checks `RUN_NUMBER` there:

- `select`'s `run` parameter (related.ts line 26) is then read by nothing, and the main block still
  reads `RUN_NUMBER` (line 94) and passes it (line 160).
- `related selection refuses ambiguous file lists and invalid run numbers`
  (related-selection.test.ts lines 213 to 215) goes red: nothing throws on a bad run number any
  more.
- check.yaml's `select` keeps `slots:` (line 543) and `RUN_NUMBER:` (line 558), which then feed
  nothing.

**Lean, 75%: take the whole cleanup** (the extra lines listed under "Needs the owning lane's yes"
below). It is what 0598 leaves behind once the related job has no group, and nothing else reads a
run number there. The doubt is ownership, not design. If the yes is refused, the fallback is to
keep `run` and check it with a small exported `runNumber` in proof.ts. That leaves a checked value
nothing reads, which gets its own finding row. The plan below is written for the lean.

A third edit is outside both grants and cannot be avoided:
`.github/ci/workflow-lint/wiring.test-support.ts` `setLegs` (lines 158 to 168) writes a
`scheduled-test-` group onto the fixture's `next` job. 0598's lint rule ("check.yaml carries no
`scheduled-` group") rejects that, so every generated wiring workflow would fail. The edit: drop
that assignment, and line 395's copy of the real `next` job's group.

## Calls taken

- **The `tests` matrix order becomes the start order: `tooling-1, 3, 2, 5, tooling-2, e2e-2, 1,
  4, e2e-1`. 85%.** 0598's pins say "then": tooling-1 then e2e-1 in group 1, and so on. A group is
  a first-in, first-out queue (`queue: max`), filled in the order the matrix makes jobs. With
  today's order (`e2e-1, e2e-2, 1, ...`) and `max-parallel: 5`, the first five jobs made would be
  e2e-1, e2e-2, 1, 2 and 3. Legs 1 and 2 both pin to group 3, so leg 2 waits while group 5 sits
  empty. In the new order the five longest legs are made first, one per group. Each later leg comes
  in the order its group frees up in run 44155250216: tooling-2 ends first (9.3 min), then leg 5
  (10.1), leg 2 (10.7), leg 3 (11.6) and tooling-1 (11.7). Each time a group frees, the next job
  made is pinned to that same group. That holds whether or not GitHub counts a job waiting on a
  group against `max-parallel`. The doubt: GitHub's docs do not say a matrix makes its jobs in list
  order. The real run after the merge shows it (Real-run proof).
- **A full set on a branch pins to four proof groups by longest-processing-time first over the
  same leg times: tooling-1 and 4 to group 1, legs 3 and 1 to group 2, legs 2 and e2e-2 to group 3,
  legs 5 and tooling-2 to group 4, and e2e-1 to group 1. 85%.** 0598 does not list these pins.
  Longest-processing-time first is the textbook greedy answer for jobs on identical machines
  (Graham, 1969). With the matrix order above, the first four legs take groups 1 to 4, and each
  later leg goes to the group that frees first. The makespan is about 26 minutes of legs, against
  0598's "about 28" with setup.
- **`tests`'s `max-parallel` is `${{ github.ref == 'refs/heads/main' && 5 || 4 }}`, and lint holds
  the two numbers equal to `MAIN_SLOTS` and `PROOF_SLOTS`. 90%.** GitHub's
  [context availability table](https://docs.github.com/en/actions/reference/workflows-and-actions/contexts#context-availability)
  gives `jobs.<job_id>.strategy` only `github, needs, vars, inputs`, and
  `jobs.<job_id>.concurrency` only `github, needs, strategy, matrix, inputs, vars`. Neither may read
  `env`. Read from the docs' source, `content/actions/reference/workflows-and-actions/contexts.md`
  in `github/docs` on raw.githubusercontent.com, since docs.github.com did not resolve from this
  session. A YAML alias cannot sit inside a `${{ }}` string, and `tests` needs a different count per
  ref, so lint makes the two counts one setting there. `vars` would let the expression read the
  counts, but a repository variable lives in Settings, not in `scheduled.yaml`, and 0598 says
  "declared once in `scheduled.yaml`".
- **`changed`'s `max-parallel` and `select`'s `MOST` are aliases of `PROOF_SLOTS`
  (`&proof-slots`), and proof.ts rotates over `MOST`. 80%.** The file already aliases across jobs
  (`&most`, `*next-limit`), and runs 44155250216 and 44155342361 ran it, so a top-level anchor works
  the same way. Rotating over `MOST` adds no environment variable for SC17 to admit. Lint holds
  `MOST == PROOF_SLOTS == changed's max-parallel`, so the legs never outnumber the groups. The doubt:
  a later wish for fewer legs than groups would have to split them again.
- **`MAIN_SLOTS` gets no anchor.** Nothing can alias it: its only readers are a `${{ }}` string and
  the pin map, which lint checks. 95%.
- **check.yaml's `related` keeps `max-parallel: 9`, and R1 keeps checking it.** 0598 changes only
  groups. A cap of nine legs at once stays a cap, now inside the organization's runner pool. 90%.
- **Rule numbers: SC6, SC16, SC17 and SC19 change in place, SC20 is new (the start order, in place
  of SC7's and SC8's order clauses), R1 changes in place and R2 is new.** This keeps every message
  that is not about groups, so the mapping table stays short. 90%.
- **merge-line.ts and merge-line.test.ts need no edit.** merge-line.ts holds no group rule. It calls
  `relatedWorkload` (workflow-lint/related.ts) for T1's tooling permission, and that check changes
  from "related holds the nine groups" to "related holds no group". Its tests plant no concurrency
  (`rg -n concurrency .github/ci/workflow-lint/merge-line.test.ts` finds nothing). 90%.

## How others do it

- **GitHub Actions.** A job `concurrency` group admits one running job per name and queues the
  rest; `queue: max` keeps up to 100 waiting, first in, first out (this file's own comment, from
  "Control the concurrency of workflows and jobs"). `strategy.max-parallel` caps one matrix in one
  run. There is no priority and no pool primitive. A pool of N is N named locks, and two workloads
  that must not block each other get disjoint names. That is 0598's split. Cited from 0598's
  sources; docs.github.com was not reachable here, so only the context table above was read, from
  its source.
- **Buildkite and GitLab** (from 0598, not fetched here): pre-merge work gets its own agent queue
  (Buildkite's queues and priorities), and only jobs that truly share one resource are serialized
  (GitLab's resource groups). Test legs share no resource, only a budget.
- **Erlang/OTP**, as the repo asks first: two workloads that must not starve each other get two
  pools under their own supervisors (poolboy-style pools, one per job kind), never one pool with a
  priority bolted on. Five plus four groups are two fixed pools; the control group is a third pool
  of one.
- **YAML anchors** are document-wide (YAML 1.2, section 3.2.2.2). This file already aliases a step's
  `env` value into another job's `strategy` (`&most` into `changed`).

## The shape

### scheduled.yaml, after (a sketch: exact keys, comments shortened)

```yaml
env:
  GAP_MINUTES: 60
  # The ten-job budget (0595, 0598): MAIN_SLOTS groups for main's full run, PROOF_SLOTS for branch
  # proofs, and scheduled-control. Change them here, keeping MAIN_SLOTS + PROOF_SLOTS = 9; then
  # re-pin `tests` (its two maps and max-parallel) to the new counts. workflow-lint.ts holds it
  # (SC16, SC19, SC20).
  MAIN_SLOTS: 5
  PROOF_SLOTS: &proof-slots 4

jobs:
  tests:
    concurrency:
      group: ${{ github.ref == 'refs/heads/main' && 'scheduled-main-' || 'scheduled-proof-' }}${{ fromJSON(github.ref == 'refs/heads/main' && '{"tooling-1":"1","3":"2","2":"3","5":"4","tooling-2":"5","e2e-2":"4","1":"3","4":"2","e2e-1":"1"}' || '{"tooling-1":"1","3":"2","2":"3","5":"4","tooling-2":"4","e2e-2":"3","1":"2","4":"1","e2e-1":"1"}')[matrix.shard] }}
      queue: max
      cancel-in-progress: false
    strategy:
      fail-fast: true
      max-parallel: ${{ github.ref == 'refs/heads/main' && 5 || 4 }}
      matrix:
        shard: ["tooling-1", "3", "2", "5", "tooling-2", "e2e-2", "1", "4", "e2e-1"]
  select:
    # ...unchanged, but:
    steps:
      - id: set
        env:
          MOST: *proof-slots
          LIMIT: *next-limit
          RECORD: ${{ runner.temp }}/proof-set.json
          RUN_NUMBER: ${{ github.run_number }}
  changed:
    concurrency:
      group: scheduled-proof-${{ fromJSON('{"1":"1","2":"2","3":"3","4":"4"}')[fromJSON(needs.select.outputs.slots)[matrix.shard]] || '1' }}
      queue: max
      cancel-in-progress: false
    strategy:
      fail-fast: true
      max-parallel: *proof-slots
```

The header comments change with it: "Nine shared test groups and one control group..." becomes the
5, 4 and 1 split, and the budget comment ("10 machines at most") names the groups as the
cross-run cap and `max-parallel` as the per-run cap.

### proof.ts, after (a sketch)

```ts
/** A full permutation of `count` groups, offset by the run number. A retry keeps its run number. */
const slots = (run: number, count: number): Record<string, string> => {
  // run: Schema.Int > 0, else throw "proof: RUN_NUMBER ..." (as today)
  // count: Schema.Int > 0, else throw "proof: MOST ..." (new)
  const offset = run % count;
  return Object.fromEntries(
    Array.from({ length: count }, (_, i) => [String(i + 1), String(((i + offset) % count) + 1)]),
  );
};

/** ...and `slots`, the proof groups rotated by the run number: `count` is MOST, PROOF_SLOTS. */
export const outputs = (proof: Proof, run: number, count: number): string[] => [/* as today */];

// main: const run = whole("RUN_NUMBER", ...); const most = whole("MOST", ...);
//       const groups = slots(run, most);  sizing.most = most;  outputs(proof, run, most)
```

`slots` loses its `export`: once related.ts stops importing it, nothing outside proof.ts reads it,
and an unused export fails `pnpm lint:dead`
([0006](../../../.decisions/0006-no-unused-exports.md)). The record keeps `slots`, as today.

### workflow-lint/scheduled.ts, the slot rules (a sketch)

```ts
const BUDGET = 10;                 // 0595's binding constraint, unchanged (was RUNNERS)
const MAIN = "scheduled-main-";
const PROOF = "scheduled-proof-";
const OLD = "scheduled-test-";     // 0595's names, refused anywhere in scheduled.yaml

type Pins = { readonly main: Record<string, string>; readonly proof: Record<string, string> };

/** The two closed maps of `tests`'s group, or none: only the exact ref-conditional form reads. */
const pinsOf = (group: unknown): Pins | undefined => { /* one regex on compact(group); Schema decode */ };

// SC16: env keys are exactly GAP_MINUTES, MAIN_SLOTS, PROOF_SLOTS; the gap as today; each count a
//       whole number of 1 or more, as a number, not text.
// SC19: five jobs; gate/select/report in scheduled-control (as today); every group: three keys,
//       queue max, cancel-in-progress false (as today);
//       tests: pinsOf(group) holds; main's keys are the matrix's legs, its values cover exactly
//       1..MAIN_SLOTS; proof's keys likewise, values exactly 1..PROOF_SLOTS;
//       changed: scheduled-proof- + the closed identity lookup over 1..PROOF_SLOTS on
//       needs.select.outputs.slots with `|| '1'`; select passes RUN_NUMBER and outputs slots
//       (now required, no longer optional); MOST == PROOF_SLOTS == changed's max-parallel;
//       MAIN_SLOTS + PROOF_SLOTS + 1 == BUDGET;
//       no group anywhere holds OLD; the workflow group holds no reserved name
//       (control, main-1..M, proof-1..P).
// SC6:  tests' max-parallel is exactly `${{ github.ref == 'refs/heads/main' && M || P }}`, and the
//       per-run count at its step of the needs chain uses the larger of M and P.
// SC20: the matrix is exactly check.yaml's full next legs and tooling-1..N, each once; its first
//       MAIN_SLOTS legs pin to main groups 1..MAIN_SLOTS in order, and its first PROOF_SLOTS legs to
//       proof groups 1..PROOF_SLOTS in order, so no group sits empty at the start.
```

The `--job-slots` command line (`jobSlots`) runs SC16's counts, SC19 and SC20, so the lead's proof
preflight (`.agents/skills/lead/scripts/ci/RunsGh.ts`, unchanged) checks the new shape.

### workflow-lint/related.ts, after (a sketch)

```ts
/** No job-level group at all: 0598 takes the merge line out of the scheduled groups. */
const ungrouped = (job: Record<string, unknown>) => Object.keys(map(job["concurrency"])).length === 0;

// selector: ungrouped(select), related.ts, HEAD, outputs exactly run, legs, files, projects, plants
// relatedWorkload (T1): ungrouped(job) in place of mapped(job)
// R1: next, select and related are ungrouped; related keeps max-parallel 9 and its one axis
// R2: no check.yaml job holds a group that starts `scheduled-`, in any case
```

`lookup`, `held`, `mapped` and the nine-entry `slots` constant go.

## One value traced through

A proof run started by hand on a branch whose change reaches 13 tooling test files, with run
number 1203.

1. The workflow group is `scheduled-refs/heads/<branch>`, as today (SC2).
2. `gate` takes `scheduled-control` and says `start=true`.
3. `select` takes `scheduled-control`. proof.ts reads `MOST=4` (the alias of `PROOF_SLOTS`),
   `LIMIT=17` and `RUN_NUMBER=1203`. Vitest lists the 13 files, and `legsOf` splits them into at
   most 4 legs, say 3: `"1"`, `"2"`, `"3"`. Then `slots(1203, 4)`: 1203 mod 4 is 3, so
   `{"1":"4","2":"1","3":"2","4":"3"}`. The outputs are `scope=changed`, `legs=["1","2","3"]`,
   `files=...` and `slots={"1":"4","2":"1","3":"2","4":"3"}`.
4. `changed (1)`'s group: `fromJSON(slots)["1"]` is `"4"`, the identity lookup gives `"4"`, so
   `scheduled-proof-4`. Leg 2 gets `scheduled-proof-1` and leg 3 `scheduled-proof-2`. At most 4 run
   at once (`max-parallel: 4`).
5. A main full run started at the same minute holds `scheduled-main-1` to `5` and
   `scheduled-control`. The proof's legs share no group with it, so they start at once. Only the
   two control jobs can meet, and each holds the group for seconds to about two minutes.
6. `report` takes `scheduled-control` and judges the run.

Main's side: a push to main whose gate says `true` runs `tests` with `github.ref ==
'refs/heads/main'`. Leg `3` takes `scheduled-main-2`, five legs run at once, and e2e-2 joins
`scheduled-main-4`'s queue after leg 5.

## Laws

| Law | Kind | Generator | Plant that must fail | Law lives in | Runs |
|---|---|---|---|---|---|
| P1: for any group count from 1 to 9, any run number and any leg count up to the group count, `slots=` is a full permutation of `1..count`, leg 1's group is `run mod count` plus 1, each next leg's is the next group, `count` consecutive runs send every leg to every group, and the legs and files are unchanged | test | fc.record: count 1..9, run 1..2^53-10, files 9 unique paths; seed 119120, 100 runs | Keep `% 9` in `slots`: count 4 gives a group past 4 | `.github/ci/proof.test.ts` | the merge line (tooling change), the full run |
| P2: a group count that is not a positive whole number (0, negative, fractional, NaN, infinite) throws `MOST` before any output | test | fc.integer: 1..1e6, and its zero, negative, fractional, NaN and infinite forms; seed 119120, 100 runs | Drop the count check: `% 0` prints `slots={"1":"NaN"}` | `.github/ci/proof.test.ts` | the merge line, the full run |
| P3: `outputs(proof, run)` without a count does not compile: a `// @ts-expect-error` on the two-argument call, beside today's one-argument line | type | type | Give `count` a default of 9: the expect-error line is unused and typecheck fails | `.github/ci/proof.test.ts` | typecheck |
| P4: today's run-number law with the new signature: a broken run number throws `RUN_NUMBER` before any output, for every proof kind | test | fc.integer: 1..1e6, as today; seed 119120, 100 runs | Accept run 0 | `.github/ci/proof.test.ts` | the merge line, the full run |
| P5: the real select's `MOST` is 4, and the pinned outputs of the full set and the zero set carry the 4-group identity at run 8 | test | pinned: the real `scheduled.yaml`'s select step and 0598's count | Leave `MOST: &most 9` | `.github/ci/proof.test.ts` | the merge line, the full run |
| S1: any split of nine into `MAIN_SLOTS` (1 to 8) and `PROOF_SLOTS`, with main and proof pins whose first legs take groups 1..N in order and whose other legs take any group, the rotation over `PROOF_SLOTS`, `MOST`, both `max-parallel`s and today's spacing, case and minute variations, passes all of lintScheduled | test | fc.tuple: split, the two pin tails, cron minute, gap, spacing, case, string or number values; seed 119120, 100 runs | Keep the nine-slot `TEST_SLOTS` in SC19: every split fails | `.github/ci/workflow-lint/scheduled.test.ts` | lint, the merge line, the full run |
| S2: each slot plant on a generated valid schedule gives SC19's error, alone: the main map loses a leg, gains a leg, names group M+1, leaves a main group unused; the proof map names group P+1 or leaves one unused; a group gains a `-${{ github.run_id }}`, `-${{ github.ref }}` or `-${{ github.run_attempt }}` suffix; `tests` uses `scheduled-test-`; `tests`'s condition reads `github.event_name == 'push'`; `changed` uses `scheduled-main-`; the rotation runs over nine; `MOST` differs from `PROOF_SLOTS`; `changed`'s `max-parallel` differs from it; the counts add up to 10; a count is `"4"` as text; the workflow group is `SCHEDULED-MAIN-1`; plus today's control, queue, cancel, extra-job and rotation plants | test | fc.tuple: S1's generator, each plant applied alone; seed 119120, 100 runs | Drop the "value in 1..M" check: group M+1 passes | `.github/ci/workflow-lint/scheduled.test.ts` | lint, the merge line, the full run |
| S3: SC16 admits exactly `GAP_MINUTES`, `MAIN_SLOTS` and `PROOF_SLOTS`; a fourth env value, a missing count, or a count of 0 fails | test | fc.tuple: S1's generator, and today's gap property kept; seed 119120, 100 runs | Admit any extra key: `FABRIKA_TEST_DEPTH` in env passes | `.github/ci/workflow-lint/scheduled.test.ts` | lint, the merge line, the full run |
| S4: SC20: swapping a first leg with a later one (so a group gets two legs before another gets one), a leg listed twice, a next leg missing, or a tooling leg renamed gives SC20's or SC7/SC8's error | test | fc.tuple: S1's generator and a swap index drawn from 0..M-1 and M..8; seed 119120, 100 runs | Drop the "first legs in order" check: a swap of `tooling-1` and `e2e-2` passes | `.github/ci/workflow-lint/scheduled.test.ts` | lint, the merge line, the full run |
| S5: the real scheduled.yaml's matrix order, both pin maps and both counts are exactly 0598's | test | vector: decision 0598's pins, measured from run 44155250216, and the proof pins this plan derives from it | Pin e2e-1 before tooling-1 in group 1 | `.github/ci/workflow-lint/scheduled.test.ts` | lint, the merge line, the full run |
| S6: SC6: `tests`'s `max-parallel` as any number, or as the ref expression with the two numbers swapped, gives SC6's error; the per-run budget counts the larger count | test | fc.tuple: S1's generator, and today's SC6 plants kept; seed 119120, 100 runs | Accept any whole number for `tests`'s `max-parallel`: `max-parallel: 9` passes | `.github/ci/workflow-lint/scheduled.test.ts` | lint, the merge line, the full run |
| S7: the stdin command line prints the success sentinel for any valid split, and refuses a private group, an extra job, a changed matrix past `PROOF_SLOTS`, and the old 0595 shape (main's scheduled.yaml at 955a82d), so a branch not yet on main's shape is refused at preflight | test | fc.record: split, case, workflow group, 100 runs; and one pinned case, the old shape, read from git at base 955a82d (a branch that never took this change) | Let `scheduled-test-` through `jobSlots`: the old shape prints the sentinel | `.github/ci/workflow-lint/scheduled.integration.test.ts` | the full run |
| R1: on the real check.yaml, each plant alone fails lintWorkflow: `next`, `select` or `related` gains any job-level group (`scheduled-test-1`, `scheduled-proof-1`, `scheduled-control`, or `related-${{ github.run_id }}`); today's workload and selector plants kept | test | fc.constantFrom: the Fault literal union, each plant applied alone; seed 119120, 100 runs | Keep `held(next)` as the next rule's only check: a next job with a group passes | `.github/ci/workflow-lint/related.test.ts` | lint, the merge line, the full run |
| R2: a check.yaml job other than the three (`typecheck`) given a `scheduled-main-1` group fails | test | fc.constantFrom: one more Fault case in the same union; seed 119120, 100 runs | Check only next, select and related: the typecheck plant passes | `.github/ci/workflow-lint/related.test.ts` | lint, the merge line, the full run |
| R3: related selection keeps both missing projects exactly once, at most seven legs, with no group map in its outputs | test | fc.integer: 0..30 files per project and a run number, as today; seed 119120, 100 runs | Keep `slots=` in `outputs`: the output keys differ | `.github/ci/related-selection.test.ts` | the merge line, the full run |
| W1: the generated wiring workflows (`wiring.test-support.ts`) still pass, with no group on `next` | test | fc.tuple: the `wiring` generator, as today; default runs | Keep `setLegs`'s group: R1 and R2 fail every generated workflow | `.github/ci/workflow-lint.test.ts` and its users | lint, the merge line, the full run |

No law needs the real machine. S7 spawns `node` on stdin text only, as today's file does, and its
file is already `.integration.`. Every other law runs on parsed YAML. Each law runs before the
review in CI, and nothing waits on the owner's Mac.

### Removed and Replacement (for loosening.sh)

Plant names below are the `%s` of `rejects the schedule's plant: %s` in scheduled.test.ts.

| Removed | Replacement |
|---|---|
| `property: SC19 accepts the run-number rotation through a closed nine-slot lookup` | `property: SC19 accepts any split of nine test groups into MAIN_SLOTS and PROOF_SLOTS, with pins that start every group at once and the proof rotation through a closed lookup` (S1) |
| `rejects the schedule's plant: SC19: rotation reaches a tenth slot` | `rejects the schedule's plant: SC19: rotation reaches a proof group past PROOF_SLOTS` |
| `rejects the schedule's plant: SC19: the full slot map reaches a tenth test slot` | `rejects the schedule's plant: SC19: the main pins reach a group past MAIN_SLOTS` |
| `rejects the schedule's plant: SC19: changed can name a tenth test slot` | `rejects the schedule's plant: SC19: changed can name a proof group past PROOF_SLOTS` |
| `rejects the schedule's plant: SC19: the workflow holds a test job's group` (value `SCHEDULED-TEST-1`) | the same title, value `SCHEDULED-MAIN-1`, plus `rejects the schedule's plant: SC19: the workflow holds a proof job's group` (`SCHEDULED-PROOF-1`) |
| `rejects the schedule's plant: SC8: a tooling leg comes before the next legs` | `rejects the schedule's plant: SC20: a first leg swaps with a later one, so a group waits while another is empty` (S4) |
| `rejects the schedule's plant: SC6: one more leg at once than the cap holds` (`tests` max-parallel 10) | `rejects the schedule's plant: SC6: the test job's max-parallel is a number, not the count of its ref` (S6) |
| SC7's "first" clause in `lintScheduled` (rule text, no test title) | SC20's order rule and S5's pinned order |
| SC8's "after the next legs" clause (rule text) | SC20 and S5 |
| SC16 "the workflow's env is GAP_MINUTES alone" (rule text, same plant titles) | SC16 "GAP_MINUTES, MAIN_SLOTS and PROOF_SLOTS, nothing else" |
| SC17's optional `slots` and `RUN_NUMBER` (rule text) | both required (stricter) |
| `property: changed-leg rotation visits every shared slot and preserves all leg counts` | `property: changed-leg rotation visits every proof group, for any group count, and preserves all leg counts` (P1; count 9 is still one of its cases) |
| `property: invalid or missing run numbers fail before any proof output` | the same title, with the count argument (P4), plus `property: an invalid group count fails before any proof output` (P2) |
| `automatic related coverage rejects omitted workloads, unbounded pools and false-green selectors` (plants `next_pool`, `related_pool`, `private_group`, `cancel`) | `automatic related coverage rejects omitted workloads, merge-line job groups and false-green selectors` (plants `next_group`, `related_group`, `select_group`, `own_group`, `other_group`) (R1, R2) |
| R1 "related jobs share only the existing nine test groups with a bounded fallback" and "existing next and visual jobs share the same nine test groups, with no independent pool" (rule text) | R1 "next, select and related take no job group (0598)" and R2 "no check.yaml job holds a scheduled- group" |
| `related selection preserves both missing projects exactly once within the shared slots` | `related selection preserves both missing projects exactly once` (R3; needs the owning lane's yes) |
| `related selection refuses ambiguous file lists and invalid run numbers` | `related selection refuses ambiguous file lists` (needs the owning lane's yes; the run number is no longer read) |
| `property: the stdin CLI confirms shared job slots without requiring full-workflow conformance` (nine-slot generator) | the same title, with the split generator (S7) |
| `property: the stdin CLI refuses extra jobs and changed matrices that leave the shared budget` | the same title, with the split generator, plus `pinned: the stdin CLI refuses the 0595 shape, so a branch not yet on main's refuses preflight` (S7) |

**Is anything loosened?** No gate. Every leg still runs at full depth, the selected set is 0590's,
and the timeouts, fail-fast, required checks and the report are untouched. Lint is looser in two
places: no group is required on check.yaml's three jobs, and SC7 and SC8 no longer fix one leg
order. 0598 decides the first, and R1 and R2 replace it with "no group at all", which is just as
exact. SC20 plus S5's pinned order replace the second: the real file's order is still fixed by a
law, and SC20 adds a property the old order did not have (no group sits empty at the start).
`scheduled.yaml`'s cap is unchanged at 10 across runs. Stated for the lead's hand check.

## Files

| File | Change | Product lines expected | Owner | Slice | How judged |
|---|---|---|---|---|---|
| `.github/workflows/check.yaml` | Line 417's comment: "No test job takes a job group (0598)"; drop `next`'s `concurrency` (lines 419 to 422); line 528's comment loses "shares the schedule's one control group"; drop `select`'s `concurrency` (lines 530 to 533) and `related`'s (lines 576 to 579). Needs the owning lane's yes: drop `select`'s `slots:` output (line 543) and its `RUN_NUMBER:` env (line 558) | 14 | tests | 1 | 0598; R1, R2 |
| `.github/ci/workflow-lint/related.ts` | Line 1's comment; the `slots` constant, `lookup`, `held` and `mapped` (lines 15 to 39) give way to `ungrouped`; `selector` (lines 50 to 58): no group, no `slots` output, no `RUN_NUMBER`; `relatedWorkload` line 72: `ungrouped(job)`; line 106 and lines 170 to 180: R1 "takes no job group"; R2, new | 40 | tests | 1 | 0598's Lint bullet |
| `.github/ci/workflow-lint/related.test.ts` | Plants `next_pool`, `related_pool`, `private_group`, `cancel` become `next_group`, `related_group`, `select_group`, `own_group`, and `other_group` is new; the title changes (mapping table) | tests | tests | 1 | R1, R2 |
| `.github/ci/workflow-lint/wiring.test-support.ts` | Needs the owning lane's yes: `setLegs` (lines 158 to 168) stops writing a group on `next`; line 395 stops copying it | tests | tests | 1 | W1 |
| `.github/ci/related.ts` | Granted: drop `slots` from the import (line 11), `const groups = slots(run);` (line 29), `slots: groups` (line 81), the `slots=` output (line 89) and `slots(run);` (line 95). Needs the owning lane's yes: drop the `run` parameter (line 26), `const run = ...` (line 94) and `run` in the call (line 160) | 8 | tests | 1 | R3 |
| `.github/ci/related-selection.test.ts` | Granted: drop the nine-group assertions (lines 168, 170 and 179) and "within the shared slots" from the title (line 144). Needs the owning lane's yes: drop the run argument from every `select` call (lines 28, 58, 60, 79, 121, 156, 196, 207, 210 and 214), the `run` input (lines 148 and 150), the invalid run loop (lines 213 to 215), and "and invalid run numbers" from line 202's title | tests | tests | 1 | R3 |
| `.github/ci/proof.ts` | Slice 1: `slots` loses its `export`. Slice 2: `slots(run, count)` with a checked count; `outputs(proof, run, count)`; the main block reads `MOST` before git and rotates over it; the doc comments say proof groups, not nine shared ones | 20 | tests | 1, 2 | P1 to P5 |
| `.github/ci/proof.test.ts` | P1 replaces the nine-slot rotation law; P2 and P3 are new; P4 and P5 follow the new signature and the real `MOST` of 4 | tests | tests | 2 | laws |
| `.github/workflows/scheduled.yaml` | `MAIN_SLOTS` and `PROOF_SLOTS` in `env`; `tests`'s ref-conditional group, its `max-parallel` and its matrix in start order; `MOST: *proof-slots`; `changed`'s proof group and `max-parallel: *proof-slots`; the header and budget comments | 40 | tests | 2 | 0598; SC6, SC16, SC19, SC20 |
| `.github/ci/workflow-lint/scheduled.ts` | SC16, SC17, SC19 and SC6 as in the sketch; SC20, new; `pinsOf` in place of `slotsOf` and `rotationOf`; `BUDGET` in place of `RUNNERS` and `TEST_SLOTS`; the header says SC1 to SC20; `jobSlots` checks SC16's counts and SC20 too | 150 | tests | 2 | 0598's Lint bullet |
| `.github/ci/workflow-lint/scheduled.test.ts` | The `scheduled` generator draws a split and its pins; `changedRotation` and `remap` follow it; S1 to S6; the plants in the mapping table | tests | tests | 2 | laws |
| `.github/ci/workflow-lint/scheduled.integration.test.ts` | The `Workflow` schema draws a split, not nine slots; S7's pinned old shape | tests | tests | 2 | S7 |
| `.glossary/TERMS.md` | The `full run` row: in place of "Runs wait in one line, the `scheduled` concurrency group, until 0595's verified cutover", say each ref's runs wait in their own `scheduled-<ref>` group; main's legs take `scheduled-main-1` to `MAIN_SLOTS`, a proof's legs `scheduled-proof-1` to `PROOF_SLOTS`, and the gate, select and report `scheduled-control`, ten jobs at most (0595, 0598) | docs | build | 3 | 0598's Consequences |
| `.github/ci/workflow-lint.test.ts` | Not changed: it runs the `wiring` generator, so W1 lives here | 0 | tests | none | W1 |
| `.github/`, `.github/**`, `.github/ci/workflow-lint`, `.github/ci/workflow-lint/` | Named only: folders and globs the prose names; every file changed in them is its own row | 0 | tests | none | not files |
| `.github/ci/workflow-lint/merge-line.ts`, `.github/ci/workflow-lint/merge-line.test.ts` | Not changed: no group rule there; T1 follows `relatedWorkload` | 0 | tests | none | read by hand |
| `.agents/skills/lead/scripts/ci/RunsGh.ts`, `.agents/skills/lead/scripts/ci/preflight.ts` | Not changed: they run `scheduled.ts --job-slots`, whose interface stays | 0 | tests | none | read only |
| `.github/ci/changes.mjs`, `.github/ci/legs.ts`, `vitest.shards.full.json`, `vitest.config.ts` | Not changed: not this lane's, and not needed (read for the leg times and rerun triggers) | 0 | tests | none | read only |

### Commit order

All of it is one pull request, in two commits, each with every check honest:

1. **Slice 1, the merge line leaves the groups:** check.yaml, workflow-lint/related.ts and its
   test, wiring.test-support.ts, related.ts, related-selection.test.ts, and proof.ts's dropped
   `export`. scheduled.yaml still has 0595's nine groups, which only it uses now, so SC19 still
   passes. No rule ties scheduled.yaml's groups to check.yaml's: SC7 reads check.yaml's next legs
   (`legs(nextJob(check))`), never its groups, and R1 reads only check.yaml. So this commit is green
   on its own.
2. **Slice 2, the scheduled split:** scheduled.yaml, proof.ts, proof.test.ts, scheduled.ts and its
   two tests. It must come second: the new `slots(run, count)` would break related.ts's
   `slots(run)` if slice 1 had not removed that call.
3. **Slice 3, the glossary row** (build).

The reverse order cannot land apart, for the reason in item 2.

## Existing tools

- `.github/ci/proof.ts` `slots`: changed, not new. It gains a count. Searched proof.ts, legs.ts
  and `effect` (`Schema.Int`, `isGreaterThan`) for a rotation helper; the existing function is the
  one.
- `.github/ci/workflow-lint/scheduled.ts` `pinsOf`: new function in an existing file, replacing
  `slotsOf` and `rotationOf`. Searched `workflow-lint/shared.ts` (`map`, `compact`, `legs`,
  `numbered`, `ends`) and the `yaml` and `effect` packages. `compact` and
  `Schema.fromJsonString` are reused; no helper reads a ref-conditional expression, so the regex is
  ours, as `slotsOf`'s is today.
- `.github/ci/workflow-lint/scheduled.ts`, SC20's order check: new lines in an existing function,
  `lintScheduled`. Searched shared.ts for a matrix-order helper; `listed` (scheduled.ts) gives the
  list and is reused.
- `.github/ci/workflow-lint/related.ts` `ungrouped`: new function in an existing file, replacing
  `held`, `mapped` and `lookup`. Searched shared.ts; `map` is reused, and none checks that a key is
  absent.

## Is this a setting?

- `MAIN_SLOTS` and `PROOF_SLOTS`: yes, 0598 makes them one (0069). Declared once in
  `scheduled.yaml`'s `env`. GitHub forbids `env` in `strategy` and job `concurrency`, so lint holds
  the copies equal: `MOST` and `changed`'s `max-parallel` alias `PROOF_SLOTS`, and `tests`'s
  `max-parallel` numbers and pin maps are checked against both counts (SC6, SC19, SC20).
- The pins: not a setting. They are measured data that follow the counts and the leg times. 0598
  says they refresh with `vitest.shards.full.json`; SC19 and SC20 hold their shape.
- `BUDGET` (10): not a setting. 0595's binding constraint fixes it, and the lint constant names it,
  as `RUNNERS` does today.
- `related`'s `max-parallel: 9`: unchanged, and not 0598's to touch.

## Records

- What a fact lost would be: which physical group each changed leg held. The `proof-set` artifact
  already records `slots`, and it keeps doing so with four groups.
- Main's pins are in the workflow at each commit, so a run's groups can be rebuilt from its head.
- Not recorded by any job: each leg's queue time (job `created_at` to `started_at`), which 0598's
  doubt needs. The Actions API keeps it only as long as the run's logs are kept. That is outside
  this plan, and the report says so (no finding rule fits a missing record).

## Validation

The tests step, on its own files, in order: `pnpm format`; `pnpm lint` (which runs workflow-lint
and `lint:dead`); `nice -n 15 pnpm exec vitest run --maxWorkers=3` on the test files it changed, while working,
narrow paths only. The lead runs the one pass over everything the branch changed and the one
type check (P3 is a type law). The build step runs `pnpm lint` for the glossary row.

## Real-run proof

What each run shows comes from the Actions API, per job: `created_at`, `started_at`,
`completed_at`, via `gh api repos/kamp-us/tea-fabrika/actions/runs/<id>/jobs`. The API does not
name a job's group. A group shows as a wait: a job made and not started while another job pinned to
the same group runs.

Before the merge:

1. **The pull request's own check run** (check.yaml from the branch): every `next (k)` and
   `related (k)` leg starts within about 0.1 minutes of `created_at`, as jobs outside the groups
   did on 2026-11-17. That holds even while a main full run holds main's groups. This proves the
   merge line left the groups.
2. **One proof run of scheduled.yaml on this branch** (workflow_dispatch, ref the branch). Its
   change touches no rerun trigger (`.github/**` is not one in `vitest.config.ts`), so it runs
   `changed` legs. It shows at most 4 legs (`MOST=4`), their `slots` in the `proof-set` artifact
   matching `run_number mod 4`, and legs that start at once even when a main full run is running.
   The preflight catch: the lead's preflight (`RunsGh.ts`) runs the trusted linter from the lead's
   checkout. Before the merge that is main's `scheduled.ts`, which refuses the new shape, since it
   only knows `scheduled-test-`. For this one pull request, the lead runs the reviewed head's
   `scheduled.ts --job-slots` on the head's YAML from this worktree, after reading the diff, then
   starts the run as `preflight.ts` prints. The lead's call.
3. **Optional, the lead's call: a throwaway probe branch** off this head that adds one comment line
   to `.gitattributes` (a rerun trigger) and is deleted unmerged. It runs the full set on a branch:
   9 `tests` legs on 4 proof groups. It shows `max-parallel` evaluating to 4 (never more than 4
   legs in progress at once), and the start order: `tooling-1`, `3`, `2` and `5` start first, and
   each later leg starts when the group 0598's pins name frees up. About 90 runner minutes, free on
   a public repository.

Only after the merge:

4. **Main's first full run:** never more than 5 `tests` legs in progress; `tooling-1`, `3`, `2`,
   `5` and `tooling-2` start together; e2e-2 starts within seconds of leg 5's end, leg 1 after leg
   2's, leg 4 after leg 3's, and e2e-1 after tooling-1's. This tests the doubt in the first call.
5. **A main full run beside a proof run:** neither waits on the other's legs, only on control for
   seconds.
6. **Lane 1's per-job report, run again** for the pull request p90, which settles 0598's 75%.

Cannot be proven before the merge: main's groups, main's `max-parallel` of 5, and whether GitHub
makes matrix jobs in list order. After the merge, an open branch whose `scheduled.yaml` still has
0595's shape is refused at preflight until it merges main (S7). That is intended: its legs would run
outside the budget.

## Size

Sized by the files table, in product lines; about 80% sure of each number, 70% for scheduled.ts.

1. **Slice 1, the merge line leaves the groups: 62 lines.** check.yaml, the related lint,
   related.ts, proof.ts's `export`, and their tests and fixture. What the owner sees first: pull
   request legs stop waiting on main's full run.
2. **Slice 2, the scheduled split: 210 lines.** scheduled.yaml, proof.ts, scheduled.ts, and their
   tests.
3. **Slice 3, the glossary row: 1 line.**

All three land in one pull request, in the commit order above. The tests step writes slices 1 and
2, since every file in them is under `.github/` (an exam path). The build step writes slice 3 and
checks the whole. Priced at about $4 a step, from ticket 1073's plan for CI work of the same kind
($3 a step) with this quest's larger lint rewrite; `field/runs/` rows carry no cost to price from.
Steps: tests, build, review, one likely send-back of the tests step, one recheck.

Estimate: 5 steps, $20

## What this cannot tell us

- Whether GitHub makes a matrix's jobs in list order under `max-parallel`. The first call rests on
  it, and only main's first full run after the merge shows it.
- Whether 5 and 4 is the right split: one main run and one proof run measured it (0598).
- How the merge line behaves at the organization's 20-runner limit at the busiest hour, now that
  its legs sit outside the ten. 0598's own doubt.
- The proof pins for a full set on a branch rest on one run's leg times. They are not measured
  until a probe run or a real trigger change runs them.

## Open questions

None.

Nothing waits on the owner. The ownership yes in "Doubt first" is for the lane that owns related.ts,
related-selection.test.ts, check.yaml's `select` outputs and wiring.test-support.ts. It is a
coordination answer, not a design call: 0598 already decides that the related job holds no group.

## Findings

```json
{"_tag":"finding","id":"2026-11-18-related-guard-names-nine-groups","date":"2026-11-18","by":"plan","model":null,"rule":"doc_drift","location":{"path":".github/ci/related.ts","line":52},"says":"related.ts's leg guard still says the selection must fit 'the existing nine shared test groups', which 0598 removes from the merge line; the cap of nine is now check.yaml's related max-parallel.","proof":"related.ts:51-52 reads `if (Object.keys(legs).length > 9) { throw new Error(\"related: the existing nine shared test groups cannot hold this selection\")`; decision 0598 (pull request 1586) says next, select and related drop job-level concurrency, and check.yaml:586 keeps `max-parallel: 9`. The coordinator's grant for this lane covers only related.ts's import and use of proof.ts slots, so the plan leaves the line as it is.","cost":"A reader of a failed related selection is told about groups that no longer exist; the limit it enforces is still right.","head":"955a82d987cb8583a0a693681c756054e836bf33","ticket":"kamp-us/tea-fabrika#1333","pr":null}
```
