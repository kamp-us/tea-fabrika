// P41 slice 2, next/. Exercise the public delivery layer at its RPC handles.
//
// Ticket 1041 (pipe plumbing) adds L13, written before the build: `MailReplies` (bindings.ts) gets a
// `full: { unread, cap }` case that `mailLayer` answers as `ProgramMailError { reason: "full" }`
// after it wakes the target, and the Project gets `processAck(process, pos, from)`, which binds the
// name from the live process it is given and takes no name of its own.
import { createHash } from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import { Machine } from "@demlik/tea/effect";
// R2 (sev1 of 2026-11-15): the gateway wakes a finished task's requester outside any span. A wake that
// required the caller's span died there, and the real Project answered that finish `unreachable`.
// Plant: read the span with `Effect.orDie` again; R2's untraced callers go red.
import { it, expect } from "@effect/vitest";
import { runsFor } from "@kampus/vitest";
import {
  Arbitrary,
  Cause,
  Context,
  Effect,
  Exit,
  Layer,
  Logger,
  References,
  Result,
  Schedule,
  Schema,
  Tracer,
} from "effect";
import * as fc from "fast-check";
import { nodeSql } from "../ledger/NodeSqlite.ts";
import { NORMAL, PIDS } from "../processes/Process.test-support.ts";
import { State } from "../processes/Process.ts";
import { type Delivery, ProgramMailError, type Receipt } from "../processes/ProgramMail.ts";
import { hash } from "../runtime/Built.ts";
import { ProgramLoader } from "../runtime/Entry.ts";
import { MailDelivery } from "../runtime/MailDelivery.ts";
import { MailWakeups, MailWakeupsError } from "../runtime/MailWakeups.ts";
import { Program } from "../runtime/Program.ts";
import * as RepliesTest from "../runtime/RepliesTest.ts";
import type { Descriptor } from "../runtime/Runner.ts";
import * as StartsTest from "../settings/StartsTest.ts";
import { mailLayer, wakeups } from "./mail.ts";
import { type Env, ProjectService, projectLayer } from "./runtime.ts";

/** The key of each Msg, Cmd and answer these laws write or expect, made by a schema (0569, 0562).
 *  A law hands over only the fields it reads, so a case holds the key alone. */
const Tag = Schema.TaggedUnion({
  request: {},
});

const Cases = fc.constantFrom(
  "no_name",
  "forbidden",
  "stale_sender",
  "bad_message",
  "id_reused",
  "storage",
  "transport",
  "undecodable",
);

const Refused = Schema.TaggedStruct("refused", { reason: Schema.String });

const delivery: Delivery = {
  command: "requester/1/0",
  source: { name: "requester:1", process: "requester" },
  to: "responder:1",
  m: { ...Tag.cases.request.make({}), ref: "r1", value: 7 },
  from: {
    by: "SHA256:fixture",
    for: "fixture",
    sentAt: "2026-11-11T00:00:00Z",
    seen: 0,
    parent: null,
    traceId: "4bf92f3577b34da6a3ce929d0e0e4736",
    build: "mail-test",
  },
};

it.effect("R1: RPC refusals keep their reason; failed transport and undecodable replies remain retryable", () =>
  Effect.gen(function* () {
    const check = Effect.fnUntraced(function* (choice: typeof Cases extends fc.Arbitrary<infer A> ? A : never) {
      let wakes = 0;
      // oxlint-disable-next-line fabrika/no-type-assertions -- edge: fake RPC handles supply only the methods this layer calls
      const env = {
        PROJECT: {
          getByName: () => ({
            mail: async () => {
              if (choice === "storage") {
                return Promise.reject(ProgramMailError.storage());
              }

              if (choice === "transport") {
                return Promise.reject(new Error("connection lost"));
              }

              return choice === "undecodable" ? { unexpected: true } : Refused.make({ reason: choice });
            },
          }),
        },
        PROCESS: {
          getByName: () => ({
            mailed: async () => {
              wakes++;
            },
          }),
        },
      } as unknown as Env;
      const result = yield* MailDelivery.use((mail) => mail.send(delivery)).pipe(
        Effect.provide(mailLayer(env, "mail-test")),
        Effect.result,
      );
      expect(Result.isFailure(result)).toBe(true);

      if (Result.isFailure(result)) {
        expect(result.failure.reason).toBe(
          ["storage", "transport", "undecodable"].includes(choice) ? "storage" : choice,
        );
      }

      expect(wakes, "no refused or unconfirmed delivery schedules a target").toBe(0);
    });
    const property = fc.asyncProperty(Cases, (choice) => Effect.runPromise(check(choice)));
    yield* Effect.promise(() => fc.assert(property, { seed: 119120, numRuns: 100 }));
  }),
);

