// P39 slice 1, L1 to L8 on a real store (0062): the laws, and no driver. A runner in the module that
// owns a driver calls `TasksTest.suite(open)`; `open` acquires one store in a scope and gives it back
// when that scope closes. Each law walks a decision tape (0093): every cell is read against the tasks
// the fold has saved so far, so a retry names a saved request, a start names a real assignment and a
// cut lands on a transition that is legal there. The oracle is this file's own record of what each
// call was given and answered, never the product's machine.
//
// P39 slice 3 (ticket 1040), J2: a `collected` event survives reopen, an equal retry answers the
// first receipt, and a different collection is refused and writes nothing. Plant (after build):
// append `collected` without folding first, so a retry writes a second event.
//
// P39 slice 4a, G1 (the stream half): an accepted request writes one line `{ id, process }` to
// `target:<key>` in its own transaction, and a repeat, a conflict or a cut request writes none;
// `forTarget(key)` answers exactly the open tasks (requested, assigned or started) whose target is
// that key, and the stream's last rev, 0 before its first line. The oracle reads the stream through
// the public `Ledger.read` and keeps its own list of what each key was asked for. Plant (after
// build): append the `target:` line on a repeated request too.
import { describe, expect, it } from "@effect/vitest";
import { Effect, Layer, Result as R, type Scope, Schema, Arbitrary, Stream, Function } from "effect";
import * as fc from "fast-check";
import * as Id from "../Id.ts";
import { Doorbell, Ledger } from "../ledger/Ledger.ts";
import * as LedgerSql from "../ledger/LedgerSql.ts";
import { LedgerStreams, LedgerStreamsError, Storage } from "../ledger/LedgerStreams.ts";
import * as LedgerStreamsSql from "../ledger/LedgerStreamsSql.ts";
import * as LedgerTransactionSql from "../ledger/LedgerTransactionSql.ts";
import type { Sql } from "../Sql.ts";
import { Command, type Executor, type Task, Request, Recorded, Result, State } from "./Task.ts";
import { Tasks, TasksError, targetStream } from "./Tasks.ts";
import * as TasksLedger from "./TasksLedger.ts";

/** One real store. `reopen` closes it and opens the same database again, keeping only its rows. */
export type Store = { readonly sql: Sql; readonly reopen: Effect.Effect<void> };

// ---------------------------------------------------------------------------------------------
// Generated values, shared with the pure laws beside this file. Nothing here is key material: a
// key is named by a made-up fingerprint, made when the law runs.

const B32 = "[0-9a-hjkmnp-tv-z]";

/** A canonical UUIDv7 TypeID for `prefix`, as `Id.make(prefix)` accepts it. */
export const fcTypeId = (prefix: string): fc.Arbitrary<string> =>
  fc.stringMatching(new RegExp(`^${prefix}_[0-7]${B32}{9}[ef]${B32}{2}[89abrstv]${B32}{12}$`));

const fcWord = fc.stringMatching(/^[a-z][a-z0-9-]{0,11}$/);
const fcTraceId = fc.stringMatching(/^[0-9a-f]{32}$/).filter((text) => !/^0+$/.test(text));
const fcHash = fc.stringMatching(/^[0-9a-f]{16}$/);

/** A made-up public key fingerprint, in OpenSSH's `SHA256:` form. */
export const fcFingerprint = fc.stringMatching(/^SHA256:[A-Za-z0-9+/]{43}$/);

/** Capabilities a host may advertise. `git` is the one `git_version` needs. */
export const CAPABILITIES = ["git", "docker", "node"] as const;

const fcNeeds = fc.uniqueArray(fc.constantFrom(...CAPABILITIES), { minLength: 1, maxLength: 3 });

export const fcResult: fc.Arbitrary<Result> = fc.oneof(
  fc
    .record({ code: fc.integer({ min: -255, max: 255 }), version: fc.string({ maxLength: 40 }) })
    .map((fields) => Result.cases.exited.make(fields)),
  fc.constantFrom("unavailable", "spawn_failed", "output_limit").map((reason) => Result.cases.failed.make({ reason })),
  fc.constant(Result.cases.unknown.make({ reason: "interrupted" })),
);

/** A request for the one command, from a generated process, to one of `targets`. */
export const fcRequest = (targets: ReadonlyArray<string>): fc.Arbitrary<Request> =>
  fc
    .record({
      process: fcTypeId("process"),
      pos: fc.integer({ min: 1, max: 9999 }),
      index: fc.integer({ min: 0, max: 9 }),
      name: fcWord,
      pack: fcWord,
      program: fcWord,
      needs: fcNeeds,
      target: fc.constantFrom(...targets),
      build: fcHash,
      settings: fc.option(fcHash, { nil: null }),
      parent: fc.option(fcTypeId("input"), { nil: null }),
      traceId: fcTraceId,
    })
    .map(({ process, pos, index, name, pack, program, ...rest }) => ({
      id: `${process}/${pos}/${index}`,
      process,
      name,
      program: `${pack}/${program}`,
      command: Command.cases.git_version.make({}),
      ...rest,
    }));

/** One executor: its key, the connection it came on, what it advertises and its build. */
export const fcExecutor = (keys: ReadonlyArray<string>): fc.Arbitrary<Executor> =>
  fc.record({
    key: fc.constantFrom(...keys),
    connection: fcTypeId("connection"),
    has: fc.uniqueArray(fc.constantFrom(...CAPABILITIES), { maxLength: 3 }),
    build: fcHash,
  });

/** What a writer says about one call, with `seen` filled in from the log the fold has reached. */
export const fcRecorded = fc.record({
  by: fc.constantFrom("brain", "gateway:hands", "gateway:window"),
  for: fcTypeId("person"),
  sentAt: fc.integer({ min: 1_700_000_000_000, max: 1_900_000_000_000 }).map((at) => new Date(at).toISOString()),
  parent: fc.option(fcTypeId("input"), { nil: null }),
  traceId: fcTraceId,
  build: fcHash,
});

