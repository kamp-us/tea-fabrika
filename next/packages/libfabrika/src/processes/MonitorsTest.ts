// Program watch (docs/plan/quests/watch-PLAN.md), next/: laws M1, M4, M5 and M6 of the approved plan, on
// a real store (0062). A runner in the module that owns a driver calls `MonitorsTest.suite(open)`;
// `open` acquires one store in a scope (0061).
//
// The contract these laws pin, from the plan's "The service and its permission":
//   Monitors.ts: `Monitors.monitor(watch, from)`, where `watch` is `{ id, name, watcher }` and the
//     watcher is a process recipient, answers `monitored` with `ref`, `process` and `name`, or fails
//     `MonitorsError` with `forbidden`, `stale_sender`, `no_name`, `bad_name` or `storage`.
//   MonitorsLedger.ts: `layer({ fabrika })`, over the ledger, `ProcessManager`, `Relations` and
//     `Senders`, as `ChildrenLedger` is. It decides in order: `bad_name`; a saved watch under the ref
//     answers again; `stale_sender`; the member (the cause's sender, else the watcher's recorded
//     member) checked with `WatchProcess`, or with no member a related pair only, else `forbidden`;
//     `no_name`. Then one turn writes the `monitored` row (`ref` = the Cmd id, `process` = the name's
//     current life, `name`, `member`, `to` = the watcher), the answer message `<id>/answer` in the
//     watcher's inbox, and, for a life that is not live, a `DOWN` with `noproc` after it.
// The test plays the gateway: its `Senders` answers from the inputs the test delivered (0262). The
// oracle reads the store's own rows through `Ledger.read`, never the product's fold.
import { describe, expect, it } from "@effect/vitest";
import { runsFor } from "@kampus/vitest";
import * as Arbitrary from "effect/Arbitrary";
import * as Cause from "effect/Cause";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as Formatter from "effect/Formatter";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Predicate from "effect/Predicate";
import * as Schema from "effect/Schema";
import type * as Scope from "effect/Scope";
import * as Stream from "effect/Stream";
import * as Str from "effect/String";
import * as fc from "fast-check";
import { Doorbell, Ledger } from "../ledger/Ledger.ts";
import * as LedgerSql from "../ledger/LedgerSql.ts";
import * as LedgerTransactionSql from "../ledger/LedgerTransactionSql.ts";
import { Model } from "../permissions/Model.ts";
import * as Relation from "../permissions/Relation.ts";
import * as RelationsMemory from "../permissions/RelationsMemory.ts";
import { Sender, Senders, SendersError } from "../permissions/Senders.ts";
import type { Sql, SqlValue } from "../Sql.ts";
import { ExitReason } from "./ExitReason.ts";
import { type From, Mailbox } from "./Mailbox.ts";
import { Monitors, MonitorsError } from "./Monitors.ts";
import * as MonitorsLedger from "./MonitorsLedger.ts";
import { Down, NoProc, Owner, ProcessName, Recipient, Start } from "./Process.ts";
import { ProcessManager } from "./ProcessManager.ts";

/** One real store. */
export type Store = { readonly sql: Sql };

const SEED = 119120;

const BRAIN = "SHA256:brain";

const HASH = "build-a";

const FABRIKA = Model.ref("fabrika", "demo");

const FOUNDER = "person_01jcfounder0000000000000000";

const OTHER = "person_01jcother000000000000000000";

const TRACE = "4bf92f3577b34da6a3ce929d0e0e4736";

const PIDS: ReadonlyArray<string> = Array.from(
  { length: 40 },
  (_, n) => `process_0000000000e00a00${Str.padStart(10, "0")(String(n))}`,
);

type Holder = "founder" | "other";

/** A person's window, or an agent let in for that person. */
const senderFrom = (holder: Holder, as: "person" | "agent" = "person") => {
  const person = holder === "founder" ? FOUNDER : OTHER;

  return as === "person"
    ? Sender.cases.person.make({ key: `SHA256:window-${holder}`, for: person })
    : Sender.cases.agent.make({ key: `SHA256:agent-${holder}`, for: person });
};

