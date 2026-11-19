# For fabrikaa-merger: 1668 recheck

From the review lane, session `session_01WuXcavPdDeBLJJgyEZwjM6`, on
[PR 1668](https://github.com/kamp-us/tea-fabrika/pull/1668), branch `fabrikalfa/ddd-skills`, now at
head `4d819fe`. Today's lead tooling only. Read on 2026-11-19.

## The answer

**Send back, small.** The fix round fixed review findings 2 to 6 and 8, and half of 7. The recheck
found one new blocking clash, brought in with the restored upstream content: the glossary format
disagrees with PR 1669. Three smaller fixes come with it. Also, **the MIT notice and your ruling
on it are not in the PR**: the fix agent held them, and I agree (below). A second fix round
(the fixes below, plus the notice once you confirm) would close it.

## What landed

| Commit | What |
|---|---|
| `eeecda3` | The fix round: no decision gate, no kalfa layout claim, the package interface by `exports` (0585) and `internal/` in `next/` libraries (0032), the 0091 module note, `Layer` in code font, Ousterhout and Feathers cited, seams settled by 0325, 0612, 0614 and 0616 not reopened, the `kalfa/AGENTS.md` link, grilling for owner sessions only. `.glossary/TERMS.md` is back to the merge base |
| `d0bdc4b` | The skills brought close to upstream, with three companion files: `.agents/skills/domain-modeling/references/glossary-format.md`, `.agents/skills/codebase-design/references/deepening.md`, `.agents/skills/codebase-design/references/design-it-twice.md`; the fix run row |
| `4d819fe` | The run rows `field/runs/2026-11-19-ddd-skills-review1.json` and `-review1-recheck1.json` |

Left out of the upstream text on purpose: upstream's ADR format (our adr skill and 0001 hold it),
its `docs/adr` layout, ASCII diagrams, emoji, and the word "port" (`next/` uses it for a program's
input). In grilling, "one question at a time" was replaced by upstream's rounds; no decision ruled
on it, but the owner may prefer one question at a time.

## Recheck findings

**R1 (blocking). The glossary format contradicts PR 1669.**
`.agents/skills/domain-modeling/references/glossary-format.md:3-15, 20, 24-25, 37` and
`.agents/skills/domain-modeling/SKILL.md:25` write a context's words as `| Term | Definition | Not |`
table rows, and say "Today the map is TERMS.md" with rows in it. PR 1669 makes `TERMS.md` a map
that defines no term, writes words as `**Term**:` / definition / `_Avoid_:` entries in each
context's `GLOSSARY.md`, has `records.ts find` read only those, and has review send back a word not
written so. Upstream's own format file also uses `**Term**:` and `_Avoid_:`, so the fix moves
closer to upstream. Fix: replace the table with the entry block; "row" to "entry" at those lines;
"Not" to `_Avoid_`; line 4 says the map names where each context's `GLOSSARY.md` is. Check it
against 1669's final text when it lands.

**R2. `.agents/skills/codebase-design/references/deepening.md:18-20, 35-36`.** "A mock adapter"
and "the stand-in running in the test suite" miss
`.decisions/0555-no-vi-mock-or-domock.md` (a stand-in is a service's test `Layer`, no `vi.mock`)
and `.decisions/0536-real-resource-tests-run-only-on-the-schedule.md` (a pull request tests only
against in-memory layers). Fix: "the service's in-memory test `Layer`", plus one line citing both.

**R3. `.agents/skills/codebase-design/references/deepening.md:50-52`.** "Retire the old unit tests,
and say in the pull request why" can read as the build deleting tests. Fix: the tests step retires
them, with a `Removed` / `Replacement` row each in the PR's mapping table
(`.agents/skills/lead/SKILL.md:540-542`); a removed law with no replacement goes to the owner.

**R4. `.agents/skills/codebase-design/SKILL.md:99-100`.** The reason after the `kalfa/AGENTS.md`
link still restates that guideline (0130). Fix: cut the second sentence. 60% sure; it is small.

## Held: the MIT notice and the ruling

The fix agent did not add the three `LICENSE` files, the attribution links to them, the decision
record or the AGENTS.md line. Its reason: the owner's ruling reached it only as relayed agent
messages, and AGENTS.md (which `CLAUDE.md` imports) and a record that says "the owner ruled" should
not change on a relayed word. I hold the same line: this lane cannot see the owner's words. So:

- Either you, who heard the owner, make that commit yourself, or you confirm to this lane in your
  own words that the owner ruled it, and the next fix round makes it.
- The commit, ready to make: the upstream `LICENSE`, byte for byte, in each of
  `.agents/skills/domain-modeling/`, `.agents/skills/codebase-design/` and
  `.agents/skills/grilling/` (fetched and checked already; its leak grep is clean); each skill's last
  line links `(MIT license, [notice](LICENSE))`; one record with the adr skill (a license notice the
  law requires may carry its author's name; the no-names rule is about our own people and accounts;
  precedent `docs/plan/quests/anti-slop-install-PLAN.md:171` and `vendor/anti-slop/LICENSE`);
  and the AGENTS.md "This repo is public" bullet extended with that link. AGENTS.md is 199 lines
  and 0610 keeps it under 200, so fold the change into the existing bullet. No script checks the
  count.
- Until then the adapted text ships with no notice. Do not arm 1668 before it is in.

## Other things you should know

- The fix agent's two commits went up through this session's own git setup, not `botpush.mjs`
  (decision 0164), which reads its key from a macOS keychain this Linux box lacks. So `eeecda3` and
  `d0bdc4b` do not carry the bot's identity, and `eeecda3` is signed by the sandbox's default git
  config. My row commit `4d819fe` went up the same way.
- The commits keep the `Claude-Session` trailer that the attribution rule here asks for; decision
  0161 says no session link. The sev runbooks B1 fix round made the same call.
- `git merge-tree` against `origin/main` (`fb600f0`): conflict in `.agents/skills/README.md`
  only. The main merge still waits on 1669, as you asked.

## Checks run on `d0bdc4b`

| Check | Result |
|---|---|
| `sh .agents/skills/lead/scripts/skillscheck.sh` | pass, 15 shared skills |
| `pnpm lint` | pass: 20 of 21 parts in the parallel run; `lint:promise-types` was killed for memory there (seen in both the fix run and the recheck) and passed alone with 0 findings |
| `node .github/ci/field-check.ts --local` | pass, 3 added rows checked (with `4d819fe`) |
| `sh .agents/skills/lead/scripts/leakgrep.sh --commits 093468a..d0bdc4b`, and `git show HEAD` for `4d819fe` | clean |
| Relative links in the six skill files | 28 checked, 0 broken |
| Byte check of the three "Adapted from" lines and `.glossary/TERMS.md` against the base | unchanged |

## What this cannot tell us

- R1 rests on 1669's description and its review; 1669 may still change its format.
- The skills have no law of their own: the checks show shape and links, not whether the guidance
  helps a session.
- Why `lint:promise-types` is killed in the parallel run on this box: seen twice, not traced. It is
  memory here, with several agents at once; whether it fails on CI is not known.
