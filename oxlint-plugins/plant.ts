// Lints planted files the way `pnpm lint` does, for the rules' own tests in this folder. The files go into a
// fresh folder that holds the repo's own `.oxlintrc.json` and its plugin folder, at the paths they are
// given (`next/packages/tuval/src/window/use-model.ts`), so the rules' own edge paths and the config's
// `next/**` globs meet them as they would meet the real file. Nothing is written inside the repo.
import { NodeServices } from "@effect/platform-node";
import { Array as Arr, Record as Rec, Effect, FileSystem, Path, Schema, Stream } from "effect";
import { ChildProcess } from "effect/process";

/** One fire: the rule's code, as oxlint prints it (`fabrika(no-of)`), where, and what it says. */
interface Fire {
  readonly code: string;
  readonly file: string;
  readonly line: number;
  readonly message: string;
}

const Report = Schema.Struct({
  number_of_files: Schema.Finite,
  diagnostics: Schema.Array(
    Schema.Struct({
      code: Schema.optional(Schema.String),
      filename: Schema.String,
      message: Schema.String,
      labels: Schema.optional(Schema.Array(Schema.Struct({ span: Schema.Struct({ line: Schema.Finite }) }))),
    }),
  ),
});

const readReport = Schema.decodeUnknownSync(Schema.fromJsonString(Report));

type Files = Readonly<Record<string, string>>;

type Fires<A> = (code: string, file: string) => readonly A[];

/**
 * Lints the planted files, keyed by path from the top of the repo, and answers the lines one rule
 * (`fabrika(no-of)`) fires on in one of them, in order. Given `show`, it answers each fire as `show`
 * gives it, for a law that also reads what a fire says.
 */
export function plant(files: Files): Promise<Fires<number>>;
export function plant<A>(files: Files, show: (fire: Fire) => A): Promise<Fires<A>>;
export function plant<A>(files: Files, show: (fire: Fire) => A | number = (f) => f.line): Promise<Fires<A | number>> {
  return Effect.runPromise(
    lint(files).pipe(
      Effect.map(
        (all) => (code: string, file: string) =>
          Arr.map(
            Arr.filter(all, (f) => f.code === code && f.file === file).sort((a, b) => a.line - b.line),
            show,
          ),
      ),
      Effect.provide(NodeServices.layer),
    ),
  );
}

const lint = Effect.fnUntraced(function* (files: Readonly<Record<string, string>>) {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const ROOT = path.resolve(import.meta.dirname, "..");
  // The real path: on a Mac the temp folder is behind a link, and oxlint matches globs on the real one.
  const at = yield* fs.realPath(yield* fs.makeTempDirectoryScoped({ prefix: "exam-" }));
  yield* fs.copyFile(path.join(ROOT, ".oxlintrc.json"), path.join(at, ".oxlintrc.json"));
  yield* fs.symlink(path.join(ROOT, "oxlint-plugins"), path.join(at, "oxlint-plugins"));
  // The config loads the vendored anti-slop plugins from here (0563).
  yield* fs.symlink(path.join(ROOT, "vendor"), path.join(at, "vendor"));

  for (const [file, text] of Rec.toEntries(files)) {
    const full = path.join(at, file);
    yield* fs.makeDirectory(path.dirname(full), { recursive: true });
    yield* fs.writeFileString(full, text);
  }

  // A planted file oxlint does not lint (a `package.json` a rule reads) is written and not passed.
  const linted = Arr.filter(Rec.keys(files), (file) => /\.[cm]?[jt]sx?$/.test(file));

  const ran = yield* ChildProcess.make(
    path.join(ROOT, "node_modules", ".bin", "oxlint"),
    [
      `--config=${path.join(at, ".oxlintrc.json")}`,
      "--disable-nested-config",
      "--no-ignore",
      "--format=json",
      ...linted,
    ],
    { cwd: at },
  );

  const [out, err] = yield* Effect.all(
    [
      ran.stdout.pipe(Stream.decodeText(), Stream.mkString),
      ran.stderr.pipe(Stream.decodeText(), Stream.mkString),
      ran.exitCode,
    ],
    { concurrency: 3 },
  );

  const report = readReport(out);

  if (report.number_of_files !== linted.length) {
    return yield* Effect.die(new Error(`oxlint read ${report.number_of_files} files: ${err}`));
  }

  return Arr.map(report.diagnostics, (d): Fire => ({
    code: d.code ?? "",
    file: d.filename,
    line: d.labels?.[0]?.span.line ?? 0,
    message: d.message,
  }));
}, Effect.scoped);
