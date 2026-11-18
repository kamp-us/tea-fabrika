// P42 slice 1, next/ (ticket 770): the built-in `start_child` and `exit` Cmds on real runners, laws
// L5 to L8, L11 and L13, and no driver. A runner in the module that owns a driver calls
// `StartChildTest.suite(open)`; `open` acquires real stores in a scope and gives them back when that
// scope closes (0061, 0062).
//
// The runner, ledger, process table, mailbox, program mail, start piece and test program are real.
// The contract these laws pin, from the approved plan's Files table:
//   StartChild.ts: `StartChildInput` ({program, name, input?}), `startChild`, `Cmd.make("start_child",
//     ...)` whose `ok` is `Started`, and `exit`, `Cmd.make("exit", ...)` with an empty strict input.
//   Runner.ts: a runner whose context holds `Children` performs both itself. `start_child` decodes
//     strictly (`bad_cmd`), resolves the program through its loader (`no_program`), then calls
//     `Children.start` with the Cmd's id and the running life as requester. `exit` writes `exited
//     {reason: normal}` for this life after the Cmds listed before it; none after it runs.
// The oracle is the walk's own model and the store's raw rows read with SQL, never the product's fold.
//
// Desk S1, next/: L1 to L3 on the same real runners. The contract they pin, from the approved
// desk plan (amendment 15):
//   0170, 0526: a start a letter caused is checked by main's permission core, `ChildrenLedger`'s
//     `judge`, with `StartProgram` on the fabrika, against that letter's sender. The runner hands
//     the core the letter's id as `from.parent`, and the core asks `Senders` who sent it. The
//     program that asked and the requester's own member are never the one checked, and no
//     `StartGrant` is read for a start with a sender behind it. A start with no letter behind it
//     keeps the `starts` pair list.
//   StartChild.ts: `stopChild`, `Cmd.make("stop_child", { input: {name}, ok: null, err:
//     ["not_child", "noproc"] })`, OTP's terminate_child: it ends the requester's own child with
//     `shutdown`, and its watchers get one DOWN.
// Every letter a runner here takes is recorded and delivered in a real SessionManager first, as the
// door does, and `Senders` is made from that SessionManager's `sender`, as `cloudflare/runtime.ts`
// makes the real one. The relation rows are the world's: the founder's owner row, and one row per
// role the walk drew.
import type { Tagged } from "@demlik/tea";
import { Machine } from "@demlik/tea/effect";
import { describe, expect, it } from "@effect/vitest";
import { type Runs, runsFor } from "@kampus/vitest";
import * as Arbitrary from "effect/Arbitrary";
import * as Arr from "effect/Array";
import * as Clock from "effect/Clock";
import * as Context from "effect/Context";
import * as Deferred from "effect/Deferred";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as Fiber from "effect/Fiber";
import * as Formatter from "effect/Formatter";
import * as Layer from "effect/Layer";
import * as Logger from "effect/Logger";
import * as Match from "effect/Match";
import * as Option from "effect/Option";
import * as Predicate from "effect/Predicate";
import * as Rec from "effect/Record";
import * as Result from "effect/Result";
import * as Schema from "effect/Schema";
import * as Scope from "effect/Scope";
import * as Str from "effect/String";
import type * as Tracer from "effect/Tracer";

import * as fc from "fast-check";
import { InputId, NotGranted, SessionManager, SignRequest, Writer } from "../coordination/index.ts";
import * as Id from "../Id.ts";
import { Model as FabrikaModel } from "../permissions/Model.ts";
import * as Relation from "../permissions/Relation.ts";
import { Sender } from "../permissions/Senders.ts";
import { Children, Started } from "../processes/Children.ts";
import { ExitReason } from "../processes/ExitReason.ts";
import { type From, Mailbox } from "../processes/Mailbox.ts";
import { Owner, Recipient, Start } from "../processes/Process.ts";
import { ProcessManager } from "../processes/ProcessManager.ts";
import { type Grants, ProgramMail } from "../processes/ProgramMail.ts";
import type { Sql } from "../Sql.ts";
import { Alarm, CheckedWriter, type Incoming, ProgramLoader, Recording, WatcherManager } from "./Entry.ts";
import { childStarter, Model, Msg as ChildMsg } from "./internal/childStarter.test-support.ts";
import { ANY_CHUNK } from "./internal/chunk.test-support.ts";
import { ProcessStore } from "./ProcessStore.ts";
import { Program } from "./Program.ts";
import { ProgramRunner } from "./Runner.ts";
import * as StartChild from "./StartChild.ts";

/** The key of each input these laws hand a starter or a stopper, and of the raw Cmd and answer they
 *  read back, made by its schema (0569, 0562). A law sets the other fields, as the program's own
 *  schema then judges them. */
const Tag = Schema.TaggedUnion({ start: {}, end: {}, stop: {}, start_child: {}, exit_err: {} });

const ping = ChildMsg.cases.ping.make({});

/** Real stores. `sql(part)` is one database per part; `probe.open` counts the handles still open. */
export type Store = {
  readonly sql: (part: string) => Sql;
  readonly reopen: Effect.Effect<void>;
  /** The host's shared services. `world` holds the relation rows, and the door's own `SessionManager`,
   *  whose `sender` answers who sent a start's parent. */
  readonly shared: (
    sql: Sql,
    next: Effect.Effect<string>,
    world: { readonly rows: ReadonlyArray<Relation.Change>; readonly sessions: SessionManager["Service"] },
  ) => Layer.Layer<
    | Children
    | ProgramMail
    | ProcessManager
    | Mailbox
    | Layer.Services<ReturnType<typeof ProcessManager.layer>>
    | Layer.Services<ReturnType<typeof ProcessStore.layer>>
  >;
  readonly entries: (names: Iterable<string>) => Effect.Effect<ReadonlyArray<Entry>>;
  readonly probe: { readonly open: () => number };
  readonly tracer: (sql: Sql) => Effect.Effect<Tracer.Tracer, never, Scope.Scope>;
};

const PIDS: ReadonlyArray<string> = Array.from(
  { length: 40 },
  (_, n) => `process_0000000000e00800${Str.padStart(10, "0")(String(n))}`,
);

const ids = (...values: ReadonlyArray<string>) => {
  let calls = 0;

  return {
    next: Effect.sync(() => {
      const value = values[calls++];

      if (value === undefined) {
        throw new Error("test exhausted its process IDs");
      }

      return value;
    }),
    calls: () => calls,
  };
};

const Reasons = Schema.TaggedUnion({ normal: {} });

const NORMAL = Reasons.cases.normal.make({});

/** Desk S1, L3: OTP's shutdown, the one reason a stopped child ends with. */
const SHUTDOWN = ExitReason.cases.shutdown.make({});

type Entry = Tagged & {
  readonly id: string;
  readonly stream: string;
  readonly rev: number;
  readonly body: unknown;
};

const SEED = 119120;

const BUILD = "p42-build-a";

const PERSON = "person_01m6v5270hf3c8x2q7w9z4k5mn";

const TRACE = "4bf92f3577b34da6a3ce929d0e0e4736";

/** The brain's own session: a process ID no start in a walk reaches. */
const DOOR = PIDS.at(-1) ?? "";

/** The ledger's row limit (`ledger/Log.ts`). */
const ROW_LIMIT = 2_000_000;

// A valid 256-character program name adds more bytes to the Cmd than to its first letter.
const BOUNDARY_PROGRAM = `m${Str.repeat(255)("é")}`;

const PROGRAMS: Record<string, unknown> = {
  starter: childStarter({ name: "starter", declare: true }),
  merger: childStarter({ name: "merger", declare: true }),
  plain: childStarter({ name: "plain", declare: false }),
  [BOUNDARY_PROGRAM]: childStarter({ name: BOUNDARY_PROGRAM, declare: true }),
};

/** Start grants, by program. `plain` is granted, but never declared the Cmds. */
export const STARTS = [
  { source: "starter", to: "merger" },
  { source: "merger", to: "merger" },
  { source: "plain", to: "merger" },
  { source: "starter", to: BOUNDARY_PROGRAM },
  { source: "merger", to: BOUNDARY_PROGRAM },
];

/**
 * Desk S1, L3: three programs that start and stop children. Booted only by a walk that stops.
 * Their starts are founder letters, so the founder's owner row allows them; no StartGrant is read.
 */
const STOPPERS: ReadonlyArray<readonly [string, string]> = [
  ["stopa:1", "stopa"],
  ["stopb:1", "stopb"],
  ["stopc:1", "stopc"],
];

const STOPPER_PROGRAMS = new Set(Arr.map(STOPPERS, ([, program]) => program));

/** Desk S1, L2: a sender whose key the membership no longer admits, though its letter was delivered. */
const OUTSIDER_KEY = "SHA256:outsider";

const OUTSIDER_PERSON = "person_01m6v5270hf3c8x2q7w9z4k5zz";

const outsider = Writer.cases.person.make({ key: OUTSIDER_KEY, for: OUTSIDER_PERSON });

/** Desk S1, L1: a member's own writer, keyed by the person. */
const memberWriter = (member: string) => Writer.cases.person.make({ key: `SHA256:${member}`, for: member });

/** Programs a letter may ask a starter for; no grant names `starter` or `plain` as a start's target. */
const ANY_PROGRAM = ["starter", "plain", "merger"] as const;

/** This fabrika's object in the permission model, the one the host checks starts on. */
export const FABRIKA = FabrikaModel.ref("fabrika", "p42");

/** Desk S1: a role on the fabrika, or none. */
type Role = "owner" | "admin" | "member" | null;

type Drawn = { readonly person: string; readonly role: Role };

const subject = (person: string) => `person:${person}`;

const related = (id: string, person: string, relation: Exclude<Role, null>): Relation.Change => ({
  id,
  row: Relation.Row.cases.related.make({ subject: subject(person), relation, object: FABRIKA }),
});

/** The owner row the boot writes for the founder, whose letters every older law sends. */
const FOUNDER_ROW = related("owner", PERSON, "owner");

/** The world's rows: the founder's, and one `related` row for each drawn person who holds a role. */
const rows = (people: ReadonlyArray<Drawn>): ReadonlyArray<Relation.Change> => [
  FOUNDER_ROW,
  ...Arr.flatMap(people, ({ person, role }, n) => (role === null ? [] : [related(`role-${n}`, person, role)])),
];

/** The started line's `member`, as the store keeps it. */
const encodeSender = Schema.encodeSync(Sender);

/** Desk S1, L3: one stopper program. It asks for starts and stops, and keeps every answer, in order,
 *  as `childStarter` does. Built on first use: `stopChild` is the build's. */
