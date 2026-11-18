// P12, next/. Saved and wire values enter the real services over in-memory platform handles.
// The settings entry flows (L10, L16) are in entry-flows.laws.test.ts, split out unchanged so each
// file stays under about 60 s on a CI leg.
import { DatabaseSync } from "node:sqlite";
import {
  DurableObjectState as ObjectState,
  fromDurableObjectState,
} from "@alchemy.run/cloudflare/Workers/DurableObjectState";
import { WorkerEnvironment } from "@alchemy.run/cloudflare/Workers/WorkerRuntime";
import { Recorder, runsFor, Stub } from "@kampus/vitest";
import { Cause, Effect, Exit, Layer, Match, Redacted, Schema } from "effect";

import * as Digest from "effect/crypto/Digest";
import * as SecureRandom from "effect/crypto/SecureRandom";
import * as Signature from "effect/crypto/Signature";
import * as Base64Url from "effect/encoding/Base64Url";
import * as Formatter from "effect/Formatter";
import * as Str from "effect/String";
import * as fc from "fast-check";
import { expect, it, vi } from "vitest";
import { Writer } from "../coordination/index.ts";
import { nodeSql } from "../ledger/NodeSqlite.ts";
import { News } from "../runtime/News.ts";
import * as StartsTest from "../settings/StartsTest.ts";
import { Chain } from "../telemetry/Trace.ts";
import { Attached } from "../transport/Wire.ts";
import type { ProjectBinding, RecordBinding } from "./bindings.ts";
import { ConnectionService, connectionRuntime, GatewayWaits, gatewayLayer, gatewayProject } from "./connection.ts";
import { control } from "./control.ts";
import { Dispatcher } from "./Dispatcher.ts";
import * as DispatcherLive from "./DispatcherLive.ts";
import { fetch } from "./fetch.ts";
import { recordPartImplementation, recordRead, recordWrite } from "./record.ts";
import {
  ProcessService,
  ProjectService,
  processDescriptor,
  processRuntime,
  projectRuntime,
  recordedLayer,
  SettingsRuntime,
  type Env,
} from "./runtime.ts";
import { Waits } from "./Waits.ts";
import * as WaitsLive from "./WaitsLive.ts";

const config = await Effect.runPromise(
  StartsTest.fixture({
    name: "parse-test",
    person: "person-test",
    founder: "public-test",
    window: null,
    port: 18787,
    build: "test",
  }),
);

/** A fresh Ed25519 public key in JWK's `x` form (base64url), from Effect's Signature on WebCrypto. */
const freshPublicKey = Signature.Signature.use((signature) => signature.generateKeyPair(Signature.ed25519)).pipe(
  Effect.flatMap(({ publicKey }) => Signature.toBytes(publicKey)),
  Effect.map(Base64Url.encode),
  Effect.provide(Signature.layerWebCrypto.pipe(Layer.provide(SecureRandom.layerWebCrypto))),
);

/** SHA-256 of no bytes (FIPS 180-2's empty-message digest). */
const EMPTY_SHA256 = "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855";

const malformed = (schema: Schema.Top) => fc.jsonValue().filter((value) => !Schema.is(schema)(value));

/** A platform member any call to which fails the law: the world gives only what the readers use. */
const unexpected = (member: string): never => {
  throw new Error(`the world gives no platform member ${member}`);
};

/** The one member Alchemy's `fromDurableObjectState` reads as it wraps an object, which these objects lack:
 *  `container` answers nothing, and any other member the world did not give fails the law. */
const absent = (member: string) => (member === "container" ? undefined : unexpected(member));

/** A platform member built from plain parts, as workerd's type promises it. */
// SAFETY: each caller hands `fake` the one part the readers use, and the readers use nothing else of it.
const fake = <A>(value: object): A => value as A;

/** A saved value a law has damaged on purpose: workerd's type promises better, so the readers check it. */
// SAFETY: the damage is the law's point. Every reader decodes the value before it uses it.
const saved = <A>(value: unknown): A => value as A;

