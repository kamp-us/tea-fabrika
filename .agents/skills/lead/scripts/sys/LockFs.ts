// LockFs.layer: the Lock service on a pid file, lifted from flow/host.ts's Electron lock. A hold
// writes `<dir>/<name>.lock` with the `wx` flag, so only one process can make it; the file holds the
// holder's pid. A live holder is waited on, and a dead one's file is taken over, so a crash never
// leaves the name held. Closing the scope removes the file.
//
// Node has no `flock` (redact.sh held its swap with Python's `fcntl.flock`); a pid file with `wx`
// is the repo's own answer, as host.ts and mutbox.ts keep theirs.
import { Effect, FileSystem, Layer, Path, Schedule, Schema } from "effect";
import { Lock } from "./Lock.ts";

/** How long a hold waits before it tries a held name again. */
const EVERY = "100 millis";

/** Another live process holds the name; the take is tried again on its schedule. */
class Held extends Schema.TaggedError<Held>()("Held", { pid: Schema.Number }) {}

/** Whether `pid` is a live process: signal 0 sends nothing, it only asks. */
const alive = (pid: number) =>
  Effect.try({ try: () => process.kill(pid, 0), catch: () => "gone" }).pipe(
    Effect.as(true),
    Effect.orElseSucceed(() => false),
  );

/** `dir` is the folder the lock files live in, such as the system's temp folder. */
export const layer = (dir: string): Layer.Layer<Lock, never, FileSystem.FileSystem | Path.Path> =>
  Layer.effect(
    Lock,
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      const hold = Effect.fn("LockFs.hold")(function* (name: string) {
        const file = path.join(dir, `${name}.lock`);
        const write = fs.writeFileString(file, String(process.pid), { flag: "wx" }).pipe(
          Effect.as(true),
          Effect.orElseSucceed(() => false),
        );
        const take = Effect.gen(function* () {
          if (yield* write) {
            return;
          }

          const owner = Number((yield* fs.readFileString(file).pipe(Effect.orElseSucceed(() => ""))).trim());

          if (Number.isInteger(owner) && owner > 0 && (yield* alive(owner))) {
            return yield* new Held({ pid: owner });
          }

          yield* fs.remove(file, { force: true }).pipe(Effect.ignore);

          if (!(yield* write)) {
            return yield* new Held({ pid: 0 });
          }
        });
        // `Schedule.spaced` never ends, so a held name is waited on for as long as it is held, and
        // `Held` never leaves the retry.
        const waited = take.pipe(Effect.retry({ schedule: Schedule.spaced(EVERY) }), Effect.orDie);
        yield* Effect.acquireRelease(waited, () => fs.remove(file, { force: true }).pipe(Effect.ignore));
      });
      return Lock.of({ hold });
    }),
  );
