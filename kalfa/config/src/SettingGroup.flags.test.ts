// Ticket 1840, kalfa/config (new work): F2 to F12 of the approved plan (.kalfa/quests/kalfa-config-flags-PLAN.md), for
// `SettingGroup.flags` and the `flags` option of `SettingGroup.layer`, read through the package's root entry (index.ts).
// Written before the code. F1, the type law, is in SettingGroup.flags.types.test.ts. 1839's laws (B1 to B17, T1 to T6,
// R1) stay as they are: none passes `flags`.
//
// What the code does, as these laws hold it to (the plan's "The shape"):
// - `SettingGroup.flags(group)` gives one optional text flag per setting that is not file-only, named as the setting is,
//   with the setting's description as help text. It throws an `Error` naming a setting whose name Effect's runner keeps
//   for its own built-in flags (`help`, `version`, `log-level`, their aliases, ...).
// - A command that holds those flags gets each as `Option<string>` (none when the person did not give it), and its
//   handler hands them to `SettingGroup.layer(group, { version, flags })`.
// - The layer reads a given flag first, before the variable, the repo file and the user file, and reads its text as a
//   variable's text. Its origin is `{ _tag: "flag", name: "--<name>" }`. A refused text stops the start with one
//   `invalid` error, however good the other sources are; an empty text is a value. A flag for a file-only setting,
//   which only a hand-built record holds, stops the start with `scope`. Flags are read after both files are checked.
//
// Every law is a property over generated inputs, in memory; F10 is a scenario, as the plan says. The files live in
// MemoryFiles.test-support.ts. F4 runs Effect's own parser, `Command.runWith`, on the in-memory services its doc names.
import { describe, expect, it } from "@effect/vitest";
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
  Ref,
  Schema,
  Stdio,
  Terminal,
  Tracer,
} from "effect";
import * as Command from "effect/cli/Command";
import * as CommandSpec from "effect/cli/CommandSpec";
import { ChildProcessSpawner } from "effect/process";
import { Setting, SettingGroup } from "./index.ts";
import * as MemoryFiles from "./MemoryFiles.test-support.ts";

const check = { arbitrary: { runs: runsFor({ fast: 25, full: 100 }), size: 100 } };

const Port = Schema.Int.check(Schema.isBetween({ minimum: 1, maximum: 65535 }));

const Rule = Schema.Literals(["people", "robots"]);

const DEFAULT = 18787;

const ROOT = "/work";

const HOME = "/people/one";

const VERSION = "1.2.3";

// ---------------------------------------------------------------------------------------------
// Generated names. A message may say `instance` and `person` only of what a program declared, so a generated word
// never holds either. `home` is left out: `<APP>_HOME` is the app's own variable, which a group refuses.
// ---------------------------------------------------------------------------------------------

const clean = Schema.makeFilter((text: string) => !["person", "instance", "home"].some((word) => text.includes(word)));

const Word = Schema.String.check(Schema.isPattern(/^[a-z][a-z0-9]{3,7}$/u), clean);

const Table = Schema.String.check(Schema.isPattern(/^[a-z]{1,6}(-[a-z]{1,4})?$/u), clean);

const Key = Schema.String.check(Schema.isPattern(/^[a-z]{2,6}(-[a-z]{1,4})?$/u), clean);

/** Four values apart from the default and from each other, one for each source: flag, variable, repo file, user file. */
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

const Entries = Schema.Array(Entry).check(
  Schema.isMinLength(1),
  Schema.isMaxLength(4),
  Schema.makeFilter((entries) => apart(entries)),
);

// ---------------------------------------------------------------------------------------------
// Declaring, grouping and starting
// ---------------------------------------------------------------------------------------------

interface Options {
  readonly files?: Setting.Files;
  readonly fileOnly?: boolean;
  readonly live?: boolean;
  /** No default: the setting is required. */
  readonly required?: boolean;
}

/** The sentence a setting is described with: one for each name, so a flag's help text says whose it is. */
const helpText = (name: string) => `How ${name} is set.`;

const declare = (name: string, options: Options = {}) => {
  const described = Setting.make(name, Port).pipe(Setting.withDescription(helpText(name)));
  const given = options.required === true ? described : described.pipe(Setting.withDefault(DEFAULT));
  const scoped = options.files === undefined ? given : given.pipe(Setting.files(options.files));
  const locked = options.fileOnly === true ? scoped.pipe(Setting.fileOnly) : scoped;

  return options.live === true ? locked.pipe(Setting.live) : locked;
};

const makeGroup = (app: string, settings: ReadonlyArray<Setting.Any>) => SettingGroup.make(app, ...settings);

type Group = ReturnType<typeof makeGroup>;

interface Place {
  readonly path: string;
  readonly name: string;
}

const repoFile = (app: string): Place => ({ path: `${ROOT}/.${app}/${app}.toml`, name: `.${app}/${app}.toml` });

const userFile = (app: string): Place => ({ path: `${HOME}/.${app}/${app}.toml`, name: `~/.${app}/${app}.toml` });

/** A TOML file: `pad` comment lines, then `[table]` and `key = raw` for each entry, with the line each key sits on. */
const toml = (pad: number, entries: ReadonlyArray<{ readonly entry: Named; readonly raw: string }>) => {
  const lines = Array.from({ length: pad }, (_, n) => `# note ${n}`);
  const at: Record<string, number> = {};

  for (const { entry, raw } of entries) {
    lines.push(`[${entry.table}]`, `${entry.key} = ${raw}`);
    at[named(entry)] = lines.length;
  }

  return { text: `${lines.join("\n")}\n`, at };
};

type FlagRecord = Readonly<Record<string, Option.Option<string>>>;

