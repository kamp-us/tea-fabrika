// Ticket 1841, kalfa/config (new work): R3 of the approved plan (.kalfa/quests/kalfa-config-live-PLAN.md, with its
// Amendment 1). The laws of SettingGroup.live.test.ts run on the live stand-in disk in MemoryFiles.test-support.ts, so this
// one checks that stand-in against a real temp folder through NodeServices, as R1 does for the plain one: the same six
// scripts of file changes must give a live setting the same values on a real disk and in memory, and a watch on a file's own
// path must hear nothing of a file that is renamed over it, on both. It writes to a temp folder and waits on real time, so it
// is an integration law: it runs in main's full run, in a proof run the lead starts, and on macOS through the `config-watch`
// suite of .github/workflows/host.yaml. It is the one place that says what inotify, FSEvents and kqueue report.
//
// Each case waits on real time, up to ten seconds, for the value it expects. The quiet window is set short with the group's
// own setting, `config.watch.debounce`, so a case takes well under a second when the watch works.
//
// Plant: watch the file's own path in place of its folder: case (b), a rename over the file, is missed on the real disk.
import { NodeServices } from "@effect/platform-node";
import { expect, it } from "@effect/vitest";
import type { Path } from "effect";
import { ConfigProvider, Duration, Effect, Exit, FileSystem, Layer, Schema, Scope, Stream } from "effect";
import { Setting, SettingGroup } from "./index.ts";
import * as MemoryFiles from "./MemoryFiles.test-support.ts";

const Port = Schema.Int.check(Schema.isBetween({ minimum: 1, maximum: 65535 }));

const DEFAULT = 18787;

const group = SettingGroup.make(
  "demo",
  Setting.make("net.port", Port).pipe(Setting.withDefault(DEFAULT), Setting.withDescription("The port."), Setting.live),
);

const text = (port: number) => `[net]\nport = ${port}\n`;

/** What a script does to the files: the same moves on a real disk and in memory. */
interface Driver {
  readonly root: string;
  readonly write: (path: string, body: string) => Effect.Effect<void>;
  readonly rename: (from: string, to: string) => Effect.Effect<void>;
  readonly remove: (path: string) => Effect.Effect<void>;
  readonly makeFolder: (path: string) => Effect.Effect<void>;
  readonly removeFolder: (path: string) => Effect.Effect<void>;
  /** The file system and path service the layer runs on. */
  readonly files: Layer.Layer<FileSystem.FileSystem | Path.Path>;
}

/** A real temp folder with `repo/` and `home/` in it. It is removed when the scope closes. */
const diskDriver = Effect.fnUntraced(function* () {
  const fs = yield* FileSystem.FileSystem;
  const root = yield* fs.makeTempDirectoryScoped({ prefix: "kalfa-config-live-" });

  yield* fs.makeDirectory(`${root}/repo`, { recursive: true });
  yield* fs.makeDirectory(`${root}/home`, { recursive: true });

  const driver: Driver = {
    root,
    write: (path, body) => Effect.orDie(fs.writeFileString(path, body)),
    rename: (from, to) => Effect.orDie(fs.rename(from, to)),
    remove: (path) => Effect.orDie(fs.remove(path)),
    makeFolder: (path) => Effect.orDie(fs.makeDirectory(path, { recursive: true })),
    removeFolder: (path) => Effect.orDie(fs.remove(path, { recursive: true })),
    files: NodeServices.layer,
  };

  return driver;
});

/** The same folders on the live stand-in disk. */
const memoryDriver = Effect.fnUntraced(function* () {
  const root = "/mem";
  const disk = yield* MemoryFiles.live({ folders: [`${root}/repo`, `${root}/home`] });

  const driver: Driver = {
    root,
    write: disk.write,
    rename: disk.rename,
    remove: disk.remove,
    makeFolder: disk.makeFolder,
    removeFolder: disk.removeFolder,
    files: disk.layer,
  };

  return driver;
});

/** One file change: what is done, and the value a live setting gives next. */
interface Move {
  readonly run: (driver: Driver, dir: string) => Effect.Effect<void>;
  readonly value: number;
}

interface Case {
  readonly name: string;
  /** The repo file's text at the start, or none, and whether its folder is there. */
  readonly start: { readonly text?: string; readonly folder: boolean };
  /** The value `changes` gives first. */
  readonly first: number;
  readonly moves: ReadonlyArray<Move>;
}

const swap = (driver: Driver, dir: string, port: number) =>
  driver
    .write(`${dir}/.demo.toml.swp`, text(port))
    .pipe(Effect.andThen(driver.rename(`${dir}/.demo.toml.swp`, `${dir}/demo.toml`)));