// Receipt has no Schema; fast-check generates its fields at the RPC boundary.
const ReceiptFields = fc.record({
  id: fc.uuid(),
  command: fc.uuid(),
  target: fc.uuid(),
  ref: fc.uuid(),
  value: fc.integer(),
  arrivedAt: fc.nat(),
  rev: fc.nat(),
  pos: fc.nat(),
});

for (const flow of [
  {
    name: "T1b [secrets]: RPC records hold no mail",
    choices: fc.oneof(Cases, fc.constant("ok")),
    trace: false,
  },
  {
    name: "T1b: the wake carries the delivery trace",
    choices: fc.oneof(Cases, fc.constant("ok")),
    trace: true,
  },
  {
    name: "T1b [secrets]: Project mail rejections hold no mail",
    choices: fc.constant("mail_rejected"),
    trace: false,
  },
  {
    name: "T1b [secrets]: Process mailed rejections hold no mail",
    choices: fc.constant("mailed_rejected"),
    trace: true,
  },
]) {
  it.effect(flow.name, () =>
    Effect.gen(function* () {
      const check = Effect.fnUntraced(function* (
        fields: typeof ReceiptFields extends fc.Arbitrary<infer A> ? A : never,
        choice: string,
        seed: number,
        rejected: "error" | "text" | "object",
      ) {
        const secrets = yield* Arbitrary.sampleEffect(RepliesTest.sentinel, { seed, count: 1 });
        const secret = secrets[0]!;
        const receipt: Receipt = {
          id: fields.id,
          command: fields.command,
          source: delivery.source,
          to: {
            name: fields.target,
            state: State.cases.live.make({
              process: "process_01jc9q4w7zfm8s5r2t6v0xkb4d",
              code: { program: "responder", hash: "mail-test" },
            }),
          },
          m: { ...Tag.cases.request.make({}), ref: secret, value: fields.value },
          ref: fields.ref,
          grant: { source: delivery.source.name, to: fields.target },
          from: delivery.from,
          arrivedAt: fields.arrivedAt,
          rev: fields.rev,
          pos: fields.pos,
        };
        const rejection =
          rejected === "error"
            ? new Error(secret)
            : rejected === "text"
              ? secret
              : { message: secret, mail: receipt.m };
        const spans: Array<Tracer.Span> = [];
        const captured = RepliesTest.capture();
        const outputs: Array<string> = [];
        const logger = Logger.layer([
          Logger.make((options) => {
            // Effect 4 keeps a line's annotations on its fiber; a logger that throws would hide the line.
            const plain = (_: string, value: unknown) => (typeof value === "bigint" ? value.toString() : value);
            outputs.push(
              JSON.stringify(options.message, plain),
              JSON.stringify(options.fiber.getRef(References.CurrentLogAnnotations), plain),
              Cause.pretty(options.cause),
            );
          }),
        ]);
        const tracer = Tracer.make({
          span(options) {
            const span = captured.tracer.span(options);
            spans.push(span);
            return span;
          },
        });
        const wakes: Array<{ readonly traceId: string; readonly spanId: string } | undefined> = [];
        // oxlint-disable-next-line fabrika/no-type-assertions -- edge: fake RPC handles supply only the methods this layer calls
        const env = {
          PROJECT: {
            getByName: () => ({
              mail: async (_mail: unknown, ...args: ReadonlyArray<unknown>) => {
                outputs.push(JSON.stringify(args));

                if (choice === "mail_rejected") {
                  return Promise.reject(rejection);
                }

                if (choice === "transport" || choice === "storage") {
                  return Promise.reject(new Error("connection lost"));
                }

                if (choice === "undecodable") {
                  return { unexpected: receipt };
                }

                return choice === "ok" || choice === "mailed_rejected"
                  ? MailOk.make({ receipt })
                  : Refused.make({ reason: choice });
              },
            }),
          },
          PROCESS: {
            getByName: () => ({
              mailed: async (
                trace?: { readonly traceId: string; readonly spanId: string },
                ...args: ReadonlyArray<unknown>
              ) => {
                outputs.push(JSON.stringify([trace, ...args]));
                wakes.push(trace);

                if (choice === "mailed_rejected") {
                  return Promise.reject(rejection);
                }
              },
            }),
          },
        } as unknown as Env;
        const exit = yield* MailDelivery.use((mail) =>
          mail.send({ ...delivery, command: receipt.command, to: receipt.to.name, m: receipt.m }),
        ).pipe(
          Effect.provide(mailLayer(env, "mail-test")),
          Effect.withTracer(tracer),
          Effect.provide(logger),
          Effect.exit,
        );

        if (Exit.isFailure(exit)) {
          outputs.push(
            String(Cause.squash(exit.cause)),
            JSON.stringify(Cause.squash(exit.cause)),
            Cause.pretty(exit.cause),
          );
        }

        const sends = spans.filter((span) => span.name === "mail_delivery.send");
        expect(sends).toHaveLength(1);
        const sent = sends[0]!;
        expect(sent.status._tag).toBe("Ended");

        if (choice === "ok") {
          expect(Exit.isSuccess(exit)).toBe(true);

          if (Exit.isSuccess(exit)) {
            expect(exit.value.id).toBe(receipt.id);
          }

          if (flow.trace) {
            expect(wakes).toEqual([{ traceId: sent.traceId, spanId: sent.spanId }]);
          }
        } else {
          expect(Exit.isFailure(exit)).toBe(true);

          if (choice === "mailed_rejected") {
            expect(wakes).toEqual([{ traceId: sent.traceId, spanId: sent.spanId }]);
          } else {
            expect(wakes).toEqual([]);
          }

          if (Exit.isFailure(exit) && (choice === "mail_rejected" || choice === "mailed_rejected")) {
            const failure = Cause.squash(exit.cause);
            expect(failure).toMatchObject({ reason: choice === "mail_rejected" ? "storage" : "unavailable" });
          }
        }

        RepliesTest.unleaked([...outputs, ...captured.text()], secrets);
      });
      const property = fc.asyncProperty(
        ReceiptFields,
        flow.choices,
        fc.nat(),
        fc.constantFrom("error" as const, "text" as const, "object" as const),
        (fields, choice, seed, rejected) => Effect.runPromise(check(fields, choice, seed, rejected)),
      );
      yield* Effect.promise(() => fc.assert(property, { seed: 119120, numRuns: 100 }));
    }),
  );
}

