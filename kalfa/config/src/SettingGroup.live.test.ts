// Ticket 1841, kalfa/config (new work): V1 to V18 of the approved plan (.kalfa/quests/kalfa-config-live-PLAN.md, with its
// Amendment 1), for the live settings of `SettingGroup`, read through the package's root entry (index.ts). Written before
// the code. The type laws TL1 to TL3 are in SettingGroup.live.types.test.ts, R3 is in SettingGroup.live.integration.test.ts.
//
// What the code does, as these laws hold it to (the plan's "The shape"):
// - A live field has `changes`: a `Stream` of the value now, then each new value, only when it differs.
// - A group with a live setting watches the folder of each configuration file. When a file changes, and has been quiet for
//   the window `config.watch.debounce` (a restart setting the package adds to such a group, 100 milliseconds by default),
//   the layer reads that file again, checks it whole as the start does, resolves every setting by precedence again, and
//   publishes each live value that differs. A refused file is logged as one warning, and the last good values hold.
// - `SettingGroup.origins` reads the origins as they are now: a live setting's origin follows its value.
//
// The disk is the live stand-in in MemoryFiles.test-support.ts (R3 checks it against a real temp folder), and time is
// Effect's `TestClock`: no law sleeps for real. A step of a law changes the disk, lets the watch's events reach the layer's
// fiber (`settle`), moves the clock past the window, and reads what the layer did.
//
// The oracle of V1, V3, V6 and V8 is a fresh start of the same group on the texts a script has left: what the layer
// gives while running must be what a start gives on the same files.
import { describe, expect, it } from "@effect/vitest";
import { Recorder, runsFor } from "@kampus/vitest";
import type { Context } from "effect";
import {
  ConfigProvider,
  Effect,
  Equal,
  Exit,
  FileSystem,
  Layer,
  Logger,
  Match,
  Option,
  Path,
  PlatformError,
  Predicate,
  References,
  Schema,
  SchemaGetter,
  Scope,
  Stream,
  SubscriptionRef,
  Tracer,
} from "effect";
import * as Command from "effect/cli/Command";
import * as CommandSpec from "effect/cli/CommandSpec";
import * as PubSub from "effect/PubSub";
import { TestClock } from "effect/testing";
import { Setting, SettingGroup } from "./index.ts";
import * as MemoryFiles from "./MemoryFiles.test-support.ts";

const check = { arbitrary: { runs: runsFor({ fast: 25, full: 100 }), size: 100 } };

const Port = Schema.Int.check(Schema.isBetween({ minimum: 1, maximum: 65535 }));

const DEFAULT = 18787;

const ROOT = "/work";

const HOME = "/people/one";

const VERSION = "1.2.3";

/** The quiet window the package gives a group that sets none. */
const WINDOW = 100;

// ---------------------------------------------------------------------------------------------
// Generated names. A generated word never holds `config`, `watch` or `debounce`, the words of the setting the package adds,
// nor `person` and `instance`, which a message may say only of what a program declared.
// ---------------------------------------------------------------------------------------------

const clean = Schema.makeFilter(
  (text: string) => !["person", "instance", "config", "watch", "debounce", "home"].some((word) => text.includes(word)),
);

const Word = Schema.String.check(Schema.isPattern(/^[a-z][a-z0-9]{3,7}$/u), clean);

const Table = Schema.String.check(Schema.isPattern(/^[a-z]{1,6}(-[a-z]{1,4})?$/u), clean);

const Key = Schema.String.check(Schema.isPattern(/^[a-z]{2,6}(-[a-z]{1,4})?$/u), clean);

const Kind = Schema.Literals(["number", "table", "array"]);

type Kind = typeof Kind.Type;

/** One declared setting of a generated group: where it sits, what its value looks like and whether it is live. */
interface Spec {
  /** The table a setting sits in, or none for a one-word name. */
  readonly table: string | undefined;
  readonly key: string;
  readonly kind: Kind;
  readonly live: boolean;
}

const Slot = Schema.Struct({ table: Table, key: Key, kind: Kind, live: Schema.Boolean });

const named = (spec: Pick<Spec, "table" | "key">) =>
  spec.table === undefined ? spec.key : `${spec.table}.${spec.key}`;

/** The field a value has: the last word of the name, hyphens joined. */
const field = (spec: Pick<Spec, "key">) =>
  spec.key.replace(/-([a-z0-9])/gu, (_, letter: string) => letter.toUpperCase());

/** The field of a setting, from the name a person writes. */
const fieldOfName = (name: string) => field({ key: name.split(".").at(-1) ?? name });

const variable = (app: string, spec: Pick<Spec, "table" | "key">) =>
  [app.toUpperCase(), ...named(spec).split(".")].map((word) => word.replace(/-/gu, "_").toUpperCase()).join("_");

/** Whether a group of these names can be read together: no two share a table, a field or a variable. */
const apart = (specs: ReadonlyArray<Spec>) =>
  new Set(specs.map((spec) => spec.table ?? spec.key)).size === specs.length &&
  new Set(specs.map(field)).size === specs.length &&
  new Set(specs.map((spec) => variable("a", spec))).size === specs.length;

const Shape = Schema.Struct({
  app: Word,
  first: Slot,
  rest: Schema.Array(Slot).check(Schema.isMaxLength(2)),
}).check(Schema.makeFilter((shape) => apart([shape.first, ...shape.rest])));

/** A generated group's settings: the first is live, so every group watches. */
const specsFrom = (shape: typeof Shape.Type): ReadonlyArray<Spec> => [{ ...shape.first, live: true }, ...shape.rest];

const Pairing = Schema.Struct({ a: Schema.optionalKey(Schema.Int), b: Schema.optionalKey(Schema.Int) });

const declare = (spec: Spec): Setting.Any => {
  const described = Setting.withDescription("A generated setting.");

  if (spec.kind === "number") {
    const made = Setting.make(named(spec), Port).pipe(described, Setting.withDefault(DEFAULT));

    return spec.live ? Setting.live(made) : made;
  }

  if (spec.kind === "table") {
    const made = Setting.make(named(spec), Pairing).pipe(described, Setting.withDefault({ a: 90 }));

    return spec.live ? Setting.live(made) : made;
  }

  const made = Setting.make(named(spec), Schema.Array(Schema.Int)).pipe(described, Setting.withDefault([70]));

  return spec.live ? Setting.live(made) : made;
};

const makeGroup = (app: string, settings: ReadonlyArray<Setting.Any>) => SettingGroup.make(app, ...settings);

type Group = ReturnType<typeof makeGroup>;

const groupFrom = (app: string, specs: ReadonlyArray<Spec>) =>
  makeGroup(
    app,
    specs.map((spec) => declare(spec)),
  );

const TABLES = [{ a: 1 }, { a: 1, b: 2 }, { b: 2 }];

const ARRAYS = [[1], [1, 2], []];

/** What each choice stands for: 0 is absent, 1 to 3 are three values of the setting's kind. */
const chosen = (spec: Spec, choice: number): unknown =>
  Match.value(spec.kind).pipe(
    Match.when("number", () => 4100 + choice),
    Match.when("table", () => TABLES[choice - 1]),
    Match.when("array", () => ARRAYS[choice - 1]),
    Match.exhaustive,
  );

/** The TOML lines of a value: a table's keys, or one `key = raw` line. */
const linesFor = (spec: Spec, choice: number): ReadonlyArray<string> =>
  spec.kind === "table"
    ? Object.entries(TABLES[choice - 1] ?? {}).map(([key, value]) => `${key} = ${value}`)
    : [`${spec.key} = ${JSON.stringify(chosen(spec, choice))}`];

/** A TOML file: `pad` comment lines, then each setting a choice gives, with its table. A one-word name sits before every table. */
const render = (specs: ReadonlyArray<Spec>, choices: ReadonlyArray<number>, pad: number) => {
  const held = specs.flatMap((spec, n) => ((choices[n] ?? 0) === 0 ? [] : [{ spec, choice: choices[n] ?? 0 }]));
  const lines = Array.from({ length: pad }, (_, n) => `# note ${n}`);

  for (const { spec, choice } of held) {
    if (spec.table === undefined) {
      lines.push(...linesFor(spec, choice));
    }
  }

  for (const { spec, choice } of held) {
    if (spec.table !== undefined) {
      lines.push(`[${spec.kind === "table" ? named(spec) : spec.table}]`, ...linesFor(spec, choice));
    }
  }

  return `${lines.join("\n")}\n`;
};

// ---------------------------------------------------------------------------------------------
// Where the files are, the rig a law runs a group in, and the clock.
// ---------------------------------------------------------------------------------------------

