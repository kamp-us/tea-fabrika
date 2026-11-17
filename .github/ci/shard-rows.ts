// Today's CI, about next/ and Kalfa test files.
import { relative } from "node:path";
import { fileURLToPath } from "node:url";
import { createVitest } from "vitest/node";
import { projects } from "../../vitest.config.ts";
import { full, measured } from "../../vitest.shards.ts";

/**
 * next/ or Kalfa rows whose file is not among `files`, in path order. A file with no row is not listed:
 * `assign` places it by its fallback until CI's `shard-times` step gives it a row.
 */
export const stale = (table: Readonly<Record<string, number>>, files: readonly string[]): string[] => {
  const selected = new Set(files);

  return Object.keys(table)
    .filter((path) => (path.startsWith("next/") || path.startsWith("kalfa/")) && !selected.has(path))
    .toSorted();
};

/**
 * Test files under `root` as Vitest itself selects them from one project's `include` and
 * `exclude`, read on each call, in path order. A glob of our own drifted from Vitest's twice
 * (`dist`, then dot folders), so Vitest does the selecting.
 */
const selected = async (root: string, name: string): Promise<string[]> => {
  const project = projects.find((each) => each.test.name === name);

  if (project === undefined) {
    throw new Error(`shard-rows: vitest.config.ts has no project ${name}`);
  }

  const { include, exclude } = project.test;
  const vitest = await createVitest("test", { root, config: false, watch: false, include, exclude });

  try {
    return (await vitest.globTestSpecifications())
      .map((spec) => relative(vitest.config.root, spec.moduleId))
      .toSorted();
  } finally {
    await vitest.close();
  }
};

/**
 * next/'s vitest-leg files: the `next` project, which pull requests and the merge queue run, and
 * `next-integration`, which the schedule runs beside it (0536).
 */
export const nextFiles = async (root: string) =>
  [...(await selected(root, "next")), ...(await selected(root, "next-integration"))].toSorted();

/** next/'s visual files, the `next-visual` project: the end-to-end legs run them. */
export const visualFiles = (root: string) => selected(root, "next-visual");

/** Write the lint diagnostic for each stale row of `table` and return its exit code. */
export const main = (rows: readonly string[], write: (line: string) => void, table = "vitest.shards.json"): number => {
  for (const path of rows) {
    write(`stale shard row: ${path} is not a next/ or Kalfa test file Vitest selects; delete its row in ${table}`);
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
