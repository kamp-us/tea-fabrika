// The laws of the memory store, the `/memory` entry point: it passes every shared law of a secret store (M1a to M1f, run by `StoreTest.suite`), it
// is the store `memory` in the place `memory`, it counts versions for each item from 1, its seed is what a person had already put, and its
// recorder keeps every fact it is given, in order. All of it runs in memory on every pull request.
import { describe, expect, it } from "@effect/vitest";
import { Arbitrary, Array as Arr, Effect, Option, Schema } from "effect";
import * as MemoryStore from "./MemoryStore.ts";
import * as Name from "./Name.ts";
import * as Recorder from "./Recorder.ts";
import {
  acceptedNames,
  acceptedStoreIds,
  acceptedVersions,
  between,
  findable,
  found,
  holder,
  nameTexture,
  outcome,
  reading,
  SEED,
  valueClasses,
  valueTexture,
} from "./Secrets.test-support.ts";
import * as StoreTest from "./StoreTest.ts";

const memorySubject: StoreTest.Subject<string, MemoryStore.Contents> = {
  store: MemoryStore.store,
  empty: MemoryStore.layer(),
  put: (item, value) => MemoryStore.Contents.use((contents) => contents.put(item, value)),
  remove: (item) => MemoryStore.Contents.use((contents) => contents.remove(item)),
  items: ["app-key", "turn-key", "client-7f3a"],
};

StoreTest.suite("memory", memorySubject, { runs: 200, timeout: 60_000 });

/** The version a read of `item` gives, or `absent` when it gave none. */
const versionRead = (item: string) =>
  holder(MemoryStore.store)
    .read(item)
    .pipe(
      Effect.map((held) =>
        Option.getOrElse(
          Option.map(found(held), (each) => each.version),
          () => "absent",
        ),
      ),
    );

