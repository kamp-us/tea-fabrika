
Plancheck-Version: 3

# Plan: the related set is computed in `changes`, and `select` relays it

Sev 1 lane A, issue https://github.com/kamp-us/tea-fabrika/issues/1333. Today's CI
(`.github/workflows/check.yaml`), which serves both versions. Read against `origin/main` at
`605a0e5` (PR 1610), with decision 0598's build already on main, and against PR
https://github.com/kamp-us/tea-fabrika/pull/1589's head `2bd56fb4` for the delta it brings. This plan
starts from the lane A sketch in 1589's plan (`docs/plan/quests/kalfa-config-delivery-PLAN.md` on
its branch, "Speed item A") and changes it in three places, each said below.

Doubts first:

- **The saving is about 25 s per ready run, not 85 s.** 1589's sketch priced lane A from one run,
  https://github.com/kamp-us/tea-fabrika/actions/runs/44201566907, whose `select` checkout took
  69 s. In the four runs since decision 0598 that experiment 299 counts and whose jobs were read
  for this plan, `select`'s checkout took 6 to 7 s and the whole job 31 to 35 s. Lane A removes
  about 22 to 26 s from the related legs' start in those runs. Experiment 299 puts the tail in
  runner wait (median 24 s, worst 357 s on the critical path), which lane A does not touch. 85%
  sure of the 22 to 26 s; the doubt is the relay job's own pickup wait, measured only as `select`'s
  (1 to 11 s). The lead's priority for this lane is CI cost first: about 25 s off every ready run
  and queue group, and about 30 runner-seconds.
- **The fallback path is held by lint alone.** No ready run will take it unless `changes` fails to
  hand over a set, so CI exercises only the relay path. Its steps are today's steps, unchanged.

```yaml
# Sketch. The whole idea: the selector moves into changes, which already has the history and,
# on most runs, the same install. select keeps its name, needs and if, relays changes' set, and
# runs today's steps only when changes handed over no whole set.
changes:
  outputs:
    related-run: ${{ steps.related.outcome == 'success' && steps.related.outputs.run || '' }}
    # related-legs, related-files, related-projects: the same shape
  steps:
    # ... install for sizing, size, as today (the install's `if` widens, below) ...
    - name: related set
      id: related
      if: (github.event_name == 'merge_group' || (github.event_name == 'pull_request' && !github.event.pull_request.draft)) && steps.diff.outputs.check != 'false'
      continue-on-error: true
      timeout-minutes: 2
      env: { BASE: <as today>, HEAD: ${{ github.sha }}, MOST_INTEGRATION: 5, MOST_TOOLING: 2,
             LIMIT_INTEGRATION: 17, LIMIT_TOOLING: 30, RECORD: ${{ runner.temp }}/related-set.json }
      run: node .github/ci/related.ts
    - name: selected files        # today's select step, word for word
select:                           # name, needs, if, timeout-minutes 10: unchanged
  outputs:
    run: ${{ steps.set.outputs.run || needs.changes.outputs.related-run }}   # same for all four
  steps:
    # checkout, ./.github/actions/pnpm, install, set: today's steps, each with if: <FALLBACK>
    # FALLBACK = needs.changes.outputs.related-run != 'true' && needs.changes.outputs.related-run != 'false'
    # selected files, stop the run: unchanged
```

## Scope

In scope, all in today's CI:

- `changes` runs `node .github/ci/related.ts` once, under exactly the condition of its existing
  `related` output, and uploads `related-set` with today's tuple.
- `changes`' pnpm and Node setup and its full install also run when only `related` needs them.
- `changes` exposes the set as four new outputs, each empty unless the selector step succeeded.
- `select` keeps its name, `needs`, `if` and ten-minute limit, relays the set, and runs today's
  four steps when no whole set came over.
- The guards that pin these jobs (`workflow-lint/changes.ts`, `related.ts`, `record.ts`) and their
  tests.

Out of scope: `.github/ci/related.ts` itself (no change; it already reads only env and the
checkout), `required.mjs`, the `jobs.ts` guard, `ci-required`'s `needs`, the `related` job, runner
wait (experiment 299 sends that to decision 0598's owner), and tooling legs (experiment 299 says
no split).

Order: this builds after PR 1589 lands. 1589 and its stack hold `check.yaml`, `related.ts`,
`changes.mjs` and the workflow-lint files, and decision 0598 asks for one writer of `check.yaml`
at a time. The section "Once 1589 lands" says what that changes.

