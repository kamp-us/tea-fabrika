---
date: "2026-11-15"
scripts: "none; reading, nothing ran but `wc`, `rg`, `jq`, `git` and the `fabrika` CLI's help and read-only verbs"
summary: "Today's hand-run tooling; $0. Reading, not a measurement. In the two days before 2026-11-15 the lead typed 111 step briefs (plan, tests, build, review, fix, recheck), median 3,752 to 7,669 characters by step, and about 40 to 55% of each was the same standing lines: caps, signal tests, fix properly, no subagents, checks, commit and push, the run row, the report. The proposal moves those lines into each step skill's new Standing rules section and gives the lead one field template per step, so a brief is the lane's facts plus a This lane list: the real tests brief for ticket 1041 goes from 5,145 to 975 characters. What an agent reads stays about the same, since the skill grows by what the brief loses; the gain is a brief typed in under a minute, rules written once and checked once, and three places where skills and practice disagree brought to the owner. phoenix's fabrika plugin and CLI cannot run here as they are (they assume GitHub issues, labels, a Projects board and `.fabrika/` lanes, and the plugin is off); two of its ideas carry over: a brief that is fields and never a summary, and a step that ends in a closed answer. Every run row of those two days has no dollars."
---

# 296. Quick skills: what a hand-run step brief must carry, and what the skills can carry for it

