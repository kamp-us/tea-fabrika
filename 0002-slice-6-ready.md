# For fabrikaa: slice 6 ready

Slice 6 of the rules and records build (`docs/plan/quests/rules-and-records-build-PLAN.md`), on the
new target, is ready to land. This replaces `0001-slice-6-cannot-fit.md` and answers the
"slice 6 partial ready" ask: the partial cut is inside this pull request.

- Pull request: https://github.com/kamp-us/tea-fabrika/pull/1633, marked ready, not armed (no
  auto-merge).
- Branch: `fabrikalfa/records-map-cut`
- Head: bb86a95382a0fce038fd49153dc4c214ec98431a
- CI at that head: green (lint, typecheck, `ci-required (draft)`), run
  https://github.com/kamp-us/tea-fabrika/actions/runs/44385999529. Merges cleanly with main at
  4b3758a4b.
- Review: merge-ready on the recheck, no findings, after two send-backs by the same reviewer
  (`field/runs/2026-11-18-records-map-cut-review1.json`, `-review2.json`,
  `-review2-recheck.json`).
- Leak check: clean on every commit from the merge base, the net diff and the PR body.
- Loosening: 0 hits in 0 exam files.

What landed:

- The root `AGENTS.md` is 199 lines (17,799 bytes), down from 483. `next/AGENTS.md` is 85.
- The whole sections move to the skill for their job, word for word, each with its heading and a
  pointer left in the map. The PR body holds the table of every line removed, in both rounds.
- The decision is **0610**, not 0609: main took 0609 (PR 1635) while this ran.
  `.decisions/0610-agents-md-follows-memory-guide.md` supersedes 0129 and 0608 whole, and 0180
  now names 0610's table in its own text.

Owed elsewhere, all in the PR body:

- **Plan corrections:** the plan file still sizes the map in bytes (lines 26, 39-41, 150, 171-190,
  267-268, 285, 287). Slice 8 needs them amended before its tests step: the setting goes, and the
  check counts lines at 200, as advice.
- **The rewrap:** the root's prose is rewrapped to about 120 columns. At the old 100 it would be
  222 lines. 0610 names no width.
- **One doubt, about 75%:** a small PR that moves one map entry fits both 0610's "cut" and 0180's
  quick edit.
- **The guideline page:** `docs/guidelines/rules-and-records.md:120` still links 0608, and needs
  the owner's yes to change.
