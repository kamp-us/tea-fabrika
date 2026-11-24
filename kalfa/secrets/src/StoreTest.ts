// The laws every secret store passes (M1a to M1h), exported as `/test`. A runner gives a `Subject`: how to make an empty store of its own kind
// and how a person puts a value into it or takes one out. The suite draws a texture, makes one value for every class the plan names, puts
// each into the store and asks the store's `holds` port. A store that passes these answers as every other one does. Later parts of the
// suite check a store's other ports, which a store that has them passes too.
import { describe, expect, it } from "@effect/vitest";
import { Arbitrary, Array as Arr, Effect, type Layer, Option, Schema } from "effect";
import * as Name from "./Name.ts";
import {
  acceptedNames,
  between,
  nameTexture,
  findable,
  found,
  holder,
  needles,
  outcome,
  pick,
  reachable,
  reading,
  SEED,
  showsAny,
  valueClasses,
  valueTexture,
  type Value,
} from "./Secrets.test-support.ts";
import type * as Store from "./Store.ts";

/** The name the laws that are not about a label ask for. */
const NAME = Schema.decodeUnknownSync(Name.SecretName)("transport/turn-key");

/** A kind of secret store, as the laws reach it: how to make an empty one and how a person fills it. */
export interface Subject<Item, R> {
  /** The store under test. It holds values. */
  readonly store: Store.Store<string, Item, R>;
  /** A new, empty store: one for each run of each law. */
  readonly empty: Layer.Layer<R>;
  /** A person puts a value into an item, which replaces what it held. */
  readonly put: (item: Item, value: string) => Effect.Effect<void, never, R>;
  /** A person takes an item's value out. */
  readonly remove: (item: Item) => Effect.Effect<void, never, R>;
  /** Items the store takes, written as a route writes them: at least three, each different. */
  readonly items: ReadonlyArray<string>;
}

export interface SuiteOptions {
  /** How many drawn textures each law checks. */
  readonly runs: number;
  /** The most one law may take, in milliseconds. */
  readonly timeout: number;
}

/** The item at `index`, decoded with the store's own `item` Schema. */
const itemAt = <Item, R>(subject: Subject<Item, R>, index: number): Item => {
  const text = subject.items[index];

  if (text === undefined) {
    throw new Error(`the subject lists no item ${index}`);
  }

  return Schema.decodeUnknownSync(subject.store.item)(text);
};

const classIds = (values: ReadonlyArray<Value>): string => values.map((value) => value.id).join("");

/** What a read of a put value must show: found, hidden, exactly the text, with a version that is a Version. */
const fine = (held: Store.Held, text: string) => {
  const each = reading(held, text);

  return each === undefined ? undefined : { ...each, isVersion: Schema.is(Name.Version)(each.version) };
};

const FOUND = { hidden: true, exact: true, isVersion: true, version: expect.any(String) };

/** One step of a person at a store: put a value of a class (or the empty text) into one of two items, or take the item's value out. */
const steps = Arbitrary.all({ move: pick(["c", "d", "e", "empty", "remove"] as const), item: between(0, 1) });

type Step = typeof steps extends Arbitrary.Arbitrary<infer A> ? A : never;

/** Every drawn run starts with a take-out followed by a put, on each item, more than once, so no run passes without reaching them. */
const OPENING: ReadonlyArray<Step> = [
  { move: "c", item: 0 },
  { move: "remove", item: 0 },
  { move: "c", item: 0 },
  { move: "remove", item: 0 },
  { move: "d", item: 0 },
  { move: "e", item: 1 },
  { move: "remove", item: 1 },
  { move: "e", item: 1 },
];