/** The world's bindings with another `INSTANCE` text, the one binding a law changes. */
const withInstance = (env: Env, instance: string) =>
  Stub.make<Env>(unexpected, {
    INSTANCE: instance,
    PROJECT: env.PROJECT,
    RECORD: env.RECORD,
    MEASUREMENTS: env.MEASUREMENTS,
  });

const entryPaths = ["Project", "Process", "Connection", "HTTP", "RecordPart"] as const;

for (const corruption of ["snapshot", ...StartsTest.originKinds] as const) {
  for (const path of entryPaths) {
    StartsTest.law(
      `T753 L3 ${path} rejects corrupt ${corruption} before consumer construction`,
      fc.tuple(
        StartsTest.recipe,
        fc.array(fc.nat(), { minLength: 8, maxLength: 25 }),
        corruption === "snapshot" ? fc.constant(undefined) : StartsTest.originFault(corruption),
      ),
      ([recipe, choices, origin]) =>
        Effect.gen(function* () {
          let deployment = yield* StartsTest.input(recipe);

          for (const [index, choice] of choices.entries()) {
            // A reopen keeps immutable input; a deployment chooses a fresh start and snapshot.
            const moves = ["deliver", "reopen", "deploy"];
            const move = moves[choice % moves.length];

            if (move === "deploy") {
              deployment = yield* StartsTest.input({
                ...recipe,
                start: `${recipe.start}-${index}`,
                port: 1 + (choice % 65535),
              });
              continue;
            }

            let consumers = 0;
            let settingsCalls = 0;

            const w = yield* Effect.acquireRelease(
              Effect.sync(() =>
                world(async (wire) => {
                  settingsCalls++;

                  return StartsTest.reply(wire);
                }),
              ),
              (value) => Effect.sync(() => value.db.close()),
            );

            const bad =
              origin === undefined
                ? StartsTest.corrupt(deployment, Math.floor(choice / moves.length))
                : StartsTest.changeOrigin(deployment, origin);

            const sql = w.ctx.storage.sql;

            const ctx = Stub.make<DurableObjectState>(absent, {
              id: Stub.make<DurableObjectId>(unexpected, {
                name: Match.value(path).pipe(
                  Match.when("Process", () => Formatter.formatJson(["settings-law", "worker"])),
                  Match.when("RecordPart", () => Formatter.formatJson(["settings-law", "spans/0"])),
                  Match.orElse(() => "settings-law"),
                ),
              }),
              getWebSockets: () => {
                consumers++;

                return [];
              },
              getTags: w.ctx.getTags,
              getWebSocketAutoResponseTimestamp: w.ctx.getWebSocketAutoResponseTimestamp,
              acceptWebSocket: w.ctx.acceptWebSocket,
              setWebSocketAutoResponse: w.ctx.setWebSocketAutoResponse,
              // The storage, with each read a consumer could make counted: `get`, and `sql.exec`.
              storage: Stub.make<DurableObjectStorage>(unexpected, {
                // Alchemy's `fromDurableObjectStorage` hands `kv` on as it wraps the storage, and these objects keep nothing in it.
                kv: Stub.make<SyncKvStorage>(unexpected),
                get: fake<DurableObjectStorage["get"]>((...args: ReadonlyArray<unknown>) => {
                  consumers++;

                  return Reflect.apply(w.ctx.storage.get, w.ctx.storage, args);
                }),
                transactionSync: w.ctx.storage.transactionSync,
                sql: Stub.make<SqlStorage>(unexpected, {
                  exec: fake<SqlStorage["exec"]>((...args: ReadonlyArray<unknown>) => {
                    consumers++;

                    return Reflect.apply(sql.exec, sql, args);
                  }),
                  get databaseSize() {
                    return sql.databaseSize;
                  },
                }),
              }),
            });

            // The world's Project stub counts each `settingsStart` and answers the start it is given.
            const env = withInstance(w.env, Formatter.formatJson(bad));

            const local = {
              ...config,
              name: "settings-law",
              port: recipe.port,
              person: "person_01m6v5270hf3c8x2q7w9z4k5mn",
              founder: yield* freshPublicKey,
              window: config.founding.window,
            };

            let exit: Exit.Exit<unknown, unknown>;

            if (path === "HTTP") {
              exit = yield* Effect.exit(
                fetch(
                  new Request(`http://127.0.0.1:${recipe.port}/window.js`, {
                    headers: { host: `127.0.0.1:${recipe.port}` },
                  }),
                  env,
                  local,
                  { "/window.js": { hash: "asset", type: "text/javascript", body: "window.fixture = true" } },
                ),
              );
            } else if (path === "RecordPart") {
              exit = yield* Effect.exit(
                Effect.gen(function* () {
                  const build = yield* recordPartImplementation;
                  const part = yield* build;

                  return yield* part.read(Chain.cases.spans.make({}), 0, 0);
                }).pipe(
                  Effect.provideService(WorkerEnvironment, env),
                  Effect.provideService(
                    ObjectState,
                    // SAFETY: `ctx` holds the handles `fromDurableObjectState` reads; only the Request brands of the two types differ.
                    // oxlint-disable-next-line fabrika/no-type-assertions -- edge: Alchemy and the global Worker types disagree on raw Request brands; this double supplies the same storage handles
                    fromDurableObjectState(ctx as unknown as Parameters<typeof fromDurableObjectState>[0]),
                  ),
                ),
              );
            } else if (path === "Connection") {
              const runtime = connectionRuntime(ctx, env, local);
              yield* Effect.addFinalizer(() => runtime.disposeEffect);
              exit = yield* Effect.promise(() => runtime.runPromiseExit(ConnectionService));
            } else if (path === "Process") {
              const runtime = processRuntime(ctx, env, {});
              yield* Effect.addFinalizer(() => runtime.disposeEffect);
              exit = yield* Effect.promise(() => runtime.runPromiseExit(ProcessService));
            } else {
              const runtime = projectRuntime(ctx, env, {
                config: local,
                programs: {},
                bootstrap: [{ id: "boot", name: "boot", program: "missing" }],
                door: () => Effect.die("consumer before start"),
              });

              yield* Effect.addFinalizer(() => runtime.disposeEffect);
              exit = yield* Effect.promise(() => runtime.runPromiseExit(ProjectService));
            }

            expect(Exit.isFailure(exit)).toBe(true);

            if (Exit.isFailure(exit)) {
              expect(Cause.hasDies(exit.cause)).toBe(false);
              expect(Cause.hasFails(exit.cause)).toBe(true);
              expect(Cause.findErrorOption(exit.cause)).toMatchObject({
                _tag: "Some",
                value: { _tag: "StartsError", reason: { _tag: "Decode" } },
              });
            }

            expect(consumers).toBe(0);
            // A remote receipt check must not hide a skipped local snapshot check.
            expect(settingsCalls).toBe(0);
          }
        }).pipe(Effect.provide(Digest.layerWebCrypto)),
    );
  }
}

