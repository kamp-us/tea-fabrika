/**
 * What the laws of `SettingGroup.snapshots` and of the strict read (ticket 1845, slice 1) share: the generators, the rig that starts a group on files in memory, and the reach check.
 *
 * Every generator is an Effect Schema, so each has its own Arbitrary. A law builds one case for each class it lists from the drawn seeds, never the cross product, and `Reach.done` fails when a class was not reached. A snapshot that does not fit is always one the loader made, with one change of its class, so it passes every check of the read before its own.
 *
 * Nothing here reads a file. The files are `MemoryFiles.live`'s, and time is Effect's `TestClock`.
 */
import { createHash } from "node:crypto";
import { expect } from "@effect/vitest";
import type { FileSystem, Path } from "effect";
import {
  Cause,
  ConfigProvider,
  type Context,
  Effect,
  Exit,
  Layer,
  Match,
  Option,
  Predicate,
  Schema,
  SchemaGetter,
  SchemaIssue,
  Scope,
  Stream,
} from "effect";
import * as Digest from "effect/crypto/Digest";
import { TestClock } from "effect/testing";
import * as AppModule from "./App.ts";
import { Setting, SettingGroup } from "./index.ts";
import { hash, read } from "./internal/snapshot.ts";
import { watched } from "./internal/window.ts";
import * as MemoryFiles from "./MemoryFiles.test-support.ts";
import { Reach } from "./SettingGroup.edit.test-support.ts";
import * as OldSnapshot from "./Snapshot.ts";
import { Origin } from "./Sources.ts";

export { Reach };

const ROOT = "/work";

const HOME = "/people/one";

/** The folder `<APP>_HOME` names when a case moves the user file. */
const MOVED = "/people/moved";

const VERSION = "1.2.3";

const DEFAULT = 18787;

const Port = Schema.Int.check(Schema.isBetween({ minimum: 1, maximum: 65535 }));

const Pairing = Schema.Struct({ a: Schema.optionalKey(Schema.Int), b: Schema.optionalKey(Schema.Int) });

type Json = typeof Schema.Json.Type;

// ---------------------------------------------------------------------------------------------
// Draws
// ---------------------------------------------------------------------------------------------

const clean = Schema.makeFilter(
  (text: string) => !["person", "instance", "config", "watch", "debounce", "home"].some((word) => text.includes(word)),
);

const Word = Schema.String.check(Schema.isPattern(/^[a-z][a-z0-9]{3,7}$/u), clean);

const Table = Schema.String.check(Schema.isPattern(/^[a-z]{1,6}(-[a-z]{1,4})?$/u), clean);

const Key = Schema.String.check(Schema.isPattern(/^[a-z]{2,6}(-[a-z]{1,4})?$/u), clean);

const Slot = Schema.Struct({ table: Table, key: Key });

type Slot = typeof Slot.Type;

export const named = (slot: Slot) => `${slot.table}.${slot.key}`;

/** The environment variable that sets a setting: `DEMO_INSTANCE_PORT`. */
export const variable = (app: string, name: string) =>
  [app.toUpperCase(), ...name.split(".").map((word) => word.replace(/-/gu, "_").toUpperCase())].join("_");

const field = (name: string) =>
  (name.split(".").at(-1) ?? name).replace(/-([a-z0-9])/gu, (_, letter: string) => letter.toUpperCase());

/** Whether a group of these names can be read together: no two share a table, a field or a variable. */
const apart = (slots: ReadonlyArray<Slot>) =>
  new Set(slots.map((slot) => slot.table)).size === slots.length &&
  new Set(slots.map((slot) => field(named(slot)))).size === slots.length &&
  new Set(slots.map((slot) => variable("a", named(slot)))).size === slots.length;

const Pick = Schema.Int.check(Schema.isBetween({ minimum: 0, maximum: 999 }));

const Count = Schema.Int.check(Schema.isBetween({ minimum: 1000, maximum: 60000 }));

const Small = Schema.String.check(Schema.isPattern(/^[a-z]{1,6}$/u));

/** What every law draws: two apps, four names, and the seeds each class takes its numbers, words and choices from. */
export const Draw = Schema.Struct({
  app: Word,
  other: Word,
  a: Slot,
  b: Slot,
  c: Slot,
  d: Slot,
  words: Schema.Array(Small).check(Schema.isMinLength(4), Schema.isMaxLength(6)),
  numbers: Schema.Array(Count).check(Schema.isMinLength(4), Schema.isMaxLength(6)),
  picks: Schema.Array(Pick).check(Schema.isMinLength(8), Schema.isMaxLength(12)),
}).check(
  Schema.makeFilter(
    (draw) =>
      apart([draw.a, draw.b, draw.c, draw.d]) && !draw.app.includes(draw.other) && !draw.other.includes(draw.app),
  ),
);

export type Draw = typeof Draw.Type;

export const pick = (draw: Draw, n: number): number => draw.picks[n % draw.picks.length] ?? 0;

const number = (draw: Draw, n: number): number => draw.numbers[n % draw.numbers.length] ?? 4100;

const word = (draw: Draw, n: number): string => draw.words[n % draw.words.length] ?? "w";

// ---------------------------------------------------------------------------------------------
// Declared settings
// ---------------------------------------------------------------------------------------------

type Kind = "number" | "table" | "array" | "text";

/** One declared setting of a generated group. */
interface Decl {
  readonly name: string;
  readonly kind: Kind;
  readonly live?: boolean;
  readonly fileOnly?: boolean;
  readonly files?: Setting.Files;
  /** No default: a source must give it. */
  readonly required?: boolean;
  /** A wider schema for a number: any integer. Only for a loader of another build. */
  readonly wide?: boolean;
}

const marked = (live: boolean, fileOnly: boolean, made: Setting.Setting<string, any>): Setting.Any => {
  if (!fileOnly) {
    return live ? Setting.live(made) : made;
  }

  return live ? Setting.live(Setting.fileOnly(made)) : Setting.fileOnly(made);
};

const declare = (decl: Decl): Setting.Any => {
  const described = Setting.withDescription("A generated setting.");
  const scoped = Setting.files(decl.files ?? ["repo", "user"]);
  const live = decl.live === true;
  const fileOnly = decl.fileOnly === true;

  if (decl.kind === "number") {
    const schema = decl.wide === true ? Schema.Int : Port;
    const made = Setting.make(decl.name, schema).pipe(described, scoped);

    return marked(
      live,
      fileOnly,
      decl.required === true ? made : made.pipe(Setting.withDefault(decl.wide === true ? 70000 : DEFAULT)),
    );
  }

  if (decl.kind === "table") {
    const made = Setting.make(decl.name, Pairing).pipe(described, scoped);

    return marked(live, fileOnly, decl.required === true ? made : made.pipe(Setting.withDefault({ a: 90 })));
  }

  if (decl.kind === "array") {
    const made = Setting.make(decl.name, Schema.Array(Schema.Int)).pipe(described, scoped);

    return marked(live, fileOnly, decl.required === true ? made : made.pipe(Setting.withDefault([70])));
  }

  const made = Setting.make(decl.name, Schema.String).pipe(described, scoped);

  return marked(live, fileOnly, decl.required === true ? made : made.pipe(Setting.withDefault("fallback")));
};