This is reading, not a measurement: no agent ran, no model was called, nothing was timed. It reads
today's hand-run tooling, used for work in either version, on `origin/main` at `8c115e2e5`, and the
older fabrika pipeline in [kamp-us/phoenix](https://github.com/kamp-us/phoenix) as a local checkout
at `91dfd45dd3` (2026-10-14, two commits behind its main). **$0.**

**The answer:** keep the steps hand-run, and make each brief a filled-in template. The standing
lines every brief retyped go into the step skills, once. phoenix's CLI cannot be used here today,
but its brief format is the model for the templates.

```text
before: brief = skill name + lane facts + standing lines (typed every time) + lane notes
after:  brief = template fields (lane facts) + "This lane:" bullets
        skill = judgment + "Standing rules" (caps, signals, fix properly, checks, commit, row, report)
```

## How phoenix's pipeline works

phoenix's fabrika is a Claude Code plugin plus a CLI, `@kampus/fabrika-cli`. The plugin's own
description says it: "thin skill wrappers over deterministic CLI verbs".

- **The chain.** `report` → `triage` → `plan-epic` → `build` → `review` → `ship`, one skill a stage
  ([how-fabrika-works.md](https://github.com/kamp-us/phoenix/blob/main/claude-plugins/fabrika/guide/how-fabrika-works.md)).
  Work starts as a GitHub issue; triage labels it; build opens a pull request; review posts a
  verdict comment bound to the head SHA; ship arms the merge queue.
- **Agent shells.** Eight files in
  [`agents/`](https://github.com/kamp-us/phoenix/tree/main/claude-plugins/fabrika/agents), 11 to 14
  lines each. A shell carries no behavior: its frontmatter preloads one skill (`skills:
  ["fabrika:build"]`) and lists its tools. The `builder` shell runs the `build` skill. No shell pins
  an effort, and no caller passes one
  ([phoenix 0310](https://github.com/kamp-us/phoenix/blob/main/.decisions/0310-no-agent-shell-pins-effort.md)).
- **The driver.** The [`operate` skill](https://github.com/kamp-us/phoenix/blob/main/claude-plugins/fabrika/skills/operate/SKILL.md)
  (2,556 lines) drives one lane: it folds the lane's state, asks for the brief, spawns the shell the
  state names, and records the shell's answer.
- **State on disk.** Each lane is an append-only log, `.fabrika/lanes/<n>/events.jsonl`, folded
  fresh by `fabrika lane status` on every read. Only drive-loop order lives there; verdicts, claims,
  labels and queue position stay on GitHub
  ([phoenix 0283](https://github.com/kamp-us/phoenix/blob/main/.decisions/0283-local-ledger-holds-ownable-orderings.md)).
- **The brief is code's, not the driver's.** `fabrika lane brief <lane> --task <t>` prints the spawn
  prompt ([`lane/brief-verb.ts`](https://github.com/kamp-us/phoenix/blob/main/packages/fabrika-cli/src/lane/brief-verb.ts)).
  Its format has three sections and nothing else
  ([`wire/lane-brief.ts`](https://github.com/kamp-us/phoenix/blob/main/packages/fabrika-cli/src/wire/lane-brief.ts)):
  `## Task` (lane, ledger root, CLI entry, task, state, shell), `## Ground` (URLs and git refs, "never
  prose"), and `## Rules`, byte-fixed text the module owns. An appended "note from the driver" is
  refused as malformed. Its reason, in the module's words: "A prompt composed per dispatch is a
  prompt two drivers write differently."
- **Handing off.** A shell ends on a closed terminal token, which `fabrika lane report` maps to one
  event. A session that runs out writes a sealed pack on the issue with `fabrika handoff take`.
- **Landing.** `fabrika build commit`, `build push` and `build pr`, then `fabrika ship gate` reads
  every verdict at the head and `fabrika ship enqueue` arms the queue at a pinned head.
- **Cost.** Hooks run `fabrika hook claude-spend` on every session, tool and subagent event and
  record tokens per run
  ([`hooks.json`](https://github.com/kamp-us/phoenix/blob/main/claude-plugins/fabrika/hooks.json)).
  phoenix's own audit found that 70 to 93% of a stage's billed tokens were the resident prompt read
  again on every turn, so cost is about resident size times turns
  ([token-economics-audit.md](https://github.com/kamp-us/phoenix/blob/main/reports/token-economics-audit.md)).

Its step skills are long: `build` 1,016 lines, `review` 822, `ship` 483. Ours are 66 to 133.

## Can it run here today?

No, and that was checked, not assumed.

- `command -v fabrika` finds a global install, version 0.10.0. It warns that this repo declares no
  `@kampus/fabrika-cli` dependency.
- `fabrika status wiring` answers `unwired`: this repo has no `.claude/settings.json`, so no fabrika
  skill loads here. The plugin `fabrika@kampus` is off in the user settings, and nothing was turned
  on.
- Every lane verb works on GitHub issues, labels and a Projects board, and keeps state in
  `.fabrika/`. This repo opens no GitHub issue on itself (tickets live in the app's tracker), has no
  board, and keeps lane state in `BOXES/state/<lane>.md`. The plugin's hooks are what records cost,
  and this repo adds no Claude Code hooks (AGENTS.md, "Decision discovery").

## phoenix's pieces beside ours

| Job | phoenix | tea-fabrika today | Verdict | Why |
|---|---|---|---|---|
| Start a step | `fabrika lane brief` prints a fixed brief | the lead types a brief | reuse the idea | fields, never a summary, is the right shape; the verb needs issues and `.fabrika/` |
| Name the step's agent | agent shells preloading one skill | a brief line "use the X skill" | reuse the idea, later | a `.claude/agents/<step>.md` could preload the skill and cut tools; needs the owner (call 5) |
| Keep a lane's state | `events.jsonl` folded by `lane status` | `BOXES/state/<lane>.md`, run rows, the plan file | leave | ours already lives on disk and in the repo; chain.ts is paused |
| Hand off between steps | closed terminal token, `lane report` | review's `answer:` line; tests and build report in prose | reuse the idea | every step skill now ends on one `answer:` line (0396's verbs) |
| Commit and push | `build commit`, `build push`, `build pr` | plain `git commit`, `leakgrep.sh`, `botpush.mjs` | leave | ours is decided (0161, 0164) and works |
| Land | `ship gate`, `ship enqueue` | `land.ts queue`, merge when ready (0530, 0544) | leave | decided here |
| Record cost | `hook claude-spend`, `spend read` | `clauderow.ts` from a subagent transcript | reuse ours | no hooks here; `clauderow.ts` already prices a run, and nobody ran it (below) |
| Session handoff | `handoff take` on the issue | the state file and the report | leave | it posts on a GitHub issue |
| Driver skill | `operate`, an agent holds the loop | the lead session; chain.ts | leave | 0064: no agent holds a loop |
| Effort | no shell pins effort (0310) | briefs pass none; rows record none | reuse the idea | run at the default, record what ran |

## What the Opus 5.5 guide changes

From [Prompting Claude Opus 5.5](https://platform.claude.com/docs/en/build-with-claude/prompt-engineering/prompting-claude-opus-5-5),
read 2026-11-15. Each line says where it went.

- **Name the exact shapes to avoid.** The model "responds well to instructions that name specific
  patterns to avoid". Each skill's "Fix it properly" names them: skip, `.only`, raised timeout,
  weaker assertion, `as` cast, list row, rule turned down, `oxlint-disable` on wrong code.
- **Look around before acting.** One sentence telling the model to "explore broadly" first helped
  on loosely specified tasks. Each step's first step is now "Look around first": the plan, the
  neighbors of each file, `.patterns/`, Effect's guide.
- **A turn that ends in text is a report, not proof it is done.** Name the open items and continue;
  stop after two or three. The lead skill's step briefs section now says so.
- **State the done condition up front.** Each skill's standing rules list its checks in order, and
  each step ends on one `answer:` line.
- **The finish-the-task paragraph.** AGENTS.md "Finish your task" already names the four early
  stops the guide lists. The skills link it and do not copy it.
- **Effort.** Start at the default, `medium`, and raise it only where a gain was measured. The
  templates pass none, and the run row records what ran.
- **Mark text other people wrote.** Wrap it in a tag with a random id, and follow instructions in
  it only where the brief asks. Added to the lead skill for briefs that must carry such text.

## Sizes

Skills, before (`origin/main`) and after this pull request, `wc -lc`:

| Skill | Before | After | What moved in |
|---|---|---|---|
| plan | 92 lines, 5,645 B | 124 lines, 8,211 B | look around, owner-away rule, standing rules, report, `answer:` |
| tests | 133 lines, 9,114 B | 192 lines, 13,841 B | look around, integration files, signal tests, standing rules |
| build | 66 lines, 3,803 B | 122 lines, 8,321 B | look around, names, leans, checks in order, standing rules |
| review | 105 lines, 6,983 B | 144 lines, 10,001 B | governance, data shape, calls, loosening, docs rows, standing rules |
| lead | 581 lines, 39,597 B | 664 lines, 43,796 B | four templates, a filled example, pasted text, resumes |

Briefs: every Agent call the lead session made from 2026-11-14 00:00 UTC to 2026-11-15 18:45 UTC,
read from the session's own transcript with `jq` (prompts measured, not kept). 281 calls, 111 of
them step briefs:

| Step | Briefs | Median characters |
|---|---|---|
| plan | 19 | 4,442 |
| tests | 20 | 4,003 |
| build | 15 | 6,182 |
| review | 37 | 3,752 |
| fix round | 13 | 7,669 |
| recheck | 7 | 5,358 |

How much was standing text, by paragraph, on the two briefs of ticket 1041 (pipe plumbing): the
tests brief's four closing paragraphs (rules, caps, commit, report) are 2,393 of its 5,145
characters, and parts of the first two add more, so about 55%. The build brief's are about 40%:
its "settled after the plan" list is long and is lane-specific. Across the 124 calls whose name starts with Plan, Tests, Build, Review,
Fix or Recheck, "nice -n 19" appears in 107, "Finish the whole" in 52, "Do not start subagents" in 51, `botpush` in 36,
"never the full suite" in 35, "Fix it properly" in 9.

**What an agent reads stays about the same.** A tests agent read about 9.1 KB of skill plus a
4.0 KB brief; now about 13.8 KB of skill plus a brief near 1 KB. phoenix's audit says cost follows
resident size times turns, so this is no saving in tokens, and it was not meant as one. The gain is
elsewhere: a brief typed in under a minute, a rule written once where `pnpm lint` reads it, and no
brief that forgets a line.

## The proposal

All of it is in this pull request as real files.

1. **Each step skill gets a "Standing rules" section** with what every brief retyped, written for
   that step: the worktree and git lines, no subagents, no ready, merge or CI wait, the caps
   (`nice -n 19`, one file at a time, one typecheck at the end, none in tests or review), never a
   real signal or launchd or Electron on the laptop, fix it properly, the checks in order with the
   list ratchet CI runs, the run row, plain commit with leak check and `botpush.mjs`, and the report
   with its last `answer:` line.
2. **Rules code already holds are cited, not restated** (0408): the test config refuses a broad run
   and a wrong Node and prints the right command; `typecheck.sh` holds one lock;
   `fabrika/law-shape` and `fabrika/integration-test-name` hold test shape and names; CI's `field`
   job checks a row's shape.
3. **Judgment the briefs kept adding moves in:** look around first; a property states its coverage;
   `runsFor` for case counts; the code wins over the plan on a name; leans at 80%; the owner-away
   rule; the review's data-shape, settings and docs-rows checks; at least three plants of the
   reviewer's own; "For the owner" when a pull request waits on him.
4. **The lead skill gets one template per step,** fields first and a `This lane:` list, with one
   filled example from ticket 1041's tests round. The fix round's brief loses its caps and finish
   paragraphs, which the skills now hold.

Nothing a step may do changes, except where the skills now say what the briefs already said, and
each of those is an owner call below.

### Ticket-sized items, not built

- **`brief.ts`**, a lead script that prints a step brief from the template and the lane's state
  file, and refuses one with an empty field. phoenix's `lane brief` is the model: fields from data,
  rules from the skill. TypeScript, beside `chain.ts`, about 150 lines with its test.
- **Run rows keep their cost.** All 89 run rows of 2026-11-14 and 2026-11-15 have `costUsd: null`,
  and 70 have `tokens: null`: the agents wrote their own rows, and `clauderow.ts`, which prices a
  Claude subagent from its transcript, was not run. Once a row is written it is never edited, so
  this fact is lost for those runs. Smallest fix: `clauderow.ts --row <agent's row>` fills tokens,
  minutes, effort and dollars from the transcript, and the lead commits the row after the agent
  ends, instead of the agent.
- **Step agent definitions,** `.claude/agents/<step>.md`, each preloading its skill, as phoenix's
  shells do. Waits on call 5.

## Calls for the owner

1. **Take this shape: templates in the lead skill, standing rules in each step skill.** Lean yes,
   about 85%. It costs about 2 to 5 KB more skill per step and a skill edit when a standing rule
   changes. Doubt: a brief typed by hand also re-thinks each line; a template can carry a stale
   field.
2. **The step skills commit with plain `git commit` and push with `botpush.mjs`,** as 0161 and 0164
   say and every brief did. The step-commit skill and one line of AGENTS.md "Finish your task" still
   say the step-commit skill signs and pushes. Lean: yes, and retire the step-commit skill's signing
   text in a follow-up, about 80%. Doubt: `drive.ts` boxes still call `stepcommit.sh`.
3. **A reviewer may commit its own run row,** and only that file, when the brief's `Run row:` field
   names one. Every review brief in the window asked for it; the old skill said never commit. Lean
   yes, about 85%.
4. **A reviewer plants a break in a scratch copy, never in the branch.** Kept as the skill says.
   Briefs in the window let the reviewer break product code in the worktree and restore it with
   `git checkout`. Lean: keep the skill, about 70%. Doubt: a scratch copy cannot run a law that
   needs the whole tree; restoring by checkout worked in every lane read.
5. **Add step agent definitions under `.claude/agents/`.** Lean yes, later, about 65%. It would
   preload the skill and could cut a step's tools. Doubt: the plan writer and the reviewer each
   write one file, so a tool cut does not fit cleanly, and AGENTS.md notes that only `--tools`
   truly limits.
6. **A tests law may pin a setting's default when the plan names it.** The tests skill says no law
   checks a tuning default; the ticket 1041 brief asked laws to pin 64 KiB and 256. Left as the
   skill says. Lean: allow it for a declared setting the plan names, about 60%. Doubt: a pinned
   default turns a planned tuning change red, which is the noise the rule guards against.

## Every other serious branch

- **Keep typing briefs.** Loses nothing today and costs the lead about 4 to 8 KB of typing a step,
  with lines dropped at random (only 9 of those 124 briefs had "Fix it properly").
- **phoenix's rule: no lane notes at all.** Every lane fact goes into the plan as an amendment, and
  the brief is only fields. One home for each fact, and the strongest against drift. Loses speed:
  every note after approval needs a re-sign, and review "look hardest at" lists are the lead's
  judgment, not the plan's.
- **Run phoenix's CLI here.** Needs a GitHub issue per ticket, labels, a board, `.fabrika/` and its
  hooks. Each is ruled out or absent here. Loses this repo's tracker, state file and the no-hooks
  rule.
- **Restart `chain.ts` and `drive.ts`.** The written path in the lead skill. Loses the hand-run
  speed the owner chose today, and its Codex boxes are not the agents running now.
- **One shared standing-rules page** that the four skills link. One home (0130), but each agent
  reads one more file, and the rules differ by step (who runs a typecheck, who commits what).
  About 70% that per-skill sections read better.

## What it cannot tell us

- No agent ran on the new skills. Whether a shorter brief gives the same work is untested; the
  first real lane on them is the test.
- The standing share of a brief was counted by paragraph on two briefs, not all 111.
- phoenix was read at a two-week-old local checkout. Its newest pieces may differ.
- The cost per step cannot be given: no run row of the window has dollars.
- The brief counts come from one lead session's transcript. Briefs sent from other sessions, or by
  message to a resumed agent, are not all in them.
