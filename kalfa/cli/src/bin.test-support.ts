// What the real-process laws of the `kalfa` command share (bin.integration.test.ts): a small repo written to a temp folder,
// with the installed packages it names, and one function that runs `node bin.ts` in it and reads standard output, standard
// error and the exit code. The repo's `node_modules` holds links to this workspace's own folders, so the fixture imports
// the source, and one copy of Effect is shared by the command and the subcommand, as an install gives it.
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

// Writes \`lines\` lines of fixed text to standard output, then ends as the second argument says.
const flood = Command.make("flood", { lines: Argument.Int("lines"), end: Argument.String("end") }, ({ lines, end }) =>
  Effect.gen(function* () {
    for (let index = 0; index < lines; index++) {
      yield* Console.log(\`\${"x".repeat(60)} \${index}\`);
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
  }),
);

export const subcommand = Subcommand.make(Command.make("leak").pipe(Command.withSubcommands([check, flood])), {
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

/** Runs `node bin.ts <args>` in a folder and reads every byte of both streams and the exit code. */
export const kalfa = (folder: string, args: ReadonlyArray<string>) =>
  Effect.gen(function* () {
    const spawner = yield* ChildProcessSpawner.ChildProcessSpawner;
    const located = yield* workspace;

    const handle = yield* spawner.spawn(
      ChildProcess.make(process.execPath, [located.bin, ...args], {
        cwd: folder,
        extendEnv: true,
        env: { NODE_PATH: undefined, NODE_OPTIONS: undefined },
      }),
    );

    const read = (stream: Stream.Stream<Uint8Array, unknown>) =>
      stream.pipe(
        Stream.decodeText(),
        Stream.runFold(
          () => "",
          (text, part) => text + part,
        ),
      );

    const [stdout, stderr, code] = yield* Effect.all([read(handle.stdout), read(handle.stderr), handle.exitCode], {
      concurrency: "unbounded",
    });

    return { code, stdout, stderr } satisfies Outcome;
  }).pipe(Effect.scoped);

/** The text `flood` writes for a count of lines: what a reader of the pipe must get back, every byte. */
export const flooded = (lines: number): string =>
  Array.from({ length: lines }, (_, index) => `${"x".repeat(60)} ${index}\n`).join("");