interface Scene {
  readonly disk: MemoryFiles.Disk;
  /** The whole environment: the law adds `HOME` when it wants one. */
  readonly env?: Readonly<Record<string, string>>;
  readonly flags?: FlagRecord;
  readonly version?: string;
}

const environment = (vars: Readonly<Record<string, string>> = {}) => ({ HOME, ...vars });

const fileSystem = (disk: MemoryFiles.Disk) =>
  Layer.merge(Layer.succeed(FileSystem.FileSystem)(MemoryFiles.make(disk)), Path.layer);

/** What a start gives: the values by field and the origins by setting name. */
const read = (group: Group) =>
  Effect.gen(function* () {
    const values = yield* group;
    const origins = yield* SettingGroup.origins(group);

    return { values, origins };
  });

type Loaded = Effect.Success<ReturnType<typeof read>>;

/** The start on a scene: the exit, the spans and the log lines. The flags are handed straight to the layer. */
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

  return Effect.gen(function* () {
    const exit = yield* read(group).pipe(Effect.provide(SettingGroup.layer(group, options)), Effect.exit);

    return { exit, spans, logs };
  }).pipe(
    Effect.provide(
      Layer.merge(
        fileSystem(scene.disk),
        ConfigProvider.layer(ConfigProvider.fromEnv({ env: { ...(scene.env ?? environment()) } })),
      ),
    ),
    Effect.provide(Logger.layer([logger])),
    Effect.provideService(References.MinimumLogLevel, "All"),
    Effect.provideService(Tracer.Tracer, tracer),
  );
};

// The services `Command.runWith`'s own doc builds for a test: a file system, the path service, standard input and output,
// a terminal and a child-process spawner that do nothing.
const commandLine = (disk: MemoryFiles.Disk) =>
  Layer.mergeAll(
    fileSystem(disk),
    Stdio.layerTest({}),
    Layer.succeed(
      Terminal.Terminal,
      Terminal.make({
        columns: Effect.succeed(80),
        rows: Effect.succeed(24),
        size: Effect.die("unused"),
        readInput: Effect.die("unused"),
        readLine: Effect.die("unused"),
        display: () => Effect.void,
      }),
    ),
    Layer.succeed(
      ChildProcessSpawner.ChildProcessSpawner,
      ChildProcessSpawner.make(() => Effect.die("unused")),
    ),
  );

/**
 * The start through Effect's own parser: a command made with the group's flags, run on `args`, whose handler provides
 * the group's layer with the flags it got.
 */
const startFromArguments = (group: Group, scene: Scene, args: ReadonlyArray<string>) =>
  Effect.gen(function* () {
    const out = yield* Ref.make<Option.Option<Exit.Exit<Loaded, unknown>>>(Option.none());

    const command = Command.make("demo", { settings: SettingGroup.flags(group) }, ({ settings }) =>
      read(group).pipe(
        Effect.provide(SettingGroup.layer(group, { version: scene.version ?? VERSION, repo: ROOT, flags: settings })),
        Effect.exit,
        Effect.flatMap((exit) => Ref.set(out, Option.some(exit))),
      ),
    );

    yield* Command.runWith(command, { version: VERSION })(args);

    return yield* Ref.get(out);
  }).pipe(
    Effect.provide(
      Layer.merge(
        commandLine(scene.disk),
        ConfigProvider.layer(ConfigProvider.fromEnv({ env: { ...(scene.env ?? environment()) } })),
      ),
    ),
  );

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

/** What a start gave, or nothing when it failed: for a law that has already read the failure with `seen`. */
const mustStartOr = (exit: Exit.Exit<Loaded, unknown>): Loaded =>
  Exit.isFailure(exit) ? { values: {}, origins: {} } : exit.value;

const escaped = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");

/** Whether a message names `name` as a whole name, not as the start of a longer one. */
const mentions = (text: string, name: string) =>
  new RegExp(`(?<![a-z0-9.-])${escaped(name)}(?![a-z0-9-]|\\.[a-z0-9])`, "u").test(text);

/** Whether a message names the repo file, not the user file whose name ends the same way. */
const namesRepo = (text: string, app: string) => new RegExp(`(?<!~/)${escaped(`.${app}/${app}.toml`)}`, "u").test(text);

/** Every form a secret may take in text: raw, JSON-escaped and URL-encoded. */
const forms = (secret: string) => [secret, JSON.stringify(secret).slice(1, -1), encodeURIComponent(secret)];

const inFile = (file: string, line: number) => ({ _tag: "file", file, line });

const flagged = (name: string) => ({ _tag: "flag", name: `--${name}` });

/** The message of what a call throws, or `undefined` when it does not throw. */
const thrown = (call: () => unknown) =>
  Effect.try({ try: call, catch: (error) => (error instanceof Error ? error.message : String(error)) }).pipe(
    Effect.match({ onSuccess: () => undefined, onFailure: (message) => message }),
  );

const isReading = (value: unknown): value is Effect.Effect<unknown> => Effect.isEffect(value);

// ---------------------------------------------------------------------------------------------
// F2, one flag per setting, with its help text
// ---------------------------------------------------------------------------------------------

const FlagGroup = Schema.Struct({
  app: Word,
  entries: Entries,
  only: Schema.Tuple([Schema.Boolean, Schema.Boolean, Schema.Boolean, Schema.Boolean]),
});

/** What a command made with the group's flags lists, from Effect's own read of it. */
const listed = (group: Group) => {
  const command = Command.make("demo", { settings: SettingGroup.flags(group) });
  const spec = Option.getOrThrow(CommandSpec.resolve(command, ["demo"], { builtIns: [] }));

  return spec.flags.map((flag) => ({
    name: flag.name,
    description: flag.description,
    required: flag.required,
    scope: flag.scope._tag,
  }));
};

