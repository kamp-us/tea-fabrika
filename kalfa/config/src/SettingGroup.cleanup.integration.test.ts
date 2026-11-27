// Ticket 2014, kalfa/config (new work): CU3 and CU4 of the approved plan (.kalfa/quests/kalfa-config-cleanup-PLAN.md). CU1 and CU2
// (SettingGroup.cleanup.test.ts) run on the writable stand-in in MemoryFiles.test-support.ts, so these two check it against a
// real temp folder through NodeServices and the product's own `removeEmptyDir`, the edge that calls Node's `rmdir`: the same
// failed set, the same race and the same five calls must leave the same disk and give the same answers on both, and each must
// leave what CU1 and CU2 say. They write to a temp folder, so they are integration laws and run in main's full run, never
// narrowly on the laptop. No stand-in will do: their one job is to check Node's real `rmdir` against the stand-in.
//
// CU3 is a property: each run draws the disk laws' draw, and on a fresh temp folder per case runs each turn of the race and
// each of three arrivals of CU1 (a lock, a file of another name, nothing), with the fault drawn in turn so every fault is
// reached, on the real folder and then in memory. One more case runs a failed set with nothing arriving through a layer that
// holds the hooked file system and `Path` but no `RemoveEmptyDir`, so the package's own default edge runs Node's `rmdir` on the
// real temp folder, and the folder must be gone: it is the one place the default is reached. CU4 is a scenario: five fixed calls, then the same five in memory.
//
// Plants, each run once and never kept, in internal/removeEmptyDir.ts. CU3: call `rm(path, { recursive: true })` in place of
// `rmdir`: a lock that arrives or that B holds is deleted on the real folder, red; call `rm(path)` without `recursive`: Node
// refuses every folder, so the empty folder stays on the real disk while the stand-in removes it, red. CU4: map `ENOTEMPTY` to
// a failure: the second case fails, red; map `ENOENT` to a failure: the fourth fails, red. In MemoryFiles.test-support.ts,
// answer `"removed"` for a folder that holds a file: the answers differ, red. The default edge (the reference's `defaultValue`
// in the same file): answer `"left"` without calling `rmdir`: the folder a failed set made stays on the real disk, red.
import { NodeServices } from "@effect/platform-node";
import { expect, it } from "@effect/vitest";
import { runsFor } from "@kampus/vitest";
import { Effect, FileSystem } from "effect";
import { removeEmptyDir } from "./internal/removeEmptyDir.ts";
import * as MemoryFiles from "./MemoryFiles.test-support.ts";
import {
  type Arrival,
  cleanup,
  CleanupDraw,
  FAULTS,
  type Fault,
  holdsCleanup,
  holdsDefault,
  holdsRace,
  race,
  sceneFor,
  shown,
  survey,
  type Turn,
  TURNS,
} from "./SettingGroup.cleanup.test-support.ts";
import { Reach } from "./SettingGroup.edit.test-support.ts";

const check = { arbitrary: { runs: runsFor({ fast: 5, full: 20 }), size: 100 } };

/** The three arrivals of CU1 that CU3 runs on a real folder: a lock, a file of another name, and nothing. */
const ARRIVALS: ReadonlyArray<Arrival> = ["lock", "other", "none"];

// ---------------------------------------------------------------------------------------------
// CU3, the race on a real disk
// ---------------------------------------------------------------------------------------------

/** A real temp folder under its real name, as a disk to run a case on, and the same case's names in memory. */
const disks = Effect.fnUntraced(function* (draw: CleanupDraw) {
  const fs = yield* FileSystem.FileSystem;
  const temp = yield* fs.makeTempDirectoryScoped({ prefix: "kalfa-config-cleanup-" });
  // A program that follows links names the real folder, which is not the temp folder's own name on every disk.
  const root = yield* fs.realPath(temp);

  return {
    real: { fileSystem: fs, removeEmptyDir } satisfies MemoryFiles.Platform,
    scene: sceneFor(draw, "repo", root),
    stand: sceneFor(draw, "repo", ""),
  };
});

/** One turn of the race, on a real folder and in memory: the same answers, calls and disk, and what CU2 says. */
const turned = (draw: CleanupDraw, fault: Fault, turn: Turn) =>
  Effect.scoped(
    Effect.gen(function* () {
      const { real, scene, stand } = yield* disks(draw);
      const alone = yield* cleanup(MemoryFiles.writable(), stand, fault, "none");
      const label = `repo ${fault} ${turn}`;
      const onDisk = yield* race(real, scene, fault, turn);
      const inMemory = yield* race(MemoryFiles.writable(), stand, fault, turn);

      yield* holdsRace(onDisk, alone.answer, scene, turn, `${label}, the temp folder`);
      yield* holdsRace(inMemory, alone.answer, stand, turn, `${label}, in memory`);

      expect(shown(onDisk.a), `${label}: A's answer, memory against the disk`).toEqual(shown(inMemory.a));
      expect(shown(onDisk.b), `${label}: B's answer, memory against the disk`).toEqual(shown(inMemory.b));
      expect(onDisk.order, `${label}: the calls, memory against the disk`).toEqual(inMemory.order);
      expect(onDisk.between, `${label}: between the writers, memory against the disk`).toEqual(inMemory.between);
      expect(onDisk.after, `${label}: the disk after, memory against the disk`).toEqual(inMemory.after);
    }),
  );

