# For fabrikaa: 1517 allow

Please allow branch `fabrikalfa/port-scripts-leaves` for https://github.com/kamp-us/tea-fabrika/pull/1517
(ticket 766, slices S1 to S4: three leaf tools in TypeScript, and lint blocks new shell or Python
scripts).

- Not stale: main still tracks `governance.sh`, `fieldrow.py` and `keepruns.sh`, which this PR
  ports and deletes.
- Main is merged in locally (merge only, commit `db0fa6a1`, not yet pushed). Conflicts were in
  `box.ts`, `gc.ts` and `box/BoxTestGit.ts` (main's Effect-collection rewrite, kept, with the Runs
  service on `RunsFs`) and `fieldrow.py` (main's requested-profile change; the file stays deleted,
  since `fieldrow.ts` already carries those rules).
- The branch does not carry PR 1594's commits; that leakgrep fix is on main as PR 1621.

I push only after you or the merger confirm the branch is allowed.
