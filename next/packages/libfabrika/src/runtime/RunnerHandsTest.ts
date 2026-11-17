// P39 slice 3 (ticket 1040), next/: a program's `hands` Cmd becomes a saved task, and its result comes
// back as one answer letter. The laws, and no driver: a runner in the module that owns a driver calls
// `RunnerHandsTest.suite(open)`; `open` acquires real stores in a scope and gives them back when that
// scope closes (0061, 0062).
//
// The runner, mailbox, process table, checkpoint store, task store and the Project's `HandsTasksLive`
// are real. The hands are this file: they take, start and finish a task through `Tasks`, as slice 2's
// gateway methods do, and the gateway's wake after a finish is the runner's own `mailed`. Every cut
// lands at a reachable boundary, through a test layer around `HandsTasks` and a planted SQL fault:
//
//   hold           the Project holds one ask open while the same program is poked
//   lose_before    the ask fails before it reaches the Project
//   lose_after     the Project saved the request, or the collect, and the reply is lost
//   cut_checkpoint the reply came back and the runner's next checkpoint write fails
//   cut_letter     the answer letter is saved and the runner fails before it folds it
//   reopen         the host goes away and comes back on the same stores, with its saved alarms
//
// Each walk reads the world it has reached and picks a move possible there: a finish only for a task
// that is really waiting, a restart only once a Cmd is out. The oracle is this file's own record of
// the Cmds it saw dispatched, the tasks it finished and the letters it saw placed; it never calls the
// product's step function.
//
// The contract these laws pin, from the plan:
//   Hands.ts: `hands`, `Cmd.make("hands", { input: { command }, ok: Result, err: ["no_hands",
//   "id_reused"] })`.
//   HandsTasks.ts: `Ask`, `Reply`, `HandsTasksError`, `HandsTasks`; HandsTasksLive.ts: `layer`.
//   Runner.ts: a runner given `HandsTasks` performs `hands` itself, saves `waiting` on the dispatched
//   Cmd, owes it only while `pending`, and asks again on every wake or due.
//   Entry.ts: `hands` is built in, so `ProgramLoader` never gives a handler for it.
//
// Plants (after build): L12, give the request a fresh id on each retry, or answer `bad_cmd` after a
// lost reply; L13, give each delivery a fresh answer id; L14, route the answer by registered name
// alone; L20, hold the command permit while waiting; R1, drop the Cmd when `ask` answers finished,
// before the letter is placed; B1, take `hands` out of `BUILT_IN`.
//
// L21, added in the fix round: an `id_reused` refusal is the program's answer, never a retry. Its
// `foreign` cut saves another process's task under the Cmd's id through the real Project first.
// Plants: treat an id_reused refusal as a failed ask, as the build first did; keep an id_reused-refused
// delivery pending.
import { Machine } from "@demlik/tea/effect";
import { describe, expect, it } from "@effect/vitest";
import { type Runs, runsFor } from "@kampus/vitest";
import { Context, Deferred, Effect, Exit, Fiber, Layer, Option, Result, Schedule, Schema, Scope, Stream } from "effect";
import * as fc from "fast-check";
import { InputId, Writer } from "../coordination/index.ts";
import { type From, Mailbox } from "../processes/Mailbox.ts";
import { data as ledger, ids, PIDS } from "../processes/Process.test-support.ts";
import { Owner, Recipient, Start } from "../processes/Process.ts";
import { ProcessManager } from "../processes/ProcessManager.ts";
import type { Sql, SqlValue } from "../Sql.ts";
import { Command, type Task, Result as TaskResult } from "../tasks/Task.ts";
import { Tasks } from "../tasks/Tasks.ts";
import { choose, fcFingerprint, fcResult } from "../tasks/TasksTest.ts";
import { Alarm, CheckedWriter, type Incoming, ProgramLoader, Recording, WatcherManager } from "./Entry.ts";
import { hands } from "./Hands.ts";
import { HandsTasks, HandsTasksError } from "./HandsTasks.ts";
import * as HandsTasksLive from "./HandsTasksLive.ts";
import { ANY_CHUNK } from "./internal/chunk.test-support.ts";
import { ProcessStore } from "./ProcessStore.ts";
import { Program } from "./Program.ts";
import { ProgramRunner } from "./Runner.ts";

/** Real stores: `sql(part)` is one database per part, `reopen` closes and reopens every part, and
 *  `tasks(sql)` is the durable task store on that part, built by the module that owns the ledger. */
export type Store = {
  readonly sql: (part: string) => Sql;
  readonly reopen: Effect.Effect<void>;
  readonly tasks: (sql: Sql) => Layer.Layer<Tasks>;
};

const SEED = 119120;

const BUILD = "p39-build-a";

const PERSON = "person_01m6v5270hf3c8x2q7w9z4k5mn";

const TRACE = "4bf92f3577b34da6a3ce929d0e0e4736";

const SETTINGS = "5e771165a5e771165";

/** A call that does not answer in this long is held behind something it must never wait on. */
const LIMIT = "5 seconds";

const CHECK = "check:1";

/** A process this walk never runs: the one whose task is found under another Cmd's id. */
const FOREIGN = PIDS.at(-1) ?? "";

const OTHER = "other:1";

// ---------------------------------------------------------------------------------------------
// The program: it asks the hands on `ask`, counts `poke`, and keeps every answer it folds.

const Answer = Schema.Struct({ ok: Schema.optionalKey(TaskResult), err: Schema.optionalKey(Schema.String) });

const Model = Schema.Struct({ asked: Schema.Int, pokes: Schema.Int, answers: Schema.Array(Answer) });

type Model = typeof Model.Type;

const Msg = Schema.Union([
  Schema.Struct({ type: Schema.Literal("ask") }),
  Schema.Struct({ type: Schema.Literal("poke") }),
]);

const checkMachine = Machine.make({
  model: Model,
  msg: Msg,
  cmds: [hands],
  init: (loaded) => [loaded ?? { asked: 0, pokes: 0, answers: [] }, []],
  update: {
    ask: (s) => [{ ...s, asked: s.asked + 1 }, [hands({ command: Command.cases.git_version.make({}) })]],
    poke: (s) => [{ ...s, pokes: s.pokes + 1 }, []],
    hands_ok: (s, m) => [{ ...s, answers: [...s.answers, { ok: m.value }] }, []],
    hands_err: (s, m) => [{ ...s, answers: [...s.answers, { err: m.error._tag }] }, []],
  },
});

