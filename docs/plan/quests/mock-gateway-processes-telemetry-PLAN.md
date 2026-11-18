Approved by the lead agent, builds 0043, 0054, 0554, 0555, 0557, 0579, 0587, 0589, 0594; body 06d9e86edc54
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

// After (amendment 2026-11-15, merge session ruling 3): the product reads crypto through Effect's
// WebCrypto reference, so a failed digest stays a typed error, and the law hands in a stand-in.
const crypto = yield* WebCrypto.WebCrypto;
const work = Effect.tryPromise({ try: () => crypto.subtle.digest("SHA-256", bytes), catch: fail });
const rejecting = Rejecting.digest(failure); // keeps each body it was asked to hash, then rejects
yield* Effect.flip(archive.put("spans/1", body)).pipe(Effect.provide(WebCrypto.layer(rejecting.crypto)));
expect(rejecting.asked).toEqual([body]);
```

**Amendment (2026-11-15, merge session rulings).** The first version of this plan moved the hashes
to Effect's `Digest` service and caught its defect with `Effect.catchDefect`. The merge session
ruled that a failed digest stays a typed error, through Effect's `WebCrypto` reference, as the
cloudflare and transport plans do; this plan drops `catchDefect`. Its M3 follows the lib-top
ruling: `Id.Generator.layer` keeps its own random source, so the law builds the generator with
`makeGenerator` through lib-top's `generatorWith`. Each slice lands on the sweep's one fold branch,
and the lock is node's M1. The sections below are amended in place; what they said before is kept
where it explains a law.

**Amendment (2026-11-18, merger ruling 05:11:20 UTC).** The shared crypto test helper now lives in
`telemetry/`. The existing `next-crypto-test-support` row names that exact file; only its path
changes. Its imports and all other layer rows stay as they are. The gateway and telemetry test
imports keep the same helper behavior and assertions. The Files table assigns `layer-rules.json` to
tests for this one row change.

## Doubts, read these first

- **Effect's crypto services cannot fail with a typed error (certain), and our notes say a crypto
  failure is typed (certain).** In the installed Effect 4.1.3, `Digest.digest` answers
  `Effect<Uint8Array>` (`node_modules/effect/src/crypto/Digest.ts:139`) and `SecureRandom` says
  "Every operation has a `never` error channel" (`crypto/SecureRandom.ts:11`). A rejected WebCrypto
  hash is a defect: `Effect.promise` inside `crypto/internal/digest.ts`. The approved
  [no Promises note](../../../docs/direction/no-promises.md) and the glossary row `crypto (reason)`
  say a crypto failure is a typed error with its own reason. The first version kept the typed error
  by catching that one defect at the one call (`Effect.catchDefect`).

  **Amendment (2026-11-15, merge session ruling 3):** settled, and not by `catchDefect`. A failed
  digest stays a typed error, through Effect's `WebCrypto` reference
  (`node_modules/effect/src/crypto/WebCrypto.ts`, a `Context.Reference` whose default is
  `globalThis.crypto`): the hash is an `Effect.tryPromise` over the reference's `subtle.digest`,
  whose `catch` makes the typed error, as `cloudflare/runtime.ts`'s `checkedPut` and
  `transport/internal/binary.ts` do in their plans. No defect is made, so none is caught. Law C1
  keeps its meaning with nothing translated.
- **The pattern doc is wrong on this point (certain).** `effect-crypto-through-services.md:30-31`
  says "a failure is a typed `CryptoError`, not a rejected Promise". That holds for `Mac` and
  `Signature`, not for `Digest` or `SecureRandom`. The build fixes the line with the write-pattern
  skill, since this quest changes the doc anyway. **Amendment (2026-11-15):** the doc also gains
  the ruled rule: a hash whose failure must stay typed reads `crypto.subtle` through the `WebCrypto`
  reference, not `Digest`; its "never touches `crypto.subtle`" line is narrowed to say so.
- **Nothing here can build before pull request 1366 merges (certain).** `gateway/Gateway.ts` holds
  the two hashes, and it is in 1366's diff. See "Waits". (Amendment 2026-11-15: `cloudflare/runtime.ts`
  no longer needs to change, since a `Context.Reference` needs no provide.)

## What changes, in one paragraph

Five `vi.spyOn` calls in these folders go, all on WebCrypto; there is no `vi.fn` and no
`toHaveBeenCalled*`. **Amended 2026-11-15:** telemetry's archive and the gateway read `crypto`
through Effect's `WebCrypto` reference, and the four laws that patched `crypto.subtle.digest` hand
in a stand-in crypto with `WebCrypto.layer` instead: one whose digest rejects and keeps the bodies
it was asked, and one that pauses a chosen hash. No edge changes: a reference needs no provide.
The one law in `processes` that patched `crypto.getRandomValues` builds its generator with
lib-top's `generatorWith` once `Id.Generator` draws from `SecureRandom`, which is the top-level
folder's slice. Then lint refuses `vi` mocks in these three folders: `vitest/no-restricted-vi-methods`,
the rule 0555 names, with all five methods and node's M1 as its law.

## The count, on main

Counted on main at `e613fa45b` with `rg -n -o 'vi\.fn\(|toHaveBeenCalled\w*|vi\.spyOn\(|spyOn\('`
over `next/packages/libfabrika/src/{gateway,node/gateway,processes,telemetry}`: 5 matches, all
`vi.spyOn`. The recorder plan's row said the same.

| Site | What it patches | What the law uses it for | What replaces it |
|---|---|---|---|
| `gateway/GatewayRevocation.integration.test.ts:631`, law "a route paused after its online check cannot record authenticated input after revoke" | `crypto.subtle.digest` | a gate: the hash of the request that holds `marker` waits on a `Deferred`, so the law can revoke in the gap | a pausing stand-in crypto handed in with `WebCrypto.layer`, `paused(marker)` below (amended 2026-11-15; was a `Digest` layer) |
| `gateway/GatewayRevocation.integration.test.ts:706`, law "a settled retry paused after online rechecks revoke before answering its cached placing" | `crypto.subtle.digest` | the same gate, on a retry | the same |
| `gateway/GatewayRevocation.integration.test.ts:1011`, law "a caused event paused after receipt checking cannot cross a revoke on another Gateway" | `crypto.subtle.digest` | the same gate, on an event's receipt | the same |
| `telemetry/ErrorCause.test.ts:35`, law "C1: a digest that rejects is `storage` with the rejected value as its cause, on any archive" | `crypto.subtle.digest` | a failure: the digest rejects with a generated value | (amended 2026-11-15) a stand-in crypto handed in with `WebCrypto.layer`, whose `subtle.digest` keeps each body it is asked and rejects with `failure`; the law reads that list |
| `processes/ProcessIdGenerator.test.ts:136`, laws "next dies on IdError `<clock, entropy, exhausted>` and keeps process.next around id.next" | `crypto.getRandomValues` | a failure (`entropy` throws) or the top random value (`255` bytes, for `clock` and `exhausted`) | (amended 2026-11-15) `Id.Generator` built by lib-top's `generatorWith(fill)` over `makeGenerator`, under `ProcessIdGenerator.layer`, after `Id.Generator` reads `SecureRandom` |

None of the five watches a call: four are a gate or a failure. **Amended 2026-11-15:** no Recorder
appears here. The first version used one for C1, over Effect's `Digest`; `WebCrypto` is a reference
to a platform object, not an Effect service, so its stand-in keeps what it was asked as its own
state, as the cloudflare plan's socket fake keeps its sent frames (0554, 0557, and the Recorder
pattern doc's "Where it applies"). C1 keeps the check that version added: the archive hashed
exactly the body it was given, once.

## How others do it

- **Effect's makers:** a crypto call goes through `effect/crypto`, and a test swaps the layer. Each
  service's WebCrypto layer reads the `WebCrypto` reference (`crypto/WebCrypto.ts`), whose default
  is `globalThis.crypto`. Read in the installed 4.1.3; the Effect repo's own tests were not fetched.
- **The pattern doc,** our current shape: domain code yields the service, the program's edge
  provides `layerWebCrypto` (`settings/Snapshot.ts:25-27`, `apps/fabrika/cli.ts:16`). Providing the
  layer inside the module, as `runtime/Built.ts` does, is listed there as "Not yet".
- **The branch taken (amendment 2026-11-15, merge session ruling 3; first written as "not
  taken"):** keep `crypto.subtle` but read it from the `WebCrypto` reference, and let a law provide
  `WebCrypto.layer(fake)`. It keeps the typed error with no defect to catch and touches no edge,
  since a reference needs no provide. The first version turned it down for the pattern doc's rule
  "never touches `crypto.subtle`" and for the fake platform object a law builds. The ruling settles
  both: the doc's rule is narrowed (see the doubts), and a stand-in for a platform object is what
  0554 and 0557 put in a test helper, as transport's `Rejecting.crypto` is. The `Digest` branch is
  marked wrong.

## The shape

### Telemetry's archive

```ts
// next/packages/libfabrika/src/telemetry/Archive.ts. A sketch, not compiled. Amended 2026-11-15:
// the WebCrypto reference in place of Digest, and no catchDefect.
import { WebCrypto } from "effect/crypto";

