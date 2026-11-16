// P39 slice 4b, next/: the hands key file on the real file system, K3 (0536: the schedule). It
// sends no signal and starts no process: each run is two layers in this process over a fresh
// temp folder.
//
// What it holds `node/client/KeyFile.ts` to, from the approved plan (docs/plan/quests/p39-s5-PLAN.md,
// "The key"): on the real file system the key file is made with mode 0600 and its folder with mode
// 0700, and two hands starting at once on one empty home agree on one key: the first link wins,
// the second reads it, and no other key is left in the folder.
//
// Plant, run once and undone (recorded in the tests step's field row): write the file with the
// default mode.
import { NodeServices } from "@effect/platform-node";
import { describe, expect, it } from "@effect/vitest";
import { runsFor } from "@kampus/vitest";
import { Effect, FileSystem, Layer, Path } from "effect";
import * as fc from "fast-check";
import { property } from "../../Testing.test-support.ts";
import { ClientKey } from "../../transport/ClientKey.ts";
import * as KeyFile from "./KeyFile.ts";

const open = (file: string) =>
  ClientKey.use((keys) => keys.current(null)).pipe(
    Effect.provide(KeyFile.layer({ file }).pipe(Layer.provide(NodeServices.layer))),
  );

describe("P39 slice 4b: the hands key file on a real disk", () => {
  it.live(
    "K3: on the real file system the key file and its folder are made with modes 0600 and 0700, and two layers opening one empty folder at once end with one key",
    () =>
      Effect.gen(function* () {
        const found = new Set<string>();
        yield* property(
          fc.integer({ min: 0, max: 20 }),
          (delay) =>
            Effect.gen(function* () {
              const fs = yield* FileSystem.FileSystem,
                path = yield* Path.Path;

              const home = yield* fs.makeTempDirectoryScoped({ prefix: "p39-k3-" });
              const folder = path.join(home, "hands");
              const file = path.join(folder, "key.json");

              const [first, second] = yield* Effect.all(
                [open(file), Effect.sleep(`${delay} millis`).pipe(Effect.andThen(open(file)))],
                { concurrency: 2 },
              );

              expect(second.fingerprint, "K3: two hands starting at once agree on one key").toBe(first.fingerprint);
              expect([first.found, second.found].sort(), "K3: one made the key and the other read it").toEqual([
                "created",
                "reused",
              ]);
              expect(yield* fs.readDirectory(folder), "K3: one key file, and nothing else left in the folder").toEqual([
                "key.json",
              ]);
              expect((yield* fs.stat(file)).mode & 0o777, "K3: the key file is 0600").toBe(0o600);
              expect((yield* fs.stat(folder)).mode & 0o777, "K3: its folder is 0700").toBe(0o700);
              const again = yield* open(file);
              expect([again.found, again.fingerprint], "K3: a later start reuses the one key").toEqual([
                "reused",
                first.fingerprint,
              ]);
              found.add(delay === 0 ? "at-once" : "apart");
            }).pipe(Effect.provide(NodeServices.layer)),
          // Both kinds pinned beside the generated runs, so the check below holds at every depth: at
          // the fast depth's three runs the shared seed draws no delay of 0, and no "at-once" case.
          { numRuns: runsFor({ fast: 3, full: 20 }), examples: [[0], [5]] },
        );
        expect([...found]).toEqual(expect.arrayContaining(["at-once", "apart"]));
      }),
    120_000,
  );
});