export type Said = Omit<Recorded, "seen">;

/** A value as it comes back from JSON: equal in every field, never the same object. */
export const copied = <A>(value: A): A => JSON.parse(JSON.stringify(value)) as A;

/** The item a tape number picks; never called on an empty list. */
export const choose: {
  (pick: number): <A>(items: ReadonlyArray<A>) => A;
  <A>(items: ReadonlyArray<A>, pick: number): A;
} = Function.dual(2, <A>(items: ReadonlyArray<A>, pick: number): A => {
  const item = items[pick % items.length];

  if (item === undefined) {
    throw new Error("a move chose from an empty list");
  }

  return item;
});

/** One field of a request changed to another valid value: same id, different bytes. */
export const changedRequest: {
  (pick: number, other: Request): (request: Request) => Request;
  (request: Request, pick: number, other: Request): Request;
} = Function.dual(3, (request: Request, pick: number, other: Request): Request => {
  const field = choose(["target", "process", "name", "program", "needs", "build", "settings", "parent"] as const, pick);
  const differs = <A>(a: A, b: A, fallback: A): A => (JSON.stringify(a) === JSON.stringify(b) ? fallback : b);

  if (field === "target") {
    return { ...request, target: differs(request.target, other.target, `${request.target}x`) };
  }

  if (field === "process") {
    const flipped = request.process.replace(/.$/, (last) => (last === "0" ? "1" : "0"));
    return { ...request, process: differs(request.process, other.process, flipped) };
  }

  if (field === "name") {
    return { ...request, name: `${request.name}-changed` };
  }

  if (field === "program") {
    return { ...request, program: `${request.program}-changed` };
  }

  if (field === "needs") {
    return { ...request, needs: request.needs.length === 1 ? [...CAPABILITIES] : request.needs.slice(0, 1) };
  }

  if (field === "build") {
    return { ...request, build: `${request.build}0` };
  }

  if (field === "settings") {
    return { ...request, settings: request.settings === null ? "changed" : null };
  }

  if (request.parent === null && other.parent === null) {
    return { ...request, build: `${request.build}1` };
  }

  return { ...request, parent: request.parent === null ? other.parent : null };
});

/** A value one field away from valid: wrong type, empty text or a missing key. */
export const broken: {
  (pick: number, bad: ReadonlyArray<readonly [string, unknown]>): (value: object) => unknown;
  (value: object, pick: number, bad: ReadonlyArray<readonly [string, unknown]>): unknown;
} = Function.dual(3, (value: object, pick: number, bad: ReadonlyArray<readonly [string, unknown]>): unknown => {
  const [key, replacement] = choose(bad, pick);

  if (replacement === MISSING) {
    const { [key]: _gone, ...rest } = value as Record<string, unknown>;
    return rest;
  }

  return { ...value, [key]: replacement };
});

export const MISSING = Symbol("missing");

/** Invalid replacements for each field a request decodes, one per pick. */
export const BAD_REQUEST: ReadonlyArray<readonly [string, unknown]> = [
  ["id", ""],
  ["id", MISSING],
  ["process", "not-a-process"],
  ["process", 7],
  ["name", ""],
  ["program", ""],
  ["program", MISSING],
  // A command case the closed schema does not have, written as JSON would bring it.
  ["command", JSON.parse('{"_tag":"shell","text":"rm -rf ."}')],
  ["command", "git --version"],
  ["needs", "git"],
  ["needs", [""]],
  ["target", ""],
  ["target", MISSING],
  ["build", ""],
  ["settings", 5],
  ["settings", MISSING],
  ["parent", "not-an-input"],
  ["parent", MISSING],
  ["traceId", "0".repeat(32)],
  ["traceId", "XYZ"],
];

export const BAD_EXECUTOR: ReadonlyArray<readonly [string, unknown]> = [
  ["key", ""],
  ["key", MISSING],
  ["connection", ""],
  ["has", "git"],
  ["has", [""]],
  ["build", MISSING],
];

export const BAD_RESULT: ReadonlyArray<readonly [string, unknown]> = [
  ["_tag", "succeeded"],
  ["_tag", MISSING],
  ["code", 1.5],
  ["code", "0"],
  ["reason", "boom"],
];

export const BAD_RECORDED: ReadonlyArray<readonly [string, unknown]> = [
  ["by", ""],
  ["for", ""],
  ["for", MISSING],
  ["sentAt", 5],
  ["seen", -1],
  ["seen", 1.5],
  ["parent", "not-an-input"],
  ["traceId", "nope"],
  ["build", ""],
];

/** A result one field away from valid, for the case it has. */
export const brokenResult: {
  (pick: number): (result: Result) => unknown;
  (result: Result, pick: number): unknown;
} = Function.dual(2, (result: Result, pick: number): unknown => {
  const fits = BAD_RESULT.filter(
    ([key]) =>
      key === "_tag" || (key === "code" ? result._tag === "exited" : key === "reason" && result._tag !== "exited"),
  );
  return broken(result, pick, fits);
});

// ---------------------------------------------------------------------------------------------
// The walk on a real store.

/** One tape cell: which move, which task, which variant, and fresh values to use if the move needs them. */
const Cell = fc.record({
  move: fc.nat(),
  pick: fc.nat(),
  variant: fc.nat(),
  said: fcRecorded,
  seen: fc.nat(),
  result: fcResult,
  other: fcResult,
  connection: fcTypeId("connection"),
  build: fcHash,
});
type Cell = typeof Cell extends fc.Arbitrary<infer A> ? A : never;

