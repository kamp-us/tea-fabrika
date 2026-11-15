// `pnpm lint`: its parts at once, so the slowest part sets the time and not their sum
// (experiment 292: 78 to 117 s one after another in CI, about 55 s for `lint:dead` alone).
//
//   node oxlint-plugins/parallel.ts '<command>' '<command>' ...
//
// Each argument is one part, a shell command run with `sh -c`. Every part runs to its end, even
// once another has failed, so one run names every failure. A part's output is held until it ends
// and is printed whole, in the order the parts were given, so two parts' lines never mix. The run
// exits 1 when any part did not exit 0, and names those parts last.
//
// Two parts that write the same file must never run at once: they go in one argument joined by
// `&&`, so the shell runs them one after the other. Today no two do. A part that writes, writes a
// file of its own, and only when it prunes: `oxlint-plugins/lint.ts` its two ledgers, `lint:dead`
// `unreachable-ledger.json`, `lint:boundaries` `boundary-ledger.json` (when that file exists). And
// no part reads a file another writes: the format check leaves those ledgers out by name
// (`.oxfmtrc.json`).
import { NodeRuntime, NodeServices } from "@effect/platform-node";
import { Console, Duration, Effect, Fiber, Schema, Stdio, Stream } from "effect";
import { ChildProcess } from "effect/process";

/** A piece of a part's output, and the stream it went to. */
type Piece = { readonly to: "stdout" | "stderr"; readonly bytes: Uint8Array };

/** What one part left: its command, its output in the order it came, its exit code and its time. */
type Ran = {
  readonly command: string;
  readonly output: ReadonlyArray<Piece>;
  readonly code: number;
  readonly took: Duration.Duration;
};

/** The run's one failure: the parts that did not exit 0, in the order they were given. */
class Failed extends Schema.TaggedError<Failed>()("Failed", { parts: Schema.Array(Schema.String) }) {}

const tagged = (to: Piece["to"]) => Stream.map((bytes: Uint8Array): Piece => ({ to, bytes }));

const unstarted = (reason: string): ReadonlyArray<Piece> => [
  { to: "stderr", bytes: new TextEncoder().encode(`could not start: ${reason}\n`) },
];

/** Runs one part to its end. A part that cannot start is a failed part, its reason its output. */
const run = (command: string) =>
  Effect.gen(function* () {
    const handle = yield* ChildProcess.make("sh", ["-c", command], { stdin: "ignore" });
    const [output, code] = yield* Effect.all(
      [
        Stream.runCollect(Stream.merge(handle.stdout.pipe(tagged("stdout")), handle.stderr.pipe(tagged("stderr")))),
        handle.exitCode,
      ],
      { concurrency: "unbounded" },
    );
    return { output, code: Number(code) };
  }).pipe(
    Effect.scoped,
    Effect.catchTag("PlatformError", (error) => Effect.succeed({ output: unstarted(error.message), code: 127 })),
    Effect.timed,
    Effect.map(([took, ran]): Ran => ({ command, ...ran, took })),
  );

const seconds = (took: Duration.Duration) => `${(Duration.toMillis(took) / 1000).toFixed(1)} s`;

/** Prints one part whole: a line naming it and how it ended, then its output as it came. */
const print = Effect.fnUntraced(function* (ran: Ran) {
  const stdio = yield* Stdio.Stdio;
  const ended = ran.code === 0 ? "passed" : `failed, exit ${ran.code}`;
  yield* Console.log(`\n> ${ran.command} (${ended}, ${seconds(ran.took)})`);

  for (const piece of ran.output) {
    yield* Stream.make(piece.bytes).pipe(Stream.run(piece.to === "stdout" ? stdio.stdout() : stdio.stderr()));
  }
});

/** Starts every part now, then prints each whole, in the order given, once it has ended. */
const all = Effect.fnUntraced(function* (commands: ReadonlyArray<string>) {
  // Serial on purpose: a fork returns at once, and each part must be a child of this fiber. Forked
  // from a fiber of their own, as `"unbounded"` makes them, they were interrupted as it ended.
  const fibers = yield* Effect.forEach(commands, (command) => Effect.forkChild(run(command)), { concurrency: 1 });
  // Serial on purpose too: joining in order is what keeps the output in the order given.
  return yield* Effect.forEach(fibers, (fiber) => Fiber.join(fiber).pipe(Effect.tap(print)), { concurrency: 1 });
});

/** Runs the parts at once and fails with the ones that did not exit 0. */
const parallel = Effect.fnUntraced(function* (commands: ReadonlyArray<string>) {
  const [took, ran] = yield* Effect.timed(all(commands));
  const failed = ran.filter((part) => part.code !== 0).map((part) => part.command);

  if (failed.length === 0) {
    return yield* Console.log(`\nparallel: ${ran.length} parts passed in ${seconds(took)}`);
  }

  yield* Console.error(
    `\nparallel: ${failed.length} of ${ran.length} parts failed in ${seconds(took)}:\n${failed.map((command) => `  ${command}`).join("\n")}`,
  );
  return yield* new Failed({ parts: failed });
});

if (import.meta.main) {
  const main = Effect.gen(function* () {
    yield* parallel(yield* (yield* Stdio.Stdio).args);
  });
  // The run prints its own failure above, so the runtime only sets the exit code.
  NodeRuntime.runMain(main.pipe(Effect.provide(NodeServices.layer)), { disableErrorReporting: true });
}
