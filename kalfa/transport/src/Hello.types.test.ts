// D8, D6 and D7 (the plan names D8 as D5, which Transport.types.test.ts already holds): the types of the hello. The compile-time laws need tsc (the build runs it); each is written as a function the test never
// calls, so no value is declared and the file also runs under vitest. D8 also runs the plan's sketch, a chain on the socket `connect` gave.
import { assert, expectTypeOf, it } from "@effect/vitest";
import { Context, Duration, Effect, Exit, Layer, Option, Schema, Stream } from "effect";
import type { Scope } from "effect";
import { Socket } from "effect/socket";
import { Format, Transport } from "./index.ts";
import type { Answer, Connected, FormatError, Frame, Hello, NoSharedVersion } from "./index.ts";
import {
  Challenge,
  challengeFrom,
  dialing,
  honest,
  Message,
  Proof,
  Refused,
  SEED,
  signed,
  SignInAnswer,
  settled,
  TURNS,
  helloDraw,
  connectionCases,
} from "./Transport.test-support.ts";

class Signer extends Context.Service<Signer, { readonly sign: (nonce: string) => typeof Proof.Type }>()(
  "@kalfa/transport/test/Signer",
) {}

class SignError extends Schema.TaggedError<SignError, { readonly brand: unique symbol }>()("SignError", {
  word: Schema.String,
}) {}

class NeedsDecoding extends Context.Service<NeedsDecoding, string>()("@kalfa/transport/test/NeedsDecoding") {}

class NeedsEncoding extends Context.Service<NeedsEncoding, string>()("@kalfa/transport/test/NeedsEncoding") {}

class NeedsAnswering extends Context.Service<NeedsAnswering, string>()("@kalfa/transport/test/NeedsAnswering") {}

// Plant: type `make`'s parameter as `unknown` (the `challenge.nonce` line fails); drop `Scope` from the needs; drop `E` from the errors
// (the `SignError` line fails).
const connectTypes = (sign: (nonce: string) => Effect.Effect<typeof Proof.Type, SignError, Signer>) => {
  const connecting = Transport.connect({
    versions: [1, 2],
    features: ["spans"],
    challenge: Challenge,
    hello: { schema: Proof, make: (challenge) => sign(challenge.nonce) },
    answer: SignInAnswer,
  });

  expectTypeOf(connecting).toEqualTypeOf<
    Effect.Effect<
      Connected<SignInAnswer>,
      NoSharedVersion | Socket.SocketError | FormatError | SignError,
      Socket.Socket | Format | Scope.Scope | Signer
    >
  >();

  return [connecting];
};

/** The plan's sketch: connect, then a chain on the socket it gave, with the stand-in and the format provided. */
const sketch = (values: Stream.Stream<Message>, stand: Socket.Socket, versions: ReadonlyArray<number>) =>
  Effect.gen(function* () {
    const connected = yield* Transport.connect({
      versions,
      features: ["spans"],
      challenge: Challenge,
      hello: { schema: Proof, make: (challenge) => Effect.succeed(signed(challenge.nonce)) },
      answer: SignInAnswer,
    });

    yield* values.pipe(
      Transport.encode(Message),
      Transport.socket,
      Transport.decode(Message),
      Stream.runDrain,
      Effect.provideService(Socket.Socket, connected.socket),
    );
  }).pipe(Effect.scoped, Effect.provide(Layer.mergeAll(Format.layerJsonRpc, Layer.succeed(Socket.Socket, stand))));

