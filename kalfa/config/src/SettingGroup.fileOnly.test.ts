// Ticket 1842, kalfa/config (new work): FO1 to FO4 of the approved plan (.kalfa/quests/kalfa-config-fileonly-PLAN.md), for
// the file-only setting, read through the package's root entry (index.ts). Written before the code. FO5 (a live file-only
// setting) is in SettingGroup.live.test.ts and FO6 (the mark in the type) in SettingGroup.types.test.ts. B10 and F8, which
// held the old case of a variable that names a file-only setting, are changed in SettingGroup.test.ts and
// SettingGroup.flags.test.ts.
//
// What the code does, as these laws hold it to (the plan's "The stop"):
// - A file-only setting is never read from the environment, and a variable that names it stops the start: one
//   `SettingsError` of reason `scope`, no file and no line, a message that opens with the variable, names the setting and
//   the files that may set it, and ends with the start's closing line. The text of the variable is never decoded and never
//   printed.
// - The stop asks the very source the read would ask: the current `ConfigProvider`, at the setting's own variable. So it
//   sees exactly what the read would have taken (an empty variable is unset under Effect's default provider), and never
//   a near name: the variable of the setting's table, another app's, a lower-case one, a child variable.
// - It runs inside the protocol's order: the minimum version, each file whole, then each setting in the group's order.
//   For one setting, a flag handed by hand (F8) comes before its variable.
//
// Every law is a property over generated inputs, in memory, with the files in MemoryFiles.test-support.ts and Effect's
// own `fromEnv` over a record for the environment.
import { expect, it } from "@effect/vitest";
import { runsFor } from "@kampus/vitest";
import {
  Cause,
  ConfigProvider,
  Effect,
  Exit,
  FileSystem,
  Layer,
  Logger,
  Option,
  Path,
  References,
  Schema,
  Tracer,
} from "effect";
import { Setting, SettingGroup } from "./index.ts";
import * as MemoryFiles from "./MemoryFiles.test-support.ts";

const check = { arbitrary: { runs: runsFor({ fast: 25, full: 100 }), size: 100 } };

const Port = Schema.Int.check(Schema.isBetween({ minimum: 1, maximum: 65535 }));

/** A table with an optional number: the other shape of value a file-only setting may have. */
const Pairing = Schema.Struct({ a: Schema.optionalKey(Schema.Int) });

const DEFAULT = 18787;

const ROOT = "/work";

const HOME = "/people/one";

const VERSION = "1.2.3";

// ---------------------------------------------------------------------------------------------
// Generated names. A message may say `instance` and `person` only of what a program declared, so a generated word never
// holds either. `home` is left out: `<APP>_HOME` is the app's own variable, which a group refuses.
// ---------------------------------------------------------------------------------------------

const clean = Schema.makeFilter((text: string) => !["person", "instance", "home"].some((word) => text.includes(word)));

const Word = Schema.String.check(Schema.isPattern(/^[a-z][a-z0-9]{3,7}$/u), clean);

const Table = Schema.String.check(Schema.isPattern(/^[a-z]{1,6}(-[a-z]{1,4})?$/u), clean);

const Key = Schema.String.check(Schema.isPattern(/^[a-z]{2,6}(-[a-z]{1,4})?$/u), clean);

/** Values apart from the default and from each other, one for each place a value may sit. */
const Seed = Schema.Int.check(
  Schema.isBetween({ minimum: 1000, maximum: 60000 }),
  Schema.makeFilter((n) => Math.abs(n - DEFAULT) > 4),
);

const Entry = Schema.Struct({ table: Table, key: Key, seed: Seed });

interface Named {
  readonly table: string;
  readonly key: string;
}

type Entry = typeof Entry.Type;

const named = (entry: Named) => `${entry.table}.${entry.key}`;

const field = (entry: Named) => entry.key.replace(/-([a-z0-9])/gu, (_, letter: string) => letter.toUpperCase());

const variable = (app: string, entry: Named) =>
  [app.toUpperCase(), ...named(entry).split(".")].map((word) => word.replace(/-/gu, "_").toUpperCase()).join("_");

