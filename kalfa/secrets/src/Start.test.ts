// The start check of `Secrets.layer` (R1 to R3): what an app lists, what its routes say and what its stores can do are compared before the first use, so
// a wrong route stops the start with the name, the store and the reason, and never reaches a store. Everything runs in memory, on stores that
// write down what they are asked, so it runs on every pull request.
import { expect, it } from "@effect/vitest";
import { Cause, Effect, Exit, Layer, Option, Redacted } from "effect";
import {
  declare,
  environment,
  fetchAs,
  memoryDeps,
  nameAt,
  proofFor,
  routing,
  routingDrawn,
  spyStore,
  startDrawn,
  starts,
  summary,
} from "./Fetch.test-support.ts";
import { nameTexture, SEED, watched } from "./Secrets.test-support.ts";

/** The first typed failure of an exit, or nothing. */
const firstFailure = <A, E>(exit: Exit.Exit<A, E>): Option.Option<E> =>
  Exit.isFailure(exit) ? Cause.findErrorOption(exit.cause) : Option.none();

/** Whether an exit is a defect and no failure, and the text it shows. */
const defect = <A, E>(exit: Exit.Exit<A, E>): { readonly died: boolean; readonly text: string } =>
  Exit.isFailure(exit)
    ? { died: Cause.hasDies(exit.cause) && !Cause.hasFails(exit.cause), text: Cause.pretty(exit.cause) }
    : { died: false, text: "" };

// R1. Plant: look a route up by a prefix of the name (g builds); skip the store check, so the first store answers (h builds); skip the item decode (i
// builds); skip the port check (j builds); check `declared` from the end (the first-problem start gives the last); answer with the last problem in
// the list; leave out the span `secrets.layer`; fail with the right tag and the wrong name.
it.effect.prop(
  "R1 start check: Secrets.layer fails RouteMissing for a declared name with no route, and RouteRefused for a route to a store that is not listed, for an item the store refuses and for a store with no holds port, always the first problem in declared order, and builds in a span secrets.layer when every route is right",
  { drawn: startDrawn },
  ({ drawn }) =>
    Effect.gen(function* () {
      const all = starts(drawn);

      expect(
        all.map((each) => each.id),
        "the generator reaches every class, the right start and the mixed one",
      ).toEqual(["g", "h", "i", "j", "right", "first"]);

      for (const start of all) {
        const { exit, spans } = yield* watched(
          Effect.scoped(Layer.build(environment(start.stores, start.declared, start.routes, memoryDeps()))),
        );

        if (start.expected === undefined) {
          expect(Exit.isSuccess(exit), `${start.id}: every route is right, so the layer builds`).toBe(true);
          expect(
            spans.map((span) => span.name),
            `${start.id}: the start is in a span`,
          ).toContain("secrets.layer");
        } else {
          const failure = firstFailure(exit);

          expect(Option.isSome(failure), `${start.id}: the start fails with an error`).toBe(true);
          expect(Option.map(failure, summary), `${start.id}: the first problem`).toEqual(Option.some(start.expected));
        }
      }

      const mixed = all.find((each) => each.id === "first");

      expect(mixed?.declared.length, "the mixed start lists the four bad classes and a good one on each side").toBe(6);
    }),
  { arbitrary: { runs: 200, seed: SEED } },
);

// R2. Plant: pass the name in place of the item; ask every store until one answers; ask the first store whatever the route says; read the item as
// text for a store whose items are numbers; read the item of the declaration before it.
it.effect.prop(
  "R2 routed item: after a start that passed, a fetch of each declared name asks its routed store's read with exactly its routed item, decoded as that store reads it, and asks no other store",
  { drawn: routingDrawn },
  ({ drawn }) =>
    Effect.gen(function* () {
      const { strings, numbers, routed, routes } = routing(drawn);

      expect([...new Set(routed.map((each) => each.store))].sort(), "the generator routes to both stores").toEqual([
        "numbers",
        "strings",
      ]);

      yield* Effect.gen(function* () {
        for (const each of routed) {
          const before = { strings: strings.asked.length, numbers: numbers.asked.length };

          const value = yield* fetchAs(each.secret, proofFor(each.secret.name));

          expect(
            { strings: strings.asked.slice(before.strings), numbers: numbers.asked.slice(before.numbers) },
            `${each.secret.name}: only the routed store is asked, for the routed item`,
          ).toEqual(
            each.store === "strings" ? { strings: [each.item], numbers: [] } : { strings: [], numbers: [each.item] },
          );
          expect(Redacted.value(value), `${each.secret.name}: the answer of the routed item`).toBe(
            `value-of-${each.item}`,
          );
        }
      }).pipe(
        Effect.provide(
          environment(
            [strings.store, numbers.store],
            routed.map((each) => each.secret),
            routes,
            memoryDeps(),
          ),
        ),
      );
    }),
  { arbitrary: { runs: 200, seed: SEED } },
);

// R3. Plant: keep the last of two declarations with one name; keep the first; dedupe stores by id; refuse a declaration listed twice; check the faults
// only for the first declaration; fail with a typed error where the fault is a defect.
it.effect.prop(
  "R3 faults in code: two declarations with one name, or two stores with one id, make the layer die with a defect naming them, and one declaration listed twice builds",
  { texture: nameTexture },
  ({ texture }) =>
    Effect.gen(function* () {
      const store = spyStore(`${texture.word}-s`);
      const name = nameAt(texture, 0);
      const other = nameAt(texture, 1);
      const route = (each: string) => ({ name: each, store: store.store.id, item: `${texture.word}-${each.length}` });

      const build = (...args: Parameters<typeof environment>) =>
        watched(Effect.scoped(Layer.build(environment(...args))));

      const once = declare(name);
      const aside = declare(other);

      const twoNames = yield* build(
        [store.store],
        [once, aside, declare(name)],
        [route(name), route(other)],
        memoryDeps(),
      );

      const twoNamesApart = yield* build([store.store], [once, declare(name)], [route(name)], memoryDeps());

      const twoStores = yield* build(
        [store.store, spyStore(store.store.id).store],
        [once],
        [route(name)],
        memoryDeps(),
      );

      const twice = yield* build([store.store], [once, aside, once], [route(name), route(other)], memoryDeps());
      const sameStore = yield* build([store.store], [once], [route(name)], memoryDeps());

      expect(defect(twoNames.exit).died, "two declarations with one name, a third between").toBe(true);
      expect(defect(twoNames.exit).text, "the defect names the name").toContain(name);
      expect(defect(twoNamesApart.exit).died, "two declarations with one name, next to each other").toBe(true);
      expect(defect(twoStores.exit).died, "two stores with one id").toBe(true);
      expect(defect(twoStores.exit).text, "the defect names the id").toContain(store.store.id);
      expect(Exit.isSuccess(twice.exit), "one declaration listed twice is one").toBe(true);
      expect(Exit.isSuccess(sameStore.exit), "the same start with nothing doubled builds").toBe(true);

      // A fetch after a twice-listed declaration still goes to its one route.
      yield* Effect.gen(function* () {
        const value = yield* fetchAs(once, proofFor(name));

        expect(Redacted.value(value), "the twice-listed declaration fetches").toBe(
          `value-of-${texture.word}-${name.length}`,
        );
      }).pipe(
        Effect.provide(environment([store.store], [once, aside, once], [route(name), route(other)], memoryDeps())),
      );
    }),
  { arbitrary: { runs: 200, seed: SEED } },
);