const stopper = (name: string) => {
  const Ask = Schema.Struct({ program: Schema.String, name: Schema.String });
  const Msg = Schema.TaggedUnion({ start: { ask: Ask }, stop: { name: Schema.String } });

  const answer = (type: string, outcome: unknown) =>
    Schema.decodeUnknownSync(Schema.Json)({ type, outcome: outcome ?? null });

  const keep = (type: string) => (s: Model, m: { value?: unknown; reason?: string }) => [
    { ...s, answers: [...s.answers, answer(type, Str.endsWith("_ok")(type) ? m.value : m.reason)] },
    [],
  ];

  const machine = Machine.make({
    model: Model,
    msg: Msg,
    cmds: [StartChild.startChild, StartChild.stopChild],
    init: (loaded) => [loaded ?? { stepped: 0, answers: [] }, []],
    // SAFETY: each key is a case of the Msg schema or the `_ok` or `_err` answer of a declared Cmd, the messages tea dispatches; the handlers are typed by hand, in shapes tea's update type does not take.
    update: {
      start: (s: Model, m: { ask: { program: string; name: string } }) => [
        { ...s, stepped: s.stepped + 1 },
        [StartChild.startChild({ program: m.ask.program, name: m.ask.name })],
      ],
      stop: (s: Model, m: { name: string }) => [
        { ...s, stepped: s.stepped + 1 },
        // SAFETY: a plain string on purpose: the host, not the type, judges the name.
        [StartChild.stopChild({ name: m.name } as never)],
      ],
      start_child_ok: keep("start_child_ok"),
      start_child_err: keep("start_child_err"),
      stop_child_ok: keep("stop_child_ok"),
      stop_child_err: keep("stop_child_err"),
    } as never,
  });

  return Program.make({
    name,
    machine,
    state: { v: 1, upgrades: [] },
    view: (s) => s,
    refuse: () => null,
    inputs: { start: "Ask for a child", stop: "Stop a child" },
    outputs: {},
    writes: {},
    wake: () => null,
  });
};

let withStoppers: Record<string, unknown> | undefined;

/** The loader's programs for a stopper's runner: every program, plus the three stoppers. */
const stopperPrograms = (): Record<string, unknown> => {
  withStoppers ??= { ...PROGRAMS, ...Rec.fromEntries(Arr.map([...STOPPER_PROGRAMS], (p) => [p, stopper(p)])) };

  return withStoppers;
};

/** The host's mail grant: `sender:1` mails both starters, so their steps run on another process's letter. */
export const HOST: Grants = { "sender:1": ["starter:1", "starter:2"] };

/** Names the boot registers: two starters, one program that never declared the Cmds, and a sender. */
const BOOT: ReadonlyArray<readonly [string, string]> = [
  ["starter:1", "starter"],
  ["starter:2", "starter"],
  ["plain:1", "plain"],
  ["sender:1", "sender"],
];

/** Programs a runner steps here; `sender` is only a registered name that mails. */
const RUNS = new Set(["starter", "merger", "plain"]);

const person = Writer.cases.person.make({ key: "SHA256:person", for: PERSON });

const owner = Writer.cases.agent.make({ key: "SHA256:owner", for: PERSON });

const inputId = (n: number) =>
  Schema.decodeUnknownSync(InputId)(`input_0000000000e008${Str.padStart(12, "0")(n.toString(16))}`);

const brainFrom = (): From => ({
  by: "SHA256:brain",
  for: "brain",
  sentAt: "2026-11-11T00:00:00Z",
  seen: 0,
  parent: null,
  traceId: TRACE,
  build: BUILD,
});

const decodeModel = Schema.decodeUnknownOption(Model);

/** A value's case, read without naming the key in a literal; every caller compares it with a string. */
const tagged = (value: unknown): string | undefined =>
  Predicate.hasProperty(value, "_tag") && Predicate.isString(value._tag) ? value._tag : undefined;

/** A raw value under `tag`, never made by a schema, so it can hold a shape its schema refuses. */
const raw = (tag: string, fields: object = {}): object =>
  // oxlint-disable-next-line fabrika/no-hand-tag -- invalid on purpose: no schema maker writes a shape its schema refuses
  ({ ...fields, _tag: tag });

const body = (entry: Entry | undefined): Record<string, unknown> => {
  const value = entry?.body;

  return Predicate.isObject(value) ? value : {};
};

const choose = <A>(items: ReadonlyArray<A>, pick: number): A => {
  const item = items[pick % items.length];

  if (item === undefined) {
    throw new Error("a move chose from an empty list");
  }

  return item;
};

/** The ledger's Sql with one cut: the next INSERT of an `exited` line throws once. */
const faulting = (
  sql: Sql,
  fault: {
    exited: boolean;
    message: string;
    checkpoint?: boolean;
    landed?: boolean;
    inputCheckpoint?: string | undefined;
    checkpointHit?: boolean;
    marker?: string;
  },
) => {
  const wrapped: Sql = {
    exec: (query, ...params) => {
      if (
        fault.exited &&
        /^\s*INSERT\b/i.test(query) &&
        Arr.some(params, (p) => p === "exited" || (Predicate.isString(p) && Str.includes('"exited"')(p)))
      ) {
        fault.exited = false;
        throw Object.assign(
          new Error(fault.message),
          fault.marker === undefined ? {} : { name: fault.marker, code: fault.marker, errcode: fault.marker },
        );
      }

      if (fault.checkpoint === true && fault.landed === true && /INSERT INTO process_state/.test(query)) {
        fault.checkpoint = false;
        throw new Error(fault.message);
      }

      if (
        fault.inputCheckpoint !== undefined &&
        /INSERT INTO process_(state|checkpoint_parts)/.test(query) &&
        Arr.some(
          params,
          (value) =>
            Predicate.isString(value) && Str.includes(Str.slice(1, -1)(JSON.stringify(fault.inputCheckpoint)))(value),
        )
      ) {
        fault.inputCheckpoint = undefined;
        fault.checkpointHit = true;
        // Driver failures can echo bound values. The runner must keep this out of every output.
        throw Object.assign(
          new Error(`SQLITE_FULL checkpoint ${JSON.stringify(params)}`),
          fault.marker === undefined ? {} : { name: fault.marker, code: fault.marker, errcode: fault.marker },
        );
      }

      const rows = sql.exec(query, ...params);

      if (
        /^\s*INSERT\b/i.test(query) &&
        Arr.some(params, (p) => p === "exited" || (Predicate.isString(p) && Str.includes('"exited"')(p)))
      ) {
        fault.landed = true;
      }

      return rows;
    },
    transaction: (step) => sql.transaction(step),
    size: () => sql.size(),
  };

  return wrapped;
};

type Ask = {
  readonly program: unknown;
  readonly name: unknown;
  readonly input?: unknown;
  readonly inputBytes?: number;
  readonly extra?: Record<string, unknown>;
  readonly drop?: ReadonlyArray<string>;
};

type Name = { readonly program: string; pid: string; live: boolean };

/** What the walk knows, from its own moves only, except what a cut made unknown. */
type World = {
  /** Desk S1: the three people this run drew, each with a role or none. */
  readonly people: ReadonlyArray<Drawn>;
  /** Desk S1, L2: each child a drawn person's letter started, and that person, its own member. */
  readonly members: Map<string, string>;
  readonly names: Map<string, Name>;
  /** Each start a `start_child` wrote: its Cmd id, the name, program, requester and first input. */
  readonly starts: Map<
    string,
    {
      readonly name: string;
      readonly program: string;
      readonly requester: string;
      readonly input?: unknown;
      readonly rev: number;
      readonly process: string;
    }
  >;
  /** Each child's first requester's name. */
  readonly parents: Map<string, string>;
  /** Live watches: who watches whom, under which ref. */
  readonly watches: Array<{ readonly watcher: string; readonly target: string; readonly ref: string }>;
  readonly fault: {
    exited: boolean;
    message: string;
    checkpoint?: boolean;
    landed?: boolean;
    inputCheckpoint?: string | undefined;
    checkpointHit?: boolean;
    marker?: string;
  };
  worker?: boolean;
  hold?: { entered: Deferred.Deferred<void>; release: Deferred.Deferred<void> } | undefined;
  n: number;
};

/**
 * One life of the whole host in `scope`: the shared ledger, process table, program mail and start
 * piece, and one runner per process that a runner steps, built when first asked for.
 */
const host = Effect.fnUntraced(function* (store: Store, world: World, next: Effect.Effect<string>, scope: Scope.Scope) {
  // Desk S1: the door's SessionManager, on its own store, built before the shared services that ask
  // it who sent a start's parent. Every key is admitted but the outsider's, which was removed.
  const sessions = Context.get(
    yield* Layer.buildWithScope(
      SessionManager.layer(
        store.sql("sessions"),
        (key) => (key === OUTSIDER_KEY ? Effect.fail(new NotGranted()) : Effect.succeed(memberWriter(key))),
        { input: () => false, event: () => false },
      ),
      scope,
    ),
    SessionManager,
  );

  const shared = store.shared(faulting(store.sql("ledger"), world.fault), next, {
    rows: rows(world.people),
    sessions,
  });

  const context = yield* Layer.buildWithScope(shared, scope);
  const children = Context.get(context, Children);

  const hold = Effect.gen(function* () {
    const held = world.hold;

    if (held !== undefined) {
      world.hold = undefined;
      yield* Deferred.succeed(held.entered, undefined);
      yield* Deferred.await(held.release);
    }
  });

  const runnerContext = Context.add(
    Context.add(context, SessionManager, sessions),
    Children,
    // Every member of the real service passes through; only `start` may be held for a race.
    Children.of({
      ...children,
      start: (...args: Parameters<typeof children.start>) => Effect.andThen(hold, children.start(...args)),
    }),
  );

  /** The door's two steps before a delivery: the input is recorded with its sender, then delivered. */
  const deliver = (input: unknown, name: string, pid: string) => {
    // SAFETY: deliver runs only in the runner wrapper's `msg` above, and every `msg` call in this file passes an Incoming: `letter(...)`, or an Incoming written out.
    const i = input as Incoming;

    // SAFETY: SessionManager keeps its InputRecord type private; each field below is the recorded Incoming's own, in its schema's form.
    return sessions
      .record({
        id: i.envelope.id,
        by: i.envelope.by,
        client: i.envelope.by.key,
        process: pid,
        name,
        personOnly: false,
        digest: i.id,
        traceId: i.span.traceId,
        span: i.span,
        arrivedAt: i.envelope.arrivedAt,
      } as never)
      .pipe(Effect.andThen(sessions.delivered(i.envelope.id, pid)), Effect.orDie);
  };

  const runners = new Map<string, ProgramRunner["Service"]>();

  const runner = Effect.fnUntraced(function* (name: string) {
    const held = world.names.get(name);

    if (held === undefined || !(RUNS.has(held.program) || STOPPER_PROGRAMS.has(held.program))) {
      return yield* Effect.die(new Error(`no runner steps ${name}`));
    }

    const known = runners.get(held.pid);

    if (known !== undefined) {
      return known;
    }

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
          // The real door backs `sign` with its SessionManager's signer, as this does.
          sign: (id: string, parent: string, kind: string) =>
            sessions.signer(parent, held.pid, kind).pipe(Effect.provideService(SignRequest, { id })),
          commit: () => Effect.die("no write declared"),
          own: () => Effect.die("no write declared"),
        };
      }),
    );

    const own = Layer.mergeAll(
      ProgramLoader.layer(STOPPER_PROGRAMS.has(held.program) ? stopperPrograms() : PROGRAMS, {}),
      ProcessStore.layer(faulting(store.sql(`process-${name}`), world.fault), { process: held.pid }),
      Layer.succeed(Alarm, { set: () => Effect.void }),
      Layer.succeed(WatcherManager, { publish: () => Effect.void }),
      Layer.succeed(Recording, { flush: Effect.void }),
      checked,
    ).pipe(Layer.provideMerge(Layer.succeedContext(runnerContext)));

    const descriptor = { id: held.pid, name, program: held.program, build: BUILD, owner };

    const options = {
      recovery: { sql: store.sql(`recovery-${name}`), name, capacity: 1024 ** 3 },
      chunk: ANY_CHUNK,
    };

    const layer =
      world.worker === true
        ? Layer.unwrap(
            Effect.map(ProgramLoader, (loader) =>
              ProgramRunner.withLoader(
                descriptor,
                {
                  load: (name, build) =>
                    Effect.map(loader.load(name, build), ({ stepper: _stepper, ...loaded }) => loaded),
                },
                options,
              ),
            ),
          )
        : ProgramRunner.layer(descriptor, options);

    const built = yield* Layer.buildWithScope(layer.pipe(Layer.provide(own)), scope);
    const real = Context.get(built, ProgramRunner);

    const made: ProgramRunner["Service"] = {
      ...real,
      msg: (input) => Effect.andThen(deliver(input, name, held.pid), real.msg(input)),
    };

    runners.set(held.pid, made);

    return made;
  });

  return { context, runner };
});

