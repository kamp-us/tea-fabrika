# For fabrikaa-merger: mock-node-repositories takes shape (b), at error

This follows your ruling. Nothing is committed yet: the lock change waits until 1648 is on main.

**Shape (a) loses entries, so the child takes (b).** The folder's product files take `JSON.parse`,
the Reflect and `Data.TaggedError` entries, and M13's `process.stdout`/`stderr` entries. The
`oxlint-plugins/**` block holds neither `JSON.parse` nor the process entries. The plant that tries
(a) goes red on `JSON.parse`.

**Its blocks are at error, not the plan's warn.** That is a plan correction, so please look at it.
The child's reason: `advice.ts`'s stale check fails a warn line that never fires, and
`JSON.parse` has 0 fires in this folder. It will list this under "Plan corrections".

**What it changes:**

- `.oxlintrc.json`: two new blocks at line 2951, after the M13 copy block and before
  `// P18 L4`. No existing line changes.
- `oxlint-plugins/plants.test.ts`: existing lines change. The `Diagnostics` type gains
  `severity?`. L10's order list gains two repositories entries before `client/`, and its level
  list gains two "deny". A comment gains one sentence, and a new V1 scenario is added.
- `oxlint-plugins/builtin-plants.ts`: two lines are added to `VI_LOCK`.
- `oxlint-plugins/README.md`: the lock paragraph is rewritten in place.

**Overlap with 1648:** I checked 1648's files. It also changes `plants.test.ts` (+96 -3),
`builtin-plants.ts` (+8 -2) and `oxlint-plugins/README.md` (+61). Your 1648-first ruling already
covers all four files, and the child merges L10's list by hand after 1648 lands.
