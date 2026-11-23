// The parts of a call that need no Schema: filling the path, leaving out what a caller left out, and reading GitHub's
// error body. Each is pure and gives a `Result` or an `Option`, and `call` lifts it into an Effect.
import { Option, Predicate, Result, Schema } from "effect";

const NAME = /\{([^{}]+)\}/g;

/** A value a path name takes: a text, or a whole number. */
export type PathValue = string | number | bigint;

/** The text of one path value, or why it is refused. */
const text = (name: string, value: PathValue): Result.Result<string, string> => {
  if (Predicate.isString(value)) {
    return value.trim() === ""
      ? Result.fail(`the path parameter ${name} cannot be empty or blank`)
      : value === "." || value === ".."
        ? Result.fail(`the path parameter ${name} cannot be . or ..`)
        : Result.succeed(value);
  }

  if (Predicate.isNumber(value)) {
    return Number.isInteger(value) && !Object.is(value, -0)
      ? Result.succeed(String(value))
      : Result.fail(`the path parameter ${name} must be a whole number, and ${String(value)} is not`);
  }

  return Result.succeed(String(value));
};

/** A path made from its template, and the values it was made with, as they were sent. */
export interface Filled {
  readonly path: string;
  readonly values: Readonly<Record<string, string>>;
}

/**
 * Fills each `{name}` of a path template with the value the caller holds for it, written as `encodeURIComponent` writes it.
 *
 * A name is read only as an own key. A missing name, a blank text, `.` or `..` (a URL parser folds them, so they would
 * reach another route), a number that is not whole, and a text `encodeURIComponent` cannot write are refused.
 */
export const fill = (template: string, params: Readonly<Record<string, PathValue>>): Result.Result<Filled, string> =>
  Result.all(
    [...new Set(Array.from(template.matchAll(NAME), (found) => found[1] ?? ""))].map((name) => {
      const value = Object.hasOwn(params, name) ? params[name] : undefined;

      return value === undefined
        ? Result.fail(`the path parameter ${name} is missing`)
        : Result.map(text(name, value), (written) => [name, written] as const);
    }),
  ).pipe(
    Result.flatMap((entries) => {
      const values = new Map(entries);

      return Result.try({
        // One pass, so a value that holds `{repo}` is not filled again.
        try: () => template.replace(NAME, (_, name: string) => encodeURIComponent(values.get(name) ?? "")),
        catch: () => "a path parameter holds a lone surrogate, which cannot be written in a URL",
      }).pipe(Result.map((path) => ({ path, values: Object.fromEntries(values) })));
    }),
  );

/** An encoded value as `call` reads it before it leaves out what was left out: JSON, with `undefined` where a key or an item was. */
export type Tree =
  | undefined
  | null
  | boolean
  | number
  | string
  | ReadonlyArray<Tree>
  | { readonly [key: string]: Tree };

/** The Schema that reads an encoded value as a `Tree`: it refuses what JSON cannot hold, such as `NaN` and a function. */
export const Tree: Schema.Codec<Tree> = Schema.Union([
  Schema.Undefined,
  Schema.Null,
  Schema.Boolean,
  Schema.Finite,
  Schema.String,
  Schema.Array(Schema.suspend((): Schema.Codec<Tree> => Tree)),
  Schema.Record(
    Schema.String,
    Schema.suspend((): Schema.Codec<Tree> => Tree),
  ),
]);

/** The Schema that reads an encoded object, such as a query, as a record of `Tree`. */
export const TreeRecord = Schema.Record(
  Schema.String,
  Schema.suspend((): Schema.Codec<Tree> => Tree),
);

const isList = (tree: Tree): tree is ReadonlyArray<Tree> => Array.isArray(tree);

