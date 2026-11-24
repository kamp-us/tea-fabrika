// The laws of a fetch (U1, O1, F1 to F3 and T1): the declaration and the proof are checked before any store is asked, the value comes back hidden and
// exactly as the store holds it, a use is recorded before the value is given, nothing is kept between fetches, and a fetch is one span with
// the name, the store and the version. Everything runs in memory, so it runs on every pull request.
import { expect, it } from "@effect/vitest";
import { Arbitrary, Cause, Deferred, Effect, Exit, Fiber, Layer, Option, Predicate, Redacted } from "effect";
import { TestClock } from "effect/testing";
import type * as Errors from "./Errors.ts";
import {
  built,
  countingMemory,
  declare,
  environment,
  fetchAs,
  ITEM,
  memoryDeps,
  memoryEnvironment,
  memoryRoute,
  nameAt,
  proofFor,
  refusedProofs,
  spyStore,
} from "./Fetch.test-support.ts";
import * as MemoryStore from "./MemoryStore.ts";
import * as Recorder from "./Recorder.ts";
import {
  failingRecorder,
  failingStore,
  findable,
  nameTexture,
  SEED,
  valueClasses,
  valueTexture,
  watched,
} from "./Secrets.test-support.ts";

const textured = Arbitrary.all({ names: nameTexture, values: valueTexture });

/** The first typed failure of an exit, or nothing. */
const failure = <A, E>(exit: Exit.Exit<A, E>): Option.Option<E> =>
  Exit.isFailure(exit) ? Cause.findErrorOption(exit.cause) : Option.none();

/** Whether an exit is a defect and no failure, and the text it shows. */
const defect = <A, E>(exit: Exit.Exit<A, E>): { readonly died: boolean; readonly text: string } =>
  Exit.isFailure(exit)
    ? { died: Cause.hasDies(exit.cause) && !Cause.hasFails(exit.cause), text: Cause.pretty(exit.cause) }
    : { died: false, text: "" };

/** The part of a `SecretMissing` the laws compare. */
const missing = (error: Errors.SecretMissing) => ({
  tag: error._tag,
  secret: error.secret,
  store: error.store,
  item: error.item,
  reason: error.reason,
});

// U1. Plant: check `declared` by name (the undeclared copy fetches); check nothing; fail with a typed error where it is a defect; ask the store before
// the check.
it.effect.prop(
  "U1 declared: a declaration that is not in declared dies with a defect naming the name and asks no store, though the declared secret of the same name fetches",
  { drawn: textured },
  ({ drawn }) =>
    Effect.gen(function* () {
      const name = nameAt(drawn.names, 0);
      const listed = declare(name);
      const copy = declare(name);
      const store = spyStore(`${drawn.names.word}-s`);

      const world = environment(
        [store.store],
        [listed],
        [{ name, store: store.store.id, item: drawn.names.word }],
        memoryDeps(),
      );

      yield* Effect.gen(function* () {
        const refused = yield* fetchAs(copy, proofFor(name)).pipe(Effect.exit);

        expect(defect(refused).died, "the copy that is not listed dies").toBe(true);
        expect(defect(refused).text, "naming the name").toContain(name);
        expect(store.asked, "no store is asked").toEqual([]);

        const value = yield* fetchAs(listed, proofFor(name));

        expect(Redacted.value(value), "the listed one fetches").toBe(`value-of-${drawn.names.word}`);
      }).pipe(Effect.provide(world));
    }),
  { arbitrary: { runs: 100, seed: SEED } },
);

