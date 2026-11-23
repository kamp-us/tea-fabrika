/**
 * The watch of one configuration file: a tick each time the file may have changed, after it has been quiet for the window. It watches the file's folder and never the file itself, because an editor that saves by a rename leaves a watch on the file's own path following the old file. A folder that is missing is waited for by watching its parent.
 */
import {
  Deferred,
  Effect,
  FileSystem,
  Option,
  Path,
  type PlatformError,
  Queue,
  Ref,
  Stream,
  type Duration,
} from "effect";
import type { Place } from "./place.ts";

/**
 * A tick each time `place`'s file may have changed. It never fails, and it ends only when the file cannot be watched at all: one warning says so and the file is then followed only by a restart.
 *
 * **Details**
 *
 * `ready` completes once the first watch is installed, or the file is given up, so a start can wait for it. Each watch gives one tick when it is installed, so a change made after the start's read and before the watch is not missed. After each quiet window the folder is looked at: gone, the file reads as empty and the watch moves to the parent, which waits for the folder to come back.
 */
export const ticks = (
  app: string,
  place: Place,
  window: Duration.Input,
  ready: Deferred.Deferred<void>,
): Stream.Stream<void, never, FileSystem.FileSystem | Path.Path> =>
  Stream.callback<void, never, FileSystem.FileSystem | Path.Path>((queue) =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      const folder = path.dirname(place.path);
      const file = path.basename(place.path);
      const own = path.basename(folder);

      /** After each quiet window of a watch of `dir`, whether the folder is there and this watch can still be trusted. Only the named events count; a window with an event of a `stale` name says the folder itself came or went, so a watch made before it follows the old folder. The watch's own installing counts at once, with no window: it is a first look. */
      const quiet = (
        dir: string,
        names: ReadonlyArray<string>,
        stale: ReadonlyArray<string>,
      ): Stream.Stream<boolean, PlatformError.PlatformError> =>
        Stream.unwrap(
          Effect.map(Effect.all([Deferred.make<void>(), Ref.make(false)], { concurrency: 1 }), ([installed, moved]) =>
            Stream.merge(
              fs
                .watch(dir, {
                  onReady: () => {
                    Deferred.doneUnsafe(installed, Effect.void);
                    Deferred.doneUnsafe(ready, Effect.void);
                  },
                })
                .pipe(
                  Stream.filter((event) => names.includes(path.basename(event.path))),
                  Stream.tap((event) =>
                    stale.includes(path.basename(event.path)) ? Ref.set(moved, true) : Effect.void,
                  ),
                  Stream.debounce(window),
                ),
              Stream.fromEffect(Deferred.await(installed)),
            ).pipe(
              Stream.mapEffect(() =>
                Effect.zipWith(fs.exists(folder), Ref.getAndSet(moved, false), (there, changed) => there && !changed),
              ),
            ),
          ),
        );

      const giveUp = Effect.logWarning(
        `${place.name} is not watched: the folder could not be watched. A change to it applies when ${app} starts again.`,
      ).pipe(Effect.annotateLogs("kalfa.config.file", place.name));

      // A watch that fails says the folder is gone when it is not found, and is given up on for any other reason.
      const lost = (error: PlatformError.PlatformError): Effect.Effect<Option.Option<boolean>> =>
        Effect.succeed(error.reason._tag === "NotFound" ? Option.some(false) : Option.none());

      // The folder is there: each quiet window is a tick. The folder going away, or going and coming back as a new one, moves the watch to its parent, which finds it again and watches it afresh.
      const inFolder: Effect.Effect<void, never, FileSystem.FileSystem | Path.Path> = quiet(
        folder,
        [file, own],
        [own],
      ).pipe(
        Stream.tap(() => Queue.offer(queue, undefined)),
        Stream.takeUntil((there) => !there),
        Stream.runLast,
        Effect.catch(lost),
        Effect.flatMap(Option.match({ onNone: () => giveUp, onSome: (there) => (there ? giveUp : inParent) })),
      );

      // The folder is missing: wait for its parent to say it came back, then watch it.
      const inParent: Effect.Effect<void, never, FileSystem.FileSystem | Path.Path> = quiet(
        path.dirname(folder),
        [own],
        [],
      ).pipe(
        Stream.filter((there) => there),
        Stream.runHead,
        Effect.catch(() => Effect.succeed(Option.none<boolean>())),
        Effect.flatMap(Option.match({ onNone: () => giveUp, onSome: () => inFolder })),
      );

      yield* inFolder;
    }).pipe(Effect.ensuring(Effect.andThen(Deferred.succeed(ready, undefined), Queue.end(queue)))),
  );
