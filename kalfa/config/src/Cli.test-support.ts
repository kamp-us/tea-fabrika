import { inspect } from "node:util";
/**
 * What the laws of the `config` command (ticket 1846, slice 2) share: the draw, the scenes (groups of settings with the
 * files and the environment that set them), the command run on a disk in memory, and the text a run must print, written
 * here from what the scene says and never from the code under test.
 *
 * Every generator is an Effect Schema, so each has its own Arbitrary. A law builds one scene for each class it lists from
 * the drawn seeds, never the cross product, and `Reach.done` fails when a class was not reached. A scene is made of rows:
 * each row is one setting, with the source that sets it (the default, a variable, the repo file or the user file), and the
 * scene knows what `get` must print for it, where it came from and what its block of `list` says.
 *
 * The listing's form is the plan's "The listing (slice 2)": a block per setting, by name, one blank line between, each
 * description's line breaks kept as written and followed by the two-space indent, except a final break, which ends the
 * block's last line in place of the plain `\n`.
 */
import { expect } from "@effect/vitest";
import { Recorder } from "@kampus/vitest";
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
  Stdio,
  Terminal,
  Tracer,
} from "effect";
import { Command } from "effect/cli";
import { ChildProcessSpawner } from "effect/process";
import * as Rec from "effect/Record";
import { TestConsole } from "effect/testing";
import { config } from "./Cli.ts";
import { Setting, SettingGroup } from "./index.ts";
import { debounce } from "./internal/window.ts";
import * as MemoryFiles from "./MemoryFiles.test-support.ts";
import { answer, readRefused } from "./SettingGroup.disk.test-support.ts";
import { Reach } from "./SettingGroup.edit.test-support.ts";
import { BREAKS, describe, TEXTS } from "./SettingGroup.text.test-support.ts";

export { BREAKS, Reach };

type Json = typeof Schema.Json.Type;

const HOME = "/people/one";

const APP_HOME = "/moved/one";

// ---------------------------------------------------------------------------------------------
// The draw
// ---------------------------------------------------------------------------------------------

const clean = Schema.makeFilter(
  (text: string) =>
    !["person", "instance", "config", "watch", "debounce", "home", "version", "constructor", "string", "proto"].some(
      (word) => text.includes(word),
    ),
);

const Word = Schema.String.check(Schema.isPattern(/^[a-z][a-z0-9]{3,7}$/u), clean);

const Table = Schema.String.check(Schema.isPattern(/^[a-z]{2,6}(-[a-z]{1,4})?$/u), clean);

const Small = Schema.String.check(Schema.isPattern(/^[a-z]{2,6}$/u), clean);

const Pick = Schema.Int.check(Schema.isBetween({ minimum: 0, maximum: 999 }));

const Count = Schema.Int.check(Schema.isBetween({ minimum: 1000, maximum: 60000 }));

