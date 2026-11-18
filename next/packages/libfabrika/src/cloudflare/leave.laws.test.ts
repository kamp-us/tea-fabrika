// Ticket 979 (P18), next/. A socket's close ends its session's watches through the Project's own
// `leave`, called the way the brain's object calls it: `runtime.runPromise(p.leave(client,
// session))`, with no caller's span. The law runs the real Project composition over in-memory
// SQLite; only the platform's handles are doubles, and the door is a stub that hands the law the
// Project's own `monitor`, the call a window session's watch goes through. The expected watches are
// this file's own fold of the moves it made, never the Project's.
//
// Generator contract: each run boots one Project and walks it. Every move reads the watches the walk
// holds: a new watch for a session, a repeat of a held one, the one exit of the watched process,
// or the close of a session that holds watches or of one that holds none.
import { DatabaseSync } from "node:sqlite";
import { Machine } from "@demlik/tea/effect";
import { describe, expect, it } from "@effect/vitest";
import { runsFor } from "@kampus/vitest";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as Formatter from "effect/Formatter";
import * as Layer from "effect/Layer";
import * as Rec from "effect/Record";
import * as Schedule from "effect/Schedule";
import * as Schema from "effect/Schema";

import * as fc from "fast-check";
import { vi } from "vitest";
import { nodeSql } from "../ledger/NodeSqlite.ts";
import { NORMAL, PIDS } from "../processes/Process.test-support.ts";
import { Recipient } from "../processes/Process.ts";
import { hash } from "../runtime/Built.ts";
import { ProgramLoader } from "../runtime/Entry.ts";
import { Program } from "../runtime/Program.ts";
import type { Descriptor } from "../runtime/Runner.ts";
import * as StartsTest from "../settings/StartsTest.ts";
import { type Env, type ProjectDoorOptions, ProjectService, projectLayer } from "./runtime.ts";

vi.mock("cloudflare:workers", () => ({ WorkerEntrypoint: class {}, DurableObject: class {} }));

const SEED = 119120;

/** A Promise the law awaited rejected: fast-check's failed assertion. */
class Rejected extends Schema.TaggedError<Rejected, { readonly brand: unique symbol }>()("Rejected", {
  cause: Schema.Defect(),
}) {}

const rejected = (cause: unknown) => new Rejected({ cause });

const PROGRAM = "fabrika/counter";

const BRAIN_BUILD = "brain-build-test";

const CLIENTS = ["window-a", "window-b", "window-c"];

const REFS = ["watch-a", "watch-b", "watch-c"];

/** A session id is a process id. A walk's new sessions take `PIDS` from the front, and the
 * sessions that never held a watch take them from here on, so the two never meet. */
const NONE = 20;

const START = await Effect.runPromise(
  StartsTest.fixture({
    name: "project-test",
    person: "person_01m6v5270hf3c8x2q7w9z4k5mn",
    // A public key line made from 32 fixed bytes: no private key exists for it.
    founder: "ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIAcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcH",
    window: null,
    port: 18787,
    build: BRAIN_BUILD,
  }),
);

/** A watch's fact on the processes stream, as the law reads it back. */
const Fact = Schema.fromJsonString(
  Schema.Struct({
    ref: Schema.String,
    to: Schema.Struct({ client: Schema.optionalKey(Schema.String), session: Schema.optionalKey(Schema.String) }),
    reason: Schema.optionalKey(Schema.String),
  }),
);

/** A held watch's key in this file's fold: its client and its ref. */
const Key = Schema.fromJsonString(Schema.Tuple([Schema.String, Schema.String]));

/** The built-in counter as Worker Loader would run it. */
const SOURCE = "export default {};\n";

const declaration = () => {
  const machine = Machine.make({
    model: Schema.Struct({ count: Schema.Int }),
    msg: Schema.Struct({ type: Schema.Literal("inc") }),
    cmds: [],
    init: (kept) => [kept ?? { count: 0 }, []],
    update: { inc: (s) => [{ count: s.count + 1 }, []] },
  });

  const program = Program.make({
    name: PROGRAM,
    machine,
    state: { v: 1, upgrades: [] },
    view: (s) => s,
    refuse: () => null,
    inputs: { inc: "Add" },
    outputs: {},
    writes: {},
    wake: () => null,
  });

  return ProgramLoader.use((loader) => loader.load(PROGRAM)).pipe(
    Effect.provide(ProgramLoader.layer<never>({ [PROGRAM]: program }, {})),
    Effect.map((loaded) => loaded.declaration),
  );
};

