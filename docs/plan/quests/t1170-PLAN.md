Approved by the lead agent, builds ticket 1170; body 8ca16161e716
Plancheck-Version: 3
# Plan: ticket 1170, second sighting: the P8 SIGKILL law's journal never shows the blocked test, because installed Vitest 5.0.5 can hold a worker's last task update forever

Today's CI tooling (the CI scripts and workflows, and the Vitest that both versions' tests run on). Every path and
line below was read at `origin/main` `5c2dc31`, in installed Vitest 5.0.5 and Effect 4.1.3 as
`pnpm-lock.yaml` pins them. Nothing in `next/` changes.

```diff
# The whole fix, in installed Vitest (node_modules/vitest/dist/chunks/run.BPv-BBRv.js:3816),
# as Vitest 5.1.0 itself changed it. A pnpm patch, declared in pnpm-workspace.yaml.
-		pendingCall ??= setTimeout(call.bind(this), ms, ...args);
+		pendingCall ??= setTimeout(() => {
+			pendingCall = void 0;
+			call.apply(this, args);
+		}, ms);
```

## Doubts first

The owner is away, so each lean below is taken. These three are under 80% and are the lead's to
weigh before signing.

1. **The proof route the brief names cannot run this law (lean 70%).** A hand start of
   `.github/workflows/scheduled.yaml` on a branch runs `--project tooling` only
   (`scheduled.yaml:308`), and `.github/ci/proof.ts:58-61` leaves every `.integration.` file out of
   a changed set. That is decision
   [0602](../../../.decisions/0602-integration-laws-leave-merge-line.md)'s binding constraint: no
   branch proof run starts an `.integration.` law, with `scope: full` or not. So P8 runs only in
   main's full run. [0594](../../../.decisions/0594-safe-checks-direct-mac-ci.md) still wants
   signal proof on disposable CI before the first review, and says "a workflow that does not run a
   required law still needs its own change before that law has proof". 0602 leaves the host
   workflow outside its ban ("Not decided here"). My lean: add one fixed, hand-started suite `p8`
   to `.github/workflows/host.yaml`, next to `e88-r6` and `box`, which already run named laws by
   hand on a branch. It runs on `ubuntu-latest`, the runner kind where P8 failed, so the green
   count below means something. The doubt: host.yaml is "the macOS workflow" today, and its lint
   (H3 in `.github/ci/workflow-lint/host.ts:72-75`) holds every job on `macos-15`. The other
   choice is no workflow change: land on the plant's reasoning and let main's full runs carry the
   proof after the merge, as 0602's post-submit model does. That gives no plant run on CI at all.
2. **A failure line in the law (lean 75%).** The red run left no record of what the child's
   journal held at 30 seconds, and the child's stderr is thrown away (`Stream.runDrain` at
   `.github/ci/progress-reporter.integration.test.ts:239`). I add one printed line when the wait
   ends empty: the last journal the law read, and the child reporter's own `vitest-progress:`
   lines. It changes no expectation, no bound and no verdict. It is evidence, not the fix. The
   lead may drop it and keep the law byte for byte; the fix does not need it.
3. **The 30-second bound stays, as the brief asks (lean 80%).**
   [0609](../../../.decisions/0609-laws-wait-on-events-never-on-a-fixed-time-bound.md), accepted
   the same day PR 1624 added the bound, says a law has no fixed bound on machine-speed work and
   only the test runner's own limit backstops it. This plan keeps the bound and files a finding
   row (below), so whether it goes is decided on its own.

## The answer

