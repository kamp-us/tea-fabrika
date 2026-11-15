# Modules guidelines

**Proposed 2026-11-14.** From [experiment 294](../../experiments/294-modules-guidelines.md). There
is no Design canvas: this area has no screen, so its shapes are code blocks.

How a module file in `next/` is named, what it exports, how other code reads it, and how an index
file is written. A **module file** is one `.ts` file with one concept, as in Effect's source and
[0032](../../.decisions/0032-libraries-take-effects-file-layout.md). A folder of libfabrika is also
called a module ([0091](../../.decisions/0091-modules-and-layers.md)); this page names such a folder
in full. Everything here is about `next/`; today's version is not touched.

The whole idea: the reader always sees the module's name first, so the export never says it again.

```ts
// next/packages/libfabrika/src/settings/Declarations.ts:35, the shape to copy
import * as Setting from "./Setting.ts";
export const port = Setting.make("instance.port", { ... });

// next/packages/libfabrika/src/ledger/NodeSqlite.ts:37, the shape to avoid
export const nodeSql = (db: DatabaseSync): Sql => { ... };
import { nodeSql } from "../ledger/NodeSqlite.ts"; // 60 files read it this way

// Effect's shape, @effect/sql-d1 4.1.2, src/D1Client.ts:108, :215, :421
D1Client.D1Client;
D1Client.make(...);
D1Client.layer(...);
```

| Use | Avoid |
|---|---|
| `NodeSqlite.make(db)` | `nodeSql(db)`, `makeNodeSqlite(db)` |
| `LedgerSql.layer(sql, caller)` | `ledgerSqlLayer`, `LedgerSqlLive` |
| `Sshsig.verify(...)` | `verifySshsig(...)` |
| `ExitReason.decode(...)` | `decodeExitReason(...)` |
| `isOption`, `LedgerError` | (these two may repeat the module) |
| `import * as Setting from "./Setting.ts"` | `import { make } from "./Setting.ts"` |
| a generated `export * as Setting from "./settings/Setting.ts"` | a hand-written `export { make } from ...` |

## M1: one module file, one PascalCase name, private parts in `internal/`

- **Kind:** lint.
- **Means:** a library file holds one concept and is named in PascalCase, `Ledger.ts`. A variant is
  a prefixed sibling, `LedgerSql.ts`. Code only the module uses goes in `internal/`, in camelCase,
  each export marked `@internal`, and no other folder imports it.
