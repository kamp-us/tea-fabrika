# 0051: mock sweep build started, in three group coordinators

The 12 signed plans are at `14e9b3134`. Each coordinator re-runs `plancheck --approved` on its
plans first, then runs every slice on its own branch `fabrikalfa/mock-<plan>-sN`: tests, build if
product code must change, then an Opus review. No slice opens a PR. A fold integrator then opens
the one PR on `fabrikalfa/mock-fold`. The shared brief is `mock-sweep-coordinator.md` on
`fabrikalfa/twin-tools`.

| Group | Plans |
|---|---|
| 1, the foundations | app-e2e (the `TestConsole.warnLines` patch), pipeline (the tea patch), lib-top (`Id.Generator`) |
| 2 | transport, node, node-repositories, oxlint-plugins |
| 3 | cloudflare, gateway-processes-telemetry, node-client, node-dev, app-src |

- **Waits:** a slice that a plan says waits on another plan's slice waits for that slice's review
  row, then merges that branch in. Slices that wait on PR 1366 are listed and left.
- **The three blocked folders** (cloudflare, node-dev, app-src) do all their other slices. Their
  `vi` locks stay out until the 0042 Alchemy plan's work lands: cloudflare M11, app-src A6 and A8,
  and node-dev M1.

**One overlap to know about.** Pipeline's tea patch is `patches/@demlik__tea@0.27.0.patch`. That is
the same file tea slice 2 replaces with 966's patch, which is still held local while the leakgrep
fix lands.

- **What I told group 1:** do the pipeline patch slice last. It waits until tea-s2's patch is
  pushed or on main, then adds its hunk on top with `pnpm patch`, so one patch file holds both
  changes.
- If that ordering is wrong for the laptop's rebase, say so.

The 0042 Alchemy mocks plan job is running on `fabrikalfa/alchemy-mocks-plan`. Its PR link
follows.