const MailOk = Schema.TaggedStruct("ok", { receipt: Schema.Any });

// --- T1041 L13: `full` over the cloud wire, and the Project's ack ---------------------------------

const FullReply = Schema.TaggedStruct("full", { unread: Schema.Int, cap: Schema.Int });

it.effect(
  "T1041 L13: a full reply over the Project's mail call fails as full, after it wakes the target, whatever its counts",
  () =>
    Effect.gen(function* () {
      const reached = new Set<string>();
      const check = Effect.fnUntraced(function* (choice: "full" | "ok" | "forbidden", unread: number, cap: number) {
        const woken: Array<unknown> = [];
        // oxlint-disable-next-line fabrika/no-type-assertions -- edge: fake RPC handles supply only the methods this layer calls
        const env = {
          PROJECT: {
            getByName: () => ({
              mail: async () =>
                choice === "full"
                  ? FullReply.make({ unread, cap })
                  : choice === "ok"
                    ? MailOk.make({
                        receipt: {
                          id: `${delivery.command}/mail`,
                          command: delivery.command,
                          source: delivery.source,
                          to: {
                            name: delivery.to,
                            state: State.cases.live.make({
                              process: "process_01jc9q4w7zfm8s5r2t6v0xkb4d",
                              code: { program: "responder", hash: "mail-test" },
                            }),
                          },
                          m: delivery.m,
                          ref: "r1",
                          grant: { source: delivery.source.name, to: delivery.to },
                          from: delivery.from,
                          arrivedAt: 1,
                          rev: unread + 1,
                          pos: unread + 1,
                        },
                      })
                    : Refused.make({ reason: choice }),
            }),
          },
          PROCESS: {
            getByName: (key: string) => ({
              mailed: async () => {
                woken.push(key);
              },
            }),
          },
        } as unknown as Env;
        const result = yield* MailDelivery.use((mail) => mail.send(delivery)).pipe(
          Effect.provide(mailLayer(env, "mail-test")),
          Effect.result,
        );
        reached.add(choice);

        if (choice === "ok") {
          expect(Result.isSuccess(result), "a saved letter is queued").toBe(true);
          expect(woken, "a saved letter wakes its target once").toHaveLength(1);
          return;
        }

        expect(Result.isFailure(result), `a ${choice} reply is no receipt`).toBe(true);
        expect(Result.isFailure(result) ? result.failure.reason : null, "the reply's reason, unchanged").toBe(choice);

        if (choice === "full") {
          // A reader whose ack was lost reads again and acks, or a writer could wait forever.
          expect(woken, `a full inbox (${unread} of ${cap}) wakes its reader once`).toHaveLength(1);
        } else {
          expect(woken, "a refusal schedules no target").toEqual([]);
        }
      });
      const property = fc.asyncProperty(
        fc.constantFrom("full" as const, "full" as const, "ok" as const, "forbidden" as const),
        fc.nat({ max: 20_000 }),
        fc.integer({ min: 1, max: 16_384 }),
        (choice, unread, cap) => Effect.runPromise(check(choice, unread, cap)),
      );
      yield* Effect.promise(() => fc.assert(property, { seed: 119120, numRuns: 50 }));
      expect([...reached].sort()).toEqual(["forbidden", "full", "ok"]);
    }),
);