const checkProgram = Program.make({
  name: "fabrika/check",
  machine: checkMachine,
  state: { v: 1, upgrades: [] },
  view: (s) => s,
  refuse: () => null,
  inputs: { ask: "Ask the hands for git's version", poke: "Count one input" },
  outputs: {},
  writes: {},
  wake: () => null,
});

const PROGRAMS: Record<string, unknown> = { [checkProgram.name]: checkProgram };

const person = Writer.cases.person.make({ key: "SHA256:person", for: PERSON });

const owner = Writer.cases.agent.make({ key: "SHA256:owner", for: PERSON });

const decodeModel = Schema.decodeUnknownOption(Model);

const HandsLetter = Schema.Struct({
  type: Schema.Literals(["hands_ok", "hands_err"]),
  cmd: Schema.Struct({ type: Schema.Literal("hands"), command: Command }),
  value: Schema.optionalKey(TaskResult),
  reason: Schema.optionalKey(Schema.String),
});

const decodeLetter = Schema.decodeUnknownOption(HandsLetter);

const HandsCmd = Schema.Struct({ id: Schema.String, cmd: Schema.Struct({ type: Schema.Literal("hands") }) });

const isHandsCmd = Schema.is(HandsCmd);

const brainFrom = (): From => ({
  by: "SHA256:brain",
  for: "brain",
  sentAt: "2026-11-15T00:00:00Z",
  seen: 0,
  parent: null,
  traceId: TRACE,
  build: BUILD,
});

const inputId = (n: number) => `input_0000000000e008${n.toString(16).padStart(12, "0")}`;

const letter = (n: number, input: unknown): Incoming => ({
  id: `letter-${n}`,
  envelope: { id: Schema.decodeUnknownSync(InputId)(inputId(n)), by: person, arrivedAt: 1794099600000 + n, input },
  sentAt: "2026-11-15T01:00:00Z",
  seen: 0,
  span: { traceId: TRACE, spanId: "00f067aa0ba902b7" },
});

// ---------------------------------------------------------------------------------------------
// The world: what the walk knows from its own moves.

type Fault = {
  /** The next ask fails before it reaches the Project. */
  before: boolean;
  /** The next ask reaches the Project, and its reply is lost. */
  after: boolean;
  /** The next ask's reply comes back; the runner's next checkpoint write fails. */
  checkpoint: boolean;
  /** Armed by a reply: the process store refuses its next write. */
  checkpointArmed: boolean;
  /** The next answer letter is saved; the statement after it fails. */
  letter: boolean;
  letterArmed: boolean;
  /** The next ask finds a task another process saved under the Cmd's id first. */
  foreign: boolean;
};

/** One Cmd the walk saw dispatched, and the process generation that dispatched it. */
type Dispatched = {
  readonly id: string;
  readonly process: string;
  readonly name: string;
  /** The request as the task first saved it, once it was. */
  first?: string;
  /** The result the hands finished it with. */
  result?: TaskResult;
  /** Its process ended before the answer folded: a later life may never take it. */
  orphan: boolean;
  /** Its task was already collected when its process ended. */
  collectedAtEnd: boolean;
  /** Its answer letter was already placed when its process ended. */
  letterAtEnd: boolean;
  /**
   * A successor folded the letter that made it, which an earlier life stepped first: a replayed
   * letter's Cmds were the life before's, so this one is never asked (0230).
   */
  readonly replay: boolean;
};

type World = {
  readonly target: string | null;
  readonly fault: Fault;
  readonly alarms: Map<string, number>;
  readonly seen: Map<string, Dispatched>;
  /** Every ask the Project was given, by Cmd id. */
  readonly asked: Array<string>;
  /** The process that was current when each input letter was sent, by letter id. */
  readonly sentBy: Map<string, string>;
  readonly done: Set<string>;
  n: number;
  /** The next ask the Project holds open: it says it arrived, then waits for its release. */
  gate?: { readonly entered: Deferred.Deferred<void>; readonly release: Deferred.Deferred<void> } | undefined;
};

const strings = (params: ReadonlyArray<SqlValue>) => params.filter((p): p is string => typeof p === "string");

const WRITE = /^\s*(INSERT|UPDATE|REPLACE|DELETE)\b/i;

/** The ledger's Sql with the letter cut: the statement after a saved hands answer letter fails. */
const letterCut = (sql: Sql, world: World): Sql => {
  let inTurn = false;
  let placed = false;

  const fire = () => {
    world.fault.letterArmed = false;
    world.done.add("cut_letter:fired");
    throw new Error("SQLITE_IOERR planted after the answer letter");
  };

  return {
    exec: (query, ...params) => {
      if (world.fault.letterArmed) {
        fire();
      }

      const rows = sql.exec(query, ...params);
      const text = strings(params);

      if (
        world.fault.letter &&
        /^\s*INSERT\b/i.test(query) &&
        text.some((p) => p.endsWith("/answer")) &&
        text.some((p) => /"hands_(ok|err)"/.test(p))
      ) {
        world.fault.letter = false;
        placed = true;

        if (!inTurn) {
          placed = false;
          world.fault.letterArmed = true;
        }
      }

      return rows;
    },
    transaction: (step) => {
      inTurn = true;

      try {
        return sql.transaction(step);
      } finally {
        inTurn = false;

        if (placed) {
          placed = false;
          world.fault.letterArmed = true;
        }
      }
    },
    size: () => sql.size(),
  };
};

/** A process store's Sql with the checkpoint cut: its next write after an armed reply fails. */
const checkpointCut = (sql: Sql, world: World): Sql => ({
  exec: (query, ...params) => {
    if (world.fault.checkpointArmed && WRITE.test(query)) {
      world.fault.checkpointArmed = false;
      world.done.add("cut_checkpoint:fired");
      throw new Error("SQLITE_FULL planted at the checkpoint after a hands reply");
    }

    return sql.exec(query, ...params);
  },
  transaction: (step) => sql.transaction(step),
  size: () => sql.size(),
});

