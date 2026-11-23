Approved by the lead agent, builds issues 1752, 2053; body 1aebc164bf81
Plancheck-Version: 3

# Plan: @kalfa/secrets, sign with a given signing key (ticket 2053)

This is the kalfa packages (`kalfa/`), new work. It is not today's frozen version and not `next/`. The ticket is
https://github.com/kamp-us/tea-fabrika/issues/2053, and its parent is the settled protocol,
https://github.com/kamp-us/tea-fabrika/issues/1752 (closed). It makes the new package `kalfa/secrets/`, which today holds
only `GLOSSARY.md`: the core entry point `@kalfa/secrets`, the `/memory` store and the `/test` store laws. It lands as
four pull requests (`## Slices`). The first three say `Part of #2053`, the last says `Closes #2053`. Slice 3 (sign with a
given key) is the one that unblocks https://github.com/kamp-us/tea-fabrika/issues/1953 (the GitHub App login), so the
lead may start 1953 once slice 3 lands. This revision follows the lead's calls at signing (`## Lead's calls at signing
(2026-11-23)`).

Words: `kalfa/secrets/GLOSSARY.md`. Where 1752's sketch says "public half", this plan says "public key", as the later
answers on 1752 ruled. Every other new name is listed under `## New names`.

```ts
// The whole idea, a sketch. The seven caller cases in "Probes" were type-checked; the rest was not.
import { Secret, Secrets, SecretsSettings, Signature, SigningKey } from "@kalfa/secrets";
import * as SecretsMemory from "@kalfa/secrets/memory";

// Declared once, by the app. MayFetchSecret and MaySignWith are the app's Permissions classes:
// Context keys whose value (the proof) has an `object` text. Secrets imports nothing from Permissions.
const TurnKey = Secret.make("transport/turn-key", { fetch: MayFetchSecret });
const AppKey = SigningKey.given("github/app-key", {
  algorithm: Signature.rsaPkcs1v15Sha256,
  sign: MaySignWith,
  place: "memory", // the loosest place this key accepts
});

TurnKey.object; // "secret:transport/turn-key", the text the app's guard checks
const value = yield* TurnKey.pipe(MayFetchSecret.guard(subject, TurnKey.object));
// Redacted<string>; fails SecretMissing | SecretsUnavailable (| Denied | PermissionsUnavailable from the guard)

const signed = yield* AppKey.sign(bytes).pipe(MaySignWith.guard(subject, AppKey.object));
// { signature: Uint8Array, version: Version, algorithm: Signature.RsaPkcs1v15 }

// A library asks for a kind of key and names no permission (1953's appLogin).
declare function appLogin<R, E>(key: SigningKey.Any<Signature.RsaPkcs1v15, R, E>, appId: string):
  Effect<Redacted<string>, SecretMissing | SecretsUnavailable | E, R | Secrets.Secrets>;

// Wired once. `values` is what the app's own settings group gave for SecretsSettings.all.
Secrets.layer({ stores: [SecretsMemory.store], declared: [TurnKey, AppKey], settings: values });
// Layer<Secrets, RouteMissing | RouteRefused, Recorder | PublicKeys | SecretsMemory.Contents | Signer>
```

```toml
# The route, in the app's settings file: a name to a store and that store's item.
[[secrets.routes]]
name = "github/app-key"
store = "memory"
item = "app-key"
```

## Doubts, at the top

Each is a call this plan takes and builds on. Under 80% sure, it says what would settle it.

- **A name that comes from a setting is not built here, and that waits on the owner's word (lean: drop it from the
  protocol, 70%).** 1752's sketch says "a name is text or a setting that holds one". A route (`secrets.routes`) already
  lets each app point a name at any store and item, so a setting that holds the name is a second way to point somewhere
  else. It also makes the proof's `object` unknown until the app starts. Every declaration here takes a literal name, and
  `object` is a constant. The lead is asking the owner (open question 1). If he keeps the setting form, it is additive
  and comes as its own ticket: the declaration of that form has no `.object` (so no stale one can be passed), and the app
  spells it with `Secret.object(values.appKey)` from the value its own settings group already read, while Secrets
  compares against the name it resolved at start. It costs about 40 lines and a way to find a setting's value in the
  app's values.
- **The object is spelled `secret:<name>`, for secrets and signing keys alike (75%).** Decision 0057 says Secrets
  reads the proof's `object` and compares it with the secret it was asked for. Today's permission code spells an object
  `type:id` (`fabrika:demo`), so the object must carry a type word, and `@kalfa/permissions` names no type (decision
  0056). Secrets therefore fixes the word for its own objects: `secret`, because the glossary calls both kinds' names
  a "secret name". The doubt is whether `@kalfa/permissions`, not built yet, keeps `type:id` text; its build plan
  settles it, and a change here is one function, `Secret.object`.
- **Secrets wraps Effect's crypto behind its own small `Signer` service and its own algorithm values (75%).** Reasons:
  laws need a synchronous stand-in under `TestClock`, and `KeyFormat` is a set of plain functions on the `WebCrypto`
  reference that no service swaps; Effect's `crypto` modules are all `@stability unstable`, so holding them to one file
  (`Signer.ts`, a lint rule says so) keeps a bump to that file; and a public key kept on a ledger must be plain bytes
  anyway. The cost is about 65 lines and one more service at the edge. What would settle it: the lead's read; the probe
  shows Effect's crypto does all the package needs, so nothing forces the wrap but the test rig and the churn.
- **Names made at run time are not built (the lead's call).** No caller makes one yet. The ticket names a route by a
  name prefix, and 1752 asks the first build plan to show how such a name is listed in `declared`. This plan's answer is
  kept under "Left for the first caller of run-time names", so that caller's ticket starts from it. `secrets.routes`
  takes name routes only. Before v0.0.0 a saved-shape change wipes the data, so adding prefix routes later loses
  nothing.
- **`place` is required on a signing key (75%).** The ticket's `AppKey` sketch has none, and every store built first
  keeps a given key in memory, so a default would have to be `"memory"`, the loosest place. The glossary says a key
  *names* the loosest place it accepts, so the plan makes it name it. Making it optional later is additive. The lead's
  read settles it.

## What changes, in one paragraph

A new private workspace package, `@kalfa/secrets`, with three entry points. The root (`src/index.ts`) holds the
declarations (`Secret`, `SigningKey`), its own algorithm values (`Signature`), the `Signer` service and its live Layer
on Effect's crypto, the store's ports and `Store.make` and `Store.signingFromHeld`, the `Recorder` and `PublicKeys`
slots and their facts, the `Secrets` service and `Secrets.layer` with the start check, the settings, and the errors. It
imports `@kalfa/config` and nothing else of kalfa. `/memory` (`src/MemoryStore.ts`) is a store with all three ports, and
a recorder and public keys in memory; it imports no kalfa package. `/test` (`src/StoreTest.ts`) is the suite of laws
every store passes, so the later stores (`/env`, `/cloudflare`, `/keychain`, `/file`) run the same laws. Out of scope,
each its own ticket: `/ledger`, `/cloudflare`, `/env`, `/keychain`, `/file`, `/cli`, and generate and rotate on any
store but memory.

## Slices

Each slice is its own pull request, branched from main after the one under it lands, as the lead skill says.

1. **The store side.** Branch `fabrikalfa/kalfa-secrets` (this worktree). The package, its manifest, lint override,
   rank rows and lockfile; `SecretName`, `Version` and `StoreId`; `StoreFailed` and `RecordFailed`; the `Holds` port and
   `Store.make`; the `Recorder` with `Fetched`; the memory store's `Holds` and recorder; and `StoreTest.suite` with its
   `holds` laws. It lands whole: a store author builds a store against the ports, and the memory store passes the laws
   every later store will run.
2. **Declare, route and fetch a secret.** Branch `fabrikalfa/kalfa-secrets-fetch`. `Proof` and `object`, the caller's
   errors, `Secret`, the `Secrets` service, `Secrets.layer` with the start check, the `declared` check and the proof
   check, the fetch, and `secrets.routes`. It lands whole: an app declares a secret, routes it, and fetches it, recorded,
   and a wrong route stops the start.
3. **Sign with a given key: the slice that unblocks 1953.** Branch `fabrikalfa/kalfa-secrets-sign`. `Signature`,
   `Signer` and its live Layer, the `Signs` port, `PublicKeys`, the `Signed` and `Rotated` facts, `SigningKey.given` and
   `SigningKey.Any`, the place check, `sign`, `publicKey`, `publicKeys`, and the memory store's `Signs` and public keys.
   It lands whole: 1953 can sign its App login with a key held in memory.
4. **Generate and rotate, sign with a held key, keep time, a secret's schema, old keys readable.** Branch
   `fabrikalfa/kalfa-secrets-generate`. `SigningKey.make` with `generate` and `rotate`, the `Generates` port,
   `Store.signingFromHeld`, `Generated`, `NameTaken` and `StoreCannot`, the memory store's `Generates`;
   `secrets.fetch.keep`, `secrets.public-keys.readable`, a secret's `schema` and `SecretMalformed`. It closes the ticket.

## Searched first

- The ticket and its one comment (1953 is blocked by this ticket, not the other way). The parent 1752 whole, with every
  comment: Transport's TURN key, Permissions' input, the resolution of 2026-11-21, Leak guard leaving (0059), the gaps
  comment, decision 0074's laptop key, 1870's `Unavailable` naming, 1891's five answers (declarations as a list,
  `PublicKeys` as its own slot, the command's recording, `names` from routes, "public key" as the word), and 1901's
  answer on rotation.
- https://github.com/kamp-us/tea-fabrika/issues/1953 (what the first caller needs) and the `@kalfa/github` protocol,
  https://github.com/kamp-us/tea-fabrika/issues/1753 (the key is an argument; GitHub ranks above Secrets).
- https://github.com/kamp-us/tea-fabrika/issues/1768, Permissions' protocol: a permission class is the key of its
  proof, the guard pipes on, a proof is sealed and is never saved.
- Decisions 0015, 0047, 0048, 0049, 0050, 0056, 0057, 0058, 0063, 0074, 0084, 0089, 0091 and 0092 whole.
- `kalfa/AGENTS.md`, `kalfa/secrets/GLOSSARY.md`, `kalfa/permissions/GLOSSARY.md`.
- `rg -il` over `.kalfa/decisions`, `.kalfa/glossary`, `.kalfa/patterns`, `.kalfa/runbooks` for "secret", "signing
  key|private key|public key", "proof|object", "route", "redact", "crypto|webcrypto|subtle", "testclock". Read every
  hit about kalfa. Patterns read: `effect-crypto-through-services.md`, `effect-services-and-layers.md`,
  `effect-errors-keep-their-cause.md`, `settings.md`, `effect-tests-run-in-it-effect.md`.
- The sibling packages, for layout and wiring: `kalfa/github/` (manifest, both tsconfig files, its lint override, its
  package law, its settings file, the plan files `.kalfa/quests/kalfa-github-operation-PLAN.md` and
  `.kalfa/quests/kalfa-github-token-PLAN.md`, whose leak law over URLs, spans, logs, rendered errors and error
  properties is the model for this plan's X laws), `kalfa/config/` (its root `Setting` and `SettingGroup`, the
  `Effectable` group, the plain-data rule), and `kalfa/git/` (no build step, a `/memory` adapter, and a shared suite
  exported as `/test` with optional vitest peers).
- Today's permission code in `next/packages/libfabrika/src/permissions/Rebac.ts`, as a map only: an object is a
  `type:id` ref, and a proof carries the object it checked.
- `layer-rules.json`, `boundary-rules.json`, `oxlint-plugins/layers.test.ts` (its pinned ranks), the kalfa Effect block
  and the `@kalfa/github` override in `.oxlintrc.json`, and `tsconfig.base.json` (Effect's `unstableApiUsage` is off
  outside the locked folders, and `kalfa/` is not one of them).
- Installed versions in `pnpm-lock.yaml`: `effect` and `@effect/vitest` 4.1.3 (the repo's patch of Effect touches only
  the arbitrary model and `TestConsole`, not crypto), `vitest` 5.0.5, TypeScript 7.0.2 with `@effect/tsgo` 0.63.0,
  `fast-check` 4.10.2. In Effect 4.1.3, read whole: `src/crypto/Signature.ts`, `KeyFormat.ts` (decode, encode, PEM,
  PKCS#1), `CryptoError.ts`, `WebCrypto.ts`, `Digest.ts`, `internal/key.ts`, `internal/webCrypto.ts`; and
  `Context.Key` (covariant, an Effect of its value), `Effectable.Prototype`, `Redacted.make` with its `label`.
- The law id check (`node oxlint-plugins/law-ids.ts`) ran clean on this worktree. `kalfa/secrets/` has no laws yet, so
  every id this plan uses is free in its package.

## Probes run while planning

Two throwaway probes in a scratch folder outside the repo, run against this worktree's installed modules. Nothing was
written into the repo, installed or committed.

- **Effect's crypto on Node 26.13.0.** An RSA 2048 key made by `node:crypto`, exported as PKCS#1 PEM (the form GitHub
  hands out) and as PKCS#8 PEM. `KeyFormat.decodePrivate(KeyFormat.pem(KeyFormat.pkcs1), Signature.rsaPkcs1v15Sha256,
  text)` and the PKCS#8 form both read it. Their RS256 signatures equal `node:crypto`'s byte for byte, the public key's
  SPKI from `Signature.toBytes` equals Node's, `verify` says true, and a changed byte says false. The decoded key's
  `algorithm.modulusLength` is 2048, though `rsaPkcs1v15Sha256` says 3072: Effect takes the imported key's real size.
  Malformed PKCS#1, plain text, PKCS#8 read as PKCS#1, and an Ed25519 key read as RSA each fail one `CryptoError`
  (`Malformed PKCS#1 RSAPrivateKey`, `Expected exactly one PEM block labelled ...`, `Invalid key data`); none of their
  rendered causes held the input's text or its base64. An RSA 3072 generate took 38 ms and 20 RSA 2048 signs took
  11 ms, so speed is no reason for a stand-in.