/** Whether a group of these names can be read together: no two share a table, a field or a variable. */
const apart = (entries: ReadonlyArray<Named>) =>
  new Set(entries.map((entry) => entry.table)).size === entries.length &&
  new Set(entries.map(field)).size === entries.length &&
  new Set(entries.map((entry) => variable("a", entry))).size === entries.length;

/** Two or three settings, no two alike. */
const Entries = Schema.Array(Entry).check(
  Schema.isMinLength(2),
  Schema.isMaxLength(3),
  Schema.makeFilter((entries) => apart(entries)),
);

/** Exactly three settings, no two alike. */
const Three = Schema.Array(Entry).check(
  Schema.isMinLength(3),
  Schema.isMaxLength(3),
  Schema.makeFilter((entries) => apart(entries)),
);

/** A text no port schema takes, so a variable that holds it is refused wherever it is read. */
const Junk = Schema.String.check(Schema.isPattern(/^[a-z]{3,10}$/u));

// ---------------------------------------------------------------------------------------------
// Declaring, grouping and starting
// ---------------------------------------------------------------------------------------------

type Scope = "both" | "repo" | "user";

const FILES: Readonly<Record<Scope, Setting.Files>> = { both: ["repo", "user"], repo: ["repo"], user: ["user"] };

const SCOPES: ReadonlyArray<Scope> = ["both", "repo", "user"];

interface Options {
  readonly files?: Setting.Files;
  readonly fileOnly?: boolean;
  /** No default: the setting is required. */
  readonly required?: boolean;
  /** The shape of its value: a number, or a table with an optional number. */
  readonly kind?: "number" | "table";
}

/** The sentence a setting is described with. */
const helpText = (name: string) => `How ${name} is set.`;

/** The files a setting is limited to, and the file-only mark, on top of what `declare` made. */
const finish = (setting: Setting.Setting<string, any>, options: Options): Setting.Any => {
  const scoped = options.files === undefined ? setting : setting.pipe(Setting.files(options.files));

  return options.fileOnly === true ? scoped.pipe(Setting.fileOnly) : scoped;
};

const declare = (name: string, options: Options = {}): Setting.Any => {
  if (options.kind === "table") {
    const made = Setting.make(name, Pairing).pipe(Setting.withDescription(helpText(name)));

    return finish(options.required === true ? made : made.pipe(Setting.withDefault({})), options);
  }

  const made = Setting.make(name, Port).pipe(Setting.withDescription(helpText(name)));

  return finish(options.required === true ? made : made.pipe(Setting.withDefault(DEFAULT)), options);
};

const makeGroup = (app: string, settings: ReadonlyArray<Setting.Any>) => SettingGroup.make(app, ...settings);

type Group = ReturnType<typeof makeGroup>;

interface Place {
  readonly path: string;
  readonly name: string;
}

const repoFile = (app: string): Place => ({ path: `${ROOT}/.${app}/${app}.toml`, name: `.${app}/${app}.toml` });

const userFile = (app: string): Place => ({ path: `${HOME}/.${app}/${app}.toml`, name: `~/.${app}/${app}.toml` });

const environment = (vars: Readonly<Record<string, string>> = {}) => ({ HOME, ...vars });

interface Scene {
  readonly files?: Readonly<Record<string, string>>;
  /** The whole environment: the law adds `HOME` when it wants one. */
  readonly env?: Readonly<Record<string, string>>;
  readonly flags?: Readonly<Record<string, Option.Option<string>>>;
  readonly version?: string;
  /** Whether the provider keeps an empty variable as a value, as `fromEnv` does when asked. */
  readonly preserveEmptyStrings?: boolean;
}

/** What a start gives: the values by field and the origins by setting name. */
const read = (group: Group) =>
  Effect.gen(function* () {
    const values = yield* group;
    const origins = yield* SettingGroup.origins(group);

    return { values, origins };
  });

type Loaded = Effect.Success<ReturnType<typeof read>>;