// A copy of `tree` as JSON, with `undefined` where a key was left out. An array may hold no such gap, since JSON would send it
// as `null`.
const walk = (tree: Tree, at: string): Result.Result<Schema.Json | undefined, string> => {
  if (
    tree === undefined ||
    tree === null ||
    Predicate.isString(tree) ||
    Predicate.isNumber(tree) ||
    Predicate.isBoolean(tree)
  ) {
    return Result.succeed(tree);
  }

  if (isList(tree)) {
    return Result.all(tree.map((item, index) => walk(item, `${at}[${index}]`))).pipe(
      Result.flatMap((items) => {
        const gap = items.indexOf(undefined);

        return gap === -1
          ? Result.succeed(items.filter(Predicate.isNotUndefined))
          : Result.fail(`${at}[${gap}] is left out of a list, which would send null`);
      }),
    );
  }

  return pruneRecord(tree, at);
};

const pruneRecord = (record: { readonly [key: string]: Tree }, at: string): Result.Result<Schema.JsonObject, string> =>
  Result.all(
    Object.entries(record).map(([key, each]) => Result.map(walk(each, `${at}.${key}`), (kept) => [key, kept] as const)),
  ).pipe(
    Result.map((entries) =>
      Object.fromEntries(entries.filter((entry): entry is readonly [string, Schema.Json] => entry[1] !== undefined)),
    ),
  );

/**
 * Makes an encoded value into what is sent: a copy with every key whose value is `undefined` left out, at any depth.
 *
 * An explicit `null`, `0`, `false`, `""`, `[]` and `{}` are kept, and so is a key such as `__proto__`. An `undefined` inside
 * a list is refused.
 */
export const prune = (tree: Tree): Result.Result<Schema.Json, string> =>
  Result.flatMap(walk(tree, "the value"), (kept) =>
    kept === undefined ? Result.fail("there is nothing to send") : Result.succeed(kept),
  );

/** The same as `prune`, for an object, such as a query. */
export const pruneObject = (record: { readonly [key: string]: Tree }): Result.Result<Schema.JsonObject, string> =>
  pruneRecord(record, "the value");

/** The query as a URL carries it: each value a text, a number, a boolean, or a list of them. */
export type QueryRecord = Readonly<
  Record<string, string | number | boolean | ReadonlyArray<string | number | boolean>>
>;

const isCarried = (value: Schema.Json): value is string | number | boolean =>
  Predicate.isString(value) || Predicate.isNumber(value) || Predicate.isBoolean(value);

/**
 * Reads an encoded query as what a URL can carry, or says which key cannot be carried: a `null`, an object, or a list that
 * holds either. The message names the key and holds no value.
 */
export const queryValues = (query: Schema.JsonObject): Result.Result<QueryRecord, string> =>
  Result.all(
    Object.entries(query).map(([key, value]) =>
      isCarried(value) || (Array.isArray(value) && value.every(isCarried))
        ? Result.succeed([key, value] as const)
        : Result.fail(`the query value of ${key} is not a text, a number, a boolean or a list of them`),
    ),
  ).pipe(Result.map((entries) => Object.fromEntries(entries)));

/** Whether a request that got no answer, or a 5xx, may have been carried out: a write that left may have been. */
export const mayHaveApplied = (method: string, left: boolean): boolean => left && method !== "GET";

/** What GitHub's error body says, each field on its own: `undefined` for a field it did not send, or sent as another kind. */
export interface ErrorFields {
  readonly message: string | undefined;
  readonly documentation_url: string | undefined;
  readonly errors: string | ReadonlyArray<Schema.Json> | undefined;
}

const Fields = Schema.Record(Schema.String, Schema.Json);

/**
 * Reads GitHub's error body field by field, so one field of another kind never hides the others. A body that is not a JSON
 * object says nothing.
 */
export const errorBody = (body: string): ErrorFields => {
  const object = Schema.decodeUnknownOption(Schema.fromJsonString(Fields))(body);

  if (Option.isNone(object)) {
    return { message: undefined, documentation_url: undefined, errors: undefined };
  }

  const field = <A>(name: string, schema: Schema.Decoder<A>): A | undefined =>
    Object.hasOwn(object.value, name)
      ? Option.getOrUndefined(Schema.decodeUnknownOption(schema)(object.value[name]))
      : undefined;

  return {
    message: field("message", Schema.String),
    documentation_url: field("documentation_url", Schema.String),
    errors: field("errors", Schema.Union([Schema.String, Schema.Array(Schema.Json)])),
  };
};
