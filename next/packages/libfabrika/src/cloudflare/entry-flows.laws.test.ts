// P12, next/. The settings entry flows (L10, L16): saved and wire values enter the five real
// entries over in-memory platform handles. Split out of readers.laws.test.ts unchanged so each file
// stays under about 60 s on a CI leg.
import { DatabaseSync } from "node:sqlite";
import {
  DurableObjectState as ObjectState,
  fromDurableObjectState,
} from "@alchemy.run/cloudflare/Workers/DurableObjectState";
import { WorkerEnvironment } from "@alchemy.run/cloudflare/Workers/WorkerRuntime";
import { Context, Effect, Exit, Layer, Match, Option, Predicate, Schema, Scope, Tracer } from "effect";

import * as Digest from "effect/crypto/Digest";
import * as SecureRandom from "effect/crypto/SecureRandom";
import * as Signature from "effect/crypto/Signature";
import * as Base64Url from "effect/encoding/Base64Url";
import * as Formatter from "effect/Formatter";
import * as Str from "effect/String";
import { vi } from "vitest";
import { Writer } from "../coordination/index.ts";
import { nodeSql } from "../ledger/NodeSqlite.ts";
import { Start } from "../processes/Process.ts";
import * as StartsTest from "../settings/StartsTest.ts";
import type { Sql } from "../Sql.ts";
import { Chain } from "../telemetry/Trace.ts";
import { Attached } from "../transport/Wire.ts";
import type { GatewayCalls } from "./bindings.ts";
// Loading record.ts registers RecordPart's constructor, which the objects.ts mock below captures.
import "./record.ts";
import { ConnectionService, connectionRuntime } from "./connection.ts";
import { fetch } from "./fetch.ts";
import type { RecordShape } from "./objects.ts";
import { ProcessService, ProjectService, processRuntime, projectRuntime, settingsReply, type Env } from "./runtime.ts";
import * as SettingsTest from "./SettingsTest.ts";

class EntryFailure extends Schema.TaggedError<EntryFailure, { readonly brand: unique symbol }>()("EntryFailure", {
  cause: Schema.Defect(),
}) {}

const recordConstructor = vi.hoisted(() => {
  const slot: {
    value?: Effect.Effect<
      Effect.Effect<RecordShape, unknown, Scope.Scope>,
      unknown,
      ObjectState | WorkerEnvironment | Scope.Scope
    >;
  } = {};

  return slot;
});

// The Project keeps each built-in program by its hash, the SHA-256 of its source (`BuiltProgram`).
const FIXTURE = {
  hash: await Effect.runPromise(
    Digest.Digest.use((digest) => digest.digestHex(Digest.sha256, new TextEncoder().encode("fixture"))).pipe(
      Effect.provide(Digest.layerWebCrypto),
    ),
  ),
  source: "fixture",
};

/** A fresh Ed25519 public key in JWK's `x` form (base64url), from Effect's Signature on WebCrypto. */
const freshPublicKey = Signature.Signature.use((signature) => signature.generateKeyPair(Signature.ed25519)).pipe(
  Effect.flatMap(({ publicKey }) => Signature.toBytes(publicKey)),
  Effect.map(Base64Url.encode),
  Effect.provide(Signature.layerWebCrypto.pipe(Layer.provide(SecureRandom.layerWebCrypto))),
);

// SQL drivers throw at the synchronous platform boundary, before the service translates them.
const settingsExec =
  (base: Sql, failed: () => boolean, cause: Error, counted: (kind: "read" | "append") => void): Sql["exec"] =>
  (query, ...args) => {
    const settings = args.some((arg) => Predicate.isString(arg) && Str.startsWith("settings/instance/")(arg));

    if (settings && /SELECT \* FROM entries WHERE stream = \? AND rev > \?/i.test(query)) {
      counted("read");

      if (failed()) {
        throw cause;
      }
    }

    if (settings && /INSERT INTO entries/i.test(query)) {
      counted("append");
    }

    return base.exec(query, ...args);
  };

