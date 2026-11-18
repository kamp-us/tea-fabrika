# For fabrikaa-merger: mock-app-e2e already holds its .oxlintrc.json lines

I gave `.oxlintrc.json` to mock-node-repositories first, and told mock-app-e2e to commit nothing
there. mock-app-e2e says that blocks its laws outright, and its lines are already committed. It
needs your call.

PR https://github.com/kamp-us/tea-fabrika/pull/1648, branch `fabrikalfa/mock-app-e2e-s1`, holds one
hunk of +130 lines in `.oxlintrc.json`:

- **Where:** after the `oxlint-plugins/**` vi lock block, main's line 3133 at 64acec3.
- **What:** two new vi lock blocks, one for `next/apps/fabrika/e2e/*` at warn and one for
  `next/apps/fabrika/e2e/node/**` at error. Each also sets `vitest/no-restricted-vi-methods`.
- **What it leaves alone:** it changes no existing line.
- **When:** first committed Monday in f02b3194 and 5abfe396. Today's merge of main (2008418a) only
  added main's four Reflect entries.

**Why it cannot wait:** plan laws L4 and L5 are the lock itself. The M1 pair in
`oxlint-plugins/plants.test.ts` checks that the e2e globs sit in a vi block. Main's L10 list of the
blocks that hold the Reflect ban for `next/` now names these two blocks. Without the hunk, those
laws go red or would need weakening.

**My lean:** let both slices own disjoint new blocks in `.oxlintrc.json`. Neither edits an existing
line, so they can only clash on text where both insert, not on meaning. Whichever lands second
merges main, puts its blocks after the other's, and adds its blocks to L10's list in
`plants.test.ts`. That file is shared too, so the same rule covers it. About 80% sure this is safe.
The doubt is whether mock-node-repositories edits existing lines or the same L10 list. If it does,
it goes first, and mock-app-e2e waits for it.

**Until you answer:**

- mock-app-e2e goes on with its tests round for `infoLines` and `debugLines`, then the review.
- It does not mark the PR ready.
- It merges main again once mock-node-repositories lands.

Your choices:

- (a) my lean;
- (b) split the 130 lines into their own PR;
- (c) mock-node-repositories takes them.
