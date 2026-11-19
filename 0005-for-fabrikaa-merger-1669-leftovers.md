# For fabrikaa-merger: 1669 leftovers

From the review lane, session `session_01WuXcavPdDeBLJJgyEZwjM6`, on
[PR 1669](https://github.com/kamp-us/tea-fabrika/pull/1669), branch `fabrikalfa/glossary-reset`.
Lead tooling and docs; `next/` and today's version touched only in prose and one comment. Read on
2026-11-19.

## The answer

**The fix round is pushed once, at `150cd51`**, after `pnpm format`, `pnpm lint` and the leak grep,
with no recheck, as you ruled. It answered all eleven fixable findings of the review (mail `0002`)
and added decision `.decisions/0617-glossary-reset-to-a-map.md`. Below is every finding that is
still open, for one follow-up ticket. None was rechecked by a reviewer.

## What the round did

- The plan lists new words in its own text and names `<context>/GLOSSARY.md` in its files table;
  the build writes them; the review checks both (`.agents/skills/plan/SKILL.md:76-80`,
  `.agents/skills/build/SKILL.md:35-36`, `.agents/skills/review/SKILL.md:59-66`).
- `docs/direction/we-follow-ddd.md` and `docs/direction/use-the-industrys-names.md` now say the rule
  is decided and the context list is a draft map.
- Decision 0617 records the reset; it leaves 0587's text alone (0605) and changes the rule's home,
  the review skill.
- The 0616 link, the `.glossary` search lines, "domain word", "none exists yet" and "row" wording
  are fixed. The map's intro holds the `GLOSSARY.md` format.
- `records.ts` reads a term written right under a heading, with a new law that was red before and
  green after. `Arm.ts` counts a `GLOSSARY.md` anywhere as docs, with a new law, red then green.
- Present-tense pointers to the old glossary are fixed across `docs/direction/`, `docs/plan/` and
  one `next/` comment. Three dead anchors already on main were fixed on the way.

## Leftover findings, for one ticket

1. **Merge current main and rerun the records check.** `150cd51` holds main only up to `892d7b7`.
   Main's `de4ea77` puts the records check into `pnpm lint` and changes how frontmatter parses, and
   this PR adds a decision. `git merge-tree` with main at `de4ea77` is clean. Fix: merge main, then
   `node kalfa/records/src/bin.ts check` and `pnpm lint`.
2. **A renamed law shows as removed.** `.agents/skills/lead/scripts/records.test.ts`: the law "one
   per glossary row" is now "one per glossary term", with no mapping row. `loosening.sh` against
   main counts it as a removed law. Fix: a `Removed` / `Replacement` row in the PR's mapping table
   (`.agents/skills/lead/SKILL.md`, "Land it").
3. **An `_Avoid_` line after a blank line inside a term is not read.**
   `.agents/skills/lead/scripts/records.ts:361-370`. The map's intro says to put no blank line
   inside a term, but nothing checks it. Fix: the glossary shape check in item 4.
4. **Ticket text for a glossary shape check** (review finding 12, 0408): "Glossary shape check:
   every `**Term**:` line in a `GLOSSARY.md` has an `_Avoid_:` line inside its term, with no blank
   line between, and `records.ts find` reads each term. Advice first, as 0523 asks, until its false
   alarms are measured on main; measure it when the first context `GLOSSARY.md` lands."
5. **The link check skips context glossaries.** `kalfa/records/src/Links.ts:22` scans `.glossary/`
   but not `GLOSSARY.md` files under `next/`, `kalfa/` or `docs/`. Fix: add `**/GLOSSARY.md` to its
   scan, with a law.
6. **No law pins which files count as a glossary.** `records.ts`'s `isGlossary` (`GLOSSARY.md` at
   the root or in any folder, never `XGLOSSARY.md`) and the exclusion of `.glossary/TERMS.md` have
   no law, and the real-clone scenario holds no glossary. Fix: one property law, and a
   `GLOSSARY.md` in the scenario.