/** A line of a description: every character Markdown reads, a tab and `雪` inside, never a space or a tab at either end. */
const Line = Schema.String.check(
  Schema.isPattern(
    /^[A-Za-z0-9*_[\]<>#|&~+!\\.:`雪=()@-](?:[A-Za-z0-9*_[\]<>#|&~+!\\.:`雪=()@ \t-]{0,10}[A-Za-z0-9*_[\]<>#|&~+!\\.:`雪=()@-])?$/u,
  ),
);

/** A secret-looking word, with a character that changes in JSON and in a URL. */
const Hidden = Schema.String.check(Schema.isPattern(/^sk-([A-Za-z0-9]{6,12})["/ +\\&][A-Za-z0-9]{3}$/u));

/** A folder the repo is held in: one or two words below `/work`. */
const Folder = Schema.String.check(Schema.isPattern(/^\/work\/[a-z]{3,6}(\/[a-z]{3,6})?$/u));

/** The environment variable that sets a setting: `DEMO_INSTANCE_PORT`. */
export const variable = (app: string, name: string) =>
  [app.toUpperCase(), ...name.split(".").map((word) => word.replace(/-/gu, "_").toUpperCase())].join("_");

const field = (name: string) =>
  (name.split(".").at(-1) ?? name).replace(/-([a-z0-9])/gu, (_, letter: string) => letter.toUpperCase());

export const CliDraw = Schema.Struct({
  app: Word,
  tables: Schema.Array(Table).check(Schema.isMinLength(8), Schema.isMaxLength(8)),
  keys: Schema.Array(Table).check(Schema.isMinLength(8), Schema.isMaxLength(8)),
  lines: Schema.Array(Line).check(Schema.isMinLength(4), Schema.isMaxLength(8)),
  words: Schema.Array(Small).check(Schema.isMinLength(4), Schema.isMaxLength(6)),
  numbers: Schema.Array(Count).check(Schema.isMinLength(4), Schema.isMaxLength(6)),
  picks: Schema.Array(Pick).check(Schema.isMinLength(8), Schema.isMaxLength(12)),
  secret: Hidden,
  repo: Folder,
}).check(
  Schema.makeFilter((draw) => {
    const names = draw.tables.map((table, n) => `${table}.${draw.keys[n]}`);

    return (
      new Set(draw.tables).size === 8 &&
      new Set(draw.keys).size === 8 &&
      new Set(draw.keys.map(field)).size === 8 &&
      new Set(names.map((name) => variable("a", name))).size === 8 &&
      // The same key under another table is a class of its own (`names` builds it), so no key may be a table too.
      draw.keys.every((key) => !draw.tables.includes(key))
    );
  }),
);

export type CliDraw = typeof CliDraw.Type;

const drawn = (draw: CliDraw, n: number): number => draw.picks[n % draw.picks.length] ?? 0;

const count = (draw: CliDraw, n: number): number => draw.numbers[n % draw.numbers.length] ?? 4100;

const small = (draw: CliDraw, n: number): string => draw.words[n % draw.words.length] ?? "w";

/** The n-th name of a draw: its own table, its own key. */
export const settingName = (draw: CliDraw, n: number): string => `${draw.tables[n]}.${draw.keys[n]}`;

// ---------------------------------------------------------------------------------------------
// Settings: one kind each, as the file writes it and as a variable's text reads
// ---------------------------------------------------------------------------------------------

export type Kind = "int" | "literal" | "pattern" | "branded" | "text" | "required" | "array" | "record";

/** The kinds a variable's text can set: the scalars. */
const SCALARS: ReadonlyArray<Kind> = ["int", "literal", "pattern", "branded", "text", "required"];

const Port = Schema.Int.check(Schema.isBetween({ minimum: 1, maximum: 65535 }));

/** The texts a text setting holds: the slice's texts that push a code span, and a text with each kind of break and a tab. */
const TEXT_VALUES: ReadonlyArray<string> = [...TEXTS, "line one\nline two", "a\r\nb", "x\ry", "tab\tand 雪\n"];

const Rule = Schema.Literals(["people", "robots", "owner"]);

const Slug = Schema.String.pipe(Schema.brand("Slug"));

const Pairing = Schema.Struct({ a: Schema.optionalKey(Schema.Int) });

const Letters = Schema.String.check(Schema.isPattern(/^[a-z]+$/u));

export interface Spec {
  readonly name: string;
  readonly kind: Kind;
  readonly files: Setting.Files;
  readonly live: boolean;
  readonly fileOnly: boolean;
  readonly description: string;
  /** The default as the file writes it, or none for a required setting. */
  readonly default: Option.Option<Json>;
}

const marked = (spec: Spec, made: Setting.Setting<string, any>): Setting.Any => {
  if (spec.fileOnly) {
    return spec.live ? Setting.live(Setting.fileOnly(made)) : Setting.fileOnly(made);
  }

  return spec.live ? Setting.live(made) : made;
};

/** The setting a spec stands for: one object, so a scene can put the same object in two groups. */
export const declare = (spec: Spec): Setting.Any => {
  const rest = [Setting.withDescription(spec.description), Setting.files(spec.files)] as const;

  switch (spec.kind) {
    case "int":
      return marked(spec, Setting.make(spec.name, Port).pipe(Setting.withDefault(18787), ...rest));
    case "literal":
      return marked(spec, Setting.make(spec.name, Rule).pipe(Setting.withDefault("people"), ...rest));
    case "pattern":
      return marked(spec, Setting.make(spec.name, Letters).pipe(Setting.withDefault("abc"), ...rest));
    case "branded":
      return marked(spec, Setting.make(spec.name, Slug).pipe(Setting.withDefault(Slug.make("slug")), ...rest));
    case "text":
      return marked(
        spec,
        Setting.make(spec.name, Schema.String).pipe(
          Setting.withDefault(Option.getOrElse(Option.filter(spec.default, Schema.is(Schema.String)), () => "x")),
          ...rest,
        ),
      );
    case "required":
      return marked(spec, Setting.make(spec.name, Port).pipe(...rest));
    case "array":
      return marked(spec, Setting.make(spec.name, Schema.Array(Schema.Int)).pipe(Setting.withDefault([70]), ...rest));
    case "record":
      return marked(spec, Setting.make(spec.name, Pairing).pipe(Setting.withDefault({ a: 90 }), ...rest));
  }
};

const initial = (kind: Kind, draw: CliDraw, n: number): Option.Option<Json> => {
  switch (kind) {
    case "int":
      return Option.some(18787);
    case "literal":
      return Option.some("people");
    case "pattern":
      return Option.some("abc");
    case "branded":
      return Option.some("slug");
    case "text":
      return Option.some(TEXT_VALUES[drawn(draw, n) % TEXT_VALUES.length] ?? "x");
    case "required":
      return Option.none();
    case "array":
      return Option.some([70]);
    case "record":
      return Option.some({ a: 90 });
  }
};

/** A value the setting's schema accepts, as a file writes it. `n` turns the value, so two sources can differ. */
const fileValue = (draw: CliDraw, kind: Kind, n: number): Json => {
  switch (kind) {
    case "int":
    case "required":
      return count(draw, n);
    case "literal":
      return n % 2 === 0 ? "robots" : "owner";
    case "pattern":
      return small(draw, n);
    case "branded":
      return small(draw, n + 1);
    case "text":
      return TEXT_VALUES[drawn(draw, n) % TEXT_VALUES.length] ?? "x";
    case "array":
      return [count(draw, n), count(draw, n + 1)];
    case "record":
      return { a: count(draw, n) };
  }
};

/** The text of a variable that sets a scalar setting, and what it reads as. A variable's text is never empty. */
const variableText = (draw: CliDraw, kind: Kind, n: number): { readonly text: string; readonly value: Json } => {
  const texts = TEXT_VALUES.filter((text) => text !== "");

  switch (kind) {
    case "int":
    case "required":
      return { text: String(count(draw, n)), value: count(draw, n) };
    case "literal":
      return { text: "robots", value: "robots" };
    case "pattern":
      return { text: small(draw, n), value: small(draw, n) };
    case "branded":
      return { text: small(draw, n + 1), value: small(draw, n + 1) };
    default: {
      const text = texts[drawn(draw, n) % texts.length] ?? "x";

      return { text, value: text };
    }
  }
};

// ---------------------------------------------------------------------------------------------
// Files, as the text a person typed: one key a line, so a key's line is known
// ---------------------------------------------------------------------------------------------

const isTable = Schema.is(Schema.Record(Schema.String, Schema.Json));

const value = (json: Json): string => {
  if (Array.isArray(json)) {
    return `[${json.map(value).join(", ")}]`;
  }

  if (isTable(json)) {
    return `{ ${Object.entries(json)
      .map(([key, below]) => `${key} = ${value(below)}`)
      .join(", ")} }`;
  }

  return JSON.stringify(json);
};

interface Pair {
  readonly name: string;
  readonly json: Json;
}

/** One file's text and the line of each key. Keys with no table come first, then each table once. */
const written = (note: string, top: ReadonlyArray<string>, pairs: ReadonlyArray<Pair>) => {
  const lines = [`# ${note}`, ...top];
  const found = new Map<string, number>();
  const tables = new Map<string, Array<Pair>>();

  for (const pair of pairs) {
    const words = pair.name.split(".");
    const header = words.slice(0, -1).join(".");
    tables.set(header, [...(tables.get(header) ?? []), pair]);
  }

  const order = [...(tables.has("") ? [""] : []), ...[...tables.keys()].filter((header) => header !== "")];

  for (const header of order) {
    if (header !== "") {
      lines.push("", `[${header}]`);
    }

    for (const pair of tables.get(header) ?? []) {
      lines.push(`${pair.name.split(".").at(-1)} = ${value(pair.json)}`);
      found.set(pair.name, lines.length);
    }
  }

  return { text: `${lines.join("\n")}\n`, found };
};

// ---------------------------------------------------------------------------------------------
// Scenes
// ---------------------------------------------------------------------------------------------

type Source = "default" | "env" | "repo" | "user";

type Break = (typeof BREAKS)[number];

/** One setting of a scene: its kind and marks, and the source that sets it. */
interface Row {
  readonly kind: Kind;
  readonly source: Source;
  readonly files?: Setting.Files;
  readonly live?: boolean;
  readonly fileOnly?: boolean;
  /** The name, when it is not the draw's n-th. */
  readonly name?: string;
  /** The break the description's lines are joined by, and whether it ends with one. */
  readonly br?: Break;
  readonly final?: boolean;
  /** For a text setting: the text it holds, wherever its source puts it, in place of one the draw picks. */
  readonly text?: string;
}

/** One setting as a scene knows it: what it is, where its value comes from, and what `get` prints. */
export interface Entry {
  readonly spec: Spec;
  readonly setting: Setting.Any;
  readonly source: Source;
  /** The value `get` prints, as the codec writes it. */
  readonly json: Json;
  /** The text of the variable that sets it, for a source `env`. */
  readonly text: string | undefined;
  /** The line of its key in the file that sets it, for a source `repo` or `user`. */
  readonly line: number | undefined;
}

type AnyGroup = SettingGroup.SettingGroup<string, ReadonlyArray<Setting.Any>>;

interface Scene {
  readonly draw: CliDraw;
  readonly app: string;
  readonly groups: ReadonlyArray<AnyGroup>;
  /** Every distinct setting the groups hold, and the quiet window when one is live, by name. */
  readonly entries: ReadonlyArray<Entry>;
  /** The settings of the groups, each once, in the order of the rows. */
  readonly settings: ReadonlyArray<Setting.Any>;
  readonly env: Readonly<Record<string, string>>;
  readonly repoText: string;
  readonly userText: string;
  readonly userAt: "home" | "app-home";
}

interface SceneOptions {
  /** Where the user configuration is: under `$HOME`, or at `$<APP>_HOME`. */
  readonly user?: "home" | "app-home";
  /** Where the quiet window's value comes from, when a setting is live. */
  readonly window?: Exclude<Source, "env">;
  /** The `<app>-version` line of the repo file. */
  readonly version?: string;
}

/** The names a person reads for the three places a value can come from. */
export const placeNames = (app: string, user: "home" | "app-home") => ({
  repo: `.${app}/${app}.toml`,
  user: user === "home" ? `~/.${app}/${app}.toml` : `$${app.toUpperCase()}_HOME/${app}.toml`,
});

/** What the quiet window holds from each source: its default, and a length each file sets. */
const WINDOW_TEXT: Readonly<Record<"default" | "repo" | "user", string>> = {
  default: "100 millis",
  repo: "2 seconds",
  user: "3 seconds",
};

const present = <T>(items: ReadonlyArray<T>, n: number): T => {
  const item = items[n];

  if (item === undefined) {
    throw new Error(`the scene has no row ${n}`);
  }

  return item;
};

/**
 * A scene: `rows` are the settings, `layout` says which rows each group holds (a row in two groups is one setting object
 * shared), and every row has the source that sets it. A row's value is also put in a weaker source where it can be, so the
 * precedence is read: a variable's setting is also in the repo file, and a repo file's in the user file.
 */
export const scene = (
  draw: CliDraw,
  rows: ReadonlyArray<Row>,
  layout: ReadonlyArray<ReadonlyArray<number>>,
  options: SceneOptions = {},
): Scene => {
  const { app } = draw;
  const userAt = options.user ?? "home";

  const specs = rows.map((row, n): Spec => ({
    name: row.name ?? settingName(draw, n),
    kind: row.kind,
    files: row.files ?? ["repo", "user"],
    live: row.live ?? false,
    fileOnly: row.fileOnly ?? false,
    description: describe(draw, n, { final: row.final ?? false, ...(row.br === undefined ? {} : { br: row.br }) }),
    default: row.text === undefined ? initial(row.kind, draw, n) : Option.some(row.text),
  }));

  const settings = specs.map(declare);
  const used = [...new Set(layout.flat())].sort((a, b) => a - b);

  const groups = layout.map((held) =>
    SettingGroup.make(app, ...held.map((n) => present(settings, n))),
  ) satisfies ReadonlyArray<AnyGroup>;

  const env: Record<string, string> = { HOME };

  if (userAt === "app-home") {
    env[`${app.toUpperCase()}_HOME`] = APP_HOME;
  }

  const repoPairs: Array<Pair> = [];
  const userPairs: Array<Pair> = [];

  const entry = (n: number): Omit<Entry, "line"> => {
    const row = present(rows, n);
    const spec = present(specs, n);
    const setting = present(settings, n);
    const mine = (file: Setting.File) => spec.files.includes(file);

    switch (row.source) {
      case "default":
        return { spec, setting, source: "default", json: Option.getOrThrow(spec.default), text: undefined };
      case "env": {
        const read = row.text === undefined ? variableText(draw, row.kind, n) : { text: row.text, value: row.text };
        env[variable(app, spec.name)] = read.text;

        // A weaker source holds another value: the variable wins.
        if (mine("repo")) {
          repoPairs.push({ name: spec.name, json: fileValue(draw, row.kind, n + 1) });
        }

        return { spec, setting, source: "env", json: read.value, text: read.text };
      }

      case "repo": {
        const json = row.text ?? fileValue(draw, row.kind, n);
        repoPairs.push({ name: spec.name, json });

        if (mine("user")) {
          userPairs.push({ name: spec.name, json: fileValue(draw, row.kind, n + 1) });
        }

        return { spec, setting, source: "repo", json, text: undefined };
      }

      case "user": {
        const json = row.text ?? fileValue(draw, row.kind, n + 1);
        userPairs.push({ name: spec.name, json });

        return { spec, setting, source: "user", json, text: undefined };
      }
    }
  };

  const made = used.map(entry);

  // The quiet window is added once, for a group with a live setting.
  const windowSource = options.window ?? "default";

  const windowing: Array<Omit<Entry, "line">> = used.some((n) => present(rows, n).live === true)
    ? [
        {
          spec: {
            name: debounce.name,
            kind: "text",
            files: ["repo", "user"],
            live: false,
            fileOnly: false,
            description: debounce.description,
            default: Option.some("100 millis"),
          },
          setting: debounce,
          source: windowSource,
          json: WINDOW_TEXT[windowSource],
          text: undefined,
        },
      ]
    : [];

  for (const one of windowing) {
    if (one.source === "repo") {
      repoPairs.push({ name: one.spec.name, json: one.json });
    }

    if (one.source === "user") {
      userPairs.push({ name: one.spec.name, json: one.json });
    }
  }

  const repo = written(
    `the repo configuration of ${app}`,
    options.version === undefined ? [] : [`${app}-version = ${JSON.stringify(options.version)}`],
    repoPairs,
  );

  const user = written(`the user configuration of ${app}`, [], userPairs);

  // Only a value a file sets has a line.
  const lines: Readonly<Record<string, ReadonlyMap<string, number>>> = { repo: repo.found, user: user.found };

  const entries = [...made, ...windowing]
    .map((one): Entry => ({
      ...one,
      line: Option.getOrUndefined(
        Option.flatMap(Rec.get(lines, one.source), (found) => Option.fromNullishOr(found.get(one.spec.name))),
      ),
    }))
    .sort((a, b) => (a.spec.name < b.spec.name ? -1 : 1));

  return {
    draw,
    app,
    groups,
    entries,
    settings: used.map((n) => present(settings, n)),
    env,
    repoText: repo.text,
    userText: user.text,
    userAt,
  };
};

// ---------------------------------------------------------------------------------------------
// The text a run must print
// ---------------------------------------------------------------------------------------------

/** Where a value came from, as a person reads it. */
const origin = (s: Scene, e: Entry): string => {
  const names = placeNames(s.app, s.userAt);

  switch (e.source) {
    case "default":
      return "the default";
    case "env":
      return variable(s.app, e.spec.name);
    case "repo":
      return `${names.repo}, line ${e.line}`;
    case "user":
      return `${names.user}, line ${e.line}`;
  }
};

/** A description with the indent after each of its inner breaks. A final break is left as it is: it ends the block. A CRLF is one break. */
const indented = (text: string) => text.replace(/(\r\n|\r(?!\n)|\n)(?!$)/gu, "$1  ");

/** One setting's block, as the plan's listing writes it. */
const block = (s: Scene, e: Entry): string => {
  const marks = `${e.spec.live ? "live" : "restart"}${e.spec.fileOnly ? ", file-only" : ""}`;
  const head = `${e.spec.name} = ${JSON.stringify(e.json)}\n  from ${origin(s, e)}\n  ${marks}\n  ${indented(e.spec.description)}`;

  // A final break ends the block's last line in place of the plain one.
  return /(\r\n|\r|\n)$/u.test(e.spec.description) ? head : `${head}\n`;
};

/** The listing: every block, by name, one blank line between. No settings, no text. */
export const listing = (s: Scene): string => s.entries.map((e) => block(s, e)).join("\n");

/** The group the joined settings make, as `jsonSchema` and `reference` are asked of one. */
export const joinedGroup = (s: Scene) => SettingGroup.make(s.app, ...s.settings);

// ---------------------------------------------------------------------------------------------
// A run
// ---------------------------------------------------------------------------------------------

export interface World {
  readonly app: string;
  readonly groups: ReadonlyArray<AnyGroup>;
  /** The folder handed to the command as the repo. */
  readonly repo: string;
  readonly env: Readonly<Record<string, string>>;
  readonly files: Readonly<Record<string, string>>;
  /** Calls of the file system that fail with the error planted there. */
  readonly faults?: ReadonlyArray<MemoryFiles.Fault>;
  /** The environment cannot be read: its provider fails, as a source that is down does. */
  readonly unreadable?: boolean;
}

/** What a scene stands on: the repo folder, the files at the paths the start finds them at, and the environment. */
export const worldFrom = (s: Scene, repo: string): World => ({
  app: s.app,
  groups: s.groups,
  repo,
  env: s.env,
  files: { [repoPath(s, repo)]: s.repoText, [userPath(s)]: s.userText },
});

export const userPath = (s: Scene) =>
  s.userAt === "home" ? `${HOME}/.${s.app}/${s.app}.toml` : `${APP_HOME}/${s.app}.toml`;

export const repoPath = (s: Scene, repo: string) => `${repo}/.${s.app}/${s.app}.toml`;

export interface Ran {
  readonly exit: Exit.Exit<void, unknown>;
  /** What the command wrote to standard output: each line it logged, and a line break after it. */
  readonly stdout: string;
  readonly spans: ReadonlyArray<Tracer.NativeSpan>;
  readonly logs: ReadonlyArray<string>;
  /** Every file the disk holds when the run is over. */
  readonly files: Readonly<Record<string, string>>;
  readonly calls: ReadonlyArray<{ readonly method: string; readonly args: ReadonlyArray<unknown> }>;
}

const terminal = Terminal.make({
  columns: Effect.succeed(80),
  rows: Effect.succeed(24),
  size: Effect.die("unused"),
  readInput: Effect.die("unused"),
  readLine: Effect.die("unused"),
  display: () => Effect.void,
});

/** Runs `config <args>` on the world, through `Command.runWith`, on a disk in memory with every call recorded. */
export const run = (world: World, args: ReadonlyArray<string>) => {
  const disk = MemoryFiles.writable({ files: world.files, faults: world.faults ?? [] });
  const spans: Array<Tracer.NativeSpan> = [];
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
    const command = config(world.app, world.groups, { version: "0.0.0", repo: world.repo });
    // The test's console keeps every line of the test: this run's are those after what was already there.
    const already = (yield* TestConsole.logLines).length;
    const exit = yield* Effect.exit(Command.runWith(command, { version: "0.0.0" })(args));
    const lines = (yield* TestConsole.logLines).slice(already);
    const calls = yield* Recorder.calls(FileSystem.FileSystem);

    return {
      exit,
      stdout: lines.map((line) => `${String(line)}\n`).join(""),
      spans,
      logs,
      files: yield* disk.files,
      calls: calls.map(({ method, args }): { readonly method: string; readonly args: ReadonlyArray<unknown> } => ({
        method,
        args,
      })),
    } satisfies Ran;
  }).pipe(
    Effect.provide(
      Layer.mergeAll(
        Recorder.layer(FileSystem.FileSystem, disk.fileSystem),
        Path.layer,
        ConfigProvider.layer(
          world.unreadable === true
            ? ConfigProvider.make(() => Effect.fail(new ConfigProvider.SourceError({ message: "refused" })))
            : ConfigProvider.fromEnv({ env: { ...world.env } }),
        ),
        Stdio.layerTest({}),
        Layer.succeed(Terminal.Terminal, terminal),
        Layer.succeed(
          ChildProcessSpawner.ChildProcessSpawner,
          ChildProcessSpawner.make(() => Effect.die("unused")),
        ),
      ),
    ),
    Effect.provide(Logger.layer([logger])),
    Effect.provideService(References.MinimumLogLevel, "All"),
    Effect.provideService(Tracer.Tracer, tracer),
  );
};

// ---------------------------------------------------------------------------------------------
// What a run answered
// ---------------------------------------------------------------------------------------------

/** The one error of a failed run, as data: `answer` fails the law when the run left a defect or a second failure beside it. */
export const failure = (ran: Ran) => {
  const found = answer(ran.exit);

  if (found._tag !== "failed") {
    return expect.fail("the run was to fail, and it ended");
  }

  return found;
};

/** The spans a run ended whose name opens `config.`. */
/** The faults a read of either configuration file would meet: each call that finds or reads one fails. */
export const readFaults = (s: Scene, repo: string): ReadonlyArray<MemoryFiles.Fault> =>
  [repoPath(s, repo), userPath(s)].map((path) => ({
    ...readRefused(path, "PermissionDenied"),
    method: ["exists", "readFile", "readFileString"],
  }));

export const configSpans = (ran: Ran) => ran.spans.filter((span) => span.name.startsWith("config."));

/** What a failed run can print: the cause as pretty-printed, and each error's message, cause and every property. */
const failureTexts = (exit: Exit.Exit<unknown, unknown>): ReadonlyArray<string> =>
  Exit.isFailure(exit)
    ? [
        Cause.pretty(exit.cause),
        ...exit.cause.reasons.flatMap((reason) =>
          reason._tag === "Fail" && reason.error instanceof Error
            ? [
                reason.error.message,
                String(reason.error.cause),
                inspect(reason.error, { depth: null, customInspect: false, showHidden: true }),
              ]
            : [],
        ),
      ]
    : [];

/** Every text a run can print: standard output, each log line, each span's name and attributes and events, and the failure. */
export const printed = (ran: Ran): ReadonlyArray<string> => [
  ran.stdout,
  ...ran.logs,
  ...ran.spans.flatMap((span) => [
    span.name,
    ...[...span.attributes.entries()].map(([key, held]) => `${key}=${String(held)}`),
    ...span.events.flatMap(([name, , attributes]) => [
      name,
      ...Object.entries(attributes).map(([key, held]) => `${key}=${String(held)}`),
    ]),
  ]),
  ...failureTexts(ran.exit),
];

// ---------------------------------------------------------------------------------------------
// Names a person types
// ---------------------------------------------------------------------------------------------

/** Edits from one name to another, a swap of two letters counting as one: the distance the suggestion is made by. */
const distance = (a: string, b: string): number => {
  const rows: Array<Array<number>> = Array.from({ length: a.length + 1 }, (_, i) =>
    Array.from({ length: b.length + 1 }, (_, j) => (i === 0 ? j : j === 0 ? i : 0)),
  );

  const cell = (i: number, j: number) => rows[i]?.[j] ?? 0;

  for (let i = 1; i <= a.length; i++) {
    for (let j = 1; j <= b.length; j++) {
      const same = a[i - 1] === b[j - 1] ? 0 : 1;
      const swap = i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1] ? cell(i - 2, j - 2) + 1 : Infinity;
      const row = rows[i];

      if (row !== undefined) {
        row[j] = Math.min(cell(i - 1, j) + 1, cell(i, j - 1) + 1, cell(i - 1, j - 1) + same, swap);
      }
    }
  }

  return cell(a.length, b.length);
};

/** The names nearest to `typed`, when the nearest is within two edits: any of them is the one a message may suggest. */
export const nearest = (names: ReadonlyArray<string>, typed: string): ReadonlyArray<string> => {
  const near = Math.min(...names.map((name) => distance(name, typed)));

  return near <= 2 ? names.filter((name) => distance(name, typed) === near) : [];
};

/** The messages an unknown name may end in: `there is no setting <typed>.`, and the suggestion when a name is near. */
export const unknownTexts = (names: ReadonlyArray<string>, typed: string): ReadonlyArray<string> => {
  const near = nearest(names, typed);

  return near.length === 0
    ? [`there is no setting ${typed}.`]
    : near.map((name) => `there is no setting ${typed}. Did you mean ${name}?`);
};

/** A name one edit from `name`: its last letter swapped for another. */
export const oneEdit = (name: string): string => `${name.slice(0, -1)}${name.endsWith("q") ? "z" : "q"}`;

/** A name two edits from `name`: two letters deleted. */
export const twoEdits = (name: string): string => `${name.slice(0, 1)}${name.slice(3)}`;

/** A name no name is near: longer than any a draw makes. */
export const FAR = "q".repeat(24);

/** The names `get` is not to find although an object holds them. */
export const OBJECT_NAMES: ReadonlyArray<string> = [
  "constructor",
  "toString",
  "__proto__",
  "hasOwnProperty",
  "valueOf",
];

export const forms = (secret: string) => [secret, JSON.stringify(secret).slice(1, -1), encodeURIComponent(secret)];

// ---------------------------------------------------------------------------------------------
// The classes the laws list
// ---------------------------------------------------------------------------------------------

/** What a scene shows of its descriptions and sources: the facts a law lists as classes it must reach. */
export type Fact =
  | "source:default"
  | "source:env"
  | "source:repo"
  | "source:user-home"
  | "source:user-app-home"
  | "break:lf"
  | "break:crlf"
  | "break:cr"
  | "final:lf"
  | "final:crlf"
  | "mark:file-only"
  | "mark:live"
  | "mark:window";

export const FACTS: ReadonlyArray<Fact> = [
  "source:default",
  "source:env",
  "source:repo",
  "source:user-home",
  "source:user-app-home",
  "break:lf",
  "break:crlf",
  "break:cr",
  "final:lf",
  "final:crlf",
  "mark:file-only",
  "mark:live",
  "mark:window",
];

/** A run that ended: its exit is a success, and the label and the cause say which run when it is not. */
export const ended = (ran: Ran, label: string) =>
  expect(
    Exit.isSuccess(ran.exit),
    `${label}: ${Exit.isFailure(ran.exit) ? Cause.pretty(ran.exit.cause) : "ended"}`,
  ).toBe(true);

/** The facts one scene shows. */
export const facts = (s: Scene): ReadonlyArray<Fact> =>
  s.entries.flatMap((e): ReadonlyArray<Fact> => {
    const inner = e.spec.description.replace(/(\r\n|\r|\n)$/u, "");

    return [
      e.source === "user" ? (s.userAt === "home" ? "source:user-home" : "source:user-app-home") : `source:${e.source}`,
      ...(inner.includes("\r\n") ? (["break:crlf"] as const) : []),
      ...(/\r(?!\n)/u.test(inner) ? (["break:cr"] as const) : []),
      ...(/(?<!\r)\n/u.test(inner) ? (["break:lf"] as const) : []),
      ...(/(?<!\r)\n$/u.test(e.spec.description) ? (["final:lf"] as const) : []),
      ...(/\r\n$/u.test(e.spec.description) ? (["final:crlf"] as const) : []),
      ...(e.spec.fileOnly ? (["mark:file-only"] as const) : []),
      ...(e.spec.live ? (["mark:live"] as const) : []),
      ...(e.setting === debounce ? (["mark:window"] as const) : []),
    ];
  });

export type ListId =
  | "plain"
  | "app-home"
  | "shared-live"
  | "two-live"
  | "same-field"
  | "empty-group"
  | "no-groups"
  | "breaks"
  | "file-only"
  | "window-user"
  | "names"
  | "values";

export const LIST_IDS: ReadonlyArray<ListId> = [
  "plain",
  "app-home",
  "shared-live",
  "two-live",
  "same-field",
  "empty-group",
  "no-groups",
  "breaks",
  "file-only",
  "window-user",
  "names",
  "values",
];

const PLAIN: ReadonlyArray<Row> = [
  { kind: "int", source: "env" },
  { kind: "literal", source: "repo" },
  { kind: "text", source: "user" },
  { kind: "pattern", source: "default" },
  { kind: "required", source: "repo" },
  { kind: "array", source: "repo" },
  { kind: "record", source: "user" },
];

/** Scenes for `list`: one for each class of the plan's (k), (l), (s), (c), (t) and (y) a listing shows. A lone `\r` never ends a description: the blank line after a block would turn it into `\r\n`. */
export const listed = (draw: CliDraw): ReadonlyArray<{ readonly id: ListId; readonly scene: Scene }> => [
  {
    id: "plain",
    scene: scene(draw, PLAIN, [
      [0, 1],
      [2, 3],
      [4, 5, 6],
    ]),
  },
  {
    id: "app-home",
    scene: scene(
      draw,
      PLAIN,
      [
        [0, 1, 2],
        [3, 4],
        [5, 6],
      ],
      { user: "app-home" },
    ),
  },
  {
    // A setting object two groups share is read once, and the quiet window of its live mark is there once.
    id: "shared-live",
    scene: scene(
      draw,
      [
        { kind: "int", source: "env" },
        { kind: "literal", source: "repo", live: true },
        { kind: "text", source: "default" },
      ],
      [
        [0, 1],
        [1, 2],
      ],
    ),
  },
  {
    id: "two-live",
    scene: scene(
      draw,
      [
        { kind: "int", source: "default", live: true },
        { kind: "text", source: "user", live: true },
        { kind: "pattern", source: "repo" },
      ],
      [[0], [1], [2]],
      { window: "repo" },
    ),
  },
  {
    id: "same-field",
    scene: scene(
      draw,
      [
        { kind: "int", source: "repo" },
        { kind: "int", source: "env", name: `${draw.tables[1]}.${draw.keys[0]}` },
        { kind: "text", source: "default" },
      ],
      [[0], [1], [2]],
    ),
  },
  { id: "empty-group", scene: scene(draw, PLAIN.slice(0, 3), [[0, 1], [], [2]]) },
  { id: "no-groups", scene: scene(draw, [], []) },
  {
    id: "breaks",
    scene: scene(
      draw,
      [
        { kind: "int", source: "default", br: "\n" },
        { kind: "text", source: "repo", br: "\r\n" },
        { kind: "pattern", source: "user", br: "\r" },
        { kind: "literal", source: "env", br: "\n", final: true },
        { kind: "branded", source: "default", br: "\r\n", final: true },
      ],
      [
        [0, 1, 2],
        [3, 4],
      ],
    ),
  },
  {
    id: "file-only",
    scene: scene(
      draw,
      [
        { kind: "text", source: "repo", fileOnly: true },
        { kind: "int", source: "default", fileOnly: true },
        { kind: "literal", source: "user", fileOnly: true, live: true },
      ],
      [[0, 1, 2]],
    ),
  },
  {
    id: "window-user",
    scene: scene(
      draw,
      [
        { kind: "int", source: "repo", live: true },
        { kind: "text", source: "default" },
      ],
      [[0, 1]],
      {
        window: "user",
      },
    ),
  },
  {
    // Names an object holds as its own: a setting called `constructor` is found, and one not declared is not.
    id: "names",
    scene: scene(
      draw,
      [
        { kind: "text", source: "repo", name: "constructor" },
        { kind: "int", source: "default", name: "to-string" },
        { kind: "literal", source: "env" },
      ],
      [[0, 1, 2]],
    ),
  },
  {
    // A text value with each kind of break and a tab, from each source: JSON writes them on one line.
    id: "values",
    scene: scene(
      draw,
      [
        { kind: "text", source: "default", text: "line one\nline two" },
        { kind: "text", source: "repo", text: "a\r\nb" },
        { kind: "text", source: "env", text: "x\ry" },
        { kind: "text", source: "user", text: "tab\tand 雪\n" },
      ],
      [
        [0, 1],
        [2, 3],
      ],
    ),
  },
];

/** Three groups of two settings: each holds exactly one key of the repo file, so a group left out leaves exactly one key no setting names. */
export const seen = (draw: CliDraw): Scene =>
  scene(
    draw,
    [
      { kind: "int", source: "repo" },
      { kind: "text", source: "default" },
      { kind: "literal", source: "repo", files: ["repo"] },
      { kind: "pattern", source: "user", live: true },
      { kind: "array", source: "repo" },
      { kind: "record", source: "default" },
    ],
    [
      [0, 1],
      [2, 3],
      [4, 5],
    ],
  );

/** A scene whose repo file holds no key: every value comes from the default, a variable or the user file. */
export const quiet = (draw: CliDraw): Scene =>
  scene(
    draw,
    [
      { kind: "int", source: "env", files: ["user"] },
      { kind: "text", source: "user" },
      { kind: "literal", source: "default" },
    ],
    [[0, 1, 2]],
  );

/** The setting rows `set` and `remove` are tried on: each scope, a file-only setting and a live one, in two groups. */
export const writable = (draw: CliDraw, user: "home" | "app-home" = "home"): Scene =>
  scene(
    draw,
    [
      { kind: "int", source: "repo", files: ["repo", "user"] },
      { kind: "text", source: "user", files: ["user", "repo"] },
      { kind: "literal", source: "user", files: ["user"] },
      { kind: "pattern", source: "default", files: ["repo"] },
      { kind: "branded", source: "repo", fileOnly: true },
      { kind: "int", source: "default", live: true },
    ],
    [
      [0, 1, 2],
      [3, 4, 5],
    ],
    { user },
  );

/** A value text for a setting of a kind, and the value it reads as: what a variable of that text would give. */
export const textFor = (draw: CliDraw, kind: Kind, n: number) =>
  SCALARS.includes(kind) ? variableText(draw, kind, n) : { text: "", value: "" };

/** A text its setting's schema refuses, for a kind that refuses some. */
export const REFUSED: Readonly<Partial<Record<Kind, string>>> = {
  int: "abc",
  required: "70000",
  literal: "nope",
  pattern: "ABC1",
};