type File = "repo" | "user";

const FILES: ReadonlyArray<File> = ["repo", "user"];

const places = (app: string) => ({
  repo: { dir: `${ROOT}/.${app}`, path: `${ROOT}/.${app}/${app}.toml`, name: `.${app}/${app}.toml` },
  user: { dir: `${HOME}/.${app}`, path: `${HOME}/.${app}/${app}.toml`, name: `~/.${app}/${app}.toml` },
});

interface Scene {
  /** The text of each file, or none: no file. */
  readonly texts?: Readonly<Partial<Record<File, string>>>;
  /** Whether each file's folder is there at the start. Both are, unless this says less. */
  readonly folders?: Readonly<Partial<Record<File, boolean>>>;
  readonly env?: Readonly<Record<string, string>>;
  readonly flags?: Readonly<Record<string, Option.Option<string>>>;
  /** What the disk does before each watch is installed: given the disk, the hook the stand-in runs. */
  readonly before?: (disk: MemoryFiles.LiveDisk) => (path: string) => Effect.Effect<void>;
  /** A fault planted on the watch of each path. */
  readonly faults?: Readonly<Record<string, PlatformError.PlatformError>>;
  /** The quiet window the law expects, in milliseconds: the default one unless a source gives another. */
  readonly window?: number;
  /** Read `changes` of each live field from the start. On unless this says off. */
  readonly collect?: boolean;
}

/** One structured log line. */
interface Line {
  /** The whole entry as the logger wrote it, for a law that scans every part of it. */
  readonly raw: string;
  readonly level: string;
  readonly message: unknown;
  readonly annotations: Readonly<Record<string, unknown>>;
}

/** What a rig's layer gives: the group, and the file system and path service it was built on, with the record of its calls. */
type Built = Context.Context<
  | SettingGroup.Identifier<Group["app"], Group["settings"]>
  | FileSystem.FileSystem
  | Path.Path
  | Recorder.Recorded<FileSystem.FileSystem>
>;

interface Rig {
  readonly group: Group;
  readonly app: string;
  readonly disk: MemoryFiles.LiveDisk;
  readonly scope: Scope.Closeable;
  readonly context: Built;
  readonly logs: Array<Line>;
  readonly spans: Array<Tracer.NativeSpan>;
  /** What each live field's `changes` has given, by field. */
  readonly seen: Record<string, Array<unknown>>;
  readonly window: number;
}

const environment = (vars: Readonly<Record<string, string>> = {}) => ({ HOME, ...vars });

const said = (line: Line) => (Array.isArray(line.message) ? line.message.join(" ") : String(line.message));

/** Whether a value is a live field's `changes`: a Stream that cannot fail and needs nothing. */
const isChanges = (value: unknown): value is Stream.Stream<unknown> => Stream.isStream(value);

/** A live field's `changes`, or a failed expectation when it has none. */
const changesFrom = (reading: unknown): Stream.Stream<unknown> => {
  const stream = Predicate.hasProperty(reading, "changes") ? reading.changes : undefined;

  expect(isChanges(stream), "a live field has `changes`, a Stream").toBe(true);

  return isChanges(stream) ? stream : Stream.empty;
};

const isReading = (value: unknown): value is Effect.Effect<unknown> => Effect.isEffect(value);

/** What a reader gets from a live field's `changes` until the scope closes: it waits, in turns, for the first value, the value now. */
const collect = Effect.fnUntraced(function* (scope: Scope.Scope, reading: unknown) {
  const list: Array<unknown> = [];

  yield* Stream.runForEach(changesFrom(reading), (value) => Effect.sync(() => void list.push(value))).pipe(
    Effect.forkIn(scope),
  );

  for (let left = 1000; left > 0 && list.length === 0; left--) {
    yield* Effect.yieldNow;
  }

  expect(list.length, "`changes` gives the value now first").toBeGreaterThan(0);

  return list;
});

/** Starts a group on a scene and keeps it running: the rig holds the scope that ends it. */
const boot = Effect.fnUntraced(function* (group: Group, scene: Scene = {}) {
  const { app } = group;
  const site = places(app);
  const logs: Array<Line> = [];
  const spans: Array<Tracer.NativeSpan> = [];

  const folders = [ROOT, HOME, ...FILES.flatMap((file) => (scene.folders?.[file] === false ? [] : [site[file].dir]))];

  const files = Object.fromEntries(
    FILES.flatMap((file) => {
      const text = scene.texts?.[file];

      return text === undefined || scene.folders?.[file] === false ? [] : [[site[file].path, text] as const];
    }),
  );

  const disk = yield* MemoryFiles.live({ files, folders });

  if (scene.before !== undefined) {
    yield* disk.beforeReady(scene.before(disk));
  }

  for (const [path, fault] of Object.entries(scene.faults ?? {})) {
    yield* disk.plant(path, fault);
  }

  const tracer = Tracer.make({
    span: (options) => {
      const span = new Tracer.NativeSpan(options);
      spans.push(span);

      return span;
    },
  });

  const logger = Logger.map(Logger.formatStructured, (entry) => {
    logs.push({
      raw: JSON.stringify(entry),
      level: entry.level,
      message: entry.message,
      annotations: entry.annotations,
    });
  });

  const scope = yield* Scope.make();

  const system = Layer.merge(Recorder.layer(FileSystem.FileSystem, disk.fileSystem), Path.layer);

  const layer = SettingGroup.layer(group, { version: VERSION, repo: ROOT, flags: scene.flags ?? {} }).pipe(
    Layer.provideMerge(system),
  );

  const context = yield* Layer.buildWithScope(layer, scope).pipe(
    Effect.provide(Logger.layer([logger])),
    Effect.provideService(References.MinimumLogLevel, "All"),
    Effect.provideService(Tracer.Tracer, tracer),
    Effect.provide(ConfigProvider.layer(ConfigProvider.fromEnv({ env: environment(scene.env) }))),
  );

  const values: Readonly<Record<string, unknown>> = yield* Effect.provideContext(group, context);
  const seen: Record<string, Array<unknown>> = {};

  for (const setting of group.settings) {
    const name = fieldOfName(setting.name);
    const reading = values[name];

    if (setting.live && scene.collect !== false) {
      seen[name] = yield* collect(scope, reading);
    }
  }

  const rig: Rig = { group, app, disk, scope, context, logs, spans, seen, window: scene.window ?? WINDOW };

  return rig;
});

/** The scheduler turns the follower may take between an event reaching it and its timer being set. */
const TURNS = 10;

const turns = Effect.forEach(Array.from({ length: TURNS }), () => Effect.yieldNow, { discard: true, concurrency: 1 });

/** Lets every event the disk has given reach the layer's fiber, which then waits out its window on the clock. */
const settle = (rig: Rig) =>
  Effect.gen(function* () {
    for (let left = 1000; left > 0 && (yield* rig.disk.owed) > 0; left--) {
      yield* Effect.yieldNow;
    }

    yield* turns;
  });

/** Settles, moves the clock past the window, and lets the layer read, resolve and publish. */
const flush = (rig: Rig) => settle(rig).pipe(Effect.andThen(TestClock.adjust(rig.window)), Effect.andThen(turns));

/** Settles, then moves the clock less than a window: the burst goes on. */
const pause = (rig: Rig, millis = 10) =>
  settle(rig).pipe(Effect.andThen(TestClock.adjust(millis)), Effect.andThen(turns));

/** The value of each field now: a live field read, a restart field as it is. */
const reads = (rig: Rig) =>
  Effect.gen(function* () {
    const values: Readonly<Record<string, unknown>> = yield* Effect.provideContext(rig.group, rig.context);
    const now: Record<string, unknown> = {};

    for (const [name, value] of Object.entries(values)) {
      now[name] = isReading(value) ? yield* value : value;
    }

    return now;
  });

const originsNow = (rig: Rig): Effect.Effect<Readonly<Record<string, unknown>>> =>
  Effect.provideContext(SettingGroup.origins(rig.group), rig.context);

const close = (rig: Rig) => Scope.close(rig.scope, Exit.void);

/** What a fresh start gives on these texts: each field's value, and each origin. Nothing watches it for long: its scope is closed. */
const fresh = Effect.fnUntraced(function* (group: Group, scene: Scene) {
  const { before: _before, faults: _faults, ...rest } = scene;
  const rig = yield* boot(group, { ...rest, collect: false });
  const now = yield* reads(rig);
  const origins = yield* originsNow(rig);
  yield* close(rig);

  return { now, origins };
});

// ---------------------------------------------------------------------------------------------
// A script of changes to the two files, walked: each move is picked from what the file is now.
// ---------------------------------------------------------------------------------------------

