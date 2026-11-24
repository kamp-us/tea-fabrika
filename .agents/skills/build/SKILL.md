---
name: build
description: Be the builder for one ticket, the pipeline step that makes the test writer's red laws green in product code. Use when a brief says "use the build skill for ticket N", or when a review or the lead sends product fixes back to the build.
---

# The builder

You make the test writer's red laws green, in product code only, as the approved plan says.

The brief gives the facts: the ticket, its version, the worktree, branch and head, the approved
plan, the run row's path, and what is special about this quest
([the build brief](../lead/SKILL.md#build-brief-template)). This skill holds the rest.
[`AGENTS.md`, "Finish your task"](../../../AGENTS.md#finish-your-task) says when to keep going.

A fix round after a review is one agent doing both jobs: it writes the law and the fix together,
with no tests step first. Its brief is
[the lead skill's template](../lead/SKILL.md#when-a-review-sends-back), and it follows this skill
for the product code.

## Steps

1. **Look around first.** Read `AGENTS.md` whole, `next/AGENTS.md` for `next/` work, the approved
   plan whole (an amendment section overrides the body where they differ), then the decided notes
   it builds. Before any edit, open the files the plan cites, their neighbors and `.kalfa/patterns/`, so
   the new code reads like the code beside it. Read `node_modules/effect/AGENTS.md` in full before
   you write Effect code. Say which version you are in. In `next/`: Effect all the way, no
   Promises, an object class stays thin.
2. **Run the red laws** one file at a time and read why each fails.
3. **Build** as the plan and decided notes say, and nothing they leave undecided. The plan's files
   tables say which paths are yours: never change a test file, a `*Test.ts` suite or a test-support
   file. A law that looks wrong is not edited: finish everything else and report it with file and
   line. A patch to a package (tea, demlik, Manti, Effect, Alchemy) the plan does not name, after
   the read asks for, goes back
   to plan, never into the build. A `GLOSSARY.md` the plan's files table names gets the terms the plan
   lists, each as a `**Term**:` entry with its meaning and an `_Avoid_:` line.
4. **Write it to be read:** plain names by the repo's rules (no `makeThing`, no `thingLayer`, no
   question-word names, short everyday data keys, `_tag` for unions, Effect Schema), small modules
   with one job each, and invalid states made unrepresentable. A generated file comes
   from the repo's own command, never a hand edit.
5. **Where the plan leaves a choice,** take your lean at 80% sure or more and say so with the
   percentage. Under that, build the plan's reading and name the doubt.
6. **Run** every law the test writer wrote and the laws that read the files you changed, one file
   at a time, until each is green.
7. **Time the laws at full depth.** Run each law file of step 6 once at full depth, by
   [the tests skill's step](../tests/SKILL.md#steps) (`FABRIKA_TEST_DEPTH=full` with the slow-law
   reporter), and put each law's time in your report. Your product code can slow a law the test
   writer timed, and CI runs at full depth. Fix a law the reporter fails in the product code; a law
   that is itself slow goes back to the tests step by report, since you never edit one.
8. **Run the guard check** once the laws are green, since a guard no law reaches passes every law:
   `node .agents/skills/mutation/scripts/survivors.ts --out <your scratch folder>/survivors`.
   It mutates the product files your diff touches, in the mutation container, against the laws
   that load them, and prints one line per mutant that lived (`lived`, `no law ran`, `no law
   loads`) with its file, line and what changed. When it refuses the scope as too wide, name the
   files that hold the guarding checks with `--files`. Answer each survivor in a guarding check:
   a law is missing, so list it in your report and end with `answer: send tests <the survivors>`;
   or it guards nothing, so write `Survivor: <file>:<line> <reason> -- <evidence>` in the commit body
   (`<file>:*` for a whole file), the whole line on one line: the check reads one line. After step
   9's commit, when the gate finds survivors on committed code, carry all the answers in one empty
   commit: `stepcommit.sh --empty --body-file <file> build <ticket> "<subject>"`
   ([the rule](../step-commit/SKILL.md)). The evidence names its proof, one of three, and the check
   refuses a line that names none, printing it as `refused`:
   - `plant: <command> => <result>`: you ran the mutant or the input and a command printed this.
     `plant: sed -i 's/=== 0/!== 0/' kalfa/git/src/Ref.ts && pnpm exec vitest run kalfa/git/src/Ref.test.ts => 12 passed, still green`
   - `rg: <search> => <result>`: a search shows no reader.
     `rg: rg -n "parseRef\(" kalfa --glob '*.ts' => one caller, Repository.ts:40, which never passes a bare name`
   - `law: <id>`: a law of the plan's laws table already catches it, so the box missed it.
     `law: R3 fails with the line planted`

   A claim without one of the three ("equivalent", "never", "covered") is a guess, and review has
   found each such line wrong. A mutant that does not type-check is a kill, since the box type-checks
   every survivor and counts the ones `tsc` refuses as `CompileError`, so such a mutant needs no line.
   Leave the `static` lines as they are:
   code that runs as the module loads, which Stryker skips and the reviewer plants by hand.
   The step is done when the same command with `--answered --answers <your commit body file>` exits 0:
   every survivor is killed by a law or carried as a `Survivor:` line. A second call on the same
   commit and files is instant: it reads the saved run and starts no box, so run it again after each
   `Survivor:` line.
9. **Commit, push and report** by the standing rules below.

## Outside your task

Something wrong outside your task is one finding with proof, never a fix.
Outside means the approved plan does not name it. A red law the plan names is your work, and a
file you need but may not touch goes in your report: neither is a finding. Put it in your
report.

## Go easy on the machine

The test config and typecheck.ts hold worker, home and typecheck limits.

- To wait for a process, wait on its pid or use `pgrep -x <name>`: `pgrep -f` matches the waiting
  shell's own command line, so that wait never ends.
- **Run tests one file at a time:** `nice -n 19 pnpm exec vitest run --maxWorkers=1 <one file>`,
  with `TYPESAFE_API_KEY` unset. The config refuses a broad run and a Node other than the pinned
  one, and its refusal prints the command to use instead.
- **One `pnpm typecheck`, at the very end,** after the laws are green. `typecheck.ts` takes the one
  lock every shell shares, so a second one waits; start it in the background when another agent's
  `tsgo` runs (`pgrep -x tsgo`). It must pass whole, type laws included.
- **Never run a test here that sends a real signal** (`kill`, `process.kill`, SIGTERM or SIGKILL),
  calls `launchctl`, starts Electron or needs the real machine. A host-only law the plan names runs
  on the real machine before any review, and the build is not done until it has passed there. You do not start it on the
  owner's Mac yourself. In your report, list each line the test can reach that signals a process or
  calls launchd (`kill`, `process.kill`, `launchctl bootout`, `launchctl kill`), and for each one
  what makes a wrong target impossible. The lead reads those lines, asks the owner, and then runs
  it or tells you to.
- On the real machine a test touches only its own label, files and processes. It uses its own temp
  home, never takes focus, and leaves nothing behind. One Electron test app at a time.
- Before you end, see that no test process from your runs is left. Check each one's path is this
  worktree before you stop it.

## Standing rules

These hold in every build round, so the brief does not repeat them.

- **Git in a worktree:** start every git command with `cd <worktree> || exit 1`, and bring the
  branch up first (`git pull --ff-only`, or the merge of `origin/main` the brief names; resolve
  nothing by dropping code). Ignore git's `gc.log` warnings. Run `pnpm install --frozen-lockfile`
  only when a module is missing.
- **Do not start subagents.** Do not mark the pull request ready, merge it or wait on CI.
- **Write scratch files only in your own scratch folder,** the one your brief names. A folder another agent
  shares is never written.
- **Fix it properly.** No skip, no weaker assertion, no raised timeout, no `as` cast to quiet a
  type. No allow-list or ledger row added, no lint rule turned down, no `oxlint-disable` on wrong
  code. An import line a list
  already holds stays byte for byte as main has it. Only a secret, a paid account or a person's Mac
  stops you.
- **Checks, in this order:** every law green, one file at a time, each `*.types.test.ts` the change
  touches included, by path under vitest as well as in the typecheck (only vitest runs its bodies); `pnpm format`; `pnpm lint` once;
  the list ratchet CI runs that local lint does not,
  `node next/apps/fabrika/src/exam/ratchet.ts --base "$(git merge-base origin/main HEAD)"`, exits 0;
  `nice -n 15 pnpm exec vitest run --changed origin/main` once, as `AGENTS.md`, "Checks", asks, and
  your report names each red in it that is not yours (a lockfile, tsconfig, `layer-rules.json` or
  `oxlint-plugins/**` change makes it the full suite, so the laptop refuses it: run the test files of
  what you touched, each by path, and leave the full run to CI);
  one `pnpm typecheck`; then `sh .agents/skills/lead/scripts/loosening.sh <the brief's head> HEAD`,
  with your reading of each hit.
- **Commit and push:** commit your own paths by name with plain `git commit`, in a few commits that
  each read whole, plain-word subjects, no trailer naming a chat tool and no session link. Then
  `sh .agents/skills/lead/scripts/leakgrep.sh --commits origin/<branch>..HEAD` (never with no
  arguments), and push with `node .agents/skills/lead/scripts/botpush.mjs "$PWD" <branch>`. No force push. A refused push
  is reported with its exact command, never worked around. When `drive.ts` runs you in a box,
  commit nothing: drive commits.
- **Public repo:** no secrets, no absolute paths from anyone's machine, no personal names in
  committed text.
- **Report** for a reader who saw none of the work, the answer first: every law green, yes or no,
  file by file, with each law's full-depth time. Then what changed, a line a file; every call you took with its percentage; any law
  you think is wrong (untouched) and why; any file you needed but may not touch; what the lead's
  own run must show (Electron, screenshots, a host-only law); each check's result; the guard
  check's survivor and `static` lines, its run time and what a capped run did not reach; and the new
  head. If every law was already green at the start and you changed nothing, do not commit: put
  `laws: green <the narrow test paths you ran>` just before the last line. End with one line:
  `answer: done <why>`, or `answer: send tests <why>` or `send plan <why>`.

## Lint findings

The two lint rules that `AGENTS.md`, "Checks", points here for, moved from there word for word:

- **Never switch a lint rule off to pass.** A `// oxlint-disable-next-line <rule> -- <why>` is for a
  line where the code is right and the rule does not fit, and its reason says why in plain words.
  The rules are in `.oxlintrc.json` and `oxlint-plugins/`
  ([its README](../../../oxlint-plugins/README.md)), the format settings in `.oxfmtrc.json`.
- **An unused export fails lint** (`pnpm lint:dead` runs that part alone). Check each finding
  by hand. If it is right, delete the code or drop its `export`. If it is wrong, stop and tell the
  owner: that is a code-graph bug to file. `unreachable-ledger.json` only shrinks, the run prunes
  it, and CI fails until that is committed. No entry is added: its last ones are fixed, then the
  file is deleted.

## Never

- Leave a stub, a dead button or "(not yet)" in the product ("no rough first versions").
- Read, print or copy a key file.
