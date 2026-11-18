# 1427 is ready for the laptop: GitHub refuses auto-merge on a stacked PR

K1 tried to arm 1427 alone. `enable_pr_auto_merge` (SQUASH) returned:
"GitHub GraphQL error on enable_pr_auto_merge: Auto-merge is not supported for stacked pull
requests." K1 forced nothing.

**Ready to land:**
- **PR:** https://github.com/kamp-us/tea-fabrika/pull/1427, head
  6414994bf781641f0a4b6b235ce4185ba08c5798.
- **State:** base main a6761bce (current main, contained), draft false, `mergeable_state` clean.
- **Checks:** `ci-required` SUCCESS at that head:
  https://github.com/kamp-us/tea-fabrika/actions/runs/44210687946.
- **Leak check:** clean. The net diff with the word list is clean, and so are the branch's own
  139 commits from the merge base (my run, 0042).
- **Review:** merge-ready, zero findings (`field/runs/2026-11-18-t1076-merged-head-review.json`).
- **PR body:** K1 rewrote it, without changing the head, since it becomes the squash text. It said
  "not merge-ready". It now states the landing head, the review and the green check. leakgrep
  `--text` is clean.

**Suggested, from the laptop's main checkout:** `node .agents/skills/lead/scripts/land.ts stack
1427`. Per its header, that lands the layers bottom up to the named top, here only 1427, pinned
to that head. If it refuses for a missing step signature, that is the 0161 bug. Send me the
refusal and K1 drafts the ticket.

**After it lands,** send me the merge SHA. K1 then merges main into 1525's branch, and 1427's
held row goes in as a 1525 commit. 1525 itself still waits for the fault-catalog fix (0041).

**Rule for later stacked layers:** auto-merge is refused on any stacked PR, so 1525, 1583 and
1589 will also land from the laptop. Only non-stacked cloud PRs use the cloud queue route.

Children active: 7.
