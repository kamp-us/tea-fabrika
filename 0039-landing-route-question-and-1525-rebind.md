# One yes or no on the cloud landing route; 1525's fault-catalog clash; 1427 green

## The question: can a cloud child queue a PR through the GitHub MCP, with squash?

Two PRs are at or near landing:
- **1427** is ready now: source merge-ready, and `ci-required` is green at 6414994b
  (https://github.com/kamp-us/tea-fabrika/actions/runs/44210687946). That run's `related` job
  passed T753 L16 at full depth.
- **1562** will be ready after its fix round.

`land.ts` cannot run in the cloud: there is no `gh`. The route I propose:
1. The child runs the full leakgrep with the list over the **net diff** (`origin/main...HEAD`).
2. It sends me the SHA.
3. I check it.
4. The child arms it with the GitHub MCP's `enable_pr_auto_merge`, `mergeMethod: SQUASH`
   stated explicitly.

That is how I armed 1586. Main's log shows every PR landing as one single-parent squash commit
(a6761bce, 4d42be0e, 955a82d9 ...), so only net diffs reach main.

**Why I ask before doing it:**
- **It skips `land.ts`'s gates.** The lead skill says a bare merge is never used because it skips
  the leak check. Here the leak check is done by hand instead.
- **Both branches fail leakgrep's per-commit mode on old history.** 1562 reports 2,587 hits, all
  in 1,917 commits dated 2026-10-04 to 2026-11-09. They come from the old root 6e9a5104, which
  main dropped when it was re-rooted at 1ffb6633 (#1537). The 713 commits from 2026-11-13 on give
  0 hits, and the net diff is clean. The stack's 1427 is the same case.

**Say "cloud queue yes"** and I send "1427 queue go" to K1 at once, and "1562 queue go" when it is
ready. **Say no** and both wait for you to land them from the laptop with `land.ts`.

**Separate, for the owner's notice, not this landing:** any branch still carrying pre-re-root
history keeps that history public. That includes several fabrikalfa branches cut before #1537. If
the re-root was done to drop it, deleting those branches once landed is the cleanup. That is the
owner's call.

## 1525: main's fault catalog clashes with the spacing autofix

1525's `ci-required` **failed** at 6d1173da
(https://github.com/kamp-us/tea-fabrika/actions/runs/44210743213):
- All 28 related integration files passed, 440 tests, L13 included.
- Then `checklist faults` (`plant-related.ts`) exited 1.

**The cause:**
- #1581's catalog `.github/ci/plant-cases.ts` pins
  `checklist-instance.laws.integration.test.ts` to exact bytes: its source commit 3ca406a6, its
  sha256, and its failure line numbers.
- K1's pure autofix 97f5b110 added two blank lines to that file, as 1525's spacing rule requires.
- The fault runner refuses a fixture whose bytes differ.

So two rules want opposite things for one file, and neither may be loosened.

**My call: route (c).**
- **What:** K1 adds one commit on 1525 that re-binds the ten checklist cases to the spaced file:
  source commit, hashes and failure lines. It uses the catalog's own tooling where it has any, and
  changes nothing else. No case is removed, and no expected failure changes.
- **Review:** that commit is not mechanical, so it gets one review of that commit alone. 97f5b110
  stays a pure autofix.
- **Why not the others:** a separate re-bind PR on main (K1's option a) would pin to bytes main
  does not have, and reverting the autofix (option b) turns 1525's lint red.
- **Ownership:** `plant-cases.ts` is not on the 18-path list, and its old writer has stopped.

Children active: 7.
