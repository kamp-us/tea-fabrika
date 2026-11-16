// The check's walk over the live tuples (0526): Zanzibar's `_this` and `computed_userset` with
// union. A permission holds when some relation its unions reach holds for the subject on the object.
// The visited set ends a loop of permissions, so no depth needs a number, and a loop alone holds
// nothing.
import { Function } from "effect";
import type { Tuples } from "../Relation.ts";
import { holds, tupleKey } from "./relationsTable.ts";

/**
 * One object type as declared: its relations, and each permission's union of names.
 *
 * @internal
 */
export interface Declared {
  readonly relations: ReadonlySet<string>;
  readonly permissions: ReadonlyMap<string, ReadonlyArray<string>>;
}

/**
 * The object type a ref names: the text before its first `:`.
 *
 * @internal
 */
export const objectType = (ref: string): string => ref.slice(0, Math.max(0, ref.indexOf(":")));

/**
 * Whether `subject` holds `permission` on `object` in these tuples, by the declared types.
 *
 * @internal
 */
export const evaluate: {
  (
    tuples: Tuples,
    subject: string,
    permission: string,
    object: string,
  ): (types: ReadonlyMap<string, Declared>) => boolean;
  (types: ReadonlyMap<string, Declared>, tuples: Tuples, subject: string, permission: string, object: string): boolean;
} = Function.dual(
  5,
  (
    types: ReadonlyMap<string, Declared>,
    tuples: Tuples,
    subject: string,
    permission: string,
    object: string,
  ): boolean => {
    const declared = types.get(objectType(object));

    if (declared === undefined) {
      return false;
    }

    const visited = new Set<string>();
    const reaches = (name: string): boolean => {
      if (declared.relations.has(name)) {
        return holds(tuples, tupleKey(subject, name, object));
      }

      if (visited.has(name)) {
        return false;
      }

      visited.add(name);
      return (declared.permissions.get(name) ?? []).some(reaches);
    };
    return reaches(permission);
  },
);