export const sha256 = Effect.fn(function* (body: Uint8Array) {
  const crypto = yield* WebCrypto.WebCrypto;
  const digest = yield* Effect.tryPromise({
    // oxlint-disable-next-line fabrika/no-promises -- edge: WebCrypto hashes through a Promise
    try: () => crypto.subtle.digest("SHA-256", new Uint8Array(body)),
    // A rejected digest is a typed failure here, never a defect (ruling 3).
    catch: (cause) => new SinkError({ reason: "storage", held: 0, cause }),
  });
  return hex(digest);
});
// sha256: (body: Uint8Array) => Effect<string, SinkError>; a Context.Reference adds no requirement

export class Archive extends Context.Service<Archive, { /* put, as on main */ }>()("...") {
  // Unchanged: `memory` and `bucket` keep main's types, since the reference needs no provide.
}
```

The hash R2 is sent does not change: `hex` and the `fabrika/no-promises` edge line at `Archive.ts:42`
stay as on main; only where `crypto` comes from changes (amended 2026-11-15; the first version
dropped both for `digestHex`).

### The gateway

```ts
// next/packages/libfabrika/src/gateway/Gateway.ts, main's lines 2044-2066. A sketch. Amended
// 2026-11-15: fingerprint and hash read the WebCrypto reference; the catchDefect goes.
const sha = Effect.fnUntraced(function* (bytes: Uint8Array) {
  const crypto = yield* WebCrypto.WebCrypto;
  return yield* Effect.tryPromise({
    // oxlint-disable-next-line fabrika/no-promises -- edge: WebCrypto hashes through a Promise
    try: () => crypto.subtle.digest("SHA-256", bytes),
    catch: (cause) => new LedgerError({ reason: "crypto", cause }),
  });
});
// Gateway.layer(options): Layer<Gateway, never, ...main's own>, unchanged
```

The two `fabrika/no-promises` edge lines at main's `Gateway.ts:2053` and `:2062` stay, as edges of
the reference's Promise (amended 2026-11-15; the first version removed them). The two
`crypto.getRandomValues` calls in `Gateway.ts` (main's `:719` and `:2042`) and all of
`GatewayNonce.ts` have no spy and stay; see "Not in this quest".

### The pausing layer the three gateway laws share

```ts
// next/packages/libfabrika/src/telemetry/Crypto.test-support.ts, new: gateway and telemetry both read
// it, so the exact layer row names the helper inside telemetry/. A sketch. Amended 2026-11-15: a
// stand-in crypto for the WebCrypto reference, in place of a Digest layer.
/** The real crypto, except the first digest of bytes that hold `marker` waits for `release`. */
export const paused = (marker: string, entered: () => void, release: Promise<void>): Crypto => {
  let once = false;
  return Stub.make<Crypto>(unexpected, {
    getRandomValues: (array) => globalThis.crypto.getRandomValues(array),
    subtle: Stub.make<SubtleCrypto>(unexpected, {
      digest: async (algorithm, data) => {
        if (!once && new TextDecoder().decode(data).includes(marker)) {
          once = true;
          entered();
          await release;
        }
        return globalThis.crypto.subtle.digest(algorithm, data);
      },
    }),
  });
};

