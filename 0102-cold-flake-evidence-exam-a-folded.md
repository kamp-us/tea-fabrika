# 0102: evidence for the 0036 cold first-run ticket; exam slice A reviewed and folded

## The cold first-run failures (app-src s1's review)

- **Review row:** `field/runs/2026-11-16-t1067-mock-app-src-s1-review1.json`, on
  `fabrikalfa/mock-app-src-s1`.
- **The failing tests' names and errors were not kept.** The reviewer piped both runs through
  `tail -8`, so only vitest's closing summary lines survive:

  | File | Started (UTC) | Time | Summary |
  |---|---|---|---|
  | `file-services.laws.integration.test.ts` | 08:02:08 | 15.50 s | "Tests 1 failed \| 12 passed (13)" |
  | `door.integration.test.ts` | 08:02:24 | 94.45 s | "Tests 2 failed \| 151 passed (153)" |

  Later green door runs took 31 to 40 s.
- **Box and state:** box `session_015QKFcx6xicqh6woBLph5CS`, in a fresh agent worktree, at head
  `3befd575f`.
  - `pnpm install --frozen-lockfile` had just run.
  - The vitest caches (`node_modules/.vitest-cache`, `next/apps/fabrika/node_modules/.vite`) were
    new.
  - These were the 2nd and 3rd vitest runs after the install, each its file's first run.
    `grant-readers` ran first and passed.
  - **Another agent's tsgo was running.** The box was under load.
- **Later runs at the same head all passed:** file-services 4 times and door 3 times, one of each
  with the caches moved away.
- **A cold rerun on an idle box passed.** It ran in a fresh worktree at `d821377bb`, after a frozen
  install with no cache, each file alone, at `nice -n 19` with `--maxWorkers=1`, and with no tsgo
  running. File-services passed 13/13 in 6.56 s, and door passed 153/153 in 38.37 s.

**So it does not reproduce cold on an idle box. The one shared factor is load.**

**One more instance in the same group today.** app-src s2's tests step saw both real-instance laws
in `instance-one-file.integration.test.ts` fail after about 72 s each, under memory pressure, with
no error captured:

- "p33 real isolation..."
- "p33 complete output and T10 recovery..."

Six other runs passed. Afterwards it found an orphaned workerd from its runs, whose parent had
died. That points to a killed test worker, but it is not proven.

**What is running:** the flake box, `session_015QKFcx4hYdhQzoeC5XBUJS`, loops cold runs of both
files at `mock-fold-1` `1c7914396`, keeping every log. On an idle box it may not fail. If it runs
10 clean passes of each, the next step is to rerun under load (a concurrent tsgo) to catch the
error text. I will mail its result.

## Exam slice A: reviewed and folded into PR 1504

**The review:** done at `0195a28`, with 0 blocking findings. No moved law compares less, and three
compare more.

**The fold:** a merge, no-edit, of `exam-to-lint-a` into `fabrikalfa/exam-to-lint`, which was at
`0b02152` with F. PR 1504's head is now `5c18d78`. This is the sweep branch's one take of main,
through A's merge at `2621967`.

**Conflicts resolved:**

- `oxlint-plugins/settings-imports.test.ts`: kept slice A's copy, as A's review ruled.
- `settings-generated.test.ts`: kept A's header.
- `vitest.shards.test.ts`: L5's title now reads 267.
- `one-page-runtime.test.ts`, which git did not flag: it imported the old exam `plant.ts` path, and
  is now `./plant.ts`.

All of this is in `field/runs/2026-11-16-591-fold-a.json`.

**Fold checks:**

- 5 test files, 98 tests, all green.
- `pnpm lint`: 17 of 18 parts passed in the full run. `lint:promise-types` died with EPIPE and
  passed alone.
- Leakgrep is clean.
- A's review finding is committed as `field/findings/2026-11-16-edge-comment-pointers-stale.json`.
- PR 1504's body is updated, and it is still a draft.

**One thing for you to judge.** The 98 include `.github/ci/changes.test.ts`. The coordinator ran it
itself, in its own main checkout, because slice A's step box could not name it: the path holds
"git". It was not a retry of a refused command, since the coordinator's own run was not refused.
But it does reach the test by a second route. I lean toward fine, because the fold step owns the
check. Say if you read it otherwise. The real fix is the package script that the compound-command
ticket asks for.

## Exam sweep, still running

- **Slice E's fix round.** Its first review sent it back for one class of fault: five S2 sync walks
  (window, tezgah program, queue, hands and chaos) skip messages their machine takes. The new laws'
  hand-seeded `fc.assert` against 0579 is a finding row, not this round's work.
- **Slice B** takes in the sweep branch, re-runs its laws, then goes to review.
