// What the real-process laws of the `kalfa` command share (bin.integration.test.ts): a small repo written to a temp folder,
// with the installed packages it names, and one function that runs `node bin.ts` in it and reads standard output, standard
// error and the exit code. The repo's `node_modules` holds links to this workspace's own folders, so the fixture imports
// the source, and one copy of Effect is shared by the command and the subcommand, as an install gives it.
import type { Duration } from "effect";
import { Effect, FileSystem, Path, Stream } from "effect";
import { ChildProcess, ChildProcessSpawner } from "effect/process";

/** The subcommand the fixture package `@demo/leak` exports, as a plain module an installed package would ship. */
const LEAK = `
import * as Subcommand from "@kalfa/cli/Subcommand";
import * as Diagnostic from "@kalfa/diagnostics/Diagnostic";
import * as Diagnostics from "@kalfa/diagnostics/Diagnostics";
import { Console, Effect, Layer } from "effect";
import { Argument, Command } from "effect/cli";

export const KeyShape = Diagnostic.make("leak/key-shape", { explain: "A line has the shape of a private key." });

const check = Command.make("check", {}, () =>
  Effect.gen(function* () {
    yield* Console.log("checked 2 files");
    yield* Diagnostics.report(KeyShape, {
      severity: "error",
      message: "A line has the shape of a private key.",
      place: Diagnostic.Place.cases.repo.make({ path: "docs/setup.md", line: 12 }),
      hint: "Remove the key and rotate it.",
    });
  }),
);

// Writes \`lines\` lines of fixed text with \`write\`, then ends as the second argument says.
const flooding = (write) => ({ lines, end }) =>
  Effect.gen(function* () {
    for (let index = 0; index < lines; index++) {
      yield* write(\`\${"x".repeat(60)} \${index}\`);
    }

    if (end === "fail") {
      return yield* Effect.fail({ _tag: "Stopped", message: "the flood stopped" });
    }

    yield* Diagnostics.report(KeyShape, {
      severity: "error",
      message: "A line has the shape of a private key.",
      place: Diagnostic.Place.cases.repo.make({ path: "docs/setup.md" }),
      hint: "Remove the key and rotate it.",
    });
  });

const flooded = { lines: Argument.Int("lines"), end: Argument.String("end") };

const flood = Command.make("flood", flooded, flooding(Console.log));

// The same, on standard error.
const floodErr = Command.make("flood-err", flooded, flooding(Console.error));

// A run that writes one line to standard error and still ends 0: a warning is not a failure.
const warn = Command.make("warn", {}, () =>
  Diagnostics.report(KeyShape, {
    severity: "warning",
    message: "A line has the shape of a private key.",
    place: Diagnostic.Place.cases.repo.make({ path: "docs/setup.md", line: 3 }),
    hint: "Remove the key and rotate it.",
  }),
);

// Says it is ready, then waits to be stopped.
const hold = Command.make("hold", {}, () => Effect.andThen(Console.log("ready"), Effect.never));

export const subcommand = Subcommand.make(Command.make("leak").pipe(Command.withSubcommands([check, flood, floodErr, warn, hold])), {
  layer: Layer.empty,
  diagnostics: [KeyShape],
});
`;

/** What a package of the fixture is: its manifest, and its files. */
interface Installed {
  readonly manifest: Record<string, unknown>;
  readonly files: Readonly<Record<string, string>>;
}

/** The packages installed in the fixture, by name. */
const PACKAGES = {
  leak: {
    manifest: {
      name: "@demo/leak",
      version: "1.0.0",
      type: "module",
      kalfa: { cli: "./cli" },
      exports: { "./cli": "./cli.js" },
    },
    files: { "cli.js": LEAK },
  },
  // Exports no `./package.json`, and has no `kalfa` field: it is found and skipped.
  leftPad: {
    manifest: { name: "left-pad", version: "1.3.0", type: "module", exports: { ".": "./index.js" } },
    files: { "index.js": "export default (text) => text;\n" },
  },
  // Its `./cli` is exported under an `import` condition only, so Node's resolve refuses it.
  importOnly: {
    manifest: {
      name: "@demo/mod",
      version: "1.0.0",
      type: "module",
      kalfa: { cli: "./cli" },
      exports: { "./cli": { import: "./cli.js" } },
    },
    files: { "cli.js": "export const subcommand = undefined;\n" },
  },
} satisfies Record<string, Installed>;

/** Where this package and its neighbors are, as the repo's own folders. */
const workspace = Effect.gen(function* () {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const cli = path.resolve(import.meta.dirname, "..");
  const effect = yield* fs.realPath(path.join(cli, "node_modules", "effect"));

  return { cli, diagnostics: path.resolve(cli, "..", "diagnostics"), effect, bin: path.join(cli, "src", "bin.ts") };
});

/** The packages the fixture can install. */
type Installable = keyof typeof PACKAGES;

/** Writes a repo whose root manifest lists these packages as dev dependencies, and installs each; answers its folder. */
export const makeRepo = (installed: ReadonlyArray<Installable>) =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;
    const located = yield* workspace;
    const folder = yield* fs.makeTempDirectoryScoped({ prefix: "kalfa-bin-" });
    const modules = path.join(folder, "node_modules");

    yield* fs.makeDirectory(path.join(modules, "@kalfa"), { recursive: true });
    yield* fs.symlink(located.effect, path.join(modules, "effect"));
    yield* fs.symlink(located.cli, path.join(modules, "@kalfa", "cli"));
    yield* fs.symlink(located.diagnostics, path.join(modules, "@kalfa", "diagnostics"));

    const packages = installed.map((key) => PACKAGES[key]);

    for (const { manifest, files } of packages) {
      const home = path.join(modules, String(manifest.name));

      yield* fs.makeDirectory(home, { recursive: true });
      yield* fs.writeFileString(path.join(home, "package.json"), JSON.stringify(manifest));

      for (const [name, text] of Object.entries(files)) {
        yield* fs.writeFileString(path.join(home, name), text);
      }
    }

    yield* fs.writeFileString(
      path.join(folder, "package.json"),
      JSON.stringify({
        name: "demo-repo",
        devDependencies: Object.fromEntries(
          packages.map(({ manifest }) => [String(manifest.name), String(manifest.version)]),
        ),
      }),
    );

    return folder;
  });