/** A crypto whose digest keeps each body it is asked to hash, then rejects with `failure`. */
export const rejecting = (failure: unknown) => {
  const asked: Array<Uint8Array> = [];
  const crypto = Stub.make<Crypto>(unexpected, {
    subtle: Stub.make<SubtleCrypto>(unexpected, {
      digest: (_algorithm, data) => (asked.push(new Uint8Array(data)), Promise.reject(failure)),
    }),
  });
  return { asked, crypto };
};
```

`world()` and `setup()` take the crypto the doors are built with, `globalThis.crypto` by default,
and provide it with `WebCrypto.layer(...)`, so a law that pauses builds its doors on `paused(...)`.
Each law's wait for `entered` gets an `Effect.timeout`, so a hash that no longer goes through the
reference fails the law at once and does not hang it. The `try/finally` with `spy.mockRestore()`
goes, and with it the module-level patch that could leak into the next law (0061). The helper's
two Promise lines are marked `fabrika/no-promises` edges, as transport's `Rejecting.crypto` is, and
it uses `Stub.make` (reflect slice 8), never a double cast. If gateway, cloudflare and transport
end up with three like it, the review names one shared helper as a finding.

### The process id law, after `Id.Generator` reads `SecureRandom`

```ts
// next/packages/libfabrika/src/processes/ProcessIdGenerator.test.ts. A sketch. Amended 2026-11-15:
// Id.Generator.layer keeps its own random source (the lib-top ruling), so a SecureRandom provided
// from outside would never reach it. The law builds the generator from makeGenerator instead.
import { bytes, generatorWith, throws } from "../Id.test-support.ts";

const generator = (exitReason: "clock" | "entropy" | "exhausted", marker: string) =>
  generatorWith(exitReason === "entropy" ? throws(new Error(marker)) : bytes(255));
// ...pipe(Effect.provide(ProcessIdGenerator.layer), Effect.provide(generator(exitReason, marker)))
```

`generatorWith(fill)` is lib-top's helper: `Layer.effect(Id.Generator, Id.makeGenerator)` over
`SecureRandom.make(fill)` ([`mock-lib-top-PLAN.md`](./mock-lib-top-PLAN.md), "The shape"), so the
law states only the bytes. The `entropy` reason stays a typed `IdError`, as lib-top's plan keeps it.

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
        // Amendment 2026-11-15, ruling 2: the five methods with node's five messages.
        "fn": "A stand-in for a platform object is Stub.make; a watched call is a Recorder (0557, 0579).",
        "mock": "Give the code a service and provide a test layer (0555).",
        "doMock": "Give the code a service and provide a test layer (0555).",
        "spyOn": "Put the call behind a service and record it with a Recorder (0555, 0579).",
        "stubEnv": "Read through Config and provide a ConfigProvider layer (0555)."
      }
    ]
  }
}
```

