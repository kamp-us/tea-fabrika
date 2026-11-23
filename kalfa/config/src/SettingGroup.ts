/**
 * Joins the settings of one app into a group, and starts them: the group's layer reads the repo's minimum version, checks both configuration files whole, resolves every value by precedence and keeps where each came from.
 *
 * **Details**
 *
 * A program reads its settings by yielding the group, which needs the group's layer, so a program that forgot it does not compile. A restart setting reads as its plain value. A live setting reads as a `Live`: yield it for the value now, or read its `changes` for the value now and then each new value, which the layer publishes when a configuration file changes while the program runs.
 */
import { Context, Effect, Layer, Stream } from "effect";
import type * as Digest from "effect/crypto/Digest";
import * as Effectable from "effect/Effectable";
import type * as FileSystem from "effect/FileSystem";
import * as Option from "effect/Option";
import type * as Path from "effect/Path";
import * as Schema from "effect/Schema";
import type * as Setting from "./Declaration.ts";
import * as change from "./internal/change.ts";
import * as disk from "./internal/disk.ts";
import { SettingsError } from "./internal/error.ts";
import { type FlagValues, type Flags, make as build } from "./internal/flags.ts";
import { frozen } from "./internal/frozen.ts";
import type { Live } from "./internal/live.ts";
import { clashes, refusedApp, variable } from "./internal/names.ts";
import { shown } from "./internal/place.ts";
import { receive } from "./internal/receive.ts";
import * as references from "./internal/reference.ts";
import * as schema from "./internal/schema.ts";
import { make as snapshot, same, type Snapshot } from "./internal/snapshot.ts";
import { type Resolved, start } from "./internal/start.ts";
import { toml } from "./internal/toml.ts";
import { type Watched, watched } from "./internal/window.ts";
import type { Origin } from "./Sources.ts";

export {
  /**
   * The one error that stops an app from starting on its settings: its `reason`, a message written for the user who must fix it, and the file and line where there is one.
   *
   * @category errors
   */
  SettingsError,
};

export type {
  /**
   * What a command's handler gets for the group's flags: each flag's text, or none when the person did not give it. Pass it to `layer` as its `flags`.
   *
   * @category models
   */
  FlagValues,
  /**
   * One `effect/cli` flag per setting a flag may set, by setting name. A file-only setting has no key, so a record that names one does not compile, and each other key is optional.
   *
   * @category models
   */
  Flags,
  /**
   * The value of a live setting, an Effect to yield for the value now with a `changes` stream of each new value, a different type from the plain value of a restart setting.
   *
   * @category models
   */
  Live,
};

declare const IdentifierId: unique symbol;

// A value's field is the last word of its name, hyphens joined: "delivery.carry-rule" is carryRule.
type Joined<W extends string> = W extends `${infer Head}-${infer Tail}` ? `${Head}${Capitalize<Joined<Tail>>}` : W;

type Field<N extends string> = N extends `${string}.${infer Rest}` ? Field<Rest> : Joined<N>;

/**
 * What a group gives for one setting: the plain value for a restart setting, a `Live` for a live one.
 *
 * @category models
 */
export type Read<S extends Setting.Any> = S["live"] extends true ? Live<Setting.Type<S>> : Setting.Type<S>;

/**
 * What yielding a group gives: each setting's value under the last word of its name.
 *
 * @category models
 */
export type Values<R extends ReadonlyArray<Setting.Any>> = {
  readonly [S in R[number] as Field<S["name"]>]: Read<S>;
};

/**
 * Where each value came from, by setting name.
 *
 * @category models
 */
export type Origins<R extends ReadonlyArray<Setting.Any>> = Readonly<Record<Watched<R>[number]["name"], Origin>>;

/**
 * What a program that reads a group needs: the group's layer.
 *
 * @category models
 */
export interface Identifier<App extends string, R> {
  readonly [IdentifierId]: { readonly app: App; readonly settings: R };
}

/**
 * One app's settings, an Effect that gives their values once the group's layer is provided.
 *
 * @category models
 */
export interface SettingGroup<App extends string, R extends ReadonlyArray<Setting.Any>> extends Effect.Effect<
  Values<R>,
  never,
  Identifier<App, R>