const groupFrom = (app: string, settings: Array<Setting.Any>) => SettingGroup.make(app, ...settings);

const makeGroup = (app: string, decls: ReadonlyArray<Decl>) =>
  groupFrom(
    app,
    decls.map((decl) => declare(decl)),
  );

type Group = ReturnType<typeof makeGroup>;

/** The group as the strict read and the snapshots hold it: the settings, the quiet window included for a group with a live one. */
export const readGroup = (group: Group) => ({ app: group.app, settings: watched(group.settings) });

// ---------------------------------------------------------------------------------------------
// Sources and the rig
// ---------------------------------------------------------------------------------------------

type Source = "default" | "flag" | "env" | "repo" | "user";

/** One setting and the one source that gives its value. */
interface Put {
  readonly decl: Decl;
  readonly source: Source;
  readonly value: unknown;
}

/** What a start runs on: the group, the text of each file, the environment and the flags. */
interface Scene {
  readonly group: Group;
  readonly repo: string | undefined;
  readonly user: string | undefined;
  readonly env: Readonly<Record<string, string>>;
  readonly flags: Readonly<Record<string, Option.Option<string>>>;
  readonly moved: boolean;
}

const lines = (decl: Decl, value: unknown): ReadonlyArray<string> => {
  const [table = decl.name, key = decl.name] = decl.name.split(".");

  if (decl.kind === "table") {
    return [
      `[${decl.name}]`,
      ...(Predicate.isObject(value) ? Object.entries(value) : []).map(([name, entry]) => `${name} = ${String(entry)}`),
    ];
  }

  if (decl.kind === "array") {
    return [`[${table}]`, `${key} = [${(Array.isArray(value) ? value : []).map(String).join(", ")}]`];
  }

  return [`[${table}]`, `${key} = ${decl.kind === "text" ? JSON.stringify(value) : String(value)}`];
};

/** The text a flag or a variable gives: a number as its digits, a text as it is. */
const given = (decl: Decl, value: unknown): string => (decl.kind === "text" ? String(value) : String(value));

/** A scene from the settings and where each value comes from. A setting no put names takes its default. */
const sceneFrom = (app: string, decls: ReadonlyArray<Decl>, puts: ReadonlyArray<Put>, moved = false): Scene => {
  const from = (source: Source) => puts.filter((put) => put.source === source);

  const text = (source: Source) =>
    from(source).length === 0
      ? undefined
      : `${from(source)
          .flatMap((put) => lines(put.decl, put.value))
          .join("\n")}\n`;

  return {
    group: makeGroup(app, decls),
    repo: text("repo"),
    user: text("user"),
    env: {
      ...(moved ? { [`${app.toUpperCase()}_HOME`]: MOVED } : {}),
      ...Object.fromEntries(from("env").map((put) => [variable(app, put.decl.name), given(put.decl, put.value)])),
    },
    flags: Object.fromEntries(from("flag").map((put) => [put.decl.name, Option.some(given(put.decl, put.value))])),
    moved,
  };
};

export const siteFor = (app: string, moved: boolean) => ({
  repo: { dir: `${ROOT}/.${app}`, path: `${ROOT}/.${app}/${app}.toml`, name: `.${app}/${app}.toml` },
  user: moved
    ? { dir: MOVED, path: `${MOVED}/${app}.toml`, name: `$${app.toUpperCase()}_HOME/${app}.toml` }
    : { dir: `${HOME}/.${app}`, path: `${HOME}/.${app}/${app}.toml`, name: `~/.${app}/${app}.toml` },
});

/** A started group on a live disk, and the scope that ends it. */
interface Rig {
  readonly group: Group;
  readonly app: string;
  readonly disk: MemoryFiles.LiveDisk;
  readonly scope: Scope.Closeable;
  readonly context: Context.Context<
    SettingGroup.Identifier<string, Array<Setting.Any>> | FileSystem.FileSystem | Path.Path | Digest.Digest
  >;
  readonly window: number;
}

const started = (group: Group, scene: Scene, disk: MemoryFiles.LiveDisk, scope: Scope.Scope) =>
  Layer.buildWithScope(
    SettingGroup.layer(group, { version: VERSION, repo: ROOT, flags: scene.flags }).pipe(
      Layer.provideMerge(disk.layer),
      Layer.provideMerge(digestLayer),
    ),
    scope,
  ).pipe(Effect.provide(ConfigProvider.layer(ConfigProvider.fromEnv({ env: { HOME, ...scene.env } }))));

/**
 * The digest a running group makes its snapshots with: SHA-256 computed in the call, so an item of the stream is made in the turns the scheduler gives it and the law needs no real time. Effect's own layer runs on `crypto.subtle`, which answers on the event loop after a time no turn of the scheduler can count, so a law that read the items a fixed number of turns after a change read them early on a busy machine. Every read and every hash outside a running group is made on that layer.
 */
const digestLayer = Layer.succeed(Digest.Digest)({
  digest: (algorithm, data) =>
    Effect.sync(() =>
      algorithm.name === "SHA-256" ? new Uint8Array(createHash("sha256").update(data).digest()) : data,
    ),
  digestHex: (algorithm, data) =>
    Effect.sync(() => (algorithm.name === "SHA-256" ? createHash("sha256").update(data).digest("hex") : "")),
});

/** Starts the scene's group and keeps it running until the rig's scope closes. */
export const boot = Effect.fnUntraced(function* (scene: Scene) {
  const { group } = scene;
  const site = siteFor(group.app, scene.moved);

  const disk = yield* MemoryFiles.live({
    files: {
      ...(scene.repo === undefined ? {} : { [site.repo.path]: scene.repo }),
      ...(scene.user === undefined ? {} : { [site.user.path]: scene.user }),
    },
    folders: [ROOT, HOME, site.repo.dir, site.user.dir],
  });

  const scope = yield* Scope.make();
  // A start that fails leaves nothing running.
  const context = yield* started(group, scene, disk, scope).pipe(Effect.tapError(() => Scope.close(scope, Exit.void)));

  const rig: Rig = { group, app: group.app, disk, scope, context, window: 100 };

  return rig;
});

export const close = (rig: Rig) => Scope.close(rig.scope, Exit.void);

/** Whether a field is a live setting's reading: an Effect that cannot fail and needs nothing. */
const isReading = (value: unknown): value is Effect.Effect<unknown> => Effect.isEffect(value);

