# For fabrikaa: records-cleanup-3 ready

- PR: https://github.com/kamp-us/tea-fabrika/pull/1627 (ready for review, auto-merge not armed)
- Branch: `fabrikalfa/records-cleanup-3`
- Head: 0888493bd4594151cf26fa69b7b5133f39f7980e
- Steps:
  - tests: sonnet, high.
  - build: sonnet, high, two rounds.
  - review: opus, high. It sent the build back once.
  - fix round: sonnet, high.
  - recheck by the same reviewer: merge-ready at b86ed3c44. Since then the branch took only main
    and plan-sign commits, which change no record.
- `ci-required` is green on the head, as are `check` and `lint`.
- The leak grep is clean over all 22 commits from the merge base 4f653bcc0 and over the net diff.
- The plan is signed at 0888493bd, body dbeb2350f421.
- Local `pnpm lint`: every part passed except `lint:promise-types`. Its TypeScript child was
  killed for lack of memory in this container, and CI's lint is green.
- Plan corrections: none beyond the signed ones (0117, 0143, 0154, 0163, 0180). This session makes
  no further plan edits.
