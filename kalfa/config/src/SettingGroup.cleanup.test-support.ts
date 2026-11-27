/**
 * What the laws of a failed set's folder clean-up share (ticket 2014, kalfa/config, new work): the draw, the three classes
 * the plan names, the CU1 runner, the race of two writers and the checks both laws and the real-disk law hold them to.
 *
 * When `SettingGroup.set` makes the `.<app>/` folder and then fails, it takes the folder away again, and a file another
 * writer has put in it since must stay. The classes, each built in every run:
 * - where writer A fails, after it made the folder: its lock's create is refused (`create`), its lock's write is refused
 *   (`write`), or its rename is refused (`rename`);
 * - what is in A's folder at its clean-up (CU1): a lock (`lock`), a finished file (`file`), a file of another name
 *   (`other`), an empty folder (`folder`), or nothing (`none`);
 * - where writer B is at A's clean-up (CU2 and CU3): it holds its lock (`inside`), it has finished (`finished`), or it starts
 *   only after A has ended (`after`).
 *
 * Both places a set makes a folder are in every run: the repo's `.<app>/` and `$HOME/.<app>/`. Each law keeps the ids it
 * reached (slice 2's `Reach`) and fails when one is missing.
 *
 * The disk is a `Platform`: a file system and the edge that removes a folder only when it is empty. The same runner and the
 * same race run on the stand-in (`MemoryFiles.writable`) and on a real folder, each wrapped by `MemoryFiles.hooked`, so a
 * hook can act between two calls. Nothing sleeps and nothing reads a clock: three `Deferred`s force the order.
 */
import { expect } from "@effect/vitest";
import { ConfigProvider, Deferred, Effect, Fiber, type FileSystem, Logger, References, Schema } from "effect";
import type * as PlatformError from "effect/PlatformError";
import { Setting, SettingGroup } from "./index.ts";
import * as MemoryFiles from "./MemoryFiles.test-support.ts";
import {
  type Answer,
  answer,
  createRefused,
  DiskDraw,
  names,
  renameRefused,
  writeRefused,
} from "./SettingGroup.disk.test-support.ts";
import { doSet, mustText } from "./SettingGroup.edit.test-support.ts";

// ---------------------------------------------------------------------------------------------
// The draw: the disk laws' draw, and what arrives in A's folder.
// ---------------------------------------------------------------------------------------------

const Word = Schema.String.check(Schema.isPattern(/^[a-z]{3,6}$/u));

/** Text that a file can hold: no lone surrogate, no DEL. */
const Held = Schema.String.check(Schema.isPattern(/^[^\uD800-\uDFFF\u007f]*$/u), Schema.isMaxLength(12));

export const CleanupDraw = Schema.Struct({
  ...DiskDraw.fields,
  cleanup: Schema.Struct({
    /** The name of the file of another name, and of the empty folder, that arrive. */
    other: Word,
    folder: Word,
    /** What an arriving file holds. */
    text: Held,
  }),
});

export type CleanupDraw = typeof CleanupDraw.Type;

// ---------------------------------------------------------------------------------------------
// The classes.
// ---------------------------------------------------------------------------------------------

/** Where writer A fails: its lock's create, its lock's write, or its rename is refused. */
export type Fault = "create" | "write" | "rename";

/** What is in A's folder at its clean-up. */
export type Arrival = "lock" | "file" | "other" | "folder" | "none";

/** Where writer B is at A's clean-up: holding its lock, finished, or not yet started. */
export type Turn = "inside" | "finished" | "after";

export const FAULTS: ReadonlyArray<Fault> = ["create", "write", "rename"];

export const ARRIVALS: ReadonlyArray<Arrival> = ["lock", "file", "other", "folder", "none"];

export const TURNS: ReadonlyArray<Turn> = ["inside", "finished", "after"];

/** The two places a set makes a folder: the repo's `.<app>/` and `$HOME/.<app>/`. */
type Site = "repo" | "home";

export const SITES: ReadonlyArray<Site> = ["repo", "home"];

// ---------------------------------------------------------------------------------------------
// The scene: one set, in one place, on a disk under `root`.
// ---------------------------------------------------------------------------------------------

