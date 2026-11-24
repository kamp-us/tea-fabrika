// V1, the settings of `@kalfa/secrets`: `secrets.routes` says which store and item each secret name points to. A route is plain data, and the
// setting refuses what could not be a route before any store is asked. They run in memory on every pull request.
import { expect, it } from "@effect/vitest";
import { Arbitrary, Effect, Exit, Option, Schema } from "effect";
import {
  acceptedNames,
  acceptedStoreIds,
  nameTexture,
  refusedNames,
  refusedStoreIds,
  SEED,
} from "./Secrets.test-support.ts";
import * as SecretsSettings from "./Settings.ts";

const decoding = Schema.decodeUnknownEffect(SecretsSettings.routes.schema);

const decode = Effect.fn("decode")(function* (...input: Parameters<typeof decoding>) {
  return yield* Effect.exit(decoding(...input));
});

/** Routes for distinct names: the accepted name classes of a texture, each to a store id and an item. */
const routesFor = (drawn: { readonly texture: Parameters<typeof acceptedNames>[0] }) => {
  const names = [...new Set(acceptedNames(drawn.texture).map((each) => each.text))];
  const stores = acceptedStoreIds(drawn.texture);

  return names.map((name, index) => ({
    name,
    store: stores[index % stores.length] ?? "memory",
    item: `${drawn.texture.word}-${index}`,
  }));
};

const drawnRoutes = Arbitrary.all({ texture: nameTexture });

// V1. Plant: drop the check for two routes with one name (the duplicate lists are taken); take the route's name as plain text (a refused name is
// taken); take an empty item; take a store id as plain text; give the setting a default other than the empty list; leave its description out;
// leave `routes` out of `all`; name the setting `secrets.route`.
it.effect.prop(
  "V1 routes: secrets.routes is named so, defaults to no routes, has a description, takes routes of distinct names, and refuses two routes for one name, a name SecretName refuses, a store id that is no id and an empty item",
  { drawn: drawnRoutes },
  ({ drawn }) =>
    Effect.gen(function* () {
      const { routes } = SecretsSettings;

      expect(routes.name).toBe("secrets.routes");
      expect(Option.getOrUndefined(routes.default), "no routes at first").toEqual([]);
      expect(routes.description?.length ?? 0, "a description").toBeGreaterThan(0);
      expect(SecretsSettings.all, "the package's settings hold it").toContain(routes);

      const good = routesFor(drawn);
      const [one] = good;

      expect(good.length, "the generator reaches several routes").toBeGreaterThanOrEqual(2);
      expect(one, "and a first one").toBeDefined();

      for (const taken of [[], good, good.slice(0, 1)]) {
        expect(Exit.isSuccess(yield* decode(taken)), `${taken.length} routes of distinct names are taken`).toBe(true);
      }

      const decoded = yield* Schema.decodeUnknownEffect(SecretsSettings.routes.schema)(good);

      expect(
        decoded.map((each) => ({ name: each.name, store: each.store, item: each.item })),
        "a route keeps its name, its store and its item, in order",
      ).toEqual(good);

      if (one === undefined) {
        return;
      }

      const elsewhere = { ...one, store: "elsewhere", item: "other" };

      const duplicates = [
        { id: "the same route twice", routes: [one, one] },
        { id: "two routes for a name", routes: [one, elsewhere] },
        { id: "a duplicate that is not next to its twin", routes: [one, ...good.slice(1), elsewhere] },
      ];

      for (const each of duplicates) {
        expect(Exit.isFailure(yield* decode(each.routes)), `${each.id} is refused`).toBe(true);
      }

      for (const each of refusedNames(drawn.texture)) {
        expect(Exit.isFailure(yield* decode([{ ...one, name: each.text }])), `${each.id}: no route name`).toBe(true);
      }

      for (const each of refusedStoreIds(drawn.texture)) {
        expect(Exit.isFailure(yield* decode([{ ...one, store: each.text }])), `${each.id}: no store id`).toBe(true);
      }

      expect(Exit.isFailure(yield* decode([{ ...one, item: "" }])), "an empty item is refused").toBe(true);
      expect(
        Exit.isFailure(yield* decode([{ name: one.name, store: one.store }])),
        "a route with no item is refused",
      ).toBe(true);
      expect(Exit.isFailure(yield* decode("memory")), "a text is no list of routes").toBe(true);
    }),
  { arbitrary: { runs: 200, seed: SEED } },
);
