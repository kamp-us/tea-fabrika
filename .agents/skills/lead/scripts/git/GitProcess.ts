// GitProcess.layer: the Git service on real git, in one checkout. Each call is one `git -C <dir>`
// run through pr/command.ts; any exit but 0, or a git that cannot start, fails with GitError. A call
// whose answer can be none names the one exit code git gives for it.
import { Effect, Layer, Option } from "effect";
import { ChildProcessSpawner } from "effect/process";
import { lastLine, run } from "../pr/command.ts";
import { Git, GitError } from "./Git.ts";

/** The shell's `$(...)` drops the trailing newlines, and only those. */
const line = (out: string) => out.replace(/\n+$/, "");

export const layer = (dir: string): Layer.Layer<Git, never, ChildProcessSpawner.ChildProcessSpawner> =>
  Layer.effect(
    Git,
    Effect.gen(function* () {
      const spawner = yield* ChildProcessSpawner.ChildProcessSpawner;

      /**
       * One git call and its stdout, whole, or none when git exits `none`, the code by which it says
       * there is nothing to give; with no `none`, every exit but 0 fails.
       */
      const ask = Effect.fn("GitProcess.git")(
        function* (call: { readonly args: ReadonlyArray<string>; readonly none?: number }) {
          const ran = yield* run("git", ["-C", dir, ...call.args], dir);

          if (call.none !== undefined && ran.code === call.none) {
            return Option.none<string>();
          }

          if (ran.code !== 0) {
            return yield* GitError.make({
              command: call.args[0] ?? "",
              reason: `exited ${ran.code}: ${lastLine(ran)}`,
            });
          }

          return Option.some(ran.out);
        },
        Effect.provideService(ChildProcessSpawner.ChildProcessSpawner, spawner),
        (effect, call) =>
          Effect.catchTag(effect, "PlatformError", (e) =>
            Effect.fail(GitError.make({ command: call.args[0] ?? "", reason: e.message })),
          ),
      );

      /** One git call that must exit 0, and its stdout, whole. */
      const git = (args: ReadonlyArray<string>) =>
        Effect.map(
          ask({ args }),
          Option.getOrElse(() => ""),
        );

      return Git.of({
        top: Effect.map(git(["rev-parse", "--show-toplevel"]), line),
        diff: (args) => git(["diff", ...args]),
        commonDir: Effect.map(git(["rev-parse", "--path-format=absolute", "--git-common-dir"]), line),
        // `remote get-url` exits 2 when there is no such remote.
        remote: (name) => Effect.map(ask({ args: ["remote", "get-url", name], none: 2 }), Option.map(line)),
        // `config --get` exits 1 when the key is not set.
        globalConfig: (key) =>
          Effect.map(ask({ args: ["config", "--global", "--get", key], none: 1 }), Option.map(line)),
      });
    }),
  );
