---
id: 0062
title: Test files keep to the layers too, and a lower module tests against a real database through a suite that a higher module runs
status: accepted
date: 2026-11-10
tags: [tests, modules, layers, suites, sqlite, node, cloudflare, libfabrika, next]
---

# 0062: Test files keep to the layers too, and a lower module tests against a real database through a suite that a higher module runs

**What this decides:** in `next/`'s libfabrika, a test file imports only from lower layers, as
product code does, and a module whose laws need a real database writes them as a suite that the
module holding the driver runs.

```mermaid
flowchart TD
  nodeRunner["node/ Sink.test.ts"] -->|"SinkTest.suite(nodeSql)"| suite["telemetry/ SinkTest.ts"]
  cfRunner["cloudflare/ runner, later"] -.->|"SinkTest.suite(the object's Sql)"| suite
  suite --> sql["Sql.ts, the shared Sql type"]
  nodeRunner --> driver["nodeSql, the Node driver"]
```

Every arrow points down a layer. `telemetry/` holds the laws and names only the `Sql` type; the
module that owns a driver runs them. The dotted runner is not built and not decided here.

## Context

The folder move (ticket 477, PR 2) put the modules on their layers and found six test sites
that break the layer rule, all in `next/packages/libfabrika/src`, read on the move's branch at
`d8ffd5496`:

- Five telemetry tests import `nodeSql` from `ledger/NodeSqlite.ts`, one layer up:
  `telemetry/P12Readers.laws.test.ts`, `RecordPart.test.ts`, `Records.test.ts`, `Sink.test.ts`
  and `internal/measurements.test.ts`.
- `presence/Connections.test.ts` imports `processes/Process.test-support.ts`, on its own layer.

`NodeSqlite.ts` imports only `../Sql.ts` and a type from `node:sqlite`. It sits in `ledger/` only
because it lived in `data/`. [0051](0051-gateway-connection-and-node-by-job.md) sends platform code
to `node/`, the top layer and later its own package. Then 25 test files below `node/` that import
it today would import upward, plus `Process.test-support.ts`, which about 18 more use (grep).

What the industry does, each read for this record:

