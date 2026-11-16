import * as Clock from "effect/Clock";
import * as Effect from "effect/Effect";
import * as Match from "effect/Match";
import * as Option from "effect/Option";
import * as ChildProcess from "effect/process/ChildProcess";
import type * as ChildProcessSpawner from "effect/process/ChildProcessSpawner";
import * as Stream from "effect/Stream";
import { Result } from "../../../tasks/Task.ts";

/** What one child has printed so far: its stdout's chunks in order, and each stream's byte count. */
type Printed = { readonly out: ReadonlyArray<Uint8Array>; readonly outBytes: number; readonly errBytes: number };

const nothing: Printed = { out: [], outBytes: 0, errBytes: 0 };

type Chunk = { readonly out: boolean; readonly bytes: Uint8Array };

const add = (printed: Printed, chunk: Chunk): Printed =>
  chunk.out
    ? { ...printed, out: [...printed.out, chunk.bytes], outBytes: printed.outBytes + chunk.bytes.length }
    : { ...printed, errBytes: printed.errBytes + chunk.bytes.length };

const joined = (chunks: ReadonlyArray<Uint8Array>): Uint8Array => {
  const out = new Uint8Array(chunks.reduce((n, c) => n + c.length, 0));
  chunks.reduce((at, c) => {
    out.set(c, at);

    return at + c.length;
  }, 0);

  return out;
};

const utf8 = new TextDecoder("utf-8", { fatal: true });

/** stdout as UTF-8 with one trailing newline dropped, or "" when it is not UTF-8. */
const version = (chunks: ReadonlyArray<Uint8Array>) =>
  Effect.try(() => utf8.decode(joined(chunks))).pipe(
    Effect.map((text) => (text.endsWith("\n") ? text.slice(0, -1) : text)),
    Effect.orElseSucceed(() => ""),
  );

/**
 * Runs one child in a scope of its own and answers its result, never an error.
 *
 * **Details**
 *
 * The child gets `env` and nothing else of this process's environment. Once stdout and stderr
 * together pass `cap` bytes, the scope closes, which stops the child, and the answer is `failed
 * output_limit`. A child that cannot be run, or whose output or exit cannot be read, is `failed
 * spawn_failed`. A child that exits is `exited` with its code and its stdout as text. stderr's
 * text is never kept; the current span gets the byte counts, whether the cap stopped it and how
 * long it took.
 *
 * @internal
 */
export const capped = Effect.fnUntraced(function* (
  spawner: ChildProcessSpawner.ChildProcessSpawner["Service"],
  argv: readonly [string, ReadonlyArray<string>],
  env: Readonly<Record<string, string>>,
  cap: number,
) {
  const started = yield* Clock.currentTimeMillis;
  const over = (printed: Printed) => printed.outBytes + printed.errBytes > cap;

  const ran = yield* Effect.scoped(
    Effect.gen(function* () {
      const handle = yield* spawner.spawn(
        // A child that ignores the stop signal is killed outright two seconds later.
        ChildProcess.make(argv[0], [...argv[1]], { env: { ...env }, extendEnv: false, forceKillAfter: "2 seconds" }),
      );

      const last = yield* Stream.merge(
        handle.stdout.pipe(Stream.map((bytes): Chunk => ({ out: true, bytes }))),
        handle.stderr.pipe(Stream.map((bytes): Chunk => ({ out: false, bytes }))),
      ).pipe(
        Stream.scan(() => nothing, add),
        Stream.takeUntil(over),
        Stream.runLast,
      );

      const printed = Option.getOrElse(last, () => nothing);

      if (over(printed)) {
        return { printed, result: Result.cases.failed.make({ reason: "output_limit" }) };
      }

      const code = yield* handle.exitCode;

      return { printed, result: Result.cases.exited.make({ code, version: yield* version(printed.out) }) };
    }),
  ).pipe(
    Effect.orElseSucceed(() => ({ printed: nothing, result: Result.cases.failed.make({ reason: "spawn_failed" }) })),
  );

  const ended = yield* Clock.currentTimeMillis;
  yield* Effect.annotateCurrentSpan({
    exit: Match.valueTags(ran.result, { exited: ({ code }) => code, failed: ({ reason }) => reason }),
    stdout_bytes: ran.printed.outBytes,
    stderr_bytes: ran.printed.errBytes,
    capped: over(ran.printed),
    duration_ms: ended - started,
  });

  return ran.result;
});
