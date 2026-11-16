---
date: "2026-11-15"
scripts: "none committed; jscpd 5.4.3 run by hand on origin/main at a1df7569d, three fixed-seed samples of its JSON report judged by reading"
summary: "Our tooling and both versions; $0. jscpd 5.4.3, the copy-paste detector, on main's code with its defaults: 235 clones in code that is no test, and 7 of a 30-clone sample (23%) were false alarms, mostly tea update cases, Schema declarations and config boilerplate. With the settings chosen from that sample (weak mode, which skips comments, 60 tokens, test, fixture and config files left out), 5 of 60 fresh clones (8%) were false alarms. That is under the 10% bar for advice and far over the 0% bar to block, so .jscpd.json runs as advice on each pull request (0587)."
---

# 297. jscpd's false alarms on main, before it advises on a pull request

[0587](../.decisions/0587-new-helpers-and-names-cite-sources.md) runs a copy-paste detector on
each pull request as advice until its false alarms are measured. `AGENTS.md`'s checks section sets
the bars: about 0% to block, up to 10% to only advise. This measures
[jscpd](https://github.com/kucherenko/jscpd) 5.4.3 (0040: try the existing tool first) on
`origin/main` at `a1df7569d`, over `next/`, `.agents/`, `packages/`, `programs/` and `apps/`,
TypeScript and TSX. **$0**: no model was called. About 2 seconds per whole-tree run on a laptop.

## What counts as a false alarm

A clone is a **true** alarm when the two copies are one piece of logic that one shared helper could
hold: a function copied between two files, a wire schema written twice, a test script's helper
copied into a second script. It is a **false** alarm when the match is the shape of the language
or the framework, not a copy: a tea machine's `update` cases that all open the same way, a
`Schema.Struct` whose fields happen to line up, an `if (import.meta.main)` block, a config file. The
judging was by reading the fragment and the two locations, one reader, no second opinion.

## Runs

| Run | Settings | Clones in code that is no test | Sample | False alarms |
|---|---|---|---|---|
| 1 | defaults (mild, 50 tokens) | 235 of 2,311 | 30, seed 119120 | 7 (23%) |
| 2 | 60 tokens | 130 of 1,451 | 30, seed 7, new clones only | 7 (23%) |
| 3 | `.jscpd.json`: weak, 60 tokens, tests, fixtures and `*.config.ts` left out | 145 | 30, seed 31337, none seen before | 4 (13%) |
| 4 | the same | the same | the next 30 of that shuffle | 1 (3%) |

Runs 1 and 2 chose the settings, so their samples do not measure them. Runs 3 and 4 are fresh
clones: **5 of 60, 8%** (a 95% Wilson interval of about 4% to 18%).

- Run 1's false alarms: `WindowMachine.ts` update cases, `hosted/lane.ts` and `hosted/task.ts`
  predicates, an `import.meta.main` block in `boxfiles.ts` and `ci-speed.ts`, two machine `start`
  cases, a shared prelude in `settings/internal/edit.ts`, and three `Schema.Int` lines in
  `HandsMachine.ts` and `Handshake.ts`.
- Run 2's: two `rslib.config.ts` files, a doc comment over an error class in `Ci.ts` and
  `CodeHost.ts`, `host-machine.ts` update branches, a value built with the same fields in
  `connection.ts` and `Gateway.ts`, a machine `start` case, two `Schema.Union` phase lists, and a
  `gitMemory.ts` command prelude.
- Run 3's: the lane options of `hosted/plan.ts` and `hosted/sort.ts`, two machine `start` cases and
  update openings, and two request handlers in `acp/fake-agent.ts`.
- Run 4's: the closing brackets of two nested schemas in `ci/HistoryGh.ts` and `ci/RunsGh.ts`.

Weak mode, which skips comments, and leaving out config files removed whole classes. What is left
is mostly tea machine boilerplate: every `update` opens with `if (s.phase !== "idle") return
stay(s);`, which jscpd cannot tell from a copy.

## What this decides, and what it does not

- `.jscpd.json` holds run 3's settings, and `.github/ci/copies.ts` reports only the clones a pull
  request adds (`--baseline-from-ref` on its base), as warnings that never fail the job.
- 8% is under the advice bar and over the blocking bar. Blocking waits on a larger sample, and on
  the tea boilerplate class being left out by a setting or gone from the code.

## What it cannot tell us

- One reader judged every clone. Several were close calls (a shared prelude, test data copied
  between two e2e scripts), and a second reader could move the rate by a few points either way.
- Sixty clones is a small sample; the interval runs to 18%.
- It measures clones already on main, not the ones new pull requests add. A pull request's new
  clones may have another mix, and no pull request has run the step yet.
- Test files were left out on purpose. 2,038 of run 1's 2,311 clones were between tests, and the
  finding about a law-shape test copying a plant helper
  (`field/findings/2026-11-14-law-shape-test-copies-plant-helper.json`) shows real copies live
  there too. They are not checked.
- Raw reports stay outside git (0027).