- **Which branch gave `null`: the 30-second `timeoutOption`, not the child's exit (97% sure).** The
  law took 31381 ms and failed in its first probe, the cutoff one, at `:312`. 30 000 ms is the
  bound; the other 1381 ms is the child's start to its ready line (P9's measured children in the
  same job reach their first queued event about 1.05 to 1.1 s after load) plus the scope's
  teardown. For the exit branch to win at that time, the child would have to end on its own about
  30 s after ready. Nothing in it can: its config sets `testTimeout: 0` (`:124`), and its hooks
  had already run, since the ready line is printed from inside the test body after `beforeEach`.
  What the duration proves: the journal did not meet the law's condition within 30 s. What it
  does not prove: which half of the condition was missing, what the journal held, or why. The law
  prints nothing on a `null`, and the child's stderr is drained.
- **The real cause: installed Vitest's task-update throttle can hold a worker's last pack of
  updates forever (85% sure).** A Vitest worker sends test and hook events to the main process in
  packs, through `throttle(sendTasksUpdate, 100)` (`run.BPv-BBRv.js:3820`). The first call sends at
  once and sets `last`. Later calls within 100 ms set one `setTimeout`. When that timer runs, it
  calls the throttle again; if `Date.now() - last > 100` is false at that moment, the line
  `pendingCall ??= setTimeout(...)` (`:3816`) does nothing, because `pendingCall` still holds the
  spent timer's id. The pack then waits for the next update, and in the cutoff child none ever
  comes: the test awaits forever. So the reporter in the main process never receives
  `test-prepare` (its `onTestCaseReady`) or `beforeEach`'s end, never appends them, and the law
  waits on a journal that cannot change.