describe("the memory store", () => {
  // M4. Plant: name the store `mem`; give it the place `store`; leave its `holds` port out; take the empty text as an item.
  it.effect.prop(
    "M4 identity: the store is `memory`, in the place `memory`, holds values, and takes any non-empty text as an item and refuses the empty text",
    { texture: valueTexture },
    ({ texture }) =>
      Effect.sync(() => {
        const store = MemoryStore.store;

        expect(store.id).toBe("memory");
        expect(store.place).toBe("memory");
        expect(store.holds, "it holds values").toBeDefined();

        for (const value of findable(valueClasses(texture))) {
          expect(Schema.decodeUnknownSync(store.item)(value.text), `${value.id}: an item is its text`).toBe(value.text);
        }

        expect(() => Schema.decodeUnknownSync(store.item)(""), "the empty text is no item").toThrow();
        expect(Schema.is(Name.StoreId)(store.id), "its id is a store id").toBe(true);
      }),
    { arbitrary: { runs: 100, seed: SEED } },
  );

  const puts = Arbitrary.all({
    texture: valueTexture,
    items: Arbitrary.array(between(0, 2), { minLength: 1, maxLength: 12 }),
  });

  // M5. Plant: count versions for the whole store and not for each item; start at 0; count from the item's first read; give every put the
  // same version.
  it.effect.prop(
    "M5 versions: each put makes the next version of its own item, counted from 1, and a read gives the version of the last put",
    { drawn: puts },
    ({ drawn }) =>
      Effect.gen(function* () {
        const values = findable(valueClasses(drawn.texture));
        const items = ["app-key", "turn-key", "client-7f3a"];
        const counts = [0, 0, 0];

        yield* Effect.gen(function* () {
          const contents = yield* MemoryStore.Contents;

          for (const [step, index] of drawn.items.entries()) {
            const item = items[index] ?? "";
            const value = values[step % values.length];

            counts[index] = (counts[index] ?? 0) + 1;

            yield* contents.put(item, value?.text ?? "");

            expect(yield* versionRead(item), `put ${step} into ${item}`).toBe(String(counts[index]));
          }

          for (const [index, item] of items.entries()) {
            if ((counts[index] ?? 0) > 0) {
              expect(yield* versionRead(item), `${item}: the last put's version stays`).toBe(String(counts[index]));
            } else {
              expect(yield* versionRead(item), `${item}: never put`).toBe("absent");
            }
          }
        }).pipe(Effect.provide(MemoryStore.layer()));
      }),
    { arbitrary: { runs: 200, seed: SEED } },
  );

  // M6. Plant: ignore the seed; give a seeded item version 0; share the contents of two builds of one layer; leave a seeded empty text as a value.
  it.effect.prop(
    "M6 seed: a layer's seed is what a person had already put, as version 1, an empty text in it is nothing, and two builds of one layer share nothing",
    { texture: valueTexture },
    ({ texture }) =>
      Effect.gen(function* () {
        const values = findable(valueClasses(texture));
        const items = ["app-key", "turn-key", "client-7f3a"];

        const seed = Object.fromEntries([
          ...values.map((value, index) => [items[index] ?? "", value.text]),
          ["blank", ""],
        ]);

        const seeded = MemoryStore.layer({ values: seed });
        const store = holder(MemoryStore.store);

        const first = yield* Effect.gen(function* () {
          yield* MemoryStore.Contents.use((contents) => contents.put("later", "x"));

          return {
            seeded: yield* Effect.forEach(items, (item) => store.read(item), { concurrency: 1 }),
            blank: yield* store.read("blank"),
            put: yield* versionRead("later"),
          };
        }).pipe(Effect.provide(seeded));

        const second = yield* versionRead("later").pipe(Effect.provide(seeded));

        expect(
          first.seeded.map((held, index) => reading(held, values[index]?.text ?? "")),
          "each seeded value, from version 1",
        ).toEqual(values.map(() => ({ hidden: true, exact: true, version: "1" })));
        expect(outcome(first.blank), "a seeded empty text is nothing").toBe("missing absent");
        expect(first.put, "a put into a free item is its version 1").toBe("1");
        expect(second, "another build of the layer has nothing the first one was given").toBe("absent");
      }),
    { arbitrary: { runs: 100, seed: SEED } },
  );

  const facts = Arbitrary.all({ texture: nameTexture, count: between(0, 8) });

  // M7. Plant: keep only the last fact; put a new fact first; share the facts of two builds; drop a fact that was recorded twice.
  it.effect.prop(
    "M7 recorder: the memory recorder keeps every fact it is given, in the order given, starting with none, and two builds share nothing",
    { drawn: facts },
    ({ drawn }) =>
      Effect.gen(function* () {
        const names = acceptedNames(drawn.texture).map((each) => Schema.decodeUnknownSync(Name.SecretName)(each.text));
        const stores = acceptedStoreIds(drawn.texture).map((each) => Schema.decodeUnknownSync(Name.StoreId)(each));
        const versions = acceptedVersions(drawn.texture).map((each) => Schema.decodeUnknownSync(Name.Version)(each));

        const given = Array.from(
          { length: drawn.count },
          (_, index) =>
            new Recorder.Fetched({
              name: Arr.getUnsafe(names, index % names.length),
              store: Arr.getUnsafe(stores, index % stores.length),
              version: Arr.getUnsafe(versions, (index + 1) % versions.length),
            }),
        );

        const build = MemoryStore.recorder;

        const program = Effect.gen(function* () {
          const recorder = yield* Recorder.Recorder;
          const recorded = yield* MemoryStore.Recorded;

          const before = yield* recorded.facts;

          for (const fact of given) {
            yield* recorder.record(fact);
          }

          // The same fact twice is two facts: a ledger does not take one for the other.
          if (given[0] !== undefined) {
            yield* recorder.record(given[0]);
          }

          return { before, after: yield* recorded.facts };
        });

        const first = yield* program.pipe(Effect.provide(build));
        const second = yield* MemoryStore.Recorded.use((recorded) => recorded.facts).pipe(Effect.provide(build));

        expect(first.before, "none at first").toEqual([]);
        expect(first.after, "every fact, in order, the first one twice").toEqual([...given, ...given.slice(0, 1)]);
        expect(second, "another build has none").toEqual([]);
      }),
    { arbitrary: { runs: 200, seed: SEED } },
  );
});
