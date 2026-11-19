# For fabrikaa-merger: mock group 2 paused

From the mock sweep lead (ticket 1067), session `session_01WuXcatCxxMYKFuNsoXp45L`. All of it is
about `next/` and our lint tooling.

## The answer

Group 2 (mock-pipeline and mock-node) is paused in its build step. It is pushed as a draft pull
request with no ready mark:

- Pull request: https://github.com/kamp-us/tea-fabrika/pull/1673
- Branch `fabrikalfa/mock-group-2`, head `857b8d1f5dbcf568e532e3889cd12012a1c51a62`, cut from main
  `892d7b74e`. Not merged with main since.
- The builder was stopped at a clean point. No agent of the sweep is running, and no new group has
  started.

## What is on the branch

- `3b54e6a3f`, mock-pipeline:
  - `codehost/CodeHostTest.ts` keeps the scripted code host's calls in a Recorder.
  - `RunnerTest.ts`, `QueueRunnerTest.ts` and the two pipeline integration laws read those calls by
    method.
  - S2 reads Effect's `TestConsole`.
- `28362427a`, mock-node:
  - New `cloudflare/ObjectCalls.ts` (contract only), `ProcessObjectsRpc.ts` and `RecordObjectsRpc.ts`.
  - `cloudflare/runtime.ts` and `connection.ts` call the objects through those services.
  - `ProjectAuditTest.ts` and the `RunnerAdmission` law record them with a Recorder in place of
    four `vi.fn`.
- `857b8d1f5`, work in progress, committed by the lead at the pause: S2's tea warning hook in
  `QueueRunnerTest.ts`. It imports `setWarn`, which only the held tea patch adds, so this commit does
  not typecheck until that patch lands.

## What is held, not applied

- The changes to the five held files, as one patch: `0002-mock-group-2-held.patch` (473 lines), on
  this mail branch. They are:
  - `.oxlintrc.json`, `oxlint-plugins/plants.test.ts` and `oxlint-plugins/builtin-plants.ts`: both
    slices' `vi` lock blocks and plants.
  - `patches/@demlik__tea@0.29.0.patch`: tea's warning hook.
  - `pnpm-lock.yaml`: the patch's new hash.
- The same changes stay uncommitted in the local worktree.
- **PR 1663 has landed since** (`a603885e0`). So the patch's `pnpm-lock.yaml` hunk is stale against
  main. On restart, the branch merges main, then the lockfile hash is made again with
  `pnpm patch-commit`, not applied from the patch.
- `.glossary/TERMS.md` was not touched. PR 1669 holds it, so mock-node's two rows
  (`ProcessObjects`, `RecordObjects`) are owed.

## What is left on restart

- The builder's run row, plants record and checks were not reached: no `field/runs` row exists for
  group 2 yet.
- The lock files are taken once R10 frees them. The lockfile is free now that 1663 has landed.
- Then one opus review, the fix round if any, CI, and the ready mail.

## What this cannot tell us

- Whether the two build commits pass the narrow checks: the builder was stopped before its report.
  The draft's own CI lint and typecheck will show it for the first two commits, and the third is
  expected red on typecheck.
