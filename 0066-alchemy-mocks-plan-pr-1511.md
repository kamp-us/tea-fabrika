# 0066: the 0042 Alchemy mocks plan is up: PR 1511

https://github.com/kamp-us/tea-fabrika/pull/1511 is on `fabrikalfa/alchemy-mocks-plan`, at
`61f7b25` for now. A last small commit is coming, which makes A5's slice a normal one, since you
said yes.

**A5 (slice 4)** covers the spy at `next/apps/fabrika/src/instance-one-file.integration.test.ts:441`.

- **The cause:** `workerLoader` (`cloudflare/index.ts:89`) takes the raw ambient `WorkerLoader`,
  which goes around Alchemy. By 0042, it goes through Alchemy first.
- **Alchemy has the same generic:** in beta.85, `WorkerStub.getEntrypoint<Shape = unknown>`
  (`src/Workers/WorkerLoader.ts:33-44`). So a stand-in of Alchemy's stub would hit the same typing
  problem.
- **The fix:** the plan adds a monomorphic `Isolates` service:
  `open(key, code) -> Effect<IsolateCalls, ProgramDown>`.
  - Its contract is in `cloudflare/Isolates.ts`.
  - Its live layer is in `IsolatesAlchemy.ts`, over Alchemy's `Cloudflare.WorkerLoader`. That live
    layer is the one place `getEntrypoint<IsolateCalls>()` is named.
  - A5 then uses `Recorder.layer(Isolates, { open: ... })`, with no generic, no spy and no cast:
    law W1, with three plants.
- **Five more test callers of `workerLoader`,** none of them `vi` hits, are touched too:
  `index.test.ts:18`, `tail.test.ts:148`, `error-cause.test.ts:143` and `:162`, and
  `IsolateUsage.integration.test.ts:214`.
- **Size:** 43 product lines, 3 steps, about $11.
- **Doubt (70%):** can Alchemy's `WorkerLoader` be built from the brain's `env.LOADER` before
  0042's port? If not, the live layer wraps the raw binding at one marked edge, and the law stays
  as planned.

**Version note:**

- `next/` declares `@cloudflare/workers-types` 5.20261027.1, not the 5.20261109.1 that the app-src
  tests step quoted. The lockfile has both versions.
- The plan job did not reproduce the TS2322 and TS2589 errors itself.
- A5's typing does not depend on which version is in use, since the plan removes the generic stub
  from the law.

**For the merge session:**

1. Sign PR 1511 once its last commit lands.
2. Re-sign the app-src plan once group 3 pushes the A5 move.

The plan's own body says what else it covers: the 7 cloudflare, 1 node-dev, 3 app-src
`cloudflare:workers` mocks and 4 Alchemy mocks, and the waiting lock laws (cloudflare M11, app-src
A6 and A8, node-dev M1).
