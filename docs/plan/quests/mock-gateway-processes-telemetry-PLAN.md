
Plancheck-Version: 3

# Plan: the mock sweep in `gateway`, `processes` and `telemetry`, in next/ (ticket 1067's sweep)

This is `next/` and the lint config. Today's app is not touched. It builds
[0555](../../../.decisions/0555-no-vi-mock-or-domock.md) (no `vi.spyOn` in a law; a stand-in comes
from a service with a test layer), [0579](../../../.decisions/0579-property-laws-use-it-prop.md)
(the `Recorder` is the one way to watch calls) and
[`effect-crypto-through-services.md`](../../../.patterns/effect-crypto-through-services.md) (hashes
and random bytes go through `effect/crypto`'s services). It is the row "`libfabrika/src/gateway`,
`processes`, `telemetry`" of the later slices in
[`recorder-PLAN.md`](recorder-PLAN.md#size).

```ts
// The whole idea, on telemetry's archive. A sketch, not compiled.
// Before: the law patches the global, and the product calls it straight.
vi.spyOn(crypto.subtle, "digest").mockRejectedValue(failure);
const work = Effect.tryPromise({ try: () => crypto.subtle.digest("SHA-256", bytes), catch: fail });

// After: the product asks for Effect's Digest service, and the law provides one.
const hash = yield* (yield* Digest.Digest).digestHex(Digest.sha256, bytes);
const dies = Recorder.layer(Digest.Digest, { digestHex: () => Effect.die(failure) });
expect(yield* Recorder.calls(Digest.Digest, "digestHex")).toEqual([[Digest.sha256, body]]);
```

## Doubts, read these first

- **Effect's crypto services cannot fail with a typed error (certain), and our notes say a crypto
  failure is typed (certain).** In the installed Effect 4.1.3, `Digest.digest` answers
  `Effect<Uint8Array>` (`node_modules/effect/src/crypto/Digest.ts:139`) and `SecureRandom` says
  "Every operation has a `never` error channel" (`crypto/SecureRandom.ts:11`). A rejected WebCrypto
  hash is a defect: `Effect.promise` inside `crypto/internal/digest.ts`. The approved
  [no Promises note](../../../docs/direction/no-promises.md) and the glossary row `crypto (reason)`
  say a crypto failure is a typed error with its own reason. This plan keeps the typed error by
  catching that one defect at the one call (`Effect.catchDefect`), so law C1 keeps its meaning. That
  is the open question below; the plan is written on its lean.
- **The pattern doc is wrong on this point (certain).** `effect-crypto-through-services.md:30-31`
  says "a failure is a typed `CryptoError`, not a rejected Promise". That holds for `Mac` and
  `Signature`, not for `Digest` or `SecureRandom`. The build fixes the line with the write-pattern
  skill, since this quest changes the doc anyway.
- **Nothing here can build before pull request 1366 merges (certain).** Every product change needs
  a file in 1366's diff: `gateway/Gateway.ts` holds the two hashes, and `cloudflare/runtime.ts` is
  the edge that must provide `Digest.layerWebCrypto` to the archive. See "Waits".

## What changes, in one paragraph

Five `vi.spyOn` calls in these folders go, all on WebCrypto; there is no `vi.fn` and no
`toHaveBeenCalled*`. Telemetry's archive and the gateway hash through Effect's `Digest` service, the
edges provide `Digest.layerWebCrypto`, and the four laws that patched `crypto.subtle.digest` provide
a `Digest` layer of their own instead: one that dies, read back through the `Recorder`, and one that
pauses a chosen hash. The one law in `processes` that patched `crypto.getRandomValues` provides a
`SecureRandom` layer once `Id.Generator` draws from that service, which is the top-level folder's
slice. Then lint refuses `vi` mocks in these three folders: `vitest/no-restricted-vi-methods`, the
rule 0555 names, in a block of its own like the Reflect ban's.

## The count, on main

Counted on main at `e613fa45b` with `rg -n -o 'vi\.fn\(|toHaveBeenCalled\w*|vi\.spyOn\(|spyOn\('`
over `next/packages/libfabrika/src/{gateway,node/gateway,processes,telemetry}`: 5 matches, all
`vi.spyOn`. The recorder plan's row said the same.

| Site | What it patches | What the law uses it for | What replaces it |
|---|---|---|---|
| `gateway/GatewayRevocation.integration.test.ts:631`, law "a route paused after its online check cannot record authenticated input after revoke" | `crypto.subtle.digest` | a gate: the hash of the request that holds `marker` waits on a `Deferred`, so the law can revoke in the gap | a pausing `Digest` layer, `paused(marker)` below |
| `gateway/GatewayRevocation.integration.test.ts:706`, law "a settled retry paused after online rechecks revoke before answering its cached placing" | `crypto.subtle.digest` | the same gate, on a retry | the same |
| `gateway/GatewayRevocation.integration.test.ts:1011`, law "a caused event paused after receipt checking cannot cross a revoke on another Gateway" | `crypto.subtle.digest` | the same gate, on an event's receipt | the same |
| `telemetry/ErrorCause.test.ts:35`, law "C1: a digest that rejects is `storage` with the rejected value as its cause, on any archive" | `crypto.subtle.digest` | a failure: the digest rejects with a generated value | a `Recorder.layer(Digest.Digest, ...)` whose members die with `failure`, and the law reads the one call |
| `processes/ProcessIdGenerator.test.ts:136`, laws "next dies on IdError `<clock, entropy, exhausted>` and keeps process.next around id.next" | `crypto.getRandomValues` | a failure (`entropy` throws) or the top random value (`255` bytes, for `clock` and `exhausted`) | a `SecureRandom` layer from `SecureRandom.make`, after `Id.Generator` reads that service |

None of the five watches a call: four are a gate or a failure. So the Recorder appears only where a
law gains a check it did not have (C1 reads that the archive hashed exactly the body it was given),
and the rest are plain test layers, as 0555 says ("the service's own test layer").

## How others do it

- **Effect's makers:** a crypto call goes through `effect/crypto`, and a test swaps the layer. Each
  service's WebCrypto layer reads the `WebCrypto` reference (`crypto/WebCrypto.ts`), whose default
  is `globalThis.crypto`. Read in the installed 4.1.3; the Effect repo's own tests were not fetched.
- **The pattern doc,** our current shape: domain code yields the service, the program's edge
  provides `layerWebCrypto` (`settings/Snapshot.ts:25-27`, `apps/fabrika/cli.ts:16`). Providing the
  layer inside the module, as `runtime/Built.ts` does, is listed there as "Not yet".
- **A branch not taken:** keep `crypto.subtle` but read it from the `WebCrypto` reference, and let a
  law provide `WebCrypto.layer(fake)`. It keeps the typed error with no defect to catch and touches
  no edge, since a reference needs no provide. It goes against the pattern doc's rule "never touches
  `crypto.subtle`", and a law would then build a fake platform object, which is the swap 0555 moves
  away from. Not taken.

## The shape

### Telemetry's archive

```ts
// next/packages/libfabrika/src/telemetry/Archive.ts. A sketch, not compiled.
import { Digest } from "effect/crypto";

export const sha256 = Effect.fn(function* (body: Uint8Array) {
  const digest = yield* Digest.Digest;
  return yield* digest.digestHex(Digest.sha256, new Uint8Array(body)).pipe(
    // A WebCrypto failure is a defect in Effect's Digest; the sink keeps it typed (the open question).
    Effect.catchDefect((cause) => Effect.fail(new SinkError({ reason: "storage", held: 0, cause }))),
  );
});
// sha256: (body: Uint8Array) => Effect<string, SinkError, Digest.Digest>

export class Archive extends Context.Service<Archive, { /* put, as on main */ }>()("...") {
  // Each layer reads Digest once when built, so `put` keeps an environment of `never`.
  static readonly memory: Layer.Layer<Archive, never, Digest.Digest>;
  static readonly bucket: (calls: BucketCalls) => Layer.Layer<Archive, never, Digest.Digest>;
}
```

`digestHex` answers lowercase hex (`Digest.ts:143`), the same as main's `hex`, so the hash R2 is
sent does not change. The `fabrika/no-promises` edge line at `Archive.ts:42` goes with the
`tryPromise`.

### The gateway

```ts
// next/packages/libfabrika/src/gateway/Gateway.ts, main's lines 2044-2066. A sketch.
// `make` yields Digest.Digest once; fingerprint and hash take it.
const sha = (digest: Digest.Digest["Service"], bytes: Uint8Array) =>
  digest.digest(Digest.sha256, bytes).pipe(
    Effect.catchDefect((cause) => Effect.fail(new LedgerError({ reason: "crypto", cause }))),
  );
// Gateway.layer(options): Layer<Gateway, never, Digest.Digest | ...main's own>
```

The two `fabrika/no-promises` edge lines at main's `Gateway.ts:2053` and `:2062` go. The two
`crypto.getRandomValues` calls in `Gateway.ts` (main's `:719` and `:2042`) and all of
`GatewayNonce.ts` have no spy and stay; see "Not in this quest".

### The pausing layer the three gateway laws share

```ts
// next/packages/libfabrika/src/gateway/GatewayRevocation.integration.test.ts. A sketch.
/** Digest on WebCrypto, except the first hash of bytes that hold `marker` waits for `release`. */
const paused = (marker: string, entered: Deferred.Deferred<void>, release: Deferred.Deferred<void>) =>
  Layer.effect(
    Digest.Digest,
    Effect.gen(function* () {
      const real = yield* Digest.Digest;
      const once = yield* Ref.make(false);
      const gate = (data: Uint8Array) =>
        Effect.gen(function* () {
          const hit = new TextDecoder().decode(data).includes(marker);
          if (hit && !(yield* Ref.getAndSet(once, true))) {
            yield* Deferred.succeed(entered, undefined);
            yield* Deferred.await(release);
          }
        });
      return {
        digest: (algorithm, data) => Effect.andThen(gate(data), real.digest(algorithm, data)),
        digestHex: (algorithm, data) => Effect.andThen(gate(data), real.digestHex(algorithm, data)),
      };
    }),
  ).pipe(Layer.provide(Digest.layerWebCrypto));
```

`world()` and `setup()` take the `Digest` layer the doors are built with, `Digest.layerWebCrypto` by
default, so a law that pauses builds its doors on `paused(...)`. Each law's `Deferred.await(entered)`
gets an `Effect.timeout`, so a hash that no longer goes through `Digest` fails the law at once and
does not hang it. The `try/finally` with `spy.mockRestore()` goes, and with it the module-level
patch that could leak into the next law (0061).

### The process id law, after `Id.Generator` reads `SecureRandom`

```ts
// next/packages/libfabrika/src/processes/ProcessIdGenerator.test.ts. A sketch.
const random = (exitReason: "clock" | "entropy" | "exhausted", marker: string) =>
  Layer.succeed(
    SecureRandom.SecureRandom,
    SecureRandom.make((size) => {
      if (exitReason === "entropy") {
        throw new Error(marker);
      }
      return new Uint8Array(size).fill(255);
    }),
  );
// ...pipe(Effect.provide(ProcessIdGenerator.layer), Effect.provide(random(exitReason, marker)))
```

`SecureRandom.make` turns a plain byte source into the whole service (`SecureRandom.ts:222`), so the
law states only the bytes. The shape of `Id.Generator`'s change, and whether its `entropy` reason
stays a typed `IdError` (the same open question), is the top-level folder's plan to say.

### The lock

```jsonc
// .oxlintrc.json, a new block after the Reflect ban's. A sketch.
{
  // Decisions 0555 and 0579: no vi mock in a law. The block lists the folders at zero; a folder
  // joins the day its own slice brings it to zero, and none is taken off (0524).
  "files": [
    "next/packages/libfabrika/src/gateway/**",
    "next/packages/libfabrika/src/telemetry/**"
    // slice 2 adds "next/packages/libfabrika/src/processes/**"
  ],
  "rules": {
    "vitest/no-restricted-vi-methods": [
      "error",
      {
        "mock": "Give the code a service and provide a test layer (0555).",
        "doMock": "Give the code a service and provide a test layer (0555).",
        "spyOn": "Put the call behind a service and provide or record it in the law's layer (0555, 0579).",
        "stubEnv": "Read through Config and provide a ConfigProvider layer (0555).",
        "fn": "Watch the service's calls with Recorder.layer from @kampus/vitest (0579)."
      }
    ]
  }
}
```

No such block is on main at `e613fa45b`. If another folder's slice adds it first, this quest adds
its folders to that block and its plant to that law. The rule is in oxlint 1.90.0, the installed
version (`node_modules/oxlint/configuration_schema.json`, `vitest/no-restricted-vi-methods`). `fn` is
in the list because 0579 makes the Recorder the replacement for `vi.fn`; these folders have none.

## One value traced: C1 on the bucket archive

1. The law draws `failure` (say `new TypeError("x")`) and `body` (say `[1, 2]`), and provides
   `Archive.bucket(calls)` over a `Recorder.layer(Digest.Digest, ...)` whose members die with `failure`.
2. `archive.put("spans/1", body)` runs `sha256(body)`, which yields the `Digest` the layer captured
   at build, and calls `digestHex(Digest.sha256, [1, 2])`.
3. The Recorder writes `{ method: "digestHex", args: [Digest.sha256, [1, 2]] }` and runs the law's
   member, which dies with `failure`. A member the law leaves out dies with `UnimplementedError`
   (`Layer.mock`), which would turn the law red for the wrong reason, so the tests step gives both
   `digest` and `digestHex`, each dying with `failure`, and the law reads that exactly one call of
   the two was made, with exactly `body`. That holds whichever member the build calls.
4. `catchDefect` turns the defect into `SinkError { reason: "storage", cause: failure }`; `put` stops
   before any bucket call.
5. The law sees `error.reason === "storage"` and `error.cause === failure`, as on main, and one
   recorded hash of exactly `body`.

## Laws

All five rewritten laws keep every value they compared on main. Property laws keep their generators;
ErrorCause's hand runner and seed move to `it.effect.prop` only in 0579's own sweep, not here.

| Law | Kind (lint, type or test?) | Generator | Plant | Where |
|---|---|---|---|---|
| M1. The three revocation laws, unchanged in what they check: a revoke inside the paused request hash is honored, through a `Digest` layer that pauses, and the pause is reached within a timeout | test | fc.asyncProperty: target, `revokeFirst`, token and text, as on main; seed 119120, 3 runs fast and 25 runs full | skip the grant recheck after the request hash in `Gateway.ts`: M1 red on `revokeFirst`. And hash with `crypto.subtle` again: M1 red at the pause's timeout | next/packages/libfabrika/src/gateway/GatewayRevocation.integration.test.ts |
| M2. C1: a digest that dies is `storage` with the defect as its cause, on either archive and on `sha256` alone, and the archive hashed exactly the body it was given, once | test | fc.asyncProperty: `failure`, `body` and `onBucket`, as on main; seed 119120, 100 runs | main's plant (`fail` built with no cause): M2 red. And hash `body.slice(1)`: M2 red on the recorded call | next/packages/libfabrika/src/telemetry/ErrorCause.test.ts |
| M3. `next dies on IdError <reason> and keeps process.next around id.next`, the same three cases with main's `Time`, `Count` and `marker` Schemas, through a `SecureRandom` layer | test | Effect Arbitrary: Time | make `Id.Generator` draw from `globalThis.crypto` again: the `entropy` case does not die, M3 red | next/packages/libfabrika/src/processes/ProcessIdGenerator.test.ts |
| M4. The lock: `vi.fn`, `vi.mock`, `vi.doMock`, `vi.spyOn` and `vi.stubEnv` are refused in every folder of the block, with `vi` imported from `vitest` and from `@effect/vitest`, and `vi.useFakeTimers` passes | lint | lint | delete one folder from the block: that folder's planted lines are not refused, M4 red | oxlint-plugins/builtin-plants.ts, oxlint-plugins/plants.test.ts |
| M5. The product code these laws reach calls no `crypto.subtle.digest`: `Archive.ts` and `Gateway.ts`'s hashes need `Digest.Digest` in their type | type | type | provide nothing for `Digest` in one test that builds `Archive.memory`: it no longer compiles, red in a typecheck | next/packages/libfabrika/src/telemetry/Archive.ts, next/packages/libfabrika/src/gateway/Gateway.ts |

- M4 also plants `import { vi as v } from "vitest"; v.spyOn(...)`, the form 0555 says the rule may
  miss. The law asserts what oxlint 1.90.0 does with it, and the run row records which. If it is not
  refused, this quest does not write a rule of its own for it: that is a finding row.
- M1 is in a `*.integration.test.ts` file because it opens a real `node:sqlite` database; it
  already is on main, and no stand-in replaces that here. It runs in this box (step rules allow an
  `.integration.` law the files reach). No law needs the owner's Mac, so none is host-only.
- No law reads a secret, so no `[secrets]` flow.
- The 37 files that build an `Archive` or a `Gateway` layer each provide `Digest.layerWebCrypto`;
  that is a type change with no law of its own (M5 holds it).

## Files

Slice 1, after 1366: telemetry and the gateway.

| File | Owner | Product lines expected | Change |
|---|---|---|---|
| next/packages/libfabrika/src/telemetry/Archive.ts | build | 15 | `sha256` yields `Digest.Digest` and keeps `SinkError` by `catchDefect`; `memory` and `bucket` read `Digest` at build |
| next/packages/libfabrika/src/gateway/Gateway.ts | build | 12 | `fingerprint` and `hash` through `Digest`, `LedgerError` `crypto` kept by `catchDefect`; `make` yields `Digest` once |
| next/packages/libfabrika/src/cloudflare/runtime.ts | build | 3 | provide `Digest.layerWebCrypto` where `archiveLayer` and the Gateway are built |
| next/apps/fabrika/src/runtime.ts | build | 2 | provide `Digest.layerWebCrypto` to `Gateway.layer` |
| next/packages/libfabrika/src/node/dev/dev-recording.ts | build | 2 | provide `Digest.layerWebCrypto` to `Archive.bucket` |
| .oxlintrc.json | tests | 15 | the new block, with `gateway/**` and `telemetry/**` |
| .patterns/effect-crypto-through-services.md | build | docs | with the write-pattern skill: the failure line corrected, the rule "a crypto failure keeps its typed reason by `catchDefect` at the one call", `Archive.ts` and the gateway's hashes out of "Not yet", the lock under "Holds it" |
| next/packages/libfabrika/src/gateway/GatewayRevocation.integration.test.ts | tests | tests | M1: `paused(...)`, `world`/`setup` take the `Digest` layer, the three spies go |
| next/packages/libfabrika/src/telemetry/ErrorCause.test.ts | tests | tests | M2: `digestRejects` becomes a Recorder layer; the `vi` import goes |
| oxlint-plugins/builtin-plants.ts | tests | tests | M4: a `VI` plant beside `REFLECT` |
| oxlint-plugins/plants.test.ts | tests | tests | M4: "VI's lines are refused exactly, in every folder of every ban block", as REFLECT's scenario |
| next/apps/fabrika/e2e/chaos-revoke.worker.test-support.ts | tests | tests | adds `Digest.layerWebCrypto` where it builds an `Archive` or `Gateway` layer; nothing else |
| next/apps/fabrika/src/door-recovery.integration.test.ts | tests | tests | adds `Digest.layerWebCrypto` where it builds an `Archive` or `Gateway` layer; nothing else |
| next/apps/fabrika/src/door-spans.test.ts | tests | tests | adds `Digest.layerWebCrypto` where it builds an `Archive` or `Gateway` layer; nothing else |
| next/apps/fabrika/src/door.integration.test.ts | tests | tests | adds `Digest.layerWebCrypto` where it builds an `Archive` or `Gateway` layer; nothing else |
| next/apps/fabrika/src/exam/agent-may.test.ts | tests | tests | adds `Digest.layerWebCrypto` where it builds an `Archive` or `Gateway` layer; nothing else |
| next/apps/fabrika/src/exam/runner-contract-replay.test.ts | tests | tests | adds `Digest.layerWebCrypto` where it builds an `Archive` or `Gateway` layer; nothing else |
| next/apps/fabrika/src/hands-client.test.ts | tests | tests | adds `Digest.layerWebCrypto` where it builds an `Archive` or `Gateway` layer; nothing else |
| next/apps/fabrika/src/instance-records.integration.test.ts | tests | tests | adds `Digest.layerWebCrypto` where it builds an `Archive` or `Gateway` layer; nothing else |
| next/packages/libfabrika/src/access/Authorization.integration.test.ts | tests | tests | adds `Digest.layerWebCrypto` where it builds an `Archive` or `Gateway` layer; nothing else |
| next/packages/libfabrika/src/cloudflare/connection.test.ts | tests | tests | adds `Digest.layerWebCrypto` where it builds an `Archive` or `Gateway` layer; nothing else |
| next/packages/libfabrika/src/desktop/BrainServiceTest.ts | tests | tests | adds `Digest.layerWebCrypto` where it builds an `Archive` or `Gateway` layer; nothing else |
| next/packages/libfabrika/src/gateway/Gateway.types.test.ts | tests | tests | adds `Digest.layerWebCrypto` where it builds an `Archive` or `Gateway` layer; nothing else |
| next/packages/libfabrika/src/gateway/TasksTest.ts | tests | tests | adds `Digest.layerWebCrypto` where it builds an `Archive` or `Gateway` layer; nothing else |
| next/packages/libfabrika/src/ledger/TraceId.test.ts | tests | tests | adds `Digest.layerWebCrypto` where it builds an `Archive` or `Gateway` layer; nothing else |
| next/packages/libfabrika/src/node/Chaos.test-support.ts | tests | tests | adds `Digest.layerWebCrypto` where it builds an `Archive` or `Gateway` layer; nothing else |
| next/packages/libfabrika/src/node/ErrorCause.test.ts | tests | tests | adds `Digest.layerWebCrypto` where it builds an `Archive` or `Gateway` layer; nothing else |
| next/packages/libfabrika/src/node/IsolateUsage.integration.test.ts | tests | tests | adds `Digest.layerWebCrypto` where it builds an `Archive` or `Gateway` layer; nothing else |
| next/packages/libfabrika/src/node/Nemesis.laws.integration.test.ts | tests | tests | adds `Digest.layerWebCrypto` where it builds an `Archive` or `Gateway` layer; nothing else |
| next/packages/libfabrika/src/node/RunnerAdmission.integration.test.ts | tests | tests | adds `Digest.layerWebCrypto` where it builds an `Archive` or `Gateway` layer; nothing else |
| next/packages/libfabrika/src/node/dev/supervision-spans.integration.test.ts | tests | tests | adds `Digest.layerWebCrypto` where it builds an `Archive` or `Gateway` layer; nothing else |
| next/packages/libfabrika/src/node/gateway/Tasks.integration.test.ts | tests | tests | adds `Digest.layerWebCrypto` where it builds an `Archive` or `Gateway` layer; nothing else |
| next/packages/libfabrika/src/node/launchd/BrainControlLaunchd.laws.integration.test.ts | tests | tests | adds `Digest.layerWebCrypto` where it builds an `Archive` or `Gateway` layer; nothing else |
| next/packages/libfabrika/src/processes/ProcessSpans.integration.test.ts | tests | tests | adds `Digest.layerWebCrypto` where it builds an `Archive` or `Gateway` layer; nothing else |
| next/packages/libfabrika/src/runtime/EffectFunctions.test.ts | tests | tests | adds `Digest.layerWebCrypto` where it builds an `Archive` or `Gateway` layer; nothing else |
| next/packages/libfabrika/src/runtime/Runner.integration.test.ts | tests | tests | adds `Digest.layerWebCrypto` where it builds an `Archive` or `Gateway` layer; nothing else |
| next/packages/libfabrika/src/runtime/RunnerRecovery.laws.test.ts | tests | tests | adds `Digest.layerWebCrypto` where it builds an `Archive` or `Gateway` layer; nothing else |
| next/packages/libfabrika/src/runtime/RunnerSupervision.integration.test.ts | tests | tests | adds `Digest.layerWebCrypto` where it builds an `Archive` or `Gateway` layer; nothing else |
| next/packages/libfabrika/src/telemetry/P12Readers.laws.test.ts | tests | tests | adds `Digest.layerWebCrypto` where it builds an `Archive` or `Gateway` layer; nothing else |
| next/packages/libfabrika/src/telemetry/Sink.integration.test.ts | tests | tests | adds `Digest.layerWebCrypto` where it builds an `Archive` or `Gateway` layer; nothing else |
| next/packages/libfabrika/src/telemetry/internal/measurements.integration.test.ts | tests | tests | adds `Digest.layerWebCrypto` where it builds an `Archive` or `Gateway` layer; nothing else |
| next/packages/libfabrika/src/telemetry/internal/sums.test.ts | tests | tests | adds `Digest.layerWebCrypto` where it builds an `Archive` or `Gateway` layer; nothing else |

Slice 2, after the top-level folder's `Id.Generator` change: processes.

| File | Owner | Product lines expected | Change |
|---|---|---|---|
| next/packages/libfabrika/src/processes/ProcessIdGenerator.test.ts | tests | tests | M3: the `random(...)` layer; the spy and its `try/finally` go |
| .oxlintrc.json | tests | 1 | `processes/**` joins the block |

- `Archive.ts`, `ErrorCause.test.ts`, `ProcessIdGenerator.test.ts` and `GatewayRevocation.integration.test.ts`
  are not in 1366's diff. `Gateway.ts`, `cloudflare/runtime.ts` and `runtime/Runner.integration.test.ts`
  are, and so are these in the three folders: `processes/ProcessManager.ts`, `ProgramMail.ts`,
  `ProgramMailLedger.ts`, `Quotas.ts`, `QuotasSql.ts`, `QuotasTest.ts`, `internal/programMail.test.ts`,
  `internal/quota.ts`, `internal/quota.test.ts`, `telemetry/QuotaRefusalTest.ts` and `telemetry/Sink.ts`.
  This quest changes none of those last eleven. Read with `pull_request_read get_files`, 57 files,
  one page, on 2026-11-15.
- Every file stays where it is; no new file. `Digest` and `SecureRandom` are Effect's, so the
  libfabrika test in `next/AGENTS.md` does not move anything.

## Waits

- **Slice 1 waits for pull request 1366** (P34c slice 4, a draft with red real-instance laws). It
  needs `Gateway.ts` and `cloudflare/runtime.ts`, and `Runner.integration.test.ts` takes the
  `Digest` provide. The plan's line numbers for `Gateway.ts` are main's at `e613fa45b` and move
  with 1366; the tests step re-reads them.
- **Slice 2 waits for the top-level folder's slice** (`libfabrika/src`: `Id`, `Id.cause`, `check`,
  9 `crypto.getRandomValues` spies on the same `entropy()` in `Id.ts:131`). `Id.ts` and its laws are
  that folder's, and the change to `Id.Generator` is one product change that both folders' laws
  read. That slice also needs `cloudflare/runtime.ts` and `cloudflare/connection.ts`, which build
  `Id.Generator.layer`, so it waits for 1366 as well.

## Calls taken

- **Plain test layers, not the Recorder, where a law does not read calls,** 85%. Four of the five
  spies are a gate or a failure; 0555 names "the service's own test layer" for a stand-in, and 0579
  makes the Recorder the way to watch. C1 gains a read of the call, so it uses the Recorder.
- **`Id.Generator`'s move is the top-level slice's, and this quest's slice 2 follows it,** 80%. The
  product file and nine of the ten laws on its entropy are there; splitting it would put one change
  in two plans.
- **The lock starts as its own block, folder by folder,** 90%. 0555 names the rule, and 0554's Reflect
  ban set the shape: a block of folders at zero, a planted law that walks every folder of the block.
- **`fn` is in the lock's list,** 80%. 0579 says the Recorder replaces `vi.fn`; these folders have
  none, so it costs nothing here. The doubt: 0555's own list has four methods, and another folder's
  slice could read 0579 more narrowly.
- **Out of scope: crypto calls no spy reaches,** 85%. `GatewayNonce.ts` (an HMAC key, sign, verify,
  salt) and `Gateway.ts`'s two `getRandomValues` have no `vi` call; their laws in `GatewayCauseTest.ts`
  shadow `crypto.subtle` by hand with `Object.defineProperty`. Moving them to `Mac` and `SecureRandom`
  is the pattern doc's "Not yet", a crypto slice of its own.
- **Is this a setting?** No. Which crypto layer runs is wiring at the edge, not a choice a person
  makes in `fabrika.toml` (0069).
- **What fact is lost if not recorded now?** None. No stored data changes shape: the archive's hash
  is the same hex, and the gateway's digests are the same bytes.

## Validation

- The tests step: `pnpm format`, `pnpm lint` (with `NODE_OPTIONS=--max-old-space-size=6144` in a
  cloud box), then `nice -n 15 pnpm exec vitest run --maxWorkers=3` on
  `next/packages/libfabrika/src/telemetry/ErrorCause.test.ts`,
  `next/packages/libfabrika/src/gateway/GatewayRevocation.integration.test.ts` and
  `oxlint-plugins/plants.test.ts`. Each plant runs once and goes in the step's report.
- The build: the same narrow paths. The lead runs the changed-files test run and the one type check,
  the only check that reads M5 and the 31 provides.
- The review runs the loosening check on the five rewritten laws.

## Size

Two pull requests, each landing whole. Confidence in the line counts: 75%; the doubt is how many of
the 37 layer sites need more than one line to reach the provide.

1. Slice 1, telemetry and the gateway, after 1366: about 49 product lines, about 40 lines of
   config and docs, about 150 test lines across 35 test files. 49 lines.
2. Slice 2, processes, after the top-level slice: 1 config line and about 20 test lines. 1 lines.

Priced as the recorder plan priced its steps, from `field/runs/` for 2026-11-10 to 2026-11-15 at
list price: a tests step about $6, a build about $5, a review about $3, a fix round about $4.
Slice 1: tests $7 (35 files), build $5, review $3, one likely fix round $4. Slice 2: tests $3, build
$1 (one line), review $2.

Estimate: 7 steps, $25

## Records

- No new decision and no glossary row: this coins no word. The pattern doc changes in slice 1.
- 0555's "Consequences" counted 14 `crypto.subtle` and 11 `crypto.getRandomValues` spies in all of
  `next/`; this quest removes 4 and 1 of them.

## What this cannot tell us

- Whether any block here compiles. None was compiled or run.
- Whether `vitest/no-restricted-vi-methods` sees a renamed `vi` import; M4's plant finds out.
- What 1366 does to `Gateway.ts`'s hashes before it lands. If it adds a hash, slice 1 moves that
  one too.
- Whether catching a defect at a crypto call hides a real bug in a test layer. The catch is one call
  wide, and every other defect still dies.

## Open questions

1. **A WebCrypto failure through Effect's `Digest` (and `SecureRandom`) is a defect: does our code
   keep it a typed error, or follow Effect?** Effect 4.1.3 gives these services a `never` error
   channel, so the known way is a defect. The approved no Promises note and the glossary row
   `crypto (reason)` say a crypto failure is typed with its own reason. Lean: keep it typed, by
   `Effect.catchDefect` at the one call (`SinkError` `storage` in the archive, `LedgerError`
   `crypto` in the gateway, `IdError` `entropy` in the top-level slice), 70%. It keeps laws C1 and
   M3 as strict as on main and walks no note back. The other branch makes each a defect: C1 and M3
   then assert the defect is the platform's own value, and the no Promises note's typed-reason rule
   is walked back for these two services.
