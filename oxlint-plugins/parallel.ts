// `pnpm lint`: its parts at once, so the slowest part sets the time and not their sum
// (experiment 293: 78 to 117 s one after another in CI, about 55 s for `lint:dead` alone).
//
//   node oxlint-plugins/parallel.ts '<command>' '<command>' ...
//
// Each argument is one part, a shell command run with `sh -c`. Every part runs to its end, even
// once another has failed, so one run names every failure. A part's output is held until it ends
// and is printed whole, in the order the parts were given, so two parts' lines never mix. The run
// exits 1 when any part did not exit 0, and names those parts last, each with its last line.
//
// Two parts that write the same file must never run at once: they go in one argument joined by
// `&&`, so the shell runs them one after the other. Today no two do. A part that writes, writes a
// file of its own, and only when it prunes: `oxlint-plugins/lint.ts` its two ledgers, `lint:dead`
// `unreachable-ledger.json`, `lint:boundaries` `boundary-ledger.json` (when that file exists). And
// no part reads a file another writes: the format check leaves those ledgers out by name
// (`.oxfmtrc.json`).
import { constants } from "node:os";
import { NodeRuntime, NodeServices } from "@effect/platform-node";
import { Console, Duration, Effect, Fiber, Result, Schema, Stdio, Stream } from "effect";
import { ChildProcess } from "effect/process";
import * as Rec from "effect/Record";

/** A piece of a part's output, and the stream it went to. */
type Piece = { readonly to: "stdout" | "stderr"; readonly bytes: Uint8Array };

/**
 * How a part ended: with an exit code; killed by a signal, its code 128 + n as a shell gives it;
 * unable to start; or with no exit code to read. Only `exited` with code 0 passes.
 */
type End =
  | { readonly _tag: "exited"; readonly code: number }
  | { readonly _tag: "killed"; readonly signal: string; readonly code: number }
  | { readonly _tag: "unstarted"; readonly reason: string }
  | { readonly _tag: "unread"; readonly reason: string };

/** What one part left: its command, its output in the order it came, how it ended and its time. */
type Ran = {
  readonly command: string;
  readonly output: ReadonlyArray<Piece>;
  readonly end: End;
  readonly took: Duration.Duration;
};

/** The run's one failure: the parts that did not exit 0, in the order they were given. */
class Failed extends Schema.TaggedError<Failed>()("Failed", { parts: Schema.Array(Schema.String) }) {}

const passed = (end: End) => end._tag === "exited" && end.code === 0;

/** A shell's exit code over 128 is 128 + the number of the signal that killed what it ran. */
const ended = (code: number): End => {
  const signal = Rec.toEntries(constants.signals).find(([, n]) => code > 128 && n === code - 128)?.[0];
  return signal === undefined ? { _tag: "exited", code } : { _tag: "killed", signal, code };
};

/** How a part ended, in the words its header and the summary print. */
const said = (end: End): string => {
  switch (end._tag) {
    case "exited":
      return end.code === 0 ? "passed" : `failed, exit ${end.code}`;
    case "killed":
      return `failed, killed by ${end.signal}, exit ${end.code}`;
    case "unstarted":
      return `could not start: ${end.reason}`;
    case "unread":
      return `failed, no exit code: ${end.reason}`;
  }
};

// `sh -c` runs a part's last command in its own place, so a signal that kills that command kills
// the very process this file waits on, and Node then gives no exit code at all. So an outer shell
// runs the part with `sh -c`, waits for it, and exits as shells do: 128 + n for signal n.
const WAITED = 'sh -c "$1"; exit $?';

const tagged = (to: Piece["to"]) => Stream.map((bytes: Uint8Array): Piece => ({ to, bytes }));

/**
 * Runs one part to its end. Its output is kept however it ends: an exit code that cannot be read
 * drops nothing the part wrote. Only a spawn that fails is a part that could not start.
 */
const run = (command: string) =>
  Effect.gen(function* () {
    const handle = yield* ChildProcess.make("sh", ["-c", WAITED, "sh", command], { stdin: "ignore" }).pipe(
      Effect.mapError((error): End => ({ _tag: "unstarted", reason: error.message })),
    );
    const [output, code] = yield* Effect.all(
      [
        Stream.runCollect(
          Stream.merge(handle.stdout.pipe(tagged("stdout")), handle.stderr.pipe(tagged("stderr"))),
        ).pipe(Effect.mapError((error): End => ({ _tag: "unread", reason: `output unread: ${error.message}` }))),
        // A result, never a failure: a failure here would interrupt the output beside it.
        Effect.result(handle.exitCode),
      ],
      { concurrency: "unbounded" },
    );
    const end = Result.match(code, {
      onSuccess: (exited) => ended(Number(exited)),
      onFailure: (error): End => ({ _tag: "unread", reason: error.message }),
    });
    return { output, end };
  }).pipe(
    Effect.scoped,
    Effect.catch((end) => Effect.succeed({ output: [], end })),
    Effect.timed,
    Effect.map(([took, ran]): Ran => ({ command, ...ran, took })),
  );

const seconds = (took: Duration.Duration) => `${(Duration.toMillis(took) / 1000).toFixed(1)} s`;

/** Prints one part whole: a line naming it and how it ended, then its output as it came. */
const print = Effect.fnUntraced(function* (ran: Ran) {
  const stdio = yield* Stdio.Stdio;
  yield* Console.log(`\n> ${ran.command} (${said(ran.end)}, ${seconds(ran.took)})`);

  for (const piece of ran.output) {
    yield* Stream.make(piece.bytes).pipe(Stream.run(piece.to === "stdout" ? stdio.stdout() : stdio.stderr()));
  }
});

/** A part's last line that is not empty, from stderr when it wrote any there, else from stdout. */
const lastLine = (output: ReadonlyArray<Piece>): string | undefined => {
  const last = (to: Piece["to"]) =>
    Buffer.concat(output.filter((piece) => piece.to === to).map((piece) => piece.bytes))
      .toString("utf8")
      .split("\n")
      .findLast((line) => line.trim() !== "");
  return last("stderr") ?? last("stdout");
};

/** A failed part as the summary names it, with its last line, the one a failure reason shows. */
const named = (ran: Ran): string => {
  const line = lastLine(ran.output);
  return `  ${ran.command} (${said(ran.end)})${line === undefined ? "" : `\n    ${line}`}`;
};

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
  const failed = ran.filter((part) => !passed(part.end));

  if (failed.length === 0) {
    return yield* Console.log(`\nparallel: ${ran.length} parts passed in ${seconds(took)}`);
  }

  yield* Console.error(
    `\nparallel: ${failed.length} of ${ran.length} parts failed in ${seconds(took)}:\n${failed.map(named).join("\n")}`,
  );
  return yield* new Failed({ parts: failed.map((part) => part.command) });
});

if (import.meta.main) {
  const main = Effect.gen(function* () {
    yield* parallel(yield* (yield* Stdio.Stdio).args);
  });
  // The run prints its own failure above, so the runtime only sets the exit code.
  NodeRuntime.runMain(main.pipe(Effect.provide(NodeServices.layer)), { disableErrorReporting: true });
}