// Keep parser checks independent of the bearer migration. The separate [secrets] type and
// flow laws require Redacted; this fixture also reaches HEAD's parser using its old signature.
const parserControl = (request: Request, env: Env) =>
  Effect.gen(function* () {
    const secure: Effect.Effect<Response, unknown> = Reflect.apply(control, undefined, [
      request.clone(),
      env,
      Redacted.make("test"),
      {},
    ]);

    const response = yield* secure;

    if (response.status !== 403) {
      return response;
    }

    const legacy: Effect.Effect<Response, unknown> = Reflect.apply(control, undefined, [request, env, "test", {}]);

    return yield* legacy;
  });

const typed = (exit: Exit.Exit<unknown, unknown>, tag = "LedgerError") => {
  expect(Exit.isFailure(exit)).toBe(true);
  const cause = Exit.isFailure(exit) ? exit.cause : Cause.die("unexpected success");
  expect(Cause.hasDies(cause)).toBe(false);
  expect(Cause.hasFails(cause)).toBe(true);
  expect(Cause.findErrorOption(cause)).toMatchObject({
    _tag: "Some",
    value: { _tag: tag, reason: "bad_row" },
  });
};

// M4 (mock sweep slice 1). Every platform object here is a `Stub.make` fake, so a call the world does
// not give fails the law. Plants, each run once: the fake socket's `send` drops its frame (the ready
// law is red: no `bad_row` reply in `sent`); `gatewayLogic` calls `ctx.storage.list()` (`unexpected`
// throws, and the laws that build a connection are red).
/** In-memory platform handles over one SQLite database. The Project stub's `settingsStart` answers
 *  as `settingsStart` says, the good start by default, its `route` answers what `answer` last set, and
 *  the object state's `storage.get` answers `read` says. `sent` holds each frame the socket was sent. */