// Capture only Alchemy's constructor registration. The actual RecordPart implementation runs below.
vi.mock("./objects.ts", async (original) => {
  const actual = await original<typeof import("./objects.ts")>();
  const { Layer } = await import("effect");

  return {
    ...actual,
    RecordPart: {
      make: (implementation: NonNullable<typeof recordConstructor.value>) => {
        recordConstructor.value = implementation;

        return Layer.empty;
      },
    },
  };
});

// The suite owns the moves and assertions; this caller owns SQLite and the platform handles.
SettingsTest.suite((recipe, secret) =>
  Effect.gen(function* () {
    const Starts = yield* Effect.promise(() => import("../settings/Starts.ts"));
    const SettingsStartsLedger = yield* Effect.promise(() => import("./SettingsStartsLedger.ts"));
    // Each Process object's descriptor, kept across a reopen as the object's own storage keeps it.
    const configured = new Map<string, unknown>();

    const captured: Record<SettingsTest.Channel, unknown[]> = {
      transport: [],
      ledger: [],
      descriptors: [],
      "record RPC": [],
      spans: [],
      content: [],
      archives: [],
      "HTTP replies": [],
      "RPC failures": [],
      stdout: [],
      stderr: [],
      logs: [],
      "span attributes": [],
    };

    let fault: SettingsTest.Fault = "none";
    let calls = 0;
    let reads = 0;
    let appends = 0;
    let consumers = 0;
    const databases: DatabaseSync[] = [];
    const key = yield* freshPublicKey;

    let input = {
      ...(yield* StartsTest.input(recipe)),
      founding: { person: "person_01m6v5270hf3c8x2q7w9z4k5mn", founder: key, window: null },
    };

    captured.transport.push(Formatter.formatJson(input));
    const lower = new Error(secret, { cause: { password: secret } });

    const database = Effect.acquireRelease(
      Effect.sync(() => {
        const db = new DatabaseSync(":memory:");
        databases.push(db);

        return db;
      }),
      (db) => Effect.sync(() => db.close()),
    );

    const local = yield* database;
    const rawSql = nodeSql(local);

    const settingsSql = {
      ...rawSql,
      exec: settingsExec(
        rawSql,
        () => fault === "storage",
        lower,
        (kind) => {
          if (kind === "read") {
            reads++;
          } else {
            appends++;
          }
        },
      ),
    };

    const startsContext = yield* Layer.build(SettingsStartsLedger.layer(settingsSql));
    const starts = Context.get(startsContext, Starts.Starts);

    const gate = Effect.fnUntraced(function* (wire: unknown) {
      calls++;
      captured.transport.push(wire);

      if (fault === "unreachable") {
        return yield* Effect.fail(lower);
      }

      if (fault === "malformed") {
        return { placed: true };
      }

      // SAFETY: `wire` is the frame a law just generated as a settings start, so it has the `StartsTest.Input` shape.
      const work =
        fault === "refused"
          ? Effect.fail(new Starts.StartsError({ reason: new Starts.Refused({ cause: lower }) }))
          : starts.record(wire as StartsTest.Input);

      const reply = yield* settingsReply(work);
      captured[reply._tag === "ok" ? "transport" : "RPC failures"].push(reply);

      if (fault === "lost") {
        return yield* Effect.fail(lower);
      }

      return reply;
    });

    yield* Effect.acquireRelease(
      Effect.sync(() => {
        const attribute = Tracer.NativeSpan.prototype.attribute;

        const spies = [
          vi.spyOn(Tracer.NativeSpan.prototype, "attribute").mockImplementation(function (
            this: Tracer.NativeSpan,
            key,
            value,
          ) {
            captured["span attributes"].push({ key, value });

            return Reflect.apply(attribute, this, [key, value]);
          }),
          vi.spyOn(process.stdout, "write").mockImplementation((chunk) => {
            captured.stdout.push(String(chunk));

            return true;
          }),
          vi.spyOn(process.stderr, "write").mockImplementation((chunk) => {
            captured.stderr.push(String(chunk));

            return true;
          }),
          ...(["log", "info", "warn", "error", "debug"] as const).map((method) =>
            vi.spyOn(console, method).mockImplementation((...args) => {
              captured.logs.push(args);
            }),
          ),
        ];

        return spies;
      }),
      (spies) =>
        Effect.sync(() => {
          for (const spy of spies) {
            spy.mockRestore();
          }
        }),
    );

    const open: SettingsTest.Driver["open"] = Effect.fnUntraced(function* (path, corrupt) {
      const context = yield* Effect.context<never>();
      const config = { ...input, ...input.founding, port: Number(input.settings.values["instance.port"]) };
      const db = path === "Project" ? local : yield* database;
      const sql = path === "Project" ? settingsSql : nodeSql(db);
      const values = new Map<string, unknown>();
      values.set("descriptor", {
        id: "process-fixture",
        name: "worker",
        program: "fixture",
        build: input.build,
        owner: Writer.cases.person.make({ key: "fixture-writer", for: input.founding.person }),
      });
      const encoded = Formatter.formatJson(corrupt === undefined ? input : StartsTest.corrupt(input, corrupt, secret));

      let attached = Attached.cases.online.make({
        client: "fixture-client",
        identity: { key: "fixture-public", person: input.founding.person, as: "window" },
        version: 1,
        waits: [],
        watching: false,
        busy: false,
      });

      // SAFETY: the hibernating socket code calls only the attachment pair, `send` and `close`, which this double has.
      // oxlint-disable-next-line fabrika/no-type-assertions -- edge: Node supplies hibernating socket methods without workerd's nominal brand
      const socket = {
        deserializeAttachment: () => attached,
        serializeAttachment: (next: typeof attached) => {
          attached = next;
        },
        send: (frame: string) => {
          captured.transport.push(frame);
        },
        close: () => {},
      } as unknown as WebSocket;

      // Only platform handles are doubled. The five consumer implementations run unchanged.
      // SAFETY: the five entries call only the object's id, its SQL storage, key-value storage, alarms and sockets, all doubled below.
      // oxlint-disable-next-line fabrika/no-type-assertions -- edge: Node supplies only the storage and socket members these entries call
      const ctx = {
        id: {
          name: Match.value(path).pipe(
            Match.when("Process", () => Formatter.formatJson([input.name, "worker"])),
            Match.when("RecordPart", () => Formatter.formatJson([input.name, "spans/0"])),
            Match.orElse(() => input.name),
          ),
        },
        storage: {
          sql: {
            exec: (query: string, ...args: Parameters<typeof sql.exec> extends [string, ...infer A] ? A : never) => {
              if (/CREATE TABLE IF NOT EXISTS (unsent|spans|content|process_state)/i.test(query)) {
                consumers++;
              }

              return sql.exec(query, ...args);
            },
            get databaseSize() {
              return sql.size();
            },
          },
          transactionSync: sql.transaction,
          get: async (name: string) => {
            consumers++;

            return values.get(name);
          },
          put: async (name: string, value: unknown) => {
            captured.descriptors.push({ name, value });
            values.set(name, value);
          },
          delete: async (name: string) => values.delete(name),
          getAlarm: async () => null,
          setAlarm: async () => {},
          deleteAlarm: async () => {},
        },
        getWebSockets: () => {
          consumers++;

          return path === "Connection" ? [socket] : [];
        },
        getTags: () => ["fixture-session", "fixture-tab", "fixture-public"],
        getWebSocketAutoResponseTimestamp: () => null,
        setWebSocketAutoResponse: () => {},
        // T852: a reopened Project binds each process load to its tail.
        exports: { IsolateTail: () => ({ fetch: async () => new Response() }) },
      } as unknown as DurableObjectState;

      // SAFETY: the entries reach only INSTANCE and the four object namespaces plus RECORD and MEASUREMENTS, each doubled below.
      // oxlint-disable-next-line fabrika/no-type-assertions -- edge: Alchemy owns the complete binding brands; these doubles implement the observed calls
      const env = {
        INSTANCE: encoded,
        UNRELATED_PASSWORD: secret,
        PROJECT: {
          getByName: () => ({
            settingsStart: (wire: unknown) => Effect.runPromiseWith(context)(gate(wire)),
            route: async () => ({ _tag: "ok", result: {} }),
          }),
        },
        PROCESS: {
          getByName: (object: string) => ({
            configure: async (descriptor: unknown) => {
              captured.descriptors.push(descriptor);
              configured.set(object, descriptor);
            },
            // P15: a reopened Project asks each live process which build its object runs.
            descriptor: async () => configured.get(object),
            swap: async () => ({ _tag: "same" }),
          }),
        },
        CONNECTION: { getByName: () => ({ ring: async () => {}, notify: async () => {}, probe: async () => 0 }) },
        RECORD: {
          getByName: () => ({
            write: async (...args: unknown[]) => {
              captured["record RPC"].push(args);
              captured["span attributes"].push(args);

              return { _tag: "written" };
            },
          }),
        },
        MEASUREMENTS: {
          put: async (...args: unknown[]) => {
            captured.archives.push(args);

            return {};
          },
          head: async () => null,
        },
        LOADER: {
          get: () => {
            consumers++;

            return {
              getEntrypoint: () => ({
                describe: async () => ({ name: "test/fixture", v: 1, writes: {}, inputs: {}, cmds: [] }),
              }),
            };
          },
        },
      } as unknown as Env;

      let close = Effect.void;
      let enter: SettingsTest.Entry["enter"];

      if (path === "HTTP") {
        enter = Effect.fnUntraced(function* (choice) {
          const route = ["/window.js", "/", "/missing", "/window.js"][choice % 4] ?? "/";

          const response = yield* fetch(
            new Request(`http://127.0.0.1:${config.port}${route}`, {
              headers: { host: choice % 4 === 3 ? "wrong.invalid" : `127.0.0.1:${config.port}` },
            }),
            env,
            config,
            { "/window.js": { body: "fixture", hash: "fixture", type: "text/javascript" } },
          );

          captured["HTTP replies"].push({
            status: response.status,
            headers: [...response.headers],
            body: yield* Effect.promise(() => response.text()),
          });

          return response.status;
        });
      } else if (path === "RecordPart") {
        const scope = yield* Effect.acquireRelease(Scope.make(), (owned) => Scope.close(owned, Exit.void));
        close = Scope.close(scope, Exit.void);
        const constructor = Option.getOrThrow(Option.fromUndefinedOr(recordConstructor.value));

        // Construct only the stable holder here. The operation must perform the fallible gate.
        const build = yield* constructor.pipe(
          Effect.provideService(WorkerEnvironment, env),
          Effect.provideService(
            ObjectState,
            // SAFETY: `ctx` holds the storage handles `fromDurableObjectState` reads; its type differs from Alchemy's only in Request brands.
            // oxlint-disable-next-line fabrika/no-type-assertions -- edge: Alchemy and the global Worker types disagree on raw Request brands; this double supplies the same storage handles
            fromDurableObjectState(ctx as unknown as Parameters<typeof fromDurableObjectState>[0]),
          ),
          Effect.provideService(Scope.Scope, scope),
        );

        enter = Effect.fnUntraced(function* (choice) {
          const part = yield* build.pipe(Effect.provideService(Scope.Scope, scope));
          const chain = Chain.cases.spans.make({});
          const method = choice % 4;

          return yield* Match.value(method).pipe(
            Match.when(0, () => part.write(chain, 0, [])),
            Match.when(1, () => part.read(chain, 0, 0)),
            Match.when(2, () => part.content(chain, 0, "absent")),
            Match.orElse(() =>
              part.deleteContent(chain, 0, "absent", { by: "fixture-writer", at: 0, reason: "requested" }),
            ),
          );
        });
      } else {
        const runtime = Match.value(path).pipe(
          Match.when("Connection", () => connectionRuntime(ctx, env, config)),
          Match.when("Process", () => processRuntime(ctx, env, {})),
          Match.orElse(() =>
            projectRuntime(ctx, env, {
              config,
              programs: { "test/fixture": FIXTURE },
              bootstrap: [{ id: "bootstrap-fixture", name: "bootstrap", program: "test/fixture" }],
              // SAFETY: these entry-flow laws never dial the gateway door, so an empty object stands in for its calls.
              door: () => Effect.succeed({} as GatewayCalls),
            }),
          ),
        );

        close = Effect.promise(() => runtime.dispose());
        yield* Effect.addFinalizer(() => close);
        enter = (choice: number) =>
          Effect.tryPromise({
            try: () => {
              const work = Match.value(path).pipe(
                Match.when("Connection", () =>
                  ConnectionService.use((service) =>
                    choice % 2 === 0
                      ? service.message(socket, JSON.stringify({ jsonrpc: "2.0", method: "ping", id: choice }))
                      : service.probe("fixture-session"),
                  ),
                ),
                Match.when("Process", () => ProcessService.use((service) => service.alarm())),
                Match.orElse(() =>
                  ProjectService.use((service) =>
                    choice % 3 === 0
                      ? service.info.pipe(Effect.asVoid)
                      : service
                          .processStart(
                            Start.cases.first.make({
                              id: choice % 2 === 0 ? `birth-${config.start}` : `birth-${config.start}-${choice}`,
                              name: choice % 2 === 0 ? "child" : `child-${choice}`,
                              code: { program: "test/fixture", hash: FIXTURE.hash },
                            }),
                            {
                              by: "fixture-writer",
                              for: config.person,
                              sentAt: "2026-11-08T04:00:00.000Z",
                              seen: 0,
                              parent: null,
                              traceId: "4bf92f3577b34da6a3ce929d0e0e4736",
                              build: config.build,
                            },
                          )
                          .pipe(Effect.asVoid),
                  ),
                ),
              );

              return Reflect.apply(runtime.runPromise, runtime, [work]);
            },
            catch: (cause: unknown) => new EntryFailure({ cause }),
          });
      }

      return { enter, close };
    });

    return {
      deploy: Effect.fnUntraced(function* (next: StartsTest.Recipe) {
        input = { ...(yield* StartsTest.input(next)), founding: input.founding };
        captured.transport.push(Formatter.formatJson(input));
      }, Effect.provide(Digest.layerWebCrypto)),
      open,
      fault: (next) => {
        fault = next;
      },
      counts: () => ({ calls, reads, appends, consumers }),
      outputs: Effect.sync(() => {
        const tables = ["entries", "dev_descriptors", "unsent", "spans", "content"] as const;
        const output = { ...captured };

        // Each captured output is checked once; saved rows below are read again for changes.
        for (const channel of SettingsTest.channels) {
          output[channel] = captured[channel].splice(0);
        }

        for (const table of tables) {
          const rows = databases.flatMap((db) =>
            db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name=?").get(table) === undefined
              ? []
              : db.prepare(`SELECT * FROM ${table}`).all(),
          );

          const channel = Match.value(table).pipe(
            Match.when("entries", () => "ledger" as const),
            Match.when("dev_descriptors", () => "descriptors" as const),
            Match.when("content", () => "content" as const),
            Match.orElse(() => "spans" as const),
          );

          output[channel] = [...output[channel], ...rows];
        }

        return output;
      }),
    } satisfies SettingsTest.Driver;
  }).pipe(Effect.provide(Digest.layerWebCrypto)),
);
