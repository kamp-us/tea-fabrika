/**
 * The permission core (0526): one model declared once, a right as a typed class, and a check that
 * gives a sealed proof tied to the one object it checked, on Zanzibar's model.
 *
 * **Details**
 *
 * `make(name).type(name, { relations, permissions })` declares the model as one value, after
 * SpiceDB's schema: a relation names the object types that may hold it, and a permission is a union
 * of the same type's relations and permissions. Its types carry every name, so a type, relation or
 * permission it does not declare does not compile. `Permission<Self>()(id, { model, on, permission
 * })` is a right: its class is the context key of its proof, and `within` is its check.
 * `provide(proof)` puts a proof into an Effect's context, and `recheck` checks it again on newer
 * rows. After phoenix's capabilities (0107), with five changes: names come from the model, rewrites
 * are per permission, the store fails typed, `Denied` carries who, what and which object, and a
 * proof carries the object it checked.
 */
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as Result from "effect/Result";
import * as Schema from "effect/Schema";
import { type Declared, evaluate } from "./internal/evaluate.ts";
import { mint, type Proof, sealed } from "./internal/proof.ts";
import type { Tuples } from "./Relation.ts";
import type { Sender } from "./Senders.ts";

/**
 * A ref to one object of type `T`: `type:id`, such as `fabrika:demo`.
 *
 * @category models
 */
export type Ref<T extends string> = `${T}:${string}`;

const RewriteTypeId: unique symbol = Symbol.for("@kampus/libfabrika/permissions/Rewrite");

/**
 * How a permission is held: made only by `Rewrites`, so it names only declared names.
 *
 * @category models
 */
export interface Rewrite {
  readonly [RewriteTypeId]: ReadonlyArray<string>;
}

/**
 * The rewrites a permission is declared with, over the names of its own object type.
 *
 * @category models
 */
export interface Rewrites<Names extends string> {
  /** The subject holds any of these relations or permissions on the same object (Zanzibar's union). */
  readonly union: (...names: ReadonlyArray<Names>) => Rewrite;
}

/** The names one object type declares, as the model's types carry them. */
interface Names {
  readonly relations: string;
  readonly permissions: string;
}

/**
 * The declared object types of a model, each with its names.
 *
 * @category models
 */
export type Types = { readonly [type: string]: Names };

/**
 * One permission model, declared once: its object types, their relations and how permissions
 * combine them.
 *
 * @category models
 */
export interface Model<T extends Types> {
  readonly name: string;
  /** The declarations as data, for the check. */
  readonly declared: ReadonlyMap<string, Declared>;
  /** Declares one more object type: who may hold each relation, and each permission's rewrite. */
  readonly type: <
    const N extends string,
    const R extends { readonly [relation: string]: ReadonlyArray<(keyof T & string) | N> } = Record<never, never>,
    P extends string = never,
  >(
    name: N,
    shape: {
      readonly relations?: R;
      readonly permissions?: { readonly [K in P]: (p: Rewrites<(keyof R & string) | P>) => Rewrite };
    },
  ) => Model<T & { readonly [K in N]: { readonly relations: keyof R & string; readonly permissions: P } }>;
  /** A ref to one object of a declared type. */
  readonly ref: <N extends keyof T & string>(type: N, id: string) => Ref<N>;
}

const rewrites: Rewrites<string> = { union: (...names) => ({ [RewriteTypeId]: names }) };

const build = <T extends Types>(name: string, declared: ReadonlyMap<string, Declared>): Model<T> => ({
  name,
  declared,
  type: <
    const N extends string,
    const R extends { readonly [relation: string]: ReadonlyArray<(keyof T & string) | N> } = Record<never, never>,
    P extends string = never,
  >(
    type: N,
    shape: {
      readonly relations?: R;
      readonly permissions?: { readonly [K in P]: (p: Rewrites<(keyof R & string) | P>) => Rewrite };
    },
  ) =>
    build<T & { readonly [K in N]: { readonly relations: keyof R & string; readonly permissions: P } }>(
      name,
      new Map(declared).set(type, {
        relations: new Set(Object.keys(shape.relations ?? {})),
        permissions: new Map(
          Object.entries<(p: Rewrites<string>) => Rewrite>(shape.permissions ?? {}).map(([permission, rewrite]) => [
            permission,
            rewrite(rewrites)[RewriteTypeId],
          ]),
        ),
      }),
    ),
  ref: <N extends keyof T & string>(type: N, id: string): Ref<N> => `${type}:${id}`,
});

/**
 * Starts a model with no object types.
 *
 * @category constructors
 */
export const make = (name: string): Model<Record<never, never>> => build(name, new Map());

/**
 * Error for a check that did not pass: who was checked, for what permission, on which object.
 *
 * @category errors
 */
export class Denied extends Schema.TaggedError<Denied>()("Denied", {
  /** The subject checked, as a ref: `person:<person>`. */
  subject: Schema.String,
  permission: Schema.String,
  /** The object checked, as a ref. */
  object: Schema.String,
}) {}

/**
 * A right: the context key of its proof, and its check.
 *
 * @category models
 */
export type PermissionClass<Self, Id extends string, On extends string> = Context.ServiceClass<
  Self,
  Id,
  Proof<Self>
> & {
  /**
   * Checks the right for `sender` on `object` in these tuples. A person and an agent are both
   * checked as `person:<for>`: an agent is capped by its person (0526).
   */
  readonly within: (tuples: Tuples, sender: Sender, object: Ref<On>) => Result.Result<Proof<Self>, Denied>;
};

/**
 * Builds a right on one permission of one object type: `class X extends Permission<X>()(id, {
 * model, on, permission }) {}`. The id is the proof's context key, so two rights never share one.
 *
 * @category constructors
 */
export const Permission =
  <Self>() =>
  <const Id extends string, T extends Types, const On extends keyof T & string, const P extends T[On]["permissions"]>(
    id: Id,
    config: { readonly model: Model<T>; readonly on: On; readonly permission: P },
  ): PermissionClass<Self, Id, On> => {
    const { model, permission } = config;
    // oxlint-disable-next-line fabrika/service-id -- a right's id is its declarer's, as with Effect's own `Context.Service` caller; `Model.ts` names its rights by their path
    const key = Context.Service<Self, Proof<Self>>()(id);
    const within = (tuples: Tuples, sender: Sender, object: Ref<On>): Result.Result<Proof<Self>, Denied> => {
      const subject = `person:${sender.for}`;
      const holds = (rows: Tuples) => evaluate(model.declared, rows, subject, permission, object);
      return holds(tuples)
        ? Result.succeed(mint<Self>(sender, permission, object, key, holds))
        : Result.fail(Denied.make({ subject, permission, object }));
    };
    return Object.assign(key, { within });
  };

/**
 * Puts a proof into an Effect's context, under its own right's key, as phoenix's `Grant.provide`
 * does: a proof of another right leaves the requirement where it was.
 *
 * @category combinators
 */
export const provide =
  <P>(proof: Proof<P>) =>
  <A, E, R>(self: Effect.Effect<A, E, R>): Effect.Effect<A, E, Exclude<R, P>> =>
    Option.match(sealed(proof), {
      onNone: () => Effect.die(new Error("a proof no check made")),
      onSome: ({ key }) => Effect.provideService(self, key, proof),
    });

/**
 * Checks a proof again on newer tuples: its own subject, permission and object, never another's. A
 * value no check made never holds.
 *
 * @category combinators
 */
export const recheck = (proof: Proof<unknown>, tuples: Tuples): boolean =>
  Option.match(sealed(proof), { onNone: () => false, onSome: ({ holds }) => holds(tuples) });
