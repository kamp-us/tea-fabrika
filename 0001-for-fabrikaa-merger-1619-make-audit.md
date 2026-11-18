# For fabrikaa-merger: 1619 make audit

Pull request: https://github.com/kamp-us/tea-fabrika/pull/1651, branch `fabrikalfa/audit-1619-make`, head `3630eee6590195a8bff67e4a0b9aeef2df65dcca`. It holds only rows: 25 finding rows and one run row. It is a draft now. I mark it ready when lint and CI are green, and I never arm it. All of this is about `next/`, read at origin/main `0dc333d73b6c146e3f7f3e6edba9473da09f471a`.

**The answer:** 25 untrusted calls, 147 trusted, 3 unsure. At none of them did #1619 remove a decode. Every old line was a plain object passed to `applyCell`, `send` or `dispatch`, and none of those decode, so none of these is the TasksLedger shape. The one real regression shape is in the runner: the new outer `make` throws a defect before `send`'s `Effect.try` (`Runner.ts:771-774`) could turn a bad field into a typed `bad_row`.

## Files read and calls judged

- **Scope.** #1619 (c203a382d) added 1,406 lines in `next/` that carry a `make` or `makeEffect` call.
- **Test files: 1,231 lines in 140 files.** These are `*.test.ts`, `*.test-support.ts` and the `*Test.ts` fakes. I judged them trusted as a class: the values are the tests' own literals and generated cells, mostly `Tag.cases.x.make({})`.
- **Product files: 175 lines in 29 files,** leaving out `TasksLedger.ts`. I judged each one at today's line, after tracing its value back to where it comes from. Three read-only subagents (opus, high) split the files by area, and I checked every untrusted claim against the source.
  - Under `next/packages/libfabrika/src/`: `access/AccessFold.ts`, `client/HandsMachine.ts`, `client/WindowMachine.ts`, `client/internal/dial.ts`, `cloudflare/runtime.ts`, `desktop/BrainLife.ts`, `desktop/BrainServiceManaged.ts`, `gateway/Gateway.ts`, `gateway/RateLimiterSql.ts`, `mcp/Tools.ts`, `node/dev/dev.ts`, `node/dev/local-dev.ts`, `node/dev/watch.ts`, `node/repositories/OpenRepository.ts`, `permissions/internal/relationsTable.ts`, `processes/Process.ts`, `processes/QuotasSql.ts`, `runtime/Program.ts`, `runtime/RepliesSql.ts`, `runtime/Runner.ts`, `runtime/WatchersSql.ts`, `telemetry/Sink.ts`, `transport/Connection.ts`, `transport/Link.ts`.
  - Elsewhere in `next/`: `next/packages/tuval/src/window/main.tsx`, `next/programs/checklist/src/tile.ts`, `next/programs/checklist/src/window.tsx`, `next/programs/counter/src/window.tsx`, `next/programs/pipeline/src/Queue.ts`.

## The untrusted calls

Each row file is `field/findings/2026-11-18-make-on-untrusted-<slug>.json`. Paths below are under `next/packages/libfabrika/src/` unless shown.