/**
 * One life of the whole host: the ledger, process table, mailbox, task store, the Project's hands
 * layer behind the cut layer, and one runner per name, all in `scope`. Closing the scope is the host
 * going away; the stores and the saved alarms keep their rows.
 */
const host = Effect.fnUntraced(function* (
  store: Store,
  world: World,
  names: ReadonlyArray<string>,
  next: Effect.Effect<string>,
  scope: Scope.Scope,
) {
  const data = ledger(letterCut(store.sql("ledger"), world));

  const manager = ProcessManager.layer(
    {
      by: "SHA256:brain",
      owner: Owner.cases.brain.make({}),
      recipient: Recipient.cases.client.make({ client: "brain", session: PIDS.at(-1) ?? "" }),
    },
    next,
  );

  const tasks = yield* Layer.buildWithScope(store.tasks(store.sql("tasks")), scope);

  const live = Context.get(
    yield* Layer.buildWithScope(
      HandsTasksLive.layer({ target: world.target, settings: SETTINGS }).pipe(
        Layer.provide(Layer.succeedContext(tasks)),
      ),
      scope,
    ),
    HandsTasks,
  );

  // The test layer around the Project's hands: it fails before or after it delegates.
  const cut = Layer.succeed(HandsTasks, {
    ask: (ask, from) =>
      Effect.gen(function* () {
        const gate = world.gate;

        if (gate !== undefined) {
          world.gate = undefined;
          yield* Deferred.succeed(gate.entered, undefined);
          yield* Deferred.await(gate.release);
        }

        if (world.fault.before) {
          world.fault.before = false;
          world.done.add("lose_before:fired");

          return yield* new HandsTasksError({ reason: "unavailable" });
        }

        if (world.fault.foreign) {
          // Another process's task is saved under this Cmd's id first, through the real Project.
          world.fault.foreign = false;
          yield* live.ask({ ...ask, process: FOREIGN }, from);
          world.done.add("foreign:saved");
        }

        world.asked.push(ask.id);
        const reply = yield* live.ask(ask, from);

        if (world.fault.after) {
          world.fault.after = false;
          world.done.add(`lose_after:${reply._tag}`);

          return yield* new HandsTasksError({ reason: "unavailable" });
        }

        if (world.fault.checkpoint) {
          world.fault.checkpoint = false;
          world.fault.checkpointArmed = true;
          world.done.add(`cut_checkpoint:${reply._tag}`);
        }

        return reply;
      }),
  });

  const shared = manager.pipe(Layer.provideMerge(Mailbox.layer), Layer.provideMerge(data));
  const context = Context.merge(yield* Layer.buildWithScope(shared, scope), tasks);

  const boot = Effect.fnUntraced(function* (name: string) {
    const status = yield* ProcessManager.use((p) => p.status(name)).pipe(Effect.result);

    if (Result.isSuccess(status)) {
      return status.success.state.process;
    }

    const started = yield* ProcessManager.use((p) =>
      p.start(
        Start.cases.first.make({ id: `boot:${name}`, name, code: { program: checkProgram.name, hash: BUILD } }),
        brainFrom(),
      ),
    ).pipe(Effect.orDie);

    return started.process;
  });

  const runners = new Map<string, ProgramRunner["Service"]>();

  for (const name of names) {
    const pid = yield* boot(name).pipe(Effect.provide(context));

    const checked = Layer.effect(
      CheckedWriter,
      Effect.gen(function* () {
        const mailbox = yield* Mailbox;

        return {
          append: (i: Incoming) =>
            mailbox.send(name, i.id, i.envelope.input, {
              by: i.envelope.by.key,
              for: i.envelope.by.for,
              sentAt: i.sentAt,
              seen: i.seen,
              parent: i.envelope.id,
              traceId: i.span.traceId,
              build: BUILD,
            }),
          commit: () => Effect.die("no write declared"),
          own: () => Effect.die("no write declared"),
        };
      }),
    );

    const own = Layer.mergeAll(
      ProgramLoader.layer(PROGRAMS, {}),
      ProcessStore.layer(checkpointCut(store.sql(`process-${name}`), world), { process: pid }),
      Layer.succeed(Alarm, {
        set: (at: number | null) =>
          Effect.sync(() => {
            if (at === null) {
              world.alarms.delete(name);
            } else {
              world.alarms.set(name, at);
            }
          }),
      }),
      Layer.succeed(WatcherManager, { publish: () => Effect.void }),
      Layer.succeed(Recording, { flush: Effect.void }),
      cut,
      checked,
    ).pipe(Layer.provideMerge(Layer.succeedContext(context)));

    const runner = ProgramRunner.layer(
      { id: pid, name, program: checkProgram.name, build: BUILD, owner },
      { recovery: { sql: store.sql(`recovery-${name}`), name, capacity: 1024 ** 3 }, chunk: ANY_CHUNK },
    ).pipe(Layer.provide(own));

    runners.set(name, Context.get(yield* Layer.buildWithScope(runner, scope), ProgramRunner));
  }

  return { context, runners };
});

/** A call that may fail at a planted cut; it must still answer, never hang. */
const answers = <A, E>(effect: Effect.Effect<A, E>, label: string) =>
  effect.pipe(
    Effect.result,
    Effect.timeoutOption(LIMIT),
    Effect.map((answer) => {
      expect(Option.isSome(answer), `${label} answers: nothing holds it behind a task`).toBe(true);

      return Option.getOrThrow(answer);
    }),
  );

type Move =
  | "ask"
  | "poke"
  | "finish"
  | "repeat_finish"
  | "wake"
  | "due"
  | "hold"
  | "lose_before"
  | "lose_after"
  | "cut_checkpoint"
  | "cut_letter"
  | "reopen"
  | "restart"
  | "steal"
  | "forge";

const Cell = fc.record({ move: fc.nat(), pick: fc.nat(), result: fcResult, other: fcResult });

type Cell = typeof Cell extends fc.Arbitrary<infer A> ? A : never;

/**
 * Folds one tape through real runners for `names`. Each cell reads the world the fold has reached
 * and picks a move possible there; the invariants hold after every move, and once every fault is
 * cleared, every finished task woken and every saved alarm fired, each Cmd has the end the oracle
 * gives it.
 */