/** A tape: three made-up keys, a pool of requests to them, and the cells. Only the first two keys hold `git`. */
const Tape = fc.uniqueArray(fcFingerprint, { minLength: 3, maxLength: 3 }).chain((keys) =>
  fc.record({
    keys: fc.constant(keys),
    requests: fc.uniqueArray(fcRequest(keys.slice(0, 2)), { minLength: 4, maxLength: 6, selector: (r) => r.id }),
    cells: fc.array(Cell, { minLength: 12, maxLength: 40, size: "max" }),
  }),
);
type Tape = typeof Tape extends fc.Arbitrary<infer A> ? A : never;

type Move =
  | "request_new"
  | "request_equal"
  | "request_changed"
  | "take_ok"
  | "take_again"
  | "take_other"
  | "take_lacking"
  | "start_ok"
  | "start_again"
  | "start_wrong"
  | "finish_ok"
  | "finish_equal"
  | "finish_other"
  | "finish_wrong"
  | "out_of_order"
  | "unknown_id"
  | "bad"
  | "cut_before"
  | "cut_after"
  | "reopen"
  | "collect_ok"
  | "collect_again"
  | "collect_conflict"
  | "collect_other"
  | "collect_early";

type Phase = "requested" | "assigned" | "started" | "finished" | "collected";
type Receipt = { readonly rev: number; readonly arrivedAt: number };
type Event = "requested" | "taken" | "started" | "finished" | "collected";
type Collection = { readonly process: string; readonly letter: string };

/** What the fold knows of one task, from its own calls and their answers. */
type Saved = {
  readonly request: Request;
  phase: Phase;
  executor?: Executor;
  execution?: string;
  result?: Result;
  collection?: Collection;
  taken?: Receipt & { readonly execution: string };
  readonly receipts: Map<Event, Receipt>;
  readonly events: Array<Recorded & Receipt & { readonly event: Event }>;
};

type World = { readonly tasks: Map<string, Saved>; head: number; next: number };

const INSERT = /^\s*INSERT\s+(?:OR\s+\w+\s+)?INTO\s+entries\b/i;

/** The store's Sql with one planted fault: refuse the next entry insert, or the statement after it. */
const cutting = (sql: Sql) => {
  const fault = { at: null as "before" | "after" | null, armed: false };
  const wrapped: Sql = {
    exec: (query, ...params) => {
      if (fault.at === "before" && INSERT.test(query)) {
        fault.at = null;
        throw new Error("SQLITE_FULL planted before an append");
      }

      if (fault.at === "after" && fault.armed) {
        fault.at = null;
        fault.armed = false;
        throw new Error("SQLITE_IOERR planted after an append");
      }

      if (fault.at === "after" && INSERT.test(query)) {
        fault.armed = true;
      }

      return sql.exec(query, ...params);
    },
    // A fault armed by the last statement fails the turn as it commits, so the append rolls back.
    transaction: (step) =>
      sql.transaction(() => {
        const answer = step();

        if (fault.at === "after" && fault.armed) {
          fault.at = null;
          fault.armed = false;
          throw new Error("SQLITE_IOERR planted after an append");
        }

        return answer;
      }),
    size: () => sql.size(),
  };
  return { sql: wrapped, fault };
};

const quiet = Layer.succeed(Doorbell, { ring: () => Effect.void });

const layer = (sql: Sql) =>
  TasksLedger.layer.pipe(
    Layer.provide(
      Layer.mergeAll(
        LedgerSql.layer(sql, { reader: "connection:tasks-test" }),
        LedgerTransactionSql.layer(sql),
        LedgerStreamsSql.layer(sql),
      ).pipe(Layer.provide(quiet)),
    ),
    Layer.provide(Id.Generator.layer),
  );

const refused = (answer: R.Result<unknown, unknown>, message: string, reason?: string) => {
  expect(R.isFailure(answer), message).toBe(true);
  const failure = R.isFailure(answer) ? answer.failure : undefined;
  expect(failure, message).toBeInstanceOf(TasksError);
  expect(failure, message).toMatchObject(reason === undefined ? {} : { reason });
};

const success = <A>(answer: R.Result<A, unknown>, message: string): A => {
  if (R.isFailure(answer)) {
    expect.fail(`${message}: ${String(answer.failure)}`);
  }

  return answer.success;
};

/** The task the oracle expects `read` to answer: its state, and one event per accepted call. */
const expected = (saved: Saved): Task => {
  const { request, executor, execution, result } = saved;
  const assignment = executor === undefined || execution === undefined ? undefined : { execution, executor };
  const state =
    saved.phase === "requested"
      ? State.cases.requested.make({ request })
      : saved.phase === "assigned" && assignment !== undefined
        ? State.cases.assigned.make({ request, assignment })
        : saved.phase === "started" && assignment !== undefined
          ? State.cases.started.make({ request, assignment })
          : saved.phase === "finished" && assignment !== undefined && result !== undefined
            ? State.cases.finished.make({ request, assignment, result })
            : assignment !== undefined && result !== undefined && saved.collection !== undefined
              ? State.cases.collected.make({ request, assignment, result, collection: saved.collection })
              : expect.fail("the fold reached a phase without its facts");
  return { state, events: saved.events } as Task;
};

const at = (world: World, phases: ReadonlyArray<Phase>) =>
  [...world.tasks.values()].filter((j) => phases.includes(j.phase));