/**
 * The set A makes (and B, of another value), where its file is, and everything a case needs from the draw. `root` is the
 * disk's own name for its folder: a real temp folder's, or none for the stand-in, so every path below it reads the same on both.
 */
export const sceneFor = (draw: CleanupDraw, site: Site, root: string) => {
  const port = Setting.make(`${draw.w}.port`, Schema.Int).pipe(
    Setting.withDefault(1),
    Setting.withDescription("A generated port."),
  );

  const settings: ReadonlyArray<Setting.Any> = [port];
  const repo = `${root}/work`;
  const home = `${root}/home`;
  const dir = `${site === "repo" ? repo : home}/.${draw.app}`;
  const path = `${dir}/${draw.app}.toml`;
  const lock = `${path}.lock`;

  return {
    site,
    root,
    repo,
    env: { HOME: home },
    group: SettingGroup.make(draw.app, ...settings),
    setting: port,
    file: site === "repo" ? ("repo" as const) : ("user" as const),
    /** The file as a person reads it. */
    name: site === "repo" ? `.${draw.app}/${draw.app}.toml` : `~/.${draw.app}/${draw.app}.toml`,
    dir,
    path,
    lock,
    /** What A sets, and what B sets: another value, so the file shows whose text it holds. */
    values: { a: draw.values.port, b: draw.values.port + 1 },
    /** The text of a file or a lock that arrives. */
    text: draw.cleanup.text,
    other: `${dir}/${draw.cleanup.other}.txt`,
    folder: `${dir}/${draw.cleanup.folder}`,
    faults: {
      create: createRefused(lock, draw.disk.create),
      write: writeRefused(lock, draw.disk.write),
      rename: renameRefused(lock, draw.disk.rename),
    } satisfies Record<Fault, MemoryFiles.Fault>,
  };
};

type Scene = ReturnType<typeof sceneFor>;

/** The file an arrival leaves in A's folder, and its text: none for a folder or nothing. */
const arrivedFile = (scene: Scene, arrival: Arrival): { readonly path: string; readonly text: string } | undefined => {
  switch (arrival) {
    case "lock":
      return { path: scene.lock, text: scene.text };
    case "file":
      return { path: scene.path, text: scene.text };
    case "other":
      return { path: scene.other, text: scene.text };
    case "folder":
    case "none":
      return undefined;
  }
};

/** Puts an arrival in A's folder, through the disk itself and never through a hook. */
const arrive = (
  fs: FileSystem.FileSystem,
  scene: Scene,
  arrival: Arrival,
): Effect.Effect<void, PlatformError.PlatformError> => {
  const file = arrivedFile(scene, arrival);

  if (file !== undefined) {
    return fs.writeFileString(file.path, file.text);
  }

  return arrival === "folder" ? fs.makeDirectory(scene.folder) : Effect.void;
};

// ---------------------------------------------------------------------------------------------
// What a disk holds, and what a call saw.
// ---------------------------------------------------------------------------------------------

/** The files and folders below `root`, by path with `root` taken off. */
interface State {
  readonly files: Readonly<Record<string, string>>;
  readonly folders: ReadonlyArray<string>;
}

/** Reads everything below `root` through the file system and nothing else. `root` is none for the stand-in. */
export const survey = Effect.fnUntraced(function* (fs: FileSystem.FileSystem, root: string) {
  const files: Record<string, string> = {};
  const folders: Array<string> = [];

  const walk: (folder: string) => Effect.Effect<void, PlatformError.PlatformError> = Effect.fnUntraced(function* (
    folder: string,
  ) {
    for (const entry of yield* fs.readDirectoryEntries(folder)) {
      const full = `${folder === "/" ? "" : folder}/${entry.name}`;

      if (entry.type === "File") {
        files[full.slice(root.length)] = yield* fs.readFileString(full);
      } else if (entry.type === "Directory") {
        folders.push(full.slice(root.length));
        yield* walk(full);
      }
    }
  });

  yield* walk(root === "" ? "/" : root);

  return { files, folders: folders.sort() } satisfies State;
});