/** The start on a scene: the exit, the spans and the log lines. */
const start = (group: Group, scene: Scene) => {
  const spans: Array<Tracer.Span> = [];
  const logs: Array<string> = [];

  const tracer = Tracer.make({
    span: (options) => {
      const span = new Tracer.NativeSpan(options);
      spans.push(span);

      return span;
    },
  });

  const logger = Logger.map(Logger.formatStructured, (entry) => {
    logs.push(JSON.stringify(entry));
  });

  const options = {
    version: scene.version ?? VERSION,
    repo: ROOT,
    ...(scene.flags === undefined ? {} : { flags: scene.flags }),
  };

  const files = MemoryFiles.make({ files: scene.files ?? {} });

  return Effect.gen(function* () {
    const exit = yield* read(group).pipe(Effect.provide(SettingGroup.layer(group, options)), Effect.exit);

    return { exit, spans, logs };
  }).pipe(
    Effect.provide(
      Layer.merge(
        Layer.merge(Layer.succeed(FileSystem.FileSystem)(files), Path.layer),
        ConfigProvider.layer(
          ConfigProvider.fromEnv({
            env: { ...(scene.env ?? environment()) },
            ...(scene.preserveEmptyStrings === true ? { preserveEmptyStrings: true } : {}),
          }),
        ),
      ),
    ),
    Effect.provide(Logger.layer([logger])),
    Effect.provideService(References.MinimumLogLevel, "All"),
    Effect.provideService(Tracer.Tracer, tracer),
  );
};

/** What a start left, as plain data: the one error's parts, or `started`. */
interface Seen {
  readonly reason: string;
  readonly file: string | undefined;
  readonly line: number | undefined;
  readonly message: string;
  /** Every text the failure can print. */
  readonly printed: string;
}

const seen = (exit: Exit.Exit<unknown, unknown>): Seen => {
  if (Exit.isSuccess(exit)) {
    return { reason: "started", file: undefined, line: undefined, message: "", printed: "" };
  }

  const errors = exit.cause.reasons.flatMap((reason) => (reason._tag === "Fail" ? [reason.error] : []));
  const error = errors[0];

  // One start, one error: never two, and never a defect beside it.
  expect(exit.cause.reasons).toHaveLength(1);
  expect(errors).toHaveLength(1);
  expect(error).toBeInstanceOf(SettingGroup.SettingsError);

  return Schema.is(SettingGroup.SettingsError)(error)
    ? {
        reason: error.reason,
        file: error.file,
        line: error.line,
        message: error.message,
        printed: [Cause.pretty(exit.cause), error.message, String(error.cause)].join("\n"),
      }
    : { reason: "not a SettingsError", file: undefined, line: undefined, message: "", printed: "" };
};

const mustStart = (exit: Exit.Exit<Loaded, unknown>): Loaded => {
  expect(seen(exit).reason).toBe("started");

  return Exit.isFailure(exit) ? { values: {}, origins: {} } : exit.value;
};

const escaped = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");

/** Whether a message names the repo file, not the user file whose name ends the same way. */
const namesRepo = (text: string, app: string) => new RegExp(`(?<!~/)${escaped(`.${app}/${app}.toml`)}`, "u").test(text);

/** How many times a text holds another. */
const count = (text: string, part: string) => text.split(part).length - 1;

/** Every form a secret may take in text: raw, JSON-escaped and URL-encoded. */
const forms = (secret: string) => [secret, JSON.stringify(secret).slice(1, -1), encodeURIComponent(secret)];

const inFile = (file: string, line: number) => ({ _tag: "file", file, line });

/** A TOML file's text that holds one value of a setting. */
const holding = (entry: Named, value: number) => `[${entry.table}]\n${entry.key} = ${value}\n`;

