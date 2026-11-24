// H1 to H9: `Transport.connect`, the client's side of the hello. A client reads the gateway's challenge, makes the proof with the
// app's own `make`, sends the hello and reads the app's answer whole, on one connection. Each law runs over the dialing stand-in
// (a memory pair for each reader acquisition) with a far end the law scripts, and every class of the plan is reached in every run.
import { assert, expect, it } from "@effect/vitest";
import { Effect, Option, Predicate, Schema } from "effect";
import { Socket } from "effect/socket";
import { Format, FormatError, NoSharedVersion } from "./index.ts";
import {
  attempt,
  between,
  checkFailed,
  checkOrder,
  checkWhole,
  closeFrom,
  closing,
  connectionCases,
  dialing,
  failureFrom,
  goodChallenge,
  HANDSHAKE_CLASSES,
  handshakes,
  helloDraw,
  holds,
  LIST_CLASSES,
  PROOF_CLASSES,
  readerFailure,
  REFUSED,
  runCase,
  scripted,
  SEED,
  signInApp,
  unwritableHellos,
  VALUE_CLASSES,
  VERSION_CLASSES,
} from "./Transport.test-support.ts";

/** Fails the law when a class the plan names is not among the classes a run made. */
const reaches = (made: ReadonlyArray<string>, wanted: ReadonlyArray<string>, law: string) =>
  expect(
    wanted.filter((name) => !made.some((each) => each.includes(name))),
    `${law}: every class is reached`,
  ).toEqual([]);

/** The classes of `handshakes` a law takes, by the id of their class. */
const handshakesFor = (draw: Parameters<typeof handshakes>[0], ids: ReadonlyArray<string>) =>
  handshakes(draw).filter(({ id }) => ids.includes(id));

// H1. Plant: give back a fixed `admitted` answer; pick the lowest shared version in `accept`; write the challenge with
// `JSON.stringify` in place of the codec (the BigInt class).
it.effect.prop(
  "H1 the app's answer comes back whole: over the dialing stand-in, connect succeeds with the highest version in both lists, the gateway's ping, the app's answer as it was answered, and make called once with the challenge sent",
  { draw: helloDraw },
  ({ draw }) =>
    Effect.gen(function* () {
      const cases = connectionCases(draw);

      reaches(
        cases.map(({ name }) => name),
        [...VALUE_CLASSES, ...LIST_CLASSES.slice(0, 5), "admitted", "waiting", "refused"],
        "H1",
      );

      for (const each of cases) {
        checkWhole(each, yield* runCase(yield* dialing, each));
      }
    }).pipe(Effect.provide(Format.layerJsonRpc)),
  { arbitrary: { seed: SEED, runs: 300 } },
);

// H2. Plant: `JSON.parse` the first frame with no catch; skip the method compare; decode the challenge with `Schema.Unknown`; leave
// the connection open until the scope ends.
it.effect.prop(
  "H2 a first frame that does not fit: connect fails with a FormatError of text or message, method or value, never a defect; make is never called; the far end reads no hello and reads the close 1002 before the scope ends",
  { draw: helloDraw },
  ({ draw }) =>
    Effect.gen(function* () {
      const classes = handshakesFor(draw, ["a", "b", "c"]);
      reaches(
        classes.map(({ name }) => name),
        HANDSHAKE_CLASSES.slice(0, 10),
        "H2",
      );

      for (const each of classes) {
        checkFailed(each, yield* attempt(each));
      }
    }).pipe(Effect.provide(Format.layerJsonRpc)),
  { arbitrary: { seed: SEED, runs: 300 } },
);