> {
  readonly app: App;
  readonly settings: R;
}

interface Started<R extends ReadonlyArray<Setting.Any>> {
  readonly values: Values<R>;
  /** The origins as they are now: a live setting's origin follows its value. */
  readonly origins: Effect.Effect<Origins<R>>;
  /** The files as last taken, as snapshots: the one now, then one each time a taken change says something new. */
  readonly snapshots: Stream.Stream<Snapshot, never, Digest.Digest>;
}

// The key is its app and the names of its settings, so two groups of one app with different settings never share a slot.
const key = <App extends string, R extends ReadonlyArray<Setting.Any>>(app: App, settings: R) =>
  Context.Service<Identifier<App, R>, Started<R>>(
    ["@kalfa/config/SettingGroup", app, ...settings.map((setting) => setting.name)].join("/"),
  );

const Segment = /^[a-z0-9]+(-[a-z0-9]+)*$/u;

/** Why a group cannot be read, or undefined when it can. */
const refusal = (app: string, settings: ReadonlyArray<Setting.Any>) => {
  const unnamed = refusedApp(app);

  if (unnamed !== undefined) {
    return unnamed;
  }

  for (const [n, setting] of settings.entries()) {
    const { name } = setting;

    if (!name.split(".").every((segment) => Segment.test(segment))) {
      return `${name} is not a setting name: each word is lowercase letters and digits, with single hyphens between`;
    }

    if (setting.description === "") {
      return `${name} has no description`;
    }

    // A default that slipped past the types is named for what it is, before the schema is asked: a record schema accepts a `Map`.
    if (Option.isSome(setting.default) && Option.isNone(frozen(setting.default.value))) {
      return `${name} has a default that is not plain data (text, numbers, booleans, and arrays and records of those)`;
    }

    if (Option.isSome(setting.default) && !Schema.is(setting.schema)(setting.default.value)) {
      return `${name} has a default its schema refuses`;
    }

    if (name === `${app}-version` || variable(app, name) === `${app.toUpperCase()}_HOME`) {
      return `${name} is taken: ${app}-version and ${app.toUpperCase()}_HOME are the app's own`;
    }

    for (const other of settings.slice(n + 1)) {
      const clash = clashes(app, setting, other);

      if (clash !== undefined) {
        return `${name} and ${other.name} ${clash}`;
      }
    }
  }

  return undefined;
};

// SAFETY: `start` fills one field of `values` for each setting the program declared, named by `field`, with that
// setting's value, and one origin for each setting read, named by the setting's name, the quiet window included for a
// group with a live setting. `Values` and `Origins` are those same keys, written as types.
const typed = <R extends ReadonlyArray<Setting.Any>>(app: string, started: Resolved): Started<R> => ({
  values: started.values as Values<R>,
  origins: Effect.map(started.origins, (origins) => origins as Origins<R>),
  snapshots: started.taken.pipe(
    Stream.mapEffect((taken) => snapshot(app, taken)),
    Stream.changesWith(same),
  ),
});

/**
 * Joins one app's settings into a group.
 *
 * **Gotchas**
 *
 * Throws an `Error` at module load, as today's `Setting.group` does, for a group that cannot be read: an app name that is not one lowercase word, a name word that is not lowercase letters and digits with single hyphens, a setting with no description, a default that is not plain data, a default its schema refuses, two settings with one name, one field or one environment name, a name and its own table, and a name that is `<app>-version` or whose variable is `<APP>_HOME`. The message names the settings.
 *
 * @category constructors
 */
export const make = <const App extends string, const R extends ReadonlyArray<Setting.Any>>(
  app: App,
  ...settings: R
): SettingGroup<App, R> => {
  // A group with a live setting is read with the quiet window too, so a name of its own for that is a clash.
  const refused = refusal(app, watched(settings));

  if (refused !== undefined) {
    throw new Error(`Settings cannot be declared: ${refused}.`);
  }

  const read = key(app, settings);

  const reads = Effectable.Prototype<SettingGroup<App, R>>({
    label: "SettingGroup",
    evaluate: () => Effect.map(read, (started) => started.values),
  });

  return Object.assign(Object.create(reads), { app, settings });
};

