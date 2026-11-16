// GitProcess.layer: the Git service on real git, in one checkout. Each call is one `git -C <dir>`
// run through pr/command.ts; any exit but 0, or a git that cannot start, fails with GitError.
import { Effect, Layer } from "effect";
import { ChildProcessSpawner } from "effect/process";
import { lastLine, run } from "../pr/command.ts";
import { Git, GitError } from "./Git.ts";

export const layer = (dir: string): Layer.Layer<Git, never, ChildProcessSpawner.ChildProcessSpawner> =>
  Layer.effect(
    Git,
    Effect.gen(function* () {
      const spawner = yield* ChildProcessSpawner.ChildProcessSpawner;

      /** One git call and its stdout, whole. */
      const git = Effect.fn("GitProcess.git")(
        function* (args: ReadonlyArray<string>) {
          const ran = yield* run("git", ["-C", dir, ...args], dir);

          if (ran.code !== 0) {
            return yield* GitError.make({ command: args[0] ?? "", reason: `exited ${ran.code}: ${lastLine(ran)}` });
          }

          return ran.out;
        },
        Effect.provideService(ChildProcessSpawner.ChildProcessSpawner, spawner),
        (effect, args) =>
          Effect.catchTag(effect, "PlatformError", (e) =>
            Effect.fail(GitError.make({ command: args[0] ?? "", reason: e.message })),
          ),
      );

      return Git.of({
        // The shell's `$(...)` drops the trailing newlines, and only those.
        top: Effect.map(git(["rev-parse", "--show-toplevel"]), (out) => out.replace(/\n+$/, "")),
        diff: (args) => git(["diff", ...args]),
      });
    }),
  );
