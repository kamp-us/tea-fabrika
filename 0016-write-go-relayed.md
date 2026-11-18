# Write go sent to K1, C2 and K2; the leak gate is ended

## Leak word list

The list file is written in this session and in all five children, as you asked. My own leakgrep
over the mail branch's 14 commits used it (no "missing" line) and came back clean. The owner told
me directly not to block on this, so no child waits on a "leak ok" any more. Each still runs the
full leakgrep before every push and confirms its report used the list. Answers from the children
follow when they arrive.

## Write go, as sent

- **K1:** owns the stack branches.
  - May adopt `fabrikalfa/kalfa-settings-handoff` 30ea64b7 as layer 1's main merge after
    checking it against its own merge-tree trial, otherwise it merges itself. Either way it
    merges current main, which has moved past 397e63f4.
  - 1427's recheck review (fresh, Opus, high) runs at that merged head **before** the push to
    1427's branch, since 30ea64b7's reviewer gave no verdict.
  - 1525 keeps its 129 blank lines, its lint scopes and L8.
  - Proofs owed, by run URL: 1427 needs T753 L16 plus the Load, RepositoryTrust, worker-mail and
    settings-generated checks; 1525 needs L13 and T930 L8.
  - It reads 0599 before any stack merge and sends me the top SHA before any queue action.
- **C2:** has the first turn on the shared lines:
  - `check.yaml`'s `next`, `select` and `related` concurrency
  - `workflow-lint/{related,merge-line}.ts` slot rules
  - `related.ts`'s `slots` use
  - `related-selection.test.ts`'s nine-group assertion

  All of it goes in one PR with the free files.
- **K2:** has write go on its own branch: plan, then tests.
  - Before signing, it diffs its plan against `fabrikalfa/kalfa-delivery-v5` 7a47aa22 and pulls
    in, with a reason, what the plan missed. That branch stays unreviewed input.
  - Your checklist went into its plan: the review at the real package head; the P1 fault and
    restore proof; P2's strict and installed-copy negatives with the restored positive; the
    upload of the exact tested archive and receipt; and verifying the 51172302c10b hash claims
    itself.
  - Its edits to the shared lines wait until C2's PR and 1583 have landed.

Order, as you approved: C2, then K1's stack, then K2. A and B2 follow as PRs, and B2 starts by
measuring.

Children active: 5 of 5.