/** What the start gave: each field's value (a live one read), and each origin. */
export const running = (rig: Rig) =>
  Effect.gen(function* () {
    const values: Readonly<Record<string, unknown>> = yield* rig.group;
    const now: Record<string, unknown> = {};

    for (const [name, value] of Object.entries(values)) {
      now[name] = isReading(value) ? yield* value : value;
    }

    const origins: Readonly<Record<string, Origin>> = yield* SettingGroup.origins(rig.group);

    return { values: now, origins };
  }).pipe(Effect.provideContext(rig.context));

/** The first item of the group's stream of snapshots. */
export const firstItem = (rig: Rig) =>
  Stream.runHead(SettingGroup.snapshots(rig.group)).pipe(
    Effect.map(Option.getOrThrow),
    Effect.provideContext(rig.context),
  );

/** Every item the stream has given since the rig started, in order. The first is waited for. */
export const collect = Effect.fnUntraced(function* (rig: Rig) {
  const items: Array<SettingGroup.Snapshot> = [];

  yield* Stream.runForEach(SettingGroup.snapshots(rig.group), (item) => Effect.sync(() => void items.push(item))).pipe(
    Effect.provideContext(rig.context),
    Effect.forkIn(rig.scope),
  );

  for (let left = 1000; left > 0 && items.length === 0; left--) {
    yield* Effect.yieldNow;
  }

  expect(items.length, "the stream gives the snapshot now first").toBeGreaterThan(0);

  return items;
});

/** A fresh start on these scenes, its first snapshot, then closed. */
export const takeFirst = Effect.fnUntraced(function* (scene: Scene) {
  const rig = yield* boot(scene);
  const item = yield* firstItem(rig);
  const state = yield* running(rig);

  yield* close(rig);

  return { item, ...state };
});

const TURNS = 10;

const turns = Effect.forEach(Array.from({ length: TURNS }), () => Effect.yieldNow, { discard: true, concurrency: 1 });

/** Lets every event the disk has given reach the follower, which then waits out its window on the clock. */
const settle = (rig: Rig) =>
  Effect.gen(function* () {
    for (let left = 1000; left > 0 && (yield* rig.disk.owed) > 0; left--) {
      yield* Effect.yieldNow;
    }

    yield* turns;
  });

/** Settles, moves the clock past the window, and lets the follower read, resolve and publish. */
export const flush = (rig: Rig) =>
  settle(rig).pipe(Effect.andThen(TestClock.adjust(rig.window)), Effect.andThen(turns));

/** The strict read of an item, as the group's own, with the digest the read needs. */
export const readItem = (group: Group, input: unknown, closing: string) =>
  read(readGroup(group), input, closing).pipe(Effect.provide(Digest.layerWebCrypto));

// ---------------------------------------------------------------------------------------------
// SN1: what a start gives, class by class
// ---------------------------------------------------------------------------------------------

export type Read =
  | "restart"
  | "live"
  | "fileonly"
  | "required"
  | "table"
  | "array"
  | "default"
  | "flag"
  | "env"
  | "repo"
  | "user"
  | "home"
  | "lf"
  | "crlf"
  | "crlf-nofinal"
  | "cr"
  | "tab"
  | "han"
  | "empty";

export const READS: ReadonlyArray<Read> = [
  "restart",
  "live",
  "fileonly",
  "required",
  "table",
  "array",
  "default",
  "flag",
  "env",
  "repo",
  "user",
  "home",
  "lf",
  "crlf",
  "crlf-nofinal",
  "cr",
  "tab",
  "han",
  "empty",
];

/** One start to read back: the class it stands for, its scene, and the texts it must give back byte for byte. */
interface Loaded {
  readonly id: Read;
  readonly scene: Scene;
  /** The setting name and the exact text it must read back as. */
  readonly texts: ReadonlyArray<readonly [string, string]>;
  /** The origin a setting must have, by name, as far as its source says: the tag, and the file name for a file. */
  readonly origins: Readonly<Record<string, { readonly tag: Origin["_tag"]; readonly file?: string }>>;
}

const TEXTS: ReadonlyArray<{
  readonly id: Read;
  readonly source: Source;
  readonly make: (w: string, x: string) => string;
}> = [
  { id: "lf", source: "repo", make: (w, x) => `${w}\n${x}\n` },
  { id: "crlf", source: "env", make: (w, x) => `${w}\r\n${x}\r\n` },
  { id: "crlf-nofinal", source: "flag", make: (w, x) => `${w}\r\n${x}` },
  { id: "cr", source: "user", make: (w, x) => `${w}\r${x}` },
  { id: "tab", source: "repo", make: (w, x) => `${w}\t${x}` },
  { id: "han", source: "env", make: (w, x) => `雪${w}${x}` },
  { id: "empty", source: "user", make: () => "" },
];

/** The name of the file a source reads, when it reads one. */
const sourceFile = (source: Source, site: ReturnType<typeof siteFor>): { readonly file?: string } => {
  if (source === "repo") {
    return { file: site.repo.name };
  }

  return source === "user" ? { file: site.user.name } : {};
};

const FILE_TAGS = { repo: "file", user: "file", env: "env", flag: "flag", default: "default" } as const;

export const loaded = (draw: Draw): ReadonlyArray<Loaded> => {
  const { app } = draw;
  const a = named(draw.a);
  const b = named(draw.b);
  const n = (i: number) => number(draw, i);

  const one = (id: Read, source: Source, moved = false): Loaded => {
    const decl: Decl = { name: a, kind: "number" };
    const put: Put = { decl, source, value: n(0) };
    const site = siteFor(app, moved);

    return {
      id,
      scene: sceneFrom(app, [decl], source === "default" ? [] : [put], moved),
      texts: [],
      origins: {
        [a]: { tag: FILE_TAGS[source], ...sourceFile(source, site) },
      },
    };
  };

  const decls = (list: ReadonlyArray<Decl>, puts: ReadonlyArray<Put>, id: Read): Loaded => ({
    id,
    scene: sceneFrom(app, list, puts),
    texts: [],
    origins: {},
  });

  const [first = "w", second = "x"] = draw.words;

  return [
    decls(
      [
        { name: a, kind: "number" },
        { name: b, kind: "table" },
      ],
      [{ decl: { name: a, kind: "number" }, source: "repo", value: n(0) }],
      "restart",
    ),
    decls(
      [
        { name: a, kind: "number", live: true },
        { name: b, kind: "number" },
      ],
      [
        { decl: { name: a, kind: "number", live: true }, source: "repo", value: n(1) },
        { decl: { name: b, kind: "number" }, source: "user", value: n(2) },
      ],
      "live",
    ),
    decls(
      [{ name: a, kind: "text", fileOnly: true, files: ["user"] }],
      [{ decl: { name: a, kind: "text", fileOnly: true, files: ["user"] }, source: "user", value: first }],
      "fileonly",
    ),
    decls(
      [{ name: a, kind: "number", required: true }],
      [{ decl: { name: a, kind: "number", required: true }, source: "repo", value: n(3) }],
      "required",
    ),
    decls(
      [{ name: a, kind: "table" }],
      [{ decl: { name: a, kind: "table" }, source: "repo", value: { a: n(0), b: n(1) } }],
      "table",
    ),
    decls(
      [{ name: b, kind: "array" }],
      [{ decl: { name: b, kind: "array" }, source: "user", value: [n(2), n(3), n(0)] }],
      "array",
    ),
    one("default", "default"),
    one("flag", "flag"),
    one("env", "env"),
    one("repo", "repo"),
    one("user", "user"),
    one("home", "user", true),
    ...TEXTS.map(({ id, source, make }): Loaded => {
      const decl: Decl = { name: a, kind: "text" };
      const text = make(first, second);

      return {
        id,
        scene: sceneFrom(app, [decl], [{ decl, source, value: text }]),
        texts: [[a, text]],
        origins: {},
      };
    }),
  ];
};

