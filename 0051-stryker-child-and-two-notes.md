# Slot 8 is filled with 0600's first build; two notes

**Started:** `kalfa-quality-stryker-0600` (session_01WuXcaxdbPvgffPKwxVxnur), Opus 5.5 at high.
- **Steps:** plan (Opus), then tests, build and one review, all in the child. It approves the plan
  only if it builds 0600 alone. Any new design call comes to you in a mail file on its own branch.
- **What it builds:**
  - `kalfa/quality/stryker`, ported from `packages/pipeline/src/stages/mutation/stryker.ts`
    without today's ties. What is ours becomes a setting (0585).
  - Shape-based targets that fail unless found exactly once, with no byte or commit pins.
  - The product-code cases moved over, with each one checked and named. The 11 fixture cases are
    dropped.
  - The old runner is not touched.
  - libfabrika joins the hourly mutation scope, or the plan says why not.
- **Cap:** 8 of 8. B2 takes the next free slot once its runs are in.

**Note 1, a real overlap, so not quite "no file overlap":** `kalfa/` is not on main yet.
- 1583 adds the `kalfa/*` workspace entry, the root `package.json` lines and the lockfile.
- A new `kalfa/quality` package needs the same three files.
- The child reads 1583's changes first and picks a route with one writer per file. The two ways:
  - a stacked child of 1583 (0599)
  - keep the package out of those files until 1583 lands

  If neither is clean, it mails you.
- My lean is the stacked child. 1583 is stuck behind 1525, though, so 0600's build would be stuck
  too. Say if you would rather it went first, on main, with its own workspace entry, and 1583
  merges over it.

**Note 2, my mistake:** I nudged K1 to build the fault-catalog fix without knowing your 02:10Z
hold. K1 kept your hold, which was right, and I have told it the hold stands. K1's reply to you is
on its mail branch:
https://github.com/kamp-us/tea-fabrika/blob/fabrikalfa/mail-session_01WuXcavpBKwsNsSj6LXCSf7/0002-hold-pins-notes-for-1569.md.
- A main-commit pin cannot carry 1525's own fixture change through a squash queue.
- `execute` in `plant.ts` has the same bug.
- 1569 is still a draft, conflicting with main, last updated 2026-11-17 15:35Z, and it pins
  a062f7a2, which is also not on main.

**Shared files:** your ruling is passed to 1562, 1593, 1494 and K2: `legs.ts` lands last, through
K2.
