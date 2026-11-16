/**
 * A plant's record, from the law's own options (decisions 0093 and 0580): after a run, `records`
 * reads vitest's task trees (`vitest.state.getFiles()`) and lists each law that ran as `{ file, law,
 * plant, result }`, `red` when it failed and `green` when it passed. The tests step pastes those
 * lines into its run row's `plants`, so a record is never typed by hand, and the CI plant check reads
 * them there.
 *
 * @stability unstable
 */
import * as Result from "effect/Result";

/**
 * A law in vitest's task tree, as far as `records` reads it: its title, its `meta.plant` and its
 * state once run.
 *
 * @stability unstable
 * @category models
 */
export interface Test {
  readonly type: "test";
  readonly name: string;
  readonly meta: { readonly plant?: string | undefined };
  readonly result?: { readonly state: string } | undefined;
}

/**
 * A `describe` in vitest's task tree, as far as `records` reads it: the tasks under it.
 *
 * @stability unstable
 * @category models
 */
export interface Suite {
  readonly type: "suite";
  readonly tasks: ReadonlyArray<Test | Suite>;
}

/**
 * One test file of a run, the part of vitest's `RunnerTestFile` that `records` reads.
 *
 * @stability unstable
 * @category models
 */
export interface File {
  readonly filepath: string;
  readonly tasks: ReadonlyArray<Test | Suite>;
}

/**
 * One plant's record, as a run row's `plants` holds it: the law's file from the repo's root, its
 * exact title, its plant, and whether the plant turned it red.
 *
 * @stability unstable
 * @category models
 */
export interface Plant {
  readonly file: string;
  readonly law: string;
  readonly plant: string;
  readonly result: "red" | "green";
}

/**
 * A law that ran with no `plant` option: no record can be made for it.
 *
 * @stability unstable
 * @category models
 */
export interface Unplanted {
  readonly file: string;
  readonly law: string;
}

/** The laws under a task, in source order. */
const laws = (task: Test | Suite): ReadonlyArray<Test> => (task.type === "test" ? [task] : task.tasks.flatMap(laws));

/** A file's path from `root`, as a run row names it. */
const fromRoot = (filepath: string, root: string): string =>
  filepath.startsWith(`${root}/`) ? filepath.slice(root.length + 1) : filepath;

/**
 * The record of each law that ran in `files`, in source order: a law that passed or failed, so a
 * skipped or unfinished one is left out. The first law that ran with no plant is refused.
 *
 * @stability unstable
 * @category records
 */
export const records = (files: ReadonlyArray<File>, root: string): Result.Result<ReadonlyArray<Plant>, Unplanted> => {
  const ran = files.flatMap((file) =>
    file.tasks
      .flatMap(laws)
      .filter((law) => law.result?.state === "pass" || law.result?.state === "fail")
      .map((law) => ({ file: fromRoot(file.filepath, root), law })),
  );
  const bare = ran.find(({ law }) => law.meta.plant === undefined);

  if (bare !== undefined) {
    return Result.fail({ file: bare.file, law: bare.law.name });
  }

  return Result.succeed(
    ran.flatMap(({ file, law }) =>
      law.meta.plant === undefined
        ? []
        : [{ file, law: law.name, plant: law.meta.plant, result: law.result?.state === "fail" ? "red" : "green" }],
    ),
  );
};