/** The moves possible in this world, each only when the world can take it. */
const possible = (world: World, tape: Tape, moves: ReadonlyArray<Move>): ReadonlyArray<Move> => {
  const any = world.tasks.size > 0;
  const fresh = world.next < tape.requests.length;
  const requested = at(world, ["requested"]).length > 0;
  const assigned = at(world, ["assigned"]).length > 0;
  const started = at(world, ["started"]).length > 0;
  const finished = at(world, ["finished"]).length > 0;
  const collected = at(world, ["collected"]).length > 0;
  const done = finished || collected;
  const owned = at(world, ["assigned", "started", "finished", "collected"]).length > 0;
  const can: Record<Move, boolean> = {
    request_new: fresh,
    request_equal: any,
    request_changed: any,
    take_ok: requested,
    take_again: owned,
    take_other: any,
    take_lacking: any,
    start_ok: assigned,
    start_again: started || done,
    start_wrong: owned,
    finish_ok: started,
    finish_equal: done,
    finish_other: done,
    finish_wrong: owned,
    out_of_order: requested || assigned,
    unknown_id: true,
    bad: any || fresh,
    cut_before: fresh || requested || assigned || started,
    cut_after: fresh || requested || assigned || started,
    reopen: true,
    collect_ok: finished,
    collect_again: collected,
    collect_conflict: collected,
    collect_other: done,
    collect_early: requested || assigned || started,
  };
  return moves.filter((move) => can[move]);
};

/** An executor for `task` that may take it: its target key, holding every capability it needs. */
const able = (saved: Saved, cell: Cell): Executor => ({
  key: saved.request.target,
  connection: cell.connection,
  has: [...new Set([...saved.request.needs, ...CAPABILITIES.slice(0, cell.variant % 2)])],
  build: cell.build,
});

/** Another execution identity than the saved one, close to it on purpose. */
const otherExecution = (execution: string, variant: number): string =>
  choose([`${execution}x`, execution.slice(0, -1) || "e", `other-${execution}`], variant);

/** A move, or a move in the one phase of the task it was played on. */
type Done = Move | `${Move}@${Phase}` | "listed" | "listed_empty";

