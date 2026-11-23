/**
 * Declares one setting with a pipe: its name, its schema and, beside them, a default, a description, the files that may set it, and whether a running process sees a change.
 *
 * **Details**
 *
 * `make` starts a setting and each combinator hands back the same type it was given, so the order in a pipe never matters. Only `live` changes the type: it turns the live mark on, and the group then reads that setting as a `Live` to yield, where a restart setting reads as its plain value. A `Setting` is not an Effect. It is read only through its group, so nothing reads it from the environment alone and skips the files.
 */
import type * as Brand from "effect/Brand";
import * as Option from "effect/Option";
import type { Pipeable } from "effect/Pipeable";
import * as PipeableModule from "effect/Pipeable";
import type * as Schema from "effect/Schema";

/**
 * One of the two settings files: the repo configuration or the user configuration.
 *
 * @category models
 */
export type File = "repo" | "user";

/**
 * The files a setting may be set in, at least one.
 *
 * @category models
 */
export type Files = readonly [File, ...Array<File>];

/**
 * One declared setting of type `A`, named `N`, and live when `L` is true.
 *
 * **Details**
 *
 * `name` is the dotted name a person writes, as `instance.port`. `default` is none for a required setting. `description` is the sentence a person reads, and a group refuses a setting without one. `files` is the file scope, both files unless `files` says less. `fileOnly` marks a setting that only a file may set.
 *
 * @category models
 */
export interface Setting<N extends string, A, L extends boolean = false> extends Pipeable {
  readonly name: N;
  readonly schema: Schema.Codec<A, unknown>;
  readonly default: Option.Option<A>;
  readonly description: string | undefined;
  readonly files: Files;
  readonly live: L;
  readonly fileOnly: boolean;
}

/**
 * Any setting, whatever its name, type or mark.
 *
 * @category models
 */
export type Any = Setting<string, any, boolean>;

/**
 * The type of a setting's value.
 *
 * @category models
 */
export type Type<S extends Any> = S extends Setting<string, infer A, boolean> ? A : never;

type Fields = Omit<Any, keyof Pipeable>;

// A setting is its fields on the one prototype that gives `.pipe`. A combinator builds a new one from the old fields
// with its change on top, so the setting it was given never changes.
const build = <T extends Any>(...fields: ReadonlyArray<Partial<Fields>>): T =>
  Object.assign(Object.create(PipeableModule.Prototype), ...fields);

// Whether two types are the same type, not only assignable one way.
type Same<A, B> = (<X>() => X extends A ? 1 : 2) extends <X>() => X extends B ? 1 : 2 ? true : false;

// Whether `T` was met before on this path, so a recursive type is checked once and not forever.
type Met<Seen, T> = true extends (Seen extends unknown ? Same<Seen, T> : never) ? true : false;

/**
 * The parts of a value's type that are not plain data, or `never` when all of it is.
 *
 * **Details**
 *
 * Plain data is text, numbers, booleans, and arrays and records of those, branded or not. A `Date`, a `Duration`, a `Map`, a class instance, `null` and `undefined` are named whole, wherever they sit. A type written as an `interface` is refused too, since the type cannot tell it from a class: write it as a `type`.
 *
 * @category models
 */
export type NotPlain<T, Seen = never> = 0 extends 1 & T
  ? T
  : Met<Seen, T> extends true
    ? never
    : T extends string | number | boolean
      ? never
      : T extends Brand.Brand<any>
        ? NotPlain<Brand.Brand.Unbranded<T>, Seen>
        : T extends ReadonlyArray<infer E>
          ? NotPlain<E, Seen | T>
          : T extends { readonly [key: string]: unknown }
            ? { [K in keyof T]-?: NotPlain<T[K], Seen | T> }[keyof T]
            : T;

/**
 * What a caller reads in the compiler's message: the part that is not plain data.
 *
 * @category models
 */
export interface NotPlainData<A> {
  readonly "a setting's value must be plain data: text, numbers, booleans, and arrays and records of those": A;
}

/**
 * The schema as given when its value is plain data, else a type no schema meets that names the part.
 *
 * @category models
 */
export type PlainSchema<C extends Schema.Codec<any, unknown>> = [NotPlain<C["Type"]>] extends [never]
  ? C
  : C & NotPlainData<NotPlain<C["Type"]>>;

/**
 * Starts a setting from its dotted name and the schema of its value.
 *
 * **Details**
 *
 * The setting has no default, no description, both files for its scope and no marks yet, so it is a required restart setting until a combinator says otherwise. Its value is plain data only: a schema that decodes a `Date`, a `Duration`, a `Map` or a class does not compile. Declare a length of time or an address as text, and decode it where it is read.
 *
 * @category constructors
 */
export function make<const N extends string, C extends Schema.Codec<any, unknown>>(
  name: N,
  schema: PlainSchema<C>,
): Setting<N, C["Type"]>;
export function make(name: string, schema: Schema.Codec<any, unknown>): Setting<string, any> {
  return build({
    name,
    schema,
    default: Option.none(),
    description: undefined,
    files: ["repo", "user"],
    live: false,
    fileOnly: false,
  });
}

/**
 * Gives a setting the value it has when no source gives one.
 *
 * **Details**
 *
 * The value's type comes from the setting in the pipe, so a default of the wrong type does not compile.
 *
 * @category combinators
 */
export const withDefault =
  <S extends Any>(value: Type<S>) =>
  (self: S): S =>
    build(self, { default: Option.some(value) });

/**
 * Gives a setting the sentence a person reads.
 *
 * @category combinators
 */
export const withDescription =
  (text: string) =>
  <S extends Any>(self: S): S =>
    build(self, { description: text });

/**
 * Names the files that may set a setting. Both files may, unless this says less.
 *
 * @category combinators
 */
export const files =
  (files: Files) =>
  <S extends Any>(self: S): S =>
    build(self, { files });

/**
 * Marks a setting that only a file may set. The environment is not read for it.
 *
 * @category combinators
 */
export const fileOnly = <S extends Any>(self: S): S => build(self, { fileOnly: true });

/**
 * Turns the live mark on: a running process sees a new value of the setting without a restart.
 *
 * **Details**
 *
 * It is the one combinator that changes the type, and a setting cannot be made live twice.
 *
 * @category combinators
 */
export const live = <N extends string, A>(self: Setting<N, A, false>): Setting<N, A, true> =>
  build(self, { live: true });