const walk = (
  open: Effect.Effect<Store, never, Scope.Scope>,
  names: ReadonlyArray<string>,
  moves: ReadonlyArray<Move>,
  done: Set<string>,
) =>
  Effect.fnUntraced(function* (tape: { readonly target: string | null; readonly cells: ReadonlyArray<Cell> }) {
    const store = yield* open;
    const next = ids(...PIDS);

    const world: World = {
      target: tape.target,
      fault: {
        before: false,
        after: false,
        checkpoint: false,
        checkpointArmed: false,
        letter: false,
        letterArmed: false,
        foreign: false,
      },
      alarms: new Map(),
      seen: new Map(),
      asked: [],
      sentBy: new Map(),
      done,
      n: 0,
    };

    let scope = yield* Scope.make();
    let life = yield* host(store, world, names, next.next, scope);
    yield* Effect.addFinalizer(() => Scope.close(scope, Exit.void));
    const inContext = <A, E, R>(effect: Effect.Effect<A, E, R>) => effect.pipe(Effect.provide(life.context));
    const runner = (name: string) => life.runners.get(name) ?? expect.fail(`no runner for ${name}`);

    const liveProcess = (name: string) =>
      inContext(
        Effect.map(
          ProcessManager.use((p) => p.status(name)),
          (s) => s.state.process,
        ),
      );

    /** A name's saved checkpoint, read from its store without going through its runner. */
    const checkpoint = Effect.fnUntraced(function* (name: string) {
      const process = yield* liveProcess(name);

      return yield* ProcessStore.use((s) => s.load).pipe(
        Effect.provide(ProcessStore.layer(store.sql(`process-${name}`), { process })),
        Effect.provide(life.context),
      );
    });

    const model = (name: string) =>
      Effect.map(checkpoint(name), (saved) => Option.getOrNull(decodeModel(saved?.saved.model ?? null)));

    const dispatched = (name: string) =>
      Effect.map(checkpoint(name), (saved) => (saved?.cmds ?? []).flatMap((c) => (isHandsCmd(c) ? [c.id] : [])));

    const letters = (name: string) => inContext(Mailbox.use((m) => Stream.runCollect(m.read(name, 0))));
    const task = (id: string) => inContext(Tasks.use((j) => j.read(id)).pipe(Effect.result));

    /** What the hands say about each of their calls. */
    const said = (cell: Cell): Parameters<Tasks["Service"]["take"]>[2] => ({
      by: world.target ?? "SHA256:none",
      for: PERSON,
      sentAt: "2026-11-15T02:00:00Z",
      seen: 0,
      parent: null,
      traceId: TRACE,
      build: `hands-${cell.pick % 3}`,
    });

    /**
     * The Cmds the walk has seen: each one dispatched in a name's checkpoint, and each one an answer
     * letter in its inbox names (a refusal is answered in the same call, so no checkpoint shows it).
     * A Cmd's id is `<process>/<pos>/<index>`, so it names the process that dispatched it.
     */
    const register = Effect.fnUntraced(function* () {
      for (const name of names) {
        const inbox = yield* letters(name);
        const answered = inbox.flatMap((l) => (l.id.endsWith("/answer") ? [l.id.slice(0, -7)] : []));

        for (const id of [...(yield* dispatched(name)), ...answered]) {
          if (!world.seen.has(id)) {
            const [process = "", pos = ""] = id.split("/");
            const made = inbox.find((l) => l.pos === Number(pos));
            const replay = made !== undefined && world.sentBy.has(made.id) && world.sentBy.get(made.id) !== process;
            world.seen.set(id, { id, process, name, orphan: false, collectedAtEnd: false, letterAtEnd: false, replay });
          }
        }
      }
    });

    const phase = Effect.fnUntraced(function* (id: string) {
      const found = yield* task(id);

      return Result.isSuccess(found) ? found.success.state._tag : "absent";
    });

    /** Fires every saved alarm until none is left, at most `rounds` times. */
    const settle = Effect.fnUntraced(function* (rounds: number) {
      for (let round = 0; round < rounds && world.alarms.size > 0; round++) {
        for (const [name, at] of [...world.alarms]) {
          world.alarms.delete(name);
          yield* answers(runner(name).due(at), `${name}'s alarm`);
          yield* register();
        }
      }
    });

    /** The invariants every prefix keeps. */
    const check = Effect.fnUntraced(function* (label: string) {
      for (const name of names) {
        const current = yield* liveProcess(name);
        const saved = yield* checkpoint(name);
        const owed = new Set(yield* dispatched(name));
        const all = yield* letters(name);
        const folded = all.filter((l) => l.rev <= (saved?.saved.after ?? 0));
        const mine = [...world.seen.values()].filter((d) => d.name === name);
        const m = yield* model(name);

        for (const d of mine) {
          const placed = all.filter((l) => l.id === `${d.id}/answer`);
          // L13: one answer letter per Cmd, however often it was asked, woken or finished.
          expect(placed.length, `${label}: L13 one answer letter for ${d.id}`).toBeLessThanOrEqual(1);
          const found = yield* task(d.id);

          if (Result.isSuccess(found)) {
            const j: Task = found.success;
            // L12: one task under the Cmd's own id, its request saved once, with its first bytes.
            expect(
              j.events.filter((e) => e.event === "requested"),
              `${label}: L12 one request for ${d.id}`,
            ).toHaveLength(1);
            const request = j.state._tag === "absent" ? expect.fail("a read task has a state") : j.state.request;
            expect(request.id, `${label}: L12 the task's id is the Cmd's`).toBe(d.id);
            expect(request.process, `${label}: L12 the task names the process that asked`).toBe(d.process);
            expect(request.target, `${label}: S1 the task targets the person's hands key`).toBe(world.target);
            d.first ??= JSON.stringify(request);
            expect(JSON.stringify(request), `${label}: L12 the request keeps its first bytes`).toBe(d.first);
            expect(j.events.filter((e) => e.event === "collected").length, `${label}: one collect`).toBeLessThanOrEqual(
              1,
            );

            if (j.state._tag === "collected") {
              // L14: only the process that asked ever takes the result.
              expect(j.state.collection, `${label}: L14 the asking process collected ${d.id}`).toEqual({
                process: d.process,
                letter: `${d.id}/answer`,
              });
            }

            if (d.orphan && !d.collectedAtEnd) {
              // L14: an ended process's result stays saved, and no successor takes it.
              expect(j.state._tag, `${label}: L14 an ended process's task is never collected`).not.toBe("collected");
            }
          }

          if (d.orphan && !d.letterAtEnd) {
            // L14: the successor's inbox stays as if the ended process's task never existed.
            expect(placed, `${label}: L14 no answer letter for an ended process's Cmd`).toEqual([]);
          }

          if (d.process !== current || d.replay) {
            continue;
          }

          const answered = folded.some((l) => l.id === `${d.id}/answer`);

          if (owed.has(d.id)) {
            // R1: until its answer letter folds, the task keeps its result and the Cmd stays dispatched.
            expect(answered, `${label}: R1 a folded answer leaves the dispatched Cmds`).toBe(false);
            const state = yield* phase(d.id);

            if (d.result !== undefined) {
              expect(["finished", "collected"], `${label}: R1 a finished task keeps its result`).toContain(state);

              if (state === "finished" || state === "collected") {
                done.add("R1:result_kept");
              }
            }
          } else if (world.target !== null) {
            // R1: once the Cmd is gone, its answer folded and its task is collected by this process.
            expect(answered, `${label}: R1 a Cmd leaves only once its answer folded (${d.id})`).toBe(true);
            expect(yield* phase(d.id), `${label}: R1 a delivered task is collected`).toBe("collected");
          }
        }

        // L13 and L14: the program folded one answer per folded answer letter of its own life, in order,
        // each the task's result. A Cmd's id names its process, so a letter for another life's Cmd,
        // placed before or after this life started, never reaches this model.
        const delivered = folded.flatMap((l) =>
          l.id.startsWith(`${current}/`) && l.id.endsWith("/answer")
            ? Option.toArray(Option.map(decodeLetter(l.m), (body) => ({ id: l.id, body })))
            : [],
        );

        const expected = delivered.map(({ body }) =>
          body.type === "hands_ok" ? { ok: body.value } : { err: body.reason },
        );

        expect(m?.answers ?? [], `${label}: L13/L14 ${name} folded exactly its own answers, once each`).toEqual(
          expected,
        );

        for (const { id, body } of delivered) {
          const d = world.seen.get(id.slice(0, -"/answer".length));

          if (body.type === "hands_ok") {
            // The letter carries the typed result the hands saved, and the Cmd it answers.
            expect(body.value, `${label}: the answer is the task's result`).toEqual(d?.result);
            expect(body.cmd.command, `${label}: the answer echoes its Cmd`).toEqual(Command.cases.git_version.make({}));
            done.add("delivered");
          } else {
            expect(world.target, `${label}: S1 only an unset hands.target refuses`).toBeNull();
            expect(body.reason, `${label}: S1 the refusal is no_hands`).toBe("no_hands");
            done.add("refused");
          }
        }
      }
    });

    const reopen = Effect.fnUntraced(function* () {
      yield* Scope.close(scope, Exit.void);
      yield* store.reopen;
      scope = yield* Scope.make();
      life = yield* host(store, world, names, next.next, scope);
    });

    for (const cell of tape.cells) {
      const name = choose(names, cell.pick);
      const current = yield* liveProcess(name);
      const out = [...world.seen.values()].filter((d) => d.process === current && d.name === name);
      const phases = new Map<string, string>();

      for (const d of out) {
        phases.set(d.id, yield* phase(d.id));
      }

      for (const d of world.seen.values()) {
        if (!phases.has(d.id)) {
          phases.set(d.id, yield* phase(d.id));
        }
      }

      // A task really waiting on the hands, whoever asked for it: an ended process's task too.
      const waiting = [...world.seen.values()].filter((d) => phases.get(d.id) === "requested");
      const finished = [...world.seen.values()].filter((d) => d.result !== undefined);

      const can: Record<Move, boolean> = {
        ask: true,
        poke: true,
        finish: waiting.length > 0,
        repeat_finish: finished.length > 0,
        wake: true,
        hold: true,
        due: world.alarms.size > 0,
        lose_before: !world.fault.before,
        lose_after: !world.fault.after,
        cut_checkpoint: !world.fault.checkpoint,
        cut_letter: !world.fault.letter,
        reopen: true,
        restart: out.length > 0,
        steal: [...world.seen.values()].some((d) => d.orphan && d.result !== undefined),
        forge: true,
      };

      const options = moves.filter((move) => can[move]);

      if (options.length === 0) {
        continue;
      }

      const move = choose(options, cell.move);
      done.add(move);

      switch (move) {
        case "ask":
        case "poke": {
          const before = (yield* model(name))?.pokes ?? 0;
          world.sentBy.set(`letter-${++world.n}`, current);
          const sent = yield* answers(runner(name).msg(letter(world.n, { type: move })), `${name}'s ${move}`);

          if (move === "poke" && Result.isSuccess(sent) && sent.success._tag === "accepted") {
            // L20: a later input steps, whatever hands work this program or another has out.
            expect((yield* model(name))?.pokes, "L20: the poke stepped").toBe(before + 1);
            done.add(world.seen.size > 0 ? "poke:while_out" : "poke");
          }

          break;
        }

        case "finish": {
          // The hands the person chose take, start and finish one task that is really waiting.
          const d = choose(waiting, cell.pick);
          const by = said(cell);
          const executor = { key: world.target ?? "", connection: `hands-${world.n}`, has: ["git"], build: by.build };
          const taken = yield* inContext(Tasks.use((j) => j.take(d.id, executor, by)));
          yield* inContext(Tasks.use((j) => j.started(d.id, taken.execution, by)));
          yield* inContext(Tasks.use((j) => j.finish(d.id, taken.execution, cell.result, by)));
          d.result = cell.result;
          done.add(d.orphan ? "orphan_finished" : "finished");

          // The gateway's wake after a finish, unless this cell plays a finish whose wake never came.
          if (cell.pick % 4 !== 0) {
            yield* answers(runner(d.name).mailed, `${d.name}'s wake`);
          }

          break;
        }

        case "repeat_finish": {
          // The hands lost the finish's answer and send it again: it repeats, and the gateway wakes again.
          const d = choose(finished, cell.pick);
          const saved = yield* task(d.id);
          const state = Result.isSuccess(saved) ? saved.success.state : null;

          if (state !== null && state._tag !== "absent" && state._tag !== "requested") {
            const by = said(cell);
            yield* inContext(Tasks.use((j) => j.finish(d.id, state.assignment.execution, d.result ?? cell.result, by)));
            yield* answers(runner(d.name).mailed, `${d.name}'s repeated wake`);
            done.add((yield* dispatched(d.name)).includes(d.id) ? "repeat_finish:out" : "duplicate_wake");
          }

          break;
        }

        case "wake":
          yield* answers(runner(name).mailed, `${name}'s wake`);
          break;
        case "due": {
          const [alarmed, at] = choose([...world.alarms], cell.pick);
          world.alarms.delete(alarmed);
          yield* answers(runner(alarmed).due(at), `${alarmed}'s alarm`);
          break;
        }

        case "hold": {
          // L20: the Project holds an ask open, and a poke to the same program steps meanwhile.
          const gate = { entered: yield* Deferred.make<void>(), release: yield* Deferred.make<void>() };
          world.gate = gate;
          world.sentBy.set(`letter-${++world.n}`, current);
          const held = yield* Effect.forkChild(runner(name).msg(letter(world.n, { type: "ask" })));
          const entered = yield* Deferred.await(gate.entered).pipe(Effect.timeoutOption(LIMIT));
          world.gate = undefined;

          if (Option.isSome(entered)) {
            const before = (yield* model(name))?.pokes ?? 0;
            world.sentBy.set(`letter-${++world.n}`, current);
            const poke = yield* Effect.forkChild(runner(name).msg(letter(world.n, { type: "poke" })));

            const stepped = yield* model(name).pipe(
              Effect.repeat({ schedule: Schedule.spaced("5 millis"), until: (m) => (m?.pokes ?? 0) > before }),
              Effect.timeoutOption(LIMIT),
            );

            yield* Deferred.succeed(gate.release, undefined);
            expect(Option.isSome(stepped), "L20: a poke steps while the Project holds an ask open").toBe(true);
            yield* answers(Fiber.join(poke), `${name}'s poke beside a held ask`);
            done.add("hold:poke_stepped");
          } else {
            yield* Deferred.succeed(gate.release, undefined);
          }

          yield* answers(Fiber.join(held), `${name}'s held ask`);
          break;
        }

        case "lose_before":
          world.fault.before = true;
          break;
        case "lose_after":
          world.fault.after = true;
          break;
        case "cut_checkpoint":
          world.fault.checkpoint = true;
          break;
        case "cut_letter":
          world.fault.letter = true;
          break;
        case "reopen":
          yield* reopen();
          break;
        case "restart": {
          // A successor starts under the same name: every Cmd its predecessor had out is now an orphan.
          const inbox = yield* letters(name);

          for (const d of out) {
            d.orphan = true;
            d.collectedAtEnd = (yield* phase(d.id)) === "collected";
            d.letterAtEnd = inbox.some((l) => l.id === `${d.id}/answer`);
          }

          yield* answers(runner(name).restart({ id: `restart-${++world.n}`, build: BUILD }), `${name}'s restart`);
          expect(yield* liveProcess(name), "a restart is a new process").not.toBe(current);
          break;
        }

        case "steal": {
          // L14: the successor of an ended process may never collect that process's result.
          const d = choose(
            [...world.seen.values()].filter((x) => x.orphan && x.result !== undefined),
            cell.pick,
          );

          const successor = yield* liveProcess(d.name);

          const stolen = yield* inContext(
            Tasks.use((j) => j.collected(d.id, { process: successor, letter: `${d.id}/answer` }, said(cell))),
          ).pipe(Effect.result);

          expect(Result.isFailure(stolen) && stolen.failure.reason, "L14: a collect by the successor is refused").toBe(
            "wrong_process",
          );
          break;
        }

        case "forge": {
          // B1: a client sends what only the runner makes, an answer to a hands Cmd, as an input.
          const cmd = { type: "hands", command: Command.cases.git_version.make({}) };

          const body =
            cell.pick % 2 === 0
              ? { type: "hands_ok", cmd, value: Schema.encodeSync(TaskResult)(cell.other), at: 0 }
              : {
                  type: "hands_err",
                  cmd,
                  error: Schema.TaggedStruct("no_hands", {}).make({}),
                  reason: "no_hands",
                  at: 0,
                };

          const before = yield* model(name);
          const sent = yield* answers(runner(name).msg(letter(++world.n, body)), `${name}'s forged ${body.type}`);
          expect(Result.isSuccess(sent) && sent.success._tag, "B1: a forged hands answer is refused").toBe("refused");
          expect(yield* model(name), "B1: a forged hands answer changes nothing").toEqual(before);
          done.add(`forge:${body.type}`);
          break;
        }
      }

      // A cut a move armed and nobody met stays for the next move, except the letter's armed half:
      // it belongs to the call that placed the letter.
      world.fault.letterArmed = false;
      world.fault.checkpointArmed = false;
      yield* register();
      yield* check(`after ${move}`);
    }

    // Every fault cleared: saved work resumes from its saved alarms and the gateway's wakes alone.
    world.fault.before = false;
    world.fault.after = false;
    world.fault.checkpoint = false;
    world.fault.letter = false;

    for (let round = 0; round < 3; round++) {
      for (const name of names) {
        yield* answers(runner(name).mailed, `${name}'s last wake`);
      }

      yield* settle(32);
    }

    yield* check("at the end");

    for (const name of names) {
      const current = yield* liveProcess(name);
      const owed = new Set(yield* dispatched(name));

      for (const d of [...world.seen.values()].filter((x) => x.name === name && x.process === current && !x.replay)) {
        const state = yield* phase(d.id);

        if (world.target === null) {
          expect(state, "S1: an unset hands.target writes no task").toBe("absent");
          expect(owed.has(d.id), "S1: a refused Cmd is answered").toBe(false);
        } else if (d.result === undefined) {
          // L12: a lost reply was asked again under the same id; the task waits, and so does its Cmd.
          expect(state, `L12: ${d.id} reached the Project once the faults cleared`).not.toBe("absent");
          expect(owed.has(d.id), `L12: a waiting task's Cmd stays dispatched`).toBe(true);
        } else {
          expect(owed.has(d.id), `L13: a finished task's answer folded (${d.id})`).toBe(false);
          expect(state, "R1: a delivered task is collected").toBe("collected");
        }
      }

      // L20 and D1: a task that only waits is not owed, so no backoff alarm is left behind.
      expect(world.alarms.has(name), `${name}: nothing waiting on the hands keeps an alarm`).toBe(false);
    }
  });