const walk = (
  open: Effect.Effect<Store, never, Scope.Scope>,
  moves: ReadonlyArray<Move>,
  done: Set<Done>,
  targets = false,
) =>
  Effect.fnUntraced(function* (tape: Tape) {
    const store = yield* open;
    const { sql, fault } = cutting(store.sql);
    const world: World = { tasks: new Map(), head: 0, next: 0 };
    // One service for the life of the store, built again on reopen as a restarted brain would.
    let life = yield* Layer.build(layer(sql));
    const tasks = <A>(call: (tasks: Tasks["Service"]) => Effect.Effect<A, TasksError>) =>
      Tasks.use(call).pipe(Effect.provide(life), Effect.result);
    /** G1: what each key was asked for, one pointer per accepted request, in the order they were saved. */
    const asked = new Map<string, Array<{ readonly id: string; readonly process: string }>>();
    // The ledger's own reader, outside the tasks service: it sees the `target:` stream as any reader would.
    const lines = (key: string) =>
      Ledger.use((ledger) => Stream.runCollect(ledger.read(targetStream(key), 0))).pipe(
        Effect.provide(LedgerSql.layer(sql, { reader: "connection:tasks-test-targets" }).pipe(Layer.provide(quiet))),
        Effect.orDie,
      );
    /** G1: each key's stream holds one line per accepted request, and `forTarget` answers its open tasks and last rev. */
    const indexed = Effect.fnUntraced(function* (message: string) {
      for (const key of tape.keys) {
        const saved = [...(yield* lines(key))];
        const wanted = asked.get(key) ?? [];
        expect(saved.length, `${message}: one ${targetStream(key)} line per accepted request`).toBe(wanted.length);
        expect(
          saved.map((entry) => entry.body),
          `${message}: each line points at its task`,
        ).toMatchObject(wanted);
        const answer = success(yield* tasks((j) => j.forTarget(key)), `${message}: forTarget`);
        const open = [...world.tasks.values()].filter(
          (s) => s.request.target === key && ["requested", "assigned", "started"].includes(s.phase),
        );
        const ids = (all: ReadonlyArray<Task>) =>
          all.map((j) => (j.state._tag === "absent" ? "" : j.state.request.id)).sort();
        expect(ids(answer.tasks), `${message}: forTarget answers exactly the key's open tasks`).toEqual(
          open.map((s) => s.request.id).sort(),
        );

        for (const task of answer.tasks) {
          const kept = world.tasks.get(task.state._tag === "absent" ? "" : task.state.request.id);
          expect(task, `${message}: each listed task reads as saved`).toEqual(
            kept === undefined ? null : expected(kept),
          );
        }

        expect(answer.rev, `${message}: the cursor is the stream's last rev`).toBe(saved.at(-1)?.rev ?? 0);
        done.add(open.length > 0 ? "listed" : "listed_empty");
      }
    });
    const said = (cell: Cell): Recorded => ({ ...cell.said, seen: cell.seen % (world.head + 1) });
    /** Keep an accepted call's receipt as the oracle's next event, and move the log head. */
    const keep = (saved: Saved, event: Event, recorded: Recorded, receipt: Receipt) => {
      expect(receipt.rev, "an accepted call is placed past every earlier one").toBeGreaterThan(world.head);
      world.head = receipt.rev;
      saved.receipts.set(event, receipt);
      saved.events.push({ ...recorded, event, rev: receipt.rev, arrivedAt: receipt.arrivedAt });
    };
    /** Every saved task reads as the oracle kept it, and every request not yet saved reads as absent. */
    const unchanged = Effect.fnUntraced(function* (message: string) {
      for (const request of tape.requests) {
        const saved = world.tasks.get(request.id);
        const answer = yield* tasks((j) => j.read(request.id));

        if (saved === undefined) {
          refused(answer, `${message}: an id nobody saved reads as not found`, "not_found");
        } else {
          expect(success(answer, `${message}: read ${request.id}`), message).toEqual(expected(saved));
        }
      }
    });

    for (const cell of tape.cells) {
      const options = possible(world, tape, moves);

      if (options.length === 0) {
        continue;
      }

      const move = choose(options, cell.move);
      const recorded = said(cell);
      /** The task a move is played on, and the phase it was in then. */
      const on = (phases: ReadonlyArray<Phase>) => {
        const saved = choose(at(world, phases), cell.pick);
        done.add(`${move}@${saved.phase}`);
        return saved;
      };

      switch (move) {
        case "request_new": {
          const request = choose(tape.requests, world.next++);
          const receipt = success(yield* tasks((j) => j.request(copied(request), recorded)), "a new request is saved");
          const saved: Saved = { request, phase: "requested", receipts: new Map(), events: [] };
          world.tasks.set(request.id, saved);
          keep(saved, "requested", recorded, receipt);
          asked.set(request.target, [
            ...(asked.get(request.target) ?? []),
            { id: request.id, process: request.process },
          ]);
          break;
        }
        case "request_equal": {
          const saved = choose([...world.tasks.values()], cell.pick);
          const answer = yield* tasks((j) => j.request(copied(saved.request), recorded));
          expect(success(answer, "an equal request retry succeeds"), "it answers the first receipt").toEqual(
            saved.receipts.get("requested"),
          );
          break;
        }
        case "request_changed": {
          const saved = choose([...world.tasks.values()], cell.pick);
          const other = choose(tape.requests, cell.variant);
          const changed = changedRequest(saved.request, cell.variant, other);
          refused(yield* tasks((j) => j.request(changed, recorded)), "changed bytes under a saved id", "conflict");
          break;
        }
        case "take_ok": {
          const saved = choose(at(world, ["requested"]), cell.pick);
          const executor = able(saved, cell);
          const taken = success(yield* tasks((j) => j.take(saved.request.id, copied(executor), recorded)), "a take");
          expect(taken.execution.length, "the take allocates an execution identity").toBeGreaterThan(0);
          saved.phase = "assigned";
          saved.executor = executor;
          saved.execution = taken.execution;
          saved.taken = taken;
          keep(saved, "taken", recorded, taken);
          break;
        }
        case "take_again": {
          // The take reply was lost: the same key, maybe on a new connection, gets its saved assignment,
          // whether or not the task has started or finished since.
          const saved = on(["assigned", "started", "finished", "collected"]);
          const executor = able(saved, cell);
          const taken = success(yield* tasks((j) => j.take(saved.request.id, executor, recorded)), "a repeated take");
          expect(taken, "a repeated take answers the first assignment").toEqual(saved.taken);
          break;
        }
        case "take_other": {
          const saved = choose([...world.tasks.values()], cell.pick);
          const key = choose(
            tape.keys.filter((k) => k !== saved.request.target),
            cell.variant,
          );
          const executor = { ...able(saved, cell), key, has: [...CAPABILITIES] };
          refused(
            yield* tasks((j) => j.take(saved.request.id, executor, recorded)),
            "another key's take",
            "not_target",
          );
          break;
        }
        case "take_lacking": {
          const saved = on(["requested", "assigned", "started", "finished", "collected"]);
          const missing = choose(saved.request.needs, cell.variant);
          const executor = { ...able(saved, cell), has: CAPABILITIES.filter((c) => c !== missing) };
          refused(
            yield* tasks((j) => j.take(saved.request.id, executor, recorded)),
            "a take without a needed capability",
            "lacks_capability",
          );
          break;
        }
        case "start_ok": {
          const saved = choose(at(world, ["assigned"]), cell.pick);
          const execution = saved.execution ?? expect.fail("an assigned task has an execution");
          const receipt = success(
            yield* tasks((j) => j.started(saved.request.id, execution, recorded)),
            "a start by the assignment",
          );
          saved.phase = "started";
          keep(saved, "started", recorded, receipt);
          break;
        }
        case "start_again": {
          // A lost start acknowledgement, retried even after the finish: it never moves the task back.
          const saved = on(["started", "finished", "collected"]);
          const execution = saved.execution ?? expect.fail("a started task has an execution");
          const answer = yield* tasks((j) => j.started(saved.request.id, `${execution}`, recorded));
          expect(success(answer, "a repeated start"), "it answers the first start").toEqual(
            saved.receipts.get("started"),
          );
          break;
        }
        case "start_wrong":
        case "finish_wrong": {
          const saved = choose(at(world, ["assigned", "started", "finished", "collected"]), cell.pick);
          const wrong = otherExecution(saved.execution ?? "", cell.variant);
          const answer =
            move === "start_wrong"
              ? yield* tasks((j) => j.started(saved.request.id, wrong, recorded))
              : yield* tasks((j) => j.finish(saved.request.id, wrong, cell.result, recorded));
          refused(answer, "an unrelated execution identity", "wrong_execution");
          break;
        }
        case "out_of_order": {
          // Before a take nothing may start or finish; an assigned task may not finish, even by its own execution.
          const saved = on(["requested", "assigned"]);
          const execution = saved.execution ?? "any-execution";
          const answer =
            saved.phase === "requested" && cell.variant % 2 === 0
              ? yield* tasks((j) => j.started(saved.request.id, execution, recorded))
              : yield* tasks((j) => j.finish(saved.request.id, execution, cell.result, recorded));
          refused(answer, "a start or a finish out of order", "wrong_state");
          break;
        }
        case "finish_ok": {
          const saved = choose(at(world, ["started"]), cell.pick);
          const execution = saved.execution ?? expect.fail("a started task has an execution");
          const receipt = success(
            yield* tasks((j) => j.finish(saved.request.id, execution, copied(cell.result), recorded)),
            "a finish by the assignment",
          );
          saved.phase = "finished";
          saved.result = cell.result;
          keep(saved, "finished", recorded, receipt);
          break;
        }
        case "finish_equal": {
          const saved = on(["finished", "collected"]);
          const answer = yield* tasks((j) =>
            j.finish(saved.request.id, saved.execution ?? "", copied(saved.result ?? cell.result), recorded),
          );
          expect(success(answer, "an equal finish retry"), "it answers the first finish").toEqual(
            saved.receipts.get("finished"),
          );
          break;
        }
        case "finish_other": {
          const saved = on(["finished", "collected"]);
          const other =
            JSON.stringify(cell.other) === JSON.stringify(saved.result)
              ? Result.cases.exited.make({ code: 1, version: `${JSON.stringify(cell.other)}-other` })
              : cell.other;
          refused(
            yield* tasks((j) => j.finish(saved.request.id, saved.execution ?? "", other, recorded)),
            "a conflicting result for a finished task",
            "conflict",
          );
          break;
        }
        case "unknown_id": {
          // A request's id with one more part: a well-formed id that nobody requested.
          const id = `${choose(tape.requests, cell.pick).id}/0`;
          const executor = {
            key: choose(tape.keys, cell.pick),
            connection: cell.connection,
            has: [...CAPABILITIES],
            build: cell.build,
          };
          const calls: ReadonlyArray<() => Effect.Effect<R.Result<unknown, TasksError>>> = [
            () => tasks((j) => j.read(id)),
            () => tasks((j) => j.take(id, executor, recorded)),
            () => tasks((j) => j.started(id, "any-execution", recorded)),
            () => tasks((j) => j.finish(id, "any-execution", cell.result, recorded)),
          ];
          refused(yield* choose(calls, cell.variant)(), "a call on an id nobody requested", "not_found");
          break;
        }
        case "bad": {
          const answer = yield* badCall(world, tape, cell, recorded, tasks);
          refused(answer, "a call with one invalid field", "bad_input");
          break;
        }
        case "cut_before":
        case "cut_after": {
          fault.at = move === "cut_before" ? "before" : "after";
          fault.armed = false;
          const answer = yield* legalCall(world, tape, cell, recorded, tasks);
          fault.at = null;
          fault.armed = false;
          refused(answer, "a call whose transaction is cut fails", "storage");
          break;
        }
        case "reopen":
          yield* store.reopen;
          life = yield* Layer.build(layer(sql));
          break;
        case "collect_ok": {
          const saved = on(["finished"]);
          const collection = { process: saved.request.process, letter: `${saved.request.id}/answer` };
          const receipt = success(
            yield* tasks((j) => j.collected(saved.request.id, copied(collection), recorded)),
            "the requesting process collects a finished task",
          );
          saved.phase = "collected";
          saved.collection = collection;
          keep(saved, "collected", recorded, receipt);
          break;
        }
        case "collect_again": {
          // The collect reply was lost: the same process and letter, maybe after a reopen, answer the first receipt.
          const saved = on(["collected"]);
          const collection = saved.collection ?? expect.fail("a collected task has its collection");
          const answer = yield* tasks((j) => j.collected(saved.request.id, copied(collection), recorded));
          expect(success(answer, "an equal collect retry"), "it answers the first collect").toEqual(
            saved.receipts.get("collected"),
          );
          break;
        }
        case "collect_conflict": {
          // The same process names another letter: one result is given in one answer letter only.
          const saved = on(["collected"]);
          const collection = { process: saved.request.process, letter: `${saved.request.id}/answer/${cell.variant}` };
          refused(
            yield* tasks((j) => j.collected(saved.request.id, collection, recorded)),
            "a different collection of a collected task",
            "conflict",
          );
          break;
        }
        case "collect_other": {
          // Another process generation, such as a successor, never takes this result.
          const saved = on(["finished", "collected"]);
          const other = choose(tape.requests, cell.variant).process;
          const process =
            other === saved.request.process
              ? saved.request.process.replace(/.$/, (last) => (last === "0" ? "1" : "0"))
              : other;
          refused(
            yield* tasks((j) =>
              j.collected(saved.request.id, { process, letter: `${saved.request.id}/answer` }, recorded),
            ),
            "a collect by another process",
            "wrong_process",
          );
          break;
        }
        case "collect_early": {
          const saved = on(["requested", "assigned", "started"]);
          const collection = { process: saved.request.process, letter: `${saved.request.id}/answer` };
          refused(
            yield* tasks((j) => j.collected(saved.request.id, collection, recorded)),
            "a collect before the task finished",
            "wrong_state",
          );
          break;
        }
      }

      done.add(move);
      // After every prefix, every saved task reads as the oracle kept it, and nothing else was written.
      yield* unchanged(`after ${move}`);

      if (targets) {
        yield* indexed(`G1 after ${move}`);
      }
    }
  });

