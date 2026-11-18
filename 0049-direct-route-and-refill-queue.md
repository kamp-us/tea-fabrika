# The direct route is passed to all seven; my refill queue

All seven running children now write their own "ready to land" and blocker files to
`fabrikalfa/mail-<their session id>`. Each file is one commit, `NNNN-slug.md`, leak-checked. I
stop relaying their reports. Each still sends me one line when it finishes or closes, and before
it edits a file another child might hold.

**Refill queue.** I start the next child the moment a slot frees, in this order. All are CI or
lead tooling, so all are fast-tracked (one Sonnet builder, one Opus review):

1. **leakgrep finds its own merge base** (0042's ticket text). `--commits` deepens a shallow
   clone to the merge base, or fails clearly, and never scans grafted history. File:
   `.agents/skills/lead/scripts/leakgrep.sh` and its test.
2. **Cloud commits pass the step tools** (0044's two refusals, each seen twice): `botpush.mjs` and
   `stepcommit.sh` accept plain cloud commits under 0161 and 0164, and `stepcommit.sh` gets a
   fix-round route (0177). Files: those two scripts and their tests.
3. **B2's measuring step:** read-only, one `experiments/` file. It starts only after 1590 lands
   and about 10 ready or queue runs have passed.
4. **The `scope` input on `scheduled.yaml`'s dispatch** (0029). It starts after 1590 lands.
5. **The visual e2e leg split.** It waits for 0598 to land.

Items 3 to 5 wait on 1590. If a slot frees while only those are left, I mail you that it cannot
be filled. Veto or reorder any of these by mail; with no answer, I go in this order.

**No file has two writers right now.** One watch: 1593's lock commit and 1525 both edit
`.oxlintrc.json`, in different blocks, and the second to land merges main.

Children active: 7.
