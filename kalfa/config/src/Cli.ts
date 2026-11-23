/**
 * The `config` command over every group of one app: ask what its settings are now and where each came from, set or remove one in a configuration file, and print the settings' schema and reference. `@kalfa/cli` mounts it as its built-in, and an app can mount it under its own command.
 */
import { Config, Console, Effect, type FileSystem, Option, type Path } from "effect";
import * as Arr from "effect/Array";
import { Argument, Command, Flag } from "effect/cli";
import type * as Setting from "./Declaration.ts";
import { type Group, near, unfit } from "./internal/check.ts";
import { join } from "./internal/cli/join.ts";
import { line, listing } from "./internal/cli/listing.ts";
import * as disk from "./internal/disk.ts";
import { type SettingsError, stop } from "./internal/error.ts";
import { segments } from "./internal/names.ts";
import { textSource } from "./internal/read.ts";
import * as references from "./internal/reference.ts";
import * as schemas from "./internal/schema.ts";
import { load } from "./internal/start.ts";
import { toml } from "./internal/toml.ts";
import type * as SettingGroup from "./SettingGroup.ts";

/** The configuration files, as a flag names them. */
const FILES = ["repo", "user"] as const;

const file = Flag.Literals("file", FILES);

/** Prints a text whole. Every text ends in exactly one line break, which the log adds, so the output is the text byte for byte. */
const print = (text: string) => (text === "" ? Effect.void : Console.log(text.slice(0, -1)));

/** The setting a person typed, found by its name and never as a key of a plain object. Fails `unknown` for a name that is no setting, with the nearest name when one is within two edits. */
const named = Effect.fnUntraced(function* (group: Group, typed: string, closing: string) {
  const found = group.settings.find((setting) => setting.name === typed);

  if (found !== undefined) {
    return found;
  }

  const guess = near(
    group.settings.map((setting) => setting.name),
    typed,
  );

  return yield* stop(
    group.app,
    "unknown",
    `there is no setting ${typed}.${Option.match(guess, { onNone: () => "", onSome: (name) => ` Did you mean ${name}?` })}`,
    undefined,
    undefined,
    closing,
  );
});

/**
 * The `config` command: `get`, `set`, `remove`, `list`, `schema` and `reference`, over the settings of every group.
 *
 * **Details**
 *
 * `repo` is the folder that holds the repo configuration, `<repo>/.<app>/<app>.toml`, and is handed in: the command reads no other folder, the current one included. `version` is the running app's, checked against the repo's minimum. `get <name>` prints the value as one line of JSON. `list` prints every setting: its value as JSON, where it came from, `live` or `restart` (with `file-only`), and its description. `set <name> <value>` reads the text as an environment variable's text is read and edits the file named by `--file`, else the first file the setting may be set in; `remove <name>` takes the key out. Both print nothing. `schema` prints the editor's JSON Schema of the file named by `--file` (the repo's when left out), and `reference` the Markdown reference. Each prints a text whole, and a failed run prints nothing. A read fails with the start's faults, ending `<app> would not start with these settings.`, and a typed name that is no setting fails `unknown`. Each run is a span `config.<subcommand>` with `kalfa.config.app`, and `kalfa.config.setting` once a typed name is found, and no value; `set` and `remove` keep the disk call's span, `config.set` and `config.remove`.
 *
 * **Gotchas**
 *
 * Throws an `Error` when a group is another app's, or two groups declare settings that are one name, a value and its table, or one variable. A field two groups share is fine: each group yields its own.
 *
 * @category commands
 */
export const config = <const App extends string>(
  app: App,
  groups: ReadonlyArray<SettingGroup.SettingGroup<NoInfer<App>, ReadonlyArray<Setting.Any>>>,
  options: { readonly version: string; readonly repo: string },
): Command.Command<
  "config",
  Record<never, never>,
  Record<never, never>,
  SettingsError,
  FileSystem.FileSystem | Path.Path
