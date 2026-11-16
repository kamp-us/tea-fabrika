> **Owner ruling, overrides anything below:** open NO pull request; push to your branch only. Your
> report goes in your field row and RESULT. See `step-rules.md`, "Pull request".

# Tests step for one judgment slice of the Effect-checker sweep

Ticket 1075, in `next/` and our tooling. Owner ruling: a judgment slice works on its own branch, opens NO pull
request (an integrator folds it into `fabrikalfa/effect-judgment`), and **fixes code only and adds no lock line** (no tsconfig `overrides` entry, nothing in
`tsconfig.base.json`, no `LOCKED` row); all judgment locks come later in one small PR. It keeps its
steps: this tests step, a build step for product files, and one Opus review.

Plan: `docs/plan/quests/effect-sweep-PLAN.md` on `origin/fabrikalfa/effect-sweep` (PR 1412), your
row, "Judgment" and "What this cannot tell us". Decisions 0565, 0524, and for `schemaSync` 0576
(a ledger step stays a plain function and uses `Schema.decodeUnknownResult` / `encodeResult` and
handles the failure, never `runSync`, never a throw or bare default to quiet the check). Read
`node_modules/effect/AGENTS.md` and the installed `node_modules/effect/src/Array.ts`, `String.ts`,
`Record.ts` before you change a call: `Arr.findFirst` answers an `Option`, `Arr.sort` takes an
`Order`, the string helpers take the string last. Use the tests skill.

1. **Count** your check over the folders of your row, with only your check at `error` through an
   `--lspconfig` (the plan's "How I counted"); nothing is written to a tsconfig. Split hits into
   exam paths (`exam-paths.json`), product files, and PR 1366's files (never touched; listed).
2. **Fix every hit in exam paths** in your row's folders, by the step rules' "Fixes". Each hit is
   a choice: keep what the code answers. Where a change reaches a caller (an `Option` in place of
   `undefined`), follow it to the callers in the same change. If a caller sits in another slice's
   folder or in a 1366 file, or the right fix is not clear, leave that hit and list it.
3. **Laws.** Where a fix changes a value's shape that a law reads, the law is updated with it and
   still asserts the same behavior. Never delete or narrow an assertion; never loosen a law.
4. `pnpm format`, `pnpm lint` (with `NODE_OPTIONS=--max-old-space-size=6144`), the narrow tests of
   every file you touched and every `.integration.` law they reach, and a recount.
5. Commit as step `tests` (ticket 1075) and push to your slice branch. Open NO pull request and
   update none. Your field row and RESULT carry the per-check report: hits met, fixed and by which
   tool, left with file:line and why, waiting on 1366, which product hits are left for the build,
   and the tests that ran at which head.
6. RESULT: `build_needed: yes` if product hits remain.
