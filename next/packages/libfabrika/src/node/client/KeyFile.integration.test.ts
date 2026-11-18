// P39 slice 4b, next/: the hands key file on the real file system, K3 (0536: the schedule). It
// sends no signal and starts no process: each run is two layers in this process over a fresh
// temp folder.
//
// What it holds `node/client/KeyFile.ts` to, from the approved plan (docs/plan/quests/p39-s5-PLAN.md,
// "The key"): on the real file system the key file is made with mode 0600 and its folder with mode
// 0700, and two hands starting at once on one empty home agree on one key: the first link wins,
// the second reads it, and no other key is left in the folder.
import { NodeServices } from "@effect/platform-node";
import { describe, expect, it, runsFor } from "@kampus/vitest";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Path from "effect/Path";
import * as fc from "fast-check";
import type { TestContext } from "vitest";
import { ClientKey } from "../../transport/ClientKey.ts";
import * as KeyFile from "./KeyFile.ts";

/** What each law's cases reached so far, by the law's own task, so each run of a law starts empty. */
const reaches = new WeakMap<object, Set<string>>();

/**
 * The set one law's cases add what they reach to. The first case registers `covers`, which runs once
 * when the law ends, so a walk that reached too little fails loudly however its cases went.
 */
const reach = (ctx: TestContext, covers: (seen: ReadonlyArray<string>) => void): Set<string> => {
  const known = reaches.get(ctx.task);

  if (known !== undefined) {
    return known;
  }

  const seen = new Set<string>();
  reaches.set(ctx.task, seen);
  ctx.onTestFinished(() => covers([...seen]));
  return seen;
};

const open = (file: string) =>
  ClientKey.use((keys) => keys.current(null)).pipe(
    Effect.provide(KeyFile.layer({ file }).pipe(Layer.provide(NodeServices.layer))),
  );

describe("P39 slice 4b: the hands key file on a real disk", () => {
  it.live.prop(
    "K3: on the real file system the key file and its folder are made with modes 0600 and 0700, and two layers opening one empty folder at once end with one key",
    // fast-check kept: moved unchanged from the property runner; the Schema rewrite comes later in 0579's sweep
    { delay: fc.integer({ min: 0, max: 20 }) },
    ({ delay }, ctx) => {
      const found = reach(ctx, (seen) => expect(seen).toEqual(expect.arrayContaining(["at-once", "apart"])));
      return Effect.gen(function* () {
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
      }).pipe(Effect.provide(NodeServices.layer));
    },
    {
      plant: "the key file is written with mode 0644, not 0600",
      timeout: 120_000,
      // Both kinds pinned beside the generated runs, so the reach check holds at every depth: at
      // the fast depth's three runs the shared seed draws no delay of 0, and no "at-once" case.
      fastCheck: { numRuns: runsFor({ fast: 3, full: 20 }), examples: [[0], [5]] },
    },
  );
});
