/**
 * The start check of `Secrets.layer`: each declared secret meets its route, its store and its store's port before the first use, so a
 * wrong route stops the start and never reaches a store.
 */
import { Effect, Schema } from "effect";
import * as Errors from "../Errors.ts";
import * as Name from "../Name.ts";
import type * as Secret from "../Secret.ts";
import type * as SecretsSettings from "../Settings.ts";
import type * as Store from "../Store.ts";

/** Where one declared secret is held: its store's id and `holds` port, the item as that store reads it, and the item as the route wrote it. */
export interface Routed {
  readonly store: typeof Name.StoreId.Type;
  readonly holds: Store.Holds<any, any>;
  readonly item: unknown;
  readonly text: string;
}

/**
 * Finds the route of each declared secret, in the order they are declared, and fails on the first problem. Two stores with one id, or
 * two declarations of one name, are faults in the code that lists them, so they die. A declaration listed twice is one.
 */
export const start = Effect.fnUntraced(function* (options: {
  readonly stores: ReadonlyArray<Store.Any>;
  readonly declared: ReadonlyArray<Secret.Any>;
  readonly routes: SecretsSettings.Values["routes"];
}) {
  const stores = new Map<string, Store.Any>();

  for (const store of options.stores) {
    if (stores.has(store.id)) {
      return yield* Effect.die(`two stores with one id: ${store.id}`);
    }

    stores.set(store.id, store);
  }

  const secrets = new Map<string, Secret.Any>();

  for (const secret of options.declared) {
    const seen = secrets.get(secret.name);

    if (seen !== undefined && seen !== secret) {
      return yield* Effect.die(`two declarations with one name: ${secret.name}`);
    }

    secrets.set(secret.name, secret);
  }

  const routed = new Map<Secret.Any, Routed>();

  for (const secret of secrets.values()) {
    const name = Name.SecretName.make(secret.name);
    const route = options.routes.find((each) => each.name === name);

    if (route === undefined) {
      return yield* new Errors.RouteMissing({ secret: name });
    }

    const store = stores.get(route.store);

    if (store === undefined) {
      return yield* new Errors.RouteRefused({ secret: name, store: route.store, reason: "store" });
    }

    const item = yield* Schema.decodeUnknownEffect(store.item)(route.item).pipe(
      Effect.mapError(() => new Errors.RouteRefused({ secret: name, store: route.store, reason: "item" })),
    );

    const { holds } = store;

    if (holds === undefined) {
      return yield* new Errors.RouteRefused({ secret: name, store: route.store, reason: "port", port: "holds" });
    }

    routed.set(secret, { store: route.store, holds, item, text: route.item });
  }

  return routed;
});