- **1624 did not reach it, and the first sighting was the same fault.** Before 1624 the cutoff
  child kept Vitest's 5-second test deadline. At the deadline, the test's failure made a new
  update, which flushed the held pack. The journal then showed the test, the law sent its kill,
  and Vitest had already written final JSON. That is the first sighting: red at `:356` after 6483
  ms, which is the child's start plus the 5-second deadline
  ([job 134841612997](https://github.com/kamp-us/tea-fabrika/actions/runs/44315669639/job/134841612997)).
  1624 removed the deadline, which was the only thing that ever released the pack. The failure
  moved from `:356` to `:312`.
- **The fix is neither in `.github/ci/progress-reporter.ts` nor in the law.** The reporter runs in
  the main process and cannot see a pack the worker never sent. The law is right: it caught a real
  gap in what the reporter is for, ticket 1144's "which test was running when the step was cut
  off". When a test hangs on a real leg, the same strand can drop that test's start, and the time
  table then names the test before it. The fix is a pnpm patch of installed Vitest 5.0.5 with
  Vitest 5.1.0's own change to this function. It needs neither `package.json` nor `.oxlintrc.json`:
  this repo's patches are declared in `pnpm-workspace.yaml` (`patchedDependencies`, line 157 on).

## What I read, and what each candidate cause shows

The brief's candidates, each against the code and the log. Line numbers are in the repo at
`5c2dc31` or in installed Vitest 5.0.5 under `node_modules/vitest/dist/chunks/`.

| Candidate | Evidence | Verdict |
| --- | --- | --- |
| The reporter holds back or throttles a write while the probe test is blocked | `progress-reporter.ts:33-42` appends each event at once, one `writeFileString(..., { flag: "a" })` under a one-permit semaphore; `:128-140` awaits it per callback. No buffer. The main process (`cli-api.De07GUeT.js:11766-11775`) awaits each reporter event in order | Ruled out for our code. The holding is one step earlier, in the worker |
| The worker's throttle holds the last pack | `run.BPv-BBRv.js:3804-3818`: the trailing timer re-enters `call`; with `now - last > ms` false, `pendingCall ??=` schedules nothing. `:3821-3829` every task event goes through it; `:3558-3560`, `:3874`, `:4053` are the hook, `test-prepare` and `suite-prepare` calls the cutoff child makes, all within a few ms. Vitest 5.1.0 (published 2026-11-02) changed exactly this: its timer clears `pendingCall` before re-entering (5.1.0's `run.CjdgFZiW.js:3817-3820`); 5.1.0-beta.1 still had the old line (`run.BfrMbGVD.js:3817`). Read from the published npm tarballs | **Ruled in** |
| An `fs.watch` event missed or coalesced between `collect` and `Queue.take` | Each `Queue.take` is followed by a whole re-read of the journal (`integration.test.ts:297-298`), so coalesced events lose nothing. Effect's watcher queues every change (`@effect/platform-node-shared/src/NodeFileSystem.ts:671-687`) into an unbounded queue (test `:277-280`) | Ruled out (90%) |
| The watch armed after the needed appends | `onReady` runs after `NFS.watch` has returned, inside the acquire (`NodeFileSystem.ts:668-709`); the law reads the whole journal once after that (test `:282-283`), so an append before the watch is still seen | Ruled out |
| The journal path outside the watched folder | `RUNNER_TEMP` is `scratch` for this probe (test `:121`, `:199`); the reporter writes `RUNNER_TEMP/vitest-progress.ndjson` (`progress-reporter.ts:12`); the law watches `scratch` (test `:278`) | Ruled out |
| The condition names an event the reporter never writes in this order | The condition wants an active `test started` for `probe.test.ts` and a `hook beforeEach ended` (test `:285-296`). The reporter writes both (`progress-reporter.ts:159-173`), from `test-prepare` and `before-hook-end`, which Vitest sends in that order (`run.BPv-BBRv.js:3874`, then `:3895` on). Four green CI runs and 16 green box runs (below) reached it | Ruled out |
| The log's `vitest-progress: metadata unavailable` lines | They come from the job's own outer reporter, not the child: the child's stderr is drained, and its project is named `tooling`. The outer run's integration file is in project `tooling-integration`, which `progress.ts:39` does not allow, so all 8 of that file's events are refused (the time table: `write_gap`, gap starts 2741, 2747, 2755). A green leg shows the same 8 lines | Not this cause; a finding row below |

Why the timer can run with `Date.now() - last` at exactly 100 or less: Node runs a 100 ms timer by
its own millisecond loop clock, while the throttle counts `Date.now()`, another clock, both cut to
whole milliseconds. This is my reasoning, about 80% sure. A 30-line copy of the installed
function, run with Node 22 in the plan step's box (no Vitest, no repo test, no signal), held its
last pack in 41, 34 and 33 of 60 tries with 0, 0.2 and 1 ms of work between the first call and the
last, and in 0 of 60 with 3 ms. Vitest 5.1.0's version held it in 0 of 60 at each of the four.
CI runs Node 26, so the rate there is not this one. The plant below does not depend on this
reasoning.

## How others do it

- **Vitest itself:** 5.1.0 fixed this function the way the diff at the top shows: the timer
  forgets itself, then re-enters, so an early run schedules a new timer instead of nothing. Read
  from the published 5.1.0 and 5.1.0-beta.1 packages. Its pull request and issue were not fetched:
  this session cannot reach GitHub's API for that repository.
- **The common trailing-edge throttle:** lodash's `throttle` (built on `debounce`) re-arms its timer
  for the remaining wait when the timer fires before the wait is over (`timerExpired` and
  `remainingWait`). From memory; not fetched. The rule is the same: a trailing call is never
  dropped because its timer ran early.
- **This repo:** a bug proven in a package we use is patched with `pnpm patch` and dropped at the
  release that has the fix ([0054](../../../.decisions/0054-read-upstream-before-patching-it.md),
  [patch upstream locally](../../../docs/direction/patch-upstream-locally.md)). Upstream has already
  shipped this fix, so there is nothing to report and no issue to file; the patch comment names the
  release, as the `@alchemy.run/*` and `effect` entries in `pnpm-workspace.yaml` do.
- Elm and OTP have no answer here: this is a dependency's timer bug, not a design choice.

## The shape

The patch, made with `pnpm patch vitest@5.0.5` and `pnpm patch-commit`, holds the one hunk at the
top of this plan, in `dist/chunks/run.BPv-BBRv.js`, the one copy of the function in the package.
The declaration, a sketch:

```yaml
# pnpm-workspace.yaml, patchedDependencies, a sketch of the comment
  # A worker's task-update throttle (dist/chunks/run.BPv-BBRv.js) re-arms a trailing timer that
  # runs early, so a test that never ends still has its start and hooks sent to the reporters.
  # Vitest 5.1.0 ships the same change. Drop this at the bump to 5.1.0 or later.
  vitest@5.0.5: patches/vitest@5.0.5.patch
```

The proof suite, a sketch of the new `host.yaml` job (doubt 1). Its shape copies the `box` job:

```yaml
  p8:
    if: github.event_name == 'workflow_dispatch' && inputs.suite == 'p8'
    runs-on: ubuntu-latest
    timeout-minutes: 20
    steps:
      - uses: actions/checkout@v7
        with:
          persist-credentials: false
      - uses: ./.github/actions/pnpm
      - run: pnpm install --frozen-lockfile
      - name: P8 law
        env:
          FABRIKA_TEST_DEPTH: full
        run: |
          git rev-parse HEAD > "$RUNNER_TEMP/p8-head.txt"
          pnpm exec vitest run --project tooling-integration --maxWorkers=1 --fileParallelism=false --reporter=default --reporter=json --outputFile.json="$RUNNER_TEMP/p8.json" \
            .github/ci/progress-reporter.integration.test.ts
      - name: P8 proof
        if: always()
        uses: actions/upload-artifact@v7
        with:
          name: p8
          path: ${{ runner.temp }}/p8*
          if-no-files-found: error
```

`suite`'s options become `[l13, e88-r6, box, p8]`. `lintHost` gains H1's fourth option, H3's job
list with `p8` on `ubuntu-latest` (the three old jobs stay on `macos-15`), and one rule like H6:
`p8` runs only that fixed file, at full depth, with no `continue-on-error` and an `always()`
upload.

The failure line in the law (doubt 2), a sketch. The `expect` calls stay as they are:

```ts
// In the cutoff branch. `seen` is set after every collect inside `observation`.
const seen = yield* Ref.make<Timings | null>(null);
// stderr: keep only the child reporter's own fixed advisory lines, which hold no path.
const advisories: string[] = [];
// ... handle.stderr.pipe(Stream.decodeText(), Stream.splitLines, Stream.runForEach(...)) ...

before = yield* Effect.raceFirst(/* unchanged: timeoutOption("30 seconds") and the exit */);

if (before === null) {
  const line = `CI_PROGRESS_CUTOFF ${JSON.stringify({ ...identities, last: yield* Ref.get(seen), advisories })}`;
  expect(line).not.toContain(scratch);
  yield* Console.log(line);
}

expect(before).not.toBeNull(); // unchanged, :312
```

## One value traced: the cutoff child, today and with the patch

Times are a sketch, in ms after the worker's first task update.

1. `0`: `suite-prepare` for `probe.test.ts` is the worker's first update. `now - 0 > 100`, so it
   is sent at once and `last` is set. The reporter appends `module started`.
2. `0.1` to `0.5`: `beforeAll`'s start and end, `test-prepare`, `beforeEach`'s start and end. The
   first of them sets `pendingCall` to a 100 ms timer; the rest join the pack.
3. `0.5`: the test body prints `CI_PROGRESS_READY` and awaits a promise that never settles.
4. Parent: it sees the ready line, arms the watch and reads the journal: run started, module
   queued, collected and started. The condition is false, so it waits on `Queue.take`.
5. `~100`, today: the timer re-enters with `Date.now() - last` at 100 or less. `pendingCall` still
   holds the spent id, so nothing is scheduled. No update comes after it. The journal never grows,
   the 30 s bound ends the wait, `before` is `null`, and the law is red at `:312`.
6. `~100`, patched: the timer clears `pendingCall` and re-enters, which sets a new timer. At
   `~200` it sends the pack. The main process appends the hook and test lines, the watch wakes the
   law, the condition holds while the child still runs, the kill lands, and final JSON is absent.
   Green.

## Laws

No new law joins the integration file. P8 keeps every expectation, its 30-second bound, its
fixtures and its config bytes, and P9 is untouched. A stand-in cannot replace P8: the fault lives
in the real worker's timer and RPC and the proof needs a real kill (0581's reason, which the 1144
plan already gave). Each plant is run once, on disposable CI only.

