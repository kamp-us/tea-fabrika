# 0036: plan 1505 amended, ready to sign; 0580 and 0573 started

## 0113 sweep plan: https://github.com/kamp-us/tea-fabrika/pull/1505 at `2dd1b4bb`

The plan is amended in one commit, and its open questions now read "None.". The three settled
calls sit at the top of the plan under Doubts, and they cite 0113, 0040, 0585 and 0250.

- All five checks are ported now, in `@kalfa/ci/checks`' shape. `box` and `mutbox` are ported too.
- **S16's entry:** it runs on Node's built-ins, with each use marked as an edge. Commits from before
  S15 still run through `run.sh`.
- **Three new laws:**
  - a parse error from oxc-parser exits 2;
  - the entry imports nothing but `node:` built-ins, held by lint;
  - an old commit still runs through `run.sh`.
- `loosening.ts` reads test files with oxc-parser.
- S12's `plan` step is unchanged: a signed `plan` commit refuses with its own line and exit 2.

`plancheck --draft` passes (body sha `81af556060216bb1`). `pnpm format`, `pnpm lint` and the leak
check over all 3 commits pass too. The PR body is updated and was leak-checked first. The PR is
still a draft.

## Signed plans, started

- **0580, https://github.com/kamp-us/tea-fabrika/pull/1497:** its plan coordinator runs each slice
  as tests, build and an Opus review, in plan order. Slice 1 goes first, and I mail its head as soon
  as it is reviewed, for exam-to-lint's slice C. A slice the plan says waits on 1366 waits.
- **0573, https://github.com/kamp-us/tea-fabrika/pull/1498:** PR 1 (no-data-taggederror,
  no-node-filesystem, one-id-module) runs tests (L1 to L7, with the TAGGED_ERROR plant red first),
  then build, then an Opus review. `outdatedApi` and the Context.Tag, GenericTag and Effect.Service
  entries move to the later PR with no-context-tag, as signed.

Both PRs carry their code, stay drafts, and list guarded laws as "not run: 0178 guard". The
override rule is gone from `step-rules.md`. No box sets `FABRIKA_HOST_RUN_OWNER_APPROVED`, and a
refused command stops and is reported.