## What the code does now

On `origin/main`:

- `changes` (check.yaml lines 97 to 256): blobless full-history checkout, the classifier, then
  pnpm and Node setup if `probe == 'true' || next != 'false'`, a full
  `pnpm install --frozen-lockfile --ignore-scripts` ("install for sizing") if next is still not
  false, `legs.ts`, the record and its upload, and `stop the run`. Every helper step is
  `continue-on-error: true`; only the classifier and the two small checks can fail the job. Its
  `related` output (line 116) is the condition `select` runs on.
- `select` (lines 525 to 562): `needs: changes`; `if: !cancelled() && (needs.changes.result !=
  'success' || needs.changes.outputs.related != 'false')`; the same blobless checkout; the
  `./.github/actions/pnpm` composite (the same `pnpm/action-setup@v6` and `actions/setup-node@v7`
  at Node 26.13.0 as `changes`); the same install command; step `set`, `node .github/ci/related.ts`
  with seven env keys and a 5-minute limit; the `related-set` upload under `!cancelled()`.
- `related.ts` refuses to run unless `HEAD` (the env) equals the checkout's `HEAD`, takes the merge
  base of `BASE` and `HEAD`, lists files with vitest, and appends four lines to `GITHUB_OUTPUT` as
  its very last act, after writing the record file.
- `required.mjs` passes `select`'s skip only when `related` is "false", and `related`'s skip when
  `select` succeeded with `run == 'false'`.

## Measured

Job and step times from the GitHub jobs API (`list_workflow_jobs`, filter `latest`), read
2026-11-18. "Path" is `select`'s `created_at` to its `completed_at`: the time it adds before the
related legs are made, since all legs are made the second `select` ends (experiment 299).

| Run | Event | `changes` ran | `select` wait | `select` ran | checkout, pnpm, install, selector, upload | Path |
|---|---|---|---|---|---|---|
| https://github.com/kamp-us/tea-fabrika/actions/runs/44201566907 | pull request, before 0598 | 35 s | 2 s | 96 s | 69, 9, 9, 3, 1 (from 1589's plan) | 98 s |
| https://github.com/kamp-us/tea-fabrika/actions/runs/44222237649 | queue | 34 s | 1 s | 35 s | 6, 11, 10, 3, 1 | 36 s |
| https://github.com/kamp-us/tea-fabrika/actions/runs/44223515842 | pull request | 37 s | 2 s | 35 s | 7, 12, 9, 3, 1 | 37 s |
| https://github.com/kamp-us/tea-fabrika/actions/runs/44224819283 | queue | 37 s | 2 s | 32 s | 7, 8, 9, 3, 1 | 34 s |
| https://github.com/kamp-us/tea-fabrika/actions/runs/44226178362 | queue | 29 s | 11 s | 31 s | 7, 8, 9, 3, 1 | 42 s |

In all five, `changes` already ran its install for sizing (7 to 10 s), so the selector would add
only its own 3 s and the upload's 1 s there.

## What it saves

```text
today      related legs made at:  changes ends + select wait + select ran
after      related legs made at:  changes ends + 4 s + relay wait + relay ran (about 5 s, a guess:
                                  Set up job 0 to 1 s, the related-set upload with no file about 1 s,
                                  and the 2 s each job above took from its last step to completed_at)
saving     = select ran - 4 s - 5 s, with the same pickup wait on both sides
```

| Run | `select` ran | Saving |
|---|---|---|
| 44201566907 | 96 s | about 87 s |
| 44222237649 | 35 s | about 26 s |
| 44223515842 | 35 s | about 26 s |
| 44224819283 | 32 s | about 23 s |
| 44226178362 | 31 s | about 22 s |

- **Median of the five: about 26 s per ready pull request run and per queue group,** off the
  related legs' start. Experiment 299 has a related leg finishing last in every counted run, so
  this comes off the run's wall time. In run 44226178362 the related group ended about 5 minutes
  after the last `next` leg.
- **What it costs.** `check`, `typecheck` and `next` start about 4 s later on every ready run that
  already installs in `changes`. On a ready run where `next` is false and `related` is not, `changes`
  gains the setup and install too, 14 to 22 s more from the steps above, so the saving falls to
  about 4 to 12 s. How often that happens was not counted (see "What this cannot tell us").
