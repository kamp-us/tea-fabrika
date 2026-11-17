// P39 slice 1, L2 to L5 and L7 on the task machine itself (0037, 0046): its real `init` and its real
// update, one Msg at a time. Every law walks a decision tape (0093): each cell is read against the
// phase the fold has reached, so a retry repeats the saved request, a start names the real
// assignment or a near miss of it, and a finish answers a real start. The expected state is this
// file's own reading of the plan's states table, never the machine.
//
// P39 slice 3 (ticket 1040), J1: `collect` is legal only in `finished`, once, by the requesting
// process; `collected` never leads back to execution. The walk reaches `collected` and keeps playing
// every take, start and finish there. Plants (after build): accept `collect` in `started`, or let
// another process collect.
import { applyCell } from "@demlik/tea";
import { describe, expect, it } from "@effect/vitest";
import { Schema } from "effect";
import * as fc from "fast-check";
import { type Executor, type Request, Result, State } from "../Task.ts";
import {
  CAPABILITIES,
  changedRequest,
  choose,
  copied,
  fcExecutor,
  fcFingerprint,
  fcRequest,
  fcResult,
  fcTypeId,
} from "../TasksTest.ts";
import { task } from "./task.ts";

/** The key of each Msg, Cmd and answer these laws write or expect, made by a schema (0569, 0562).
 *  A law hands over only the fields it reads, so a case holds the key alone. */
const Tag = Schema.TaggedUnion({
  collect: {},
  finish: {},
  request: {},
  start: {},
  take: {},
});

const RUNS = { seed: 119120, numRuns: 100 };

type Model = (typeof task)["model"]["Type"];

type Msg = (typeof task)["msg"]["Type"];

type Phase = "absent" | "requested" | "assigned" | "started" | "finished" | "collected";

const init = (): Model => task.init(null, undefined)[0];

const step = (model: Model, msg: Msg): Model => applyCell(task, model, msg)[0];

/** What the fold knows, from its own Msgs only. */
type World = {
  phase: Phase;
  request?: Request;
  executor?: Executor;
  execution?: string;
  result?: Result;
  collection?: Collection;
};

/** Who took a finished task's result, and the answer letter it went in. */
type Collection = { readonly process: string; readonly letter: string };

const Cell = fc.record({
  move: fc.nat(),
  pick: fc.nat(),
  variant: fc.nat(),
  execution: fc.stringMatching(/^[a-z0-9]{1,12}$/),
  connection: fcTypeId("connection"),
  result: fcResult,
  stranger: fcTypeId("process"),
  letter: fc.stringMatching(/^[a-z0-9]{1,8}$/),
});

type Cell = typeof Cell extends fc.Arbitrary<infer A> ? A : never;

const Tape = fc.uniqueArray(fcFingerprint, { minLength: 3, maxLength: 3 }).chain((keys) =>
  fc.record({
    keys: fc.constant(keys),
    requests: fc.array(fcRequest(keys.slice(0, 2)), { minLength: 2, maxLength: 3 }),
    executors: fc.array(fcExecutor(keys), { minLength: 1, maxLength: 3 }),
    cells: fc.array(Cell, { minLength: 8, maxLength: 40, size: "max" }),
  }),
);

type Tape = typeof Tape extends fc.Arbitrary<infer A> ? A : never;

type Move =
  | "request_new"
  | "early"
  | "request_equal"
  | "request_changed"
  | "take_ok"
  | "take_again"
  | "take_other"
  | "take_lacking"
  | "out_of_order"
  | "start_ok"
  | "start_again"
  | "start_wrong"
  | "finish_ok"
  | "finish_equal"
  | "finish_other"
  | "finish_wrong"
  | "collect_ok"
  | "collect_again"
  | "collect_conflict"
  | "collect_other"
  | "collect_early";

