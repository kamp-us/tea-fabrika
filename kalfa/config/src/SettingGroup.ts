/**
 * Joins the settings of one app into a group, and starts them: the group's layer reads the repo's minimum version, checks both configuration files whole, resolves every value by precedence and keeps where each came from.
 *
 * **Details**
 *
 * A program reads its settings by yielding the group, which needs the group's layer, so a program that forgot it does not compile. A restart setting reads as its plain value. A live setting reads as a `Live`, which is yielded for the value now.
 */
import { Context, Effect, Layer } from "effect";
import * as Effectable from "effect/Effectable";
import type * as FileSystem from "effect/FileSystem";
import * as Option from "effect/Option";
import type * as Path from "effect/Path";
import * as Schema from "effect/Schema";
import type * as Setting from "./Declaration.ts";
import { SettingsError } from "./internal/error.ts";
import { type FlagValues, type Flags, make as build } from "./internal/flags.ts";
import { frozen } from "./internal/frozen.ts";
import type { Live } from "./internal/live.ts";
import { field, variable } from "./internal/names.ts";
import { type Resolved, start } from "./internal/start.ts";
import { toml } from "./internal/toml.ts";
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
   * One `effect/cli` flag per setting a flag may set, by setting name. A file-only setting has none, so each named key is optional.
   *
   * @category models
   */
  Flags,
  /**
   * The value of a live setting, an Effect to yield for the value now, a different type from the plain value of a restart setting.
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
export type Origins<R extends ReadonlyArray<Setting.Any>> = Readonly<Record<R[number]["name"], Origin>>;

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
  readonly origins: Origins<R>;
}

// The key is its app and the names of its settings, so two groups of one app with different settings never share a slot.
const key = <App extends string, R extends ReadonlyArray<Setting.Any>>(app: App, settings: R) =>
  Context.Service<Identifier<App, R>, Started<R>>(
    ["@kalfa/config/SettingGroup", app, ...settings.map((setting) => setting.name)].join("/"),
  );

const App = /^[a-z][a-z0-9]*$/u;

const Segment = /^[a-z0-9]+(-[a-z0-9]+)*$/u;

/** Why a group cannot be read, or undefined when it can. */
const refusal = (app: string, settings: ReadonlyArray<Setting.Any>) => {
  if (!App.test(app)) {
    return `${JSON.stringify(app)} is not an app name: it must be one lowercase word, as demo`;
  }

  for (const [n, setting] of settings.entries()) {
    const { name } = setting;

    if (!name.split(".").every((segment) => Segment.test(segment))) {
      return `${name} is not a setting name: each word is lowercase letters and digits, with single hyphens between`;
    }

    if (setting.description === undefined) {
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

const clashes = (app: string, a: Setting.Any, b: Setting.Any) => {
  const [short, long] = a.name.length <= b.name.length ? [a.name, b.name] : [b.name, a.name];

  if (short === long || long.startsWith(`${short}.`)) {
    return "are one name, or a value and its table";
  }

  if (field(a.name) === field(b.name)) {
    return `are read as one field, ${field(a.name)}`;
  }

  return variable(app, a.name) === variable(app, b.name) ? `share ${variable(app, a.name)}` : undefined;
};

// SAFETY: `start` fills one field of `values` for each setting, named by `field`, with that setting's value, and one
// origin for each, named by the setting's name. `Values` and `Origins` are those same keys, written as types.
const typed = <R extends ReadonlyArray<Setting.Any>>(started: Resolved): Started<R> => ({
  values: started.values as Values<R>,
  origins: started.origins as Origins<R>,
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
  const refused = refusal(app, settings);

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
  // SAFETY: `build` gives one key for each setting that is not file-only, named by the setting, which is `Flags`
  // written as a type.
  build(group.settings) as Flags<R>;

/**
 * Starts a group's settings once and provides them to every program that reads the group.
 *
 * **Details**
 *
 * It runs in a span named `config.layer` with the attribute `kalfa.config.app`, and no value goes in the span. In order: it reads the repo configuration at `<repo>/.<app>/<app>.toml`, checks the minimum version `<app>-version` against `version`, checks the repo configuration whole, then finds, reads and checks the user configuration whole, and only then resolves each setting by precedence: command-line flag, environment variable, repo configuration, user configuration, default. Fails with one `SettingsError`, the repo configuration's first. `repo` is the folder that holds `.<app>/`, the current folder by default. `flags` is what the command's handler got for `flags(group)`: a flag's text is read as the variable's text is, and with no `flags`, no flag was given.
 *
 * @category layers
 */
export const layer = <App extends string, R extends ReadonlyArray<Setting.Any>>(
  group: SettingGroup<App, R>,
  options: { readonly version: string; readonly repo?: string; readonly flags?: FlagValues<R> },
): Layer.Layer<Identifier<App, R>, SettingsError, FileSystem.FileSystem | Path.Path> =>
  Layer.effect(
    key(group.app, group.settings),
    start(group, toml, options).pipe(
      Effect.map(typed<R>),
      Effect.withSpan("config.layer", { attributes: { "kalfa.config.app": group.app } }),
    ),
  );

/**
 * Reads where each value of a group came from, by setting name.
 *
 * **Details**
 *
 * An origin is the default, a command-line flag by name, an environment variable by name, or a file and line. It holds no value, so it holds no secret.
 *
 * @category combinators
 */
export const origins = <App extends string, R extends ReadonlyArray<Setting.Any>>(
  group: SettingGroup<App, R>,
): Effect.Effect<Origins<R>, never, Identifier<App, R>> =>
  Effect.map(key(group.app, group.settings), (started) => started.origins);
