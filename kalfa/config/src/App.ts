/**
 * An app that declares settings, named once: every name the settings engine makes comes from it.
 *
 * **Details**
 *
 * `make({ name: "kalfa", list: "kalfa config get" })` gives the app's prefix `KALFA`, its home variable `KALFA_HOME`, its repo file `.kalfa/kalfa.toml`, its person's file `~/.kalfa/kalfa.toml` and its version setting `kalfa-version`. Its `Setting` and `Sources` declare and read under that name only, so one app never reads another's files or variables.
 */
import { Schema } from "effect";
import * as Setting from "./Setting.ts";
import * as Sources from "./Sources.ts";

/** An app's name: one lowercase word, a letter first, so its folder, file, prefix and home variable are one word too. */
const Name = Schema.String.check(Schema.isPattern(/^[a-z][a-z0-9]*$/u));

// The u flag lets Effect write the pattern into the generated JSON Schema.
const Version = Schema.String.check(Schema.isPattern(/^\d+\.\d+\.\d+$/u)).annotate({
  title: "a version",
  description: "A version is three whole numbers, as 1.2.3.",
});

/**
 * One app's names, and the engine's `Setting.make`, `Setting.group` and `Sources.env` bound to it.
 *
 * @category models
 */
export interface App {
  /** The app's one-word name, as `fabrika`. */
  readonly name: string;
  /** The command that lists the app's settings, which a message sends a person to, as `fabrika settings`. */
  readonly list: string;
  /** The start of every environment name, as `FABRIKA`. */
  readonly prefix: string;
  /** The variable that moves the person's folder when it is set, as `FABRIKA_HOME`. */
  readonly home: string;
  /** The repo's file, relative to the repo, as `.fabrika/fabrika.toml`. */
  readonly repo: string;
  /** The person's file as a person reads its name, as `~/.fabrika/fabrika.toml`. */
  readonly person: string;
  /** The oldest release of the app a repo works with, at `<name>-version`, read before every other setting. */
  readonly version: Setting.Setting<string, readonly ["repo"]>;
  readonly Setting: {
    readonly make: <C extends Schema.Codec<any, unknown>, const S extends Setting.Scope>(
      path: string,
      options: Parameters<typeof Setting.make<C, S>>[2],
    ) => Setting.Setting<C["Type"], S, C>;
    readonly group: <const R extends Record<string, Setting.Setting<any>>>(
      settings: R,
    ) => Setting.Group<Setting.Values<R>, R>;
  };
  readonly Sources: {
    readonly env: (record: Readonly<Record<string, string>>) => Sources.Source;
  };
}

/**
 * Makes an app from its one-word name and the command that lists its settings.
 *
 * **Gotchas**
 *
 * Throws an `Error` for a name that is not one lowercase word, so a bad app stops at module load and never runs. Two names such as `kal_fa` and `kal` could otherwise make one environment name.
 *
 * @category constructors
 */
export const make = (options: { readonly name: string; readonly list: string }): App => {
  const { name, list } = options;

  if (!Schema.is(Name)(name)) {
    throw new Error(`${JSON.stringify(name)} is not an app name: it must be one lowercase word, as kalfa.`);
  }

  const prefix = name.toUpperCase();

  const app: App = {
    name,
    list,
    prefix,
    home: `${prefix}_HOME`,
    repo: `.${name}/${name}.toml`,
    person: `~/.${name}/${name}.toml`,
    // The version setting carries the app, so it is made once the app exists.
    get version() {
      return version;
    },
    Setting: {
      make: (path, settings) => Setting.make(app, path, settings),
      group: (settings) => Setting.group(app, settings),
    },
    Sources: { env: (record) => Sources.env(app, record) },
  };

  const version = Setting.make(app, `${name}-version`, {
    schema: Version,
    default: "0.0.0",
    doc: `The oldest ${name} this repo works with. It is read before every other setting.`,
    scope: ["repo"],
    reload: "restart",
    since: "0.0.0",
  });

  return app;
};
