/**
 * The fields of a `package.json` that `kalfa` reads, and the rules for them.
 *
 * **Details**
 *
 * A key `kalfa` does not read is left alone, in the manifest and in its `kalfa` field, so an older `kalfa` does not refuse a newer package.
 */
import { Array as Arr, Effect, Option, Order, Predicate, Schema } from "effect";
import { Refused } from "./failure.ts";

/** `.`, or `./` and parts that are not empty, `.` or `..`: a path that stays inside the package. */
const Subpath = Schema.String.check(Schema.isPattern(/^\.(?:\/(?!\.\.?(?:\/|$))[^/]+)*$/));

const Dependencies = Schema.optionalKey(Schema.Record(Schema.String, Schema.String));

/** The fields `kalfa` reads of a manifest, as JSON text. Its own `kalfa` field is checked apart, to say which part is off. */
const Manifest = Schema.fromJsonString(
  Schema.Struct({
    dependencies: Dependencies,
    devDependencies: Dependencies,
    optionalDependencies: Dependencies,
    kalfa: Schema.optionalKey(Schema.Unknown),
  }),
);

type Manifest = typeof Manifest.Type;

const Kalfa = Schema.Struct({ cli: Schema.optionalKey(Subpath) });

/** A manifest read from its text. `name` is the package it belongs to, and none for the repo's own. */
export const read = (text: string, name?: string): Effect.Effect<Manifest, Refused> =>
  Schema.decodeUnknownEffect(Manifest)(text).pipe(
    Effect.mapError(() => new Refused({ reason: "bad-manifest", packages: name === undefined ? [] : [name] })),
  );

/** The subpath of a package's `kalfa.cli` field, when it has one. A field that is not a path inside the package refuses the start. */
export const cli = (manifest: Manifest, name: string): Effect.Effect<Option.Option<string>, Refused> => {
  if (manifest.kalfa === undefined) {
    return Effect.succeed(Option.none());
  }

  return Predicate.isObject(manifest.kalfa)
    ? Schema.decodeUnknownEffect(Kalfa)(manifest.kalfa).pipe(
        Effect.map((field) => Option.fromUndefinedOr(field.cli)),
        Effect.mapError(() => new Refused({ reason: "bad-field", packages: [name], field: "cli" })),
      )
    : Effect.fail(new Refused({ reason: "bad-field", packages: [name] }));
};

/** The direct dependencies of a manifest: each name once, sorted, and whether every list that holds it is `optionalDependencies`. */
export const direct = (manifest: Manifest): ReadonlyArray<{ readonly name: string; readonly optional: boolean }> => {
  const required = new Set([
    ...Object.keys(manifest.dependencies ?? {}),
    ...Object.keys(manifest.devDependencies ?? {}),
  ]);

  const optional = Object.keys(manifest.optionalDependencies ?? {});

  return Arr.sort(Arr.dedupe([...required, ...optional]), Order.String).map((name) => ({
    name,
    optional: !required.has(name),
  }));
};

/** The specifier that Node's resolve takes for a package and the subpath its field names: `.` is the package itself. */
export const specifier = (name: string, subpath: string): string =>
  subpath === "." ? name : `${name}/${subpath.slice(2)}`;