type Call = <A>(
  call: (tasks: Tasks["Service"]) => Effect.Effect<A, TasksError>,
) => Effect.Effect<R.Result<A, TasksError>>;

/** One legal transition the world allows here, called and left uncounted: the cut moves use it. */
const legalCall = (world: World, tape: Tape, cell: Cell, recorded: Recorded, tasks: Call) => {
  const options: Array<() => Effect.Effect<R.Result<unknown, TasksError>>> = [];

  if (world.next < tape.requests.length) {
    // The request stays fresh: the next request_new still sends it, after the cut.
    const request = choose(tape.requests, world.next);
    options.push(() => tasks((j) => j.request(request, recorded)));
  }

  for (const saved of world.tasks.values()) {
    const id = saved.request.id;
    const execution = saved.execution ?? "";

    if (saved.phase === "requested") {
      options.push(() => tasks((j) => j.take(id, able(saved, cell), recorded)));
    } else if (saved.phase === "assigned") {
      options.push(() => tasks((j) => j.started(id, execution, recorded)));
    } else if (saved.phase === "started") {
      options.push(() => tasks((j) => j.finish(id, execution, cell.result, recorded)));
    }
  }

  return choose(options, cell.pick)();
};

/** A call that would be legal here, with one field of its input or its record made invalid. */
const badCall = (world: World, tape: Tape, cell: Cell, recorded: Recorded, tasks: Call) => {
  const saved = [...world.tasks.values()];
  const which = cell.variant % 4;
  const badRecord = broken(recorded, cell.pick, BAD_RECORDED) as Recorded;

  if (which === 0 || saved.length === 0) {
    const request = choose(tape.requests, world.next < tape.requests.length ? world.next : cell.pick);
    return cell.pick % 3 === 0
      ? tasks((j) => j.request(request, badRecord))
      : tasks((j) => j.request(broken(request, cell.pick, BAD_REQUEST) as Request, recorded));
  }

  const task = choose(saved, cell.pick);
  const execution = task.execution ?? "any-execution";

  if (which === 1) {
    return cell.pick % 3 === 0
      ? tasks((j) => j.take(task.request.id, able(task, cell), badRecord))
      : tasks((j) => j.take(task.request.id, broken(able(task, cell), cell.pick, BAD_EXECUTOR) as Executor, recorded));
  }

  if (which === 2) {
    return tasks((j) => j.started(task.request.id, execution, badRecord));
  }

  return cell.pick % 3 === 0
    ? tasks((j) => j.finish(task.request.id, execution, cell.result, badRecord))
    : tasks((j) => j.finish(task.request.id, execution, brokenResult(cell.result, cell.pick) as Result, recorded));
};

