# For fabrikaa: slice 6 cannot fit

Slice 6 of the rules and records build plan (`docs/plan/quests/rules-and-records-build-PLAN.md`),
the cut of the `AGENTS.md` map to 0608's 32,768 bytes, hit the plan's hard stop. By 0129's three
moves alone, with no rule dropped, the map cannot reach the limit. The cut is not committed. This
needs the owner's call.

- Pull request: https://github.com/kamp-us/tea-fabrika/pull/1633 (draft; holds only the
  `docs/plan/README.md` fixes, 0146 to 0162 and the "where we are" line, plus the step rows)
- Branch: `fabrikalfa/records-map-cut`
- The partial cut, safe and losing no rule: `0001-slice-6-partial-cut.patch` on this mail branch,
  with its 65-row removal table, `0001-slice-6-removal-table.md`.

## The byte counts (`wc -c`)

| Read together | Before | After the partial cut | Limit | Over by |
|---|---|---|---|---|
| `AGENTS.md` | 39,370 | 36,536 | 32,768 | 3,768 |
| `AGENTS.md` + `next/AGENTS.md` | 50,301 | 41,773 | 32,768 | 9,005 |

`next/AGENTS.md` went from 10,931 to 5,237 bytes: its lint table is code-checked, and nine
decided bullets became one line and a link each. The root lost about 2,900 bytes of decided lines.

## Why the rest cannot move by the three moves

- About 8,400 bytes of the root are rules that no check, decision or folder file holds. 0129's
  flowchart keeps such a rule in the map.
- Several decided rules keep details that only a direction note holds, and 0130 says a direction
  note is no home, so those details stay.
- Five lines (about 1,940 bytes) are ones 0525 says change in the lane that builds the freeze
  guard, so this slice leaves them as written.
- Link paths alone are about 6,600 bytes of the pair (143 links).
- The safe moves the build left (Money, the `rg` tool facts and the shot recipe, to a how-to, and
  the direction-note trims) are worth about 2,100 bytes. With them the pair is still about 6,900
  over.

## The smallest set of rules that would have to go or get a new home

About 6,900 bytes after the safe moves, from these groups (the build's estimates, by the tests
step's 193-row worklist):

| Group | Bytes | What it holds |
|---|---|---|
| The five lines 0525 marks for another lane | about 1,940 | "In today's version" fixes and UX work; a product foundation starts on today's app at once; the "Change the machines (today's version)" row; the `pnpm build` line; "Pick the look before the PR" |
| "Changing the product", rules with no home | about 1,860 | the daily moment first; secure and simple; no new paid accounts; "like Tuval"; mockups use the real thing; ask how Linear would do it, and Linear as the builder |
| "Before you design anything", rules with no home | about 1,610 | tea stays small; judge a design by its properties; judge an idea against the plan; solve a problem we have; moving a job from an agent to code; the section's intro |
| "Finish your task" | about 1,145 | finish the whole task; stop only for a real blocker; what needs no approval; a problem seen twice gets its root cause and a ticket |
| "How to write here", rules with no home | about 640 | show it in code; one table per section; and the rest of that list |

All five groups together are about 7,195 bytes, so nearly every one of them has to leave the map.

## The choices, as the lead sees them

1. **Record the homeless groups as decisions** (about four `/adr` records, plus a ruling on
   0525's five lines), then each becomes one line and a link (0129's second move). This keeps
   0129 as written. The lead's lean, about 70%: it is the move 0129 already names.
2. **Let a rule move to the skill or how-to read for its job,** with a pointer left in the map:
   "Before you design anything" to the plan skill, "Changing the product" to a new how-to. This
   changes 0129's three moves, so it is the owner's call. It is quicker, but a rule read only when
   an agent opens that skill is easier to miss.
3. **Name rules that go.** The lead recommends none.

0608 says the limit changes only with a new source, so raising it is not on the list.

This session waits for the call and does not commit the cut before it.
