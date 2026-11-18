/**
 * The hourly mutation run's file pick (0066, 0089): which changed files it mutates and which tests
 * it runs. One source: the sample script beside this one imports `PRODUCT` and `inScope` for its
 * diff, and the `range` step of `.github/workflows/mutation.yaml` pipes `git diff --name-only`
 * through this script for the test list.
 *
 *   git diff --name-only --diff-filter=d BASE HEAD | node .agents/skills/mutation/scripts/scope.ts --tracked FILE
 *
 * `--tracked FILE` is the head's file list (`git ls-tree -r --name-only HEAD`), one path a line.
 * With it a changed file also picks the tests beside it that carry a kind, such as
 * `name.laws.test.ts` or `name.integration.test.ts` (decision 0600: 61 of libfabrika's product
 * files have only those). Without it the pick is `name.test.ts` and `name.test.tsx` alone.
 *
 * Of the lead tooling under `.agents/`, only the code that runs quests is in (0089): the lead's
 * chain and drive scripts and the flow runner under `flow/`, each with the tests beside it.
 * Everything outside `.agents/` is in as before. Script names here are built from their stems, so
 * the script-reads lint does not take this file for a reader of those scripts.
 *
 * Hand-written, since no tool here fits (0040). A git pathspec cannot do it: an exclude always
 * wins over an include, so "not `.agents/`, but the chain script" needs two diffs, and the
 * workflow's shell could not share them. The rule is four exact paths and one folder, so plain
 * string tests are enough; picomatch is only a transitive dependency here. Its edge cases, each in
 * the test:
 *
 * - `.agents/` only at the top: an `.agents/` folder inside `apps/` is product code.
 * - `flow/` is a folder: a `flow` file or a `flowers/` folder beside it is out.
 * - The chain and drive scripts only in the lead skill: the same names in another skill are out.
 * - Only the exact names: a `chain.cleanup` test or a `chain` `.tsx` file is out.
 * - A test of an in-scope file is in, and a test of an out-of-scope file is out.
 * - A kind sibling is `name.<kind>.test.ts(x)` in the same folder: the stem, then a dot. A file that
 *   only starts with the stem (`name-x.laws.test.ts`) is not one. A kind is a word of letters,
 *   digits and dashes, and a file with `types` (a type law kills no mutant) or `visual` (a window,
 *   which the container cannot open) among its kinds is left out.
 */
import { NodeRuntime, NodeServices } from "@effect/platform-node";
import { Console, Effect, FileSystem, Stdio, Stream } from "effect";
import { Command, Flag } from "effect/cli";

const LEAD = ".agents/skills/lead/scripts/";

/** The quest code's own files and tests (0089's table); the flow runner is a folder. */
const QUEST = ["chain", "drive"].flatMap((stem) => [".ts", ".test.ts"].map((end) => `${LEAD}${stem}${end}`));

const FLOW = `${LEAD}flow/`;

/**
 * Every extension Stryker 10.1.1's Instrumenter parses as JavaScript or TypeScript (its
 * parsers/create-parser.js). A changed `.cjs` or `.mjs` file is sampled like a `.ts` one (ticket 655).
 */
const EXTENSIONS = [".ts", ".tsx", ".mts", ".cts", ".js", ".jsx", ".mjs", ".cjs"] as const;

const DECLARATIONS = [".d.ts", ".d.mts", ".d.cts"] as const;

const TESTS = [".test.ts", ".test.tsx"] as const;

/** The same product rule as a git pathspec, for the sample script's diff: less tests and type-only files. */
export const PRODUCT = [
  ...EXTENSIONS.map((extension) => `*${extension}`),
  ":!*.test.*",
  ...DECLARATIONS.map((extension) => `:!*${extension}`),
] as const;

/** A file that holds mutants: the pathspec above, read as git reads it (its `*` crosses `/`). */
const product = (path: string) =>
  EXTENSIONS.some((extension) => path.endsWith(extension)) &&
  !path.includes(".test.") &&
  !DECLARATIONS.some((extension) => path.endsWith(extension));

const test = (path: string) => TESTS.some((extension) => path.endsWith(extension));

/** Whether the run may mutate this path, or run it as a test: all but lead tooling, quest code kept. */
export const inScope = (path: string) => !path.startsWith(".agents/") || QUEST.includes(path) || path.startsWith(FLOW);

/** The changed paths in scope, in their order. */
export const pick = (paths: ReadonlyArray<string>) => paths.filter(inScope);

const compare = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);

/** The kinds that name a test no hourly run can use: a type law kills no mutant, and a window needs a display. */
const UNUSABLE = ["types", "visual"];

/** What follows a stem and its dot in a kind sibling: one or more kind words, each with its dot, then `test.ts(x)`. */
const SIBLING = /^((?:[A-Za-z0-9-]+\.)+)test\.tsx?$/;

/** The tracked tests beside a product file that carry a kind: `stem.<kind>.test.ts(x)`, the stem followed by a dot. */
const siblings = (stem: string, tracked: ReadonlyArray<string>) =>
  tracked.filter((file) => {
    const kinds = file.startsWith(`${stem}.`) ? SIBLING.exec(file.slice(stem.length + 1))?.[1] : undefined;

    return kinds !== undefined && !kinds.split(".").some((kind) => UNUSABLE.includes(kind));
  });

/**
 * The tests a run of these changed paths may use, sorted and unique: for each changed product file
 * in scope, its `name.test.ts` and `name.test.tsx`, and each of its kind siblings among `tracked`
 * (the head's files; none, and there are none), and each changed test in scope. Whether each
 * `name.test.ts(x)` exists at head is the workflow's check.
 */
export const related = (changed: ReadonlyArray<string>, tracked: ReadonlyArray<string> = []) => {
  const tests = pick(changed).flatMap((path) => {
    if (product(path)) {
      const stem = path.slice(0, path.lastIndexOf("."));

      return [...TESTS.map((extension) => `${stem}${extension}`), ...siblings(stem, tracked)];
    }

    return test(path) ? [path] : [];
  });

  return [...new Set(tests)].sort(compare);
};

const scope = Command.make(
  "scope",
  { tracked: Flag.String("tracked").pipe(Flag.withDefault(undefined)) },
  Effect.fnUntraced(function* ({ tracked }) {
    const fs = yield* FileSystem.FileSystem;
    const stdio = yield* Stdio.Stdio;
    const text = yield* stdio.stdin.pipe(Stream.decodeText(), Stream.mkString);
    const files = tracked === undefined ? "" : yield* fs.readFileString(tracked);
    const lines = (list: string) => list.split("\n").filter((line) => line !== "");
    const tests = related(lines(text), lines(files));

    if (tests.length > 0) {
      yield* Console.log(tests.join("\n"));
    }
  }),
);

if (import.meta.main) {
  NodeRuntime.runMain(
    Command.runWith(scope, { version: "0.0.0" })(process.argv.slice(2)).pipe(Effect.provide(NodeServices.layer)),
  );
}