/** What the walked disk holds now: the text of each file, and whether each file's folder is there. */
interface Model {
  readonly texts: Texts;
  readonly folders: Record<File, boolean>;
}

type Texts = Partial<Record<File, string>>;

const modelFrom = (scene: Scene): Model => {
  const folders = { repo: scene.folders?.repo !== false, user: scene.folders?.user !== false };

  return {
    folders,
    texts: Object.fromEntries(
      Object.entries(scene.texts ?? {}).filter(([file]) => folders[file === "repo" ? "repo" : "user"]),
    ),
  };
};

const Choices = Schema.Array(Schema.Int.check(Schema.isBetween({ minimum: 0, maximum: 3 }))).check(
  Schema.isMaxLength(3),
);

const Move = Schema.Literals(["edit", "replace", "remove"]);

const Intent = Schema.Struct({
  file: Schema.Literals(FILES),
  move: Move,
  choices: Choices,
  pad: Schema.Int.check(Schema.isBetween({ minimum: 0, maximum: 2 })),
});

type Intent = typeof Intent.Type;

/**
 * Does one move to one file: an intent is read against the file as it is now, so each is possible where it is made. It says
 * what it came to: `edit` a file in place, `replace` it by a rename over it, `create` it, `create by rename`, or `remove` it.
 */
const apply = (rig: Rig, specs: ReadonlyArray<Spec>, model: Model, intent: Intent): Effect.Effect<string> =>
  Effect.gen(function* () {
    const site = places(rig.app)[intent.file];
    const present = model.texts[intent.file] !== undefined;
    const text = render(specs, intent.choices, intent.pad);
    const swap = `${site.dir}/.${rig.app}.toml.swp`;

    if (intent.move === "remove" && present) {
      yield* rig.disk.remove(site.path);
      delete model.texts[intent.file];

      return "remove";
    }

    if (intent.move === "replace") {
      // An editor writes a new file beside the old one, then renames it over.
      yield* rig.disk.write(swap, text);
      yield* rig.disk.rename(swap, site.path);
      model.texts[intent.file] = text;

      return present ? "replace" : "create by rename";
    }

    yield* rig.disk.write(site.path, text);
    model.texts[intent.file] = text;

    return present ? "edit" : "create";
  });

const Script = Schema.Array(Intent).check(Schema.isMaxLength(6));

const Assign = Choices;

/** The moves every run makes whatever it generated, so each class of change is reached: in place, over a rename, a file made, a file removed, a comment-only change, a value moved from the user file to the repo file. */
const tour = (first: ReadonlyArray<number>, second: ReadonlyArray<number>): ReadonlyArray<Intent> => [
  ...FILES.flatMap((file) => [
    { file, move: "edit" as const, choices: first, pad: 0 },
    { file, move: "edit" as const, choices: first, pad: 1 },
    { file, move: "replace" as const, choices: second, pad: 0 },
    { file, move: "remove" as const, choices: first, pad: 0 },
    { file, move: "edit" as const, choices: first, pad: 0 },
  ]),
  { file: "repo", move: "remove", choices: first, pad: 0 },
  { file: "user", move: "edit", choices: second, pad: 0 },
  { file: "repo", move: "edit", choices: second, pad: 0 },
];

const Walk = Schema.Struct({ script: Script, first: Assign, second: Assign });

/** What a walk is shown at each step: the rig, the step and what it came to, the oracle's values and what the layer logged on the way. */
interface Step<S> {
  readonly rig: Rig;
  readonly step: S;
  readonly done: string;
  readonly model: Model;
  /** What a fresh start gives on the files now. */
  readonly want: Readonly<Record<string, unknown>>;
  /** What a fresh start gave on the files before this step. */
  readonly before: Readonly<Record<string, unknown>>;
  /** The log lines this step made. */
  readonly logged: ReadonlyArray<Line>;
}

/**
 * Walks steps over a started group, and checks after each that every live field's `changes` gives exactly the consecutive
 * distinct values a fresh start gives on the files, that yielding the field gives the last, and that each live setting's
 * origin is the one a fresh start gives. `required` names what each walk must have come to at least once. A law adds its own
 * check of a step with `onStep`.
 */
const walkWith = Effect.fnUntraced(function* <S>(
  group: Group,
  steps: ReadonlyArray<S>,
  move: (rig: Rig, model: Model, step: S) => Effect.Effect<string>,
  scene: Scene,
  required: ReadonlyArray<string>,
  onStep: (step: Step<S>) => Effect.Effect<void> = () => Effect.void,
) {
  const rig = yield* boot(group, scene);
  yield* flush(rig);

  const model = modelFrom(scene);
  const live = group.settings.filter((s) => s.live);
  const start = yield* fresh(group, { ...scene, texts: { ...model.texts }, folders: { ...model.folders } });
  const expected = Object.fromEntries(live.map((s) => [fieldOfName(s.name), [start.now[fieldOfName(s.name)]]]));
  const reached = new Set<string>();
  let before = start.now;

  for (const step of steps) {
    const mark = rig.logs.length;
    const done = yield* move(rig, model, step);
    reached.add(done);
    yield* flush(rig);

    const oracle = yield* fresh(group, { ...scene, texts: { ...model.texts }, folders: { ...model.folders } });
    const now = yield* reads(rig);
    const origins = yield* originsNow(rig);

    for (const s of live) {
      const name = fieldOfName(s.name);
      const sequence = expected[name] ?? [];

      if (!Equal.equals(oracle.now[name], sequence.at(-1))) {
        sequence.push(oracle.now[name]);
      }

      expect(rig.seen[name], `${s.name}'s changes after ${done}`).toEqual(sequence);
      expect(now[name], `${s.name} now, after ${done}`).toEqual(oracle.now[name]);
      expect(origins[s.name], `${s.name}'s origin after ${done}`).toEqual(oracle.origins[s.name]);
    }

    if (live.every((s) => Equal.equals(oracle.now[fieldOfName(s.name)], before[fieldOfName(s.name)]))) {
      reached.add("same");
    }

    yield* onStep({
      rig,
      step,
      done,
      model: { texts: { ...model.texts }, folders: { ...model.folders } },
      want: oracle.now,
      before,
      logged: rig.logs.slice(mark),
    });
    before = oracle.now;
  }

  // Every class of change is reached in each run, whatever was generated.
  for (const done of required) {
    expect(reached.has(done), `a run reaches ${done}`).toBe(true);
  }

  yield* close(rig);

  return rig;
});

/** Walks a script of intents and then the tour. */
const walk = (
  group: Group,
  specs: ReadonlyArray<Spec>,
  walked: typeof Walk.Type,
  scene: Scene = {},
  onStep: (step: Step<Intent>) => Effect.Effect<void> = () => Effect.void,
) =>
  walkWith(
    group,
    [...walked.script, ...tour(walked.first, walked.second)],
    (rig, model, intent) => apply(rig, specs, model, intent),
    scene,
    ["edit", "replace", "create", "remove", "same"],
    onStep,
  );

// ---------------------------------------------------------------------------------------------
// V1 and V8, a live setting follows its files
// ---------------------------------------------------------------------------------------------

// Plants: (a) keep only `Create` events: an in-place change is missed; (b) watch the file's own path: after a rename the
// watch follows the old file and sees nothing; (c) drop events for a name not read before: a created file is missed;
// (d) keep the held text when a file is removed: the value never falls back; (m) set the reference on every update:
// `changes` gives a value twice; (p) compare with `===`: a table value is given again on a comment change.
describe("V1 a live setting follows its files", () => {
  it.effect.prop(
    "each live field's `changes` gives the start value and then exactly the consecutive distinct values a fresh start gives on the files, and yielding it gives the last",
    { shape: Shape, walked: Walk },
    ({ shape, walked }) =>
      Effect.gen(function* () {
        const specs = specsFrom(shape);
        const reachedKinds = new Set<Kind>();

        yield* walk(groupFrom(shape.app, specs), specs, walked, { texts: { repo: render(specs, walked.first, 0) } });

        // A number, a table and an array are each compared by what they hold, so each kind is walked alone in every run.
        for (const kind of ["number", "table", "array"] as const) {
          const only = specs.map((spec) => ({ ...spec, kind }));
          reachedKinds.add(kind);
          yield* walk(groupFrom(shape.app, only), only, walked);
        }

        expect([...reachedKinds].sort()).toEqual(["array", "number", "table"]);
      }),
    check,
  );
});

