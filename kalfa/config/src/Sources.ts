/**
 * The four sources of a setting in their order: flag, env, repo, person, with each declaration's default last (0086).
 *
 * **Details**
 *
 * Each source is an Effect ConfigProvider beside the Origin it names for a leaf it holds. The origin of a key is the first source that holds it, never a guess from equal values.
 */
import type { Config } from "effect";
import { ConfigProvider, Effect, Schema, SchemaIssue, String as Str } from "effect";
import type { App } from "./App.ts";
import { refused, SettingsError, STOP } from "./Files.ts";
import type * as Setting from "./Setting.ts";
import type { TomlDocument } from "./Toml.ts";

/**
 * Schema for where a value came from: the default, a flag, an environment variable, or a line of a file.
 *
 * @category models
 */
export const Origin = Schema.TaggedUnion({
  default: {},
  flag: { name: Schema.String },
  env: { name: Schema.String },
  file: { file: Schema.String, line: Schema.Int },
});

/**
 * The decoded type of `Origin`.
 *
 * @category models
 */
export type Origin = typeof Origin.Type;

/**
 * One source of values: a ConfigProvider and a function that names the origin of a path it holds.
 *
 * @category models
 */
export interface Source {
  readonly provider: ConfigProvider.ConfigProvider;
  readonly origin: (path: ReadonlyArray<string>) => Origin;
}

/**
 * The four sources `resolve` reads, one per slot. `resolve` tries them in the order flags, env, repo, person.
 *
 * @category models
 */
export interface Slots {
  readonly flags: Source;
  readonly env: Source;
  readonly repo: Source;
  readonly person: Source;
}

/**
 * The result of `resolve`: the group's values, and the origin of each path.
 *
 * @category models
 */
export interface Resolved<A> {
  readonly values: A;
  /** Per dotted path, the source that supplied the value, or `default`. */
  readonly origins: Readonly<Record<string, Origin>>;
}

/**
 * Builds a source from flag values keyed by dotted path, as `{ "instance.port": "18800" }`.
 *
 * **Details**
 *
 * An empty value is kept as a value. The origin names the flag, as `--instance.port`.
 *
 * @category constructors
 */
export const flags = (record: Readonly<Record<string, string>>): Source => ({
  provider: ConfigProvider.make((path) => {
    const value = record[path.join(".")];

    return Effect.succeed(value === undefined ? undefined : ConfigProvider.makeValue(value));
  }),
  origin: (path) => Origin.cases.flag.make({ name: `--${path.join(".")}` }),
});

/**
 * Builds a source of an app's variables from an explicit environment record, never the process's own. An app's own `Sources.env` is this one with the app given.
 *
 * **Details**
 *
 * A key is read as the app's prefix and the constant-cased path, as `FABRIKA_INSTANCE_PORT`, so another app's variables are never asked for, and an empty string is kept as a value. The origin names the variable.
 *
 * @category constructors
 */
export const env = (app: App, record: Readonly<Record<string, string>>): Source => ({
  provider: ConfigProvider.fromEnv({ env: { ...record }, preserveEmptyStrings: true }).pipe(
    ConfigProvider.nested(app.name),
    ConfigProvider.constantCase,
  ),
  origin: (path) => Origin.cases.env.make({ name: [app.prefix, ...path.map(Str.configCase)].join("_") }),
});

/**
 * Builds a source from a parsed settings file, with `name` as the file name a person reads.
 *
 * **Details**
 *
 * The origin gives the file name and the line the key starts on, found from the document's spans. It is line 0 when no span matches the exact path.
 *
 * @category constructors
 */
export const file = (name: string, document: TomlDocument): Source => ({
  provider: ConfigProvider.fromUnknown(document.value, { preserveEmptyStrings: true }),
  origin: (path) =>
    Origin.cases.file.make({
      file: name,
      line:
        document.spans.find((s) => s.path.length === path.length && s.path.every((p, n) => p === path[n]))?.line ?? 0,
    }),
});

const location = (origin: Origin) =>
  Origin.matchOrElse(
    origin,
    { file: (origin) => `${origin.file}, line ${origin.line}`, default: () => "default" },
    (origin) => origin.name,
  );

/**
 * Reads every declaration in the group from the four sources and records where each value came from.
 *
 * **Details**
 *
 * For each declaration the first source in the order flag, env, repo, person that holds its key names the origin, and none leaves the default origin. Values are then parsed by the group over the sources chained in that same order. A source that cannot be read fails as `read`. A value the schema refuses fails as `invalid` naming its origin, and a failure that cannot be traced to a declaration fails as `read`. Fails with `SettingsError`.
 *
 * @category combinators
 */
export const resolve = Effect.fnUntraced(function* <A>(group: Setting.Group<A>, slots: Slots) {
  const order = [slots.flags, slots.env, slots.repo, slots.person];
  const origins: Record<string, Origin> = {};
  const supplied: Record<string, string> = {};

  for (const d of group.declarations) {
    origins[d.path] = Origin.cases.default.make({});

    for (const source of order) {
      const node = yield* source.provider
        .load(d.segments)
        .pipe(
          Effect.mapError(
            (cause) => new SettingsError({ reason: "read", message: `${d.path} could not be read.\n  ${STOP}`, cause }),
          ),
        );

      if (node !== undefined) {
        origins[d.path] = source.origin(d.segments);
        supplied[d.path] = node.value ?? "";
        break;
      }
    }
  }

  const provider = [slots.env, slots.repo, slots.person].reduce(
    (chain, source) => chain.pipe(ConfigProvider.orElse(source.provider)),
    slots.flags.provider,
  );

  const values = yield* group.parse(provider).pipe(
    Effect.mapError((error: Config.ConfigError) => {
      const issue = error.cause instanceof Schema.SchemaError ? error.cause.issue : undefined;

      const path =
        issue === undefined ? [] : (SchemaIssue.makeFormatterStandardSchemaV1()(issue).issues[0]?.path ?? []);

      const d = group.declarations.find((d) => d.segments.join(".") === path.join("."));

      return d === undefined
        ? new SettingsError({ reason: "read", message: `The settings could not be read.\n  ${STOP}`, cause: error })
        : refused(location(origins[d.path] ?? Origin.cases.default.make({})), d, supplied[d.path] ?? "");
    }),
  );

  const resolved: Resolved<A> = { values, origins };

  return resolved;
});
