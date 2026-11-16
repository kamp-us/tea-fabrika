---
name: plan
description: Write the plan for one pull request, read-only, as the pipeline's plan step. Use when a brief says "use the plan skill for ticket N", or when you are the plan writer for a hand-run ticket.
---

# The plan step

You write one pull request's plan. You change no product or test code. The lead reads the plan and
approves it, or sends it back. Return it unsigned, including when you review or revise a plan: only
the lead session fills the blank approval line.

The brief gives the facts: the ticket, its version, the worktree and branch, where the plan goes,
and what is special about this quest ([the plan brief](../lead/SKILL.md#plan-brief-template)). This
skill holds the rest. [`AGENTS.md`, "Finish your task"](../../../AGENTS.md#finish-your-task) says
when to keep going and how to write for a reader who saw none of the work.

## Steps

1. **Look around first.** Read `AGENTS.md` whole, then `next/AGENTS.md` for `next/` work, then
   `docs/plan/README.md`, the tier rows the brief names (`docs/plan/tier-1.md`, `tier-1-detail.md`),
   every direction note a row cites, and any note `rg -n "<row or word>" docs` finds. Open the code
   the plan will change and its neighbors before you design anything.
2. **Read the code as built,** on main. Read the installed versions in `pnpm-lock.yaml` (Effect,
   `@demlik/tea`, vitest, any patch in `patches/`) and check every API against that version.
   Before you propose a patch or change to a package (tea, demlik, Manti, Effect, Alchemy), read
   its decisions, patterns and source, and name its answer or say you found none
   ([0054](../../../.decisions/0054-read-upstream-before-patching-it.md)).
3. **Check what is settled** before you call anything open: `.decisions/`, `docs/direction/`,
   `experiments/`, `docs/plan/`, and the settled-search tool the brief names, if any. Run
   `node .agents/skills/lead/scripts/records.ts find "<words>"` for each open question, in two or
   three wordings, and read every hit.
4. **Lead with the known way.** How the makers do it (Elm and Erlang/OTP first, then Effect and the
   industry). Cite what you read; mark what you did not fetch. A web request carries no detail of
   this project.
5. **Write the plan** in the shape below, to the path the brief names (by default
   `docs/plan/quests/<quest>-PLAN.md` in the worktree). With no path in the brief, your final message
   is the whole plan.

## The shape

- `plancheck.sh --draft` checks the plan's format.
- How others do it, with sources.
- The shape: types in code blocks, Effect Schema, `_tag` unions, names from settled notes. Mark a
  sketch as a sketch.
- One value traced through, step by step.
- Laws use [generated inputs or a reason label](../../../docs/direction/five-steps-for-every-check.md#every-law-is-a-property).
  Ask of each law: lint, type or test? A shape check's cell says `lint` or `type`. Give each law
  the plant that should turn it red.
- When secrets must stay out of records, URLs or spans, use `[secrets]` and generated flows.
  Inspect every named output, including encoded URLs, and plant a leak into each.
- `plancheck.sh` checks file owners and keeps exam paths with `tests`.
- When the plan changes a skill, a rule code checks or could check becomes a check and leaves the
  prose. Only judgment stays in prose
  ([0408](../../../.decisions/0408-skills-keep-only-judgment.md)).
- Name each host-only law: one that can only run on the real machine (launchd, the real Electron
  app, a real OS process or socket, a real signal). Say it runs before the first review, and that on
  the owner's Mac it waits for the lead's read of its signal and launchd lines and the owner's yes
  ([0178](../../../.decisions/0178-host-only-laws-run-first.md)). A test on a real resource is a
  `*.integration.test.ts` file ([0536](../../../.decisions/0536-real-resource-tests-run-only-on-the-schedule.md)).
  A fixture that stands in for a real tool's output comes from a real run and is labeled `vector:`.
- Screenshots at five layouts when a window changes (`AGENTS.md`, "Shoot more than one layout").
- Ask "is this a setting?" of each new choice, and say why not when it is not
  ([0069](../../../.decisions/0069-choices-are-settings.md)).
- Say what fact is lost if it is not recorded now.
- In `next/`, place each file by [`next/AGENTS.md`](../../../next/AGENTS.md)'s libfabrika test.
- Split a big plan into pull requests that each land whole, ordered by what the owner sees first.
  Give the files table a "Product lines expected" column (a number, or a word such as `tests` or
  `docs`), and list the slices as numbered items under `## Size`, each saying "<n> lines".
  `plancheck.sh --draft` prints the plan's size and names each slice with no estimate. No number
  caps a slice ([0099](../../../.decisions/0099-no-number-caps-a-pull-request.md)): cut by what
  lands whole, never to fit a count.
- End the Size section with `Estimate: <n> steps, $<d>`, the quest's budget: chain.ts stops a quest
  at twice it ([0076](../../../.decisions/0076-a-lane-stops-at-its-budget.md)). `n` is the steps you expect:
  tests, build, review, plus one per likely send-back. `d` is their list-price dollars, priced from
  similar steps in `field/runs/` and the older rows in `field/runs.jsonl`.

## The open questions test

A question that only picks how the code does what a note already says is yours: decide it in one
line, and name the note. That includes an item a row calls "a walk" or "the owner approves" when a
decided note answers it. Before you put anything in open questions, ask: could the owner say no
without contradicting a decision already made? If not, it is not a question.

When the brief says the owner is away: take your lean where you are 80% sure or more and write it
in the plan as a call with its percentage. Under 80%, still take the best lean, and put the doubt at
the top of the plan. Anything a person sees or presses, a run on the owner's Mac, a launchd entry,
a new schedule or a paid account still waits for the owner: split it into a later part and say so.

## Outside your task

Something wrong outside your task is one finding row, never a fix:
[A finding](../../../field/README.md#a-finding) has the rule, the fields and what counts as proof.
Outside means the ticket does not ask for it and the plan does not need it. What the plan needs
goes in the plan. Put the row in a last section of the plan, `## Findings`, as one JSON line in a
fence. Its `id` is the date and a short slug. The lead saves it unchanged as its own file in
`field/findings/`.

## Standing rules

These hold in every plan round, so the brief does not repeat them.

- **Write only the plan file.** No product, test or skill edit, no commit, no push: the lead reads,
  signs and commits the plan. Do not start subagents. Run no test, no install and no
  `pnpm typecheck`; reading is the job.
- **Git in a worktree:** start every git command with `cd <worktree> || exit 1`. Ignore git's
  `gc.log` warnings. Make a worktree only when the brief gives the command for it.
- **Public repo:** no secrets, no absolute paths from anyone's machine, no personal names. Quote
  nothing private. A file outside the repo that the brief names is read, never copied in.
- **Done means** `sh .agents/skills/plan/scripts/plancheck.sh --draft <plan>` passes on the file
  you wrote, and every open question passes the test above.
- **Report,** the answer first: the plan's path, whether `plancheck --draft` passes, with its digest
  line; the scope in up to five plain bullets; every call you took with its percentage; every open
  question only the owner can answer; and, when the ticket does not exist yet, a ready ticket title
  and body. End with one line: `answer: done <why>`, or `answer: ask owner <the question>`.

## Scripts

plancheck.sh checks the draft; only the lead session reads and approves the whole plan and amendments.
leakgrep.sh checks added text; private words stay outside the repo.

A draft has a blank first line, `Plancheck-Version: 3` on line two, no unfenced line beginning
`Approved by the lead agent,`, and one Estimate line, the Size section's last. The check reads the
format, not who wrote it: do not add a marker, key or readable file as proof.
[`plancheck.sh`](scripts/plancheck.sh) holds what else each mode checks. The lead runs it again
before it signs.
