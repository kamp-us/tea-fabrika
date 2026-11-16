// T953 slice 1, next/: law L8 of the approved plan (docs/plan/quests/t953-PLAN.md) on a real store (0062).
// A runner in the module that owns a driver calls `RelationsTest.suite(open)`; `open` acquires one
// store in a scope and gives it back when that scope closes (0061).
//
// The contract this law pins, from the plan's "Rows and the fold":
//   Relations.ts: `Relations`, whose `within(turn)` answers the live tuples inside the caller's turn
//     and whose `write(changes, writer)` writes each change once, by its id, as the layer's own key.
//   RelationsLedger.ts: `layer({ by })` on `LedgerTransaction`, skipping every row whose `by` is not `by`.
//   RelationsMemory.ts: `layer(changes)`, the same fold over its changes; `write` adds to them.
//   Relation.ts: `STREAM`, `Row` and `Change` (`{ id, row }`).
// The two layers are compared through the check, the only way to read `Tuples`: a test right per
// relation makes every tuple visible.
import { describe, expect, it } from "@kampus/vitest";
import { Context, Effect, Layer, Result, type Scope } from "effect";
import * as fc from "fast-check";
import { Doorbell } from "../ledger/Ledger.ts";
import { LedgerTransaction } from "../ledger/LedgerTransaction.ts";
import * as LedgerTransactionSql from "../ledger/LedgerTransactionSql.ts";
import { lineFor } from "../ledger/Log.ts";
import type { Sql } from "../Sql.ts";
import * as Rebac from "./Rebac.ts";
import * as Relation from "./Relation.ts";
import { Relations } from "./Relations.ts";
import * as RelationsLedger from "./RelationsLedger.ts";
import * as RelationsMemory from "./RelationsMemory.ts";
import { Sender } from "./Senders.ts";

/** One real store. */
export type Store = { readonly sql: Sql };

const BRAIN = "SHA256:brain";
const OTHER = "SHA256:program-writer";

/** A model whose every relation is also a permission of the same name, so every tuple is a check. */
const Mirror = Rebac.make("t953-mirror")
  .type("person", {})
  .type("fabrika", {
    relations: { owner: ["person"], admin: ["person"], member: ["person"] },
    permissions: {
      owns: (p) => p.union("owner"),
      admins: (p) => p.union("admin"),
      belongs: (p) => p.union("member"),
    },
  });

class Owns extends Rebac.Permission<Owns>()("t953/Owns", { model: Mirror, on: "fabrika", permission: "owns" }) {}

class Admins extends Rebac.Permission<Admins>()("t953/Admins", {
  model: Mirror,
  on: "fabrika",
  permission: "admins",
}) {}

class Belongs extends Rebac.Permission<Belongs>()("t953/Belongs", {
  model: Mirror,
  on: "fabrika",
  permission: "belongs",
}) {}

const RIGHTS = [
  { relation: "owner", right: Owns },
  { relation: "admin", right: Admins },
  { relation: "member", right: Belongs },
] as const;

const PERSONS = ["person_a", "person_b", "person_c"] as const;
const FABRIKAS = ["one", "two"] as const;

/** The writer fields every batch is written with: the referee keeps a resend as one line only when they match. */
const WRITER = {
  by: BRAIN,
  for: "person_a",
  sentAt: "2026-11-14T10:00:00.000Z",
  seen: 0,
  parent: null,
  traceId: "4bf92f3577b34da6a3ce929d0e0e4736",
  build: "t953-test",
};

const choose = <A>(items: ReadonlyArray<A>, pick: number): A => {
  const item = items[pick % items.length];

  if (item === undefined) {
    throw new Error("a move chose from an empty list");
  }

  return item;
};

const Cell = fc.record({
  move: fc.constantFrom("related", "related", "unrelated", "resend", "foreign"),
  person: fc.nat(),
  relation: fc.nat(),
  fabrika: fc.nat(),
  pick: fc.nat(),
  cut: fc.boolean(),
});
type Cell = typeof Cell extends fc.Arbitrary<infer A> ? A : never;

/** What the walk wrote: the brain's batches, each change with its id, and the other key's rows. */
type Batch = { readonly changes: ReadonlyArray<Relation.Change>; readonly foreign: ReadonlyArray<Foreign> };
type Foreign = { readonly id: string; readonly row: typeof Relation.Row.Type };

/**
 * Walks the cells into batches. Each cell reads what the walk has written: `unrelated` removes a live
 * tuple when there is one, `resend` writes an earlier change again under its own id, and `foreign`
 * writes a row as another key. A cell with `cut` ends its batch.
 */