> => {
  const group = join(app, groups);
  const annotate = Effect.annotateCurrentSpan("kalfa.config.app", app);
  // Nothing is starting, so a fault in the files or the environment says what a start would have done.
  const read = load(group, toml, options, `${app} would not start with these settings.`);

  const get = Command.make(
    "get",
    { name: Argument.String("name").pipe(Argument.withDescription("The setting's name, as delivery.approver")) },
    Effect.fn("config.get")(function* ({ name }) {
      yield* annotate;

      const setting = yield* named(group, name, "Nothing was read.");

      yield* Effect.annotateCurrentSpan("kalfa.config.setting", setting.name);

      const { held } = yield* read;

      // The read resolves every setting of the group, this one included.
      const settled = yield* Effect.fromOption(Arr.findFirst(held.settled, (one) => one.setting === setting)).pipe(
        Effect.orDie,
      );

      yield* print(line(settled));
    }),
  ).pipe(Command.withDescription("Print one setting's value as JSON"));

  /** The first steps of a `set` or a `remove`, in the run's span: the app, and the setting once the typed name is found. */
  const opened = Effect.fnUntraced(function* (typed: string) {
    yield* annotate;

    const setting = yield* named(group, typed, "Nothing was changed.");

    yield* Effect.annotateCurrentSpan("kalfa.config.setting", setting.name);

    return setting;
  });

  const set = Command.make(
    "set",
    {
      name: Argument.String("name").pipe(Argument.withDescription("The setting's name, as delivery.approver")),
      value: Argument.String("value").pipe(
        Argument.withDescription("The value, as an environment variable's text is read"),
      ),
      file: file.pipe(
        Flag.withDescription("The file to change: the first the setting may be set in, when left out"),
        Flag.optional,
      ),
    },
    Effect.fn("config.set")(function* ({ name, value, file }) {
      const setting = yield* opened(name);
      const chosen = Option.getOrElse(file, () => setting.files[0]);
      // A text the schema refuses stops before any file is touched. The error names the file the write would, and never holds the text.
      const found = yield* disk.fileName(app, toml, chosen, options.repo);

      const given = yield* Config.schema(setting.schema, segments(setting.name))
        .parse(textSource(value))
        .pipe(Effect.mapError(() => unfit(app, setting, found, `The ${chosen} configuration was not changed.`)));

      yield* disk.setBare(group, toml, setting, given, chosen, options.repo);
    }),
  ).pipe(Command.withDescription("Set one setting in a configuration file"));

  const remove = Command.make(
    "remove",
    {
      name: Argument.String("name").pipe(Argument.withDescription("The setting's name, as delivery.approver")),
      file: file.pipe(
        Flag.withDescription("The file to change: the first the setting may be set in, when left out"),
        Flag.optional,
      ),
    },
    Effect.fn("config.remove")(function* ({ name, file }) {
      const setting = yield* opened(name);

      yield* disk.removeBare(
        group,
        toml,
        setting,
        Option.getOrElse(file, () => setting.files[0]),
        options.repo,
      );
    }),
  ).pipe(Command.withDescription("Take one setting out of a configuration file"));

  const list = Command.make(
    "list",
    {},
    Effect.fn("config.list")(function* () {
      yield* annotate;

      const { held } = yield* read;

      yield* print(listing(held.settled));
    }),
  ).pipe(Command.withDescription("List every setting: its value, where it came from, and when a change applies"));

  const schema = Command.make(
    "schema",
    { file: file.pipe(Flag.withDescription("The file the schema is for"), Flag.withDefault("repo")) },
    Effect.fn("config.schema")(function* ({ file }) {
      yield* annotate;
      yield* print(yield* Effect.sync(() => schemas.text(group, file)));
    }),
  ).pipe(Command.withDescription("Print the JSON Schema of a configuration file, for an editor"));

  const reference = Command.make(
    "reference",
    {},
    Effect.fn("config.reference")(function* () {
      yield* annotate;
      yield* print(yield* Effect.sync(() => references.text(group)));
    }),
  ).pipe(Command.withDescription("Print the settings reference as Markdown"));

  return Command.make("config").pipe(
    Command.withDescription("Ask about the settings, and change them"),
    Command.withSubcommands([get, set, remove, list, schema, reference]),
  );
};