// Plant (n): keep the held values in a plain object and read `held[s.name]`: the first update reads Object's `constructor`.
describe("V8 own keys only", () => {
  it.effect.prop(
    "a one-word live setting named constructor, beside others, starts and follows its files as V1 says",
    { shape: Shape, walked: Walk },
    ({ shape, walked }) =>
      Effect.gen(function* () {
        const specs: ReadonlyArray<Spec> = [
          { table: undefined, key: "constructor", kind: "number", live: true },
          ...shape.rest.filter((spec) => spec.key !== "constructor"),
        ];

        expect(apart(specs)).toBe(true);

        yield* walk(groupFrom(shape.app, specs), specs, walked);
      }),
    check,
  );
});

// ---------------------------------------------------------------------------------------------
// V2, a folder that comes and goes
// ---------------------------------------------------------------------------------------------

const Dig = Schema.Struct({ file: Schema.Literals(FILES), move: Schema.Literals(["drop", "make"]), choices: Choices });

type Dig = typeof Dig.Type;

/** A folder move picked from the folder as it is now: where it is, `drop` removes it with its file and `make` changes the file in place; where it is not, either makes the folder with the file in it. */
const dig = (rig: Rig, specs: ReadonlyArray<Spec>, model: Model, step: Dig): Effect.Effect<string> =>
  Effect.gen(function* () {
    const site = places(rig.app)[step.file];
    const text = render(specs, step.choices, 0);

    if (model.folders[step.file] && step.move === "drop") {
      yield* rig.disk.removeFolder(site.dir);
      model.folders[step.file] = false;
      delete model.texts[step.file];

      return "drop";
    }

    const there = model.folders[step.file];

    if (!there) {
      yield* rig.disk.makeFolder(site.dir);
      model.folders[step.file] = true;
    }

    yield* rig.disk.write(site.path, text);
    model.texts[step.file] = text;

    return there ? "edit" : "make";
  });

const Digging = Schema.Struct({
  script: Schema.Array(Dig).check(Schema.isMaxLength(6)),
  first: Assign,
  second: Assign,
  start: Schema.Struct({ repo: Schema.Boolean, user: Schema.Boolean }),
});

// Plants: (e) end the watch on `NotFound`: a folder made later is never seen; (f) keep watching the removed folder: the
// file made again in a new folder is missed.
describe("V2 a folder that comes and goes", () => {
  it.effect.prop(
    "with a file's folder missing at the start and made later, or removed while watched and made again, the live value follows the file each time, and the start does not wait for the folder",
    { shape: Shape, digging: Digging },
    ({ shape, digging }) =>
      Effect.gen(function* () {
        const specs = specsFrom(shape);
        const group = groupFrom(shape.app, specs);

        const steps = [
          ...digging.script,
          ...FILES.flatMap((file) =>
            (["drop", "make", "drop", "make"] as const).map((move) => ({ file, move, choices: digging.first })),
          ),
        ];

        // Each run starts with both folders missing, with both there, and as generated.
        for (const start of [{ repo: false, user: false }, { repo: true, user: true }, digging.start]) {
          const texts = {
            ...(start.repo ? { repo: render(specs, digging.second, 0) } : {}),
            ...(start.user ? { user: render(specs, digging.second, 0) } : {}),
          };

          yield* walkWith(group, steps, (rig, model, step) => dig(rig, specs, model, step), { texts, folders: start }, [
            "drop",
            "make",
            "same",
          ]);
        }
      }),
    check,
  );
});

// ---------------------------------------------------------------------------------------------
// V3, a burst is read once
// ---------------------------------------------------------------------------------------------

const BROKEN = "[[ this is not valid ===\n";

const Middle = Schema.Literals(["broken", "empty", "other"]);

const Burst = Schema.Struct({
  base: Assign,
  middles: Schema.Array(Middle).check(Schema.isMaxLength(3)),
  last: Assign,
  other: Assign,
  via: Schema.Literals(["edit", "replace"]),
  second: Assign,
});

const warnings = (rig: Rig) => rig.logs.filter((line) => line.level === "WARN");

const updates = (rig: Rig) => rig.spans.filter((span) => span.name === "config.update");

// Plants: (g) read on each event with no window: the empty text in the middle publishes the defaults; (h) debounce after
// merging the two files: a change to one file is lost.
describe("V3 a burst is read once", () => {
  it.effect.prop(
    "events on one file inside one window give one read after the window, of the last text, with no refusal logged for the broken text in the middle, and a change to each file inside one window is taken for both",
    { shape: Shape, burst: Burst },
    ({ shape, burst }) =>
      Effect.gen(function* () {
        const specs = specsFrom(shape);
        const group = groupFrom(shape.app, specs);
        const site = places(shape.app);
        const reachedMiddles = new Set<string>();

        // One file, a burst: a broken text and an empty one come first in every run.
        const rig = yield* boot(group, { texts: { repo: render(specs, burst.base, 0) } });
        yield* flush(rig);
        const reads0 = updates(rig).length;
        const first = yield* reads(rig);

        for (const middle of ["broken", "empty", ...burst.middles] as const) {
          reachedMiddles.add(middle);
          yield* rig.disk.write(
            site.repo.path,
            Match.value(middle).pipe(
              Match.when("broken", () => BROKEN),
              Match.when("empty", () => ""),
              Match.when("other", () => render(specs, burst.other, 1)),
              Match.exhaustive,
            ),
          );
          yield* pause(rig);
        }

        const last = render(specs, burst.last, 2);

        if (burst.via === "edit") {
          yield* rig.disk.write(site.repo.path, last);
        } else {
          yield* rig.disk.write(`${site.repo.dir}/.swp`, last);
          yield* rig.disk.rename(`${site.repo.dir}/.swp`, site.repo.path);
        }

        yield* flush(rig);

        const want = (yield* fresh(group, { texts: { repo: last } })).now;

        for (const s of specs.filter((spec) => spec.live)) {
          const name = field(s);
          expect(rig.seen[name], `${s.key}'s changes`).toEqual(
            Equal.equals(first[name], want[name]) ? [first[name]] : [first[name], want[name]],
          );
        }

        expect(warnings(rig), "no refusal is logged for the broken text").toEqual([]);
        expect(updates(rig).length - reads0, "the burst is read once").toBe(1);
        expect([...reachedMiddles].sort().slice(0, 2)).toEqual(["broken", "empty"]);
        yield* close(rig);

        // Both files, one window.
        const both = yield* boot(group, {
          texts: { repo: render(specs, burst.base, 0), user: render(specs, burst.second, 0) },
        });

        yield* flush(both);
        const reads1 = updates(both).length;
        const user = render(specs, burst.last, 1);
        const repo = render(specs, burst.second, 1);

        yield* both.disk.write(site.repo.path, repo);
        yield* pause(both);
        yield* both.disk.write(site.user.path, user);
        yield* flush(both);

        const both_ = (yield* fresh(group, { texts: { repo, user } })).now;
        const now = yield* reads(both);

        for (const s of specs.filter((spec) => spec.live)) {
          expect(now[field(s)], `${s.key} after a change to each file`).toEqual(both_[field(s)]);
        }

        expect(updates(both).length - reads1, "each file is read once").toBe(2);
        yield* close(both);
      }),
    check,
  );
});

// ---------------------------------------------------------------------------------------------
// V4, a refused change holds the last good values
// ---------------------------------------------------------------------------------------------

const refusing = (app: string) =>
  makeGroup(app, [
    Setting.make("a.one", Port).pipe(Setting.withDefault(DEFAULT), Setting.withDescription("One."), Setting.live),
    Setting.make("b.two", Port).pipe(Setting.withDefault(DEFAULT), Setting.withDescription("Two."), Setting.live),
    // Required: nothing sets it but the repo file.
    Setting.make("c.must", Port).pipe(Setting.withDescription("Needed.")),
    Setting.make("d.only", Port).pipe(
      Setting.withDefault(DEFAULT),
      Setting.withDescription("Only the user file."),
      Setting.files(["user"]),
    ),
  ]);

const goodRepo = (n: number) => `[a]\none = ${5000 + n}\n[c]\nmust = 7000\n`;

const goodUser = (n: number) => `[b]\ntwo = ${6000 + n}\n[d]\nonly = 8000\n`;

const REASONS = ["syntax", "unknown", "scope", "invalid", "version", "missing", "read"] as const;

type Reason = (typeof REASONS)[number];

/** One refused text: the reason it is refused for, the file, the text (with a changed value in it, so a taken one shows), and the token its line is found by. */
interface Refusal {
  readonly reason: Reason;
  readonly file: File;
  readonly text: (app: string, value: number) => string;
  readonly token?: string;
}

