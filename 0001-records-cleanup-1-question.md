# 0001: for fabrikaa: records-cleanup-1 question

For fabrikaa. Slice 1 of `docs/plan/quests/rules-and-records-build-PLAN.md` (records 0001 to 0049),
branch `fabrikalfa/records-cleanup-1`. Two records need a call the plan does not make. The other 33
records are being folded now; these two stay untouched until an answer comes.

## Q1: 0022, a fold or a whole reversal for slice 7?

`.decisions/0022-codex-steps-run-on-astra-at-medium.md` decides that the lead's Codex steps default
to `gpt-6-astra` at `medium`. Its own Amendments line (2026-11-11) says the model and the effort are
settings ([0069](../.decisions/0069-choices-are-settings.md)), with no decision file, and that the
default moved. Today `.agents/skills/lead/scripts/env.sh` lines 38 to 45 hold per-role defaults
(`CODEX_MODEL`, `CODEX_PLAN_MODEL`, `CODEX_BUILD_MODEL`, `CODEX_REVIEW_MODEL` and their efforts).
What is left of 0022 once the value goes to its file and key is the pricing rule for field rows
(now in `fieldrow.ts`, not `fieldrow.py`).

- **A, fold (my lean, 60%):** retitle to "the lead's Codex steps take their model and effort from
  env.sh's role settings, and a field row prices each model at its own list price", name the file
  and keys, keep the pricing rule. Status `accepted`.
- **B, reversed whole:** 0069 already reversed its why (a decision fixing a model). Hand it to
  slice 7, which marks it superseded with `successor: "0069"`, and the pricing rule needs a home.

## Q2: 0049, a fold or a whole reversal for slice 7?

`.decisions/0049-merge-behind-main-once-lint-passes-on-the-true-merge.md` decides the lead's merge
script lands a green pull request behind main once `freshmain.ts` lint passes on the true merge,
head pinned, no override flag. Its amenders: 0097 (superseded), 0116, 0146 (superseded) and 0162.
Since 0162 main takes changes only through GitHub's merge queue, which tests on newest main, so the
true-merge lint by `freshmain.ts` is no longer the check. What would be left: "a green pull request
does not catch up with main by hand; the merge is pinned to its head; no override flag".

- **A, fold (my lean, 55%):** retitle to what is left, as above, and fold 0116 and 0162.
- **B, reversed whole:** its why (lint on the true merge is the check instead of catching up) is
  replaced by 0162's queue. Slice 7 marks it superseded with `successor: "0162"`.

The plan's files row says "0012, 0032 and 0049 drop their superseded patch", which reads as A for
0049, but it was written before anyone read what the fold leaves.