// O1. Plant: skip the compare (the other name's proof fetches); compare only the text after the first colon (p fetches); compare a prefix (the longer
// object fetches); ask the store before the compare (the store is asked); fail with a typed error in place of a defect; name only one object in the
// defect.
it.effect.prop(
  "O1 proof: a fetch whose proof's object is another declared name's, the name under another type word, or only like its own dies with a defect naming both objects and asks no store, and a proof for secret:<name> fetches",
  { texture: nameTexture },
  ({ texture }) =>
    Effect.gen(function* () {
      const name = nameAt(texture, 0);
      const secret = declare(name);
      const another = declare(nameAt(texture, 9));
      const store = spyStore(`${texture.word}-s`);

      const world = environment(
        [store.store],
        [secret, another],
        [
          { name, store: store.store.id, item: "one" },
          { name: another.name, store: store.store.id, item: "two" },
        ],
        memoryDeps(),
      );

      const proofs = refusedProofs(texture);

      expect(
        proofs.map((each) => each.id.split(":")[0]),
        "the generator reaches the plan's two classes and the texts like the object",
      ).toEqual(expect.arrayContaining(["o", "p"]));

      yield* Effect.gen(function* () {
        for (const proof of proofs) {
          const object = proof.object(name);
          const exit = yield* fetchAs(secret, object).pipe(Effect.exit);
          const died = defect(exit);

          expect(died.died, `${proof.id}: the fetch dies`).toBe(true);
          expect(died.text, `${proof.id}: naming the secret's object`).toContain(secret.object);
          expect(died.text, `${proof.id}: and the proof's`).toContain(object);
        }

        expect(store.asked, "no store is asked for a refused proof").toEqual([]);

        const value = yield* fetchAs(secret, proofFor(name));

        expect(Redacted.value(value), "a proof for the secret fetches").toBe("value-of-one");
        expect(store.asked, "and then the store is asked").toEqual(["one"]);
      }).pipe(Effect.provide(world));
    }),
  { arbitrary: { runs: 200, seed: SEED } },
);

// F1. Plant: trim the value (c loses a trailing space or line break); cut it at 4 KB (d is shorter); decode a value in PEM armor as base64 first (e is
// bytes); pass an empty held text on as a value (f is a value); give `Redacted.make("")` for nothing (l is a value); return the value as plain text;
// leave the label off the hidden value; answer with the route's item in place of the stored one.
it.effect.prop(
  "F1 value: a fetch gives the value the memory store holds, whole and hidden with the name as its label, for every class of value, and the empty text and an item with nothing in it fail SecretMissing absent and never an empty value",
  { drawn: valueTexture },
  ({ drawn }) =>
    Effect.gen(function* () {
      const name = "transport/turn-key";
      const secret = declare(name);
      const values = valueClasses(drawn);

      expect(values.map((each) => each.id).join(""), "the generator reaches every value class").toBe("cdef");

      const cases = [
        ...values.map((each) => ({ id: each.id, held: { [ITEM]: each.text }, text: each.text })),
        { id: "l", held: {}, text: "" },
      ];

      for (const each of cases) {
        const exit = yield* fetchAs(secret, proofFor(name)).pipe(
          Effect.provide(memoryEnvironment([secret], [memoryRoute(name)], each.held)),
          Effect.exit,
        );

        if (each.text === "") {
          expect(
            Option.map(failure(exit), (error) =>
              Predicate.isTagged(error, "SecretMissing") ? missing(error) : error._tag,
            ),
            `${each.id}: nothing to give`,
          ).toEqual(Option.some({ tag: "SecretMissing", secret: name, store: "memory", item: ITEM, reason: "absent" }));
        } else if (Exit.isSuccess(exit)) {
          const hidden = exit.value;

          expect(Redacted.isRedacted(hidden), `${each.id}: hidden`).toBe(true);
          expect(Redacted.value(hidden), `${each.id}: the value, whole`).toBe(each.text);
          expect(hidden.label, `${each.id}: labeled with the name`).toBe(name);
          expect(String(hidden), `${each.id}: shows only its label`).toBe(
            String(Redacted.make(each.text, { label: name })),
          );
        } else {
          expect.unreachable(`${each.id}: the fetch failed: ${Cause.pretty(exit.cause).slice(0, 200)}`);
        }
      }

      expect(findable(values).length, "the findable values are three").toBe(3);
    }),
  { arbitrary: { runs: 300, seed: SEED } },
);

