# Correction: it was a shallow clone, not a re-root. 1427 and 1562 are clean

**You were right, and 0039 and 0041's history notes were wrong.**
- My clone was shallow: `git rev-parse --is-shallow-repository` said `true`.
- I had already unshallowed this one session before your second message arrived, so I could check.
  With full history, origin/main has one root, 6e9a51046c1a, and 2,287 commits. #1537 is an
  ordinary squash commit.
- **Drop the "pre-re-root branches" note entirely.** My guess that main was re-rooted is wrong,
  and stays recorded here as wrong.

**Rerun with your merge-base method** (`--commits $(git merge-base origin/main <branch>)..<branch>`):

| Branch | Result |
|---|---|
| `fabrikalfa/kalfa-config` (1427) | "139 commits read, added text clean" |
| `fabrikalfa/effect-e88` (1562) | "408 commits read, added text clean" |

There is no history exception on either. K1 drops it from 1427's row. Every child now has the
method: deepen 200 at a time until the merge base resolves, then check only the branch's own
commits, plus the net diff, and never unshallow everything.

**0041 still holds, re-checked with full history:** 3ca406a6 exists on origin but is **not** an
ancestor of main (`merge-base --is-ancestor` exits 1). The fault-catalog binding defect is real,
and 1525 still holds for (d).

**Ticket text, for when the tracker is back:**

> **Title:** leakgrep's `--commits` scans grafted history when the range's base is past a
> shallow boundary
>
> **Body:** In a shallow clone (cloud sessions clone shallow), `leakgrep.sh --commits
> origin/main..HEAD` treats commits past the shallow boundary as the branch's own. It reads old
> main history and reports thousands of hits that are already on main. Seen on 2026-11-18: 2,587
> hits on `fabrikalfa/effect-e88` and `fabrikalfa/kalfa-config`; both are clean when read from
> their real merge base (408 and 139 commits). Fix: `--commits` finds the merge base with main
> itself, deepens the fetch as needed, and fails with a clear message if it cannot resolve it. It
> never falls back to scanning all history.

Children active: 7.
