---
name: mutation
description: Run the hourly mutation check on what merged to main with StrykerJS, and sort each real gap by hand into a tracker ticket (the CI run files none). Use when a brief says "use the mutation skill", for the hourly run or for a quest parked inside a mutation step.
---

# The mutation run

Mutation is no step of a pull request. It runs against
main, starting itself after a push and on an hourly catch-up, on the changed lines of what merged since
the last passing run, in the container, with the tests beside the changed files. No new merge, no run.
A merge never waits on it, and a heartbeat opens an issue when merges wait too long for a passing run.

- **The hourly run** changes nothing in the repo. Its result is the job summary and the `mutbox`
  artifact. It files no ticket today: the CI job cannot reach the local tracker, so no real gap is
  filed and nobody is told of one. Read the survivors from the artifact (step 3 below sorts them). A ticket
  will add a filer; until it lands, the steps below that file tickets and the category list
  ([below](#a-gaps-category)) are what a person or session does by hand from the artifact, and a
  survivor the run finds is not yet a ticket. A narrowing (arm a kills, arm b lets live) is a loosening,
  and is found the same way, by hand.
- **A quest parked inside its mutation step before 0066** finishes it with the steps below, as the
  ticket's test writer, test files only; then the quest goes on to review.

A brief names the ticket or the merged range, and the build commit or files to mutate. This skill
holds the rest. The fast check's settings: changed lines
first, five minutes, survivors as advice.
[`AGENTS.md`, "Finish your task"](../../../AGENTS.md#finish-your-task) says when to keep going, what needs
no approval and how to write the report.

Never print npm, pnpm or env settings. The runner strips secret settings and redacts saved output.

## Steps

1. **Read** `AGENTS.md`'s mutation rules.
2. **Read the fast check's report.** `drive.ts` ran it before you started, in a container with its
   own network, with
   [the command below](#the-command). Your prompt holds its report, `mutbox.json`, whole. Never run
   Stryker yourself, and start nothing that listens on a port. `run.sh` and `sample.ts` hold file
   selection, the seed, sample cap and round settings. Ask before you scale up.
3. **Sort each survivor:** real (a law should catch it), equivalent (no behavior changes) or
   unconfirmed. A schema or class created during module loading needs a hand-planted check
   before any claim. In a disposable copy, show the unchanged code passing in a fresh process.
   Apply the exact mutant replacement and run the relevant laws in another fresh process.
   Report killed when they fail on that change. Report equivalent only with evidence that no
   behavior changes. Otherwise report unconfirmed and why. Keep static mutants off.
4. **Survivors advise.** A real survivor never holds the pull request. Kill one with a new or
   tighter law, in test files only, when the law is clear; list the rest in the report. Run the
   touched tests and `pnpm lint`. Step-commit checks staged formatting.
5. **Commit** changed laws with the step-commit skill, as `mutation`. When `drive.ts` runs you in a box,
   commit nothing: leave every change in the tree, and drive commits and signs it as one step commit.
6. **Report** actual tested, killed, survived, timeout, compile-error, uncovered,
   reused and unreached counts, plus the seed and `sample.json` totals; each survivor with
   `file:line` and its status, with hand-plant evidence for startup survivors; the laws added;
   the commit. If the five minutes ran out, say
   how many lines and mutants it did not reach. That is reported, and the pull request goes on.
   Name every test the report lists under `excluded` or `skipped`, with its reason: those did not
   run. Give the report's `narrowing` list as the arm a against arm b comparison. Quote its
   `reach` line, "the sample reached N of M changed files", with the files it names.
   When the sampler selects no mutation ranges, because the diff has no product lines, commit
   nothing and end with `answer: skip <why>`; review takes that row in place of a mutation run.

## The command

The settings are the decided fast check
on StrykerJS 10.1.1 (read `pnpm-lock.yaml` first; a newer Stryker may rename an option).
`--ticket` is the ticket, `--build` the build commit, `--base` the commit whose tests are arm a.
With a base, the sample is the pull request's own lines, `base..build`, so a tip that merged main
samples the quest and not main (ticket 568); with none, it is the build commit against its parent.
`--related` is the explicit related-test paths, separated by commas; in a brief that is one line,
`RELATED=<paths>`, which `drive.ts` reads. They are the tests that run, never the files mutated:
the sample is drawn from every changed product file in the diff (`PRODUCT` in `scope.ts`: `.ts`,
`.tsx`, `.mts`, `.cts`, `.js`, `.jsx`, `.mjs`, `.cjs`, less tests and `.d.*`; of `.agents/`, only
`chain.ts`, `drive.ts` and the lead's `flow/` folder, 0089), each file's cheapest
range first, round-robin, so every changed file gets a mutant before any gets a second (ticket
655). For arm a, name the base's test file a moved or changed law came from too: arm a runs only
the related tests the base has. `--plan` is the approved plan; drive passes it.
The executable inside the container is `scripts/run.sh`, from the build commit. There it mutates
the container's own copy in place (`IN_PLACE=1`); its header says why (ticket 457: without it a
quest read 0 kills of 61). A quest built before that fix samples with the old `run.sh` until it
merges main.

**The run happens in a container, never on the host and never in an agent's sandbox**. Stryker starts a logging
server that listens on a port. The container has its own network (`--network none`), so it may,
and nothing on the laptop is opened. `mutbox.ts` copies the build commit in read-only, mounts
nothing from the home folder, and takes the one Docker box lock. `drive.ts` runs it for a
mutation step. By hand:

```sh
node .agents/skills/lead/scripts/mutbox.ts run --checkout . --ticket 520 --build abc1234 \
	--base origin/main --related .agents/skills/mutation/scripts/sample.test.ts \
	--out ../boxes/t520-mutbox --lock ../boxes/state/docker.lock
```

It prints one JSON line and writes it to `<out>/mutbox.json`: `done`, `skip` (no product line) or
`stuck`. Docker missing or stopped is `stuck`. It is never run on the host instead.

- `excluded` names each related test left out before the run, with why: a test that loads
  Electron or a browser driver needs a display, and the container has none. That is read from its
  parsed imports, so a lint rule's test whose planted strings name Electron still runs. `skipped` names each
  test that skipped itself inside the container. Neither ran. A test that fails there before any
  mutant makes the run `stuck`, naming it.
- `b` is the branch's own tests. `a` is the same sample against the base's tests, and `narrowing`
  the mutants `a` kills that `b` lets live. `reach` is the line "the sample reached N of M changed
  files", naming each file with zero mutants.
- Arm a first runs the base's related tests on the build and keeps only the files that pass,
  since Stryker stops at a failing test in its dry run; `armA.dropped` names each one left out
  and why.
- A run never passes silently. A known gap is `done` with the gap in its reason and `narrowing:
  "unknown"`: `no_arm_a:base_has_none` or `no_arm_a:none_pass` (arm a had nothing to run), and
  `no_reach:old_sampler` (the build's `sample.ts` predates per-file reach). Say so in the report;
  the lead hand-checks the laws as for a loosening hit. Arm a that was due and gave no clean
  answer is `stuck` `arm_a_failed`, and a sample that reached none of the plan's build-owned files
  with a mutant on their changed lines is `stuck` `no_build_reach`.

- `<out>/box/b/report.json` holds every answer when Stryker finished. When the cap stopped it,
  `mutbox.ts` reads `events/*-onMutantTested.json`, one file per mutant as it came: that is what it
  kept, and the arm says `from: "events"` and how many were `unreached`. Keep selection omissions
  (`left`) separate from selected mutants not tested before the cap.
- **A dry run is not proof.** Ignored or uncovered mutants alone are not proof either. At least
  one mutant needs a real test result. Record the dry-run log and the actual result counts.

## The guard check

The builder runs it once its laws are green, and the reviewer on the branch, as their skills say.
It is the same container run on a smaller scope: `scripts/survivors.ts` picks the product files
(those a change touches, or those `--files` names), finds the laws whose imports reach them, and
hands mutbox a commit whose parent holds the base's version of those files, so the sampler draws
from their changed lines (a named file the change does not touch is mutated whole). Its header
holds the flags, the settings `MUTATE_SECONDS` (default 300), `MUTATE_FILES` (default 8) and `MUTATE_RUNS` (default 25), the
exits, and what it cannot see. It prints one line per survivor: `lived` (a law ran it and
passed), `no law ran`, or `no law loads` for a file no law reaches, then `static` lines Stryker
skipped, then the counts and seconds. A scope past `MUTATE_FILES` is refused before Docker starts.
A lint rule under `oxlint-plugins/` also gets the test beside it, `<rule>.test.ts`: it lints through another process, so no import reaches the rule. The output lists the laws found by import and those found by name. That test covers every mutant of its rule file, so a rule test that never lints through the mutated file leaves each mutant printed as `lived`, though no law ran that line.
`MUTATE_RUNS` is the most cases a property law draws in the box, or `full` for each law's own count: the laws run
three times over (the plain baseline, Stryker's dry run, then once per mutant they cover), so at full depth the slow
ones alone passed the five minutes on `@kalfa/git`. A law that asks for fewer keeps its own count, the seed stays its
own, and `depth.ts` says what the cap reaches. A mutant that lives at the cap is run again at full depth, in only the laws that cover it, and is listed only if it lives there too:
the cap is the fast path and full depth the fallback (`recheck.ts`). The last line gives the counts at both depths. The depth is in the saved-run key. The hourly
run on CI passes none and keeps full depth.
Before that recheck, the box type-checks each mutant that lived, in its own package (`recheck.ts`, `tsc --noEmit`, 90 s in all): the vitest
runner strips types, so a mutant `tsc` refuses would otherwise live. One that does not compile is a kill (`CompileError`), is not listed and is
not run again at full depth, and the last line counts them. A package that fails `tsc` as it is, or a file in no package, is not judged.
A `Survivor:` line answers only with a proof in its evidence (`plant:`, `rg:` or `law:`), as [the build skill](../build/SKILL.md) shows.
A later commit takes a row back with `Survivor-withdrawn: <file>:<line> <reason>`: the place then has no row, so a `refused` line of old code is gone and a mutant that lived there is listed again.
A call whose base, tree, files and scripts match a saved run reads it and starts no box, and a call that
needs the box waits its turn in line, one box at a time; its header holds the settings and says how.
`mutbox.ts run --wait <seconds>` takes a place in the same line. Drive's mutation step still refuses at the
lock before it starts mutbox, and the hourly run on CI has a lock of its own.

## The hourly run, in CI

The hourly run on main runs in
GitHub CI, in `.github/workflows/mutation.yaml`, on the free arm64 runner. It starts itself: on every
push to main, on an hourly cron as the catch-up (GitHub's cron fires only about 3 times a day on
this repo, so the push is the real clock), and by hand. No person or session has to remember it. It runs
the command above with `--ticket 0`, the range's base as arm a, and the tests beside the changed files as
`--related`. One run at a time: a run that starts while one runs waits, and only the newest waiting
run is kept, so a burst of merges costs one more run up to the newest head.

The base is the commit the last passing run on main ended at, read from GitHub's run list (a run
passed when its `mutation` job passed, so a run the gate skipped never counts). A run that fails leaves
it where it was, so the next run mutates that range again. The range is cut so one run takes at most
`MUTATION_MAX_RELATED` related test files (default 12, a setting in the workflow's `env`): mutbox stops
the container at 900 s, so a range of hundreds of files could never pass and would only grow. `range.ts`
moves the base forward along main's first-parent commits until the range fits, and the job summary says
how many commits it left unmutated (the first run after the 13-day gap left about 660). Commits cut away
are never mutated unless you run them by hand with a `base`: a bigger `MUTATION_MAX_RELATED` in a pull
request, or a dispatch with an older `base` (the cap applies to it too). No gap paces the run: replayed on
the real history it is about 44 runs a day, with no merge waiting more than 16 minutes at the 90th percentile
(a 60-minute gap gave 0.65 false alarms a day). The gate (`mutation-gate.mjs`) only skips a head a passing run
already covered, and backs off a run that keeps failing: after `MUTATION_FAIL_STREAK` failed runs in a row
(default 3), a push starts the work only when none started within `MUTATION_FAIL_GAP_MINUTES` (default 60),
so a broken image cannot burn a slot all day; a pass resets the count.

1. **Start it by hand** (only to re-run, or to skip a range). `base` is the commit to mutate from, and
   `head` is main's head unless you give one:

   ```sh
   gh workflow run mutation.yaml -f base=<sha>
   ```

   A hand run with a `head` older than main's leaves the next base at main's head when it started, not
   at that `head`; give no `head` unless you mean it. A hand run always passes the gate, backoff included.

2. **Find it.** The newest row is yours; a second run waits until the first ends:

   ```sh
   gh run list --workflow mutation.yaml --limit 1 --json databaseId,status,conclusion,headSha
   gh run watch <id> --exit-status --interval 60
   ```

   Keep `--interval 60`: the default asks GitHub every 3 seconds, about 40 calls a minute of the
   5,000 an hour the login gets, for as long as the run takes.

3. **Read it.** The job summary has the range and the counts. The whole answer is the artifact
   `mutbox`, with `mutbox.json` at its top:

   ```sh
   gh run download <id> --name mutbox --dir <folder>
   ```

A run with survivors passes. The job fails only when mutbox says `stuck`: the run broke.

### The heartbeat

`.github/workflows/mutation-heartbeat.yaml` runs `scripts/heartbeat.ts --issue` on a push to
main, each hour and by hand; its own gate lets a push or the cron through only when no check started in the last
hour. It watches the outcome, so it alarms whichever way the runs stop
(the push trigger, the cron, the backoff, GitHub's scheduler, or runs that fail). When a merge on main has waited
longer than the limit (210 minutes, two full runs) for a passing run, it goes red and opens one GitHub issue
titled "The hourly mutation run is late", labeled `mutation-heartbeat` (not `ci-scheduled`, which
switches on a sev1). A passing run closes the issue. The script's header holds the rules.

- **The limit** is `MUTATION_LATE_MINUTES`, the environment of the heartbeat job. Leave it unset for 210; it must be 105 to 1440 (below 105 a healthy run alarms).
- **A pause on purpose** is `MUTATION_PAUSE` in the same job: `{"until":"<ISO time>","reason":"<why>"}`.
  Until the end the check stays green and opens no issue; at the end the alarm is back on by itself. A pause
  with no end or no reason fails the check. Set one in a pull request, so the commit says who and why.
- **What it cannot see:** if the heartbeat workflow itself stops (disabled, or GitHub's scheduler
  and pushes both fail), nothing says so. An outside dead-man switch would, and none is set up.

`scripts/limit.ts` sets each arm's test and hook limit; its header holds the numbers.

## A gap's category

Each real gap filed from the hourly run gets one category. The hourly run in CI files none itself
today (it cannot reach the tracker; a ticket will add a filer), so a person or session reading
the artifact files them by hand with these steps. The tracker tickets are the
record: keep no other file. No script holds this yet.

1. **Pick one category** by the test that is missing. The mutator is a hint, not the rule. The
   closed list is in 0077's table: `error_branch`, `boundary`, `condition`, `return_value`,
   `call_order`, `fallback`, `other`. A gap that fits none is `other`; never coin a new word.
2. **File the gap** with the title `mutation gap (<category>): <file>`. The body names each
   mutant's line, mutator and change.
3. **Count.** Skip this for `other`. List `tracker_query` `{status: "all", find: "mutation gap
   (<category>)"}` and `{status: "all", find: "tests step: catch <category> gaps"}`. Count the gap
   tickets filed after the newest tests-step ticket of that category, or all of them if there is
   none.
4. **At two or more,** if that tests-step ticket is still open, comment the new gap on it.
   Otherwise file one ticket, `tests step: catch <category> gaps`, naming the gaps. It asks, in
   order, for a code check that would have caught the category (a lint rule, a plancheck rule, a
   test helper), else a row the plan's laws table must carry, and skill prose only if neither can
   hold it.
5. **One gap alone** changes nothing but its own test.

## Outside your task

Something wrong outside your task is one finding with proof, never a fix.

A survivor is this step's own answer and stays in its report, never a finding. Outside
means anything else you meet that is wrong.
Put it in your report.

## Go easy on the machine

The test config and typecheck.ts hold worker, home and typecheck limits.

- To wait for a process, wait on its pid or use `pgrep -x <name>`: `pgrep -f` matches the waiting
  shell's own command line, so that wait never ends.

## Never

- Write scratch files outside your own scratch folder, the one your brief names.
- A survivor the product should catch, but a law cannot reach, goes in the report for the lead.
- Write a mutation skip list: that is the exam, and the owner's.
