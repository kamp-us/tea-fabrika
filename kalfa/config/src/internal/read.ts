/**
 * Reading a setting group's files and resolving its settings from them: the steps a start and each later change to a file share, so the two cannot drift. A file is read, its minimum version checked (the repo's), and checked whole; then each setting takes the first source that holds it, by precedence, with its origin kept.
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
import { segments, variable } from "./names.ts";
import { empty, type Loaded, load, type Names, type Place } from "./place.ts";

/** Where a configuration file is, and the name a person reads. The user's has no path where there is no home. */
interface Where {
  readonly path: string | undefined;
  readonly name: string;
}

/** What a start and each later change share: the group, how its files are read, and the sources that are not files. */
export interface Setup {
  readonly group: Group;
  readonly format: Format;
  readonly provider: ConfigProvider.ConfigProvider;
  readonly flags: Readonly<Record<string, Option.Option<string> | undefined>>;
  readonly places: { readonly repo: Place; readonly user: Where };
  readonly names: Names;
  /** The version of the running app. */
  readonly version: string;
  /** The sentence that ends a refusal: `<app> did not start.` at the start, `<app> keeps the last good values.` for a change. */
  readonly closing: string;
}

/** The two files as they were last taken, and every setting resolved from them. */
export interface Held {
  readonly repo: Loaded;
  readonly user: Loaded;
  readonly settled: ReadonlyArray<Settled>;
}

/** One setting's value, frozen, and where it came from. */
export interface Settled {
  readonly setting: Setting.Any;
  readonly value: unknown;
  readonly origin: Origin;
}

/** Fails when the repo configuration asks for a newer app than the one running. */
const supported = Effect.fnUntraced(function* (setup: Setup, repo: Loaded) {
  const { app } = setup.group;
  const { closing } = setup;
  const minimum = yield* Effect.fromResult(version(app, repo, closing));

  if (Option.isNone(minimum)) {
    return;
  }

  const { version: asked, position } = minimum.value;

  const running = yield* Schema.decodeUnknownEffect(Schema.SemVerFromString)(setup.version).pipe(
    Effect.mapError(() =>
      stop(app, "invalid", `${setup.version} is not a version, as 1.2.3.`, undefined, undefined, closing),
    ),
  );

  if (SemVer.isGreaterThan(asked, running)) {
    return yield* stop(
      app,
      "version",
      `this repo needs ${app} ${SemVer.format(asked)} or newer. You have ${SemVer.format(running)}.`,
      position,
      undefined,
      closing,
    );
  }
});

/** The first source that holds the setting. */
const holder = (setup: Setup, s: Setting.Any, sources: ReadonlyArray<Source>) =>
  Effect.findFirst(sources, (source) =>
    source.provider.load(segments(s.name)).pipe(
      Effect.map((node) => node !== undefined),
      Effect.mapError((cause) =>
        stop(setup.group.app, "read", `${s.name} could not be read.`, undefined, cause, setup.closing),
      ),
    ),
  );

/** One setting's value and where it came from: the first source that holds it, else its default. */
const resolve = Effect.fnUntraced(function* (
  setup: Setup,
  s: Setting.Any,
  files: Readonly<Record<Setting.File, Source>>,
) {
  const { app } = setup.group;
  const { closing, names } = setup;
  const name = variable(app, s.name);
  // Only the record's own keys count: a setting named `constructor` has no flag unless the record holds one.
  const given = Option.getOrUndefined(Rec.get(setup.flags, s.name)) ?? Option.none();

  // A file-only setting has no flag: a value can reach here only from a record the program built by hand.
  if (s.fileOnly && Option.isSome(given)) {
    return yield* stop(
      app,
      "scope",
      `--${s.name}: ${s.name} may be set only in ${places(app, s, names)}.`,
      undefined,
      undefined,
      closing,
    );
  }

  // A flag's text is read as a variable's is: one value, answered at every path the schema asks about.
  const flag = Option.map(given, (text): Source => ({
    provider: ConfigProvider.make(() => Effect.succeed(ConfigProvider.makeValue(text))),
    origin: () => Origin.cases.flag.make({ name: `--${s.name}` }),
  }));

  // An environment variable reads at its own name, so the origin names what was read.
  const env: Source = {
    provider: setup.provider.pipe(ConfigProvider.mapInput(() => [name])),
    origin: () => Origin.cases.env.make({ name }),
  };

  // A file-only setting is never read from the environment: a variable that names it stops the start here, so the read below finds none. The check asks the source the read would ask, so it sees what the read would have taken, and it never decodes the text.
  if (s.fileOnly) {
    const named = yield* holder(setup, s, [env]);

    if (Option.isSome(named)) {
      return yield* stop(
        app,
        "scope",
        `${name}: ${s.name} may be set only in ${places(app, s, names)}.`,
        undefined,
        undefined,
        closing,
      );
    }
  }

  const sources = [...Option.toArray(flag), env, files.repo, files.user];
  const first = yield* holder(setup, s, sources);

  if (Option.isNone(first)) {
    if (Option.isNone(s.default)) {
      return yield* stop(
        app,
        "missing",
        `${s.name} is required, and nothing sets it. Set it in ${places(app, s, names)}.`,
        undefined,
        undefined,
        closing,
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
          ? refused(app, s, origin, closing)
          : stop(app, "read", `${s.name} could not be read.`, undefined, error, closing),
      ),
    );

  return { value, origin };
});

/** Reads the repo configuration, checks its minimum version, then checks it whole. */
export const readRepo = Effect.fnUntraced(function* (setup: Setup) {
  const repo = yield* load(setup.group.app, setup.format, setup.places.repo, setup.closing);

  yield* supported(setup, repo);
  yield* check(setup.group, "repo", repo, setup.names, { closing: setup.closing });

  return repo;
});

/** Reads the user configuration and checks it whole. No home means no user configuration, so there is no file to read. */
export const readUser = Effect.fnUntraced(function* (setup: Setup) {
  const { path, name } = setup.places.user;

  const found: Loaded =
    path === undefined
      ? { name, document: empty }
      : yield* load(setup.group.app, setup.format, { path, name }, setup.closing);

  yield* check(setup.group, "user", found, setup.names, { closing: setup.closing });

  return found;
});

/** Resolves every setting, in the group's order, from the two files as they are. */
export const settle = Effect.fnUntraced(function* (setup: Setup, repo: Loaded, user: Loaded) {
  const files = { repo: Sources.file(repo.name, repo.document), user: Sources.file(user.name, user.document) };

  // One at a time, in the group's order: the first fault is the one that is reported.
  return yield* Effect.forEach(
    setup.group.settings,
    (setting) =>
      Effect.gen(function* () {
        const resolved = yield* resolve(setup, setting, files);
        // What a reader gets is a frozen copy: no write to it reaches another reader, another start or the declaration's default.
        const value = frozen(resolved.value);

        // Only a schema cast to lie about its type decodes anything but plain data: the program's author made that, and no user can fix it.
        if (Option.isNone(value)) {
          return yield* Effect.die(
            new Error(
              `Settings cannot be declared: ${setting.name}'s schema gives a value that is not plain data. Only a cast schema can do that.`,
            ),
          );
        }

        return { setting, value: value.value, origin: resolved.origin } satisfies Settled;
      }),
    { concurrency: 1 },
  );
});
