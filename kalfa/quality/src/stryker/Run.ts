// `@kalfa/quality/stryker/Run`: run one plant, or survey the mutants on some lines (decision 0600).
//
// A plant runs only once its target is certain: the file is read, Stryker's instrumenter makes every
// mutant on it, and the shape must match exactly one (`Target.find`). Every refusal is before Stryker
// is asked to run, so a plant that cannot be certain costs no run.
import { Duration, Effect, FileSystem, Path } from "effect";
import type { Scope } from "effect";
import { Mutants } from "./Mutants.ts";
import * as Options from "./Options.ts";
import type { Plant } from "./Plant.ts";
import { Refused, rows, record } from "./Report.ts";
import type { Line, Row } from "./Report.ts";
import type { Settings } from "./Settings.ts";
import * as Target from "./Target.ts";

type Needs = FileSystem.FileSystem | Path.Path | Mutants | Scope.Scope;

// The Node version of this process, for the record line.
const NODE = globalThis.process.version;

const stuck = () => new Refused({ reason: "could_not_run", at: [] });

/** The folder of the nearest `package.json` at or above `file`'s folder, or `root` when none is nearer. */
const packageOf = (root: string, file: string): Effect.Effect<string, Refused, FileSystem.FileSystem | Path.Path> =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;

    const up = (dir: string): Effect.Effect<string, Refused> =>
      dir === root || path.dirname(dir) === dir
        ? Effect.succeed(root)
        : fs.exists(path.join(dir, "package.json")).pipe(
            Effect.mapError(stuck),
            Effect.flatMap((there) => (there ? Effect.succeed(dir) : up(path.dirname(dir)))),
          );

    return yield* up(path.dirname(path.join(root, file)));
  });

/**
 * Stryker copies the repo into a sandbox and links each `node_modules` back to the checkout, so a law
 * that reaches its target through a workspace package link reads the unmutated file. When the target
 * and the law sit in different packages, the run needs `inPlace` (ticket 457), and is refused without it.
 */
const checkPackages = (settings: Settings, root: string, file: string, law: string) =>
  Effect.gen(function* () {
    const [target, tests] = yield* Effect.all([packageOf(root, file), packageOf(root, law)], { concurrency: 1 });

    if (target !== tests && !settings.inPlace) {
      return yield* new Refused({ reason: "needs_in_place", at: [] });
    }
  });

/** Stryker on `options`, timed, with its report read. */
const ran = Effect.fnUntraced(function* (options: Options.Options) {
  const mutants = yield* Mutants;
  const [took, report] = yield* Effect.timed(mutants.run(options));

  return { report, seconds: Duration.toSeconds(took) };
});

/** A scoped temp folder for the run's own files: its report, its sandbox, its config. */
const tempDir = Effect.gen(function* () {
  const fs = yield* FileSystem.FileSystem;
  const dir = yield* fs.makeTempDirectoryScoped({ prefix: "quality-" });

  return yield* fs.realPath(dir);
}).pipe(Effect.mapError(stuck));

/** Run the catalog's plant called `name`, and answer with the record line: what was found and which tests killed it. */
export const plant = Effect.fn("Run.plant")(function* (ask: {
  readonly catalog: ReadonlyArray<Plant>;
  readonly name: string;
  readonly settings: Settings;
  readonly root: string;
}): Effect.fn.Return<Line, Refused, Needs> {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const mutants = yield* Mutants;
  const chosen = ask.catalog.find(({ name }) => name === ask.name);

  if (chosen === undefined) {
    return yield* new Refused({ reason: "unknown_plant", at: [] });
  }

  const text = yield* fs.readFileString(path.join(ask.root, chosen.file)).pipe(Effect.mapError(stuck));
  const made = yield* mutants.make(chosen.file, text);
  const target = yield* Effect.fromResult(Target.find(text, made, chosen));

  yield* checkPackages(ask.settings, ask.root, chosen.file, chosen.law.file);

  const dir = yield* tempDir;
  const options = Options.make(target, chosen, ask.settings, { dir, plugin: mutants.plugin });
  const done = yield* ran(options);

  return record(chosen, target, done.report, {
    seconds: done.seconds,
    node: NODE,
    stryker: done.report.framework?.version ?? "unknown",
  });
});

/** Every mutant Stryker makes on lines `from` to `to` of `file` (from 1), run against `law`'s file, as rows with their status and killers. */
export const survey = Effect.fn("Run.survey")(function* (ask: {
  readonly file: string;
  readonly law: string;
  readonly from: number;
  readonly to: number;
  readonly settings: Settings;
  readonly root: string;
}): Effect.fn.Return<ReadonlyArray<Row>, Refused, Needs> {
  const mutants = yield* Mutants;

  yield* checkPackages(ask.settings, ask.root, ask.file, ask.law);

  const dir = yield* tempDir;
  // No target: the whole of each line is the range, which Stryker reads as `file:from-to`.
  const nothing = {
    name: "survey",
    file: ask.file,
    mutator: "",
    original: "",
    replacement: "",
    law: { file: ask.law, name: "" },
  };
  const place = {
    file: ask.file,
    line: ask.from,
    column: 0,
    endLine: ask.to,
    endColumn: 0,
    mutator: "",
    original: "",
    replacement: "",
  };
  const options = {
    ...Options.make(place, nothing, ask.settings, { dir, plugin: mutants.plugin }),
    mutate: [`${ask.file}:${ask.from}-${ask.to}`],
  };
  const done = yield* ran(options);

  return rows(done.report, ask.file);
});
