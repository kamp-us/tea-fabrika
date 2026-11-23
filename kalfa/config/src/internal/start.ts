/**
 * The start of a setting group, in the order the protocol fixes: the repo configuration is read, its minimum version is checked, both files are checked whole, and only then is each value resolved by precedence with its origin kept.
 */
import { Config, ConfigProvider, Effect, Option, Schema, SemVer } from "effect";
import * as Rec from "effect/Record";
import type * as Setting from "../Declaration.ts";
import { Origin, type Source } from "../Sources.ts";
import * as Sources from "../Sources.ts";
import { check, type Group, places, refused, version } from "./check.ts";
import { stop } from "./error.ts";
import type { Format } from "./format.ts";
import { frozen } from "./frozen.ts";
import { reading } from "./live.ts";
import { field, segments, variable } from "./names.ts";
import { empty, type Loaded, load, type Names, repoPlace, userPlace } from "./place.ts";

/** What a start leaves: each value under its field and each origin under its setting name. */
export interface Resolved {
  readonly values: Readonly<Record<string, unknown>>;
  readonly origins: Readonly<Record<string, Origin>>;
}

/** Fails when the repo configuration asks for a newer app than the one running. */
const supported = Effect.fnUntraced(function* (app: string, repo: Loaded, current: string) {
  const minimum = yield* Effect.fromResult(version(app, repo));

  if (Option.isNone(minimum)) {
    return;
  }

  const { version: asked, position } = minimum.value;

  const running = yield* Schema.decodeUnknownEffect(Schema.SemVerFromString)(current).pipe(
    Effect.mapError(() => stop(app, "invalid", `${current} is not a version, as 1.2.3.`)),
  );

  if (SemVer.isGreaterThan(asked, running)) {
    return yield* stop(
      app,
      "version",
      `this repo needs ${app} ${SemVer.format(asked)} or newer. You have ${SemVer.format(running)}.`,
      position,
    );
  }
});

/** The first source that holds the setting. */
const holder = (app: string, s: Setting.Any, sources: ReadonlyArray<Source>) =>
  Effect.findFirst(sources, (source) =>
    source.provider.load(segments(s.name)).pipe(
      Effect.map((node) => node !== undefined),
      Effect.mapError((cause) => stop(app, "read", `${s.name} could not be read.`, undefined, cause)),
    ),
  );

/** One setting's value and where it came from: the first source that holds it, else its default. */
const resolve = Effect.fnUntraced(function* (
  group: Group,
  s: Setting.Any,
  files: Readonly<Record<Setting.File, Source>>,
  names: Names,
  provider: ConfigProvider.ConfigProvider,
  given: Option.Option<string>,
) {
  const { app } = group;
  const name = variable(app, s.name);

  // A file-only setting has no flag: a value can reach here only from a record the program built by hand.
  if (s.fileOnly && Option.isSome(given)) {
    return yield* stop(app, "scope", `--${s.name}: ${s.name} may be set only in ${places(app, s, names)}.`);
  }

  // A flag's text is read as a variable's is: one value, answered at every path the schema asks about.
  const flag = Option.map(given, (text): Source => ({
    provider: ConfigProvider.make(() => Effect.succeed(ConfigProvider.makeValue(text))),
    origin: () => Origin.cases.flag.make({ name: `--${s.name}` }),
  }));

  // A file-only setting skips the environment. An environment variable reads at its own name, so the origin names what was read.
  const env: Source = {
    provider: provider.pipe(ConfigProvider.mapInput(() => [name])),
    origin: () => Origin.cases.env.make({ name }),
  };

  const sources = [...Option.toArray(flag), ...(s.fileOnly ? [] : [env]), files.repo, files.user];
  const first = yield* holder(app, s, sources);

  if (Option.isNone(first)) {
    if (Option.isNone(s.default)) {
      return yield* stop(
        app,
        "missing",
        `${s.name} is required, and nothing sets it. Set it in ${places(app, s, names)}.`,
      );
    }

    return { value: s.default.value, origin: Origin.cases.default.make({}) };
  }

  const origin = first.value.origin(segments(s.name));

  // The value is decoded from the source that holds it and no other: a table that source holds comes whole, and a key it leaves out is not filled from a weaker one.
  const value = yield* Config.schema(s.schema, segments(s.name))
    .parse(first.value.provider)
    .pipe(
      Effect.mapError((error) =>
        error.cause instanceof Schema.SchemaError
          ? refused(app, s, origin)
          : stop(app, "read", `${s.name} could not be read.`, undefined, error),
      ),
    );

  return { value, origin };
});

/**
 * Starts a group: reads and checks both files, then resolves every setting, and fails with the first fault.
 */
export const start = Effect.fnUntraced(function* (
  group: Group,
  format: Format,
  options: {
    readonly version: string;
    readonly repo?: string;
    readonly flags?: Readonly<Record<string, Option.Option<string> | undefined>>;
  },
) {
  const { app } = group;
  const provider = yield* ConfigProvider.ConfigProvider;
  const user = yield* userPlace(app, format, provider);
  const place = yield* repoPlace(app, format, options.repo ?? ".");
  const names = { repo: place.name, user: user.name };

  const repo = yield* load(app, format, place);
  yield* supported(app, repo, options.version);
  yield* check(group, "repo", repo, names);

  // No home means no user configuration, so there is no file to read.
  const found: Loaded =
    user.path === undefined
      ? { name: user.name, document: empty }
      : yield* load(app, format, { path: user.path, name: user.name });

  yield* check(group, "user", found, names);

  const files = { repo: Sources.file(repo.name, repo.document), user: Sources.file(found.name, found.document) };
  const values: Record<string, unknown> = {};
  const origins: Record<string, Origin> = {};

  for (const s of group.settings) {
    // Only the record's own keys count: a setting named `constructor` has no flag unless the record holds one.
    const given = Option.getOrUndefined(Rec.get(options.flags ?? {}, s.name)) ?? Option.none();
    const resolved = yield* resolve(group, s, files, names, provider, given);
    // What a reader gets is a frozen copy: no write to it reaches another reader, another start or the declaration's default.
    const settled = frozen(resolved.value);

    // Only a schema cast to lie about its type decodes anything but plain data: the program's author made that, and no user can fix it.
    if (Option.isNone(settled)) {
      return yield* Effect.die(
        new Error(
          `Settings cannot be declared: ${s.name}'s schema gives a value that is not plain data. Only a cast schema can do that.`,
        ),
      );
    }

    values[field(s.name)] = s.live ? yield* reading(settled.value) : settled.value;
    origins[s.name] = Object.freeze(resolved.origin);
  }

  const started: Resolved = { values: Object.freeze(values), origins: Object.freeze(origins) };

  return started;
});
