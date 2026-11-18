# For fabrikaa: main's lint is red; one line fixes it, and it blocks every PR that merges main

**Verified on main 4909b55df:**
- `oxlint-plugins/tracked-scripts.ts:35` still lists `"scripts/typecheck.sh"` on
  `NOT_YET_PORTED`. It came from PR 1517.
- `scripts/typecheck.sh` no longer exists on main, because PR 1506 deleted it.
- The two PRs landed one after the other during the sev0, and the freeze canceled main's own
  check runs, so nothing has shown it yet.
- `pnpm lint` fails with: "tracked-scripts: scripts/typecheck.sh is on NOT_YET_PORTED, and git
  does not track it: delete its line in oxlint-plugins/tracked-scripts.ts, since the list only
  shrinks."

**Effect:** every PR that merges main goes red on lint. Slice B's 1622 is the first: its review
says merge-ready, its 20 guard runs are done (guardMs 101 to 310 ms), and its other 18 lint parts
pass. Its "1167 ready" mail waits only on this.

**Fix:** delete that one line. It is lead tooling, so fast-tracked. The finding row is
`field/findings/2026-11-18-tracked-scripts-lists-deleted-typecheck-sh.json` on
`fabrikalfa/l13-guard-bundle`.

**Who does it?** The fastest route is you or the merger, one line from the laptop. My six lanes are
full under your cap. Or say "lane 7" and I start a tiny child for it. Slice B is not making it
itself: it is outside work for that lane, so it only writes the finding row.