/** What a program does after its ask was refused for good: more inputs, wakes and alarms. */
const After = fc.array(fc.constantFrom("poke" as const, "wake" as const, "due" as const), {
  minLength: 1,
  maxLength: 6,
});

/**
 * L21: a refusal for good is an answer. The real Project finds another process's task under the
 * Cmd's id and refuses `id_reused`; the program folds one `hands_err`, and the Cmd is never asked or
 * retried again, whatever wakes, alarms and inputs come after.
 */
const refusedForGood = (open: Effect.Effect<Store, never, Scope.Scope>, done: Set<string>) =>
  Effect.fnUntraced(function* (tape: {
    readonly target: string;
    readonly after: ReadonlyArray<"poke" | "wake" | "due">;
  }) {
    const store = yield* open;

    const world: World = {
      target: tape.target,
      fault: {
        before: false,
        after: false,
        checkpoint: false,
        checkpointArmed: false,
        letter: false,
        letterArmed: false,
        foreign: true,
      },
      alarms: new Map(),
      seen: new Map(),
      asked: [],
      sentBy: new Map(),
      done,
      n: 0,
    };

    const scope = yield* Scope.make();
    yield* Effect.addFinalizer(() => Scope.close(scope, Exit.void));
    const life = yield* host(store, world, [CHECK], ids(...PIDS).next, scope);
    const runner = life.runners.get(CHECK) ?? expect.fail("no runner");
    const inContext = <A, E, R>(effect: Effect.Effect<A, E, R>) => effect.pipe(Effect.provide(life.context));

    const process = yield* inContext(
      ProcessManager.use((p) => p.status(CHECK)).pipe(Effect.map((s) => s.state.process)),
    );

    const saved = () =>
      ProcessStore.use((p) => p.load).pipe(
        Effect.provide(ProcessStore.layer(store.sql(`process-${CHECK}`), { process })),
        Effect.provide(life.context),
      );

    yield* answers(runner.msg(letter(++world.n, { type: "ask" })), "the ask");
    const id = world.asked[0] ?? expect.fail("L21: the program's hands Cmd reached the Project");
    const foreign = yield* inContext(Tasks.use((j) => j.read(id)));

    for (const move of tape.after) {
      if (move === "poke") {
        yield* answers(runner.msg(letter(++world.n, { type: "poke" })), "a later poke");
      } else if (move === "wake") {
        yield* answers(runner.mailed, "a wake");
      } else {
        // A saved alarm fires, or, with none, a stray one: a due asks every Cmd still dispatched.
        const at = world.alarms.get(CHECK) ?? 1794099600000;
        world.alarms.delete(CHECK);
        yield* answers(runner.due(at), "a due");
      }

      done.add(move);
    }

    // A wake sets the alarm to now; firing every saved alarm must leave none behind.
    for (let round = 0; round < 8 && world.alarms.has(CHECK); round++) {
      const at = world.alarms.get(CHECK) ?? 0;
      world.alarms.delete(CHECK);
      yield* answers(runner.due(at), "a saved alarm");
    }

    const checkpoint = yield* saved();
    const m = Option.getOrNull(decodeModel(checkpoint?.saved.model ?? null));
    expect(m?.answers, "L21: the program folds one hands_err id_reused").toEqual([{ err: "id_reused" }]);
    expect(m?.pokes, "L21: every later input steps").toBe(tape.after.filter((a) => a === "poke").length);
    expect(
      (checkpoint?.cmds ?? []).filter((c) => isHandsCmd(c)),
      "L21: the refused Cmd is no longer dispatched",
    ).toEqual([]);
    expect(world.alarms.has(CHECK), "L21: nothing keeps an alarm for a refused Cmd").toBe(false);
    expect(world.asked, "L21: the refused Cmd is never asked again").toEqual([id]);
    const inbox = yield* inContext(Mailbox.use((mb) => Stream.runCollect(mb.read(CHECK, 0))));
    const placed = inbox.filter((l) => l.id === `${id}/answer`).map((l) => Option.getOrNull(decodeLetter(l.m)));
    expect(
      placed.map((l) => [l?.type, l?.reason]),
      "L21: one answer letter, hands_err id_reused",
    ).toEqual([["hands_err", "id_reused"]]);
    expect(yield* inContext(Tasks.use((j) => j.read(id))), "L21: the other process's task is left as it was").toEqual(
      foreign,
    );
    expect(foreign.state._tag !== "absent" && foreign.state.request.process, "the task is the other process's").toBe(
      FOREIGN,
    );
  });