- **The caller types on TypeScript 7.0.2.** Seven cases passed with `tsc` over a sketch of the declarations: a given
  RSA key passed to `appLogin` shows `MaySignWith` in the result's needs and dropping it does not compile; the piped
  guard removes it and adds `Denied`; an Ed25519 key is refused where RSA is asked; a given key has no `generate`; a
  proof key whose value has no `object` does not compile; a name ending in `/` gives a family whose `member` is a
  generated key, and a family has no `sign` (families are not built; see the lead's calls); a key typed with its own
  error passes it into the library's errors.

## How others do it

- **Go's `crypto.Signer`** (from memory, not fetched): an interface with `Public()` and `Sign(rand, digest, opts)`, so a
  private key in a hardware module and one in memory look the same to a caller. That is the `Signs` port, and a
  declaration's `sign`.
- **AWS KMS** (read for 1752, not fetched again): `Sign` takes a key id and a message, the private key never leaves,
  the answer names the key, each call is logged, and the key policy gates each key on its own. That is the record per
  use and the proof per object (0057).
- **HashiCorp Vault's transit engine** (from memory, not fetched): sign with a named key, the signature carries the key
  version (`vault:v1:...`), rotation adds a version, and old versions stay readable for checks. That is `Signed.version`
  and `publicKeys`.
- **Erlang/OTP** (from memory, not fetched): `public_key:sign/3` signs with a key the caller holds, and `ssh`'s
  `ssh_client_key_api` is a behaviour a key store implements, called by the protocol code. That is the store's ports,
  one behaviour per ability. OTP has no secret-fetch module; nothing in this ticket waits or is supervised.
- **Elm** (from memory): a secret comes in as a flag at start and effects stay at the edge; no package names keys. The
  nearest lesson is the shape: a declaration is plain data, and only a `Cmd` does the work. Here a declaration is a value
  and only the `Secrets` service reaches a store.
- **Effect** (read in 4.1.3): `Redacted` hides a value from `String`, JSON and inspect; `crypto/Signature` signs,
  verifies, makes key pairs and computes a public key, and keys show only their algorithm; `KeyFormat` reads PKCS#1,
  PKCS#8 and SPKI. The plan uses all of them behind `Signer`.

## The shape

### The package

```text
kalfa/secrets/
  package.json        @kalfa/secrets, private; exports ".", "./memory", "./test", "./package.json"; no build step, as @kalfa/git
  tsconfig.json       as kalfa/github's, with the Effect checks
  README.md           declare, route, fetch, sign, wire; the memory store; the store laws; what never shows a value; Effect's crypto
  GLOSSARY.md         the words, with Recorder and Keep time added
  src/
    index.ts          the root entry point: re-exports the modules below as namespaces, and the errors
    Name.ts           SecretName, Version, StoreId, Proof, object
    Signature.ts      the algorithm values: rsaPkcs1v15Sha256, ed25519, their types and names
    Signer.ts         the Signer service, PrivateKey, and its live Layer on Effect's crypto (the only file that imports effect/crypto)
    Errors.ts         SecretMissing, SecretsUnavailable, SecretMalformed, NameTaken, StoreCannot, RouteMissing, RouteRefused, StoreFailed, RecordFailed
    Store.ts          Place, the three ports, Found and Missing, Store.make, Store.signingFromHeld
    Recorder.ts       the Recorder slot and its four facts
    PublicKeys.ts     the PublicKeys slot and PublicKey
    Secret.ts         Secret.make
    SigningKey.ts     SigningKey.given, SigningKey.make, SigningKey.Any, Signed
    Secrets.ts        the Secrets service and Secrets.layer
    Settings.ts       secrets.routes, secrets.fetch.keep, secrets.public-keys.readable; all; Values
    internal/start.ts the start check: routes, stores, declared
    internal/use.ts   fetch, sign, publicKey, publicKeys, generate, rotate, with the proof and declared checks
    MemoryStore.ts    the /memory entry point
    StoreTest.ts      the /test entry point: the laws every store passes (the tests step's)
```

```jsonc
// kalfa/secrets/package.json, a sketch. No rslib and no publishConfig: the package is private, as @kalfa/git is.
{
  "name": "@kalfa/secrets", "version": "0.0.0", "private": true, "type": "module",
  "scripts": { "typecheck": "tsc --noEmit" },
  "exports": { ".": "./src/index.ts", "./memory": "./src/MemoryStore.ts", "./test": "./src/StoreTest.ts", "./package.json": "./package.json" },
  "dependencies": { "@kalfa/config": "workspace:*" },
  "peerDependencies": { "effect": "catalog:", "@effect/vitest": "catalog:", "vitest": "catalog:" },
  "peerDependenciesMeta": { "@effect/vitest": { "optional": true }, "vitest": { "optional": true } },
  "devDependencies": { "@effect/platform-node, @effect/vitest, @types/node, effect, typescript, vitest": "catalog:" },
  "engines": { "node": ">=26" }
}
```

### Names and the object

```ts
// kalfa/secrets/src/Name.ts, a sketch.
/** "transport/turn-key": lowercase segments of letters and digits with single hyphens, joined by "/", at most 256. */
export const SecretName = Schema.String.check(Schema.isPattern(NAME), Schema.isMaxLength(256)).pipe(Schema.brand("@kalfa/secrets/SecretName"));
/** A store's own label for one value or one signing key that a name has held. Non-empty, at most 128. */
export const Version = Schema.NonEmptyString.check(Schema.isMaxLength(128)).pipe(Schema.brand("@kalfa/secrets/Version"));
/** A store's id in a route: "memory", "env". One lowercase word, hyphens allowed. */
export const StoreId = Schema.String.check(Schema.isPattern(/^[a-z][a-z0-9]*(-[a-z0-9]+)*$/u)).pipe(Schema.brand("@kalfa/secrets/StoreId"));

/** What Secrets reads from a proof: the object its check was for. Any value with this field counts (0057). */
export interface Proof { readonly object: string }
/** The object a permission check names for one secret or signing key. */
export const object = <N extends string>(name: N): `secret:${N}` => `secret:${name}`;
```

### Declarations

```ts
// kalfa/secrets/src/Secret.ts and SigningKey.ts, a sketch. Doc blocks left out.
type Literal<N extends string> = string extends N ? never : IsUnion<N> extends true ? never : N; // a name is written in code
export type Place = "store" | "runtime" | "memory"; // tight to loose

export interface Secret<N extends string, A, I>
  extends Effect<Redacted<A>, SecretMissing | SecretsUnavailable, I | Secrets> { // yielding it is the fetch
  readonly _tag: "Secret";
  readonly name: N;
  readonly object: `secret:${N}`;
}
export const make: <const N extends string, I>(
  name: Literal<N>,
  options: { readonly fetch: Context.Key<I, Proof> },
) => Secret<N, string, I>;
// slice 4: options.schema (Schema.Codec<A, string>) adds SecretMalformed to the errors.

export interface SigningKey<A extends Signature.Algorithm, R, E = never> {
  readonly _tag: "SigningKey";
  readonly name: SecretName;
  readonly object: string;
  readonly algorithm: A;
  readonly place: Place;
  readonly sign: (bytes: Uint8Array) => Effect<Signed<A>, SecretMissing | SecretsUnavailable | E, R | Secrets>;
  readonly publicKey: Effect<PublicKeys.PublicKey, SecretMissing | SecretsUnavailable, Secrets>;
  readonly publicKeys: Effect<ReadonlyArray<PublicKeys.PublicKey>, SecretsUnavailable, Secrets>; // newest first, no proof
}
/** The kind of key a library asks for: any signing key of that algorithm, with the caller's needs and errors. */
export type Any<A extends Signature.Algorithm, R, E> = SigningKey<A, R, E>;
export interface Signed<A extends Signature.Algorithm> {
  readonly signature: Uint8Array;
  readonly version: Version;
  readonly algorithm: A;
}
export interface Given<N extends string, A extends Signature.Algorithm, I> extends SigningKey<A, I> {
  readonly kind: "given";
  readonly object: `secret:${N}`;
}
export interface Generated<N extends string, A extends Signature.Algorithm, I, J> extends SigningKey<A, I> { // slice 4
  readonly kind: "generated";
  readonly object: `secret:${N}`;
  readonly generate: Effect<PublicKeys.PublicKey, NameTaken | StoreCannot | SecretsUnavailable, J | Secrets>;
  readonly rotate: Effect<PublicKeys.PublicKey, SecretMissing | StoreCannot | SecretsUnavailable, J | Secrets>;
}
export const given: <const N extends string, A extends Signature.Algorithm, I>(
  name: Literal<N>,
  options: { readonly algorithm: A; readonly sign: Context.Key<I, Proof>; readonly place: Place },
) => Given<N, A, I>;
// slice 4: make(name, { algorithm, sign, rotate, place }) => Generated; generate shares rotate's proof key (1752).
```

A declaration is plain data plus calls on the `Secrets` service. `sign` reads the proof with `yield* options.sign`, so
the proof key's identifier is in `R` and the app's guard removes it. A secret is an `Effect` through
`Effectable.Prototype`, as `@kalfa/config`'s group is. `make` throws at module load for a name `SecretName` refuses,
naming the rule and the name, as `SettingGroup.make` throws for a bad group.

### The store's side

```ts
// kalfa/secrets/src/Store.ts, a sketch.
export type Found<A> = { readonly _tag: "Found"; readonly value: A };
export type Missing = { readonly _tag: "Missing"; readonly reason: "absent" | "kind" | "algorithm" };
export type Held = Found<{ readonly value: Redacted<string>; readonly version: Version }> | Missing;

export interface Holds<Item, R> { readonly read: (item: Item) => Effect<Held, StoreFailed, R> }
export interface Signs<Item, R> { // slice 3
  readonly sign: (item: Item, algorithm: Signature.Algorithm, bytes: Uint8Array)
    => Effect<Found<{ readonly signature: Uint8Array; readonly version: Version }> | Missing, StoreFailed, R>;
  readonly versions: (item: Item, algorithm: Signature.Algorithm)
    => Effect<Found<ReadonlyArray<PublicKeys.PublicKey>> | Missing, StoreFailed, R>; // newest first
}
export interface Generates<Item, R> { // slice 4
  readonly generate: (item: Item, algorithm: Signature.Algorithm) => Effect<PublicKeys.PublicKey, StoreFailed | ItemTaken, R>;
  readonly rotate: (item: Item, algorithm: Signature.Algorithm) => Effect<Found<PublicKeys.PublicKey> | Missing, StoreFailed, R>;
}
export interface Store<Id extends string, Item, R> {
  readonly id: Id;
  readonly item: Schema.Codec<Item, string>;
  readonly place: Place;
  readonly holds?: Holds<Item, R>;
  readonly signs?: Signs<Item, R>;
  readonly generates?: Generates<Item, R>;
}
export const make: <const Id extends string, Item, R>(options: Store<Id, Item, R>) => Store<Id, Item, R>;
/** A store that only holds can sign: the private key is read into memory from the held text for each signing. (slice 4) */
export const signingFromHeld: <Id extends string, Item, R>(store: Store<Id, Item, R>) => Store<Id, Item, R | Signer>;
```

1752 sketched the answers as `Option`. A tagged `Missing` with a reason keeps what a person must fix ("nothing there",
"the other kind", "another algorithm"), which `SecretMissing` carries on (80%). An empty held text is `absent`: an
environment variable set to nothing is not a secret (85%).

### The slots

```ts
// kalfa/secrets/src/Recorder.ts and PublicKeys.ts, a sketch.
export class Fetched extends Schema.TaggedClass<Fetched>()("Fetched", { name: SecretName, store: StoreId, version: Version }) {}
export class Signed extends Schema.TaggedClass<Signed>()("Signed", { name: SecretName, store: StoreId, version: Version }) {}   // slice 3
export class Rotated extends Schema.TaggedClass<Rotated>()("Rotated", { name: SecretName, store: StoreId, version: Version }) {} // slice 3
export class Generated extends Schema.TaggedClass<Generated>()("Generated", { name: SecretName, store: StoreId, version: Version }) {} // slice 4
export type Fact = Fetched | Signed | Generated | Rotated;
// slice 4: Fetched gains from: "store" | "kept".
export class Recorder extends Context.Service<Recorder, {
  readonly record: (fact: Fact) => Effect<void, RecordFailed>;
}>()("@kalfa/secrets/Recorder") {}

export const PublicKey = Schema.Struct({ version: Version, algorithm: Signature.AlgorithmName, spki: Schema.Uint8ArrayFromBase64Url });
export class PublicKeys extends Context.Service<PublicKeys, {
  readonly keep: (name: SecretName, key: PublicKey) => Effect<void, RecordFailed>; // keeping a kept version again changes nothing
  readonly read: (name: SecretName) => Effect<ReadonlyArray<PublicKey>, RecordFailed>; // in the order kept
}>()("@kalfa/secrets/PublicKeys") {}
```

The fact `Recorder.Signed` and the result `SigningKey.Signed` share the ticket's word; each lives in its own module, so
they never meet unqualified (85%).

### `Secrets.layer` and the start check

```ts
// kalfa/secrets/src/Secrets.ts, a sketch.
export class Secrets extends Context.Service<Secrets, Use>()("@kalfa/secrets/Secrets") {} // Use: internal/use.ts's calls
export const layer: <const S extends ReadonlyArray<Store.Any>>(options: {
  readonly stores: S;
  readonly declared: ReadonlyArray<Declared>; // secrets and signing keys
  readonly settings: SecretsSettings.Values;
}) => Layer<Secrets, RouteMissing | RouteRefused, Recorder | PublicKeys | Store.Needs<S[number]>>;
```

The ticket's sketch names `ConfigError` in the layer's errors and takes no settings. Here the layer takes the values the
app's own settings group already checked, as `GitHubLive.layer` does (`kalfa/github/src/Settings.ts`, its header): a wrong
value stops the group's start with its file and line, so the layer has no settings failure of its own (85%).

The start, in a span `secrets.layer`, in this order, failing on the first problem in `declared` order as
`@kalfa/config` fails on the first one (85%):

1. Two stores with one id, or two declarations with one name, die: a fault in code, not in data. The same declaration
   listed twice is one.
2. For each declaration: find its route by exact name. None is `RouteMissing { name }`.
3. The route's store is one of `stores`, else `RouteRefused { reason: "store" }`.
4. The route's item decodes with the store's `item`, else `RouteRefused { reason: "item" }`.
5. The store has every port the declaration needs (a secret: `holds`; a given key: `signs`; a generated key: `signs`
   and `generates`), else `RouteRefused { reason: "port", port }`.
6. A signing key's store place is no looser than the key's (`store` < `runtime` < `memory`), else
   `RouteRefused { reason: "place", place }`.

Every message names the name, the store and the item, which are public, and never a value. A route for a name nobody
declared is left alone: `kalfa secrets names` lists routes, and an app may carry routes for another app.

### Each use

Each call runs in its own span (`secrets.fetch`, `secrets.sign`, `secrets.public-key`, `secrets.public-keys`,
`secrets.generate`, `secrets.rotate`) with `kalfa.secrets.name`, `kalfa.secrets.store` and, once known,
`kalfa.secrets.version`, made with `Effect.fn` and `Effect.annotateCurrentSpan` (decision 0063). Before anything:

- The declaration must be in `declared`, by reference, else it dies naming the name. A check by name would let an undeclared copy through.
- The proof's `object` must equal `Secret.object(name)`, else it dies naming both. Generate and rotate read the
  `rotate` proof key's proof.

Then:

- **Fetch:** `read` the routed item; `Missing` is `SecretMissing { name, store, item, reason }`; record
  `Fetched { name, store, version }`; return `Redacted.make(value, { label: name })`. A store failure is
  `SecretsUnavailable { name, store, reason: StoreFailed }` and writes nothing; a recorder failure is
  `SecretsUnavailable { reason: RecordFailed }` and the value is dropped. Nothing is kept between fetches until slice 4.
- **Sign:** `sign` the routed item; on a version this process has not kept yet, read `PublicKeys`; if it lacks the
  version, read the store's `versions`, `keep` the version's public key, and when older versions were kept, record
  `Rotated` first (a person rotated it in the store); then record `Signed`; then return `{ signature, version,
  algorithm }`. Any failure on the way gives no signature. Two processes that keep the same version at once both
  keep it, which `keep` takes as one; both may record a `Rotated` (see "What this cannot tell us").
- **publicKey:** the store's newest version. **publicKeys:** the kept ones newest first, with the store's newest at the
  front if it was never kept; slice 4 trims the list to `secrets.public-keys.readable`.
- **Generate** (slice 4): `generate` the routed item; `ItemTaken` is `NameTaken`; record `Generated`; return the public
  key. A recorder failure after the store changed is `SecretsUnavailable { reason: RecordFailed }`, and the error carries
  the new public key, so the caller knows the key was made and not recorded, as 1891 rules for the command (80%).
- **Rotate** (slice 4): `rotate`; keep the new version's public key; record `Rotated`; return it.

### `Signer` and Effect's crypto

```ts
// kalfa/secrets/src/Signer.ts, a sketch. The only file of the package that imports effect/crypto (lint L3).
declare const PrivateKeyId: unique symbol;
/** A private key in our own process. It shows only its algorithm through String, JSON and inspect. */
export interface PrivateKey { readonly [PrivateKeyId]: typeof PrivateKeyId; readonly algorithm: Signature.Algorithm }

export class Signer extends Context.Service<Signer, {
  readonly read: (algorithm: Signature.Algorithm, text: Redacted<string>) => Effect<PrivateKey, KeyRefused>; // PKCS#8 or PKCS#1 PEM
  readonly generate: (algorithm: Signature.Algorithm) => Effect<PrivateKey>;
  readonly sign: (key: PrivateKey, bytes: Uint8Array) => Effect<Uint8Array>;
  readonly verify: (key: PublicKeys.PublicKey, signature: Uint8Array, bytes: Uint8Array) => Effect<boolean>;
  readonly publicKey: (key: PrivateKey, version: Version) => Effect<PublicKeys.PublicKey>;
  readonly fingerprint: (key: PrivateKey) => Effect<Version>; // "sha256:" and the base64url SHA-256 of the SPKI bytes
}>()("@kalfa/secrets/Signer") {}

/** On Effect's Signature.layerWebCrypto, SecureRandom.layerWebCrypto, Digest and KeyFormat, all on the WebCrypto reference. */
export const layer: Layer<Signer>;
```

`KeyRefused` is internal: `Store.signingFromHeld` turns it into `Missing { reason: "kind" }`, and the memory store's
seed dies on it. It keeps the `CryptoError` as its cause, as the errors pattern asks; the probe found no input text in
those causes, and leak law X5 holds that against the live `Signer` (80%). A sign, verify or generate failure on a key
`read` or `generate` gave is a defect. `layer` provides Effect's own WebCrypto Layers inside itself, as `Id.Generator.layer`
does, so the edge does not need to name Effect's unstable tags; the `WebCrypto` reference still swaps the platform
object under it (80%).

`Signature.ts` holds plain data, so a setting, an entry and a public key can name an algorithm:

```ts
// kalfa/secrets/src/Signature.ts, a sketch.
export interface RsaPkcs1v15 { readonly _tag: "RsaPkcs1v15"; readonly name: "rsaPkcs1v15Sha256"; readonly hash: "SHA-256" }
export interface Ed25519 { readonly _tag: "Ed25519"; readonly name: "ed25519" }
export type Algorithm = RsaPkcs1v15 | Ed25519;
export const rsaPkcs1v15Sha256: RsaPkcs1v15 = { _tag: "RsaPkcs1v15", name: "rsaPkcs1v15Sha256", hash: "SHA-256" };
export const ed25519: Ed25519 = { _tag: "Ed25519", name: "ed25519" };
export const AlgorithmName = Schema.Literals(["rsaPkcs1v15Sha256", "ed25519"]);
```

The names are Effect's own `name` values, held equal by law C3. Other hashes and curves join when a caller needs them.

### The memory store

```ts
// kalfa/secrets/src/MemoryStore.ts, a sketch: the /memory entry point. It imports no kalfa package.
export class Contents extends Context.Service<Contents, {
  readonly put: (item: string, value: string) => Effect<void>;                                          // a person puts a value in
  readonly putKey: (item: string, algorithm: Signature.Algorithm, text: Redacted<string>) => Effect<void>; // and a given key (slice 3)
  readonly remove: (item: string) => Effect<void>;
}>()("@kalfa/secrets/memory/Contents") {}
export const layer: (seed?: { values?: Record<string, string>; keys?: Record<string, { algorithm; text }> }) => Layer<Contents, never, Signer>;
export const store: Store.Store<"memory", string, Contents | Signer>; // place "memory", holds, signs, generates
export class Recorded extends Context.Service<Recorded, { readonly facts: Effect<ReadonlyArray<Recorder.Fact>> }>()("@kalfa/secrets/memory/Recorded") {}
export const recorder: Layer<Recorder.Recorder | Recorded>;
export const publicKeys: Layer<PublicKeys.PublicKeys>;
```

The ticket left open which place the memory store takes and whether its keys are held or generated in the process. The
call (90%): its place is `"memory"`, because its private keys are `Signer.PrivateKey` objects in our process, and calling
it anything tighter would let a key that refuses memory sit there. An item holds a value or a key, never both, and each
put makes a new version, counted per item. A key is read into a `PrivateKey` when it is put, so it signs inside the
store (its `signs` port), and `generate` makes one with `Signer.generate`. A key that refuses memory (`place: "store"`
or `"runtime"`) is refused at start with the memory store, which is law R4's case.

### Settings

```ts
// kalfa/secrets/src/Settings.ts, a sketch.
const NameRoute = Schema.Struct({ name: SecretName, store: StoreId, item: Schema.NonEmptyString });
export const routes = Setting.make("secrets.routes", Routes /* the array, refusing two routes for one name */).pipe(
  Setting.withDefault([]), Setting.withDescription("Which secret store and item each secret name points to."));
export const keep = Setting.make("secrets.fetch.keep", Wait).pipe(Setting.withDefault("0 seconds"), ...);          // slice 4
export const readable = Setting.make("secrets.public-keys.readable", Readable /* "all" or 1 and up */).pipe(
  Setting.withDefault("all"), ...);                                                                                  // slice 4
export const all = [routes, keep, readable] as const;
export type Values = Pick<SettingGroup.Values<typeof all>, "routes" | "keep" | "readable">;
```

Each value is plain data (decision 0089): the keep time is text, decoded with `Schema.DurationFromString` where it is
read.

### Left for the first caller of run-time names

Not built (the lead's call at signing). The ticket names a route by a name prefix, and 1752 asks the first build plan to
show how a name made at run time is listed in `declared`. This is the shape that caller's ticket starts from, a sketch:

```ts
const ClientKeys = SigningKey.make("identity/client/", { algorithm: Signature.ed25519, sign: MaySignAsClient, rotate: MayManageKeys, place: "memory" });
// a name ending in "/" would make a family, with no sign of its own; `declared` lists the family
const key = ClientKeys.member(Schema.decodeSync(NamePart)("laptop-7f3a")); // a key named "identity/client/laptop-7f3a"
```

A member would be checked as its family: in `declared` by the family's reference, routed by a prefix route
(`prefix = "identity/client/"`, `item = "client-"`, so the member's item is `client-laptop-7f3a`), its proof for its own
full name, and a store would say it takes such items, so one that cannot is refused at start. The type probe above
checked that a name ending in `/` can give such a family. Until then `secrets.routes` takes name routes only, and a
name that `SecretName` refuses, a trailing `/` included, stops at module load.

## Effect's `crypto/Signature`: what the package leans on, and how a bump shows

Every module in `effect/crypto` is marked `@stability unstable` in 4.1.3, so a minor release may change it. Only
`src/Signer.ts` imports it, and lint L3 refuses `effect/crypto` and its subpaths in every other file of the package, so
a change lands in one file. What that file uses:

| Effect 4.1.3 | What for |
|---|---|
| `Signature.Signature`: `sign`, `verify`, `generateKeyPair`, `publicKeyOf`; `Signature.layerWebCrypto` | sign, check, make, and the public key |
| `Signature.rsaPkcs1v15Sha256`, `Signature.ed25519` | the mapping from our algorithm values |
| `KeyFormat.decodePrivate` with `pem(pkcs8)` and `pem(pkcs1)`; `decodePublic(spki)`; `encode(spki, key)` | reading a held key, checking against a kept public key, and the SPKI bytes |
| `SecureRandom.layerWebCrypto`, `Digest` with `sha256` | key making, and the fingerprint a held key's version is |
| `CryptoError` and its `reason._tag` | the cause kept in `KeyRefused` |

How a bump shows, loudly and in this file only:

- **A rename or a changed signature** fails `pnpm typecheck` in `src/Signer.ts`. Nothing else names these APIs.
- **Changed bytes** fail law C2: RSASSA-PKCS1-v1_5 is deterministic, so a fixed test key and payload give one exact
  signature, made by `node:crypto` in a real run and kept as a `vector:`. A changed hash, padding, PEM reading or SPKI
  output turns it red.
- **Changed behavior** fails C1 (the live `Signer` against the same laws as the stand-in: round trip, a changed byte,
  a refused text) and S3 (the ticket's own check, through `AppKey.sign`).
- **A changed algorithm name** fails C3, which holds our names to Effect's `name` values.
- `tsconfig.base.json` keeps `unstableApiUsage` off for `kalfa/`, so the checker raises nothing today. If `kalfa/secrets`
  ever joins the locked list, `effect/crypto/KeyFormat` must be added to `allowedUnstableApis` beside the four
  `effect/crypto` entries already there (Findings 2).

## One value traced: `AppKey` signs a login, then two things go wrong

1. The app's module loads: `SigningKey.given("github/app-key", { algorithm: rsaPkcs1v15Sha256, sign: MaySignWith,
   place: "memory" })` checks the name with `SecretName` and gives a `Given` with `object` `"secret:github/app-key"`.
2. The app builds `Secrets.layer({ stores: [SecretsMemory.store], declared: [AppKey], settings })`, with `routes` holding
   `{ name: "github/app-key", store: "memory", item: "app-key" }`. The start finds the route, finds the store, decodes
   `"app-key"` with `Schema.NonEmptyString`, sees `signs`, and compares places: `memory` is no looser than `memory`. The
   layer builds. `SecretsMemory.layer({ keys: { "app-key": { algorithm, text } } })` read the PEM into a `PrivateKey`
   with `Signer.read`, as version `"1"`.
3. 1953's client calls `AppKey.sign(bytes)` inside `appLogin`, with the app's guard piped on: the guard checks the
   subject against `"secret:github/app-key"` and provides the proof. `sign` reads the proof (`yield* MaySignWith`),
   checks `AppKey` is in `declared`, and compares `proof.object` with `"secret:github/app-key"`: equal.
4. The memory store's `sign("app-key", rsaPkcs1v15Sha256, bytes)` answers `Found { signature, version: "1" }`. This
   process has not kept version `"1"`: `PublicKeys.read` gives `[]`, the store's `versions` gives the public key, `keep`
   writes it. No older version was kept, so no `Rotated`. `Recorder.record(new Signed({ name, store: "memory", version:
   "1" }))` returns. The caller gets `{ signature, version: "1", algorithm }`, in a span `secrets.sign` with the name,
   the store and the version.
5. A person puts a new key at `"app-key"`. The next sign answers version `"2"`: not kept, `PublicKeys.read` holds `"1"`,
   so `Rotated { version: "2" }` is recorded, then version 2's key is kept, then `Signed`. `publicKeys` now gives 2 then 1,
   so a token signed with version 1 still checks.
6. The recorder's ledger is down: `record` fails `RecordFailed`. `sign` fails `SecretsUnavailable { name, store,
   reason: RecordFailed }`, and the signature is dropped. Version 2 stays kept, which is right: it did sign.
7. Someone passes a proof made for `"secret:transport/turn-key"`: step 3's compare fails, and the fiber dies with a
   defect that names both objects. No store is asked.

## Generators

Every generator is an Effect `Arbitrary` in `kalfa/secrets/src/Secrets.test-support.ts` (and, from slice 3,
`kalfa/secrets/src/Signer.test-support.ts`), as `@kalfa/github`'s are. Each law applies to each drawn value one value
made for every class it names, so every class is reached in every run. Each class that targets a check passes every
check before it.

- `names`: (a) names of one segment and of many, with digits and single hyphens, up to 256 characters; (b) refused
  names: empty, an uppercase letter, a space, a letter past ASCII, a leading, trailing or doubled `/`, a doubled hyphen,
  257 characters.
- `values` (what a person put in a store): (c) text with quotes, backslashes, CR and LF, U+0000 to U+001F, letters past
  ASCII and an emoji; (d) 64 KB of text; (e) text in PEM armor around base64, which is a value to a fetch and not a key
  to a held signing; (f) the empty text.
- `starts` (a declared list, its routes and its stores): (g) a declared name with no route, while routes for other names
  exist; (h) a route to a store id no listed store has; (i) a route whose item the store's `item` Schema refuses, to a
  store that exists; (j) a store that exists and takes the item but lacks the port the declaration needs; (k) a store
  that has the port but whose place is looser than the key accepts (slice 3).
- `held` (what the routed item holds when it is used): (l) nothing; (m) the other kind, a key where a secret is fetched
  or a value where a key signs; for generate, an item that already holds either; (n) a key of another algorithm
  (slice 3).
- `proofs` (each for a declaration that is in `declared`): (o) a proof whose `object` is another declared name's
  object; (p) a proof with this name under another type word, as `key:<name>`.
- `undeclared`: (q) a declaration not in `declared` with the same name as one that is.
- `faults` (stand-ins that fail, each after the checks before it passed): (r) the store's port fails; (s) the recorder
  fails; (t) `PublicKeys.keep` fails (slice 3); (u) `PublicKeys.read` fails (slice 3).
- `bytes` (what a key signs, slice 3): (v) empty, one byte, 64 KB, and bytes that hold a value's text from (c).
- `versions` (slice 3): (w) a version's first sign with nothing kept, a new version after older ones were kept, and the
  same version again.
- `keeps` (slice 4): (x) `secrets.fetch.keep` of 0 seconds; (y) a keep above 0, with the test clock moved to just
  before, exactly at, and past the keep time.

The `Signer` stand-in in `Signer.test-support.ts` is synchronous: a private key is random bytes, a signature is a pure
function of the key and the bytes, `verify` looks the key up in the stand-in's own table, and `read` takes only texts
the stand-in itself wrote. No law runs `crypto.subtle` under `TestClock`: the laws that need the real one (C1's live
half, C2, S3, H2) run under `it.live`, with few runs.

## Laws, slice 1

Run caps: every property law runs 100 to 300 runs, all in memory, under `it.effect`. The tests step reports any law over
10 s and lowers its runs, never its classes. Each `*.types.test.ts` file also runs under vitest, so it holds no
`declare const`: it builds real values, or wraps its lines in a function it never calls.

| Law | Kind (lint, type or test?) | Generator | Plant | Where |
|---|---|---|---|---|
| P1, the manifest: one dependency, `@kalfa/config` as `workspace:*`; peers `effect`, and `@effect/vitest` and `vitest` marked optional; exports `.`, `./memory`, `./test` and `./package.json`, each to its source file; no other package of this repo named anywhere in it | test | scenario: the package's own manifest at head; no generated input says what a manifest holds | add `@kalfa/github` to the dependencies: red; drop `./test`: red; make `vitest` a required peer: red | kalfa/secrets/src/Package.test.ts |
| L1, imports: in the package's source files `@kalfa/config` passes, and every other `@kalfa/` package, a `@kalfa/config/` subpath, `@kampus/` and `@tea-fabrika/` packages, a `node:` module or a bare Node module name, a platform package and Telemetry are refused; in `MemoryStore.ts` every `@kalfa/` import is refused; tests, test support and `StoreTest.ts` are left out | lint | lint | in turn: import `@kalfa/github` in `Store.ts`, `@kalfa/config` in `MemoryStore.ts`, `node:crypto` in `Store.ts`, `crypto` (bare) in `Recorder.ts`, `@effect/opentelemetry` in `Recorder.ts`: lint red each time, then undone | .oxlintrc.json |
| L2, the rank: `kalfa-secrets` is a layer-rules row at layer 2 that imports `kalfa-config`, a boundary row that imports `kalfa-config`, and `kalfa/secrets/src` is a root in both; the layers test pins it at 2 with its reason | test | pinned: the two rule files at head | write layer 1: the pin is red; drop the boundary row: the boundary-and-layer law is red | oxlint-plugins/layers.test.ts |
| D6, a store's types: `Store.make` with only `holds` has no `signs` and no `generates`; a port's needs are the store's `R`, and `Store.Needs` of a list of stores is the union of theirs; `Held` is `Found` or `Missing`, and `Missing`'s reason takes only `absent`, `kind` and `algorithm`; the memory store's `R` is `Contents` | type | type | type `Store.Needs` as `never`: the union line fails, red; type the reason as `string`: the refused-reason line compiles, red | kalfa/secrets/src/Store.types.test.ts |
| N1, names: `SecretName` takes every (a) and refuses every (b); `StoreId` takes `memory` and `env` and refuses an uppercase or empty id; `Version` refuses the empty text and 129 characters. 200 runs | test | Effect Arbitrary: names | accept uppercase: (b) red; cap names at 64 characters: (a) red | kalfa/secrets/src/Name.test.ts |
| X6, [secrets] the values hide themselves: a store's `Found`, the memory store's `Contents` and every fact the memory recorder holds show no value through `String`, `JSON.stringify` and `Inspectable.format`, for values (c), (d) and (e) in every form. 300 runs | test | Effect Arbitrary: values | give `Found` a `toJSON` that returns its text: red; keep values on `Contents` as a plain record: red | kalfa/secrets/src/Leak.test.ts |
| M1, the store laws, `holds` part, on the memory store: `read` of a put value gives it and a version; a value put again gives a new version; a removed or never-put item is `Missing absent`; no `Found` holds the empty text; every failure holds no value the store holds; `StoreTest.suite` takes a subject that says how to put a value into its own kind of store. 200 runs | test | Effect Arbitrary: values | give the same version after a second put: red; answer `Found` with `""` for a put empty text: red | kalfa/secrets/src/MemoryStore.test.ts |

## Laws, slice 2

| Law | Kind (lint, type or test?) | Generator | Plant | Where |
|---|---|---|---|---|
| D1, a secret's types: `yield* TurnKey` is `Redacted<string>`, fails `SecretMissing \| SecretsUnavailable` and needs `MayFetchSecret \| Secrets`; a guard that provides `MayFetchSecret` leaves `Secrets`; a proof key whose value has no `object` text does not compile; `TurnKey.object` is the literal `"secret:transport/turn-key"` | type | type | type the proof key as `Context.Key<I, unknown>`: the no-object line compiles, red; type `object` as `string`: the literal line fails, red | kalfa/secrets/src/Secret.types.test.ts |
| D4, a name typed from a value holds for every way it is typed: `Secret.make` takes a literal name; a name typed `string`, a union of two literals, a template type with a `string` hole and `any` do not compile | type | type | drop the literal check: the `string` line compiles, red; check only `string extends N`: the union line compiles, red | kalfa/secrets/src/Secret.types.test.ts |
| N1 widened: `Secret.make` with a (b) name throws when called, and its message names the rule and the name; an (a) name makes a secret. 200 runs | test | Effect Arbitrary: names | check the name only at the first fetch: the throw check red for (b) | kalfa/secrets/src/Name.test.ts |
| V1, the routes setting: `secrets.routes` decodes an array of name routes, refuses two routes for one name, a route whose name `SecretName` refuses, and an empty item; its default is `[]` and it has a description. 200 runs | test | Effect Arbitrary: names | drop the "two routes for one name" check: red; take the route's name as plain text: red | kalfa/secrets/src/Settings.test.ts |
| R1, the start check: for `starts`, `Secrets.layer` fails `RouteMissing { name }` for (g), `RouteRefused { name, store, reason: "store" }` for (h), `reason: "item"` for (i), and `reason: "port"` naming `holds` for (j), always the first problem in `declared` order; with every route right it builds, in a span `secrets.layer`. 200 runs | test | Effect Arbitrary: starts | look a route up by a prefix of the name: (g) red; skip the store check, so the first store answers: (h) red; skip the item decode: (i) red; skip the port check: (j) red; check `declared` from the end: the first-problem check red | kalfa/secrets/src/Start.test.ts |
| R2, the routed item is the one asked: after a start that passed, a fetch of each declared name asks its routed store's `read` with exactly its routed item, and no other store is asked. 200 runs | test | Effect Arbitrary: starts | pass the name in place of the item: red; ask every store until one answers: red | kalfa/secrets/src/Start.test.ts |
| R3, faults in code: two declarations with one name, or two stores with one id, make the layer die with a defect naming them; one declaration listed twice builds | test | scenario: three hand-built lists, since the fault is in the code that lists them and not in data | keep the last of two declarations with one name: red; dedupe stores by id: red; refuse a declaration listed twice: red | kalfa/secrets/src/Start.test.ts |
| U1, a declaration not in `declared` dies: fetching (q) is a defect naming the name, though the declared secret of the same name fetches. 100 runs | test | Effect Arbitrary: undeclared | check `declared` by name: (q) fetches, red | kalfa/secrets/src/Fetch.test.ts |
| O1, the proof is for this secret: a fetch whose proof's `object` is (o) or (p) dies with a defect naming both objects, and no store is asked; a proof for `secret:<name>` fetches. 200 runs | test | Effect Arbitrary: proofs | skip the compare: (o) red; compare only the text after the first `:`: (p) red; ask the store before the compare: the "no store is asked" check red | kalfa/secrets/src/Fetch.test.ts |
| F1, a fetch gives the held value hidden: for (c), (d) and (e), `Redacted.value` of the result equals the text the memory store holds, and `String` of it is `<redacted>` with its label; (f) and (l) fail `SecretMissing { name, store, item, reason: "absent" }`, never an empty value. 300 runs | test | Effect Arbitrary: fetches | trim the value: (c) red; cut it at 4 KB: (d) red; decode a value in PEM armor as base64 first: (e) red; pass an empty held text on as a value: (f) red; give `Redacted.make("")` for nothing: (l) red | kalfa/secrets/src/Fetch.test.ts |
| F2, the record comes before the value: a fetch that succeeds writes exactly one `Fetched { name, store, version }` with the store's version, and the value comes back only after `record` returned; with (s) it fails `SecretsUnavailable` with `RecordFailed` as its reason and gives no value; with (r) it fails `SecretsUnavailable` with `StoreFailed` as its reason and writes no fact. 200 runs | test | Effect Arbitrary: faults | fork the record and return at once: the order check red; record before the read: (r) writes a fact, red; catch (s)'s failure and return the value: (s) red | kalfa/secrets/src/Fetch.test.ts |
| F3, nothing is kept between fetches: two fetches read the store twice, and a value changed between them comes back new. 100 runs | test | Effect Arbitrary: fetches | keep the first value in a `Ref`: red | kalfa/secrets/src/Fetch.test.ts |
| T1, spans: a fetch ends one span `secrets.fetch` with `kalfa.secrets.name`, `kalfa.secrets.store` and, on success, `kalfa.secrets.version`, and no other `kalfa.` attribute; a failed fetch's span holds the error's tag. 100 runs | test | Effect Arbitrary: fetches | annotate the item: red; name the span `secrets.get`: red | kalfa/secrets/src/Fetch.test.ts |
| X1, [secrets] facts hold no value: for every fetch flow (success, (l), (r), (s), the proof defect), every fact the memory recorder holds, through `JSON.stringify` and through its Schema's encoding, holds no value from (c), (d) or (e) in any form: as is, JSON-escaped, base64, base64url, hex and `encodeURIComponent`. 300 runs | test | Effect Arbitrary: fetchFlows | add a `value` field to `Fetched`: red; put the value's base64 in the version: red | kalfa/secrets/src/Leak.test.ts |
| X2, [secrets] spans hold no value: for the same flows and forms, no span name, attribute, event, or failure text as Effect's tracer writes it (the error's `message` and `Cause.pretty` with its stack) holds the value. 300 runs | test | Effect Arbitrary: fetchFlows | annotate the span with the value: red; name the span with the value's first 8 characters: red | kalfa/secrets/src/Leak.test.ts |
| X3, [secrets] logs hold no value: for the same flows and forms, no line at any level of a recording logger holds the value. 300 runs | test | Effect Arbitrary: fetchFlows | `Effect.logDebug` the value after the read: red | kalfa/secrets/src/Leak.test.ts |
| X4, [secrets] rendered errors hold no value: for each failed flow, `Cause.pretty` of the exit with the cause's stack, and `String`, `JSON.stringify` and `Inspectable.format` of the failure, hold no value in any form. 300 runs | test | Effect Arbitrary: fetchFlows | put the value into `SecretMissing`'s message: red; put it into the proof defect's message: red | kalfa/secrets/src/Leak.test.ts |
| X5, [secrets] error properties hold no value: for each failed flow, every text reachable from the failure's own properties, its `reason` and its `cause` chain holds no value in any form. 300 runs | test | Effect Arbitrary: fetchFlows | keep the store's `Found` in `RecordFailed`'s cause when the recorder fails after a read: red | kalfa/secrets/src/Leak.test.ts |
| X6 widened, [secrets]: a `Secret` declaration, the `Secrets` service and a fetched `Redacted` show no value the same ways. 300 runs | test | Effect Arbitrary: values | give the `Secrets` service a `toJSON` that lists the kept values: red | kalfa/secrets/src/Leak.test.ts |

## Laws, slice 3

| Law | Kind (lint, type or test?) | Generator | Plant | Where |
|---|---|---|---|---|
| D2, a signing key's types: `AppKey.sign(bytes)` is `Signed<RsaPkcs1v15>` with `SecretMissing \| SecretsUnavailable` and needs `MaySignWith \| Secrets`; `appLogin`-shaped code typed `SigningKey.Any<Signature.RsaPkcs1v15, R, E>` compiles against `AppKey` and shows `MaySignWith` in its needs; the piped guard removes it and adds `Denied`; an `ed25519` key is refused where RSA is asked; a given key has no `generate` and no `rotate`; a key typed with its own error passes it on; `publicKey` and `publicKeys` need only `Secrets`; `place` is required | type | type | type `sign`'s needs as `Secrets` only: the "shows `MaySignWith`" line fails, red; give `Given` an optional `generate`: red; give `place` a default: the "required" line compiles, red | kalfa/secrets/src/SigningKey.types.test.ts |
| D4 widened: `SigningKey.given` takes a literal name; `string`, a union and `any` do not compile | type | type | drop the literal check from `given`: red | kalfa/secrets/src/SigningKey.types.test.ts |
| L3, Effect's crypto in one file: `effect/crypto` and its subpaths are refused in every source file of the package but `src/Signer.ts` | lint | lint | import `effect/crypto/Signature` in `MemoryStore.ts`; import `effect/crypto` in `Store.ts`: lint red each time, then undone | .oxlintrc.json |
| C1, the stand-in and the real `Signer` pass the same laws: for each algorithm, a key from `generate` signs bytes that `verify` checks with the key's `publicKey`; a changed byte or another key's public key checks false; `fingerprint` is the same for one key twice and differs for two keys; `read` refuses (e) and plain text. The stand-in runs 200 runs under `it.effect`; `Signer.layer` runs 5 runs under `it.live` | test | Effect Arbitrary: signerCases | make the stand-in's `verify` ignore the bytes: red; make the live `fingerprint` hash the private key's bytes: the live half red; let the live `read` take PKCS#8 only: red on C2 | kalfa/secrets/src/Signer.test.ts |
| C2, the real `Signer` matches a known answer: it reads the vector key as PKCS#1 PEM and as PKCS#8 PEM; its signature over the vector payload equals the vector signature byte for byte; the key's `publicKey` SPKI equals the vector SPKI | test | vector: a 2048-bit RSA test key made for this law, a payload, and their RS256 signature and SPKI, made by `node:crypto` in a real run and kept as base64 DER, with the PEM armor written in pieces | map `rsaPkcs1v15Sha256` to Effect's `rsaPssSha256`: red; read PKCS#1 text as PKCS#8: red; give the public key as Effect's raw `toBytes` for Ed25519 and SPKI for RSA, then compare an Ed25519 vector: red | kalfa/secrets/src/Signer.test.ts |
| C3, our algorithm names are Effect's: `Signature.rsaPkcs1v15Sha256.name` and `Signature.ed25519.name` equal Effect's `name` of the values `Signer.ts` maps them to, and `AlgorithmName` lists exactly ours | test | pinned: Effect 4.1.3's algorithm values | rename ours to `rs256`: red | kalfa/secrets/src/Signer.test.ts |
| R4, the place and the port for a key: a given key accepting `store` or `runtime`, routed to the memory store, fails `RouteRefused { reason: "place", place: "memory" }` for (k); a given key routed to a store with only `holds` fails `reason: "port"` naming `signs`; a given key accepting `memory` builds. 200 runs | test | Effect Arbitrary: starts | compare places alphabetically: (k) red; take `holds` as enough to sign: the port check red | kalfa/secrets/src/Start.test.ts |
| S1, a sign gives a signature that checks: for a given key put into the memory store and bytes (v), `AppKey.sign` gives `{ signature, version, algorithm }`, the version is the store's, the algorithm is the declared one, and the stand-in's `verify` with that version's kept public key says true; (l) fails `SecretMissing { reason: "absent" }`, (m) `reason: "kind"` and (n) `reason: "algorithm"`. 300 runs | test | Effect Arbitrary: signs | sign with the store's key whatever its algorithm: (n) red; sign a value item's text as a key: (m) red; cut the bytes at 4 KB before signing: (v) red | kalfa/secrets/src/Sign.test.ts |
| S2, the order of a sign: for (w), a version's first sign in this process keeps its public key, then records `Rotated` when older versions were kept, then records `Signed`, and only then returns; the same version again keeps nothing and records only `Signed`; with (t) or (u) the sign fails `SecretsUnavailable` and gives no signature and no `Signed` fact; with (s) it gives no signature. 300 runs | test | Effect Arbitrary: signs | keep the public key after returning: (t) red; keep on every sign: (w) red; take a failed `read` as "nothing kept" and go on: (u) red; record `Signed` before keeping: the order check red | kalfa/secrets/src/Sign.test.ts |
| S3, the ticket's check, on the real crypto: under `it.live` with `Signer.layer`, the C2 vector key put into the memory store, `AppKey.sign(payload)` gives a signature that Effect's own `Signature.verify` checks true against the kept public key's SPKI, and false for a changed payload | test | vector: C2's key and payload | keep the public key of the wrong version: red | kalfa/secrets/src/Sign.test.ts |
| S4, the public keys: `publicKey` is the store's newest version's; `publicKeys` lists every kept version newest first, with the store's newest at the front when it was never kept; a person who rotated twice sees three. 100 runs | test | Effect Arbitrary: signs | list oldest first: red; read only the store's versions: the "kept" check red | kalfa/secrets/src/Sign.test.ts |
| F1 widened: fetching a secret whose item holds a key, (m), fails `SecretMissing { reason: "kind" }`. 200 runs | test | Effect Arbitrary: fetches | give a key item's PEM text as the value: (m) red | kalfa/secrets/src/Fetch.test.ts |
| T1 widened: `secrets.sign`, `secrets.public-key` and `secrets.public-keys` spans, with the same attributes and nothing else. 100 runs | test | Effect Arbitrary: signs | annotate the bytes' length: red | kalfa/secrets/src/Sign.test.ts |
| X1 to X6 widened, [secrets]: for every sign flow (success, (l), (m), (n), (r), (s), (t), (u), (w)), no fact, no kept `PublicKey` (but for its SPKI), no span, no log line, no rendered error, no error property and no display of a declaration, a `Signer.PrivateKey` or `Contents` holds the private key's PEM text, its DER bytes in any form, or the signed bytes (v) in any form; the signature itself appears only in the result. 300 runs | test | Effect Arbitrary: signFlows | annotate the span with the signed bytes: red; put the PEM text into `KeyRefused`'s message: red; give `PrivateKey` an enumerable bytes field: the display check red | kalfa/secrets/src/Leak.test.ts |
| M2, the store laws, `signs` part, on the memory store: a put key signs bytes that `verify` checks against `versions`' newest; a key put again is a new version and the old one stays in `versions`; (m) and (n) are `Missing` with their reason | test | Effect Arbitrary: signs | drop old versions from `versions` on a new put: red | kalfa/secrets/src/MemoryStore.test.ts |

## Laws, slice 4

| Law | Kind (lint, type or test?) | Generator | Plant | Where |
|---|---|---|---|---|
| D3, a generated key's types: `SigningKey.make` gives `generate` and `rotate`, each needing the `rotate` proof key's identifier and `Secrets`; `generate` fails `NameTaken \| StoreCannot \| SecretsUnavailable` and `rotate` `SecretMissing \| StoreCannot \| SecretsUnavailable`; a `Generated` key is a `SigningKey.Any` of its algorithm | type | type | type `generate`'s needs with the `sign` key: red | kalfa/secrets/src/SigningKey.types.test.ts |
| G1, generate: for (l) it gives a public key, records `Generated`, and the key then signs bytes that check against it; for (m) it fails `NameTaken`; with the `rotate` proof (o) or (p) it dies; with (s) after the store changed it fails `SecretsUnavailable { reason: RecordFailed }` carrying the new public key. 200 runs | test | Effect Arbitrary: generates | read the `sign` proof key for generate: (o) red; overwrite a taken item: (m) red; drop the public key from the failure: the (s) check red | kalfa/secrets/src/Generate.test.ts |
| G2, rotate: it makes a new version that signs from then on, records `Rotated`, keeps the new public key, and the old version's public key still checks an old signature; for (l) it fails `SecretMissing { reason: "absent" }` and for (n) `reason: "algorithm"`. 200 runs | test | Effect Arbitrary: generates | sign with the oldest version after a rotate: red; skip the keep on rotate: the old-signature check stays green but the kept list misses it, red | kalfa/secrets/src/Generate.test.ts |
| H1, a store that only holds signs: `Store.signingFromHeld` over a holds-only stand-in signs with a key read from its held text; its version is the key's fingerprint, the same for the same text and new for a new text, so a changed text records `Rotated` (w); (e) and plain text fail `SecretMissing { reason: "kind" }`; the wrapped store's place is `memory`, so a key accepting `store` is refused at start (k). 200 runs | test | Effect Arbitrary: held | take the held store's own version: (w) red; let a PEM-armored value that is no key sign: (e) red; keep the wrapped store's place: (k) red | kalfa/secrets/src/Held.test.ts |
| H2, the real held path: under `it.live` with `Signer.layer`, `signingFromHeld` over a holds-only stand-in holding the C2 vector key as PKCS#1 PEM signs the payload with the C2 vector signature, and its version is the vector SPKI's fingerprint | test | vector: C2's key, payload, signature and SPKI | hash the PEM text for the version: red | kalfa/secrets/src/Held.test.ts |
| M3, the store laws, `generates` part, on the memory store, and the `signs` part on `signingFromHeld` over a holds-only stand-in: generate on a free item gives a version; on a taken one `ItemTaken`; rotate gives a new version and keeps the old in `versions` | test | Effect Arbitrary: generates | let generate replace a taken item: red | kalfa/secrets/src/MemoryStore.test.ts |
| T1 and X1 to X6 widened, [secrets]: `secrets.generate` and `secrets.rotate` spans; for every generate, rotate and held-signing flow, nothing above holds a private key's text or bytes, or a held value, in any form. 300 runs | test | Effect Arbitrary: generates | log the generated key's PEM at debug: red | kalfa/secrets/src/Leak.test.ts |
| K1, the keep time: with (x) every fetch reads the store; with (y) a second fetch before the keep time reads no store and gives the kept value, and one at or past it reads again; every fetch, kept or not, writes one `Fetched` with `from: "store"` or `from: "kept"`, and with (s) a kept value is dropped too. 200 runs under `TestClock` | test | Effect Arbitrary: keeps | keep values at 0 seconds: (x) red; keep while the clock is at the keep time: (y) red; skip the record for a kept value: the `from: "kept"` check red | kalfa/secrets/src/Keep.test.ts |
| K2, old public keys readable: with `readable` set to n, `publicKeys` gives the n newest; with `"all"` it gives every one. 100 runs | test | Effect Arbitrary: signs | give the n oldest: red | kalfa/secrets/src/Keep.test.ts |
| F4, a secret's schema: `Secret.make(name, { fetch, schema })` gives `Redacted<A>` with the decoded value; a value the schema refuses fails `SecretMalformed { name, store }`, which holds no value and no schema issue text (the issue text can quote the value). 200 runs | test | Effect Arbitrary: values | keep the `SchemaError` as `SecretMalformed`'s cause: X5 red | kalfa/secrets/src/Fetch.test.ts |
| D5, a secret's schema in the types: `Secret.make` with `schema` gives `Redacted<A>` and adds `SecretMalformed` to the errors; without it the errors stay `SecretMissing \| SecretsUnavailable` | type | type | add `SecretMalformed` to every secret's errors: the no-schema line fails, red | kalfa/secrets/src/Secret.types.test.ts |
| V1 widened: `secrets.fetch.keep` refuses text that is no length of time and defaults to `"0 seconds"`; `secrets.public-keys.readable` refuses 0 and below and defaults to `"all"`. 200 runs | test | Effect Arbitrary: names | let `readable` take 0: red | kalfa/secrets/src/Settings.test.ts |
| X1 to X6 widened, [secrets]: for the kept and malformed flows, nothing above holds the value in any form. 300 runs | test | Effect Arbitrary: fetchFlows | log the kept value when it is reused: red | kalfa/secrets/src/Leak.test.ts |

No law here needs the real machine: every law runs in memory on every pull request, and real crypto is Node's own
WebCrypto, not a host resource. There is no `.integration.` file and no screenshot, since no window changes.

## Lint

Slice 1 adds `kalfa/secrets/src/**` to the kalfa Effect block of `.oxlintrc.json` (its `files` list beside
`kalfa/github/src/**`), and an override for the package modeled on `@kalfa/github`'s, holding L1. Slice 3 adds L3 to that
override: `effect/crypto` and `effect/crypto/**` are refused in every source file but `kalfa/secrets/src/Signer.ts`, which
gets its own override that repeats the rest. An override replaces a rule's options, so each repeats the base entries,
as `@kalfa/github`'s does.

## Where the rank is written

`@kalfa/secrets` imports `@kalfa/config` (layer 1), so it ranks at layer 2. `kalfa/AGENTS.md` gets one sentence: Secrets
ranks just above Configuration and imports only it. `@kalfa/github` also sits at layer 2 today; when 1953 makes it import
Secrets, it moves to layer 3, which is 1953's change.

## Is this a setting?

- Routes, the keep time and how many old public keys stay readable: settings, as the protocol rules.
- The object's type word, `secret`: not a setting. It is a contract with Permissions' proofs, and a setting would let a
  settings file change which proofs count.
- A key's place: not a setting. It is the declaration's own, in code, so a settings file cannot loosen where a key may
  sit; a route already picks the store.
- An empty held text counting as absent, failing on the first start problem, and the memory store's counted versions:
  rules, not choices a person makes per app.
- The name grammar (256 characters, 64 for a part): not a setting, since names are written in code and on the ledger.
- RSA's key size when the memory store makes one: Effect's 3072 for `rsaPkcs1v15Sha256`; a setting would let one name's
  keys differ by machine. It joins the algorithm values when a caller needs another size.

## What fact is lost if it is not recorded now

- **Which store served a use, and which version.** Every fact holds the name, the store and the version from the first
  slice. A ledger never forgets, so an entry written without the store could never say later which store a value came
  from.
- **An old version's public key.** It is kept the first time that version signs. A store that keeps one value would
  otherwise lose it at the next rotation, and every signature made before could never be checked again.
- **Whether a fetch was served from the keep.** `Fetched.from` comes with the keep time in slice 4. Before then every
  fetch reads the store, so the field would only ever say `store`. Before v0.0.0 a saved-shape change wipes the data,
  so nothing is lost by waiting.
- The sender and the time are the ledger's own fields (1752), so Secrets records neither.

## Files, slice 1

| File | Owner | Product lines expected | Change |
|---|---|---|---|
| kalfa/secrets/src/index.ts | build | 10 | new: the root entry point, re-exporting `Store`, `Recorder` and the names |
| kalfa/secrets/src/Name.ts | build | 20 | new: `SecretName`, `Version`, `StoreId` |
| kalfa/secrets/src/Errors.ts | build | 10 | new: `StoreFailed`, `RecordFailed` |
| kalfa/secrets/src/Store.ts | build | 40 | new: `Place`, `Found`, `Missing`, `Held`, `Holds`, `Store`, `Store.make`, `Any`, `Needs` |
| kalfa/secrets/src/Recorder.ts | build | 18 | new: `Recorder`, `Fetched`, `Fact` |
| kalfa/secrets/src/MemoryStore.ts | build | 50 | new: `Contents`, `layer`, `store` with `holds`, `Recorded`, `recorder` |
| kalfa/secrets/README.md | build | docs | new: the store's ports, the memory store, the store laws |
| kalfa/secrets/GLOSSARY.md | build | docs | Recorder |
| kalfa/AGENTS.md | build | docs | the rank sentence |
| kalfa/secrets/package.json | tests | tests | new: the manifest sketched above |
| kalfa/secrets/tsconfig.json | tests | tests | new: as `kalfa/github`'s, with the Effect checks |
| package.json | tests | tests | `"@kalfa/secrets": "workspace:*"` beside the other kalfa packages |
| pnpm-lock.yaml | tests | tests | the new importer, written by one `pnpm install --offline` |
| .oxlintrc.json | tests | tests | L1: the kalfa Effect block's files and the package's override |
| layer-rules.json | tests | tests | L2: `kalfa-secrets` at layer 2, importing `kalfa-config`; the root `kalfa/secrets/src` |
| boundary-rules.json | tests | tests | L2: `kalfa-secrets` imports `kalfa-config`; `kalfa/secrets` is `kalfa-secrets` |
| oxlint-plugins/layers.test.ts | tests | tests | L2: `"kalfa-secrets": 2`, with its reason comment |
| oxlint-plugins/law-ids.ts | tests | tests | no change: ran clean while planning; the tests step runs it again |
| tsconfig.base.json | tests | tests | no change: read for `unstableApiUsage`, which is off for `kalfa/` |
| kalfa/secrets/src/StoreTest.ts | tests | tests | new: `suite(subject)`, the `holds` laws M1 |
| kalfa/secrets/src/Secrets.test-support.ts | tests | tests | `names`, `values`, stand-in stores and a recorder that fail |
| kalfa/secrets/src/Package.test.ts | tests | tests | P1 |
| kalfa/secrets/src/Store.types.test.ts | tests | tests | D6 |
| kalfa/secrets/src/Name.test.ts | tests | tests | N1 |
| kalfa/secrets/src/Leak.test.ts | tests | tests | X6 |
| kalfa/secrets/src/MemoryStore.test.ts | tests | tests | M1, running `StoreTest.suite` on the memory store |

## Files, slice 2

| File | Owner | Product lines expected | Change |
|---|---|---|---|
| kalfa/secrets/src/index.ts | build | 10 | `Secret`, `Secrets`, `SecretsSettings`, the errors |
| kalfa/secrets/src/Name.ts | build | 5 | `Proof`, `object` |
| kalfa/secrets/src/Errors.ts | build | 30 | `SecretMissing`, `SecretsUnavailable`, `RouteMissing`, `RouteRefused`, with doc blocks |
| kalfa/secrets/src/Secret.ts | build | 35 | new: `Secret`, `make`, the literal check |
| kalfa/secrets/src/Secrets.ts | build | 25 | new: the `Secrets` service and `layer` |
| kalfa/secrets/src/internal/start.ts | build | 40 | new: the start check, steps 1 to 5 |
| kalfa/secrets/src/internal/use.ts | build | 30 | new: the declared and proof checks, fetch |
| kalfa/secrets/src/Settings.ts | build | 25 | new: `secrets.routes` with name routes, `all`, `Values` |
| kalfa/secrets/README.md | build | docs | declare, route, fetch, wire; what never shows a value |
| kalfa/secrets/src/Secrets.test-support.ts | tests | tests | `starts`, `undeclared`, `proofs`, `fetches`, `faults`, `fetchFlows`, proof keys, a recording tracer and logger |
| kalfa/secrets/src/Secret.types.test.ts | tests | tests | D1, D4 |
| kalfa/secrets/src/Name.test.ts | tests | tests | N1 widened |
| kalfa/secrets/src/Settings.test.ts | tests | tests | V1 |
| kalfa/secrets/src/Start.test.ts | tests | tests | R1, R2, R3 |
| kalfa/secrets/src/Fetch.test.ts | tests | tests | U1, O1, F1, F2, F3, T1 |
| kalfa/secrets/src/Leak.test.ts | tests | tests | X1 to X5, X6 widened |

## Files, slice 3

| File | Owner | Product lines expected | Change |
|---|---|---|---|
| kalfa/secrets/src/Signature.ts | build | 30 | new: `RsaPkcs1v15`, `Ed25519`, `Algorithm`, `rsaPkcs1v15Sha256`, `ed25519`, `AlgorithmName` |
| kalfa/secrets/src/Signer.ts | build | 65 | new: `Signer`, `PrivateKey`, `KeyRefused`, `layer` on Effect's crypto |
| kalfa/secrets/src/PublicKeys.ts | build | 22 | new: `PublicKeys`, `PublicKey` |
| kalfa/secrets/src/SigningKey.ts | build | 50 | new: `SigningKey`, `Any`, `Signed`, `Given`, `given` |
| kalfa/secrets/src/Store.ts | build | 15 | the `Signs` port |
| kalfa/secrets/src/Recorder.ts | build | 8 | `Signed`, `Rotated` |
| kalfa/secrets/src/internal/start.ts | build | 15 | step 6, the place; the `signs` need |
| kalfa/secrets/src/internal/use.ts | build | 55 | sign, the first-sign keep and `Rotated`, `publicKey`, `publicKeys` |
| kalfa/secrets/src/MemoryStore.ts | build | 45 | `putKey`, the key seed, the `signs` port, `publicKeys` |
| kalfa/secrets/src/index.ts | build | 3 | `Signature`, `Signer`, `SigningKey`, `PublicKeys` |
| kalfa/secrets/README.md | build | docs | sign, public keys, `Signer` and its live Layer, Effect's crypto and how a bump shows |
| .oxlintrc.json | tests | tests | L3: `effect/crypto` only in `Signer.ts` |
| kalfa/secrets/src/StoreTest.ts | tests | tests | the `signs` laws M2 |
| kalfa/secrets/src/Signer.test-support.ts | tests | tests | the synchronous stand-in, the C2 vector, `signerCases` |
| kalfa/secrets/src/Secrets.test-support.ts | tests | tests | `signs`, `signFlows`, the (k), (n), (t), (u), (v), (w) classes |
| kalfa/secrets/src/Signer.test.ts | tests | tests | C1, C2, C3 |
| kalfa/secrets/src/SigningKey.types.test.ts | tests | tests | D2, D4 widened |
| kalfa/secrets/src/Start.test.ts | tests | tests | R4 |
| kalfa/secrets/src/Sign.test.ts | tests | tests | S1 to S4, T1 widened |
| kalfa/secrets/src/Fetch.test.ts | tests | tests | F1 widened |
| kalfa/secrets/src/Leak.test.ts | tests | tests | X1 to X6 widened |
| kalfa/secrets/src/MemoryStore.test.ts | tests | tests | M2 |

## Files, slice 4

| File | Owner | Product lines expected | Change |
|---|---|---|---|
| kalfa/secrets/src/SigningKey.ts | build | 30 | `Generated`, `make` |
| kalfa/secrets/src/Store.ts | build | 45 | the `Generates` port, `ItemTaken`, `signingFromHeld` |
| kalfa/secrets/src/Recorder.ts | build | 8 | `Generated`; `Fetched.from` |
| kalfa/secrets/src/Errors.ts | build | 18 | `NameTaken`, `StoreCannot`, `SecretMalformed` |
| kalfa/secrets/src/internal/use.ts | build | 70 | generate and rotate with the `rotate` proof; the keep, `Fetched.from`, the readable trim |
| kalfa/secrets/src/internal/start.ts | build | 5 | the `generates` need |
| kalfa/secrets/src/MemoryStore.ts | build | 35 | the `generates` port |
| kalfa/secrets/src/Settings.ts | build | 20 | `secrets.fetch.keep`, `secrets.public-keys.readable` |
| kalfa/secrets/src/Secret.ts | build | 15 | `schema` |
| kalfa/secrets/README.md | build | docs | generated keys, held signing, keep time, schema, readable |
| kalfa/secrets/GLOSSARY.md | build | docs | Keep time |
| kalfa/secrets/src/StoreTest.ts | tests | tests | the `generates` laws M3 |
| kalfa/secrets/src/Secrets.test-support.ts | tests | tests | `generates`, `held`, `keeps`, a holds-only stand-in store |
| kalfa/secrets/src/SigningKey.types.test.ts | tests | tests | D3 |
| kalfa/secrets/src/Secret.types.test.ts | tests | tests | D5 |
| kalfa/secrets/src/Generate.test.ts | tests | tests | G1, G2 |
| kalfa/secrets/src/Held.test.ts | tests | tests | H1, H2 |
| kalfa/secrets/src/Keep.test.ts | tests | tests | K1, K2 |
| kalfa/secrets/src/Fetch.test.ts | tests | tests | F4 |
| kalfa/secrets/src/Settings.test.ts | tests | tests | V1 widened |
| kalfa/secrets/src/MemoryStore.test.ts | tests | tests | M3 |
| kalfa/secrets/src/Leak.test.ts | tests | tests | T1 and X1 to X6 widened |

## Existing tools

- `kalfa/secrets/src/index.ts`: searched `kalfa/config/src/index.ts` (a root that re-exports modules as namespaces; followed).
- `kalfa/secrets/src/Name.ts`: searched Effect's `Schema.brand`, `Schema.isPattern`, `Schema.isMaxLength` (used), and
  `@kalfa/config`'s name rules in `SettingGroup.ts` (its own words, not exported; not used).
- `kalfa/secrets/src/Errors.ts`: searched `Schema.TaggedError` and the reason-and-cause pattern in
  `effect-errors-keep-their-cause.md` (followed); no kalfa package has an error a secret store can reuse.
- `kalfa/secrets/src/Store.ts`: searched Effect's `KeyValueStore` (holds bytes by key, with no versions, no kinds and no
  signing; not used) and `Option` (1752's sketch; replaced by a tagged `Missing` to keep the reason).
- `kalfa/secrets/src/Recorder.ts`: searched `Schema.TaggedClass` and `Context.Service` (used); no ledger package is built,
  and the core may not import one anyway.
- `kalfa/secrets/src/PublicKeys.ts`: searched `Schema.Uint8ArrayFromBase64Url` (used for the SPKI bytes) and Effect's
  `Signature.PublicKey` (an opaque object, not plain data; not used in the slot).
- `kalfa/secrets/src/Secret.ts`: searched `Effectable.Prototype`, as `@kalfa/config`'s group uses it (used), `Config.redacted`
  (reads from a `ConfigProvider` with no store, record or proof; not used) and `Redacted.make` with `label` (used).
- `kalfa/secrets/src/SigningKey.ts`: searched Effect's `Signature.Signature` service (the private key is an argument
  there, so a caller would hold it; used only inside `Signer.ts`).
- `kalfa/secrets/src/Secrets.ts`: searched `Context.Service` and `Layer.effect` (used) and `GitHubLive.layer`'s way of taking
  checked settings values (followed).
- `kalfa/secrets/src/internal/start.ts`: searched `@kalfa/config`'s start, which fails on the first problem (followed); no
  tool checks routes against ports.
- `kalfa/secrets/src/internal/use.ts`: searched `Effect.fn`, `Effect.annotateCurrentSpan` (used) and `Effect.cachedWithTTL`
  (one value for all names and no record per use; the keep is a `Ref` of entries read with `Clock`).
- `kalfa/secrets/src/Settings.ts`: searched `@kalfa/config`'s root `Setting.make`, `withDefault`, `withDescription` (used),
  `kalfa/github/src/Settings.ts` (followed) and `Schema.DurationFromString` (used where the keep is read).
- `kalfa/secrets/src/Signature.ts`: searched Effect's `crypto/Signature` algorithm values (not plain data: their `hash` is
  an object; mapped to in `Signer.ts`).
- `kalfa/secrets/src/Signer.ts`: searched Effect's `crypto/Signature`, `KeyFormat`, `SecureRandom`, `Digest` and `WebCrypto`
  (all used, in this file only), `node:crypto` (refused by L1: the package runs where only WebCrypto exists) and npm's
  `jose` (a second crypto stack with its own errors; not used).
- `kalfa/secrets/src/MemoryStore.ts`: searched `kalfa/git/src/MemoryRepository.ts` (a memory adapter of a kalfa port;
  followed in shape) and Effect's `Ref` (used).

## Lead's calls at signing (2026-11-23)

The lead read the plan's calls and ruled on each. The plan above is written to these.

1. **Kept:** Effect's crypto behind our own `Signer` service, in `src/Signer.ts` only, with the RS256 known-answer law
   (C2) against the real Effect module, so an Effect bump breaks loudly.
2. **Kept:** `place` is required on a signing key.
3. **Kept:** the memory store's place is `"memory"`.
4. **Kept:** the proof's object is `secret:<name>`; Permissions' build plan settles whether it stays.
5. **Changed: names made at run time are not built.** No caller needs them yet. The family shape, the `/` name ending,
   prefix routes and the store's `prefixes` flag are out of every slice, kept only as an open point for the first
   caller's ticket ("Left for the first caller of run-time names").
6. **Changed: names held in a setting are not built here,** as the plan leaned, and the plan waits on the owner's word on
   1752's sketch line. The lead is asking him (open question 1).
7. **Changed: slice 1 is split** so no slice is much over 300 lines: the store side (148), then declare, route and fetch
   (200). Sign with a given key is now slice 3 (308), the one that unblocks 1953. Generate, rotate and held signing
   joined keep time, schema and readable keys in slice 4 (246).

## Calls taken

- No build step and no `publishConfig`, as `@kalfa/git` (80%): the package is private, and publishing is recorded as
  later. A later bump adds rslib as `@kalfa/github` has it.
- `Secrets.layer` takes checked settings values and has no settings failure (85%), from `@kalfa/github`'s precedent.
- The start fails on the first problem in `declared` order (85%), as `@kalfa/config` does.
- Store answers are a tagged `Found` or `Missing` with a reason (80%); an empty held text is absent (85%).
- The memory store's place is `memory`, it holds values and keys apart, it reads a put key into a `PrivateKey` at once,
  and it counts versions per item (90%).
- `Signer.layer` provides Effect's WebCrypto Layers inside itself (80%), as `Id.Generator.layer` does.
- `KeyRefused` keeps the `CryptoError` as its cause (80%); the probe and X5 back it.
- A held key's version is the fingerprint of its public key, never a hash of the held text (80%): the public key is
  public, and a hash of a held value would let anyone with the ledger test guesses against it.
- A version this process has not kept is checked against `PublicKeys` once, then remembered in the process (80%).
- A new version seen on a signing key records `Rotated` before `Signed` (80%), so "Secrets records a rotation when it
  sees one" holds for signing keys from slice 3. A fetched secret has no kept versions to compare with, so its rotation
  is not seen (What this cannot tell us).
- A kept value is still recorded on every fetch (85%), with `from: "kept"`, since 1752 says each fetch is recorded.
- A failed record after generate carries the new public key (80%), as 1891 rules for the command.
- `/test` is `src/StoreTest.ts`, a shared suite as `@kalfa/git`'s `RepositoryTest.ts` (90%).
- The fact `Signed` and the result `Signed` live in two modules (85%).
- The doubts at the top: 70%, 75%, 75%, 75%; run-time names are not built (the lead's call).

## Validation

- The tests step runs its new files by path, then `pnpm format` and `pnpm lint`, and `node oxlint-plugins/law-ids.ts`.
  It does not run the changed-tests command or a typecheck: the lead does.
- The build runs the same narrow files, `pnpm format` and `pnpm lint`. The lead runs the changed tests and the
  typecheck once at the end, outside any box; CI runs the rest.
- No law needs the real machine, and none is an `.integration.` file.

## Size

1. Slice 1, the store side: 148 lines (`MemoryStore.ts` 50, `Store.ts` 40, `Name.ts` 20, `Recorder.ts` 18, `Errors.ts`
   10, `index.ts` 10), plus the package files, the rule rows, the lockfile and the store laws.
2. Slice 2, declare, route and fetch a secret: 200 lines (`internal/start.ts` 40, `Secret.ts` 35, `Errors.ts` 30,
   `internal/use.ts` 30, `Secrets.ts` 25, `Settings.ts` 25, `index.ts` 10, `Name.ts` 5).
3. Slice 3, sign with a given key, the one that unblocks 1953: 308 lines (`Signer.ts` 65, `internal/use.ts` 55,
   `SigningKey.ts` 50, `MemoryStore.ts` 45, `Signature.ts` 30, `PublicKeys.ts` 22, `Store.ts` 15, `internal/start.ts`
   15, `Recorder.ts` 8, `index.ts` 3).
4. Slice 4, generate, rotate, held signing, keep time, schema and readable keys: 246 lines (`internal/use.ts` 70,
   `Store.ts` 45, `MemoryStore.ts` 35, `SigningKey.ts` 30, `Settings.ts` 20, `Errors.ts` 18, `Secret.ts` 15,
   `Recorder.ts` 8, `internal/start.ts` 5).

902 product lines in all, about 9 agent hours across the four slices, 65% sure. The doubt is slice 2's start check and
slice 3's ordering of keep, record and return, which carry most of the laws and may each be sent back once. Budget basis:
the `@kalfa/github` plans priced about $9 to $12 a step for slices of this size. Slice 1 at about $9, $9 and $6: $24.
Slice 2 at about $10, $10 and $7: $27. Slice 3 at about $12, $12 and $8: $32. Slice 4 at about $11, $11 and $7: $29.
Two likely send-backs at about $12: $24.

Estimate: 14 steps, $136

## New names

- `Secret`, `SigningKey`, `SigningKey.given`, `SigningKey.make`, `SigningKey.Any`, `Signature.rsaPkcs1v15Sha256`,
  `Secrets.layer`, `Holds`, `Signs`, `Generates`, `Store.make`, `Store.signingFromHeld`, `Recorder`, `Fetched`, `Signed`,
  `Generated`, `Rotated`, `PublicKeys`, `keep`, `read`, the errors, `secrets.routes`, `secrets.fetch.keep`: the protocol's
  and the ticket's.
- `Signer`: the industry's word for what signs with a private key, as Go's `crypto.Signer`; a code name, not a domain
  word.
- `PublicKey`, `spki`, `fingerprint`: the standard words (SPKI is RFC 5280's SubjectPublicKeyInfo).
- `object`, `Proof`: Permissions' words, as decision 0057 uses them.
- `Found`, `Missing`, `Held`, `Place` (the glossary's private key's place), `ItemTaken`, `KeyRefused`, `Contents`,
  `Recorded`, `Needs`, `Literal`, `AlgorithmName`, `StoreId`, `from`, `secrets.public-keys.readable`:
  code names inside the package.
- New domain words, which the build writes into `kalfa/secrets/GLOSSARY.md`:
  - **Recorder** (slice 1): the slot the app fills to record each use; it takes four facts. _Avoid_: logger, audit log,
    journal.
  - **Keep time** (slice 4): how long a fetched value is kept for the next fetch of its name; 0 by default. _Avoid_:
    cache, TTL.

## Records

- `kalfa/secrets/GLOSSARY.md` gains Recorder and Keep time; `kalfa/AGENTS.md` gains the rank sentence.
- The README records the declarations, the routes, the memory store, the store laws, what never shows a value, and
  which Effect crypto calls the package leans on and how a bump shows.
- A decision record is the lead's call for two contracts: the object spelling `secret:<name>`, which `@kalfa/permissions`
  must match, and holding Effect's crypto behind `Signer` in one file. This plan writes none.
- When the owner answers open question 1, 1752's sketch line "a name is text or a setting that holds one" is struck or
  kept on that ticket, by the lead.

## What this cannot tell us

- Nothing here was built. The seven caller cases were type-checked in a scratch probe; the ports, the start check, the
  slots and `Signer` were not typed, and the property laws have not run.
- Whether `@kalfa/permissions` spells an object `type:id`. Decision 0057 asks for a law that builds a real Permissions
  proof; that law waits for the Permissions package, and it should be part of that package's first build ticket.
- How long a fetch takes with a real recorder: each fetch is one store read and one ledger append, on the TURN login
  path too, and no timing backs "no kept value" (1752 says so as well).
- Whether two processes keeping one version at once leave two `Rotated` facts on a real ledger; the memory slots take it
  as harmless, and the ledger recorder's ticket decides.
- Whether a fetched secret's rotation can be seen at all: Secrets keeps no versions of a secret, so a person's change in
  the store is recorded only as a `Fetched` with a new version.
- How names made at run time should be declared: not built, and the sketch under "Left for the first caller of
  run-time names" was never tried against a real caller (Transport's browser client keys are the likely first).
- Whether `Effect.cachedWithTTL` would serve the keep after all; the plan writes it by hand because each kept use is
  still recorded.

## Open questions

1. Name from a setting (1752 sketch: "a name is text or a setting that holds one"): drop it? Lean yes, 70%. Routes
   already pick the store and item per app, and a setting-held name makes the proof's object unknown until start. This
   plan builds literal names only and waits on this answer, which the lead is asking for; keeping the setting form adds
   about 40 lines later, as its own ticket, with the spelling under Doubts.

## Findings

1. **`secrets.routes` from the repo file hides the person's routes.** `@kalfa/config` takes one value per setting by
   precedence, and a list is replaced whole, so a repo that sets `secrets.routes` makes every route in the user file
   unread. Decision 0074 says a route to `/keychain` or `/file` may be set only in the user configuration, so on a laptop
   both files will route names at once. The `/keychain` and `/file` ticket must settle it, for example with a second,
   user-only setting `secrets.user-routes`. Proof: the "A flag wins over the environment, then the repo file, then the
   person file, then the default" paragraph of `kalfa/config/README.md`.
2. **`allowedUnstableApis` names no `effect/crypto/KeyFormat`.** `tsconfig.base.json`'s locked list holds
   `effect/crypto/Digest`, `SecureRandom`, `Signature` and `WebCrypto`. `kalfa/` is not locked, so nothing fails today;
   the day a folder that reads a key from text joins the list, it needs the entry.
3. **A proof kept in a long-lived Layer outlives its check.** 1953's acceptance says the app pipes its Permissions guard
   on for the GitHub Layer to build. A guard piped on a Layer provides one proof for the Layer's whole life, so the App
   key keeps signing after the permission is taken away, until a restart. Secrets cannot see this: it compares the
   object only. 1953's plan, or Permissions', should say whether a guard per call is meant.
4. **A held value's version must not be a hash of the value.** The `/env` and `/cloudflare` stores will need a version
   for a value that has none. A hash of the value on the ledger lets anyone who reads the ledger test guesses against
   a low-entropy secret. Their tickets should give a counter or the platform's own version, never a hash.