it.effect.prop(
  "D8 type and run: connect for the test app's schemas and a make of Effect<Proof, SignError, Signer> is Effect<Connected<SignInAnswer>, NoSharedVersion | SocketError | FormatError | SignError, Socket | Format | Scope | Signer> with make's challenge typed and no annotation, and the sketch's chain, provided the stand-in and the format, is Effect<void, ..., never> and runs",
  { draw: helloDraw },
  ({ draw }) =>
    Effect.gen(function* () {
      // These compile-time laws need tsc, which the build runs.
      expectTypeOf(connectTypes).toBeFunction();
      expectTypeOf(sketch).returns.toEqualTypeOf<
        Effect.Effect<void, NoSharedVersion | Socket.SocketError | FormatError, never>
      >();

      const standIn = yield* dialing;
      const [each] = connectionCases(draw);

      if (each === undefined) {
        return assert.fail("no case is made");
      }

      yield* standIn.serve(
        honest({
          app: each.app,
          challenge: each.challenge,
          versions: each.gateway.versions,
          ping: each.gateway.ping,
          answer: each.gateway.answer,
          batch: each.batch,
          later: [],
          reads: 0,
          closes: "after reading",
        }),
      );

      const run = yield* settled(sketch(Stream.empty, standIn.socket, each.gateway.versions), TURNS);
      assert.isTrue(Option.exists(run, Exit.isSuccess), "the sketch ends, and succeeds");
    }).pipe(Effect.provide(Format.layerJsonRpc)),
  { arbitrary: { seed: SEED, runs: 100 } },
);

// Plant: type `make` as `(c) => H["Type"] | Effect<H["Type"]>` (the plain-value line compiles, the unused `@ts-expect-error` fails);
// type `features` as `Array<string>` (the line that holds a readonly array fails); drop `A["DecodingServices"]` (the decoding-service line fails).
const optionTypes = (
  top: Schema.Top,
  unknown: typeof Schema.Unknown,
  loose: any,
  needsDecoding: Schema.Codec<string, string, NeedsDecoding, never>,
  needsEncoding: Schema.Codec<string, string, never, NeedsEncoding>,
  needsAnswering: Schema.Codec<string, string, NeedsAnswering, never>,
  readonlyVersions: ReadonlyArray<number>,
  readonlyFeatures: ReadonlyArray<string>,
) => {
  // No type arguments, and explicit ones.
  const plain = Transport.connect({
    versions: [1],
    features: [],
    challenge: Challenge,
    hello: { schema: Proof, make: () => Effect.succeed(signed("x")) },
    answer: SignInAnswer,
  });

  expectTypeOf(plain).toEqualTypeOf<
    Effect.Effect<
      Connected<SignInAnswer>,
      NoSharedVersion | Socket.SocketError | FormatError,
      Socket.Socket | Format | Scope.Scope
    >
  >();

  const explicit = Transport.connect<typeof Challenge, typeof Proof, typeof SignInAnswer, never, never>({
    versions: [1],
    features: [],
    challenge: Challenge,
    hello: { schema: Proof, make: () => Effect.succeed(signed("x")) },
    answer: SignInAnswer,
  });

  expectTypeOf(explicit).toEqualTypeOf<typeof plain>();

  // Schemas typed Top, Unknown and any.
  const topped = Transport.connect({
    versions: [1],
    features: [],
    challenge: top,
    hello: { schema: top, make: () => Effect.void },
    answer: top,
  });

  expectTypeOf(topped).toExtend<Effect.Effect<Connected<unknown>, unknown, unknown>>();

  const unknowns = Transport.connect({
    versions: [1],
    features: [],
    challenge: unknown,
    hello: { schema: unknown, make: () => Effect.succeed("x") },
    answer: unknown,
  });

  expectTypeOf(unknowns).toEqualTypeOf<
    Effect.Effect<
      Connected<unknown>,
      NoSharedVersion | Socket.SocketError | FormatError,
      Socket.Socket | Format | Scope.Scope
    >
  >();

  const loosened = Transport.connect({
    versions: [1],
    features: [],
    challenge: loose,
    hello: { schema: loose, make: () => Effect.void },
    answer: loose,
  });

  expectTypeOf(loosened).toExtend<Effect.Effect<unknown, unknown, unknown>>();

  // A challenge and an answer that need a decoding service, and a proof that needs an encoding service: each need shows in R.
  const needing = Transport.connect({
    versions: [1],
    features: [],
    challenge: needsDecoding,
    hello: { schema: needsEncoding, make: () => Effect.succeed("x") },
    answer: needsAnswering,
  });

  expectTypeOf(needing).toEqualTypeOf<
    Effect.Effect<
      Connected<string>,
      NoSharedVersion | Socket.SocketError | FormatError,
      Socket.Socket | Format | Scope.Scope | NeedsDecoding | NeedsEncoding | NeedsAnswering
    >
  >();

  // `versions` as a readonly tuple, `features` as `[]` and as a readonly tuple.
  const tuples = Transport.connect({
    versions: [1, 2] as const,
    features: ["spans"] as const,
    challenge: Challenge,
    hello: { schema: Proof, make: () => Effect.succeed(signed("x")) },
    answer: SignInAnswer,
  });

  expectTypeOf(tuples).toEqualTypeOf<typeof plain>();

  // `versions` and `features` as readonly arrays held in a variable.
  const held = Transport.connect({
    versions: readonlyVersions,
    features: readonlyFeatures,
    challenge: Challenge,
    hello: { schema: Proof, make: () => Effect.succeed(signed("x")) },
    answer: SignInAnswer,
  });

  expectTypeOf(held).toEqualTypeOf<typeof plain>();

  // `make` gives an Effect: a plain value, and an Effect of another type, are refused.
  const refusedPlain = Transport.connect({
    versions: [1],
    features: [],
    challenge: Challenge,
    // @ts-expect-error `make` gives an Effect, never a plain value.
    hello: { schema: Proof, make: () => signed("x") },
    answer: SignInAnswer,
  });

  const refusedType = Transport.connect({
    versions: [1],
    features: [],
    challenge: Challenge,
    // @ts-expect-error `make` gives an Effect of the proof's type, never of another type.
    hello: { schema: Proof, make: () => Effect.succeed(42) },
    answer: SignInAnswer,
  });

  return [plain, explicit, topped, unknowns, loosened, needing, tuples, held, refusedPlain, refusedType];
};