/** A process's saved model, read from its checkpoint without asking the runner. */
const savedModel = Effect.fnUntraced(function* (store: Store, name: string, pid: string) {
  const saved = yield* ProcessStore.use((s) => s.load).pipe(
    Effect.provide(ProcessStore.layer(store.sql(`process-${name}`), { process: pid })),
  );

  return Option.getOrUndefined(decodeModel(saved?.saved.model ?? null));
});

// Effect Arbitrary has no fast-check adapter, and the walk is fast-check's `fc.commands`: one seed
// draws one value from the schema's own Arbitrary.
const generated = <S extends Schema.Top>(schema: S): fc.Arbitrary<S["Type"]> =>
  fc.nat().map((seed) => {
    // oxlint-disable-next-line fabrika/no-effect-run-outside-edge -- edge: fast-check's map takes a plain value, so one sample is drawn here
    const [value] = Effect.runSync(Arbitrary.sampleEffect(Arbitrary.schema(schema), { seed, count: 1 }));

    // SAFETY: sampleEffect was asked for one value, so the first element is there.
    return value as S["Type"];
  });

/** Desk S1: three people per run, none of them the founder or the outsider, each with a role or none. */
const People = fc.uniqueArray(
  fc.record({
    person: generated(Id.Person).filter((p) => p !== PERSON && p !== OUTSIDER_PERSON),
    role: fc.constantFrom<Role>("owner", "admin", "member", null),
  }),
  { minLength: 3, maxLength: 3, selector: (drawn) => drawn.person },
);

/** The laws that draw nobody: only the founder's row is in their world. */
const NOBODY = fc.constant<ReadonlyArray<Drawn>>([]);

const Cell = fc.record({
  move: fc.nat(),
  /** Desk S1: which drawn person sends the letter, and which program it asks for. */
  sender: fc.nat(),
  program: fc.nat(),
  pick: fc.nat(),
  alt: fc.nat(),
  shape: fc.nat(),
  m: fc.jsonValue({ maxDepth: 2 }),
  extra: fc.subarray(["requester", "owner", "process", "hash", "reason", "source"], { minLength: 1 }),
});

type Cell = typeof Cell extends fc.Arbitrary<infer A> ? A : never;

type Walk = { readonly step: (cell: Cell) => Effect.Effect<void, unknown> };

const Tape = fc
  .commands(
    [
      Cell.map((cell): fc.AsyncCommand<object, Walk> => ({
        check: () => true,
        // oxlint-disable-next-line fabrika/no-effect-run-outside-edge -- edge: fast-check awaits one real service move
        run: (_model, real) => Effect.runPromise(real.step(cell)),
        toString: () => JSON.stringify(cell),
      })),
    ],
    { maxCommands: 20, size: "max" },
  )
  .filter((commands) => [...commands].length >= 6);

type Move =
  | "door_start"
  | "mail_start"
  | "forged"
  | "bad"
  | "undeclared"
  | "undeclared_exit"
  | "exit"
  | "exit_extra"
  | "after_exit"
  | "watch"
  | "start_ended"
  | "retry_saved"
  | "cut_exit"
  | "queued_exit"
  | "interleaved_exit"
  | "worker_before_exit"
  | "worker_after_exit"
  | "boundary_start"
  | "checkpoint_starts"
  // Desk S1
  | "related_start"
  | "unrelated_start"
  | "removed_start"
  | "stopper_start"
  | "stop_own"
  | "stop_other"
  | "stop_ended";

/** The moves that need the three stoppers booted. */
const STOPS: ReadonlySet<Move> = new Set(["stopper_start", "stop_own", "stop_other", "stop_ended"]);

/** A forged operand for each extra field a program might add beside its Cmd. */
const forged = (field: string, world: World): typeof Recipient.Type | typeof Owner.Type | string => {
  const sender = world.names.get("sender:1")?.pid ?? DOOR;

  return field === "requester"
    ? Recipient.cases.process.make({ process: sender })
    : field === "owner"
      ? Owner.cases.brain.make({})
      : field === "process" || field === "source"
        ? sender
        : field === "hash"
          ? "forged-hash"
          : "kill";
};

/**
 * Folds one tape through real runners, in a world holding the people this run drew. Each cell reads
 * the world the fold has reached and picks a move possible there; the oracle checks every prefix
 * against the store's raw rows.
 */