- **Why:** Effect's source is flat PascalCase modules with camelCase `internal/` files. Erlang:
  "The name `Module`, an atom, is to be the same as the file name minus the extension `.erl`"
  ([modules](https://www.erlang.org/doc/system/modules.html)).
- **Example:** `next/packages/libfabrika/src/ledger/Ledger.ts`, `LedgerSql.ts`, and
  `ledger/internal/ledgerPages.ts`.
- **Held by:** [0023](../../.decisions/0023-next-follows-effects-code-style.md),
  [0032](../../.decisions/0032-libraries-take-effects-file-layout.md) and
  [0043](../../.decisions/0043-rooms-on-floors.md); the rules `unicorn/filename-case`,
  `fabrika/modules` and `eslint/no-restricted-imports` (`next/AGENTS.md:47`).
- **Breaks today:** the lower-case files in `next/packages/libfabrika/src/cloudflare/` and
  `node/build/`, `node/dev/`, which the file name rule does not cover yet, such as
  `cloudflare/runtime.ts` (2,305 lines). The running example follows it: `settings/Setting.ts` and
  `ledger/NodeSqlite.ts` are both PascalCase.

## M2: the module's main thing carries the module's name

- **Kind:** taste.
- **Means:** when a module has one main type, service or schema, it is named as the module, so a
  reader writes `Setting.Setting`, `Ledger.Ledger`. A layer file or a constructor module has no main
  type and needs none.
- **Why:** Effect: `export type Option<A>` (`effect/src/Option.ts:57`) and
  `export const D1Client = Context.Service<D1Client>(...)` (`@effect/sql-d1/src/D1Client.ts:108`).
  Elm's core: `type Dict k v` in `module Dict`
  ([`src/Dict.elm`](https://github.com/elm/core/blob/master/src/Dict.elm)). Go: "users see it as
  `bufio.Reader`, which is a clear, concise name"
  ([Effective Go](https://go.dev/doc/effective_go#package-names)).
- **Example:** `export interface Setting<...>` at
  `next/packages/libfabrika/src/settings/Setting.ts:54`.
- **Held by:** review, against the module's neighbors (M7).
- **Breaks today:** Nothing: today's `Setting.ts` follows it at `:54`. `NodeSqlite.ts` has no main
  type, as Effect's `NodeFileSystem.ts` has none.

## M3: short words after the module name

- **Kind:** taste.
- **Means:** the main constructor is `make`. A layer file's layer is `layer`. Another constructor is
  a plain word or `fromX`. A variant goes after the verb: `layerTest`, `makeUnsafe`. Never
  `make<Module>`, `<module>Layer`, `<Module>Live`, or the module's own name in camelCase. A module
  whose whole job is one verb may keep it, as Effect keeps `Hash.hash`.
- **Why:** Elm: "A function called `State.runState` is redundant and silly", and "With a name like
  `State.run` the user is encouraged to disambiguate functions with namespacing"
  ([design guidelines](https://package.elm-lang.org/help/design-guidelines)). Go: "the package is
  called `ring`, it's called just `New`, which clients of the package see as `ring.New`"
  ([Effective Go](https://go.dev/doc/effective_go#package-names)). Effect has 0 `make<Module>` and 0
  `<module>Layer` across the 408 public modules of 4.1.2.
- **Example:**

  ```ts
  // @effect/sql-d1 4.1.2, src/D1Client.ts:215 and :421
  export const make = (
  export const layer = (

  // next/packages/libfabrika/src/ledger/LedgerSql.ts:26, read as LedgerSql.layer(sql, caller)
  export const layer = (sql: Sql, caller: { readonly reader: string }): Layer.Layer<Ledger, never, Doorbell> =>
  ```

- **Held by:** review and the builder's model file (M7). `make` is decided in
  [0029](../../.decisions/0029-format-and-names-follow-effect.md), and `layer` in a sibling file in
  [0095](../../.decisions/0095-a-service-file-holds-only-its-contract.md), with no static member on
  a service class. A span keeps its `<piece>.<verb>` name
  ([0252](../../.decisions/0252-effect-fn-for-exported-effects.md)) whatever the export is called.
- **Breaks today:** `nodeSql` at `next/packages/libfabrika/src/ledger/NodeSqlite.ts:37`;
  `recoveryStore` at `runtime/RecoveryStore.ts:109`; `CoordinationLayer` at
  `processes/ProcessManager.ts:563`; `mailLayer` at `cloudflare/mail.ts:24`; `RecordPartLive` at
  `cloudflare/record.ts:76`; five `xLayer` names in `cloudflare/runtime.ts` (`:199`, `:722`,
  `:1967`, `:2042`, `:2287`); `verifySshsig` at `transport/Sshsig.ts:175`. `Setting.ts` follows it
  at `:85`.

## M4: a guard is `isX` and an error is `XError`

- **Kind:** taste.
- **Means:** these two names may repeat the module's name: `isOption`, `LedgerError`. A guard comes
  from `Schema.is` or `Predicate` before it is written by hand. A service fails with its own
  `<Service>Error`.
- **Why:** Effect: `export const isOption` (`effect/src/Option.ts:329`) and
  `export const isDuration` (`effect/src/Duration.ts:498`). Its guide: "**NEVER** write your own
  helper functions like `isRecord` or `isString`, instead use the helpers from the `Predicate`
  module" (`node_modules/effect/AGENTS.md:321`).
- **Example:** `LedgerError` in `next/packages/libfabrika/src/ledger/Ledger.ts`.
- **Held by:** [0055](../../.decisions/0055-errors-named-by-their-service.md) for errors, and
  [0120](../../.decisions/0120-effect-code-guidelines.md) E1 for guards; review for the rest.
- **Breaks today:** Nothing: `next/` exports no hand-written `isX`, and 35 of its 41 exported error
  classes are named as their module file. Neither running example has a guard or an error.

## M5: a value is read through its module's namespace

- **Kind:** taste.
- **Means:** a camelCase value from one of our modules is read through the module:
  `import * as Setting from "./Setting.ts"`, then `Setting.make(...)`. A type, a service class or a
  schema may be imported by name. `@kampus/vitest`'s root is the one exception: its names are read
  bare, as `import { runsFor } from "@kampus/vitest"`.
- **Why:** Elm warns that `import State exposing (..)` "does not scale well", since in such files
  "it is essentially impossible to figure out where functions are coming from"
  ([design guidelines](https://package.elm-lang.org/help/design-guidelines)). Erlang's call names
  the module each time: `lists:keyfind(Name, 1, List)`
  ([expressions](https://www.erlang.org/doc/system/expressions.html)).
- **Example:**

  ```ts
  // next/packages/libfabrika/src/settings/Declarations.ts:35
  export const port = Setting.make("instance.port", {
  ```

- **Held by:** [0032](../../.decisions/0032-libraries-take-effects-file-layout.md) ("Callers write
  `Ledger.make(...)` and `Ledger.Ledger`"), and review. The exception is
  [0538](../../.decisions/0538-kampus-vitest-holds-the-test-primitives.md), after `@effect/vitest`.
  Imports of Effect itself are E7 of [0120](../../.decisions/0120-effect-code-guidelines.md).
- **Breaks today:** all 60 importers of `nodeSql`, such as `next/packages/libfabrika/src/node/dev/dev-recording.ts`.
  Over `next/`'s product files, 516 imports of our own modules are named and 134 are namespace
  imports. Every importer of `Setting.ts` follows it.

## M6: index files are generated

- **Kind:** none of law, lint or taste: a program writes the file.
- **Means:** a package's `index.ts` holds one `export * as X from "./X.ts"` line per public module
  file, under a `// @barrel` comment, with its doc block. A generator writes it inside
  `pnpm format`, so nobody edits it by hand and no CI check is needed. It copies `@stability` and no
  `@since`, prints our format, and leaves out every platform module. `@kampus/vitest`'s root stays
  hand-written.
- **Why:** Effect's guide: "Some `index.ts` sections marked with `@barrel` are generated. Do not edit
  those sections manually; update their source modules and run `pnpm codegen`"
  ([`.agents/AGENTS.md`](https://github.com/Effect-TS/effect/blob/main/.agents/AGENTS.md), lines
  47-48). Its generator writes `` export * as ${moduleName} from "./${posixPath}" ``
  ([`Codegen.ts`](https://github.com/Effect-TS/effect/blob/main/packages/tools/utils/src/Codegen.ts),
  line 187), and its CI never re-runs it.
- **Example:**

  ```ts
  // node_modules/@effect/sql-d1/src/index.ts, the whole file after its doc block
  // @barrel: Auto-generated exports. Do not edit manually.

  export * as D1Client from "./D1Client.ts"
  ```

- **Held by:** a generated file, not built yet. The namespace index is decided in
  [0023](../../.decisions/0023-next-follows-effects-code-style.md) and
  [0032](../../.decisions/0032-libraries-take-effects-file-layout.md); no `@since` in
  [0118](../../.decisions/0118-no-since-tag-before-a-release.md); our format in
  [0039](../../.decisions/0039-keep-semicolons-and-es5-commas.md).
- **Breaks today:** six of seven `index.ts` files are hand-written with named exports. The top one
  mixes both shapes at `next/packages/libfabrika/src/index.ts:47-48`: `export * as ProgramClient`
  beside `export { clientMachineFor }` from the same file. `Setting.ts` and `NodeSqlite.ts` are both
  reached by their own path (`"./ledger/*"` in `next/packages/libfabrika/package.json`).

## M7: a new module file copies a named neighbor

- **Kind:** taste.
- **Means:** the plan and the builder name the existing file a new module file follows. The
  reviewer checks a new module against its neighbors: its names, its exports and how it is read.
  These model files, in `next/`, are the ones to copy:
  - `next/packages/libfabrika/src/settings/Setting.ts`: `make`, `group`, the `Setting` type, inline
    options.
  - `next/packages/libfabrika/src/ledger/LedgerSql.ts`: one `layer`, read as `LedgerSql.layer`.
  - `next/packages/libfabrika/src/permissions/Rebac.ts`: `make`, its `Denied` error, `provide`.
- **Why:** Effect's guide: "Inspect nearby code before editing"
  ([`.agents/AGENTS.md`](https://github.com/Effect-TS/effect/blob/main/.agents/AGENTS.md), line 13).
  Its package skill: "Justify each proposed file by precedent or an explicit repository need"
  ([`package-development`](https://github.com/Effect-TS/effect/blob/main/.agents/skills/package-development/SKILL.md)).
  Its review: "naming and API consistency with neighboring modules"
  ([`pull-requests`](https://github.com/Effect-TS/effect/blob/main/.agents/skills/pull-requests/SKILL.md)).
- **Example:** `LedgerSql.ts` and its sibling layer files, such as `ledger/RefereeSql.ts`, all one
  `layer` read through the module.
- **Held by:** a line in the plan, build and review steps, written by this page's build plan. It
  builds [0114](../../.decisions/0114-effects-team-as-the-builder.md)'s "nearest Effect module"
  line, which no step says today.
- **Breaks today:** no step skill asks for the model file yet. `ledger/NodeSqlite.ts` is what a new
  file would copy if it read only its folder.
