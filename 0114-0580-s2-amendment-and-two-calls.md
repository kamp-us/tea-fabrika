# 0114: 0580 slice 2's amendment is ready to sign, with two calls; the typecheck port has one call; app-e2e-s1 was sent back once

## 0580 slice 2: its plan amendment, for re-sign

`fabrikalfa/law-options-0580` is at `c5184b7e0d4bb22aa97a0bbd8f6a428eb2ee517d`. The commit
changes only the plan and one row, `field/runs/2026-11-16-law-options-0580-plan-amend.json`.

- **Checks:** leakgrep is clean. `plancheck --draft` exits 0 on an unsigned copy, with
  plan-sha256 `c369b593b9126fe0adcda862da8a8b58dd7f3c50394b9c2f4e0e1145a63eadaa`.
- **The approval line:** the committed plan keeps the old one, which no longer matches.
- **The new section:** "Slice 2 amendment: a record names the file that declares its law
  (2026-11-16)". It carries my two calls, dated, and leaves `plant-check.ts` unchanged, per the
  sev0 ruling.

### What it plans

vitest 5.0.5 gives a task's location only as `{line, column}`, taken from the running test file's
frame. So it cannot name a shared suite's file.

- **The build adds `declaredIn` to `Law.ts`.** When `it` registers a law, it reads one stack trace,
  keeps the first frame outside the package's `src/`, and writes that file into `meta.file`.
  `Plants.records` names `meta.file`, or else the test file. `plant.ts` changes only its doc.
- **The tests:**
  - One new law: a law declared in one file and run from another is recorded under the declaring
    file. It runs on two new fixtures, and its plant records the running file in place of the
    declaring one.
  - The Relations and ProgramMailReads runners are shown red in the row only, because they open
    SQLite on disk.
  - The `Plants.records` generator sets `meta.file` on some laws.
  - A lint law holds `lint:layers`.
- **The build reprints** the 9 suite records with `plant.ts`, in its own row.
- **Size:** about 32 product lines and 60 test lines, in an estimated 10 steps, about $45.
- **Lint at `c5184b7e0`:** only `lint:layers` is red, on the known `RelationsTest.ts:13`.

### Your two calls before the sign

**(1) Who owns the `layer-rules.json` line.** It is on the exam list, and `plancheck.sh` and
`stepcommit.sh` refuse an exam path for any owner but tests. So the plan gives it to the tests
step, not to the build, as I had called it. My call was wrong for an exam path. Please confirm
tests.

**(2) How the stale `unclaimed` record clears.** The plan says the build "removes the one stale
record from the slice-2 tests row". That is the `LedgerTurnReads.test.ts` record of "T1041 L7
ledger", the one plant-check refuses as unclaimed. Removing it would edit a committed run row,
which the repo never does, and the coordinator will not let a step do it without a ruling. The
other way, a skip in plant-check, is a change to a CI gate, which your sev0 ruling forbids.

I see three ways:

| Option | What it means |
|---|---|
| (a) | plant-check already reads only the newest record per law, so the build's reprinted row supersedes the stale one. If so, nothing needs editing. I have not checked this, and the coordinator can check it in one read. |
| (b) | Allow this one edit of a committed row, as a named exception. |
| (c) | Hold slice 2 until after the sev0, when plant-check may change. |

I lean (a), if the read shows it holds. If not, I lean (c) over (b): rows are never edited.

## The typecheck port: L3 cannot hold as planned

The tests fix round is pushed at `0df871b21`, leakgrep clean.

- **N7** is red on today's product for the plan's reason: "expected [602, 603] to have a length of
  1". `LocksFile.ts:108-110` removes the dead `.break` directly.
- **The 16 test sites** (17 by count, since line 71 held two) use matchers now. The laws are
  unchanged, and 8 are green.
- **L3** is in `.oxlintrc.json`, and its plant is red.

**The gap.** `oxlint-plugins/anti-slop.ts`'s zero lock refuses any listed glob outside its scope.
Its `folders()` at line 63 covers `.agents/**`, `.github/ci/**`, `oxlint-plugins/**` and the
`next/` folders, and `lock()` is at line 93. So L3's four `scripts/typecheck*` globs print 4 "not a
folder of its scope" lint lines. The plan gives `anti-slop.ts` to no step.

| Option | What it costs |
|---|---|
| (a) Amend the plan so one step adds `scripts/**` to `folders()`'s scope, with its own law and plant | A change to a lint plugin's scope. It widens what the rule checks, so it is a tightening. It is still a check change during the sev0. |
| (b) Drop L3, and hold 0567 in `scripts/` by review only | No tool change. 0567 there has no automatic guard. |

I lean (a), about 65% sure, because it adds enforcement and loosens nothing. Your sev0 ruling named
CI gates, plant-check in particular, and I read a scope widening of a lint rule as different. If
you read it as the same, then (b).

- **The build** for the product fixes is running now, because they do not depend on this:
  `breakStale`, removing only its own `.break`, and the 8 sites. Lint fires on 7 product lines,
  not 8. `LocksFile.ts:19` compares `_tag` with a parameter, which the rule does not see, and the
  build fixes it by hand anyway.
- **The recheck** waits for your ruling.
- **The merge of main** still waits for PR 1523.

## app-e2e-s1: sent back once, to tests

The review row is pushed, at head `58134982218ff14fd6ae30aab5295b0f2deb71b8`.

**The blocking fault.** L1, in `bundle-warnings.test.ts:105-118`, checks only that a line starts
with `<relative file> (`. The reviewer planted a `bundle.ts` that swaps line and column, and L1
stayed green. The fix pins Rolldown's own `(line:column)` from the log's `loc`, so that the swap
plant goes red.

**Also in this round:**

- The L17 plant comment at `reload.visual.test.ts:266` names a plant that leaves L2 green.
- The EPIPE finding row needs line 323, not 322, plus ticket 1067, and an honest line on the
  ticket's number.

**What holds:**

- The Effect patch adds only `warnLines`, and `bundle.ts` matches Rolldown 1.2.13's printer.
- Both e2e lint blocks keep every entry at its level, and the `vi` entries block at warn.
- The REFLECT dedupe is not a loosening.
- `pnpm typecheck` and `pnpm lint` are 18/18 green, and L17 is green in the box.
- `build-one-file.integration.test.ts` passed 5 of 5, so there is no flaky row.

**For the layer 7 fold.** A merge-tree against lib-top-s1 conflicts in `builtin-plants.ts`, which
has two versions of `VI_METHODS` and `VI_PROPERTIES`, and in `plants.test.ts`. An auto-merge would
also leave two `viGlobs` consts and two pairs of vi scenarios. The integrator must keep one union.

One fix agent is running, and the same reviewer rechecks afterwards. pipeline-s1 waits on this
review.
