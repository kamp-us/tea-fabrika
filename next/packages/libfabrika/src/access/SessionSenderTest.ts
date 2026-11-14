// T953 slice 2, next/: law L9 of the approved plan (docs/plan/lanes/t953-PLAN.md), on any `Sql`. A suite
// read through its module as `SessionSenderTest.suite(open)`: the module that owns the driver runs it,
// so this file names no driver (0043 rule 11, 0062).
//
// The contract: `SessionManager` gains `sender(parent, process)`, which answers the `Writer` of a saved
// input delivered to that process once `membership` says its key still belongs. It refuses
// `not_delivered` and `ended` as `signer` does, fails `NotGranted` when the key is gone, takes no
// `SignRequest` and writes no receipt.
//
// Two oracles: the walk's own model of what it recorded, delivered, ended and removed, and `signer`
// itself, asked under a kind and an id no other call uses, so its answer is the one it would sign.
import { describe, expect, it } from "@effect/vitest";
import { Brand, Cause, Effect, Exit, Option, Predicate, type Scope } from "effect";
import * as fc from "fast-check";
import type * as Id from "../Id.ts";
import type { Sql } from "../Sql.ts";
import { NotGranted, SessionManager, SigningRefused, SignRequest, Writer } from "./SessionManager.ts";

/** What the module that owns the driver gives: one database file. */
export type Store = { readonly sql: Sql };

/** A fresh database file each time it runs. Its scope closes the connection and removes the file (0061). */
export type Open = Effect.Effect<Store, never, Scope.Scope>;

const SEED = 119120;
const PERSON = "person_01m6v5270hf3c8x2q7w9z4k5mn";
const PROCESSES = ["process_0000000000e008000000000000", "process_0000000000e008000000000001"] as const;
const START = "process_0000000000e008000000000002";
const TRACE = "4bf92f3577b34da6a3ce929d0e0e4736";
const SPAN = "00f067aa0ba902b7";
const CLIENTS = ["person", "agent"] as const;
type Client = (typeof CLIENTS)[number];

const inputId = Brand.nominal<Id.InputId>(); // The test plays the trusted door, never a public decoder.
const PARENTS = [1, 2, 3].map((n) => inputId(`in-${START}-${n}`));

const writer = (client: Client) =>
  Writer.cases[client].make({ key: client === "person" ? "SHA256:person-window" : "SHA256:agent", for: PERSON });

const record = (parent: string, client: Client, process: string) => ({
  id: inputId(parent),
  by: writer(client),
  client,
  process,
  name: "comment",
  personOnly: false,
  digest: "SHA256:payload",
  traceId: TRACE,
  span: { traceId: TRACE, spanId: SPAN },
  arrivedAt: 100,
});

/** Every saved row, by table. A table the manager made on first use and left empty holds nothing. */
const snapshot = (sql: Sql) =>
  JSON.stringify(
    sql
      .exec("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name")
      .map(
        ({ name }) =>
          [
            name,
            sql
              .exec(`SELECT * FROM "${String(name)}"`)
              .map((row) => JSON.stringify(row))
              .sort(),
          ] as const,
      )
      .filter(([, rows]) => rows.length > 0),
  );

const choose = <A>(items: ReadonlyArray<A>, pick: number): A => {
  const item = items[pick % items.length];

  if (item === undefined) {
    throw new Error("a move chose from an empty list");
  }

  return item;
};

const Cell = fc.record({
  move: fc.constantFrom("record", "delivered", "end", "remove", "restore", "sender", "sender", "signer"),
  parent: fc.nat(),
  process: fc.nat(),
  client: fc.nat(),
});
type Cell = typeof Cell extends fc.Arbitrary<infer A> ? A : never;

/** What the walk did, from its own moves only. */
type World = {
  readonly inputs: Map<string, { readonly client: Client; readonly process: string; delivered: boolean }>;
  readonly ended: Set<string>;
  readonly live: Set<Client>;
};

/** An answer as the law compares it: the writer, or the refusal's tag and reason. */
type Shown =
  | { readonly writer: unknown }
  | { readonly refused: "NotGranted" }
  | { readonly refused: "SigningRefused"; readonly reason: string }
  | { readonly other: string };

const shown = (exit: Exit.Exit<unknown, unknown>): Shown => {
  if (Exit.isSuccess(exit)) {
    const value = exit.value;
    // `signer` answers a session, whose `by` is the writer; `sender` answers the writer itself.
    return { writer: Predicate.hasProperty(value, "parent") && Predicate.hasProperty(value, "by") ? value.by : value };
  }

  const error = Option.getOrUndefined(Cause.findErrorOption(exit.cause));
  return error instanceof NotGranted
    ? { refused: "NotGranted" }
    : error instanceof SigningRefused
      ? { refused: "SigningRefused", reason: error.reason }
      : { other: Predicate.hasProperty(error, "_tag") ? String(error._tag) : String(exit.cause) };
};

