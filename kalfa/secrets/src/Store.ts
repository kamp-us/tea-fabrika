/**
 * The ports of a secret store, and what a store answers.
 *
 * **Details**
 *
 * A store holds values behind its own items. It answers a read with `Found`, whose value is hidden, or with `Missing`, which says
 * why: nothing is there, the other kind is, or another algorithm. `Store.make` gives a store its types from what it is given, so a
 * store's needs are the needs of its ports.
 */
import { Data, type Effect, type Redacted, type Schema } from "effect";
import type * as Errors from "./Errors.ts";
import type * as Name from "./Name.ts";

/**
 * Where a signing key's private key sits while it signs, from the tightest to the loosest: in the store, in the runtime, or in
 * memory.
 *
 * @category models
 */
export type Place = "store" | "runtime" | "memory";

/**
 * What a store found: a value of the store's own kind.
 *
 * @category models
 */
export class Found<A> extends Data.TaggedClass("Found")<{ readonly value: A }> {}

/**
 * What a store did not find, and why: `absent` for nothing there (an empty text is nothing), `kind` for the other kind of secret, and
 * `algorithm` for a key of another algorithm.
 *
 * @category models
 */
export class Missing extends Data.TaggedClass("Missing")<{ readonly reason: "absent" | "kind" | "algorithm" }> {}

/**
 * A store's answer to a read: the hidden value with its version, or why there is none.
 *
 * @category models
 */
export type Held =
  | Found<{ readonly value: Redacted.Redacted<string>; readonly version: typeof Name.Version.Type }>
  | Missing;

/**
 * The port of a store that holds values: it reads an item.
 *
 * @category models
 */
export interface Holds<Item, R> {
  readonly read: (item: Item) => Effect.Effect<Held, Errors.StoreFailed, R>;
}

/**
 * A secret store: its id, how its items are written in a route, the place its keys sit, and the ports it has.
 *
 * @category models
 */
export interface Store<Id extends string, Item, R> {
  readonly id: Id;
  readonly item: Schema.Codec<Item, string>;
  readonly place: Place;
  readonly holds?: Holds<Item, R>;
}

/**
 * Any store, whatever its id, items and needs.
 *
 * @category models
 */
export type Any = Store<string, any, any>;

/**
 * What a store or a list of stores needs: the union of what each one's ports need.
 *
 * @category models
 */
export type Needs<S extends Any> = S extends Store<string, any, infer R> ? R : never;

/**
 * Makes a store. It gives the store its types from what it is given, so nothing is written twice.
 *
 * @category constructors
 */
export const make = <const Id extends string, Item, R>(store: Store<Id, Item, R>): Store<Id, Item, R> => store;
