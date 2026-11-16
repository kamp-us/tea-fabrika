// P39 slice 4b, next/: the journal file survives a crash, J2 (0536: the schedule). Host-only: it
// sends a real SIGKILL to a real child, so it runs only in CI's full run, in its container (0045),
// never on a laptop.
//
// What it holds `node/client/JournalSqlite.ts` to, from the approved plan
// (docs/plan/quests/p39-s5-PLAN.md, "The journal file"): a hands-like child writing journal entries in
// a loop and killed with SIGKILL at any moment leaves every key holding one whole entry, or none,
// when the file is opened again; never a torn value, which the 4a machine reads as `bad_entry` and
// then skips for good.
//
// The child prints `ready` only once all sixteen keys are saved, so none is ever right after the
// kill: a key that reads null lost an entry the journal had said was saved. To 4a's machine a lost
// `executing` entry means "never seen", and the task runs a second time. So every key must read a
// whole entry the child wrote for that key.
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

/** The tasks the child writes (`JournalSqlite.child.test-support.ts`): write `n` goes to `n % 16`. */
const TASKS = Array.from({ length: 16 }, (_, i) => `P/${i}/0`);

/**
 * Every one of the sixteen keys reads a whole entry the child wrote for it: no error, no null, a
 * `result` whose execution `execution-<n>` has `n % 16` equal to the key's place, and whose version
 * is the full 64 KiB value that starts `<n>:`.
 */
const everyKeyWhole = (label: string) =>
  Effect.gen(function* () {
    const journal = yield* Journal;

    for (const [place, task] of TASKS.entries()) {
      const read = yield* journal.read(task).pipe(Effect.result);
      const shown = JSON.stringify(read).slice(0, 200);
      expect(read._tag, `J2: ${task} ${label} reads without an error: ${shown}`).toBe("Success");
      const entry = read._tag === "Success" ? read.success : null;
      expect(entry, `J2: ${task} ${label} still holds the entry saved before ready`).not.toBeNull();
      expect(entry?._tag, `J2: ${task} ${label} holds a whole result entry`).toBe("result");
      const n = entry?._tag === "result" ? Number(entry.execution.replace(/^execution-/, "")) : Number.NaN;
      expect(Number.isInteger(n) && n % TASKS.length === place, `J2: ${task} ${label} holds its own write`).toBe(true);
      const result = entry?._tag === "result" ? entry.result : null;
      const version = result?._tag === "exited" ? result.version : "";
      expect(
        version.length === 64 * 1024 && version.startsWith(`${n}:`),
        `J2: ${task} ${label} holds the whole value of write ${n}`,
      ).toBe(true);
    }
  });

describe("P39 slice 4b: the journal file after a crash", () => {
  it.live(
    "J2: a hands-like child that saves all sixteen keys, then writes in a loop and is killed with SIGKILL at a generated moment, leaves every one of the sixteen keys holding one whole entry when the file is opened again",
    () =>
      Effect.gen(function* () {
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

                  // The kill delay counts from the first full round, so every run kills a writer
                  // whose sixteen keys are all saved.
                  const ready = yield* handle.stdout.pipe(
                    Stream.decodeText(),
                    Stream.splitLines,
                    Stream.filter((line) => line === "ready"),
                    Stream.runHead,
                    Effect.timeout("30 seconds"),
                  );

                  expect(Option.isSome(ready), "J2: the child saved all sixteen keys").toBe(true);
                  yield* Effect.sleep(`${delay} millis`);
                  yield* handle.kill({ killSignal: "SIGKILL" });
                  yield* handle.exitCode.pipe(Effect.ignore);
                }),
              );
              // Opened again, as the next hands start opens it. The reads run inside the provide: the
              // layer closes the file when its scope closes, so a read after it would fail for that.
              yield* everyKeyWhole(`after a SIGKILL at ${delay} ms`).pipe(
                Effect.provide(JournalStore.layer.pipe(Layer.provide(JournalSqlite.layer({ file })))),
              );
            }).pipe(Effect.provide(NodeServices.layer)),
          { numRuns: runsFor({ fast: 3, full: 20 }) },
        );
      }),
    600_000,
  );
});