// Plants: (e) make a flag for a file-only setting too; give every flag the first setting's description.
describe("F2 one flag per setting, with its help text", () => {
  it.prop(
    "a command made with the group's flags lists one flag for each setting that is not file-only, in the group's order, named as the setting and described as it is, never required",
    { input: FlagGroup },
    ({ input: { app, entries, only } }) => {
      const reached = new Set<string>();

      const masks = [entries.map((_, n) => only[n] ?? false), entries.map(() => false), entries.map(() => true)];

      for (const mask of masks) {
        const settings = entries.map((entry, n) => declare(named(entry), { fileOnly: mask[n] === true }));
        const group = makeGroup(app, settings);

        const want = entries.flatMap((entry, n) =>
          mask[n] === true
            ? []
            : [{ name: named(entry), description: helpText(named(entry)), required: false, scope: "Local" }],
        );

        expect(listed(group)).toEqual(want);

        reached.add(mask.every(Boolean) ? "all file-only" : mask.some(Boolean) ? "some file-only" : "none file-only");
      }

      // The generated mask is one of the three, and the two extremes are reached in every run.
      expect(reached.has("all file-only")).toBe(true);
      expect(reached.has("none file-only")).toBe(true);
    },
    check,
  );
});

// ---------------------------------------------------------------------------------------------
// F3 and F4, a flag wins, and its origin says flag
// ---------------------------------------------------------------------------------------------

const SOURCES = ["flag", "env", "repo", "user"] as const;

const Held = Schema.Struct({ flag: Schema.Boolean, env: Schema.Boolean, repo: Schema.Boolean, user: Schema.Boolean });

type Held = typeof Held.Type;

/** All sixteen ways the four sources can hold one setting. */
const EVERY: ReadonlyArray<Held> = Array.from({ length: 16 }, (_, bits) => ({
  flag: (bits & 1) !== 0,
  env: (bits & 2) !== 0,
  repo: (bits & 4) !== 0,
  user: (bits & 8) !== 0,
}));

const label = (held: Held) => SOURCES.filter((source) => held[source]).join("+") || "none";

const NOTHING: Held = { flag: false, env: false, repo: false, user: false };

/**
 * One start's scene: each source holds its own value of the setting, the flag `seed`, the variable `seed + 1`, the repo
 * file `seed + 2`, the user file `seed + 3`. A flag not given is `none`, or no key when `absent`.
 */
const place = (app: string, entries: ReadonlyArray<Entry>, held: ReadonlyArray<Held>, absent: boolean) => {
  const env: Record<string, string> = {};
  const flags: Record<string, Option.Option<string>> = {};
  const repo: Array<{ entry: Named; raw: string }> = [];
  const user: Array<{ entry: Named; raw: string }> = [];
  const given: Array<{ name: string; text: string }> = [];

  entries.forEach((entry, n) => {
    const here = held[n] ?? NOTHING;

    if (here.flag) {
      flags[named(entry)] = Option.some(String(entry.seed));
      given.push({ name: named(entry), text: String(entry.seed) });
    } else if (!absent) {
      flags[named(entry)] = Option.none();
    }

    if (here.env) {
      env[variable(app, entry)] = String(entry.seed + 1);
    }

    if (here.repo) {
      repo.push({ entry, raw: String(entry.seed + 2) });
    }

    if (here.user) {
      user.push({ entry, raw: String(entry.seed + 3) });
    }
  });

  const files = { repo: toml(1, repo), user: toml(2, user) };

  const want = entries.map((entry, n) => {
    const here = held[n] ?? NOTHING;

    return here.flag
      ? { value: entry.seed, origin: flagged(named(entry)) }
      : here.env
        ? { value: entry.seed + 1, origin: { _tag: "env", name: variable(app, entry) } }
        : here.repo
          ? { value: entry.seed + 2, origin: inFile(repoFile(app).name, files.repo.at[named(entry)] ?? -1) }
          : here.user
            ? { value: entry.seed + 3, origin: inFile(userFile(app).name, files.user.at[named(entry)] ?? -1) }
            : { value: DEFAULT, origin: { _tag: "default" } };
  });

  const scene: Scene = {
    disk: { files: { [repoFile(app).path]: files.repo.text, [userFile(app).path]: files.user.text } },
    env: environment(env),
    flags,
  };

  return { scene, want, given };
};

/** The one-word names a setting may have that `Object.prototype` also holds, as the group's own name rule allows them. */
const INHERITED = Object.getOwnPropertyNames(Object.prototype).filter(
  (name) => Effect.runSync(thrown(() => SettingGroup.make("demo", declare(name)))) === undefined,
);

/**
 * A group of settings named like keys of `Object.prototype`, none of them given a flag, started with no flags at all
 * (`flags: {}`) and through the command line with none typed, whose handler gets the flags `SettingGroup.flags` made. It
 * answers as it does with no flag: the first of the variable (unless file-only), the repo file and the user file that
 * holds the setting, else its default.
 */