const COUNTER = "fabrika/counter";
const BRAIN_BUILD = "brain-build-test";

const START = StartsTest.fixture(
  {
    name: "project-test",
    person: "person_01m6v5270hf3c8x2q7w9z4k5mn",
    // A public key line made from 32 fixed bytes: no private key exists for it.
    founder: "ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIAcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcH",
    window: null,
    port: 18787,
    build: BRAIN_BUILD,
  },
  (algorithm, data) => createHash(algorithm.name.replaceAll("-", "").toLowerCase()).update(data).digest(),
);

const counter = () => {
  const machine = Machine.make({
    model: Schema.Struct({ count: Schema.Int }),
    msg: Schema.TaggedStruct("inc", {}),
    cmds: [],
    init: (kept) => [kept ?? { count: 0 }, []],
    update: { inc: (s) => [{ count: s.count + 1 }, []] },
  });
  const program = Program.make({
    name: COUNTER,
    machine,
    state: { v: 1, upgrades: [] },
    view: (s) => s,
    refuse: () => null,
    inputs: { inc: "Add" },
    outputs: {},
    writes: {},
    wake: () => null,
  });
  return ProgramLoader.use((loader) => loader.load(COUNTER)).pipe(
    Effect.provide(ProgramLoader.layer<never>({ [COUNTER]: program }, {})),
    Effect.map((loaded) => loaded.declaration),
  );
};

const brainOrigin: Parameters<ProjectService["Service"]["start"]>[1] = {
  by: "SHA256:brain",
  for: "brain",
  sentAt: "2026-11-15T00:00:00Z",
  seen: 0,
  parent: null,
  traceId: "4bf92f3577b34da6a3ce929d0e0e4736",
  build: BRAIN_BUILD,
};

const AckRow = Schema.fromJsonString(Schema.Struct({ process: Schema.String, pos: Schema.Int }));