const CASES: ReadonlyArray<Case> = [
  {
    name: "(a) a file changed in place",
    start: { text: text(4101), folder: true },
    first: 4101,
    moves: [{ run: (d, dir) => d.write(`${dir}/demo.toml`, text(4102)), value: 4102 }],
  },
  {
    name: "(b) a file replaced by a rename over it",
    start: { text: text(4101), folder: true },
    first: 4101,
    moves: [{ run: (d, dir) => swap(d, dir, 4102), value: 4102 }],
  },
  {
    name: "(c) a file created where there was none",
    start: { folder: true },
    first: DEFAULT,
    moves: [{ run: (d, dir) => d.write(`${dir}/demo.toml`, text(4102)), value: 4102 }],
  },
  {
    name: "(d) a file removed",
    start: { text: text(4101), folder: true },
    first: 4101,
    moves: [{ run: (d, dir) => d.remove(`${dir}/demo.toml`), value: DEFAULT }],
  },
  {
    name: "(e) the folder missing at the start, then made with the file in it",
    start: { folder: false },
    first: DEFAULT,
    moves: [
      { run: (d, dir) => d.makeFolder(dir).pipe(Effect.andThen(d.write(`${dir}/demo.toml`, text(4102)))), value: 4102 },
    ],
  },
  {
    name: "(f) the folder removed while watched, then made again",
    start: { text: text(4101), folder: true },
    first: 4101,
    moves: [
      { run: (d, dir) => d.removeFolder(dir), value: DEFAULT },
      { run: (d, dir) => d.makeFolder(dir).pipe(Effect.andThen(d.write(`${dir}/demo.toml`, text(4103)))), value: 4103 },
    ],
  },
];

/** Waits on real time, up to ten seconds, until `seen` holds `count` values. */
const until = (seen: ReadonlyArray<number>, count: number, label: string) =>
  Effect.gen(function* () {
    for (let waited = 0; seen.length < count && waited < 10_000; waited += 25) {
      yield* Effect.sleep(Duration.millis(25));
    }

    expect(seen.length, `${label}: the values seen so far are ${JSON.stringify(seen)}`).toBeGreaterThanOrEqual(count);
  });

/** What a case gives on one disk: the values `changes` gave, in order. */
const play = Effect.fnUntraced(function* (driver: Driver, one: Case) {
  const repo = `${driver.root}/repo`;
  const dir = `${repo}/.demo`;

  if (one.start.folder) {
    yield* driver.makeFolder(dir);
  }

  if (one.start.text !== undefined) {
    yield* driver.write(`${dir}/demo.toml`, one.start.text);
  }

  const scope = yield* Scope.make();

  const layer = SettingGroup.layer(group, { version: "1.2.3", repo }).pipe(Layer.provide(driver.files));

  const context = yield* Layer.buildWithScope(layer, scope).pipe(
    Effect.provide(
      ConfigProvider.layer(
        ConfigProvider.fromEnv({
          // The quiet window is set short with the group's own setting, so each case is quick when the watch works.
          env: { HOME: `${driver.root}/home`, DEMO_CONFIG_WATCH_DEBOUNCE: "50 millis" },
        }),
      ),
    ),
  );

  const values = yield* Effect.provideContext(group, context);
  const seen: Array<number> = [];

  yield* Stream.runForEach(values.port.changes, (value) => Effect.sync(() => void seen.push(value))).pipe(
    Effect.forkIn(scope),
  );

  yield* until(seen, 1, `${one.name}: the start value`);

  for (const [n, move] of one.moves.entries()) {
    yield* move.run(driver, dir);
    yield* until(seen, n + 2, `${one.name}: after move ${n + 1}`);
  }

  yield* Scope.close(scope, Exit.void);

  return seen;
});

/** The events a watch on a file's own path hears of a rename over it, and then of a change to the file that took its place. */
const heard = Effect.fnUntraced(function* (driver: Driver) {
  const dir = `${driver.root}/repo/.demo`;
  yield* driver.makeFolder(dir);
  yield* driver.write(`${dir}/demo.toml`, text(4101));

  const fs = yield* Effect.service(FileSystem.FileSystem).pipe(Effect.provide(driver.files));

  const events: Array<string> = [];
  const scope = yield* Scope.make();

  yield* Stream.runForEach(fs.watch(`${dir}/demo.toml`), (event) =>
    Effect.sync(() => void events.push(event._tag)),
  ).pipe(Effect.forkIn(scope));

  yield* Effect.sleep(Duration.millis(300));
  yield* swap(driver, dir, 4102);
  yield* Effect.sleep(Duration.millis(500));

  // What the rename itself is reported as differs between kernels, so only what comes after it is held to be the same.
  const mark = events.length;
  yield* driver.write(`${dir}/demo.toml`, text(4103));
  yield* Effect.sleep(Duration.millis(500));
  yield* Scope.close(scope, Exit.void);

  return events.slice(mark);
});

// scenario: six file scripts and one file-path watch, on disk and then in memory.
it.live(
  "R3 scenario: on a real temp folder, six scripts of file changes give a live setting the values they give in memory, and a watch on a file's own path hears nothing of a change after a rename over it",
  () =>
    Effect.gen(function* () {
      for (const one of CASES) {
        const real = yield* play(yield* diskDriver(), one);
        const memory = yield* play(yield* memoryDriver(), one);
        const want = [one.first, ...one.moves.map((move) => move.value)];

        expect(real, `${one.name}: the temp folder`).toEqual(want);
        expect(memory, `${one.name}: in memory`).toEqual(want);
        expect(memory, `${one.name}: memory against the disk`).toEqual(real);
      }

      const onDisk = yield* heard(yield* diskDriver());
      const inMemory = yield* heard(yield* memoryDriver());

      expect(onDisk, "on the disk, a change to the file that replaced the watched one is not heard").toEqual([]);
      expect(inMemory, "in memory, the same").toEqual(onDisk);
    }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
  120_000,
);
