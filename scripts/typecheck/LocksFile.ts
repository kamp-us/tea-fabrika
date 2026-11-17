// LocksFile.layer: the Locks service as a label file holding its holder's pid, after Mercurial
// 7.2.4's repository lock (`mercurial/lock.py`, `_trylock` and `_testlock`; `posix.py`, `testpid`).
// A taker writes `<lock>.<pid>.tmp` holding `<pid>\n` and links it to `<lock>`: link(2) fails with
// EEXIST when the name is there, so the label is made whole in one step and never seen empty. A
// waiter that finds the label reads it and `<lock>.child`, asks Processes about each pid, and lets
// `judge` decide. A stale lock is broken only while `<lock>.break` is held, looked at again under it:
// Mercurial's "must do this with another lock held, or can race and break valid lock". A `.break`
// left by a dead breaker is broken the same way, under `<lock>.break.break`, as Mercurial's
// `_testlock` takes `.break` as a lock of its own with `timeout=0`. While a
// command runs, its pid is in `<lock>.child`, so a compiler that outlives a killed wrapper keeps the
// lock. Today's tooling (0113, 0410 as amended on 2026-11-15), following next/'s rules (0033).
import { Console, Effect, FileSystem, Layer, Option, type PlatformError } from "effect";
import { type Held, LockError, Locks } from "./Locks.ts";
import { judge, Liveness, type Look, pidIn, type Read, Seen } from "./Look.ts";
import { Processes } from "./Processes.ts";

// How long a waiter sleeps between looks at a held lock.
const POLL = "250 millis";