const subjectFor = (person: string) => `person:${person}`;

/** The founder owns the fabrika; the other person holds `role`, or nothing. */
const rows = (role: "none" | "member" | "admin"): ReadonlyArray<Relation.Change> => [
  {
    id: "owner",
    row: Relation.Row.cases.related.make({ subject: subjectFor(FOUNDER), relation: "owner", object: FABRIKA }),
  },
  ...(role === "none"
    ? []
    : [
        {
          id: `other-${role}`,
          row: Relation.Row.cases.related.make({ subject: subjectFor(OTHER), relation: role, object: FABRIKA }),
        },
      ]),
];

/** 0170's first rule, applied to a watch: any member, owner and admins included, may watch. */
const allowed = (role: "none" | "member" | "admin", holder: Holder) => holder === "founder" || role !== "none";

const from = (parent: string | null): From => ({
  by: "SHA256:program-writer",
  for: FOUNDER,
  sentAt: "2026-11-15T10:00:01.000Z",
  seen: 0,
  parent,
  traceId: TRACE,
  build: "writer-build",
});

const quiet = Layer.succeed(Doorbell, { ring: () => Effect.void });

/** An input the test delivered, as the gateway keeps it. */
type Input = { readonly process: string; readonly sender: Sender; state: "live" | "removed" | "ended" };

/** The gateway's answer: none unless the input was delivered to that process. */
const gateway = (inputs: ReadonlyMap<string, Input>) =>
  Layer.succeed(Senders, {
    sender: (parent: string | null, process: string) =>
      Effect.suspend(() => {
        const input = parent === null ? undefined : inputs.get(parent);

        if (input === undefined || input.process !== process) {
          return Effect.succeedNone;
        }

        return input.state === "live"
          ? Effect.succeedSome(input.sender)
          : Effect.fail(new SendersError({ reason: input.state }));
      }),
  });

const ids = (values: ReadonlyArray<string>) => {
  let calls = 0;

  return Effect.sync(() => {
    const value = values[calls++];

    if (value === undefined) {
      throw new Error("test exhausted its process IDs");
    }

    return value;
  });
};

/** The real ledger, process manager and watch service on one Sql, with memory relations and the test's gateway. */
const stack = (sql: Sql, changes: ReadonlyArray<Relation.Change>, inputs: ReadonlyMap<string, Input>) => {
  const data = Layer.merge(LedgerSql.layer(sql, { reader: "connection:test" }), LedgerTransactionSql.layer(sql)).pipe(
    Layer.provide(quiet),
  );

  return MonitorsLedger.layer({ fabrika: FABRIKA }).pipe(
    Layer.provideMerge(
      ProcessManager.layer(
        {
          owner: Owner.cases.brain.make({}),
          recipient: Recipient.cases.client.make({ client: "window-a", session: PIDS[39] as string }),
          by: BRAIN,
        },
        ids(PIDS),
      ).pipe(Layer.provideMerge(Mailbox.layer.pipe(Layer.provideMerge(data)))),
    ),
    Layer.provideMerge(RelationsMemory.layer(changes)),
    Layer.provideMerge(gateway(inputs)),
  );
};

/** Every row of every table, so "nothing was written" covers whatever table a watch might use. */
const snapshot = (sql: Sql): Record<string, ReadonlyArray<Record<string, SqlValue>>> => {
  const tables = sql
    .exec("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name")
    .map((row) => String(row.name));

  return Object.fromEntries(tables.map((table) => [table, sql.exec(`SELECT * FROM "${table}"`)]));
};

/** One ledger row: its global rev, stream, id, tag and body. */
type Row = {
  readonly rev: number;
  readonly stream: string;
  readonly id: string;
  readonly tag: string;
  readonly body: unknown;
};

const decodeRef = Schema.decodeUnknownOption(Schema.Struct({ ref: Schema.String }));