// ---------------------------------------------------------------------------------------------
// SN2: a script of changes to the files of a group with live settings
// ---------------------------------------------------------------------------------------------

export type Change = "d" | "e" | "f" | "g" | "h";

/** Where a change goes and which setting it moves, from the seeds. */
interface Step {
  readonly change: Change;
  readonly pick: number;
}

export const CHANGES: ReadonlyArray<Change> = ["d", "e", "f", "g", "h"];

/** The script: every class once, in an order the seeds rotate, and one more of a class the seeds draw. */
export const script = (draw: Draw): ReadonlyArray<Step> => {
  const turn = pick(draw, 0) % CHANGES.length;
  const order = [...CHANGES.slice(turn), ...CHANGES.slice(0, turn)];

  return [
    ...order.map((change, i): Step => ({ change, pick: pick(draw, i + 1) })),
    { change: CHANGES[pick(draw, 7) % CHANGES.length] ?? "d", pick: pick(draw, 6) },
  ];
};

/** One file's layout: what each setting in it holds, and the lines above and below. */
interface Layout {
  readonly choices: Readonly<Record<string, number>>;
  readonly pad: number;
  readonly tail: number;
}

type Layouts = Readonly<Record<"repo" | "user", Layout>>;

/** The settings of the script's group: two live, one restart. Each sits in one file. */
const scriptDecls = (draw: Draw): ReadonlyArray<Decl & { readonly file: "repo" | "user" }> => [
  { name: named(draw.a), kind: "number", live: true, file: "repo" },
  { name: named(draw.b), kind: "number", live: true, file: "user" },
  { name: named(draw.c), kind: "number", file: "repo" },
];

const scriptGroup = (draw: Draw) => makeGroup(draw.app, scriptDecls(draw));

export const initial = (draw: Draw): Layouts => ({
  repo: { choices: { [named(draw.a)]: 1, [named(draw.c)]: 1 }, pad: 0, tail: 0 },
  user: { choices: { [named(draw.b)]: 1 }, pad: 0, tail: 0 },
});

