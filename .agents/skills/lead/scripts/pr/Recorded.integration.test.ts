// Today's lead tooling. L16 of .kalfa/quests/land-record-PLAN.md: real signals sent to a real `land.ts`-shaped process. Each law starts
// the fixture (`Recorded.fixture.ts`: `around` under `NodeRuntime.runMain`, waiting for ever), waits until it says it is ready, and
// sends it one signal with `child.kill`, which signals that child's own pid and nothing else. The other laws prove each of these on
// stand-ins (an interrupt in L1, a gone pid in L9); this is the thin check that the real Node and `runMain` do the same. Host-only:
// it starts a process and sends signals, so the laptop refuses it by its name and CI runs it in the full run.
import { spawn } from "node:child_process";
import { NodeServices } from "@effect/platform-node";
import { describe, expect, it } from "@effect/vitest";
import { Deferred, Effect, FileSystem, Schema } from "effect";
import { LandLog, Line } from "./LandLog.ts";
import * as LandLogFs from "./LandLogFs.ts";
import * as Recorded from "./Recorded.ts";

const fixture = `${import.meta.dirname}/Recorded.fixture.ts`;

/** The fixture, running, with its folder: it is stopped (by its own handle) when the law ends, whatever it did. */
const started = Effect.gen(function* () {
  const fs = yield* FileSystem.FileSystem;
  const dir = yield* fs.makeTempDirectoryScoped({ prefix: "recorded-" });
  const ready = yield* Deferred.make<void>();
  const gone = yield* Deferred.make<{ readonly code: number | null; readonly signal: NodeJS.Signals | null }>();

  const child = yield* Effect.acquireRelease(
    Effect.sync(() => {
      const spawned = spawn(process.execPath, [fixture, dir], { stdio: ["ignore", "pipe", "pipe"] });

      spawned.stdout.on("data", (chunk: Buffer) => {
        if (chunk.toString().includes("ready")) {
          Deferred.doneUnsafe(ready, Effect.void);
        }
      });

      spawned.once("exit", (code, signal) => {
        Deferred.doneUnsafe(gone, Effect.succeed({ code, signal }));
      });

      return spawned;
    }),
    (spawned) =>
      Effect.sync(() => {
        if (spawned.exitCode === null && spawned.signalCode === null) {
          spawned.kill("SIGKILL");
        }
      }),
  );

  yield* Deferred.await(ready);

  return { dir, child, gone };
});

/** The lines the child left, and what `land.ts last` would say about them, with the real process probe. */
const left = (dir: string) =>
  Effect.gen(function* () {
    const log = yield* LandLog;

    return {
      lines: (yield* log.read({ _tag: "pr", pr: 2351 })).lines,
      said: yield* Recorded.last({ key: { _tag: "pr", pr: 2351 }, count: 1, alive: Recorded.pidExists }),
    };
  }).pipe(Effect.provide(LandLogFs.layer(dir)));

describe("a real signal: Node and runMain end a recorded command as the stand-ins say", () => {
  // Plants: remove the SIGHUP handler (red: SIGHUP leaves no ending, and the process dies); write the ending before the work (red:
  // a SIGKILL then leaves an ending, and `last` says ended). Not run on the laptop: the plan holds it for CI's full run.
  for (const signal of ["SIGTERM", "SIGINT", "SIGHUP"] as const) {
    it.effect(
      `L16 scenario: a real ${signal} leaves started, then interrupted, as the last line (a real process is the claim)`,
      () =>
        Effect.gen(function* () {
          const { dir, child, gone } = yield* started;

          // Before the signal the process is there, and `last` says it is still running.
          const before = yield* left(dir);
          expect(before.lines.map((line) => line._tag)).toEqual(["started"]);
          expect(before.said[0]).toContain("still running");

          child.kill(signal);
          yield* Deferred.await(gone);

          const after = yield* left(dir);
          expect(after.lines.every(Schema.is(Line))).toBe(true);
          expect(after.lines.map((line) => line._tag)).toEqual(["started", "interrupted"]);
          expect(after.said[0]).not.toContain("died");
        }).pipe(Effect.provide(NodeServices.layer)),
    );
  }

  it.effect(
    "L16 scenario: a real SIGKILL leaves no ending, and `last` says the process is gone (a real process is the claim)",
    () =>
      Effect.gen(function* () {
        const { dir, child, gone } = yield* started;

        child.kill("SIGKILL");
        expect((yield* Deferred.await(gone)).signal).toBe("SIGKILL");

        const after = yield* left(dir);
        expect(after.lines.map((line) => line._tag)).toEqual(["started"]);
        expect(after.said[0]).toContain("died");
      }).pipe(Effect.provide(NodeServices.layer)),
  );
});