/** One booted Project over in-memory SQLite, with `counter:1` started by the boot, as leave.laws boots it. */
const project = Effect.fnUntraced(function* () {
  const db = yield* Effect.acquireRelease(
    Effect.sync(() => new DatabaseSync(":memory:")),
    (db) => Effect.sync(() => db.close()),
  );
  const sql = nodeSql(db);
  const values = new Map<string, unknown>();
  // oxlint-disable-next-line fabrika/no-type-assertions -- Node fixture implements the platform members Project reads; only workerd can construct a full DurableObjectState
  const ctx = {
    id: { name: "project-test" },
    storage: {
      sql: {
        exec: sql.exec,
        get databaseSize() {
          return sql.size();
        },
      },
      transactionSync: sql.transaction,
      get: async (key: string) => values.get(key),
      put: async (key: string, value: unknown) => {
        values.set(key, value);
      },
    },
    exports: { IsolateTail: () => ({ fetch: () => Promise.resolve(new Response()) }) },
  } as unknown as DurableObjectState;
  const descriptors = new Map<string, Pick<Descriptor, "id" | "name" | "build" | "program">>();
  // oxlint-disable-next-line fabrika/no-type-assertions -- Node binding doubles implement only the RPC methods this composition calls, without workerd's nominal brands
  const env = {
    INSTANCE: JSON.stringify(START),
    PROJECT: { getByName: () => ({}) },
    PROCESS: {
      getByName: (key: string) => ({
        configure: async (d: Pick<Descriptor, "id" | "name" | "build" | "program">) => {
          descriptors.set(key, d);
        },
        descriptor: async (pid?: string) => {
          const d = descriptors.get(key)!;
          return { ...d, id: pid ?? d.id };
        },
        msg: async () => ({ _tag: "accepted", rev: 1, pos: 1 }),
        swap: async () => ({ _tag: "same" }),
        mailed: async () => {},
      }),
    },
    CONNECTION: { getByName: () => ({ ring: async () => {}, notify: async () => {}, probe: async () => 42 }) },
    RECORD: { getByName: () => ({ write: async () => ({ _tag: "written" }) }) },
    MEASUREMENTS: {},
    LOADER: {
      get: () => ({
        getEntrypoint: () => ({
          describe: () => Effect.runPromise(counter()),
        }),
      }),
    },
  } as unknown as Env;
  const source = "export default {};\n";
  const context = yield* Layer.build(
    projectLayer(ctx, env, {
      programs: { [COUNTER]: { hash: yield* hash(source), source } },
      bootstrap: [{ name: "counter:1", id: "counter:1", program: COUNTER }],
      door: () =>
        Effect.succeed(
          Object.fromEntries(
            [
              "connect",
              "challenge",
              "initialize",
              "target",
              "route",
              "knock",
              "grant",
              "disconnect",
              "sign",
              "append",
              "retire",
              "checkDelivery",
            ].map((method) => [
              method,
              () => (method === "retire" ? Effect.void : Effect.die(`not under test: ${method}`)),
            ]),
          ) as never,
        ),
    }),
  );
  // The build forks its configure calls (ticket 762): wait for the Project's record of them.
  yield* Effect.suspend(() =>
    sql.exec("SELECT process FROM dev_descriptors WHERE pending>0").length === 0
      ? Effect.void
      : Effect.fail("a start is not yet delivered to its object"),
  ).pipe(Effect.retry(Schedule.spaced("5 millis")), Effect.timeout("5 seconds"), Effect.orDie);
  return {
    project: Context.get(context, ProjectService),
    /** Every ack row the ledger holds for `name`, in log order. */
    acks: (name: string) =>
      sql
        .exec("SELECT body FROM entries WHERE stream=? ORDER BY rev", `processes/${name}/acked`)
        .map((row) => Schema.decodeUnknownSync(AckRow)(String(row.body))),
  };
});