export const render = (draw: Draw, file: "repo" | "user", layout: Layout): string => {
  const held = scriptDecls(draw).filter((decl) => decl.file === file && (layout.choices[decl.name] ?? 0) > 0);

  return `${[
    ...Array.from({ length: layout.pad }, (_, n) => `# note ${n}`),
    ...held.flatMap((decl) => {
      const [table = "", key = ""] = decl.name.split(".");

      return [`[${table}]`, `${key} = ${4100 + (layout.choices[decl.name] ?? 0)}`];
    }),
    ...Array.from({ length: layout.tail }, (_, n) => `# tail ${n}`),
  ].join("\n")}\n`;
};

/** The layouts after one change, and the text the file is written with: a refused change writes a key no setting names. */
export const apply = (
  draw: Draw,
  layouts: Layouts,
  step: Step,
): { readonly layouts: Layouts; readonly file: "repo" | "user"; readonly text: string } => {
  const decls = scriptDecls(draw);
  const live = decls.filter((decl) => decl.live === true);
  const restart = decls.filter((decl) => decl.live !== true);

  const target = Match.value(step.change).pipe(
    Match.when("d", () => live[step.pick % live.length] ?? live[0]),
    Match.when("e", () => restart[step.pick % restart.length] ?? restart[0]),
    Match.orElse(() => undefined),
  );

  const file: "repo" | "user" = target?.file ?? (step.pick % 2 === 0 ? "repo" : "user");
  const layout = layouts[file];

  const next: Layout =
    target !== undefined
      ? {
          ...layout,
          choices: { ...layout.choices, [target.name]: ((layout.choices[target.name] ?? 0) % 3) + 1 },
        }
      : step.change === "f"
        ? { ...layout, pad: layout.pad + 1 }
        : step.change === "g"
          ? { ...layout, tail: layout.tail + 1 }
          : layout;

  const text = render(draw, file, next);

  return {
    layouts: step.change === "h" ? layouts : { ...layouts, [file]: next },
    file,
    text: step.change === "h" ? `${text}[zzzzz]\nkeykey = 1\n` : text,
  };
};

/** The scene the script's group starts on: both files as the layouts say. */
export const sceneFor = (draw: Draw, layouts: Layouts): Scene => ({
  group: scriptGroup(draw),
  repo: render(draw, "repo", layouts.repo),
  user: render(draw, "user", layouts.user),
  env: {},
  flags: {},
  moved: false,
});

/** A scene with the files as these texts, for the oracle's fresh start. */
export const sceneOn = (draw: Draw, texts: { readonly repo: string; readonly user: string }): Scene => ({
  group: scriptGroup(draw),
  repo: texts.repo,
  user: texts.user,
  env: {},
  flags: {},
  moved: false,
});

/** Whether two snapshots say the same thing: the same values and the same origins. */
export const alike = (x: SettingGroup.Snapshot, y: SettingGroup.Snapshot): boolean =>
  x.hash === y.hash && JSON.stringify(x.origins) === JSON.stringify(y.origins);

/** What a change did to the snapshot, as a person would say it. */
export const effect = (
  draw: Draw,
  before: SettingGroup.Snapshot,
  after: SettingGroup.Snapshot | undefined,
): "refused" | "live" | "restart" | "origin" | "nothing" => {
  if (after === undefined) {
    return "refused";
  }

  const moved = Object.keys(after.values).filter(
    (name) => JSON.stringify(after.values[name]) !== JSON.stringify(before.values[name]),
  );

  if (moved.length === 0) {
    return JSON.stringify(after.origins) === JSON.stringify(before.origins) ? "nothing" : "origin";
  }

  return moved.some((name) => scriptDecls(draw).some((decl) => decl.name === name && decl.live === true))
    ? "live"
    : "restart";
};

export const INTENT: Readonly<Record<Change, ReturnType<typeof effect>>> = {
  d: "live",
  e: "restart",
  f: "origin",
  g: "nothing",
  h: "refused",
};

// ---------------------------------------------------------------------------------------------
// SN3 and SN5: a snapshot of the loader, and one change of one class
// ---------------------------------------------------------------------------------------------

export type Misfit = "m" | "n" | "o" | "p" | "q" | "r" | "s" | "t";

export const MISFITS: ReadonlyArray<Misfit> = ["m", "n", "o", "p", "q", "r", "s", "t"];

/** The group a snapshot is read by: a table (restart), a live number only the repo may set, and a required text only the user file may set. */
const richDecls = (draw: Draw): ReadonlyArray<Decl> => [
  { name: named(draw.a), kind: "table" },
  { name: named(draw.b), kind: "number", live: true, files: ["repo"] },
  { name: named(draw.c), kind: "text", fileOnly: true, files: ["user"], required: true },
];

const richValue = (draw: Draw, decl: Decl): unknown =>
  Match.value(decl.kind).pipe(
    Match.when("table", () => ({ a: number(draw, 0), b: number(draw, 1) })),
    Match.when("number", () => number(draw, 2)),
    Match.orElse(() => word(draw, 0)),
  );

/** Each setting of the rich group has a value in the file that may hold it: the repo's, but for the file-only text. */
const richPuts = (draw: Draw, decls: ReadonlyArray<Decl>): ReadonlyArray<Put> =>
  decls.map((decl) => ({
    decl,
    source: decl.fileOnly === true ? ("user" as const) : ("repo" as const),
    value: richValue(draw, decl),
  }));

export const richScene = (draw: Draw, app = draw.app, decls = richDecls(draw)) =>
  sceneFrom(app, decls, richPuts(draw, decls));

/** A snapshot as plain data a law may change. */
interface Plain {
  app: unknown;
  values: Record<string, Json>;
  origins: Record<string, unknown>;
  hash: unknown;
}

const plain = (item: SettingGroup.Snapshot): Plain => ({
  app: item.app,
  values: { ...item.values },
  origins: { ...item.origins },
  hash: item.hash,
});

/** The snapshot with its hash made over the values it holds now. */
const sealed = (snapshot: Plain) =>
  Effect.gen(function* () {
    return { ...snapshot, hash: yield* hash(snapshot.values) };
  }).pipe(Effect.provide(Digest.layerWebCrypto));

/** One snapshot that does not fit, and the message the read must give. */
interface Case {
  /** The snapshot as plain data, for the classes a wrong hash may be added to. */
  readonly snapshot?: Plain;
  readonly id: Misfit;
  readonly label: string;
  readonly input: unknown;
  /** The step's message, before the closing line. */
  readonly message: string;
}

const isRecord = Schema.is(Schema.Record(Schema.String, Schema.Json));

/** A hash that is not the values': the real one with its first character changed. */
const wrong = (hex: string): string => `${hex.startsWith("0") ? "1" : "0"}${hex.slice(1)}`;

/** What the builds of the loader that differ from the group's give, for class (t). */
interface Builds {
  readonly more: SettingGroup.Snapshot;
  readonly fewer: SettingGroup.Snapshot;
  readonly wider: SettingGroup.Snapshot;
  readonly other: SettingGroup.Snapshot;
}

/** The loader's snapshots of the other builds, each started on files of its own. */
export const builds = (draw: Draw): Effect.Effect<Builds> =>
  Effect.gen(function* () {
    const rich = richDecls(draw);
    const [a, b, c] = rich;

    if (a === undefined || b === undefined || c === undefined) {
      return yield* Effect.die("the rich group has three settings");
    }

    const more = [...rich, { name: named(draw.d), kind: "number" } satisfies Decl];
    const fewer = [b, c];
    const wide = [a, { ...b, wide: true }, c];

    const take = (decls: ReadonlyArray<Decl>, app = draw.app, without: ReadonlyArray<string> = []) =>
      Effect.map(
        Effect.orDie(
          takeFirst(
            sceneFrom(
              app,
              decls,
              richPuts(draw, decls).filter((put) => !without.includes(put.decl.name)),
            ),
          ),
        ),
        (result) => result.item,
      );

    return {
      more: yield* take(more),
      fewer: yield* take(fewer),
      wider: yield* take(wide, draw.app, [named(draw.b)]),
      other: yield* take(rich, draw.other),
    };
  });

const surplus = (draw: Draw) => `Extra.${word(draw, 2)}`;

/** The misfits of the draw: one case for each class from the seeds, and the same with a wrong hash where a later step would also fail. */
export const misfits = (draw: Draw, item: SettingGroup.Snapshot, built: Builds): Effect.Effect<ReadonlyArray<Case>> =>
  Effect.gen(function* () {
    const { app } = draw;
    const [a, b, c] = [named(draw.a), named(draw.b), named(draw.c)];
    const window = "config.watch.debounce";
    const names = [a, b, c, window];
    const name = names[pick(draw, 0) % names.length] ?? a;
    const origin = `the snapshot gives it an origin ${app} cannot give.`;
    const refused = "the snapshot's value is refused by its schema.";
    const missing = `the snapshot does not hold ${app}'s settings.`;
    const cases: Array<Case> = [];

    const add = (id: Misfit, label: string, input: unknown, message: string, snapshot?: Plain) => {
      cases.push({ id, label, input, message, ...(snapshot === undefined ? {} : { snapshot }) });
    };

    // (m) not a snapshot: not an object, a missing top-level key, an extra one, a field of the wrong type.
    const notObject = [null, "x", 5, true, [], undefined, [item]];
    const base = plain(item);
    const keys = ["app", "values", "origins", "hash"] as const;
    const dropped = keys[pick(draw, 1) % keys.length] ?? "app";
    const without: Record<string, unknown> = { ...base };
    delete without[dropped];

    const typed: ReadonlyArray<readonly [string, unknown]> = [
      ["app", 5],
      ["values", []],
      ["values", "x"],
      ["origins", 5],
      ["hash", 5],
      ["hash", null],
    ];

    const [typedKey, typedValue] = typed[pick(draw, 2) % typed.length] ?? typed[0] ?? ["app", 5];

    const variants: ReadonlyArray<readonly [string, unknown]> = [
      ["not an object", notObject[pick(draw, 3) % notObject.length]],
      [`no ${dropped}`, without],
      ["an extra key", { ...base, [`extra${word(draw, 1)}`]: 1 }],
      [`${typedKey} of the wrong type`, { ...base, [typedKey]: typedValue }],
    ];

    for (const [label, input] of variants) {
      add("m", label, input, "this is not a snapshot.");
    }

    // (n) another app's snapshot, its names and its hash right.
    add("n", "another app's snapshot", built.other, "the snapshot is another app's.");

    // (o) a name missing, extra or renamed in `values` or in `origins`, the hash made over what is there.
    const renamed = <T>(record: Record<string, T>, from: string): Record<string, T> =>
      Object.fromEntries(Object.entries(record).map(([key, value]) => [key === from ? `Renamed.${from}` : key, value]));

    const dropOne = <T>(record: Record<string, T>, from: string): Record<string, T> =>
      Object.fromEntries(Object.entries(record).filter(([key]) => key !== from));

    const o: ReadonlyArray<readonly [string, Plain]> = [
      ["a name missing in values", { ...base, values: dropOne(base.values, name) }],
      ["a name extra in values", { ...base, values: { ...base.values, [surplus(draw)]: 1 } }],
      ["a name renamed in values", { ...base, values: renamed(base.values, name) }],
      ["a name missing in origins", { ...base, origins: dropOne(base.origins, name) }],
      [
        "a name extra in origins",
        { ...base, origins: { ...base.origins, [surplus(draw)]: Origin.cases.default.make({}) } },
      ],
      ["a name renamed in origins", { ...base, origins: renamed(base.origins, name) }],
    ];

    const [oLabel, oSnapshot] = o[pick(draw, 4) % o.length] ?? o[0] ?? ["", base];
    const oSealed = yield* sealed(oSnapshot);
    add("o", oLabel, oSealed, missing, oSealed);

    // (p) an origin no start gives.
    const file = (text: string) => Origin.cases.file.make({ file: text, line: 1 });
    const flag = (text: string) => Origin.cases.flag.make({ name: text });
    const env = (text: string) => Origin.cases.env.make({ name: text });

    const p: ReadonlyArray<readonly [string, string, unknown]> = [
      ["a flag for a file-only setting", c, flag(`--${c}`)],
      ["a variable for a file-only setting", c, env(variable(app, c))],
      ["a flag of another name", a, flag(`--${b}`)],
      ["a variable of another name", a, env(variable(app, b))],
      ["a user file for a setting only the repo may set", b, file(`~/.${app}/${app}.toml`)],
      ["a home file for a setting only the repo may set", b, file(`$${app.toUpperCase()}_HOME/${app}.toml`)],
      ["a repo file for a setting only the user file may set", c, file(`.${app}/${app}.toml`)],
      ["another app's repo file", a, file(`.${draw.other}/${draw.other}.toml`)],
      ["another app's user file", a, file(`~/.${draw.other}/${draw.other}.toml`)],
      ["another app's home file", a, file(`$${draw.other.toUpperCase()}_HOME/${draw.other}.toml`)],
      ["an absolute path", a, file(`${ROOT}/.${app}/${app}.toml`)],
      ["the default for a required setting", c, Origin.cases.default.make({})],
    ];

    const [pLabel, pName, pOrigin] = p[pick(draw, 5) % p.length] ?? p[0] ?? ["", a, {}];
    const pSnapshot = { ...base, origins: { ...base.origins, [pName]: pOrigin } };
    add("p", pLabel, pSnapshot, `${pName}: ${origin}`, pSnapshot);

    // (q) a value its schema refuses, the hash made over it.
    const q: ReadonlyArray<readonly [string, ReadonlyArray<Json>]> = [
      [a, ["x", 5, [1], { a: "x" }, { a: 1.5 }]],
      [b, ["x", -1, 70000, 1.5, null]],
      [c, [5, null, true, [], {}]],
    ];

    const [qName, qValues] = q[pick(draw, 6) % q.length] ?? q[0] ?? [a, []];
    const qValue = qValues[pick(draw, 7) % qValues.length] ?? null;
    const qSealed = yield* sealed({ ...base, values: { ...base.values, [qName]: qValue } });
    add("q", `${qName} holds ${JSON.stringify(qValue)}`, qSealed, `${qName}: ${refused}`, qSealed);

    // (r) an extra key inside a record value, the hash made over it.
    const held = base.values[a];
    const record = isRecord(held) ? held : {};

    const rSealed = yield* sealed({
      ...base,
      values: { ...base.values, [a]: { ...record, [`zz${word(draw, 3)}`]: 1 } },
    });

    add("r", "an extra key in a record value", rSealed, `${a}: ${refused}`, rSealed);

    // (s) a wrong hash, all else right.
    const hashes = [wrong(item.hash), "", "not hex"];
    add(
      "s",
      "a wrong hash",
      { ...base, hash: hashes[pick(draw, 8) % hashes.length] },
      "the snapshot's hash does not match its values.",
    );

    // (t) builds out of step: one more setting, one fewer, another schema at one name.
    const builtOne = pick(draw, 9) % 3;
    add(
      "t",
      ["one more setting", "one fewer setting", "another schema at one name"][builtOne] ?? "",
      [built.more, built.fewer, built.wider][builtOne],
      builtOne === 2 ? `${b}: ${refused}` : missing,
    );

    // The same, with the hash also wrong: a later step must not be the one that speaks.
    for (const one of cases) {
      if (one.snapshot !== undefined) {
        add(
          one.id,
          `${one.label}, and a wrong hash`,
          { ...one.snapshot, hash: wrong(String(one.snapshot.hash)) },
          one.message,
        );
      }
    }

    return cases;
  }).pipe(Effect.provide(Digest.layerWebCrypto));