const Tape = (target: fc.Arbitrary<string | null>) =>
  fc.record({ target, cells: fc.array(Cell, { minLength: 8, maxLength: 30, size: "max" }) });

const prop = (
  name: string,
  open: Effect.Effect<Store, never, Scope.Scope>,
  options: {
    readonly names: ReadonlyArray<string>;
    readonly moves: ReadonlyArray<Move>;
    readonly required: ReadonlyArray<string>;
    readonly runs: Runs;
    readonly target?: fc.Arbitrary<string | null>;
  },
) =>
  it.effect(name, () =>
    Effect.gen(function* () {
      const done = new Set<string>();
      const law = walk(open, options.names, options.moves, done);
      const tapes = Tape(options.target ?? fcFingerprint);
      // oxlint-disable-next-line fabrika/no-effect-run-outside-edge -- edge: fast-check awaits each tape
      const property = fc.asyncProperty(tapes, (tape) => Effect.runPromise(Effect.scoped(law(tape))));
      const check = { seed: SEED, numRuns: runsFor(options.runs), includeErrorInReport: true };
      // oxlint-disable-next-line fabrika/no-promises -- edge: fast-check's async property answers a Promise
      yield* Effect.promise(() => fc.assert(property, check));
      // An empty walk cannot pass: every move and every cut the law is about happened at least once.
      expect([...done].sort()).toEqual(expect.arrayContaining([...options.required].sort()));
    }),
  );

