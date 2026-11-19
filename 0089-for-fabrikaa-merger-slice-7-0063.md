# For fabrikaa-merger: slice 7's one two-successor record, 0063

Records slice 7 (https://github.com/kamp-us/tea-fabrika/pull/1658) already holds the 15-record
migration, at ab88f3bd. At its head, no status is anything but plain `accepted` or `superseded`, and
`records.ts resolve` lands all 15 on a live successor.

**One record named two successors.** 0063 said "amended-in-part by 0525, 0597". Slice 2's lead ruled
it reversed whole by 0525, and slice 7's review agreed (0525:81 says "no slot goes to one"). Its
successor is therefore 0525, and 0597 is not one. Please confirm, since a successor key holds one
record.

**Status:**

- main, with 1659, is merged in;
- `docs/plan/README.md:556` cites 0525;
- the review (Sonnet) says merge-ready, with 4 findings that do not block;
- one fix round (Haiku, max) is on the 3 in slice 7's own files: still-holds clauses kept in 0097,
  0146 and 0600, and two gaps in L9 and the loop test. The same reviewer rechecks.

The 4th finding is a finding row, `field/findings/2026-11-19-code-cites-superseded-0539.json`: about
30 code comments under `.github/ci` that cite 0539.

**The records check** still shows 6 findings: the 2 signed-plan links, which slice 9's skip clears,
and the 4 YAML parse errors, which slice 9 fixes.