/** The message of the stop a variable makes, checked in every part the plan gives it. */
const expectStop = (error: Seen, app: string, entry: Named, scope: Scope, label: string) => {
  const name = named(entry);
  const names = variable(app, entry);

  expect(error.reason, `${label}: ${error.message}`).toBe("scope");
  expect(error.file, label).toBeUndefined();
  expect(error.line, label).toBeUndefined();
  expect(error.message.startsWith(`${names}: ${name} may be set only in `), `${label}: ${error.message}`).toBe(true);
  expect(error.message.includes(`--${name}`), label).toBe(false);
  expect(error.message.endsWith(`${app} did not start.`), label).toBe(true);

  // The files of its scope, exactly, and the variable only where the message opens, never as a place that may set it.
  expect(namesRepo(error.message, app), `${label} names the repo file`).toBe(FILES[scope].includes("repo"));
  expect(error.message.includes(userFile(app).name), `${label} names the user file`).toBe(
    FILES[scope].includes("user"),
  );
  expect(count(error.message, names), `${label} names the variable once`).toBe(1);
};

// ---------------------------------------------------------------------------------------------
// FO1, a variable that names a file-only setting stops the start
// ---------------------------------------------------------------------------------------------

const FileOnlyVariable = Schema.Struct({
  app: Word,
  entries: Entries,
  at: Schema.Int.check(Schema.isBetween({ minimum: 0, maximum: 2 })),
  junk: Junk,
});

/** What a start of the file-only setting's group is given: how its variable reads, and whether its scope's files hold a value. */
type Variable = "good" | "junk" | "none";

const VARIABLES: ReadonlyArray<Variable> = ["good", "junk", "none"];

// Plants: (a) drop the stop: the start takes the file's value or the default; (b) decode the variable before the stop, so a
// refused text fails `invalid`; (c) look for `missing` before the stop; (d) stop only when no file holds the setting, so a
// file's value excuses the variable; (e) name both files whatever the scope; (m) skip the environment for every setting of
// a group that has a file-only one, so the control beside it reads its default.
it.effect.prop(
  "FO1 a variable that names a file-only setting stops the start with one `scope` error that names the variable, the setting and the files of its scope, and the setting beside it still reads its variable",
  { input: FileOnlyVariable },
  ({ input: { app, entries, at, junk } }) =>
    Effect.gen(function* () {
      const target = entries[at % entries.length] ?? entries[0];

      if (target === undefined) {
        return;
      }

      const others = entries.filter((entry) => entry !== target);
      const reached = new Set<string>();

      for (const scope of SCOPES) {
        const files = FILES[scope];

        for (const required of [false, true]) {
          const group = makeGroup(
            app,
            entries.map((entry) =>
              entry === target ? declare(named(entry), { fileOnly: true, files, required }) : declare(named(entry)),
            ),
          );

          for (const held of [false, true]) {
            // The value sits in the first file the scope allows, or in both.
            const onDisk = held
              ? {
                  ...(files.includes("repo") ? { [repoFile(app).path]: holding(target, target.seed + 2) } : {}),
                  ...(files.includes("user") ? { [userFile(app).path]: holding(target, target.seed + 3) } : {}),
                }
              : {};

            for (const kind of VARIABLES) {
              const env: Record<string, string> = {};

              for (const entry of others) {
                env[variable(app, entry)] = String(entry.seed);
              }

              if (kind !== "none") {
                env[variable(app, target)] = kind === "good" ? String(target.seed + 1) : junk;
              }

              const label = `${scope} ${required ? "required" : "optional"} ${held ? "held" : "empty"} ${kind}`;
              const { exit } = yield* start(group, { files: onDisk, env: environment(env) });

              if (kind !== "none") {
                expectStop(seen(exit), app, target, scope, label);
                reached.add(`${kind} ${scope} ${required ? "required" : "optional"} ${held ? "held" : "empty"}`);

                continue;
              }

              // The control: with no variable that names it, the file-only setting reads from its files or its default (or
              // is missing when it is required and no file holds it), and each setting beside it reads its variable.
              if (required && !held) {
                expect(seen(exit).reason, label).toBe("missing");
                reached.add(`control ${scope} required empty`);

                continue;
              }

              const loaded = mustStart(exit);

              const want = held
                ? files.includes("repo")
                  ? {
                      value: target.seed + 2,
                      origin: inFile(repoFile(app).name, 2),
                    }
                  : { value: target.seed + 3, origin: inFile(userFile(app).name, 2) }
                : { value: DEFAULT, origin: { _tag: "default" } };

              expect({ value: loaded.values[field(target)], origin: loaded.origins[named(target)] }, label).toEqual(
                want,
              );

              for (const entry of others) {
                expect(
                  { value: loaded.values[field(entry)], origin: loaded.origins[named(entry)] },
                  `${label}: ${named(entry)}`,
                ).toEqual({ value: entry.seed, origin: { _tag: "env", name: variable(app, entry) } });
              }

              reached.add(`control ${scope} ${required ? "required" : "optional"} ${held ? "held" : "empty"}`);
            }
          }
        }
      }

      // Every class is reached in every run: a text its schema takes and one it refuses, a required setting, a value in a
      // file its scope allows, and each file scope.
      for (const scope of SCOPES) {
        for (const kind of ["good", "junk"]) {
          for (const required of ["required", "optional"]) {
            for (const held of ["held", "empty"]) {
              expect(
                reached.has(`${kind} ${scope} ${required} ${held}`),
                `a run reaches ${kind} ${scope} ${required} ${held}`,
              ).toBe(true);
            }
          }
        }
      }
    }),
  check,
);

