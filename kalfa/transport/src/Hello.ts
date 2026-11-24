/**
 * The hello: a client reads the gateway's challenge, signs it, says which versions and features it speaks, and gets the app's answer whole.
 *
 * **Details**
 *
 * The three frames are ordinary notifications of the format, with the method words `challenge`, `hello` and `answer`. Transport carries the challenge, the proof and the answer for the app and reads none of them: each is the app's own schema. `connect` is the client's side and keeps its one connection open for the stream that follows. `challenge`, `accept` and `answer` are the gateway's side, one frame at a time, and touch no socket.
 */
import { Context, Effect, Option, Schema, SchemaTransformation, Tracer } from "effect";
import type { Duration, Scope } from "effect";
import { Socket } from "effect/socket";
import type { Format, FormatError } from "./Format.ts";
import type { Frame } from "./Frame.ts";
import * as Connection from "./internal/connection.ts";
import { receive, send } from "./internal/message.ts";

/** A protocol version: a whole number of 1 or more. */
const Version = Schema.Int.check(Schema.isGreaterThanOrEqualTo(1));

// Whole milliseconds above 0, read into a Duration. Zero, a negative, a fraction and infinity are refused both ways.
const Ping = Schema.Int.check(Schema.isGreaterThan(0)).pipe(
  Schema.decodeTo(Schema.Duration, SchemaTransformation.durationFromMillis),
);

/**
 * The client and the gateway list no version in common.
 *
 * **Details**
 *
 * It holds the two lists and nothing else, no cause: both are public facts, and a frame can hold the app's proof.
 *
 * @category errors
 */
export class NoSharedVersion extends Schema.TaggedError<NoSharedVersion, { readonly brand: unique symbol }>()(
  "NoSharedVersion",
  { client: Schema.Array(Schema.Int), gateway: Schema.Array(Schema.Int) },
) {}

/**
 * What `connect` gives back: the version the gateway picked, its ping interval, the app's answer, and the open socket.
 *
 * @category models
 */
export interface Connected<A> {
  readonly version: number;
  readonly ping: Duration.Duration;
  readonly answer: A;
  /** The one connection `connect` dialed: reading it never dials again. */
  readonly socket: Socket.Socket;
}

/**
 * What `accept` gives the gateway: the version it picked, the client's features, and the app's proof, decoded.
 *
 * @category models
 */
export interface Hello<P> {
  readonly version: number;
  readonly features: ReadonlyArray<string>;
  readonly proof: P;
}

/**
 * What the gateway answers a hello with when the two ends share a version.
 *
 * @category models
 */
export interface Answer<A> {
  readonly version: number;
  readonly ping: Duration.Duration;
  readonly answer: A;
}

const helloValue = <T, E, RD, RE>(proof: Schema.Codec<T, E, RD, RE>) =>
  Schema.Struct({ versions: Schema.Array(Version), features: Schema.Array(Schema.String), proof });

const HelloValue = <H extends Schema.Top>(proof: H) =>
  helloValue<H["Type"], H["Encoded"], H["DecodingServices"], H["EncodingServices"]>(proof);

const answerCase = <T, E, RD, RE>(answer: Schema.Codec<T, E, RD, RE>) =>
  Schema.TaggedStruct("Answer", { version: Version, ping: Ping, answer });

const AnswerCase = <A extends Schema.Top>(answer: A) =>
  answerCase<A["Type"], A["Encoded"], A["DecodingServices"], A["EncodingServices"]>(answer);

const AnswerValue = <A extends Schema.Top>(answer: A) => Schema.Union([AnswerCase(answer), NoSharedVersion]);

// The highest version in both lists, when there is one.
const pick = (client: ReadonlyArray<number>, gateway: ReadonlyArray<number>): Option.Option<number> =>
  Option.fromNullishOr(
    client
      .filter((version) => gateway.includes(version))
      .reduce<number | undefined>(
        (best, version) => (best === undefined || version > best ? version : best),
        undefined,
      ),
  );

// The span the current fiber runs under, as the trace a frame carries: none when tracing is off.
const currentTrace: Effect.Effect<Option.Option<Tracer.ExternalSpan>> = Effect.map(
  Effect.option(Effect.currentSpan),
  Option.filter((span) => !Context.get(span.annotations, Tracer.DisablePropagation)),
).pipe(
  Effect.map(
    Option.map(({ traceId, spanId, sampled, annotations }) =>
      Tracer.externalSpan({ traceId, spanId, sampled, annotations }),
    ),
  ),
);

const describe = (version: number, versions: ReadonlyArray<number>, features: ReadonlyArray<string>) =>
  Effect.annotateCurrentSpan({
    "kalfa.transport.version": version,
    "kalfa.transport.versions": versions,
    "kalfa.transport.features": features,
  });

