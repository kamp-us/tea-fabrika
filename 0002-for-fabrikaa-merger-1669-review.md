# For fabrikaa-merger: 1669 review

From the review lane, session `session_01WuXcavPdDeBLJJgyEZwjM6`. One read-only review of
[PR 1669](https://github.com/kamp-us/tea-fabrika/pull/1669), branch `fabrikalfa/glossary-reset`,
head `69a12a5` on `origin/main` `52aebb8`, read on 2026-11-19. It is lead tooling and docs; it
touches `next/` and today's version only in prose. The review ran as one subagent with the review
skill. I checked the blocking claims against the files myself before writing this. The owner's
call to reset the glossary was taken as settled and not argued.

## The answer

**Send back.** The `records.ts` change and its tests are sound. Four small blocking fixes: the
plan skill sends new words to a map that holds none, two decided notes contradict the draft map,
the reset has no decision file, and the map has one dead link. Eight smaller findings follow.

## Must change

**1. The plan skill sends words to the wrong place, and no step writes the file.**
`.agents/skills/plan/SKILL.md:76-77` says to list new words "under its context in
`.glossary/TERMS.md`". The new map defines no term, and `.agents/skills/review/SKILL.md:59-63`
looks for `**Term**:` entries with an `_Avoid_` line in the context's `GLOSSARY.md`. The plan
step is read-only, and the build skill says nothing about it. Fix: the plan lists each new word
with its context and `_Avoid_` words in its own text, and puts `<context>/GLOSSARY.md` in its
files table; add one line to `.agents/skills/build/SKILL.md`: write the `GLOSSARY.md` terms the
plan lists.

**2. Two decided notes say the opposite of the map.**

- `docs/direction/we-follow-ddd.md:3` and `:8-9` say "the eight contexts drawn in the glossary
  and its context map are all decided". The new map says it is a draft, borders may move, and it
  lists 15 contexts (`.glossary/TERMS.md:6, 19-53`). Fix: the rule is decided; the context list
  is a draft map, checked with Event Storming; drop "eight".
- `docs/direction/use-the-industrys-names.md:11` says the glossary "exists, `.glossary/TERMS.md`",
  and `:38-40, 47` call it "one term, one row, one meaning". The review rule links this note.
  Fix: say the glossary was reset on 2026-11-18, the map is `.glossary/TERMS.md`, and terms live
  in each context's `GLOSSARY.md` with an `_Avoid_` line.

**3. The reset and the new rule have no decision file.** `git diff 52aebb8..HEAD -- .decisions`
is empty. `.decisions/0001-decisions-live-in-the-repo.md` and
`.decisions/0115-decided-rules-live-in-decision-files.md` ask for one. The live
`.decisions/0587-new-helpers-and-names-cite-sources.md:87` still says review checks names against
`.glossary/TERMS.md`. Fix: one record with the adr skill in this PR: the map shape, one
`GLOSSARY.md` per context in `**Term**:` and `_Avoid_` form, the review and plan rule, and that
it amends 0587 where 0587 names TERMS.md. The older records that name TERMS.md rows (0029's and
0081's `## Records`, 0490 to 0493) are history and stay. About 70% sure this was simply missed.

**4. A dead link.** `.glossary/TERMS.md:52` links
`../.decisions/0616-chat-codehost-provider-split.md`, which does not exist. Fix: point it at
`../.decisions/0616-providers-are-one-package-each.md`. The 0607 link check only flags links to
superseded records, so it passed.

## Smaller findings

**5. The temporary link to PR 1668** (`.agents/skills/review/SKILL.md:59`) is fine as a stopgap,
but right after 1669 lands the format has no home on main. Fix: put the four-line format (`#
Context`, one sentence, `## Language`, then `**Term**:` / meaning / `_Avoid_:`) in the
`.glossary/TERMS.md` intro, so 1669 stands alone. When 1668 merges main, its fix round changes
that link to `../domain-modeling/SKILL.md`. 1668's own fix round, running now, already removes
the "contexts stay in TERMS.md rows" and "one kalfa package is one context" claims that clashed
with this map.

**6. Instructions still say to search `.glossary/` for terms**, which now holds only the map:
`.agents/skills/adr/SKILL.md:105`, `.agents/skills/plan/references/design.md:111`,
`.agents/skills/lead/SKILL.md:709`, and a prompt string in `.agents/skills/lead/scripts/chain.ts:1195`.
Fix: `node .agents/skills/lead/scripts/records.ts find "<words>"`, or
`rg -il --glob 'GLOSSARY.md' '<word>'`.

**7. `records.ts` drops some terms.** `.agents/skills/lead/scripts/records.ts:365-369` splits on
blank lines and keeps a block only if it starts with `**`. A term directly under a heading with no
blank line is dropped, and so is an `_Avoid_` line after a blank line inside a term. The reviewer
showed it in a scratch clone: `find "zebra stripe dots"` printed "no overlap" for a term written
right under `## Misc`. Fix: start a term at each line matching `^\*\*[^*\n]+\*\*:` and end it at a
blank line or a `#` line; add a `format:` law for a term under a heading.

**8. Present-tense pointers into rows or sections that are gone.**
`docs/plan/tier-1.md:721` links `TERMS.md#shared-names`, a deleted section; the PR body's "no
link pointed at a section" is wrong. `next/packages/libfabrika/src/client/Keys.ts:91` cites "the
glossary's `prefix` row". Notes that state current facts about the old glossary:
`docs/direction/the-frame.md:9, 25, 156` (a Frame section),
`docs/direction/design-for-bounded-objects.md:105`, `docs/direction/summon-guidelines.md:903`,
`docs/direction/picker-guidelines.md:435`, `docs/direction/inputs-carry-their-sender.md:111`.
Fix: one line each, "the old glossary (git history at 52aebb8)", or drop the claim.

**9. "Domain word" is not defined** (`.agents/skills/review/SKILL.md:59-64`,
`.agents/skills/plan/SKILL.md:76`). Names like `Clone` (0587's example) or `scope` (0081) are not
clearly domain words. Fix: one line: a domain word names a thing the project is about, not a
library or industry term already cited in `## New names`.

**10. Wording that will rot.** `AGENTS.md:46` says "none exists yet"; drop it, the map says it.
`.agents/skills/review/SKILL.md:92` and `.agents/skills/adr/SKILL.md:152` say "glossary row";
change to "term".

**11. `.agents/skills/lead/scripts/pr/Arm.ts:51`'s `DOCS` matches path prefixes only**, so a PR
that only adds a `next/.../GLOSSARY.md` is not read as a docs PR (0544). Not broken today. Fix
when the first glossary lands, or add a basename check now.

**12. 0408 note.** "Is the term there with an `_Avoid_` line" is mechanical. 0408 lets the prose
stay until a check holds it. A glossary shape check (each term has `_Avoid_`, parseable by
`records.ts`) would also catch finding 7; that is ticket text, not a fix here.

## The three questions

- **Pointers:** `records.ts` was the only program that read the old table. `skillscheck.sh`
  passes; `kalfa/records/src/Links.test.ts:43` and `.agents/skills/lead/scripts/pr/Arm.test.ts:260`
  use the path only as a sample. One live `TERMS.md#` anchor (finding 8). About 80 other hits, in
  `docs/plan/quests/*-PLAN.md`, other plan tables, `field/`, `experiments/` and `.decisions/`,
  were counted as history: they record what a past step touched. AGENTS.md's "Know what a word
  means" row lands on the map.
- **`records.ts find`:** 35 laws before and 35 after. Only the glossary fixture, the
  `readEntries` format law and the glossary path in the ranking law changed; the ranking numbers
  are the same; nothing was skipped, loosened or deleted. Gap: no law pins `isGlossary` or the
  exclusion of TERMS.md. By hand with no `GLOSSARY.md` on main, the state right after merge,
  `find` prints decisions, notes and experiments only, exit 0, in about one second.
- **Naming rule:** no clash with `.decisions/0029-format-and-names-follow-effect.md` or
  `.decisions/0081-no-question-word-names.md`, which govern code names; "the industry's word,
  else a short everyday word" agrees with them and with `docs/direction/use-the-industrys-names.md`,
  but that note is stale (finding 2). 0587 agrees in intent and needs the amendment (finding 3).

## Checks run

| Check | Result |
|---|---|
| `nice -n 15 pnpm exec vitest run .agents/skills/lead/scripts/records.test.ts --maxWorkers=3` | 35 of 35 pass, with `CI=1` to pass the Node guard: Node here is 22, the pin is 26 |
| `sh .agents/skills/lead/scripts/skillscheck.sh` | pass |
| `pnpm lint` | green: 21 of 22 parts passed, `lint:promise-types` was killed for memory once and passed alone |
| `node kalfa/records/src/bin.ts check link` | one finding, `docs/plan/quests/full-run-cadence-PLAN.md:33`, not in this diff |
| `sh .agents/skills/lead/scripts/leakgrep.sh --commits 52aebb8..HEAD` | clean, 2 commits |
| `git merge-tree --write-tree origin/main HEAD` | clean |

## What this cannot tell us

- The laws did not run on Node 26 here; the PR body says they passed there.
- How often finding 7 bites depends on whether real glossaries put a blank line after each
  heading; the PR's fixture and 1668's example both do.
- 1668's text after its fix round and main merge; only its current branch was read.