const world = (
  settingsStart: (wire: StartsTest.Input) => Promise<unknown> = async () => StartsTest.reply(config),
  read?: (key: string) => Promise<unknown>,
) => {
  const db = new DatabaseSync(":memory:"),
    sql = nodeSql(db);

  let attached: unknown = Attached.cases.online.make({
    client: "client",
    identity: { key: "public", person: "person", as: "agent" },
    version: 1,
    waits: [],
    watching: false,
    busy: false,
  });

  let tags: unknown = ["session", "tab", "key"],
    name: unknown = "gateway",
    answered: unknown = { _tag: "parked", stream: "stream", after: 0 };

  const sent: Array<string> = [];

  const socket = Stub.make<WebSocket>(unexpected, {
    deserializeAttachment: () => attached,
    serializeAttachment: (value: unknown) => {
      attached = value;
    },
    send: (text) => {
      sent.push(String(text));
    },
    close: () => {},
  });

  const ctx = Stub.make<DurableObjectState>(absent, {
    id: Stub.make<DurableObjectId>(unexpected, {
      get name() {
        return saved<string>(name);
      },
    }),
    storage: Stub.make<DurableObjectStorage>(unexpected, {
      // Alchemy's `fromDurableObjectStorage` hands `kv` on as it wraps the storage, and these objects keep nothing in it.
      kv: Stub.make<SyncKvStorage>(unexpected),
      sql: Stub.make<SqlStorage>(unexpected, {
        // workerd answers a cursor, which the readers take with `Array.from`, as they take these rows.
        exec: fake<SqlStorage["exec"]>(sql.exec),
        get databaseSize() {
          return sql.size();
        },
      }),
      transactionSync: sql.transaction,
      ...(read === undefined ? {} : { get: fake<DurableObjectStorage["get"]>(read) }),
    }),
    getWebSockets: () => [socket],
    getTags: () => saved<Array<string>>(tags),
    getWebSocketAutoResponseTimestamp: () => null,
    acceptWebSocket: () => {},
    setWebSocketAutoResponse: () => {},
  });

  const project = Stub.make<DurableObjectStub<ProjectBinding>>(unexpected, {
    settingsStart: fake<DurableObjectStub<ProjectBinding>["settingsStart"]>(settingsStart),
    route: fake<DurableObjectStub<ProjectBinding>["route"]>(async () => answered),
    leave: fake<DurableObjectStub<ProjectBinding>["leave"]>(async () => {}),
    disconnect: fake<DurableObjectStub<ProjectBinding>["disconnect"]>(async () => {}),
    clientConnect: fake<DurableObjectStub<ProjectBinding>["clientConnect"]>(async () => "client"),
    challenge: fake<DurableObjectStub<ProjectBinding>["challenge"]>(async () => "nonce"),
  });

  const env = Stub.make<Env>(unexpected, {
    INSTANCE: JSON.stringify(config),
    PROJECT: Stub.make<Env["PROJECT"]>(unexpected, { getByName: () => project }),
    RECORD: Stub.make<Env["RECORD"]>(unexpected, {
      getByName: () =>
        Stub.make<DurableObjectStub<RecordBinding>>(unexpected, {
          write: fake<DurableObjectStub<RecordBinding>["write"]>(async () => ({ _tag: "written" })),
        }),
    }),
    MEASUREMENTS: Stub.make<R2Bucket>(unexpected),
  });

  return {
    ctx,
    env,
    socket,
    sent,
    db,
    /** What the Project's `route` answers from now on. */
    answer: (value: unknown) => {
      answered = value;
    },
    attached: (value: unknown) => {
      attached = value;
    },
    tags: (value: unknown) => {
      tags = value;
    },
    name: (value: unknown) => {
      name = value;
    },
  };
};

