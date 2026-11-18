# K1's read: no layer of the stack can land yet

K1 read the stack and changed nothing. **None of the three layers is ready to land today: each
lacks a merge-ready review at its current head.** CI is green on the lower two.

Heads (origin, read 00:20Z): main 397e63f4. PR 1427 `fabrikalfa/kalfa-config` 5665d13f. PR 1525
`fabrikalfa/antislop-mechanical-1366` d2b6c3f9. PR 1583 `fabrikalfa/kalfa-config-package`
322e6c16 (the join, as you said).

| Layer | CI at head | Review at head | Missing |
|---|---|---|---|
| 1427 settings | ci-required green (run 44201567740; host 44201567637) | latest row `field/runs/2026-11-17-t1076-native-integration-review.json` is send_back: source passes, but scheduled proof 44110982551 failed T753 L16 at its 60 s bound; last merge-ready review is at 10f784ec, two main joins back | a merge-ready review at the merged head, and that runtime proof (green proof run, or L16's timeout fixed at its cause) |
| 1525 spacing | ci-required green (run 44201570609) | no review row for d2b6c3f9 or 103655a8 on any branch; the t1057 rows review the earlier install, not this sweep; its body says the recheck was not credited; scheduled proof 44113744564 failed checklist L13 at 60 s; runs under the anti-slop-install plan as a "mechanical exception" | a recorded merge-ready review, and a ruling on the L13 runtime gate |
| 1583 package | no check runs at 322e6c16 | review rows pass "source only"; body lists the final review, P1/P2 execution, archive delivery and seven CI routing and upload paths as not done | the CI paths, a ci-required run, P1/P2 runtime proof, a final whole-diff review |

## Merge plan (trial with `git merge-tree`, nothing kept)

1. main into 1427: one conflict, `docs/plan/README.md` "Where we are now". Keep both
   paragraphs, settings first. The other 50 incoming paths merge clean.
2. 1427 into 1525: the same conflict carries through. **Risk:** 1525 turns
   `require-readable-spacing` on as an error over `.github/ci/**`, and #1581 added many new files
   there (`changes.mjs`, `legs.ts`, `related.ts`, `plant-*.ts`, `workflow-lint/*`). If any lacks
   the blank lines, merged 1525's lint goes red until the rule's autofix runs on those files,
   which are on the 18-path list.
3. 1525 into 1583 (on 322e6c16): the same README conflict only. `check.yaml` merges clean (one
   cache path in 1583); K1 reads the result.

## What I told K1 (all of it waits on "write go")

- Merge plan approved as written.
- **The spacing autofix in 1525 is K1's**, if lint goes red: the rule's own autofix only, one
  separate commit. It is mechanical, and K2 has pushed nothing, so no file gets two writers. K2
  plans on top of it.
- **Reviews:** fresh step-review agents after the merges, at the merged heads: 1427 a recheck,
  1525 a whole-sweep review. This is owed work (0166), so I approved it.
- **Runtime gates:** K1 neither fixes nor waives them. A layer whose review asks for that proof
  does not land until it exists.
- 1583's CI paths and final review are K2's work.

## What I need from you

1. **Who owns the two runtime gates:** T753 L16 (proof 44110982551, 60 s bound) and checklist L13
   (proof 44113744564, 60 s). Both are timeouts at a fixed bound, so they may be CI-load problems
   that lane C's slot work also touches. If no one owns them, I can give them to a child when a
   slot frees (the cap is full now).
2. **Whether 1525's "mechanical exception" under the anti-slop-install plan holds,** or it needs
   its own plan. That is a lead or owner ruling, not mine to make up.
3. "Write go" for K1 and K2 once the Codex writers have stopped.

Children active: 4 of 4.
