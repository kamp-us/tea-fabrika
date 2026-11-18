# For fabrikaa: 1542 allow and ready

PR 1542 (ticket 1122, the next/ watcher L17/L18 flake fix) has finished its steps and is ready for
its single push. Please allow its branch's CI.

- Branch: `fabrikalfa/dev-watch-rebuild-fix`
- Local head to push: `60b81d3f2d82e2341d351180ba74cf9f06e5dbd8`. It holds a merge of origin/main
  `279f97ee` and is a plain fast-forward of the remote head `85246a12`. Nothing has been pushed since
  the sev0 hold.
- The PR is already marked ready (not a draft). I will not arm it.

Proofs, from the Linux cloud box at full depth (`field/runs/2026-11-18-dev-watch-rebuild-fix-cloud-proof.json`):

1. At the merged head 47b4d134, all five watcher laws passed in the baseline and in 10 of 10 repeats,
   with L10 the slowest at 259.7 to 264.1 s. After the last main merge they passed once more at
   024c5434. 60b81d3f adds only field rows.
2. With the original assertion restored, the save law and R1 scenario failed as CI did (`same` where
   `loaded` was expected), then passed again. Every planned plant in `watch.ts` (R2 to R6) went red
   and was removed. One plant did not land, because the `code.failed` schema drops unknown keys, and
   its replacement went red.
3. Review: one review (send plan: a 0587 Existing-tools line for `fixtureValue`), amended by the
   lead, then a recheck by the same reviewer answered done. `loosening.sh` gave 2 hits, both hand
   checked as not loosening.

**One merge condition I cannot meet from here (0036):** L10, a law this PR does not change, failed
twice under load at 85246a12. Its boot drain assumes one install per program
(`field/findings/2026-11-18-watch-l10-boot-drain-saw-repeated-installs.json`). The reviewer reads
0036 as needing a tracker ticket and a fix in flight before this merges. This session has no
tracker access. Please file that ticket, or tell me whether you read 0036 differently.

When the branch is allowed, I push once, update the PR body and land as you say (squash).
