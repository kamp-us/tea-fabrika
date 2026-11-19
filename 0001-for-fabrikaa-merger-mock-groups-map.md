# For fabrikaa-merger: mock groups map

From the mock sweep lead (ticket 1067), session `session_01WuXcatCxxMYKFuNsoXp45L`. All of it is
about `next/` and our lint tooling. Read at origin/main `01dee99` on 2026-11-19.

## The answer

Five group pull requests, in this order. Group 1 starts now.

| Group | Slices | Waits on |
|---|---|---|
| 1 | mock-lib-top (lock only), mock-gateway-processes-telemetry (slice 2 and the lock) | nothing |
| 2 | mock-pipeline, mock-node | group 1 landed, then ticket 1184 on the lock files; PR 1638 landed (mock-node); a ruling on PRs 1458 and 1584 (mock-pipeline, below) |
| 3 | mock-node-dev, mock-node-client | group 2 (both need the pipeline's tea warning hook); a ruling on PR 1497 (mock-node-client) |
| 4 | alchemy-mocks | PR 1638 and mock-node (group 2): both change `cloudflare/runtime.ts` |
| 5 | mock-app-src (what is left of its five slices) | alchemy-mocks and mock-node-dev, which share its app test files and `node/dev/dev.ts` |

The lock files (`.oxlintrc.json`, `oxlint-plugins/plants.test.ts`, `oxlint-plugins/builtin-plants.ts`)
go to each group in turn. Ticket 1184 takes them between group 1 and group 2.

## What main or a landed slice already did

- **mock-lib-top:** its product and laws landed in PR 1526 (`Id.ts`, `Id.test.ts`,
  `Id.cause.test.ts`, `Id.types.test.ts`, `Id.test-support.ts`). Only the lock is left: no
  `no-restricted-vi-methods` block names `next/packages/libfabrika/src/*.ts` on main. The top files
  hold no banned `vi` call today.
- **mock-gateway-processes-telemetry:** slice 1 (telemetry's `Archive.ts`, the gateway's
  `WebCrypto` hashes, `telemetry/Crypto.test-support.ts`, `GatewayRevocation` and `ErrorCause`
  laws, `layer-rules.json`) landed in PR 1526. Left: slice 2, the one `vi.spyOn(crypto,
  "getRandomValues")` in `processes/ProcessIdGenerator.test.ts:151`, and the lock for
  `gateway/**`, `telemetry/**` and `processes/**`, which is not on main.
  `.patterns/effect-crypto-through-services.md:125` already says the lock holds those folders; it
  does not yet.
- **mock-app-src:** slice 1 (A1 to A4, A3b's grant no-console rule) landed in PR 1526. Slices 2,
  3, 4 and 5 are open. Monday's branches `fabrikalfa/mock-app-src-s2` and `-s5` hold work to reuse.
- **mock-pipeline:** nothing landed. Main moved tea to 0.29.0 with its own patch
  (`patches/@demlik__tea@0.29.0.patch`, PR 1619), so the plan's tea 0.27.0 patch is a hunk set to
  add to the 0.29.0 patch, keeping every hunk it has. tea's seven `console.warn` sites are still
  unpatched. Effect's `infoLines` and `debugLines` are on main already (PR 1648), so no slice
  touches `patches/effect@4.1.3.patch` or `scripts/effect-testconsole.test.ts`.
- **mock-node, mock-node-client, mock-node-dev, alchemy-mocks:** nothing landed.

## The files of each slice still to change, at main

- **mock-lib-top:** the three lock files.
- **mock-gateway-processes-telemetry:** `next/packages/libfabrika/src/processes/ProcessIdGenerator.test.ts`,
  `.patterns/effect-crypto-through-services.md`, the three lock files.
- **mock-pipeline:** `next/packages/libfabrika/src/codehost/CodeHostTest.ts`,
  `next/programs/pipeline/src/RunnerTest.ts`, `next/programs/pipeline/src/QueueRunnerTest.ts`,
  `next/programs/pipeline/src/node/runner.laws.integration.test.ts`,
  `next/programs/pipeline/src/node/queue.laws.integration.test.ts`,
  `patches/@demlik__tea@0.29.0.patch`, `pnpm-lock.yaml`, the three lock files.
- **mock-node:** `next/packages/libfabrika/src/node/RunnerAdmission.integration.test.ts`,
  `cloudflare/ProjectAuditTest.ts`, new `cloudflare/ObjectCalls.ts`, `ProcessObjectsRpc.ts`,
  `RecordObjectsRpc.ts`, `cloudflare/runtime.ts`, `cloudflare/connection.ts`, `.glossary/TERMS.md`,
  the three lock files.
- **mock-node-client:** `next/packages/libfabrika/src/client/HandsStart.ts`,
  `client/HandsStart.laws.test.ts`, `node/client/HandsSecrets.laws.test.ts`,
  `next/apps/fabrika/hands.ts`, the three lock files.
- **mock-node-dev:** new `node/dev/Signals.ts`, `internal/signals.ts`, `SignalsNode.ts`,
  `SignalsTest.ts`, `signals.test.ts`, `SignalsNode.integration.test.ts`; `local-dev.ts`, `dev.ts`
  (doc block), `watch.ts`, `local-dev.laws.test.ts`, `dev-client.test-support.ts`, the four
  `dev*.laws.integration.test.ts` and `watch.laws.integration.test.ts`;
  `next/packages/libfabrika/package.json`, `next/apps/fabrika/src/instance.ts`,
  `.glossary/TERMS.md`, the three lock files.
- **alchemy-mocks:** about 30 files: `cloudflare/box.ts`, `index.ts`, `runtime.ts`, `control.ts`,
  new `Isolates.ts` and `IsolatesAlchemy.ts`, `node/build/bundle.ts`, `next/packages/vitest/src/Stub.ts`,
  `apps/fabrika/alchemy.run.ts`, `src/instance.ts`, and the cloudflare and app laws that mock
  `cloudflare:workers` (its plan's files table), the three lock files.
- **mock-app-src, slices 2 to 5:** its plan's files table from slice 2 on, among them
  `patches/@alchemy.run__cloudflare-runtime@2.0.0-beta.85.patch`, `pnpm-lock.yaml`,
  `node/dev/dev.ts`, `gateway/GatewayNonce.ts`, `gateway/Gateway.ts`, new `gateway/InputNames.ts`,
  `cloudflare/runtime.ts`, the app's `runtime.ts`, `brain.ts`, `objects.ts`, `dev.ts`, `grant.ts`,
  `hands.ts`, new `node/build/Bundler.ts`, `build.ts`, `bundle.ts`, libfabrika's `package.json`, and
  the app laws its slices name.

## Why the groups fall this way

- Shared product files: `cloudflare/runtime.ts` (mock-node, alchemy-mocks, mock-app-src);
  `cloudflare/ProjectAuditTest.ts` (mock-node, alchemy-mocks); `apps/fabrika/src/instance.ts`
  (mock-node-dev, alchemy-mocks); `node/build/bundle.ts` and six app laws (alchemy-mocks,
  mock-app-src); `node/dev/dev.ts` and libfabrika's `package.json` (mock-node-dev, mock-app-src);
  `pnpm-lock.yaml` (mock-pipeline, mock-app-src).
- Order needs: mock-node-dev's secrets law and mock-node-client's `HandsStart.ts` set the tea
  warning hook that mock-pipeline's tea patch adds. mock-app-src's slice 4 waits on mock-node-dev.
- PR 1638 (mock-transport) changes `cloudflare/runtime.ts`, `.glossary/TERMS.md`,
  `door.integration.test.ts`, `cloudflare/connection.test.ts`, `gateway/Gateway.ts`,
  `GatewayCauseTest.ts` and `node/ErrorCause.test.ts`, so mock-node, alchemy-mocks and
  mock-app-src slice 3 wait for it. Group 1's gateway lock edits no gateway file; 1638 adds no
  banned `vi` call or `process` write there (read from its patch).

## Open pull requests on these files, and what each holds back

- **PR 1458** (draft, `fabrikalfa/pipe-s1`, last pushed 2026-11-16) changes
  `next/programs/pipeline/src/node/runner.laws.integration.test.ts` and
  `queue.laws.integration.test.ts`. mock-pipeline needs both (a 3-line and a 10-line change, as
  Monday's `fabrikalfa/mock-pipeline-s1` shows). Under one owner per file, mock-pipeline waits.
  **I need a ruling:** may group 2 take the two files and leave 1458 the merge?
- **PR 1584** (fabsh v1 S1, ready) changes `pnpm-lock.yaml` and `.oxlintrc.json`. The tea patch
  changes `pnpm-lock.yaml`'s patch hash. **Same ruling needed** for `pnpm-lock.yaml`. Its
  `.oxlintrc.json` change I treat as the lock-file turn you set, with a normal merge.
- **PR 1497** (draft, holds `oxlint-plugins/README.md`) changes `client/HandsStart.laws.test.ts`
  and `node/client/HandsSecrets.laws.test.ts`, both mock-node-client's. mock-node-client waits for
  a ruling or for 1497.
- **`.glossary/TERMS.md`** is in PRs 1638, 1584, 1514, 1458, 1312, 1305 and 1232. mock-node and
  mock-node-dev each add one row there. Unless you rule otherwise, their groups leave the row out
  and list it under "Plan corrections", and one docs pull request adds both rows later.
- No open PR touches group 1's other files (`gh api search/issues` per file, then the file lists
  of PRs 1657, 1646, 1584, 1497, 1514, 1464, 1458 and the older drafts).

## Plan corrections found so far

- mock-pipeline: the tea patch is for tea 0.29.0 now, an addition to the existing patch, and
  needs no new `pnpm-workspace.yaml` row.
- mock-pipeline, mock-node-dev, mock-node-client: the Effect `infoLines` and `debugLines` rows are
  done on main; none of them touches the Effect patch.
- mock-node: its plan's wait on pull request 1433 is historical (its own 2026-11-17 note says
  `Stub.make` is on main).
- mock-node-dev: `JournalSqlite.child.test-support.ts:41` already has its disable line (PR 1644).
- `oxlint-plugins/README.md` is held by PR 1497; any README line a group would add goes under
  "Plan corrections" in that group's PR body.

## What this map cannot tell us

- Line overlaps inside the lock files with ticket 1184; I read only which files it holds.
- Whether 1458 and 1497 are still alive; both are drafts last pushed on 2026-11-16 to 2026-11-18.
- Whether Monday's branches still apply cleanly: each builder reads its branch and reuses only
  what is right at today's main.