/** The folders a case starts on: the repo and the home, made through the disk, so a real folder and the stand-in start alike. */
const prepare = Effect.fnUntraced(function* (fs: FileSystem.FileSystem, scene: Scene) {
  yield* fs.makeDirectory(scene.repo, { recursive: true });
  yield* fs.makeDirectory(scene.env.HOME, { recursive: true });
});

/** A step with `root` taken off its path. */
const below = (scene: Scene, step: MemoryFiles.Step): MemoryFiles.Step => ({
  ...step,
  path: step.path.slice(scene.root.length),
});

/** Whether a fault names this step. */
const planted = (fault: MemoryFiles.Fault, step: MemoryFiles.Step) =>
  fault.path === step.path &&
  (Array.isArray(fault.method) ? fault.method.some((m) => m === step.method) : fault.method === step.method) &&
  (fault.flag === undefined || fault.flag === step.flag);

/** A removal of A's folder: the call whose gap another writer's file falls into. Today's code ends with `remove`, the fix with `removeEmptyDir`. */
const removal = (dir: string, step: MemoryFiles.Step) =>
  step.path === dir && (step.method === "removeEmptyDir" || step.method === "remove");

/** The parts of an answer a law compares across runs: the reason, the file, the line and the message, never the text of the stack that `printed` holds. */
export const shown = (found: Answer) =>
  found._tag === "failed" ? ["failed", found.reason, found.file, found.line, found.message] : ["done"];

// ---------------------------------------------------------------------------------------------
// One writer.
// ---------------------------------------------------------------------------------------------

/** One `set` of `value` on a disk, with its answer and every log line it wrote. */
const set = (scene: Scene, view: ReturnType<typeof MemoryFiles.hooked>, value: number) => {
  const logs: Array<string> = [];

  const logger = Logger.map(Logger.formatStructured, (entry) => {
    logs.push(JSON.stringify(entry));
  });

  return SettingGroup.set(scene.group, scene.setting, value, scene.file, { repo: scene.repo }).pipe(
    Effect.exit,
    Effect.map((exit) => ({ answer: answer(exit), logs: [...logs] })),
    Effect.provide(view.layer),
    Effect.provide(ConfigProvider.layer(ConfigProvider.fromEnv({ env: { ...scene.env } }))),
    Effect.provide(Logger.layer([logger])),
    Effect.provideService(References.MinimumLogLevel, "All"),
  );
};

// ---------------------------------------------------------------------------------------------
// CU1: one writer fails, and a file arrives in its folder just before its clean-up.
// ---------------------------------------------------------------------------------------------

/** What one failed set left: its answer, its log lines, every call in the order it started, and the disk before and after. */
interface Cleaned {
  readonly answer: Answer;
  readonly logs: ReadonlyArray<string>;
  readonly order: ReadonlyArray<MemoryFiles.Step>;
  readonly before: State;
  readonly after: State;
}

/**
 * A set into a place with no folder, on `base`: the hook fails A's planted step, and just before A removes its folder it puts
 * `arrival` in it, once, through the base disk.
 */
export const cleanup = Effect.fnUntraced(function* (
  base: MemoryFiles.Platform,
  scene: Scene,
  fault: Fault,
  arrival: Arrival,
) {
  yield* prepare(base.fileSystem, scene);

  const before = yield* survey(base.fileSystem, scene.root);
  const order: Array<MemoryFiles.Step> = [];
  const refusal = scene.faults[fault];
  let arrived = false;

  const view = MemoryFiles.hooked(base, (step) =>
    Effect.suspend(() => {
      order.push(below(scene, step));

      if (planted(refusal, step)) {
        return Effect.fail(refusal.error);
      }

      if (removal(scene.dir, step) && !arrived) {
        arrived = true;

        return arrive(base.fileSystem, scene, arrival);
      }

      return Effect.void;
    }),
  );

  const ran = yield* set(scene, view, scene.values.a);
  const after = yield* survey(base.fileSystem, scene.root);

  return { answer: ran.answer, logs: ran.logs, order, before, after } satisfies Cleaned;
});