/**
 * One `effect/cli` flag per setting, for the app's own command: named as the setting is, as `--instance.port`, with the setting's description as its help text. A file-only setting has no flag.
 *
 * **Gotchas**
 *
 * Throws an `Error` for a setting whose name is a flag Effect's command line keeps for itself, as `help` or `version`.
 *
 * @category combinators
 */
export const flags = <App extends string, R extends ReadonlyArray<Setting.Any>>(
  group: SettingGroup<App, R>,
): Flags<R> =>
  // SAFETY: `build` gives one key for each setting that is not file-only, named by the setting, and the quiet window's
  // for a group with a live setting, which is `Flags` written as a type.
  build(watched(group.settings)) as Flags<R>;

/**
 * Starts a group's settings once and provides them to every program that reads the group.
 *
 * **Details**
 *
 * It runs in a span named `config.layer` with the attribute `kalfa.config.app`, and no value goes in the span. A group with a live setting also gets the restart setting `config.watch.debounce`, the quiet window, 100 milliseconds by default. In order: it reads the repo configuration at `<repo>/.<app>/<app>.toml`, checks the minimum version `<app>-version` against `version`, checks the repo configuration whole, then finds, reads and checks the user configuration whole, and only then resolves each setting by precedence: command-line flag, environment variable, repo configuration, user configuration, default. Fails with one `SettingsError`, the repo configuration's first. `repo` is the folder that holds `.<app>/`, the current folder by default. `flags` is what the command's handler got for `flags(group)`: a flag's text is read as the variable's text is, and with no `flags`, no flag was given. A file-only setting is read from its files and its default only, and a flag or a variable that names it stops the start with `scope`.
 *
 * A group with a live setting then watches the folder of each configuration file for as long as the layer lives. A file that has been quiet for the window is read again and checked whole as the start does, every setting is resolved again, and each live value that differs is published to its `changes`. A refused file is logged as a warning with its file and line, the last good values hold, and nothing fails. A restart setting whose value changed is logged once and applies at the next start. A file that cannot be watched is logged once and followed only at a restart. The watch ends with the layer.
 *
 * @category layers
 */
export const layer = <App extends string, R extends ReadonlyArray<Setting.Any>>(
  group: SettingGroup<App, R>,
  options: { readonly version: string; readonly repo?: string; readonly flags?: FlagValues<R> },
): Layer.Layer<Identifier<App, R>, SettingsError, FileSystem.FileSystem | Path.Path> =>
  Layer.effect(
    key(group.app, group.settings),
    start({ app: group.app, settings: watched(group.settings) }, toml, options).pipe(
      Effect.map((started) => typed<R>(group.app, started)),
      Effect.withSpan("config.layer", { attributes: { "kalfa.config.app": group.app } }),
    ),
  );

/**
 * Reads where each value of a group came from, by setting name.
 *
 * **Details**
 *
 * An origin is the default, a command-line flag by name, an environment variable by name, or a file and line. It holds no value, so it holds no secret. A live setting's origin follows its value: it is read as it is now.
 *
 * @category combinators
 */
export const origins = <App extends string, R extends ReadonlyArray<Setting.Any>>(
  group: SettingGroup<App, R>,
): Effect.Effect<Origins<R>, never, Identifier<App, R>> =>
  Effect.flatMap(key(group.app, group.settings), (started) => started.origins);

/**
 * The group's settings as snapshots, for a process that cannot read files: the one now, then one each time a change to a file is taken and the snapshot says something new. A change that is refused gives none.
 *
 * **Details**
 *
 * A snapshot holds the files as last taken: a restart setting that changed in a file shows its new value and origin, though the running process keeps its start value. It is plain JSON, so an app carries it as it likes. Needs the group's layer and the `Digest` service; the layer from files does not need `Digest`.
 *
 * @category combinators
 */
export const snapshots = <App extends string, R extends ReadonlyArray<Setting.Any>>(
  group: SettingGroup<App, R>,
): Stream.Stream<Snapshot, never, Identifier<App, R> | Digest.Digest> =>
  Stream.unwrap(Effect.map(key(group.app, group.settings), (started) => started.snapshots));

export type {
  /**
   * Every loaded value of one app, where each came from, and a hash of the values alone, as plain JSON.
   *
   * @category models
   */
  Snapshot,
};