for (const source of ["attachment", "tags", "name"] as const) {
  it(`Connection startup returns a typed error for malformed saved ${source}`, async () => {
    const schema = {
      attachment: Attached,
      tags: Schema.Tuple([Schema.String, Schema.String, Schema.String]),
      name: Schema.String,
    }[source];

    await fc.assert(
      fc.asyncProperty(malformed(schema), async (raw) => {
        const w = world();
        ({ attachment: w.attached, tags: w.tags, name: w.name })[source](raw);
        const runtime = connectionRuntime(w.ctx, w.env, config);

        try {
          typed(await runtime.runPromiseExit(ConnectionService));
        } finally {
          await runtime.dispose();
          w.db.close();
        }
      }),
      { seed: 119120, numRuns: runsFor({ fast: 5, full: 20 }), examples: [[null], [{}], [17]] },
    );
  });
}

for (const method of ["message", "close", "ring", "probe", "notify"] as const) {
  it(`Connection ${method} returns a typed error for a damaged attachment after startup`, async () => {
    await fc.assert(
      fc.asyncProperty(malformed(Attached), async (raw) => {
        const w = world(),
          runtime = connectionRuntime(w.ctx, w.env, config);

        try {
          const gateway = await runtime.runPromise(ConnectionService);
          w.attached(raw);

          const work = () =>
            ({
              message: () => gateway.message(w.socket, '{"jsonrpc":"2.0","id":1,"method":"view.open","params":{}}'),
              close: () => gateway.close(w.socket),
              ring: () => gateway.ring("stream", 1),
              probe: () => gateway.probe("session"),
              notify: () => gateway.notify("client", News.cases.granted.make({ nonce: "nonce-1" })),
            })[method]();

          typed(await runtime.runPromiseExit(Effect.suspend(work)));
        } finally {
          await runtime.dispose();
          w.db.close();
        }
      }),
      { seed: 119120, numRuns: runsFor({ fast: 4, full: 20 }), examples: [[null], [{}]] },
    );
  });
}

// The live members the two Recorder laws below wrap, read once from each service's live layer, the
// sibling file 0095 keeps apart from the contract.
const liveWaits = Effect.runSync(Waits.pipe(Effect.provide(WaitsLive.layer)));

const liveDispatcher = Effect.runSync(Dispatcher.pipe(Effect.provide(DispatcherLive.layer)));

// M1 (mock sweep slice 2). The wait asks the `Waits` service for the ready decode once, with the
// raw answer the project gave, and the live decode fails in the typed channel. The Recorder holds
// the call; the live member run on the recorded value holds the typed exit.
// Plants: in `WaitsLive.layer`'s `ready`, `Effect.orDie` in place of the `mapError` to `LedgerError`
// (red on the typed exit); `wait` decodes the answer inline, past `Waits` (red: no recorded call).
it("Connection ready RPC decoding fails in the typed channel before the wait refusal is sent", async () => {
  await fc.assert(
    fc.asyncProperty(malformed(Schema.Struct({ rev: Schema.Int })), async (raw) => {
      const w = world(),
        attempts: Array<Exit.Exit<unknown, unknown>> = [],
        decodes: Array<Exit.Exit<unknown, unknown>> = [];

      // The real waits, watched: each run is recorded, and its exit is kept to read its error.
      const waits = Layer.unwrap(
        Effect.gen(function* () {
          const real = yield* GatewayWaits;

          return Recorder.layer(GatewayWaits, {
            wait: (...args) =>
              real.wait(...args).pipe(
                Effect.onExit((exit) =>
                  Effect.sync(() => {
                    attempts.push(exit);
                  }),
                ),
              ),
          });
        }),
      ).pipe(Layer.provide(GatewayWaits.layer));

      // The ready decode's own seam (mock sweep slice 2, 0095): the live `Waits` member behind a
      // Recorder, with its own exit kept. The request path must ask it, so the recorded call holds the
      // exact raw answer the project gave, beside the exit of the whole wait above.
      const decoding = Recorder.layer(Waits, {
        ready: (answer) =>
          liveWaits.ready(answer).pipe(
            Effect.onExit((exit) =>
              Effect.sync(() => {
                decodes.push(exit);
              }),
            ),
          ),
      });

      const runtime = SettingsRuntime.runtime(
        gatewayLayer(w.ctx, w.env).pipe(
          Layer.provideMerge(waits),
          Layer.provide(gatewayProject(w.env)),
          Layer.provide(recordedLayer(w.env)),
          Layer.provideMerge(decoding),
        ),
      );

      try {
        const gateway = await runtime.runPromise(ConnectionService);
        w.answer({ _tag: "ok", result: raw });
        await runtime.runPromise(
          gateway
            .message(
              w.socket,
              JSON.stringify({
                jsonrpc: "2.0",
                id: "wait",
                method: "ledger.wait",
                params: { stream: "stream", after: 0 },
              }),
            )
            .pipe(Effect.exit),
        );
        expect(await runtime.runPromise(Recorder.calls(GatewayWaits, "wait"))).toHaveLength(1);
        expect(attempts).toHaveLength(1);
        typed(attempts[0]!);
        expect(
          await runtime.runPromise(Recorder.calls(Waits, "ready")),
          "the wait asks for the decode once, with exactly the project's raw answer",
        ).toEqual([[raw]]);
        expect(decodes, "the one decode ran once and failed").toHaveLength(1);
        typed(decodes[0]!);
        expect(w.sent.map((text) => JSON.parse(text))).toContainEqual(
          expect.objectContaining({
            id: "wait",
            error: expect.objectContaining({ data: { reason: "bad_row" } }),
          }),
        );
      } finally {
        await runtime.dispose();
        w.db.close();
      }
    }),
    { seed: 119120, numRuns: runsFor({ fast: 6, full: 20 }), examples: [[null], [{}], [{ rev: "1" }], [{ rev: 1.5 }]] },
  );
});

