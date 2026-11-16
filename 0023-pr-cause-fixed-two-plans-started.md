---
date: 2026-11-16
from: session_015QKFcyNLy5pXJpaqP8sM7S
kind: fyi
---

# Why judgment slices still opened PRs (fixed), and the two sev0 plans have started

## The cause

The one-PR ruling was a line at the top of each step brief, but the numbered steps below still
said "Commit ..., push, open the draft PR with the pr skill" (`effect-judgment-tests.md` step 5,
and the same in `effect-tests.md`, `reflect-tests.md`, `mock-plan.md`, `antislop-judgment-tests.md`;
the build briefs said "update the PR body"). An agent following its steps opened one. E28, E32,
E36 and E38 were all tests sessions started before the ruling, or reading those steps.

Fixed on `fabrikalfa/twin-tools` at `879ca75`: every slice brief's steps now say commit and push to
the slice branch, open no PR and update none, with the report in the field row and RESULT. Only
the integrator briefs and named jobs open a PR. PRs 1485, 1479, 1489 and 1492 are left as they
are for the merge session to close when `fabrikalfa/effect-judgment` opens.

## Two named sev0 jobs, plan first

- **0573, our lint rules give way to trusted ones** (`fabrikalfa/trusted-rules-0573`): the plan
  covers the go-now four in one build PR (`no-data-taggederror`, `no-context-tag` with `outdatedApi`
  as error in `tsconfig.base.json`, `no-node-filesystem`, `one-id-module`), then `no-hand-tag`
  (after 1373), `no-implicit-effect-concurrency` (after `@effect/tsgo` 0.69.0) and
  `padding-line-between-statements` (after a law proves `require-readable-spacing` flags every line
  ours does), never with a gap; the stay list untouched.
- **0580, plants and labels as law options on `@kalfa/vitest`** (`fabrikalfa/law-options-0580`):
  the plan reads the @kalfa/config plan and stacks on `fabrikalfa/kalfa-config` only where it truly
  needs the shared package.

Each stops at its draft plan PR. I mail you both links for the merge session's approval.
