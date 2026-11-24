import { inspect } from "node:util";
/**
 * What the laws RF1 to RF6 and RF8 of ticket 1995 share (Cli.refusals.test.ts): the draws, the settings of each
 * class of schema, the faults each read can meet, the runners (a start, a disk call, an edit and the command, each under
 * a recording tracer and logger), and the text each refusal must say, written here from the plan's tables and never from
 * the code under test.
 *
 * Every draw is an Effect Schema, so each has its own Arbitrary. A law builds one case for each class it lists from the
 * drawn seeds, never the cross product, and `Reach.done` fails when a class was not reached.
 */
import { expect } from "@effect/vitest";
import type { Option } from "effect";
import {
  Cause,
  ConfigProvider,
  Effect,
  Exit,
  Layer,
  Logger,
  PlatformError,
  References,
  Schema,
  SchemaGetter,
  SchemaIssue,
  Tracer,
} from "effect";
import { run, type World } from "./Cli.test-support.ts";
import { Setting, SettingGroup } from "./index.ts";
import * as MemoryFiles from "./MemoryFiles.test-support.ts";
import { Reach } from "./SettingGroup.edit.test-support.ts";

export { Reach };

type AnyGroup = SettingGroup.SettingGroup<string, ReadonlyArray<Setting.Any>>;

const VERSION = "1.2.3";

// ---------------------------------------------------------------------------------------------
// The draws
// ---------------------------------------------------------------------------------------------

const clean = Schema.makeFilter(
  (text: string) =>
    !["person", "instance", "config", "watch", "debounce", "home", "version", "constructor", "string", "proto"].some(
      (word) => text.includes(word),
    ),
);

/** A word of two to six lower-case letters: an app, a table, a key, a title word. */
const Word = Schema.String.check(Schema.isPattern(/^[a-z]{2,6}$/u), clean);

