// ChangesGit.layer: the Changes service on real git, in the checkout the caller names. It asks one question, `git diff --name-only -z
// --no-renames origin/main...<head>`, and changes nothing. `-z` makes the answer NUL-separated, so a name with a space, a line break or an
// accent comes back whole, and `--no-renames` lists both halves of a move, so a file moved out of a reviewed folder still names the folder.
// The head and origin/main must be fetched already, as the leak check earlier in the gate leaves them.
import { Effect, Layer } from "effect";
import { ChildProcessSpawner } from "effect/process";
import { Changes, ChangesError } from "./Changes.ts";
import { lastLine, run } from "./command.ts";

export const layer: Layer.Layer<Changes, never, ChildProcessSpawner.ChildProcessSpawner> = Layer.effect(
  Changes,
  Effect.gen(function* () {
    const spawner = yield* ChildProcessSpawner.ChildProcessSpawner;

    const paths = Effect.fn("ChangesGit.paths")(
      function* (dir: string, head: string) {
        const ran = yield* run("git", ["diff", "--name-only", "-z", "--no-renames", `origin/main...${head}`], dir);

        if (ran.code !== 0) {
          return yield* ChangesError.make({
            reason: `git diff of ${head.slice(0, 12)} against origin/main exited ${ran.code}: ${lastLine(ran)}`,
          });
        }

        // Each name ends with a NUL; an answer that does not was cut, and a cut list is never read as the whole one.
        if (ran.out !== "" && !ran.out.endsWith("\0")) {
          return yield* ChangesError.make({ reason: "git diff printed a name that was cut short" });
        }

        return ran.out.split("\0").slice(0, -1);
      },
      Effect.provideService(ChildProcessSpawner.ChildProcessSpawner, spawner),
      Effect.catchTag("PlatformError", (e) =>
        Effect.fail(ChangesError.make({ reason: `git could not start: ${e.message}` })),
      ),
    );

    return Changes.of({ paths });
  }),
);