/**
 * The editor's JSON Schema of the repo or the user configuration, as the text a repo commits.
 *
 * **Details**
 *
 * It holds the settings the file's scope allows, each with its description and encoded default, and nothing else: a key no setting names is refused. The repo's also holds `<app>-version`, as a pattern. The quiet window is in it for a group with a live setting. The text is two-space JSON as `pnpm format` prints it, with one final line break, and is the same for a group with its settings in another order.
 *
 * **Gotchas**
 *
 * Throws an `Error` when a setting's schema cannot be written as JSON Schema without loosening it, as a bare `Schema.makeFilter` cannot.
 *
 * @category combinators
 */
export const jsonSchema = <App extends string, R extends ReadonlyArray<Setting.Any>>(
  group: SettingGroup<App, R>,
  file: Setting.File,
): string => schema.text({ app: group.app, settings: watched(group.settings) }, file);

/**
 * The settings reference as Markdown: one section per setting, by name, the quiet window included.
 *
 * **Details**
 *
 * Each section holds the setting's description, and a table of its files, its environment variable and flag (`none: file-only` for a file-only setting), its default (`none: required` for a required one) and whether a change applies live or at a restart. It is made from the declarations alone, and ends in one line break.
 *
 * @category combinators
 */
export const reference = <App extends string, R extends ReadonlyArray<Setting.Any>>(
  group: SettingGroup<App, R>,
): string => references.text({ app: group.app, settings: watched(group.settings) });

/**
 * Starts a group from a stream of snapshots, in a process that cannot read files. The first snapshot starts it; each later one updates its live settings.
 *
 * **Details**
 *
 * The first item is read strictly and starts the group, so the group yields the values the loading process read, and `origins` gives where they came from. Each later item is read the same way and applied as the file follower applies a change: a live setting gets its new value, and a changed restart setting is logged as `<name> changed. It applies when <app> starts again.` while its value and origin stay. A snapshot that does not fit the group is refused: the first fails the layer with reason `snapshot`, a later one is logged as a warning and the last good values hold. A stream that ends before its first item fails the layer, and one that ends later is logged once. It runs in the span `config.layer`, and each later item in a root span `config.update`.
 *
 * **Gotchas**
 *
 * The stream cannot fail: a carrier's failure is the app's to handle, so one cannot be passed in. The layer reads no file and no environment, so the stop on a variable for a file-only setting holds on the loading process only. Needs `Digest`.
 *
 * @category layers
 */
export const layerFromSnapshots = <App extends string, R extends ReadonlyArray<Setting.Any>, RS>(
  group: SettingGroup<App, R>,
  snapshots: Stream.Stream<unknown, never, RS>,
): Layer.Layer<Identifier<App, R>, SettingsError, RS | Digest.Digest> =>
  Layer.effect(
    key(group.app, group.settings),
    receive({ app: group.app, settings: watched(group.settings) }, snapshots).pipe(
      Effect.map((started) => typed<R>(group.app, started)),
      Effect.withSpan("config.layer", { attributes: { "kalfa.config.app": group.app } }),
    ),
  );

/**
 * One edit of one configuration file's text: set one setting of the group, or take it out.
 *
 * @category models
 */
export interface Edit<R extends ReadonlyArray<Setting.Any>> {
  /**
   * The text with the setting's value replaced, or added where the file puts it. Fails with one `SettingsError`, and then no text comes back.
   */
  readonly set: <S extends R[number]>(setting: S, value: Setting.Type<S>) => Effect.Effect<string, SettingsError>;
  /**
   * The text without the setting's key, or the same text when the key is not there.
   */
  readonly remove: (setting: R[number]) => Effect.Effect<string, SettingsError>;
}