// F2. Plant: fork the record and return at once (the order check sees the value return before the record ends); record before the read (a store
// that fails leaves a fact); catch a failed record and return the value; record twice; leave the version out of the fact; write the fact for the
// route's item and not the store's version; give the failure the wrong tag.
it.effect.prop(
  "F2 record: a fetch that succeeds writes exactly one Fetched with the name, the store and the store's version, and returns the value only after record returned; a recorder that fails gives SecretsUnavailable with RecordFailed and no value; a store that fails gives SecretsUnavailable with StoreFailed and writes no fact",
  { drawn: textured },
  ({ drawn }) =>
    Effect.gen(function* () {
      const name = nameAt(drawn.names, 0);
      const secret = declare(name);
      const values = findable(valueClasses(drawn.values));

      expect(values.length, "the generator reaches three value classes").toBe(3);

      for (const value of values) {
        // The record comes before the value: a recorder that waits holds the fetch, which is seen to wait and then to finish.
        const started = yield* Deferred.make<void>();
        const gate = yield* Deferred.make<void>();
        const written: Array<Recorder.Fact> = [];

        const gated = Layer.succeed(Recorder.Recorder, {
          record: (fact) =>
            Deferred.succeed(started, undefined).pipe(
              Effect.andThen(Deferred.await(gate)),
              Effect.andThen(Effect.sync(() => void written.push(fact))),
            ),
        });

        const context = yield* Layer.build(
          environment(
            [MemoryStore.store],
            [secret],
            [memoryRoute(name)],
            Layer.merge(MemoryStore.layer({ values: { [ITEM]: value.text } }), gated),
          ),
        ).pipe(Effect.orDie);

        const fetching = yield* Effect.forkChild(fetchAs(secret, proofFor(name)).pipe(Effect.provide(context)));

        yield* Deferred.await(started);

        const racing = yield* Effect.forkChild(
          Fiber.await(fetching).pipe(
            Effect.as("returned"),
            Effect.timeoutOrElse({ duration: "1 second", orElse: () => Effect.succeed("waiting") }),
          ),
        );

        yield* TestClock.adjust("1 second");

        expect(yield* Fiber.join(racing), `${value.id}: the value is not given while the record is not written`).toBe(
          "waiting",
        );

        yield* Deferred.succeed(gate, undefined);

        const given = yield* Fiber.join(fetching);

        expect(Redacted.value(given), `${value.id}: the value comes back once the record is`).toBe(value.text);
        expect(
          written.map((fact) => ({ tag: fact._tag, name: fact.name, store: fact.store, version: fact.version })),
          `${value.id}: exactly one fact, from the store's version`,
        ).toEqual([{ tag: "Fetched", name, store: "memory", version: "1" }]);

        // A recorder that fails: no value, and the reason says the record failed.
        const unrecorded = yield* fetchAs(secret, proofFor(name)).pipe(
          Effect.provide(
            environment(
              [MemoryStore.store],
              [secret],
              [memoryRoute(name)],
              Layer.merge(MemoryStore.layer({ values: { [ITEM]: value.text } }), failingRecorder(value.text)),
            ),
          ),
          Effect.exit,
        );

        expect(
          Option.map(failure(unrecorded), (error) =>
            Predicate.isTagged(error, "SecretsUnavailable")
              ? { tag: error._tag, secret: error.secret, store: error.store, reason: error.reason._tag }
              : error._tag,
          ),
          `${value.id}: the recorder failed`,
        ).toEqual(Option.some({ tag: "SecretsUnavailable", secret: name, store: "memory", reason: "RecordFailed" }));

        // A store that fails: no value, the reason says the store failed, and no fact is written.
        const failing = failingStore(value.text);

        const unread = yield* Effect.gen(function* () {
          const exit = yield* fetchAs(secret, proofFor(name)).pipe(Effect.exit);
          const facts = yield* MemoryStore.Recorded.use((recorded) => recorded.facts);

          return { exit, facts };
        }).pipe(
          Effect.provide(
            environment(
              [failing],
              [secret],
              [{ name, store: failing.id, item: ITEM }],
              memoryDeps({ [ITEM]: value.text }),
            ),
          ),
        );

        expect(
          Option.map(failure(unread.exit), (error) =>
            Predicate.isTagged(error, "SecretsUnavailable")
              ? { tag: error._tag, secret: error.secret, store: error.store, reason: error.reason._tag }
              : error._tag,
          ),
          `${value.id}: the store failed`,
        ).toEqual(Option.some({ tag: "SecretsUnavailable", secret: name, store: failing.id, reason: "StoreFailed" }));
        expect(unread.facts, `${value.id}: a fetch that read nothing writes nothing`).toEqual([]);
      }
    }),
  { arbitrary: { runs: 200, seed: SEED } },
);

