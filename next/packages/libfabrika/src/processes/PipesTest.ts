// Pipe slice 1 (docs/plan/quests/pipe-PLAN.md), next/: laws P1, P2 and P3 of the approved plan, the
// brain's `Pipes` service on a real store (0062), written before the build. A runner in the module
// that owns a driver calls `PipesTest.suite(open)`; `open` acquires one store in a scope (0061).
//
// The contract these laws pin, from the plan's "What the brain records":
//   Pipes.ts: `Pipes.pipe(ask, from)`, where `ask` is `{id, from, to, requester}`: `from` is the
//     writer end `{name, program, output, hash, shape}`, `to` the reader end `{name, program, input,
//     hash, shape}`, and `requester` the asking process `{name, process}`. The runner fills `hash`
//     and `shape` from the loader. It answers `{_tag: "piped", pipe}` or `{_tag: "unfit", fit}`, or
//     fails `PipesError` with a `PipeRefusal` reason or `storage`.
//   PipesLedger.ts: `layer({ fabrika })`, over the ledger, `ProcessManager`, `Relations` and
//     `Senders`, as `ChildrenLedger` and `MonitorsLedger` are. It decides in the plan's order:
//     `bad_name`, a saved pipe under the id answers again, `stale_sender`, the member (the cause's
//     sender, else the requester's recorded member) checked with `PipePrograms`, else `forbidden`,
//     `no_output`, `no_input`, `name_taken`, `taken`, then the fit. One turn writes the `piped` row on
//     `pipes`, the `related pipes_to` row on the relation stream and the answer message
//     `<id>/answer` in the requester's inbox.
//   A port the program does not declare reaches the service as an end with no `shape` key: the
//     runner leaves `shape` out for a writer with no such output, and for a reader with no such
//     piped input or no DOWN input. That is how the service, whose refusal order puts the member
//     before the ports, learns a port is missing; the plan names the refusal and its place but not
//     the field, so this suite pins the smallest one. A `shape` of `null` is a port whose form could
//     not be written, which the fit answers as cannot tell.
// The test plays the gateway: its `Senders` answers from the inputs the test delivered (0262). The
// oracle reads the store's own rows through `Ledger.read`, never the product's fold.
import { describe, expect, it } from "@effect/vitest";
import { runsFor } from "@kampus/vitest";
import { Arbitrary, Cause, Effect, Exit, Layer, Option, Predicate, Schema, type Scope, Stream } from "effect";
import * as fc from "fast-check";
import { Doorbell, Ledger } from "../ledger/Ledger.ts";
import * as LedgerSql from "../ledger/LedgerSql.ts";
import * as LedgerTransactionSql from "../ledger/LedgerTransactionSql.ts";
import { Model } from "../permissions/Model.ts";
import * as Relation from "../permissions/Relation.ts";
import * as RelationsMemory from "../permissions/RelationsMemory.ts";
import { Sender, Senders, SendersError } from "../permissions/Senders.ts";
import type { Sql } from "../Sql.ts";
import { ExitReason } from "./ExitReason.ts";
import * as Fit from "./Fit.ts";
import { type From, Mailbox } from "./Mailbox.ts";
import { Pipes, PipesError } from "./Pipes.ts";
import * as PipesLedger from "./PipesLedger.ts";
import { Owner, ProcessName, Recipient, Start } from "./Process.ts";
import { ProcessManager } from "./ProcessManager.ts";

/** One real store. */
export type Store = { readonly sql: Sql };

const SEED = 119120;
const BRAIN = "SHA256:brain";
const FABRIKA = Model.ref("fabrika", "pipes");
const FOUNDER = "person_01jcfounder0000000000000000";
const OTHER = "person_01jcother000000000000000000";
const TRACE = "4bf92f3577b34da6a3ce929d0e0e4736";
const REQUESTER = "lab:1";

const PIDS: ReadonlyArray<string> = Array.from(
  { length: 40 },
  (_, n) => `process_0000000000e00b00${String(n).padStart(10, "0")}`,
);

type Holder = "founder" | "other";

