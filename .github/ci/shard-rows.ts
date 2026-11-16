// Today's CI, about next/'s test files.
import { relative } from "node:path";
import { fileURLToPath } from "node:url";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";
import * as Rec from "effect/Record";
import { createVitest } from "vitest/node";
import { projects } from "../../vitest.config.ts";
import { full, measured } from "../../vitest.shards.ts";

/**
 * next/ rows whose file is not among `files`, in path order. A file with no row is not listed:
 * `assign` places it by its fallback until CI's `shard-times` step gives it a row.
 */
export const stale = (table: Readonly<Record<string, number>>, files: readonly string[]): string[] => {
  const selected = new Set(files);
  return Rec.keys(table)
    .filter((path) => path.startsWith("next/") && !selected.has(path))
    .toSorted();
};

/** Vitest could not start, select or close: the check's own failure, with Vitest's error as its cause. */
class VitestFailure extends Schema.TaggedError<VitestFailure>()("VitestFailure", { cause: Schema.Defect() }) {}

/** One call of Vitest's Promise API, as `Effect.tryPromise` in its object form. */
const vitestCall = <A>(run: () => PromiseLike<A>) =>
  Effect.tryPromise({ try: run, catch: (cause) => new VitestFailure({ cause }) });

/**
 * Test files under `root` as Vitest itself selects them from one project's `include` and
 * `exclude`, read on each call, in path order. A glob of our own drifted from Vitest's twice
 * (`dist`, then dot folders), so Vitest does the selecting.
 */
const selected = Effect.fnUntraced(function* (root: string, name: string) {
  const project = projects.find((each) => each.test.name === name);

  if (project === undefined) {
    return yield* Effect.die(new Error(`shard-rows: vitest.config.ts has no project ${name}`));
  }

  const { include, exclude } = project.test;
  return yield* Effect.acquireUseRelease(
    vitestCall(() => createVitest("test", { root, config: false, watch: false, include, exclude })),
    (vitest) =>
      vitestCall(() => vitest.globTestSpecifications()).pipe(
        Effect.map((specs) => specs.map((spec) => relative(vitest.config.root, spec.moduleId)).toSorted()),
      ),
    (vitest) => vitestCall(() => vitest.close()).pipe(Effect.orDie),
  );
});

/**
 * next/'s vitest-leg files: the `next` project, which pull requests and the merge queue run, and
 * `next-integration`, which the schedule runs beside it (0536). A Promise, since the tests and this
 * file's own check await it.
 */
export const nextFiles = (root: string) =>
  Effect.runPromise(
    Effect.all([selected(root, "next"), selected(root, "next-integration")], { concurrency: 1 }).pipe(
      Effect.map(([plain, integration]) => [...plain, ...integration].toSorted()),
    ),
  );

/** next/'s visual files, the `next-visual` project: the end-to-end legs run them. */
export const visualFiles = (root: string) => Effect.runPromise(selected(root, "next-visual"));

/** Write the lint diagnostic for each stale row of `table` and return its exit code. */
export const main = (rows: readonly string[], write: (line: string) => void, table = "vitest.shards.json"): number => {
  for (const path of rows) {
    write(`stale shard row: ${path} is not a next/ test file Vitest selects; delete its row in ${table}`);
  }

  return rows.length === 0 ? 0 : 1;
};

// L1, run by `pnpm lint`. Plant, run once on the table and restored: add a row for
// next/apps/fabrika/src/gone.test.ts. The check printed its stale shard row line and exited 1;
// restored, it printed nothing and exited 0. On the same tree the old check, which refused a file
// with no row, printed `no shard row: next/apps/fabrika/src/exam/effect-checks.test.ts` and exited 1.
// Under Vitest `import.meta.main` is false, so a test that imports this file never runs the check.
// E9 (T967): the vitest and end-to-end selections are judged together, since one table holds both
// rows. Plants, each run once with the 8 end-to-end rows in the table, and restored: leave e2eFiles
// out of the entry (8 stale lines, exit 1); add a row for next/apps/fabrika/e2e/gone.test.ts (its one
// stale line, exit 1). Restored, it printed nothing and exited 0.
if (import.meta.main) {
  const root = fileURLToPath(new URL("../../", import.meta.url));
  const files = [...(await nextFiles(root)), ...(await visualFiles(root))];
  const write = (line: string) => console.error(line);
  // The full-depth table is judged the same way: a renamed file must not keep a row in either.
  process.exitCode = Math.max(
    main(stale(measured, files), write),
    main(stale(full, files), write, "vitest.shards.full.json"),
  );
}