/** The model's answer for `parent` at `process`, in the signer's own order. */
const expected = (world: World, parent: string, process: string): Shown => {
  const input = world.inputs.get(parent);

  if (input !== undefined && !world.live.has(input.client)) {
    return { refused: "NotGranted" };
  }

  if (world.ended.has(process)) {
    return { refused: "SigningRefused", reason: "ended" };
  }

  if (input === undefined || !input.delivered || input.process !== process) {
    return { refused: "SigningRefused", reason: "not_delivered" };
  }

  return { writer: writer(input.client) };
};

const walk = (open: Open) =>
  Effect.fnUntraced(function* (cells: ReadonlyArray<Cell>) {
    const { sql } = yield* open;
    const world: World = { inputs: new Map(), ended: new Set(), live: new Set(CLIENTS) };
    let oracles = 0;
    yield* Effect.gen(function* () {
      const sessions = yield* SessionManager;
      // A signer under a kind and an id no other call uses: what it would sign for this input now.
      const signs = (parent: string, process: string) => {
        oracles++;
        return sessions
          .signer(parent, process, `oracle-${oracles}`)
          .pipe(Effect.provideService(SignRequest, { id: `oracle-${oracles}` }), Effect.exit);
      };

      for (const cell of cells) {
        const parent = choose(PARENTS, cell.parent);
        const process = choose(PROCESSES, cell.process);
        const client = choose(CLIENTS, cell.client);
        const input = world.inputs.get(parent);

        if (cell.move === "record" && input === undefined && !world.ended.has(process)) {
          yield* sessions.record(record(parent, client, process));
          world.inputs.set(parent, { client, process, delivered: false });
        } else if (cell.move === "delivered" && input !== undefined && !world.ended.has(input.process)) {
          yield* sessions.delivered(parent, input.process);
          input.delivered = true;
        } else if (cell.move === "end") {
          yield* sessions.end(process);
          world.ended.add(process);
        } else if (cell.move === "remove") {
          world.live.delete(client);
        } else if (cell.move === "restore") {
          world.live.add(client);
        } else if (cell.move === "signer") {
          // A signer with its own stable id, after any number of sender calls, answers as the model says.
          const signed = yield* sessions
            .signer(parent, process, "saved")
            .pipe(Effect.provideService(SignRequest, { id: `sign-${parent}-${process}` }), Effect.exit);
          expect(shown(signed), "L9: a signer after sender calls still answers").toEqual(
            expected(world, parent, process),
          );
        } else {
          const before = snapshot(sql);
          const answer = yield* sessions.sender(parent, process).pipe(Effect.exit);
          expect(snapshot(sql), "L9: sender writes nothing, no receipt included").toBe(before);
          expect(shown(answer), "L9: sender answers as the model says").toEqual(expected(world, parent, process));
          expect(shown(answer), "L9: sender answers what signer would sign, or refuses alike").toEqual(
            shown(yield* signs(parent, process)),
          );
        }
      }
    }).pipe(
      Effect.provide(
        SessionManager.layer(
          sql,
          (key: string) =>
            CLIENTS.some((c) => c === key && world.live.has(c))
              ? Effect.succeed(writer(key === "agent" ? "agent" : "person"))
              : Effect.fail(new NotGranted({})),
          { input: () => false, event: () => false },
        ),
      ),
    );
  });

export const suite = (open: Open) =>
  describe("T953 the gateway answers who sent an input", () => {
    // Plant: implement `sender` by calling `signer` with a fixed kind (SessionManager.ts).
    it.effect("L9: sender answers the writer signer would sign for, refuses alike, and writes no receipt", () =>
      Effect.gen(function* () {
        const law = walk(open);
        const tapes = fc.array(Cell, { minLength: 1, maxLength: 30 });
        // oxlint-disable-next-line fabrika/no-effect-run-outside-edge -- edge: fast-check awaits each case
        const property = fc.asyncProperty(tapes, (cells) => Effect.runPromise(Effect.scoped(law(cells))));
        // oxlint-disable-next-line fabrika/no-promises -- edge: fast-check's async property answers a Promise
        yield* Effect.promise(() => fc.assert(property, { seed: SEED, numRuns: 100, endOnFailure: true }));
      }),
    );
  });