const possible = (world: World, moves: ReadonlyArray<Move>): ReadonlyArray<Move> => {
  const s = world.phase;
  const done = s === "finished" || s === "collected";
  const owned = s === "assigned" || s === "started" || done;

  const can: Record<Move, boolean> = {
    request_new: s === "absent",
    early: s === "absent",
    request_equal: s !== "absent",
    request_changed: s !== "absent",
    take_ok: s === "requested",
    take_again: owned,
    take_other: s !== "absent",
    take_lacking: s !== "absent",
    out_of_order: s === "requested" || s === "assigned",
    start_ok: s === "assigned",
    start_again: s === "started" || done,
    start_wrong: owned,
    finish_ok: s === "started",
    finish_equal: done,
    finish_other: done,
    finish_wrong: owned,
    collect_ok: s === "finished",
    collect_again: s === "collected",
    collect_conflict: s === "collected",
    collect_other: done,
    collect_early: !done,
  };

  return moves.filter((move) => can[move]);
};

/** The state the oracle expects, built from the world through the schema's own constructors. */
const expected = (world: World) => {
  const { request, executor, execution, result } = world;

  if (world.phase === "absent" || request === undefined) {
    return State.cases.absent.make({});
  }

  if (world.phase === "requested" || executor === undefined || execution === undefined) {
    return State.cases.requested.make({ request });
  }

  const assignment = { execution, executor };

  if (world.phase === "assigned") {
    return State.cases.assigned.make({ request, assignment });
  }

  if (world.phase === "started" || result === undefined) {
    return State.cases.started.make({ request, assignment });
  }

  if (world.phase === "finished" || world.collection === undefined) {
    return State.cases.finished.make({ request, assignment, result });
  }

  return State.cases.collected.make({ request, assignment, result, collection: world.collection });
};

/** An executor that may take the request: its target key, holding every capability it needs. */
const able = (request: Request, cell: Cell, base: Executor): Executor => ({
  ...base,
  key: request.target,
  connection: cell.connection,
  has: [...new Set([...base.has, ...request.needs])],
});

const near = (execution: string, variant: number): string =>
  choose([`${execution}x`, execution.slice(0, -1) || "e", `other-${execution}`], variant);

type Expect = { readonly answer: "accepted" | "repeated" | "refused"; readonly reason?: string };