const walk = (
  open: Effect.Effect<Store, never, Scope.Scope>,
  moves: ReadonlyArray<Move>,
  done: Set<Move>,
  seen: Set<string>,
) =>
  Effect.fnUntraced(function* ([people, tape]: readonly [
    ReadonlyArray<Drawn>,
    Iterable<fc.AsyncCommand<object, Walk>>,
  ]) {
    const store = yield* open;
    const next = ids(...PIDS);

    const world: World = {
      people,
      members: new Map(),
      names: new Map(),
      starts: new Map(),
      parents: new Map(),
      watches: [],
      fault: { exited: false, message: "SQLITE_FULL planted at the exit" },
      n: 0,
    };

    const scope = yield* Scope.make();
    yield* Effect.addFinalizer(() => Scope.close(scope, Exit.void));
    const life = yield* host(store, world, next.next, scope);

    const inContext = <A, E>(effect: Effect.Effect<A, E, Layer.Success<ReturnType<Store["shared"]>>>) =>
      effect.pipe(Effect.provide(life.context));

    const all = (extra: Iterable<string> = []) => inContext(store.entries([...world.names.keys(), ...extra]));

    const letter = (input: unknown, by: Writer = person): Incoming => {
      const n = ++world.n;

      return {
        id: `letter-${n}`,
        envelope: { id: inputId(n), by, arrivedAt: 1794099600000 + n, input },
        sentAt: "2026-11-11T01:00:00Z",
        seen: 0,
        span: { traceId: TRACE, spanId: "00f067aa0ba902b7" },
      };
    };

    /** A runner call that may refuse: it must answer, never hang. */
    const call = <A, E>(effect: Effect.Effect<A, E>, label: string) =>
      effect.pipe(
        Effect.result,
        Effect.timeoutOption("20 seconds"),
        Effect.map((answer) => {
          expect(Option.isSome(answer), `${label} answers`).toBe(true);

          return answer;
        }),
      );

    const door = Effect.fnUntraced(function* (name: string, input: unknown, by: Writer = person) {
      const runner = yield* life.runner(name);
      yield* call(runner.msg(letter(input, by)), `${name}'s letter`);
    });

    const answers = Effect.fnUntraced(function* (name: string) {
      // SAFETY: answers is called only for names the walk started, and each start is kept in world.names.
      const held = world.names.get(name) as Name;

      return (yield* inContext(savedModel(store, name, held.pid)))?.answers ?? [];
    });

    /** The last answer the program was told, once its own answer letter was folded. */
    const lastAnswer = Effect.fnUntraced(function* (name: string, before: number) {
      const told = yield* answers(name);
      expect(told.length, `${name} was told one answer`).toBe(before + 1);

      // SAFETY: the expect above saw one more answer, and each answer is `{ type, outcome }`.
      return told.at(-1) as { type: string; outcome: unknown };
    });

    /** Adds every start the store holds that the world has not seen; each must be one it asked for. */
    const sync = Effect.fnUntraced(function* (
      asked: ReadonlyArray<{ readonly name: string; readonly requester: string; readonly input?: unknown }>,
    ) {
      const rows = yield* all(Arr.map(asked, (a) => a.name));

      for (const row of rows) {
        if (row._tag !== "started" || !Str.startsWith("processes/")(row.stream) || world.starts.has(row.id)) {
          continue;
        }

        const b = body(row);
        // SAFETY: a start row's requester is a recipient, which names its process when it is one.
        const requester = (b["requester"] as { process?: string } | undefined)?.process;

        if (requester === undefined) {
          continue;
        }

        const name = String(b["name"]);
        const ask = Option.getOrUndefined(Arr.findFirst(asked, (a) => a.name === name));
        expect(ask, `L5: ${name} was started only by a Cmd the walk dispatched`).toBeDefined();
        expect(requester, "L5: the requester is the life that ran the step").toBe(ask?.requester);
        expect(Str.startsWith(`${ask?.requester}/`)(row.id), "L5: the start's id is the dispatched Cmd's id").toBe(
          true,
        );
        expect(b["hash"], "L5: the hash is the loader's, never the program's").toBe(BUILD);

        const registered = Option.getOrUndefined(
          Arr.findFirst(rows, (e) => e.stream === "processes" && e._tag === "registered" && body(e)["name"] === name),
        );

        expect(body(registered)["owner"], "L5: the brain owns a started child").toEqual(Owner.cases.brain.make({}));
        world.starts.set(row.id, {
          name,
          program: String(b["program"]),
          requester,
          ...(ask?.input === undefined ? {} : { input: ask.input }),
          rev: row.rev,
          process: String(b["process"]),
        });
        world.names.set(name, { program: String(b["program"]), pid: String(b["process"]), live: true });
        const parent = Option.getOrUndefined(Arr.findFirst([...world.names], ([, h]) => h.pid === requester))?.[0];

        if (parent !== undefined) {
          world.parents.set(name, parent);
        }
      }
    });

    const registered = (name: string) =>
      Effect.map(all(), (rows) =>
        Arr.some(rows, (e) => e.stream === "processes" && e._tag === "registered" && body(e)["name"] === name),
      );

    /** Desk S1: the `started` line a start wrote for `name`, read from the store's raw rows. */
    const startedLine = (name: string) =>
      Effect.map(all([name]), (rows) =>
        Option.getOrUndefined(Arr.findFirst(rows, (e) => e._tag === "started" && body(e)["name"] === name)),
      );

    /** Desk S1: the drawn people, by whether they hold a role. */
    const drawn = (holds: boolean) => Arr.filter(world.people, ({ role }) => (role !== null) === holds);

    const exitedRows = (pid: string) =>
      Effect.map(all(), (rows) => Arr.filter(rows, (e) => e._tag === "exited" && body(e)["process"] === pid));

    // Built on each read: `all()` lists the streams of the names known at the time it is called.
    const head = Effect.suspend(() => Effect.map(all(), (rows) => Math.max(0, ...Arr.map(rows, (e) => e.rev))));
    const fresh = (prefix = "merger") => `${prefix}:${1000 + ++world.n}`;

    const runnable = () =>
      Arr.map(
        Arr.filter([...world.names], ([, h]) => h.live && RUNS.has(h.program) && h.program !== "plain"),
        ([n]) => n,
      );

    const starters = () => runnable();

    /** Desk S1, L2: a starter, often a child a drawn person's letter started, so it has a member of its own. */
    const requester = (cell: Cell) => {
      const children = Arr.filter(starters(), (n) => world.members.has(n));

      return children.length > 0 && cell.shape % 2 === 0 ? choose(children, cell.pick) : choose(starters(), cell.pick);
    };

    const ended = () =>
      Arr.map(
        Arr.filter([...world.names], ([n, h]) => !h.live && world.parents.has(n)),
        ([n]) => n,
      );

    const stoppers = () =>
      Arr.filter(
        Arr.map(STOPPERS, ([n]) => n),
        (n) => world.names.get(n)?.live === true,
      );

    /** Desk S1, L3: each stopper's children, by state. */
    const stopperChildren = (live: boolean) =>
      Arr.filter(
        [...world.names],
        ([n, h]) =>
          h.live === live &&
          Arr.some(STOPPERS, ([s]) => s === world.parents.get(n) && world.names.get(s)?.live === true),
      );

    /** Every process row written after `rev`, outside the inboxes. */
    const processRows = (rev: number) =>
      Effect.map(all(), (rows) => Arr.filter(rows, (e) => e.rev > rev && Str.startsWith("processes")(e.stream)));

    /** What each known name's process state is now, read from the process table. */
    const states = Effect.fnUntraced(function* () {
      const out = new Map<string, string>();

      for (const n of world.names.keys()) {
        out.set(n, (yield* inContext(ProcessManager.use((p) => p.status(n)))).state._tag);
      }

      return out;
    });

    for (const [name, program] of [...BOOT, ...(Arr.some(moves, (m) => STOPS.has(m)) ? STOPPERS : [])]) {
      const started = yield* inContext(
        ProcessManager.use((p) =>
          p.start(Start.cases.first.make({ id: `boot:${name}`, name, code: { program, hash: BUILD } }), brainFrom()),
        ),
      ).pipe(Effect.orDie);

      world.names.set(name, { program, pid: started.process, live: true });
    }

    const step = Effect.fnUntraced(function* (cell: Cell) {
      const can: Record<Move, boolean> = {
        door_start: starters().length > 0 && next.calls() < PIDS.length - 6,
        mail_start:
          Arr.some(["starter:1", "starter:2"], (n) => world.names.get(n)?.live === true) &&
          next.calls() < PIDS.length - 6,
        forged: starters().length > 0,
        bad: starters().length > 0,
        undeclared_exit: world.names.get("plain:1")?.live === true,
        undeclared: world.names.get("plain:1")?.live === true,
        exit: runnable().length > 0 && next.calls() < PIDS.length - 6,
        exit_extra: runnable().length > 0,
        after_exit: Arr.some([...world.names], ([, h]) => !h.live && RUNS.has(h.program)),
        watch: runnable().length > 0,
        start_ended: starters().length > 0 && ended().length > 0,
        retry_saved: world.starts.size > 0,
        queued_exit: runnable().length > 0 && next.calls() < PIDS.length - 6,
        interleaved_exit: runnable().length > 0 && next.calls() < PIDS.length - 6,
        worker_before_exit: runnable().length > 0 && next.calls() < PIDS.length - 6,
        worker_after_exit: runnable().length > 0 && next.calls() < PIDS.length - 6,
        cut_exit: runnable().length > 0 && next.calls() < PIDS.length - 6,
        checkpoint_starts: starters().length > 0 && next.calls() < PIDS.length - 6,
        related_start: starters().length > 0 && drawn(true).length > 0 && next.calls() < PIDS.length - 6,
        unrelated_start: starters().length > 0 && drawn(false).length > 0,
        removed_start: starters().length > 0,
        stopper_start: stoppers().length > 0 && next.calls() < PIDS.length - 6,
        stop_own: stopperChildren(true).length > 0,
        stop_other: stoppers().length > 0,
        stop_ended: stopperChildren(false).length > 0,
        boundary_start: starters().length > 0 && next.calls() < PIDS.length - 6,
      };

      const options = Arr.filter(moves, (move) => can[move]);

      if (options.length === 0) {
        return;
      }

      const move = choose(options, cell.move);

      switch (move) {
        case "door_start":
        case "mail_start": {
          const name =
            move === "mail_start"
              ? choose(
                  Arr.filter(["starter:1", "starter:2"], (n) => world.names.get(n)?.live === true),
                  cell.pick,
                )
              : choose(starters(), cell.pick);

          // SAFETY: the name was chosen from world.names: a live starter or a live mail starter.
          const held = world.names.get(name) as Name;
          const existing = Arr.filter([...world.names], ([n, h]) => h.program === "merger" && n !== name);
          const target = cell.alt % 3 === 0 && existing.length > 0 ? choose(existing, cell.alt)[0] : fresh();
          const was = world.names.get(target);

          const ask: Ask = {
            program: "merger",
            name: target,
            ...(cell.shape % 2 === 0 ? {} : { input: ping }),
          };

          const before = (yield* answers(name)).length;

          if (move === "door_start") {
            yield* door(name, { ...Tag.cases.start.make({}), ask });
          } else {
            // Another live process's letter: the requester must still be the life that steps it.
            // SAFETY: sender:1 is one of the processes every world starts with.
            const sender = world.names.get("sender:1") as Name;

            const sent = yield* inContext(
              ProgramMail.use((mail) =>
                mail.deliver({
                  command: `${sender.pid}/${++world.n}/0`,
                  source: { name: "sender:1", process: sender.pid },
                  to: name,
                  m: { ...Tag.cases.start.make({}), ask },
                  from: { ...brainFrom(), by: "SHA256:sender", for: PERSON },
                }),
              ),
            ).pipe(Effect.result);

            expect(Result.isSuccess(sent), "the sender's letter is delivered").toBe(true);
            const runner = yield* life.runner(name);
            yield* call(runner.due(yield* Clock.currentTimeMillis), `${name}'s drain`);
          }

          yield* sync([
            { name: target, requester: held.pid, ...(ask.input === undefined ? {} : { input: ask.input }) },
          ]);
          const told = yield* lastAnswer(name, before);

          if (was === undefined) {
            expect(told, `L5: a fresh start answers started`).toMatchObject({
              type: "start_child_ok",
              outcome: { name: target },
            });
            expect(tagged(told.outcome), "L5: a fresh start answers started").toBe("started");
            expect(
              world.starts.size > 0 && Arr.some([...world.starts.values()], (s) => s.name === target),
              "the child is recorded",
            ).toBe(true);
            seen.add(move === "mail_start" ? "mailed_start" : "started");
          } else {
            expect(told, "an existing name is an answer, and writes nothing").toMatchObject({
              type: "start_child_ok",
              outcome: Started.cases[was.live ? "already_started" : "already_present"].make({
                process: was.pid,
                name: target,
              }),
            });
            seen.add(was.live ? "already_started" : "already_present");
          }

          break;
        }

        case "forged": {
          const name = choose(starters(), cell.pick);
          const target = fresh();
          const extra = Rec.fromEntries(Arr.map(cell.extra, (field) => [field, forged(field, world)]));
          const before = (yield* answers(name)).length;
          yield* door(name, { ...Tag.cases.start.make({}), ask: { program: "merger", name: target, extra } });
          expect(yield* lastAnswer(name, before), "L5, L8: a Cmd with fields beyond its operands").toEqual({
            type: "start_child_err",
            outcome: "bad_cmd",
          });
          expect(yield* registered(target), "L5: a forged Cmd writes nothing").toBe(false);
          seen.add("forged");
          break;
        }

        case "bad": {
          const name = choose(starters(), cell.pick);
          const target = fresh();
          const kind = cell.shape % 8;

          const bad: { ask: Ask; reason: string; tag: string } = Match.value(kind).pipe(
            Match.when(0, () => ({
              ask: { program: "merger", name: target, drop: ["program"] },
              reason: "bad_cmd",
              tag: "missing",
            })),
            Match.when(1, () => ({
              ask: { program: "merger", name: target, drop: ["name"] },
              reason: "bad_cmd",
              tag: "missing",
            })),
            Match.when(2, () => ({ ask: { program: 5, name: target }, reason: "bad_cmd", tag: "typed" })),
            Match.when(3, () => ({ ask: { program: "merger", name: ["x"] }, reason: "bad_cmd", tag: "typed" })),
            Match.when(4, () => ({
              ask: { program: `nope${cell.alt % 9}`, name: target },
              reason: "no_program",
              tag: "no_program",
            })),
            // The loader answers before the name is judged.
            Match.when(5, () => ({
              ask: { program: "nope", name: "Bad Name" },
              reason: "no_program",
              tag: "no_program",
            })),
            Match.when(6, () => ({
              ask: {
                program: "merger",
                name: choose(["", "processes", "Merger:1", "merger/1", "client:x", Str.repeat(257)("m")], cell.alt),
              },
              reason: "bad_name",
              tag: "bad_name",
            })),
            Match.orElse(() => ({
              ask: { program: "merger", name: target, inputBytes: ROW_LIMIT + 1 },
              reason: "bad_input",
              tag: "bad_input",
            })),
          );

          const before = (yield* answers(name)).length;
          const revBefore = yield* head;
          yield* door(name, { ...Tag.cases.start.make({}), ask: bad.ask });
          expect(yield* lastAnswer(name, before), `L6: ${bad.tag}`).toEqual({
            type: "start_child_err",
            outcome: bad.reason,
          });
          expect(
            Arr.filter(
              Arr.filter(yield* all(), (e) => e.rev > revBefore),
              (e) => Str.startsWith("processes")(e.stream) || Str.startsWith('["start",')(e.id),
            ),
            `L6: ${bad.tag} writes nothing`,
          ).toEqual([]);
          seen.add(bad.tag);
          break;
        }

        case "undeclared": {
          const target = fresh();
          yield* door("plain:1", { ...Tag.cases.start.make({}), ask: { program: "merger", name: target } });
          expect(yield* registered(target), "L6, L8: a Cmd the program never declared writes nothing").toBe(false);
          seen.add("undeclared");
          break;
        }

        case "undeclared_exit": {
          // SAFETY: plain:1 is one of the processes every world starts with.
          const held = world.names.get("plain:1") as Name;
          const before = yield* head;
          yield* door("plain:1", { ...Tag.cases.end.make({}), before: [], after: [], twice: false });
          const rows = yield* all();
          expect(
            Arr.filter(rows, (row) => row.rev > before && Str.startsWith("processes")(row.stream)),
            "L8: an undeclared exit writes no process rows",
          ).toEqual([]);
          expect(yield* exitedRows(held.pid), "L8: an undeclared exit leaves its life live").toEqual([]);
          const replies = Arr.filter(rows, (row) => Str.endsWith("/answer")(row.id) && row.stream === "plain:1/inbox");
          expect(body(replies.at(-1))["m"]).toMatchObject({ ...Tag.cases.exit_err.make({}), reason: "bad_cmd" });
          seen.add("undeclared_exit");
          break;
        }

        case "queued_exit":
        case "interleaved_exit":
        case "worker_before_exit":
        case "worker_after_exit": {
          const name = choose(runnable(), cell.pick);
          // SAFETY: runnable() lists only names in world.names.
          const held = world.names.get(name) as Name;
          const before = Array.from({ length: 1 + (cell.shape % 3) }, () => ({ program: "merger", name: fresh() }));
          const after = Array.from({ length: 1 + (cell.alt % 3) }, () => ({ program: "merger", name: fresh() }));
          const ending = { ...Tag.cases.end.make({}), before, after, twice: true };
          const late = { ...Tag.cases.start.make({}), ask: { program: "merger", name: fresh() } };
          const pid = held.pid;
          world.worker = Str.startsWith("worker_")(move);
          // The public withLoader path has the Worker's declaration and execution, with no pure stepper.
          let current = yield* host(store, world, next.next, scope);
          let runner = yield* current.runner(name);
          yield* call(runner.msg(letter(ping)), "initial letter");
          const initialSteps = (yield* inContext(savedModel(store, name, pid)))?.stepped ?? 0;

          if (move === "queued_exit") {
            // Ordinary mail already waiting when the alarm drains it. End comes before the late ask.
            yield* inContext(Mailbox.use((m) => m.send(name, `end-${++world.n}`, ending, brainFrom())));
            yield* inContext(Mailbox.use((m) => m.send(name, `late-${++world.n}`, late, brainFrom())));
            yield* call(runner.due((yield* Clock.currentTimeMillis) + 1_000), "queued exit");
          } else if (move === "interleaved_exit") {
            const entered = yield* Deferred.make<void>();
            const release = yield* Deferred.make<void>();
            world.hold = { entered, release };
            const endingCall = yield* Effect.forkChild(runner.msg(letter(ending)).pipe(Effect.result));
            yield* Deferred.await(entered).pipe(Effect.timeout("10 seconds"));
            // A different letter arrives while the Cmd before exit is still in flight.
            const alarm = cell.alt % 2 === 0;

            if (alarm) {
              yield* inContext(Mailbox.use((m) => m.send(name, `late-${++world.n}`, late, brainFrom())));
            }

            const laterCall = yield* Effect.forkChild(
              (alarm ? runner.due((yield* Clock.currentTimeMillis) + 1_000) : runner.msg(letter(late))).pipe(
                Effect.result,
              ),
            );

            // Let the competing call run up to a wait, without requiring it to finish before release.
            for (let turn = 0; turn < 20; turn++) {
              yield* Effect.yieldNow;
            }

            yield* Deferred.succeed(release, undefined);
            yield* Fiber.join(endingCall);
            yield* Fiber.join(laterCall);
            seen.add(alarm ? "interleaved_alarm" : "interleaved_letter");
          } else {
            world.fault.landed = false;
            world.fault.exited = move === "worker_before_exit";
            world.fault.checkpoint = move === "worker_after_exit";
            yield* call(runner.msg(letter(ending)), "exit with a cut");
            expect(
              move === "worker_before_exit" ? world.fault.exited : world.fault.checkpoint,
              "L7: the selected recovery cut fired",
            ).toBe(false);
            // Discard all runner memory and reopen the same files before a Worker loader recovers.
            yield* store.reopen;
            current = yield* host(store, world, next.next, scope);
            runner = yield* current.runner(name);

            for (let retry = 0; retry < 4; retry++) {
              yield* call(runner.due((yield* Clock.currentTimeMillis) + 60_000 * (retry + 1)), "recovered alarm");
            }
          }

          const rows = yield* store.entries([
            name,
            ...Arr.map(before, (a) => a.name),
            ...Arr.map(after, (a) => a.name),
            late.ask.name,
          ]);

          const exits = Arr.filter(rows, (row) => row._tag === "exited" && body(row)["process"] === pid);
          expect(exits, "L7: one normal exit survives a queued turn or a Worker recovery cut").toHaveLength(1);
          expect(body(exits[0])["reason"]).toEqual(NORMAL);

          for (const ask of before) {
            expect(
              Arr.some(rows, (row) => row._tag === "started" && body(row)["name"] === ask.name),
              "L7: every Cmd before exit ran",
            ).toBe(true);
          }

          for (const ask of [...after, late.ask]) {
            expect(
              Arr.some(rows, (row) => row._tag === "registered" && body(row)["name"] === ask.name),
              "L7: no Cmd or later queued letter after exit ran",
            ).toBe(false);
          }

          const stepped = (yield* inContext(savedModel(store, name, pid)))?.stepped;
          expect(stepped, "L7: exit is the last letter stepped, including mail already waiting").toBe(initialSteps + 1);
          yield* call(runner.msg(letter(ping)), "late letter after recovery");
          expect(
            (yield* inContext(savedModel(store, name, pid)))?.stepped,
            "L7: ended life steps no later letter",
          ).toBe(stepped);
          expect(
            Arr.filter(yield* store.entries([name]), (row) => row._tag === "restarted" && body(row)["after"] === pid),
            "L7: normal exit never restarts",
          ).toEqual([]);
          held.live = false;
          seen.add(move);
          break;
        }

        case "boundary_start": {
          const name = choose(starters(), cell.pick);
          const target = fresh();
          const inputBytes = ROW_LIMIT - 400 - (cell.alt % 16);
          const input = Str.repeat(inputBytes)("x");
          const ask = { program: BOUNDARY_PROGRAM, name: target, inputBytes };
          const encoder = new TextEncoder();
          expect(
            encoder.encode(
              Formatter.formatJson({ ...Tag.cases.start_child.make({}), program: ask.program, name: target, input }),
            ).length,
            "L6: this full Cmd exceeds the row limit",
          ).toBeGreaterThan(ROW_LIMIT);
          const before = (yield* answers(name)).length;
          yield* door(name, { ...Tag.cases.start.make({}), ask });
          const rows = yield* all([target]);
          const starts = Arr.filter(rows, (row) => row._tag === "started" && body(row)["name"] === target);
          const letters = Arr.filter(rows, (row) => row.stream === `${target}/inbox`);
          expect(starts, "L6: a valid first letter survives an oversized full Cmd").toHaveLength(1);
          expect(letters, "L6: the boundary input is written once").toHaveLength(1);
          // SAFETY: the expect above failed the law unless exactly one letter is there, and inbox rows carry From.
          const first = letters[0] as Entry & From;

          const texts = [
            first.stream,
            first.id,
            first.by,
            first.for,
            first.sentAt,
            first.parent,
            first.traceId,
            first.build,
            first._tag,
            Formatter.formatJson(first.body),
          ];

          const size = Arr.reduce(texts, 0, (total, text) => total + (text === null ? 0 : encoder.encode(text).length));
          expect(size, "L6: the complete first-letter row fits the limit").toBeLessThanOrEqual(ROW_LIMIT);
          expect(body(first)["m"]).toBe(input);
          expect(first.rev, "L6: the first letter follows the start with no intervening row").toBe(
            (starts[0]?.rev ?? 0) + 1,
          );
          expect(yield* lastAnswer(name, before)).toEqual({
            type: "start_child_ok",
            outcome: Started.cases.started.make({
              process: String(body(starts[0])["process"]),
              name: target,
              rev: starts[0]?.rev ?? 0,
            }),
          });
          world.names.set(target, { program: ask.program, pid: String(body(starts[0])["process"]), live: true });
          seen.add("boundary_start");
          break;
        }

        case "checkpoint_starts": {
          const name = choose(starters(), cell.pick);
          // SAFETY: starters() lists only names in world.names.
          const held = world.names.get(name) as Name;
          const before = (yield* answers(name)).length;

          const asks = Array.from({ length: 2 + (cell.shape % 2) }, () => ({
            program: "merger",
            name: fresh(),
            inputBytes: 1_100_000 + (cell.alt % 10_000),
          }));

          // The door letter holds sizes only. Its step emits individually valid Cmds whose sum
          // crosses the platform's row limit before any of them can be performed.
          yield* door(name, { ...Tag.cases.end.make({}), before: asks, after: [], twice: false });
          const rows = yield* all(Arr.map(asks, (ask) => ask.name));
          expect((yield* answers(name)).length, "L6: every valid start answers across a large checkpoint").toBe(
            before + asks.length,
          );

          for (const ask of asks) {
            const starts = Arr.filter(rows, (row) => row._tag === "started" && body(row)["name"] === ask.name);
            const letters = Arr.filter(rows, (row) => row.stream === `${ask.name}/inbox`);
            expect(starts, "L6: checkpoint size loses no valid start").toHaveLength(1);
            expect(letters, "L6: each input was written once").toHaveLength(1);
            expect(body(letters[0])["m"]).toBe(Str.repeat(ask.inputBytes)("x"));
          }

          expect(yield* exitedRows(held.pid), "L7: exit still follows every valid start").toHaveLength(1);
          held.live = false;
          seen.add("checkpoint_starts");
          break;
        }

        case "exit":
        case "cut_exit": {
          const name = choose(runnable(), cell.pick);
          // SAFETY: runnable() lists only names in world.names.
          const held = world.names.get(name) as Name;
          const before = Array.from({ length: cell.alt % 3 }, () => ({ program: "merger", name: fresh() }));
          const after = Array.from({ length: cell.shape % 3 }, () => ({ program: "merger", name: fresh() }));
          const twice = cell.shape % 2 === 0;

          const children = Arr.map(
            Arr.filter([...world.parents], ([, p]) => p === name),
            ([c]) => c,
          );

          if (move === "cut_exit") {
            world.fault.exited = true;
          }

          yield* door(name, { ...Tag.cases.end.make({}), before, after, twice });

          if (move === "cut_exit") {
            const hit = !world.fault.exited;
            world.fault.exited = false;
            const runner = yield* life.runner(name);

            // The cut exit is retried until it lands; it may never land twice.
            for (let round = 0; round < 4; round++) {
              const landed = (yield* exitedRows(held.pid)).length;
              expect(landed, "L7: a retried exit never writes twice").toBeLessThanOrEqual(1);

              if (landed > 0) {
                break;
              }

              yield* call(runner.due((yield* Clock.currentTimeMillis) + 1_000 * (round + 1)), `${name}'s retry`);
              yield* call(runner.msg(letter(ping)), `${name}'s nudge`);
            }

            seen.add(hit ? "cut_exit" : "cut_missed");
          }

          yield* sync(Arr.map([...before, ...after], (a) => ({ name: a.name, requester: held.pid })));
          const exits = yield* exitedRows(held.pid);
          expect(exits.length, `L7: ${name}'s exit writes one exited`).toBe(1);
          expect(body(exits[0])["reason"], "L7: exit ends its life with normal").toEqual(NORMAL);

          for (const a of before) {
            expect(yield* registered(a.name), "L7: a Cmd listed before exit is performed").toBe(true);
          }

          for (const a of after) {
            expect(yield* registered(a.name), "L7: a Cmd listed after exit is not performed").toBe(false);
          }

          held.live = false;
          const info = yield* inContext(ProcessManager.use((p) => p.info));
          expect(
            Arr.some(info, (row) => row.process === held.pid),
            "L7: info drops an exited life",
          ).toBe(false);

          for (const child of children) {
            const status = yield* inContext(ProcessManager.use((p) => p.status(child)));
            // SAFETY: each child the walk started is kept in world.names.
            const known = world.names.get(child) as Name;
            expect(status.state._tag, "L7: a requester's exit ends none of its children").toBe(
              known.live ? "live" : status.state._tag,
            );
          }

          for (const watch of Arr.filter(world.watches, (w) => w.target === held.pid)) {
            // SAFETY: a watch is made only with a watcher from world.names.
            const watcher = Option.getOrUndefined(
              Arr.findFirst([...world.names], ([, h]) => h.pid === watch.watcher),
            )?.[0] as string;

            const downs = Arr.filter(
              yield* all(),
              (e) =>
                e.stream === `${watcher}/inbox` &&
                Str.includes('"DOWN"')(JSON.stringify(body(e)["m"] ?? null)) &&
                // SAFETY: a DOWN letter's `m` is the DOWN, which carries its `ref`.
                (body(e)["m"] as { ref?: string } | undefined)?.ref === watch.ref,
            );

            expect(downs.length, "L7: each live watch gets one DOWN").toBe(1);
            // SAFETY: the filter above kept only DOWN letters, whose `m` carries its `reason`.
            expect((body(downs[0])["m"] as { reason?: unknown }).reason, "L7: the DOWN says normal").toEqual(NORMAL);
            seen.add("down");
          }

          world.watches.splice(
            0,
            world.watches.length,
            ...Arr.filter(world.watches, (w) => w.target !== held.pid && w.watcher !== held.pid),
          );
          const runner = yield* life.runner(name);
          yield* call(runner.due((yield* Clock.currentTimeMillis) + 60_000), `${name}'s alarm`);
          expect(
            Arr.filter(yield* all(), (e) => e._tag === "restarted" && body(e)["after"] === held.pid),
            "L7: nothing restarts a life that exited",
          ).toEqual([]);
          seen.add(before.length > 0 && after.length > 0 ? "exit_between_cmds" : "exit");

          if (children.length > 0) {
            seen.add("children_outlive");
          }

          break;
        }

        case "exit_extra": {
          const name = choose(runnable(), cell.pick);
          // SAFETY: runnable() lists only names in world.names.
          const held = world.names.get(name) as Name;

          const extra =
            cell.alt % 2 === 0
              ? { reason: choose(["kill", "shutdown", raw("crashed")], cell.shape) }
              : { [`x${cell.shape % 4}`]: cell.m };

          const before = (yield* answers(name)).length;
          yield* door(name, { ...Tag.cases.end.make({}), before: [], after: [], twice: false, extra });
          expect(yield* lastAnswer(name, before), "L8: exit's input takes no field").toEqual({
            type: "exit_err",
            outcome: "bad_cmd",
          });
          expect(yield* exitedRows(held.pid), "L8: a refused exit writes nothing").toEqual([]);
          seen.add("exit_extra");
          break;
        }

        case "after_exit": {
          const [name, held] = choose(
            Arr.filter([...world.names], ([, h]) => !h.live && RUNS.has(h.program)),
            cell.pick,
          );

          const stepped = (yield* inContext(savedModel(store, name, held.pid)))?.stepped;
          const runner = yield* life.runner(name);
          yield* call(runner.msg(letter(ping)), `${name}'s late letter`);
          expect(
            (yield* inContext(savedModel(store, name, held.pid)))?.stepped,
            "L7: no letter is stepped after exit",
          ).toBe(stepped);
          seen.add("after_exit");
          break;
        }

        case "watch": {
          const target = choose(runnable(), cell.pick);
          const watchers = Arr.filter([...world.names], ([n, h]) => h.live && n !== target);

          if (watchers.length === 0) {
            break;
          }

          const [, watcher] = choose(watchers, cell.alt);
          const ref = `ref-${++world.n}`;
          // SAFETY: target came from runnable(), which lists only names in world.names.
          const held = world.names.get(target) as Name;
          yield* ProcessManager.use((p) => p.monitor(ref, held.pid, brainFrom())).pipe(
            Effect.provide(
              ProcessManager.layer(
                {
                  by: "SHA256:brain",
                  owner: Owner.cases.process.make({ process: watcher.pid }),
                  recipient: Recipient.cases.process.make({ process: watcher.pid }),
                },
                next.next,
              ).pipe(Layer.provide(Layer.succeedContext(life.context))),
            ),
            Effect.orDie,
          );
          world.watches.push({ watcher: watcher.pid, target: held.pid, ref });
          break;
        }

        case "start_ended": {
          const name = choose(starters(), cell.pick);
          const target = choose(ended(), cell.alt);
          // SAFETY: ended() lists only names in world.names.
          const was = world.names.get(target) as Name;
          const before = (yield* answers(name)).length;
          const revBefore = yield* head;
          yield* door(name, { ...Tag.cases.start.make({}), ask: { program: was.program, name: target } });
          expect(
            yield* lastAnswer(name, before),
            "L7: an unsaved id for an ended child answers already_present",
          ).toMatchObject({
            type: "start_child_ok",
            outcome: Started.cases.already_present.make({ process: was.pid, name: target }),
          });
          expect(
            Arr.filter(
              Arr.filter(yield* all(), (e) => e.rev > revBefore),
              (e) => Str.startsWith("processes")(e.stream),
            ),
            "already_present writes nothing",
          ).toEqual([]);
          seen.add("already_present");
          break;
        }

        case "related_start": {
          // L1, L2: a drawn person with a role asks for any program, which no grant may name. The
          // sender is the one checked and the one recorded, never the requester's own member.
          const { person: sender, role } = choose(drawn(true), cell.sender);
          const name = requester(cell);
          // SAFETY: requester() picks from starters(), which lists only names in world.names.
          const held = world.names.get(name) as Name;
          const own = world.members.get(name);
          const program = choose(ANY_PROGRAM, cell.program);
          const target = fresh(program);
          const label = `${role} ${sender} asks ${name} for ${program}`;
          const before = (yield* answers(name)).length;
          yield* door(name, { ...Tag.cases.start.make({}), ask: { program, name: target } }, memberWriter(sender));
          const told = yield* lastAnswer(name, before);
          expect(told, `L1: ${label}: the start is allowed`).toMatchObject({ type: "start_child_ok" });
          expect(Schema.decodeUnknownOption(Started)(told.outcome)._tag, `L1: ${label}: Started's shape`).toBe("Some");
          expect(tagged(told.outcome), `L1: ${label}: a fresh name answers started`).toBe("started");
          yield* sync([{ name: target, requester: held.pid }]);
          expect(world.names.get(target)?.program, `L1: ${label}: the child runs that program`).toBe(program);
          expect(
            body(yield* startedLine(target))["member"],
            `L1, L2: ${label}: the started line names the sender as member`,
          ).toEqual(encodeSender(Sender.cases.person.make({ key: `SHA256:${sender}`, for: sender })));
          world.members.set(target, sender);
          seen.add(`related_${role}`);
          seen.add(`related_${program}`);

          if (own !== undefined && own !== sender) {
            seen.add("related_child");
          }

          break;
        }

        case "unrelated_start":
        case "removed_start": {
          // L1: a sender with no row is refused. L2: so is a sender whose key was removed, and
          // neither the program that asked, whose grant names `merger`, nor the requester's own
          // member, which holds start, lets either through.
          const kind = move === "removed_start" ? "removed" : "unrelated";
          const by = move === "removed_start" ? outsider : memberWriter(choose(drawn(false), cell.sender).person);
          const name = requester(cell);
          const program = choose(ANY_PROGRAM, cell.program);
          const target = fresh(program);
          const label = `${kind} ${by.for} asks ${name} for ${program}`;
          const before = (yield* answers(name)).length;
          const revBefore = yield* head;
          yield* door(name, { ...Tag.cases.start.make({}), ask: { program, name: target } }, by);
          expect(yield* lastAnswer(name, before), `L1, L2: ${label}: refused`).toEqual({
            type: "start_child_err",
            outcome: "forbidden",
          });
          expect(yield* processRows(revBefore), `L1, L2: ${label}: no process row`).toEqual([]);
          expect(yield* registered(target), `L1, L2: ${label}: no name registered`).toBe(false);
          expect(
            Arr.filter(yield* all([target]), (e) => e.stream === `${target}/inbox`),
            `L1, L2: ${label}: no first letter`,
          ).toEqual([]);
          seen.add(`${kind}_${program}`);

          if (world.members.has(name)) {
            seen.add(`${kind}_child`);
          }

          break;
        }

        case "stopper_start": {
          const name = choose(stoppers(), cell.pick);
          // SAFETY: stoppers() lists only names in world.names.
          const held = world.names.get(name) as Name;
          const target = fresh();
          const before = (yield* answers(name)).length;
          yield* door(name, { ...Tag.cases.start.make({}), ask: { program: "merger", name: target } });
          expect(tagged((yield* lastAnswer(name, before)).outcome), "L3: a stopper starts its child").toBe("started");
          yield* sync([{ name: target, requester: held.pid }]);
          seen.add("stopper_started");
          break;
        }

        case "stop_own": {
          // L3: OTP's terminate_child: the requester's own child ends with shutdown.
          const [target, child] = choose(stopperChildren(true), cell.alt);
          // SAFETY: stopperChildren() keeps only children whose parent is in world.parents.
          const name = world.parents.get(target) as string;
          const before = (yield* answers(name)).length;
          const was = yield* states();
          yield* door(name, { ...Tag.cases.stop.make({}), name: target });
          expect(yield* lastAnswer(name, before), "L3: a stop of its own child answers null").toEqual({
            type: "stop_child_ok",
            outcome: null,
          });
          const exits = yield* exitedRows(child.pid);
          expect(exits, "L3: the child's life ends once").toHaveLength(1);
          expect(body(exits[0])["reason"], "L3: a stopped child ends with shutdown").toEqual(SHUTDOWN);
          expect(
            (yield* inContext(ProcessManager.use((p) => p.status(target)))).state._tag,
            "L3: the stopped child is no longer live",
          ).not.toBe("live");
          const now = yield* states();

          for (const [other, state] of was) {
            if (other !== target) {
              expect(now.get(other), `L3: a stop ends only its target, not ${other}`).toBe(state);
            }
          }

          for (const watch of Arr.filter(world.watches, (w) => w.target === child.pid)) {
            // SAFETY: a watch is made only with a watcher from world.names.
            const watcher = Option.getOrUndefined(
              Arr.findFirst([...world.names], ([, h]) => h.pid === watch.watcher),
            )?.[0] as string;

            const downs = Arr.filter(
              yield* all(),
              (e) =>
                e.stream === `${watcher}/inbox` &&
                Str.includes('"DOWN"')(JSON.stringify(body(e)["m"] ?? null)) &&
                // SAFETY: a DOWN letter's `m` is the DOWN, which carries its `ref`.
                (body(e)["m"] as { ref?: string } | undefined)?.ref === watch.ref,
            );

            expect(downs.length, "L3: each watcher of a stopped child gets one DOWN").toBe(1);
            // SAFETY: the filter above kept only DOWN letters, whose `m` carries its `reason`.
            expect((body(downs[0])["m"] as { reason?: unknown }).reason, "L3: the DOWN says shutdown").toEqual(
              SHUTDOWN,
            );
            seen.add("down_shutdown");
          }

          world.watches.splice(
            0,
            world.watches.length,
            ...Arr.filter(world.watches, (w) => w.target !== child.pid && w.watcher !== child.pid),
          );
          child.live = false;
          seen.add("stopped_own");
          break;
        }

        case "stop_other": {
          // L3: any name but the requester's own children: another stopper's child, a boot process,
          // another stopper, or the requester itself.
          const name = choose(stoppers(), cell.pick);
          const others = Arr.filter([...world.names], ([n, h]) => h.live && world.parents.get(n) !== name);
          const [target, held] = choose(others, cell.alt);
          const before = (yield* answers(name)).length;
          const revBefore = yield* head;
          yield* door(name, { ...Tag.cases.stop.make({}), name: target });
          expect(yield* lastAnswer(name, before), `L3: ${name} may not stop ${target}`).toEqual({
            type: "stop_child_err",
            outcome: "not_child",
          });
          expect(yield* processRows(revBefore), "L3: a refused stop writes no process row").toEqual([]);
          expect(yield* exitedRows(held.pid), "L3: another's process keeps its life").toEqual([]);
          seen.add("not_child");
          break;
        }

        case "stop_ended": {
          const [target] = choose(stopperChildren(false), cell.alt);
          // SAFETY: stopperChildren() keeps only children whose parent is in world.parents.
          const name = world.parents.get(target) as string;
          const before = (yield* answers(name)).length;
          const revBefore = yield* head;
          yield* door(name, { ...Tag.cases.stop.make({}), name: target });
          expect(yield* lastAnswer(name, before), "L3: a stop of an ended child").toEqual({
            type: "stop_child_err",
            outcome: "noproc",
          });
          expect(yield* processRows(revBefore), "L3: a refused stop writes no process row").toEqual([]);
          seen.add("noproc");
          break;
        }

        case "retry_saved": {
          // A library caller asks a saved Cmd id again, after the child or the requester ended.
          const [id, saved] = choose([...world.starts], cell.pick);

          const answer = yield* inContext(
            Children.use((c) =>
              c.start(
                {
                  id,
                  name: saved.name,
                  code: { program: saved.program, hash: "another-build" },
                  requester: Recipient.cases.process.make({ process: saved.requester }),
                  // SAFETY: a saved start's input is its ask's, and the only input the walk's asks carry is `{ type: "ping" }`, a JSON value.
                  ...(saved.input === undefined ? {} : { input: saved.input as Schema.Json }),
                },
                brainFrom(),
              ),
            ),
          ).pipe(Effect.result);

          expect(
            Result.isSuccess(answer) ? answer.success : answer.failure,
            "L7, L3: the saved id still answers started",
          ).toEqual(Started.cases.started.make({ process: saved.process, name: saved.name, rev: saved.rev }));
          seen.add("retried");
          break;
        }
      }

      done.add(move);
    });

    // oxlint-disable-next-line fabrika/no-promises -- edge: fast-check owns the generated command walk
    yield* Effect.promise(() => fc.asyncModelRun(() => ({ model: world, real: { step } }), tape));
  });