/**
 * Sends one control request with the `Dispatcher` recorded, and answers the response with the
 * dispatch calls the request path made and the exit of each. The recorded member is the live one
 * with `Effect.onExit` on it, so the exit read is the first, actual call's, never a second run.
 */
const recordedControl = (body: unknown, headers: Record<string, string>, env: Env) => {
  const exits: Array<Exit.Exit<unknown, unknown>> = [];

  const watched = Recorder.layer(Dispatcher, {
    dispatch: (...args) =>
      liveDispatcher.dispatch(...args).pipe(
        Effect.onExit((exit) =>
          Effect.sync(() => {
            exits.push(exit);
          }),
        ),
      ),
  });

  return Effect.gen(function* () {
    const request = new Request("http://local/", {
      method: "POST",
      headers: { authorization: "Bearer test", ...headers },
      body: JSON.stringify(body),
    });

    const response = yield* parserControl(request, env);

    return { response, calls: yield* Recorder.calls(Dispatcher, "dispatch"), exits };
  }).pipe(Effect.provide(watched));
};

/** The one recorded dispatch is the law's own request, and its actual exit fails typed. */
const dispatchedOnce = (
  calls: ReadonlyArray<Recorder.Args<Dispatcher["Service"], "dispatch">>,
  exits: ReadonlyArray<Exit.Exit<unknown, unknown>>,
  body: unknown,
  env: Env,
) => {
  expect(calls, "the request path dispatches once").toHaveLength(1);
  const [call] = calls;
  expect(call?.[0], "with the Worker's own bindings").toBe(env);
  expect(call?.[2], "and exactly the request the law sent").toEqual(JSON.parse(JSON.stringify(body)));
  expect(exits, "the one dispatch ran once").toHaveLength(1);
  typed(exits[0]!);
};

// M2 (mock sweep slice 2). Plants: in the live `dispatch`, decode the bucket bytes with
// `Schema.decodeUnknownSync`, so a bad value dies (red); `control.ts` calls the dispatch body
// inline, past `Dispatcher` (red: no recorded call).
it("control bucket bytes fail as a typed parse error before its HTTP error response", async () => {
  await fc.assert(
    fc.asyncProperty(malformed(Schema.Array(Schema.Number)), async (raw) => {
      const w = world();

      try {
        const body = {
          target: "bucket",
          project: "parse-test",
          name: "",
          method: "put",
          args: ["key", raw, "checksum"],
        };

        const exit = await Effect.runPromiseExit(recordedControl(body, { "content-type": "application/json" }, w.env));
        expect(Exit.isSuccess(exit)).toBe(true);

        const { response, calls, exits } = Exit.isSuccess(exit)
          ? exit.value
          : { response: new Response(null), calls: [], exits: [] };

        dispatchedOnce(calls, exits, body, w.env);
        expect(response.status).toBe(500);
        expect(await response.json()).toEqual({ error: { reason: "bad_row" } });
      } finally {
        w.db.close();
      }
    }),
    { seed: 119120, numRuns: runsFor({ fast: 5, full: 20 }), examples: [[null], [{}], [["byte"]]] },
  );
});