export const layer: Layer.Layer<Locks, never, FileSystem.FileSystem | Processes> = Layer.effect(
  Locks,
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const processes = yield* Processes;
    const self = processes.self;
    const label = `${self}\n`;

    const lockError = (path: string, reason: string) => (cause: PlatformError.PlatformError) =>
      new LockError({ path, reason: `${reason}: ${cause.message}`, cause });

    /** Makes `target` hold our pid in one step: true when it did, false when the name was taken. */
    const link = Effect.fnUntraced(function* (lock: string, target: string) {
      const temp = `${lock}.${self}.tmp`;
      yield* fs.writeFileString(temp, label).pipe(Effect.mapError(lockError(temp, "the temp label does not write")));
      const linked = yield* fs.link(temp, target).pipe(
        Effect.as(true),
        Effect.catchReason("PlatformError", "AlreadyExists", () => Effect.succeed(false)),
        Effect.mapError(lockError(target, "the label does not link")),
        Effect.ensuring(fs.remove(temp, { force: true }).pipe(Effect.ignore)),
      );
      return linked;
    });

    /** One lock file's text and mtime, or none where it is gone. */
    const read = Effect.fnUntraced(function* (path: string) {
      const info = yield* fs.stat(path).pipe(
        Effect.asSome,
        Effect.catchReason("PlatformError", "NotFound", () => Effect.succeedNone),
        Effect.mapError(lockError(path, "the lock file does not stat")),
      );

      if (Option.isNone(info)) {
        return Option.none<Read>();
      }

      const at = Option.getOrElse(
        Option.map(info.value.mtime, (d) => d.getTime()),
        () => 0,
      );
      return yield* fs.readFileString(path).pipe(
        Effect.map((text): Option.Option<Read> => Option.some({ text, at })),
        Effect.catchReason("PlatformError", "NotFound", () => Effect.succeed(Option.none<Read>())),
        Effect.mapError(lockError(path, "the lock file does not read")),
      );
    });

    /** Each pid the files name, and how it stands now. */
    const livenessFor = Effect.fnUntraced(function* (files: ReadonlyArray<Option.Option<Read>>) {
      const pids = files.flatMap((file) => Option.toArray(Option.flatMap(file, (f) => pidIn(f.text))));
      const known = new Map<number, Liveness>();

      for (const pid of pids) {
        known.set(pid, yield* processes.liveness(pid));
      }

      return (pid: number) => known.get(pid) ?? Liveness.cases.gone.make({});
    });

    /** Reads the label at `path` and, with `withChild`, the running command's file, then judges. */
    const look = Effect.fnUntraced(function* (path: string, withChild: boolean) {
      const labelRead = yield* read(path);
      const child = withChild ? yield* read(`${path}.child`) : Option.none<Read>();
      const liveness = yield* livenessFor([labelRead, child]);
      const found: Look = { label: labelRead, child, liveness };
      return judge(found);
    });

    /** Removes the label at `path` only if it still names this process. */
    const removeIfOurs = Effect.fnUntraced(function* (path: string) {
      const now = yield* read(path);

      if (Option.isSome(now) && now.value.text === label) {
        yield* fs.remove(path, { force: true }).pipe(Effect.mapError(lockError(path, "does not remove")));
      }
    });

    /**
     * Breaks a stale label at `path` under `<path>.break`, and the running command's file with it
     * when `path` is the lock (`withChild`). Answers `busy` when a live breaker holds `.break`, which
     * is never waited on here, and `again` when the lock should be tried at once. A `.break` left by
     * a dead breaker is broken the same way, by this step one level down, under `.break.break`.
     * Uninterruptible as a whole: a breaker that stopped halfway would leave `.break` naming a live
     * process.
     */
    const breakStale = (path: string, withChild: boolean): Effect.Effect<"busy" | "again", LockError> =>
      Effect.uninterruptible(
        Effect.gen(function* () {
          const breaker = `${path}.break`;

          if (!(yield* link(path, breaker))) {
            return yield* Seen.match(yield* look(breaker, false), {
              held: () => Effect.succeed("busy" as const),
              stale: () => breakStale(breaker, false),
              free: () => Effect.succeed("again" as const),
            });
          }

          yield* Effect.gen(function* () {
            // Looked at again under `.break`: another breaker may have taken the lock since.
            if (Seen.guards.stale(yield* look(path, withChild))) {
              yield* fs.remove(path, { force: true }).pipe(Effect.mapError(lockError(path, "does not remove")));

              if (withChild) {
                yield* fs
                  .remove(`${path}.child`, { force: true })
                  .pipe(Effect.mapError(lockError(`${path}.child`, "does not remove")));
              }
            }
          }).pipe(Effect.ensuring(removeIfOurs(breaker).pipe(Effect.ignore)));
          return "again" as const;
        }),
      );

    /** Lets the lock go: the running command's file, then the label if it still names us. */
    const release = (lock: string) =>
      Effect.gen(function* () {
        yield* fs.remove(`${lock}.child`, { force: true });
        yield* removeIfOurs(lock);
      }).pipe(Effect.catch((e) => Console.error(`typecheck: the lock ${lock} was not let go cleanly: ${e.message}`)));

    /** Names a holder for the waiting line: its pid, and its command line where ps can read it. */
    const named = Effect.fnUntraced(function* (pid: number) {
      const args = yield* processes.args(pid);
      return args === "" ? `pid ${pid}` : `pid ${pid} (${args})`;
    });

    const hold = Effect.fnUntraced(function* (lock: string) {
      let said = false;

      for (;;) {
        // The take and its finalizer are one step, so an interrupt never leaves a label behind.
        const taken = yield* Effect.uninterruptible(
          Effect.gen(function* () {
            const linked = yield* link(lock, lock);

            if (linked) {
              yield* Effect.addFinalizer(() => release(lock));
            }

            return linked;
          }),
        );

        if (taken) {
          break;
        }

        yield* Seen.match(yield* look(lock, true), {
          held: ({ pid }) =>
            Effect.gen(function* () {
              if (!said) {
                said = true;
                yield* Console.error(`typecheck: waiting for ${yield* named(pid)}, which holds ${lock}`);
              }

              yield* Effect.sleep(POLL);
            }),
          stale: () =>
            breakStale(lock, true).pipe(
              Effect.flatMap((answer) => (answer === "busy" ? Effect.sleep(POLL) : Effect.void)),
            ),
          free: () => Effect.void,
        });
      }

      const child = `${lock}.child`;
      const running = (pid: Option.Option<number>) =>
        Option.match(pid, {
          onNone: () => fs.remove(child, { force: true }),
          // Written whole and renamed into place, so a waiter never reads it half written.
          onSome: (n) => {
            const temp = `${child}.${self}.tmp`;
            return fs.writeFileString(temp, `${n}\n`).pipe(Effect.andThen(fs.rename(temp, child)));
          },
        }).pipe(Effect.mapError(lockError(child, "the running command's pid does not write")));
      return { running } satisfies Held;
    });

    return Locks.of({ hold });
  }),
);