/** What a case leaves, by arrival. `none` is the answer of the same set with nothing arriving. */
export const holdsCleanup = (found: Cleaned, none: Answer, scene: Scene, arrival: Arrival, label: string) => {
  const dir = scene.dir.slice(scene.root.length);
  const file = arrivedFile(scene, arrival);

  // What is in the folder stays, and the folder with it. Nothing arrived, and the folder goes.
  expect(found.after.files, `${label}: the files after`).toEqual(
    file === undefined ? found.before.files : { [file.path.slice(scene.root.length)]: file.text },
  );

  expect(found.after.folders, `${label}: the folders after`).toEqual(
    arrival === "none"
      ? found.before.folders
      : [...found.before.folders, dir, ...(arrival === "folder" ? [scene.folder.slice(scene.root.length)] : [])].sort(),
  );

  expect(shown(found.answer), `${label}: the answer is the one with nothing arriving`).toEqual(shown(none));
  expect(none._tag, `${label}: the set fails`).toBe("failed");

  if (none._tag === "failed") {
    expect(none.reason, `${label}: it is a write error`).toBe("write");
    expect(names(none, scene.name), `${label}: it names the file`).toBe(true);
  }

  expect(
    found.order.filter((step) => step.method === "removeEmptyDir"),
    `${label}: one removal of the folder, with one call`,
  ).toEqual([{ method: "removeEmptyDir", path: dir }]);

  expect(
    found.order.filter(
      (step) =>
        step.path === dir &&
        (step.method === "remove" || step.method === "readDirectory" || step.method === "readDirectoryEntries"),
    ),
    `${label}: the folder is never listed or removed by another call`,
  ).toEqual([]);

  expect(
    found.logs.filter((line) => line.includes(`${scene.name}'s folder was not removed.`)),
    `${label}: a folder left in place is no problem and logs nothing`,
  ).toEqual([]);
};

// ---------------------------------------------------------------------------------------------
// CU2: two writers on one disk, in a forced order.
// ---------------------------------------------------------------------------------------------

/** What one race left: each writer's answer, every call in the order it began its work, and the disk before, between (turn `after` only) and after. */
interface Raced {
  readonly a: Answer;
  readonly b: Answer;
  readonly order: ReadonlyArray<{ readonly writer: "a" | "b"; readonly step: MemoryFiles.Step }>;
  readonly before: State;
  readonly between?: State;
  readonly after: State;
}

/**
 * Two sets of one file on one `base`: A fails at its planted step and B does not. Each writer has its own hooked view and its
 * own fiber, and three `Deferred`s set the order. A runs alone until it is about to remove its folder, and then it waits, so B
 * starts while A's folder is there: B's `makeDirectory` answers `AlreadyExists` and B does not own the folder.
 * - `inside`: B holds its lock and, at its read, lets A go and waits for A to end.
 * - `finished`: B runs to its end, and then A goes.
 * - `after`: A goes and ends, and then B starts.
 * Under a 10-second limit, so a gate that never opens fails with a name and never hangs.
 */