// M2, per field. Plant: coerce the field with `String(raw)` before the check (red: the dispatch
// succeeds); `control.ts` calls the dispatch body inline, past `Dispatcher` (red: no recorded call).
for (const field of ["put key", "put checksum", "head key"] as const) {
  it(`control checks outside ${field} as text instead of coercing it or throwing`, async () => {
    const input: fc.Arbitrary<unknown> = fc.oneof(malformed(Schema.String), fc.record({ toString: fc.jsonValue() }));
    await fc.assert(
      fc.asyncProperty(input, async (raw) => {
        const w = world();

        try {
          const args: Array<unknown> = field === "head key" ? [raw] : ["key", [], EMPTY_SHA256];

          if (field === "put key") {
            args[0] = raw;
          }

          if (field === "put checksum") {
            args[2] = raw;
          }

          const body = {
            target: "bucket",
            project: "parse-test",
            name: "",
            method: field === "head key" ? "head" : "put",
            args,
          };

          const exit = await Effect.runPromiseExit(recordedControl(body, {}, w.env));
          expect(exit).toMatchObject({ _tag: "Success" });

          const { response, calls, exits } = Exit.isSuccess(exit)
            ? exit.value
            : { response: new Response(null), calls: [], exits: [] };

          dispatchedOnce(calls, exits, body, w.env);
          expect(response.status).toBe(500);
          expect(await response.json()).toEqual({ error: { reason: "bad_row" } });
        } finally {
          w.db.close();
        }
      }),
      { seed: 119120, numRuns: runsFor({ fast: 5, full: 20 }), examples: [[{ toString: 0 }], [null], [17]] },
    );
  });
}

const objectName = Schema.fromJsonString(Schema.Tuple([Schema.String, Schema.String]));

for (const service of ["process", "record"] as const) {
  it(`${service} object names return typed parse failures for malformed saved names`, async () => {
    await fc.assert(
      fc.asyncProperty(malformed(objectName), async (raw) => {
        const w = world();
        w.name(raw);
        const runtime = processRuntime(w.ctx, w.env, {});

        try {
          const exit =
            service === "process"
              ? await runtime.runPromiseExit(ProcessService)
              : await Effect.runPromiseExit(recordRead(w.ctx, undefined, { _tag: "spans" }, 0, 0));

          typed(exit, service === "record" ? "SinkError" : "LedgerError");
        } finally {
          await runtime.dispose();
          w.db.close();
        }
      }),
      {
        seed: 119120,
        numRuns: runsFor({ fast: 6, full: 20 }),
        examples: [[null], ["{"], ['["project"]'], ['["project",17]']],
      },
    );
  });
}

// M3 (mock sweep slice 1). Plant, run once: `processDescriptor` returns `storage.get`'s value without its
// decode (red: a malformed descriptor is no typed `bad_row` failure).
it("processDescriptor checks the saved value before returning it to a caller", async () => {
  const descriptor = Schema.Struct({
    id: Schema.String,
    name: Schema.String,
    program: Schema.String,
    build: Schema.String,
    owner: Writer,
  });

  await fc.assert(
    fc.asyncProperty(malformed(descriptor), async (raw) => {
      const w = world(undefined, async () => raw);

      try {
        typed(await Effect.runPromiseExit(processDescriptor(w.ctx)));
      } finally {
        w.db.close();
      }
    }),
    { seed: 119120, numRuns: runsFor({ fast: 5, full: 20 }), examples: [[null], [{}], [17]] },
  );
});

