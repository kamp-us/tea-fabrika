/**
 * The files git tracks, read through a service, so a check never starts git itself and a law hands in
 * a list. `layer` answers `git ls-files -s` run in the working folder.
 */
import { Context, Effect, FileSystem, Layer, Path, Schema, Stream } from "effect";
import { ChildProcess, ChildProcessSpawner } from "effect/process";

/**
 * One tracked file: its path from the repo root, and whether it is a symlink.
 *
 * @category models
 */
interface Entry {
  readonly path: string;
  readonly symlink: boolean;
}

/**
 * Git could not list the tracked files.
 *
 * @category errors
 */
class GitError extends Schema.TaggedError<GitError, { readonly brand: unique symbol }>()("GitError", {
  message: Schema.String,
  cause: Schema.optional(Schema.Defect()),
}) {}

/**
 * The tracked files, sorted by path.
 *
 * @category services
 */
export class Tracked extends Context.Service<
  Tracked,
  { readonly files: Effect.Effect<ReadonlyArray<Entry>, GitError> }
>()("@kalfa/records/Tracked") {
  /** Lists the files with `git ls-files -s -z` in the working folder, which is the repo's root. */
  static readonly layer = Layer.effect(
    Tracked,
    Effect.gen(function* () {
      const spawner = yield* ChildProcessSpawner.ChildProcessSpawner;

      const files = Effect.gen(function* () {
        const handle = yield* spawner.spawn(ChildProcess.make("git", ["ls-files", "-s", "-z"]));

        const [out, code] = yield* Effect.all(
          [Stream.mkString(Stream.decodeText(Stream.drainFork(handle.stdout, handle.stderr))), handle.exitCode],
          { concurrency: 2 },
        );

        if (code !== 0) {
          return yield* new GitError({ message: `git ls-files -s exited with ${code}` });
        }

        return out
          .split("\0")
          .filter((entry) => entry !== "")
          .flatMap((entry) => {
            const tab = entry.indexOf("\t");
            const mode = entry.slice(0, entry.indexOf(" "));

            // 160000 is a submodule: a folder, not a file to read.
            return mode === "160000" ? [] : [{ path: entry.slice(tab + 1), symlink: mode === "120000" }];
          })
          .sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
      }).pipe(
        Effect.scoped,
        Effect.catchTag("PlatformError", (cause) =>
          Effect.fail(new GitError({ message: "git ls-files -s could not run", cause })),
        ),
      );

      return Tracked.of({ files });
    }),
  );
}

/**
 * Reads tracked files, a few at a time. A file git lists but the folder no longer holds (deleted, not yet committed) is left out.
 *
 * @category constructors
 */
export const read = Effect.fnUntraced(function* (root: string, paths: ReadonlyArray<string>) {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;

  const found = yield* Effect.forEach(
    paths,
    (each) =>
      fs.readFileString(path.join(root, each)).pipe(
        Effect.map((text) => [{ path: each, text }]),
        Effect.catchTag("PlatformError", (error) =>
          error.reason._tag === "NotFound" ? Effect.succeed([]) : Effect.fail(error),
        ),
      ),
    { concurrency: 16 },
  );

  return found.flat();
});