it("D6 type: every way the options are typed compiles with the plan's types (no type arguments, explicit ones, Top, Unknown, any, services in R, readonly tuples), and a make that gives a plain value or an Effect of another type is refused", () => {
  expectTypeOf(optionTypes).toBeFunction();
});

// Plant: make `accept` need `Socket.Socket` (the needs line fails); let `answer` take a `FormatError` (the `@ts-expect-error` line is
// unused and fails).
const gatewayTypes = (
  frame: Frame,
  error: FormatError,
  needsDecoding: Schema.Codec<string, string, NeedsDecoding, never>,
) => {
  const accepting = Transport.accept({ versions: [1], hello: Proof })(frame);
  expectTypeOf(accepting).toEqualTypeOf<
    Effect.Effect<Hello<typeof Proof.Type>, NoSharedVersion | FormatError, Format>
  >();

  const needing = Transport.accept({ versions: [1], hello: needsDecoding })(frame);
  expectTypeOf(needing).toEqualTypeOf<
    Effect.Effect<Hello<string>, NoSharedVersion | FormatError, Format | NeedsDecoding>
  >();

  const challenging = Transport.challenge(Challenge)(challengeFrom("x"));
  expectTypeOf(challenging).toEqualTypeOf<Effect.Effect<Frame, FormatError, Format>>();

  const answering = Transport.answer(SignInAnswer)({
    version: 1,
    ping: Duration.seconds(30),
    answer: Refused.make({ reason: "no" }),
  } satisfies Answer<SignInAnswer>);

  expectTypeOf(answering).toEqualTypeOf<Effect.Effect<Frame, FormatError, Format>>();

  // @ts-expect-error `answer` takes an Answer or a NoSharedVersion and nothing else.
  // @effect-diagnostics-next-line missingEffectError:off -- a FormatError is an Effect, and the call is refused on purpose
  const refusing = () => Transport.answer(SignInAnswer)(error);

  return [accepting, needing, challenging, answering, refusing];
};

it("D7 type: accept is a function of a frame that needs Format and the proof's services only, with no Socket and no Scope; challenge and answer give Effect<Frame, FormatError, Format>; answer takes an Answer or a NoSharedVersion and nothing else", () => {
  expectTypeOf(gatewayTypes).toBeFunction();
});
