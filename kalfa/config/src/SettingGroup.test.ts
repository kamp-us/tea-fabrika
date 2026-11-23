// Ticket 1839, kalfa/config (new work): B1 to B15 of the approved plan (.kalfa/quests/kalfa-config-declare-PLAN.md),
// for `Setting` (Declaration.ts) and `SettingGroup` (SettingGroup.ts), read through the package's root entry (index.ts).
// Written before the modules. The type laws T1 to T5 are in SettingGroup.types.test.ts, R1 is in
// SettingGroup.integration.test.ts.
//
// What the start does, as these laws hold it to (the plan's "The start"):
// - `SettingGroup.layer(group, { version, repo })` reads `<repo>/.<app>/<app>.toml` (named `.<app>/<app>.toml`), checks
//   its minimum version `<app>-version`, checks the whole repo file, then reads the user file (`$<APP>_HOME/<app>.toml`
//   named `$<APP>_HOME/<app>.toml`, else `$HOME/.<app>/<app>.toml` named `~/.<app>/<app>.toml`, else none) and checks it
//   whole. Only then does it resolve each setting: environment variable, repo file, user file, default.
// - It fails with exactly one `SettingsError { reason, message, file?, line? }`. A missing file counts as empty.
// - `yield* group` gives the values by field (the last word of the name, hyphens joined). `SettingGroup.origins(group)`
//   gives each value's `Origin` by setting name.
// - The environment and `HOME` come from Effect's current `ConfigProvider`, which a law sets with `ConfigProvider.layer`.
//
// Each law is a property over generated inputs; B7 and B11 are scenarios, as the plan says. The files live in
// MemoryFiles.test-support.ts, which R1 checks against a real temp folder.
import { describe, expect, it } from "@effect/vitest";
import { Recorder, runsFor } from "@kampus/vitest";
import {
  Cause,
  ConfigProvider,
  Effect,
  Exit,
  FileSystem,
  Layer,
  Logger,
  Match,
  Path,
  PlatformError,
  Predicate,
  References,
  Schema,
  SchemaGetter,
  SubscriptionRef,
  Tracer,
} from "effect";
import { Setting, SettingGroup } from "./index.ts";
import * as MemoryFiles from "./MemoryFiles.test-support.ts";

const check = { arbitrary: { runs: runsFor({ fast: 25, full: 100 }), size: 100 } };

const Port = Schema.Int.check(Schema.isBetween({ minimum: 1, maximum: 65535 }));

const DEFAULT = 18787;

const ROOT = "/work";

const HOME = "/people/one";

const VERSION = "1.2.3";

// ---------------------------------------------------------------------------------------------
// Generated names. A message may say `instance` and `person` only of what a program declared, so a generated word
// never holds either: B15 reads them as the words the start must not use.
// ---------------------------------------------------------------------------------------------

const WORDS_NOT_USED = ["person", "instance"];

const clean = Schema.makeFilter((text: string) => WORDS_NOT_USED.every((word) => !text.includes(word)));

const Word = Schema.String.check(Schema.isPattern(/^[a-z][a-z0-9]{3,7}$/u), clean);

const Table = Schema.String.check(Schema.isPattern(/^[a-z]{1,6}(-[a-z]{1,4})?$/u), clean);

const Key = Schema.String.check(Schema.isPattern(/^[a-z]{2,6}(-[a-z]{1,4})?$/u), clean);

/** A key with no hyphen, long enough to take two edits and stay a key. */
const PlainKey = Schema.String.check(Schema.isPattern(/^[a-z]{4,6}$/u), clean);

const Seed = Schema.Int.check(
  Schema.isBetween({ minimum: 1000, maximum: 60000 }),
  Schema.makeFilter((n) => Math.abs(n - DEFAULT) > 2),
);

const Entry = Schema.Struct({ table: Table, key: Key, seed: Seed });

type Entry = typeof Entry.Type;

const PlainEntry = Schema.Struct({ table: Table, key: PlainKey, seed: Seed });

type PlainEntry = typeof PlainEntry.Type;

interface Named {
  readonly table: string;
  readonly key: string;
}

/** The name a person writes: `delivery.carry-rule`. */
const named = (entry: Named) => `${entry.table}.${entry.key}`;

/** The field a value has: the last word of the name, hyphens joined, so `carry-rule` is `carryRule`. */
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

const Trio = Schema.Tuple([PlainEntry, PlainEntry, PlainEntry]).check(Schema.makeFilter((entries) => apart(entries)));

const Pair = Schema.Tuple([Entry, Entry]).check(Schema.makeFilter((entries) => apart(entries)));

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

const declare = (name: string, options: Options = {}) => {
  const described = Setting.make(name, Port).pipe(Setting.withDescription("A port."));
  const given = options.required === true ? described : described.pipe(Setting.withDefault(DEFAULT));
  const scoped = options.files === undefined ? given : given.pipe(Setting.files(options.files));
  const locked = options.fileOnly === true ? scoped.pipe(Setting.fileOnly) : scoped;

  return options.live === true ? locked.pipe(Setting.live) : locked;
};

const makeGroup = (app: string, settings: ReadonlyArray<Setting.Any>) => SettingGroup.make(app, ...settings);

type Group = ReturnType<typeof makeGroup>;

interface Place {
  /** The path the program reads the file from. */
  readonly path: string;
  /** The name a person reads. */
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

const comments = (pad: number) => Array.from({ length: pad }, (_, n) => `# note ${n}\n`).join("");

interface Scene {
  readonly disk: MemoryFiles.Disk;
  /** The whole environment: the law adds `HOME` when it wants one. */
  readonly env?: Readonly<Record<string, string>>;
  readonly version?: string;
}

/** The reasons a read may fail for other than a missing file. */
const Denied = Schema.Literals(["PermissionDenied", "Busy", "Unknown"]);

/** The error a disk answers in place of a file's text. */
const denial = (tag: typeof Denied.Type, path: string) =>
  PlatformError.systemError({ _tag: tag, module: "FileSystem", method: "readFileString", pathOrDescriptor: path });

/** The in-memory file system, watched: every call is recorded, and `touched` reads the paths back. */
const watched = (disk: MemoryFiles.Disk) =>
  Layer.merge(Recorder.layer(FileSystem.FileSystem, MemoryFiles.make(disk)), Path.layer);

const touched = Effect.map(Recorder.calls(FileSystem.FileSystem), (calls) =>
  calls.flatMap((call) => {
    const path = call.args[0];

    return Predicate.isString(path) ? [path] : [];
  }),
);

const environment = (vars: Readonly<Record<string, string>> = {}) => ({ HOME, ...vars });

/** The start on a scene: the exit, the paths the file system was asked about, the spans and the log lines. */
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