const toBatches = (cells: ReadonlyArray<Cell>): ReadonlyArray<Batch> => {
  const written: Array<Relation.Change> = [];
  const live: Array<{ subject: string; relation: string; object: string }> = [];
  const batches: Array<Batch> = [];
  let changes: Array<Relation.Change> = [];
  let foreign: Array<Foreign> = [];

  cells.forEach((cell, n) => {
    const fresh = {
      subject: `person:${choose(PERSONS, cell.person)}`,
      relation: choose(RIGHTS, cell.relation).relation,
      object: Mirror.ref("fabrika", choose(FABRIKAS, cell.fabrika)),
    };

    if (cell.move === "resend" && written.length > 0) {
      changes.push(choose(written, cell.pick));
    } else if (cell.move === "foreign") {
      foreign.push({ id: `foreign-${n}`, row: Relation.Row.cases.related.make(fresh) });
    } else if (cell.move === "unrelated" && live.length > 0) {
      const [gone] = live.splice(cell.pick % live.length, 1);
      const change = { id: `change-${n}`, row: Relation.Row.cases.unrelated.make(gone ?? fresh) };
      written.push(change);
      changes.push(change);
    } else {
      live.push(fresh);
      const change = { id: `change-${n}`, row: Relation.Row.cases.related.make(fresh) };
      written.push(change);
      changes.push(change);
    }

    if (cell.cut) {
      batches.push({ changes, foreign });
      changes = [];
      foreign = [];
    }
  });

  return [...batches, { changes, foreign }];
};

const quiet = Layer.succeed(Doorbell, { ring: () => Effect.void });

/** Every (person, relation, fabrika) and whether the store's tuples hold it, read through the check. */
const view = (tuples: Relation.Tuples) =>
  PERSONS.flatMap((person) =>
    FABRIKAS.flatMap((id) =>
      RIGHTS.map(({ relation, right }) => {
        const sender = Sender.cases.person.make({ key: `SHA256:window-${person}`, for: person });
        // Each right answers its own proof's type; only whether one was given is read here.
        const answer: Result.Result<unknown, Rebac.Denied> = right.within(tuples, sender, Mirror.ref("fabrika", id));
        const held = Result.isSuccess(answer);
        return `${person}#${relation}@${id}=${held}`;
      }),
    ),
  );

const ok = <A, E>(result: Result.Result<A, E>, label: string): A => {
  expect(Result.isSuccess(result), label).toBe(true);
  return Result.getOrThrow(result);
};

/** One walk on one fresh store: the same batches into both layers, compared after each batch. */
const agree = (open: Effect.Effect<Store, never, Scope.Scope>) =>
  Effect.fnUntraced(function* (cells: ReadonlyArray<Cell>) {
    const { sql } = yield* open;
    const batches = toBatches(cells);
    const [first, ...rest] = batches;
    const tx = Context.get(
      yield* Layer.build(LedgerTransactionSql.layer(sql).pipe(Layer.provide(quiet))),
      LedgerTransaction,
    );
    const onLedger = Context.get(
      yield* Layer.build(
        RelationsLedger.layer({ by: BRAIN }).pipe(Layer.provide(Layer.succeed(LedgerTransaction, tx))),
      ),
      Relations,
    );
    // The memory layer starts from the first batch; the ledger gets the same batch written.
    const inMemory = Context.get(yield* Layer.build(RelationsMemory.layer(first?.changes ?? [])), Relations);
    const apply = Effect.fnUntraced(function* (batch: Batch, memory: boolean) {
      yield* tx.transact((turn) => {
        for (const { id, row } of batch.foreign) {
          turn.append(Relation.STREAM, id, lineFor({ ...WRITER, by: OTHER }, row));
        }
      });
      yield* onLedger.write(batch.changes, WRITER);

      if (memory) {
        yield* inMemory.write(batch.changes, WRITER);
      }
    });
    const compare = Effect.fnUntraced(function* (label: string) {
      const [ledger, memory] = yield* tx.transact((turn) => [onLedger.within(turn), inMemory.within(turn)] as const);
      expect(view(ok(ledger, `${label}: the ledger's rows fold`)), `L8: ${label}`).toEqual(
        view(ok(memory, `${label}: the memory layer folds`)),
      );
    });

    if (first !== undefined) {
      yield* apply(first, false);
    }

    yield* compare("after the first batch, given to the memory layer at build");

    for (const [n, batch] of rest.entries()) {
      yield* apply(batch, true);
      yield* compare(`after batch ${n + 2}`);
    }
  });

/** Runs L8 on the store `open` gives. */
export const suite = (open: Effect.Effect<Store, never, Scope.Scope>) =>
  describe("T953 the relation store's two layers", () => {
    it.effect.prop(
      "L8: the memory and ledger layers agree on every tuple, with resent ids and another writer's rows",
      // fast-check kept: moved unchanged from the property runner; the Schema rewrite comes later in 0579's sweep
      { cells: fc.array(Cell, { minLength: 0, maxLength: 20 }) },
      ({ cells }) => agree(open)(cells),
      {
        plant: "the memory layer ignores unrelated rows when it folds (RelationsMemory.ts)",
        fastCheck: { numRuns: 100, endOnFailure: true },
      },
    );
  });