it("Connection close checks saved tags again after startup", async () => {
  await fc.assert(
    fc.asyncProperty(malformed(Schema.String), async (raw) => {
      const w = world(),
        runtime = connectionRuntime(w.ctx, w.env, config);

      try {
        const gateway = await runtime.runPromise(ConnectionService);
        w.tags([raw, "tab", "key"]);
        typed(await runtime.runPromiseExit(gateway.close(w.socket)));
      } finally {
        await runtime.dispose();
        w.db.close();
      }
    }),
    { seed: 119120, numRuns: runsFor({ fast: 5, full: 20 }), examples: [[null], [{}], [17]] },
  );
});

it("Connection rejects missing or malformed URL segments with a typed error", async () => {
  const invalid = fc.oneof(
    fc.constantFrom("/ws", "/ws/key", "/ws/%/tab", "/ws/key/%"),
    fc.string().map((text) => `/ws/${encodeURIComponent(text)}%/tab`),
  );

  await fc.assert(
    fc.asyncProperty(invalid, async (path) => {
      const w = world(),
        runtime = connectionRuntime(w.ctx, w.env, config);

      vi.stubGlobal(
        "WebSocketPair",
        class {
          0 = {};
          1 = {};
        },
      );

      try {
        const gateway = await runtime.runPromise(ConnectionService);
        typed(
          await runtime.runPromiseExit(
            gateway.fetch(new Request(`http://local${path}`, { headers: { upgrade: "websocket" } })),
          ),
        );
      } finally {
        vi.unstubAllGlobals();
        await runtime.dispose();
        w.db.close();
      }
    }),
    { seed: 119120, numRuns: runsFor({ fast: 5, full: 20 }), examples: [["/ws"], ["/ws/%/tab"], ["/ws/key/%"]] },
  );
});

StartsTest.law(
  "T753 L19 the legacy cap, fallback, resend and rollover behavior remain intact",
  fc.record({
    cap: fc.option(fc.integer({ min: 1, max: 1_000_000_000 }), { nil: undefined }),
    id: fc.integer({ min: 1, max: 1_000_000 }),
  }),
  ({ cap, id }) =>
    Effect.gen(function* () {
      const w = yield* Effect.acquireRelease(Effect.sync(world), (value) => Effect.sync(() => value.db.close()));
      let size = 0;
      const raw = w.ctx.storage.sql;

      const ctx = Stub.make<DurableObjectState>(unexpected, {
        id: Stub.make<DurableObjectId>(unexpected, { name: Formatter.formatJson(["settings-law", "spans/0"]) }),
        storage: Stub.make<DurableObjectStorage>(unexpected, {
          transactionSync: w.ctx.storage.transactionSync,
          sql: Stub.make<SqlStorage>(unexpected, {
            exec: raw.exec,
            get databaseSize() {
              return size;
            },
          }),
        }),
      });

      const chain = Chain.cases.spans.make({});

      const row = (n: number) => ({
        span: {
          traceId: "4bf92f3577b34da6a3ce929d0e0e4736",
          spanId: Str.padStart(16, "0")(n.toString(16)),
          parentSpanId: null,
          name: "settings-cap-fixture",
          kind: "internal" as const,
          startTimeUnixNano: "1794096000000000000",
          endTimeUnixNano: "1794096000001000000",
          attributes: {},
          events: [],
          links: [],
          resource: { attributes: { "fab.object": "settings-cap-fixture" } },
          ok: true,
        },
        content: null,
      });

      const old = row(id);
      const next = row(id + 1);
      const fresh = row(id + 2);
      expect(yield* recordWrite(ctx, cap, chain, 0, [old])).toEqual({ _tag: "written" });
      size = (cap ?? 1_000_000_000) - 1;
      expect(yield* recordWrite(ctx, cap, chain, 0, [next])).toEqual({ _tag: "written" });
      size++;
      expect(yield* recordWrite(ctx, cap, chain, 0, [old])).toEqual({ _tag: "written" });
      expect(yield* recordWrite(ctx, cap, chain, 0, [old, fresh])).toEqual({
        _tag: "rolled",
        next: "spans/1",
        had: [old.span.spanId],
      });
    }),
);