const origin: Parameters<ProjectService["Service"]["start"]>[1] = {
  by: "SHA256:brain",
  for: "brain",
  sentAt: "2026-11-14T00:00:00Z",
  seen: 0,
  parent: null,
  traceId: "4bf92f3577b34da6a3ce929d0e0e4736",
  build: BRAIN_BUILD,
};

/** One booted Project over one SQLite database, with the door's `monitor` kept for the law. */
const instance = Effect.fnUntraced(function* () {
  const services = yield* Effect.context<never>();
  const db = yield* Effect.acquireRelease(
    Effect.sync(() => new DatabaseSync(":memory:")),
    (db) => Effect.sync(() => db.close()),
  );

  const sql = nodeSql(db);
  const values = new Map<string, unknown>();

  // SAFETY: the Project reads its name, SQL, key-value storage and tail exports, which this fixture gives.
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

  // SAFETY: the leave composition calls only these namespace methods: configure, descriptor, msg, swap, ring and notify.
  // oxlint-disable-next-line fabrika/no-type-assertions -- Node binding doubles implement only the RPC methods this composition calls, without workerd's nominal brands
  const env = {
    INSTANCE: Formatter.formatJson(START),
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
      }),
    },
    CONNECTION: { getByName: () => ({ ring: async () => {}, notify: async () => {}, probe: async () => 42 }) },
    RECORD: { getByName: () => ({ write: async () => ({ _tag: "written" }) }) },
    MEASUREMENTS: {},
    LOADER: {
      get: () => ({
        getEntrypoint: () => ({
          describe: () => Effect.runPromiseWith(services)(declaration()),
        }),
      }),
    },
  } as unknown as Env;

  const door = Rec.fromEntries(
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
      () => (method === "retire" ? Effect.void : Effect.die(`the door is not under test: ${method}`)),
    ]),
  );

  let monitor: ProjectDoorOptions["monitor"] | undefined;

  const context = yield* Layer.build(
    projectLayer(ctx, env, {
      programs: { [PROGRAM]: { hash: yield* hash(SOURCE), source: SOURCE } },
      bootstrap: [{ name: "counter:1", id: "counter:1", program: PROGRAM }],
      door: (options) => {
        monitor = options.monitor;

        // SAFETY: `door` above holds each door method the Project calls, built from a list of names, which loses its type.
        return Effect.succeed(door as never);
      },
    }),
  );

  // The build forks its configure calls (ticket 762): wait for the Project's record of them.
  yield* Effect.suspend(() =>
    sql.exec("SELECT process FROM dev_descriptors WHERE pending>0").length === 0
      ? Effect.void
      : Effect.fail("a start is not yet delivered to its object"),
  ).pipe(Effect.retry(Schedule.spaced("5 millis")), Effect.timeout("5 seconds"), Effect.orDie);
  const project = Context.get(context, ProjectService);

  return {
    project,
    monitor: monitor!,
    /** Every watch fact on the processes stream, in log order. */
    facts: (tag: "monitored" | "demonitored") =>
      sql
        .exec("SELECT body FROM entries WHERE stream='processes' AND _tag=? ORDER BY rev", tag)
        .map((row) => Schema.decodeUnknownSync(Fact)(String(row.body))),
  };
});

/**
 * Runs one Effect as the brain's object runs a socket's close: on a fresh runtime, so no caller's
 * span or fiber is there (apps/fabrika/src/brain.ts, `leave`).
 */
const closed = <A, E>(work: Effect.Effect<A, E>) =>
  // edge: a socket's close enters the Project as a plain RPC call, with no fiber of the caller's.
  Effect.tryPromise({ try: () => Effect.runPromiseExit(work), catch: rejected });