// ---------------------------------------------------------------------------------------------
// FO2, the stop sees exactly what the read sees
// ---------------------------------------------------------------------------------------------

const NearVariable = Schema.Struct({
  app: Word,
  entry: Entry,
  neighbor: Entry,
  scope: Schema.Literals(SCOPES),
  held: Schema.Boolean,
  other: Word,
}).check(Schema.makeFilter((input) => apart([input.entry, input.neighbor])));

/** The classes of environment the stop must read as the read does: what each holds, and whether the provider keeps an empty variable. */
interface Class {
  readonly name: string;
  readonly preserveEmptyStrings: boolean;
  readonly vars: (app: string, entry: Named, other: string) => Readonly<Record<string, string>>;
}

const CLASSES: ReadonlyArray<Class> = [
  {
    name: "empty, default provider",
    preserveEmptyStrings: false,
    vars: (app, entry) => ({ [variable(app, entry)]: "" }),
  },
  {
    name: "empty, provider that keeps empty strings",
    preserveEmptyStrings: true,
    vars: (app, entry) => ({ [variable(app, entry)]: "" }),
  },
  {
    // The variable of the setting's table: `<APP>_<TABLE>`.
    name: "the table's variable",
    preserveEmptyStrings: false,
    vars: (app, entry) => ({ [`${app.toUpperCase()}_${entry.table.replace(/-/gu, "_").toUpperCase()}`]: "9" }),
  },
  {
    name: "the same name under another app",
    preserveEmptyStrings: false,
    vars: (_app, entry, other) => ({ [variable(other, entry)]: "9" }),
  },
  {
    name: "the name in lower case",
    preserveEmptyStrings: false,
    vars: (app, entry) => ({ [variable(app, entry).toLowerCase()]: "9" }),
  },
  {
    // A child variable of a table-valued setting, with its own variable unset: `<VAR>_<KEY>`.
    name: "a child variable",
    preserveEmptyStrings: false,
    vars: (app, entry) => ({ [`${variable(app, entry)}_A`]: "9" }),
  },
];

/** What a start came to, as data: its reason, and for a start the value and origin of the setting. */
const outcome = (exit: Exit.Exit<Loaded, unknown>, entry: Entry) =>
  Exit.isSuccess(exit)
    ? { reason: "started", value: exit.value.values[field(entry)], origin: exit.value.origins[named(entry)] }
    : { reason: seen(exit).reason, value: undefined, origin: undefined };

/** A TOML file's text that holds one value of a setting of this kind. */
const holdingKind = (kind: "number" | "table", entry: Named, value: number) =>
  kind === "number" ? holding(entry, value) : `[${entry.table}]\n${entry.key} = { a = ${value} }\n`;

