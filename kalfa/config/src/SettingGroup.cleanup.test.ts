// Ticket 2014, kalfa/config (new work): CU1 and CU2 of the approved plan (.kalfa/quests/kalfa-config-cleanup-PLAN.md), for the
// folder a failed `SettingGroup.set` takes away again (internal/disk.ts). Written before the code. CU3 and CU4, which run on a
// real temp folder, are in SettingGroup.cleanup.integration.test.ts, and CU5 is the disk laws and the command's laws, unchanged.
//
// What a failed set does with the `.<app>/` folder it made, as these laws hold it to:
// - It takes the folder away only while the folder is empty, in one call (`removeEmptyDir`, which the system refuses for a
//   folder that holds anything). A lock, a finished file, a file of another name or a folder that another writer has put in it
//   since stays, and the folder with it.
// - That is no failure and no log line. The set still fails with its own first error, as it fails alone.
//
// CU1 draws one writer and puts what arrives in its folder just before its clean-up. CU2 draws two writers on one disk, in a
// forced order (no sleep, no clock: three `Deferred`s), and holds B to finish whole whatever A's clean-up does. Both run on the
// stand-in in MemoryFiles.test-support.ts, the same race that CU3 runs on a real folder. Each law names its plant: break one
// thing in the code, run the law, see it red, undo it.
import { it } from "@effect/vitest";
import { runsFor } from "@kampus/vitest";
import { Effect } from "effect";
import * as MemoryFiles from "./MemoryFiles.test-support.ts";
import {
  ARRIVALS,
  cleanup,
  CleanupDraw,
  FAULTS,
  holdsCleanup,
  holdsRace,
  race,
  SITES,
  sceneFor,
  TURNS,
} from "./SettingGroup.cleanup.test-support.ts";
import { Reach } from "./SettingGroup.edit.test-support.ts";

const check = { arbitrary: { runs: runsFor({ fast: 25, full: 100 }), size: 100 } };

// ---------------------------------------------------------------------------------------------
// CU1, a failed set's clean-up leaves what another writer put in the folder
// ---------------------------------------------------------------------------------------------

// Plants, each run once and never kept, in internal/disk.ts. Today's `unmake` (list, then remove with `recursive: true`):
// (l), (f), (o) and (d) lose the entry, red. Decide the folder is empty while leaving out names that end `.lock`: (l) is lost,
// red; leave out the file's own name: (f) is lost, red; keep the folder only when it holds the lock or the file: (o) is lost,
// red; count only plain files (`readDirectoryEntries`, `type === "File"`): (d) is lost, red. Drop `unmake`: with (n) the
// folder is left, red. Skip the clean-up when the lock was never taken: with (c) and (n) the folder is left, red. On a refused
// lock write, remove the folder with `recursive: true` inside `replace`: (w) loses the entry, red; the same on a refused
// rename: (r), red. Log "left" at `Warn`: the line shows, red. For the refused removal: set the options of `Effect.ignore` in
// `unmake` to `{}`: no line is logged, red; replace `Effect.ignore({...})` by `Effect.orDie`: the set dies and no longer fails
// as it fails alone, red.
it.effect.prop(
  "CU1 a failed set's clean-up leaves what another writer put in the folder: for each place, each fault and each arrival, the folder stays with what arrived and the set fails as it fails with nothing arriving, and a removal the disk refuses is logged once and changes no answer",
  CleanupDraw.fields,
  (draw) =>
    Effect.gen(function* () {
      const reach = new Reach<string>([
        ...SITES.map((site) => `u:${site}`),
        ...FAULTS.map((fault) => `f:${fault}`),
        ...ARRIVALS.map((arrival) => `a:${arrival}`),
      ]);

      for (const site of SITES) {
        const scene = sceneFor(draw, site, "");

        for (const fault of FAULTS) {
          const none = yield* cleanup(MemoryFiles.writable(), scene, fault, "none");

          for (const arrival of ARRIVALS) {
            const found = arrival === "none" ? none : yield* cleanup(MemoryFiles.writable(), scene, fault, arrival);

            holdsCleanup(found, none.answer, scene, arrival, `${site} ${fault} ${arrival}`);
            reach.mark(`u:${site}`, `f:${fault}`, `a:${arrival}`);
          }
        }
      }

      reach.done();
    }),
  check,
);

// ---------------------------------------------------------------------------------------------
// CU2, two writers, in a forced order
// ---------------------------------------------------------------------------------------------

// Plants, each run once and never kept. Today's `unmake`: (i) deletes B's lock, so B's rename fails `NotFound` and B fails, red.
// Keep the folder only when it holds the file: (i) loses B's lock, red; keep it only when it holds a `.lock`: (j) loses B's
// file, red. Drop `unmake`: A never reaches its removal, red. A removal that leaves the folder (`removeEmptyDir` that answers
// "left" always): for turn (a) the folder is still there between the writers, red. Take the gate out of `race` (B's hook does
// not wait for `aDone`): B is not held when A's removal ends, so the held check fails, red.
it.live.prop(
  "CU2 two writers, in a forced order: A fails and B, whose folder A may not take away, finishes with its own text, whether B holds its lock, has finished or starts after A has ended",
  CleanupDraw.fields,
  (draw) =>
    Effect.gen(function* () {
      const reach = new Reach<string>([
        ...SITES.map((site) => `u:${site}`),
        ...FAULTS.map((fault) => `f:${fault}`),
        ...TURNS.map((turn) => `t:${turn}`),
      ]);

      for (const site of SITES) {
        const scene = sceneFor(draw, site, "");

        for (const fault of FAULTS) {
          const alone = yield* cleanup(MemoryFiles.writable(), scene, fault, "none");

          for (const turn of TURNS) {
            const found = yield* race(MemoryFiles.writable(), scene, fault, turn);

            yield* holdsRace(found, alone.answer, scene, turn, `${site} ${fault} ${turn}`);
            reach.mark(`u:${site}`, `f:${fault}`, `t:${turn}`);
          }
        }
      }

      reach.done();
    }),
  check,
);
