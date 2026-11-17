// RunsFs.layer: the Runs service on the file system, the one mover every cleanup shares (0113: it
// was keepruns.sh). Before a box or worktree folder goes, its runs/ moves into MAIN's
// runs/<folder name>/, so raw samples kept there survive the removal (field note 2026-11-09: a
// landed worktree's removal deleted experiment 244's raw answers). Today's lead tooling.
//
//   nothing to keep (no runs/, or an empty one)       kept, says nothing
//   moved                                             kept, says "kept runs of <name> at runs/<dest>"
//   a runs/ that is a link or a file, MAIN's own
//   runs/, a write or a move that failed              not kept: the caller keeps the folder
//
// A name already taken under MAIN's runs/ gets a -<n> suffix; nothing there is ever overwritten.
// It waits on nothing, so on a synchronous FileSystem it runs synchronously.
import { Effect, FileSystem, Layer, Option, Path } from "effect";
import { type Kept, Runs } from "./Runs.ts";

const nothing: Kept = { said: "", kept: true };

const refused: Kept = { said: "", kept: false };

/** `main` is MAIN, the checkout whose runs/ every folder's runs/ moves into. */
export const layer = (main: string): Layer.Layer<Runs, never, FileSystem.FileSystem | Path.Path> =>
  Layer.effect(
    Runs,
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;

      /** What is at `at` itself, a link not followed; none when nothing is there. */
      const entry = (at: string) =>
        fs.lstat(at).pipe(
          Effect.asSome,
          Effect.catchReason("PlatformError", "NotFound", () => Effect.succeedNone),
        );

      /** The first of `<name>`, `<name>-1`, `<name>-2`, ... under `into` with nothing there, not even a link. */
      const free = Effect.fnUntraced(function* (into: string, name: string) {
        for (let n = 0; ; n += 1) {
          const dest = path.join(into, n === 0 ? name : `${name}-${n}`);

          if (Option.isNone(yield* entry(dest))) {
            return dest;
          }
        }
      });

      const keep = Effect.fn("RunsFs.keep")(
        function* (folder: string) {
          const name = path.basename(folder);
          const src = path.join(folder, "runs");
          const found = yield* entry(src);

          if (Option.isNone(found)) {
            return nothing;
          }

          if (found.value.type !== "Directory") {
            return refused;
          }

          if ((yield* fs.readDirectory(src)).length === 0) {
            return nothing;
          }

          if ((yield* fs.realPath(folder)) === (yield* fs.realPath(main))) {
            return refused;
          }

          const into = path.join(main, "runs");
          yield* fs.makeDirectory(into, { recursive: true });
          const dest = yield* free(into, name);
          yield* fs.rename(src, dest);

          return { said: `kept runs of ${name} at runs/${path.basename(dest)}`, kept: true };
        },
        Effect.catchTag("PlatformError", () => Effect.succeed(refused)),
      );

      return Runs.of({ keep });
    }),
  );