export const suite = <Item, R>(name: string, subject: Subject<Item, R>, options: SuiteOptions): void => {
  const run = { arbitrary: { runs: options.runs, seed: SEED }, timeout: options.timeout };
  const readNamed = holder(subject.store).read;
  // The laws that are not about the label ask for one fixed name.
  const read = (item: Item) => readNamed(item, NAME);

  describe(`${name}: the shared laws of a secret store`, () => {
    // Plant: answer `Found` with the value cut at 4 KB, or trimmed (c, d, e); decode base64 inside a PEM armor (e); answer a plain text in place of
    // a `Redacted`; answer a version that is no Version; give a second read another version.
    it.effect.prop(
      "M1a read: a value put in an item is read back byte for byte, hidden, with a version, and a second read gives the same",
      { texture: valueTexture },
      ({ texture }) =>
        Effect.gen(function* () {
          const values = findable(valueClasses(texture));
          expect(classIds(values), "the generator reaches every value class").toBe("cde");

          for (const value of values) {
            const [first, second] = yield* Effect.gen(function* () {
              yield* subject.put(itemAt(subject, 0), value.text);

              return [yield* read(itemAt(subject, 0)), yield* read(itemAt(subject, 0))] as const;
            }).pipe(Effect.provide(subject.empty));

            expect(outcome(first), `${value.id}: a put value is found`).toBe("found");
            expect(fine(first, value.text), `${value.id}: hidden, byte for byte, with a version`).toEqual(FOUND);
            expect(fine(second, value.text), `${value.id}: a second read gives the same`).toEqual(
              fine(first, value.text),
            );
          }
        }),
      run,
    );

    // Plant: give the same version after a second put; give the same version to the same text.
    it.effect.prop(
      "M1b versions: every put makes a new version, and a read after a put gives the value and the version of that put",
      { texture: valueTexture },
      ({ texture }) =>
        Effect.gen(function* () {
          const values = findable(valueClasses(texture));
          expect(classIds(values), "the generator reaches every value class").toBe("cde");

          const reads = yield* Effect.gen(function* () {
            const answers: Array<ReturnType<typeof fine>> = [];

            for (const value of [...values, ...values]) {
              yield* subject.put(itemAt(subject, 0), value.text);

              answers.push(fine(yield* read(itemAt(subject, 0)), value.text));
            }

            return answers;
          }).pipe(Effect.provide(subject.empty));

          expect(reads, "each put is read back as it was put").toEqual(reads.map(() => FOUND));

          const versions = reads.map((each) => each?.version ?? "");

          expect(new Set(versions).size, "six puts, six different versions").toBe(reads.length);
        }),
      run,
    );

    // Plant: answer `Found` with the empty text for a removed item; answer `Missing` with another reason; answer `Found` for an item never put; put a
    // value in a Missing.
    it.effect.prop(
      "M1c absent: an item never put, or put and taken out, is Missing absent, and a Missing holds no value the store holds",
      { texture: valueTexture },
      ({ texture }) =>
        Effect.gen(function* () {
          const values = findable(valueClasses(texture));
          expect(classIds(values), "the generator reaches every value class").toBe("cde");

          for (const value of values) {
            const answers = yield* Effect.gen(function* () {
              const never = yield* read(itemAt(subject, 0));

              yield* subject.put(itemAt(subject, 1), value.text);

              const beside = yield* read(itemAt(subject, 0));

              yield* subject.put(itemAt(subject, 0), value.text);
              yield* subject.remove(itemAt(subject, 0));

              const removed = yield* read(itemAt(subject, 0));

              // A take-out of an item that is not there changes nothing.
              yield* subject.remove(itemAt(subject, 2));

              const taken = yield* read(itemAt(subject, 2));

              return { never, beside, removed, taken };
            }).pipe(Effect.provide(subject.empty));

            expect(outcome(answers.never), `${value.id}: never put`).toBe("missing absent");
            expect(outcome(answers.beside), `${value.id}: another item holds a value, this one nothing`).toBe(
              "missing absent",
            );
            expect(outcome(answers.removed), `${value.id}: put and taken out`).toBe("missing absent");
            expect(outcome(answers.taken), `${value.id}: taken out without a put`).toBe("missing absent");

            for (const answer of Object.values(answers)) {
              expect(Object.keys(answer).toSorted(), `${value.id}: a Missing is its tag and its reason`).toEqual([
                "_tag",
                "reason",
              ]);
              expect(
                showsAny([JSON.stringify(answer), ...reachable(answer)], needles(value)),
                `${value.id}: no value in a Missing`,
              ).toEqual([]);
            }
          }
        }),
      run,
    );

    // Plant: answer `Found` with the empty text; answer `Missing` with the reason `kind` for it; ignore a put of the empty text, so the old value stays.
    it.effect.prop(
      "M1d empty: the empty text is no value, so an item put with it is Missing absent, and a value put after it is found",
      { texture: valueTexture },
      ({ texture }) =>
        Effect.gen(function* () {
          const values = valueClasses(texture);
          expect(classIds(values), "the generator reaches every value class").toBe("cdef");
          expect(
            values.map((value) => value.text === ""),
            "and only the class f is the empty text",
          ).toEqual([false, false, false, true]);

          const nothing = Arr.getUnsafe(values, 3).text;

          for (const value of findable(values)) {
            const answers = yield* Effect.gen(function* () {
              yield* subject.put(itemAt(subject, 0), nothing);

              const first = yield* read(itemAt(subject, 0));

              yield* subject.put(itemAt(subject, 0), value.text);

              const second = yield* read(itemAt(subject, 0));

              yield* subject.put(itemAt(subject, 0), nothing);

              const third = yield* read(itemAt(subject, 0));

              return { first, second, third };
            }).pipe(Effect.provide(subject.empty));

            expect(outcome(answers.first), `${value.id}: the empty text first`).toBe("missing absent");
            expect(fine(answers.second, value.text), `${value.id}: a value after it`).toEqual(FOUND);
            expect(outcome(answers.third), `${value.id}: the empty text over a value`).toBe("missing absent");
          }
        }),
      run,
    );

    // Plant: read every item from the first one's place; keep one value for the whole store; take every item's value out with one's.
    it.effect.prop(
      "M1e items: an item reads what was put in it and nothing of another item, and taking one out leaves the others",
      { texture: valueTexture },
      ({ texture }) =>
        Effect.gen(function* () {
          const values = findable(valueClasses(texture));
          expect(classIds(values), "the generator reaches every value class").toBe("cde");

          const readAll = Effect.forEach(
            values,
            (value, index) => Effect.map(read(itemAt(subject, index)), (held) => ({ value, held })),
            { concurrency: 1 },
          );

          const answers = yield* Effect.gen(function* () {
            for (const [index, value] of values.entries()) {
              yield* subject.put(itemAt(subject, index), value.text);
            }

            const all = yield* readAll;

            yield* subject.remove(itemAt(subject, 0));

            return { all, rest: yield* readAll };
          }).pipe(Effect.provide(subject.empty));

          const reads = (each: typeof answers.all) => each.map(({ value, held }) => fine(held, value.text));

          expect(reads(answers.all), "each item reads its own value").toEqual(answers.all.map(() => FOUND));
          expect(
            answers.rest.map(({ held }) => outcome(held)),
            "taking the first out leaves only it gone",
          ).toEqual(["missing absent", "found", "found"]);
          expect(reads(answers.rest.slice(1)), "and the others read what they did").toEqual(
            reads(answers.all.slice(1)),
          );
        }),
      run,
    );

    // Plant: list the value in a Found's own property; hold the value's base64 in the version.
    it.effect.prop(
      "M1f hidden: no answer of the store shows a value it holds, written any way, through its text, its JSON or its own properties",
      { texture: valueTexture },
      ({ texture }) =>
        Effect.gen(function* () {
          const values = findable(valueClasses(texture));
          expect(classIds(values), "the generator reaches every value class").toBe("cde");

          for (const value of values) {
            const held = yield* Effect.gen(function* () {
              yield* subject.put(itemAt(subject, 0), value.text);

              return yield* read(itemAt(subject, 0));
            }).pipe(Effect.provide(subject.empty));

            expect(
              showsAny([String(held), JSON.stringify(held), ...reachable(held)], needles(value)),
              `${value.id}: no value in a Found but the one Redacted`,
            ).toEqual([]);
          }
        }),
      run,
    );

    // Plant: a take-out forgets the item's earlier versions, so the next put starts again (the memory store deletes the shelf in `remove`).
    it.effect.prop(
      "M1g reuse: puts and take-outs in any order on the same name never give a version twice, and a take-out leaves the name Missing absent",
      { texture: valueTexture, tail: Arbitrary.array(steps, { minLength: 2, maxLength: 16 }) },
      ({ texture, tail }) =>
        Effect.gen(function* () {
          const classes = valueClasses(texture);
          expect(classIds(classes), "the generator reaches every value class").toBe("cdef");

          const texts = { c: "", d: "", e: "", empty: "" };

          for (const value of classes) {
            texts[value.id === "f" ? "empty" : value.id] = value.text;
          }

          const sequence = [...OPENING, ...tail];
          const seen: Array<Array<string>> = [[], []];

          yield* Effect.gen(function* () {
            for (const [index, step] of sequence.entries()) {
              const at = itemAt(subject, step.item);

              if (step.move === "remove") {
                yield* subject.remove(at);
                expect(outcome(yield* read(at)), `step ${index}: taken out`).toBe("missing absent");
              } else if (step.move === "empty") {
                yield* subject.put(at, texts.empty);
                expect(outcome(yield* read(at)), `step ${index}: the empty text`).toBe("missing absent");
              } else {
                yield* subject.put(at, texts[step.move]);

                const version = Option.getOrElse(
                  Option.map(found(yield* read(at)), (each) => each.version),
                  () => "",
                );

                expect(version, `step ${index}: a put value has a version`).not.toBe("");
                expect(seen[step.item], `step ${index}: a version new for this name`).not.toContain(version);
                seen[step.item]?.push(version);
              }
            }
          }).pipe(Effect.provide(subject.empty));
        }),
      run,
    );

    // Plant: answer a value with no label; label it with the item's text; label it with the first name asked for, on every later read; give a
    // value the label of the store's id.
    it.effect.prop(
      "M1h label: the value a read gives for a name carries that name as its label and shows only its label, for every name and every value, and a read for another name gives that name",
      { texture: valueTexture, names: nameTexture },
      ({ texture, names }) =>
        Effect.gen(function* () {
          const values = findable(valueClasses(texture));
          expect(classIds(values), "the generator reaches every value class").toBe("cde");

          const asked = [...new Set(acceptedNames(names).map((each) => each.text))].map((text) =>
            Schema.decodeUnknownSync(Name.SecretName)(text),
          );

          expect(asked.length, "the generator reaches several names").toBeGreaterThanOrEqual(2);

          for (const value of values) {
            const labels = yield* Effect.gen(function* () {
              yield* subject.put(itemAt(subject, 0), value.text);

              return yield* Effect.forEach(
                asked,
                (name) => Effect.map(readNamed(itemAt(subject, 0), name), (held) => ({ name, held })),
                { concurrency: 1 },
              );
            }).pipe(Effect.provide(subject.empty));

            for (const { name, held } of labels) {
              const hidden = Option.getOrUndefined(Option.map(found(held), (each) => each.value));

              expect(hidden?.label, `${value.id}: labeled with the name asked for`).toBe(name);
              expect(String(hidden), `${value.id}: shows only the label`).toBe(`<redacted:${name}>`);
              expect(reading(held, value.text)?.exact, `${value.id}: and still the value, byte for byte`).toBe(true);
            }
          }
        }),
      run,
    );
  });
};
