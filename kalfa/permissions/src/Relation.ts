/**
 * A relation: a named kind of link a model declares on a type, with the types of subject that may hold it, whether one subject or many
 * may hold it on one object, and the permission a change to it must pass.
 *
 * **Details**
 *
 * A relation is made on its own, before the type that takes it, and the type checks it when it takes it. A relation with no `change` is one
 * no write may touch: a fact another context owns, which the app passes with each check.
 */

/**
 * How many subjects may hold a relation on one object.
 *
 * @category models
 */
export type Holds = "one" | "many";

/**
 * A relation's subject types, how many may hold it, and the permission a change to it must pass.
 *
 * @category models
 */
export interface Relation<S extends string, H extends Holds, C extends string> {
  readonly holds: H;
  readonly subjects: ReadonlyArray<S>;
  readonly change: C | undefined;
}

/**
 * Makes a relation one subject holds on an object, such as the author of a book.
 *
 * @category constructors
 */
export const one = <const S extends string, const C extends string = never>(
  subjects: readonly [S, ...ReadonlyArray<S>],
  options?: { readonly change: C },
): Relation<S, "one", C> => ({ holds: "one", subjects: [...subjects], change: options?.change });

/**
 * Makes a relation many subjects hold on an object, such as the editors of a book.
 *
 * @category constructors
 */
export const many = <const S extends string, const C extends string = never>(
  subjects: readonly [S, ...ReadonlyArray<S>],
  options?: { readonly change: C },
): Relation<S, "many", C> => ({ holds: "many", subjects: [...subjects], change: options?.change });
