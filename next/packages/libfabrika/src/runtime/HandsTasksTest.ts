// P39 slice 3 (ticket 1040), next/, S1 on the Project's half of a hands Cmd: `HandsTasksLive.layer`
// over a real task store, and no driver (0062). A runner in the module that owns a driver calls
// `HandsTasksTest.suite(open)`; `open` acquires one store in a scope and gives it back when that scope
// closes.
//
// The walk reads the tasks it has saved so far and picks its next move from what is possible there: an
// ask for a Cmd nobody saved or for a saved one, a change of the person's `hands.target` between two
// asks, the hands finishing a task that is really waiting, or a restart of the Project, which builds
// the layer again over the same store. The oracle is this file's own record of what each ask was
// given and answered, never the product's machine.
//
// The contract this law pins, from the plan:
//   HandsTasks.ts: `Ask`, `Reply` (`waiting`, `finished`, `refused` with `no_hands` or `id_reused`),
//   `HandsTasksError`, `HandsTasks`.
//   HandsTasksLive.ts: `layer({ target, settings })`, read first, then request or collect, over `Tasks`.
//
// Plants (after build): fall back to the first live hands key when `hands.target` is unset; rebuild
// the request on a retry, so a changed target answers `id_reused`.
//
// S2, added in the fix round: a saved task's id asked by another process is refused `id_reused` in
// every state the task can be in. The task machine refuses `wrong_process` only for a finished or
// collected task, so for a requested, assigned or started one the layer's own check is what keeps
// another process's waiting receipt out of the reply. Plant: drop that check in `HandsTasksLive.ts`.
import { describe, expect, it } from "@effect/vitest";
import { runsFor } from "@kampus/vitest";
import { Effect, Layer, Result as R, type Scope } from "effect";
import * as fc from "fast-check";
import type { From } from "../processes/Mailbox.ts";
import { Command, type Task, type Result, State } from "../tasks/Task.ts";
import { Tasks } from "../tasks/Tasks.ts";
import { choose, copied, fcFingerprint, fcRecorded, fcRequest, fcResult } from "../tasks/TasksTest.ts";
import { type Ask, HandsTasks, Reply } from "./HandsTasks.ts";
import * as HandsTasksLive from "./HandsTasksLive.ts";

/** One real task store, for the life of one walk. `reopen` closes it and opens the same rows again. */
export type Store = { readonly tasks: Layer.Layer<Tasks>; readonly reopen: Effect.Effect<void> };

const fcHash = fc.stringMatching(/^[0-9a-f]{16}$/);

/** A Cmd a program dispatched: the request's own facts, as the runner gives them to `ask`. */
const fcAsk = (keys: ReadonlyArray<string>): fc.Arbitrary<typeof Ask.Type> =>
  fcRequest(keys).map(({ id, process, name, program, build, parent, traceId }) => ({
    id,
    process,
    name,
    program,
    build,
    command: Command.cases.git_version.make({}),
    parent,
    traceId,
  }));

const Cell = fc.record({ move: fc.nat(), pick: fc.nat(), said: fcRecorded, result: fcResult });
type Cell = typeof Cell extends fc.Arbitrary<infer A> ? A : never;

/**
 * A tape: the person's `hands.target` over the walk (unset is `null`), each life's settings hash,
 * the Cmds a program may dispatch, and the cells. A target may repeat, and may go from set to unset.
 */
const Tape = fc.uniqueArray(fcFingerprint, { minLength: 2, maxLength: 2 }).chain((keys) =>
  fc.record({
    targets: fc.array(fc.option(fc.constantFrom(...keys), { nil: null, freq: 3 }), { minLength: 2, maxLength: 4 }),
    hashes: fc.array(fcHash, { minLength: 4, maxLength: 4 }),
    asks: fc.uniqueArray(fcAsk(keys), { minLength: 2, maxLength: 4, selector: (a) => a.id }),
    cells: fc.array(Cell, { minLength: 8, maxLength: 30, size: "max" }),
  }),
);
type Tape = typeof Tape extends fc.Arbitrary<infer A> ? A : never;

type Move = "ask" | "change" | "finish" | "reopen";

/** What the oracle knows of one ask's task, from its own calls only. */
type Saved = {
  readonly target: string;
  readonly settings: string;
  readonly requested: { readonly rev: number; readonly arrivedAt: number };
  phase: "requested" | "finished" | "collected";
  result?: Result;
  collected?: { readonly rev: number; readonly arrivedAt: number };
};