/** A `send` row's DOWN, when its body is one. */
const decodeDown = Schema.decodeUnknownOption(Schema.Struct({ m: Down }));

const names = (body: unknown, ref: string) => Option.exists(decodeRef(body), (b) => b.ref === ref);

type Answer = Exit.Exit<{ readonly ref: string; readonly process: string; readonly name: string }, MonitorsError>;

/**
 * One store and its stack, built once so the memory relations keep what a law writes. `start`,
 * `exit`, `restart` and `down` play the brain's own supervision; `watch` is the call under test.
 */
const world = Effect.fnUntraced(function* (
  open: Effect.Effect<Store, never, Scope.Scope>,
  changes: ReadonlyArray<Relation.Change>,
) {
  const { sql } = yield* open;
  const inputs = new Map<string, Input>();
  const context = yield* Layer.build(stack(sql, changes, inputs));

  const run = <A, E>(effect: Effect.Effect<A, E, Monitors | ProcessManager | Ledger>) =>
    effect.pipe(Effect.provideContext(context));

  /** The rows of `streams`, read through the ledger, in the order the ledger took them. */
  const rows = (streams: ReadonlyArray<string>) =>
    run(
      Effect.forEach(
        streams,
        (stream) =>
          Ledger.use((ledger) => Stream.runCollect(ledger.read(stream, 0))).pipe(
            Effect.map((read) =>
              [...read].map((e): Row => ({
                rev: e.rev,
                stream,
                id: e.id,
                tag: e._tag,
                body: (e.body ?? {}) as Row["body"],
              })),
            ),
          ),
        { concurrency: 1 },
      ),
    ).pipe(
      Effect.orDie,
      Effect.map((parts) => parts.flat().sort((a, b) => a.rev - b.rev)),
    );

  let n = 0;

  const start = (name: string, options: { readonly requester?: string; readonly member?: Sender } = {}) =>
    run(
      ProcessManager.use((p) =>
        p.start(
          Start.cases.first.make({
            id: `start:${name}:${++n}`,
            name,
            code: { program: Str.split(name, ":")[0] ?? "program", hash: HASH },
            ...(options.requester === undefined
              ? {}
              : { requester: Recipient.cases.process.make({ process: options.requester }) }),
            ...(options.member === undefined ? {} : { member: options.member }),
          }),
          from(null),
        ),
      ),
    ).pipe(
      Effect.orDie,
      Effect.map((placed) => placed.process),
    );

  const exit = (process: string, reason: ExitReason = ExitReason.cases.normal.make({})) =>
    run(ProcessManager.use((p) => p.exit(process, reason, from(null)))).pipe(Effect.orDie);

  const restart = (name: string, after: string) =>
    run(
      ProcessManager.use((p) =>
        p.start(
          Start.cases.again.make({
            id: `again:${name}:${++n}`,
            name,
            code: { program: Str.split(name, ":")[0] ?? "program", hash: HASH },
            after,
            reason: "crashed",
          }),
          from(null),
        ),
      ),
    ).pipe(
      Effect.orDie,
      Effect.map((placed) => placed.process),
    );

  const down = (process: string) =>
    run(
      ProcessManager.use((p) =>
        p.down(process, { reason: "intensity", crashes: 6, until: 1_794_099_700_000 }, from(null)),
      ),
    ).pipe(Effect.orDie);

  /** Delivers an input to `process` as the gateway would, and answers its id. */
  const deliver = (process: string, sender: Sender, state: Input["state"] = "live") => {
    const id = `in-${process}-${++n}`;
    inputs.set(id, { process, sender, state });

    return id;
  };

  /** A watch as the runner makes it: this life is the watcher, a fresh Cmd id is the ref. */
  const watch = (watcher: string, name: string, parent: string | null, id = `${watcher}/${++n}/0`) =>
    run(
      Monitors.use((m) =>
        m.monitor({ id, name, watcher: Recipient.cases.process.make({ process: watcher }) }, from(parent)),
      ),
    ).pipe(
      Effect.exit,
      Effect.map((answer) => ({ id, answer: answer as Answer })),
    );

  return { sql, start, exit, restart, down, deliver, watch, rows };
});

