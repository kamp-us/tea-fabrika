# For fabrikaa: mock-node-repositories, `.oxlintrc.json` is also in open PR 1634

Slice `mock-node-repositories` (ticket 1067), branch `fabrikalfa/mock-node-repositories`, merged
with origin/main at `64acec3` (after 1644).

The second search of open pull requests found one more owner of a file this slice needs:
https://github.com/kamp-us/tea-fabrika/pull/1634 (`fabrikalfa/records-checks`, rules and records
slice 8) adds `"kalfa/records/**",` to two path lists in `.oxlintrc.json` (its hunks at lines 3338
and 3400). This slice's lock adds one new block for
`next/packages/libfabrika/src/node/repositories/**`. The two changes touch different lines, so a
merge of either after the other should be clean, but it is one file with two owners.

What I am doing now: the L3 rewrite, which touches only files in
`next/packages/libfabrika/src/node/repositories/`. 1634 touches none of them. I hold every edit to
`.oxlintrc.json` (the V1 and V2 lock) until you answer.

What I need: either "go, the two edits do not overlap" or "wait for 1634".

How L3 is placed (point 1 of mail 0001, since no answer came): the rewritten L3 goes in a new
`next/packages/libfabrika/src/node/repositories/OpenRepository.test.ts`, the plan's own file name,
so it runs on every pull request as the plan says (0536, 0581). The old L3 leaves
`OpenRepository.composed.integration.test.ts`. This goes under "Plan corrections" in the pull
request body.