// Plants: (f) let an empty text pass the stop, so under the provider that keeps empty strings the unmarked start reads `""`
// from the variable and the marked one starts; (g) also ask for the table's variable `<APP>_<TABLE>`, so a near name
// stops the start; (h) ask for the variable's words as a path (`["DEMO", "NET", "KEY"]`), so a child variable stops the
// start while the read ignores it.
it.effect.prop(
  "FO2 the stop sees exactly what the read sees: the start of the group stops exactly when the start of the same group with the mark off would read or refuse the setting from its variable, and otherwise gives the same value and origin",
  { input: NearVariable },
  ({ input: { app, entry, neighbor, scope, held, other } }) =>
    Effect.gen(function* () {
      const files = FILES[scope];
      const reached = new Set<string>();

      for (const kind of ["number", "table"] as const) {
        const grouped = (fileOnly: boolean) =>
          makeGroup(app, [declare(named(entry), { fileOnly, files, kind }), declare(named(neighbor))]);

        const disk = held
          ? {
              ...(files.includes("repo") ? { [repoFile(app).path]: holdingKind(kind, entry, entry.seed + 2) } : {}),
              ...(files.includes("user") ? { [userFile(app).path]: holdingKind(kind, entry, entry.seed + 3) } : {}),
            }
          : {};

        // The oracle: the same group with the mark off, and no variable of any class in the environment.
        const calm = outcome(
          (yield* start(grouped(false), {
            files: disk,
            env: environment({ [variable(app, neighbor)]: String(neighbor.seed) }),
          })).exit,
          entry,
        );

        for (const variables of CLASSES) {
          const scene: Scene = {
            files: disk,
            env: environment({
              ...variables.vars(app, entry, `${other}x`),
              [variable(app, neighbor)]: String(neighbor.seed),
            }),
            preserveEmptyStrings: variables.preserveEmptyStrings,
          };

          const marked = (yield* start(grouped(true), scene)).exit;
          const unmarked = outcome((yield* start(grouped(false), scene)).exit, entry);

          // The variable reaches the unmarked start when the start gives something else than the files and the default do.
          const reads = JSON.stringify(unmarked) !== JSON.stringify(calm);
          const label = `${kind}, ${variables.name}`;

          reached.add(`${label} ${reads ? "read" : "ignored"}`);

          if (reads) {
            expectStop(seen(marked), app, entry, scope, label);
          } else {
            // Nothing read the variable, so the marked start gives what the unmarked one gives: the same value and origin.
            expect(outcome(marked, entry), label).toEqual(unmarked);
          }
        }
      }

      // Every class is reached in every run, and the read is what tells it apart: a provider that keeps an empty variable
      // reads it, and no near name is read by any provider. A child variable of a table-valued setting is the one class that
      // may be either: today the read ignores it, and once ticket 1997 reads a variable for each key of a table it reads it.
      // Either way the oracle above holds the stop to the read, so a read child variable must stop the start.
      for (const kind of ["number", "table"]) {
        expect(
          reached.has(`${kind}, empty, provider that keeps empty strings read`),
          `a run reaches an empty ${kind}`,
        ).toBe(true);

        for (const near of [
          "empty, default provider",
          "the table's variable",
          "the same name under another app",
          "the name in lower case",
          "a child variable",
        ]) {
          const either = kind === "table" && near === "a child variable";

          expect(
            reached.has(`${kind}, ${near} ignored`) || (either && reached.has(`${kind}, ${near} read`)),
            `a run reaches ${kind}, ${near}`,
          ).toBe(true);
        }
      }
    }),
  check,
);

// ---------------------------------------------------------------------------------------------
// FO3 [secrets], the variable's text stays out
// ---------------------------------------------------------------------------------------------