type World = Effect.Success<ReturnType<typeof world>>;

/** The `monitored` rows the brain wrote for `ref`. */
const monitoredRows = (w: World, ref: string) =>
  Effect.map(w.rows(["processes"]), (rows) => rows.filter((row) => row.tag === "monitored" && names(row.body, ref)));

/** The rows a watch put in the watcher's inbox: its answer message, and the `DOWN`s for its ref. */
const inboxRows = (w: World, watcherName: string, ref: string) =>
  Effect.map(w.rows([`${watcherName}/inbox`]), (inbox) => ({
    answers: inbox.filter((row) => row.id === `${ref}/answer`),
    downs: inbox.filter(
      (row) => row.tag === "send" && Option.exists(decodeDown(row.body), (sent) => sent.m.ref === ref),
    ),
  }));

const refusal = (answer: Answer): string | undefined => {
  const error = Exit.isFailure(answer) ? Option.getOrUndefined(Cause.findErrorOption(answer.cause)) : undefined;

  return error instanceof MonitorsError ? error.reason : undefined;
};

const watched = (answer: Answer, label: string) => {
  expect(Exit.isSuccess(answer), `${label}; got ${Exit.isFailure(answer) ? Cause.pretty(answer.cause) : ""}`).toBe(
    true,
  );
  const value = Exit.isSuccess(answer) ? answer.value : expect.fail(label);
  expect(Predicate.isTagged(value, "monitored"), `${label}: the answer is monitored`).toBe(true);

  return value;
};

/** A refusal is `MonitorsError` with its reason, and writes nothing. */
const refused = (w: World, answer: Answer, before: ReturnType<typeof snapshot>, reason: string, label: string) => {
  expect(refusal(answer), `${label}: refused ${reason}`).toBe(reason);
  expect(snapshot(w.sql), `${label}: a refusal writes nothing`).toEqual(before);
};

const encodeSender = Schema.encodeSync(Sender);

// Effect Arbitrary has no fast-check adapter: one seed draws one value from the schema's own Arbitrary.
const generated = <S extends Schema.Top>(schema: S): fc.Arbitrary<S["Type"]> =>
  fc.nat().map((seed) => {
    // oxlint-disable-next-line fabrika/no-effect-run-outside-edge -- edge: fast-check's map takes a plain value, so one sample is drawn here
    const [value] = Effect.runSync(Arbitrary.sampleEffect(Arbitrary.schema(schema), { seed, count: 1 }));

    return value as S["Type"];
  });

/** A registered name the boot names never take. */
const Name = generated(ProcessName).filter((name) => !["watcher:1", "parent:1", "other:1"].includes(name));

const M1Case = fc.record({
  name: Name,
  restarts: fc.integer({ min: 0, max: 3 }),
  via: fc.constantFrom("sender", "recorded", "related"),
  as: fc.constantFrom<"person" | "agent">("person", "agent"),
});

type M1Case = typeof M1Case extends fc.Arbitrary<infer A> ? A : never;

/**
 * M1 on one case: a watch on a live name answers its current life under the Cmd's id, and writes one
 * `monitored` row with the name, the member it was checked against, and the watcher's life.
 */
