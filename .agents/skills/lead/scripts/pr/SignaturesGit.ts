// SignaturesGit.layer: the Signatures service on real git, in the checkout the caller names. It changes nothing but the refs
// it fetches. Main is fetched into a ref of this call alone and the ref is removed after: never FETCH_HEAD (every fetch in a
// checkout writes it) and never a shared ref: see ./MainFetch.ts.
import { Effect, Layer } from "effect";
import { ChildProcessSpawner } from "effect/process";

import { lastLine, run } from "./command.ts";
import { fetchedMain } from "./MainFetch.ts";
import { Signatures, SignaturesError } from "./Signatures.ts";

/** The identity `stepcommit.sh` commits as; a commit with this author is one of its own. */
export const BOT_EMAIL = "353269643+fabrikalfa[bot]@users.noreply.github.com";

export const layer: Layer.Layer<Signatures, never, ChildProcessSpawner.ChildProcessSpawner> = Layer.effect(
  Signatures,
  Effect.gen(function* () {
    const spawner = yield* ChildProcessSpawner.ChildProcessSpawner;

    /** One git call run to its end, whatever its exit code; one that cannot start fails. */
    const ran = (dir: string, args: ReadonlyArray<string>) =>
      run("git", args, dir).pipe(
        Effect.provideService(ChildProcessSpawner.ChildProcessSpawner, spawner),
        Effect.catchTag("PlatformError", (e) =>
          Effect.fail(SignaturesError.make({ reason: `git ${args[0] ?? ""} could not start: ${e.message}` })),
        ),
      );

    /** One git call that must exit 0; its output, trimmed. */
    const must = (dir: string, reason: string, ...args: ReadonlyArray<string>) =>
      Effect.flatMap(ran(dir, args), (done) =>
        done.code === 0
          ? Effect.succeed(done.out.trim())
          : Effect.fail(SignaturesError.make({ reason: `${reason}: ${lastLine(done)}` })),
      );

    const commits = Effect.fn("SignaturesGit.unsigned")(function* (dir: string, head: string) {
      const main = yield* fetchedMain(dir).pipe(
        Effect.provideService(ChildProcessSpawner.ChildProcessSpawner, spawner),
        Effect.mapError((e) =>
          SignaturesError.make({ reason: `${e.reason}: ${e.output.trim().split("\n").at(-1) ?? ""}` }),
        ),
      );

      if ((yield* ran(dir, ["cat-file", "-e", `${head}^{commit}`])).code !== 0) {
        yield* must(
          dir,
          `the pull request head ${head.slice(0, 8)} could not be fetched`,
          "fetch",
          "-q",
          "--no-write-fetch-head",
          "origin",
          head,
        );
      }

      const listed = yield* must(dir, "the branch's commits do not read", "rev-list", "--reverse", `${main}..${head}`);
      const unsigned: Array<string> = [];

      for (const sha of listed.split("\n").filter((line) => line !== "")) {
        const noted = yield* ran(dir, ["notes", "--ref=fabrika", "list", sha]);
        const raw = yield* must(dir, `${sha} does not read`, "cat-file", "commit", sha);
        const author = yield* must(dir, `${sha} does not read`, "log", "-1", "--format=%ae", sha);

        if (noted.code !== 0 && author !== BOT_EMAIL && !/^gpgsig /m.test(raw.split("\n\n")[0] ?? "")) {
          const subject = yield* must(dir, `${sha} does not read`, "log", "-1", "--format=%s", sha);
          unsigned.push(`${sha.slice(0, 8)} ${subject}`);
        }
      }

      return unsigned;
    });

    return Signatures.of({ unsigned: commits });
  }),
);
