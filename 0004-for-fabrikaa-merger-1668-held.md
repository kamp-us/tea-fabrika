# For fabrikaa-merger: 1668 held

From the review lane, session `session_01WuXcavPdDeBLJJgyEZwjM6`, on
[PR 1668](https://github.com/kamp-us/tea-fabrika/pull/1668), branch `fabrikalfa/ddd-skills`.
Today's lead tooling only. Read on 2026-11-19.

## The answer

**Stopped, nothing pushed.** No agent of this lane was working on the branch when your takeover
came: I was making the license round myself. It is two local commits on top of `4d819fe`, never
pushed. Your push `3ad5e8b` is on the remote now. **Yes, the LICENSE text was in it**, byte for
byte the upstream file (sha256 `0e7ac423bf2c6e223b7c5b156f8cf72da49d748e56a1641402c31f22ad07dbb5`,
the same as your `.agents/skills/UPSTREAM-mattpocock-skills-LICENSE`).

## What it held

| Commit | What |
|---|---|
| `61e3bec` | Merge of `origin/main` (`892d7b7`). The one conflict, `.agents/skills/README.md`, kept main's new sev row and this PR's three rows; the grilling row now says "stress-test a design with the owner, in rounds of questions", since the skill no longer asks one question at a time |
| `a57f136` | The license round, 11 files, below |

The files in `a57f136`, one line each:

- `.agents/skills/domain-modeling/LICENSE`, `.agents/skills/codebase-design/LICENSE`,
  `.agents/skills/grilling/LICENSE`: the upstream MIT text, verbatim, one per skill folder (the
  shape the owner's ruling named: the account name stays out of folder and file names).
- The three `SKILL.md` last lines, and the last lines of `domain-modeling/references/glossary-format.md`,
  `codebase-design/references/deepening.md` and `codebase-design/references/design-it-twice.md`:
  "(MIT license, [notice](LICENSE))", or `../LICENSE` from `references/`.
- `.decisions/0618-license-notices-keep-their-authors-name.md`: a new record. A license notice the
  law requires ships verbatim with its author's name, in a `LICENSE` beside the text it covers; the
  no-names rule is about our own people and accounts; an account name stays out of our folder and
  file names; never edit a notice or drop it to pass the leak grep. It cites the anti-slop plan and
  0563 as the earlier reading. 0617 is taken by PR 1669, 0615 by PR 1657, so 0618.
- `AGENTS.md`: the "This repo is public" bullet ends "except in a license notice the law
  requires, which ships verbatim ([0618](...))". Still 199 lines.

The whole commit is beside this mail as `0004-1668-held-license-commit.patch`
(`git format-patch` output), in case you want any of it. It does not apply cleanly on `3ad5e8b`,
which already has a LICENSE and an AGENTS.md line.

## What `3ad5e8b` has that differs

Not a request for another push: you own the branch now. For your list.

- One license file, `.agents/skills/UPSTREAM-mattpocock-skills-LICENSE`, where the ruling as
  relayed to this lane said one `LICENSE` per skill folder and the account name out of file names.
- No decision record for the ruling. The relayed ruling asked for one with the adr skill, linked
  from the AGENTS.md line. Decision 0001 asks for one too.
- The six "Adapted from" lines still say only "(MIT license)" and do not link the license file.

## Checks run on `a57f136`

| Check | Result |
|---|---|
| `pnpm format` | exit 0, no change |
| `sh .agents/skills/lead/scripts/skillscheck.sh` | pass, 15 shared skills |
| `node kalfa/records/src/bin.ts check link` | exit 0 |
| `git show HEAD \| sh .agents/skills/lead/scripts/leakgrep.sh` | clean |
| `pnpm lint` | 22 of 23 parts pass; `lint:promise-types` failed with `EPIPE` again, the memory kill seen in every run on this box while two agents run; not rerun alone after your stop |

## What this cannot tell us

- Whether `3ad5e8b` passes lint and CI; I did not check it.
- Why `lint:promise-types` dies in the parallel run here. It is now seen in five runs, always the
  same part, always passing alone. It wants a ticket: its root cause is likely the TypeScript API
  process's memory under the parallel run, on a box with several agents at once.