// ---------------------------------------------------------------------------------------------
// SN4: the origin rule
// ---------------------------------------------------------------------------------------------

/** One declaration the rule is asked about. */
export const Declaration = Schema.Struct({
  scope: Schema.Literals(["repo", "user", "both"]),
  fileOnly: Schema.Boolean,
  required: Schema.Boolean,
});

export type Declaration = typeof Declaration.Type;

/** The names of the files a person reads for each, as the model of the rule holds them. */
const modelNames = (app: string, scope: Declaration["scope"]): ReadonlyArray<string> => [
  ...(scope !== "user" ? [`.${app}/${app}.toml`] : []),
  ...(scope !== "repo" ? [`~/.${app}/${app}.toml`, `$${app.toUpperCase()}_HOME/${app}.toml`] : []),
];

/** The origins a start could give, and the ones it could not, for a setting of this name in this app. */
export const candidates = (draw: Draw, texts: ReadonlyArray<string>): ReadonlyArray<Origin> => {
  const { app, other } = draw;
  const name = named(draw.a);
  const mate = named(draw.b);
  const OTHER = other.toUpperCase();

  const files = [
    `.${app}/${app}.toml`,
    `~/.${app}/${app}.toml`,
    `$${app.toUpperCase()}_HOME/${app}.toml`,
    `.${other}/${other}.toml`,
    `~/.${other}/${other}.toml`,
    `$${OTHER}_HOME/${other}.toml`,
    `$${OTHER}_HOME/${app}.toml`,
    `${ROOT}/.${app}/${app}.toml`,
    `/${app}.toml`,
    `./.${app}/${app}.toml`,
    `.${app}/${app}.toml/`,
    `~/.${app}/${other}.toml`,
    `${app}.toml`,
    "",
    ...texts,
  ];

  return [
    Origin.cases.default.make({}),
    Origin.cases.flag.make({ name: `--${name}` }),
    Origin.cases.flag.make({ name: `--${mate}` }),
    Origin.cases.flag.make({ name }),
    Origin.cases.flag.make({ name: `--${name}x` }),
    Origin.cases.env.make({ name: variable(app, name) }),
    Origin.cases.env.make({ name: variable(app, mate) }),
    Origin.cases.env.make({ name: variable(other, name) }),
    Origin.cases.env.make({ name }),
    ...files.map((file, i): Origin => Origin.cases.file.make({ file, line: i + 1 })),
  ];
};