const prop = (
  name: string,
  open: Effect.Effect<Store, never, Scope.Scope>,
  moves: ReadonlyArray<Move>,
  required: ReadonlyArray<Move>,
  answers: ReadonlyArray<string>,
  runs: Runs,
  people: fc.Arbitrary<ReadonlyArray<Drawn>> = NOBODY,
) =>
  // Live services: the walk runs on the real clock, as it did before it ran under this test's services.
  it.live(
    name,
    () =>
      Effect.gen(function* () {
        // oxlint-disable-next-line fabrika/no-effect-run-outside-edge -- edge: fast-check's async property runs each case under the test's own services
        const runPromise = Effect.runPromiseWith(yield* Effect.context<never>());
        const done = new Set<Move>();
        const seen = new Set<string>();
        const law = walk(open, moves, done, seen);
        // oxlint-disable-next-line fabrika/no-effect-run-outside-edge -- edge: fast-check awaits each tape
        const property = fc.asyncProperty(fc.tuple(people, Tape), (run) => runPromise(Effect.scoped(law(run))));
        const checks = { seed: SEED, numRuns: runsFor(runs), includeErrorInReport: true, endOnFailure: true };
        // oxlint-disable-next-line fabrika/no-promises -- edge: fast-check's async property answers a Promise
        yield* Effect.promise(() => fc.assert(property, checks));
        // An empty walk cannot pass: every move and every answer the law is about was reached.
        expect([...done].sort()).toEqual(expect.arrayContaining([...required].sort()));
        expect([...seen].sort()).toEqual(expect.arrayContaining([...answers].sort()));
      }),
    600_000,
  );