const REFUSALS: ReadonlyArray<Refusal> = [
  { reason: "syntax", file: "repo", text: (_, v) => `[a\none = ${v}\n` },
  { reason: "syntax", file: "user", text: (_, v) => `[b\ntwo = ${v}\n` },
  {
    reason: "unknown",
    file: "repo",
    text: (_, v) => `[a]\none = ${v}\n[c]\nmust = 7000\n[zzzz]\nkeykey = 1\n`,
    token: "keykey",
  },
  { reason: "unknown", file: "user", text: (_, v) => `[b]\ntwo = ${v}\n[zzzz]\nkeykey = 1\n`, token: "keykey" },
  {
    reason: "scope",
    file: "repo",
    text: (_, v) => `[a]\none = ${v}\n[c]\nmust = 7000\n[d]\nonly = 1\n`,
    token: "only",
  },
  { reason: "scope", file: "user", text: (app, v) => `${app}-version = "1.0.0"\n[b]\ntwo = ${v}\n`, token: "-version" },
  { reason: "invalid", file: "repo", text: (_, v) => `[a]\none = ${v}\n[c]\nmust = 0\n`, token: "must = 0" },
  { reason: "invalid", file: "user", text: (_, v) => `[b]\ntwo = ${v}\n[d]\nonly = 0\n`, token: "only = 0" },
  {
    reason: "version",
    file: "repo",
    text: (app, v) => `${app}-version = "99.0.0"\n[a]\none = ${v}\n[c]\nmust = 7000\n`,
    token: "-version",
  },
  { reason: "missing", file: "repo", text: (_, v) => `[a]\none = ${v}\n` },
  { reason: "read", file: "repo", text: (_, v) => `[a]\none = ${v}\n[c]\nmust = 7000\n` },
  { reason: "read", file: "user", text: (_, v) => `[b]\ntwo = ${v}\n` },
];

const Denied = Schema.Literals(["PermissionDenied", "Busy", "Unknown"]);

/** The error a disk answers in place of a file's text. */
const denial = (tag: typeof Denied.Type, path: string, method = "readFileString") =>
  PlatformError.systemError({ _tag: tag, module: "FileSystem", method, pathOrDescriptor: path });

const Refusing = Schema.Struct({
  app: Word,
  order: Schema.Array(Schema.Int).check(Schema.isMinLength(REFUSALS.length), Schema.isMaxLength(REFUSALS.length)),
  denied: Denied,
});

const lineHolding = (text: string, token: string) => text.split("\n").findIndex((line) => line.includes(token)) + 1;

// Plants: (i) publish before the whole-file check: an `unknown` or `scope` text is taken; (i) skip the minimum version on
// an update: a repo text asking for a newer app is taken; (i) end the message with `did not start.`; (v) end the follower
// after a refusal: the good text after it is missed.
describe("V4 a refused change holds the last good values", () => {
  it.effect.prop(
    "for a refused text of each reason, one warning names the file and the line, ends with the app keeping the last good values, and holds every value, origin and `changes`, and a later good text is taken",
    { input: Refusing },
    ({ input: { app, order, denied } }) =>
      Effect.gen(function* () {
        const group = refusing(app);
        const site = places(app);
        const texts: Texts = { repo: goodRepo(0), user: goodUser(0) };
        const rig = yield* boot(group, { texts });
        yield* flush(rig);

        const expected: Record<string, Array<unknown>> = { one: [5000], two: [6000] };
        const reached = new Set<string>();
        const sorted = REFUSALS.map((refusal, n) => ({ refusal, key: order[n] ?? 0 })).sort((x, y) => x.key - y.key);

        for (const [n, { refusal }] of sorted.entries()) {
          const place = site[refusal.file];
          const text = refusal.text(app, 5500 + n);
          const before = { seen: structuredClone(rig.seen), now: yield* reads(rig), origins: yield* originsNow(rig) };
          const mark = { logs: rig.logs.length, spans: updates(rig).length };

          if (refusal.reason === "read") {
            yield* rig.disk.breakRead(place.path, denial(denied, place.path));
          }

          yield* rig.disk.write(place.path, text);
          yield* flush(rig);

          const warned = rig.logs.slice(mark.logs).filter((line) => line.level === "WARN");
          const message = warned.map(said).join("\n");

          expect(warned, `${refusal.reason} in ${refusal.file}: one warning`).toHaveLength(1);
          expect(message).toContain(place.name);
          expect(
            message.trimEnd().endsWith(`${app} keeps the last good values.`),
            `${refusal.reason}: the message ends the way a refused change ends`,
          ).toBe(true);
          expect(warned[0]?.annotations["kalfa.config.file"]).toBe(place.name);

          if (refusal.token !== undefined) {
            expect(message).toContain(`${place.name}, line ${lineHolding(text, refusal.token)}`);
          }

          const span = updates(rig).slice(mark.spans).at(-1);
          expect(span?.attributes.get("kalfa.config.refused")).toBe(true);
          expect(span?.attributes.get("kalfa.config.reason")).toBe(refusal.reason);

          // Nothing the refused text held reached a reader.
          expect(rig.seen).toEqual(before.seen);
          expect(yield* reads(rig)).toEqual(before.now);
          expect(yield* originsNow(rig)).toEqual(before.origins);
          reached.add(refusal.reason);

          // A later good text is taken.
          if (refusal.reason === "read") {
            yield* rig.disk.breakRead(place.path);
          }

          const good = refusal.file === "repo" ? goodRepo(n + 1) : goodUser(n + 1);
          texts[refusal.file] = good;
          const warnedBefore = warnings(rig).length;

          yield* rig.disk.write(place.path, good);
          yield* flush(rig);

          const want = (yield* fresh(group, { texts: { ...texts } })).now;

          for (const name of ["one", "two"]) {
            if (!Equal.equals(want[name], expected[name]?.at(-1))) {
              expected[name]?.push(want[name]);
            }
          }

          expect(rig.seen, `the good text after ${refusal.reason} in ${refusal.file}`).toEqual(expected);
          expect(yield* reads(rig)).toEqual(want);
          expect(warnings(rig), "a good text logs nothing").toHaveLength(warnedBefore);
        }

        expect([...reached].sort()).toEqual([...REASONS].sort());
        yield* close(rig);
      }),
    check,
  );
});

// ---------------------------------------------------------------------------------------------
// V5, precedence holds while running
// ---------------------------------------------------------------------------------------------

const PIN: Spec = { table: "a", key: "pin", kind: "number", live: true };

const HELD: Spec = { table: "b", key: "env", kind: "number", live: true };

const FREE: Spec = { table: "c", key: "free", kind: "number", live: true };

const PRECEDENCE: ReadonlyArray<Spec> = [PIN, HELD, FREE];

// Plants: (j) resolve an update from the files only: the flag's value is replaced; (k) the same for the variable.
describe("V5 precedence holds while running", () => {
  it.effect.prop(
    "a live setting a flag or a variable sets keeps that value and origin through any script of file changes, and one nothing sets follows the files",
    { app: Word, script: Script },
    ({ app, script }) =>
      Effect.gen(function* () {
        const group = groupFrom(app, PRECEDENCE);

        const scene: Scene = {
          flags: { [named(PIN)]: Option.some("4999") },
          env: { [variable(app, HELD)]: "4998" },
        };

        const rig = yield* walk(group, PRECEDENCE, { script, first: [1, 1, 1], second: [2, 2, 2] }, scene, (step) =>
          Effect.gen(function* () {
            const origins = yield* originsNow(step.rig);

            expect(step.rig.seen.pin).toEqual([4999]);
            expect(step.rig.seen.env).toEqual([4998]);
            expect(origins["a.pin"]).toEqual({ _tag: "flag", name: "--a.pin" });
            expect(origins["b.env"]).toEqual({ _tag: "env", name: variable(app, HELD) });
          }),
        );

        // The setting nothing pins moved, so the law is not about a file that never changes anything.
        expect((rig.seen[field(FREE)] ?? []).length).toBeGreaterThan(1);
      }),
    check,
  );
});

// ---------------------------------------------------------------------------------------------
// V6, a restart setting waits for a restart
// ---------------------------------------------------------------------------------------------

const RESTART: ReadonlyArray<Spec> = [
  { table: "a", key: "live", kind: "number", live: true },
  { table: "b", key: "first", kind: "number", live: false },
  { table: "c", key: "second", kind: "number", live: false },
];

