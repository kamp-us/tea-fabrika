# 1588 hit a visual flake, and I re-ran its failed jobs; the judgment fold's draft is up

## 1588: a red `next (e2e-2)`, rerun

- **The failure:** ready run 44216670632 at 0d5efd6d failed `next (e2e-2)`, job 134508456856.
  Fail-fast then canceled related legs 3, 5, 6 and 7. Everything else that finished was green.
- **The test:** `next/apps/fabrika/e2e/first-window.visual.test.ts`, "L15: use in two tabs (W2)".
  At seed 119120, path 0, `locator.waitFor` timed out after 30 s at line 441, waiting for tab t1's
  checklist "Add an item" textbox.
- **Why it reads as a flake, not this PR:**
  - 1588 changes no code that leg runs, only which visual files share a leg.
  - first-window started first on its leg, as before.
  - The same fixed-seed case passed, also first on its leg, in all three sampled runs (44201566907,
    44155250216, 44077224612).
- **Done:** I re-ran the failed jobs (`rerun_failed_jobs`, 201). The arm stays. If it goes red on
  the same law again, B1 stops, and 1588 waits for that law's fix.

**0036 owes a ticket** for this flaky law. It is not B1's lane. The finding row text, for 1588
after it lands or a rows-only PR:

> `{"_tag":"finding","id":"2026-11-18-first-window-two-tabs-checklist-textbox-timeout","date":"2026-11-18","rule":"flaky_test","location":{"path":"next/apps/fabrika/e2e/first-window.visual.test.ts","line":441},"says":"In next/, the visual law L15 (use in two tabs, W2) timed out after 30 s waiting for tab t1's checklist 'Add an item' textbox on its first fixed-seed case, on a leg where it started first, as it had on three green runs.","proof":"run 44216670632 job 134508456856: TimeoutError locator.waitFor 30000ms at first-window.visual.test.ts:441, seed 119120 path 0; the same file and case passed in runs 44201566907, 44155250216 and 44077224612.","pr":"kamp-us/tea-fabrika#1588"}`

**Ticket title:** next/: first-window L15 (two tabs, W2) times out waiting for t1's checklist
textbox on a fixed seed.

## The judgment fold (ticket 1057): draft https://github.com/kamp-us/tea-fabrika/pull/1593

- **The merge:** a plain merge of the fold at 788cb7725, just before its old lock commit, so the
  lock lands as one new commit.
- **Left out:** every blank-line-only change is dropped, and `.oxlintrc.json` is main's until the
  lock. 15 clashes with main's newer code were resolved by hand and are listed in the merge commit.
- **Recount on the merged tree:** 52 folders at zero, against the old lock's 56. The old commit's
  subject said 57, and its row said 56.

  | Rule | To add now | Old fold added |
  |---|---|---|
  | require-safety-comment | 10 | 12 |
  | no-unknown-parameters | 4 | 5 |
  | no-unknown-returns | 6 | 6 |
  | no-runtime-typeof | 14 | 16 |
  | prefer-effect-match | 18 | 20 |

- **The 4 folders lost** come from main's newer code: `apps/fabrika`, `.github/ci`, and one line
  of `botpush.mjs`. An Opus agent is fixing those 17 hits, so the lock can go back to 56. A folder
  that does not reach zero stays off the lock.
- **Next:** the lock commit, then one review of the judgment commits.
- **Seen, not in scope:** `no-unknown-type-aliases` is at 0 hits everywhere but not switched on.
  Turning it on is a new rule, for ticket 1053.

Children active: 7.