// --- L11: secrets stay out of Cmd answers, spans and logs ---------------------------------------

const capture = Effect.fnUntraced(function* (sql: Sql, makeTracer: Store["tracer"]) {
  const tracer = yield* makeTracer(sql);
  const lines: Array<string> = [];

  const logger = Logger.make((options) => {
    lines.push(Logger.formatSimple.log(options), Logger.formatLogFmt.log(options), Logger.formatJson.log(options));
  });

  // Inspect the real sink's saved span and failure content, including nested storage causes.
  const exported = () =>
    Arr.flatMap(sql.exec("SELECT row, content FROM unsent"), (row) => [
      JSON.stringify(row),
      String(row.row),
      String(row.content),
    ]);

  return { tracer, logger, lines, exported };
});

/** A secret-shaped sentinel: made up, never a real key. */
// Encoded forms differ on purpose; an alphanumeric sentinel alone cannot prove escaping checks.
const Secret = fc
  .tuple(fc.stringMatching(/^sk-[A-Za-z0-9]{24}$/), fc.constantFrom("", '"', "/%? ", "\n"))
  .map(([word, suffix]) => word + suffix);

const forms = (secret: string) => [secret, Str.slice(1, -1)(JSON.stringify(secret)), encodeURIComponent(secret)];

const secrets = (open: Effect.Effect<Store, never, Scope.Scope>, seen: Set<string>) =>
  Effect.fnUntraced(function* (secret: string, tape: Iterable<fc.AsyncCommand<object, Walk>>) {
    const store = yield* open;
    const next = ids(...PIDS);

    const world: World = {
      people: [],
      members: new Map(),
      names: new Map(),
      starts: new Map(),
      parents: new Map(),
      watches: [],
      fault: { exited: false, message: `SQLITE_FULL at ${secret}`, marker: secret },
      n: 0,
    };

    let scope = yield* Scope.make();
    yield* Effect.addFinalizer(() => Scope.close(scope, Exit.void));
    let life = yield* host(store, world, next.next, scope);

    for (const [name, program] of BOOT) {
      const started = yield* ProcessManager.use((p) =>
        p.start(Start.cases.first.make({ id: `boot:${name}`, name, code: { program, hash: BUILD } }), brainFrom()),
      ).pipe(Effect.provide(life.context), Effect.orDie);

      world.names.set(name, { program, pid: started.process, live: true });
    }

    const seenBy = yield* capture(store.sql("spans"), store.tracer);

    type Asked = {
      name: string;
      incoming: Incoming;
      kind: "answer" | "refusal" | "storage" | "checkpoint";
      before: number;
    };

    const pending = new Map<string, Asked>();
    const saved: Array<Asked> = [];
    const done = new Set<string>();

    const answers = (name: string) =>
      // SAFETY: answers is called only for names the walk started, and each start is kept in world.names.
      savedModel(store, name, world.names.get(name)?.pid as string).pipe(
        Effect.provide(life.context),
        Effect.map((model) => model?.answers ?? []),
      );

    const inspect = Effect.fnUntraced(function* (outcome: Exit.Exit<unknown, unknown>) {
      const outputs = [...seenBy.exported(), ...seenBy.lines];

      for (const name of world.names.keys()) {
        if (!RUNS.has(world.names.get(name)?.program ?? "")) {
          continue;
        }

        outputs.push(Formatter.formatJson(yield* answers(name)));
      }

      const rows = yield* store.entries(world.names.keys()).pipe(Effect.provide(life.context));
      // Keep the whole answer, including its Cmd echo, and the sink's stored failure content.
      outputs.push(
        ...Arr.map(
          Arr.filter(rows, (e) => Str.endsWith("/answer")(e.id)),
          (e) => JSON.stringify(body(e)),
        ),
      );

      if (Exit.isFailure(outcome)) {
        for (const reason of outcome.cause.reasons) {
          const error = Match.value(reason).pipe(
            Match.tag("Fail", (reason) => reason.error),
            Match.tag("Die", (reason) => reason.defect),
            Match.orElse(() => undefined),
          );

          if (error instanceof Error) {
            outputs.push(error.message);
          }
        }
      }

      for (const output of outputs) {
        for (const form of forms(secret)) {
          expect(Str.includes(form)(output), `L11: a secret reached an output: ${Str.slice(0, 200)(output)}`).toBe(
            false,
          );
        }
      }
    });

    const checkAnswer = Effect.fnUntraced(function* (ask: Asked) {
      if (ask.kind === "storage") {
        const rows = yield* store.entries(world.names.keys()).pipe(Effect.provide(life.context));
        expect(
          Arr.filter(rows, (e) => e._tag === "exited" && body(e)["process"] === world.names.get(ask.name)?.pid),
          "L11: the failed exit recovers exactly once",
        ).toHaveLength(1);
        // SAFETY: this ask's start was recorded in world.names when it was asked.
        const held = world.names.get(ask.name) as Name;
        held.live = false;

        return;
      }

      const told = yield* answers(ask.name);
      expect(told.length, `L11: ${ask.kind} for ${ask.name} was folded exactly once`).toBe(ask.before + 1);
      const rows = yield* store.entries([ask.name]).pipe(Effect.provide(life.context));
      expect(
        Arr.filter(rows, (e) => e.stream === `${ask.name}/inbox` && Str.endsWith("/answer")(e.id)).length,
        "L11: the start's whole answer row was written and inspected",
      ).toBeGreaterThan(0);

      if (ask.kind === "refusal") {
        expect(told.at(-1), "L11: the secret rode a refused start").toEqual({
          type: "start_child_err",
          outcome: "no_program",
        });
      } else {
        expect(told.at(-1), "L11: the secret rode a start that answered").toMatchObject({ type: "start_child_ok" });
        // SAFETY: the expect above matched the last answer as a start_child_ok, which holds an `outcome`.
        expect(tagged((told.at(-1) as { outcome: unknown }).outcome)).toBe("started");
      }
    });

    const step = Effect.fnUntraced(function* (cell: Cell) {
      const live = Arr.map(
        Arr.filter([...world.names], ([name, held]) => held.live && held.program === "starter" && !pending.has(name)),
        ([name]) => name,
      );

      const retries = Arr.filter(saved, (ask) => world.names.get(ask.name)?.live === true && !pending.has(ask.name));

      const available = [
        ...(live.length === 0
          ? []
          : saved.length === 0 && pending.size === 0
            ? ["answer"]
            : ["answer", "refusal", "storage", "checkpoint"]),
        ...(pending.size === 0 ? [] : ["recover"]),
        ...(retries.length === 0 ? [] : ["retry"]),
      ];

      if (available.length === 0) {
        return;
      }

      const missing = Arr.filter(available, (move) => !done.has(move));
      const move = choose(missing.length === 0 ? available : missing, cell.move);
      let ask: Asked;
      let outcome: Exit.Exit<unknown, unknown>;

      if (move === "recover") {
        ask = choose([...pending.values()], cell.pick);
        yield* Scope.close(scope, Exit.void);
        yield* store.reopen;
        scope = yield* Scope.make();
        life = yield* host(store, world, next.next, scope);
        const runner = yield* life.runner(ask.name);
        outcome = yield* (
          ask.kind === "checkpoint"
            ? runner.msg({
                ...ask.incoming,
                id: `letter-${++world.n}`,
                envelope: { ...ask.incoming.envelope, id: inputId(world.n), input: ping },
              })
            : runner.due((yield* Clock.currentTimeMillis) + 60_000)
        ).pipe(Effect.withTracer(seenBy.tracer), Effect.provide(Logger.layer([seenBy.logger])), Effect.exit);
        yield* inspect(outcome);
        expect(Exit.isSuccess(outcome), "L11: a fresh runner recovers the failed operation").toBe(true);
        yield* checkAnswer(ask);
        pending.delete(ask.name);

        if (ask.kind !== "storage") {
          saved.push(ask);
        }
      } else if (move === "retry") {
        ask = choose(retries, cell.pick);
        const before = yield* answers(ask.name);
        const runner = yield* life.runner(ask.name);
        outcome = yield* runner
          .msg(ask.incoming)
          .pipe(Effect.withTracer(seenBy.tracer), Effect.provide(Logger.layer([seenBy.logger])), Effect.exit);
        yield* inspect(outcome);
        expect(Exit.isSuccess(outcome), "L11: a saved letter may be retried").toBe(true);
        expect(yield* answers(ask.name), "L11: retry adds no answer").toEqual(before);
      } else {
        const name = choose(live, cell.pick);
        const n = ++world.n;

        const input =
          move === "storage"
            ? { ...Tag.cases.end.make({}), before: [], after: [], twice: false }
            : {
                ...Tag.cases.start.make({}),
                ask: {
                  program: move === "refusal" ? `nope-${secret}` : "merger",
                  name: `merger:${n}`,
                  ...(move === "refusal" ? {} : { input: { ...ping, token: secret, nested: cell.m } }),
                },
              };

        ask = {
          name,
          // SAFETY: the `recover` and `retry` branches above took those two moves, so move is answer, refusal, storage or checkpoint, the Asked kinds.
          kind: move as Asked["kind"],
          before: (yield* answers(name)).length,
          incoming: {
            id: `letter-${n}`,
            envelope: { id: inputId(n), by: person, arrivedAt: 1794099600000 + n, input },
            sentAt: "2026-11-11T01:00:00Z",
            seen: 0,
            span: { traceId: TRACE, spanId: "00f067aa0ba902b7" },
          },
        };

        if (move === "storage") {
          world.fault.exited = true;
        }

        if (move === "checkpoint") {
          world.fault.checkpointHit = false;
          world.fault.inputCheckpoint = secret;
        }

        const runner = yield* life.runner(name);
        outcome = yield* runner
          .msg(ask.incoming)
          .pipe(Effect.withTracer(seenBy.tracer), Effect.provide(Logger.layer([seenBy.logger])), Effect.exit);
        yield* inspect(outcome);

        if (move === "storage" || move === "checkpoint") {
          if (move === "storage") {
            expect(world.fault.exited, "L11: the exit's write met the storage failure").toBe(false);
          } else {
            expect(world.fault.checkpointHit, "L11: a checkpoint carrying the secret met the storage failure").toBe(
              true,
            );
            expect(Exit.isFailure(outcome), "L11: the failed checkpoint reaches the error output").toBe(true);
          }

          world.fault.exited = false;
          world.fault.inputCheckpoint = undefined;
          pending.set(name, ask);
        } else {
          expect(Exit.isSuccess(outcome)).toBe(true);
          yield* checkAnswer(ask);
          saved.push(ask);
        }
      }

      done.add(move);
      seen.add(move);
    });

    // oxlint-disable-next-line fabrika/no-promises -- edge: fast-check owns the generated command walk
    yield* Effect.promise(() => fc.asyncModelRun(() => ({ model: { world, saved, pending }, real: { step } }), tape));
    expect(done.size, "L11: the operation walk was not empty").toBeGreaterThan(0);
  });

