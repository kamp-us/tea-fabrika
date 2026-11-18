// p23/p82: answerFrame(text, attachment) asks the `Routes` service for its route. A failed route
// stays retryable; a parked wait is data. Each law that reads which routes ran watches `Routes` with
// a Recorder (0579); one that only reads the reply provides `Layer.mock(Routes, ...)` (ticket 1067
// slice 1). Plants: answer a notification; route before initialize; turn a failure into err.
import { assert, describe, expect, expectTypeOf, it } from "@effect/vitest";
import { Recorder } from "@kampus/vitest";
import * as Arbitrary from "effect/Arbitrary";
import * as Arr from "effect/Array";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";
import * as Tracer from "effect/Tracer";
import * as fc from "fast-check";
import { answerFrame } from "./Answer.ts";
import { RouteError, Routes } from "./Routes.ts";
import { Answer, Attached } from "./Wire.ts";
import * as Wire from "./Wire.ts";

/** Any JSON text, as the wire carries it. */
const Json = Schema.fromJsonString(Schema.Unknown);

/** Reads a frame the door sent; a frame that is not JSON fails the law. */
const readJson = Schema.decodeUnknownEffect(Json);

/** The parts of a JSON-RPC reply these laws read. */
const Reply = Schema.Struct({
  jsonrpc: Schema.String,
  id: Schema.Union([Schema.String, Schema.Finite]),
  result: Schema.optionalKey(Schema.Unknown),
  error: Schema.optionalKey(Schema.Struct({ data: Schema.Unknown })),
});

const PERSON = "person_01m6v5270hf3c8x2q7w9z4k5mn";

const online = () =>
  Attached.cases.online.make({
    client: "c1",
    identity: { key: "SHA256:checked", person: PERSON, as: "window" },
    version: 2,
    waits: [],
    watching: false,
    busy: false,
  });

const SEED = 119120; // the shared seed (AGENTS.md), so a red run repeats

const rateReplyTypeLaw = () => {
  // @ts-expect-error a rate refusal cannot be made without its positive delay.
  const missing = Wire.RateRefusal.make({ reason: "rate_limited" });

  return missing;
};

void rateReplyTypeLaw;

// Method names the door and the ledger answer today, and two near misses of gateway.knock.
const METHODS = [
  "gateway.knock",
  "gateway.watch",
  "gateway.grant",
  "gateway.deny",
  "gateway.input",
  "gateway.initialize",
  "ledger.read",
  "ledger.append",
  "ledger.wait",
  "process.send",
  "process.start",
  "process.exit",
  "spans.read",
  "session.end",
  "Gateway.knock",
  "gateway.knock ",
] as const;

const Unauthenticated = Schema.TaggedUnion({
  new: { client: Schema.String, nonce: Schema.String },
  waiting: {
    client: Schema.String,
    key: Schema.String,
    nonce: Schema.String,
    hello: Schema.Struct({
      versions: Schema.Array(Schema.Int.check(Schema.isBetween({ minimum: 1, maximum: 9 }))),
      has: Schema.Array(Schema.String),
      ping: Schema.String,
      key: Schema.String,
      tab: Schema.String,
      nonce: Schema.String,
      platform: Schema.Literals(["browser", "electron", "headless"]),
      os: Schema.Literals(["macos", "windows", "linux", "android", "ios", "unknown"]),
      sentAt: Schema.String,
      signed: Schema.String,
    }),
  },
});

const unauthenticatedEffect = Arbitrary.schema(Unauthenticated).pipe(
  Arbitrary.map(
    Unauthenticated.match({
      new: ({ client, nonce }) => Attached.cases.new.make({ client, nonce }),
      waiting: ({ client, key, nonce, hello }) => Attached.cases.waiting.make({ client, key, nonce, hello }),
    }),
  ),
);

const method = Arbitrary.schema(Schema.Union([Schema.Literals(["gateway.knock", ...METHODS]), Schema.String]));

const jsonRpcId = Schema.Union([
  Schema.String,
  Schema.Int.check(Schema.isBetween({ minimum: -0x80000000, maximum: 0x7fffffff })),
]);