const m1 = (open: Effect.Effect<Store, never, Scope.Scope>) =>
  Effect.fnUntraced(function* (c: M1Case) {
    const w = yield* world(open, rows("none"));
    const member = senderFrom("founder", c.as);
    const watcher = yield* w.start("watcher:1", c.via === "recorded" ? { member } : {});
    let life = yield* w.start(c.name, c.via === "related" ? { requester: watcher } : {});

    for (let k = 0; k < c.restarts; k++) {
      yield* w.exit(life, ExitReason.cases.crashed.make({ phase: "step" }));
      life = yield* w.restart(c.name, life);
    }

    const parent = c.via === "sender" ? w.deliver(watcher, member) : null;
    const { id, answer } = yield* w.watch(watcher, c.name, parent);
    const label = `M1: ${c.via} watch on ${c.name} after ${c.restarts} restarts`;
    const value = watched(answer, label);
    expect(value, `${label}: the answer names the ref, the current life and the name`).toMatchObject({
      ref: id,
      process: life,
      name: c.name,
    });
    const written = yield* monitoredRows(w, id);
    expect(written.length, `${label}: exactly one monitored row`).toBe(1);
    expect(written[0]?.body, `${label}: the row binds the current life for the watcher`).toMatchObject({
      ref: id,
      process: life,
      name: c.name,
      to: Recipient.cases.process.make({ process: watcher }),
    });

    if (c.via === "related") {
      expect(written[0]?.body, `${label}: a watch with no member records none`).not.toHaveProperty("member");
    } else {
      expect(written[0]?.body, `${label}: the row records the member it was checked against`).toMatchObject({
        member: encodeSender(member),
      });
    }

    const inbox = yield* inboxRows(w, "watcher:1", id);
    expect(inbox.answers.length, `${label}: one answer message in the watcher's inbox`).toBe(1);
    expect(inbox.downs, `${label}: a live life gets no DOWN`).toEqual([]);
  });

const M4Case = fc.record({
  name: Name,
  state: fc.constantFrom("live", "ended", "down", "never"),
  reason: generated(ExitReason),
});

type M4Case = typeof M4Case extends fc.Arbitrary<infer A> ? A : never;

/**
 * M4 on one case: a name whose current life ended or went down answers `monitored` with that life,
 * then one `DOWN noproc`, in that order and in one turn; a name never registered is `no_name`.
 */
const m4 = (open: Effect.Effect<Store, never, Scope.Scope>) =>
  Effect.fnUntraced(function* (c: M4Case) {
    const w = yield* world(open, rows("none"));
    const watcher = yield* w.start("watcher:1", { member: senderFrom("founder") });
    const life = c.state === "never" ? undefined : yield* w.start(c.name);

    if (life !== undefined && c.state !== "live") {
      yield* w.exit(life, c.reason);

      if (c.state === "down") {
        yield* w.down(life);
      }
    }

    const label = `M4: a ${c.state} name ${c.name}`;
    const before = snapshot(w.sql);
    const { id, answer } = yield* w.watch(watcher, c.name, null);

    if (life === undefined) {
      refused(w, answer, before, "no_name", label);

      return;
    }

    expect(watched(answer, label), `${label}: answers its current life`).toMatchObject({
      ref: id,
      process: life,
      name: c.name,
    });
    const inbox = yield* inboxRows(w, "watcher:1", id);
    expect(inbox.answers.length, `${label}: one answer message`).toBe(1);

    if (c.state === "live") {
      expect(inbox.downs, `${label}: no DOWN`).toEqual([]);

      return;
    }

    expect(inbox.downs.length, `${label}: one DOWN`).toBe(1);
    const down = Option.getOrUndefined(decodeDown(inbox.downs[0]?.body))?.m;
    expect(down, `${label}: the DOWN says noproc for that life`).toMatchObject({
      ref: id,
      process: life,
      reason: NoProc.make({}),
      to: Recipient.cases.process.make({ process: watcher }),
    });
    const answerRev = inbox.answers[0]?.rev ?? 0;
    const downRev = inbox.downs[0]?.rev ?? 0;
    expect(answerRev < downRev, `${label}: the answer comes before its DOWN`).toBe(true);
    // One turn: the monitored row, the answer and the DOWN, with no other turn's row between them.
    const turn = [(yield* monitoredRows(w, id))[0]?.rev ?? 0, answerRev, downRev];
    expect(Math.max(...turn) - Math.min(...turn), `${label}: the three rows are one turn`).toBe(2);
  });