// A secret-looking word, with a character that changes in JSON and in a URL.
const Hidden = Schema.String.check(Schema.isPattern(/^sk-([A-Za-z0-9]{6,12})["/ +\\&][A-Za-z0-9]{3}$/u));

const FLOWS = ["variable only", "variable and repo file", "variable and user file", "variable and both files"] as const;

const HiddenVariable = Schema.Struct({
  app: Word,
  entries: Entries,
  at: Schema.Int.check(Schema.isBetween({ minimum: 0, maximum: 2 })),
  secret: Hidden,
});

// Plant: put the variable's text in the message of the stop.
for (const flow of FLOWS) {
  it.effect.prop(
    `FO3 [secrets] a secret in a file-only setting's variable, ${flow}, reaches no error message, cause, span attribute or log line, raw, escaped or encoded`,
    { input: HiddenVariable },
    ({ input: { app, entries, at, secret } }) =>
      Effect.gen(function* () {
        const target = entries[at % entries.length] ?? entries[0];

        if (target === undefined) {
          return;
        }

        const group = makeGroup(
          app,
          entries.map((entry) => declare(named(entry), { fileOnly: entry === target })),
        );

        const env: Record<string, string> = {};

        for (const entry of entries) {
          env[variable(app, entry)] = entry === target ? secret : String(entry.seed);
        }

        const body = holding(target, target.seed + 2);

        const { exit, spans, logs } = yield* start(group, {
          files: {
            [repoFile(app).path]: flow === "variable and repo file" || flow === "variable and both files" ? body : "",
            [userFile(app).path]: flow === "variable and user file" || flow === "variable and both files" ? body : "",
          },
          env: environment(env),
        });

        const span = spans.find((s) => s.name === "config.layer");
        // The span exists and names the app, so the check below is not about nothing.
        expect(span?.attributes.get("kalfa.config.app")).toBe(app);

        const outputs = [
          ...logs,
          ...spans.flatMap((s) => [...s.attributes.entries()].map(([k, v]) => `${k}=${String(v)}`)),
          ...spans.map((s) => s.name),
        ];

        // The variable stops the start, so there is an error to read.
        const error = seen(exit);
        expect(error.reason).toBe("scope");
        outputs.push(error.printed);

        for (const output of outputs) {
          for (const form of forms(secret)) {
            expect(output).not.toContain(form);
          }
        }
      }),
    check,
  );
}

// ---------------------------------------------------------------------------------------------
// FO4, the order of faults
// ---------------------------------------------------------------------------------------------

const StopOrder = Schema.Struct({
  app: Word,
  entries: Three,
  swap: Schema.Boolean,
  junk: Junk,
  flagText: Schema.String.check(Schema.isMinLength(1)),
});

/** One fault a file or the version may hold, with the reason it stops with and the file it is in. */
interface Fault {
  readonly label: string;
  readonly reason: string;
  readonly file: "repo" | "user";
  readonly text: (app: string, settings: { readonly repoOnly: Entry; readonly userOnly: Entry }) => string;
}

// Each fault is the file's own: a syntax error, a key that is no setting, a setting of the other file, a value its schema
// refuses, and a newer minimum version. A setting of the repo file only and one of the user file only give each file a
// setting it may not hold.
const FAULTS: ReadonlyArray<Fault> = [
  { label: "repo syntax", reason: "syntax", file: "repo", text: () => "= = =\n" },
  { label: "repo unknown key", reason: "unknown", file: "repo", text: () => "[zzzz]\nnope = 1\n" },
  { label: "repo wrong file", reason: "scope", file: "repo", text: (_, { userOnly }) => holding(userOnly, 4000) },
  {
    label: "repo refused value",
    reason: "invalid",
    file: "repo",
    text: (_, { repoOnly }) => `[${repoOnly.table}]\n${repoOnly.key} = "no"\n`,
  },
  {
    label: "repo newer minimum version",
    reason: "version",
    file: "repo",
    text: (app) => `${app}-version = "9.9.9"\n`,
  },
  { label: "user syntax", reason: "syntax", file: "user", text: () => "= = =\n" },
  { label: "user unknown key", reason: "unknown", file: "user", text: () => "[zzzz]\nnope = 1\n" },
  { label: "user wrong file", reason: "scope", file: "user", text: (_, { repoOnly }) => holding(repoOnly, 4000) },
  {
    label: "user refused value",
    reason: "invalid",
    file: "user",
    text: (_, { userOnly }) => `[${userOnly.table}]\n${userOnly.key} = "no"\n`,
  },
];

// Plants: (j) check file-only settings' variables before the files are checked, so the variable's `scope` comes first;
// (k) check the variable before the flag, so the message names the variable; (l) check every file-only setting's variable
// in a first pass, before resolving any setting, so the stop comes before an earlier setting's `invalid`.
it.effect.prop(
  "FO4 the first fault is the one error: a file's fault or a newer version comes before a variable's stop, a flag before its variable, the first file-only setting in the group's order before a later one, and a refused variable of an earlier setting before a later stop",
  { input: StopOrder },
  ({ input: { app, entries, swap, junk, flagText } }) =>
    Effect.gen(function* () {
      const [fileOnlyEntry, second, third] = entries;

      if (fileOnlyEntry === undefined || second === undefined || third === undefined) {
        return;
      }

      // The group the faults are made against: the file-only setting first, its variable set, then a setting of the repo file only, then one of the user file only.
      const group = makeGroup(app, [
        declare(named(fileOnlyEntry), { fileOnly: true }),
        declare(named(second), { files: ["repo"] }),
        declare(named(third), { files: ["user"] }),
      ]);

      const withVariable = environment({ [variable(app, fileOnlyEntry)]: String(fileOnlyEntry.seed + 1) });
      const reached = new Set<string>();

      // A file's fault, or a newer minimum version, with the variable set: the file's error, or `version`, is the one.
      for (const fault of FAULTS) {
        const path = fault.file === "repo" ? repoFile(app).path : userFile(app).path;
        const body = fault.text(app, { repoOnly: second, userOnly: third });
        const { exit } = yield* start(group, { files: { [path]: body }, env: withVariable });
        const error = seen(exit);

        expect(error.reason, `${fault.label}: ${error.message}`).toBe(fault.reason);
        expect(error.file, fault.label).toBeDefined();
        expect(error.message.startsWith(`${variable(app, fileOnlyEntry)}:`), `${fault.label}: ${error.message}`).toBe(
          false,
        );
        reached.add(fault.label);
      }

      // A flag handed by hand for the setting, whose variable is set too: the flag's stop is the one error, and it names the flag.
      const flagged = seen(
        (yield* start(group, {
          env: withVariable,
          flags: { [named(fileOnlyEntry)]: Option.some(flagText) },
        })).exit,
      );

      expect(flagged.reason).toBe("scope");
      expect(flagged.message.startsWith(`--${named(fileOnlyEntry)}:`), flagged.message).toBe(true);
      expect(flagged.message.includes(variable(app, fileOnlyEntry))).toBe(false);
      reached.add("flag");

      // Two file-only settings with their variables set: the first in the group's order is the one named.
      const fileOnlyPair = [fileOnlyEntry, second];
      const ordered = swap ? [...fileOnlyPair].reverse() : fileOnlyPair;

      const pair = makeGroup(app, [
        ...ordered.map((entry) => declare(named(entry), { fileOnly: true })),
        declare(named(third)),
      ]);

      const both = seen(
        (yield* start(pair, {
          env: environment({
            [variable(app, fileOnlyEntry)]: String(fileOnlyEntry.seed + 1),
            [variable(app, second)]: String(second.seed + 1),
          }),
        })).exit,
      );

      const first = ordered[0];

      expect(both.reason, both.message).toBe("scope");
      expect(first === undefined ? false : both.message.startsWith(`${variable(app, first)}:`), both.message).toBe(
        true,
      );
      reached.add("first of two");

      // A refused variable of a setting earlier in the group's order comes before a later file-only setting's stop.
      const earlier = makeGroup(app, [declare(named(second)), declare(named(fileOnlyEntry), { fileOnly: true })]);

      const refused = seen(
        (yield* start(earlier, {
          env: environment({
            [variable(app, second)]: junk,
            [variable(app, fileOnlyEntry)]: String(fileOnlyEntry.seed + 1),
          }),
        })).exit,
      );

      expect(refused.reason, refused.message).toBe("invalid");
      expect(refused.message.includes(variable(app, fileOnlyEntry))).toBe(false);
      reached.add("earlier refusal");

      // Every class is reached in every run.
      for (const label of [...FAULTS.map((fault) => fault.label), "flag", "first of two", "earlier refusal"]) {
        expect(reached.has(label), `a run reaches ${label}`).toBe(true);
      }
    }),
  check,
);
