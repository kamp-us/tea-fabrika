Approved by the lead agent, builds issues 1768, 2092; body 955f6f70252b
Plancheck-Version: 3

# Plan: @kalfa/permissions, declare a model, check a permission and guard a step, in memory (ticket 2092)

This is the kalfa packages (`kalfa/`), new work. It is not today's frozen version and not `next/`. The ticket is
https://github.com/kamp-us/tea-fabrika/issues/2092, the first build ticket of `@kalfa/permissions`. Its parent is the
settled protocol, https://github.com/kamp-us/tea-fabrika/issues/1768 (closed), with the owner's answers from
https://github.com/kamp-us/tea-fabrika/issues/1903 and the error name from
https://github.com/kamp-us/tea-fabrika/issues/1870. The package folder `kalfa/permissions/` holds only `GLOSSARY.md`
today. Today's permission code in `next/packages/libfabrika/src/permissions/` is left alone, and was read as a map only.

It lands as two pull requests (`## Slices`). Slice 1 needs nothing that is not on main and can start now. Slice 2 waits
for the Ledger pull request that puts the Ledger's three failure classes on main (`## What it needs from the Ledger`).

```ts
// The whole idea, a sketch. Every type line below was checked in a scratch probe on TypeScript 7.0.2 and Effect 4.1.3
// (see "Probe run while planning"); no body was run. The model is made up: the package names no app's words.
import { Model, Permission, Relation } from "@kalfa/permissions";
import * as PermissionsMemory from "@kalfa/permissions/memory";

const model = Model.make("library")
  .type("reader", {})
  .type("book", {
    relations: {
      author: Relation.one(["reader"], { change: "retitle" }), // one holder per book
      editor: Relation.many(["reader"], { change: "retitle" }),
    },
    permissions: {
      retitle: (r) => r.union("author"),
      edit: (r) => r.union("author", "editor"),
      read: (r) => r.union("edit"), // a permission may name another permission of the same type
    },
  });

// The class is the key of its proof (a Context key whose value is the proof).
class MayEdit extends Permission<MayEdit>()("library/MayEdit", { model, on: "book", permission: "edit" }) {}

MayEdit.check("reader:ann", "book:dune");
// Effect<Proof<MayEdit>, Denied | PermissionsUnavailable, RelationshipStore>

const rename = Effect.gen(function* () {
  const proof = yield* MayEdit; // the step needs the proof: Effect<void, never, MayEdit>
  // ... proof.object is "book:dune"
});
rename.pipe(MayEdit.guard("reader:ann", "book:dune"));
// Effect<void, Denied | PermissionsUnavailable, RelationshipStore>: MayEdit left the requirements

PermissionsMemory.layer(model, [{ subject: "reader:ann", relation: "editor", object: "book:dune" }]);
// Layer<RelationshipStore>
```

## Doubts, at the top

Each is a call this plan takes and builds on. Under 80% sure, it says what would settle it.

- **A guard makes one span, `permissions.guard`, around its check only, and the step runs after it, outside the span
  (75%).** The ticket says "check and guard each make one span". A guard that called the traced check would make two
  spans per guarded step, and a span that also wrapped the step would show the step's time as the guard's. So the guard
  runs the check's body untraced inside its own span. What would settle it: the lead's read of the ticket's sentence.
- **The span also carries the subject, as `kalfa.permissions.subject` (75%).** The ticket names the permission and the
  object. A span is the record of what happened (decision 0063), and without the subject a passed check does not say
  who passed it; a subject is an id, never a secret. OpenTelemetry has no attribute namespace for authorization (its
  registry page was read; there are 88 namespaces and none is about access control), so all three are `kalfa.permissions.*`.
  What would settle it: the lead strikes the subject, and the plan loses one attribute and one assertion.
- **A permission class has a checked `provide(proof)` (75%).** The ticket says "a value no check made is never accepted
  as one". Nothing else in this ticket takes a proof in, so without a door that checks the seal the rule has nothing to
  hold it. `MayEdit.provide(proof)` puts a proof from `check` into a step's context and dies on a value no check made,
  as today's `provide` in `next/packages/libfabrika/src/permissions/Rebac.ts` and phoenix's `Grant.provide` do. A caller
  who uses Effect's own `Effect.provideService` with a cast still gets past it; the type brand stops it without a cast.
  What would settle it: the lead's read; dropping it costs one law and about 8 lines.