// Plants: (l) log on every update that has a restart setting: an unchanged one is logged; log nothing.
describe("V6 a restart setting waits for a restart", () => {
  it.effect.prop(
    "through any script of file changes a restart field reads its start value, and each change of its resolved value logs one info line naming the setting and the file, never the value, and no line when it did not change",
    { app: Word, script: Script },
    ({ app, script }) =>
      Effect.gen(function* () {
        const group = groupFrom(app, RESTART);
        const walked = { script, first: [1, 1, 1], second: [2, 3, 2] };
        const restart = RESTART.filter((spec) => !spec.live);
        const site = places(app);
        let start: Readonly<Record<string, unknown>> | undefined;
        let logged = 0;

        yield* walk(group, RESTART, walked, { texts: { repo: render(RESTART, walked.first, 0) } }, (step) =>
          Effect.gen(function* () {
            start ??= step.before;
            const now = yield* reads(step.rig);

            for (const spec of restart) {
              const name = field(spec);
              const changed = !Equal.equals(step.want[name], step.before[name]);
              const lines = step.logged.filter((line) => said(line).includes(named(spec)));

              expect(now[name], `${named(spec)} still reads its start value`).toEqual(start[name]);
              expect(lines, `${named(spec)} changed: ${changed}`).toHaveLength(changed ? 1 : 0);

              for (const line of lines) {
                const words = said(line).replaceAll(site[step.step.file].name, "").replaceAll(app, "");
                expect(line.level).toBe("INFO");
                expect(said(line)).toContain(site[step.step.file].name);
                expect(words).not.toContain(String(step.want[name]));
                logged += 1;
              }
            }
          }),
        );

        // Some run changes a restart value: the law is not about a script that changes none.
        expect(logged).toBeGreaterThan(0);
      }),
    check,
  );
});

// ---------------------------------------------------------------------------------------------
// V7, origins follow live values
// ---------------------------------------------------------------------------------------------

/** The texts a disk holds, left out where a file is not there. */
const present = (files: Readonly<Record<File, string | undefined>>): Texts => ({
  ...(files.repo === undefined ? {} : { repo: files.repo }),
  ...(files.user === undefined ? {} : { user: files.user }),
});

const MOVING: ReadonlyArray<Spec> = [
  { table: "a", key: "live", kind: "number", live: true },
  { table: "b", key: "rest", kind: "number", live: false },
];

// scenario: a live and a restart setting, each moved from the user file to the repo file and back.
// Plant: keep the start's origins for a live setting.
it.effect(
  "V7 scenario: after each taken change a live setting's origin is the one a fresh start gives, and a restart setting keeps its start origin",
  () =>
    Effect.gen(function* () {
      const group = groupFrom("demo", MOVING);

      for (const home of ["user", "repo"] as const) {
        const other = home === "user" ? "repo" : "user";
        const texts: Texts = { [home]: render(MOVING, [1, 1], 1) };
        const rig = yield* boot(group, { texts });
        yield* flush(rig);
        const started = yield* originsNow(rig);

        const moves: ReadonlyArray<(disk: MemoryFiles.LiveDisk) => Effect.Effect<void>> = [
          (disk) => disk.write(places("demo")[other].path, render(MOVING, [2, 2], 2)),
          (disk) => disk.remove(places("demo")[other].path),
          (disk) => disk.write(places("demo")[home].path, render(MOVING, [3, 3], 0)),
          (disk) => disk.write(places("demo")[other].path, render(MOVING, [3, 3], 1)),
        ];

        for (const move of moves) {
          yield* move(rig.disk);
          yield* flush(rig);

          const files = {
            repo: yield* rig.disk.text(places("demo").repo.path),
            user: yield* rig.disk.text(places("demo").user.path),
          };

          const oracle = yield* fresh(group, { texts: present(files) });
          const origins = yield* originsNow(rig);

          expect(origins["a.live"]).toEqual(oracle.origins["a.live"]);
          expect(origins["b.rest"], "a restart setting keeps its start origin").toEqual(started["b.rest"]);
        }

        yield* close(rig);
      }
    }),
);

// ---------------------------------------------------------------------------------------------
// V9, an asynchronous schema
// ---------------------------------------------------------------------------------------------

const Later = Schema.Int.pipe(
  Schema.decodeTo(Schema.Int, {
    decode: SchemaGetter.transformEffect((n: number) =>
      Effect.callback<number>((resume) => queueMicrotask(() => resume(Effect.succeed(n)))),
    ),
    encode: SchemaGetter.passthrough(),
  }),
);

// One asynchronous live setting, three texts in turn, over a generated name.
// Plant (o): check the update with `Schema.decodeUnknownResult`: the update dies.
describe("V9 an asynchronous schema", () => {
  it.effect.prop(
    "a live setting whose schema decodes in a later turn follows its file through three texts",
    { app: Word, slot: Slot },
    ({ app, slot }) =>
      Effect.gen(function* () {
        const spec: Spec = { ...slot, kind: "number", live: true };

        const group = makeGroup(app, [
          Setting.make(named(spec), Later).pipe(
            Setting.withDefault(DEFAULT),
            Setting.withDescription("Decoded later."),
            Setting.live,
          ),
        ]);

        const rig = yield* boot(group, { texts: { repo: render([spec], [1], 0) } });
        yield* flush(rig);
        yield* rig.disk.write(places(app).repo.path, render([spec], [2], 0));
        yield* flush(rig);
        yield* rig.disk.write(places(app).repo.path, render([spec], [3], 0));
        yield* flush(rig);

        expect(rig.seen[field(spec)]).toEqual([4101, 4102, 4103]);
        expect(warnings(rig)).toEqual([]);
        yield* close(rig);
      }),
    check,
  );
});

// ---------------------------------------------------------------------------------------------
// V10, a watch that cannot be made is logged, never fatal
// ---------------------------------------------------------------------------------------------

const Faulted = Schema.Struct({
  app: Word,
  denied: Denied,
  target: Schema.Literals(["repo", "user", "parent"]),
  seeds: Schema.Tuple([
    Schema.Int.check(Schema.isBetween({ minimum: 1, maximum: 2 })),
    Schema.Int.check(Schema.isBetween({ minimum: 1, maximum: 2 })),
  ]),
});

const TWO: ReadonlyArray<Spec> = [
  { table: "a", key: "one", kind: "number", live: true },
  { table: "b", key: "two", kind: "number", live: true },
];

// Plant (q): let the fault end the follower without a log: no warning, and the other file stops too.
describe("V10 a watch that cannot be made is logged, never fatal", () => {
  it.effect.prop(
    "with a fault planted on a folder's watch the layer starts, one warning names the file, the values hold, and the other file is still followed",
    { input: Faulted },
    ({ input: { app, denied, target, seeds } }) =>
      Effect.gen(function* () {
        const group = groupFrom(app, TWO);
        const site = places(app);
        const [one, two] = seeds;

        const path = Match.value(target).pipe(
          Match.when("repo", () => site.repo.dir),
          Match.when("user", () => site.user.dir),
          Match.when("parent", () => HOME),
          Match.exhaustive,
        );

        const unwatched = target === "repo" ? "repo" : "user";
        const followed = target === "repo" ? "user" : "repo";

        const rig = yield* boot(group, {
          texts: { repo: render(TWO, [one, 0], 0), user: render(TWO, [0, two], 0) },
          folders: { user: target !== "parent" },
          faults: { [path]: denial(denied, path, "watch") },
        });

        yield* flush(rig);

        // A parent that cannot be watched leaves a missing folder unwatched.
        const warned = warnings(rig);
        expect(warned, "one warning").toHaveLength(1);
        expect(warned.map(said).join(" ")).toContain(site[unwatched].name);

        const mark = rig.logs.length;
        const now = yield* reads(rig);

        // Both files change on the disk. The file that is watched is followed, and the program does not see the other.
        if (target === "parent") {
          yield* rig.disk.makeFolder(site.user.dir);
        }

        yield* rig.disk.write(site.repo.path, render(TWO, [3, 0], 0));
        yield* rig.disk.write(site.user.path, render(TWO, [0, 3], 0));

        yield* flush(rig);

        const later = yield* reads(rig);
        const moved = followed === "repo" ? "one" : "two";
        const stayed = followed === "repo" ? "two" : "one";

        expect(later[moved], "the watched file is followed").toBe(4103);
        expect(later[stayed], "the unwatched file is not").toBe(now[stayed]);
        expect(rig.logs.slice(mark).filter((line) => line.level === "WARN")).toEqual([]);
        yield* close(rig);
      }),
    check,
  );
});

// ---------------------------------------------------------------------------------------------
// V11, no live setting, no watch
// ---------------------------------------------------------------------------------------------

const watchCalls = (rig: Rig) => Effect.provideContext(Recorder.calls(FileSystem.FileSystem, "watch"), rig.context);