const answered = <A>(answer: R.Result<A, unknown>, message: string): A => {
  if (R.isFailure(answer)) {
    expect.fail(`${message}: ${String(answer.failure)}`);
  }

  return answer.success;
};

const walk = (open: Effect.Effect<Store, never, Scope.Scope>, done: Set<string>) =>
  Effect.fnUntraced(function* (tape: Tape) {
    const store = yield* open;
    let tasksLife = yield* Layer.build(store.tasks);
    let life = 0;
    const saved = new Map<string, Saved>();
    const target = () => choose(tape.targets, life);
    const settings = () => choose(tape.hashes, life);
    const ask = (a: typeof Ask.Type, from: From) =>
      HandsTasks.use((h) => h.ask(copied(a), from)).pipe(
        Effect.provide(
          HandsTasksLive.layer({ target: target(), settings: settings() }).pipe(
            Layer.provide(Layer.succeedContext(tasksLife)),
          ),
        ),
        Effect.result,
      );
    const tasks = <A, E>(call: (j: Tasks["Service"]) => Effect.Effect<A, E>) =>
      Tasks.use(call).pipe(Effect.provide(tasksLife), Effect.result);
    const read = (id: string) => tasks((j) => j.read(id));

    for (const cell of tape.cells) {
      const waiting = [...saved.entries()].filter(([, s]) => s.phase === "requested");
      const can: Record<Move, boolean> = {
        ask: true,
        change: life + 1 < tape.targets.length,
        finish: waiting.length > 0,
        reopen: true,
      };
      const move = choose(
        (["ask", "change", "finish", "reopen"] as const).filter((m) => can[m]),
        cell.move,
      );
      const from: From = { ...cell.said, seen: 0 };

      if (move === "ask") {
        const a = choose(tape.asks, cell.pick);
        const kept = saved.get(a.id);
        const reply = answered(yield* ask(a, from), "an ask answers, whatever the task's state");

        if (kept === undefined && target() === null) {
          // S1: no hands key is set: nothing is written, and the answer is a refusal the program reads.
          expect(reply, "S1: an unset hands.target refuses no_hands").toEqual(
            Reply.cases.refused.make({ reason: "no_hands" }),
          );
          const task = yield* read(a.id);
          expect(R.isFailure(task) && task.failure.reason, "S1: an unset hands.target writes no task").toBe(
            "not_found",
          );
          done.add("refused");
        } else if (kept === undefined) {
          const task = answered(yield* read(a.id), "a waiting ask saved its task");
          const first = task.events[0];
          expect(
            task.events.map((e) => e.event),
            "one request is saved",
          ).toEqual(["requested"]);
          expect(reply, "S1: a new task answers waiting with its request's receipt").toEqual(
            Reply.cases.waiting.make({ rev: first?.rev ?? -1, arrivedAt: first?.arrivedAt ?? -1 }),
          );
          // The request is the Cmd's own facts, the trusted needs of its command, the target and the hash.
          expect(task.state).toEqual(
            State.cases.requested.make({
              request: { ...a, needs: ["git"], target: target() ?? "", settings: settings() },
            }),
          );
          expect(first, "the writer's record is the runner's").toMatchObject({
            by: from.by,
            for: from.for,
            sentAt: from.sentAt,
            traceId: from.traceId,
            build: from.build,
          });
          saved.set(a.id, {
            target: target() ?? "",
            settings: settings(),
            requested: { rev: first?.rev ?? -1, arrivedAt: first?.arrivedAt ?? -1 },
            phase: "requested",
          });
          done.add("waiting:new");
        } else if (kept.phase === "requested") {
          // A retry reads the saved task, whatever the person changed since: no other bytes under its id.
          expect(reply, "S1: a retry of a waiting task answers its first receipt").toEqual(
            Reply.cases.waiting.make(kept.requested),
          );
          done.add(target() === kept.target ? "waiting:again" : target() === null ? "waiting:unset" : "waiting:moved");
        } else {
          const result = kept.result ?? expect.fail("a finished task has its result");
          const task = answered(yield* read(a.id), "a finished task reads back");
          const collected = task.events.filter((e) => e.event === "collected");
          expect(collected, "one collect is saved, however often the Cmd asks").toHaveLength(1);
          const receipt = { rev: collected[0]?.rev ?? -1, arrivedAt: collected[0]?.arrivedAt ?? -1 };
          expect(reply, "a finished task answers its result and the collect's receipt").toEqual(
            Reply.cases.finished.make({ result, ...receipt }),
          );
          expect(task.state._tag, "the asking process collected it").toBe("collected");
          expect(task.state, "into the Cmd's answer letter").toMatchObject({
            collection: { process: a.process, letter: `${a.id}/answer` },
          });
          done.add(kept.phase === "finished" ? "finished" : "finished:again");

          if (kept.collected !== undefined) {
            expect(receipt, "a repeated collect answers the first").toEqual(kept.collected);
          }

          kept.phase = "collected";
          kept.collected = receipt;
        }

        // Whatever the target is now, a saved request keeps the target and hash it was first made with.
        const after = yield* read(a.id);

        if (R.isSuccess(after) && after.success.state._tag !== "absent") {
          const first = saved.get(a.id);
          expect(after.success.state.request.target, "S1: the request's target is the first one").toBe(first?.target);
          expect(after.success.state.request.settings, "S1: the request's settings hash is the first one").toBe(
            first?.settings,
          );
        }
      } else if (move === "change") {
        life++;
        done.add(target() === null ? "change:unset" : "change:set");
      } else if (move === "finish") {
        // The hands the person chose take, start and finish the task, as slice 2's methods do.
        const [id, kept] = choose(waiting, cell.pick);
        const executor = { key: kept.target, connection: "hands-law", has: ["git"], build: "hands-build" };
        const by = { ...from, by: kept.target };
        const taken = answered(yield* tasks((j) => j.take(id, executor, by)), "the target takes its task");
        answered(yield* tasks((j) => j.started(id, taken.execution, by)), "the target starts its task");
        answered(yield* tasks((j) => j.finish(id, taken.execution, cell.result, by)), "the target finishes its task");
        kept.phase = "finished";
        kept.result = cell.result;
        done.add("finish");
      } else {
        yield* store.reopen;
        tasksLife = yield* Layer.build(store.tasks);
        done.add("reopen");
      }

      // Every ask nobody answered waiting stays unsaved.
      for (const a of tape.asks) {
        if (!saved.has(a.id)) {
          const task: R.Result<Task, unknown> = yield* read(a.id);
          expect(R.isFailure(task), "an ask that was refused or never made saves no task").toBe(true);
        }
      }
    }
  });