const inherited = Effect.fnUntraced(function* (
  app: string,
  seed: number,
  held: Held,
  scope: { readonly fileOnly: boolean; readonly files: Setting.Files },
) {
  const { fileOnly, files } = scope;

  const group = makeGroup(
    app,
    INHERITED.map((name) => declare(name, { fileOnly, files })),
  );

  const env: Record<string, string> = {};
  const repo = ["# note 0"];
  const user = ["# note 0", "# note 1"];

  const want = INHERITED.map((name, n) => {
    const base = seed + 10 * n;
    const key = `${app.toUpperCase()}_${name.toUpperCase()}`;

    if (held.env && !fileOnly) {
      env[key] = String(base + 1);
    }

    if (held.repo && files.includes("repo")) {
      repo.push(`${name} = ${base + 2}`);
    }

    if (held.user && files.includes("user")) {
      user.push(`${name} = ${base + 3}`);
    }

    return held.env && !fileOnly
      ? { value: base + 1, origin: { _tag: "env", name: key } }
      : held.repo && files.includes("repo")
        ? { value: base + 2, origin: inFile(repoFile(app).name, repo.length) }
        : held.user && files.includes("user")
          ? { value: base + 3, origin: inFile(userFile(app).name, user.length) }
          : { value: DEFAULT, origin: { _tag: "default" } };
  });

  const scene: Scene = {
    disk: { files: { [repoFile(app).path]: `${repo.join("\n")}\n`, [userFile(app).path]: `${user.join("\n")}\n` } },
    env: environment(env),
  };

  const byRecord = mustStart((yield* start(group, { ...scene, flags: {} })).exit);
  const typedNone = yield* startFromArguments(group, scene, []);

  expect(Option.isSome(typedNone)).toBe(true);
  const byCommand = mustStart(Option.isSome(typedNone) ? typedNone.value : Exit.succeed({ values: {}, origins: {} }));

  for (const [route, loaded] of [
    ["flags: {}", byRecord],
    ["the command's flags", byCommand],
  ] as const) {
    for (const [n, name] of INHERITED.entries()) {
      // The `want` of the settings is read here by name, in the order they were declared.
      expect({ value: loaded.values[name], origin: loaded.origins[name] }, `${route} ${name}`).toEqual(want[n]);
    }
  }
});

const Picks = Schema.Tuple([Held, Held, Held, Held]);

const Absent = Schema.Boolean;

/** Whether what a start gave is what the sources say, for every entry. */
const expectWant = (
  entries: ReadonlyArray<Entry>,
  loaded: Loaded,
  want: ReadonlyArray<{ value: unknown; origin: unknown }>,
  context: string,
) => {
  for (const [n, entry] of entries.entries()) {
    expect(
      { value: loaded.values[field(entry)], origin: loaded.origins[named(entry)] },
      `${context} ${named(entry)}`,
    ).toEqual(want[n]);
  }
};

// Plants: (a) put the flag's source after the environment's; (b) count a flag that was not given as given, with the
// text empty.
// Fix round 1: read the flag record with a plain index, so a setting named `constructor` finds `Object.prototype`'s key
// as its flag: F3 and F8 red, with `flags: {}` and with the flags `SettingGroup.flags` made.
it.effect.prop(
  "F3 each value is the first of flag, variable, repo file and user file that holds it, else its default, and a flag's origin names the flag",
  { app: Word, entries: Entries, picks: Picks, absent: Absent },
  ({ app, entries, picks, absent }) =>
    Effect.gen(function* () {
      const group = makeGroup(
        app,
        entries.map((entry) => declare(named(entry))),
      );

      const reached = new Set<string>();

      const run = Effect.fnUntraced(function* (held: ReadonlyArray<Held>, omitted: boolean) {
        for (const here of held) {
          reached.add(label(here));
        }

        const { scene, want } = place(app, entries, held, omitted);
        const { exit } = yield* start(group, scene);
        expectWant(entries, mustStart(exit), want, held.map(label).join(","));
      });

      yield* run(picks, absent);

      // Every one of the sixteen placements is reached in each run, with a flag's key there and not there.
      for (const here of EVERY) {
        yield* run(
          entries.map(() => here),
          false,
        );

        yield* run(
          entries.map(() => here),
          true,
        );
      }

      expect(reached.size).toBe(16);

      // A setting named like a key of `Object.prototype` has no flag, and starts as with no flag, in every placement
      // of the variable and the files.
      expect(INHERITED.length).toBeGreaterThan(0);

      for (const here of EVERY) {
        yield* inherited(
          app,
          entries[0]?.seed ?? 1000,
          { ...here, flag: false },
          {
            fileOnly: false,
            files: ["repo", "user"],
          },
        );
      }
    }),
  check,
);

/** The arguments a person types for the flags given: `--name value` or `--name=value`, in a generated order. */
const typed = (given: ReadonlyArray<{ name: string; text: string }>, equals: ReadonlyArray<boolean>, turn: number) => {
  const groups = given.map(({ name, text }, n) =>
    equals[n % Math.max(equals.length, 1)] === true ? [`--${name}=${text}`] : [`--${name}`, text],
  );

  const at = groups.length === 0 ? 0 : turn % groups.length;

  return [...groups.slice(at), ...groups.slice(0, at)].flat();
};

// Plant: name each flag by its field, `--port`, in place of the setting's name.
it.effect.prop(
  "F4 through Effect's own parser, a command made with the group's flags gives the values and origins the sources say, in both forms of a flag",
  {
    app: Word,
    entries: Entries,
    picks: Picks,
    equals: Schema.Tuple([Schema.Boolean, Schema.Boolean, Schema.Boolean, Schema.Boolean]),
    turn: Schema.Int.check(Schema.isBetween({ minimum: 0, maximum: 7 })),
  },
  ({ app, entries, picks, equals, turn }) =>
    Effect.gen(function* () {
      const group = makeGroup(
        app,
        entries.map((entry) => declare(named(entry))),
      );

      const used = new Set<string>();

      const run = Effect.fnUntraced(function* (
        held: ReadonlyArray<Held>,
        form: ReadonlyArray<boolean>,
        around: number,
      ) {
        const { scene, want, given } = place(app, entries, held, false);

        for (const equal of form) {
          used.add(equal ? "equals" : "space");
        }

        const out = yield* startFromArguments(group, scene, typed(given, form, around));

        // The handler ran: the command line took every flag the person typed.
        expect(Option.isSome(out)).toBe(true);
        expectWant(
          entries,
          mustStart(Option.isSome(out) ? out.value : Exit.succeed({ values: {}, origins: {} })),
          want,
          "command",
        );
      });

      yield* run(picks, equals, turn);

      // Both forms are reached in each run, with every flag given.
      const all = entries.map(() => ({ ...NOTHING, flag: true, env: true }));
      yield* run(all, [false], turn);
      yield* run(all, [true], turn);

      expect(used.size).toBe(2);
    }),
  check,
);

