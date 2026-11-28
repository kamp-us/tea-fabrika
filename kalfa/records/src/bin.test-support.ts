// What the real-process laws of the `records` bin share (bin.integration.test.ts): a small git repo written to a temp folder,
// one function that runs `node bin.ts` in it and reads standard output, standard error and the exit code, one that runs it
// where the reader of standard output closes after a line, and the in-memory command that says what standard output must hold.
// It follows kalfa/cli/src/bin.test-support.ts, copied and not imported: that file is another package's test support.
import type { Duration } from "effect";
import { Effect, FileSystem, Layer, Path, Stream } from "effect";
import { Command } from "effect/cli";
import { ChildProcess, ChildProcessSpawner } from "effect/process";
import { TestConsole } from "effect/testing";
import { records } from "./cli.ts";
import { cliLayers } from "./Records.test-support.ts";

/** The bin under test: the one next to this file. */
const BIN = Effect.gen(function* () {
  const path = yield* Path.Path;

  return path.resolve(import.meta.dirname, "bin.ts");
});

/** Writes a git repo of these files to a temp folder, tracked (`git add -A`, no commit), and answers its folder. */
export const makeRepo = (files: Readonly<Record<string, string>>) =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;
    const spawner = yield* ChildProcessSpawner.ChildProcessSpawner;
    const folder = yield* fs.makeTempDirectoryScoped({ prefix: "kalfa-records-bin-" });

    for (const [name, text] of Object.entries(files)) {
      yield* fs.makeDirectory(path.dirname(path.join(folder, name)), { recursive: true });
      yield* fs.writeFileString(path.join(folder, name), text);
    }

    for (const args of [
      ["init", "--quiet"],
      ["add", "-A"],
    ]) {
      const code = yield* spawner.exitCode(ChildProcess.make("git", args, { cwd: folder }));

      if (code !== 0) {
        return yield* Effect.die(`git ${args.join(" ")} ended ${code}`);
      }
    }

    return folder;
  });

/** What one run of the real bin did. */
interface Outcome {
  readonly code: number;
  readonly stdout: string;
  readonly stderr: string;
}

/** Reads a stream whole, as text; a slow reader reads nothing for `delay` first, so the process meets its exit with its output unread. */
const readAll = (stream: Stream.Stream<Uint8Array, unknown>, delay: Duration.Input | undefined) =>
  Effect.andThen(
    delay === undefined ? Effect.void : Effect.sleep(delay),
    stream.pipe(
      Stream.decodeText(),
      Stream.runFold(
        () => "",
        (text, part) => text + part,
      ),
    ),
  );

/** Runs a command and reads every byte of both streams and the exit code. */
const spawnRead = (command: ChildProcess.Command, delay?: Duration.Input) =>
  Effect.gen(function* () {
    const spawner = yield* ChildProcessSpawner.ChildProcessSpawner;
    const handle = yield* spawner.spawn(command);

    const [stdout, stderr, code] = yield* Effect.all(
      [readAll(handle.stdout, delay), readAll(handle.stderr, delay), handle.exitCode],
      { concurrency: "unbounded" },
    );

    return { code, stdout, stderr } satisfies Outcome;
  }).pipe(Effect.scoped);

/** The environment the bin runs in: this one, without the settings that would change how Node starts. */
const environment = { NODE_PATH: undefined, NODE_OPTIONS: undefined } as const;

/** Runs `node bin.ts <args>` in a folder and reads every byte of both streams and the exit code; a slow reader starts `delay` late. */
export const bin = (folder: string, args: ReadonlyArray<string>, delay?: Duration.Input) =>
  Effect.gen(function* () {
    const script = yield* BIN;

    return yield* spawnRead(
      ChildProcess.make(process.execPath, [script, ...args], { cwd: folder, extendEnv: true, env: environment }),
      delay,
    );
  });

/** What a run did when the reader of standard output closed before it wrote everything. */
interface Closed {
  /** The exit code of the bin itself, not the shell's. */
  readonly code: number;
  /** What the bin wrote to standard error. */
  readonly kept: string;
}

// `head -n 1` reads one line and ends, so the read end of the pipe is closed while the bin still has things to write: the way
// `check runbook | head -n 1` runs. The subshell keeps the bin's exit code in a file, since a pipeline's own code is its last
// command's, and its standard error in another.
const CLOSED = '("$@" 2>"$KEPT"; echo $? >"$CODE") | head -n 1 >/dev/null';

/** Runs `node bin.ts <args>` where the reader of standard output goes after one line. */
export const closedPipe = (folder: string, args: ReadonlyArray<string>) =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;
    const script = yield* BIN;
    const notes = yield* fs.makeTempDirectoryScoped({ prefix: "kalfa-records-pipe-" });
    const code = path.join(notes, "code");
    const kept = path.join(notes, "kept");

    yield* spawnRead(
      ChildProcess.make("sh", ["-c", CLOSED, "sh", process.execPath, script, ...args], {
        cwd: folder,
        extendEnv: true,
        env: { ...environment, CODE: code, KEPT: kept },
      }),
    );

    return {
      code: Number((yield* fs.readFileString(code)).trim()),
      kept: yield* fs.readFileString(kept),
    } satisfies Closed;
  });

/** A sev skill that links `count` sev runbooks that are not there: each link is one `dangling` finding of `check runbook`. */
export const dangling = (count: number): Readonly<Record<string, string>> => ({
  ".agents/skills/sev/SKILL.md": [
    "# The sev skill",
    "",
    ...Array.from({ length: count }, (_, index) => `- [runbook ${index}](../../../.kalfa/runbooks/sev-${index}.md)`),
    "",
  ].join("\n"),
});

/**
 * The text the `records` command prints on standard output for these files, run in memory with no process: one line per
 * `Console.log`, as the bin writes it.
 */
export const printed = (args: ReadonlyArray<string>, files: Readonly<Record<string, string>>) =>
  Effect.gen(function* () {
    const path = yield* Path.Path;

    yield* Effect.exit(
      Command.runWith(records, { version: "0.0.0" })(args).pipe(Effect.provide(cliLayers(path.resolve(), files))),
    );

    return (yield* TestConsole.logLines).map((line) => `${String(line)}\n`).join("");
  }).pipe(Effect.provide(Path.layer), Effect.provide(Layer.fresh(TestConsole.layer)));