/** The states a saved task can be in when another process asks under its id. */
const STATES = ["requested", "assigned", "started", "finished", "collected"] as const;

/**
 * A tape for S2: the asking process's Cmd, another process, the state its task is brought to, the
 * hands' result, and what each writer says.
 */
const Foreign = fc.uniqueArray(fcFingerprint, { minLength: 1, maxLength: 1 }).chain((keys) =>
  fc
    .record({
      key: fc.constant(keys[0] ?? ""),
      mine: fcAsk(keys),
      theirs: fcAsk(keys),
      state: fc.constantFrom(...STATES),
      result: fcResult,
      said: fcRecorded,
      asked: fcRecorded,
    })
    .filter(({ mine, theirs }) => mine.process !== theirs.process),
);
type Foreign = typeof Foreign extends fc.Arbitrary<infer A> ? A : never;

/**
 * S2: a saved task is only ever its own process's. Brings one process's task to a state, then asks
 * under the same id as another process, and reads the task back before and after.
 */
const foreign = (open: Effect.Effect<Store, never, Scope.Scope>, done: Set<string>) =>
  Effect.fnUntraced(function* (tape: Foreign) {
    const store = yield* open;
    const tasksLife = yield* Layer.build(store.tasks);
    const ask = (a: typeof Ask.Type, from: From) =>
      HandsTasks.use((h) => h.ask(copied(a), from)).pipe(
        Effect.provide(
          HandsTasksLive.layer({ target: tape.key, settings: "0123456789abcdef" }).pipe(
            Layer.provide(Layer.succeedContext(tasksLife)),
          ),
        ),
        Effect.result,
      );
    const tasks = <A, E>(call: (j: Tasks["Service"]) => Effect.Effect<A, E>) =>
      Tasks.use(call).pipe(Effect.provide(tasksLife), Effect.result);
    const from: From = { ...tape.said, seen: 0 };
    const id = tape.mine.id;
    const reached = STATES.indexOf(tape.state);

    answered(yield* ask(tape.mine, from), "the asking process saves its task");

    if (reached >= 1) {
      const executor = { key: tape.key, connection: "hands-law", has: ["git"], build: "hands-build" };
      const by = { ...from, by: tape.key };
      const taken = answered(yield* tasks((j) => j.take(id, executor, by)), "the target takes the task");

      if (reached >= 2) {
        answered(yield* tasks((j) => j.started(id, taken.execution, by)), "the target starts the task");
      }

      if (reached >= 3) {
        answered(yield* tasks((j) => j.finish(id, taken.execution, tape.result, by)), "the target finishes the task");
      }

      if (reached >= 4) {
        answered(yield* ask(tape.mine, from), "the asking process collects its result");
      }
    }

    const before = answered(yield* tasks((j) => j.read(id)), "the saved task reads back");
    expect(before.state._tag, `the task is ${tape.state}`).toBe(tape.state);

    // Another process asks under the same id: its own Cmd's facts, the id it does not own.
    const reply = answered(
      yield* ask({ ...tape.mine, process: tape.theirs.process }, { ...tape.asked, seen: 0 }),
      "an ask from another process answers",
    );
    // The answer is the bare refusal, for good: no receipt and no result, the asker's to read.
    expect(reply, `S2: another process's ask is refused id_reused and nothing else (${tape.state})`).toEqual(
      Reply.cases.refused.make({ reason: "id_reused" }),
    );
    expect(Object.keys(reply).sort(), "S2: the refusal carries no receipt or result").toEqual(["_tag", "reason"]);

    const after = answered(yield* tasks((j) => j.read(id)), "the saved task still reads back");
    expect(after, `S2: another process's ask writes nothing (${tape.state})`).toEqual(before);
    done.add(tape.state);
  });

