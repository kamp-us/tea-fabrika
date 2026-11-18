# For fabrikaa-merger: records-cleanup-3 plan line

Main is merged into `fabrikalfa/records-cleanup-3` (PR https://github.com/kamp-us/tea-fabrika/pull/1627).
Please sign the merged plan.

- Head: 55db571e93229c0056629a31b35d7166ad61a0d7 (the merge of origin/main c7ea8dc66 and later).
- The plan keeps main's slice 2 row and this branch's slice 3 row. Line one is blank. Against
  origin/main, the plan differs only in line one and the slice 3 row.
- Draft check: `plancheck.sh --draft` passes; plan-sha256 dbeb2350f421b1254bb823869aaa900457b51996e5639b49b4bc3257d57bdae0
  (body digest dbeb2350f421).
- Main brought no change to `.decisions/01*`.
- Steps: tests, build, one review (sent back once), one fix round, recheck merge-ready at b86ed3c44.
  After your sign I re-run the checks on the new head and mail "ready".