const senderFrom = (holder: Holder, as: "person" | "agent" = "person") => {
  const person = holder === "founder" ? FOUNDER : OTHER;
  return as === "person"
    ? Sender.cases.person.make({ key: `SHA256:window-${holder}`, for: person })
    : Sender.cases.agent.make({ key: `SHA256:agent-${holder}`, for: person });
};

/** The founder owns the fabrika; the other person holds `role`, or nothing. */
const rows = (role: "none" | "member" | "admin"): ReadonlyArray<Relation.Change> => [
  {
    id: "owner",
    row: Relation.Row.cases.related.make({ subject: `person:${FOUNDER}`, relation: "owner", object: FABRIKA }),
  },
  ...(role === "none"
    ? []
    : [
        {
          id: `other-${role}`,
          row: Relation.Row.cases.related.make({ subject: `person:${OTHER}`, relation: role, object: FABRIKA }),
        },
      ]),
];

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

type Input = { readonly process: string; readonly sender: typeof Sender.Type; state: "live" | "removed" | "ended" };

/** The gateway's answer: none unless the input was delivered to that process. */
const gateway = (inputs: ReadonlyMap<string, Input>) =>
  Layer.succeed(Senders, {
    sender: (parent: string | null, process: string) =>
      Effect.suspend(() => {
        const input = parent === null ? undefined : inputs.get(parent);

        if (input === undefined || input.process !== process) {
          return Effect.succeed(Option.none());
        }

        return input.state === "live"
          ? Effect.succeed(Option.some(input.sender))
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

/** The real ledger, process manager and pipe service on one Sql, with memory relations and the test's gateway. */
const stack = (sql: Sql, changes: ReadonlyArray<Relation.Change>, inputs: ReadonlyMap<string, Input>) => {
  const data = Layer.merge(LedgerSql.layer(sql, { reader: "connection:test" }), LedgerTransactionSql.layer(sql)).pipe(
    Layer.provide(quiet),
  );
  return PipesLedger.layer({ fabrika: FABRIKA }).pipe(
    Layer.provideMerge(
      ProcessManager.layer(
        {
          owner: Owner.cases.brain.make({}),
          recipient: Recipient.cases.client.make({ client: "window-a", session: PIDS[39] ?? "" }),
          by: BRAIN,
        },
        ids(PIDS),
      ).pipe(Layer.provideMerge(Mailbox.layer.pipe(Layer.provideMerge(data)))),
    ),
    Layer.provideMerge(RelationsMemory.layer(changes)),
    Layer.provideMerge(gateway(inputs)),
  );
};

/** One ledger row: its global rev, stream, id, tag and body. */
type Row = {
  readonly rev: number;
  readonly stream: string;
  readonly id: string;
  readonly tag: string;
  readonly body: unknown;
};

// ---------------------------------------------------------------------------------------------
// The two ends' shapes, as the loader writes them.

const Str = Schema.String;
/** tracker's rows: `id`, `title` and `state`. */
const TRACKER = Fit.shape(Schema.Array(Schema.Struct({ id: Str, title: Str, state: Str })));
/** outline needs `id` and `title`: tracker's rows fit it. */
const OUTLINE = Fit.shape(Schema.Array(Schema.Struct({ id: Str, title: Str })));
/** board needs `column`, which tracker's rows have none of. */
const BOARD = Fit.shape(Schema.Array(Schema.Struct({ id: Str, column: Str })));
const TICKET = Fit.shape(Schema.Int.check(Schema.isGreaterThanOrEqualTo(1)));

type Shape = typeof TRACKER;
type End = { readonly name: string; readonly program: string; readonly hash: string; readonly shape?: Shape };

const encodeSender = Schema.encodeSync(Sender);

/** The pipe id a `piped` answer carries, or none for any other answer. */
const pipedId = (value: unknown): string | undefined =>
  Predicate.isTagged(value, "piped") && Predicate.hasProperty(value, "pipe") ? String(value.pipe) : undefined;

/**
 * One store and its stack, built once so the memory relations keep what a law writes. `start` and
 * `exit` play the brain's own supervision; `pipe` is the call under test, as the runner makes it.
 */
const world = Effect.fnUntraced(function* (
  open: Effect.Effect<Store, never, Scope.Scope>,
  changes: ReadonlyArray<Relation.Change>,
) {
  const { sql } = yield* open;
  const inputs = new Map<string, Input>();
  const context = yield* Layer.build(stack(sql, changes, inputs));
  const run = <A, E>(effect: Effect.Effect<A, E, Pipes | ProcessManager | Ledger>) =>
    effect.pipe(Effect.provideContext(context));
  const read = (streams: ReadonlyArray<string>) =>
    run(
      Effect.forEach(
        streams,
        (stream) =>
          Ledger.use((ledger) => Stream.runCollect(ledger.read(stream, 0))).pipe(
            Effect.map((got) =>
              [...got].map((e): Row => ({ rev: e.rev, stream, id: e.id, tag: e._tag, body: e.body ?? {} })),
            ),
          ),
        { concurrency: 1 },
      ),
    ).pipe(
      Effect.orDie,
      Effect.map((parts) => parts.flat().sort((a, b) => a.rev - b.rev)),
    );
  let n = 0;
  const start = (name: string, options: { readonly member?: typeof Sender.Type } = {}) =>
    run(
      ProcessManager.use((p) =>
        p.start(
          Start.cases.first.make({
            id: `start:${name}:${++n}`,
            name,
            code: { program: `fabrika/${name.split(":")[0] ?? "program"}`, hash: "build-a" },
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
  /** Delivers an input to `process` as the gateway would, and answers its id. */
  const deliver = (process: string, sender: typeof Sender.Type, state: Input["state"] = "live") => {
    const id = `in-${process}-${++n}`;
    inputs.set(id, { process, sender, state });
    return id;
  };
  /** A pipe as the runner asks for it: `requester` is the asking life, a fresh Cmd id unless given. */
  const pipe = (
    requester: string,
    writer: End & { readonly output: string },
    reader: End & { readonly input: string },
    parent: string | null,
    id = `${requester}/${++n}/0`,
  ) =>
    run(
      Pipes.use((p) =>
        p.pipe({ id, from: writer, to: reader, requester: { name: REQUESTER, process: requester } }, from(parent)),
      ),
    ).pipe(
      Effect.exit,
      Effect.map((answer) => ({ id, answer })),
    );
  const streams = (names: ReadonlyArray<string>) => [
    "pipes",
    Relation.STREAM,
    "processes",
    ...names.map((name) => `${name}/inbox`),
  ];
  return { start, exit, deliver, pipe, read, streams };
});

type World = Effect.Success<ReturnType<typeof world>>;
type Answer = Effect.Success<ReturnType<World["pipe"]>>["answer"];

const refusal = (answer: Answer): string | undefined => {
  const error = Exit.isFailure(answer) ? Option.getOrUndefined(Cause.findErrorOption(answer.cause)) : undefined;
  return error instanceof PipesError ? error.reason : undefined;
};

const answered = (answer: Answer, label: string) => {
  expect(Exit.isSuccess(answer), `${label}; got ${Exit.isFailure(answer) ? Cause.pretty(answer.cause) : ""}`).toBe(
    true,
  );
  return Exit.isSuccess(answer) ? answer.value : expect.fail(label);
};

/** The rows written since `before`, on `streams`. */
const since = (before: ReadonlyArray<Row>, after: ReadonlyArray<Row>) => {
  const seen = new Set(before.map((r) => `${r.stream}#${r.rev}`));
  return after.filter((r) => !seen.has(`${r.stream}#${r.rev}`));
};

/** A refused or unfit pipe writes nothing but, at most, its answer message in the requester's inbox. */
const wroteOnlyAnswer = (written: ReadonlyArray<Row>, id: string, label: string) => {
  const other = written.filter((r) => !(r.stream === `${REQUESTER}/inbox` && r.id === `${id}/answer`));
  expect(other, `${label}: writes nothing on the pipe, relation or process streams`).toEqual([]);
  expect(written.length, `${label}: at most one answer message`).toBeLessThanOrEqual(1);
};

// Effect Arbitrary has no fast-check adapter: one seed draws one value from the schema's own Arbitrary.
const generated = <S extends Schema.Top>(schema: S): fc.Arbitrary<S["Type"]> =>
  fc.nat().map((seed) => {
    // oxlint-disable-next-line fabrika/no-effect-run-outside-edge -- edge: fast-check's map takes a plain value, so one sample is drawn here
    const [value] = Effect.runSync(Arbitrary.sampleEffect(Arbitrary.schema(schema), { seed, count: 1 }));
    return value as S["Type"];
  });

/** A registered name the requester's name never takes. */
const Name = generated(ProcessName).filter((name) => name !== REQUESTER);

/** The two ends a pair pipes, and whether the reader's shape fits the writer's. */
const PAIRS = [
  { output: "rows", writer: TRACKER, input: "rows", reader: OUTLINE, fits: true },
  { output: "ticket", writer: TICKET, input: "ticket", reader: TICKET, fits: true },
  { output: "rows", writer: TRACKER, input: "any", reader: Fit.shape(Schema.Unknown), fits: true },
  { output: "rows", writer: TRACKER, input: "rows", reader: BOARD, fits: false },
] as const;

const P1Case = fc
  .record({
    writer: Name,
    reader: Name,
    pair: fc.constantFrom(...PAIRS.filter((p) => p.fits)),
    via: fc.constantFrom("sender", "recorded"),
    as: fc.constantFrom<"person" | "agent">("person", "agent"),
    role: fc.constantFrom<"none" | "member" | "admin">("none", "member", "admin"),
    holder: fc.constantFrom<Holder>("founder", "other"),
  })
  .filter((c) => c.writer !== c.reader && (c.holder === "founder" || c.role !== "none"));
type P1Case = typeof P1Case extends fc.Arbitrary<infer A> ? A : never;

/**
 * P1 on one case: a pipe that passes answers `piped` with its Cmd id, and one turn writes exactly one
 * `piped` row with every fact, one `related pipes_to` row and the answer message.
 */
const p1 = (open: Effect.Effect<Store, never, Scope.Scope>) =>
  Effect.fnUntraced(function* (c: P1Case) {
    const w = yield* world(open, rows(c.role));
    const member = senderFrom(c.holder, c.as);
    const requester = yield* w.start(REQUESTER, c.via === "recorded" ? { member } : {});
    const parent = c.via === "sender" ? w.deliver(requester, member) : null;
    const writer = {
      name: c.writer,
      program: "fabrika/tracker",
      output: c.pair.output,
      hash: "9c1e-tracker",
      shape: c.pair.writer,
    };
    const reader = {
      name: c.reader,
      program: "fabrika/outline",
      input: c.pair.input,
      hash: "d03b-outline",
      shape: c.pair.reader,
    };
    const before = yield* w.read(w.streams([REQUESTER]));
    const { id, answer } = yield* w.pipe(requester, writer, reader, parent);
    const label = `P1: ${JSON.stringify({ ...c, pair: c.pair.input })}`;
    expect(pipedId(answered(answer, label)), `${label}: answers piped under the Cmd id`).toBe(id);
    const written = since(before, yield* w.read(w.streams([REQUESTER])));
    const piped = written.filter((r) => r.stream === "pipes");
    const related = written.filter((r) => r.stream === Relation.STREAM);
    const answers = written.filter((r) => r.stream === `${REQUESTER}/inbox`);
    expect(
      piped.map((r) => r.tag),
      `${label}: exactly one piped row`,
    ).toEqual(["piped"]);
    expect(piped[0]?.body, `${label}: the row keeps every fact`).toEqual({
      pipe: id,
      from: writer,
      to: reader,
      rule: Fit.RULE,
      requester: { name: REQUESTER, process: requester },
      member: encodeSender(member),
    });
    expect(
      related.map((r) => [r.tag, r.body]),
      `${label}: one pipes_to row from the writer's name to the reader's`,
    ).toEqual([["related", { subject: `name:${c.writer}`, relation: "pipes_to", object: `name:${c.reader}` }]]);
    expect(
      answers.map((r) => r.id),
      `${label}: one answer message`,
    ).toEqual([`${id}/answer`]);
    // One turn: the three rows, with no other turn's row between them.
    const revs = [...piped, ...related, ...answers].map((r) => r.rev);
    expect(Math.max(...revs) - Math.min(...revs), `${label}: the three rows are one turn`).toBe(2);
    expect(
      written.filter((r) => r.stream === "processes"),
      `${label}: a pipe starts nothing`,
    ).toEqual([]);
  });

const BAD_NAMES = ["", "Upper:1", "has space", "a/b", "client:x", "processes", "gateway", "-lead"];

const STEPS = [
  "bad_name",
  "stale_sender",
  "forbidden",
  "no_output",
  "no_input",
  "name_taken",
  "taken",
  "unfit",
] as const;

type Step = (typeof STEPS)[number];

type P2Case = {
  readonly bad: "no" | "writer" | "reader" | "same";
  readonly badName: string;
  readonly stale: "no" | "exited" | "cause";
  readonly member: "allowed" | "denied" | "missing";
  readonly noOutput: boolean;
  readonly noInput: "no" | "input" | "down";
  readonly live: "no" | "writer" | "reader";
  readonly taken: boolean;
  readonly unfit: boolean;
  readonly writer: string;
  readonly reader: string;
};

/**
 * P2's cases, walked from the refusal that must come first: each check before it passes, it fails,
 * and each check after it fails or not as drawn, with one at least when one is left. So every
 * refusal in the order is drawn as the first, and the ones after it are what the order must hide.
 */
const P2Case: fc.Arbitrary<P2Case> = fc
  .record({
    first: fc.nat({ max: STEPS.length - 1 }),
    later: fc.array(fc.boolean(), { minLength: STEPS.length, maxLength: STEPS.length }),
    bad: fc.constantFrom<"writer" | "reader" | "same">("writer", "reader", "same"),
    badName: fc.constantFrom(...BAD_NAMES),
    stale: fc.constantFrom<"exited" | "cause">("exited", "cause"),
    member: fc.constantFrom<"denied" | "missing">("denied", "missing"),
    noInput: fc.constantFrom<"input" | "down">("input", "down"),
    live: fc.constantFrom<"writer" | "reader">("writer", "reader"),
    writer: Name,
    reader: Name,
  })
  .filter((d) => d.writer !== d.reader && d.writer !== "tracker:9" && d.reader !== "tracker:9")
  .map((d) => {
    const after = d.later.map((on, k) => k > d.first && on);
    const fails = after.some(Boolean) || d.first === STEPS.length - 1 ? after : after.map((_, k) => k === d.first + 1);
    const on = (k: number) => k === d.first || fails[k] === true;
    return {
      bad: on(0) ? d.bad : "no",
      badName: d.badName,
      stale: on(1) ? d.stale : "no",
      member: on(2) ? d.member : "allowed",
      noOutput: on(3),
      noInput: on(4) ? d.noInput : "no",
      live: on(5) ? d.live : "no",
      taken: on(6),
      unfit: on(7),
      writer: d.writer,
      reader: d.reader,
    };
  });

/** A case that passes every check but the fit. */
const PASSING: P2Case = {
  bad: "no",
  badName: "",
  stale: "no",
  member: "allowed",
  noOutput: false,
  noInput: "no",
  live: "no",
  taken: false,
  unfit: true,
  writer: "tracker:1",
  reader: "outline:1",
};

/** The first refusal a case earns, in the plan's order. */
const firstStep = (c: P2Case): Step =>
  c.bad !== "no"
    ? "bad_name"
    : c.stale !== "no"
      ? "stale_sender"
      : c.member !== "allowed"
        ? "forbidden"
        : c.noOutput
          ? "no_output"
          : c.noInput !== "no"
            ? "no_input"
            : c.live !== "no"
              ? "name_taken"
              : c.taken
                ? "taken"
                : "unfit";

/**
 * P2 on one case: an ask that fails more than one check gets the first refusal of the plan's order,
 * and writes nothing but, at most, its answer message.
 */
const p2 = (open: Effect.Effect<Store, never, Scope.Scope>, reached: Set<Step>) =>
  Effect.fnUntraced(function* (c: P2Case) {
    const w = yield* world(open, rows("none"));
    const requester = yield* w.start(REQUESTER, c.member === "allowed" ? { member: senderFrom("founder") } : {});
    const pair = c.unfit ? PAIRS[3] : PAIRS[0];

    if (c.taken) {
      // An earlier live pipe into the same reader name and input, from another writer.
      const earlier = yield* w.pipe(
        requester,
        { name: "tracker:9", program: "fabrika/tracker", output: "rows", hash: "h", shape: TRACKER },
        { name: c.reader, program: "fabrika/outline", input: pair.input, hash: "h", shape: OUTLINE },
        w.deliver(requester, senderFrom("founder")),
      );
      expect(Exit.isSuccess(earlier.answer), "P2: the earlier pipe is made").toBe(true);
    }

    if (c.live !== "no") {
      yield* w.start(c.live === "writer" ? c.writer : c.reader);
    }

    if (c.stale === "exited") {
      yield* w.exit(requester);
    }

    const parent =
      c.stale === "cause"
        ? w.deliver(requester, senderFrom("founder"), "ended")
        : c.member === "denied"
          ? w.deliver(requester, senderFrom("other"))
          : null;
    const writerName = c.bad === "writer" ? c.badName : c.writer;
    const readerName = c.bad === "reader" ? c.badName : c.bad === "same" ? writerName : c.reader;
    const writer = {
      name: writerName,
      program: "fabrika/tracker",
      output: pair.output,
      hash: "h-w",
      ...(c.noOutput ? {} : { shape: pair.writer }),
    };
    const reader = {
      name: readerName,
      program: "fabrika/outline",
      input: pair.input,
      hash: "h-r",
      ...(c.noInput !== "no" ? {} : { shape: pair.reader }),
    };
    const streams = w.streams([REQUESTER, c.writer, c.reader]);
    const before = yield* w.read(streams);
    const { id, answer } = yield* w.pipe(requester, writer, reader, parent);
    const expected = firstStep(c);
    const label = `P2: ${JSON.stringify({ ...c, expected })}`;

    if (expected === "unfit") {
      const value = answered(answer, label);
      expect(Predicate.isTagged(value, "unfit"), `${label}: answers unfit`).toBe(true);
      const fit = Predicate.hasProperty(value, "fit") ? value.fit : undefined;
      expect(Predicate.isTagged(fit, "does_not_fit"), `${label}: the verdict is does_not_fit`).toBe(true);
      expect(Predicate.hasProperty(fit, "path") ? fit.path : undefined, `${label}: the verdict says where`).toEqual([
        "[]",
        "column",
      ]);
    } else {
      expect(refusal(answer), `${label}: refused ${expected}`).toBe(expected);
    }

    wroteOnlyAnswer(since(before, yield* w.read(streams)), id, label);
    reached.add(expected);
  });

const P3Case = fc.record({
  retries: fc.integer({ min: 1, max: 5 }),
  pair: fc.constantFrom(...PAIRS.filter((p) => p.fits)),
});
type P3Case = typeof P3Case extends fc.Arbitrary<infer A> ? A : never;

/** P3 on one case: the same Cmd id asked again any number of times is one pipe. */
const p3 = (open: Effect.Effect<Store, never, Scope.Scope>) =>
  Effect.fnUntraced(function* (c: P3Case) {
    const w = yield* world(open, rows("none"));
    const requester = yield* w.start(REQUESTER, { member: senderFrom("founder") });
    const writer = {
      name: "tracker:1",
      program: "fabrika/tracker",
      output: c.pair.output,
      hash: "h-w",
      shape: c.pair.writer,
    };
    const reader = {
      name: "outline:1",
      program: "fabrika/outline",
      input: c.pair.input,
      hash: "h-r",
      shape: c.pair.reader,
    };
    const id = `${requester}/41/0`;
    const answers = [];

    for (let k = 0; k <= c.retries; k++) {
      answers.push((yield* w.pipe(requester, writer, reader, null, id)).answer);
    }

    const label = `P3: ${c.retries} retries`;

    for (const answer of answers) {
      expect(pipedId(answered(answer, label)), `${label}: every try answers the same pipe`).toBe(id);
    }

    const all = yield* w.read(w.streams([REQUESTER]));
    expect(all.filter((r) => r.stream === "pipes" && r.tag === "piped").length, `${label}: one piped row`).toBe(1);
    expect(all.filter((r) => r.stream === Relation.STREAM).length, `${label}: one relation row`).toBe(1);
    expect(all.filter((r) => r.id === `${id}/answer`).length, `${label}: one answer message`).toBe(1);
  });

/** Runs one case per property run, each on a fresh store. */
const prop = <A>(
  name: string,
  arbitrary: fc.Arbitrary<A>,
  law: (c: A) => Effect.Effect<void, unknown, Scope.Scope>,
  examples: ReadonlyArray<[A]> = [],
  after: () => void = () => undefined,
) =>
  it.effect(
    name,
    () =>
      Effect.gen(function* () {
        // oxlint-disable-next-line fabrika/no-effect-run-outside-edge -- edge: fast-check awaits each case
        const property = fc.asyncProperty(arbitrary, (c) => Effect.runPromise(Effect.scoped(law(c))));
        const checks = {
          seed: SEED,
          numRuns: runsFor({ fast: 25, full: 100 }),
          endOnFailure: true,
          examples: [...examples],
        };
        // oxlint-disable-next-line fabrika/no-promises -- edge: fast-check's async property answers a Promise
        yield* Effect.promise(() => fc.assert(property, checks));
        after();
      }),
    600_000,
  );

/** Runs the laws on the store `open` gives. */
export const suite = (open: Effect.Effect<Store, never, Scope.Scope>) =>
  describe("Pipe slice 1: the brain's Pipes service checks a pipe and records it in one turn", () => {
    // Plants: (a) drop `member` or `rule` from the row; (b) write the relation row in a second turn;
    // (c) keep only the writer's shape: P1 red.
    prop(
      "P1: a pipe that passes answers piped with its Cmd id and writes in one turn one piped row with every fact, one pipes_to row and the answer message",
      P1Case,
      p1(open),
      [
        [
          {
            writer: "tracker:1",
            reader: "outline:1",
            pair: PAIRS[0],
            via: "sender",
            as: "person",
            role: "none",
            holder: "founder",
          },
        ],
      ],
    );
    // Plant: check that the pipe fits before the member: P2 red.
    const reached = new Set<Step>();
    prop(
      "P2: an ask that fails more than one check gets the first of bad_name, stale_sender, forbidden, no_output, no_input, name_taken, taken, then unfit, and writes nothing but its answer message",
      P2Case,
      p2(open, reached),
      [
        // pinned: the plan's reason for the order, a denied member must not learn the shapes do not fit.
        [
          {
            bad: "no",
            badName: "",
            stale: "no",
            member: "denied",
            noOutput: false,
            noInput: "no",
            live: "no",
            taken: false,
            unfit: true,
            writer: "tracker:1",
            reader: "board:1",
          },
        ],
        // pinned: no member at all is forbidden: a pipe has no related-pair exception (0551).
        [
          {
            bad: "no",
            badName: "",
            stale: "no",
            member: "missing",
            noOutput: true,
            noInput: "no",
            live: "no",
            taken: false,
            unfit: false,
            writer: "tracker:1",
            reader: "outline:1",
          },
        ],
        // pinned: a pipe is made before its ends start (0550), and never fans in.
        [
          {
            bad: "no",
            badName: "",
            stale: "no",
            member: "allowed",
            noOutput: false,
            noInput: "no",
            live: "reader",
            taken: true,
            unfit: true,
            writer: "tracker:1",
            reader: "outline:1",
          },
        ],
        // Each refusal first at least once, whatever the draw, with every later check failing too.
        ...STEPS.map((_, k): [P2Case] => [
          {
            ...PASSING,
            ...(k <= 0 ? { bad: "same" as const } : {}),
            ...(k <= 1 ? { stale: "exited" as const } : {}),
            ...(k <= 2 ? { member: "missing" as const } : {}),
            ...(k <= 3 ? { noOutput: true } : {}),
            ...(k <= 4 ? { noInput: "down" as const } : {}),
            ...(k <= 5 ? { live: "writer" as const } : {}),
            ...(k <= 6 ? { taken: true } : {}),
          },
        ]),
      ],
      () => {
        // Coverage: every refusal in the order was the first one at least once.
        for (const step of STEPS) {
          expect(reached, `P2 reached ${step} first`).toContain(step);
        }
      },
    );
    // Plant: mint a new id per try: P3 red.
    prop(
      "P3: the same Cmd id asked again any number of times gives one piped row, one relation row and the same pipe id",
      P3Case,
      p3(open),
    );
  });