| Law | Kind | Generator or reason | Check | Plant |
| --- | --- | --- | --- | --- |
| P8 a ready-observed SIGKILL child's journal shows the blocked test, then final JSON stays absent (unchanged) | test | scenario: a real Vitest child whose worker sends task updates through its own 100 ms throttle and RPC, then a real SIGKILL; no stand-in has the worker's timer, the main process or the kernel's file | Unchanged expectations at `:247` to `:367`; with the failure line, a `null` wait first prints `CI_PROGRESS_CUTOFF` with the last journal read and no machine path | A: the trailing timer at `ms / 2` with today's `??=` line (hunk below): red at `:312` on every run after about 31 s, and the printed journal holds `module started` but no `test started` and no `beforeEach` end. B: the same `ms / 2` with the fix: green |
| H7 host.yaml's `p8` suite starts by hand only, runs only the P8 file at full depth on `ubuntu-latest`, fails on a red law and always uploads its proof | lint | lint | `lintHost` in `.github/ci/workflow-lint/host.ts`, through `host.test.ts`'s existing fixture style | Each once in `host.test.ts`: another test file in the command, `macos-15` or no time limit, `continue-on-error: true`, the upload on `success()`, `p8` missing from `suite`'s options |
| H1 and H3 still hold for `l13`, `e88-r6` and `box` | lint | lint | The existing rules, with `p8` added to the option and job lists | The existing `host.test.ts` plants stay red |

