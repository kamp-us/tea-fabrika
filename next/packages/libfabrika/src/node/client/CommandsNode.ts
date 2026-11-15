/**
 * The hands' real `Commands` on a laptop: each closed command is one child process with a pinned
 * environment and an output cap, run through Effect's `ChildProcessSpawner`.
 *
 * @stability unstable
 */
import { Config, Effect, FileSystem, Layer, Path } from "effect";
import { ChildProcessSpawner } from "effect/process";
import { Commands } from "../../client/Commands.ts";
import type { Command } from "../../jobs/Job.ts";
import { capped } from "./internal/capped.ts";

/** The most bytes a command may print, stdout and stderr together, before it is stopped. */
const CAP: Record<Command["_tag"], number> = { git_version: 4096 };

/** What each closed command runs: the executable, found on `PATH`, and its arguments. */
const ARGV: Record<Command["_tag"], readonly [string, ReadonlyArray<string>]> = {
  git_version: ["git", ["--version"]],
};

/** Whether a folder of `PATH` holds a file `name` with an execute bit. */
const onPath = Effect.fnUntraced(function* (name: string, PATH: string) {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const runnable = (folder: string) =>
    fs.stat(path.join(folder, name)).pipe(
      Effect.map((info) => info.type === "File" && (info.mode & 0o111) !== 0),
      Effect.orElseSucceed(() => false),
    );
  const folders = PATH.split(":").filter((folder) => folder !== "");
  const found = yield* Effect.forEach(folders, runnable, { concurrency: "unbounded" });
  return found.includes(true);
});

/**
 * Layer that supplies `Commands` from the spawner, the file system and this process's `PATH`.
 *
 * **Details**
 *
 * `has` is `["git"]` when a folder of `PATH` holds an executable `git` at the layer's build, and
 * `[]` otherwise, so a host without git is refused at take time and never runs the job. `execute`
 * runs the command's child with only `PATH` in its environment, in a scope of its own, and stops
 * it once it prints more than the command's cap.
 *
 * @stability unstable
 * @category layers
 */
export const layer = Layer.effect(
  Commands,
  Effect.gen(function* () {
    const spawner = yield* ChildProcessSpawner.ChildProcessSpawner;
    // The one value of this process's environment that the child gets.
    const PATH = yield* Config.String("PATH");
    const git = yield* onPath("git", PATH);
    return Commands.of({
      has: git ? ["git"] : [],
      execute: (command) => capped(spawner, ARGV[command._tag], { PATH }, CAP[command._tag]),
    });
  }),
);