const nonnegativeInteger = Schema.Int.check(Schema.isBetween({ minimum: 0, maximum: 0x7fffffff }));

/** A route that answers `answer` to every request, for a law that reads only the reply. */
const answering = (answer: typeof Answer.Type) => Layer.mock(Routes, { route: () => Effect.succeed(answer) });

const PARAMS = { stream: "x", after: 0 };

const frame = (over: Record<string, unknown> = {}) =>
  JSON.stringify({
    jsonrpc: "2.0",
    id: "r1",
    method: "ledger.read",
    params: PARAMS,
    ...over,
  });

describe("P10 JSON-RPC", () => {
  it.effect.prop(
    "T843 answerFrame: retry delay survives with the request id and counts its enclosing span (50 runs)",
    {
      retryAfter: Schema.Int.check(Schema.isBetween({ minimum: 1, maximum: 1_000_000 })),
      id: Schema.Union([Schema.String, Schema.Int]),
    },
    ({ retryAfter, id }) =>
      Effect.gen(function* () {
        const attached = online();
        const answer = { ...Answer.cases.refused.make({ reason: "rate_limited" }), retryAfter };
        const spans: Array<Tracer.NativeSpan> = [];

        const tracer = Tracer.make({
          span: (options) => {
            const span = new Tracer.NativeSpan(options);
            spans.push(span);

            return span;
          },
        });

        const reply = yield* answerFrame(frame({ id }), attached).pipe(
          Effect.withTracer(tracer),
          Effect.provide(answering(answer)),
        );

        expect(yield* readJson(reply.send!)).toEqual({
          jsonrpc: "2.0",
          id: id === 0 ? 0 : id, // JSON encodes negative zero as zero.
          error: { code: -32000, message: "rate_limited", data: { reason: "rate_limited", retryAfter } },
        });
        expect(reply.attached).toEqual(attached);
        const span = Option.getOrThrow(Arr.findFirst(spans, (s) => s.name === "transport.answerFrame"));
        expect(span.status._tag).toBe("Ended");
        expect(span.attributes.get("fab.gateway.refused")).toBe("rate_limited");
      }),
    { arbitrary: { runs: 50 } },
  );

  it("T843 rate reply schema: a positive safe retry delay is required (50 runs)", () => {
    fc.assert(
      fc.property(
        fc.oneof(
          fc.integer({ max: 0 }),
          fc.double({ min: 0.01, max: 1e6, noNaN: true }).filter((n) => !Number.isInteger(n)),
          fc.constantFrom(Number.NaN, Infinity, -Infinity, Number.MAX_SAFE_INTEGER + 1),
        ),
        (bad) => {
          expect(Schema.is(Wire.RateRefusal)({ _tag: "refused", reason: "rate_limited" })).toBe(false);
          expect(Schema.is(Wire.RateRefusal)({ _tag: "refused", reason: "rate_limited", retryAfter: bad })).toBe(false);
          expect(Schema.is(Wire.RateRefusal)({ _tag: "refused", reason: "rate_limited", retryAfter: 1 })).toBe(true);
          expect(Schema.is(Answer)({ _tag: "refused", reason: "ordinary" })).toBe(true);
        },
      ),
      { seed: SEED, numRuns: 50 },
    );
  });
  it.effect("p23: numeric reply id zero is preserved, not mistaken for a notification", () =>
    Effect.gen(function* () {
      const result = yield* answerFrame(frame({ id: 0 }), online()).pipe(
        Effect.provide(answering(Answer.cases.ok.make({ result: null }))),
      );

      expect(yield* readJson(result.send!)).toEqual({ jsonrpc: "2.0", id: 0, result: null });
    }),
  );

  // A1: a request on an online connection reaches the route once, with its method, its params and
  // the connection's identity, and an ok or refused answer becomes its one reply. Plant: pass
  // `null` as the identity on an online connection.
  for (const mode of ["ok", "refused"] as const) {
    it.effect.prop(
      `p23: ${mode} has one matching reply`,
      { generated: Answer.cases.refused },
      ({ generated }) =>
        Effect.forEach(
          [Answer.cases.refused.make({ reason: "stale" }), generated],
          (value) => {
            const answer = mode === "ok" ? Answer.cases.ok.make({ result: { rows: [1] } }) : value;
            const attached = online();

            return Effect.gen(function* () {
              const result = yield* answerFrame(frame(), attached);
              expect(result.send).not.toBeNull();
              const reply = yield* Schema.decodeEffect(Schema.fromJsonString(Reply))(result.send!);
              expect(reply).toMatchObject({ jsonrpc: "2.0", id: "r1" });
              expect(mode === "ok" ? reply.result : reply.error?.data).toEqual(
                mode === "ok"
                  ? { rows: [1] }
                  : { reason: value.reason, ...("retryAfter" in value ? { retryAfter: value.retryAfter } : {}) },
              );
              expect(yield* Recorder.calls(Routes)).toEqual([
                { method: "route", args: ["ledger.read", PARAMS, attached.identity] },
              ]);
              assert(result.attached._tag === "online");
              expect(result.attached.waits).toEqual([]);
            }).pipe(Effect.provide(Recorder.layer(Routes, { route: () => Effect.succeed(answer) })));
          },
          { concurrency: 1, discard: true },
        ),
      { arbitrary: { runs: 12 } },
    );
  }

  // A2: a route that fails or dies sends nothing and keeps the attachment, and the same frame
  // again reaches the route a second time. The route counts its own runs: the first fails or dies,
  // the next answers ok. Plant: answer a failed route with a cached reply and skip the second
  // route call.
  for (const mode of ["failure", "defect"] as const) {
    it.effect(`p23: ${mode} sends nothing and permits a real retry`, () => {
      const attached = online();
      let runs = 0;

      const first =
        mode === "failure" ? Effect.fail(RouteError.make({ cause: "offline" })) : Effect.die("route crashed");

      const route = () =>
        Effect.suspend(() => {
          runs += 1;

          return runs === 1 ? first : Effect.succeed(Answer.cases.ok.make({ result: "recovered" }));
        });

      return Effect.gen(function* () {
        const failed = yield* answerFrame(frame(), attached);
        expect(failed).toEqual({ send: null, attached });
        const retried = yield* answerFrame(frame(), failed.attached);
        expect(yield* readJson(retried.send!)).toMatchObject({ id: "r1", result: "recovered" });
        const call = { method: "route", args: ["ledger.read", PARAMS, attached.identity] };
        expect(yield* Recorder.calls(Routes)).toEqual([call, call]);
      }).pipe(Effect.provide(Recorder.layer(Routes, { route })));
    });
  }

  // A3: junk, a response and a notification reach no route. Plant: route a notification.
  for (const text of [
    "{",
    "null",
    "[]",
    JSON.stringify({ jsonrpc: "2.0", id: "r1", result: 7 }),
    JSON.stringify({ jsonrpc: "2.0", method: "news", params: {} }),
  ]) {
    it.effect(`p23: no reply for junk, response or notification ${text}`, () =>
      Effect.gen(function* () {
        expect((yield* answerFrame(text, online())).send).toBeNull();
        expect(yield* Recorder.calls(Routes)).toEqual([]);
      }).pipe(
        Effect.provide(Recorder.layer(Routes, { route: () => Effect.succeed(Answer.cases.ok.make({ result: null })) })),
      ),
    );
  }

  // A4, d2/p23: a connection that is not online never reaches a route. Every request gets one
  // no_hello error with its own id, and the attachment stays as it was. The one way through is a
  // waiting client's gateway.knock: the route runs once with its params and a null identity, and
  // its answer is the one reply. Plants: drop the request silently; let waiting reach any method;
  // answer no_hello to a waiting knock; pass the waiting client's key as an identity to the knock
  // route.
  it.effect.prop(
    "d2: for any unauthenticated state, method and id, only a waiting gateway.knock is routed",
    { attached: unauthenticatedEffect, method, id: jsonRpcId, params: Schema.Json, answer: Schema.Json },
    ({ attached, method, id, params, answer }) =>
      Effect.gen(function* () {
        const result = yield* answerFrame(frame({ id, method, params }), attached);
        expect(result.send).not.toBeNull();
        expect(result.attached).toEqual(attached);
        const wire = <A>(value: A): A => JSON.parse(JSON.stringify(value));
        const calls = yield* Recorder.calls(Routes);

        if (Attached.isAnyOf(["waiting"])(attached) && method === "gateway.knock") {
          expect(calls).toEqual([{ method: "route", args: ["gateway.knock", wire(params), null] }]);
          expect(yield* readJson(result.send!)).toEqual({
            jsonrpc: "2.0",
            id,
            result: wire(answer),
          });
        } else {
          expect(calls).toEqual([]);
          expect(yield* readJson(result.send!)).toEqual({
            jsonrpc: "2.0",
            id,
            error: { code: -32000, message: "no_hello", data: { reason: "no_hello" } },
          });
        }
      }).pipe(
        Effect.provide(
          Recorder.layer(Routes, { route: () => Effect.succeed(Answer.cases.ok.make({ result: answer })) }),
        ),
      ),
    { arbitrary: { runs: 300, maxShrinks: 0 } },
  );
  // d2: a waiting knock whose handler parks sends nothing and the client stays waiting, as it
  // was. Only an online client keeps a parked wait. Plant: treat every parked answer as online.
  it.effect.prop(
    "d2: for any waiting state, a knock that parks sends nothing and leaves it waiting",
    {
      attached: Arbitrary.filter(unauthenticatedEffect, Attached.isAnyOf(["waiting"])),
      id: jsonRpcId,
      stream: Schema.String,
      after: nonnegativeInteger,
    },
    ({ attached, id, stream, after }) =>
      Effect.gen(function* () {
        const result = yield* answerFrame(frame({ id, method: "gateway.knock" }), attached);

        expect(result).toEqual({ send: null, attached });
      }).pipe(Effect.provide(answering(Answer.cases.parked.make({ stream, after })))),
    { arbitrary: { runs: 100, maxShrinks: 0 } },
  );

  for (const id of ["r1", 0]) {
    it.effect(`p23: parked wait retains reply id ${id} and cursor, with no unresolved work`, () =>
      Effect.gen(function* () {
        const result = yield* answerFrame(frame({ id }), online()).pipe(
          Effect.provide(answering(Answer.cases.parked.make({ stream: "x", after: 8 }))),
        );

        expect(result.send).toBeNull();
        assert(result.attached._tag === "online");
        expect(result.attached.waits).toEqual([{ id, stream: "x", after: 8 }]);
        expect(yield* readJson(yield* Schema.encodeEffect(Json)(result.attached))).toEqual(result.attached);
      }),
    );
  }

  // A5: fields a request adds do not reach the route's identity: the third argument is the
  // attached identity. Plant: read the identity from the request's params.
  it.effect("p82: additive request fields leave the reply id and checked writer alone", () => {
    const attached = online();

    return Effect.gen(function* () {
      const result = yield* answerFrame(frame({ future: { by: "forged" } }), attached);
      expect(yield* readJson(result.send!)).toMatchObject({ id: "r1", result: null });
      expect((yield* Recorder.calls(Routes, "route"))[0]?.[2]).toEqual(attached.identity);
    }).pipe(
      Effect.provide(Recorder.layer(Routes, { route: () => Effect.succeed(Answer.cases.ok.make({ result: null })) })),
    );
  });

  // A6: answerFrame needs exactly `Routes` and fails with nothing, so it cannot reach admission or
  // any other service. The compiler checks it (`pnpm typecheck`); Vitest does not typecheck (0527).
  // Plant: make answerFrame also `yield*` another service, such as the hello's `Admissions`; the
  // environment is no longer exactly `Routes` and the typecheck fails.
  it("A6 type: answerFrame's environment is exactly Routes, so it cannot reach admission", () => {
    expectTypeOf<Effect.Services<ReturnType<typeof answerFrame>>>().toEqualTypeOf<Routes>();
    expectTypeOf<Effect.Error<ReturnType<typeof answerFrame>>>().toEqualTypeOf<never>();
  });
});
