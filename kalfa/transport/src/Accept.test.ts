// A1 to A3: the gateway's side of the hello, one frame at a time. `accept` reads a hello frame and picks the highest version both ends
// list, `challenge` and `answer` write the gateway's two frames. None of them touches a socket: each is a function of a frame or a
// value, and needs only the format.
import { assert, expect, it } from "@effect/vitest";
import { Duration, Effect, Exit, Option, Schema } from "effect";
import { Format, FormatError, NoSharedVersion, Transport } from "./index.ts";
import {
  Admitted,
  answersFrom,
  failureFrom,
  HELLO_CLASSES,
  helloDraw,
  helloValue,
  hellos,
  LIST_CLASSES,
  metaFrom,
  notification,
  PING_CLASSES,
  Proof,
  SEED,
  SignInAnswer,
  unwritablePings,
  valueClasses,
  valueFrom,
  versionLists,
  wire,
  VALUE_CLASSES,
} from "./Transport.test-support.ts";

// A1. Plant: pick the gateway's highest without checking the client's list; pick the client's first; give version 0 when nothing is
// shared.
it.effect.prop(
  "A1 accept picks the version: for lists that share one, the highest number in both with the hello's features and its proof; for lists that share none, NoSharedVersion holding the two lists exactly as given",
  { draw: helloDraw },
  ({ draw }) =>
    Effect.gen(function* () {
      const lists = versionLists(draw.pool);
      expect(
        lists.map(({ name }) => name),
        "every class (n) and (o) is reached",
      ).toEqual([...LIST_CLASSES]);

      for (const each of lists) {
        const frame = notification("hello", helloValue(draw, { versions: [...each.client] }));
        const exit = yield* Effect.exit(Transport.accept({ versions: each.gateway, hello: Proof })(frame));

        if (Option.isSome(each.picked)) {
          assert.isTrue(Exit.isSuccess(exit), `${each.name}: a version is picked`);

          if (Exit.isSuccess(exit)) {
            const hello = exit.value;
            expect(hello.version, `${each.name}: the highest in both lists`).toBe(each.picked.value);
            assert.deepStrictEqual(hello.features, [...draw.features], `${each.name}: the hello's features`);
            expect(Schema.toEquivalence(Proof)(hello.proof, helloValueProof(draw)), `${each.name}: the proof`).toBe(
              true,
            );
          }
        } else {
          const { error, defect } = failureFrom(exit);
          expect(defect, `${each.name}: never a defect`).toBe(false);
          expect(
            Option.map(error, (value) =>
              Schema.is(NoSharedVersion)(value) ? { client: value.client, gateway: value.gateway } : value,
            ),
            `${each.name}: no version is shared`,
          ).toEqual(Option.some({ client: [...each.client], gateway: [...each.gateway] }));
        }
      }
    }).pipe(Effect.provide(Format.layerJsonRpc)),
  { arbitrary: { seed: SEED, runs: 300 } },
);

const helloValueProof = (draw: Parameters<typeof helloValue>[0]) =>
  Schema.decodeUnknownSync(Proof)(helloValue(draw).proof);

// A2. Plant: skip the method compare; decode the proof with `Schema.Json`; read `has` when `features` is missing.
it.effect.prop(
  "A2 accept refuses a hello that does not fit: a FormatError of text, message or method for a frame that is no hello, of value for a value that does not fit; never a defect, never a NoSharedVersion",
  { draw: helloDraw },
  ({ draw }) =>
    Effect.gen(function* () {
      const frames = hellos(draw);
      expect(
        frames.map(({ name }) => name),
        "every class (p) and (q) is reached",
      ).toEqual([...HELLO_CLASSES]);

      const [p0 = 1] = draw.pool;

      for (const each of frames) {
        const exit = yield* Effect.exit(Transport.accept({ versions: [p0], hello: Proof })(each.frame));
        const { error, defect } = failureFrom(exit);

        expect(defect, `${each.name}: never a defect`).toBe(false);
        expect(
          Option.map(error, (value) => (Schema.is(FormatError)(value) ? value.reason : value)),
          `${each.name}: the frame is refused as a frame, with its reason`,
        ).toEqual(Option.some(each.reason));
      }
    }).pipe(Effect.provide(Format.layerJsonRpc)),
  { arbitrary: { seed: SEED, runs: 300 } },
);