const prop = (
  name: string,
  open: Effect.Effect<Store, never, Scope.Scope>,
  moves: ReadonlyArray<Move>,
  required: ReadonlyArray<Done>,
  targets = false,
) =>
  it.effect(
    name,
    () =>
      Effect.gen(function* () {
        const done = new Set<Done>();
        const law = walk(open, moves, done, targets);
        // oxlint-disable-next-line fabrika/no-effect-run-outside-edge -- edge: fast-check awaits each tape
        const property = fc.asyncProperty(Tape, (tape) => Effect.runPromise(Effect.scoped(law(tape))));
        // oxlint-disable-next-line fabrika/no-promises -- edge: fast-check's async property answers a Promise
        yield* Effect.promise(() => fc.assert(property, { seed: 119120, numRuns: 40, includeErrorInReport: true }));
        // An empty flow cannot pass: every move the law is about ran at least once.
        expect([...done].sort()).toEqual(expect.arrayContaining([...required].sort()));
      }),
    120_000,
  );

const LIFE: ReadonlyArray<Move> = ["request_new", "take_ok", "start_ok", "finish_ok", "reopen"];

export const suite = (open: Effect.Effect<Store, never, Scope.Scope>) =>
  describe("P39 slice 1: the durable task service on a real store", () => {
    prop(
      "L1: a request keeps every fact it was given, and each event its writer's record and arrival, through reopen",
      open,
      LIFE,
      ["request_new", "take_ok", "start_ok", "finish_ok", "reopen"],
    );
    prop(
      "L2: an equal request retry answers the first receipt; changed bytes under that id are refused",
      open,
      [...LIFE, "request_equal", "request_changed"],
      ["request_new", "request_equal", "request_changed", "reopen"],
    );
    prop(
      "L3: only the target key holding every need takes a request, and its first execution identity stays",
      open,
      [...LIFE, "take_again", "take_other", "take_lacking"],
      [
        "take_ok",
        "take_other",
        "reopen",
        "take_lacking@requested",
        ...(["assigned", "started", "finished"] as const).flatMap((phase) => [
          `take_again@${phase}` as const,
          `take_lacking@${phase}` as const,
        ]),
      ],
    );
    prop(
      "L4: a start or a finish needs the saved execution identity",
      open,
      [...LIFE, "start_again", "start_wrong", "finish_wrong", "out_of_order", "unknown_id"],
      [
        "start_ok",
        "start_wrong",
        "finish_wrong",
        "unknown_id",
        "start_again@started",
        "start_again@finished",
        "out_of_order@requested",
        "out_of_order@assigned",
      ],
    );
    prop(
      "L5: an equal terminal retry is harmless; a conflicting result never replaces the first",
      open,
      [...LIFE, "finish_equal", "finish_other"],
      ["finish_ok", "finish_equal", "finish_other", "reopen"],
    );
    prop(
      "L6: a transaction cut before or after its append leaves no part of its transition",
      open,
      [...LIFE, "cut_before", "cut_after"],
      ["cut_before", "cut_after", "take_ok", "start_ok"],
    );
    prop(
      "L7: reopening after any committed prefix reads back the same tasks",
      open,
      [...LIFE, "request_equal", "take_again", "start_again", "finish_equal"],
      ["reopen", "start_ok", "finish_ok"],
    );
    prop(
      "L8: a call with one invalid field is refused and changes no task",
      open,
      [...LIFE, "bad"],
      ["bad", "request_new", "take_ok"],
    );
    prop(
      "J2: a collected event survives reopen; an equal retry answers the first receipt; a different collection is refused and writes nothing",
      open,
      [
        ...LIFE,
        "collect_ok",
        "collect_again",
        "collect_conflict",
        "collect_other",
        "collect_early",
        "finish_equal",
        "start_again",
        "take_again",
      ],
      [
        "collect_ok@finished",
        "collect_again@collected",
        "collect_conflict@collected",
        "collect_other@finished",
        "collect_other@collected",
        "collect_early@started",
        "finish_equal@collected",
        "start_again@collected",
        "take_again@collected",
        "reopen",
      ],
    );
    prop(
      "G1: an accepted request writes one target: line in its own transaction, a repeat, a conflict or a cut writes none, and forTarget answers exactly the key's open tasks and the stream's last rev",
      open,
      [...LIFE, "request_equal", "request_changed", "cut_before", "cut_after", "take_again", "finish_equal"],
      [
        "request_new",
        "request_equal",
        "request_changed",
        "cut_before",
        "cut_after",
        "finish_ok",
        "reopen",
        "listed",
        "listed_empty",
      ],
      true,
    );
  });

