// ProcessesPs.layer: the Processes service on pgrep, ps and kill(pid, 0). pgrep's exits are read as
// `.agents/skills/lead/scripts/pgrep.ts` reads them, 0 and 1 listed and anything else refused; that
// file sits in the `.agents` package, which `scripts/` does not import by path, so the rule is
// copied here. A pid is alive unless kill(pid, 0) says ESRCH, as Mercurial's `posix.py` `testpid`
// reads it, so a refusal waits rather than breaks. Its start is now less ps's elapsed time.
// Today's tooling (0113), following next/'s rules (0033).
import { Clock, Effect, Layer, Predicate, Stream } from "effect";
import { ChildProcess, ChildProcessSpawner } from "effect/process";
import { Liveness } from "./Look.ts";
import { Listing, Processes } from "./Processes.ts";

// ps prints elapsed time as [[dd-]hh:]mm:ss, right-aligned (procps-ng ps(1) and macOS ps(1)).
const ETIME = /^(?:(?:(\d+)-)?(\d+):)?(\d+):(\d+)$/;

/** The seconds an `etime` names, or undefined where ps printed something else. */
const secondsIn = (etime: string): number | undefined => {
  const found = ETIME.exec(etime.trim());

  if (found === null) {
    return undefined;
  }

  const [, days = "0", hours = "0", minutes = "0", seconds = "0"] = found;
  return ((Number(days) * 24 + Number(hours)) * 60 + Number(minutes)) * 60 + Number(seconds);
};

/**
 * Whether `pid` is gone: kill(pid, 0) says ESRCH. Any other answer, EPERM included, is alive.
 * Effect has no form of kill(pid, 0) (0250).
 */
const gone = (pid: number) =>
  Effect.try({
    try: () => process.kill(pid, 0),
    catch: (e): boolean => Predicate.hasProperty(e, "code") && e.code === "ESRCH",
  }).pipe(
    Effect.as(false),
    Effect.catch((esrch) => Effect.succeed(esrch)),
  );

export const layer: Layer.Layer<Processes, never, ChildProcessSpawner.ChildProcessSpawner> = Layer.effect(
  Processes,
  Effect.gen(function* () {
    const spawner = yield* ChildProcessSpawner.ChildProcessSpawner;

    /** Runs one short command and reads its stdout and exit code; a command that cannot start is none. */
    const ran = (cmd: string, args: ReadonlyArray<string>) =>
      Effect.gen(function* () {
        const handle = yield* ChildProcess.make(cmd, [...args], { stdin: "ignore" });
        const [out, , code] = yield* Effect.all(
          [Stream.mkString(Stream.decodeText(handle.stdout)), Stream.runDrain(handle.stderr), handle.exitCode],
          { concurrency: 3 },
        );
        return { out, code: Number(code) };
      }).pipe(
        Effect.scoped,
        Effect.provideService(ChildProcessSpawner.ChildProcessSpawner, spawner),
        Effect.catch(() => Effect.succeed({ out: "", code: -1 })),
      );

    const named = Effect.fn("ProcessesPs.named")(function* (name: string) {
      const found = yield* ran("pgrep", ["-x", name]);

      if (found.code !== 0 && found.code !== 1) {
        return Listing.cases.refused.make({});
      }

      const pids = found.out
        .split("\n")
        .map((line) => line.trim())
        .filter((line) => /^\d+$/.test(line))
        .map(Number);
      return Listing.cases.listed.make({ pids });
    });

    const args = Effect.fn("ProcessesPs.args")(function* (pid: number) {
      const found = yield* ran("ps", ["-o", "args=", "-p", String(pid)]);
      return found.code === 0 ? found.out.trim() : "";
    });

    const liveness = Effect.fn("ProcessesPs.liveness")(function* (pid: number) {
      if (yield* gone(pid)) {
        return Liveness.cases.gone.make({});
      }

      const found = yield* ran("ps", ["-o", "etime=", "-p", String(pid)]);
      const seconds = found.code === 0 ? secondsIn(found.out) : undefined;

      if (seconds === undefined) {
        return Liveness.cases.running.make({});
      }

      const now = yield* Clock.currentTimeMillis;
      return Liveness.cases.running.make({ startedAt: now - seconds * 1000 });
    });

    // This process's pid: Effect has no form of it (0250).
    return Processes.of({ self: process.pid, named, args, liveness });
  }),
);
