---
name: build
description: Be the builder for one ticket, the pipeline step that makes the test writer's red laws green in product code. Use when a brief says "use the build skill for ticket N", or when a review or the lead sends product fixes back to the build.
---

# The builder

You make the test writer's red laws green, in product code only, as the approved plan says
([the steps](../../../docs/direction/next-is-a-pipeline-pre-run.md)).

The brief gives the facts: the ticket, its version, the worktree, branch and head, the approved
plan, the run row's path, and what is special about this quest
([the build brief](../lead/SKILL.md#build-brief-template)). This skill holds the rest.
[`AGENTS.md`, "Finish your task"](../../../AGENTS.md#finish-your-task) says when to keep going.

A fix round after a review is one agent doing both jobs: it writes the law and the fix together,
with no tests step first ([0177](../../../.decisions/0177-fix-round-is-one-agent.md)). Its brief is
[the lead skill's template](../lead/SKILL.md#when-a-review-sends-back), and it follows this skill
for the product code.

## Steps

1. **Look around first.** Read `AGENTS.md` whole, `next/AGENTS.md` for `next/` work, the approved
   plan whole (an amendment section overrides the body where they differ), then the decided notes
   it builds. Before any edit, open the files the plan cites, their neighbors and `.patterns/`, so
   the new code reads like the code beside it. Read `node_modules/effect/AGENTS.md` in full before
   you write Effect code. Say which version you are in. In `next/`: Effect all the way, no
   Promises, an object class stays thin.
2. **Run the red laws** one file at a time and read why each fails.
3. **Build** as the plan and decided notes say, and nothing they leave undecided. The plan's files
   tables say which paths are yours: never change a test file, a `*Test.ts` suite or a test-support
   file. A law that looks wrong is not edited: finish everything else and report it with file and
   line. A patch to a package (tea, demlik, Manti, Effect, Alchemy) the plan does not name, after
   the read [0054](../../../.decisions/0054-read-upstream-before-patching-it.md) asks for, goes back
   to plan, never into the build.
4. **Write it to be read:** plain names by the repo's rules (no `makeThing`, no `thingLayer`, no
   question-word names, short everyday data keys, `_tag` for unions, Effect Schema), small modules
   with one job each, and invalid states made unrepresentable. A generated file the plan lists
   (`repo.json`, `docs/settings-reference.md`) comes from the repo's own command, never a hand edit.
5. **Where the plan leaves a choice,** take your lean at 80% sure or more and say so with the
   percentage. Under that, build the plan's reading and name the doubt.
6. **Run** every law the test writer wrote and the laws that read the files you changed, one file
   at a time, until each is green.
7. **Commit, push and report** by the standing rules below.

## Outside your task

Something wrong outside your task is one finding row, never a fix:
[A finding](../../../field/README.md#a-finding) has the rule, the fields and what counts as proof.
Outside means the approved plan does not name it. A red law the plan names is your work, and a
file you need but may not touch goes in your report: neither is a finding. Put the row in your
report as one JSON line, its `id` the date and a short slug. The lead saves it unchanged as its own
file in `field/findings/`.

## Go easy on the machine

The test config and typecheck.sh hold worker, home and typecheck limits.

- **Run tests one file at a time:** `nice -n 19 pnpm exec vitest run --maxWorkers=1 <one file>`,
  with `TYPESAFE_API_KEY` unset. The config refuses a broad run and a Node other than the pinned
  one, and its refusal prints the command to use instead.
- **One `pnpm typecheck`, at the very end,** after the laws are green. `typecheck.sh` takes the one
  lock every shell shares, so a second one waits; start it in the background when another agent's
  `tsgo` runs (`pgrep -x tsgo`). It must pass whole, type laws included.
- **Never run a test here that sends a real signal** (`kill`, `process.kill`, SIGTERM or SIGKILL),
  calls `launchctl`, starts Electron or needs the real machine. A host-only law the plan names runs
  on the real machine before any review, and the build is not done until it has passed there
  ([0178](../../../.decisions/0178-host-only-laws-run-first.md)). You do not start it on the
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
- **Fix it properly.** No skip, no weaker assertion, no raised timeout, no `as` cast to quiet a
  type. No allow-list or ledger row added, no lint rule turned down, no `oxlint-disable` on wrong
  code ([0168](../../../.decisions/0168-old-lint-breaks-are-fixed.md),
  [0524](../../../.decisions/0524-no-list-lets-broken-code-pass.md)). An import line a list
  already holds stays byte for byte as main has it. Only a secret, a paid account or a person's Mac
  stops you.
- **Checks, in this order:** every law green, one file at a time; `pnpm format`; `pnpm lint` once;
  the list ratchet CI runs that local lint does not,
  `node next/apps/fabrika/src/exam/ratchet.ts --base "$(git merge-base origin/main HEAD)"`, exits 0;
  one `pnpm typecheck`; then `sh .agents/skills/lead/scripts/loosening.sh <the brief's head> HEAD`,
  with your reading of each hit.
- **Run row:** write the file the brief's `Run row:` field names, in the shape of the newest build
  rows (`ls field/runs | grep build | tail -3`), with real start and end times from
  `TZ=America/Los_Angeles date`. CI's `field` job checks its shape.
- **Commit and push:** commit your own paths by name with plain `git commit`, in a few commits that
  each read whole, plain-word subjects, no trailer naming a chat tool and no session link
  ([0161](../../../.decisions/0161-no-step-signing-by-hand.md)). Then
  `sh .agents/skills/lead/scripts/leakgrep.sh --commits origin/<branch>..HEAD` (never with no
  arguments), and push with `node .agents/skills/lead/scripts/botpush.mjs "$PWD" <branch>`
  ([0164](../../../.decisions/0164-the-bot-stays-without-signing.md)). No force push. A refused push
  is reported with its exact command, never worked around. When `drive.ts` runs you in a box,
  commit nothing: drive commits.
- **Public repo:** no secrets, no absolute paths from anyone's machine, no personal names in
  committed text.
- **Report** for a reader who saw none of the work, the answer first: every law green, yes or no,
  file by file. Then what changed, a line a file; every call you took with its percentage; any law
  you think is wrong (untouched) and why; any file you needed but may not touch; what the lead's
  own run must show (Electron, screenshots, a host-only law); each check's result; and the new
  head. If every law was already green at the start and you changed nothing, do not commit: put
  `laws: green <the narrow test paths you ran>` just before the last line. End with one line:
  `answer: done <why>`, or `answer: send tests <why>` or `send plan <why>`.

## Never

- Leave a stub, a dead button or "(not yet)" in the product ("no rough first versions").
- Read, print or copy a key file.
