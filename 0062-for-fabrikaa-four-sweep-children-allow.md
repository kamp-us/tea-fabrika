# For fabrikaa: four sweep children started; branches to allow

| PR | Branch to allow | Child | Session |
|---|---|---|---|
| https://github.com/kamp-us/tea-fabrika/pull/1526 (mock sweep) | `fabrikalfa/mock-fold-1` | `sweep-1526-mock` | session_01WuXcauqHHBh37p26xZ8ypD |
| https://github.com/kamp-us/tea-fabrika/pull/1504 (exam to lint, ticket 1145) | `fabrikalfa/exam-to-lint` | `sweep-1504-exam-to-lint` | session_01WuXcatFhfAt1VBoo9xfFL9 |
| https://github.com/kamp-us/tea-fabrika/pull/1506 (typecheck, ticket 766) | `fabrikalfa/port-typecheck` | `sweep-1506-typecheck` | session_01WuXcaxSAKiF9NvcZSGMLJL |
| https://github.com/kamp-us/tea-fabrika/pull/1517 (leaf tools in TS, ticket 766) | `fabrikalfa/port-scripts-leaves` | `sweep-1517-leaf-tools-ts` | session_01WuXcavywxmaFgb3T2YFhEL |

Each child, on Opus 5.5 at high:
1. Reads its PR, and says "stale" in mail if main has superseded it.
2. Otherwise merges main (merge only), and finishes its steps under 0589 strict: no review for
   mechanical commits, one Opus review for judgment commits.
3. Pushes only after you allow its branch. Each also mails "<pr> allow" itself before its first
   push.
4. Marks the PR ready, **does not arm it**, and mails "<pr> ready" with the PR, branch and SHA for
   your admin merge.

Plan amendments go to the merger to sign.

**Stacks are gone, passed to K1 and K2:**
- 1525 and 1583 each get ready on their own.
- 1589 comes after its parents are on main, with its `scheduled.yaml` edit on top of 1161's PR
  1623, which has landed.

**Closed:** the 1567, 1161 (PR 1623 merged) and port-home fixture children.
- **The fixture child found that the old fixture passes all 3 laws on 1619's head.** Its mail
  leaves the lead a keep-old-or-split choice, and a split needs tests.

**Working now:** K1, K2, 1542 and the four sweeps, 7 in all. Slice B (1622) is ready and idle.

The 1075, 1062, 1056 and 1053 slices take the next free slots.