/**
 * Connects as a client: reads the gateway's challenge, makes the hello's proof from it, sends the hello, and reads the answer, all on one connection.
 *
 * **Details**
 *
 * The connection is dialed once, in the caller's `Scope`, and `socket` is that open connection: a chain provided `socket` reads the frames that came in the answer's batch first and never dials again. A first frame that does not fit fails with a `FormatError`, a gateway that shares no version, or names one the client did not list, fails with `NoSharedVersion`, and the app's own failure in `make` passes through as it is. A failed `connect` closes the connection at once, with code 1002 for Transport's own refusals and 1000 for the app's failure. The call runs in a span `transport.connect` with a child for each step, and the hello carries the trace of its own span.
 *
 * @category client
 */
export const connect = Effect.fn("transport.connect")(function* <
  C extends Schema.Top,
  H extends Schema.Top,
  A extends Schema.Top,
  E = never,
  R = never,
>(options: {
  readonly versions: ReadonlyArray<number>;
  readonly features: ReadonlyArray<string>;
  readonly challenge: C;
  readonly hello: {
    readonly schema: H;
    readonly make: (challenge: C["Type"]) => Effect.Effect<H["Type"], E, R>;
  };
  readonly answer: A;
}): Effect.fn.Return<
  Connected<A["Type"]>,
  NoSharedVersion | Socket.SocketError | FormatError | E,
  Socket.Socket | Format | Scope.Scope | R | C["DecodingServices"] | H["EncodingServices"] | A["DecodingServices"]
> {
  const connection = yield* Connection.open(yield* Socket.Socket);
  // Whether the failure is the app's own, from `make`: it closes with 1000, Transport's own refusals with 1002.
  let theirs = false;

  const connected = yield* Effect.gen(function* () {
    const challenge = yield* Effect.gen(function* () {
      return (yield* receive("challenge")(options.challenge)(yield* connection.next)).value;
    }).pipe(Effect.withSpan("transport.connect.challenge"));

    yield* Effect.gen(function* () {
      const proof = yield* options.hello.make(challenge).pipe(
        Effect.tapError(() =>
          Effect.sync(() => {
            theirs = true;
          }),
        ),
      );

      const trace = yield* currentTrace;

      yield* connection.write(
        yield* send("hello")(HelloValue(options.hello.schema))({
          value: { versions: options.versions, features: options.features, proof },
          trace,
        }),
      );
    }).pipe(Effect.withSpan("transport.connect.hello"));

    return yield* Effect.gen(function* () {
      const { value } = yield* receive("answer")(AnswerValue(options.answer))(yield* connection.next);

      if (Schema.is(NoSharedVersion)(value)) {
        return yield* value;
      }

      if (!options.versions.includes(value.version)) {
        return yield* new NoSharedVersion({ client: options.versions, gateway: [value.version] });
      }

      return { version: value.version, ping: value.ping, answer: value.answer, socket: connection.handOn };
    }).pipe(Effect.withSpan("transport.connect.answer"));
  }).pipe(Effect.tapError((error) => connection.close(theirs || Socket.isSocketError(error) ? 1000 : 1002)));

  yield* describe(connected.version, options.versions, options.features);

  return connected;
});

/**
 * Writes the challenge: the gateway's first frame on a new connection, the app's one-time value, with no trace.
 *
 * @category gateway
 */
export const challenge = <C extends Schema.Top>(schema: C) =>
  Effect.fn("transport.challenge")(function* (
    value: C["Type"],
  ): Effect.fn.Return<Frame, FormatError, Format | C["EncodingServices"]> {
    return yield* send("challenge")(schema)({ value, trace: Option.none() });
  });

/**
 * Reads a hello frame and picks the highest version both ends list.
 *
 * **Details**
 *
 * It reads no socket, no clock and no state. A frame that does not fit fails with a `FormatError`, and two lists with nothing in common fail with `NoSharedVersion`, holding the two lists as they were given. The proof is decoded with the app's schema only. Extra keys in the hello's value are ignored.
 *
 * @category gateway
 */
export const accept = <H extends Schema.Top>(options: {
  readonly versions: ReadonlyArray<number>;
  readonly hello: H;
}) =>
  Effect.fn("transport.accept")(function* (
    frame: Frame,
  ): Effect.fn.Return<Hello<H["Type"]>, NoSharedVersion | FormatError, Format | H["DecodingServices"]> {
    const { value } = yield* receive("hello")(HelloValue(options.hello))(frame);
    const version = pick(value.versions, options.versions);

    if (Option.isNone(version)) {
      return yield* new NoSharedVersion({ client: value.versions, gateway: options.versions });
    }

    yield* describe(version.value, value.versions, value.features);

    return { version: version.value, features: value.features, proof: value.proof };
  });

/**
 * Writes the answer to a hello: the version picked, the ping interval and the app's own answer, or the `NoSharedVersion` itself, with no trace.
 *
 * @category gateway
 */
export const answer = <A extends Schema.Top>(schema: A) =>
  Effect.fn("transport.answer")(function* (
    reply: Answer<A["Type"]> | NoSharedVersion,
  ): Effect.fn.Return<Frame, FormatError, Format | A["EncodingServices"]> {
    const value = Schema.is(NoSharedVersion)(reply) ? reply : AnswerCase(schema).make(reply);

    return yield* send("answer")(AnswerValue(schema))({ value, trace: Option.none() });
  });