describe("ticket 979: a closed socket's leave ends its session's watches", () => {
  it.live(
    "a leave with no caller's span ends each live watch of that session once, and no watch that fired or is another session's",
    () =>
      // edge: fast-check answers its assertion through a Promise.
      Effect.tryPromise({
        catch: rejected,
        try: () =>
          fc.assert(
            fc.asyncProperty(fc.gen(), (g) =>
              Effect.runPromise(
                Effect.scoped(
                  Effect.gen(function* () {
                    const i = yield* instance();
                    const pid = i.project.boot.process;
                    // This file's fold: each session's watches, by client and ref. A watch made while the
                    // process runs is live; one whose process exited sent its DOWN, and is gone (OTP).
                    const held = new Map<string, Map<string, "live" | "fired">>();
                    let running = true;
                    let sessions = 0;
                    const steps = g(fc.integer, { min: 1, max: 12 });

                    for (let n = 0; n < steps; n++) {
                      const holders = [...held.keys()];
                      const move = g(fc.nat, { max: holders.length > 0 ? 10 : 5 });

                      if (move < 5) {
                        // A watch for a session: a held one again or a new one, sometimes on a ref it holds.
                        const reuse = holders.length > 0 && g(fc.boolean);
                        const session = reuse ? holders[g(fc.nat, { max: holders.length - 1 })]! : PIDS[sessions++]!;
                        const client = CLIENTS[g(fc.nat, { max: CLIENTS.length - 1 })]!;
                        const ref = REFS[g(fc.nat, { max: REFS.length - 1 })]!;
                        const to = Recipient.cases.client.make({ client, session });
                        expect(Exit.isSuccess(yield* Effect.exit(i.monitor(ref, pid, to, origin)))).toBe(true);
                        const watches = held.get(session) ?? new Map<string, "live" | "fired">();
                        const key = yield* Schema.encodeEffect(Key)([client, ref]);
                        watches.set(key, watches.get(key) ?? (running ? "live" : "fired"));
                        held.set(session, watches);
                      } else if (move === 5) {
                        // The watched process exits once: every watch on it fires its DOWN.
                        if (running) {
                          yield* i.project.exit(pid, NORMAL, origin);
                          running = false;

                          for (const watches of held.values()) {
                            for (const key of watches.keys()) {
                              watches.set(key, "fired");
                            }
                          }
                        }
                      } else {
                        // A close: a session that holds watches, or one that never held any.
                        const session = move < 10 ? holders[g(fc.nat, { max: holders.length - 1 })]! : PIDS[NONE + n]!;

                        const ending = [...(held.get(session) ?? [])]
                          .filter(([, state]) => state === "live")
                          .map(([key]) => Schema.decodeUnknownSync(Key)(key));

                        const before = i.facts("demonitored").length;
                        const client = CLIENTS[g(fc.nat, { max: CLIENTS.length - 1 })]!;
                        const exit = yield* closed(i.project.leave(client, session));
                        expect(exit, "the leave succeeds with no caller's span").toStrictEqual(Exit.void);
                        const written = i.facts("demonitored").slice(before);
                        expect(
                          written.map((f) => [f.to.client, f.ref, f.to.session, f.reason]).sort(),
                          "each live watch of the closed session ends once, as its watcher exited",
                        ).toEqual(ending.map(([c, ref]) => [c, ref, session, "watcher_exited"]).sort());
                        held.delete(session);
                      }
                    }

                    // A watch no leave ended has no demonitored fact: another session's close left it alone.
                    const ended = new Set(
                      i.facts("demonitored").map((f) => JSON.stringify([f.to.client, f.to.session, f.ref])),
                    );

                    const kept = [...held].flatMap(([session, watches]) =>
                      [...watches.keys()].map((key) => {
                        const [client, ref] = Schema.decodeUnknownSync(Key)(key);

                        return JSON.stringify([client, session, ref]);
                      }),
                    );

                    expect(kept.filter((key) => ended.has(key))).toEqual([]);
                  }),
                ),
              ),
            ),
            { seed: SEED, numRuns: runsFor({ fast: 10, full: 100 }), endOnFailure: true },
          ),
      }),
  );
});