const BAD_NAMES = [
  "",
  "Upper:1",
  "has space",
  "a/b",
  "client:x",
  "processes",
  "gateway",
  "-lead",
  Str.repeat(257)("x"),
];

const M5Case = fc
  .record({
    bad: fc.boolean(),
    badName: fc.constantFrom(...BAD_NAMES),
    stale: fc.constantFrom("no", "exited", "cause"),
    denied: fc.boolean(),
    via: fc.constantFrom("sender", "recorded"),
    missing: fc.boolean(),
    name: Name,
  })
  .filter((c) => c.bad || c.stale !== "no" || c.denied || c.missing);

type M5Case = typeof M5Case extends fc.Arbitrary<infer A> ? A : never;

/** The first refusal a case earns, in the plan's order. */
const firstRefusal = (c: M5Case) =>
  c.bad ? "bad_name" : c.stale !== "no" ? "stale_sender" : c.denied ? "forbidden" : "no_name";

/**
 * M5 on one case: a request that fails several checks gets the first refusal of `bad_name`,
 * `stale_sender`, `forbidden`, `no_name`, and writes nothing.
 */
const m5 = (open: Effect.Effect<Store, never, Scope.Scope>) =>
  Effect.fnUntraced(function* (c: M5Case) {
    const w = yield* world(open, rows("none"));
    const member = senderFrom(c.denied ? "other" : "founder");
    const watcher = yield* w.start("watcher:1", c.via === "recorded" ? { member } : {});

    if (!c.missing) {
      yield* w.start(c.name);
    }

    if (c.stale === "exited") {
      yield* w.exit(watcher);
    }

    const parent =
      c.via === "sender" || c.stale === "cause"
        ? w.deliver(watcher, member, c.stale === "cause" ? "ended" : "live")
        : null;

    const before = snapshot(w.sql);
    const { answer } = yield* w.watch(watcher, c.bad ? c.badName : c.name, parent);
    refused(w, answer, before, firstRefusal(c), `M5: ${Formatter.format({ ...c, name: c.bad ? c.badName : c.name })}`);
  });

const M6Case = fc.record({
  role: fc.constantFrom<"none" | "member" | "admin">("none", "member", "admin"),
  sender: fc.constantFrom<"none" | Holder>("none", "founder", "other"),
  recorded: fc.constantFrom<"none" | Holder>("none", "founder", "other"),
  as: fc.constantFrom<"person" | "agent">("person", "agent"),
  pair: fc.constantFrom("child", "starter", "unrelated"),
});

type M6Case = typeof M6Case extends fc.Arbitrary<infer A> ? A : never;

/**
 * M6 on one case: the member is the cause's sender, else the watcher's recorded member, and it is
 * checked with `WatchProcess`; with no member, only the watcher's own child or its starter may be
 * watched.
 */
const m6 = (open: Effect.Effect<Store, never, Scope.Scope>) =>
  Effect.fnUntraced(function* (c: M6Case) {
    const w = yield* world(open, rows(c.role));
    // The other key kind for the recorded member, so a sender and a recorded member never look alike.
    const recorded = c.recorded === "none" ? undefined : senderFrom(c.recorded, c.as === "person" ? "agent" : "person");
    const starter = c.pair === "starter" ? yield* w.start("parent:1") : undefined;

    const watcher = yield* w.start("watcher:1", {
      ...(starter === undefined ? {} : { requester: starter }),
      ...(recorded === undefined ? {} : { member: recorded }),
    });

    const target =
      c.pair === "child"
        ? { name: "child:1", life: yield* w.start("child:1", { requester: watcher }) }
        : c.pair === "starter"
          ? { name: "parent:1", life: starter as string }
          : { name: "other:1", life: yield* w.start("other:1") };

    const sender = c.sender === "none" ? undefined : senderFrom(c.sender, c.as);
    const parent = sender === undefined ? null : w.deliver(watcher, sender);
    const member = sender ?? recorded;
    const label = `M6: ${Formatter.format(c)}`;
    const before = snapshot(w.sql);
    const { id, answer } = yield* w.watch(watcher, target.name, parent);

    const ok =
      member === undefined ? c.pair !== "unrelated" : allowed(c.role, member.for === FOUNDER ? "founder" : "other");

    if (!ok) {
      refused(w, answer, before, "forbidden", label);

      return;
    }

    expect(watched(answer, label), `${label}: watches`).toMatchObject({ ref: id, process: target.life });
    const row = (yield* monitoredRows(w, id))[0]?.body;

    if (member === undefined) {
      expect(row, `${label}: no member is recorded`).not.toHaveProperty("member");
    } else {
      expect(row, `${label}: the member checked is the one recorded`).toMatchObject({ member: encodeSender(member) });
    }
  });

