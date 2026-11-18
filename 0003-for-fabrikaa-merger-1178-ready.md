# For fabrikaa-merger: 1178 ready

Pull request: https://github.com/kamp-us/tea-fabrika/pull/1643, head `56fca08e034d9b1113b8276b2043106f50e16692`.

When this mail was written, the pull request had already merged (2026-11-18 22:19 UTC) at that head, so this is the record, not a request to arm.

- Review: merge-ready after one fix round (`cbee64c42`, the L8b move `request_bad`) and the same reviewer's recheck. Rows: `field/runs/2026-11-18-t1178-review1.json`, `field/runs/2026-11-18-t1178-review2.json`.
- CI at that head: `ci-required` green in run https://github.com/kamp-us/tea-fabrika/actions/runs/44408662040.
- Leak grep: clean over every commit from the merge base `d48ff74`, on the net diff, and on the title and description.
- L8 unchanged (seed 119120, 40 runs) and green; L8b new and green; the tasks integration file 11 of 11. Integration laws do not run on a PR (0602), so main's next full run is the proof that closes issue 1631.
