# For fabrikaa-merger: 1668 review

From the review lane, session `session_01WuXcavPdDeBLJJgyEZwjM6`. One read-only review of
[PR 1668](https://github.com/kamp-us/tea-fabrika/pull/1668), branch `fabrikalfa/ddd-skills`, head
`093468a` on `origin/main` `4c2ebab`, read on 2026-11-19. This is about today's lead tooling: the
PR touches neither `next/` nor today's machines. The review ran as one subagent with the review
skill; I checked its main claims against the files before writing this.

## The answer

**Send back.** Three things must change: the MIT notice must ship, the "offer a decision sparingly"
gate goes, and the kalfa context-layout claim needs either a decision or removal. Six smaller
findings follow. Skills check, `pnpm lint` and the leak grep all pass. The branch conflicts with
main in `.agents/skills/README.md`.

## Must change

**1. The MIT notice is missing.** `.agents/skills/domain-modeling/SKILL.md:60`,
`.agents/skills/codebase-design/SKILL.md:49`, `.agents/skills/grilling/SKILL.md:24`.

- Each skill says only "Adapted from <upstream repo> (MIT license)" with a link. The upstream
  `LICENSE` is the standard MIT text with one copyright line. Neither the copyright line nor the
  permission text ships in this repo.
- The clause: "The above copyright notice and this permission notice shall be included in all
  copies or substantial portions of the Software." A link to a live repo does not "include" it.
- How much is upstream: word runs of four or more words copied exactly are 10% of domain-modeling,
  19% of codebase-design and 3% of grilling. By structure and close paraphrase about 60% of each is
  upstream: domain-modeling's glossary format, its three-test decision list and its five steps;
  codebase-design's definitions (module, interface, depth, seam, adapter, leverage, locality), the
  deletion test and "one adapter is hypothetical, two is real"; grilling's tree walk, "word it so
  yes accepts it" and "done when every branch is visited". These are close adaptations, so treat
  them as substantial portions. About 85% sure; this is a reading, not legal advice.
- Fix: add `.agents/skills/THIRD-PARTY-LICENSES.md` with the upstream copyright line and the full
  MIT permission text, unchanged, headed with the upstream repo it came from. End each skill with
  "Adapted from <upstream repo> (MIT license, [notice](../THIRD-PARTY-LICENSES.md))". Pinning the
  link to the commit adapted from is optional. The repo already does the same for vendored code in
  `vendor/anti-slop/LICENSE`. `skillscheck.sh` does not mind an extra file in that folder.

**2. The "offer a decision sparingly" gate goes against decision 0001.**
`.agents/skills/domain-modeling/SKILL.md:54-58`, and the description on line 3.

- The skill says to offer a decision only when it is hard to reverse, surprising and a real
  trade-off, and that "a missing one means no decision".
- `.decisions/0001-decisions-live-in-the-repo.md` says every owner decision lands the turn it is
  made, and `.agents/skills/adr/SKILL.md` says to record any settled rule, name, shape or yes/no,
  "even when nobody asks". An agent following this skill would drop a small settled ruling.
- Fix: delete the three-part gate. Keep "ask first whether it is only a setting (0069), then use
  the adr skill". If a screen is wanted, make it "not a setting and not already recorded".

**3. "One kalfa package is one bounded context, with its own GLOSSARY.md" has no decision.**
`.agents/skills/domain-modeling/SKILL.md:13-18` and `.glossary/TERMS.md:552-557`.

- `docs/direction/we-follow-ddd.md` (line 32) says the contexts and the map live in
  `.glossary/TERMS.md`, one section per context. `.decisions/0585-kalfa-is-six-domain-packages.md`,
  which the skill cites, does not make a package a context. As written this gives kalfa words two
  homes, against `.decisions/0130-every-piece-of-knowledge-has-one-home.md`, since `TERMS.md`
  already holds kalfa rows.
- The new "Kalfa contexts" section is an empty section that will grow by one appended line per
  package, the shared-append shape `.decisions/0522-no-folder-keeps-an-index-table.md` removed.
- **PR 1669 changes this.** The coordinator says 1669 (the glossary reset, an owner call) lands
  first, has `records.ts find` read `GLOSSARY.md` files, and replaces this section with its own
  map, so 1668 drops the section when it merges main. If 1669 records the per-package glossary
  rule, the skill's claim then stands on it, and lines 16-18 must point at 1669's map, not at
  the dropped section. If 1669 does not record it, delete the kalfa claim and say words go in the
  owning context's section.
- Fix: after 1669 lands, merge main, drop the TERMS section, and rewrite
  `domain-modeling/SKILL.md:13-20` to match 1669's layout, citing the decision 1669 records.

## Smaller findings

**4. `.agents/skills/codebase-design/SKILL.md:46-47` is wrong for kalfa.** A package's interface
is its `package.json` `exports` map (0585), not its root files. Private code lives in `internal/`
(`.decisions/0032-libraries-take-effects-file-layout.md`). `boundary-rules.json` limits which
package types may import which. Fix: say exactly that, with those two citations.

**5. Words in `.agents/skills/codebase-design/SKILL.md:15-17, 34, 43-45`.** "Module" is defined
as "a function, a Layer, a package", but `.decisions/0091-modules-and-layers.md` and the TERMS
`module` row give it a narrower meaning in `next/` (0212: one meaning in a context). "gateway" on
line 34 is a TERMS word for a real module. Fix: add "In `next/`, 'module' also means one
libfabrika folder (0091)", write Effect's `Layer` in code font, drop "gateway" from line 34, and
cite the books "deep module" and "seam" come from
(`.decisions/0587-new-helpers-and-names-cite-sources.md`).

**6. `.agents/skills/codebase-design/SKILL.md:31-32, 41-42`, "add a seam only when something
varies".** The owner settled single-provider seams up front in
`.decisions/0325-agents-behind-one-service-of-ours.md`,
`.decisions/0612-kalfa-ci-holds-the-ci-protocol-once.md`,
`.decisions/0614-kalfa-codehost-holds-the-code-host-protocol-once.md` and
`.decisions/0616-providers-are-one-package-each.md`. A reviewer using this rule could send those
back. Fix: add "a seam a decision settled is not reopened by this test; it judges new ones".

**7. `.agents/skills/codebase-design/SKILL.md:43-45` restates `kalfa/AGENTS.md`** (0130). Fix:
keep only the link and the one-line reason it hides a seam.

**8. `.agents/skills/grilling/SKILL.md:11-12, 19`.** The cite after "the answer decides which
branch comes next" points at AGENTS.md rules that do not say that; drop it. "Act only after a yes"
collides with AGENTS.md "Finish your task" if a pipeline step loads the skill. Fix: add "For a
session with the owner. A pipeline step does not grill."

**9. `.agents/skills/README.md:22-24` conflicts with main** (`git merge-tree`): both sides appended
rows after the last row, main's from #1646. Fix: resolve in the same merge as finding 3, keeping
both rows.

## The public repo rule

- The attribution link carries the upstream account name. That is a source address the license's
  attribution need supports, not a name of our own people or accounts. It is fine as written.
  `docs/plan/quests/anti-slop-install-PLAN.md:171` already rules the same for a vendored MIT
  notice: "No personal names" is about our own people and accounts, so the notice stays as
  written. That also covers the copyright line in finding 1's new file. About 90% sure.
- No other personal or account names in the diff.

## Checks run

| Check | Result |
|---|---|
| `sh .agents/skills/lead/scripts/skillscheck.sh` | pass: "15 shared skills have the correct links" |
| `pnpm lint`, after `pnpm install --frozen-lockfile` | pass, exit 0 (Node here is 22, the project asks for 26; no effect) |
| `sh .agents/skills/lead/scripts/leakgrep.sh --commits 4c2ebab..HEAD` | pass, 1 commit read |
| `git merge-tree --write-tree origin/main HEAD` | conflict in `.agents/skills/README.md` only |
| `records.ts find` on each skill's claims | hits read; the clashes are above |
| Upstream `LICENSE`, README and the three source skills | fetched by raw file path; compared |

## What this cannot tell us

- Whether the owner ruled "a kalfa package is a bounded context" outside the repo. Nothing in
  `.decisions/` says so; PR 1669 may.
- The 60% shares are a reviewer's reading, not a legal opinion; the 4-word-run shares are measured.
- The upstream GitHub contents API was refused, so only the files the skills adapt were read.
