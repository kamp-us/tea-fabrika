---
summary: Refresh stale native-stack merge refs without changing source heads.
follows: ["0004", "0571"]
---

# Refresh native stack metadata

Use this when GitHub says a native stacked PR conflicts, its branch and PR head agree, and its
merge ref still names an older head. The merge ref is GitHub's temporary commit for PR checks.
Check read-only merge calculations separately.
This records the operation performed on 2026-11-17 with gh-stack 0.3.0. It changes PR grouping and review bases; source history still follows [0004](../.decisions/0004-squash-merges-and-native-stacks.md).
The runbook follows [0571](../.decisions/0571-runbooks-live-in-top-level-runbooks.md).

- [ ] Record the stack's exact membership and order, both source heads, bases and ready states.
  Read both auto-merge and queue entries. This operation was used with two open, unmerged,
  unqueued PRs and auto-merge off.
- [ ] Compare both branch refs with their PR heads. Read each `refs/pull/<number>/merge` and its
  parents. Separate stale server data from any real source conflict. In the recorded case,
  ordinary and cumulative merge calculations were clean while the child merge ref named its
  old source head.
- [ ] Remove the grouping with `gh stack unstack <stack-number>`. Read the result. This leaves
  the PRs and source branches in place. Keep recording the source heads before each next write.
- [ ] Change only the child's base to main, then restore its original parent base. Read back
  each write and verify that the source head stayed unchanged. The recorded commands were:

  ```sh
  gh api -X PATCH repos/kamp-us/tea-fabrika/pulls/1525 -f base=main
  gh api -X PATCH repos/kamp-us/tea-fabrika/pulls/1525 -f base=fabrikalfa/kalfa-config
  ```

- [ ] Re-create the complete grouping, bottom first. Use full PR URLs: gh-stack 0.3.0 resolves
  them as PRs and skips all branch pushes. Record the new stack number.

  ```sh
  gh stack link --base main https://github.com/kamp-us/tea-fabrika/pull/1427 https://github.com/kamp-us/tea-fabrika/pull/1525
  ```

- [ ] Read back the complete membership, order, bases and unchanged source heads. Verify the
  child's refreshed merge ref includes its current head and GitHub clears the conflict state.
  If the state remains wrong, preserve the evidence and return to the lead. Repeating the
  sequence or changing source history is outside this metadata operation.
- [ ] If ordinary CI is absent, read the workflow's actual event list. The recorded check
  workflow did not listen for base edits or stack changes. One child draft-to-ready toggle
  emitted its supported `ready_for_review` event, then the original ready state was verified:

  ```sh
  gh pr ready 1525 --undo --repo kamp-us/tea-fabrika
  gh pr ready 1525 --repo kamp-us/tea-fabrika
  ```

- [ ] Verify the new check's actual head. Existing source proof keeps its original meaning;
  missing or red proof still blocks landing. The recorded full run remained red on L11 after
  metadata recovered. The pair was not merged.

The observed recovery changed stack 1532 to 1554. Both source heads stayed unchanged. Child
merge ref `d089bec7449a80fcc7d3e88597ed3ed2d4e211cb`, which still named the old child,
was replaced by `f4661b465f7f985c9da1cc987196f770f30c742a`, whose parents were the current
parent and child. The old stack base SHA alone was not a reliable failure or recovery signal.

Primary sources: [matching stale-ref issue](https://github.com/github/gh-stack/issues/319),
[reported successful recovery](https://github.com/github/gh-stack/discussions/229#discussioncomment-17751523),
and [0.3.0 recovery documentation](https://github.com/github/gh-stack/blob/v0.3.0/skills/gh-stack/references/troubleshooting.md#local-and-remote-stacks-have-diverged).
This operation succeeded once here; the upstream workaround is not a guarantee for every conflict.