/** One arrival of CU1, on a real folder and in memory: the same answer, calls and disk, and what CU1 says. */
const arrived = (draw: CleanupDraw, fault: Fault, arrival: Arrival) =>
  Effect.scoped(
    Effect.gen(function* () {
      const { real, scene, stand } = yield* disks(draw);
      const alone = yield* cleanup(MemoryFiles.writable(), stand, fault, "none");
      const label = `repo ${fault} ${arrival}`;
      const onDisk = yield* cleanup(real, scene, fault, arrival);
      const inMemory = yield* cleanup(MemoryFiles.writable(), stand, fault, arrival);

      holdsCleanup(onDisk, alone.answer, scene, arrival, `${label}, the temp folder`);
      holdsCleanup(inMemory, alone.answer, stand, arrival, `${label}, in memory`);

      expect(shown(onDisk.answer), `${label}: the answer, memory against the disk`).toEqual(shown(inMemory.answer));
      expect(onDisk.order, `${label}: the calls, memory against the disk`).toEqual(inMemory.order);
      expect(onDisk.after, `${label}: the disk after, memory against the disk`).toEqual(inMemory.after);
    }),
  );

/** A failed set with nothing arriving, on a real folder, where the set gets no edge of its own: the package's default removes the folder. */
const defaulted = (draw: CleanupDraw, fault: Fault) =>
  Effect.scoped(
    Effect.gen(function* () {
      const { real, scene, stand } = yield* disks(draw);
      const alone = yield* cleanup(MemoryFiles.writable(), stand, fault, "none");
      const found = yield* cleanup(real, scene, fault, "none", "default");

      holdsDefault(found, alone.answer, `repo ${fault} the default edge, the temp folder`);
    }),
  );

// Each case is on a disk of its own, and the fault is turned in the order of the cases, so each run reaches each fault.
it.live.prop(
  "CU3 the race on a real disk: a failed set's clean-up and two writers in a forced order leave the same files, folders, answers and calls on a real temp folder as in memory, and what CU1 and CU2 say",
  CleanupDraw.fields,
  (draw) =>
    Effect.gen(function* () {
      const reach = new Reach<string>([
        "u:repo",
        "e:default",
        ...FAULTS.map((fault) => `f:${fault}`),
        ...TURNS.map((turn) => `t:${turn}`),
        ...ARRIVALS.map((arrival) => `a:${arrival}`),
      ]);

      const faultFor = (n: number) => FAULTS[(n + draw.disk.turn) % FAULTS.length] ?? "create";

      for (const [n, turn] of TURNS.entries()) {
        yield* turned(draw, faultFor(n), turn);
        reach.mark("u:repo", `f:${faultFor(n)}`, `t:${turn}`);
      }

      for (const [n, arrival] of ARRIVALS.entries()) {
        yield* arrived(draw, faultFor(n + TURNS.length), arrival);
        reach.mark("u:repo", `f:${faultFor(n + TURNS.length)}`, `a:${arrival}`);
      }

      yield* defaulted(draw, faultFor(ARRIVALS.length + TURNS.length));
      reach.mark("u:repo", "e:default", `f:${faultFor(ARRIVALS.length + TURNS.length)}`);

      reach.done();
    }).pipe(Effect.provide(NodeServices.layer)),
  check,
);

// ---------------------------------------------------------------------------------------------
// CU4, the stand-in's `removeEmptyDir` is the edge's
// ---------------------------------------------------------------------------------------------

/** Five folders and files under `root`, made with file system calls only, so a real folder and the stand-in are made the same way. */
const setUp = Effect.fnUntraced(function* (fs: FileSystem.FileSystem, root: string) {
  yield* fs.makeDirectory(`${root}/empty`, { recursive: true });
  yield* fs.makeDirectory(`${root}/full`, { recursive: true });
  yield* fs.writeFileString(`${root}/full/inside.txt`, "inside");
  yield* fs.makeDirectory(`${root}/nested/inner`, { recursive: true });
  yield* fs.writeFileString(`${root}/plain.txt`, "plain");
});

/** The five calls, in order: an empty folder, a folder with a file, a folder with an empty folder, a missing path, a file. */
const PATHS = ["/empty", "/full", "/nested", "/gone", "/plain.txt"] as const;

const play = Effect.fnUntraced(function* (platform: MemoryFiles.Platform, root: string) {
  yield* setUp(platform.fileSystem, root);

  const answers: Array<string> = [];

  for (const path of PATHS) {
    answers.push(
      yield* platform.removeEmptyDir(`${root}${path}`).pipe(
        Effect.match({
          onFailure: (error) => `fails ${error.reason._tag}`,
          onSuccess: (removal) => removal,
        }),
      ),
    );
  }

  return { answers, left: yield* survey(platform.fileSystem, root) };
});

// scenario: five fixed calls on a temp folder, then the same five in memory (the reason label `fabrika/law-shape` takes for a
// check of a stand-in against the real thing).
it.effect(
  "CU4 scenario: on a real temp folder and in memory, `removeEmptyDir` gives the same five answers and leaves the same entries: an empty folder goes, a folder with anything in it and a missing path are left, a file fails",
  () =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const temp = yield* fs.makeTempDirectoryScoped({ prefix: "kalfa-config-cleanup-" });
      const root = yield* fs.realPath(temp);
      const real = yield* play({ fileSystem: fs, removeEmptyDir }, root);
      const memory = yield* play(MemoryFiles.writable(), "");

      const wanted = {
        answers: ["removed", "left", "left", "left", "fails BadResource"],
        left: {
          files: { "/full/inside.txt": "inside", "/plain.txt": "plain" },
          folders: ["/full", "/nested", "/nested/inner"],
        },
      };

      expect(real, "the temp folder").toEqual(wanted);
      expect(memory, "in memory").toEqual(wanted);
      expect(memory, "memory against the disk").toEqual(real);
    }).pipe(Effect.provide(NodeServices.layer)),
);