// A3. Plant: write the ping with `Schema.Duration`'s own codec; round a fraction to whole milliseconds; let `Duration.infinity` through.
it.effect.prop(
  "A3 the gateway's writers: challenge gives one notification of the method challenge with the codec's writing and no _meta; answer gives method answer with the version, the ping in whole milliseconds and the app's answer, or the NoSharedVersion as its own JSON; a ping it cannot write fails with a FormatError of value and gives no frame",
  { draw: helloDraw },
  ({ draw }) =>
    Effect.gen(function* () {
      // (r): a challenge of each class (a) to (d), as the codec writes it.
      const classes = valueClasses(draw.seeds);
      expect(
        classes.map(({ name }) => name),
        "every class (r) is reached",
      ).toEqual([...VALUE_CLASSES]);

      for (const klass of classes) {
        for (const value of klass.values) {
          const frame = yield* Transport.challenge(klass.schema)(value);
          const written = valueFrom(frame);

          expect(written.method, `${klass.name}: the method`).toBe("challenge");
          expect(metaFrom(frame).params._meta, `${klass.name}: no trace is written`).toBeUndefined();
          expect(JSON.stringify(written.params.value), `${klass.name}: the value is the codec's writing`).toBe(
            JSON.stringify(Schema.encodeUnknownSync(Schema.toCodecJson(klass.schema))(value)),
          );
        }
      }

      // (m) x (n): an answer of each kind, with the version of each list that shares one.
      for (const [index, answer] of answersFrom(draw.text).entries()) {
        for (const each of versionLists(draw.pool).filter(({ id }) => id === "n")) {
          const version = Option.getOrThrow(each.picked);
          const frame = yield* Transport.answer(SignInAnswer)({ version, ping: Duration.millis(draw.ping), answer });
          const written = valueFrom(frame);

          expect(written.method, `answer ${index}: the method`).toBe("answer");
          assert.deepStrictEqual(
            written.params.value,
            wire("Answer", { version, ping: draw.ping, answer }),
            `${each.name}, ${answer._tag}: the answer as written`,
          );
          expect(metaFrom(frame).params._meta, "no trace is written").toBeUndefined();
        }
      }

      const refusal = new NoSharedVersion({ client: draw.left, gateway: draw.right });
      const written = valueFrom(yield* Transport.answer(SignInAnswer)(refusal));
      expect(written.method, "the refusal's method").toBe("answer");
      assert.deepStrictEqual(
        written.params.value,
        wire("NoSharedVersion", { client: [...draw.left], gateway: [...draw.right] }),
        "the refusal as its own JSON",
      );

      // (s): a ping that cannot be written.
      const pings = unwritablePings(draw);
      expect(
        pings.map(({ name }) => name),
        "every class (s) is reached",
      ).toEqual([...PING_CLASSES]);

      for (const { name, ping } of pings) {
        const exit = yield* Effect.exit(
          Transport.answer(SignInAnswer)({ version: 1, ping, answer: Admitted.make({ name: draw.nonce }) }),
        );

        const { error, defect } = failureFrom(exit);

        expect(defect, `${name}: never a defect`).toBe(false);
        expect(
          Option.map(error, (value) => (Schema.is(FormatError)(value) ? value.reason : value)),
          `${name}: no frame, a FormatError of value`,
        ).toEqual(Option.some("value"));
      }
    }).pipe(Effect.provide(Format.layerJsonRpc)),
  { arbitrary: { seed: SEED, runs: 300 } },
);
