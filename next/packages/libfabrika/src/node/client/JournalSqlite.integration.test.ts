// P39 slice 4b, next/: the journal file survives a crash, J2 (0536: the schedule). Host-only: it
// sends a real SIGKILL to a real child, so it runs only in CI's full run, in its container (0045),
// never on a laptop.
//
// What it holds `node/client/JournalSqlite.ts` to, from the approved plan
// (docs/plan/lanes/p39-s5-PLAN.md, "The journal file"): a hands-like child writing journal entries in
// a loop and killed with SIGKILL at any moment leaves every key holding one whole entry, or none,
// when the file is opened again; never a torn value, which the 4a machine reads as `bad_entry` and
// then skips for good.
//
// Plant, run once and undone (recorded in the tests step's field row): swap the store for
// `KeyValueStore.layerFileSystem`.
import { NodeServices } from "@effect/platform-node";
import { describe, expect, it } from "@effect/vitest";
import { runsFor } from "@kampus/vitest";
import { Effect, FileSystem, Layer, Option, Path, Stream } from "effect";
import { ChildProcess } from "effect/process";
import * as fc from "fast-check";
import { Journal } from "../../client/Journal.ts";
import * as JournalStore from "../../client/JournalStore.ts";
import { property } from "../../Testing.test-support.ts";
import * as JournalSqlite from "./JournalSqlite.ts";

/** The jobs the child writes (`JournalSqlite.child.test-support.ts`). */
const JOBS = Array.from({ length: 16 }, (_, i) => `P/${i}/0`);

describe("P39 slice 4b: the journal file after a crash", () => {
  it.live(
    "J2: a hands-like child that writes journal entries in a loop and is killed with SIGKILL at a generated moment leaves every key holding one whole entry when the file is opened again",
    () =>
      Effect.gen(function* () {
        const reached = new Set<string>();
        yield* property(
          fc.integer({ min: 1, max: 200 }),
          (delay) =>
            Effect.gen(function* () {
              const fs = yield* FileSystem.FileSystem,
                path = yield* Path.Path;
              const home = yield* fs.makeTempDirectoryScoped({ prefix: "p39-j2-" });
              const file = path.join(home, "journal.sqlite");
              const child = path.join(import.meta.dirname, "JournalSqlite.child.test-support.ts");
              yield* Effect.scoped(
                Effect.gen(function* () {
                  const handle = yield* ChildProcess.make(process.execPath, [child, file], {
                    cwd: import.meta.dirname,
                    killSignal: "SIGKILL",
                  });
                  // The kill delay counts from the first saved entry, so every run kills a writer.
                  const ready = yield* handle.stdout.pipe(
                    Stream.decodeText(),
                    Stream.splitLines,
                    Stream.filter((line) => line === "ready"),
                    Stream.runHead,
                    Effect.timeout("30 seconds"),
                  );
                  expect(Option.isSome(ready), "J2: the child saved its first entry").toBe(true);
                  yield* Effect.sleep(`${delay} millis`);
                  yield* handle.kill({ killSignal: "SIGKILL" });
                  yield* handle.exitCode.pipe(Effect.ignore);
                }),
              );
              // Opened again, as the next hands start opens it. The reads run inside the provide: the
              // layer closes the file when its scope closes, so a read after it would fail for that.
              const whole = yield* Effect.gen(function* () {
                const journal = yield* Journal;
                let saved = 0;

                for (const job of JOBS) {
                  const read = yield* journal.read(job).pipe(Effect.result);
                  expect(read._tag, `J2: ${job} after a SIGKILL at ${delay} ms: ${JSON.stringify(read)}`).toBe(
                    "Success",
                  );

                  if (read._tag === "Success" && read.success !== null) {
                    expect(read.success._tag, "J2: a saved entry is whole").toBe("result");
                    saved++;
                  }
                }

                return saved;
              }).pipe(Effect.provide(JournalStore.layer.pipe(Layer.provide(JournalSqlite.layer({ file })))));

              expect(whole, "J2: at least the first entry was saved whole").toBeGreaterThan(0);
              reached.add(whole === JOBS.length ? "all-keys" : "some-keys");
            }).pipe(Effect.provide(NodeServices.layer)),
          { numRuns: runsFor({ fast: 3, full: 20 }) },
        );
        expect(reached.size).toBeGreaterThan(0);
      }),
    600_000,
  );
});