/** Runs one case per property run, each on a fresh store. */
const prop = <A>(
  name: string,
  arbitrary: fc.Arbitrary<A>,
  law: (c: A) => Effect.Effect<void, unknown, Scope.Scope>,
  examples: ReadonlyArray<[A]> = [],
) =>
  it.effect(
    name,
    () =>
      Effect.gen(function* () {
        const context = yield* Effect.context<never>();
        // oxlint-disable-next-line fabrika/no-effect-run-outside-edge -- edge: fast-check awaits each case
        const property = fc.asyncProperty(arbitrary, (c) => Effect.runPromiseWith(context)(Effect.scoped(law(c))));
        const checks = {
          seed: SEED,
          numRuns: runsFor({ fast: 25, full: 100 }),
          endOnFailure: true,
          examples: [...examples],
        };

        // oxlint-disable-next-line fabrika/no-promises -- edge: fast-check's async property answers a Promise
        yield* Effect.promise(() => fc.assert(property, checks));
      }),
    600_000,
  );

/** Runs the laws on the store `open` gives. */
export const suite = (open: Effect.Effect<Store, never, Scope.Scope>) =>
  describe("Program watch: the brain's Monitors service checks a watch and writes it in one turn", () => {
    // Plants: bind the name's first life, not its current one; drop `member` from the row.
    prop(
      "M1: a watch on a live name answers its current life under the Cmd's id, and writes one monitored row with the name, the member and the watcher",
      M1Case,
      m1(open),
      [[{ name: "tracker:1", restarts: 2, via: "recorded", as: "person" }]],
    );
    // Plants: answer `no_name` for an ended name; write the noproc DOWN before the answer.
    prop(
      "M4: an ended or down name answers its life, then one DOWN noproc, in one turn; a name never registered is no_name and writes nothing",
      M4Case,
      m4(open),
    );
    // Plant: check `no_name` before the permission step.
    prop(
      "M5: a request that fails several checks gets the first of bad_name, stale_sender, forbidden, no_name, and writes nothing",
      M5Case,
      m5(open),
      [
        // pinned: the plan's reason for the order, a denied member must not learn the name is missing.
        [{ bad: false, badName: "", stale: "no", denied: true, via: "sender", missing: true, name: "tracker:1" }],
        [{ bad: true, badName: "Upper:1", stale: "exited", denied: true, via: "recorded", missing: true, name: "x:1" }],
        [{ bad: false, badName: "", stale: "cause", denied: true, via: "sender", missing: false, name: "x:1" }],
      ],
    );
    // Plants: skip the check when there is no member; read the program's member, not the cause's sender.
    prop(
      "M6: a member WatchProcess allows may watch any name, a denied one is forbidden, and with no member only the watcher's child or starter",
      M6Case,
      m6(open),
      [
        // pinned: the plan's plant, a denied sender behind a program whose own member is allowed.
        [{ role: "none", sender: "other", recorded: "founder", as: "person", pair: "unrelated" }],
        // pinned: no member at all, and a pair that is not related.
        [{ role: "admin", sender: "none", recorded: "none", as: "agent", pair: "unrelated" }],
      ],
    );
  });