/** One move as its Msg, what the world becomes, and the answer the oracle expects. */
const play = (world: World, tape: Tape, cell: Cell, move: Move): readonly [Msg, World, Expect] => {
  const request = world.request ?? choose(tape.requests, cell.pick);
  const base = choose(tape.executors, cell.pick);
  const refuse = (reason: string): Expect => ({ answer: "refused", reason });
  const same: Expect = { answer: "repeated" };
  const execution = world.execution ?? cell.execution;

  switch (move) {
    case "request_new":
      return [
        { ...Tag.cases.request.make({}), request: copied(request) },
        { phase: "requested", request },
        { answer: "accepted" },
      ];
    case "early": {
      const msgs: ReadonlyArray<Msg> = [
        { ...Tag.cases.take.make({}), executor: able(request, cell, base), execution: cell.execution },
        { ...Tag.cases.start.make({}), execution: cell.execution },
        { ...Tag.cases.finish.make({}), execution: cell.execution, result: cell.result },
      ];

      return [choose(msgs, cell.variant), world, refuse("not_found")];
    }

    case "request_equal":
      return [{ ...Tag.cases.request.make({}), request: copied(request) }, world, same];
    case "request_changed": {
      const changed = changedRequest(request, cell.variant, choose(tape.requests, cell.variant + 1));
      return [{ ...Tag.cases.request.make({}), request: changed }, world, refuse("conflict")];
    }

    case "take_ok": {
      const executor = able(request, cell, base);
      const next = { ...world, phase: "assigned" as const, executor, execution: cell.execution };
      return [
        { ...Tag.cases.take.make({}), executor: copied(executor), execution: cell.execution },
        next,
        { answer: "accepted" },
      ];
    }

    case "take_again": {
      // The take reply was lost: the same key on a new connection proposes a new identity, and keeps the first.
      const executor = able(request, cell, base);
      return [{ ...Tag.cases.take.make({}), executor, execution: near(execution, cell.variant) }, world, same];
    }

    case "take_other": {
      const key = choose(
        tape.keys.filter((k) => k !== request.target),
        cell.variant,
      );

      const executor = { ...able(request, cell, base), key, has: [...CAPABILITIES] };
      return [{ ...Tag.cases.take.make({}), executor, execution: cell.execution }, world, refuse("not_target")];
    }

    case "take_lacking": {
      const missing = choose(request.needs, cell.variant);
      const executor = { ...able(request, cell, base), has: CAPABILITIES.filter((c) => c !== missing) };
      return [{ ...Tag.cases.take.make({}), executor, execution: cell.execution }, world, refuse("lacks_capability")];
    }

    case "out_of_order": {
      // Before a take nothing may start or finish; an assigned task may not finish, even by its own execution.
      const msgs: ReadonlyArray<Msg> =
        world.phase === "assigned"
          ? [{ ...Tag.cases.finish.make({}), execution, result: cell.result }]
          : [
              { ...Tag.cases.start.make({}), execution: cell.execution },
              { ...Tag.cases.finish.make({}), execution: cell.execution, result: cell.result },
            ];

      return [choose(msgs, cell.variant), world, refuse("wrong_state")];
    }

    case "start_ok":
      return [
        { ...Tag.cases.start.make({}), execution: `${execution}` },
        { ...world, phase: "started" },
        { answer: "accepted" },
      ];
    case "start_again":
      return [{ ...Tag.cases.start.make({}), execution: `${execution}` }, world, same];
    case "start_wrong":
      return [
        { ...Tag.cases.start.make({}), execution: near(execution, cell.variant) },
        world,
        refuse("wrong_execution"),
      ];
    case "finish_ok": {
      const next = { ...world, phase: "finished" as const, result: cell.result };
      return [{ ...Tag.cases.finish.make({}), execution, result: copied(cell.result) }, next, { answer: "accepted" }];
    }

    case "finish_equal":
      return [{ ...Tag.cases.finish.make({}), execution, result: copied(world.result ?? cell.result) }, world, same];
    case "finish_other": {
      const other =
        JSON.stringify(cell.result) === JSON.stringify(world.result)
          ? Result.cases.exited.make({ code: 1, version: `${JSON.stringify(cell.result)}-other` })
          : cell.result;
      return [{ ...Tag.cases.finish.make({}), execution, result: other }, world, refuse("conflict")];
    }

    case "finish_wrong":
      return [
        { ...Tag.cases.finish.make({}), execution: near(execution, cell.variant), result: cell.result },
        world,
        refuse("wrong_execution"),
      ];
    case "collect_ok": {
      const collection = { process: request.process, letter: `${request.id}/answer` };
      const next = { ...world, phase: "collected" as const, collection };
      return [{ ...Tag.cases.collect.make({}), collection: copied(collection) }, next, { answer: "accepted" }];
    }

    case "collect_again":
      return [
        { ...Tag.cases.collect.make({}), collection: copied(world.collection ?? { process: "", letter: "" }) },
        world,
        same,
      ];
    case "collect_conflict": {
      // The same process names another letter: one result goes in one answer letter.
      const collection = { process: request.process, letter: `${request.id}/answer/${cell.letter}` };
      return [{ ...Tag.cases.collect.make({}), collection }, world, refuse("conflict")];
    }

    case "collect_other": {
      // Another process generation, such as the successor of a restart, never takes this result.
      const process = cell.stranger === request.process ? `${request.process}x` : cell.stranger;

      return [
        { ...Tag.cases.collect.make({}), collection: { process, letter: `${request.id}/answer` } },
        world,
        refuse("wrong_process"),
      ];
    }

    case "collect_early": {
      const collection = { process: request.process, letter: `${request.id}/answer` };
      return [
        { ...Tag.cases.collect.make({}), collection },
        world,
        refuse(world.phase === "absent" ? "not_found" : "wrong_state"),
      ];
    }
  }
};

/** A move, or a move in the one phase it must have been played in. */
type Done = Move | `${Move}@${Phase}`;

