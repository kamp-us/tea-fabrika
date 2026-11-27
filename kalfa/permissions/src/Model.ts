/**
 * A model: the one declared set of types, their relations, and the permissions built from them.
 *
 * **Details**
 *
 * A model is plain data and its types. Each `.type` makes a new model and leaves the one it was called on as it was. The types refuse every
 * mistake a written declaration can hold. A value that got past them with a cast throws where it is declared, with a message that names the
 * model and the place.
 */
import { type Declared, declareType, type Rule, type Rules as RuleHelper } from "./internal/declare.ts";
import type { Holds, Relation } from "./Relation.ts";

/**
 * What a rule's body is handed to build its rule from: `union`, which takes one name or more of the type's own relations and permissions.
 *
 * @category models
 */
export type Rules<Names extends string> = RuleHelper<Names>;

/**
 * What a model has declared so far: each type's relations, by name, and the names of its permissions.
 *
 * @category models
 */
export type Types = {
  readonly [type: string]: { readonly relations: object; readonly permissions: string };
};

/** A model with nothing declared, and a type with no relations. */
type Nothing = Record<never, never>;

type IsUnion<U, Each = U> = [U] extends [never]
  ? false
  : U extends unknown
    ? [Each] extends [U]
      ? false
      : true
    : never;

/** A name written in code: one literal word, not a plain text, not a text pattern such as `x${string}` and not a union of words. */
type Literal<N extends string> = Nothing extends Record<N, 1> ? never : IsUnion<N> extends true ? never : N;

/** A type, relation or permission name: a literal that is not empty and holds no `#`, `:` or space. */
type Name<N extends string> = [Literal<N>] extends [never]
  ? never
  : N extends "" | `${string}${"#" | ":" | " "}${string}`
    ? never
    : N;

/**
 * A model with the types declared so far.
 *
 * @category models
 */
export interface Model<T extends Types> {
  readonly name: string;
  /**
   * Declares one type, with its relations and the permissions built from them, and gives the model with it added. A relation's subjects are
   * types declared before it or this one, its `change` is a permission of this type, and a permission's union names relations and
   * permissions of this type.
   */
  readonly type: <
    const N extends string,
    const R extends { readonly [relation: string]: Relation<(keyof T & string) | N, Holds, P> } = Nothing,
    const P extends string = never,
  >(
    name: [N] extends [keyof T] ? never : [Extract<P, keyof R>] extends [never] ? Name<N> : never,
    shape: {
      readonly relations?: R;
      readonly permissions?: { readonly [K in P]: (r: Rules<(keyof R & string) | P>) => Rule };
    },
  ) => Model<T & { readonly [K in N]: { readonly relations: R; readonly permissions: P } }>;
}

const from = <T extends Types>(name: string, declared: Declared): Model<T> => ({
  name,
  type: (type, shape) => from(name, declareType(name, declared, type, shape.relations ?? {}, shape.permissions ?? {})),
});

/**
 * Starts a model with the given name and nothing declared.
 *
 * @category constructors
 */
export const make = (name: string): Model<Nothing> => from(name, new Map());