  return Effect.gen(function* () {
    const exit = yield* Effect.gen(function* () {
      const values = yield* group;
      const origins = yield* SettingGroup.origins(group);

      return { values, origins };
    }).pipe(Effect.provide(SettingGroup.layer(group, { version: scene.version ?? VERSION, repo: ROOT })), Effect.exit);

    const reads = yield* touched;

    return { exit, reads, spans, logs };
  }).pipe(
    Effect.provide(
      Layer.merge(
        watched(scene.disk),
        ConfigProvider.layer(ConfigProvider.fromEnv({ env: { ...(scene.env ?? environment()) } })),
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

const mustStart = (exit: Exit.Exit<{ values: Record<string, unknown>; origins: Record<string, unknown> }, unknown>) => {
  expect(seen(exit).reason).toBe("started");

  if (Exit.isFailure(exit)) {
    return { values: {}, origins: {} };
  }

  return exit.value;
};

const escaped = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");

/** Whether a message names `name` as a whole name, not as the start of a longer one. */
const mentions = (text: string, name: string) =>
  new RegExp(`(?<![a-z0-9.-])${escaped(name)}(?![a-z0-9-]|\\.[a-z0-9])`, "u").test(text);

/** Whether a message names the repo file, not the user file whose name ends the same way. */
const namesRepo = (text: string, app: string) => new RegExp(`(?<!~/)${escaped(`.${app}/${app}.toml`)}`, "u").test(text);

/** Every form a secret may take in text: raw, JSON-escaped and URL-encoded. */
const forms = (secret: string) => [secret, JSON.stringify(secret).slice(1, -1), encodeURIComponent(secret)];

// A secret-looking word, with a character that changes in JSON and in a URL.
const Hidden = Schema.String.check(Schema.isPattern(/^sk-([A-Za-z0-9]{6,12})["/ +\\&][A-Za-z0-9]{3}$/u));

/** Whether a field is a live setting's reading, an Effect to yield. */
const isReading = (field: unknown): field is Effect.Effect<unknown> => Effect.isEffect(field);

/** The `Origin` of a value in a file. */
const inFile = (file: string, line: number) => ({ _tag: "file", file, line });

// ---------------------------------------------------------------------------------------------
// B1, precedence and origin
// ---------------------------------------------------------------------------------------------

const PLACES = ["none", "env", "repo", "user", "env+repo", "env+user", "repo+user", "env+repo+user"] as const;

type Placement = (typeof PLACES)[number];

const Placed = Schema.Literals(PLACES);

/** Each source holds its own value: the environment `seed`, the repo file `seed + 1`, the user file `seed + 2`. */
const precedence = Effect.fnUntraced(function* (
  app: string,
  entries: ReadonlyArray<Entry>,
  places: ReadonlyArray<Placement>,
  reached: Set<Placement>,
) {
  const group = makeGroup(
    app,
    entries.map((entry) => declare(named(entry))),
  );

  const env: Record<string, string> = {};
  const repo: Array<{ entry: Named; raw: string }> = [];
  const user: Array<{ entry: Named; raw: string }> = [];

  entries.forEach((entry, n) => {
    const held = (places[n] ?? "none").split("+");
    reached.add(places[n] ?? "none");

    if (held.includes("env")) {
      env[variable(app, entry)] = String(entry.seed);
    }

    if (held.includes("repo")) {
      repo.push({ entry, raw: String(entry.seed + 1) });
    }

    if (held.includes("user")) {
      user.push({ entry, raw: String(entry.seed + 2) });
    }
  });

  const files = { repo: toml(1, repo), user: toml(2, user) };

  const { exit } = yield* start(group, {
    disk: {
      files: {
        [repoFile(app).path]: files.repo.text,
        [userFile(app).path]: files.user.text,
      },
    },
    env: environment(env),
  });

  const loaded = mustStart(exit);

  entries.forEach((entry, n) => {
    const held = (places[n] ?? "none").split("+");

    const want = held.includes("env")
      ? { value: entry.seed, origin: { _tag: "env", name: variable(app, entry) } }
      : held.includes("repo")
        ? { value: entry.seed + 1, origin: inFile(repoFile(app).name, files.repo.at[named(entry)] ?? -1) }
        : held.includes("user")
          ? { value: entry.seed + 2, origin: inFile(userFile(app).name, files.user.at[named(entry)] ?? -1) }
          : { value: DEFAULT, origin: { _tag: "default" } };

    expect({ value: loaded.values[field(entry)], origin: loaded.origins[named(entry)] }).toEqual(want);
  });
});

// Plants: (a) chain the user file before the repo file; (b) take the origin from the last source that holds the key.
it.effect.prop(
  "B1 each value is the first of environment, repo file and user file that holds it, else its default, and its origin names that source",
  { app: Word, entries: Entries, picks: Schema.Tuple([Placed, Placed, Placed, Placed]) },
  ({ app, entries, picks }) =>
    Effect.gen(function* () {
      const reached = new Set<Placement>();
      yield* precedence(app, entries, picks, reached);

      // Every placement is reached in each run, in every setting.
      for (const place of PLACES) {
        yield* precedence(
          app,
          entries,
          entries.map(() => place),
          reached,
        );
      }

      expect([...reached].sort()).toEqual([...PLACES].sort());
    }),
  check,
);

// ---------------------------------------------------------------------------------------------
// B1, a table-valued setting comes whole from the one source that holds it
// ---------------------------------------------------------------------------------------------

const Pairing = Schema.Struct({ a: Schema.optionalKey(Schema.Int), b: Schema.optionalKey(Schema.Int) });

const Nesting = Schema.Struct({ inner: Schema.optionalKey(Pairing) });

const Shape = Schema.Literals(["flat", "nested"]);

/** What one file holds of the setting's table: nothing, the table with no key, or the table with these keys. */
const Contents = Schema.Literals(["none", "empty", "a", "b", "ab"]);

type Content = typeof Contents.Type;

const CONTENTS: Readonly<Record<Content, ReadonlyArray<"a" | "b">>> = {
  none: [],
  empty: [],
  a: ["a"],
  b: ["b"],
  ab: ["a", "b"],
};

/** One file: `pad` comment lines, then the table of the setting, with the line its header sits on. A key's value is `base` for `a` and `base + 2` for `b`. */
const tabled = (pad: number, shape: typeof Shape.Type, entry: Named, content: Content, base: number) => {
  const lines = Array.from({ length: pad }, (_, n) => `# note ${n}`);

  if (content === "none") {
    return { text: `${lines.join("\n")}\n`, line: undefined, value: undefined };
  }

  lines.push(`[${named(entry)}]`);
  const line = lines.length;
  const keys = CONTENTS[content];

  if (shape === "nested" && content !== "empty") {
    lines.push(`[${named(entry)}.inner]`);
  }

  const fields = {
    ...(keys.some((key) => key === "a") ? { a: base } : {}),
    ...(keys.some((key) => key === "b") ? { b: base + 2 } : {}),
  };

  for (const [key, value] of Object.entries(fields)) {
    lines.push(`${key} = ${value}`);
  }

  return {
    text: `${lines.join("\n")}\n`,
    line,
    value: shape === "flat" || content === "empty" ? fields : { inner: fields },
  };
};

// Plants: (a) decode the value through the chain of every source, as the reviewed head did, so a key the stronger file
// leaves out is filled from the weaker one; (b) fill each key the holder lacks from the other file.
it.effect.prop(
  "B1 a table-valued setting, placed partly in each file, comes whole from the stronger file that holds the table, with its origin, else whole from its default",
  { app: Word, entry: Entry, shape: Shape, pad: Schema.Int.check(Schema.isBetween({ minimum: 0, maximum: 3 })) },
  ({ app, entry, shape, pad }) =>
    Effect.gen(function* () {
      const fallback = shape === "flat" ? { a: DEFAULT } : { inner: { a: DEFAULT } };

      const setting =
        shape === "flat"
          ? Setting.make(named(entry), Pairing).pipe(Setting.withDescription("A pair."), Setting.withDefault(fallback))
          : Setting.make(named(entry), Nesting).pipe(Setting.withDescription("A pair."), Setting.withDefault(fallback));

      const group = makeGroup(app, [setting]);
      const reached = new Set<string>();

      // Every pair of contents is reached in each run, in this shape.
      for (const repo of Contents.literals) {
        for (const user of Contents.literals) {
          reached.add(`${repo}+${user}`);

          const files = {
            repo: tabled(pad + 1, shape, entry, repo, entry.seed + 1),
            user: tabled(pad + 2, shape, entry, user, entry.seed + 2),
          };

          const { exit } = yield* start(group, {
            disk: { files: { [repoFile(app).path]: files.repo.text, [userFile(app).path]: files.user.text } },
            env: environment(),
          });

          const loaded = mustStart(exit);

          const want =
            files.repo.line !== undefined
              ? { value: files.repo.value, origin: inFile(repoFile(app).name, files.repo.line) }
              : files.user.line !== undefined
                ? { value: files.user.value, origin: inFile(userFile(app).name, files.user.line) }
                : { value: fallback, origin: { _tag: "default" } };

          expect(
            { value: loaded.values[field(entry)], origin: loaded.origins[named(entry)] },
            `${repo}+${user}`,
          ).toEqual(want);
        }
      }

      expect(reached.size).toBe(Contents.literals.length ** 2);
    }),
  check,
);

// ---------------------------------------------------------------------------------------------
// B2, the minimum version comes first
// ---------------------------------------------------------------------------------------------

const Triple = Schema.Tuple([
  Schema.Int.check(Schema.isBetween({ minimum: 0, maximum: 20 })),
  Schema.Int.check(Schema.isBetween({ minimum: 0, maximum: 20 })),
  Schema.Int.check(Schema.isBetween({ minimum: 0, maximum: 20 })),
]);

type Triple = typeof Triple.Type;

const dotted = ([x, y, z]: Triple) => `${x}.${y}.${z}`;

const later = (wanted: Triple, running: Triple) =>
  wanted[0] !== running[0]
    ? wanted[0] > running[0]
    : wanted[1] !== running[1]
      ? wanted[1] > running[1]
      : wanted[2] > running[2];

const Garbage = Schema.Struct({
  kind: Schema.Literals(["word", "integer", "list", "partial"]),
  word: Schema.String.check(Schema.isPattern(/^[a-z]{3,8}$/u)),
  n: Schema.Int.check(Schema.isBetween({ minimum: 0, maximum: 99 })),
});

const garbage = ({ kind, word, n }: typeof Garbage.Type) =>
  Match.value(kind).pipe(
    Match.when("word", () => JSON.stringify(word)),
    Match.when("integer", () => String(n)),
    Match.when("list", () => `["${word}"]`),
    Match.orElse(() => `"${n}.${n}"`),
  );

/** The repo file holds `<app>-version = raw` on line `pad + 1`, the user file does not parse and holds the only value. */
const versioned = Effect.fnUntraced(function* (
  app: string,
  pad: number,
  raw: string,
  version: string,
  want: "version" | "invalid" | "started",
) {
  const entry = { table: "net", key: "port" };
  const group = makeGroup(app, [declare(named(entry))]);
  const repo = `${comments(pad)}${app}-version = ${raw}\n`;
  const user = want === "started" ? "[net]\nport = 4100\n" : "[net\nport = }\n";

  const { exit, reads } = yield* start(group, {
    disk: { files: { [repoFile(app).path]: repo, [userFile(app).path]: user } },
    version,
  });

  const error = seen(exit);
  expect(error.reason).toBe(want);

  if (want === "started") {
    const loaded = mustStart(exit);
    expect(loaded.values["port"]).toBe(4100);
    expect(reads).toContain(userFile(app).path);

    return;
  }

  // The refusal names the repo file and the line the version is on.
  expect(error.file).toBe(repoFile(app).name);
  expect(error.line).toBe(pad + 1);
  // The user configuration was never read, though it does not parse.
  expect(reads).not.toContain(userFile(app).path);
  expect(reads).toContain(repoFile(app).path);
});

// Plant: read the user configuration before the version check.
it.effect.prop(
  "B2 a newer minimum version fails `version` at its line and never reads the user file; an older, an equal one starts; one that is no version fails `invalid`",
  {
    app: Word,
    pad: Schema.Int.check(Schema.isBetween({ minimum: 0, maximum: 4 })),
    running: Triple,
    wanted: Triple,
    junk: Garbage,
  },
  ({ app, pad, running, wanted, junk }) =>
    Effect.gen(function* () {
      const reached = new Set<string>();

      const attempt = (given: Triple) => {
        const newer = later(given, running);
        reached.add(newer ? "newer" : "not newer");

        return versioned(app, pad, JSON.stringify(dotted(given)), dotted(running), newer ? "version" : "started");
      };

      yield* attempt(wanted);
      // The two edges: the very same version starts, and one patch newer is refused.
      yield* attempt(running);
      yield* attempt([running[0], running[1], running[2] + 1]);
      // A value that is no version is refused as invalid, whatever the user file holds.
      yield* versioned(app, pad, garbage(junk), dotted(running), "invalid");

      expect([...reached].sort()).toEqual(["newer", "not newer"]);
    }),
  check,
);

// ---------------------------------------------------------------------------------------------
// B3 and B15, one error in order, and the words of every error
// ---------------------------------------------------------------------------------------------

const RepoFault = Schema.Literals(["none", "syntax", "version", "unknown", "scope", "invalid", "read"]);

const UserFault = Schema.Literals(["none", "syntax", "unknown", "scope", "scope-version", "invalid", "read"]);

const EnvFault = Schema.Literals(["none", "invalid", "missing"]);

const FaultCase = Schema.Struct({
  app: Word,
  repo: RepoFault,
  user: UserFault,
  env: EnvFault,
  pad: Schema.Int.check(Schema.isBetween({ minimum: 0, maximum: 4 })),
  denied: Denied,
}).check(Schema.makeFilter((c) => c.repo !== "none" || c.user !== "none" || c.env !== "none"));

type FaultCase = typeof FaultCase.Type;

const NET = { table: "net", key: "port" };

const LOCK = { table: "lock", key: "rule" };

const MINE = { table: "mine", key: "theme" };

const NEED = { table: "need", key: "thing" };

/** One group of four: a both-files setting, a repo-only one, a user-only one and a required one. */
const faultGroup = (app: string) =>
  makeGroup(app, [
    declare(named(NET)),
    declare(named(LOCK), { files: ["repo"] }),
    declare(named(MINE), { files: ["user"] }),
    declare(named(NEED), { required: true }),
  ]);

/** The text of a file with one fault, the reason it must fail with, and the line it must name. */
const faulty = (fault: string, pad: number, app: string) => {
  const at = (text: string, line: number) => ({ text: `${comments(pad)}${text}`, line: pad + line });

  switch (fault) {
    case "syntax":
      return { ...at("[net]\nport = }\n", 2), reason: "syntax" };
    case "version":
      return { ...at(`${app}-version = "9.9.9"\n`, 1), reason: "version" };
    case "unknown":
      return { ...at("[zzzzz]\nkeykey = 1\n", 2), reason: "unknown" };
    case "scope":
      return { ...at("[mine]\ntheme = 4000\n", 2), reason: "scope" };
    case "repo-scope":
      return { ...at("[lock]\nrule = 4000\n", 2), reason: "scope" };
    case "scope-version":
      return { ...at(`${app}-version = "1.0.0"\n`, 1), reason: "scope" };
    case "invalid":
      return { ...at("[net]\nport = 0\n", 2), reason: "invalid" };
    default:
      return { ...at("[net]\nport = 4000\n", 2), reason: "started" };
  }
};

/** Runs a start with the faults of a case. The first fault in the order repo file, user file, environment is the one. */
const faulted = Effect.fnUntraced(function* (given: FaultCase) {
  const { app } = given;
  const repo = faulty(given.repo, given.pad, app);
  const user = faulty(given.user === "scope" ? "repo-scope" : given.user, given.pad, app);

  const env: Record<string, string> = { [variable(app, NEED)]: "4000" };

  if (given.env === "invalid") {
    env[variable(app, NET)] = "notaport";
  }

  if (given.env === "missing") {
    delete env[variable(app, NEED)];
  }

  const broken: Record<string, PlatformError.PlatformError> = {};

  if (given.repo === "read") {
    broken[repoFile(app).path] = denial(given.denied, repoFile(app).path);
  }

  if (given.user === "read") {
    broken[userFile(app).path] = denial(given.denied, userFile(app).path);
  }

  const { exit } = yield* start(faultGroup(app), {
    disk: { files: { [repoFile(app).path]: repo.text, [userFile(app).path]: user.text }, broken },
    env: environment(env),
  });

  const error = seen(exit);

  if (given.repo !== "none") {
    return {
      error,
      want: {
        reason: given.repo === "read" ? "read" : repo.reason,
        file: repoFile(app).name,
        line: given.repo === "read" ? undefined : repo.line,
      },
    };
  }

  if (given.user !== "none") {
    return {
      error,
      want: {
        reason: given.user === "read" ? "read" : user.reason,
        file: userFile(app).name,
        line: given.user === "read" ? undefined : user.line,
      },
    };
  }

  return { error, want: { reason: given.env === "missing" ? "missing" : "invalid", file: undefined, line: undefined } };
});

// Plant: check the user configuration before the repo configuration.
it.effect.prop(
  "B3 faults in the repo file, the user file and the environment at once fail with one error, the repo file's first, then the user file's, then the environment's",
  { input: FaultCase },
  ({ input }) =>
    Effect.gen(function* () {
      const { error, want } = yield* faulted(input);
      expect(error.reason).toBe(want.reason);

      if (input.repo !== "none" || input.user !== "none") {
        expect(error.file).toBe(want.file);

        if (want.line !== undefined) {
          expect(error.line).toBe(want.line);
        }
      } else {
        // The environment's fault names the variable, in no file.
        expect(error.file).not.toBe(repoFile(input.app).name);
        expect(error.file).not.toBe(userFile(input.app).name);
        expect(error.message).toContain(variable(input.app, input.env === "missing" ? NEED : NET));
      }
    }),
  check,
);

// Plant: end the messages with today's `Files.STOP`, "The instance did not start."
it.effect.prop(
  "B15 every message ends with `<app> did not start.` and says neither `person` nor `instance`",
  { input: FaultCase },
  ({ input }) =>
    Effect.gen(function* () {
      const { error } = yield* faulted(input);
      expect(error.message.endsWith(`${input.app} did not start.`)).toBe(true);
      expect(error.message.toLowerCase()).not.toContain("person");
      expect(error.message.toLowerCase()).not.toContain("instance");
    }),
  check,
);

// ---------------------------------------------------------------------------------------------
// B4, a mistyped key stops the start
// ---------------------------------------------------------------------------------------------

/** Both files, the repo file only, the user file only: a group of one of each. */
const SCOPES = [["repo", "user"], ["repo"], ["user"]] as const;

const Edit = Schema.Struct({
  op: Schema.Literals(["swap", "drop", "add", "change"]),
  at: Schema.Int.check(Schema.isBetween({ minimum: 0, maximum: 9 })),
  letter: Schema.String.check(Schema.isPattern(/^[a-z]$/u)),
});

type Edit = typeof Edit.Type;

/** One edit of a key. It always changes the key. */
const edit = (key: string, step: Edit) => {
  const i = step.at % key.length;
  const j = step.at % (key.length - 1);

  switch (step.op) {
    case "swap":
      return key[j] === key[j + 1]
        ? `${key.slice(0, j)}${key.slice(j + 1)}`
        : `${key.slice(0, j)}${key[j + 1]}${key[j]}${key.slice(j + 2)}`;
    case "add":
      return `${key.slice(0, i)}${step.letter}${key.slice(i)}`;
    case "change":
      return `${key.slice(0, i)}${step.letter === key[i] ? (step.letter === "a" ? "b" : "a") : step.letter}${key.slice(i + 1)}`;
    default:
      return `${key.slice(0, i)}${key.slice(i + 1)}`;
  }
};

/** A key at most two edits from `key`, never `key` itself. */
const typo = (key: string, first: Edit, second: Edit | undefined) => {
  const once = edit(key, first);
  const twice = second === undefined ? once : edit(once, second);

  return twice === key ? once : twice;
};

/** Edits from one name to another, a swap of two letters counting as one: what "within two edits" means. */
const distance = (a: string, b: string) => {
  const rows = Array.from({ length: a.length + 1 }, (_, i) => Array.from({ length: b.length + 1 }, (_, k) => i + k));
  const cell = (i: number, k: number) => rows[i]?.[k] ?? 0;

  for (let i = 1; i <= a.length; i++) {
    for (let k = 1; k <= b.length; k++) {
      const swap = i > 1 && k > 1 && a[i - 1] === b[k - 2] && a[i - 2] === b[k - 1] ? cell(i - 2, k - 2) + 1 : Infinity;
      const change = cell(i - 1, k - 1) + (a[i - 1] === b[k - 1] ? 0 : 1);
      rows[i]?.splice(k, 1, Math.min(cell(i - 1, k) + 1, cell(i, k - 1) + 1, change, swap));
    }
  }

  return cell(a.length, b.length);
};

const Digits = Schema.String.check(Schema.isPattern(/^[0-9]{5,8}$/u));

const TypoCase = Schema.Struct({
  app: Word,
  trio: Trio,
  first: Edit,
  second: Schema.UndefinedOr(Edit),
  far: Digits,
  pad: Schema.Int.check(Schema.isBetween({ minimum: 0, maximum: 4 })),
});

// Plants: guess among every setting, whatever file it may be set in; take the first guess in the group's order, not the nearest.
it.effect.prop(
  "B4 a key within two edits of a setting the file may set fails `unknown` at its line and names a guess among those; a key farther away names none",
  { input: TypoCase },
  ({ input: { app, trio, first, second, far, pad } }) =>
    Effect.gen(function* () {
      const specs = trio.map((entry, n) => ({ entry, files: SCOPES[n] ?? SCOPES[0] }));

      const group = makeGroup(
        app,
        specs.map(({ entry, files }) => declare(named(entry), { files })),
      );

      for (const [file, place] of [
        ["repo", repoFile(app)],
        ["user", userFile(app)],
      ] as const) {
        const within = specs.filter(({ files }) => files.some((f) => f === file));

        const attempt = Effect.fnUntraced(function* (table: string, key: string, near: ReadonlyArray<string>) {
          const text = `${comments(pad)}[${table}]\n${key} = 4000\n`;
          const disk = { files: { [(file === "repo" ? repoFile(app) : userFile(app)).path]: text } };
          const { exit } = yield* start(group, { disk });
          const error = seen(exit);

          expect(error.reason).toBe("unknown");
          expect(error.file).toBe(place.name);
          expect(error.line).toBe(pad + 2);

          const said = specs.map(({ entry }) => named(entry)).filter((name) => mentions(error.message, name));
          // A guess is never a setting this file may not set, nor one more than two edits away.
          expect(said.every((name) => near.includes(name))).toBe(true);
          // And a setting within two edits that this file may set is named.
          expect(said.length > 0).toBe(near.length > 0);
        });

        for (const { entry } of specs) {
          const mistyped = typo(entry.key, first, second);
          const path = `${entry.table}.${mistyped}`;

          yield* attempt(
            entry.table,
            mistyped,
            within.map(({ entry: other }) => named(other)).filter((name) => distance(name, path) <= 2),
          );
        }

        yield* attempt(far, far, []);

        // Two settings one edit apart in one table: the typed key is one edit from the longer name and two from the shorter,
        // so the guess is the longer, whichever of the two is declared first.
        const [one] = trio;

        if (one !== undefined) {
          const short = `${one.table}.${one.key}`;
          const long = `${short}z`;

          for (const names of [
            [short, long],
            [long, short],
          ]) {
            const pair = makeGroup(
              app,
              names.map((name) => declare(name, { files: ["repo", "user"] })),
            );

            const text = `[${one.table}]\n${one.key}zz = 4000\n`;
            const { exit } = yield* start(pair, { disk: { files: { [place.path]: text } } });
            const error = seen(exit);

            expect(error.reason).toBe("unknown");
            expect(error.message, `declared as ${names.join(", ")}`).toContain(`Did you mean ${long}?`);
            expect(error.message, `declared as ${names.join(", ")}`).not.toContain(`Did you mean ${short}?`);
          }
        }
      }
    }),
  check,
);

// ---------------------------------------------------------------------------------------------
// B5, file scope
// ---------------------------------------------------------------------------------------------

const ScopeCase = Schema.Struct({
  app: Word,
  pair: Pair,
  fileOnlyRepo: Schema.Boolean,
  fileOnlyUser: Schema.Boolean,
  pad: Schema.Int.check(Schema.isBetween({ minimum: 0, maximum: 4 })),
});

// Plant: build each file's schema from every setting, whatever file it may be set in.
it.effect.prop(
  "B5 a setting found in a file outside its file scope fails `scope` at that file and line, naming where it may be set, and `<app>-version` in the user file is a scope error too",
  { input: ScopeCase },
  ({ input: { app, pair, fileOnlyRepo, fileOnlyUser, pad } }) =>
    Effect.gen(function* () {
      const [repoSetting, userSetting] = pair;

      const group = makeGroup(app, [
        declare(named(repoSetting), { files: ["repo"], fileOnly: fileOnlyRepo }),
        declare(named(userSetting), { files: ["user"], fileOnly: fileOnlyUser }),
      ]);

      const attempt = Effect.fnUntraced(function* (found: "repo" | "user", text: string, line: number) {
        const files = { [(found === "repo" ? repoFile(app) : userFile(app)).path]: `${comments(pad)}${text}` };
        const { exit } = yield* start(group, { disk: { files } });
        const error = seen(exit);

        expect(error.reason).toBe("scope");
        expect(error.file).toBe((found === "repo" ? repoFile(app) : userFile(app)).name);
        expect(error.line).toBe(pad + line);

        return error.message;
      });

      // A repo-only setting in the user file: it may be set in the repo file, or by its variable.
      const inUser = yield* attempt("user", `[${repoSetting.table}]\n${repoSetting.key} = 4000\n`, 2);
      expect(namesRepo(inUser, app)).toBe(true);
      expect(inUser.includes(variable(app, repoSetting))).toBe(!fileOnlyRepo);

      // A user-only setting in the repo file: it may be set in the user file, or by its variable.
      const inRepo = yield* attempt("repo", `[${userSetting.table}]\n${userSetting.key} = 4000\n`, 2);
      expect(inRepo).toContain(userFile(app).name);
      expect(inRepo.includes(variable(app, userSetting))).toBe(!fileOnlyUser);

      // The minimum version is the repo file's alone.
      const version = yield* attempt("user", `${app}-version = "1.0.0"\n`, 1);
      expect(namesRepo(version, app)).toBe(true);
    }),
  check,
);

// ---------------------------------------------------------------------------------------------
// B6, a refused value never becomes the default
// ---------------------------------------------------------------------------------------------

const Refusal = Schema.Struct({
  kind: Schema.Literals(["low", "high", "word", "empty-list", "empty-table", "list", "float", "flag"]),
  n: Schema.Int.check(Schema.isBetween({ minimum: 1, maximum: 1000 })),
  word: Schema.String.check(Schema.isPattern(/^[a-z]{1,8}$/u)),
});

/** A value the port schema refuses, as TOML text and as an environment string. */
const refused = ({ kind, n, word }: typeof Refusal.Type) => {
  switch (kind) {
    case "low":
      return { raw: String(-n), text: String(-n) };
    case "high":
      return { raw: String(65535 + n), text: String(65535 + n) };
    case "word":
      return { raw: JSON.stringify(word), text: word };
    case "empty-list":
      return { raw: "[]", text: "[]" };
    case "empty-table":
      return { raw: "{}", text: "{}" };
    case "list":
      return { raw: `[${n}]`, text: `[${n}]` };
    case "float":
      return { raw: `${n}.5`, text: `${n}.5` };
    default:
      return { raw: "true", text: "true" };
  }
};

const RefusedCase = Schema.Struct({
  app: Word,
  entries: Entries,
  junk: Refusal,
  pad: Schema.Int.check(Schema.isBetween({ minimum: 0, maximum: 4 })),
  lower: Schema.Boolean,
});

// Plant: fall back to the default on any decode failure.
it.effect.prop(
  "B6 a value its schema refuses, in a file or in the environment, fails `invalid` naming where it was and never becomes the default",
  { input: RefusedCase },
  ({ input: { app, entries, junk, pad, lower } }) =>
    Effect.gen(function* () {
      const [target] = entries;

      if (target === undefined) {
        return;
      }

      const group = makeGroup(
        app,
        entries.map((entry) => declare(named(entry))),
      );

      const { raw, text } = refused(junk);
      const valid = String(target.seed);

      for (const place of ["repo", "user", "env"] as const) {
        // The source below the refused one holds a good value, or nothing: either way the refusal stands.
        const files: Record<string, string> = {
          [repoFile(app).path]: place === "repo" ? toml(pad, [{ entry: target, raw }]).text : "",
          [userFile(app).path]:
            place === "user"
              ? toml(pad, [{ entry: target, raw }]).text
              : lower && place === "env"
                ? toml(pad, [{ entry: target, raw: valid }]).text
                : "",
        };

        const env = place === "env" ? { [variable(app, target)]: text } : {};
        const { exit } = yield* start(group, { disk: { files }, env: environment(env) });
        const error = seen(exit);

        expect(error.reason).toBe("invalid");

        if (place === "env") {
          expect(error.message).toContain(variable(app, target));
        } else {
          expect(error.file).toBe((place === "repo" ? repoFile(app) : userFile(app)).name);
          expect(error.line).toBe(pad + 2);
        }
      }
    }),
  check,
);

// ---------------------------------------------------------------------------------------------
// B7, a required setting (scenario)
// ---------------------------------------------------------------------------------------------

// Plant: give a required setting `undefined` when it is absent.
it.effect(
  "B7 scenario: a required setting with no source fails `missing`, naming it, its variable and its files, and reads from any one source",
  () =>
    Effect.gen(function* () {
      const app = "demo";
      const entry = { table: "must", key: "have" };
      const both = makeGroup(app, [declare(named(entry), { required: true })]);
      const onlyUser = makeGroup(app, [declare(named(entry), { required: true, files: ["user"] })]);

      const absent = yield* start(both, { disk: { files: {} } });
      const lacking = seen(absent.exit);
      expect(lacking.reason).toBe("missing");
      expect(lacking.message).toContain(named(entry));
      expect(lacking.message).toContain(variable(app, entry));
      expect(namesRepo(lacking.message, app)).toBe(true);
      expect(lacking.message).toContain(userFile(app).name);

      // A setting that only the user file may set names no repo file.
      const lackingUser = seen((yield* start(onlyUser, { disk: { files: {} } })).exit);
      expect(lackingUser.reason).toBe("missing");
      expect(lackingUser.message).toContain(userFile(app).name);
      expect(namesRepo(lackingUser.message, app)).toBe(false);

      const body = (raw: string) => toml(0, [{ entry, raw }]).text;

      const sources = [
        {
          name: "env",
          scene: { disk: { files: {} }, env: environment({ [variable(app, entry)]: "4001" }) },
          value: 4001,
        },
        { name: "repo", scene: { disk: { files: { [repoFile(app).path]: body("4002") } } }, value: 4002 },
        { name: "user", scene: { disk: { files: { [userFile(app).path]: body("4003") } } }, value: 4003 },
      ];

      for (const { scene, value } of sources) {
        const loaded = mustStart((yield* start(both, scene)).exit);
        expect(loaded.values[field(entry)]).toBe(value);
      }
    }),
);

// ---------------------------------------------------------------------------------------------
// B8, values stay out
// ---------------------------------------------------------------------------------------------

const HIDDEN = [
  "repo-unknown",
  "user-unknown",
  "repo-mistyped",
  "user-mistyped",
  "repo-table",
  "user-table",
  "repo-refused",
  "user-refused",
  "env-refused",
  "other-app",
] as const;

const HiddenCase = Schema.Struct({ app: Word, other: Word, secret: Hidden }).check(
  Schema.makeFilter((c) => !c.app.includes(c.other) && !c.other.includes(c.app)),
);

describe("B8 [secrets], values stay out", () => {
  for (const place of HIDDEN) {
    // Plants: print the unknown key's value in the message; print the value a known setting refuses in its `invalid`
    // message, once for a file's value and once for the environment's.
    it.effect.prop(
      `a secret under ${place} reaches no error message, cause, span attribute or log line, raw, escaped or encoded`,
      { input: HiddenCase },
      ({ input: { app, other, secret } }) =>
        Effect.gen(function* () {
          const group = makeGroup(app, [declare(named(NET))]);
          const quoted = JSON.stringify(secret);
          const [side, kind] = place.split("-");

          const body = Match.value(kind).pipe(
            Match.when("unknown", () => `[zzzzz]\nkeykey = ${quoted}\n`),
            Match.when("mistyped", () => `[net]\npotr = ${quoted}\n`),
            Match.when("table", () => `[net.port]\nnested = ${quoted}\n`),
            Match.when("refused", () => (side === "env" ? "" : `[net]\nport = ${quoted}\n`)),
            Match.orElse(() => ""),
          );

          const files: Record<string, string> = {
            [(side === "repo" ? repoFile(app) : userFile(app)).path]: body,
            // Another app's own files are never read.
            [`${ROOT}/.${other}/${other}.toml`]: `[net]\nport = ${quoted}\n`,
          };

          const env = Match.value(place).pipe(
            Match.when("other-app", () => ({ [`${other.toUpperCase()}_NET_PORT`]: secret })),
            Match.when("env-refused", () => ({ [variable(app, NET)]: secret })),
            Match.orElse(() => ({})),
          );

          const { exit, spans, logs } = yield* start(group, { disk: { files }, env: environment(env) });

          const span = spans.find((s) => s.name === "config.layer");
          // The span exists and names the app, so the check below is not about nothing.
          expect(span?.attributes.get("kalfa.config.app")).toBe(app);

          const outputs = [
            ...logs,
            ...spans.flatMap((s) => [...s.attributes.entries()].map(([k, v]) => `${k}=${String(v)}`)),
            ...spans.map((s) => s.name),
          ];

          if (Exit.isSuccess(exit)) {
            expect(place).toBe("other-app");
            outputs.push(JSON.stringify(exit.value.values), JSON.stringify(exit.value.origins));
          } else {
            const error = seen(exit);
            // A table where a value belongs is refused as one or the other, and a value the schema refuses is `invalid`;
            // every other secret sits under an unknown key.
            expect(
              place.endsWith("table") ? ["invalid", "unknown"] : place.endsWith("refused") ? ["invalid"] : ["unknown"],
            ).toContain(error.reason);
            outputs.push(error.printed);
          }

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
// B9, a group that cannot be read is refused at make
// ---------------------------------------------------------------------------------------------

const REFUSALS = ["app", "segment", "field", "variable", "table", "default", "description", "version", "home"] as const;

const Letters = Schema.String.check(Schema.isPattern(/^[a-z]{1,4}$/u), clean);

const Junk = Schema.Union([
  Schema.String.check(Schema.isPattern(/^[A-Z][a-z]{1,4}$/u)),
  Schema.String.check(Schema.isPattern(/^-[a-z]{1,4}$/u)),
  Schema.String.check(Schema.isPattern(/^[a-z]{1,3}_[a-z]{1,3}$/u)),
  Schema.Literal(""),
]);

const BadApp = Schema.Union([
  Schema.String.check(Schema.isPattern(/^[A-Z][a-z]{2,6}$/u)),
  Schema.String.check(Schema.isPattern(/^[a-z]{2,4}-[a-z]{2,4}$/u)),
  Schema.String.check(Schema.isPattern(/^[a-z]{2,4}\.[a-z]{2,4}$/u)),
  Schema.String.check(Schema.isPattern(/^[a-z]{2,4}_[a-z]{2,4}$/u)),
  Schema.String.check(Schema.isPattern(/^[0-9][a-z0-9]{2,6}$/u)),
]);

const BadGroup = Schema.Struct({
  app: Word,
  badApp: BadApp,
  good: Entries,
  one: Letters,
  two: Letters,
  three: Letters,
  junk: Junk,
}).check(Schema.makeFilter((c) => c.one !== c.two && c.two !== c.three && c.one !== c.three));

/** The message of what making a group throws, or `undefined` when it makes. */
const thrown = (make: () => unknown) =>
  Effect.try({ try: make, catch: (error) => (error instanceof Error ? error.message : String(error)) }).pipe(
    Effect.match({ onSuccess: () => undefined, onFailure: (message) => message }),
  );

// Plant: drop the one-field check, so two settings that end in `port` make a group.
it.effect.prop(
  "B9 each group that cannot be read throws an `Error` naming its settings at make, and a group that can makes",
  { input: BadGroup },
  ({ input: { app, badApp, good, one, two, three, junk } }) =>
    Effect.gen(function* () {
      const ok = (name: string) => declare(name);
      const noDescription = Setting.make(`${one}.${two}`, Port).pipe(Setting.withDefault(DEFAULT));

      const badDefault = Setting.make(`${one}.${two}`, Port).pipe(
        Setting.withDefault(0),
        Setting.withDescription("A port."),
      );

      const cases = {
        app: { names: badApp, thrown: yield* thrown(() => SettingGroup.make(badApp, ok(`${one}.${two}`))) },
        segment: {
          names: `${one}.${junk}`,
          thrown: yield* thrown(() => SettingGroup.make(app, ok(`${one}.${junk}`))),
        },
        field: {
          names: [`${one}.${three}`, `${two}.${three}`],
          thrown: yield* thrown(() => SettingGroup.make(app, ok(`${one}.${three}`), ok(`${two}.${three}`))),
        },
        variable: {
          names: [`${one}-${two}.${three}`, `${one}.${two}-${three}`],
          thrown: yield* thrown(() =>
            SettingGroup.make(app, ok(`${one}-${two}.${three}`), ok(`${one}.${two}-${three}`)),
          ),
        },
        table: {
          names: [`${one}.${two}`, `${one}.${two}.${three}`],
          thrown: yield* thrown(() => SettingGroup.make(app, ok(`${one}.${two}`), ok(`${one}.${two}.${three}`))),
        },
        default: { names: `${one}.${two}`, thrown: yield* thrown(() => SettingGroup.make(app, badDefault)) },
        description: { names: `${one}.${two}`, thrown: yield* thrown(() => SettingGroup.make(app, noDescription)) },
        version: { names: `${app}-version`, thrown: yield* thrown(() => SettingGroup.make(app, ok(`${app}-version`))) },
        home: { names: "home", thrown: yield* thrown(() => SettingGroup.make(app, ok("home"))) },
      };

      for (const refusal of REFUSALS) {
        const { names, thrown: message } = cases[refusal];
        expect(message, `${refusal} makes no group`).toBeDefined();

        for (const name of [names].flat()) {
          // An empty or unwritable app name has nothing to name.
          if (name.length > 0) {
            expect(message ?? "", `${refusal} names ${name}`).toContain(name);
          }
        }
      }

      expect(
        yield* thrown(() =>
          makeGroup(
            app,
            good.map((entry) => declare(named(entry))),
          ),
        ),
      ).toBeUndefined();
    }),
  check,
);

// ---------------------------------------------------------------------------------------------
// B10, a file-only setting skips the environment (ticket 1842: a variable that names it stops the start, so FO1 holds
// that case; here its variable is unset)
// ---------------------------------------------------------------------------------------------

const FileOnlyCase = Schema.Struct({
  app: Word,
  pair: Pair,
  place: Schema.Literals(["none", "repo", "user", "repo+user"]),
  pad: Schema.Int.check(Schema.isBetween({ minimum: 0, maximum: 4 })),
});

// Plant: read the environment for every setting.
it.effect.prop(
  "B10 a file-only setting reads from the files or its default and its origin is never `env`, while a setting beside it still reads its variable",
  { input: FileOnlyCase },
  ({ input: { app, pair, place, pad } }) =>
    Effect.gen(function* () {
      const [locked, open] = pair;
      const group = makeGroup(app, [declare(named(locked), { fileOnly: true }), declare(named(open))]);
      const held = place === "none" ? [] : place.split("+");
      const repo = toml(pad, held.includes("repo") ? [{ entry: locked, raw: String(locked.seed + 1) }] : []);
      const user = toml(pad, held.includes("user") ? [{ entry: locked, raw: String(locked.seed + 2) }] : []);

      const { exit } = yield* start(group, {
        disk: { files: { [repoFile(app).path]: repo.text, [userFile(app).path]: user.text } },
        // Only the open setting's variable is set: a variable that names a file-only setting stops the start (FO1).
        env: environment({ [variable(app, open)]: String(open.seed) }),
      });

      const loaded = mustStart(exit);

      const want = held.includes("repo")
        ? { value: locked.seed + 1, origin: inFile(repoFile(app).name, repo.at[named(locked)] ?? -1) }
        : held.includes("user")
          ? { value: locked.seed + 2, origin: inFile(userFile(app).name, user.at[named(locked)] ?? -1) }
          : { value: DEFAULT, origin: { _tag: "default" } };

      expect({ value: loaded.values[field(locked)], origin: loaded.origins[named(locked)] }).toEqual(want);
      expect(loaded.origins[named(locked)]).not.toMatchObject({ _tag: "env" });

      // The control: the setting beside it is not file-only, so its variable wins.
      expect({ value: loaded.values[field(open)], origin: loaded.origins[named(open)] }).toEqual({
        value: open.seed,
        origin: { _tag: "env", name: variable(app, open) },
      });
    }),
  check,
);

// ---------------------------------------------------------------------------------------------
// B11, a live setting gives its value now (scenario)
// ---------------------------------------------------------------------------------------------

// Plant: build every `Live` from the default.
it.effect(
  "B11 scenario: yielding a live field gives the value resolved from each source in turn, with the origin a restart setting gets",
  () =>
    Effect.gen(function* () {
      const app = "demo";
      const live = { table: "deliv", key: "rule" };
      const restart = { table: "plain", key: "thing" };
      const group = makeGroup(app, [declare(named(live), { live: true }), declare(named(restart))]);

      for (const place of ["none", "env", "repo", "user"] as const) {
        const env: Record<string, string> = {};
        const repo: Array<{ entry: Named; raw: string }> = [];
        const user: Array<{ entry: Named; raw: string }> = [];

        for (const [n, entry] of [live, restart].entries()) {
          if (place === "env") {
            env[variable(app, entry)] = String(4100 + n);
          } else if (place === "repo") {
            repo.push({ entry, raw: String(4100 + n) });
          } else if (place === "user") {
            user.push({ entry, raw: String(4100 + n) });
          }
        }

        const files = { repo: toml(1, repo), user: toml(1, user) };

        const { exit } = yield* start(group, {
          disk: { files: { [repoFile(app).path]: files.repo.text, [userFile(app).path]: files.user.text } },
          env: environment(env),
        });

        const loaded = mustStart(exit);
        const reading = loaded.values[field(live)];

        // A live field is an Effect: yield it for the value now. A restart field is the plain value.
        expect(isReading(reading)).toBe(true);
        expect(isReading(loaded.values[field(restart)])).toBe(false);

        const now = isReading(reading) ? yield* reading : undefined;

        const want = (entry: Named, n: number) =>
          Match.value(place).pipe(
            Match.when("none", () => ({ value: DEFAULT, origin: { _tag: "default" } })),
            Match.when("env", () => ({ value: 4100 + n, origin: { _tag: "env", name: variable(app, entry) } })),
            Match.orElse((found) => ({
              value: 4100 + n,
              origin: inFile(
                (found === "repo" ? repoFile(app) : userFile(app)).name,
                files[found].at[named(entry)] ?? -1,
              ),
            })),
          );

        expect({ value: now, origin: loaded.origins[named(live)] }).toEqual(want(live, 0));
        expect({ value: loaded.values[field(restart)], origin: loaded.origins[named(restart)] }).toEqual(
          want(restart, 1),
        );
      }
    }),
);

// ---------------------------------------------------------------------------------------------
// B16 [protocol], nothing a caller holds changes the start
// ---------------------------------------------------------------------------------------------

/** Whether a value is, or holds in a property of its own or of its prototypes, a `SubscriptionRef`. */
const holdsRef = (value: unknown, depth = 0): boolean => {
  if (SubscriptionRef.isSubscriptionRef(value)) {
    return true;
  }

  if (depth > 2 || !Predicate.isObject(value)) {
    return false;
  }

  const found: Array<unknown> = [];

  for (let at: object | null = value; at !== null && at !== Object.prototype; at = Reflect.getPrototypeOf(at)) {
    for (const key of Reflect.ownKeys(at)) {
      found.push(Reflect.getOwnPropertyDescriptor(at, key)?.value);
    }
  }

  return found.some((next) => holdsRef(next, depth + 1));
};

/** The writes a caller can try on a property: set it, define it, delete it. */
const WRITES: ReadonlyArray<(target: object, key: PropertyKey, junk: unknown) => unknown> = [
  (target, key, junk) => Object.assign(target, { [key]: junk }),
  (target, key, junk) =>
    Object.defineProperty(target, key, { value: junk, writable: true, configurable: true, enumerable: true }),
  (target, key) => Reflect.deleteProperty(target, key),
  (target, _key, junk) => (Array.isArray(target) ? target.push(junk) : undefined),
];

/** One write on `target` at `key`. A write that throws changed nothing, as one that answers `false` did not. */
const tamper = (write: (typeof WRITES)[number], target: unknown, key: PropertyKey, junk: unknown) =>
  Predicate.isObjectOrArray(target)
    ? Effect.ignore(Effect.try({ try: () => write(target, key, junk), catch: () => "refused" as const }))
    : Effect.void;

const Tampering = Schema.Struct({ app: Word, pair: Pair, junk: Seed });

// Plants: (a) keep the reference of a `Live` in a plain `private` property, as the reviewed head did; (b) leave the
// values object of a group writable; (c) leave the origins object writable; (d) leave the `Live` itself writable.
it.effect.prop(
  "B16 a started group gives a caller no reference to a live value, and no write to its values, its origins or a live value changes what a later reader gets",
  { input: Tampering },
  ({ input: { app, pair, junk } }) =>
    Effect.gen(function* () {
      const [live, restart] = pair;
      const group = makeGroup(app, [declare(named(live), { live: true }), declare(named(restart))]);

      const files = { [repoFile(app).path]: toml(1, [{ entry: live, raw: "4101" }]).text };

      const readers = Effect.gen(function* () {
        const first: Readonly<Record<string, unknown>> = yield* group;
        const reading = first[field(live)];
        const origins: Readonly<Record<string, unknown>> = yield* SettingGroup.origins(group);

        // A live field is an Effect to yield, and the law needs the one it is given.
        expect(isReading(reading)).toBe(true);

        const now = (values: Readonly<Record<string, unknown>>) => {
          const field_ = values[field(live)];

          return isReading(field_) ? field_ : Effect.void;
        };

        const before = { live: yield* now(first), restart: first[field(restart)], origins: { ...origins } };

        // The live value shows no reference: not as a key, not in any property of it or of what it inherits.
        expect(Predicate.isObject(reading) ? Object.keys(reading) : []).not.toContain("ref");
        expect(holdsRef(reading)).toBe(false);
        expect(holdsRef(first)).toBe(false);

        // Each write, to the reading, to the group's values and to its origins, whatever it does, changes nothing later.
        for (const write of WRITES) {
          for (const key of [...(Predicate.isObject(reading) ? Reflect.ownKeys(reading) : []), "asEffect", "ref"]) {
            yield* tamper(write, reading, key, () => Effect.succeed(junk));
          }

          for (const key of [field(live), field(restart), "extra"]) {
            yield* tamper(write, first, key, junk);
          }

          for (const key of [named(live), named(restart), "extra"]) {
            yield* tamper(write, origins, key, { _tag: "default" });
          }

          const second: Readonly<Record<string, unknown>> = yield* group;
          const later: Readonly<Record<string, unknown>> = yield* SettingGroup.origins(group);

          expect({ live: yield* now(second), restart: second[field(restart)], origins: { ...later } }).toEqual(before);
        }
      });

      yield* readers.pipe(
        Effect.provide(SettingGroup.layer(group, { version: VERSION, repo: ROOT })),
        Effect.provide(MemoryFiles.layer({ files })),
        Effect.provide(ConfigProvider.layer(ConfigProvider.fromEnv({ env: { ...environment() } }))),
      );
    }),
  check,
);

/** One declared setting of the nested law: its value, whether it is live, and whether a file or its default gives it. */
interface Kept {
  readonly name: string;
  readonly field: string;
  readonly live: boolean;
}

const KEPT: ReadonlyArray<Kept> = ["file", "dflt"].flatMap((source) =>
  [
    { word: "pair", live: false },
    { word: "tags", live: false },
    { word: "lpair", live: true },
  ].map(({ word, live }) => ({ name: `t0${source}.${source[0]}${word}`, field: `${source[0]}${word}`, live })),
);

const Nested = Schema.Struct({ app: Word, junk: Seed });

// Plants, each with the fix undone for that one case: (a) a table value left writable; (b) an array value left
// writable; (c) each origin object left writable; (d) the value a `Live` yields left writable; (e) the declaration's
// own default object handed out as the value; (f) the declaration's own default frozen in place and handed out, which
// leaves every write refused and every value as it was, so only the `isFrozen` line sees it.
it.effect.prop(
  "B16 no write to a table value, an array value, an origin or the value a live setting yields changes what a later reader or a later start gets, nor the declaration's default",
  { input: Nested },
  ({ input: { app, junk } }) =>
    Effect.gen(function* () {
      const defaults = { pair: { a: 1, b: 2 }, tags: ["x", "y"], lpair: { a: 3 } };

      const settings = KEPT.map(({ name, live }) => {
        const word = name.split(".")[1]?.slice(1);
        const described = Setting.withDescription("A kept value.");

        if (word === "tags") {
          const made = Setting.make(name, Schema.Array(Schema.String)).pipe(
            described,
            Setting.withDefault(defaults.tags),
          );

          return live ? made.pipe(Setting.live) : made;
        }

        const made = Setting.make(name, Pairing).pipe(
          described,
          Setting.withDefault(word === "pair" ? defaults.pair : defaults.lpair),
        );

        return live ? made.pipe(Setting.live) : made;
      });

      const group = makeGroup(app, settings);

      // The file gives each `file` setting its value, and leaves each `dflt` one to its default.
      const files = {
        [repoFile(app).path]: '[t0file]\nftags = ["p", "q"]\n[t0file.fpair]\na = 11\nb = 12\n[t0file.flpair]\na = 13\n',
      };

      // Each reader sees every value as plain data: a live one yielded, an origin as it is.
      const seeing = Effect.gen(function* () {
        const values: Readonly<Record<string, unknown>> = yield* group;
        const origins: Readonly<Record<string, unknown>> = yield* SettingGroup.origins(group);
        const now: Record<string, unknown> = {};

        for (const { field: key, live } of KEPT) {
          const value = values[key];
          now[key] = live && isReading(value) ? yield* value : value;
        }

        return { values, origins, now, plain: structuredClone({ now, origins }) };
      });

      const started = <A, E, R>(program: Effect.Effect<A, E, R>) =>
        program.pipe(
          Effect.provide(SettingGroup.layer(group, { version: VERSION, repo: ROOT })),
          Effect.provide(MemoryFiles.layer({ files })),
          Effect.provide(ConfigProvider.layer(ConfigProvider.fromEnv({ env: { ...environment() } }))),
        );

      const first = yield* started(
        Effect.gen(function* () {
          const seen_ = yield* seeing;

          for (const write of WRITES) {
            // Every table value, array value and origin, the value a live one yields included, whatever the write does.
            for (const target of [...Object.values(seen_.now), ...Object.values(seen_.origins)]) {
              const keys = Predicate.isObjectOrArray(target)
                ? [...Reflect.ownKeys(target), "0", "length", "extra"]
                : [];

              for (const key of keys) {
                yield* tamper(write, target, key, junk);
              }
            }

            const later = yield* seeing;
            expect(later.plain).toEqual(seen_.plain);
          }

          return seen_.plain;
        }),
      );

      // A second start, on its own layer, gets what the first one first read, and the declaration's default is as it was.
      const second = yield* started(Effect.map(seeing, (seen_) => seen_.plain));
      expect(second).toEqual(first);
      expect(defaults).toEqual({ pair: { a: 1, b: 2 }, tags: ["x", "y"], lpair: { a: 3 } });

      // The object a caller declared a default with is still the caller's: a start made its own copy and froze that.
      expect([defaults.pair, defaults.tags, defaults.lpair].map((object) => Object.isFrozen(object))).toEqual([
        false,
        false,
        false,
      ]);
    }),
  check,
);

// ---------------------------------------------------------------------------------------------
// B17, a value that is not plain data never reaches a reader
// ---------------------------------------------------------------------------------------------

/** A guard that lies: it says every value is text. It is how these laws tell the compiler a value is plain when it is not. */
const claimsText = (_value: unknown): _value is string => true;

// A schema typed as text that takes any value, which leaves the plain-data check at make as the only refusal there is.
const Anything = Schema.declare(claimsText);

const slipped = (name: string, value: unknown): Setting.Any => {
  const made = Setting.make(name, Anything).pipe(Setting.withDescription("A slipped value."));

  return claimsText(value) ? made.pipe(Setting.withDefault(value)) : made;
};

class Holder {
  readonly size = 1;
}

const KINDS = ["date", "map", "set", "instance", "null", "undefined", "function"] as const;

const NotPlainDefault = Schema.Struct({
  app: Word,
  entry: Entry,
  kind: Schema.Literals(KINDS),
  // The depth is how many records and arrays the kind sits in, none to two.
  wraps: Schema.Array(Schema.Literals(["array", "record"])).check(Schema.isMaxLength(2)),
});

/** A value in `wraps`, the innermost first, a record or an array each. */
const wrapped = (leaf: unknown, wraps: ReadonlyArray<"array" | "record">) =>
  wraps.reduce<unknown>((inner, shape) => (shape === "array" ? [inner] : { held: inner }), leaf);

const badLeaf = (kind: (typeof KINDS)[number]): unknown =>
  Match.value(kind).pipe(
    Match.when("date", () => new Date(0)),
    Match.when("map", () => new Map([["a", 1]])),
    Match.when("set", () => new Set(["a"])),
    Match.when("instance", () => new Holder()),
    Match.when("null", () => null),
    Match.when("undefined", () => undefined),
    Match.when("function", () => () => 1),
    Match.exhaustive,
  );

// Plants: (a) drop the plain-data check, so the schema, which accepts anything, lets a default in; (b) check only the
// top level of a default, so a `Date` one level down makes a group.
it.effect.prop(
  "B17 a default that is not plain data, put in past the types, throws at make naming the setting and saying plain data, and the same group with plain data in its place makes",
  { input: NotPlainDefault },
  ({ input: { app, entry, kind, wraps } }) =>
    Effect.gen(function* () {
      const name = named(entry);
      const refused = yield* thrown(() => SettingGroup.make(app, slipped(name, wrapped(badLeaf(kind), wraps))));
      expect(refused ?? "it made a group").toContain(name);
      expect(refused ?? "it made a group").toContain("plain data");

      expect(yield* thrown(() => SettingGroup.make(app, slipped(name, wrapped("text", wraps))))).toBeUndefined();
    }),
  check,
);

// Plant: hand the value out as it is when `frozen` answers none, so the layer starts and a `Date` reaches a reader.
it.effect(
  "B17 scenario: a cast schema that decodes a class instance makes its group, and its layer dies, as a defect and not a SettingsError, naming the setting",
  () =>
    Effect.gen(function* () {
      const app = "demo";
      const name = "since.when";

      // The schema decodes a text of a time into a `Date` and says it gave text: the one lie a caller can tell, which
      // the start must still refuse.
      const Lying = Schema.String.pipe(
        Schema.decodeTo(Anything, {
          decode: SchemaGetter.transform((text: string) => {
            const date: unknown = new Date(text);

            return claimsText(date) ? date : text;
          }),
          encode: SchemaGetter.transform((text: string) => text),
        }),
      );

      const lying = Setting.make(name, Lying).pipe(Setting.withDescription("A lying schema."));

      const group = makeGroup(app, [lying]);
      const files = { [repoFile(app).path]: '[since]\nwhen = "2020-01-01T00:00:00.000Z"\n' };
      const { exit } = yield* start(group, { disk: { files } });

      expect(Exit.isFailure(exit)).toBe(true);

      if (Exit.isFailure(exit)) {
        expect(exit.cause.reasons.map((reason) => reason._tag)).toEqual(["Die"]);
        expect(Cause.pretty(exit.cause)).toContain(name);
      }
    }),
);

// ---------------------------------------------------------------------------------------------
// B12, missing and unreadable files
// ---------------------------------------------------------------------------------------------

const ReadCase = Schema.Struct({
  app: Word,
  entries: Entries,
  file: Schema.Literals(["repo", "user"]),
  denied: Denied,
  seed: Seed,
});

// Plant: count every read failure as an empty file.
it.effect.prop(
  "B12 a missing file counts as empty, and any other read failure fails `read` naming the file",
  { input: ReadCase },
  ({ input: { app, entries, file, denied, seed } }) =>
    Effect.gen(function* () {
      const group = makeGroup(
        app,
        entries.map((entry) => declare(named(entry))),
      );

      // Neither file is there: every value is its default.
      const empty = mustStart((yield* start(group, { disk: { files: {} } })).exit);

      for (const entry of entries) {
        expect(empty.values[field(entry)]).toBe(DEFAULT);
        expect(empty.origins[named(entry)]).toEqual({ _tag: "default" });
      }

      // One file fails to read, whatever else is on the disk: no value comes from the other file instead.
      const place = file === "repo" ? repoFile(app) : userFile(app);
      const other = file === "repo" ? userFile(app) : repoFile(app);

      const { exit } = yield* start(group, {
        disk: {
          files: {
            [place.path]: "",
            [other.path]: toml(
              0,
              entries.map((entry) => ({ entry, raw: String(seed) })),
            ).text,
          },
          broken: { [place.path]: denial(denied, place.path) },
        },
      });

      const error = seen(exit);
      expect(error.reason).toBe("read");
      expect(error.file).toBe(place.name);
    }),
  check,
);

// ---------------------------------------------------------------------------------------------
// B13, where the user configuration is
// ---------------------------------------------------------------------------------------------

const Dir = Schema.String.check(Schema.isPattern(/^\/[a-z]{2,6}\/[a-z]{2,6}$/u));

const HomeCase = Schema.Struct({
  app: Word,
  other: Word,
  mode: Schema.Literals(["app-home", "home", "both", "neither"]),
  appDir: Dir,
  homeDir: Dir,
  otherDir: Dir,
  pad: Schema.Int.check(Schema.isBetween({ minimum: 0, maximum: 4 })),
}).check(
  Schema.makeFilter(
    (c) =>
      c.app !== c.other &&
      new Set([c.appDir, c.homeDir, c.otherDir]).size === 3 &&
      ![c.appDir, c.homeDir, c.otherDir].some((dir) => dir.startsWith(`${ROOT}/`)),
  ),
);

// Plant: read `HOME` before `<APP>_HOME`.
it.effect.prop(
  "B13 the user file is `$<APP>_HOME/<app>.toml`, else `$HOME/.<app>/<app>.toml`, else none, and another app's home is never read",
  { input: HomeCase },
  ({ input: { app, other, mode, appDir, homeDir, otherDir, pad } }) =>
    Effect.gen(function* () {
      const group = makeGroup(app, [declare(named(NET))]);
      const body = (value: number) => toml(pad, [{ entry: NET, raw: String(value) }]);
      const here = { app: body(4001), home: body(4002), other: body(4003) };

      const paths = {
        app: `${appDir}/${app}.toml`,
        home: `${homeDir}/.${app}/${app}.toml`,
        otherOwn: `${otherDir}/${other}.toml`,
        otherSame: `${otherDir}/${app}.toml`,
        otherDeep: `${otherDir}/.${app}/${app}.toml`,
      };

      const env: Record<string, string> = { [`${other.toUpperCase()}_HOME`]: otherDir };

      if (mode === "app-home" || mode === "both") {
        env[`${app.toUpperCase()}_HOME`] = appDir;
      }

      if (mode === "home" || mode === "both") {
        env["HOME"] = homeDir;
      }

      const { exit, reads } = yield* start(group, {
        disk: {
          files: {
            [repoFile(app).path]: "",
            [paths.app]: here.app.text,
            [paths.home]: here.home.text,
            [paths.otherOwn]: here.other.text,
            [paths.otherSame]: here.other.text,
            [paths.otherDeep]: here.other.text,
          },
        },
        env,
      });

      const loaded = mustStart(exit);

      const want =
        mode === "app-home" || mode === "both"
          ? {
              value: 4001,
              origin: inFile(`$${app.toUpperCase()}_HOME/${app}.toml`, here.app.at[named(NET)] ?? -1),
              path: paths.app,
            }
          : mode === "home"
            ? { value: 4002, origin: inFile(`~/.${app}/${app}.toml`, here.home.at[named(NET)] ?? -1), path: paths.home }
            : { value: DEFAULT, origin: { _tag: "default" }, path: undefined };

      expect({ value: loaded.values[field(NET)], origin: loaded.origins[named(NET)] }).toEqual({
        value: want.value,
        origin: want.origin,
      });

      // The repo file is read, and so is the user file where it is. No other place a user file might be is touched.
      expect(reads).toContain(repoFile(app).path);

      for (const path of Object.values(paths)) {
        expect(reads.includes(path)).toBe(path === want.path);
      }

      expect(want.path === undefined || reads.includes(want.path)).toBe(true);

      // With neither variable, nothing outside the repo is read at all.
      expect(want.path !== undefined || reads.every((path) => path.startsWith(`${ROOT}/`))).toBe(true);
    }),
  check,
);

// ---------------------------------------------------------------------------------------------
// B14, a file that is not TOML
// ---------------------------------------------------------------------------------------------

const BrokenCase = Schema.Struct({
  app: Word,
  file: Schema.Literals(["repo", "user"]),
  shape: Schema.Literals(["brace", "two-values"]),
  pad: Schema.Int.check(Schema.isBetween({ minimum: 0, maximum: 6 })),
});

// Plant: report line 0.
it.effect.prop(
  "B14 a file that is not TOML fails `syntax` naming the file and the line the parser stops on",
  { input: BrokenCase },
  ({ input: { app, file, shape, pad } }) =>
    Effect.gen(function* () {
      const group = makeGroup(app, [declare(named(NET))]);
      const place = file === "repo" ? repoFile(app) : userFile(app);
      const text = `${comments(pad)}[net]\nport = ${shape === "brace" ? "}" : "1 2"}\n`;
      const { exit } = yield* start(group, { disk: { files: { [place.path]: text } } });
      const error = seen(exit);

      expect(error.reason).toBe("syntax");
      expect(error.file).toBe(place.name);
      expect(error.line).toBe(pad + 2);
    }),
  check,
);

// ---------------------------------------------------------------------------------------------
// O2, a schema that decodes asynchronously (ticket 1843, slice 1, amendment 1)
// ---------------------------------------------------------------------------------------------

const AsyncCase = Schema.Struct({ app: Word, entry: Entry });

// A schema whose decode finishes on a later tick, as one built with `transformEffect` may. The start decodes the file with
// `Schema.decodeUnknownEffect`, so it waits; a decode that must answer at once dies on it. A scenario of main's
// behavior, which the move of the check must keep: no new behavior, so no new refusal.
// Plant: decode the file with `Schema.decodeUnknownResult` in `internal/check.ts`: the start dies with
// "Result adapter can only return schema issues".
it.effect.prop(
  "O2 a setting whose schema decodes asynchronously starts with the value in the repo file",
  { input: AsyncCase },
  ({ input: { app, entry } }) =>
    Effect.gen(function* () {
      const Later = Schema.Int.pipe(
        Schema.decodeTo(Schema.Int, {
          decode: SchemaGetter.transformEffect((n: number) =>
            Effect.callback<number>((resume) => queueMicrotask(() => resume(Effect.succeed(n)))),
          ),
          encode: SchemaGetter.passthrough(),
        }),
      );

      const later = Setting.make(named(entry), Later).pipe(
        Setting.withDescription("Decoded later."),
        Setting.withDefault(DEFAULT),
      );

      const group = makeGroup(app, [later]);
      const body = toml(0, [{ entry, raw: String(entry.seed) }]);
      const { exit } = yield* start(group, { disk: { files: { [repoFile(app).path]: body.text } } });
      const loaded = mustStart(exit);

      expect(loaded.values[field(entry)]).toBe(entry.seed);
      expect(loaded.origins[named(entry)]).toEqual(inFile(repoFile(app).name, body.at[named(entry)] ?? -1));
    }),
  check,
);