// Plant (s): fork the follower for every group: a watch call is recorded.
describe("V11 no live setting, no watch", () => {
  it.effect.prop(
    "a group of restart settings makes no watch call and opens no watch, where the same group with a live setting does",
    { shape: Shape },
    ({ shape }) =>
      Effect.gen(function* () {
        const specs = specsFrom(shape);
        const texts = { repo: render(specs, [1, 1, 1], 0), user: render(specs, [2, 2, 2], 0) };

        const still = yield* boot(
          groupFrom(
            shape.app,
            specs.map((spec) => ({ ...spec, live: false })),
          ),
          { texts },
        );

        yield* flush(still);
        expect(yield* watchCalls(still), "a restart-only group watches nothing").toEqual([]);
        expect(yield* still.disk.open).toBe(0);
        yield* close(still);

        // The same group with a live setting watches, so the law is about the group and not about the stand-in.
        const moving = yield* boot(groupFrom(shape.app, specs), { texts });
        yield* flush(moving);
        expect((yield* watchCalls(moving)).length).toBeGreaterThan(0);
        expect(yield* moving.disk.open).toBeGreaterThan(0);
        yield* close(moving);
      }),
    check,
  );
});

// ---------------------------------------------------------------------------------------------
// V12, the watch ends with the layer
// ---------------------------------------------------------------------------------------------

// A change written, and the scope closed inside its window, over generated groups.
// Plant (t): fork the follower with `Effect.forkDetach`: a watch stays open.
describe("V12 the watch ends with the layer", () => {
  it.effect.prop(
    "once the layer's scope closes no watch is open, and a change that was waiting out its window logs and publishes nothing",
    { shape: Shape, walked: Walk },
    ({ shape, walked }) =>
      Effect.gen(function* () {
        const specs = specsFrom(shape);
        const group = groupFrom(shape.app, specs);
        const rig = yield* boot(group, { texts: { repo: render(specs, [1, 1, 1], 0) } });
        yield* flush(rig);

        const marks = { logs: rig.logs.length, updates: updates(rig).length, seen: structuredClone(rig.seen) };
        const now = yield* reads(rig);

        yield* rig.disk.write(places(shape.app).repo.path, render(specs, [2, 2, 2], 1));
        yield* settle(rig);
        expect(yield* rig.disk.open, "the watch is open while the layer lives").toBeGreaterThan(0);

        yield* close(rig);
        expect(yield* rig.disk.open, "the watch ends with the layer").toBe(0);

        yield* rig.disk.write(places(shape.app).user.path, render(specs, walked.first, 0));
        yield* TestClock.adjust(rig.window * 3);
        yield* turns;

        expect(rig.logs.length).toBe(marks.logs);
        expect(updates(rig).length).toBe(marks.updates);
        expect(rig.seen).toEqual(marks.seen);
        expect(yield* reads(rig)).toEqual(now);
        expect(yield* rig.disk.owed).toBe(0);
      }),
    check,
  );
});

// ---------------------------------------------------------------------------------------------
// V13, nothing slips in at the start
// ---------------------------------------------------------------------------------------------

// Plant (u): emit no tick when the watch is ready: the change is missed.
describe("V13 nothing slips in at the start", () => {
  it.effect.prop(
    "a change made after the start's read and before a watch is ready is taken, and the layer is built only after both watches are ready",
    { shape: Shape, which: Schema.Literals(FILES) },
    ({ shape, which }) =>
      Effect.gen(function* () {
        const specs = specsFrom(shape);
        const group = groupFrom(shape.app, specs);
        const site = places(shape.app);

        const rig = yield* boot(group, {
          texts: { repo: render(specs, [1, 1, 1], 0), user: render(specs, [1, 1, 1], 0) },
          // The disk changes the file while its watch is being installed, and the watch takes some turns to be ready.
          before: (disk) => {
            let done = false;

            return (path) =>
              Effect.gen(function* () {
                if (!done && path === site[which].dir) {
                  done = true;
                  yield* disk.write(site[which].path, render(specs, [3, 3, 3], 0));
                }

                yield* turns;
              });
          },
        });

        expect(yield* rig.disk.ready, "both watches are ready when the layer is built").toEqual(
          expect.arrayContaining([site.repo.dir, site.user.dir]),
        );

        yield* flush(rig);

        const [one, three] = [render(specs, [1, 1, 1], 0), render(specs, [3, 3, 3], 0)];
        const changed: Texts = which === "repo" ? { repo: three, user: one } : { repo: one, user: three };
        const want = (yield* fresh(group, { texts: changed })).now;
        const now = yield* reads(rig);

        for (const spec of specs.filter((s) => s.live)) {
          expect(now[field(spec)], `${named(spec)} has the change made while the watch was installed`).toEqual(
            want[field(spec)],
          );
        }

        yield* close(rig);
      }),
    check,
  );
});

// ---------------------------------------------------------------------------------------------
// V14 [secrets], values stay out
// ---------------------------------------------------------------------------------------------

/** Every form a secret may take in text: raw, JSON-escaped and URL-encoded. */
const forms = (secret: string) => [secret, JSON.stringify(secret).slice(1, -1), encodeURIComponent(secret)];

