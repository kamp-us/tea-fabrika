/**
 * Runs one law under a planted break and prints its plant record (decisions 0093 and 0580), so the
 * tests step never types a record by hand:
 *
 *   node .agents/skills/tests/scripts/plant.ts <file> "<law's title>"
 *   {"file":"next/packages/libfabrika/src/ledger/LedgerTurnReads.test.ts","law":"the log reads back as written","plant":"skip the last append on read","result":"red"}
 *
 * The step plants the break in the product file, runs this, restores the file by copy, and pastes
 * the printed line into its run row's `plants`. The script runs that one law through vitest's Node
 * API, from the repo's root (the directory it runs in), with the repo's setup file and time limits,
 * and reads the law's task: its file, its exact title, `meta.plant` and its state. The record says
 * `red` when the law failed and `green` when it passed, and exits 0 either way.
 *
 * It refuses, with exit 1 and no record, a title that matches no law in the file or two, and a law
 * with no `plant` option, since any of those would make a record up. It runs whatever file it is
 * given, a file no test project includes too. The pure part, from tasks to records, is the test
 * package's `Plants.records`.
 */
import { NodeRuntime, NodeServices } from "@effect/platform-node";
import { Plants } from "@kampus/vitest";
import { Console, Effect, Result, Schema } from "effect";
import { Argument, Command } from "effect/cli";
import { type CliOptions, createVitest } from "vitest/node";
import { testConfig } from "../../../../vitest.config.ts";

/** Why no record was printed: the run broke, or the title or the law cannot give a true record. */
class Refused extends Schema.TaggedError<Refused>()("Refused", { message: Schema.String }) {}

/** A title as a pattern for vitest's name filter: the exact text, at the end of the full name. */
const pattern = (title: string) => new RegExp(`${title.replaceAll(/[.*+?^${}()|[\]\\]/g, String.raw`\$&`)}$`);

/** Every law under a task, in source order. */
const laws = (task: Plants.Test | Plants.Suite): ReadonlyArray<Plants.Test> =>
  task.type === "test" ? [task] : task.tasks.flatMap(laws);

/** Why the run itself broke, as a refusal. */
const broke = (step: string) => (cause: unknown) => new Refused({ message: `vitest ${step}: ${String(cause)}` });

/** A vitest of its own that runs only `file`'s laws whose name ends with `title`, closed with its scope. */
const vitest = (root: string, file: string, title: string) => {
  const options: CliOptions = {
    root,
    config: false,
    watch: false,
    include: [file],
    setupFiles: testConfig.test.setupFiles,
    testTimeout: testConfig.test.testTimeout,
    hookTimeout: testConfig.test.hookTimeout,
    testNamePattern: pattern(title),
    maxWorkers: 1,
    reporters: [],
  };
  const open = () => createVitest("test", options);
  return Effect.acquireRelease(
    // oxlint-disable-next-line fabrika/no-promises -- edge: vitest's Node API answers a Promise
    Effect.tryPromise({ try: open, catch: broke("did not start") }),
    // oxlint-disable-next-line fabrika/no-promises -- edge: vitest's Node API answers a Promise
    (running) => Effect.tryPromise({ try: () => running.close(), catch: broke("did not close") }).pipe(Effect.orDie),
  );
};

/** The one law `title` names in `file`, run, as its plant record. */
const record = Effect.fnUntraced(function* (root: string, file: string, title: string) {
  const running = yield* vitest(root, file, title);
  const start = () => running.start();
  // oxlint-disable-next-line fabrika/no-promises -- edge: vitest's Node API answers a Promise
  yield* Effect.tryPromise({ try: start, catch: broke(`could not run ${file}`) });
  const files = running.state.getFiles().map((ran) => ({
    filepath: ran.filepath,
    tasks: ran.tasks.flatMap(laws).filter((law) => law.name === title),
  }));
  const named = files.flatMap((ran) => ran.tasks);

  if (named.length !== 1) {
    return yield* new Refused({
      message: `${file} has ${named.length} laws titled "${title}": a record names exactly one`,
    });
  }

  const records = Plants.records(files, root);

  if (Result.isFailure(records)) {
    return yield* new Refused({
      message: `"${records.failure.law}" in ${records.failure.file} has no plant option: write { plant: "<the break>" } on it`,
    });
  }

  const [one] = records.success;

  if (one === undefined) {
    return yield* new Refused({ message: `"${title}" in ${file} did not finish, so it has no result` });
  }

  return one;
});

const command = Command.make(
  "plant",
  { file: Argument.String("file"), title: Argument.String("title") },
  ({ file, title }) =>
    record(process.cwd(), file, title).pipe(
      Effect.scoped,
      Effect.flatMap((one) => Console.log(JSON.stringify(one))),
      // A red law sets vitest's exit code; the record is the answer, so the script still exits 0.
      Effect.tap(() => Effect.sync(() => (process.exitCode = 0))),
      Effect.tapError((error) => Console.error(`plant: ${error.message}`)),
    ),
);

// stdout carries only the record, since the step pastes it; a refusal goes to stderr and exits 1.
if (import.meta.main) {
  NodeRuntime.runMain(
    Command.runWith(command, { version: "0.0.0" })(process.argv.slice(2)).pipe(Effect.provide(NodeServices.layer)),
    { disableErrorReporting: true },
  );
}