// F3. Plant: keep the first value in a `Ref` (the second fetch gives it, and the store is read once); keep it until the version changes; read the
// store only on the first fetch.
it.effect.prop(
  "F3 nothing kept: each fetch reads the store, and a value changed between two fetches comes back new",
  { drawn: textured },
  ({ drawn }) =>
    Effect.gen(function* () {
      const name = nameAt(drawn.names, 0);
      const secret = declare(name);
      const first = findable(valueClasses(drawn.values))[0]?.text ?? "";
      const second = `${first}-changed`;
      const counted = countingMemory();

      expect(first, "the generator draws a first value").not.toBe("");

      const seen = yield* Effect.gen(function* () {
        const fetch = fetchAs(secret, proofFor(name)).pipe(Effect.map(Redacted.value));

        const one = yield* fetch;
        const two = yield* fetch;
        const readsBefore = counted.reads.count;

        yield* MemoryStore.Contents.use((contents) => contents.put(ITEM, second));

        const three = yield* fetch;
        const versions = (yield* MemoryStore.Recorded.use((recorded) => recorded.facts)).map((fact) => fact.version);

        return { values: [one, two, three], readsBefore, reads: counted.reads.count, versions };
      }).pipe(
        Effect.provide(environment([counted.store], [secret], [memoryRoute(name)], memoryDeps({ [ITEM]: first }))),
      );

      expect(seen.values, "the value as the store holds it at each fetch").toEqual([first, first, second]);
      expect(seen.readsBefore, "two fetches read the store twice").toBe(2);
      expect(seen.reads, "and a third, a third time").toBe(3);
      expect(seen.versions, "each fetch is recorded with the version it read").toEqual(["1", "1", "2"]);
    }),
  { arbitrary: { runs: 100, seed: SEED } },
);

// T1. Plant: annotate the item (a kalfa attribute besides the three); name the span `secrets.get`; leave the version off a success; annotate the
// version on a failure that read nothing; end the span with a success when the fetch failed; open two spans for one fetch.
it.effect.prop(
  "T1 span: a fetch ends one span secrets.fetch with kalfa.secrets.name, kalfa.secrets.store and, on success, kalfa.secrets.version, and no other kalfa attribute, and a failed fetch's span ends with the failure the fetch gave",
  { drawn: textured },
  ({ drawn }) =>
    Effect.gen(function* () {
      const value = findable(valueClasses(drawn.values))[0]?.text ?? "";

      for (const id of ["success", "missing", "store", "record"] as const) {
        const flow = yield* built(id, value);

        const { exit, spans } = yield* watched(fetchAs(flow.secret, flow.object).pipe(Effect.provide(flow.context)));

        const fetched = spans.filter((span) => span.name === "secrets.fetch");

        expect(fetched.length, `${id}: one span for one fetch`).toBe(1);

        const [span] = fetched;
        const attributes = new Map([...(span?.attributes ?? [])].filter(([key]) => key.startsWith("kalfa.")));

        expect([...attributes.keys()].sort(), `${id}: no kalfa attribute but the plan's`).toEqual(
          expect.arrayContaining(["kalfa.secrets.name", "kalfa.secrets.store"]),
        );
        expect(
          [...attributes.keys()].filter(
            (key) => !["kalfa.secrets.name", "kalfa.secrets.store", "kalfa.secrets.version"].includes(key),
          ),
          `${id}: and no other`,
        ).toEqual([]);
        expect(attributes.get("kalfa.secrets.name"), `${id}: the name`).toBe(flow.name);
        expect(attributes.get("kalfa.secrets.store"), `${id}: the store`).toBe(flow.store);

        const outcome = span?.status;

        if (Exit.isSuccess(exit)) {
          expect(attributes.get("kalfa.secrets.version"), `${id}: the version the store gave`).toBe("1");
          expect(outcome?._tag === "Ended" && Exit.isSuccess(outcome.exit), `${id}: the span ends well`).toBe(true);
        } else {
          const given = failure(exit);

          const ended =
            outcome?._tag === "Ended" && Exit.isFailure(outcome.exit)
              ? Cause.findErrorOption(outcome.exit.cause)
              : Option.none();

          const expectedTag = id === "missing" ? "SecretMissing" : "SecretsUnavailable";

          expect(
            Option.exists(given, Predicate.isTagged(expectedTag)),
            `${id}: the fetch failed as the plan says`,
          ).toBe(true);
          expect(
            Option.exists(ended, Predicate.isTagged(expectedTag)),
            `${id}: the span ends with the failure the fetch gave`,
          ).toBe(true);
        }
      }
    }),
  { arbitrary: { runs: 100, seed: SEED } },
);