export const suite = (open: Effect.Effect<Store, never, Scope.Scope>) =>
  describe("P39 slice 3: a program's hands Cmd becomes a saved task, and its result one answer", () => {
    prop(
      "L12: request submission survives each runner-to-project cut: one task under the Cmd id, with its first bytes, and the Cmd stays dispatched until answered",
      open,
      {
        names: [CHECK],
        moves: ["ask", "finish", "wake", "due", "lose_before", "lose_after", "cut_checkpoint", "cut_letter", "reopen"],
        required: [
          "lose_before:fired",
          "lose_after:waiting",
          "lose_after:finished",
          "cut_checkpoint:waiting",
          "cut_letter:fired",
          "reopen",
          "delivered",
        ],
        runs: { fast: 30, full: 100 },
      },
    );
    prop(
      "L13: one saved result produces one program answer, through duplicate wakes, dues, lost ask replies, lost letter replies and repeated finishes",
      open,
      {
        names: [CHECK],
        moves: ["ask", "finish", "repeat_finish", "wake", "due", "lose_after", "cut_letter", "reopen"],
        required: [
          "wake",
          "due",
          "repeat_finish:out",
          "duplicate_wake",
          "lose_after:finished",
          "cut_letter:fired",
          "delivered",
        ],
        runs: { fast: 30, full: 100 },
      },
    );
    prop(
      "L14: an old process's result never changes its successor: its model and inbox stay as if the task never existed, the task stays finished, and a collected by the successor is refused",
      open,
      {
        names: [CHECK],
        moves: ["ask", "finish", "wake", "due", "restart", "steal", "lose_before", "lose_after"],
        required: ["restart", "orphan_finished", "steal", "delivered"],
        runs: { fast: 30, full: 100 },
      },
    );
    prop(
      "L20: failed or waiting work in one program leaves another responsive, and leaves the same program's later inputs responsive",
      open,
      {
        names: [CHECK, OTHER],
        moves: ["ask", "poke", "finish", "wake", "due", "hold", "lose_before"],
        required: ["poke:while_out", "hold:poke_stepped", "lose_before:fired", "delivered", "refused"],
        runs: { fast: 30, full: 60 },
        target: fc.option(fcFingerprint, { nil: null, freq: 3 }),
      },
    );
    prop(
      "R1: the result stays until delivery is confirmed: until the answer folds the task keeps its result and the Cmd stays dispatched; after the fold the Cmd is gone and the task is collected by its process",
      open,
      {
        names: [CHECK],
        moves: ["ask", "finish", "wake", "due", "cut_letter", "lose_after", "cut_checkpoint", "reopen"],
        required: ["R1:result_kept", "cut_letter:fired", "lose_after:finished", "delivered"],
        runs: { fast: 30, full: 100 },
      },
    );
    it.effect(
      "L21: a hands Cmd whose id holds another process's task is answered hands_err id_reused once, and is never asked or retried again",
      () =>
        Effect.gen(function* () {
          const done = new Set<string>();
          const law = refusedForGood(open, done);
          const tapes = fc.record({ target: fcFingerprint, after: After });
          // oxlint-disable-next-line fabrika/no-effect-run-outside-edge -- edge: fast-check awaits each tape
          const property = fc.asyncProperty(tapes, (tape) => Effect.runPromise(Effect.scoped(law(tape))));
          const check = { seed: SEED, numRuns: runsFor({ fast: 15, full: 40 }), includeErrorInReport: true };
          // oxlint-disable-next-line fabrika/no-promises -- edge: fast-check's async property answers a Promise
          yield* Effect.promise(() => fc.assert(property, check));
          // An empty walk cannot pass: the foreign task was really found, and every later move ran.
          expect([...done].sort()).toEqual(["due", "foreign:saved", "poke", "wake"]);
        }),
    );

    prop("B1: a forged hands answer through a client input is refused and never steps the program", open, {
      names: [CHECK],
      moves: ["ask", "forge", "finish", "wake", "due"],
      required: ["forge:hands_ok", "forge:hands_err", "delivered"],
      runs: { fast: 30, full: 60 },
    });
    it.effect("B1: ProgramLoader gives no handler for hands, whatever handlers a host offers", () =>
      Effect.gen(function* () {
        const reached = new Set<string>();

        const law = Effect.fnUntraced(function* (names: ReadonlyArray<string>) {
          // A handler offered under each name, `hands` among them: a built-in Cmd's is never given.
          const offered = Object.fromEntries(
            [...names, "hands"].map((cmd) => [cmd, () => Effect.die(`B1: the ${cmd} handler ran`)]),
          );

          const loaded = yield* ProgramLoader.use((l) => l.load(checkProgram.name)).pipe(
            Effect.provide(ProgramLoader.layer(PROGRAMS, offered)),
            Effect.orDie,
          );

          expect(loaded.declaration.cmds, "the program declares hands").toContain("hands");
          expect(Option.isNone(loaded.handler("hands")), "B1: the loader gives no handler for hands").toBe(true);
          reached.add("hands");

          // The loader still gives an ordinary Cmd its handler: the refusal is for built-in Cmds only.
          for (const cmd of names.filter((c) => c !== "hands" && c !== "send" && c !== "fire")) {
            expect(Option.isSome(loaded.handler(cmd)), `an ordinary Cmd, ${cmd}, keeps its handler`).toBe(true);
            reached.add("ordinary");
          }
        });

        const offers = fc.uniqueArray(fc.constantFrom("hands", "send", "write", "fire", "git", "exit"), {
          maxLength: 5,
        });

        // oxlint-disable-next-line fabrika/no-effect-run-outside-edge -- edge: fast-check awaits each case
        const property = fc.asyncProperty(offers, (names) => Effect.runPromise(law(names)));
        // oxlint-disable-next-line fabrika/no-promises -- edge: fast-check's async property answers a Promise
        yield* Effect.promise(() => fc.assert(property, { seed: SEED, numRuns: 60 }));
        expect([...reached].sort()).toEqual(["hands", "ordinary"]);
      }),
    );
  });
