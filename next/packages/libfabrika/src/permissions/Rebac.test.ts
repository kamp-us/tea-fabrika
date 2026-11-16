// T953 slice 1, next/: the permission core's check, laws L1 to L4 of the approved plan
// (docs/plan/quests/t953-PLAN.md), on generated relation histories.
//
// The contract these laws pin, from the plan's "The shape":
//   Rebac.ts: `make(name).type(name, { relations, permissions })` builds one model, and `Model.ref(type, id)`
//     names an object; `Permission<Self>()(id, { model, on, permission })` is a right whose static
//     `within(tuples, sender, object)` answers `Result<Proof<Self>, Denied>`; `recheck(proof, tuples)`
//     checks a proof again on newer rows; `Denied` carries `subject`, `permission` and `object`.
//   Relation.ts: `STREAM` and the `Row` cases `related` and `unrelated`.
//   Relations.ts: the `Relations` service, whose `within(turn)` answers `Result<Tuples, RelationsError>`.
//   RelationsLedger.ts: `layer({ by })`, which folds `STREAM` inside the caller's turn, trusting only `by`.
//   Senders.ts: `Sender`, a person or an agent with its `key` and the person it is `for`; both are
//     checked as `person:<for>` (0526: an agent is capped by its person).
//
// The oracle is Zanzibar's set meaning, written here and never read from the product: the live
// tuples are the brain's rows folded in the referee's order, and a permission's holders are the least
// fixed point of its unions, so a loop alone holds nothing.
import { describe, expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Result from "effect/Result";
import * as Rec from "effect/Record";
import * as Arr from "effect/Array";
import * as fc from "fast-check";
import { LedgerTransaction, type LedgerTurn } from "../ledger/LedgerTransaction.ts";
import { type Entry, lineFor } from "../ledger/Log.ts";
import * as Rebac from "./Rebac.ts";
import * as Relation from "./Relation.ts";
import { Relations } from "./Relations.ts";
import * as RelationsLedger from "./RelationsLedger.ts";
import { Sender } from "./Senders.ts";

const SEED = 119120;

const BRAIN = "SHA256:brain";

const OTHER = "SHA256:program-writer";

/** The test model: two object types, permissions over relations and over each other, and one loop. */
const Test = Rebac.make("t953-test")
  .type("person", {})
  .type("fabrika", {
    relations: { owner: ["person"], admin: ["person"], member: ["person"], x: ["person"], y: ["person"] },
    permissions: {
      start: (p) => p.union("owner", "admin", "member"),
      manage: (p) => p.union("owner", "admin"),
      enter: (p) => p.union("start"),
      a: (p) => p.union("b", "x"),
      b: (p) => p.union("a", "y"),
    },
  })
  .type("board", {
    relations: { viewer: ["person"], editor: ["person"] },
    permissions: { edit: (p) => p.union("editor"), view: (p) => p.union("viewer", "edit") },
  });

class Start extends Rebac.Permission<Start>()("t953/Start", { model: Test, on: "fabrika", permission: "start" }) {}

class Manage extends Rebac.Permission<Manage>()("t953/Manage", { model: Test, on: "fabrika", permission: "manage" }) {}

class Enter extends Rebac.Permission<Enter>()("t953/Enter", { model: Test, on: "fabrika", permission: "enter" }) {}

class LoopA extends Rebac.Permission<LoopA>()("t953/LoopA", { model: Test, on: "fabrika", permission: "a" }) {}

class LoopB extends Rebac.Permission<LoopB>()("t953/LoopB", { model: Test, on: "fabrika", permission: "b" }) {}

class Edit extends Rebac.Permission<Edit>()("t953/Edit", { model: Test, on: "board", permission: "edit" }) {}

class View extends Rebac.Permission<View>()("t953/View", { model: Test, on: "board", permission: "view" }) {}

type Type = "fabrika" | "board";

/** The model again, as plain data for the oracle: each permission's union, by object type. */
const RULES: Readonly<Record<Type, Readonly<Record<string, ReadonlyArray<string>>>>> = {
  fabrika: {
    start: ["owner", "admin", "member"],
    manage: ["owner", "admin"],
    enter: ["start"],
    a: ["b", "x"],
    b: ["a", "y"],
  },
  board: { edit: ["editor"], view: ["viewer", "edit"] },
};

const RELATIONS: Readonly<Record<Type, ReadonlyArray<string>>> = {
  fabrika: ["owner", "admin", "member", "x", "y"],
  board: ["viewer", "editor"],
};

const PERSONS = ["person_a", "person_b", "person_c"] as const;

const OBJECTS = [
  { type: "fabrika", id: "one" },
  { type: "fabrika", id: "two" },
  { type: "board", id: "one" },
] as const;

type Thing = (typeof OBJECTS)[number];

/** Every right of the test model, each with the object type and permission it checks. */
const RIGHTS = [
  { right: Start, on: "fabrika", permission: "start" },
  { right: Manage, on: "fabrika", permission: "manage" },
  { right: Enter, on: "fabrika", permission: "enter" },
  { right: LoopA, on: "fabrika", permission: "a" },
  { right: LoopB, on: "fabrika", permission: "b" },
  { right: Edit, on: "board", permission: "edit" },
  { right: View, on: "board", permission: "view" },
] as const;

type Right = (typeof RIGHTS)[number];

const ref = (thing: Thing) => (thing.type === "fabrika" ? Test.ref("fabrika", thing.id) : Test.ref("board", thing.id));

const subjectFor = (person: string) => `person:${person}`;

const tupleKey = (subject: string, relation: string, object: string) => `${subject}#${relation}@${object}`;

/** A person's window, or an agent let in for that person: both are checked as the person. */
const senderFor = (person: string, as: "person" | "agent") =>
  as === "person"
    ? Sender.cases.person.make({ key: `SHA256:window-${person}`, for: person })
    : Sender.cases.agent.make({ key: `SHA256:agent-${person}`, for: person });

/** One relation row as written, with its writer. */
type Written = {
  readonly row: typeof Relation.Row.Type;
  readonly by: string;
};

/** One move of a history: write a relation, remove one, or write as another key. */
const Cell = fc.record({
  move: fc.constantFrom("related", "related", "unrelated_live", "unrelated_any", "foreign"),
  person: fc.nat(),
  thing: fc.nat(),
  relation: fc.nat(),
  pick: fc.nat(),
});

type Cell = typeof Cell extends fc.Arbitrary<infer A> ? A : never;

const choose = <A>(items: ReadonlyArray<A>, pick: number): A => {
  const item = items[pick % items.length];

  if (item === undefined) {
    throw new Error("a move chose from an empty list");
  }

  return item;
};

/**
 * Walks a history: each cell reads the tuples the brain's rows hold so far and picks a move possible
 * there. `unrelated_live` removes a live tuple when there is one; `foreign` writes as another key.
 */
const walkHistory = (cells: ReadonlyArray<Cell>): ReadonlyArray<Written> => {
  const live: Array<{ subject: string; relation: string; object: string }> = [];
  return Arr.map(cells, (cell) => {
    const thing = choose(OBJECTS, cell.thing);

    const fresh = {
      subject: subjectFor(choose(PERSONS, cell.person)),
      relation: choose(RELATIONS[thing.type], cell.relation),
      object: ref(thing),
    };

    if (cell.move === "unrelated_live" && live.length > 0) {
      const [gone] = live.splice(cell.pick % live.length, 1);

      return { row: Relation.Row.cases.unrelated.make(gone ?? fresh), by: BRAIN };
    }

    if (cell.move === "unrelated_live" || cell.move === "unrelated_any") {
      const at = Arr.findFirstIndex(
        live,
        (t) => t.subject === fresh.subject && t.relation === fresh.relation && t.object === fresh.object,
      );

      if (Option.isSome(at)) {
        live.splice(at.value, 1);
      }

      return { row: Relation.Row.cases.unrelated.make(fresh), by: BRAIN };
    }

    if (cell.move === "foreign") {
      // Another key's row changes nothing: the walk's own state does not take it.
      return { row: Relation.Row.cases.related.make(fresh), by: OTHER };
    }

    live.push(fresh);

    return { row: Relation.Row.cases.related.make(fresh), by: BRAIN };
  });
};

const History = fc.array(Cell, { minLength: 0, maxLength: 30 });

/** The oracle's live tuples: the brain's rows in order, each `related` adding and each `unrelated` removing. */
const liveTuples = (history: ReadonlyArray<Written>): ReadonlySet<string> => {
  const tuples = new Set<string>();

  for (const { row, by } of history) {
    if (by !== BRAIN) {
      continue;
    }

    const key = tupleKey(row.subject, row.relation, row.object);

    if (row._tag === "related") {
      tuples.add(key);
    } else {
      tuples.delete(key);
    }
  }

  return tuples;
};

/** The oracle's answer: the least fixed point of the type's unions for one subject on one object. */
const holds = (tuples: ReadonlySet<string>, subject: string, permission: string, thing: Thing): boolean => {
  const rules = RULES[thing.type];
  const relations = new Set(RELATIONS[thing.type]);
  const held = new Set<string>();

  const has = (name: string) =>
    relations.has(name) ? tuples.has(tupleKey(subject, name, ref(thing))) : held.has(name);

  let changed = true;

  while (changed) {
    changed = false;

    for (const [name, union] of Rec.toEntries(rules)) {
      if (!held.has(name) && Arr.some(union, has)) {
        held.add(name);
        changed = true;
      }
    }
  }

  return held.has(permission);
};

/** The history as ledger entries of `STREAM`, in the referee's order. */
const toEntries = (history: ReadonlyArray<Written>): ReadonlyArray<Entry> =>
  Arr.map(history, ({ row, by }, n) => ({
    ...lineFor(
      {
        by,
        for: "person_a",
        sentAt: "2026-11-14T10:00:00.000Z",
        seen: n,
        parent: null,
        traceId: "4bf92f3577b34da6a3ce929d0e0e4736",
        build: "t953-test",
      },
      row,
    ),
    id: `row-${n}`,
    stream: Relation.STREAM,
    pos: n + 1,
    rev: n + 1,
    arrivedAt: 1_000 + n,
  }));

/** A turn that holds only these entries; a check reads it and never appends. */
const turnHolding = (entries: ReadonlyArray<Entry>): LedgerTurn => ({
  read: (stream, after) => Arr.filter(entries, (e) => e.stream === stream && e.rev > after),
  get: (stream, id) => Arr.findFirst(entries, (e) => e.stream === stream && e.id === id),
  head: (stream) => Arr.reduce(entries, 0, (rev, e) => (e.stream === stream ? Math.max(rev, e.rev) : rev)),
  // T1041: the newest entry's pos, or none, as the store's position-only read answers.
  end: (stream) => Option.fromUndefinedOr(Arr.filter(entries, (e) => e.stream === stream).at(-1)?.pos),
  append: () => {
    throw new Error("a check never appends");
  },
});

/** The ledger layer of the store, trusting only the brain's key; these laws never write. */
const onLedger = RelationsLedger.layer({ by: BRAIN }).pipe(
  Layer.provide(Layer.succeed(LedgerTransaction, { transact: () => Effect.die("these laws write nothing") })),
);

const tuplesIn = (relations: Relations["Service"], history: ReadonlyArray<Written>) => {
  const tuples = relations.within(turnHolding(toEntries(history)));
  expect(Result.isSuccess(tuples), "rows the brain wrote always fold").toBe(true);

  return Result.getOrThrow(tuples);
};

const rightsOn = (thing: Thing): ReadonlyArray<Right> => Arr.filter(RIGHTS, (r) => r.on === thing.type);

/**
 * `within` of a right, on the object as `Ref` its type takes. Each right answers its own proof's
 * type, which no other right's proof is; these laws read only whether a proof was given and the
 * `Denied` when none was.
 */
const check = (
  right: Right,
  tuples: Relation.Tuples,
  sender: Sender,
  thing: Thing,
): Result.Result<unknown, Rebac.Denied> =>
  right.on === "fabrika" && thing.type === "fabrika"
    ? right.right.within(tuples, sender, Test.ref("fabrika", thing.id))
    : right.on === "board" && thing.type === "board"
      ? right.right.within(tuples, sender, Test.ref("board", thing.id))
      : expect.fail("a right is checked only on its own type");

describe("T953 the permission core's check", () => {
  // Plant: the fold applies a row whatever its `by` (RelationsLedger.ts or internal/relationsTable.ts).
  it.effect("L1: for any rows, a right gives a proof exactly when the oracle's holders hold the subject", () =>
    Effect.gen(function* () {
      const relations = yield* Relations;
      fc.assert(
        fc.property(History, fc.constantFrom("person", "agent"), (cells, as) => {
          const history = walkHistory(cells);
          const tuples = tuplesIn(relations, history);
          const oracle = liveTuples(history);

          for (const person of PERSONS) {
            for (const thing of OBJECTS) {
              for (const right of rightsOn(thing)) {
                const answer = check(right, tuples, senderFor(person, as), thing);
                expect(
                  Result.isSuccess(answer),
                  `L1: ${subjectFor(person)} ${right.permission} on ${ref(thing)} as ${as}`,
                ).toBe(holds(oracle, subjectFor(person), right.permission, thing));
              }
            }
          }
        }),
        {
          seed: SEED,
          numRuns: 200,
          examples: [
            // pinned: the plant's own case, a row by another key that would make the founder an owner.
            [[{ move: "foreign", person: 0, thing: 0, relation: 0, pick: 0 }], "person"],
          ],
        },
      );
    }).pipe(Effect.provide(onLedger)),
  );

  // Plant: the walk drops its visited set (internal/evaluate.ts): `a = b + x` and `b = a + y` never end.
  it.effect("L2: a loop of permissions ends every check, and the loop alone never holds", () =>
    Effect.gen(function* () {
      const relations = yield* Relations;
      fc.assert(
        fc.property(History, fc.constantFrom("person", "agent"), (cells, as) => {
          const history = walkHistory(cells);
          const tuples = tuplesIn(relations, history);
          const oracle = liveTuples(history);

          for (const person of PERSONS) {
            for (const thing of Arr.filter(OBJECTS, (t) => t.type === "fabrika")) {
              const looped =
                oracle.has(tupleKey(subjectFor(person), "x", ref(thing))) ||
                oracle.has(tupleKey(subjectFor(person), "y", ref(thing)));

              for (const right of [RIGHTS[3], RIGHTS[4]]) {
                const answer = check(right, tuples, senderFor(person, as), thing);
                expect(Result.isSuccess(answer), `L2: ${right.permission} holds only through x or y`).toBe(looped);
              }
            }
          }
        }),
        {
          seed: SEED,
          numRuns: 100,
          // pinned: an empty history, where only the loop could make `a` hold.
          examples: [[[], "person"]],
        },
      );
    }).pipe(Effect.provide(onLedger)),
  );

  // Plant: `Denied` takes its object from the model's first declared type (Rebac.ts).
  it.effect("L3: every Denied carries the subject, permission and object that were asked, exactly", () =>
    Effect.gen(function* () {
      const relations = yield* Relations;
      fc.assert(
        fc.property(History, fc.constantFrom("person", "agent"), (cells, as) => {
          const history = walkHistory(cells);
          const tuples = tuplesIn(relations, history);
          const oracle = liveTuples(history);

          for (const person of PERSONS) {
            for (const thing of OBJECTS) {
              for (const right of rightsOn(thing)) {
                if (holds(oracle, subjectFor(person), right.permission, thing)) {
                  continue;
                }

                const answer = check(right, tuples, senderFor(person, as), thing);
                expect(Result.isFailure(answer), `L3: ${right.permission} on ${ref(thing)} is denied`).toBe(true);
                const denied = Result.isFailure(answer) ? answer.failure : expect.fail("denied");
                expect(denied).toBeInstanceOf(Rebac.Denied);
                expect({ subject: denied.subject, permission: denied.permission, object: denied.object }).toEqual({
                  subject: subjectFor(person),
                  permission: right.permission,
                  object: ref(thing),
                });
              }
            }
          }
        }),
        { seed: SEED, numRuns: 100 },
      );
    }).pipe(Effect.provide(onLedger)),
  );

  // Plant: `recheck` checks the object of the last `within` call, not the proof's own (Rebac.ts).
  it.effect("L4: a proof is tied to its object: removing A's rows fails A's recheck and leaves B's proof", () =>
    Effect.gen(function* () {
      const relations = yield* Relations;
      fc.assert(
        fc.property(
          fc.tuple(
            History,
            fc.constantFrom(...PERSONS),
            fc.constantFrom("person", "agent"),
            fc.boolean(),
            fc.boolean(),
          ),
          ([cells, person, as, removeFirst, lastIsRemoved]) => {
            const [one, two] = [OBJECTS[0], OBJECTS[1]];
            const [removed, kept] = removeFirst ? [one, two] : [two, one];
            const subject = subjectFor(person);

            // Both objects hold for the subject: its owner rows are the last the brain wrote before the checks.
            const before = [
              ...walkHistory(cells),
              ...Arr.map([one, two], (thing) => ({
                row: Relation.Row.cases.related.make({ subject, relation: "owner", object: ref(thing) }),
                by: BRAIN,
              })),
            ];

            const sender = senderFor(person, as);
            const tuples = tuplesIn(relations, before);
            // The removed object's proof is made first or last, so a recheck that reads the last call's object fails either way.
            const order = lastIsRemoved ? [kept, removed] : [removed, kept];

            const proofs = new Map(
              Arr.map(order, (thing) => {
                const answer = Start.within(tuples, sender, Test.ref("fabrika", thing.id));
                expect(Result.isSuccess(answer), `L4: ${ref(thing)} holds before the removal`).toBe(true);

                return [thing.id, Result.getOrThrow(answer)] as const;
              }),
            );

            for (const thing of [one, two]) {
              const proof = proofs.get(thing.id) ?? expect.fail("a proof per object");
              expect(proof.object, "L4: a proof names the object it checked").toBe(ref(thing));
              expect(proof.permission).toBe("start");
              expect(proof.sender).toEqual(sender);
            }

            const after = [
              ...before,
              ...Arr.map(RELATIONS.fabrika, (relation) => ({
                row: Relation.Row.cases.unrelated.make({ subject, relation, object: ref(removed) }),
                by: BRAIN,
              })),
            ];

            const newer = tuplesIn(relations, after);
            const proofFor = (thing: Thing) => proofs.get(thing.id) ?? expect.fail("a proof per object");
            expect(Rebac.recheck(proofFor(removed), newer), "L4: the removed object's proof fails its recheck").toBe(
              false,
            );
            expect(Rebac.recheck(proofFor(kept), newer), "L4: the other object's proof still holds").toBe(true);
            expect(Rebac.recheck(proofFor(removed), tuples), "L4: on the rows it was made from, it holds").toBe(true);
          },
        ),
        { seed: SEED, numRuns: 100 },
      );
    }).pipe(Effect.provide(onLedger)),
  );
});
