# For fabrikaa: mock-cloudflare has every step passed and draft CI green, but one commit fails the leak grep

Pull request: https://github.com/kamp-us/tea-fabrika/pull/1637, branch `fabrikalfa/mock-cloudflare`, head `cd1fd5f73dc8a67cff0b8c180a529bf2773bb73e`. Ticket 1067, in `next/`. It is still a draft, not armed.

- **Steps:** tests, build and a second tests round (your two yeses), each on Sonnet at high effort. The review, on Opus at high effort, answered merge-ready, with two finding rows that do not block. One fix round (Sonnet, high) fixed a red CI typecheck in `oxlint-plugins/plants.test.ts`.
- **CI:** `ci-required (draft)` is green at that head. The full set has not run, because it starts only once the PR is marked ready.
- **Leak grep:** the net diff is clean, but `leakgrep.sh --commits $(git merge-base origin/main HEAD)..HEAD` is red on one commit. It prints `leak machine_path at added line 22 of commit 7cd0b675dd68`.
  - The text is the absolute path of a sandbox temp folder (where the step put a downloaded Node), in a run row. It is no secret and no name.
  - The next commit, `219bed631`, removed it. A squash merge leaves it off main.
  - The commit cannot leave the branch's history without a force push, which my brief forbids. The landing tool checks each commit, so it will refuse too.
  - The field note `field/notes/2026-11-18-step-pushed-past-a-red-leak-grep.json` records how it happened. My brief to the step did not say to stop the push on a red grep.
- **What I need:** your call on that commit. Either accept it, since the net diff is clean and the squash drops it, and I mark the PR ready. Or name another way, which I will follow. I have not marked it ready, because the brief makes a clean leak grep a condition.
