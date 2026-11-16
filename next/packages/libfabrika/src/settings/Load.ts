/**
 * One load of an app's settings: read its two files, check them whole, resolve the four sources and make the snapshot. It answers all of that or one `SettingsError`, so nothing runs on settings that were not checked.
 *
 * **Details**
 *
 * Every name comes from the group's app: the repo's file is `<repo>/.<app>/<app>.toml`, and the person's is `$<APP>_HOME/<app>.toml` when the environment holds `<APP>_HOME`, else `<home>/.<app>/<app>.toml`. Another app's files and variables are never read. Files are read through Effect's `FileSystem` service, so any platform that gives one can load.
 *
 * @stability unstable
 */
import { Effect, FileSystem, Path } from "effect";
import * as Files from "./Files.ts";
import type * as Setting from "./Setting.ts";
import * as Snapshot from "./Snapshot.ts";
import * as Sources from "./Sources.ts";
import type { TomlDocument } from "./Toml.ts";
import { Toml } from "./Toml.ts";

interface Place {
  /** Where the file is read from. */
  readonly path: string;
  /** The name a person reads, as `~/.fabrika/fabrika.toml`. */
  readonly name: string;
}

/**
 * Reads and parses one settings file. A missing file counts as empty.
 *
 * **Details**
 *
 * A file that cannot be read for any other reason fails as `read`, and a TOML error fails as `syntax` with its line. Both messages name the file as a person reads it, never its contents.
 *
 * @stability unstable
 * @category constructors
 */
export const file = Effect.fnUntraced(function* (place: Place) {
  const fs = yield* FileSystem.FileSystem;
  const toml = yield* Toml;
  const text = yield* fs.readFileString(place.path).pipe(
    Effect.catchTag("PlatformError", (cause) =>
      cause.reason._tag === "NotFound"
        ? Effect.succeed("")
        : Effect.fail(
            new Files.SettingsError({
              reason: "read",
              message: `${place.name} could not be read.\n  ${Files.STOP}`,
              cause,
            }),
          ),
    ),
  );
  const document = yield* toml.parse(text).pipe(
    Effect.mapError(
      (cause) =>
        new Files.SettingsError({
          reason: "syntax",
          message: `${place.name}, line ${cause.line}: ${cause.message}\n  ${Files.STOP}`,
          cause,
        }),
    ),
  );
  return { file: place.name, document };
});

/**
 * Resolves an app's settings from two read files: checks the files whole, resolves the four sources over them by precedence, and makes the snapshot, checked as it would be read back.
 *
 * **Details**
 *
 * The files are checked against the group with `Files.validate`, the environment is read under the group's app only, and the snapshot is read back once with `Snapshot.read`, so a value that would not survive saving fails here as `invalid`.
 *
 * @stability unstable
 * @category combinators
 */
export const resolve = Effect.fnUntraced(function* <A, R extends Record<string, Setting.Setting<any>>>(
  group: Setting.Group<A, R>,
  options: {
    readonly repo: { readonly file: string; readonly document: TomlDocument };
    readonly person: { readonly file: string; readonly document: TomlDocument };
    readonly flags: Readonly<Record<string, string>>;
    readonly env: Readonly<Record<string, string>>;
    readonly version: string;
  },
) {
  const { repo, person } = options;
  yield* Files.validate(group, { repo, person }, { version: options.version });
  const resolved = yield* Sources.resolve(group, {
    flags: Sources.flags(options.flags),
    env: Sources.env(group.app, options.env),
    repo: Sources.file(repo.file, repo.document),
    person: Sources.file(person.file, person.document),
  });
  const saved = yield* Snapshot.make(group, resolved);
  return yield* Snapshot.read(group, saved).pipe(
    Effect.mapError(
      (cause) =>
        new Files.SettingsError({
          reason: "invalid",
          message: `The saved settings could not be checked.\n  ${Files.STOP}`,
          cause,
        }),
    ),
  );
});

/**
 * Loads an app's settings once: reads the repo's file and the person's file, checks them, and answers the values with their snapshot.
 *
 * **Details**
 *
 * `repo` is the repo's folder and `home` the person's home folder. A repo that needs a newer release of the app is refused before the person's file is read. Fails with one `SettingsError`.
 *
 * @stability unstable
 * @category constructors
 */
export const load = Effect.fnUntraced(function* <A, R extends Record<string, Setting.Setting<any>>>(
  group: Setting.Group<A, R>,
  options: {
    readonly repo: string;
    readonly home: string;
    readonly flags: Readonly<Record<string, string>>;
    readonly env: Readonly<Record<string, string>>;
    /** The running app's version, which the repo's `<app>-version` is checked against. */
    readonly version: string;
  },
) {
  const path = yield* Path.Path;
  const app = group.app;
  const moved = options.env[app.home];
  const repo = yield* file({ path: path.join(options.repo, app.repo), name: app.repo });
  yield* Files.supported(app, repo, options.version);
  const person = yield* file(
    moved === undefined
      ? { path: path.join(options.home, `.${app.name}`, `${app.name}.toml`), name: app.person }
      : { path: path.join(moved, `${app.name}.toml`), name: `$${app.home}/${app.name}.toml` },
  );
  return yield* resolve(group, { repo, person, flags: options.flags, env: options.env, version: options.version });
});