/** Whether a start could give a setting this origin: the model of the rule, written out. */
export const model = (draw: Draw, declaration: Declaration, origin: Origin): boolean => {
  const { app } = draw;
  const name = named(draw.a);

  switch (origin._tag) {
    case "default":
      return !declaration.required;
    case "flag":
      return !declaration.fileOnly && origin.name === `--${name}`;
    case "env":
      return !declaration.fileOnly && origin.name === variable(app, name);
    case "file":
      return modelNames(app, declaration.scope).includes(origin.file);
  }
};

/** The setting the rule is asked about. */
export const settingFor = (draw: Draw, declaration: Declaration): Setting.Any =>
  declare({
    name: named(draw.a),
    kind: "number",
    fileOnly: declaration.fileOnly,
    files: declaration.scope === "both" ? ["repo", "user"] : [declaration.scope],
    required: declaration.required,
  });

// ---------------------------------------------------------------------------------------------
// SN5: secrets
// ---------------------------------------------------------------------------------------------

/** A secret-looking text, with a character that changes in JSON and in a URL. */
const Hidden = Schema.String.check(Schema.isPattern(/^sk-([A-Za-z0-9]{6,12})["/ +\\&][A-Za-z0-9]{3}$/u));

export const HiddenDraw = Schema.Struct({ draw: Draw, secret: Hidden });

/** Every form a secret may take in text: raw, JSON-escaped and URL-encoded. */
export const forms = (secret: string) => [secret, JSON.stringify(secret).slice(1, -1), encodeURIComponent(secret)];

/** One snapshot that holds the secret where a step refuses it. */
interface Hiding {
  readonly step: number;
  readonly label: string;
  readonly input: unknown;
}

export const hiding = (draw: Draw, item: SettingGroup.Snapshot, secret: string): Effect.Effect<ReadonlyArray<Hiding>> =>
  Effect.gen(function* () {
    const base = plain(item);
    const [a, b, c] = [named(draw.a), named(draw.b), named(draw.c)];
    const hidden: Array<Hiding> = [];

    const add = (step: number, label: string, input: unknown) => {
      hidden.push({ step, label, input });
    };

    add(1, "an extra key's value", { ...base, extra: secret });
    add(1, "an extra key's name", { ...base, [secret]: 1 });
    add(1, "a field of the wrong type", { ...base, hash: [secret] });
    add(2, "the app name", { ...base, app: secret });
    add(3, "an extra name in values", yield* sealed({ ...base, values: { ...base.values, [secret]: secret } }));
    add(3, "an extra name in origins", {
      ...base,
      origins: { ...base.origins, [secret]: Origin.cases.default.make({}) },
    });
    add(4, "a file origin", {
      ...base,
      origins: { ...base.origins, [a]: Origin.cases.file.make({ file: secret, line: 1 }) },
    });
    add(4, "a flag origin", { ...base, origins: { ...base.origins, [a]: Origin.cases.flag.make({ name: secret }) } });
    add(4, "a variable origin", {
      ...base,
      origins: { ...base.origins, [a]: Origin.cases.env.make({ name: secret }) },
    });
    add(5, "a value a schema refuses", yield* sealed({ ...base, values: { ...base.values, [b]: secret } }));
    add(5, "a record value a schema refuses", yield* sealed({ ...base, values: { ...base.values, [a]: secret } }));
    add(
      5,
      "an extra key in a record value",
      yield* sealed({ ...base, values: { ...base.values, [a]: { a: 1, [secret]: secret } } }),
    );
    add(5, "a text a schema refuses", yield* sealed({ ...base, values: { ...base.values, [c]: [secret] } }));
    add(6, "the hash", { ...base, hash: secret });

    return hidden;
  }).pipe(Effect.provide(Digest.layerWebCrypto));

// ---------------------------------------------------------------------------------------------
// What a read that fails says
// ---------------------------------------------------------------------------------------------

interface Refusal {
  readonly reason: string;
  readonly file: string | undefined;
  readonly line: number | undefined;
  readonly message: string;
  /** Everything a caller could print of the failure: its trace, its message, its cause and its fields. */
  readonly printed: string;
}

/** The kinds of reason a failed read holds, as `Fail` and `Die`: a success holds none. */
export const kinds = (exit: Exit.Exit<unknown, unknown>): ReadonlyArray<string> =>
  Exit.isFailure(exit) ? exit.cause.reasons.map((reason) => reason._tag) : [];

/** The one `SettingsError` a failed read holds, and never a second error or a defect beside it. */
export const refusal = (exit: Exit.Exit<unknown, unknown>): Refusal => {
  expect(Exit.isFailure(exit), "the read fails").toBe(true);

  if (Exit.isSuccess(exit)) {
    return { reason: "read", file: undefined, line: undefined, message: "", printed: "" };
  }

  const errors = exit.cause.reasons.flatMap((reason) => (reason._tag === "Fail" ? [reason.error] : []));
  const error = errors[0];

  expect(exit.cause.reasons).toHaveLength(1);
  expect(errors).toHaveLength(1);
  expect(error).toBeInstanceOf(SettingGroup.SettingsError);

  return Schema.is(SettingGroup.SettingsError)(error)
    ? {
        reason: error.reason,
        file: error.file,
        line: error.line,
        message: error.message,
        printed: [Cause.pretty(exit.cause), error.message, String(error.cause), JSON.stringify(error)].join("\n"),
      }
    : { reason: "not a SettingsError", file: undefined, line: undefined, message: "", printed: "" };
};

// ---------------------------------------------------------------------------------------------
// SN13: the hash does not depend on key order
// ---------------------------------------------------------------------------------------------

/** Values whose keys are in no order at every depth. */
export const KNOWN_VALUES: Readonly<Record<string, Json>> = {
  "b.x": { y: 1, a: [2, { d: 4, c: 3 }] },
  "c.w": null,
  "a.z": "q",
};

/** The SHA-256 of `[["a.z","q"],["b.x",{"a":[2,{"c":3,"d":4}],"y":1}],["c.w",null]]`, the sorted entries as compact JSON, made outside this package. */
export const KNOWN_HASH = "11955bc314a9fe493f571a9dddf896248424459699f762f9994672f631a93ae9";

/** The same data with the keys of every object, at every depth, in the opposite order. */
export const reversed = (value: Json): Json => {
  if (Array.isArray(value)) {
    return value.map(reversed);
  }

  return isRecord(value)
    ? Object.fromEntries(
        Object.entries(value)
          .reverse()
          .map(([key, entry]) => [key, reversed(entry)]),
      )
    : value;
};

/** The same record, its keys in the opposite order at every depth. */
export const flipped = (values: Readonly<Record<string, Json>>): Record<string, Json> =>
  Object.fromEntries(
    Object.entries(values)
      .reverse()
      .map(([key, entry]) => [key, reversed(entry)]),
  );

/** The hash of the values, as the snapshot makes it. */
export const hashed = (values: Readonly<Record<string, Json>>) =>
  hash(values).pipe(Effect.provide(Digest.layerWebCrypto));

/** One snapshot of the older API, made over a group of one setting that holds any JSON, and what reads it back. */
/** Values three records deep, which a setting of the older API can read by its keys. */
export const Tree = Schema.Record(
  Key,
  Schema.Record(Key, Schema.Record(Key, Schema.Int).check(Schema.isMaxProperties(3))).check(Schema.isMaxProperties(3)),
).check(Schema.isMaxProperties(3));

export const older = Effect.fnUntraced(function* (draw: Draw, value: typeof Tree.Type) {
  const app = AppModule.make({ name: draw.app, list: `${draw.app} settings` });
  const path = named(draw.a);

  const setting = app.Setting.make(path, {
    schema: Tree,
    default: {},
    doc: "A record.",
    scope: ["repo", "person"],
    reload: "restart",
    since: "0.0.0",
  });

  const group = app.Setting.group({ s0: setting });

  const snapshot = yield* OldSnapshot.make(group, {
    values: { s0: value },
    origins: { [path]: Origin.cases.default.make({}) },
  });

  return {
    path,
    snapshot,
    read: (input: Json) => OldSnapshot.read(group, input).pipe(Effect.provide(Digest.layerWebCrypto)),
  };
}, Effect.provide(Digest.layerWebCrypto));

export const OldSnapshotError = OldSnapshot.SnapshotError;

// ---------------------------------------------------------------------------------------------
// SN14: the two guards a snapshot can reach in the read of a value
// ---------------------------------------------------------------------------------------------

export type Guard = "cast" | "encode";

export const GUARDS: ReadonlyArray<Guard> = ["cast", "encode"];

/** A guard that lies: it says every value is text. It is how this law tells the compiler a value is plain when it is not. */
const claimsText = (_value: unknown): _value is string => true;

/** A schema typed as text that decodes a text of a time to a `Date`: the one lie a program's author can tell, which the read must die on. */
const Lying = Schema.String.pipe(
  Schema.decodeTo(Schema.declare(claimsText), {
    decode: SchemaGetter.transform((text: string) => {
      const date: unknown = new Date(text);

      return claimsText(date) ? date : text;
    }),
    encode: SchemaGetter.transform((text: string) => text),
  }),
);

/** A text that decodes with a mark added, and encodes only when the result is at most three letters: "abc" decodes to "abc!", which it refuses to encode. */
const Shortened = Schema.String.pipe(
  Schema.decodeTo(Schema.String, {
    decode: SchemaGetter.transform((text: string) => `${text}!`),
    encode: SchemaGetter.transformEffect((text: string) =>
      text.length <= 3
        ? Effect.succeed(text.slice(0, -1))
        : Effect.fail(new SchemaIssue.InvalidValue({ message: "the encoded text is too long" })),
    ),
  }),
);

/** A snapshot of one setting the loader could not have made, as the read gets it. */
interface Guarded {
  readonly id: Guard;
  readonly group: Group;
  readonly name: string;
  readonly input: unknown;
  /** A snapshot of the same group that reads, for the control. */
  readonly fine: unknown;
}

export const guarded = (draw: Draw): Effect.Effect<ReadonlyArray<Guarded>> =>
  Effect.gen(function* () {
    const site = `.${draw.app}/${draw.app}.toml`;
    const name = named(draw.a);

    const one = (id: Guard, setting: Setting.Any, text: string, fine: string) =>
      Effect.gen(function* () {
        const make = (value: string) =>
          Effect.map(hash({ [name]: value }), (sum) => ({
            app: draw.app,
            values: { [name]: value },
            origins: { [name]: Origin.cases.file.make({ file: site, line: 1 }) },
            hash: sum,
          }));

        return {
          id,
          group: groupFrom(draw.app, [setting]),
          name,
          input: yield* make(text),
          fine: yield* make(fine),
        } satisfies Guarded;
      });

    const described = Setting.withDescription("A generated setting.");

    const lie = Lying;

    return [
      yield* one(
        "cast",
        Setting.make(name, lie).pipe(described),
        `2020-01-${String(10 + (number(draw, 0) % 18))}T00:00:00.000Z`,
        "",
      ),
      yield* one("encode", Setting.make(name, Shortened).pipe(described), `${word(draw, 0)}xyz`.slice(0, 3), "ab"),
    ];
  }).pipe(Effect.provide(Digest.layerWebCrypto));

// ---------------------------------------------------------------------------------------------
// SN15: every origin is checked before any value
// ---------------------------------------------------------------------------------------------

export type Order = "before" | "same" | "after";

export const ORDERS: ReadonlyArray<Order> = ["before", "same", "after"];

/** A snapshot with a refused value and an origin no start gives, and the origin's message: a value before it, at it, or after it. */
interface Ordered {
  readonly id: Order;
  readonly label: string;
  readonly input: unknown;
  readonly message: string;
}

export const ordered = (draw: Draw, item: SettingGroup.Snapshot): Effect.Effect<ReadonlyArray<Ordered>> =>
  Effect.gen(function* () {
    const { app } = draw;
    const base = plain(item);
    const names = [named(draw.a), named(draw.b), named(draw.c)];

    // For each setting: an origin no start gives it, and a value its schema refuses.
    const bad = [
      Origin.cases.flag.make({ name: `--${names[1]}` }),
      Origin.cases.file.make({ file: `~/.${app}/${app}.toml`, line: 1 }),
      Origin.cases.flag.make({ name: `--${names[2]}` }),
    ];

    const refused: ReadonlyArray<Json> = ["x", "x", 5];
    const found: Array<Ordered> = [];

    for (const [at, origin] of bad.entries()) {
      for (const [id, to] of [
        ["before", at - 1],
        ["same", at],
        ["after", at + 1],
      ] as const) {
        const name = names[to];
        const value = refused[to];

        if (name === undefined || value === undefined) {
          continue;
        }

        const input = yield* sealed({
          ...base,
          origins: { ...base.origins, [names[at] ?? ""]: origin },
          values: { ...base.values, [name]: value },
        });

        found.push({
          id,
          label: `a value refused at ${name} and an origin at ${names[at]}`,
          input,
          message: `${names[at]}: the snapshot gives it an origin ${app} cannot give.`,
        });
      }
    }

    return found;
  }).pipe(Effect.provide(Digest.layerWebCrypto));
