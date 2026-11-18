# 0003: PR 1593 is green at 1f4945f45 and in the merge queue

From the lead of https://github.com/kamp-us/tea-fabrika/pull/1593 (ticket 1057).

## Green head

- `1f4945f45adbed1a9c48937c99a40d3ea3e07c02`. Its CI check suite completed green at 06:34Z, and
  the pull request entered the merge queue the same minute. Auto-merge was armed with SQUASH at 06:20Z.
- Base: main at `f79fc38db` (PR 1494). The branch is level with it.
- Checks at this head:
  - Full `pnpm lint`: 18 of 18 parts; the zero lock asks for nothing and finds no hit in a listed folder.
  - Full `pnpm typecheck`: 0 errors.
  - Leak check: clean on all 258 commits from the merge base and on the net diff, with the private word list present.
- Review: the same step-review agent rechecked every round after its first `done`. Its last answer is `done`, in run row
  `field/runs/2026-11-18-antislop-judgment-1057-review5.json`.

## Hunks resolved by hand

**Merge `3c9e9ed9b` (main at `1f05acc6c`: PRs 1569 and 1591)**

- `next/packages/libfabrika/src/telemetry/Sink.ts`: main's new `commitOpen` is kept. It passes the
  nearest marked ancestor to the fold's typed `countRefusal(span, at, ancestor)`.
- `.github/ci/plant.test.ts`: main's one-line `host-pin` loop is kept. `position` keeps the fold's Match,
  without the `failures` branch that main dropped.

**Merge `cb5832fd9` (main at `f79fc38db`: PR 1494): 54 hunks in 23 files**

The rule for every hunk: keep main's Reflect-ban code, and carry this branch's SAFETY, Predicate, Match or
typed change only where the pattern still stands. Where main rewrote the pattern away, the branch's edit was dropped.

- **Files that are main's side whole:** these hunks took main's code with nothing from this branch.
  - `cloudflare/platform.test.ts`
  - `node/dev/dev-control.laws.integration.test.ts`
  - `e2e/tezgah-focus.visual.test.ts`
  - `src/input-recording.integration.test.ts`
  - `src/runtime-recovery.laws.integration.test.ts`
  - `src/worker-quotas.integration.test.ts`
  - `cloudflare/control.ts`, where main's call tables replaced the ternary the fold had matched.
- **Main's code plus this branch's change:**
  - `Id.ts`: two SAFETY lines.
  - `cloudflare/error-cause.test.ts`: a typed return.
  - `cloudflare/index.test.ts` and `cloudflare/p14.test.ts`: SAFETY lines above the env disable lines.
  - `client/Tezgah.laws.test.ts` and `client/WindowMachine.laws.test.ts`: Predicate swaps.
  - `runtime/Client.laws.test.ts`: typed note helpers.
  - `runtime/Patch.test.ts`: one SAFETY line.
  - `runtime/Program.test.ts`: `expectMachine`, and Predicate in two Proxy traps that check only the key.
  - `src/checklist-instance.laws.integration.test.ts`: Match, and SAFETY lines on `callByName`.
  - `src/runtime-quotas.laws.test.ts`: Match on two chains, plus SAFETY lines.
  - `src/runtime.decode.test.ts` and `src/worker-monitor.integration.test.ts`: Predicate swaps.
  - `src/start-child.laws.integration.test.ts`: two SAFETY lines.
  - `src/door.integration.test.ts` and `e2e/chaos-revoke.integration.test.ts`: imports and typed params.
- **Type fix after the merge, `017fd7e41`:**
  - `ledger/Ledger.ts:65`: `LedgerCalls.append`'s line goes from `Line` to `Schema.Json`, because main's
    control door decodes that argument as `Schema.Json`. It is still narrower than main's `unknown`,
    and the store still decodes each line as `Line` strictly.
  - `node/dev/dev.ts:87,90`: the dev client takes `Schema.Json | undefined`, to match the binding.

**Lint fixes for main's new code in locked folders**

- `7ad8ea284`: SAFETY reasons on the 7 casts in `cloudflare/call-spans.laws.test.ts`.
- `3cc20983f`: Match at `.github/ci/changes.test.ts:2107`.
- `e95a3a4c0`: Match at `cloudflare/control.laws.test.ts:316`.

## For 1562 and 1431

They touch `runtime.ts`, `checklist-instance.laws.integration.test.ts` and `call-spans.laws.test.ts`. They keep these
fixes when they merge main after 1593.
