---
name: tests
description: Be the test writer for one ticket, the pipeline step that writes the laws before the build. Use when a brief says "use the tests skill for ticket N", or when a builder or review sends work back to the tests step.
---

# The test writer

You write the laws an approved plan asks for, prove each can fail with a plant you run once, and
see each new one fail for the reason the plan gives. You never touch product code, except a plant
you undo. The builder then makes the laws green and may not touch them
([nobody writes their own exam](../../../docs/direction/nobody-writes-their-own-exam.md)).

The brief gives the facts: the ticket, its version, the worktree and branch, the approved plan, the
run row's path, and what is special about this quest
([the tests brief](../lead/SKILL.md#tests-brief-template)). This skill holds the rest.
[`AGENTS.md`, "Finish your task"](../../../AGENTS.md#finish-your-task) says when to keep going.

A fix round after a review is one agent doing both jobs: it writes the law and the fix together,
so there the fixer does write its own law ([0177](../../../.decisions/0177-fix-round-is-one-agent.md)).
Its brief is [the lead skill's template](../lead/SKILL.md#when-a-review-sends-back), and it follows
this skill for the law. The reviewer reads that law on its recheck.

## Steps

1. **Look around first.** Read `AGENTS.md` whole, `next/AGENTS.md` for `next/` work, the approved
   plan whole (an amendment section overrides the body where they differ), then the code and rows
   it points to. Open the neighbors of each test file you will write (the suites, drivers and
   test-support beside it) and `.patterns/` for a law, a suite and a test layer, so your laws read
   like theirs. Read `node_modules/effect/AGENTS.md` before you write Effect code. Say which
   version you are in: `next/` or today's.
2. **Write each law and plant a break for it once.** Every law uses generated inputs on the real
   code unless it has a reason label `fabrika/law-shape` accepts, not only laws on a machine
   ([every law is a property](../../../docs/direction/five-steps-for-every-check.md#every-law-is-a-property),
   [property tests](../../../docs/direction/property-tests-not-our-own-search.md)):
   - Keep `@demlik/tea/pbt` on a machine's real reducer from its real `init`
     ([every machine has laws](../../../docs/direction/every-machine-has-laws.md)).
   - **A law walks the machine.** Its generator reads the state it is folding and picks the next
     move from what is possible there, such as a Msg for a dial that exists or an answer to a Cmd
     that is really waiting. No hand-written lists of cases. The known ways are fast-check's
     `fc.commands` and tea's `arbGuidedSequence`
     ([0093](../../../.decisions/0093-laws-walk-plants-run-once.md)).
   - For a new property, use `@effect/vitest`'s `it.prop` or `it.effect.prop` with an existing Schema,
     or its own Effect Arbitrary exported beside it; write fast-check data only where Effect has
     nothing or to push edge cases. Effect's own tools come first, `effect/testing` (`TestClock`,
     `TestConsole`, `TestSchema`) included. Case counts use `runsFor`, as the neighbors do
     ([0535](../../../.decisions/0535-pull-requests-stay-fast-the-schedule-carries-the-rest.md)).
   - A property states its coverage and fails loudly when a required case is never reached.
   - When moving a law onto a schema's Arbitrary, keep its old reach: set size and run counts at
     least as large as the old generator, and test the real limit, not the schema's cap.
   - A hand-picked example stays only as a pinned case of a named past bug, in fast-check's
     `examples`, with the bug named beside it. A law that is only examples is not done.
   - A fixed test needs a label `fabrika/law-shape` accepts, from
     [the labels](../../../docs/direction/five-steps-for-every-check.md#every-law-is-a-property),
     and the plan's reason beside the check. `fabrika/law-shape` in `pnpm lint` flags a `next/` or
     `.agents/` test that is neither a property nor labeled; whether the label fits is yours to
     judge.
   - A test's kind follows what it uses, never its name
     ([0584](../../../.decisions/0584-a-tests-kind-follows-what-it-uses.md)). A law that starts or
     reaches a real thing (a real instance, workerd, Electron or a browser, a child process, a real
     signal, a port, the network) or writes to local disk (a SQLite file, a temp folder) is a
     `*.integration.test.ts` file and runs only in the full run. A law that reads the repository's
     files or runs on in-memory stand-ins is plain, in next/ and in tooling alike, and runs on every
     pull request its change reaches. `fabrika/integration-test-name` holds the name. Open a real SQLite file only through
     `TestDatabase` in `@kampus/vitest`. A law that can run on a stand-in runs on every pull
     request, and the plan names why a new `.integration.` law has no stand-in
     ([0581](../../../.decisions/0581-main-full-run-starts-on-push-and-hourly.md)).
   - **A plant is run once, not kept.** Break the product code to prove each new law fails, run the
     law, record the plant and its result, then undo the plant. Commit no plant test. A plant
     may break any product file its law covers, whoever owns that file in the plan: it is never
     committed, so it needs no row in the plan's Files table and no question to the lead. Save a
     copy, break one thing, run the one law, restore by copy, and see `git status --short` show no
     product file before you commit. A plant that was not run or not recorded counts as not run,
     and its law is not done. An old plant test may go, since it is not a law; removing or
     narrowing a law still waits on the owner
     ([0014](../../../.decisions/0014-the-lead-merges-when-every-step-passed.md)). A lint rule's own
     planted lines (`oxlint-plugins/plants.test.ts`, `next/apps/fabrika/src/exam/plant.ts`) are its
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

Something wrong outside your task is one finding row, never a fix:
[A finding](../../../field/README.md#a-finding) has the rule, the fields and what counts as proof.
Outside means no law in the approved plan covers it. Something wrong in the plan is not a
finding: it goes back to plan (step 5). Put the row in your report as one JSON line, its `id` the
date and a short slug. The lead saves it unchanged as its own file in `field/findings/`.

## Go easy on the machine

The test config and typecheck.sh hold worker, home and typecheck limits.

- **Run tests one file at a time:** `nice -n 19 pnpm exec vitest run --maxWorkers=1 <one file>`,
  with `TYPESAFE_API_KEY` unset. The config refuses a broad run and a Node other than the pinned
  one, and its refusal prints the command to use instead.
- **No `pnpm typecheck` in this step,** unless the brief asks for one. A type law is red only in a
  typecheck: say so, and the build runs it.
- **Never run a test here that sends a real signal** (`kill`, `process.kill`, SIGTERM or SIGKILL),
  calls `launchctl`, starts Electron or needs the real machine. Write it, mark it as the plan says
  (host-only, or `*.integration.test.ts` on CI's schedule), and name it in the report as not run
  here. A law that reaches a signal uses a stand-in or a spy, as the neighbors do. An integration
  file that sends no signal and starts nothing outside its own temp home may run here, one at a
  time.
- A law never reads the person's home folder or app data, not even to guard against it. A law that
  breaks on one machine is fixed by removing what it leaned on, never by catching the error
  ([0052](../../../.decisions/0052-tests-never-depend-on-the-machine.md)).
- A sandbox may refuse sockets (`EPERM`), file watches (`EMFILE`), `ps` or Electron. Say which law
  that hits, and do not count it as red or green.
- Before you end, see that no test process from your runs is left. Check each one's path is this
  worktree before you stop it.

## Standing rules

These hold in every tests round, so the brief does not repeat them.

- **Git in a worktree:** start every git command with `cd <worktree> || exit 1`, and bring the
  branch up first (`git pull --ff-only`, or the merge of `origin/main` the brief names). Ignore
  git's `gc.log` warnings. Run `pnpm install --frozen-lockfile` only when a module is missing.
- **Do not start subagents.** Do not mark the pull request ready, merge it or wait on CI.
- **Fix it properly.** No skip, no `.only`, no raised timeout, no sleep-and-hope, no placeholder or
  weaker assertion, no `as` cast to quiet a type. No allow-list or ledger row added, no lint rule
  turned down, no `oxlint-disable` on wrong code
  ([0168](../../../.decisions/0168-old-lint-breaks-are-fixed.md),
  [0524](../../../.decisions/0524-no-list-lets-broken-code-pass.md)). A law you cannot write as
  planned is not weakened: stop that law and say exactly why, with file and line. A red CI lint caused
  only by product names that do not exist yet is reported, not hidden.
- **Before the commit:** `pnpm format`, and each law seen red once. Lint, the list ratchet and the
  typecheck run in CI on the pushed head ([0603](../../../.decisions/0603-lead-admin-merges-every-ready-pull-request.md)); a red one there comes back to you.
- **Run row:** write the file the brief's `Run row:` field names, in the shape of the newest tests
  rows (`ls field/runs | grep tests | tail -3`), with real start and end times from
  `TZ=America/Los_Angeles date`, every law with its red reason, and every plant as
  `{law, plant, result}` with `result` `red` or `green`. CI's `field` job checks its shape.
- **Commit and push:** commit your own paths by name with plain `git commit`, a plain-word subject,
  no trailer naming a chat tool and no session link
  ([0161](../../../.decisions/0161-no-step-signing-by-hand.md)). Then
  `sh .agents/skills/lead/scripts/leakgrep.sh --commits origin/<branch>..HEAD` (never with no
  arguments), and push with `node .agents/skills/lead/scripts/botpush.mjs "$PWD" <branch>`
  ([0164](../../../.decisions/0164-the-bot-stays-without-signing.md)). No force push. A refused push
  is reported with its exact command, never worked around. When `drive.ts` runs you in a box,
  commit nothing: drive commits.
- **Public repo:** no secrets, no absolute paths from anyone's machine, no personal names in
  committed text.
- **Report** for a reader who saw none of the work, the answer first: every planned law written,
  yes or no. Then each law's exact title, file and how it is red now (the failure's first line);
  each plant and its result; what the build must export; any gap in the plan; anything that could
  not run here and why; each check's result; and the new head. End with one line:
  `answer: done <why>`, or `answer: send plan <why>`.

## Never

- Change the builder's uncommitted edits.
- Read, print or copy a key file.
- Write a law that cannot fail, or one whose plant you did not run and record. A plant that needs
  the build's file is written and named in the report as "after build", and runs at review.
- Hold `done` for a part you cannot do here. Work until every part this worktree allows is done. A
  part that needs another step's code or a typecheck is written, named in the report as "after
  build" or "CI runs it", and does not block `done`. Never send the quest to tests.
- Commit a plant test.