export const suite = (open: Effect.Effect<Store, never, Scope.Scope>) =>
  describe("P39 slice 3: the Project's half of a hands Cmd", () => {
    it.effect(
      "S1: an unset hands.target writes no task and answers refused no_hands; a set one is the request's target, and the snapshot hash its settings",
      () =>
        Effect.gen(function* () {
          const context = yield* Effect.context<never>();
          const done = new Set<string>();
          const law = walk(open, done);
          // oxlint-disable-next-line fabrika/no-effect-run-outside-edge -- edge: fast-check awaits each tape
          const property = fc.asyncProperty(Tape, (tape) => Effect.runPromiseWith(context)(Effect.scoped(law(tape))));
          const options = { seed: 119120, numRuns: runsFor({ fast: 20, full: 100 }), includeErrorInReport: true };
          // oxlint-disable-next-line fabrika/no-promises -- edge: fast-check's async property answers a Promise
          yield* Effect.promise(() => fc.assert(property, options));
          // An empty walk cannot pass: every case the law is about ran at least once.
          expect([...done].sort()).toEqual(
            expect.arrayContaining(
              [
                "refused",
                "waiting:new",
                "waiting:again",
                "waiting:moved",
                "waiting:unset",
                "finish",
                "finished",
                "finished:again",
                "change:set",
                "change:unset",
                "reopen",
              ].sort(),
            ),
          );
        }),
    );
    it.effect(
      "S2: an ask under a saved task's id from another process is refused id_reused in every state of the task, writes nothing, and reveals no receipt or result",
      () =>
        Effect.gen(function* () {
          // oxlint-disable-next-line fabrika/no-effect-run-outside-edge -- edge: fast-check's async property runs each case under the test's own services
          const runPromise = Effect.runPromiseWith(yield* Effect.context<never>());
          const done = new Set<string>();
          const law = foreign(open, done);
          // oxlint-disable-next-line fabrika/no-effect-run-outside-edge -- edge: fast-check awaits each tape
          const property = fc.asyncProperty(Foreign, (tape) => runPromise(Effect.scoped(law(tape))));
          const options = { seed: 119120, numRuns: runsFor({ fast: 20, full: 60 }), includeErrorInReport: true };
          // oxlint-disable-next-line fabrika/no-promises -- edge: fast-check's async property answers a Promise
          yield* Effect.promise(() => fc.assert(property, options));
          // An empty walk cannot pass: every state a task can be in when another process asks ran.
          expect([...done].sort()).toEqual([...STATES].sort());
        }),
    );
  });