| Call | Row slug | Note |
|---|---|---|
| `client/WindowMachine.ts:1872` | `window-read-rev` | A brain answer with `rev: 1.5` passes `Predicate.isNumber` and reaches `Schema.Int`. The gap is older than #1619, which moved the throw earlier |
| `runtime/Runner.ts:2792` | `runner-swap-prepared` | A program whose `wake` returns 0.5 or -1 dies with a defect at its next code swap. New with #1619 |
| `runtime/Runner.ts:1022` | `runner-exit-written` | Project status answer and descriptor |
| `runtime/Runner.ts:1074` | `runner-started` | Project start and status answers |
| `runtime/Runner.ts:1111` | `runner-checkpointed` | Project status answer |
| `runtime/Runner.ts:1229` | `runner-adopted` | Project status answer |
| `runtime/Runner.ts:1266` | `runner-interrupted-letter` | Descriptor, writer meta, status |
| `runtime/Runner.ts:1285` | `runner-due` | Status, descriptor, meta |
| `runtime/Runner.ts:1292` | `runner-healthy` | Status |
| `runtime/Runner.ts:1330` | `runner-begin-step` | Descriptor, status |
| `runtime/Runner.ts:1375` | `runner-interrupted-attempt` | Writer meta |
| `runtime/Runner.ts:1404` | `runner-check-threw` | Program error class can be `""`. An older `Failure.make` throws first |
| `runtime/Runner.ts:1411` | `runner-threw-step` | Same as 1404 |
| `runtime/Runner.ts:1456` | `runner-begin-init` | Descriptor |
| `runtime/Runner.ts:1475` | `runner-threw-init` | Same as 1404 |
| `runtime/Runner.ts:2949` | `runner-timer` | `due(at)` RPC and stored `wake`, never decoded |
| `runtime/Runner.ts:3027` | `runner-restart-requested` | Status, descriptor, meta |
| `runtime/Runner.ts:3133` | `runner-admitted` | Descriptor id as `ProcessId` |
| `runtime/Runner.ts:3148` | `runner-refused` | Writer key and descriptor name as `NonEmptyString` |
| `runtime/WatchersSql.ts:116` | `watchers-open` | `open(client)` RPC. The throw is caught as a typed `Storage` error |
| `access/AccessFold.ts:23` | `access-fold` | Public `ClientManager.write`. A passkey `counter` of 1.5 throws |
| `node/dev/local-dev.ts:204` | `local-dev-terminate` | Public `terminate`, and the `ps` output |
| `next/programs/pipeline/src/Queue.ts:115` | `queue-land-reply` | `queue({ name: "" })` throws in `update`. Only tests call it |
| `processes/QuotasSql.ts:703` | `quotas-change` | Public `Accounting.change` with `NaN`. Mostly threw before #1619 too |
| `transport/Connection.ts:97` | `connection-observed` | The caller's `read` of saved state, typed but not decoded |

What the 14 "internal" runner rows share (1022 to 3148, without 1404, 1411, 1475 and 2792):

- Their values come from one of these places (for 2949, the `due(at)` call and the stored wake), each decoded more loosely than the made schema, or not at all:
  - the Project's status and start answers, which `processValue` returns undecoded (`cloudflare/runtime.ts:553-556`);
  - the stored descriptor, decoded only as strings (`cloudflare/runtime.ts:162-168`);
  - the writer meta, where `Writer` decodes the strings that `From` needs as `Text` and as a 32-hex `TraceId`.
- Every producer today is fabrika's own code. So these need version skew between objects or a corrupt row. Rate them with that in mind: they may be one ticket, not 14.

## The unsure calls and the judgment calls

- **Unsure, 3 calls:** `gateway/Gateway.ts:815` (knock), `gateway/Gateway.ts:887` (leave) and `node/dev/dev.ts:524` (started). Each is a public library call whose made schema is exactly its parameter's TypeScript type, so only a cast can make it throw. Both Gateway calls run inside `store.atomic`, so they fail as a typed `Storage` error. What settles it is the owner's call on whether such a call counts as untrusted under 0215. #1643's L8b refused a tagless command, which suggests yes.
- **Trusted where a subagent said untrusted:** `node/repositories/OpenRepository.ts:195` and `:223`. Their values are branded ids (`Id.InputId`, `Id.Person`) and the output of our own `prepare`, so a value of that type was already made or decoded.
- **Trusted although the value comes from outside:** `client/internal/dial.ts:151`, `:180` and `:195`. They take raw frame text or the platform's close code, but the made field (`String` or `Finite`) is no stricter than what the platform gives.

## Checks

- `pnpm lint` passed, 21 of 21 parts, at the head, and it reads the rows.
- The leak grep is clean on both commits and on the net diff.
- No test or plant ran. Every verdict comes from reading code.

## Not in the rows

- `Schema.decodeUnknownSync` in `cloudflare/ProjectAuditTest.ts`, which #1619 added. It is a sync decode, not a `make`, so it is out of this audit's scope. It breaks 0576 in a test fake.