const law = (name: string, moves: ReadonlyArray<Move>, required: ReadonlyArray<Done>) =>
  it(name, () => {
    const done = new Set<Done>();
    fc.assert(
      fc.property(Tape, (tape) => {
        let model = init();
        let world: World = { phase: "absent" };
        const accepted: Array<Msg> = [];
        expect(model.state, "a task starts absent").toEqual(State.cases.absent.make({}));

        for (const cell of tape.cells) {
          const options = possible(world, moves);

          if (options.length === 0) {
            continue;
          }

          const move = choose(options, cell.move);
          const [msg, next, answer] = play(world, tape, cell, move);
          const before = model.state;
          model = step(model, msg);
          done.add(move).add(`${move}@${world.phase}`);

          expect(model.answer._tag, `${move}: the answer`).toBe(answer.answer);

          if (answer.reason !== undefined) {
            expect(model.answer, `${move}: the refusal's reason`).toMatchObject({ reason: answer.reason });
          }

          if (answer.answer === "accepted") {
            accepted.push(msg);
          } else {
            expect(model.state, `${move}: a repeat or a refusal changes nothing`).toEqual(before);
          }

          world = next;
          expect(model.state, `${move}: the state the plan's table gives`).toEqual(expected(world));
          // L7 on every prefix: folding only the committed events from a fresh init is the same task.
          const replayed = accepted.reduce(step, init());
          expect(replayed.state, `${move}: the committed events fold back to the same task`).toEqual(model.state);
        }
      }),
      RUNS,
    );
    // An empty flow cannot pass: every move the law is about ran at least once.
    expect([...done].sort()).toEqual(expect.arrayContaining([...required].sort()));
  });

const LIFE: ReadonlyArray<Move> = ["request_new", "take_ok", "start_ok", "finish_ok"];

const COLLECT: ReadonlyArray<Move> = [
  "collect_ok",
  "collect_again",
  "collect_conflict",
  "collect_other",
  "collect_early",
];

describe("P39 slice 1: the task machine", () => {
  law(
    "L2: an equal request repeats; changed bytes under the same id are refused and the first request stays",
    [...LIFE, "request_equal", "request_changed"],
    ["request_new", "request_equal", "request_changed"],
  );
  law(
    "L3: only the target key holding every need takes a request, and one execution identity wins",
    [...LIFE, "early", "take_again", "take_other", "take_lacking"],
    [
      "take_ok",
      "take_other",
      "early",
      ...(["assigned", "started", "finished"] as const).flatMap((phase) => [
        `take_again@${phase}` as const,
        `take_lacking@${phase}` as const,
      ]),
      "take_lacking@requested",
    ],
  );
  law(
    "L4: a start or a finish needs the saved execution identity, in its order",
    [...LIFE, "start_again", "start_wrong", "finish_wrong", "out_of_order", "early"],
    [
      "start_ok",
      "start_again@started",
      "start_again@finished",
      "start_wrong",
      "finish_wrong",
      "out_of_order@requested",
      "out_of_order@assigned",
    ],
  );
  law(
    "L5: an equal terminal retry repeats; a conflicting result never replaces the first",
    [...LIFE, "finish_equal", "finish_other", "finish_wrong", "start_wrong"],
    ["finish_ok", "finish_equal", "finish_other"],
  );
  law(
    "L7: folding the committed events from init gives the same task as the whole walk",
    [
      ...LIFE,
      "request_equal",
      "request_changed",
      "take_again",
      "take_other",
      "take_lacking",
      "start_again",
      "start_wrong",
      "finish_equal",
      "finish_other",
    ],
    ["request_new", "take_ok", "start_ok", "finish_ok", "take_again", "finish_equal"],
  );
  law(
    "J1: collect is legal only in finished, once, by the requesting process, and collected never leads back to execution",
    [...LIFE, ...COLLECT, "take_again", "start_again", "start_wrong", "finish_equal", "finish_other", "finish_wrong"],
    [
      "collect_ok@finished",
      "collect_again@collected",
      "collect_conflict@collected",
      "collect_other@finished",
      "collect_other@collected",
      "collect_early@absent",
      "collect_early@requested",
      "collect_early@assigned",
      "collect_early@started",
      "take_again@collected",
      "start_again@collected",
      "start_wrong@collected",
      "finish_equal@collected",
      "finish_other@collected",
      "finish_wrong@collected",
    ],
  );
});