// ---------------------------------------------------------------------------------------------
// F5, a refused flag stops the start
// ---------------------------------------------------------------------------------------------

const Letters = Schema.String.check(Schema.isPattern(/^[a-z]{1,8}$/u));

const Refusals = Schema.Struct({
  app: Word,
  entries: Entries,
  below: Schema.Int.check(Schema.isLessThanOrEqualTo(0)),
  above: Schema.Int.check(Schema.isGreaterThan(65535)),
  word: Letters,
  other: Letters.check(Schema.makeFilter((text) => text !== "people" && text !== "robots")),
});

/** The refused texts of a port, and of a setting that takes one of a list. */
const refusedTexts = (input: typeof Refusals.Type) => [
  { kind: "range below", rule: false, text: String(input.below) },
  { kind: "range above", rule: false, text: String(input.above) },
  { kind: "a word for a number", rule: false, text: input.word },
  { kind: "empty", rule: false, text: "" },
  { kind: "a literal not in the list", rule: true, text: input.other },
];

// Plants: (d) on a refused flag, fall to the next source; (c) count an empty text as not given.
it.effect.prop(
  "F5 a flag text the schema refuses, an empty one included, stops the start with one `invalid` error that names the flag, even when the variable, a file or the default would give a good value",
  { input: Refusals },
  ({ input }) =>
    Effect.gen(function* () {
      const { app, entries } = input;
      const reached = new Set<string>();

      for (const refused of refusedTexts(input)) {
        reached.add(refused.kind);

        const target = entries[0] ?? { table: "net", key: "port", seed: 5000 };
        const name = named(target);

        const first = refused.rule
          ? Setting.make(name, Rule).pipe(Setting.withDescription(helpText(name)), Setting.withDefault("people"))
          : declare(name);

        const rest = entries.slice(1).map((entry) => declare(named(entry)));
        const group = makeGroup(app, [first, ...rest]);

        // Every source holds a good value of the setting, and every other setting is given a good flag.
        const good = refused.rule ? "robots" : String(target.seed);
        const flags: Record<string, Option.Option<string>> = { [name]: Option.some(refused.text) };

        for (const entry of entries.slice(1)) {
          flags[named(entry)] = Option.some(String(entry.seed));
        }

        const { exit } = yield* start(group, {
          disk: {
            files: {
              [repoFile(app).path]:
                `[${target.table}]\n${target.key} = ${refused.rule ? JSON.stringify(good) : good}\n`,
              [userFile(app).path]:
                `[${target.table}]\n${target.key} = ${refused.rule ? JSON.stringify(good) : good}\n`,
            },
          },
          env: environment({ [variable(app, target)]: good }),
          flags,
        });

        const error = seen(exit);
        expect(error.reason, refused.kind).toBe("invalid");
        expect(error.file).toBeUndefined();
        expect(error.line).toBeUndefined();
        expect(mentions(error.message, `--${name}`), error.message).toBe(true);
        expect(error.message.endsWith(`${app} did not start.`)).toBe(true);
      }

      expect(reached.size).toBe(5);
    }),
  check,
);

// ---------------------------------------------------------------------------------------------
// F6 [secrets], a flag's text stays out
// ---------------------------------------------------------------------------------------------

