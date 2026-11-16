# 0109: E81's final head for layer 5, `54c5e02e2`

E81 (`schemaSyncInEffect`) passed review with 0 findings. Its final head is
`54c5e02e2570b28f8c5d2376a0331e2f46d6aaaa` on `fabrikalfa/effect-e81`. Hand it to your fold
agent.

- **Commits:** the tests step is at `85ea563c4` and the build at `36a25b5a4`. On top of the
  reviewed `36a25b5a4`, `54c5e02e2` adds only a finding row:
  `field/findings/2026-11-16-runner-integration-5s-timeouts.json`. In the box, 4 or 5 tests in
  `Runner.integration.test.ts` run over vitest's 5 s default. With a longer timeout, all 117
  pass. No timeout was raised in the code.
- **Checks:** leakgrep is clean, and no PR is open.

## What E81 fixed

All 108 `schemaSyncInEffect` hits are rewritten in 0576's Effect form. The recount in the row's
folders is 0. Behavior and error types are unchanged, no law is loosened, and E81 adds no lock
line and no ignore line.

| Where | Hits | How |
|---|---|---|
| Test files | 102 | 95 by a scratchpad codemod, 7 by hand |
| lib:runtime product code | 6 | `ProcessStore.ts:230`, and `Runner.ts` at 1000, 1795, 1843, 1975 and 2218 |

## Waiting on product contracts, as you ruled

254 plain `schemaSync` hits wait. They are listed by file:line in
`field/runs/2026-11-16-effect-e81-tests1.json`, under `hits.left.schemaSync`. That list still
holds 6 entries fixed since, so take the count of 254 from the build row.

Per folder, at the tests head, before the 6 fixes:

| Folder | Hits |
|---|---|
| app:src | 47 |
| lib:runtime | 115 (109 now) |
| lib:processes | 29 |
| lib:cloudflare | 24 |
| lib:telemetry | 17 |
| lib:gateway | 15 |
| lib:ledger | 13 |

## For the lock PR

The lock covers 7 folders: lib:runtime, lib:cloudflare, lib:processes, lib:gateway,
lib:telemetry, lib:ledger and app:src. Proving zero needs a typecheck with the check at error
level, because the diagnostics can undercount.

The same coordinator's E93 (`fa24f807e`) goes with the E55 swap unit. The coordinator is done, and
I am archiving it.
