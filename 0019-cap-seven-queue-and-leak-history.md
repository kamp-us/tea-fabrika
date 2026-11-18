# Queue items 1 and 2 started; branch-history leak hits; the two old branches

## Started (cap 7, now 7 of 7 active)

- **Item 1:** `effect-judgment-fold-1562` (session_01WuXcatXo34sNRSg1qVtjUg), on PR 1562 at the
  fix round 67706e7fe.
  - A fresh re-review (Opus, high) recounts each tsconfig with `effect-tsgo tsc` and a scratch
    tsconfig, never `diagnostics --project`.
  - Then a fix round if one is needed (0177, 0176, 0564), the proof, the full leakgrep, and the
    queue.
- **Item 2:** `reflect-ban-rest-1494` (session_01WuXcat9nxpu5nB7cTshssk), on PR 1494.
  - It finds why it stalled, merges main, and splits the rest into mechanical and judgment
    commits up front.
  - Only the judgment commits get the one review. Mechanical work goes to Sonnet.
  - Then the full leakgrep and the queue.
- **0589 strict:** applied to the running children too. B1 is told to split mechanical row
  regeneration from judgment (laws, hand-picked numbers) and review only the judgment commits.
  C2, K2 and L16 are judgment work and keep their review. K1's spacing fix is a pure autofix and
  1525 already needs no review.
- **Next free slots:** item 3 (PR 1504, exam-to-lint), then item 4 (PR 1526, mock sweep).

## The two old branches: not settled yet

`fabrikalfa/antislop-judgment-fold-1` (head 45ead97f61d9, 2026-11-16) and
`fabrikalfa/reflect-fold-1` (head 405e3a21b4ec, 2026-11-16) are both about 2,400 commits ahead
of main and 55 behind.

Main is squash-merged, so neither the commit counts nor `--cherry-pick` patch ids tell landed from
not landed. They report about 2,250 and 2,220 commits "not on main", which is mostly main's own
history before the squashes.

The heads' last commits are fold field rows and fix rounds:
- antislop: "the five judgment rules block in the 57 folders now at zero (0563)"
- reflect: "slice 10 recheck, merge-ready"

So both may hold real unlanded work. Item 2's child does a content check, read-only: for each file
the branch's own commits touch, is main's version at least as far along? It also finds their PRs.
It reports landed, partly landed or not landed per branch, and builds nothing. I'll send the
answer when it comes.

## Per-commit leak hits in 1427's branch history (my call; tell me if you want it otherwise)

K1 found:
- Every layer's net diff against main is leakgrep-clean.
- `leakgrep.sh --commits origin/main..origin/fabrikalfa/kalfa-config` exits 1 on already-pushed
  branch commits: 10 private_word, 6 key, 2,066 machine_path and 505 em_dash hits, mostly in
  large old merge commits.
- `land.ts`'s per-commit gate will refuse that history. Rewriting it is forbidden.

My call, under the owner's word to me in this session that he does not care about the two words
and not to block on them:

1. The private_word hits in already-public branch history do not block.
2. Key hits: I checked three of the six by file and redacted shape (`sshsig.ts`,
   `sshsig.test.ts`, `redact.test.ts`). All three are ordinary code or test fixture lines, so
   false alarms. K1 checks the other three the same way, and any real secret stops everything.
3. machine_path and em_dash hits in old merges do not block while the net diffs stay clean.
4. Every new commit must pass `--commits` clean.
5. **Still open:** how the stack lands if `land.ts` refuses it on that history. K1 sends me the
   SHA and `land.ts`'s answer before any queue action, and I bring the route to you then. Landing
   is not near: proofs are still owed.

Children active: 7 of 7 (B1, K1, K2, L16, C2, item 1, item 2).
