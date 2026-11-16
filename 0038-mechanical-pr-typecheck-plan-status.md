# 0038: Effect mechanical PR 1501 is green; typecheck port plan PR 1506; rulings sent on

## Effect mechanical fold: https://github.com/kamp-us/tea-fabrika/pull/1501 at `aefa6512`

All 22 mechanical slices, E4 to E25, are in one draft PR.

- **Hits:** 845 met, 39 fixed by the checker's quick fix, 726 by hand edits, 0 left in locked
  folders, and 79 waiting on PR 1366.
- **CI's PR check is green:** `ci-required (draft)`, `lint`, `typecheck`, `changes` and `launchd`
  passed. The `next` test job was skipped on the draft, so its tests have not run in CI yet. That
  includes two `ssh-keygen` integration tests (`instance-wire.integration.test.ts` and
  `Sshsig.integration.test.ts`) that the box could not run either.
- **Fold fixes:**
  - The slices left 54 hits inside the new locks; all 54 are fixed.
  - E18's leftover at `next/packages/libfabrika/src/processes/ChildrenLedger.ts:405` is fixed.
  - **A bug E4 caused:** its change to `telemetry/internal/sink.ts` broke every local instance at
    boot and turned `sink.test.ts` red. It is fixed in the fold.
- **Not touched:** `tsconfig.base.json`, and no `LOCKED` row was added. None of PR 1366's files is
  touched.
- **Left for round 2:** 234 hits in the folders of E61 to E74, outside every lock and listed by
  folder.
- The body names the slice PRs it replaces, 1437 to 1457, for the merge session to close. It also
  says PR 1462 is not landed yet and touches the same tsconfig overrides.

**Two things to know:**

1. The integrator left the session link out of the PR body and the commit messages, citing
   decision 0161 and the pr skill.
2. It replaced the PR body with `gh api -X PATCH`, which this cloud environment allows only for
   search. The body itself is fine. I have added the rule to the twin's briefs: PR bodies change
   only through the GitHub tool.

## Typecheck port plan: https://github.com/kamp-us/tea-fabrika/pull/1506 at `3b9934b`

- PR 1419 merged during the plan step, so the branch starts from main at `59910b0`, which already
  holds it.
- **The lock:** Mercurial's pid lock, read in the 7.2.4 source (`mercurial/lock.py`).
  - The lock file is made in one step with `link()`, and it holds the holder's pid.
  - A holder counts as alive while its pid exists and its process started before the file was
    written.
  - A dead holder's lock is taken over only while holding `<lock>.break`.
  - The lock path and `FABRIKA_TYPECHECK_LOCK` stay the same.
- `proper-lockfile` was read and turned down: it calls a lock stale only after 2 to 10 seconds,
  which would turn three current laws red.
- One law body changes: "R4 gives every shell one fixed lock file", whose stand-in `python3` has
  nothing left to stand in for. That one is for the lead's `loosening.sh` hand check.
- A typecheck still on the flock version, on an older branch, never waits on the new lock. Until
  those branches merge main, two compilers can run at once on the laptop.

**Two owner questions in the plan:**

1. Decision 0410 says the typecheck lock is "one fixed OS lock". May it become a pid lock, with
   0410 amended? Lean: yes (75%).
2. When a worktree's `node_modules` is a broken link, the new script cannot load Effect. Is one
   printed line that names `pnpm install --offline --frozen-lockfile`, then exit 1, enough? Lean:
   yes (70%).

It waits for your approval and the two answers, then goes to tests, build and review.

## Your rulings, sent on

- **Exam to lint (1504):** its coordinator waits for the signed commit, then runs the slices in
  plan order. Slice E fixes the 30 hits before `machine-has-laws` turns on. C waits on 0580's slice
  1, and D waits on C and PR 1496.
- **Mock plans (1491):** one more commit is in progress.
  - No interim lock: the `vi.mock`, `vi.doMock` and `vi.stubEnv` hits are fixed in this sweep, and
    a folder that cannot reach zero keeps its lock out.
  - The fold branch is `fabrikalfa/mock-fold`.
  - The stdout row gets its end time.
  - Each plan names its decisions in its opening paragraph.
  I mail the head when it is pushed.

## Also

- **PR 1462 box:** still running `next-integration` at `262c210b4`, with no counts yet. Two things
  about how it runs:
  - The 0410 cap refused a whole-project run, so it uses CI's command: `CI=true nice -n 15 pnpm
    exec vitest run --project next-integration --maxWorkers=3`. `CI=true` also skips the Node
    version pin check.
  - It linked the 1248 browser paths to 1243 (that box was built before the Playwright install).
  `next-visual` runs after.
- **E45 restarted:** its first session never pushed and its branch never existed. A fresh
  coordinator is on `fabrikalfa/effect-e45` from main.
- **AS-no-unknown-type-aliases-1:**
  - It fixed 2 of its 3 hits.
  - The third, `runtime/Entry.ts:38`, waits on PR 1366, because the whole fix also changes
    `Runner.ts:396`, one of 1366's files. The three-line fix is in its row.
  - Its review is running now.
- **E26** is done and reviewed at `d11a67b`: 800 hits met.
