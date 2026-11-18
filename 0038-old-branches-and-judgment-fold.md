# The two old branches: reflect-fold-1 needs nothing; the judgment fold child started

Item 2 checked both branches by content, against main a6761bce1. Neither has a PR of its own.

## `fabrikalfa/reflect-fold-1`: partly landed, nothing left to do

- **On main:**
  - the ticket 1029 TestDatabase part (PR 1301)
  - the E4 to E25 part (PR 1501, with its one extra tsconfig line superseded by PR 1521)
  - the ticket 1067 mock plans (PR 1491)
- **Not on main, but carried by open PRs:**
  - ticket 1056 Reflect slices 9 to 12 are all on `fabrikalfa/reflect-rest`, so PR 1494 already
    has them
  - ticket 1067 mock slice 1 is on PR 1526
- **Residual:** only "T1056 fold:" fixes for main's Effect checks, which 1494's main merge
  70dddec3e redid.

So no fold into 1494 is needed and no PR either. **The branch can be retired once 1494 and 1526
land.** Should 1526 stay off the queue for long, its slice 1 lines live only on that draft and on
this branch.

## `fabrikalfa/antislop-judgment-fold-1`: not landed. A child is started in C2's slot

- **What is not on main and on no open PR:**
  - SAFETY comments on type assertions (0561; 679 lines on the branch against 3 on main)
  - no-unknown-parameters and no-unknown-returns
  - no-runtime-typeof, via Effect Predicate
  - prefer-effect-match and no-unknown-type-aliases (0563)
  - the lock commit b254a4c1e for 57 folders
- **Already handled elsewhere:** readable spacing landed in part (PR 1507), and the rest is
  1525's.
- **Main at error against the fold:**

  | Rule | Folders at error on main | Folders in the fold |
  |---|---|---|
  | no-runtime-typeof | 13 | 27 |
  | no-unknown-parameters | 11 | 15 |
  | no-unknown-returns | 15 | 21 |
  | require-safety-comment | 11 | 22 |

**Child:** `antislop-judgment-fold-1057` (session_01WuXcavoryxg1kTrUUbrNPu), Opus 5.5 at high.
Its brief:
1. A new branch from main, with a plain merge of the old fold, readable spacing left to 1525, and
   a draft PR at the first push.
2. **Recount every rule on the merged tree:** main has moved about 100 commits. The lock is one
   reviewed commit, per 0589's first amendment, but for the folders at zero **now**, not the old
   57. A folder with hits gets fixed or stays off the lock. It is never locked red, and no rule is
   switched off.
3. Mechanical commits are split from judgment commits. Only the judgment commits (SAFETY
   comments, rule code, the lock) get the one review.
4. **Sequencing:** `.oxlintrc.json` is shared with 1525. The child keeps to the judgment rules'
   blocks, and whichever lands second merges main.
5. Proof comes from the automatic CI only, then the full leakgrep, then ready and the queue.

**One more thing for you, on 0161.** C2 flagged that its commit 8eab399 carries a
"Co-authored-by: Claude" trailer the commit script added, against 0161's "the bot pushes with the
owner as co-author". My own commits carry the same kind of trailer, from this session's
attribution settings. That includes this mail branch and 1586's acceptance commit, which merged.
Rewriting is not allowed, so they stay. Is a Claude trailer against 0161, or only a missing owner
trailer? If cloud commits must change, the harness's attribution setting is the place, and that
is the owner's setting, not mine.

Children active: 7 (B1, K1, K2, L16, item 1, item 2, judgment fold).
