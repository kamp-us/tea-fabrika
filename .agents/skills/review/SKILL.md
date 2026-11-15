---
name: review
description: Do the one review of a ticket's whole diff, read-only, against its approved plan and decided notes. Use when a brief says "use the review skill for ticket N", after the tests and build steps.
---

# The one review

You read every commit since `origin/main` and judge the change against the approved plan and the
decided notes it builds. You change no product or test file. Your verdict is what lets the lead
merge ([how a change lands](../../../docs/plan/README.md#how-a-change-lands)).

The brief gives the facts: the ticket, its version, the worktree, branch and reviewed head, the
approved plan, the decided notes, the last fixes, and what to look hardest at this round
([the review brief](../lead/SKILL.md#review-brief-template)). This skill holds the rest.
[`AGENTS.md`, "Finish your task"](../../../AGENTS.md#finish-your-task) says when to keep going.

Never print npm, pnpm or env settings. The runner strips secret settings and redacts saved output.

## Steps

1. **Read** `AGENTS.md`, `next/AGENTS.md` for `next/` work, then the approved plan whole, then the
   decided notes it builds, and the tests and build rows in `field/runs/` for this lane (the plants
   are there).
2. **Read every commit** since `origin/main`: `git diff $(git merge-base origin/main HEAD)..HEAD`.
   The branch may be behind main: judge the change, and say if a merge of main would conflict, with
   any open pull request the brief names.
3. **Check:**
   - Sweep, do not sample. For each law in the plan's table, list every way in: each public call,
     each cut point, and each saved or binding state. Check each one.
   - A finding names its class and every case of it.
   - A law written as examples over a class the plan names is a defect when a found case escapes
     those examples.
   - On a re-review, read every line the last fixes changed and what calls them first. Then finish
     the remaining checks.
   - Read every decided note the PR builds, following the plan's references and the change itself.
     `sh .agents/skills/lead/scripts/governance.sh` lists the decision files the diff's words touch;
     say for each whether the diff walks it back.
   - Block only on a broken decision in docs/direction or AGENTS.md, lost data, or a broken law.
     Each blocker cites that source and shows the missed case.
   - It does what the plan and the notes' decided parts say, and nothing they leave undecided. Each
     call the builder or test writer took that the plan did not spell out is judged against the
     notes, with your own percentage; a choice that should be a declared setting is a finding
     ([0069](../../../.decisions/0069-choices-are-settings.md)).
   - The data shape: name any fact this change loses forever (who, when on whose clock, what was
     seen, why something was refused).
   - "No rough first versions": no stub, dead button or "(not yet)".
   - Names follow `AGENTS.md` for its version (`_tag`, no `xOf`, short everyday keys, no question
     words, "run" means an agent run in `next/`) and `.glossary/TERMS.md`. Effect code follows
     `node_modules/effect/AGENTS.md` and [0023](../../../.decisions/0023-next-follows-effects-code-style.md).
     Readability and module shape count: say where the code is hard to read and why.
   - Every new law is a property test over generated inputs (fast-check, `@demlik/tea/pbt` or
     Effect's `Arbitrary`). A new law that is an example test with no generator is a defect. A
     pinned example is fine only inside a property's `examples`, naming the past bug it pins
     ([every law is a property](../../../docs/direction/five-steps-for-every-check.md#every-law-is-a-property)).
     A fixed test is fine only when its name starts with one of five labels and it is that kind:
     `vector:`, `format:`, `pinned:`, `scenario:` or `type:`. A hand-picked example checking a general rule,
     labeled or not, is a defect. `fabrika/law-shape` in `pnpm lint` flags a test with neither;
     check that each one fits, against the named spec, format, bug or run. Do not reopen each
     test's merits.
   - Each generator on a machine reads the state it is folding and picks the next move from what is
     possible there. A hand-written list of cases is a defect
     ([0093](../../../.decisions/0093-laws-walk-plants-run-once.md)).
   - The tests report records a plant and its result for each new law. A law with no recorded plant
     run is not done. A committed plant test is a defect; a lint rule's own planted lines are not
     one. Plant a break yourself where a law looks weak, and in at least three laws you pick: in
     your head or in a scratch copy, never in the branch. In a read-only box a command that writes
     ends your turn with no answer, so plant by reading there.
   - A law moved onto a schema's Arbitrary keeps its old reach.
   - If secrets must stay out of records, URLs or spans, the plan's Law cell has `[secrets]` and
     the law generates flows: made-up words, keys and passes, operation orders, refusals and
     failures. Check every named output, including encoded URL forms, and a leak planted in each.
     A scenario only supplements the property. Report a missing marker or flow law as a defect.
   - `sh .agents/skills/lead/scripts/loosening.sh $(git merge-base origin/main HEAD) HEAD`: read
     every hit and say whether any law is truly loosened.
   - The docs rows the plan gives the lead (plan docs, glossary rows, follows rows): say which are
     owed and missing.
   - Shots on the pull request when the plan asks for them, at its layouts: the brief names the
     comment that holds them. A shot committed only to show the pull request running is a defect
     ([0160](../../../.decisions/0160-pr-shots-are-never-committed.md)).
   - Each point the brief lists under "Look hardest at", answered one by one: holds or not, and why.
     A lane has no mutation step ([0066](../../../.decisions/0066-mutation-runs-on-a-schedule.md)).
4. **Answer.** Start with merge-ready; findings: <m> or changes: <n>; findings: <m>.
   n counts blocking classes. Each class lists every affected case. m counts the finding rows in
   this answer.
   Give every finding in that answer, grouped by class, most serious first.
   Name each checked decided note and say where the change follows or breaks it.
   Each blocker gives `file:line`, its source, the missed case, and what a fix must do. A
   demonstrated gap in a named class checks the law; it does not reopen every test's merits.

   Any other actionable finding is one finding row with proof: never a ticket, a fix or only a
   mention, and never a security hole.
   Give each row as one JSON line in the answer. The lead saves it unchanged as its own file in
   field/findings/. Do not start another review round for it.
   When the brief says the pull request waits for the owner, end the findings with a short plain
   list, "For the owner": the two or three things only the owner can decide, each with your lean
   and percentage.
   End with exactly one answer: line, as the last line.
   It reads `answer: done <why>` when merge-ready, else `answer: send build <why>` (or `send tests`,
   `send plan`). The verdict is never the answer.
   Decision [0035](../../../.decisions/0035-outside-work-becomes-finding-rows.md) says why, and
   [A finding](../../../field/README.md#a-finding) has the fields, the closed `rule` list and what
   counts as proof. Other means it is wrong but blocks nothing by the rule in step 3, in this diff
   or beside it. Reading one function is not proof: run it, or show the two lines that disagree.
   With no proof, write nothing.

## Recheck

The lead resumes you after a fix round, with a message that names the new head and the faults you
named ([0177](../../../.decisions/0177-fix-round-is-one-agent.md)). This is not a new review of the
whole diff.

- Check the fix for the faults you named: read each line it changed and what calls it.
- Check that the new law reaches the fix. Plant a break, by reading or by running it in a scratch
  copy where your box lets you write, never in the branch. The fix agent wrote this law itself, so
  yours is the read that guards it.
- You may withdraw a finding of yours that was wrong. Say which, and why.
- A new fault you notice outside the fix is a finding row, or ticket text for the lead. It does
  not send the lane back unless it breaks the slice's main job.
- End with the same `answer:` line, as the last line.

## Standing rules

These hold in every review and recheck, so the brief does not repeat them.

- **Git in a worktree:** start every git command with `cd <worktree> || exit 1`. Ignore git's
  `gc.log` warnings. Check that `HEAD` is the brief's reviewed head before you read.
- **Do not start subagents.** Do not wait on CI. Do not mark the pull request ready or merge it.
- **Tests one file at a time:** `nice -n 19 pnpm exec vitest run --maxWorkers=1 <one file>`, with
  `TYPESAFE_API_KEY` unset; the test config refuses a broad run. No `pnpm typecheck`: the build ran
  it on this head. Never run a test that sends a real signal, calls `launchctl`, starts Electron or
  needs the real machine; judge it by reading.
- **Run row:** when the brief's `Run row:` field names a file, write it in the shape of the newest
  review rows, with real start and end times from `TZ=America/Los_Angeles date`. It is the one file
  you may commit: plain `git commit` of that path alone, then push it with
  `node .agents/skills/lead/scripts/botpush.mjs "$PWD" <branch>`. With no `Run row:` field, commit
  nothing.
- **Report** in the shape of step 4, for a reader who saw none of the work: the answer first, plain
  short sentences, a path and line for each thing you cite.

## Never

- Change, stage or commit a product, test, plan or skill file. Run a command that writes to the
  branch, other than your run row's commit and push.
- Give style nits. A finding is something that is wrong or that a decided note rules out.