- **Runner time.** About 30 runner-seconds less per ready run: the relay holds a runner for about
  5 s, where `select` held one for 31 to 96 s.
- **The tail stays.** Experiment 299's worst runs waited 209 to 357 s for runners on the critical
  path. Lane A takes none of that away.

## How others do it

- **GitHub Actions passes data between jobs as job outputs**, set from step outputs and read
  through `needs.<job>.outputs`; a job's `outputs` may read the `needs` and `steps` contexts
  ([passing information between jobs](https://docs.github.com/en/actions/how-tos/write-workflows/choose-what-workflows-do/pass-job-outputs)
  and [contexts, availability](https://docs.github.com/en/actions/reference/workflows-and-actions/contexts#context-availability),
  not fetched for this plan; `check.yaml` already reads `needs.changes.outputs.*` and step
  outputs this way). The limits page puts job outputs at 1 MB per job
  ([Actions limits](https://docs.github.com/en/actions/reference/limits), not fetched). The
  set's four outputs are lists of paths, far below that, beside `files`, which `changes` already
  prints.
- **Every job pays its own setup.** That is why the industry merges small setup-heavy jobs into a
  job that already holds the checkout and install: this repo did it before, when the `legs` job
  became `changes`' size step (ticket 985, check.yaml lines 172 to 175), and `field` became a step
  of `check`. Lane A is the same move for `select`.
- **A step that may fail without failing its job** is GitHub's `continue-on-error`, with
  `steps.<id>.outcome` telling the failure apart from success
  ([steps context](https://docs.github.com/en/actions/reference/workflows-and-actions/contexts#steps-context),
  not fetched). `changes` already uses it for every helper step.

## The shape

Three changes from 1589's sketch, each a call:

1. **The selector fails open in `changes`, and `select` reruns it** (85% sure). 1589's sketch had
   the selector fail `changes` and `select` fail on a missing set. That moves the failing job from
   `select` to `changes` and turns a transient failure of `changes`' install, which today only
   fails open to the full `next` matrix, into a red run. With `continue-on-error`, a selector error,
   a failed install or a hang leaves the set outputs empty, `select` runs today's steps, and the
   same error fails `select`, as it does today: `ci-required` prints `select: failure`, and
   `select`'s own stop step cancels the run. A real error costs about 35 s more before the red.
2. **`select` falls back when no whole set came over, whatever `changes`' result** (85% sure).
   1589's sketch fell back on `changes` failing. Keyed on the set instead, the two sources never
   mix: on the relay path `steps.set` is skipped and empty, and on the fallback path `changes`'
   outputs are empty, so `steps.set.outputs.k || needs.changes.outputs.related-k` reads one source
   either way, an empty `archive` included once 1589 lands. When `changes` fails after a whole set
   (only its upload could do it), the set is relayed; it came from the same script, env and commit,
   and `changes`' stop step cancels the run anyway.
3. **The selector step's limit is 2 minutes, not 5** (80% sure). `changes`' job limit is 5
   minutes. A 5-minute step could never time out before the job, and a hang would fail `changes`.
   At 2 minutes a hang stays inside `continue-on-error` and falls back. Sources: the selector took
   3 s in all five runs above; `changes` ran 29 to 37 s here and 12 to 41 s in the seven runs 1589's
   plan read, so 2 minutes plus 41 s leaves over 2 minutes of the job's 5.

The workflow, in full where it changes (a sketch for the build; names are the ones it lands with):

```yaml
changes:
  outputs:
    # ... today's outputs ...
    related-run: ${{ steps.related.outcome == 'success' && steps.related.outputs.run || '' }}
    related-legs: ${{ steps.related.outcome == 'success' && steps.related.outputs.legs || '' }}
    related-files: ${{ steps.related.outcome == 'success' && steps.related.outputs.files || '' }}
    related-projects: ${{ steps.related.outcome == 'success' && steps.related.outputs.projects || '' }}
  steps:
    - name: setup pnpm            # and setup node: if gains `|| <RELATED>`
      if: steps.diff.outputs.probe == 'true' || steps.diff.outputs.next != 'false' || (<RELATED>)
    - name: install for sizing    # if gains `|| <RELATED>`; the size step's own if does not change
      run: pnpm install --frozen-lockfile --ignore-scripts
      if: (steps.same.outputs.next || steps.diff.outputs.next) != 'false' || (<RELATED>)
      continue-on-error: true
    - name: size                  # unchanged
    - name: related set           # new, after size and before record
      id: related
      if: <RELATED>
      continue-on-error: true
      timeout-minutes: 2
      env:
        BASE: ${{ github.event.pull_request.base.sha || github.event.merge_group.base_sha || github.event.before }}
        HEAD: ${{ github.sha }}
        MOST_INTEGRATION: &related-integration-most 5   # every anchor is defined here, its first use
        MOST_TOOLING: &related-tooling-most 2
        LIMIT_INTEGRATION: &related-integration-limit 17
        LIMIT_TOOLING: &related-tooling-limit 30
        RECORD: ${{ runner.temp }}/related-set.json
      run: node .github/ci/related.ts
    - name: selected files        # new: today's select step, word for word
      if: ${{ !cancelled() }}
      uses: actions/upload-artifact@v7
      with: { name: related-set, path: "${{ runner.temp }}/related-set.json",
              if-no-files-found: ignore, retention-days: 90 }
    # record, upload the record, stop the run: unchanged
select:
  needs: changes                  # unchanged
  if: ${{ !cancelled() && (needs.changes.result != 'success' || needs.changes.outputs.related != 'false') }}
  timeout-minutes: 10             # unchanged
  outputs:
    run: ${{ steps.set.outputs.run || needs.changes.outputs.related-run }}
    legs: ${{ steps.set.outputs.legs || needs.changes.outputs.related-legs }}
    files: ${{ steps.set.outputs.files || needs.changes.outputs.related-files }}
    projects: ${{ steps.set.outputs.projects || needs.changes.outputs.related-projects }}
  steps:
    - uses: actions/checkout@v7   # today's with:, plus if: <FALLBACK>
    - uses: ./.github/actions/pnpm                     # if: <FALLBACK>
    - run: pnpm install --frozen-lockfile --ignore-scripts   # if: <FALLBACK>
    - id: set                     # today's env through the four aliases (*related-integration-most, ...),
                                  # today's limit, no continue-on-error, if: <FALLBACK>
      run: node .github/ci/related.ts
    - name: selected files        # unchanged: on the relay path it finds no file and uploads nothing
    - *stop                       # unchanged
# <RELATED> is shared.ts's RELATED, the expression of changes' `related` output (line 116).
# <FALLBACK> = needs.changes.outputs.related-run != 'true' && needs.changes.outputs.related-run != 'false'
```

A YAML anchor must be defined before its first alias, and the first use is now `changes`. So
`&related-integration-limit` and `&related-tooling-limit` move from `select`'s `set` to `changes`'
step, and two new anchors, `&related-integration-most` and `&related-tooling-most`, hold the leg
counts. `select`'s `set` and the `related` job's test-step limits read all four through aliases,
so each value is written once. The parsed values stay 5, 2, 17 and 30, which is what the guards
read.

What stays the same, and why:

| Property | How it holds |
|---|---|
| Event | The selector step's `if` is RELATED, the same expression `select` runs on when `changes` succeeds. On a draft or a push the step skips, the set is empty, and `select` behaves as today: skipped when `related` is false, today's steps when `changes` failed. |
| Identity | Same script, same seven env values, `HEAD` is `github.sha`, the checkout is `changes`' own blobless full history with no `ref`, and `related.ts` refuses any other `HEAD`. Same pnpm and Node actions and versions, same install command. |
| Record | One `related-set` artifact per run, with today's name, path, retention and no-file rule, uploaded by whichever job ran the selector. Its content is the same script's. Which job computed it stays readable in the jobs API (`select`'s `set` step skipped or run). |
| Fault | A selector error, a failed install or a hang ends with `select` red, as today, through the fallback. `changes` keeps failing only on the classifier and its two small checks. `required.mjs` sees the same results. |
| Skip | `select` still runs whenever `related` is not false, so `required.mjs`'s `gates.select` and `empty` rules read what they read today. |

## One value traced

A ready pull request run on a merge commit `M`, base `B`, that changes `.github/ci/legs.ts`:

1. `changes`: the classifier prints `check=true`, so RELATED is true. `next` is not false, so the
   setup and install run as today (7 to 10 s).
2. `size` prints `next`'s legs. `related set` runs `related.ts` with `HEAD=M`, `BASE=B`: checkout
   `HEAD` is `M`, merge base taken, tooling files listed, outputs
   `run=true`, `legs=["1","2"]`, `files={"1":"...","2":"..."}`, `projects={"1":"tooling","2":"tooling"}`,
   and `related-set.json` in `RUNNER_TEMP` (3 s). `selected files` uploads it (1 s).
3. `changes` ends; `related-run` is `true` because the step's outcome is `success`.
4. `select` starts (job `if` true, since `related` is true). FALLBACK is false, so its checkout,
   setup, install and `set` skip; `selected files` finds no file and uploads nothing. Its outputs
   read `steps.set` (empty) then `changes` (the set). About 5 s.
5. `related` makes two legs from `needs.select.outputs.legs`, as today. `ci-required` reads
   `select: success`.

The same run when the registry fails `changes`' install: step 2's selector fails (vitest is
missing), its outcome is `failure`, `related-run` is empty, `changes` still succeeds. In `select`,
FALLBACK is true: today's checkout, install and `set` run. If the registry is back, the set comes
from `select` and the run goes on 35 s later than with lane A working; if not, `select` fails and
cancels the run, as today.

## Laws

Every law is a workflow-lint rule (`pnpm lint` runs `node .github/ci/workflow-lint.ts`), so each is
`lint`. Each plant is one new case in the guard test's fault list (the existing `it.prop` over a
`Schema.Literals` of faults, with its every-fault-drawn check), applied to the real `check.yaml`.

| Law | Kind | Generator | Plant | Where |
|---|---|---|---|---|
| A1, `changes` runs `node .github/ci/related.ts` once, as step `related`, after the install for sizing and the size step and before the record, with `if` exactly RELATED, `continue-on-error: true`, `timeout-minutes: 2`, and exactly the seven env keys of `select`'s `set` with the same values, `HEAD` being `github.sha`; no token. | lint | lint | Each alone: `HEAD` set to the pull request head; the draft clause dropped from `if`; `MOST_TOOLING` 3; `GITHUB_TOKEN` added; the step moved before the install; `continue-on-error` removed; a second selector step. | .github/ci/workflow-lint/related.test.ts |
| A2, `changes`' pnpm setup, Node setup and install for sizing run on their own guard or RELATED, stay `continue-on-error`, and the size step's `if` stays exactly SIZED. | lint | lint | The install's `if` left at SIZED; the size step's `if` widened with RELATED; the setup's `continue-on-error` dropped. | .github/ci/workflow-lint/changes.test.ts |
| A3, `changes` exposes exactly `related-run`, `related-legs`, `related-files` and `related-projects` beside today's outputs, each `steps.related.outcome == 'success' && steps.related.outputs.<key>`, else the empty string. | lint | lint | The outcome clause dropped from one output; `related-legs` reading `outputs.files`; a fifth `related-` output. | .github/ci/workflow-lint/changes.test.ts |
| A4, `select` keeps its name, `needs`, `if` and ten-minute limit; each of its four outputs is `steps.set.outputs.<key>`, else `needs.changes.outputs.related-<key>`; its checkout, pnpm action, install and `set` each carry exactly FALLBACK; `set` keeps today's env, 5-minute limit and no `continue-on-error`. | lint | lint | Two relayed keys swapped; the order of the two sources swapped; FALLBACK dropped from the install; FALLBACK replaced by `needs.changes.result != 'success'`; `set` given `continue-on-error`. | .github/ci/workflow-lint/related.test.ts |
| A5, `related-set` is uploaded by exactly two steps in `check.yaml`, one in `changes` after its selector and one in `select` after `set`, each named `selected files` with today's four keys and tuple; the record's own upload count in `changes` stays one. | lint | lint | A third `related-set` upload in `related`; `changes`' copy with `retention-days: 7`; `changes`' copy before its selector; the record's upload duplicated. | .github/ci/workflow-lint/record.test.ts |

No new law for `related`, `required.mjs` or `ci-required`: R1 (`related`'s `needs`, `if` and
matrix), the `jobs.ts` guard (`select`'s `needs` and `if`) and `required.mjs`'s tests already hold
them, and this plan changes none of them. If any goes red on the new workflow, that is a fault in
the build, not a law to edit.

Host-only laws: none. Nothing here needs launchd, Electron, a real OS process or a signal.

## Files

| File | Owner | Product lines expected | What |
|---|---|---|---|
| .github/workflows/check.yaml | build | 35 | The selector and upload in `changes`, four outputs, two widened `if`s, `select`'s relay outputs and FALLBACK on four steps, comments. |
| .github/ci/workflow-lint/shared.ts | build | 4 | `FALLBACK` beside `RELATED`, one constant. |
| .github/ci/workflow-lint/changes.ts | build | 20 | A2 and A3: the widened setup and install guards, the four outputs in the exposed list. |
| .github/ci/workflow-lint/related.ts | build | 35 | A1 and A4: the selector step in `changes`, `selector()`'s relay form and FALLBACK. |
| .github/ci/workflow-lint/record.ts | build | 10 | A5: the report upload table allows `changes`' copy. |
| .github/ci/workflow-lint/wiring.test-support.ts | tests | tests | Its generated valid workflow gains the new `changes` outputs and step, so every other guard's cases stay valid. |
| .github/ci/workflow-lint/related.test.ts | tests | tests | A1 and A4 plants. |
| .github/ci/workflow-lint/changes.test.ts | tests | tests | A2 and A3 plants. |
| .github/ci/workflow-lint/record.test.ts | tests | tests | A5 plants. |

## Existing tools

- `FALLBACK` in `.github/ci/workflow-lint/shared.ts`: a constant, not a helper. Searched
  `shared.ts` and the guards for an existing expression of "changes handed over a set"; none, since
  no job relays another's set today. It sits beside `RELATED`, the constant it pairs with.
- `selector()` in `.github/ci/workflow-lint/related.ts` is changed in place, and the new A1 check
  reuses its `steps`, `map`, `compact` and `uses` from `shared.ts`. Searched the guards for a
  step-env comparison to reuse: `record.ts` compares env maps with `sameEntries`, which A1 uses for
  the seven keys.
- `node .github/ci/related.ts` is reused unchanged. No new script, no new workflow file, no shell.

## Is this a setting?

- The selector step's 2-minute limit: no. It is a limit derived from `changes`' 5-minute job limit,
  pinned by lint like every job and step limit in `check.yaml`, and no person would set it
  differently from the job's.
- `MOST_INTEGRATION`, `MOST_TOOLING`, `LIMIT_INTEGRATION` and `LIMIT_TOOLING` stay the settings
  they are, each still written once: as an anchor in `changes`' step, read by `select`'s fallback
  through an alias. A1 and A4 still hold both parsed copies equal, so an alias replaced by a
  number is caught.
- No other new choice.

## Records: the relay's pickup wait

The relay's own wait is the one number this plan guesses at, and experiment 299's open question
(does the merge line's tail come from runner supply?) needs it. So the build owes one week of it.

- **What:** for every ready pull request run and queue group in the 7 days after merge, `select`'s
  wait (`started_at - created_at`) and run time (`completed_at - started_at`), `changes`'
  `completed_at`, and the earliest related leg's `created_at`, from the GitHub jobs API.
- **Where it is recorded:** one experiment write-up, `experiments/NN-related-relay-wait.md` with the
  number `records.ts next experiments` gives, written on day 7 by one measuring step with experiment
  299's script on its branch (`fabrikalfa/ci-related-tooling-legs-script`, `experiments/299-related-legs.ts`)
  extended by these four fields. Its raw rows go to the private archive (0027), and the build's
  field run row names the write-up as owed.
- **Why not a new field in CI:** the jobs API keeps these times with each run, so waiting 7 days
  loses nothing, well inside the 90-day log and artifact retention. A recorder inside `select` would
  need a checkout on the relay path, about 7 s, which takes back a quarter of the saving. `time-table.ts`
  reads only its own job's steps, and teaching it another job's would change a guarded file outside
  this lane.
- **What it settles:** whether the relay's pickup wait stays at the 1 to 11 s `select` showed, or
  carries the 209 to 357 s tail; if the tail, the direct read in "Calls taken" comes back to fabrikaa.

## What fact is lost if it is not recorded now

None beyond the relay's wait, above. Which job computed a run's set is in the jobs API (`select`'s `set` step skipped or run) for
as long as GitHub keeps the run, and the `related-set` artifact keeps its 90 days. Adding a "by"
field to the record would change `related.ts` and the record's content, which this lane keeps
exactly.

## Once 1589 lands

PR 1589 (`2bd56fb4`) adds `archive` and `consumer` to `select`'s outputs and to `related.ts`'s
`outputs()`, so the set is six lines, not four. On 1589's head, `select` has six outputs; the
"eight" in 1589's lane A sketch is a count from an older head. What changes in this plan:

- `changes` exposes six outputs, `related-archive` and `related-consumer` added, each with the same
  outcome clause; `select` relays six. A3 and A4 list six keys.
- The `||` relay and an empty `archive` or `consumer`: on the relay path `steps.set` is empty and
  `changes`' value passes through, empty or not; on the fallback path `changes`' values are empty
  and `select`'s own pass through. The `package receipt`, `consumer fault` and `package archive`
  steps keep reading `needs.select.outputs.archive` and `consumer`, unchanged. This is why call 2
  keys the fallback on the set and not on `changes`' result.
- 1589's `record.ts` adds `deliveryUpload` to the allowed uploaders; A5 adds `changes`' copy of
  `related-set` to the report table beside it, and keeps the delivery count at one.
- 1589's `changes.ts` pins the size step's env keys exactly; A2 does not touch that step.
- 1589's `related.ts` main block reads the same env (`HEAD`, `BASE`, the four counts and limits,
  `RECORD`, `GITHUB_OUTPUT`), so A1's seven keys stay. Its new `--receipt` and `--fault` modes run
  on the related legs, not in `select`, and are untouched.
- 1589's `related.ts` is about 540 lines with more imports. The build rechecks the selector's
  time on its first ready run; if it is well past 3 s, the saving shrinks by the difference and the
  2-minute limit is re-judged against it.
- The build merges main after 1589 and re-reads these lines; the line numbers above are from
  `605a0e5`.

## Validation

The plan step read code, decisions, experiment 299, 1589's plan and diff, and the GitHub jobs API.
It ran no test, install or compiler.

After the build, the lead reads on the pull request's own ready run, before the review:

- `changes`' `related set` step's log (the record and four output lines) and its 3 s;
- `select`'s steps: checkout, install and `set` skipped, `selected files` uploading nothing;
- one `related-set` artifact in the run, `head` equal to the run's `github.sha`;
- the related legs' `created_at` against `changes`' `completed_at`, for the measured saving.

Then three more ready or queue runs after merge, to replace the 22 to 26 s estimate with a number.

## Size

1. One pull request: about 105 lines of workflow and guard code and about 150 lines of laws: 255
   lines.
2. The week's measuring step and its write-up (Records): 0 lines of CI code, one experiment file.

About 2 agent hours, 75% sure. Priced from 1589's plan's roughly $5 per step for steps on these same
files: tests, build, review, and one likely send-back, plus the measuring step, priced at about $10 from
experiment 299's $11 for the same kind of read.

Estimate: 5 steps, $30

## What this cannot tell us

- The saving rests on five runs, one of them before 0598, all in one evening during a sev 1.
- The relay job's own time (about 5 s) is a guess from other jobs' setup and tail steps; no job
  with only skipped steps was measured.
- How many ready runs have `next` false and `related` true, where the saving falls to 4 to 12 s,
  was not counted. What would settle it: for the ready and queue runs of one day, count the runs
  whose `next` jobs skipped and whose `select` ran.
- Whether GitHub fills `needs.<job>.outputs` from a job that failed was not checked; the plan
  works either way, since an empty set falls back.
- The fallback path does not run on CI in the normal case. Lint holds its conditions; its steps
  are today's.
- Whether the parser's filtered install before the full install leaves a `node_modules` that lists
  differently from `select`'s fresh install was not tested. Both use the same lockfile and
  `--frozen-lockfile`; the first ready run's record is the check.

## Calls taken

- **Answered by fabrikaa: keep the relay.** The question was whether `related` should take the set
  from `changes` directly, with `select` running only as the fallback. The answer is no, as the lean
  below said; it walks back nothing in 1589's plan. The week of relay waits (Records) is the check
  on it. The original question: That drops the relay hop: the relay's pickup wait (1 to 11 s measured for
  `select`) and its about 5 s, so about 6 to 16 s more per ready run. It walks back what 1589's
  plan kept fixed: `select` would skip on most ready runs while `related` is true, so
  `required.mjs`'s `gates.select` and `empty` rules, R1's `related` `needs` and `if`, and the
  `jobs.ts` guard all change, and the required check's verdict code is touched for 6 to 16 s. Lean:
  no, keep the relay, 70%. The doubt: if the relay's pickup wait turns out to carry experiment
  299's runner-wait tail (209 to 357 s in the slowest runs), the hop costs minutes, not seconds;
  the first week of relay runs settles it.

## Open questions

None.

## Findings

None.
