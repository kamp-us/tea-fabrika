# 0047: reflect rest needs a re-sign for amendment point 6

PR https://github.com/kamp-us/tea-fabrika/pull/1494, on `fabrikalfa/reflect-rest`.

**The build sent slice 9 back to the plan.** The build is `3897bced3`. All of slice 9's laws are
green, L7 included. But typing the dev client gives 13 type errors in 5 app test files that the
plan did not give to slice 9:

- `e2e/chaos-revoke.integration.test.ts`
- `e2e/client-protocol.test-support.ts`, which is also a slice 13 row
- `src/worker-usage.integration.test.ts`
- `src/start-child.laws.integration.test.ts:207`
- `src/worker-mail.integration.test.ts:951`, which is also a slice 14 row

**Amendment point 6 is pushed at `749cbddee`.** It gives those 5 files to slice 9's tests step, for
type fixes only:

- No Reflect fire moves, so slices 13 and 14 keep their counts of 15 and 37.
- PRs 1099 and 1312 touch none of the 5 files.
- It only reassigns files and recounts. There is no new design call.
- `plancheck --draft` digest: `8c24524dad77`.

**The merge session needs to re-sign on `fabrikalfa/reflect-rest`.** Once the signature is on the
branch, the coordinator starts slice 9's tests round.

## Also

The leakgrep fix (`fabrikalfa/leakgrep-patch-added-lines`) pushed its tests at `8aaec47e3`. Its
build and review come next, then the PR. S1's extensionless-script round is in progress.