// H3. Plant: wrap make's error in `FormatError "value"`; close with the refusal code for it; delete the flag that says make failed, so the
// app's own FormatError or NoSharedVersion closes as a refusal.
it.effect.prop(
  "H3 the app's failure stays the app's: connect fails with the very error make failed with, not a FormatError or a SocketError; the far end reads no hello and reads the close 1000",
  { draw: helloDraw },
  ({ draw }) =>
    Effect.gen(function* () {
      const classes = handshakesFor(draw, ["d"]);
      reaches(
        classes.map(({ name }) => name),
        [HANDSHAKE_CLASSES[10]],
        "H3",
      );

      for (const each of classes) {
        const run = yield* attempt(each);
        checkFailed(each, run);

        const exit = Option.getOrElse(run.exit, () => assert.fail("connect stalled"));
        expect(
          Option.map(failureFrom(exit).error, (error) => (Predicate.hasProperty(error, "_tag") ? error._tag : error)),
          "not a FormatError or a SocketError",
        ).toEqual(Option.some("AppFailure"));
      }

      // An app whose own error is a FormatError or a NoSharedVersion, the names of Transport's refusals: it is still the app's,
      // and the connection closes with 1000 and no refusal.
      for (const [name, own] of [
        ["a FormatError", new FormatError({ reason: "value" })],
        ["a NoSharedVersion", new NoSharedVersion({ client: [1], gateway: [2] })],
      ] as const) {
        const run = yield* attempt({
          app: { ...signInApp, make: () => Effect.fail(own) },
          client: { versions: [1], features: [] },
          program: scripted(Option.some(goodChallenge(draw.nonce)), Option.none()),
        });

        const exit = Option.getOrElse(run.exit, () => assert.fail(`${name}: connect stalled`));
        expect(Option.getOrUndefined(failureFrom(exit).error), `${name}: the app's own error, as it was`).toBe(own);
        expect(
          Option.map(run.seen.close, ({ code, reason }) => ({ code, reason })),
          `${name}: closed with 1000 and no reason`,
        ).toEqual(Option.some({ code: 1000, reason: undefined }));
      }
    }).pipe(Effect.provide(Format.layerJsonRpc)),
  { arbitrary: { seed: SEED, runs: 100 } },
);

// H4. Plant: write the features under `has`; write the versions with no `Int` check; write the proof with `JSON.stringify`.
it.effect.prop(
  "H4 the hello a client sends: versions and a proof the codec cannot write fail with a FormatError of value and no hello goes out; a valid hello is one notification of the method hello whose value holds exactly versions, features and proof, as given",
  { draw: helloDraw },
  ({ draw }) =>
    Effect.gen(function* () {
      const bad = unwritableHellos(draw);
      reaches(
        bad.map(({ name }) => name),
        [...VERSION_CLASSES, ...PROOF_CLASSES],
        "H4 (e) and (f)",
      );

      for (const each of bad) {
        checkFailed(each, yield* attempt(each));
      }

      for (const each of connectionCases(draw)) {
        const out = yield* runCase(yield* dialing, each);
        const hello = holds(out.seen.frames[0] ?? "");

        expect(hello.method, `${each.name}: the method`).toBe("hello");
        expect(Object.keys(hello.params.value).sort(), `${each.name}: the keys of the value`).toEqual([
          "features",
          "proof",
          "versions",
        ]);
        assert.deepStrictEqual(
          hello.params.value.versions,
          [...each.client.versions],
          `${each.name}: versions as given`,
        );
        assert.deepStrictEqual(
          hello.params.value.features,
          [...each.client.features],
          `${each.name}: features as given`,
        );

        const proof = yield* each.app.make(each.challenge);
        expect(
          JSON.stringify(hello.params.value.proof),
          `${each.name}: the proof is the codec's writing of what make gave`,
        ).toBe(JSON.stringify(Schema.encodeUnknownSync(Schema.toCodecJson(each.app.proof))(proof)));
      }
    }).pipe(Effect.provide(Format.layerJsonRpc)),
  { arbitrary: { seed: SEED, runs: 300 } },
);

// H5. Plant: skip the method compare on the answer; read the ping with `Schema.DurationFromMillis` as it ships; read a
// NoSharedVersion reply as an answer with no version; skip the client's own version check.
it.effect.prop(
  "H5 an answer that does not fit, or a refusal: connect fails with a FormatError of the frame's reason, or with the gateway's own NoSharedVersion, or with one naming the version the gateway named; each closes with Transport's refusal code",
  { draw: helloDraw },
  ({ draw }) =>
    Effect.gen(function* () {
      const classes = handshakesFor(draw, ["g", "h", "i", "j"]);
      reaches(
        classes.map(({ name }) => name),
        HANDSHAKE_CLASSES.slice(11),
        "H5",
      );

      for (const each of classes) {
        checkFailed(each, yield* attempt(each));
      }
    }).pipe(Effect.provide(Format.layerJsonRpc)),
  { arbitrary: { seed: SEED, runs: 300 } },
);

// H6. Plant: drop the frames left in the answer's batch; give them after the next pull's frames.
it.effect.prop(
  "H6 frames that came with the answer go to the chain: the chain on the handed-on socket reads every value frame of the answer's batch first, in order, then the later ones; none is lost and none is read twice",
  { draw: helloDraw },
  ({ draw }) =>
    Effect.gen(function* () {
      for (const each of connectionCases(draw)) {
        checkOrder(each, yield* runCase(yield* dialing, each));
      }
    }).pipe(Effect.provide(Format.layerJsonRpc)),
  { arbitrary: { seed: SEED, runs: 200 } },
);

// The codes a browser lets a client write, which the memory pair keeps: a gateway's own 1001 or 1011 cannot be written through it.
const CLOSE_CODES = [1000, 3000, 4999] as const;