No such block is on main at `e613fa45b`. If another folder's slice adds it first, this quest adds
its folders to that block and its plant lines to node's `VI_METHODS` set (amendment 2026-11-15,
ruling 2: one lock shape, node's M1 as every block's law). The rule is in oxlint 1.90.0, the installed
version (`node_modules/oxlint/configuration_schema.json`, `vitest/no-restricted-vi-methods`). `fn` is
in the list because 0579 makes the Recorder the replacement for `vi.fn`; these folders have none.

**Amendment (2026-11-16, lead ruling): the lock is a pair.** oxlint's
`vitest/no-restricted-vi-methods` does not refuse a call chained onto the `vi` call, in oxlint
1.90.0 (the lockfile's) and 1.93.0 alike: `vi.spyOn(console, "warn").mockImplementation(() => {})`
and `vi.fn().mockReturnValue(1)` pass, while the same call in parentheses is refused. The proof is
the last `false` lines of `VI_METHODS` in `oxlint-plugins/builtin-plants.ts` on
`fabrikalfa/mock-app-e2e-s1` at `f02b31948`, and the row
`field/runs/2026-11-15-mock-app-e2e-tests1.json`. So every block of the lock sets two of oxlint's
own rules over the same files: `vitest/no-restricted-vi-methods`, kept on as it is, and the
built-in `eslint/no-restricted-properties` with one `object: "vi"` entry for each member the
block bans, each with the same message as that member's entry in the vitest rule.
`no-restricted-properties` matches the member access `vi.spyOn` itself, so it refuses the call
with another call chained on; the vitest rule keeps what only it sees, such as `v.spyOn` after
`import { vi as v }`. Both are trusted rules, as
[0573](../../../.decisions/0573-trusted-lint-rule-replaces-ours.md) asks, and no rule of ours is
written. The upstream issue is [oxc#29656](https://github.com/oxc-project/oxc/issues/29656),
filed by the lead: `vitest/no-restricted-vi-methods` misses chained calls. The
`no-restricted-properties` half stays until oxc fixes it.

```jsonc
// .oxlintrc.json, the lock as a pair (amendment 2026-11-16, lead ruling). A sketch; one block, since the three folders take one set on main.
{
  "files": ["next/packages/libfabrika/src/gateway/**", "next/packages/libfabrika/src/telemetry/**"],
  "rules": {
    // Kept on as it is: the same members, with the same messages as below.
    "vitest/no-restricted-vi-methods": ["error", { /* fn, mock, doMock, spyOn, stubEnv */ }],
    "eslint/no-restricted-properties": [
      "warn",
      // Written out again, since an override replaces options: the `JSON.parse` entry and the four Reflect entries (`Reflect.get`, `Reflect.set`, `Reflect.has`, `globalThis.Reflect`), of the Reflect ban's warn block; slice 2 adds `processes/**`.
      { "object": "vi", "property": "fn", "message": "A stand-in for a platform object is Stub.make; a watched call is a Recorder (0557, 0579)." },
      { "object": "vi", "property": "mock", "message": "Give the code a service and provide a test layer (0555)." },
      { "object": "vi", "property": "doMock", "message": "Give the code a service and provide a test layer (0555)." },
      { "object": "vi", "property": "spyOn", "message": "Put the call behind a service and record it with a Recorder (0555, 0579)." },
      { "object": "vi", "property": "stubEnv", "message": "Read through Config and provide a ConfigProvider layer (0555)." }
    ]
  }
}
```

- **The `vi` entries join the list these files already take.** A block's options for a rule
  replace an earlier block's, they do not merge, and oxlint takes the last matching block's. So the
  lock's `no-restricted-properties` list writes out again every entry its files take today, at that
  block's level, and the lock's block sits after that block, the way the Reflect ban's blocks write
  out the `JSON.parse` entry (`.oxlintrc.json` on main at `b490a3203`). On main all three folders take the Reflect ban's `warn` block (`JSON.parse` and the four Reflect entries), so the lock is one block, as the sketch shows. At `warn`, a `vi`
  fire still blocks: `pnpm lint` lets only a `JSON.parse` fire of this rule advise
  (0523, the advice map `pnpm lint` reads). No file loses an entry, and no file gains one but the
  `vi` entries. Whichever slice lands later carries the entries the others landed first: another folder's `vi` entries, the `process.stdout` and `process.stderr` entries of the cloudflare plan's M13 (on these files but `*.test.ts`, the way M13 leaves test files out), or any new set.
- **The plant, red first.** The lock's law runs a second plant beside node's `VI_METHODS`:
  `VI_PROPERTIES`, under the code `eslint(no-restricted-properties)` as `REFLECT` is, in every
  path of every block that sets the vitest rule, through the same scenario. Refused:
  `vi.spyOn(console, "warn").mockImplementation(() => undefined)`, `vi.fn().mockReturnValue(1)`,
  and one plain call of each banned member. Taken: `vi.hoisted(() => 1)`, `vi.waitFor(() => 1)`,
  a comment, a string and `other.fn()`. A line is held by the lock when either plant refuses it.
  Red first: drop the block's `vi` entries from `no-restricted-properties`, and the two chained
  lines are not refused, so the law is red; with them back, it is green. The plants of the entries
  written out again, such as `REFLECT`, still pass in each locked path, which shows no entry was
  lost.
- **`VI_METHODS`' chained lines.** `VI_METHODS` keeps recording what the vitest rule does alone,
  so its chained lines stay `false` under its own code. They are no longer a miss of the lock: the
  pair refuses them, through `VI_PROPERTIES`.

## One value traced: C1 on the bucket archive

Amended 2026-11-15, on the `WebCrypto` reference:

1. The law draws `failure` (say `new TypeError("x")`) and `body` (say `[1, 2]`), builds
   `const r = rejecting(failure)`, and provides `Archive.bucket(calls)` with
   `WebCrypto.layer(r.crypto)`.
2. `archive.put("spans/1", body)` runs `sha256(body)`, which reads `WebCrypto.WebCrypto`, the law's
   stand-in, and calls `crypto.subtle.digest("SHA-256", [1, 2])`.
3. The stand-in pushes `[1, 2]` onto `r.asked` and rejects with `failure`.
4. `tryPromise`'s `catch` makes `SinkError { reason: "storage", cause: failure }`: a typed failure,
   with no defect made or caught. `put` stops before any bucket call.
5. The law sees `error.reason === "storage"` and `error.cause === failure`, as on main, and
   `r.asked` is exactly `[body]`: one hash, of exactly the body.

## Laws

Current rule for new or rewritten properties (0579, 0411): use `it.prop` or `it.effect.prop`
with Schema inputs. The `fc.*` names in the rows below describe the source read for this plan,
not a future runner choice. Keep every input range, size, run count, pinned case and failure
check. Keep a fast-check input only with an explicit nearby 0411 reason for unsupported data
or an edge case. Set the shared seed 119120 once in package setup, never on a law, and verify
that moving a runner keeps the same first failing case.

All five rewritten laws keep every value they compared on main. The source used hand runners
and seeds, including ErrorCause's; rewritten properties use `it.effect.prop` with Schema inputs
and the package setup seed (0579), preserving all input bounds, run counts and first failing cases.

| Law | Kind (lint, type or test?) | Generator | Plant | Where |
|---|---|---|---|---|
| M1. The three revocation laws, unchanged in what they check: a revoke inside the paused request hash is honored, through a stand-in crypto that pauses, handed in with `WebCrypto.layer` (amended 2026-11-15), and the pause is reached within a timeout | test | fc.asyncProperty: target, `revokeFirst`, token and text, as on main; seed 119120, 3 runs fast and 25 runs full | skip the grant recheck after the request hash in `Gateway.ts`: M1 red on `revokeFirst`. And hash with `globalThis.crypto.subtle` again, past the reference: M1 red at the pause's timeout | next/packages/libfabrika/src/gateway/GatewayRevocation.integration.test.ts |
| M2. C1: a digest that rejects is `storage` with the rejected value as its cause, on either archive and on `sha256` alone, with no defect, and the archive hashed exactly the body it was given, once (amended 2026-11-15: a rejection through the reference, as on main, not a defect) | test | fc.asyncProperty: `failure`, `body` and `onBucket`, as on main; seed 119120, 100 runs | main's plant (`fail` built with no cause): M2 red. Hash `body.slice(1)`: M2 red on `asked`. And `Effect.promise` in place of `tryPromise`, so the rejection dies: M2 red on its no-defect check | next/packages/libfabrika/src/telemetry/ErrorCause.test.ts |
| M3. `next dies on IdError <reason> and keeps process.next around id.next`, the same three cases with main's `Time`, `Count` and `marker` Schemas, through an `Id.Generator` built by lib-top's `generatorWith` (amended 2026-11-15) | test | Effect Arbitrary: Time | make `makeGenerator` draw from `globalThis.crypto` again: the `entropy` case does not die, M3 red; and provide `Id.Generator.layer` in place of `generatorWith(...)`: the `entropy` and `exhausted` cases do not happen, M3 red | next/packages/libfabrika/src/processes/ProcessIdGenerator.test.ts |
| M4. The lock, node's M1 (amendment 2026-11-15, ruling 2): `vi.fn`, `vi.mock`, `vi.doMock`, `vi.spyOn` and `vi.stubEnv` are refused in every folder of the block, with `vi` imported from `vitest` and from `@effect/vitest`, and `vi.useFakeTimers` passes; these lines join node's `VI_METHODS` set | lint | lint | delete one folder from the block: that folder's planted lines are not refused, M4 red. Amendment 2026-11-16 (lead ruling): the lock is the pair, and this law also runs `VI_PROPERTIES` (see the lock's amendment): drop the block's `vi` entries from `eslint/no-restricted-properties`, and its chained lines are not refused, red | oxlint-plugins/builtin-plants.ts, oxlint-plugins/plants.test.ts |
| M5. The product hashes these laws reach read `crypto` through `WebCrypto.WebCrypto`, never `globalThis.crypto`: with a stand-in handed in, `Archive.ts`'s and `Gateway.ts`'s hashes reach it (amended 2026-11-15; first a type law on `Digest`) | test | scenario: M1's and M2's own runs | read `globalThis.crypto.subtle` in `Archive.ts`: `asked` is empty and the real digest answers, M2 red; the same in `Gateway.ts`: M1 red at the pause's timeout | next/packages/libfabrika/src/telemetry/ErrorCause.test.ts, next/packages/libfabrika/src/gateway/GatewayRevocation.integration.test.ts |

- M4 also plants `import { vi as v } from "vitest"; v.spyOn(...)`, the form 0555 says the rule may
  miss. The law asserts what oxlint 1.90.0 does with it, and the run row records which. If it is not
  refused, this quest does not write a rule of its own for it: that is a finding row.
- M1 is in a `*.integration.test.ts` file because it opens a real `node:sqlite` database; it
  already is on main, and no stand-in replaces that here. It runs in this box (step rules allow an
  `.integration.` law the files reach). No law needs the owner's Mac, so none is host-only.
- No law reads a secret, so no `[secrets]` flow.
- **Amended 2026-11-15:** the 37 files that build an `Archive` or a `Gateway` layer change nothing.
  The first version had each provide `Digest.layerWebCrypto`; a `Context.Reference` needs no
  provide, so every caller keeps `globalThis.crypto`, as today.
- No law is loosened: M2 goes back to main's own claim (a rejection, typed), which the first
  version had turned into a defect.

## Files

Slice 1, after 1366: telemetry and the gateway.

| File | Owner | Product lines expected | Change |
|---|---|---|---|
Amended 2026-11-15: the `Digest` provides in 34 files (31 tests and 3 edges) are gone, since the
`WebCrypto` reference needs no provide.

| File | Owner | Product lines expected | Change |
|---|---|---|---|
| next/packages/libfabrika/src/telemetry/Archive.ts | build | 2 | `sha256` reads `WebCrypto.WebCrypto` in place of `globalThis.crypto`; its `tryPromise` keeps `SinkError` `storage` (amended 2026-11-15) |
| next/packages/libfabrika/src/gateway/Gateway.ts | build | 4 | `fingerprint` and `hash` read `WebCrypto.WebCrypto`; `LedgerError` `crypto` stays the `tryPromise`'s typed failure (amended 2026-11-15) |
| .oxlintrc.json | tests | 15 | the new block, with `gateway/**` and `telemetry/**` |
| layer-rules.json | tests | 1 | retarget only `next-crypto-test-support` to the telemetry helper path; preserve its imports and every other row |
| .patterns/effect-crypto-through-services.md | build | docs | with the write-pattern skill: the failure line corrected, the rule "a hash whose failure stays typed reads `crypto.subtle` through the `WebCrypto` reference" (amended 2026-11-15; was `catchDefect`), `Archive.ts` and the gateway's hashes out of "Not yet", the lock under "Holds it" |
| next/packages/libfabrika/src/telemetry/Crypto.test-support.ts | tests | tests | new (amended 2026-11-15; moved by the 2026-11-18 merger ruling): `paused` and `rejecting`, stand-in crypto objects on `Stub.make` |
| next/packages/libfabrika/src/gateway/GatewayRevocation.integration.test.ts | tests | tests | M1: `paused(...)` through `WebCrypto.layer`, `world`/`setup` take the crypto, the three spies go |
| next/packages/libfabrika/src/telemetry/ErrorCause.test.ts | tests | tests | M2: `digestRejects` becomes `rejecting(failure)` through `WebCrypto.layer`; the `vi` import goes |
| oxlint-plugins/builtin-plants.ts | tests | tests | M4: its lines join node's `VI_METHODS` set (amended 2026-11-15; was a `VI` plant of its own); and (amendment 2026-11-16, lead ruling) the `VI_PROPERTIES` plant, the lock's other half |
| oxlint-plugins/plants.test.ts | tests | tests | M4: node's M1 scenario, `VI_METHODS` refused exactly in every folder of every block that sets the rule |

Slice 2, after the top-level folder's `Id.Generator` change: processes.

| File | Owner | Product lines expected | Change |
|---|---|---|---|
| next/packages/libfabrika/src/processes/ProcessIdGenerator.test.ts | tests | tests | M3: `generator(...)` over lib-top's `generatorWith` (amended 2026-11-15); the spy and its `try/finally` go |
| next/packages/libfabrika/src/Id.test-support.ts | tests | tests | read only, not changed: lib-top's `generatorWith`, `bytes` and `throws` |
| .oxlintrc.json | tests | 1 | `processes/**` joins the block |

- `Archive.ts`, `ErrorCause.test.ts`, `ProcessIdGenerator.test.ts` and `GatewayRevocation.integration.test.ts`
  are not in 1366's diff, nor is `telemetry/Crypto.test-support.ts`. `Gateway.ts` is, and so are
  `cloudflare/runtime.ts`
  and `runtime/Runner.integration.test.ts`, which this quest no longer changes (amended 2026-11-15), and so are these in the three folders: `processes/ProcessManager.ts`, `ProgramMail.ts`,
  `ProgramMailLedger.ts`, `Quotas.ts`, `QuotasSql.ts`, `QuotasTest.ts`, `internal/programMail.test.ts`,
  `internal/quota.ts`, `internal/quota.test.ts`, `telemetry/QuotaRefusalTest.ts` and `telemetry/Sink.ts`.
  This quest changes none of those last eleven. Read with `pull_request_read get_files`, 57 files,
  one page, on 2026-11-15.
- Every product file stays where it is. The one new test helper (amended by the 2026-11-18 merger
  ruling) lives inside `telemetry/` and is read by gateway and telemetry tests. Its specific layer
  row names only that helper. `WebCrypto` and `SecureRandom` are Effect's, so the libfabrika test in
  `next/AGENTS.md` does not move anything.

## Waits

- **Slice 1 waits for pull request 1366** (P34c slice 4, a draft with red real-instance laws). It
  needs `Gateway.ts` (amended 2026-11-15: no longer `cloudflare/runtime.ts` or a provide in
  `Runner.integration.test.ts`). The plan's line numbers for `Gateway.ts` are main's at `e613fa45b` and move
  with 1366; the tests step re-reads them.
- **Slice 2 waits for the top-level folder's slice** (`libfabrika/src`: `Id`, `Id.cause`, `check`,
  9 `crypto.getRandomValues` spies on the same `entropy()` in `Id.ts:131`). `Id.ts` and its laws are
  that folder's, and the change to `Id.Generator` is one product change that both folders' laws
  read. That slice also needs `cloudflare/runtime.ts` and `cloudflare/connection.ts`, which build
  `Id.Generator.layer`, so it waits for 1366 as well.

## Calls taken

- **Stand-ins through Effect's own references, not the Recorder, where a law does not read calls,**
  85%. Four of the five spies are a gate or a failure; 0555 names "the service's own test layer" for
  a stand-in, and 0579 makes the Recorder the way to watch. **Amended 2026-11-15:** C1's read of the
  hashed body is the stand-in crypto's own list, since `WebCrypto` is a platform object, not an
  Effect service the Recorder can wrap.
- **A failed digest stays typed through the `WebCrypto` reference, with no `catchDefect`**
  (amendment 2026-11-15, merge session ruling 3, no longer a call; the `Digest` lean is marked
  wrong).
- **The process id law builds its generator with `generatorWith`** (amendment 2026-11-15, the
  lib-top ruling: `Id.Generator.layer` keeps its own random source, so a `SecureRandom` provided
  from outside would not reach it).
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

With concurrent workers, local safe test runs use `nice -n 19 pnpm exec vitest run
--maxWorkers=1` on the named narrow paths. Keep the repo's shared-resource caps. Planned doc
comments carry no `@stability` before the first release (0574); citations of Effect's own source
tags are historical source facts.

- The tests step: `pnpm format`, `pnpm lint` (with `NODE_OPTIONS=--max-old-space-size=6144` in a
  cloud box), then `nice -n 19 pnpm exec vitest run --maxWorkers=1` on
  `next/packages/libfabrika/src/telemetry/ErrorCause.test.ts`,
  `next/packages/libfabrika/src/gateway/GatewayRevocation.integration.test.ts` and
  `oxlint-plugins/plants.test.ts`. Each plant runs once and goes in the step's report.
- The build: the same narrow paths. The lead runs the changed-files test run and the one type
  check (amended 2026-11-15: no provides are left for it to read).
- The review runs the loosening check on the five rewritten laws.

## Steps

**Amendment (2026-11-15, merge session ruling 1): one pull request for the sweep.** Neither slice
opens a pull request of its own. Each lands on the mock sweep's one fold branch,
`fabrikalfa/mock-fold`, and in its one pull request (0589, amended 2026-11-15), after its own
steps, one fresh agent each, in its own box:

1. **Tests:** the slice's laws, the stand-in crypto support and the lock lines, each plant run once.
2. **Build:** slice 1 writes the two hashes' reads of the reference and the pattern doc. Slice 2 has
   no product file: its build changes nothing, says so, and runs the slice's checks green at the
   tests step's head (ruling 5).
3. **Review:** the one review of the slice's diff, with the loosening check.

## Size

Two slices, each landing whole on `fabrikalfa/mock-fold`, the sweep's one fold branch (amended
2026-11-15; first "two pull requests"). Confidence in the line counts: 80%; the doubt is how much
the pausing stand-in needs to type against `Crypto` through `Stub.make`.

1. Slice 1, telemetry and the gateway, after 1366: about 6 product lines (amended 2026-11-15; was
   49 with the provides), about 40 lines of config and docs, about 120 test lines across 3 test
   files. 6 lines.
2. Slice 2, processes, after the top-level slice: 1 config line and about 20 test lines. 1 lines.

Priced as the recorder plan priced its steps, from `field/runs/` for 2026-11-10 to 2026-11-15 at
list price: a tests step about $6, a build about $5, a review about $3, a fix round about $4.
Slice 1: tests $6 (3 files and the stand-ins), build $3 (two small reads and the doc), review $3,
one likely fix round $4. Slice 2: tests $3, a build that only runs checks $1, review $2.

Estimate: 7 steps, $22

## Records

- No new decision and no glossary row: this coins no word. The pattern doc changes in slice 1.
- The merge session's rulings of 2026-11-15 are amendments here: the typed digest through
  `WebCrypto`, M3 on `generatorWith`, one pull request for the sweep, and node's M1 for the lock.
  Its one open question was answered (see "Answered questions").
- 0555's "Consequences" counted 14 `crypto.subtle` and 11 `crypto.getRandomValues` spies in all of
  `next/`; this quest removes 4 and 1 of them.

## What this cannot tell us

- Whether any block here compiles. None was compiled or run.
- Whether `vitest/no-restricted-vi-methods` sees a renamed `vi` import; M4's plant finds out.
- What 1366 does to `Gateway.ts`'s hashes before it lands. If it adds a hash, slice 1 moves that
  one too.
- Whether the stand-in crypto types against `Crypto` and `SubtleCrypto` through `Stub.make` with no
  cast (amended 2026-11-15; this replaces the first version's doubt about catching a defect, which
  no longer happens). Transport's `Rejecting.crypto` meets the same question first.

## Open questions

None.

## Answered questions

**Amendment (2026-11-15, merge session ruling 3):** the one open question was answered: a failed
digest stays a typed error, through Effect's `WebCrypto` reference, with no `catchDefect`. The
lean's goal held (typed) and its means did not (`catchDefect` over `Digest`). The question is kept
as it was asked. The `SecureRandom` half is lib-top's, whose plan keeps `IdError` `entropy` typed.

1. **(Answered 2026-11-15: typed, through the `WebCrypto` reference.) A WebCrypto failure through Effect's `Digest` (and `SecureRandom`) is a defect: does our code
   keep it a typed error, or follow Effect?** Effect 4.1.3 gives these services a `never` error
   channel, so the known way is a defect. The approved no Promises note and the glossary row
   `crypto (reason)` say a crypto failure is typed with its own reason. Lean: keep it typed, by
   `Effect.catchDefect` at the one call (`SinkError` `storage` in the archive, `LedgerError`
   `crypto` in the gateway, `IdError` `entropy` in the top-level slice), 70%. It keeps laws C1 and
   M3 as strict as on main and walks no note back. The other branch makes each a defect: C1 and M3
   then assert the defect is the platform's own value, and the no Promises note's typed-reason rule
   is walked back for these two services.

## Existing tools

- `next/packages/libfabrika/src/telemetry/Crypto.test-support.ts` paused helper: searched the current
  GatewayRevocation.integration.test.ts pause gate and the installed WebCrypto Reference.
  Reuse its Deferred gate and BufferSource conversion through Stub.make, replacing only the
  global spy. Effect supplies the injected Reference, not this law's marker-specific gate.
- The same file's rejecting helper: searched telemetry/Archive.ts sha256, its ErrorCause law,
  the transport helper named by the earlier plan and the current source tree. No shared crypto
  test-support module exists on main. Reuse Stub.make and WebCrypto.layer; keep the rejected
  value and the exact asked-body list. No second hashing implementation is introduced.
- Id.test-support.ts generatorWith: searched and read Id.ts and the current test-support file.
  Reuse the lib-top slice's one generator helper rather than adding a second in this module.

## Current execution and input rule, 2026-11-17

Read the exact selected laws, their helpers and cleanup before local execution (0594). An older
no-host claim or test filename is not clearance. Any selected check reaching real process
signals, launchd or real Electron runs on eligible disposable CI before review; keep isolation
for other real resources where needed. Narrow the lead's local changed selection accordingly.
Bring a branch forward by an ordinary merge preserving both sides, never a history rewrite.

The shared crypto helper must keep the existing BufferSource view semantics. The current gate
uses ArrayBuffer.isView and copies only data.buffer with data.byteOffset and data.byteLength.
A DataView or subarray must not become an empty copy or include bytes outside that view.
The earlier helper sketch does not authorize either change. Keep the same generated byte
domains, gate, counts and typed failure behavior.