// A secret-looking word, with a character that changes in JSON and in a URL.
const Hidden = Schema.String.check(Schema.isPattern(/^sk-([A-Za-z0-9]{6,12})["/ +\\&][A-Za-z0-9]{3}$/u));

const HIDDEN = ["unknown", "invalid", "syntax", "table", "scope"] as const;

describe("V14 [secrets], values stay out", () => {
  for (const kind of HIDDEN) {
    // Plant: log the file's text with the refusal.
    it.effect.prop(
      `a secret in a ${kind} text reaches no log line, span attribute or span event, raw, escaped or encoded`,
      { app: Word, secret: Hidden },
      ({ app, secret }) =>
        Effect.gen(function* () {
          const group = refusing(app);
          const quoted = JSON.stringify(secret);

          const text = {
            unknown: `[a]\none = 5500\n[zzzz]\nkeykey = ${quoted}\n`,
            invalid: `[a]\none = ${quoted}\n`,
            syntax: `[a\none = ${quoted} ${quoted}\n`,
            table: `[a.one]\nnested = ${quoted}\n`,
            scope: `[a]\none = 5500\n[c]\nmust = 7000\n[d]\nonly = ${quoted}\n`,
          }[kind];

          const rig = yield* boot(group, { texts: { repo: goodRepo(0), user: goodUser(0) } });
          yield* flush(rig);
          const mark = { logs: rig.logs.length, spans: rig.spans.length };

          yield* rig.disk.write(places(app).repo.path, text);
          yield* flush(rig);

          // The refusal happened, so what is scanned is not nothing.
          expect(warnings(rig).length).toBeGreaterThan(0);
          expect(updates(rig).length).toBeGreaterThan(0);

          const outputs = [
            ...rig.logs.slice(mark.logs).map((line) => line.raw),
            ...rig.spans
              .slice(mark.spans)
              .flatMap((span) => [
                span.name,
                ...[...span.attributes.entries()].map(([key, value]) => `${key}=${String(value)}`),
                ...span.events.map((event) => JSON.stringify(event)),
              ]),
          ];

          for (const output of outputs) {
            for (const form of forms(secret)) {
              expect(output).not.toContain(form);
            }
          }

          yield* close(rig);
        }),
      check,
    );
  }
});

// ---------------------------------------------------------------------------------------------
// V15, each update is a span
// ---------------------------------------------------------------------------------------------

// One taken and one refused change, over a generated app name.
// Plants: make the span a child of `config.layer`; leave `kalfa.config.refused` out.
it.effect.prop(
  "V15 each update ends one root config.update span with the app, the file, whether it was refused, and the reason when refused",
  { app: Word },
  ({ app }) =>
    Effect.gen(function* () {
      const rig = yield* boot(refusing(app), { texts: { repo: goodRepo(0), user: goodUser(0) } });
      yield* flush(rig);
      const mark = updates(rig).length;

      yield* rig.disk.write(places(app).repo.path, goodRepo(1));
      yield* flush(rig);
      yield* rig.disk.write(places(app).repo.path, `[a]\none = 5500\n[zzzz]\nkeykey = 1\n`);
      yield* flush(rig);

      const [taken, refused, ...rest] = updates(rig).slice(mark);
      expect(rest, "one span for each update").toEqual([]);

      for (const span of [taken, refused]) {
        expect(span?.status._tag).toBe("Ended");
        expect(Option.isNone(span?.parent ?? Option.some(undefined)), "a root span").toBe(true);
        expect(span?.attributes.get("kalfa.config.app")).toBe(app);
        expect(span?.attributes.get("kalfa.config.file")).toBe("repo");
      }

      expect(taken?.attributes.get("kalfa.config.refused")).toBe(false);
      expect(taken?.attributes.has("kalfa.config.reason")).toBe(false);
      expect(refused?.attributes.get("kalfa.config.refused")).toBe(true);
      expect(refused?.attributes.get("kalfa.config.reason")).toBe("unknown");
      yield* close(rig);
    }),
  check,
);

// ---------------------------------------------------------------------------------------------
// V16 [protocol], no setter
// ---------------------------------------------------------------------------------------------

/** Whether a value is, or holds in a property of its own or of its prototypes to depth three, a `SubscriptionRef` or a `PubSub`. */
const holdsSetter = (value: unknown, depth = 0): boolean => {
  if (SubscriptionRef.isSubscriptionRef(value) || PubSub.isPubSub(value)) {
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

  return found.some((next) => holdsSetter(next, depth + 1));
};

/** The writes a caller can try on a property: set it, define it, delete it. */
const WRITES: ReadonlyArray<(target: object, key: PropertyKey, junk: unknown) => unknown> = [
  (target, key, junk) => Object.assign(target, { [key]: junk }),
  (target, key, junk) =>
    Object.defineProperty(target, key, { value: junk, writable: true, configurable: true, enumerable: true }),
  (target, key) => Reflect.deleteProperty(target, key),
];

const tamper = (write: (typeof WRITES)[number], target: unknown, key: PropertyKey, junk: unknown) =>
  Predicate.isObjectOrArray(target)
    ? Effect.ignore(Effect.try({ try: () => write(target, key, junk), catch: () => "refused" as const }))
    : Effect.void;

// One live setting, B16's writes tried on `changes`, over a generated junk value.
// Plant: expose `changes` as an object that keeps the PubSub.
describe("V16 [protocol] no setter", () => {
  it.effect.prop(
    "a live field's changes holds no SubscriptionRef and no PubSub to depth three, writes on it change nothing a later reader gets, and a value the layer sets still reaches it",
    { app: Word, junk: Schema.Int.check(Schema.isBetween({ minimum: 1000, maximum: 60000 })) },
    ({ app, junk }) =>
      Effect.gen(function* () {
        const spec: Spec = { table: "a", key: "one", kind: "number", live: true };
        const group = groupFrom(app, [spec]);
        const rig = yield* boot(group, { texts: { repo: render([spec], [1], 0) }, collect: false });
        yield* flush(rig);

        const values: Readonly<Record<string, unknown>> = yield* Effect.provideContext(group, rig.context);
        const reading = values.one;
        const changes = Predicate.hasProperty(reading, "changes") ? reading.changes : undefined;

        expect(isChanges(changes), "changes is a Stream").toBe(true);
        expect(holdsSetter(changes), "changes holds no reference").toBe(false);
        expect(holdsSetter(reading), "a live field holds no reference").toBe(false);

        for (const write of WRITES) {
          for (const key of [
            ...(Predicate.isObject(changes) ? Reflect.ownKeys(changes) : []),
            "ref",
            "pubsub",
            "publish",
            "set",
          ]) {
            yield* tamper(write, changes, key, () => Effect.succeed(junk));
          }

          for (const key of ["changes", "ref", "asEffect"]) {
            yield* tamper(write, reading, key, Stream.make(junk));
          }
        }

        const later: Readonly<Record<string, unknown>> = yield* Effect.provideContext(group, rig.context);
        const seen = yield* collect(rig.scope, later.one);

        expect(later.one, "the same live field").toBe(reading);
        expect(seen).toEqual([4101]);

        yield* rig.disk.write(places(app).repo.path, render([spec], [2], 0));
        yield* flush(rig);

        expect(seen, "a value the layer sets reaches a reader after the writes").toEqual([4101, 4102]);
        yield* close(rig);
      }),
    check,
  );
});

// ---------------------------------------------------------------------------------------------
// V17, the quiet window is a setting
// ---------------------------------------------------------------------------------------------

const Millis = Schema.Int.check(
  Schema.isBetween({ minimum: 20, maximum: 1500 }),
  Schema.makeFilter((n) => n !== WINDOW),
);

const Source = Schema.Literals(["flag", "env", "repo", "user"]);

// Plant: read the default whatever the sources say.
describe("V17 the quiet window is a setting", () => {
  it.effect.prop(
    "for a window given by flag, variable, repo file or user file, the follower waits that long, a burst inside it is read once, a change after it is read on its own, and the origin names the source",
    { app: Word, millis: Millis, source: Source },
    ({ app, millis, source }) =>
      Effect.gen(function* () {
        const spec: Spec = { table: "a", key: "one", kind: "number", live: true };
        const group = groupFrom(app, [spec]);
        const given = `${millis} millis`;
        const named_ = "config.watch.debounce";
        const lines = `[config.watch]\ndebounce = "${given}"\n`;
        const text = (choice: number) => `${render([spec], [choice], 0)}${source === "repo" ? lines : ""}`;

        const rig = yield* boot(group, {
          texts: { repo: text(1), ...(source === "user" ? { user: lines } : {}) },
          flags: source === "flag" ? { [named_]: Option.some(given) } : {},
          env: source === "env" ? { [`${app.toUpperCase()}_CONFIG_WATCH_DEBOUNCE`]: given } : {},
          window: millis,
        });

        yield* flush(rig);

        const origin = (yield* originsNow(rig))[named_];

        const want = Match.value(source).pipe(
          Match.when("flag", () => ({ _tag: "flag", name: `--${named_}` })),
          Match.when("env", () => ({ _tag: "env", name: `${app.toUpperCase()}_CONFIG_WATCH_DEBOUNCE` })),
          Match.orElse((file) => ({
            _tag: "file",
            file: places(app)[file].name,
            line: lineHolding(file === "repo" ? text(1) : lines, "debounce"),
          })),
        );

        expect(origin).toEqual(want);

        const write = (choice: number) => rig.disk.write(places(app).repo.path, text(choice));
        const wait = (ms: number) => settle(rig).pipe(Effect.andThen(TestClock.adjust(ms)), Effect.andThen(turns));

        // One change, read when the window has passed and not before.
        yield* write(2);
        yield* wait(millis - 1);
        expect(rig.seen.one, "not before the window").toEqual([4101]);
        yield* wait(1);
        expect(rig.seen.one, "after the window").toEqual([4101, 4102]);

        // A burst inside the window is read once, a window after its last change.
        yield* write(3);
        yield* wait(millis - 1);
        yield* write(1);
        yield* wait(millis - 1);
        expect(rig.seen.one, "a burst is not read before its window").toEqual([4101, 4102]);
        yield* wait(1);
        expect(rig.seen.one, "a burst is read once").toEqual([4101, 4102, 4101]);

        yield* close(rig);
      }),
    check,
  );
});

// ---------------------------------------------------------------------------------------------
// V18, the window is a flag of a group that has a live setting
// ---------------------------------------------------------------------------------------------

/** What a command made with the group's flags lists, from Effect's own read of it. */
const listed = (group: Group) => {
  const command = Command.make("demo", { settings: SettingGroup.flags(group) });
  const spec = Option.getOrThrow(CommandSpec.resolve(command, ["demo"], { builtIns: [] }));

  return spec.flags.map((flag) => ({ name: flag.name, description: flag.description }));
};

// Plant: add the setting to every group.
describe("V18 the window is a flag of a group that has a live setting", () => {
  it.prop(
    "a group with a live setting lists config.watch.debounce among its flags with a description, a group with none does not, and a group that declares the name itself throws at make",
    { shape: Shape },
    ({ shape }) => {
      const specs = specsFrom(shape);
      const mine = (group: Group) => listed(group).find((flag) => flag.name === "config.watch.debounce");

      const watching = mine(groupFrom(shape.app, specs));
      expect(watching, "a live group lists the window").toBeDefined();
      expect(watching?.description ?? "").not.toBe("");

      expect(
        mine(
          groupFrom(
            shape.app,
            specs.map((spec) => ({ ...spec, live: false })),
          ),
        ),
        "a restart-only group does not",
      ).toBeUndefined();

      for (const live of [true, false]) {
        const own = Setting.make("config.watch.debounce", Schema.String).pipe(
          Setting.withDefault("1 second"),
          Setting.withDescription("My own."),
        );

        const made = () =>
          makeGroup(shape.app, [...specs.map((spec) => declare(spec)), live ? Setting.live(own) : own]);

        expect(made).toThrow(/config\.watch\.debounce/u);
      }
    },
    check,
  );
});