Plant A's hunk, in the plant's own patch file on a scratch branch (today's line, early timer):

```diff
-		pendingCall ??= setTimeout(call.bind(this), ms, ...args);
+		pendingCall ??= setTimeout(call.bind(this), ms / 2, ...args);
```

The early timer runs 50 ms after the first held call, when `Date.now() - last` is about 50, so the
`??=` line strands the pack on every run unless the worker stalls 50 ms between two calls a few
microseconds apart. The same copy of the function as above stranded 25 of 25 tries with plant A and
0 of 25 with plant B, with 0, 3 and 20 ms of work between the calls. Plant A affects only a test
that never ends: a finished file flushes every pack (`finishSendTasksUpdate`, `:3800`). R1 stops
P8 at its first probe, the cutoff one, but still runs P9, which stays green; R2 runs P8's normal,
timeout and unwritable probes under the same early timer, and they stay green.

## Files

| File | Owner | Product lines expected | Change |
| --- | --- | ---: | --- |
| `patches/vitest@5.0.5.patch` (pnpm's name, read as `patches/vitest` by the path scan) | tests | 15 | New: the one hunk at the top, made with `pnpm patch` and `pnpm patch-commit` |
| `pnpm-workspace.yaml` | tests | 4 | `patchedDependencies` gains `vitest@5.0.5` and its comment |
| `pnpm-lock.yaml` | tests | 55 | The patch hash and every `vitest@5.0.5(...)` key that gains it, written by pnpm; mechanical |
| `.github/workflows/host.yaml` | tests | 30 | The `p8` option and job (doubt 1), and the header comment's suite list |
| `.github/ci/workflow-lint/host.ts` | tests | 20 | H1 and H3 lists gain `p8`; the new H7 rule |
| `.github/ci/workflow-lint/host.test.ts` | tests | tests | H7's plants; H1 and H3 fixtures gain `p8` |
| `.github/ci/progress-reporter.integration.test.ts` | tests | tests | The failure line only (doubt 2): `seen`, the stderr advisories and one guarded print before `:312`. No expectation, bound or fixture changes |
| `.github/ci/progress-reporter.ts` | tests | 0 | Read only: the reporter, unchanged |
| `.github/ci/progress.ts` | tests | 0 | Read only; its project list is the first finding row, not this ticket |
| `.github/ci/proof.ts` | tests | 0 | Read only: why a branch proof run cannot run P8 |
| `.github/workflows/scheduled.yaml` | tests | 0 | Read only: the brief's proof route, which runs `--project tooling` on a branch |
| `.github/actions/pnpm` | tests | 0 | Read only: the setup step the `p8` job reuses |
| `vitest.config.ts` | tests | 0 | Read only: project names and the 60-second test limit |
| `package.json` | tests | 0 | Must not change (PR 1646 owns it) |
| `.oxlintrc.json` | tests | 0 | Must not change (PR 1647 owns it) |
| `docs/plan/README.md` | lead | docs | One sentence in the ticket 1144 paragraph: why a hung test could be missing from the journal, and the patch |
| `docs/plan/quests/t1170-PLAN.md` | lead | docs | This plan |

Every changed path sits under the exam paths, so the tests step writes all of it and there is no
build step, as in PR 1624. `package.json` and `.oxlintrc.json` do not change. If
`pnpm patch-commit` writes to `package.json` anyway, the tests step moves the entry to `pnpm-workspace.yaml` by hand and checks
`git diff --stat package.json` is empty; if pnpm refuses that, it is a question for the lead
(PR 1646 owns `package.json`).

## Existing tools

- The fix: searched our reporter, Vitest's reporter API (`onTaskUpdate`, `onTestCaseReady`) and
  its config for a flush or an interval setting. None reaches the worker's module-private
  throttle. Found Vitest 5.1.0's own fix and use it as a `pnpm patch`, the repo's way for a
  package bug. A bump to 5.1.x was weighed and not taken (see calls).
- The proof suite: searched every workflow file (`scheduled.yaml`, `host.yaml`, `plant.yaml`,
  `plants.yaml`, `l11-exercise.yaml`). Only `host.yaml` runs named laws by hand on a branch
  (`e88-r6` runs `next-integration` laws there today). A new workflow file cannot be started on a
  branch before it is on main (GitHub's rule, as `plants.yaml`'s header records). So `p8` is a
  fourth fixed suite there, copying `box`'s steps.
- The failure line: reuses the law's own `collect` result, `identities` and the
  `CI_PROGRESS_*` line style of `:466`, Effect's `Ref`, `Stream.decodeText` and
  `Stream.splitLines` (installed Effect 4.1.3, `Stream.ts:16877`, `:16949`). No new helper.

## Validation and proof

Format first. The tests step runs `nice -n 15 pnpm exec vitest run --maxWorkers=3
.github/ci/workflow-lint/host.test.ts` while it works. The integration file never runs in a box or
on a laptop (0594, as the brief says), not even its plants. The lockfile change is a rerun trigger,
so the lead uses narrow paths, not `--changed`, and the pull request's own checks run the full
plain suite.

P8 is a host-only law: it sends a real signal. Its proof runs after the tests step and before the
first review (0178, 0594), on disposable Linux CI through the new suite, started by hand with
`gh workflow run host.yaml --ref <branch> -f suite=p8`. It does not run on the owner's Mac, so no
launchd read or owner's yes is due. The suite's concurrency group cancels a second start of the
same suite at the same commit, so the runs below go one at a time.

| Run | Ref | Expected |
| --- | --- | --- |
| R1, plant A | a scratch branch from the step's head, the fix hunk swapped for plant A's | P8 red at `:312` after about 31 s; the `CI_PROGRESS_CUTOFF` line shows no `test started`; P9 green |
| R2, plant B | a scratch branch from the step's head, fix plus `ms / 2` | P8 and P9 green |
| R3 to R10 | the pull request's head | 8 green runs in a row of the whole file |

The tests step prepares the two plant commits (each with its patch file and lockfile hash) on
local scratch branches; the lead pushes them, starts R1 and R2, and deletes both branches after.
After the merge, main's full runs keep running P8 as before.

**Why 8 green runs.** The cutoff probe in its current shape ran on GitHub's Linux runners 6 times
that I could find: green in branch proof runs
[44108835179](https://github.com/kamp-us/tea-fabrika/actions/runs/44108835179) and
[44117144227](https://github.com/kamp-us/tea-fabrika/actions/runs/44117144227) and main full runs
[44410430015](https://github.com/kamp-us/tea-fabrika/actions/runs/44410430015) (its cutoff and
normal probes passed before the leg was canceled) and
[44426789535](https://github.com/kamp-us/tea-fabrika/actions/runs/44426789535); red in
[44315669639](https://github.com/kamp-us/tea-fabrika/actions/runs/44315669639) (`:356`) and
[44428278854](https://github.com/kamp-us/tea-fabrika/actions/runs/44428278854) (`:312`). The other
10 main full runs since P8 landed that started tooling legs were canceled before those legs
reached it. Two of six is
about 33%. If the rate were still that high, 8 greens in a row would happen less than 4% of the
time ((2/3)^8 = 0.039). It cannot rule out a second, rarer cause: at 10%, 8 greens happen 43% of
the time. That is why the deterministic plant, not the count, carries the proof of the mechanism.
On a cloud box the law passed 16 of 16 (1624's tests and review steps), so the rate depends on the
runner. Sure of the number 80%.

## Calls and settings

- **A patch of 5.0.5, not a bump to 5.1.1 (85%).** The patch changes one function; a minor bump
  changes every test run in both versions at once, with `@effect/vitest` and Stryker's runner on
  top. The patch goes at the bump. Not a setting: it is a dependency fix.
- **The law is right and keeps its expectations (95%).** It found a real gap in the reporter's
  purpose. Decision [0036](../../../.decisions/0036-a-flaky-test-is-fixed.md) holds: no timeout
  grows, no retry, no expectation, seed or wait limit changes, the 30-second bound included.
- **The cause is not in our code, and is proven by reading upstream (0036's "no, and proven"
  branch), so the fix removes it upstream's way rather than adding a wait (90%).**
- **No upstream issue (85%).** Vitest 5.1.0 already ships the change. If the lead wants a link in
  the patch comment, the Vitest pull request is still to be found; this session could not read
  GitHub's API for that repository.
- **The suite name `p8` and its runner are not settings:** they are a fixed proof route, which
  `lintHost` pins, like `box`.
- **What fact is lost if not recorded now:** what the child's journal held when a cutoff wait ends
  empty, and the child reporter's own error lines. This sighting lost both. The failure line keeps
  them for the next one (doubt 2). The run IDs and the 2-of-6 count go in the tests and lead run
  rows, since a later bump will change the rate.

## Size

1. One pull request: the Vitest patch, its declaration and lockfile, the `p8` proof suite with its
   lint, and the law's failure line, about 124 lines (15 patch, 4 workspace, 55 lockfile, 30
   workflow, 20 lint), plus tests and one plan sentence. Size confidence 80%: the lockfile count is
   pnpm's, not mine. If GitHub refuses `-f suite=p8` because main's `host.yaml` lacks the option, the suite and its lint land first as their own pull
   request and the patch follows; the size of each stays as listed.

Budget basis: field run rows of 2026-11-18 for tickets 1178, 1180 and 1181: tests $0.70 to $1.49,
build $0.22 to $0.50, review $2.09 to $2.38, at list price. This one has no build
step and waits on 10 CI runs, so I price tests at $4.50 (laws, patch, suite, plant branches), review $2.50 and one
send-back $1.50, then round up.

Estimate: 3 steps, $10

## Records

Each step writes its run row the same day. The tests row records plant A and B as plants with their
CI run IDs. The lead's row records R1 to R10. The two finding rows below are saved as given. No
decision is made here; nothing in `.decisions/`, the glossary or `.patterns/` changes.

## What this plan cannot tell us

- What the red run's journal held at 30 seconds: the law did not print it and the child's stderr
  was drained. The cause is inferred from the duration, the code, upstream's own change, both
  sightings' timings and a copy of the function, not read from that journal.
- Whether Node's timer rounding is the only way the timer runs early on a runner. The plant forces
  the early run; it does not show how often CI produces one.
- Whether a real hung test on main has already been misnamed in a time table by this strand. No
  such leg was looked for.
- Whether the macOS route (H3 as it stands) would be accepted instead of `ubuntu-latest`.
- No test, install or typecheck ran in this step. The simulation above was a copy of one function,
  run outside the repo.

## Open questions

None.

Nothing here is the owner's to answer. The three doubts at the top are the lead's to weigh, and
each has a lean.

## Findings

```json
{"_tag":"finding","id":"2026-11-19-progress-journal-refuses-tooling-integration","date":"2026-11-19","by":"plan","model":"claude-opus-5-5","rule":"bug","location":{"path":".github/ci/progress.ts","line":39},"says":"In today's CI, the progress journal allows the projects next, next-integration, next-visual and tooling but not tooling-integration, so every callback from a tooling-integration law is dropped as 'vitest-progress: metadata unavailable' and every tooling leg's time table reads partial, with write gaps.","proof":"vitest.config.ts:260 names the project tooling-integration; progress.ts:39 allows only [\"next\", \"next-integration\", \"next-visual\", \"tooling\"]. Main full run 44428278854, job 135239318310, printed 8 'vitest-progress: metadata unavailable' lines, all while .github/ci/progress-reporter.integration.test.ts ran, and its time table said 'Journal partial' and 'Reasons: write_gap. Gap starts: 2741, 2747, 2755.' The green leg in run 44426789535, job 135233711469, printed the same 8 lines and 'Gap starts: 2743, 2749, 2755.'","cost":"On main's full run, a hung tooling-integration law, the kind that starts processes, is never shown as the last observed activity, and a real write gap on a tooling leg cannot be told from these.","head":"5c2dc3102030f3abacf6a97d109fe2d0ef21230d","ticket":"kamp-us/tea-fabrika#1170","pr":null}
{"_tag":"finding","id":"2026-11-19-p8-fixed-bound-against-0609","date":"2026-11-19","by":"plan","model":"claude-opus-5-5","rule":"rule_break","location":{"path":".github/ci/progress-reporter.integration.test.ts","line":309},"says":"In today's CI, the P8 law waits for the child journal's acknowledgement under a fixed 30-second bound, which decision 0609 rules out: a law waits on the event, and only the test runner's own limit backstops a part that never answers.","proof":".github/ci/progress-reporter.integration.test.ts:309 reads `observation.pipe(Effect.timeoutOption(\"30 seconds\"), Effect.map(Option.getOrNull))`; .decisions/0609-laws-wait-on-events-never-on-a-fixed-time-bound.md's binding constraint says 'No law wraps a real build or other machine-speed work in a fixed time bound.' PR 1624 (da86605) added the bound on 2026-11-18, the date 0609 was accepted.","cost":"The law keeps a shape an accepted decision forbids, so the next fix to it must first settle whether 0036's 'no timeout grows' or 0609's 'remove the clock' governs; on a very slow runner a slow acknowledgement turns the law red instead of only slower.","head":"5c2dc3102030f3abacf6a97d109fe2d0ef21230d","ticket":"kamp-us/tea-fabrika#1170","pr":null}
```