it.effect(
  "T1041 L13: the Project's processAck moves the ack of the name whose live process asks, forward only, and a process that is not live moves nothing",
  () =>
    Effect.gen(function* () {
      const reached = new Set<string>();
      const walk = Effect.fnUntraced(function* (moves: ReadonlyArray<{ readonly move: number; readonly pos: number }>) {
        const i = yield* project();
        const live = i.project.boot.process;
        let running = true;
        // This file's fold: the newest pos an ack moved to.
        let acked = 0;

        for (const { move, pos } of moves) {
          const before = i.acks("counter:1");

          if (move % 4 === 3 && running) {
            yield* i.project.exit(live, NORMAL, brainOrigin);
            running = false;
            reached.add("exit");
            continue;
          }

          // A stranger: a process id no start in this walk reached.
          const asker = move % 4 === 2 ? (PIDS[30] as string) : live;
          yield* i.project.processAck(asker, pos, brainOrigin).pipe(Effect.result);
          const after = i.acks("counter:1");
          const lands = asker === live && running && pos > acked;
          reached.add(asker !== live ? "stranger" : !running ? "ended" : pos > acked ? "forward" : "behind");

          // The live process's ack is one row bound to it; one from behind, an ended life or a
          // stranger changes nothing.
          expect(
            after,
            `an ack at ${pos} from ${asker === live ? (running ? "the live life" : "an ended life") : "a stranger"}`,
          ).toEqual(lands ? [...before, { process: live, pos }] : before);
          acked = lands ? pos : acked;
        }
      });
      const property = fc.asyncProperty(
        fc.array(fc.record({ move: fc.nat({ max: 15 }), pos: fc.integer({ min: 1, max: 12 }) }), {
          minLength: 4,
          maxLength: 12,
        }),
        (moves) => Effect.runPromise(Effect.scoped(walk(moves))),
      );
      yield* Effect.promise(() =>
        fc.assert(property, { seed: 119120, numRuns: runsFor({ fast: 10, full: 50 }), endOnFailure: true }),
      );
      // An empty walk cannot pass: each kind of ack was asked for.
      expect([...reached]).toEqual(expect.arrayContaining(["behind", "ended", "exit", "forward", "stranger"]));
    }),
);

it.effect(
  "R2: a wake schedules its name once from any caller, with the caller's span as its trace or none, and fails only as unavailable",
  () =>
    Effect.gen(function* () {
      const reached = new Set<string>();
      const check = Effect.fnUntraced(function* (name: string, traced: boolean, rejects: boolean) {
        const objects: Array<string> = [];
        const traces: Array<unknown> = [];
        // oxlint-disable-next-line fabrika/no-type-assertions -- edge: fake RPC handles supply only the methods this layer calls
        const env = {
          PROCESS: {
            getByName: (object: string) => {
              objects.push(object);
              return {
                mailed: async (trace?: unknown) => {
                  traces.push(trace);

                  if (rejects) {
                    return Promise.reject(new Error("connection lost"));
                  }
                },
              };
            },
          },
        } as unknown as Env;
        const wake = MailWakeups.use((mail) => mail.wake(name)).pipe(
          Effect.provide(wakeups(env, "mail-test")),
          Effect.exit,
        );
        const [caller, exit] = traced
          ? yield* Effect.gen(function* () {
              const span = yield* Effect.currentSpan;
              return [{ traceId: span.traceId, spanId: span.spanId }, yield* wake] as const;
            }).pipe(Effect.withSpan("caller"))
          : ([undefined, yield* wake] as const);
        reached.add(`${traced ? "traced" : "untraced"}:${rejects ? "rejects" : "saves"}`);
        expect(objects, "the wake reaches its name's one object").toEqual([JSON.stringify(["mail-test", name])]);
        expect(traces, "the wake carries the caller's span, or no trace when it has none").toEqual([caller]);

        if (rejects) {
          expect(Exit.isFailure(exit) && Cause.squash(exit.cause), "a lost wake may be asked again").toBeInstanceOf(
            MailWakeupsError,
          );
        } else {
          expect(Exit.isSuccess(exit), "a saved wake answers").toBe(true);
        }
      });
      const property = fc.asyncProperty(
        fc.string({ minLength: 1 }),
        fc.boolean(),
        fc.boolean(),
        (name, traced, rejects) => Effect.runPromise(check(name, traced, rejects)),
      );
      yield* Effect.promise(() => fc.assert(property, { seed: 119120, numRuns: 100 }));
      // An empty run cannot pass: every caller and answer was met.
      expect([...reached].sort()).toEqual(["traced:rejects", "traced:saves", "untraced:rejects", "untraced:saves"]);
    }),
);