- **Layer tools check tests by default.**
  [dependency-cruiser](https://github.com/sverweij/dependency-cruiser/blob/main/doc/rules-reference.md)
  matches every module when a rule's `from` is empty; its
  [starter config](https://github.com/sverweij/dependency-cruiser/blob/main/src/cli/init-config/config-template.mjs)
  lets tests use dev-only packages (`not-to-dev-dep`'s `pathNot`) and nothing more.
  [ArchUnit](https://github.com/TNG/ArchUnit/blob/main/archunit-junit/junit5/api/src/main/java/com/tngtech/archunit/junit/AnalyzeClasses.java)'s
  `importOptions()` defaults to `{}`: `DoNotIncludeTests` is something you add.
  [eslint-plugin-boundaries](https://www.jsboundaries.dev/docs/setup/settings/): "All files
  included", "No files ignored". Nx's
  [`enforce-module-boundaries`](https://github.com/nrwl/nx/blob/master/packages/eslint-plugin/src/rules/enforce-module-boundaries.ts)
  has `allow: []` by default and no test carve-out.
- **Effect writes a suite in the lower package and runs it from the platform package.**
  `packages/effect/test/unstable/eventlog/SqlEventLogServerUnencryptedStorageTest.ts` exports
  `suite = (name, layer: Layer.Layer<SqlClient.SqlClient, unknown>) => ...`, and
  `packages/sql/sqlite-node`, `pg` and `mysql2` each run it with their own client
  ([effect-smol](https://github.com/Effect-TS/effect-smol)). `packages/effect/package.json` does
  not depend on `@effect/platform-node`. Effect reaches the suite through a path alias its root
  `tsconfig.json` marks "We should try to get rid of it"; inside one package we need no alias.
- **phoenix's lint rules bite tests too.** "The rule should bite everywhere, production *and*
  tests", and a justified test line is suppressed one by one
  ([`.patterns/biome-custom-gritql-rules.md`](https://github.com/kamp-us/phoenix/blob/main/.patterns/biome-custom-gritql-rules.md)).
- **Our own records already lean this way.** [0042](0042-platform-pieces-go-through-alchemy.md)
  says "Tests follow the same rule". [An object class stays thin](../docs/direction/object-classes-stay-thin.md)
  says "the ledger suite runs one set of laws with a driver per runtime".

Node's SQLite misses real differences from the Durable Object's. The object's `sql.exec()`
"cannot execute transaction-related statements like `BEGIN TRANSACTION` or `SAVEPOINT`"
([Cloudflare docs](https://developers.cloudflare.com/durable-objects/api/sqlite-storage-api/)), so
its transactions go through `transactionSync`, while `nodeSql` sends `BEGIN IMMEDIATE`, `COMMIT`
and `ROLLBACK`. A suite that takes the driver is the shape that can later run on both.

**How this fits older records.** It applies [0043](0043-rooms-on-floors.md)'s rule 3 (a module
imports only from lower layers) to test files, a case 0043 did not name, and keeps the "no
exemption" of 0043 and of [0055](0055-errors-named-by-their-service.md). As in
[0032](0032-libraries-take-effects-file-layout.md)'s "the test sits beside it", the suite sits
beside the file it tests, and only the runner lives in the driver's module. Tracker ticket 642 is this
record; ticket 641 builds the first part.

**Where the real-driver run happens.** A suite that needs a real database, run by the module that
owns the driver, runs on the full run on main, never on a pull request or in the merge queue
([0536](0536-real-resource-tests-run-only-on-the-schedule.md); the full run starts on a push to main
and hourly, [0581](0581-main-full-run-starts-on-push-and-hourly.md)).

## Decision

**Test files keep to the layers, with no exemption, and a lower module's database laws are a suite
that the module owning the driver runs.**

**Before** (on the move's branch):

```ts
// telemetry/Sink.test.ts: imports a layer up
import { DatabaseSync } from "node:sqlite";
import { nodeSql } from "../ledger/NodeSqlite.ts";

const sql = nodeSql(new DatabaseSync(":memory:"));
it("drops a deleted record's bytes", () => ...);
```

**After** (a sketch; the maker's exact shape is the plan's):

```ts
// telemetry/SinkTest.ts: the laws, and no driver
import type { Sql } from "../Sql.ts";

export const suite = (open: () => Sql) =>
  describe("SpanSink", () => {
    it("drops a deleted record's bytes", () => ...);
  });

// node/Sink.test.ts: runs the laws with the real driver
import * as SinkTest from "../telemetry/SinkTest.ts";

SinkTest.suite(nodeSql);
```

What moved: the import of the driver left `telemetry/`, and the laws stayed beside `Sink.ts`.

- **No exemption for tests.** A test file, a `*.test-support.ts` and a suite import only from lower
  layers, exactly as product code does (0043, 0055). This is the layer tools' default and what
  Effect and phoenix do.
- **A module whose laws need a real database writes them as a suite:** a function that takes a `Sql`
  maker and registers the laws. The file is `<Module>Test.ts` beside the file it tests, so vitest
  does not run it alone, and it exports `suite`, read through its module per
  [0029](0029-format-and-names-follow-effect.md): `SinkTest.suite(nodeSql)`.
- **The module that owns the driver runs the suite,** in a `*.test.ts` of its own. The same suite
  can later run on the Durable Object's SQLite, the "one set of laws with a driver per runtime" that
  [an object class stays thin](../docs/direction/object-classes-stay-thin.md) asks for.
- **A test helper two modules share lives on a layer both may import.** For presence, the part of
  `Process.test-support.ts` it uses moves down to a layer below both modules.
- **Sequencing.** The five telemetry tests and presence's helper are fixed in their own pull
  request right after the move's PR 2 (ticket 641). Until then the six sites are six `allowed`
  entries in `layer-rules.json`, each dated, with a guard that fails if that pull request lands
  with any of them still present.
- **The end state** is `nodeSql` in `node/`, with the other test files that import it turned into
  suites. That is a later ticket (644), and its details are not decided here.

**Binding constraints:**

- No rule, glob or `allowed` entry exempts test files from the layers, except the six dated entries
  above, which leave with ticket 641.
- A suite that no runner calls is a failure: the plan that adds the first suites adds a check that
  each one is run.

## Consequences

- Ticket 641 turns the five telemetry tests into suites run from `node/`, moves presence's helper
  down, and removes the six entries. It starts with one mutation dry run on `Sink`, to confirm
  StrykerJS still kills mutants through a suite.
- Ticket 644 moves `nodeSql` to `node/`; the test files below it become suites.
- Ticket 643, apart from this rule: SQLite tests that never reopen use an in-memory database.
- The cost: a module's database laws now span two files, the suite and its runner, and runners
  gather in `node/`. A wrong import fails lint early; a suite nobody runs is the risk the check
  above closes.
- Not decided here: whether tests also run inside the real runtime as a second runner, and when.

## Records

- No glossary row: "suite" keeps its everyday testing meaning.
- AGENTS.md: one clause in the library-layout bullet.
- [`docs/direction/follows/`](../docs/direction/follows/README.md) has no Effect table, so no row
  is added.