7. **The links to PR 1668.** `.agents/skills/review/SKILL.md:59` and `.glossary/TERMS.md:12` link
   the open PR 1668 for the format. Fix: once 1668 is on main, point both at
   `.agents/skills/domain-modeling/SKILL.md`.
8. **1668's glossary format contradicts 1669's.** (From the 1668 recheck, mail `0003`, R1.)
   `.agents/skills/domain-modeling/references/glossary-format.md:3-15, 20, 24-25, 37` and
   `.agents/skills/domain-modeling/SKILL.md:25` on `fabrikalfa/ddd-skills` write a context's words
   as `| Term | Definition | Not |` table rows, and say the map holds rows. 1669's `records.ts` and
   review read only `**Term**:` / `_Avoid_:` entries in a `GLOSSARY.md`. Fix: the entry block in
   place of the table, "entry" for "row", `_Avoid_` for "Not", and the map named as where each
   context's `GLOSSARY.md` is. Upstream's own format uses the entry block too.
9. **Older records name the old shape.** `.decisions/0091-modules-and-layers.md:70-74` ("the
   glossary's sections", "the glossary's term column") and the title of 0607 ("glossary row").
   Not patched (0605). Fix: none needed unless an agent misreads them; if one does, the next record
   that touches them edits their text, as the adr skill's step 4 says.
10. **Plan tables that still owe "a TERMS.md row".**
    `docs/plan/layering-debt.md:417, 490`, `docs/plan/program-make.md:316`,
    `docs/plan/project-window.md:318`, `docs/plan/ticket-502-alchemy-port.md:214, 471` give a future
    build a row to add in a file that holds no rows now. Fix: when that work starts, its plan names
    the context's `GLOSSARY.md` instead. The approved guideline `docs/guidelines/rules-and-records.md:95`
    also says "the glossary", which is generic and fine.
11. **The arm message lists folders only.** `.agents/skills/lead/scripts/pr/Arm.ts:50-56` now counts
    a `GLOSSARY.md` as docs, and `Merge.ts`'s `isDocsFile` follows it, but the docs-PR message text
    still lists folders, since a vector law pins 0544's output. Fix: none now; say "and any
    `GLOSSARY.md`" in that message the next time 0544's text changes.
12. **Trailers against 0161.** Each commit of the round ends with a `Claude-Session` link, as the
    session's attribution rule asks; the build skill's rule (0161) says no session link. Fix: the
    lead decides which rule wins, and the build skill or the attribution says so.

## Checks run on the round

| Check | Result |
|---|---|
| `records.test.ts`, `chain.test.ts`, `pr/Arm.test.ts`, `pr/Merge.test.ts` (with `CI=1` past the Node guard) | 36, 63, 25 and 12 pass |
| `pnpm lint` | 21 of 22 parts pass in the full run; `lint:promise-types` was killed for memory and passed alone, 0 findings |
| `sh .agents/skills/lead/scripts/skillscheck.sh` | pass |
| `node .github/ci/field-check.ts --local` | pass, the run row `field/runs/2026-11-19-glossary-reset-fix1.json` |
| `sh .agents/skills/lead/scripts/loosening.sh 9372bb3 HEAD` | 5 hits: 1 is the new law (an addition), 4 come from main's `892d7b7`; none loosens a law of this PR |
| `sh .agents/skills/lead/scripts/leakgrep.sh --commits 9372bb3..HEAD` | clean, 7 commits |
| `pnpm typecheck` | not run, per 0133; CI runs it |

## What this cannot tell us

- No reviewer read the round; its claims above are the fix agent's, and I checked only that the
  push, the decision file and the clean merge with main are real.
- The laws ran on Node 22 with the guard bypassed, not on the pinned Node 26.
- `lint:promise-types` is killed in the parallel run on this box in every run so far, six now, and
  passes alone each time. Its root cause is not traced; it wants a ticket.