const secretsLaw = (open: Effect.Effect<Store, never, Scope.Scope>) =>
  // Live services: the walk runs on the real clock, as it did before it ran under this test's services.
  it.live(
    "L11: a secret in a Cmd's operands or a storage cause stays out of Cmd answers, spans and logs",
    () =>
      Effect.gen(function* () {
        // oxlint-disable-next-line fabrika/no-effect-run-outside-edge -- edge: fast-check's async property runs each case under the test's own services
        const runPromise = Effect.runPromiseWith(yield* Effect.context<never>());
        const seen = new Set<string>();
        const law = secrets(open, seen);
        // oxlint-disable-next-line fabrika/no-effect-run-outside-edge -- edge: fast-check awaits each case
        const property = fc.asyncProperty(Secret, Tape, (x, tape) => runPromise(Effect.scoped(law(x, tape))));

        const checks = {
          seed: SEED,
          numRuns: runsFor({ fast: 10, full: 100 }),
          includeErrorInReport: true,
          endOnFailure: true,
        };

        // oxlint-disable-next-line fabrika/no-promises -- edge: fast-check's async property answers a Promise
        yield* Effect.promise(() => fc.assert(property, checks));
        expect([...seen].sort()).toEqual(["answer", "checkpoint", "recover", "refusal", "retry", "storage"]);
      }),
    600_000,
  );

