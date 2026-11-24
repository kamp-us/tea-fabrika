/**
 * The settings `@kalfa/secrets` reads: which store and item each secret name points to.
 *
 * **Details**
 *
 * An app joins `all` into its own group, which checks each value when the app starts, so a wrong route stops the start with its file
 * and line. `Secrets.layer` takes only the values that passed. A route holds only public text: a name, a store's id and the item in
 * that store.
 */
import { Setting, type SettingGroup } from "@kalfa/config";
import { Schema } from "effect";
import * as Name from "./Name.ts";

/**
 * Where one secret name points: a store, and the item that store holds it under.
 *
 * @category models
 */
export const Route = Schema.Struct({ name: Name.SecretName, store: Name.StoreId, item: Schema.NonEmptyString });

/**
 * The routes of an app: at most one for each name, since two would not say which store holds the secret.
 *
 * @category models
 */
export const Routes = Schema.Array(Route).check(
  Schema.makeFilter(
    (routes: ReadonlyArray<{ readonly name: string }>) =>
      new Set(routes.map((route) => route.name)).size === routes.length || "two routes for one name",
  ),
);

/**
 * Which secret store and item each secret name points to.
 *
 * @category settings
 */
export const routes = Setting.make("secrets.routes", Routes).pipe(
  Setting.withDefault([]),
  Setting.withDescription("Which secret store and item each secret name points to."),
);

/**
 * Every setting of the package, for an app to join into its own group.
 *
 * @category settings
 */
export const all = [routes] as const;

/**
 * The values an app's group gives for these settings, which `Secrets.layer` takes.
 *
 * @category models
 */
export type Values = Pick<SettingGroup.Values<typeof all>, "routes">;
