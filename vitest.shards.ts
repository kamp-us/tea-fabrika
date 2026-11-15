import { readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { BaseSequencer, type TestSpecification } from "vitest/node";

// How `--shard k/n` splits the test files over the check's machines: each machine gets about the
// same seconds, not the same count of files. vitest's own split gives each the same count, so two
// two-minute lane files can land on one machine while another runs only one-second files. On each
// machine the heaviest file starts first, so its workers end near the same time and the split's
// sums hold; a heavy file that starts late runs alone at the end.

const LANE = "packages/pipeline/src/stages/pipeline/lane";

/** The table at `path`: an object of seconds, each a finite number of zero or more, or it throws. */
const readTable = (path: string): Record<string, number> => {
  const table: unknown = JSON.parse(readFileSync(path, "utf8"));

  if (
    typeof table !== "object" ||
    table === null ||
    Array.isArray(table) ||
    !Object.values(table).every((seconds) => typeof seconds === "number" && Number.isFinite(seconds) && seconds >= 0)
  ) {
    throw new Error(`${path}: not an object of seconds per test file`);
  }

  return Object.fromEntries(Object.entries(table));
};

/**
 * Seconds per file from the repo root: medians of today's test-file times in CI runs
 * 42579837468, 42573088027 and 42571265116, rounded to one decimal.
 * The 18 lane rows use PR 757 runs 42850162592, 42853075395 and 42855774180,
 * one file at a time. The 12 refreshed rows use main runs 42803733957, 42807559589
 * and 42801440878. box, boxrm, loosening and program-package-layout come from PR 757's check
 * run 42874119130, attempts 5 to 14 (a median of 10).
 * stepcommit, redact and gc use CI runs 42631962689, 42631256491 and 42630840277.
 * The `next` project's rows, the in-memory tests the merge line runs (0536), use attempt 1 of runs
 * 43656757141 and 43657195723 (pull requests) and 43657535864 (a merge queue group), all after PR
 * 1278; the `next-integration` rows use attempt 1 of green runs 43544589151 (push to main),
 * 43551626086 (merge queue group) and 43556494864 (push to main). Each is rounded to one decimal:
 * the median of the three samples, or the larger of those in hand when a run did not hold the
 * file. The samples and their jobs are in vitest.shards.test.ts. The 8 end-to-end rows (next/apps/fabrika/e2e and the tuval key law) use
 * attempt 1 of runs 43601966383 (job 132468657925), 43601964962 (job 132468687674) and 43605298688
 * (job 132478645693), the median of the three, from Vitest's printed Duration per file.
 * A file with no row is placed by the fallback at the median measured time; CI's `shard-times`
 * step prints its real seconds for a later row.
 *
 * The rows live in vitest.shards.json and are read from disk, never imported. vitest.config.ts
 * imports this file, and Vitest selects every test when a file its config imports changes, so a
 * table imported here made each row edit run the whole suite. A row only orders and splits files.
 * The config makes the table a watched file of this module, so `--changed` still runs every test
 * that imports this file when a row changes.
 */
export const measured: Readonly<Record<string, number>> = readTable(join(import.meta.dirname, "vitest.shards.json"));

/**
 * The middle of `seconds` once sorted; of an even count, the lower middle, so no two rows are
 * averaged into a number nobody measured. With no seconds at all there is no middle, so 1 s.
 */
export const median = (seconds: readonly number[]): number =>
  seconds.toSorted((a, b) => a - b)[Math.floor((seconds.length - 1) / 2)] ?? 1;

/** What a file with no row counts as: the median of every row, read once. */
const guess = median(Object.values(measured));

/**
 * Each file's machine, `0` to `count - 1`, in the order the files came. Each measured file,
 * heaviest first (ties by path), goes to the machine with the least seconds so far (ties: the
 * first). Then each file with no seconds, in path order, goes the same way and counts as
 * `unmeasured` seconds, the table's median by default, so several new files spread over the
 * machines. The same files in any order get the same machines, so every machine computes the same
 * split.
 */
export const assign = (
  files: readonly { readonly path: string; readonly seconds?: number | undefined }[],
  count: number,
  start: readonly number[] = [],
  unmeasured: number = guess,
): number[] => {
  const byPath = (x: { readonly path: string }, y: { readonly path: string }) =>
    x.path < y.path ? -1 : x.path > y.path ? 1 : 0;
  const order = files
    .map((file, at) => ({ path: file.path, seconds: file.seconds, at }))
    .toSorted((x, y) =>
      x.seconds === undefined || y.seconds === undefined
        ? Number(x.seconds === undefined) - Number(y.seconds === undefined) || byPath(x, y)
        : y.seconds - x.seconds || byPath(x, y),
    );
  const load = Array.from({ length: count }, (_, i) => start[i] ?? 0);
  const machines = files.map(() => 0);

  for (const file of order) {
    const least = load.indexOf(Math.min(...load));
    machines[file.at] = least;
    load[least] = (load[least] ?? 0) + (file.seconds ?? unmeasured);
  }

  return machines;
};

/** Workers used by the rest step on each CI machine. */
export const WORKERS = 3;

export const wall = (seconds: readonly number[]): number =>
  Math.max(0, ...seconds, seconds.reduce((sum, value) => sum + value, 0) / WORKERS);

/** A lane file of today's pipeline, which the rest step's loads leave out. */
export const inLaneStep = (path: string) => path.includes(`${LANE}.`);

/** Estimated rest-step wall time, excluding next/ and the separate lane step. */
export const restLoads = (count: number): number[] => {
  const files = Object.entries(measured)
    .filter(([path]) => !path.startsWith("next/") && !inLaneStep(path))
    .map(([path, seconds]) => ({ path, seconds }));
  const machines = assign(files, count);
  return Array.from({ length: count }, (_, machine) =>
    wall(files.filter((_, i) => machines[i] === machine).map((file) => file.seconds)),
  );
};

/** A file's row, or undefined when the table has none. */
const rowOf = (path: string): number | undefined => (Object.hasOwn(measured, path) ? measured[path] : undefined);

/**
 * vitest's own sequencer with two changes: `shard` keeps this machine's files of `assign`, and
 * `sort` starts the heaviest file first.
 */
export class Shards extends BaseSequencer {
  override async shard(files: TestSpecification[]): Promise<TestSpecification[]> {
    const { root, shard } = this.ctx.config;

    // vitest calls `shard` only when `--shard` is given; the type does not know that.
    if (shard === undefined) {
      throw new Error("Shards.shard: called without --shard");
    }

    const machines = assign(
      files.map((spec) => {
        const path = relative(root, spec.moduleId);
        return { path, seconds: rowOf(path) };
      }),
      shard.count,
      files.every((spec) => inLaneStep(relative(root, spec.moduleId))) ? restLoads(shard.count) : [],
    );
    return files.filter((_, i) => machines[i] === shard.index - 1);
  }

  /**
   * vitest's own order, with the table's seconds where vitest's results cache has none. vitest runs
   * a failed file first, then the longer one, by its cache. CI keeps no cache, so vitest falls back to
   * file size, and on main run 43618656328 StartChild (531 s) started 284 s in, behind smaller files,
   * and its machine took 816 s. Here each of vitest's pools runs a failed file first, then the
   * heaviest row, a file with no row counting the median as in `assign`; equal seconds keep vitest's
   * order. A pool is what vitest 5's `groupSpecs` makes: one per group order, every project of that
   * order in it, and one more for the projects that run one isolated file at a time. vitest's own
   * sort puts projects one after another by name, but they share the pool, so on a leg that runs
   * `next` and `next-integration` that order only made the heavy integration files start last.
   */
  override async sort(files: TestSpecification[]): Promise<TestSpecification[]> {
    const { root } = this.ctx.config;
    const sorted = await super.sort(files);
    const groupOf = ({ project: { config } }: TestSpecification) =>
      config.isolate === true && config.sequence.groupOrder === 0 && config.maxWorkers === 1
        ? "one at a time"
        : `${config.sequence.groupOrder}`;
    const groups = new Map<string, number>();

    for (const spec of sorted) {
      groups.set(groupOf(spec), groups.get(groupOf(spec)) ?? groups.size);
    }

    const rank = (spec: TestSpecification) => groups.get(groupOf(spec)) ?? groups.size;
    const failed = (spec: TestSpecification) => this.ctx.cache.getTestSpecificationResult(spec)?.failed === true;
    const seconds = (spec: TestSpecification) => rowOf(relative(root, spec.moduleId)) ?? guess;
    return sorted.toSorted(
      (a, b) => rank(a) - rank(b) || Number(failed(b)) - Number(failed(a)) || seconds(b) - seconds(a),
    );
  }
}