// scenario: L13. Resource lifetime is one path, not a space to walk: one walk interrupted with
// its runners built must still give back every database handle its scope opened.
const lifetimeLaw = (open: Effect.Effect<Store, never, Scope.Scope>) =>
  it.effect("scenario: L13: an interrupted walk gives back every store and runner its scope acquired", () =>
    Effect.gen(function* () {
      let probe: Store["probe"] | undefined;
      let opened = 0;
      // Set once the walk holds its store and runner. A count of yields is no wait for real IO.
      const ready = yield* Deferred.make<void>();

      const held = Effect.scoped(
        Effect.gen(function* () {
          const store = yield* open;

          const world: World = {
            people: [],
            members: new Map(),
            // SAFETY: PIDS is a fixed list of ids, never empty.
            names: new Map([["starter:1", { program: "starter", pid: PIDS[0] as string, live: true }]]),
            starts: new Map(),
            parents: new Map(),
            watches: [],
            fault: { exited: false, message: "" },
            n: 0,
          };

          const scope = yield* Scope.make();
          yield* Effect.addFinalizer(() => Scope.close(scope, Exit.void));
          const life = yield* host(store, world, ids(...PIDS).next, scope);
          yield* ProcessManager.use((p) =>
            p.start(
              Start.cases.first.make({
                id: "boot:starter:1",
                name: "starter:1",
                code: { program: "starter", hash: BUILD },
              }),
              brainFrom(),
            ),
          ).pipe(Effect.provide(life.context), Effect.orDie);
          const runner = yield* life.runner("starter:1");
          yield* runner
            .msg({
              id: "letter-1",
              envelope: { id: inputId(1), by: person, arrivedAt: 1794099600001, input: ping },
              sentAt: "2026-11-11T01:00:00Z",
              seen: 0,
              span: { traceId: TRACE, spanId: "00f067aa0ba902b7" },
            })
            .pipe(Effect.result);
          opened = store.probe.open();
          probe = store.probe;
          yield* Deferred.succeed(ready, undefined);

          return yield* Effect.never;
        }),
      );

      const fiber = yield* Effect.forkChild(held);
      // The walk never ends on its own, so its join wins only when the walk fails before it is ready.
      yield* Effect.raceFirst(Deferred.await(ready), Fiber.join(fiber));
      yield* Fiber.interrupt(fiber);
      expect(probe, "the walk acquired its store and a runner").toBeDefined();
      expect(opened, "the walk had databases open when it was interrupted").toBeGreaterThan(0);
      expect(probe?.open(), "L13: no database handle outlives its scope").toBe(0);
    }),
  );

// The laws come in three suites, one test file each, so CI can run them on different machines. The
// boundary law alone took 210 s there (CI run 43615844695), and all of them together 482 to 531 s.
const TITLE = "P42 slice 1: start_child and exit on real runners";

/** L5, Desk S1's L1 to L3, L6's refusals, L8, L11 and L13. */
export const suite = (open: Effect.Effect<Store, never, Scope.Scope>) =>
  describe(TITLE, () => {
    prop(
      "L5: every start a start_child wrote keeps the life that ran the step as requester, never its letter's sender; extra fields are bad_cmd",
      open,
      ["door_start", "mail_start", "forged", "exit", "retry_saved"],
      ["door_start", "mail_start", "forged"],
      ["started", "mailed_start", "forged"],
      { fast: 20, full: 200 },
    );
    prop(
      "Desk S1 L1: a start a letter caused is started for any program when its sender holds owner, admin or member on the fabrika, and refused forbidden with nothing written when it holds none; no start grant is read, and the started line names the sender as member",
      open,
      ["related_start", "unrelated_start", "door_start", "mail_start"],
      ["related_start", "unrelated_start"],
      [
        ...Arr.map(["owner", "admin", "member"], (role) => `related_${role}`),
        ...Arr.map(ANY_PROGRAM, (program) => `related_${program}`),
        ...Arr.map(ANY_PROGRAM, (program) => `unrelated_${program}`),
      ],
      { fast: 20, full: 200 },
      People,
    );
    prop(
      "Desk S1 L2: the member checked is the sender of the start's parent, never the program that asked nor the requester's own member; a sender with no row or a removed key is forbidden even where the requester's grant or member would allow it",
      open,
      ["related_start", "unrelated_start", "removed_start"],
      ["related_start", "unrelated_start", "removed_start"],
      [
        "related_child",
        "unrelated_child",
        "removed_child",
        ...Arr.map(ANY_PROGRAM, (program) => `unrelated_${program}`),
        ...Arr.map(ANY_PROGRAM, (program) => `removed_${program}`),
      ],
      { fast: 20, full: 200 },
      People,
    );
    prop(
      "Desk S1 L3: stop_child ends only the requester's own child, with shutdown and one DOWN per watcher; another's is not_child, an ended one noproc",
      open,
      ["stopper_start", "stop_own", "stop_other", "stop_ended", "watch"],
      ["stopper_start", "stop_own", "stop_other", "stop_ended", "watch"],
      ["stopper_started", "stopped_own", "down_shutdown", "not_child", "noproc"],
      { fast: 10, full: 100 },
    );
    prop(
      "L6: bad_cmd, then no_program, then bad_name, then bad_input, each writing nothing; an undeclared Cmd writes nothing",
      open,
      ["door_start", "bad", "undeclared"],
      ["bad", "undeclared"],
      ["missing", "typed", "no_program", "bad_name", "bad_input", "undeclared"],
      { fast: 20, full: 200 },
    );
    prop(
      "L8: start_child and exit run only when declared, and both refuse extra fields as bad_cmd",
      open,
      ["forged", "exit_extra", "undeclared", "undeclared_exit", "door_start"],
      ["forged", "exit_extra", "undeclared", "undeclared_exit"],
      ["forged", "exit_extra", "undeclared", "undeclared_exit"],
      { fast: 10, full: 100 },
    );
    secretsLaw(open);
    lifetimeLaw(open);
  });

/** L7, its four exit orders, and L6's starts that an exit's checkpoint carries past one row. */
export const exitSuite = (open: Effect.Effect<Store, never, Scope.Scope>) =>
  describe(TITLE, () => {
    prop(
      "L7: exit ends only its own life with normal, after the Cmds before it and none after; watchers get one DOWN; children outlive it",
      open,
      ["door_start", "exit", "cut_exit", "after_exit", "watch", "start_ended", "retry_saved"],
      ["door_start", "exit", "cut_exit", "after_exit", "watch", "start_ended", "retry_saved"],
      ["exit", "exit_between_cmds", "down", "children_outlive", "already_present", "after_exit", "retried", "cut_exit"],
      { fast: 10, full: 100 },
    );

    for (const move of ["queued_exit", "interleaved_exit", "worker_before_exit", "worker_after_exit"] as const) {
      prop(
        `L7 ${move}: exit keeps its command order and survives a fresh runner`,
        open,
        [move],
        [move],
        move === "interleaved_exit" ? [move, "interleaved_alarm", "interleaved_letter"] : [move],
        { fast: 10, full: 100 },
      );
    }

    prop(
      "L6: individually valid starts survive a checkpoint larger than one platform row",
      open,
      ["checkpoint_starts"],
      ["checkpoint_starts"],
      ["checkpoint_starts"],
      { fast: 20, full: 200 },
    );
  });

/** L6 at the platform's row limit: a first letter just under it, whose full Cmd is over it. */
export const boundarySuite = (open: Effect.Effect<Store, never, Scope.Scope>) =>
  describe(TITLE, () => {
    prop(
      "L6: a valid first-letter row survives when its full command exceeds the row limit",
      open,
      ["boundary_start"],
      ["boundary_start"],
      ["boundary_start"],
      { fast: 20, full: 200 },
    );
  });