export const race = (base: MemoryFiles.Platform, scene: Scene, fault: Fault, turn: Turn) =>
  Effect.gen(function* () {
    yield* prepare(base.fileSystem, scene);

    const before = yield* survey(base.fileSystem, scene.root);
    const aWaits = yield* Deferred.make<void>();
    const go = yield* Deferred.make<void>();
    const aDone = yield* Deferred.make<void>();
    const order: Array<{ readonly writer: "a" | "b"; readonly step: MemoryFiles.Step }> = [];
    const refusal = scene.faults[fault];

    const viewA = MemoryFiles.hooked(base, (step) =>
      Effect.suspend(() => {
        if (planted(refusal, step)) {
          order.push({ writer: "a", step: below(scene, step) });

          return Effect.fail(refusal.error);
        }

        if (removal(scene.dir, step)) {
          // The removal is noted once it is let go, so the record says when it did its work.
          return Deferred.succeed(aWaits, undefined).pipe(
            Effect.andThen(Deferred.await(go)),
            Effect.andThen(
              Effect.sync(() => {
                order.push({ writer: "a", step: below(scene, step) });
              }),
            ),
          );
        }

        order.push({ writer: "a", step: below(scene, step) });

        return Effect.void;
      }),
    );

    const viewB = MemoryFiles.hooked(base, (step) =>
      Effect.suspend(() => {
        order.push({ writer: "b", step: below(scene, step) });

        // B's first read of the file, after it made its lock: it lets A go and waits for A to end.
        return turn === "inside" && step.method === "readFileString" && step.path === scene.path
          ? Deferred.succeed(go, undefined).pipe(Effect.andThen(Deferred.await(aDone)))
          : Effect.void;
      }),
    );

    const fiberA = yield* Effect.forkChild(set(scene, viewA, scene.values.a));

    // A is to stop at the removal of its folder. A that ends without one never put its folder at risk, and the race says so.
    const reached = yield* Effect.raceFirst(
      Deferred.await(aWaits).pipe(Effect.as(true)),
      Fiber.join(fiberA).pipe(Effect.as(false)),
    );

    expect(reached, "A removes its folder").toBe(true);

    const [a, b, between] = yield* Effect.gen(function* () {
      switch (turn) {
        case "inside": {
          const fiberB = yield* Effect.forkChild(set(scene, viewB, scene.values.b));
          const a = yield* Fiber.join(fiberA);

          yield* Deferred.succeed(aDone, undefined);

          return [a, yield* Fiber.join(fiberB), undefined] as const;
        }

        case "finished": {
          const b = yield* set(scene, viewB, scene.values.b);

          yield* Deferred.succeed(go, undefined);

          return [yield* Fiber.join(fiberA), b, undefined] as const;
        }

        case "after": {
          yield* Deferred.succeed(go, undefined);

          const a = yield* Fiber.join(fiberA);
          const between = yield* survey(base.fileSystem, scene.root);

          return [a, yield* set(scene, viewB, scene.values.b), between] as const;
        }
      }
    });

    const after = yield* survey(base.fileSystem, scene.root);

    return {
      a: a.answer,
      b: b.answer,
      order,
      before,
      after,
      ...(between === undefined ? {} : { between }),
    } satisfies Raced;
  }).pipe(Effect.timeout("10 seconds"));

/** What a race must leave: A's own failure, B done with its own text, the folder and the file, and each turn's order of calls. */
export const holdsRace = Effect.fnUntraced(function* (
  found: Raced,
  alone: Answer,
  scene: Scene,
  turn: Turn,
  label: string,
) {
  const wanted = mustText(yield* doSet(scene.group, "", scene.file, scene.setting, scene.values.b));
  const dir = scene.dir.slice(scene.root.length);
  const path = scene.path.slice(scene.root.length);
  const lock = scene.lock.slice(scene.root.length);

  expect(shown(found.b), `${label}: B is done`).toEqual(["done"]);
  expect(found.after.files, `${label}: only B's file is there, holding B's text, and no lock is left`).toEqual({
    [path]: wanted,
  });
  expect(found.after.folders, `${label}: the folder is there`).toEqual([...found.before.folders, dir].sort());
  expect(shown(found.a), `${label}: A fails as it fails alone`).toEqual(shown(alone));

  const at = found.order.findIndex(({ writer, step }) => writer === "a" && removal(dir, step));

  expect(at, `${label}: A removes its folder`).toBeGreaterThanOrEqual(0);

  const first = (predicate: (step: MemoryFiles.Step) => boolean) =>
    found.order.findIndex(({ writer, step }) => writer === "b" && predicate(step));

  switch (turn) {
    case "inside": {
      const created = first((step) => step.method === "writeFileString" && step.flag === "wx" && step.path === lock);
      const renamed = first((step) => step.method === "rename");

      expect(created, `${label}: B made its lock`).toBeGreaterThanOrEqual(0);
      expect(at, `${label}: A removes its folder after B made its lock`).toBeGreaterThan(created);
      expect(renamed, `${label}: B renames its lock`).toBeGreaterThan(at);

      break;
    }

    case "finished": {
      expect(at, `${label}: A removes its folder after B's rename`).toBeGreaterThan(
        first((step) => step.method === "rename"),
      );

      break;
    }

    case "after": {
      expect(
        found.order.slice(0, at + 1).filter(({ writer }) => writer === "b"),
        `${label}: B calls nothing before A has ended`,
      ).toEqual([]);
      expect(found.between, `${label}: between the writers, the disk is as it was`).toEqual({
        files: found.before.files,
        folders: found.before.folders,
      });

      break;
    }
  }
});
