// TicketsCli.layer: the Tickets service on today's app's own command line, `cli.ts post`, as
// agent:lead. Its list shows only open tickets, one line each. A failure keeps the tracker's first
// ERROR line and never its stack, which names local paths.
import { Effect, FileSystem, Layer, Path } from "effect";
import { ChildProcessSpawner } from "effect/process";
import { run } from "./command.ts";
import { Tickets, TicketsError } from "./Tickets.ts";

/** The open tickets in the tracker's list: each line reads `...: #<n> <state> ...`. */
export const openIn = (listed: string): ReadonlyArray<number> =>
  listed
    .split("\n")
    .map((line) => /: #(\d+) ([a-z]+) /.exec(line))
    .filter((found) => found?.[2] === "open")
    .map((found) => Number(found?.[1]));

/** The tracker's first ERROR line in what it printed, or a plain stand-in. */
export const firstError = (said: string): string =>
  said.split("\n").find((line) => line.includes("ERROR")) ?? "no reason given";

/** `main` is the main checkout, which holds the app; `home` is the app's home folder. */
export const layer = (
  main: string,
  home: string,
): Layer.Layer<Tickets, never, ChildProcessSpawner.ChildProcessSpawner | FileSystem.FileSystem | Path.Path> =>
  Layer.effect(
    Tickets,
    Effect.gen(function* () {
      const spawner = yield* ChildProcessSpawner.ChildProcessSpawner;
      const fs = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;

      const post = Effect.fn("TicketsCli.post")(
        function* (args: ReadonlyArray<string>, stdin?: string) {
          const ran = yield* run("node", [`${main}/apps/fabrika/src/cli.ts`, "post", ...args, "--as", "lead"], main, {
            env: { FABRIKA_HOME: home },
            ...(stdin === undefined ? {} : { stdin }),
          });

          if (ran.code !== 0) {
            return yield* new TicketsError({ reason: firstError(`${ran.out}\n${ran.err}`) });
          }

          return ran.out;
        },
        Effect.provideService(ChildProcessSpawner.ChildProcessSpawner, spawner),
        Effect.catchTag("PlatformError", () =>
          Effect.fail(new TicketsError({ reason: "the tracker could not start" })),
        ),
      );

      return Tickets.of({
        open: Effect.map(post(["list"]), openIn),
        // The tracker opens `--body-file` as a regular file and refuses a pipe, `/dev/stdin` included,
        // so the text goes to a file of its own for the one call.
        comment: (number, body) =>
          Effect.scoped(
            Effect.gen(function* () {
              const dir = yield* fs.makeTempDirectoryScoped({ prefix: "ticket-comment-" });
              const file = path.join(dir, "body.md");
              yield* fs.writeFileString(file, body);
              yield* post(["comment", String(number), "--body-file", file]);
            }),
          ).pipe(
            Effect.catchTag("PlatformError", () =>
              Effect.fail(new TicketsError({ reason: "the comment file could not be written" })),
            ),
          ),
        close: (number) => Effect.asVoid(post(["close", String(number)])),
      });
    }),
  );
