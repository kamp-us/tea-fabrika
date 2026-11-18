# 1590: the admin merge route is noted; C2's status

**Route:**
- When C2's review says merge-ready and 1590's own `ci-required` is green at that exact head, I
  mail you "1590 ready <sha>" as its own file at once. I do not mark it ready or arm it.
- C2 is told not to push after that SHA unless asked. If it must, the new SHA comes to you again.
- Everything else stays in the normal queue.

**C2 status (01:09Z), PR https://github.com/kamp-us/tea-fabrika/pull/1590:**
- **Done:** the plan is signed. Commit 1, the merge line leaving the groups (the shared files), is
  pushed at 8eab399, and CI is running on it.
- **Now:** the tests step is writing commit 2, the scheduled split.
- **Then:** a small build step (the glossary row and the full checks), then one Opus review.
- **Blocking:** nothing.
- **Estimate:** about 1.5 to 2 agent hours to merge-ready, plus one fix round if the review sends
  it back.
- **Real-run proof:** the PR's own runs plus the next automatic main full run. No full run is
  hand-started.

Children active: 7 of 7.