// H7. Plant: end the read cleanly on the close 1000, as `socket` does (connect hangs on its next frame).
it.effect.prop(
  "H7 a close during the hello: connect fails with Effect's SocketError holding the close's code and reason, 1000 included; it never succeeds, never hangs and is never a defect",
  { draw: helloDraw, code: between(3000, 4999) },
  ({ draw, code }) =>
    Effect.gen(function* () {
      for (const closeCode of [...CLOSE_CODES, code]) {
        for (const reason of [undefined, draw.reason]) {
          for (const when of ["before the challenge", "after the hello"] as const) {
            const name = `${when}, code ${closeCode}, ${reason === undefined ? "no reason" : "a reason"}`;

            const run = yield* attempt({
              app: signInApp,
              client: { versions: [1], features: [] },
              program: closing(when, closeCode, reason, draw.nonce),
            });

            const exit = Option.getOrElse(run.exit, () => assert.fail(`${name}: connect stalled`));
            const { error, defect } = failureFrom(exit);

            expect(defect, `${name}: never a defect`).toBe(false);
            expect(
              Option.flatMap(error, (each) => (Socket.isSocketError(each) ? closeFrom(each) : Option.none())),
              `${name}: the close, as Effect's SocketError holds it`,
            ).toEqual(Option.some({ code: closeCode, reason }));
          }
        }
      }
    }).pipe(Effect.provide(Format.layerJsonRpc)),
  { arbitrary: { seed: SEED, runs: 200 } },
);

/** The error each refusal of Transport's own is, by the kind a law expects. */
const REFUSAL_TAGS = { format: "FormatError", noShared: "NoSharedVersion" } as const;

// H8. Plant: close with 1002 or with 1000 for a refusal; write no reason; write a reason that does not name the error; close a
// NoSharedVersion with another code than a FormatError; write a reason of more than 123 bytes.
it.effect.prop(
  "H8 a refused connect's close reaches the far end: for every refusal of Transport's own, the far end reads a close with a code of 4000 to 4999, the same code for every refusal, and a reason that names the error and fits the 123 bytes a browser allows",
  { draw: helloDraw },
  ({ draw }) =>
    Effect.gen(function* () {
      const refusals = handshakes(draw).filter(({ expected }) => expected.kind !== "app");
      const codes = new Set<number>();
      const kinds = new Set<string>();

      for (const each of refusals) {
        const run = yield* attempt(each);
        const close = Option.getOrElse(run.seen.close, () => assert.fail(`${each.name}: the far end read no close`));
        const tag = REFUSAL_TAGS[each.expected.kind === "format" ? "format" : "noShared"];

        expect(close.code >= REFUSED.low && close.code <= REFUSED.high, `${each.name}: a code of 4000 to 4999`).toBe(
          true,
        );
        expect(close.reason?.includes(tag), `${each.name}: the reason names ${tag}`).toBe(true);
        expect(
          new TextEncoder().encode(close.reason ?? "").length <= 123,
          `${each.name}: the reason fits 123 bytes`,
        ).toBe(true);
        codes.add(close.code);
        kinds.add(each.expected.kind);
      }

      expect([...kinds].sort(), "a FormatError and a NoSharedVersion are both refused").toEqual(["format", "noShared"]);
      expect(codes.size, "one code for every refusal").toBe(1);
    }).pipe(Effect.provide(Format.layerJsonRpc)),
  { arbitrary: { seed: SEED, runs: 100 } },
);

// H9. Plant: delete `|| Socket.isSocketError(error)` from the close code, so a socket's own failure closes as a refusal.
it.effect.prop(
  "H9 a socket's own failure is no refusal: when the socket's reader fails with a SocketError, before the challenge or after the hello, connect fails with that error and closes with 1000, never with a refusal code",
  { draw: helloDraw },
  ({ draw }) =>
    Effect.gen(function* () {
      for (const when of ["before the challenge", "after the hello"] as const) {
        const run = yield* readerFailure(when, draw.nonce);
        const exit = Option.getOrElse(run.exit, () => assert.fail(`${when}: connect stalled`));
        const { error, defect } = failureFrom(exit);

        expect(defect, `${when}: never a defect`).toBe(false);
        expect(Option.exists(error, Socket.isSocketError), `${when}: connect fails with the SocketError`).toBe(true);
        expect(run.closes, `${when}: one close, 1000`).toEqual([1000]);
        expect(run.frames, `${when}: the hello is written only after the challenge`).toBe(
          when === "after the hello" ? 1 : 0,
        );
      }
    }).pipe(Effect.provide(Format.layerJsonRpc)),
  { arbitrary: { seed: SEED, runs: 100 } },
);