- **A relation's `change` is optional (80%).** The ticket's criterion says "each with its subject types and its `change`
  permission", and the protocol's own sketch has `agent: Relation.many(["agent"])` with none. A relation with no
  `change` is one no write may touch: a fact another context owns and the app passes as a contextual relationship
  (https://github.com/kamp-us/tea-fabrika/issues/2094). Ticket 2095 builds the write that refuses it.
- **The store's port reads all relationships at once (80%).** `RelationshipStore` has one call, `read`, that gives an
  opaque `Relationships` value, and the check is a pure walk over it. Ticket 2096 needs exactly this: `checkIn` walks the
  same value inside a transaction, and its law says `check` and `checkIn` never answer differently. A lookup per
  relation (OpenFGA's storage `Read` with a tuple filter) would make the check many reads and the two walks different
  code. The cost: a big store reads more than one check needs. 2096 times it on 10,000 changes.
- **A malformed reference that gets past the types is a defect, not a typed error (80%).** The ticket fixes `check`'s
  errors as `Denied | PermissionsUnavailable`. The types refuse a plain string and an undeclared type; only a cast or an
  empty id (`"book:"` fits `` `book:${string}` ``) gets through, and that is a bug in the caller, so the check dies with
  an exact message and asks no store.

## What changes, in one paragraph

A new private workspace package, `@kalfa/permissions`, with two entry points. The root (`src/index.ts`) holds the
model builder (`Model`, `Relation`), references, the permission class (`Permission`) with `check`, `guard` and
`provide`, the sealed proof, the two errors and the store's port (`RelationshipStore`). It imports the Ledger's three
failure classes and their union, and nothing else of kalfa (decision 0091). `/memory` (`src/MemoryStore.ts`) provides
the port from the relationships it is handed, and imports no kalfa package. Out of scope, each its own ticket:
`intersection` and `arrow` (2093), contextual relationships (2094), changing relationships, `first` and `/test` (2095),
`checkIn` (2096), and the ledger store (2097, 2098).

## Slices

Each slice is its own pull request, branched from main after the one under it lands.

1. **Declare a model.** Branch `fabrikalfa/kalfa-permissions` (this worktree). The package, its manifest, tsconfig,
   lint overrides, rank rows and lockfile; `Model.make(name).type(...)`, `Relation.one` and `Relation.many`, `union`,
   and the run-time checks a declaration passes at module load. It lands whole: an app writes its model, every mistake
   in it is a compile error or a throw at load, and the owner can read one in the README. It says `Part of #2092`. It
   needs nothing from the Ledger, and starts now.
2. **Check a permission and guard a step, in memory.** Branch `fabrikalfa/kalfa-permissions-check`. `Reference`,
   `Permission` with `check`, `guard` and `provide`, `Proof`, `Denied`, `PermissionsUnavailable`, `RelationshipStore`,
   the walk, `/memory`, and the two spans. It lands whole: a step guarded by a permission runs only for a subject the
   memory store's relationships let in, and a sibling package can take the guard. It says `Closes #2092`. It waits for
   the Ledger's failure classes on main.

## What it needs from the Ledger

Slice 2's core names the Ledger's failures in `PermissionsUnavailable`'s `reason`, so it imports them (decision 0091).
Slice 1 imports nothing of the Ledger. Exactly this, from the root entry point `@kalfa/ledger` of
https://github.com/kamp-us/tea-fabrika/issues/2082, merged on main:

- The three classes `Unreachable`, `StorageFailed` and `BadRow`, each a `Schema.TaggedError` with those tags (2082's
  criterion "Each error is a `Schema.TaggedError`").
- `Failure`, the union of those three, exported as a Schema value and a type of the same name (2082: "The `Refusal` and
  `Failure` unions are exported so that wrapping needs no list of its own"). `PermissionsUnavailable` is a Schema class,
  so its `reason` needs the Schema, not only the type.
- Constructors a test can call with no Ledger running: whatever fields the classes take (a `cause: Schema.Defect()`,
  most likely, as `.kalfa/patterns/effect-errors-keep-their-cause.md` says) must be plain values.
- The package on main with its manifest, so `"@kalfa/ledger": "workspace:*"` resolves, and its row in `layer-rules.json`
  and `boundary-rules.json` (`kalfa-ledger`, layer 0, importing nothing), so this package's row can name it.

Nothing else: no `Ledger` service, no `Entry`, no `EntryId`, no `Refusal`, no helper. If 2082's first slice lands these,
slice 2 starts the day it merges. A local copy of the classes to start sooner is the option decision 0091 rejected.

## Searched first

- The ticket, whole. The protocol https://github.com/kamp-us/tea-fabrika/issues/1768 with all its comments (the shape,
  what was ruled, the gaps, decision 0078's answers, 1870's name, 1903's answers), and
  https://github.com/kamp-us/tea-fabrika/issues/1870 and https://github.com/kamp-us/tea-fabrika/issues/1903 whole.
- The later Permissions tickets 2093, 2094, 2095, 2096, 2097 and 2098, to keep their calls out of this one and keep the
  shapes they build on, and Secrets' fit ticket https://github.com/kamp-us/tea-fabrika/issues/2108.
- Ledger's first ticket https://github.com/kamp-us/tea-fabrika/issues/2082, for its error classes and unions. Its plan is
  being written in another worktree; no draft of it was on disk to read.
- The protocols that take the guard: Secrets https://github.com/kamp-us/tea-fabrika/issues/1752, Reconciliation
  https://github.com/kamp-us/tea-fabrika/issues/1758 (its `{ guard: (object) => MayReconcile.guard(bot, object) }`
  option, and its note that only an option that applies the guard to the proof's own key infers), Incidents
  https://github.com/kamp-us/tea-fabrika/issues/1759 (`{ guard }` on each call).
- Decisions 0025, 0047, 0048, 0056, 0057, 0063, 0078, 0079 and 0091 whole. `rg -il` over `.kalfa/decisions`,
  `.kalfa/glossary`, `.kalfa/patterns` and `.kalfa/runbooks` for "proof|permission", "relationship|rebac" and
  "unavailable|unreachable"; every kalfa hit read. Patterns read: `effect-errors-keep-their-cause.md`,
  `effect-services-and-layers.md`, `settings.md`. The research record `.kalfa/research/rebac-rule-words.md` (the words,
  and `type:id` with `#` for a subject set in Zanzibar, SpiceDB, OpenFGA and Permify).
- `kalfa/AGENTS.md`, `kalfa/permissions/GLOSSARY.md`, `kalfa/ledger/GLOSSARY.md`, `kalfa/secrets/GLOSSARY.md`.
- The newest packages for layout and wiring: `kalfa/secrets/` (manifest, tsconfig, README, `Errors.ts`, `MemoryStore.ts`,
  `Package.test.ts`, `Store.types.test.ts`) and the files its pull request https://github.com/kamp-us/tea-fabrika/pull/2058
  touched outside the package (`layer-rules.json`, `boundary-rules.json`, `oxlint-plugins/layers.test.ts`, the root
  `package.json`, `.oxlintrc.json`, `kalfa/AGENTS.md`, `pnpm-lock.yaml`); `kalfa/cli/` and its pull request
  https://github.com/kamp-us/tea-fabrika/pull/2289; the Secrets plan `.kalfa/quests/kalfa-secrets-sign-PLAN.md`, whose
  doubt "whether `@kalfa/permissions` spells an object `type:id`" this plan settles (yes).
- Today's code as a map: `next/packages/libfabrika/src/permissions/Rebac.ts`, `internal/proof.ts` (a `WeakMap` of minted
  proofs), `internal/evaluate.ts` (a visited set ends a loop of permissions), `Relation.ts`, `Relations.ts`.
- Installed versions in `pnpm-lock.yaml`: `effect` and `@effect/vitest` 4.1.3, `vitest` 5.0.5, TypeScript 7.0.2 with
  `@effect/tsgo` 0.63.0, oxlint 1.90.0. In Effect 4.1.3, read: `node_modules/effect/AGENTS.md` whole,
  `src/Context.ts` (`Key`, `Service`, `ServiceClass`; the string key is the run-time identity of a slot),
  `src/sql/SqlError.ts` (`override readonly cause = this.reason`, `override get message()`), and
  `ai-docs/src/01_effect/04_errors/20_reason-errors.ts` (`Effect.catchReason`). oxlint 1.90.0's
  `configuration_schema.json` has `allowImportNames` for `no-restricted-imports`.
- The law id check ran clean on this worktree. `kalfa/permissions/` has no laws yet, so every id this
  plan uses is free in its package.

## Probe run while planning

One throwaway file in a scratch folder outside the repo, type-checked with this worktree's `tsc` (7.0.2, with
`@effect/tsgo` 0.63.0) and Effect 4.1.3. Nothing was written into the repo, installed or committed. It typed the
builder, the class and the guard with stub bodies, and every case passed (`tsc` exit 0):

- The protocol's model with union only compiles. A `change` that names no permission of its type, an undeclared subject
  type, `"human#member"` in a subject list, a union naming an undeclared name, a type declared twice, a name typed as
  `string`, a permission sharing a relation's name, and an empty subject list each fail to compile.
- `Permission()` with no class fails, a permission of another type fails, and `on` typed as a union fails.
- The guard removes its own class from the requirements and adds `RelationshipStore`; another permission's guard leaves
  the class in place. An object of another type, a plain `string` object and an object literal typed as a proof fail.
- A stand-in for Reconciliation's `reconcile(key, object, { guard: (object) => MayX.guard(subject, object) })` infers
  `Denied | PermissionsUnavailable` and `RelationshipStore` with no annotation and no cast, once the option's type is
  the step's own: `(self: Effect<A, E, P>) => Effect<A, GE, GR>`. A generic `<A, E, R>` option came out `unknown`, as
  1758 found.
- Two first tries were wrong and are kept here: a mapped type that refused a permission named as a relation made
  TypeScript infer the relation names as permissions; a check on the name argument works instead. And a wrong `change`
  is reported on the type's name argument, not on the relation, so the error points one line off.

## How others do it

- **Zanzibar, SpiceDB, OpenFGA** (from `.kalfa/research/rebac-rule-words.md`, read 2026-11-20): an object and a subject
  are written `type:id` (`document:readme`, `user:emilia`), and `type#relation` names a subject set, so `#` stays out
  of an id. A schema declares each relation's allowed subject types, and a permission is a rewrite of the same type's
  relations (`union`). SpiceDB's `CheckPermission` answers has or has not; ours answers a proof or `Denied`.
- **OpenFGA's storage interface** (from memory, not fetched): `Read` takes a tuple filter and the check issues many
  reads. Not taken here, see the doubt on the store's port.
- **Elm** (from memory): a value of an opaque type can only be made by its module, so a function that takes one knows it
  came from there. That is the proof's seal: only `check` makes one. Erlang/OTP has no counterpart; nothing here waits
  or is supervised.
- **Effect** (read in 4.1.3): a `Context.Service` class is the key of a slot in an Effect's requirements; providing it
  removes it from `R`. That is the guard. `SqlError` keeps a typed `reason` and sets `cause` from it, and
  `Effect.catchReason` matches the reason's tag; that is `PermissionsUnavailable`.
- **phoenix's capabilities and today's `Rebac.ts`** (read in this repo): a class is the key of its proof, a `WeakMap`
  keeps minted proofs, and `provide` dies on a value `mint` never made. Taken, rethought for a store behind a port.

## The shape

### The package

```text
kalfa/permissions/
  package.json         @kalfa/permissions, private; exports ".", "./memory" (slice 2), "./package.json"; no build step
  tsconfig.json        as Secrets', with the Effect checks
  README.md            declare a model, a permission, check, guard, provide, the memory store, the errors, the spans
  GLOSSARY.md          gains Reference
  src/
    index.ts           the root: Model, Relation, Permission, Reference, Proof, Denied, PermissionsUnavailable, RelationshipStore
    Model.ts           Model.make, .type, Relation.one, Relation.many, Rules (union)                 slice 1
    internal/declare.ts the checks a declaration passes at load, and the declared data the walk reads  slice 1
    Reference.ts       Reference<T>, and its run-time check                                          slice 2
    Errors.ts          Denied, PermissionsUnavailable                                                slice 2
    Proof.ts           Proof<P>, mint, sealed                                                        slice 2
    Permission.ts      Permission<Self>()(id, { model, on, permission }): check, guard, provide      slice 2
    Store.ts           RelationshipStore, Relationship<T>, Relationships                             slice 2
    internal/walk.ts   Relationships.make (index and seed checks), and the walk                      slice 2
    MemoryStore.ts     the /memory entry point                                                       slice 2
```

```jsonc
// kalfa/permissions/package.json, a sketch. Slice 1 has no dependencies and no "./memory".
{
  "name": "@kalfa/permissions", "version": "0.0.0", "private": true, "type": "module",
  "scripts": { "typecheck": "tsc --noEmit" },
  "exports": { ".": "./src/index.ts", "./memory": "./src/MemoryStore.ts", "./package.json": "./package.json" },
  "dependencies": { "@kalfa/ledger": "workspace:*" },          // slice 2: the error classes only (0091)
  "peerDependencies": { "effect": "catalog:" },
  "devDependencies": { "@effect/vitest, @types/node, effect, typescript, vitest": "catalog:" },
  "engines": { "node": ">=26" }
}
```

No `/test` entry point: the laws every store passes come with the first store that changes (ticket 2095), so the
manifest has no optional vitest peers yet.

### The model (slice 1)

```ts
// kalfa/permissions/src/Model.ts, a sketch; the probe typed these signatures.
type Literal<N extends string> = string extends N ? never : IsUnion<N> extends true ? never : N;
/** A type, relation or permission name: written in code, and never empty or holding "#", ":" or a space. */
type Name<N extends string> = N extends "" | `${string}${"#" | ":" | " "}${string}` ? never : Literal<N>;

export interface Relation<S extends string, H extends "one" | "many", C extends string> {
  readonly [RelationTypeId]: { readonly subjects: S; readonly holds: H; readonly change: C };
}
export const one: <const S extends string, const C extends string = never>(
  subjects: readonly [S, ...ReadonlyArray<S>],    // at least one subject type, each a declared type name
  options?: { readonly change: C },
) => Relation<S, "one", C>;
export const many: /* the same, with "many" */;

export interface Rules<Names extends string> {
  readonly union: (first: Names, ...rest: ReadonlyArray<Names>) => Rule; // the same type's relations and permissions
}

export interface Model<T extends Types> {
  readonly name: string;
  readonly type: <
    const N extends string,
    const R extends { readonly [r: string]: Relation<(keyof T & string) | N, "one" | "many", NoInfer<P>> } = {},
    const P extends string = never,
  >(
    name: N extends keyof T ? never : [Extract<P, keyof R>] extends [never] ? Name<N> : never,
    shape: {
      readonly relations?: R;
      readonly permissions?: { readonly [K in P]: (r: Rules<(keyof R & string) | P>) => Rule };
    },
  ) => Model<T & { readonly [K in N]: { readonly relations: R; readonly permissions: P } }>;
}
export const make: (name: string) => Model<{}>;
```

A model is plain data plus its types: each step of `.type` makes a new model, and the declared data (each type's
relations with subjects, holds and change, and each permission's union of names) sits in a `ReadonlyMap` that only the
walk reads. The types catch every mistake a literal can make. For a value that got past them with a cast, `.type`
throws at module load, as `Secret.make` in Secrets does, with one of these exact messages:

| Mistake | Message |
|---|---|
| a name that is empty or holds `#`, `:` or a space | `model library: "<name>" is no name: a name starts with a lowercase letter and holds only letters, digits and _` |
| a type declared twice | `model library: type <type> is declared twice` |
| a `change` that is no permission of the type | `model library: <type>.<relation> changes by <change>, which is no permission of <type>` |
| a permission named as a relation | `model library: <type>.<name> is both a relation and a permission` |
| an empty subject list or an empty union | `model library: <type>.<name> names nothing` |
| a subject type that is not declared yet | `model library: <type>.<relation> names <subject>, which is no declared type` |

The name rule is `^[a-z][A-Za-z0-9_]*$`. A subject type must be declared before, or be the type being declared (a type
whose relation names itself, such as a folder in a folder). That keeps `type#relation` out of a subject list at run time
too, so the spelling stays free for a subject set later (ticket criterion 2).

### References, the proof and the errors (slice 2)

```ts
// kalfa/permissions/src/Reference.ts, a sketch.
/** One subject or object: a declared type and an id, written "type:id", as Zanzibar, SpiceDB and OpenFGA write it. */
export type Reference<T extends string> = `${T}:${string}`;
// The run-time check, used by check, guard and the memory store: the text before the first ":" is a declared type,
// and the id after it is not empty and holds no whitespace and no "#". Else: `"<text>" is no reference of model <name>`.
```

```ts
// kalfa/permissions/src/Proof.ts, a sketch, after today's internal/proof.ts.
declare const ProofTypeId: unique symbol;               // not exported, so no literal can be typed as a proof
export interface Proof<out P> {
  readonly [ProofTypeId]: (_: never) => P;
  readonly subject: string;
  readonly permission: string;
  readonly object: string;                               // public and plain, kept for good (decision 0057)
}
// mint: the one maker, called by a passed check. It freezes the proof and keeps it, with its class's key, in a WeakMap
// no other file reaches. sealed(value): that entry, or none for a value mint never made. A proof is no Schema.
```

```ts
// kalfa/permissions/src/Errors.ts, a sketch.
import { Failure } from "@kalfa/ledger";               // the error classes' union and nothing else (0091)

export class Denied extends Schema.TaggedError<Denied, { readonly brand: unique symbol }>()("Denied", {
  subject: Schema.String,
  permission: Schema.String,
  object: Schema.String,
}) {
  override get message(): string {
    return `${this.subject} lacks ${this.permission} on ${this.object}`;
  }
}

export class PermissionsUnavailable extends Schema.TaggedError<PermissionsUnavailable, { readonly brand: unique symbol }>()(
  "PermissionsUnavailable",
  { reason: Failure },                                   // Unreachable | StorageFailed | BadRow, the Ledger's own
) {
  override readonly cause = this.reason;                 // a log or a span shows the Ledger's error under it (#2018)
  override get message(): string {
    return `permissions could not be read: ${this.reason._tag}`;
  }
}
```

A caller that retries tells the reasons apart with `Effect.catchReason("PermissionsUnavailable", "BadRow", ...)`: a
retry can help `Unreachable` and `StorageFailed` and never `BadRow` (issue 1870). The README says so.

### The permission, check and guard (slice 2)

```ts
// kalfa/permissions/src/Permission.ts, a sketch; the probe typed these signatures.
export const Permission =
  <Self = never>() =>
  <const Id extends string, T extends Types, const On extends keyof T & string, const P extends T[On]["permissions"]>(
    id: [Self] extends [never] ? "give Permission its own class: Permission<Self>()" : Literal<Id>,
    config: { readonly model: Model<T>; readonly on: Literal<On>; readonly permission: Literal<P> },
  ) => Context.ServiceClass<Self, Id, Proof<Self>> & {
    readonly check: (subject: Reference<keyof T & string>, object: Reference<On>)
      => Effect<Proof<Self>, Denied | PermissionsUnavailable, RelationshipStore>;
    readonly guard: (subject: Reference<keyof T & string>, object: Reference<On>)
      => <A, E, R>(self: Effect<A, E, R>) => Effect<A, E | Denied | PermissionsUnavailable, Exclude<R, Self> | RelationshipStore>;
    readonly provide: (proof: Proof<Self>)
      => <A, E, R>(self: Effect<A, E, R>) => Effect<A, E, Exclude<R, Self>>;
  };
```

- `check` reads `RelationshipStore`, checks both references, walks, and mints a proof or fails `Denied`. It is
  `Effect.fn`-free: it builds `Effect.withSpan("permissions.check", { attributes })` per call, since the attributes are
  the call's arguments.
- `guard` runs the same body under `permissions.guard`, then provides the proof under the class's key with
  `Effect.provideService` and runs the step outside the span. A denied check never runs the step.
- `provide` checks `sealed(proof)` and that the key kept with it is this class's; else it dies with
  `library/MayEdit was handed a proof no check of it made`.
- At class creation, an `on` that is no declared type, a permission that is none of `on`'s, or an id already used by
  another permission class throws at module load: two classes with one id would share one slot in a context (Effect's
  string key is a slot's run-time identity), so a proof of one would satisfy the other.
- Span attributes: `kalfa.permissions.permission` (the permission's name), `kalfa.permissions.object`,
  `kalfa.permissions.subject` and `kalfa.permissions.id` (the class's id). A failure rides in the span's own failure.

### The store's port and the memory store (slice 2)

```ts
// kalfa/permissions/src/Store.ts, a sketch.
/** One kept fact, typed by the model: the relation is declared on the object's type and lists the subject's type. */
export type Relationship<T extends Types> = {
  [O in keyof T & string]: {
    [R in keyof T[O]["relations"] & string]: {
      readonly subject: Reference<SubjectsOf<T[O]["relations"][R]>>;
      readonly relation: R;
      readonly object: Reference<O>;
    };
  }[keyof T[O]["relations"] & string];
}[keyof T & string];

/** Every kept relationship, indexed for the walk. Opaque: only this package's walk reads it. */
export interface Relationships { readonly [RelationshipsTypeId]: unknown }

export class RelationshipStore extends Context.Service<
  RelationshipStore,
  { readonly read: Effect<Relationships, PermissionsUnavailable> }
>()("@kalfa/permissions/RelationshipStore") {}
```

(`SubjectsOf` is a sketch name for the helper that reads a relation's subject union; the build names it.)

```ts
// kalfa/permissions/src/MemoryStore.ts, a sketch.
export const layer: <T extends Types>(model: Model<T>, relationships: ReadonlyArray<Relationship<T>>) => Layer<RelationshipStore>;
```

The memory store behaves as the ledger store will on every edge. A real store never holds an undeclared relation, a
subject of a type its relation does not list, a malformed reference, or two holders of a one-relation on one object,
because the admission refuses each (decision 0078). So the memory layer refuses each in its seed and dies building, with
an exact message such as `memory store: book:dune has two holders of author, reader:ann and reader:bo`. The same
relationship twice is kept once. The index is a map from object to relation to a set of subjects, so no text join can
make two facts look alike.

### The walk

A permission holds when some relation its union reaches, through nested permissions, holds for the subject on the
object. A visited set ends a loop of permissions, and a loop alone holds nothing (today's `internal/evaluate.ts`).

## One value traced

The model and `MayEdit` above; the memory store seeded with `reader:ann editor book:dune`.

1. `rename.pipe(MayEdit.guard("reader:ann", "book:dune"))` compiles: `rename` needs `MayEdit`, the guard removes it and
   adds `RelationshipStore`. Run with `PermissionsMemory.layer(model, seed)`.
2. Building the layer checks the seed: `book` is declared, `editor` is a relation of `book`, it lists `reader`, both
   references are well formed, and `editor` is many. It indexes `book:dune -> editor -> {reader:ann}`.
3. The guard opens the span `permissions.guard` with `kalfa.permissions.permission = "edit"`,
   `kalfa.permissions.object = "book:dune"`, `kalfa.permissions.subject = "reader:ann"`, `kalfa.permissions.id =
   "library/MayEdit"`.
4. It checks both references against the model: `reader` and `book` are declared, `book` is `on`, both ids are good.
5. It reads the store: `Effect.succeed(relationships)`.
6. The walk: `edit` is `union(author, editor)`. `author` on `book:dune` holds no `reader:ann`; `editor` does. It holds.
7. `mint` makes `{ subject: "reader:ann", permission: "edit", object: "book:dune" }`, frozen, kept in the WeakMap with
   `MayEdit`'s key. The span ends.
8. The step runs with the proof provided; `yield* MayEdit` gives it, and `proof.object` is `"book:dune"`.
9. The same guard for `reader:bo` fails at step 6: `Denied { subject: "reader:bo", permission: "edit", object:
   "book:dune" }`, message `reader:bo lacks edit on book:dune`. The step never runs; the span records the failure.
10. A stand-in store whose `read` fails `PermissionsUnavailable { reason: BadRow }` fails step 5; `error.cause` is the
    `BadRow`, and `Effect.catchReason("PermissionsUnavailable", "BadRow", ...)` catches it.

## Generators

`models` in `kalfa/permissions/src/Permissions.test-support.ts` (the tests step's): a model of two to four types with
relations, one or many, and permissions as unions of the same type's names, nested; with relationships valid for it,
and subject and object references. `oracle` is a second, plain fixpoint walk over the same data, written in the test
support, that the check must agree with. The classes each generator must reach:

- Checks: (a) a permission reached only through another permission; (b) a loop of permissions, with and without a
  relation that holds; (c) the subject holds the relation on another object of the same type; (d) another subject with
  the same id and another type holds it (`reader:x` and `admin:x`); (e) the subject holds a relation the union does not
  name; (f) the seed holds the same relationship twice.
- References that get past the types with a cast: (g) an empty id; (h) an id with whitespace or `#`; (i) an undeclared
  type; (j) an object of a declared type other than `on`.
- Proofs: (k) an object literal cast to a proof; (l) a spread copy of a real proof, which keeps its symbol key; (m) a real
  proof of another permission, cast; (n) a real proof whose `object` is written after it was made.
- Store failures: (o) `Unreachable`; (p) `StorageFailed`; (q) `BadRow`.
- Declarations that get past the types with a cast: (r) a name that is empty or holds `#`, `:` or a space; (s) a type
  declared twice; (t) a `change` that is no permission of its type; (u) a permission named as a relation; (v) an empty
  subject list or an empty union; (w) a subject type not declared yet, `type#relation` among them.
- Memory seeds that get past the types with a cast: (x) a relation not declared on the object's type; (y) a subject of a
  type the relation does not list; (z) two holders of a one-relation on one object.

## Laws

Every law runs in memory on every pull request. None is host-only, and none is an `.integration.` test: the only store
is memory.

| Law | Kind | Generator | Plant | Where |
|---|---|---|---|---|
| M1, a model's types: the protocol-shaped made-up model compiles with no annotation; an undeclared type, relation or permission in a union, a subject list, a `change`, `Permission`'s `on` or `permission` does not compile; a `change` that is no permission of its type does not compile; `"reader#editor"` in a subject list does not compile; a name typed as `string` or as a union, a type declared twice, a permission named as a relation and an empty subject list each do not compile | type | type | drop `NoInfer` from `change`: the wrong-`change` line compiles, red; drop the `Extract<P, keyof R>` check: the shared-name line compiles, red; widen the subject list to `string`: the `#` line compiles, red | kalfa/permissions/src/Model.types.test.ts |
| M2, a declaration that gets past the types throws at load with its exact message: for (r), (s), (t), (u), (v) and (w), `.type` throws the message in "The model", and a valid declaration throws nothing. 200 runs | test | fc.letrec: models, with one mistake each | delete the name rule: (r) red; delete the twice check: (s) red; delete the `change` check: (t) red; delete the shared-name check: (u) red; delete the empty check: (v) red; accept `type#relation` as declared: (w) red | kalfa/permissions/src/Model.test.ts |
| M3, the model is plain data: declaring a type returns a new model and leaves the earlier one as it was; two models built from one start share nothing | scenario: two models from one `Model.make` | scenario: a start model and two branches | make `.type` change its own map in place: red | kalfa/permissions/src/Model.test.ts |
| R1, a reference's types: `check` and `guard` take `Reference` of a declared type for the subject and of `on` for the object; a plain `string`, an object of another type and a subject of an undeclared type do not compile; a union of declared subject types compiles | type | type | type the subject as `string`: the plain-string line compiles, red; type the object as `Reference<keyof T>`: the other-type line compiles, red | kalfa/permissions/src/Permission.types.test.ts |
| R2, a reference that gets past the types is a defect with its exact message, and no store is read: for (g), (h), (i) and (j), as subject or object, `check` and `guard` die with `"<text>" is no reference of model <name>`, and a counting stand-in store saw no read. 200 runs | test | fc.letrec: models, with a bad reference | let an empty id through: (g) red; let `#` through: (h) red; skip the declared-type check: (i) red; skip the `on` check for the object: (j) red; read the store before the check: the no-read line red | kalfa/permissions/src/Permission.test.ts |
| C1, check's type is `Effect<Proof<P>, Denied \| PermissionsUnavailable, RelationshipStore>` for the class's own `P`, with no annotation | type | type | type the error as `Denied` only: red; type the proof as `Proof<unknown>`: red | kalfa/permissions/src/Permission.types.test.ts |
| C2, the check agrees with the oracle: for every generated model, seed, subject, object and permission, `check` over the memory store passes exactly when `oracle` says the permission holds. 500 runs | test | fc.letrec: models and seeds | walk one level only: (a) red; drop the visited set: (b) hangs, red under the test's timeout; key the index by object id alone: (c) red; compare subject ids without their types: (d) red; let any relation of the type count: (e) red; count a twice-seeded fact as two holders of a one-relation: (f) red | kalfa/permissions/src/Permission.test.ts |
| C3, a denial says who, what and which object: every denied check fails `Denied` with that subject, permission name and object, and its message is exactly `<subject> lacks <permission> on <object>`. 200 runs | test | fc.letrec: models and seeds, denied cases | put the class id in `permission`: red; swap subject and object in the message: red | kalfa/permissions/src/Permission.test.ts |
| U1, a store that cannot answer fails `PermissionsUnavailable` with that reason: for (o), (p) and (q), `check` and `guard` fail it with the Ledger's own error as `reason`, `error.cause` is that same value, the message is `permissions could not be read: <tag>`, and `Cause.pretty` of the exit shows the reason's tag. 30 runs | test | fc.constantFrom: the three reasons | drop `cause = this.reason`: the cause line red; wrap only `Unreachable` and die on the others: (p) and (q) red; fail `Unreachable` as a defect: (o) red; map `BadRow` to `StorageFailed`: (q) red | kalfa/permissions/src/Errors.test.ts |
| U2, a caller can tell `BadRow` from the other two: a retry wrapper written with `Effect.catchReason("PermissionsUnavailable", "BadRow", ...)` retries (o) and (p) and stops at once on (q), and its counting store saw exactly the reads it says. 30 runs | test | fc.constantFrom: the three reasons | type the reason as one plain tag text: the `catchReason` line fails to compile, red; stop retrying on every reason: (o) and (p) red; retry `BadRow` too: (q) red | kalfa/permissions/src/Errors.test.ts |
| U3, the errors' types: `PermissionsUnavailable["reason"]` is exactly the Ledger's `Failure`; `Denied` has exactly `subject`, `permission` and `object` | type | type | type the reason as `unknown`: red | kalfa/permissions/src/Errors.types.test.ts |
| G1, a step that needs a proof does not compile until its guard is piped on: running it unguarded is a compile error; its own guard removes the class from `R` and adds `RelationshipStore`; another permission's guard leaves the class in `R`; `provide` of a `check`'s proof removes it too; `Permission()` with no class does not compile | type | type | type the guard's result `R` as `R \| RelationshipStore`: the removal line fails, red; type it `Exclude<R, unknown>`: the other-guard line compiles, red; give `Self` the default `unknown`: the no-class line compiles, red | kalfa/permissions/src/Permission.types.test.ts |
| G2, a sibling's `{ guard }` option infers: a stand-in shaped as Reconciliation's `reconcile(key, object, { guard: (object) => MayEdit.guard(subject, object) })`, its option typed `(self: Effect<A, E, P>) => Effect<A, GE, GR>`, gives `Denied \| PermissionsUnavailable` and `RelationshipStore` with no annotation and no cast; a stand-in shaped as Secrets' `TurnKey.pipe(MayFetch.guard(subject, TurnKey.object))`, with `object` the literal `"secret:<name>"`, compiles | type | type | type `guard`'s object as `string`: the literal line still compiles but the `Reference<On>` line in R1 fails, red; make the guard's step generic in the sibling stand-in's place: the inference line fails, red | kalfa/permissions/src/Guard.types.test.ts |
| G3, a denied guard never runs its step, and a passed one runs it once with the proof: for every generated case, a step that counts its runs ran once exactly when `oracle` holds, and the proof it read has the checked subject, permission and object. 300 runs | test | fc.letrec: models and seeds | run the step before the check: red; provide a proof made for the other object: the object line red | kalfa/permissions/src/Permission.test.ts |
| F1, a proof names its one object in a plain public field: `proof.object` is the checked reference, `Object.keys` shows `subject`, `permission` and `object`, and a type test reads `proof.object` as a `string` with no import of the brand. 200 runs | test | fc.letrec: models and seeds, passed cases | rename `object` to `target`: red; hide it behind a getter: the keys line red | kalfa/permissions/src/Proof.test.ts |
| F2, a value no check made is never accepted: `provide` dies with `<id> was handed a proof no check of it made` for (k), (l) and (m), and the step never runs; for (n) the write throws, since a proof is frozen, and the proof's `object` is unchanged; a real proof of this class is provided. 200 runs | test | fc.letrec: models and seeds, with a forged proof | skip `sealed`: (k) red; seal by the symbol key instead of the WeakMap: (l) red; skip the key check: (m) red; drop the freeze: (n) red | kalfa/permissions/src/Proof.test.ts |
| F3, a proof is no Schema and no literal is one: an object literal typed `Proof<MayEdit>` does not compile; `Schema.isSchema` of a proof is false and the root exports no Schema for it | type | type | export the brand symbol: the literal line compiles, red | kalfa/permissions/src/Proof.types.test.ts |
| F4, a permission class's declaration is checked at load: an `on` that is no declared type, a permission none of `on`'s and a second class with an id already used each throw an exact message, cast past the types | scenario: three casts and one repeat | scenario: one made-up model | delete the repeat-id check: the repeat line red; delete the `on` check: red | kalfa/permissions/src/Permission.test.ts |
| S1, the memory store gives back what it was handed: for every generated seed, the relationships `read` gives hold exactly the seed's facts, each once, so C2's oracle agrees on every check; two layers built from one seed share nothing. 300 runs | test | fc.letrec: models and seeds | drop the last fact of the seed: red; share one index across builds: the share line red | kalfa/permissions/src/MemoryStore.test.ts |
| S2, a seed a real store could never hold fails the layer's build with its exact message: (x), (y), (z), and a malformed reference (g) to (i) in the seed. 200 runs | test | fc.letrec: models, with one bad seed fact | skip the declared-relation check: (x) red; skip the subject-type check: (y) red; skip the one-holder check: (z) red | kalfa/permissions/src/MemoryStore.test.ts |
| S3, a seed's types: a literal seed for the model infers with no annotation; a relation the object's type lacks, a subject type the relation does not list and a relation typed as `string` do not compile; a seed typed with a union of objects compiles | type | type | type the seed as `ReadonlyArray<{ subject: string; relation: string; object: string }>`: the bad-relation line compiles, red | kalfa/permissions/src/MemoryStore.types.test.ts |
| T1, spans: each `check` makes exactly one span, `permissions.check`, and each `guard` exactly one, `permissions.guard`, with no `permissions.check` under it, carrying `kalfa.permissions.permission`, `kalfa.permissions.object`, `kalfa.permissions.subject` and `kalfa.permissions.id`; the step's own span is a sibling of the guard's, not its child; a denial and an unavailable store end the span failed. Read from an in-memory tracer. 100 runs | test | fc.letrec: models and seeds | have the guard call the traced check: the one-span line red; wrap the step in the guard's span: the sibling line red; leave out the object attribute: red | kalfa/permissions/src/Spans.test.ts |
| P1, the manifest: a private package, `effect` its one peer, the root, `./memory` and `./package.json` exports each to a file that exists, and `@kalfa/ledger` its one dependency of this repo (slice 1: none) | scenario: the package's own manifest at head | scenario: the manifest at head | add `@kalfa/config` to the dependencies: red; point `./memory` at another file: red | kalfa/permissions/src/Package.test.ts |
| P2, the package names no app's words and no forbidden error name: its source files outside tests hold none of the protocol's app words (human, agent, project, owner, admin, member, freezer) and no `RelationshipsUnreachable`; no class it exports has the tag `Unreachable`; the root exports exactly the names in "The package" | scenario: the package's source at head, words written in pieces | scenario: the source files at head | add a `project` type to a doc example in `Model.ts`: red; export an `Unreachable` of our own: red | kalfa/permissions/src/Package.test.ts |
| L1, the core's imports: the core imports `@kalfa/ledger`'s `Unreachable`, `StorageFailed`, `BadRow` and `Failure` and nothing else of it (`allowImportNames`; a namespace import is refused), no other kalfa or repo package, no Telemetry, no Identity, no Node module | lint | lint | import `Ledger` from `@kalfa/ledger`: `pnpm lint` red; `import * as Ledger from "@kalfa/ledger"`: red; import `@kalfa/identity`: red | .oxlintrc.json |
| L2, `/memory` imports no kalfa package, `@kalfa/ledger` included | lint | lint | import `Failure` from `@kalfa/ledger` in `MemoryStore.ts`: `pnpm lint` red | .oxlintrc.json |
| L3, the ranks: `kalfa-permissions` is layer 0 importing nothing in slice 1, and layer 1 importing only `kalfa-ledger` in slice 2 | test | scenario: the real rule file | rank it 0 in slice 2: red | oxlint-plugins/layers.test.ts |

The `.types.test.ts` files run under vitest too, as Secrets' do: each law's lines sit in a helper, and its `it` names it.
No `declare const` in a test: a value a type law needs is a parameter of the helper or a real value.

## Acceptance criteria and their laws

| Criterion (ticket 2092) | Laws |
|---|---|
| 1. `Model.make(name).type(...)` with `Relation.one`, `Relation.many`, `change` and `union`; undeclared names and a wrong `change` do not compile | M1, M2, M3 |
| 2. A subject list names types only; `type#relation` is not accepted | M1, M2 (w) |
| 3. A subject and an object are a declared type and an id; exactly one subject; no empty subject | R1, R2 (g) to (j) |
| 4. `check`'s type; `Denied` carries subject, permission and object | C1, C2, C3 |
| 5. `PermissionsUnavailable`, its Ledger `reason`, its `cause`; it imports only the Ledger's error classes | U1, U3, L1 |
| 6. A caller tells `BadRow` from the other two | U2 |
| 7. No `RelationshipsUnreachable`, no own `Unreachable` | P2 |
| 8. A step does not compile until its guard is piped on; another guard leaves the requirement | G1, G3 |
| 9. A sibling's `{ guard }` option infers with no annotation and no cast | G2 |
| 10. A proof names its object in a public plain field `object` | F1 |
| 11. A proof is sealed and is no Schema | F2, F3, F4 |
| 12. `/memory` provides `RelationshipStore` from the relationships it is given | S1, S2, S3 |
| 13. The package names no app's type, relation or permission; tests use a made-up model | P2 |
| 14. The core imports only the Ledger's error classes; `/memory` no kalfa package; neither Identity | L1, L2, L3, P1 |
| 15. Spans `permissions.check` and `permissions.guard`, made with Effect's own; no Telemetry import | T1, L1 |

## Files

| File | Owner | Slice | Product lines expected | What |
|---|---|---|---|---|
| kalfa/permissions/package.json | build | 1 | config | new; slice 2 adds `./memory` and `@kalfa/ledger` |
| kalfa/permissions/tsconfig.json | tests | 1 | config | new, as Secrets' tsconfig; an exam path, so the tests step writes it |
| kalfa/permissions/README.md | build | 1 | docs | new; slice 2 adds the check, the guard, the store, the errors and the spans |
| kalfa/permissions/GLOSSARY.md | build | 2 | docs | adds Reference |
| kalfa/permissions/src/index.ts | build | 1 | 15 | the root entry point; slice 2 adds its exports |
| kalfa/permissions/src/Model.ts | build | 1 | 110 | `Model`, `Relation`, `Rules` |
| kalfa/permissions/src/internal/declare.ts | build | 1 | 55 | the load-time checks and the declared data |
| kalfa/permissions/src/Model.types.test.ts | tests | 1 | tests | M1 |
| kalfa/permissions/src/Model.test.ts | tests | 1 | tests | M2, M3 |
| kalfa/permissions/src/Package.test.ts | tests | 1 | tests | P1, P2; slice 2 changes P1's dependency line |
| kalfa/permissions/src/Permissions.test-support.ts | tests | 1 | tests | `models` and `oracle`; slice 2 adds seeds, references, forged proofs, stand-in stores, a recording tracer |
| kalfa/AGENTS.md | build | 1 | docs | the rank sentence for Permissions; slice 2 says it ranks above the Ledger |
| layer-rules.json | tests | 1 | config | the `kalfa-permissions` row and its root in the library list; slice 2 makes it layer 1 importing `kalfa-ledger` |
| boundary-rules.json | tests | 1 | config | the `kalfa-permissions` library; slice 2 adds `kalfa-ledger` to its imports |
| oxlint-plugins/layers.test.ts | tests | 1 | tests | L3: the pinned rank, 0 then 1 |
| .oxlintrc.json | tests | 1 | config | the package's override and its folder in the kalfa Effect block; slice 2 adds the `@kalfa/ledger` allow list and the `/memory` override |
| package.json | tests | 1 | config | the root's `@kalfa/permissions` workspace entry, as for Secrets |
| pnpm-lock.yaml | tests | 1 | tests | one `pnpm install --offline`, in each slice |
| kalfa/permissions/src/Reference.ts | build | 2 | 25 | `Reference` and its check |
| kalfa/permissions/src/Errors.ts | build | 2 | 35 | `Denied`, `PermissionsUnavailable` |
| kalfa/permissions/src/Proof.ts | build | 2 | 30 | `Proof`, `mint`, `sealed` |
| kalfa/permissions/src/Permission.ts | build | 2 | 85 | the class, `check`, `guard`, `provide`, the spans |
| kalfa/permissions/src/Store.ts | build | 2 | 30 | `RelationshipStore`, `Relationship`, `Relationships` |
| kalfa/permissions/src/internal/walk.ts | build | 2 | 55 | the index, the seed checks and the walk |
| kalfa/permissions/src/MemoryStore.ts | build | 2 | 20 | the `/memory` entry point |
| kalfa/permissions/src/Permission.types.test.ts | tests | 2 | tests | R1, C1, G1 |
| kalfa/permissions/src/Permission.test.ts | tests | 2 | tests | R2, C2, C3, G3, F4 |
| kalfa/permissions/src/Guard.types.test.ts | tests | 2 | tests | G2 |
| kalfa/permissions/src/Errors.test.ts | tests | 2 | tests | U1, U2 |
| kalfa/permissions/src/Errors.types.test.ts | tests | 2 | tests | U3 |
| kalfa/permissions/src/Proof.test.ts | tests | 2 | tests | F1, F2 |
| kalfa/permissions/src/Proof.types.test.ts | tests | 2 | tests | F3 |
| kalfa/permissions/src/MemoryStore.test.ts | tests | 2 | tests | S1, S2 |
| kalfa/permissions/src/MemoryStore.types.test.ts | tests | 2 | tests | S3 |
| kalfa/permissions/src/Spans.test.ts | tests | 2 | tests | T1 |

## Existing tools

- `kalfa/permissions/src/Model.ts`: searched `kalfa/` (no model builder outside `next/`), Effect 4.1.3 (no ReBAC model;
  `Schema` declares data shapes, not rewrites), npm (`@authzed/authzed-node` and `@openfga/sdk` are clients of a server
  and decision 0025 rules out a server). Rethought from `next/packages/libfabrika/src/permissions/Rebac.ts`, not
  copied: `next/` is not a dependency of a kalfa package.
- `kalfa/permissions/src/internal/declare.ts`: searched `kalfa/config/src` (its group's start checks are for settings,
  not names) and Effect's `Schema.isPattern` (used for the name rule, so no hand-written regex test).
- `kalfa/permissions/src/Reference.ts`: searched `kalfa/ledger` (not built), Chat's `ReplyId` (another shape) and
  Effect's `Schema.TemplateLiteral` (it types the text but not the declared-type rule, so the check is a small function
  over `Schema.isPattern`).
- `kalfa/permissions/src/Errors.ts`: searched `kalfa/secrets/src/Errors.ts` and `kalfa/git` for a `<Package>Unavailable`
  to copy; Effect's `SqlError` gives the `cause` line, and the Ledger gives the reasons.
- `kalfa/permissions/src/Proof.ts`: searched Effect for a sealed-value module (none; `Brand` is a type only and a cast
  passes it) and `next/packages/libfabrika/src/permissions/internal/proof.ts` (the `WeakMap` way, taken).
- `kalfa/permissions/src/Permission.ts`: searched Effect's `Context.Service` (the class is built on it) and
  `Effect.provideService` (the guard uses it); no Effect helper removes one requirement after a check.
- `kalfa/permissions/src/Store.ts`: searched `kalfa/secrets/src/Store.ts` for the port shape and Effect's
  `Context.Service` (used).
- `kalfa/permissions/src/internal/walk.ts`: searched Effect's `Graph` module (a general graph with no rewrite rules) and
  `next/packages/libfabrika/src/permissions/internal/evaluate.ts` (the visited-set walk, taken).
- `kalfa/permissions/src/MemoryStore.ts`: searched `kalfa/secrets/src/MemoryStore.ts` and `kalfa/git`'s memory
  repository for the layer shape; Effect's `Layer.effect` builds it.
- `kalfa/permissions/src/index.ts`: searched the sibling roots; it re-exports, as `kalfa/secrets/src/index.ts` does.

## New names

- **Reference** (domain word, goes in `kalfa/permissions/GLOSSARY.md`): one subject or object, a declared type and an
  id, written `type:id`. _Avoid_: ref, key, handle, address, URN. SpiceDB says "object reference".
- `Model`, `Relation`, `Permission`, `Proof`, `Denied`, `Union`, `Subject`, `Object`, `Check`: already in the glossary.
- `RelationshipStore`, `PermissionsUnavailable`: the ticket's names.
- `Rule`, `Rules`: the value a union makes and the helper a rule body gets; code names under the glossary's
  Permission line, no glossary entry.
- `mint`, `sealed`: internal code names from today's code, kept.

## Settings

- The name rule and the reference rule: not settings. They are the contract with the ledger store and with every
  package that spells an object (Secrets' `secret:<name>`), and a setting would let a file change which references
  exist.
- No limit is added: no length cap on names or ids. A reference's length is bounded by the ledger store's entry size,
  which is the Ledger's setting (2082, 2,000,000 bytes by default).
- The span names and attributes: not settings (decision 0063 names them).

## What fact is lost if not recorded now

Nothing is kept by this ticket: a check reads and writes no record, and a proof is never saved. A check's record is its
span, so the span carries the subject too (see the doubt): without it, a passed check would say nothing of who passed,
and that cannot be rebuilt later.

## Size

1. Declare a model: 180 lines.
2. Check a permission and guard a step, in memory: 280 lines.

The two are about 460 product lines, beside config, docs and tests. I am 75% sure of the numbers: the types in
`Model.ts` are the part most likely to grow, as the probe's two wrong first tries showed. Steps: tests, build and review
for each slice, plus one likely send-back of the tests step in slice 2, where the generators are many. Effect code with
many laws, at about $10 a step.

Estimate: 7 steps, $70

## Records

- `kalfa/permissions/GLOSSARY.md` gains Reference.
- `kalfa/AGENTS.md` gains the rank sentence: Permissions imports no kalfa package in slice 1, and ranks just above the
  Ledger, importing only its error classes, in slice 2 (decision 0091).
- The README records the model, the class, check, guard and provide, the memory store, the two errors and which
  reason a retry can help, and the spans.
- The layer rules name decision 0091's exception, as that decision asks.
- No decision record: the calls here pick how the code does what the protocol and decisions 0056, 0057 and 0091 say.
  `type:id` as the reference spelling is a contract with Secrets; the lead may want it as a line in 0057's consequences.

## What this cannot tell us

- Nothing was built. The probe typed stub signatures only; no body ran and no property law has run.
- Whether a wrong class in `Permission<Other>()` is caught. Effect's `classSelfMismatch` check holds Effect's own
  classes, not a factory of ours, so `class A extends Permission<B>()(...)` compiles and its guard removes `B`. Nothing
  in this plan closes it (see Findings).
- Whether reading every relationship per check is fast enough on a ledger store: ticket 2096 times it.
- Whether the error a wrong `change` gives, reported on the type's name, reads well enough to a person. The probe showed
  where it lands, not how it reads.
- Whether the Ledger's classes take fields a test can make with no Ledger. 2082's plan is not written yet.

## Open questions

None.

## Lead's calls at signing (2026-11-23)

- Slice 1 (declaring a model) starts first; slice 2 waits for Ledger's first ticket (https://github.com/kamp-us/tea-fabrika/issues/2082) to land the error classes and rows this plan names.
- Kept, each at 75% with its law: the guard's span covers its check only, and the step runs outside it; spans carry `kalfa.permissions.subject`; a checked `MayX.provide(proof)` is the one door that accepts a proof.

## Findings

1. **Reconciliation's object is not `type:id`.** https://github.com/kamp-us/tea-fabrika/issues/1758 says a proof names
   one item "such as `codehost/ref-rule/main`". This package's guard takes `Reference<On>`, `type:id`, as Secrets'
   `secret:<name>` and Incidents' `severity:sev0` do, so Reconciliation's build ticket must spell its items with a type
   word first (for example `ref-rule:codehost/main`). Proof: the "Proof names one item" line of 1758's resolution.
2. **A wrong class in `Permission<Self>()` compiles.** Effect's checker (`classSelfMismatch`, on in the base tsconfig)
   holds only Effect's own class factories. A lint rule of ours that holds `class X extends Permission<X>()`
   would close it, and the same rule would hold Secrets' and any later factory. It is a ticket of its own.
3. **`kalfa/secrets/src/**` is not in the kalfa Effect lint block.** `.oxlintrc.json`'s block that turns on
   `fabrika/no-promises`, `fabrika/effect-functions`, `fabrika/no-cause-squash` and the others lists `kalfa/cli`,
   `kalfa/config`, `kalfa/diagnostics`, `kalfa/git`, `kalfa/github` and `kalfa/markdown`, and not `kalfa/secrets`
   (the `"files"` list of the block whose comment begins "The config engine moved to kalfa/config"). This plan adds
   `kalfa/permissions/src/**` to it; Secrets' gap is one line for the lead.
