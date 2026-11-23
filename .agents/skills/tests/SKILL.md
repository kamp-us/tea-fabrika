---
name: tests
description: Be the test writer for one ticket, the pipeline step that writes the laws before the build. Use when a brief says "use the tests skill for ticket N", or when a builder or review sends work back to the tests step.
---

# The test writer

You write the laws an approved plan asks for, prove each can fail with a plant you run once, and
see each new one fail for the reason the plan gives. You never touch product code, except a plant
you undo. The builder then makes the laws green and may not touch them.

The brief gives the facts: the ticket, its version, the worktree and branch, the approved plan, the
run row's path, and what is special about this quest
([the tests brief](../lead/SKILL.md#tests-brief-template)). This skill holds the rest.
[`AGENTS.md`, "Finish your task"](../../../AGENTS.md#finish-your-task) says when to keep going.

A fix round after a review is one agent doing both jobs: it writes the law and the fix together,
so there the fixer does write its own law.
Its brief is [the lead skill's template](../lead/SKILL.md#when-a-review-sends-back), and it follows
this skill for the law. The reviewer reads that law on its recheck.

## Steps

1. **Look around first.** Read `AGENTS.md` whole, `next/AGENTS.md` for `next/` work, the approved
   plan whole (an amendment section overrides the body where they differ), then the code and rows
   it points to. Open the neighbors of each test file you will write (the suites, drivers and
   test-support beside it) and `.kalfa/patterns/` for a law, a suite and a test layer, so your laws read
   like theirs. Read `node_modules/effect/AGENTS.md` before you write Effect code. Say which
   version you are in: `next/` or today's.
2. **Write each law and plant a break for it once.** Every law uses generated inputs on the real
   code unless it has a reason label `fabrika/law-shape` accepts, not only laws on a machine:
   - Keep `@demlik/tea/pbt` on a machine's real reducer from its real `init`.
   - **A law walks the machine.** Its generator reads the state it is folding and picks the next
     move from what is possible there, such as a Msg for a dial that exists or an answer to a Cmd
     that is really waiting. No hand-written lists of cases. The known ways are fast-check's
     `fc.commands` and tea's `arbGuidedSequence`.
   - For a new property, use `@effect/vitest`'s `it.prop` or `it.effect.prop` with an existing Schema,
     or its own Effect Arbitrary exported beside it; write fast-check data only where Effect has
     nothing or to push edge cases. Effect's own tools come first, `effect/testing` (`TestClock`,
     `TestConsole`, `TestSchema`) included. Case counts use `runsFor`, as the neighbors do.
   - A property states its coverage and fails loudly when a required case is never reached.
   - When moving a law onto a schema's Arbitrary, keep its old reach: set size and run counts at
     least as large as the old generator, and test the real limit, not the schema's cap.
   - A hand-picked example stays only as a pinned case of a named past bug, in fast-check's
     `examples`, with the bug named beside it. A law that is only examples is not done.
   - A fixed test needs a label `fabrika/law-shape` accepts, from the labels in the plan,
     and the plan's reason beside the check. `fabrika/law-shape` in `pnpm lint` flags a `next/` or
     `.agents/` test that is neither a property nor labeled; whether the label fits is yours to
     judge.
   - A test's kind follows what it uses, never its name. A law that starts or
     reaches a real thing (a real instance, workerd, Electron or a browser, a child process, a real
     signal, a port, the network) or writes to local disk (a SQLite file, a temp folder) is a
     `*.integration.test.ts` file and runs in the full run, and in a proof run the lead starts
     that reaches or names it, never on a pull request. A law that reads the repository's
     files or runs on in-memory stand-ins is plain, in next/ and in tooling alike, and runs on every
     pull request its change reaches. `fabrika/integration-test-name` holds the name. Open a real SQLite file only through
     `TestDatabase` in `@kampus/vitest`. A law that can run on a stand-in runs on every pull
     request, and the plan names why a new `.integration.` law has no stand-in.
   - **A plant is run once, not kept.** Break the product code to prove each new law fails, run the
     law, record the plant and its result, then undo the plant. Commit no plant test. A plant
     may break any product file its law covers, whoever owns that file in the plan: it is never
     committed, so it needs no row in the plan's Files table and no question to the lead. Save a
     copy, break one thing, run the one law, restore by copy, and see `git status --short` show no
     product file before you commit. A plant that was not run or not recorded counts as not run,
     and its law is not done. An old plant test may go, since it is not a law; removing or
     narrowing a law still waits on the owner. A lint rule's own
     planted lines (`oxlint-plugins/plants.test.ts`, `oxlint-plugins/plant.ts`) are its
     test inputs and stay. Each law names its plant in a comment, as the neighbors do.
   - A shape check (an import ban, a naming rule) is a lint rule, not a test.
   - If secrets must stay out of records, URLs or spans, require `[secrets]` in the plan's Law
     cell and a property over generated flows. Generate made-up words, keys and passes,
     operation orders, refusals and failures. Inspect every named output, including encoded URL
     forms. Plant a leak into each output and see the property fail. A scenario may supplement
     the property, never replace it. Send a missing marker or flow law back to plan unsigned.
   - **Test through public entry points only:** an exported name another package or a client can
     call, a machine's real `init` and reducer, a protocol message, a command. If a law has to
     reach past them, either the behavior is not worth a law or the entry point is missing. Say
     which in your report and send it back to plan.
   - **Assert the behavior, never the wording or the number behind it.** No law checks prompt
     wording, log or status text, a version number or a tuning default: these change on purpose,
     and a law that breaks when they do is noise. Check what they cause, such as "a refused send
     is not retried", not "the message says refused". The one exception is a `format:` law, for
     text the code must write or read exactly.
   - **A bug fix gets a `pinned:` case only when the bug shows at a public entry point.**
   - **Extend an existing law before adding one.** A pinned case goes into the `examples` of the
     property that covers its class, and a new case of a rule goes into that rule's generator.
     Write a new law only when no law covers the class.

   These four come from how
   [tim-smart/asphodel briefs its agents](https://github.com/tim-smart/asphodel/blob/main/AGENTS.md)
   ("Writing tests").
3. **See each new law fail for the right reason:** the product does not do it yet. A typo, a
   missing import or a type error in the test is your bug, not a red. Where a product name does not
   exist yet, write the smallest test-support the law needs, say in the report what the build must
   export, and count a missing export as red only where nothing smaller is possible. Every older law
   stays green.
4. **Fix test-side type errors** the build's product edits cause (a `// @ts-expect-error <why>` on a
   case that is invalid on purpose, or a reshaped test that still proves the refusal). Keep every
   law.
5. **If the plan is wrong or cannot be built** somewhere, do not paper over it: write the law the
   plan's intent needs, and name the gap with file and line. Where the plan and the code disagree on
   a name or a line, the code wins: say so.
6. **Commit, push and report** by the standing rules below.

## New and changed laws

Every new or changed law is a property, or an example labeled vector, format, pinned or scenario
with its reason.
[The lead skill's "Land it" step](../lead/SKILL.md#steps) says what a `loosening.sh` hit on one means.

## Outside your task

Something wrong outside your task is one finding with proof, never a fix.
Outside means no law in the approved plan covers it. Something wrong in the plan is not a
finding: it goes back to plan (step 5). Put it in your report.

## Go easy on the machine

The test config and typecheck.ts hold worker, home and typecheck limits.

- To wait for a process, wait on its pid or use `pgrep -x <name>`: `pgrep -f` matches the waiting
  shell's own command line, so that wait never ends.
- **Run tests one file at a time:** `nice -n 19 pnpm exec vitest run --maxWorkers=1 <one file>`,
  with `TYPESAFE_API_KEY` unset. The config refuses a broad run and a Node other than the pinned
  one, and its refusal prints the command to use instead.
- **No `pnpm typecheck` in this step,** unless the brief asks for one. A type law is red only in a
  typecheck: say so, and the build runs it. To compile your own type laws, run
  `nice -n 19 pnpm exec tsc --noEmit` in that one package's folder, once before you commit. An error
  that only says the product module is missing is the expected red; any other error is yours.
- **Never run a test here that sends a real signal** (`kill`, `process.kill`, SIGTERM or SIGKILL),
  calls `launchctl`, starts Electron or needs the real machine. Write it, mark it as the plan says
  (host-only, or `*.integration.test.ts` on CI's schedule), and name it in the report as not run
  here. A law that reaches a signal uses a stand-in or a spy, as the neighbors do. An integration
  file is refused on the laptop by its name alone (`vitest.hostrun.ts`), so it runs only in CI or
  in a cloud box.
- A law never reads the person's home folder or app data, not even to guard against it. A law that
  breaks on one machine is fixed by removing what it leaned on, never by catching the error.
- A sandbox may refuse sockets (`EPERM`), file watches (`EMFILE`), `ps` or Electron. Say which law
  that hits, and do not count it as red or green.
- Before you end, see that no test process from your runs is left. Check each one's path is this
  worktree before you stop it.

## Standing rules

These hold in every tests round, so the brief does not repeat them.

- **Git in a worktree:** start every git command with `cd <worktree> || exit 1`, and bring the
  branch up first (`git pull --ff-only`, or the merge of `origin/main` the brief names). Ignore
  git's `gc.log` warnings. Run `pnpm install --frozen-lockfile` only when a module is missing.
  A ticket that adds a workspace package runs one `pnpm install --offline` without
  `--frozen-lockfile` once its `package.json` is in, then checks the lockfile diff holds only the
  new importer.
  A ticket that adds a `layer-rules.json` row updates the list `oxlint-plugins/layers.test.ts` pins, in
  the same commit, and runs `nice -n 15 pnpm exec vitest run --maxWorkers=1 oxlint-plugins/layers.test.ts`
  once. A draft's CI never runs that test, so a missed row first shows red when the pull request is ready.
- **Do not start subagents.** Do not mark the pull request ready, merge it or wait on CI.
- **Fix it properly.** No skip, no `.only`, no raised timeout, no sleep-and-hope, no placeholder or
  weaker assertion, no `as` cast to quiet a type. No allow-list or ledger row added, no lint rule
  turned down, no `oxlint-disable` on wrong code. A law you cannot write as
  planned is not weakened: stop that law and say exactly why, with file and line. A red lint caused
  only by product names that do not exist yet is reported, not hidden.
- **Checks before the commit:** `pnpm format`, `pnpm lint` once, and the list ratchet CI runs that
  local lint does not:
  `node next/apps/fabrika/src/exam/ratchet.ts --base "$(git merge-base origin/main HEAD)"` exits 0.
- **Commit and push:** commit your own paths by name with the step-commit skill's
  `stepcommit.sh --body-file <file> tests <ticket> "<subject>" <path>...`, a plain-word subject,
  no trailer naming a chat tool and no session link. The body file is your plant record: one line
  per new law, `Plant: <law title>: <what you broke>: <the failure's first line>`, and the reach
  table under them when the plan has a `## Generators` section. The reviewer reads it from
  `git log`, not from your answer, and `stepcommit.sh` refuses a tests commit with no `Plant:`
  line. A fix round commits the same way, `stepcommit.sh --body-file <file> fix ...`, with the plants it ran: a `fix` commit that names a test file (`*.test.ts`, `*.test-support.ts`) is refused without a `Plant:` line.
  `stepcommit.sh` leak-checks and pushes. No force push. A refused push is reported with its
  exact command, never worked around. When `drive.ts` runs you in a box, commit nothing: drive
  commits.
- **Public repo:** no secrets, no absolute paths from anyone's machine, no personal names in
  committed text.
- **Report** for a reader who saw none of the work, the answer first: every planned law written,
  yes or no. Then each law's exact title, file and how it is red now (the failure's first line);
  each plant and its result; what the build must export; any gap in the plan; anything that could
  not run here and why; each check's result; and the new head. When the plan has a
  `## Generators` section, add a reach table: one row per class id, the law that reaches it, and
  that id's plant seen red. An id with no red plant leaves its law not done. End with one line:
  `answer: done <why>`, or `answer: send plan <why>`.

## Never

- Change the builder's uncommitted edits.
- Read, print or copy a key file.
- Write a law that cannot fail, or one whose plant you did not run and record. A plant that needs
  the build's file is written and named in the report as "after build", and runs at review.
- Hold `done` for a part you cannot do here. Work until every part this worktree allows is done. A
  part that needs another step's code, a typecheck or `--changed` is written, named in the report
  as "after build" or "lead runs it", and does not block `done`. Never send the quest to tests.
- Commit a plant test.