/**
 * Edits one setting of one configuration file's text, in memory: no file is read or written, and the text is the only input.
 *
 * **Details**
 *
 * `file` says which file the text is, `"repo"` or `"user"`, and the errors name it as a person reads it: `.<app>/<app>.toml` or `~/.<app>/<app>.toml`. Only the changed value's text is replaced, so every comment and line break and every other key stays as it was. A record written over several lines (under its own header, under the headers of its items, or by dotted keys) is compared key by key: a key that is the same keeps its lines, a changed key has only its value replaced, a new item is written beside its siblings, and an item that leaves takes its lines, with the comments inside it and the comment lines right above its header. An array is replaced whole, in the form it had. A set of the value the file already holds, or a remove of a key the file lacks, answers the same text.
 *
 * Before the text is changed, the setting must be one of the group's, the file must be one its file scope allows, a value must pass its schema and be one the file can write, and the whole text must pass the start's check with this setting's own old value left out, so an edit can fix a bad value. After it, the new text is read again: it must hold only that one change and pass the whole check. The first fault is the one error, and no text comes back. A message ends `<file> was not changed.` and never holds a value.
 *
 * **Gotchas**
 *
 * Fails `edit` when the answer would change other data or would not be valid TOML.
 *
 * @category combinators
 */
export const edit = <App extends string, R extends ReadonlyArray<Setting.Any>>(
  group: SettingGroup<App, R>,
  text: string,
  file: Setting.File,
): Edit<R> => {
  const place = { file, names: shown(group.app, toml) };
  const read = { app: group.app, settings: watched(group.settings) };

  return {
    set: (setting, value) => change.set(read, toml, place, text, setting, value),
    remove: (setting) => change.remove(read, toml, place, text, setting),
  };
};

/**
 * Sets one setting in a configuration file on disk: reads the file, makes the same edit as `edit`, and writes the answer back with one rename.
 *
 * **Details**
 *
 * `file` says which file, `"repo"` or `"user"`. The repo configuration is `<repo>/.<app>/<app>.toml`, and `repo` is the folder that holds `.<app>/`, the current folder by default. The user configuration is found as the start finds it: `$<APP>_HOME/<app>.toml`, else `$HOME/.<app>/<app>.toml`. Errors name a file as the start does, as `.demo/demo.toml`, `~/.demo/demo.toml` or `$DEMO_HOME/demo.toml`, never by an absolute path.
 *
 * The new text goes into `<file>.lock`, which is made only if none is there, and one rename puts it over the file: a reader never sees half a file, and a second writer fails at once with `write`, as `git config` does. A link is followed to its target, so a file kept in a dotfiles repo stays a link. A value the file already holds changes nothing: no lock is left and nothing is renamed. The call ends one span, `config.set`, with the attributes `kalfa.config.app`, `kalfa.config.setting`, `kalfa.config.file` and `kalfa.config.changed`, and no value.
 *
 * **Gotchas**
 *
 * Fails `write` when the file or its lock cannot be written, when another change holds the lock (after a crash, remove the lock file by hand), and for a user configuration when neither `$<APP>_HOME` nor `HOME` is set. A set makes the app's own folder, `.<app>/`, and no folder above it: a missing parent fails `write`, and so does a `$<APP>_HOME` that names a folder that is not there. Fails `read` when the file exists and cannot be read. Every other fault is the edit's: the file is as it was.
 *
 * @category combinators
 */
export const set = <App extends string, R extends ReadonlyArray<Setting.Any>, S extends R[number]>(
  group: SettingGroup<App, R>,
  setting: S,
  value: Setting.Type<S>,
  file: Setting.File,
  options?: { readonly repo?: string },
): Effect.Effect<void, SettingsError, FileSystem.FileSystem | Path.Path> =>
  disk.set({ app: group.app, settings: watched(group.settings) }, toml, setting, value, file, options?.repo ?? ".");

/**
 * Takes one setting out of a configuration file on disk, the same way `set` writes: the same file, lock and rename.
 *
 * **Details**
 *
 * A remove of a key the file lacks, or of a file or folder that is not there, succeeds and writes nothing. With no home there is no user configuration, and a remove of its setting succeeds with nothing to take out. The call ends one span, `config.remove`.
 *
 * @category combinators
 */
export const remove = <App extends string, R extends ReadonlyArray<Setting.Any>>(
  group: SettingGroup<App, R>,
  setting: R[number],
  file: Setting.File,
  options?: { readonly repo?: string },
): Effect.Effect<void, SettingsError, FileSystem.FileSystem | Path.Path> =>
  disk.remove({ app: group.app, settings: watched(group.settings) }, toml, setting, file, options?.repo ?? ".");
