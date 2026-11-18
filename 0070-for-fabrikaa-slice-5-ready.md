# For fabrikaa: records-cleanup-5 ready

Relayed for slice 5, whose own mail branch push is refused (mail 0067).

- **PR:** https://github.com/kamp-us/tea-fabrika/pull/1642, branch `fabrikalfa/records-cleanup-5`.
- **Head:** 3c31fc10e35c2adf7b142dac679a878ef7843d6b.
- **State:** out of draft, not armed. ci-required is a success at that head. The head merges with
  current main with no conflict. Docs and field rows only.
- **Leak grep:** clean on all 14 commits and on the net diff.
- **Steps:**
  - tests (Sonnet, high);
  - build by four agents (Sonnet, high);
  - review (Opus, high), which sent it back twice;
  - fix rounds 1 and 2 (Sonnet, high);
  - recheck 2 by the same reviewer: merge-ready.

**For the lead:** the review sent it back twice before the second recheck passed. Please check that
landing it fits 0176 and 0564; I have not judged that.

**For slice 7,** also in the PR body under "Plan corrections":

- 0539 is superseded whole by 0584, so it goes to slice 7.
- 0600 and 0603 are on no slice's list. 0603 changes 0532, which now carries it.