/** A secret-looking text: a needle, then a space, a `"` and a `/`, so its JSON and URL forms differ from the raw form. */
const Secret = Schema.String.check(Schema.isPattern(/^zq[a-z]{8} "\/[a-z]{2}$/u));

/** A needle number: eight digits. */
const Digits = Schema.Int.check(Schema.isBetween({ minimum: 10000000, maximum: 99999999 }));

const Bound = Schema.Int.check(Schema.isBetween({ minimum: 1, maximum: 999 }));

const Pad = Schema.Int.check(Schema.isBetween({ minimum: 0, maximum: 3 }));

const HomeFolder = Schema.String.check(Schema.isPattern(/^\/people\/[a-z]{3,6}$/u));

const RepoFolder = Schema.String.check(Schema.isPattern(/^\/work\/[a-z]{3,6}$/u));

const MovedFolder = Schema.String.check(Schema.isPattern(/^\/moved\/[a-z]{3,6}$/u));

/** The tags of a system error a read can fail with, other than a missing path. */
const OTHER_TAGS = [
  "Busy",
  "TimedOut",
  "Unknown",
  "InvalidData",
  "UnexpectedEof",
  "WouldBlock",
  "WriteZero",
  "AlreadyExists",
] as const;

const SYSTEM_TAGS = ["PermissionDenied", "BadResource", ...OTHER_TAGS] as const;

const Code = Schema.String.check(Schema.isPattern(/^E[A-Z]{2,6}$/u));

/** What every law draws: names, needles, a bound, the lines before the key, and the folders. */
const Core = Schema.Struct({
  app: Word,
  words: Schema.Array(Word).check(Schema.isMinLength(12), Schema.isMaxLength(12)),
  secret: Secret,
  other: Secret,
  number: Digits,
  bound: Bound,
  pad: Pad,
  home: HomeFolder,
  repo: RepoFolder,
  moved: MovedFolder,
});

export const RuleDraw = Core;

export type RuleDraw = typeof RuleDraw.Type;

/** RF2 draws which of the two schemas the sources refuse a value of. */
export const SourceDraw = Schema.Struct({ ...Core.fields, kind: Schema.Literals(["b", "j"]) });

export type SourceDraw = typeof SourceDraw.Type;

export const FaultDraw = Schema.Struct({
  ...Core.fields,
  /** The tag of (u). */
  tag: Schema.Literals(OTHER_TAGS),
  /** The tag of (q), (x) and (y). */
  anyTag: Schema.Literals(SYSTEM_TAGS),
  code: Code,
  which: Schema.Boolean,
});

export type FaultDraw = typeof FaultDraw.Type;

export const EnvironmentDraw = Schema.Struct({ ...Core.fields, message: Secret });

export type EnvironmentDraw = typeof EnvironmentDraw.Type;

// ---------------------------------------------------------------------------------------------
// Names
// ---------------------------------------------------------------------------------------------

export const settingName = (draw: RuleDraw) => `${draw.words[0]}.${draw.words[1]}`;

/** The environment variable that sets a setting: `DEMO_NET_PORT`. */
export const variable = (draw: RuleDraw) => [draw.app, ...settingName(draw).split(".")].join("_").toUpperCase();

const homeVariable = (draw: RuleDraw) => `${draw.app.toUpperCase()}_HOME`;

export const repoName = (draw: RuleDraw) => `.${draw.app}/${draw.app}.toml`;

export const repoPath = (draw: RuleDraw) => `${draw.repo}/.${draw.app}/${draw.app}.toml`;

const homePath = (draw: RuleDraw) => `${draw.home}/.${draw.app}/${draw.app}.toml`;

const movedPath = (draw: RuleDraw) => `${draw.moved}/${draw.app}.toml`;

/** Every form a text may take: raw, JSON-escaped and URL-encoded. */
export const forms = (text: string) => [text, JSON.stringify(text).slice(1, -1), encodeURIComponent(text)];

// ---------------------------------------------------------------------------------------------
// RF1: the classes of schema, each as a setting, the value the file holds and the tail the message ends with
// ---------------------------------------------------------------------------------------------

export type RuleId = "a" | "b" | "c" | "d" | "e" | "f" | "g" | "h" | "i" | "j" | "n";

export const RULE_IDS: ReadonlyArray<RuleId> = ["a", "b", "c", "d", "e", "f", "g", "h", "i", "j", "n"];

interface RuleCase {
  readonly id: RuleId;
  readonly setting: Setting.Any;
  /** The value as the file writes it. */
  readonly raw: string;
  /** The same value as a variable's or a flag's text, for the classes whose value is one scalar. */
  readonly text: string;
  /** What follows `<name> is not `. */
  readonly tail: string;
  /** What no rendering may hold. */
  readonly needles: ReadonlyArray<string>;
}

/** A setting of the drawn name over a schema of plain data, with the description every setting needs. */
const made = <C extends Schema.Codec<any, unknown>>(draw: RuleDraw, schema: Setting.PlainSchema<C>): Setting.Any =>
  Setting.make(settingName(draw), schema).pipe(Setting.withDescription("A setting."));

const odd = (n: number) => (n % 2 === 0 ? n + 1 : n);

const title = (draw: RuleDraw) => `a ${draw.words[2]} ${draw.words[3]}`;

const description = (draw: RuleDraw) => `Use ${draw.words[4]} ${draw.words[5]}.`;

/** The declared text of (j). */
const declared = (draw: RuleDraw) => `an even number of ${draw.words[6]}`;

const even = Schema.makeFilter((n: number) => n % 2 === 0);

const quoted = Schema.makeFilter((text: string) => `${text} is bad`);

const first = (draw: RuleDraw) => `${draw.words[8]}`;

const second = (draw: RuleDraw) => `${draw.words[8]}${draw.words[9]}`;

const literals = (draw: RuleDraw) => [`${draw.words[10]}`, `${draw.words[10]}${draw.words[11]}`] as const;

/** One case for each class (a) to (n), built from the drawn seeds. */
export const ruleCases = (draw: RuleDraw): ReadonlyArray<RuleCase> => {
  const refused = forms(draw.secret);
  const small = -draw.number;
  const text = JSON.stringify(draw.secret);
  const [one, two] = literals(draw);
  const own = draw.number;

  return [
    {
      id: "a",
      setting: made(draw, Schema.Finite),
      raw: text,
      text: draw.secret,
      tail: "a valid value. Expected number.",
      needles: refused,
    },
    {
      id: "b",
      setting: made(draw, Schema.Finite.check(Schema.isGreaterThan(draw.bound))),
      raw: String(small),
      text: String(small),
      tail: `a valid value. Expected a value greater than ${draw.bound}.`,
      needles: [String(own)],
    },
    {
      id: "c",
      setting: made(draw, Schema.Finite.check(even)),
      raw: String(odd(own)),
      text: String(odd(own)),
      tail: "a valid value. Its schema names no rule.",
      needles: [String(odd(own))],
    },
    {
      id: "d",
      setting: made(draw, Schema.String.check(quoted)),
      raw: text,
      text: draw.secret,
      tail: "a valid value. Its schema names no rule.",
      needles: refused,
    },
    {
      id: "e",
      setting: made(draw, Schema.Finite.annotate({ title: title(draw), description: description(draw) })),
      raw: text,
      text: draw.secret,
      tail: `${title(draw)}. ${description(draw)}`,
      needles: refused,
    },
    {
      id: "f",
      setting: made(draw, Schema.Finite.check(Schema.isGreaterThan(draw.bound)).annotate({ title: title(draw) })),
      raw: String(small),
      text: String(small),
      tail: `${title(draw)}. Expected a value greater than ${draw.bound}.`,
      needles: [String(own)],
    },
    {
      id: "g",
      setting: made(draw, Schema.Finite.annotate({ description: description(draw) })),
      raw: text,
      text: draw.secret,
      tail: `a valid value. ${description(draw)}`,
      needles: refused,
    },
    {
      id: "h",
      setting: made(draw, Schema.Literals([one, two])),
      raw: text,
      text: draw.secret,
      tail: `a valid value. Expected "${one}" | "${two}".`,
      needles: refused,
    },
    {
      id: "i",
      setting: made(draw, Schema.Record(Schema.String, Schema.Finite)),
      raw: `{ ${JSON.stringify(draw.other)} = ${text} }`,
      text: draw.secret,
      tail: "a valid value. Expected number.",
      needles: [...refused, ...forms(draw.other)],
    },
    {
      id: "j",
      setting: made(
        draw,
        Schema.Finite.check(Schema.makeFilter((n: number) => n % 2 === 0, { expected: declared(draw) })),
      ),
      raw: String(odd(own)),
      text: String(odd(own)),
      tail: `a valid value. Expected ${declared(draw)}.`,
      needles: [String(odd(own))],
    },
    {
      id: "n",
      setting: made(draw, Schema.Struct({ [first(draw)]: Schema.Finite, [second(draw)]: Schema.Finite })),
      raw: `{ ${first(draw)} = 1 }`,
      text: "",
      tail: "a valid value. Expected a table with every key it needs.",
      needles: [],
    },
  ];
};

export const makeGroup = (draw: RuleDraw, settings: ReadonlyArray<Setting.Any>): AnyGroup =>
  SettingGroup.make(draw.app, ...settings);

export type MoreId = "o" | "u" | "m" | "v";

export const MORE_IDS: ReadonlyArray<MoreId> = ["o", "u", "m", "v"];

/** A text that cannot be decoded, and whose failure quotes it in a message written at run time. */
const Broken = Schema.String.pipe(
  Schema.decodeTo(Schema.String, {
    decode: SchemaGetter.transformEffect((text: string) =>
      Effect.fail(new SchemaIssue.InvalidValue({ message: `${text} is bad` })),
    ),
    encode: SchemaGetter.transform((text: string) => text),
  }),
);

/**
 * The classes of RF9, which RF1's do not reach: (o) a union that must match exactly one member and matches two, (u) a table given a key it does not have, (m) a title and a check that declares no rule, (v) a transformation that fails with a message that quotes the value.
 */
export const moreCases = (draw: RuleDraw): ReadonlyArray<Omit<RuleCase, "id"> & { readonly id: MoreId }> => {
  const [one, two] = literals(draw);
  const text = JSON.stringify(draw.secret);

  return [
    {
      id: "o",
      setting: made(draw, Schema.Union([Schema.Literals([one, two]), Schema.Literal(one)], { mode: "oneOf" })),
      raw: JSON.stringify(one),
      text: one,
      tail: `a valid value. Expected "${one}" | "${two}" | "${one}".`,
      needles: [],
    },
    {
      id: "u",
      setting: made(draw, Schema.Struct({ [first(draw)]: Schema.Finite, [second(draw)]: Schema.Finite })),
      raw: `{ ${first(draw)} = 1, ${second(draw)} = 2, ${JSON.stringify(draw.other)} = 3 }`,
      text: "",
      tail: "a valid value. Expected a table with no other keys.",
      needles: forms(draw.other),
    },
    {
      id: "m",
      setting: made(draw, Schema.Finite.check(even).annotate({ title: title(draw) })),
      raw: String(odd(draw.number)),
      text: String(odd(draw.number)),
      tail: `${title(draw)}.`,
      needles: [String(odd(draw.number))],
    },
    {
      id: "v",
      setting: made(draw, Broken),
      raw: text,
      text: draw.secret,
      tail: "a valid value. Its schema names no rule.",
      needles: forms(draw.secret),
    },
  ];
};

/** The message of a file that gives a value to a name that is a table of settings: the line of the key, and the table's own name. */
export const tableMessage = (draw: RuleDraw) => {
  const [table] = settingName(draw).split(".");

  return {
    text: `${Array.from({ length: draw.pad }, (_, n) => `# note ${n}\n`).join("")}${table} = 3\n`,
    message: `${repoName(draw)}, line ${draw.pad + 1}: ${table} is a table of settings, not a value.\n  ${draw.app} did not start.`,
  };
};

/** A file of a table and a key: `pad` comment lines, the table's header, then the key, which sits on line `pad + 2`. */
export const fileText = (draw: RuleDraw, raw: string) => {
  const notes = Array.from({ length: draw.pad }, (_, n) => `# note ${n}\n`).join("");
  const [table, key] = settingName(draw).split(".");

  return `${notes}[${table}]\n${key} = ${raw}\n`;
};

export const keyLine = (draw: RuleDraw) => draw.pad + 2;

// ---------------------------------------------------------------------------------------------
// Running: a start, a disk call, an edit and the command, each under a recording tracer and logger
// ---------------------------------------------------------------------------------------------

export interface Observed {
  readonly exit: Exit.Exit<unknown, unknown>;
  readonly spans: ReadonlyArray<Tracer.NativeSpan>;
  readonly logs: ReadonlyArray<string>;
  /** Every file the disk holds when the run is over, where the run has a disk that changes. */
  readonly files: Readonly<Record<string, string>>;
  /** What the command printed. */
  readonly stdout: string;
}

const recording = () => {
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

  return {
    spans,
    logs,
    under: <A, E, R>(effect: Effect.Effect<A, E, R>) =>
      effect.pipe(
        Effect.provide(Logger.layer([logger])),
        Effect.provideService(References.MinimumLogLevel, "All"),
        Effect.provideService(Tracer.Tracer, tracer),
      ),
  };
};

interface Scene {
  readonly files?: Readonly<Record<string, string>>;
  /** A read of the path fails with the error. */
  readonly broken?: Readonly<Record<string, PlatformError.PlatformError>>;
  readonly env?: Readonly<Record<string, string>>;
  readonly provider?: ConfigProvider.ConfigProvider;
  readonly flags?: Readonly<Record<string, Option.Option<string>>>;
  readonly repo: string;
}

/** The start on a scene. */
export const startOn = (group: AnyGroup, scene: Scene) => {
  const rec = recording();

  return Effect.gen(function* () {
    const exit = yield* Effect.scoped(
      Layer.build(
        SettingGroup.layer(group, { version: VERSION, repo: scene.repo, flags: { ...scene.flags } }).pipe(
          Layer.provide(
            MemoryFiles.layer({
              files: scene.files ?? {},
              ...(scene.broken === undefined ? {} : { broken: scene.broken }),
            }),
          ),
        ),
      ),
    ).pipe(
      Effect.provide(ConfigProvider.layer(scene.provider ?? ConfigProvider.fromEnv({ env: { ...(scene.env ?? {}) } }))),
      Effect.exit,
    );

    return { exit, spans: rec.spans, logs: rec.logs, files: scene.files ?? {}, stdout: "" } satisfies Observed;
  }).pipe(rec.under);
};

/** A disk the program changes: the file system faults are planted in, and the files it holds. */
interface Disk {
  readonly files: Readonly<Record<string, string>>;
  readonly faults?: ReadonlyArray<MemoryFiles.Fault>;
  readonly env: Readonly<Record<string, string>>;
  readonly repo: string;
}

/** `SettingGroup.set` or `SettingGroup.remove` on a disk. */
export const onDisk = (
  group: AnyGroup,
  setting: Setting.Any,
  call: { readonly kind: "set"; readonly value: unknown } | { readonly kind: "remove" },
  disk: Disk,
) => {
  const rec = recording();
  const held = MemoryFiles.writable({ files: disk.files, faults: disk.faults ?? [] });

  return Effect.gen(function* () {
    const exit = yield* (
      call.kind === "set"
        ? SettingGroup.set(group, setting, call.value, "repo", { repo: disk.repo })
        : SettingGroup.remove(group, setting, "repo", { repo: disk.repo })
    ).pipe(
      Effect.provide(held.layer),
      Effect.provide(ConfigProvider.layer(ConfigProvider.fromEnv({ env: { ...disk.env } }))),
      Effect.exit,
    );

    return { exit, spans: rec.spans, logs: rec.logs, files: yield* held.files, stdout: "" } satisfies Observed;
  }).pipe(rec.under);
};

/** `SettingGroup.edit(...).set` on a text, in memory. */
export const edited = (group: AnyGroup, setting: Setting.Any, text: string, value: unknown) => {
  const rec = recording();

  return Effect.gen(function* () {
    const exit = yield* Effect.exit(SettingGroup.edit(group, text, "repo").set(setting, value));

    return { exit, spans: rec.spans, logs: rec.logs, files: {}, stdout: "" } satisfies Observed;
  }).pipe(rec.under);
};

/** The command, as `run` runs it. */
export const command = (world: World, args: ReadonlyArray<string>) =>
  Effect.map(run(world, args), (ran): Observed => ({
    exit: ran.exit,
    spans: ran.spans,
    logs: ran.logs,
    files: ran.files,
    stdout: ran.stdout,
  }));

// ---------------------------------------------------------------------------------------------
// What a run answered
// ---------------------------------------------------------------------------------------------

interface Refusal {
  readonly error: SettingGroup.SettingsError;
  readonly reason: string;
  readonly file: string | undefined;
  readonly line: number | undefined;
  readonly message: string;
}

/** The one error of a failed run: never two failures, and never a defect beside it. */
export const refusal = (observed: Observed): Refusal => {
  if (Exit.isSuccess(observed.exit)) {
    return expect.fail("the call was to fail, and it ended");
  }

  const errors = observed.exit.cause.reasons.flatMap((reason) => (reason._tag === "Fail" ? [reason.error] : []));
  const error = errors[0];

  expect(observed.exit.cause.reasons, "one failure and no defect").toHaveLength(1);
  expect(error).toBeInstanceOf(SettingGroup.SettingsError);

  if (!Schema.is(SettingGroup.SettingsError)(error)) {
    return expect.fail("the failure is no SettingsError");
  }

  return { error, reason: error.reason, file: error.file, line: error.line, message: error.message };
};

/** Every text a run can print: the error as each rendering writes it, each span's name, attributes and ended exit, and each log line. */
export const printed = (observed: Observed): ReadonlyArray<string> => {
  const failures = Exit.isFailure(observed.exit)
    ? [
        Cause.pretty(observed.exit.cause),
        ...observed.exit.cause.reasons.flatMap((reason) =>
          reason._tag === "Fail"
            ? [
                String(reason.error),
                JSON.stringify(reason.error),
                inspect(reason.error, { depth: null, showHidden: true, customInspect: false }),
                ...(reason.error instanceof Error ? [reason.error.message] : []),
              ]
            : [],
        ),
      ]
    : [];

  const spans = observed.spans.flatMap((span) => [
    span.name,
    ...[...span.attributes.entries()].map(([key, held]) => `${key}=${String(held)}`),
    ...(span.status._tag === "Ended" && Exit.isFailure(span.status.exit) ? [Cause.pretty(span.status.exit.cause)] : []),
  ]);

  return [...failures, ...spans, ...observed.logs, observed.stdout];
};

// ---------------------------------------------------------------------------------------------
// RF3: the read faults, each as the error a disk answers and the reason the message must give
// ---------------------------------------------------------------------------------------------

export type FaultId = "p" | "o" | "u" | "q" | "x" | "y" | "w";

export const FAULT_IDS: ReadonlyArray<FaultId> = ["p", "o", "u", "q", "x", "y", "w"];

/** A system error of a tag, as the read of `path` fails with it. */
const system = (tag: PlatformError.SystemErrorTag, path: string, cause?: unknown) =>
  PlatformError.systemError({
    // oxlint-disable-next-line fabrika/no-hand-tag -- edge: Effect PlatformError requires its own system error tag
    _tag: tag,
    module: "FileSystem",
    method: "readFileString",
    pathOrDescriptor: path,
    cause,
  });

/** A Node error with a `code`, as Node gives one: its message holds the path. */
const nodeError = (code: string, path: string) =>
  Object.assign(new Error(`${code}: operation failed, open '${path}'`), { code });

/** The words a tag is given: the three kinds the message tells apart. */
const kind = (tag: PlatformError.SystemErrorTag) => {
  switch (tag) {
    case "PermissionDenied":
      return "permission was denied";
    case "BadResource":
      return "it is not a plain file";
    default:
      return `the system gave the error ${tag}`;
  }
};

/** The read of `path` refused for want of permission. */
export const denial = (path: string) => system("PermissionDenied", path);

interface Fault {
  readonly id: FaultId;
  readonly error: PlatformError.PlatformError;
  /** What follows `because `, up to the full stop. */
  readonly because: string;
}

/** The fault of each class for the read of `path`. */
export const plant = (id: FaultId, draw: FaultDraw, path: string): Fault => {
  switch (id) {
    case "p":
      return { id, error: system("PermissionDenied", path), because: kind("PermissionDenied") };
    case "o":
      return { id, error: system("BadResource", path), because: kind("BadResource") };
    case "u":
      return { id, error: system(draw.tag, path), because: kind(draw.tag) };
    case "q":
      return {
        id,
        error: system(draw.anyTag, path, nodeError(draw.code, path)),
        because: `${kind(draw.anyTag)} (${draw.code})`,
      };
    case "x":
      return {
        id,
        error: system(draw.anyTag, path, { code: draw.which ? draw.home : draw.repo }),
        because: kind(draw.anyTag),
      };
    case "y":
      return { id, error: system(draw.anyTag, path, { code: `${draw.code}${draw.home}` }), because: kind(draw.anyTag) };
    case "w":
      return {
        id,
        error: PlatformError.badArgument({ module: "FileSystem", method: "readFileString", description: draw.home }),
        because: "its path is not valid",
      };
  }
};

export type ReadSite = "repo" | "home" | "app-home" | "disk-set" | "list";

export const READ_SITES: ReadonlyArray<ReadSite> = ["repo", "home", "app-home", "disk-set", "list"];

/** The file a person reads at a site, and the sentence that ends the message. */
export const siteWords = (draw: RuleDraw, site: ReadSite) => {
  const app = draw.app;

  switch (site) {
    case "repo":
      return { file: `.${app}/${app}.toml`, closing: `${app} did not start.` };
    case "home":
      return { file: `~/.${app}/${app}.toml`, closing: `${app} did not start.` };
    case "app-home":
      return { file: `$${app.toUpperCase()}_HOME/${app}.toml`, closing: `${app} did not start.` };
    case "disk-set":
      return { file: `.${app}/${app}.toml`, closing: `.${app}/${app}.toml was not changed.` };
    case "list":
      return { file: `.${app}/${app}.toml`, closing: `${app} would not start with these settings.` };
  }
};

/** The path a site reads. */
export const sitePath = (draw: RuleDraw, site: ReadSite) => {
  switch (site) {
    case "home":
      return homePath(draw);
    case "app-home":
      return movedPath(draw);
    default:
      return repoPath(draw);
  }
};

/** The setting a read fault is met under: a number with a default, so the file is all that can go wrong. */
export const plain = (draw: RuleDraw) =>
  Setting.make(settingName(draw), Schema.Finite).pipe(Setting.withDescription("A setting."), Setting.withDefault(1));

/** The call a site makes with its read failing with `error`. */
export const readAt = (draw: RuleDraw, site: ReadSite, error: PlatformError.PlatformError) => {
  const setting = plain(draw);
  const group = makeGroup(draw, [setting]);
  const path = sitePath(draw, site);
  const env = site === "app-home" ? { HOME: draw.home, [homeVariable(draw)]: draw.moved } : { HOME: draw.home };
  const present = { [repoPath(draw)]: "# note\n" };

  switch (site) {
    case "repo":
    case "home":
    case "app-home":
      return startOn(group, { files: present, broken: { [path]: error }, env, repo: draw.repo });
    case "disk-set":
      return onDisk(
        group,
        setting,
        { kind: "set", value: 2 },
        {
          files: present,
          faults: [{ method: ["readFile", "readFileString"], path, error }],
          env,
          repo: draw.repo,
        },
      );
    case "list":
      return command(
        {
          app: draw.app,
          groups: [group],
          repo: draw.repo,
          env,
          files: present,
          faults: [{ method: ["exists", "readFile", "readFileString"], path, error }],
        },
        ["list"],
      );
  }
};

/** The message a read fault must give. */
export const readMessage = (draw: RuleDraw, site: ReadSite, because: string) => {
  const { file, closing } = siteWords(draw, site);

  return `${file}: could not be read, because ${because}.\n  ${closing}`;
};

// ---------------------------------------------------------------------------------------------
// RF4: the environment that does not answer
// ---------------------------------------------------------------------------------------------

export type EnvironmentSite = "app-home" | "home" | "holder" | "resolve";

export const ENVIRONMENT_SITES: ReadonlyArray<EnvironmentSite> = ["app-home", "home", "holder", "resolve"];

/** A provider that answers every name it is asked for but one, and fails the `SourceError` for that one. */
export const failing = (draw: RuleDraw, site: EnvironmentSite, error: ConfigProvider.SourceError) => {
  let reads = 0;

  return ConfigProvider.make((path) => {
    const [name] = path;

    switch (name) {
      case homeVariable(draw):
        return site === "app-home" ? Effect.fail(error) : Effect.undefined;
      case "HOME":
        return site === "home" ? Effect.fail(error) : Effect.succeed(ConfigProvider.makeValue(draw.home));
      case variable(draw):
        // `resolve`'s read is the second ask for the variable: the first is the check of which source holds it.
        reads += 1;

        return site === "holder" || (site === "resolve" && reads > 1)
          ? Effect.fail(error)
          : Effect.succeed(ConfigProvider.makeValue("4200"));
      default:
        return Effect.undefined;
    }
  });
};

/** What each site's message names: the variable, or the setting. */
const NAMED: Readonly<Record<EnvironmentSite, (draw: RuleDraw) => string>> = {
  "app-home": homeVariable,
  home: () => "HOME",
  holder: settingName,
  resolve: settingName,
};

/** The message of a site. */
export const environmentMessage = (draw: RuleDraw, site: EnvironmentSite) => {
  const named = NAMED[site](draw);

  return `${named} could not be read, because the environment did not answer.\n  ${draw.app} did not start.`;
};

// ---------------------------------------------------------------------------------------------
// RF2 and RF6: a refused value from each source
// ---------------------------------------------------------------------------------------------

/** The setting RF2 refuses a value of: (b) or (j) of RF1's classes. */
export const sourced = (draw: SourceDraw): RuleCase => {
  const found = ruleCases(draw).find((one) => one.id === draw.kind);

  return found ?? expect.fail(`no class ${draw.kind}`);
};

/** `<R>`: the rule of a (b) or (j) setting, as the message says it. */
export const ruleText = (draw: SourceDraw) =>
  draw.kind === "b" ? `a value greater than ${draw.bound}` : declared(draw);

/** A value a call is given that the setting refuses: a number, as the schema of (b) and (j) types it. */
export const refusedValue = (c: RuleCase) => Number(c.text);