// A5: IDs intentionally disagree with request.process; the saved request decides membership.
export const discoverySuite = (open: Effect.Effect<Store, never, Scope.Scope>) => {
  it.effect(
    "A5: process discovery keeps every saved task through page crossings and reopen",
    () =>
      Effect.gen(function* () {
        const done = new Set<string>();
        const measured = { scans: 0, queries: 0, rows: 0, tasks: 0 };
        const tape = Schema.Struct({
          request: Schema.Struct({ ...Request.fields, process: Id.Process }),
          recorded: Recorded,
          cells: Schema.Array(Schema.Int.check(Schema.isGreaterThanOrEqualTo(0))).check(
            Schema.isMinLength(8),
            Schema.isMaxLength(40),
          ),
          total: Schema.Int.check(Schema.isGreaterThanOrEqualTo(257), Schema.isLessThanOrEqualTo(530)),
        });
        const check = Effect.fnUntraced(function* (a: typeof tape.Type) {
          const raw = yield* open;
          const work = { queries: 0, rows: 0 };
          const sql: Sql = {
            exec: (query, ...params) => {
              const rows = raw.sql.exec(query, ...params);
              work.queries++;
              work.rows += rows.length;
              return rows;
            },
            transaction: (step) => raw.sql.transaction(step),
            size: () => raw.sql.size(),
          };
          const store = { ...raw, sql };
          let life = yield* Layer.build(layer(store.sql));
          const call = <A, E>(f: (j: Tasks["Service"]) => Effect.Effect<A, E>) =>
            Tasks.use(f).pipe(Effect.provide(life));
          const wanted = a.request.process;
          const other = wanted.replace(/.$/, (last) => (last === "0" ? "1" : "0"));
          const said = { ...a.recorded, seen: 0 };
          const expected = new Map<string, Task>();

          for (let n = 0; n < a.total; n++) {
            const request = { ...a.request, id: `opaque-${n}`, process: n % 3 === 0 ? other : wanted };
            yield* call((j) => j.request(request, said));
            expected.set(request.id, yield* call((j) => j.read(request.id)));
          }

          for (const choice of a.cells) {
            const owned = [...expected.entries()].filter(([, j]) => j.state._tag === "requested");
            const move = choice % (owned.length > 0 ? 3 : 2);

            if (move === 0) {
              yield* store.reopen;
              life = yield* Layer.build(layer(store.sql));
              done.add("reopen");
            } else if (move === 2) {
              const [id, saved] = choose(owned, choice);

              if (saved.state._tag === "requested") {
                yield* call((j) =>
                  j.take(
                    id,
                    {
                      key: saved.state._tag === "requested" ? saved.state.request.target : "",
                      connection: "discovery",
                      has: saved.state._tag === "requested" ? saved.state.request.needs : [],
                      build: "hands",
                    },
                    said,
                  ),
                );
                expected.set(id, yield* call((j) => j.read(id)));
                done.add("taken");
              }
            }

            for (const process of [wanted, other]) {
              const before = { ...work };
              const actual = yield* call((j) => Stream.runCollect(j.forProcess(process)));
              measured.scans++;
              measured.queries += work.queries - before.queries;
              measured.rows += work.rows - before.rows;
              measured.tasks += a.total;
              const rows = [...actual];
              const selected = [...expected.values()].filter(
                (j) => j.state._tag !== "absent" && j.state.request.process === process,
              );
              const ids = (tasks: ReadonlyArray<Task>) =>
                tasks.map((j) => (j.state._tag === "absent" ? "" : j.state.request.id)).sort();
              expect(ids(rows)).toEqual(ids(selected));
              expect(new Set(ids(rows)).size).toBe(rows.length);

              for (const task of rows) {
                expect(task).toEqual(expected.get(task.state._tag === "absent" ? "" : task.state.request.id));
              }
            }
          }
        });
        const result = yield* Arbitrary.checkEffect(
          Arbitrary.schema(tape),
          (a) =>
            Effect.scoped(check(a)).pipe(
              Effect.as(true),
              Effect.catchCause((cause) => Effect.fail(cause)),
            ),
          { seed: 119120, runs: 60, concurrency: 1 },
        );
        expect(result._tag, Arbitrary.formatCheckFailure(result)).toBe("Passed");
        expect(done).toEqual(new Set(["reopen", "taken"]));
        yield* Effect.logInfo("P39 process discovery work", measured);
      }),
    120_000,
  );
  it.effect.prop(
    "A13: Tasks discovery keeps its own error and the lower cause",
    { cause: Schema.String },
    ({ cause }) =>
      Effect.gen(function* () {
        const store = yield* open;
        const lower = new LedgerStreamsError({ reason: new Storage({ cause }) });
        const dependencies = Layer.mergeAll(
          Layer.succeed(LedgerStreams, { list: () => Stream.fail(lower) }),
          LedgerSql.layer(store.sql, { reader: "tasks-discovery-error" }).pipe(Layer.provide(quiet)),
          LedgerTransactionSql.layer(store.sql).pipe(Layer.provide(quiet)),
          Id.Generator.layer,
        );
        const result = yield* Tasks.use((tasks) =>
          Stream.runCollect(tasks.forProcess("process_01m6v5270hetdrt4r8h9vvjwjs")),
        ).pipe(Effect.provide(TasksLedger.layer.pipe(Layer.provide(dependencies))), Effect.result);
        expect(R.isFailure(result)).toBe(true);

        if (R.isFailure(result)) {
          expect(result.failure).toBeInstanceOf(TasksError);
          expect(result.failure.cause).toBe(lower);
        }
      }).pipe(Effect.scoped),
    { arbitrary: { seed: 119120, runs: 100 } },
  );
};