// A secret-looking word, with a character that changes in JSON and in a URL.
const Hidden = Schema.String.check(Schema.isPattern(/^sk-([A-Za-z0-9]{6,12})["/ +\\&][A-Za-z0-9]{3}$/u));

const FLOWS = [
  "flag only",
  "flag and variable",
  "flag and repo file",
  "flag and user file",
  "flag and both files",
] as const;

const HiddenFlag = Schema.Struct({
  app: Word,
  entries: Entries,
  at: Schema.Int.check(Schema.isBetween({ minimum: 0, maximum: 3 })),
  secret: Hidden,
});

// Plant: put the refused text in the message of an `invalid` error.
describe("F6 [secrets], a flag's text stays out", () => {
  for (const flow of FLOWS) {
    it.effect.prop(
      `a secret refused as a flag, ${flow}, reaches no error message, cause, span attribute or log line, raw, escaped or encoded`,
      { input: HiddenFlag },
      ({ input: { app, entries, at, secret } }) =>
        Effect.gen(function* () {
          const group = makeGroup(
            app,
            entries.map((entry) => declare(named(entry))),
          );

          const target = entries[at % entries.length] ?? entries[0];

          if (target === undefined) {
            return;
          }

          const good = String(target.seed);

          const flags: Record<string, Option.Option<string>> = {};

          for (const entry of entries) {
            flags[named(entry)] = entry === target ? Option.some(secret) : Option.some(String(entry.seed));
          }

          const body = `[${target.table}]\n${target.key} = ${good}\n`;

          const { exit, spans, logs } = yield* start(group, {
            disk: {
              files: {
                [repoFile(app).path]: flow === "flag and repo file" || flow === "flag and both files" ? body : "",
                [userFile(app).path]: flow === "flag and user file" || flow === "flag and both files" ? body : "",
              },
            },
            env: environment(flow === "flag and variable" ? { [variable(app, target)]: good } : {}),
            flags,
          });

          const span = spans.find((s) => s.name === "config.layer");
          // The span exists and names the app, so the check below is not about nothing.
          expect(span?.attributes.get("kalfa.config.app")).toBe(app);

          const outputs = [
            ...logs,
            ...spans.flatMap((s) => [...s.attributes.entries()].map(([k, v]) => `${k}=${String(v)}`)),
            ...spans.map((s) => s.name),
          ];

          // A secret no schema takes as a port is refused, so there is an error to read.
          const error = seen(exit);
          expect(error.reason).toBe("invalid");
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
});

// ---------------------------------------------------------------------------------------------
// F7, a flag's text is read as a variable's
// ---------------------------------------------------------------------------------------------

const KINDS = ["port", "literals", "boolean", "text", "table", "array"] as const;

type Kind = (typeof KINDS)[number];

const Pairing = Schema.Struct({ a: Schema.Int });

/** One required setting of each kind of schema, named `name`. */
const ofKind = (name: string, kind: Kind): Setting.Any => {
  const described = (text: string) => Setting.withDescription(text);

  switch (kind) {
    case "port":
      return Setting.make(name, Port).pipe(described(helpText(name)));
    case "literals":
      return Setting.make(name, Rule).pipe(described(helpText(name)));
    case "boolean":
      return Setting.make(name, Schema.Boolean).pipe(described(helpText(name)));
    case "text":
      return Setting.make(name, Schema.String).pipe(described(helpText(name)));
    case "table":
      return Setting.make(name, Pairing).pipe(described(helpText(name)));
    case "array":
      return Setting.make(name, Schema.Array(Schema.Int)).pipe(described(helpText(name)));
  }
};

const NonEmpty = Schema.String.check(Schema.isMinLength(1));

const SameText = Schema.Struct({
  app: Word,
  entry: Entry,
  good: Schema.Struct({
    port: Port,
    literals: Rule,
    boolean: Schema.Literals(["true", "false"]),
    text: NonEmpty,
    table: Schema.Int,
    array: Schema.Array(Schema.Int),
  }),
  junk: Schema.Tuple([NonEmpty, NonEmpty, NonEmpty, NonEmpty, NonEmpty, NonEmpty]),
});

/** The text a person would type for a value of that kind. */
const goodText = (kind: Kind, good: typeof SameText.Type.good) => {
  switch (kind) {
    case "port":
      return String(good.port);
    case "literals":
      return good.literals;
    case "boolean":
      return good.boolean;
    case "text":
      return good.text;
    case "table":
      return JSON.stringify({ a: good.table });
    case "array":
      return JSON.stringify(good.array);
  }
};

// Plants: (f) read a flag's text as JSON; (h) decode a flag's text with the schema's own decoder, not the string codec.
it.effect.prop(
  "F7 a flag's text is read as the same text in the variable is: the same value, or the same refusal once the flag's name is swapped for the variable's",
  { input: SameText },
  ({ input: { app, entry, good, junk } }) =>
    Effect.gen(function* () {
      const name = named(entry);
      const reached = new Set<string>();

      for (const [n, kind] of KINDS.entries()) {
        const group = makeGroup(app, [ofKind(name, kind)]);

        for (const [sort, text] of [
          ["good", goodText(kind, good)],
          ["junk", junk[n] ?? "junk"],
        ] as const) {
          reached.add(`${kind} ${sort}`);

          const byFlag = yield* start(group, { disk: { files: {} }, flags: { [name]: Option.some(text) } });

          const byVariable = yield* start(group, {
            disk: { files: {} },
            env: environment({ [variable(app, entry)]: text }),
          });

          const a = seen(byFlag.exit);
          const b = seen(byVariable.exit);

          expect(a.reason, `${kind} ${JSON.stringify(text)}`).toBe(b.reason);
          expect(a.file).toBe(b.file);
          expect(a.line).toBe(b.line);
          expect(a.message.replaceAll(`--${name}`, variable(app, entry)), kind).toBe(b.message);

          if (Exit.isSuccess(byFlag.exit) && Exit.isSuccess(byVariable.exit)) {
            expect(byFlag.exit.value.values).toEqual(byVariable.exit.value.values);
            expect(byFlag.exit.value.origins[name]).toEqual(flagged(name));
            expect(byVariable.exit.value.origins[name]).toEqual({ _tag: "env", name: variable(app, entry) });
          }
        }
      }

      // Every kind is reached with a text a person would type and with a junk text.
      expect(reached.size).toBe(KINDS.length * 2);
    }),
  check,
);

// ---------------------------------------------------------------------------------------------
// F8, a file-only setting has no flag
// ---------------------------------------------------------------------------------------------

const Scopes = Schema.Literals(["both", "repo", "user"]);

const FileOnlyFlag = Schema.Struct({
  app: Word,
  entries: Entries,
  scope: Scopes,
  held: Schema.Struct({ env: Schema.Boolean, repo: Schema.Boolean, user: Schema.Boolean }),
  flagText: NonEmpty,
});

const FILES: Readonly<Record<typeof Scopes.Type, Setting.Files>> = {
  both: ["repo", "user"],
  repo: ["repo"],
  user: ["user"],
};

// Plants: (e) read the flag of a file-only setting like any other, so the start takes its value; (k, ticket 1842) check the
// variable before the flag, so the stop names the variable, not the flag.
it.effect.prop(
  "F8 a flag handed to a file-only setting stops the start with `scope` that names the flag and the files and never the variable, and with no flag it reads from its files or its default",
  { input: FileOnlyFlag },
  ({ input: { app, entries, scope, held, flagText } }) =>
    Effect.gen(function* () {
      const [target, ...rest] = entries;

      if (target === undefined) {
        return;
      }

      const name = named(target);
      const files = FILES[scope];

      const group = makeGroup(app, [
        declare(name, { fileOnly: true, files }),
        ...rest.map((entry) => declare(named(entry))),
      ]);

      const inRepo = held.repo && files.includes("repo");
      const inUser = held.user && files.includes("user");

      const disk: MemoryFiles.Disk = {
        files: {
          [repoFile(app).path]: inRepo ? `[${target.table}]\n${target.key} = ${target.seed + 2}\n` : "",
          [userFile(app).path]: inUser ? `[${target.table}]\n${target.key} = ${target.seed + 3}\n` : "",
        },
      };

      // A variable that names the file-only setting is there with the flag: the flag stops the start first, as a flag
      // comes before a variable in precedence. The half with no flag has no such variable, which would stop the start (FO1).
      const env = environment({ [variable(app, target)]: String(target.seed + 1) });
      const unset = environment();

      const other: Record<string, Option.Option<string>> = {};

      for (const entry of rest) {
        other[named(entry)] = Option.none();
      }

      // The flag a hand-built record holds, whatever the files hold.
      const given = seen((yield* start(group, { disk, env, flags: { ...other, [name]: Option.some(flagText) } })).exit);

      expect(given.reason).toBe("scope");
      expect(given.file).toBeUndefined();
      expect(given.line).toBeUndefined();
      expect(mentions(given.message, `--${name}`), given.message).toBe(true);
      expect(given.message.includes(variable(app, target))).toBe(false);
      expect(given.message.endsWith(`${app} did not start.`)).toBe(true);
      expect(files.includes("repo") ? namesRepo(given.message, app) : namesRepo(given.message, app)).toBe(
        files.includes("repo"),
      );
      expect(given.message.includes(userFile(app).name)).toBe(files.includes("user"));

      // With no flag and no variable, as B10 says: the first of the repo file and the user file that holds it, else the default.
      const loaded = mustStart((yield* start(group, { disk, env: unset, flags: other })).exit);

      const lineHolding = (text: string) =>
        text.split("\n").findIndex((line) => line.startsWith(`${target.key} =`)) + 1;

      const want = inRepo
        ? {
            value: target.seed + 2,
            origin: inFile(repoFile(app).name, lineHolding(disk.files[repoFile(app).path] ?? "")),
          }
        : inUser
          ? {
              value: target.seed + 3,
              origin: inFile(userFile(app).name, lineHolding(disk.files[userFile(app).path] ?? "")),
            }
          : { value: DEFAULT, origin: { _tag: "default" } };

      expect({ value: loaded.values[field(target)], origin: loaded.origins[name] }).toEqual(want);

      // A file-only setting named like a key of `Object.prototype` has no flag either, and starts as with none.
      yield* inherited(
        app,
        target.seed,
        { flag: false, env: held.env, repo: held.repo, user: held.user },
        {
          fileOnly: true,
          files,
        },
      );
    }),
  check,
);

// ---------------------------------------------------------------------------------------------
// F9, a required setting a flag sets
// ---------------------------------------------------------------------------------------------

const RequiredFlag = Schema.Struct({
  app: Word,
  entries: Entries,
  given: Schema.Tuple([Schema.Boolean, Schema.Boolean, Schema.Boolean, Schema.Boolean]),
});

// Plant: (j) look for a required setting's value in the variable and the files only.
it.effect.prop(
  "F9 a required setting only a flag sets starts with the flag's value and origin, and fails `missing` when its flag is not given",
  { input: RequiredFlag },
  ({ input: { app, entries, given } }) =>
    Effect.gen(function* () {
      const group = makeGroup(
        app,
        entries.map((entry) => declare(named(entry), { required: true })),
      );

      const reached = new Set<string>();

      const run = Effect.fnUntraced(function* (which: ReadonlyArray<boolean>) {
        const flags: Record<string, Option.Option<string>> = {};

        entries.forEach((entry, n) => {
          flags[named(entry)] = which[n] === true ? Option.some(String(entry.seed)) : Option.none();
        });

        const { exit } = yield* start(group, { disk: { files: {} }, flags });
        const first = entries.findIndex((_, n) => which[n] !== true);
        const error = seen(exit);

        reached.add(first === -1 ? "all given" : "one missing");
        expect(error.reason).toBe(first === -1 ? "started" : "missing");

        // The first setting whose flag is not given is the one the error names.
        const lacking = entries[first];
        expect(lacking === undefined || mentions(error.message, named(lacking))).toBe(true);

        const loaded = mustStartOr(exit);

        for (const entry of first === -1 ? entries : []) {
          expect({ value: loaded.values[field(entry)], origin: loaded.origins[named(entry)] }).toEqual({
            value: entry.seed,
            origin: flagged(named(entry)),
          });
        }
      });

      yield* run(entries.map((_, n) => given[n] === true));
      yield* run(entries.map(() => true));
      yield* run(entries.map(() => false));
      yield* run(entries.map((_, n) => n !== entries.length - 1));

      expect(reached.size).toBe(2);
    }),
  check,
);

// ---------------------------------------------------------------------------------------------
// F10, a live setting a flag sets
// ---------------------------------------------------------------------------------------------

// Plant: (g) build each `Live` from the sources after the flag.
it.effect(
  "F10 scenario: a live setting a flag sets reads the flag's value and origin, as a restart setting with the same flag does, also when every other source holds it too",
  () =>
    Effect.gen(function* () {
      const app = "demo";

      const group = makeGroup(app, [declare("net.fixed"), declare("net.moving", { live: true })]);

      const flags = { "net.fixed": Option.some("4200"), "net.moving": Option.some("4300") };
      const places = ["flag only", "flag, variable and both files"] as const;

      for (const situation of places) {
        const everywhere = situation !== "flag only";

        const file = "[net]\nfixed = 4001\nmoving = 4002\n";

        const { exit } = yield* start(group, {
          disk: everywhere ? { files: { [repoFile(app).path]: file, [userFile(app).path]: file } } : { files: {} },
          env: environment(everywhere ? { DEMO_NET_FIXED: "4003", DEMO_NET_MOVING: "4004" } : {}),
          flags,
        });

        const loaded = mustStart(exit);
        const moving = loaded.values.moving;

        expect(isReading(moving), situation).toBe(true);
        expect(isReading(moving) ? yield* moving : undefined, situation).toBe(4300);
        expect(loaded.values.fixed, situation).toBe(4200);
        expect(loaded.origins["net.moving"], situation).toEqual(flagged("net.moving"));
        expect(loaded.origins["net.fixed"], situation).toEqual(flagged("net.fixed"));
      }
    }),
);

// ---------------------------------------------------------------------------------------------
// F11, flags are read last of all checks
// ---------------------------------------------------------------------------------------------

type FileFault = "syntax" | "unknown" | "invalid" | "version";

const REPO_FAULTS: ReadonlyArray<FileFault | undefined> = [undefined, "syntax", "unknown", "invalid", "version"];

const USER_FAULTS: ReadonlyArray<FileFault | undefined> = [undefined, "syntax", "unknown", "invalid"];

/** Each pair of a repo fault and a user fault, bar the pair with no fault at all. */
const FAULTS = REPO_FAULTS.flatMap((repo) => USER_FAULTS.map((user) => ({ repo, user }))).filter(
  ({ repo, user }) => repo !== undefined || user !== undefined,
);

const FlagFault = Schema.Struct({
  app: Word,
  entries: Entries,
  word: Letters,
  at: Schema.Int.check(Schema.isBetween({ minimum: 0, maximum: FAULTS.length - 1 })),
});

/** A file that holds `fault`: the setting's own table, a table that is none, a value of the wrong type, or no valid TOML. */
const faulty = (app: string, target: Named, fault: FileFault) => {
  switch (fault) {
    case "syntax":
      return `[${target.table}\n`;
    case "unknown":
      return "[zzzzz]\nkeykey = 1\n";
    case "invalid":
      return `[${target.table}]\n${target.key} = "not a port"\n`;
    case "version":
      return `${app}-version = "99.0.0"\n`;
  }
};

// Plant: (m) read the flags before the files are checked.
it.effect.prop(
  "F11 a fault in the repo file or the user file, a newer minimum version included, is the one error of a start that also holds a refused flag",
  { input: FlagFault },
  ({ input: { app, entries, word, at } }) =>
    Effect.gen(function* () {
      const target = entries[0] ?? { table: "net", key: "port", seed: 5000 };

      const group = makeGroup(
        app,
        entries.map((entry) => declare(named(entry))),
      );

      const reached = new Set<number>();

      const run = Effect.fnUntraced(function* (n: number) {
        const { repo, user } = FAULTS[n] ?? { repo: undefined, user: undefined };
        reached.add(n);

        const { exit } = yield* start(group, {
          disk: {
            files: {
              [repoFile(app).path]: repo === undefined ? "" : faulty(app, target, repo),
              [userFile(app).path]: user === undefined ? "" : faulty(app, target, user),
            },
          },
          flags: { [named(target)]: Option.some(word) },
        });

        const error = seen(exit);
        const wantFile = repo !== undefined ? repoFile(app).name : userFile(app).name;
        const wantReason = repo !== undefined ? (repo === "version" ? "version" : repo) : (user ?? "none");

        expect({ reason: error.reason, file: error.file }, `${repo ?? "none"} and ${user ?? "none"}`).toEqual({
          reason: wantReason,
          file: wantFile,
        });
      });

      yield* run(at);

      // Every pair of faults is reached in each run.
      for (const n of FAULTS.keys()) {
        yield* run(n);
      }

      expect(reached.size).toBe(FAULTS.length);

      // The control: with both files clean, the same refused flag is the one error, so the flag is in play above.
      const clean = seen(
        (yield* start(group, { disk: { files: {} }, flags: { [named(target)]: Option.some(word) } })).exit,
      );

      expect(clean.reason).toBe("invalid");
      expect(mentions(clean.message, `--${named(target)}`), clean.message).toBe(true);
    }),
  check,
);

// ---------------------------------------------------------------------------------------------
// F12, a flag Effect's runner would take is refused
// ---------------------------------------------------------------------------------------------

/** The names and aliases of the flags Effect's runner reads before a command's own, from its own read of a command. */
const KEPT: ReadonlyArray<string> = Option.getOrThrow(CommandSpec.resolve(Command.make("x"), ["x"])).flags.flatMap(
  (flag) => (flag.scope._tag === "Global" ? [flag.name, ...flag.aliases] : []),
);

const OneWord = Schema.Union([Word, Schema.Literals(KEPT)]);

const Fresh = Word.check(Schema.makeFilter((text) => !KEPT.includes(text)));

// Plant: (l) drop the check, so a setting named `help` gets a flag the runner never passes on.
it.effect.prop(
  "F12 `flags` throws an `Error` naming a setting whose name is one of the runner's own flags or aliases, and makes the flags of any other one-word name",
  { app: Word, word: OneWord, fresh: Fresh },
  ({ app, word, fresh }) =>
    Effect.gen(function* () {
      // The runner keeps names: the check below is not about nothing.
      expect(KEPT.length).toBeGreaterThan(0);

      const reached = new Set<string>();

      for (const name of [...KEPT, word, fresh]) {
        const group = makeGroup(app, [declare(name)]);
        const message = yield* thrown(() => SettingGroup.flags(group));
        reached.add(KEPT.includes(name) ? "kept" : "free");

        if (KEPT.includes(name)) {
          expect(message ?? "it made flags", name).toContain(name);
        } else {
          expect(message, name).toBeUndefined();
          expect(Object.keys(SettingGroup.flags(group)), name).toEqual([name]);
        }
      }

      expect(reached.size).toBe(2);
    }),
  check,
);