/** What one run of the real command did. */
interface Outcome {
  readonly code: number;
  readonly stdout: string;
  readonly stderr: string;
}

/** Reads a stream whole, as text, waiting `pause` after each part when a reader is slow. */
const readAll = (stream: Stream.Stream<Uint8Array, unknown>, pause: Duration.Input | undefined) =>
  stream.pipe(
    Stream.decodeText(),
    Stream.tap(() => (pause === undefined ? Effect.void : Effect.sleep(pause))),
    Stream.runFold(
      () => "",
      (text, part) => text + part,
    ),
  );

/** Runs a command and reads every byte of both streams and the exit code. */
const spawnRead = (command: ChildProcess.Command, pause?: Duration.Input) =>
  Effect.gen(function* () {
    const spawner = yield* ChildProcessSpawner.ChildProcessSpawner;
    const handle = yield* spawner.spawn(command);

    const [stdout, stderr, code] = yield* Effect.all(
      [readAll(handle.stdout, pause), readAll(handle.stderr, pause), handle.exitCode],
      { concurrency: "unbounded" },
    );

    return { code, stdout, stderr } satisfies Outcome;
  }).pipe(Effect.scoped);

/** `node bin.ts <args>` in a folder, with the environment the fixture wants. */
const node = (folder: string, args: ReadonlyArray<string>, bin: string) =>
  ChildProcess.make(process.execPath, [bin, ...args], {
    cwd: folder,
    extendEnv: true,
    env: { NODE_PATH: undefined, NODE_OPTIONS: undefined },
  });

/** Runs `node bin.ts <args>` in a folder and reads every byte of both streams and the exit code; a slow reader waits `pause` after each part. */
export const kalfa = (folder: string, args: ReadonlyArray<string>, pause?: Duration.Input) =>
  Effect.gen(function* () {
    const located = yield* workspace;

    return yield* spawnRead(node(folder, args, located.bin), pause);
  });

/** What a run did when the reader of one stream closed before it wrote. */
interface Closed {
  /** The exit code of `kalfa` itself, not the shell's. */
  readonly code: number;
  /** What `kalfa` wrote to the stream whose reader stayed. */
  readonly kept: string;
}

// `head -n 1` reads one line and ends, so the read end of the pipe is closed while `kalfa` still has things to write: the way
// `kalfa --help | head -n 1` runs. The subshell keeps the exit code of `kalfa` in a file, since a pipeline's own code is its
// last command's. In `stdout` the subshell's standard error goes to a file; in `stderr` its standard error goes down the pipe,
// and its standard output goes to the file.
const CLOSED = {
  stdout: '("$@" 2>"$KEPT"; echo $? >"$CODE") | head -n 1 >/dev/null',
  stderr: '("$@" 2>&1 >"$KEPT"; echo $? >"$CODE") | head -n 1 >/dev/null',
} as const;

/** Runs `node bin.ts <args>` where the reader of `closed` goes after one line: the way `kalfa --help | head -n 1` runs it. */
export const closedPipe = (folder: string, args: ReadonlyArray<string>, closed: keyof typeof CLOSED) =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;
    const located = yield* workspace;
    const notes = yield* fs.makeTempDirectoryScoped({ prefix: "kalfa-pipe-" });
    const code = path.join(notes, "code");
    const kept = path.join(notes, "kept");

    yield* spawnRead(
      ChildProcess.make("sh", ["-c", CLOSED[closed], "sh", process.execPath, located.bin, ...args], {
        cwd: folder,
        extendEnv: true,
        env: { CODE: code, KEPT: kept, NODE_PATH: undefined, NODE_OPTIONS: undefined },
      }),
    );

    return {
      code: Number((yield* fs.readFileString(code)).trim()),
      kept: yield* fs.readFileString(kept),
    } satisfies Closed;
  });

/** What a run did that was stopped by a signal. */
interface Stopped {
  readonly ready: string;
  readonly stderr: string;
  readonly code: number;
}

/** Starts `leak hold`, waits until it says it is ready, sends it a signal, and reads what is left of its streams and its exit code. */
export const stopped = (folder: string, signal: "SIGINT" | "SIGTERM") =>
  Effect.gen(function* () {
    const spawner = yield* ChildProcessSpawner.ChildProcessSpawner;
    const located = yield* workspace;
    const handle = yield* spawner.spawn(node(folder, ["leak", "hold"], located.bin));

    const first = yield* handle.stdout.pipe(Stream.decodeText(), Stream.splitLines, Stream.take(1), Stream.runCollect);

    yield* handle.kill({ killSignal: signal });

    const [stderr, code] = yield* Effect.all([readAll(handle.stderr, undefined), handle.exitCode], {
      concurrency: "unbounded",
    });

    return { ready: first.join(""), stderr, code } satisfies Stopped;
  }).pipe(Effect.scoped);

/** The text `flood` writes for a count of lines: what a reader of the pipe must get back, every byte. */
export const flooded = (lines: number): string =>
  Array.from({ length: lines }, (_, index) => `${"x".repeat(60)} ${index}\n`).join("");
