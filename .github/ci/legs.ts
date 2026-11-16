// Today's CI, next/. How many of the next job's machines a run starts: the size step of check.yaml's
// changes job prints them, and next's matrix reads them. A small pull request started all seven
// machines, each spending about a minute on setup to run 0 or 1 files, and held runners a big one
// could use. The merge queue and main ran the whole suite; since 0534 they run what their change
// reaches too, and only the schedule (scheduled.yaml) runs all of next/.
//
//   event and path                               legs
//   pull request, merge queue group or push to   sized from the `next` files Vitest's `--changed`
//   main, all of next/, with a base commit       picks from the base, and every reader test
//   the same events, the reader tests alone      sized from the reader tests, with or without a base
//   anything else                                the full matrix: all of next/ with no base
//
// Only a pull request with the `visual` label starts end-to-end legs, which run `next-visual`; the
// merge queue and main never do, and the schedule runs every layer (0536).
//
// The reader tests (changes.mjs's `readers`) read source as text, so `--changed`, which follows
// imports, misses them. A sized run adds them to the vitest files, each once, and prints that list
// as `files`; every vitest leg runs exactly it, so a reader `--changed` already picked runs once.
//
// A vitest leg's files may take the size step's BUDGET seconds, a setting check.yaml declares once,
// and never more than half the next job's limit less the leg's setup, so a leg cannot run into the
// timeout. An end-to-end leg's files may take that half less its own, longer setup:
// vitest.shards.test.ts's E4 budget, the one the count of e2e legs is pinned with. Seconds come from
// vitest.shards.json's table, a file with no row at the table's median, and `assign` splits them, so
// this split is the one `Shards` makes on each leg.
import { spawnSync } from "node:child_process";
import { appendFileSync, mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import * as Function from "effect/Function";
import { assign, measured, median } from "../../vitest.shards.ts";
import { readers, validSha } from "./changes.mjs";
import { e2eLegs, nextMinutes, vitestLegs } from "./workflow-lint.ts";

/** How many legs of each kind run. Zero of a kind starts none of its machines. */
export type Legs = { readonly vitest: number; readonly e2e: number };

/**
 * What the run tests: every next/ file a change reaches, or only the reader tests (changes' filter),
 * `base`, the commit its change starts from, which Vitest's `--changed` diffs with: a pull request's
 * base, a merge queue group's base, or what main held before a push, empty when there is none, as on
 * a first push; and whether a pull request asked for its visual tests with the `visual` label (0536).
 */
export type Run = {
  readonly event: string;
  readonly scope: "all" | "readers";
  readonly base: string;
  readonly visual: boolean;
};

/** Each kind's selected test files, from the repo root. */
export type Selected = { readonly vitest: readonly string[]; readonly e2e: readonly string[] };

/**
 * A vitest leg's setup, in seconds: its job's time less its vitest step's (checkout, pnpm, install,
 * and the steps after the tests), the median of the 10 legs of runs 43653934535 (jobs 132628327688,
 * 132628327717), 43654840420 (132631117471, 132631117496), 43656757141 (132637025465, 132637025443),
 * 43657195723 (132638385663, 132638385672) and 43657535864 (132639432580, 132639432685), in that order.
 */
export const SETUP = median([28, 30, 35, 33, 35, 30, 34, 32, 30, 27]);

/** An end-to-end leg's setup, chromium's fetch included, in seconds: the median of E4's three samples. */
export const E2E_SETUP = 70.2;

/** The seconds one leg's files may take before the job's limit: half of it, the 2x room it is sized with, less setup. */
export const room: {
  (setup: number): (minutes: number) => number;
  (minutes: number, setup: number): number;
} = Function.dual(2, (minutes: number, setup: number): number => (minutes * 60) / 2 - setup);

/** The seconds a leg of each kind may take on a sized run. */
export type Limits = { readonly vitest: number; readonly e2e: number };

/**
 * Each kind's limit: a vitest leg's is `budget`, the size step's BUDGET setting, but never past its
 * room in the job's `minutes`; an end-to-end leg's is its room alone, which no budget changes.
 */
export const limits: {
  (budget: number): (minutes: number) => Limits;
  (minutes: number, budget: number): Limits;
} = Function.dual(2, (minutes: number, budget: number): Limits => ({
  vitest: Math.min(budget, room(minutes, SETUP)),
  e2e: room(minutes, E2E_SETUP),
}));

/** The size step's BUDGET, a vitest leg's seconds: a positive number, or a throw, so the step prints nothing. */
export const budgetOf = (value: string | undefined): number => {
  const seconds = Number(value);

  if (value === undefined || value.trim() === "" || !Number.isFinite(seconds) || seconds <= 0) {
    throw new Error(`legs: BUDGET must be a positive number of seconds, not ${JSON.stringify(value)}`);
  }

  return seconds;
};

/** A file's row, or undefined when the table has none, as `Shards` reads it. */
const rowOf = (table: Readonly<Record<string, number>>, path: string) =>
  Object.hasOwn(table, path) ? table[path] : undefined;

/** Each leg's files when `assign` splits `files` over `count` legs, as `Shards` keeps them. */
export const split: {
  (count: number, table?: Readonly<Record<string, number>>): (files: readonly string[]) => string[][];
  (files: readonly string[], count: number, table?: Readonly<Record<string, number>>): string[][];
} = Function.dual(
  // A direct call starts with the file list; a piped one with the count.
  (args) => Array.isArray(args[0]),
  (files: readonly string[], count: number, table: Readonly<Record<string, number>> = measured): string[][] => {
    const placed = assign(
      files.map((path) => ({ path, seconds: rowOf(table, path) })),
      count,
      [],
      median(Object.values(table)),
    );
    return Array.from({ length: count }, (_, leg) => files.filter((_, i) => placed[i] === leg));
  },
);

/** The seconds of a leg's files, a file with no row at the table's median. */
const seconds = (files: readonly string[], table: Readonly<Record<string, number>>) => {
  const unmeasured = median(Object.values(table));
  return files.reduce((sum, path) => sum + (rowOf(table, path) ?? unmeasured), 0);
};

/**
 * The fewest legs, up to `most`, whose longest share fits `limit` seconds. When no count fits (one
 * file alone is over), the fewest that make the longest share as short as it gets. No file, no leg.
 */
export const fewest: {
  (most: number, limit: number, table?: Readonly<Record<string, number>>): (files: readonly string[]) => number;
  (files: readonly string[], most: number, limit: number, table?: Readonly<Record<string, number>>): number;
} = Function.dual(
  // A direct call starts with the file list; a piped one with the most legs.
  (args) => Array.isArray(args[0]),
  (
    files: readonly string[],
    most: number,
    limit: number,
    table: Readonly<Record<string, number>> = measured,
  ): number => {
    const tried = Array.from({ length: Math.min(most, files.length) }, (_, i) => {
      const count = i + 1;
      return { count, longest: Math.max(...split(files, count, table).map((leg) => seconds(leg, table))) };
    });
    const shortest = tried.reduce<(typeof tried)[number] | undefined>(
      (best, next) => (best === undefined || next.longest < best.longest ? next : best),
      undefined,
    );
    return (tried.find((next) => next.longest <= limit) ?? shortest)?.count ?? 0;
  },
);

/** The events on the merge line, each of which runs only what its change reaches (0534). */
const LINE = new Set(["pull_request", "merge_group", "push"]);

/**
 * A run legs.ts sizes: one on the merge line that tests all of next/ from a base commit, or only the
 * reader tests, which are listed whole and need no base. Every other run is the full matrix: one
 * off the merge line, and one that tests all of next/ with no base to diff with.
 */
const sizes = (run: Run) => LINE.has(run.event) && (run.scope === "readers" || validSha(run.base));

/**
 * Whether a run's end-to-end legs, which run the visual tests, may start: only on a pull request
 * that asked with the `visual` label; never in the merge queue or on main, since the schedule runs
 * them (0536). check.yaml's fallback says the same (workflow-lint.ts, E10).
 */
const visual = (run: Run) => run.event === "pull_request" && run.visual;

/**
 * The legs a run starts: sized on a merge line run, each kind to its own limit, else `full`, each
 * with no end-to-end leg where the visual tests may not start.
 */
export const size: {
  (selected: Selected, full: Legs, limit: Limits, table?: Readonly<Record<string, number>>): (run: Run) => Legs;
  (run: Run, selected: Selected, full: Legs, limit: Limits, table?: Readonly<Record<string, number>>): Legs;
} = Function.dual(
  // A direct call starts with the run, which has an event; a piped one with the selected files.
  (args) => typeof args[0] === "object" && args[0] !== null && "event" in args[0],
  (
    run: Run,
    selected: Selected,
    full: Legs,
    limit: Limits,
    table: Readonly<Record<string, number>> = measured,
  ): Legs => {
    const e2e = visual(run) ? full.e2e : 0;
    return sizes(run)
      ? {
          vitest: fewest(selected.vitest, full.vitest, limit.vitest, table),
          e2e: fewest(selected.e2e, e2e, limit.e2e, table),
        }
      : { vitest: full.vitest, e2e };
  },
);

/** The matrix's legs, as check.yaml writes them: `e2e-1` to `e2e-N`, then "1" to "M". */
export const shards = (legs: Legs): string[] => [
  ...Array.from({ length: legs.e2e }, (_, i) => `e2e-${i + 1}`),
  ...Array.from({ length: legs.vitest }, (_, i) => `${i + 1}`),
];

/**
 * A sized run's vitest files: what `--changed` picked, and every reader test, which it cannot
 * reach. Each once, in path order, so a reader `--changed` picked too runs once.
 */
export const withReaders: {
  (readerFiles: readonly string[]): (changed: readonly string[]) => string[];
  (changed: readonly string[], readerFiles: readonly string[]): string[];
} = Function.dual(2, (changed: readonly string[], readerFiles: readonly string[]): string[] =>
  [...new Set([...changed, ...readerFiles])].toSorted(),
);

/**
 * What the size step prints. On a sized run with a vitest leg, `files` is the vitest legs' one
 * list: each leg runs exactly it, and `Shards` keeps the leg's share of the split sized here. The
 * step passes it unquoted, one path per word, so a path with a space would split; then this
 * throws, the step prints nothing, and next runs its full matrix on every file. No other run
 * prints `files`, so its legs keep changes' filter. With no leg, no `shards` line: if GitHub ever
 * expanded the matrix before next's `if`, it would expand the fallback, never an empty matrix.
 * A sized run of all of next/ with an end-to-end leg prints `base`, so those legs run the
 * end-to-end files the size step sized them with, `--changed` from the same commit; every other run
 * prints none, and its end-to-end legs run every file, as a sized run of the reader tests sized them.
 */
export const outputs: {
  (legs: Legs, selected: Selected): (run: Run) => string[];
  (run: Run, legs: Legs, selected: Selected): string[];
} = Function.dual(3, (run: Run, legs: Legs, selected: Selected): string[] => {
  const some = legs.vitest + legs.e2e > 0;
  const listed = sizes(run) && legs.vitest > 0;
  const narrowed = sizes(run) && run.scope === "all" && legs.e2e > 0;

  if (listed && selected.vitest.some((path) => /\s/.test(path))) {
    throw new Error("legs: a vitest file's path holds a space, so it cannot be one word of `files`");
  }

  return [
    ...(some ? [`shards=${JSON.stringify(shards(legs))}`] : []),
    ...(listed ? [`files=${selected.vitest.join(" ")}`] : []),
    ...(narrowed ? [`base=${run.base}`] : []),
    `vitest=${legs.vitest}`,
    `e2e=${legs.e2e}`,
    `next=${some}`,
  ];
});

/** The test files `vitest list` picks with `args`, as a run with them would, from the repo root. */
const list = (root: string, args: readonly string[]): string[] => {
  const out = join(mkdtempSync(join(tmpdir(), "legs-")), "list.json");
  // CI=true, as on a runner: the config's local guard refuses a broad list without it.
  const done = spawnSync(
    "pnpm",
    ["exec", "vitest", "list", ...args, "--passWithNoTests", "--filesOnly", `--json=${out}`],
    { cwd: root, env: { ...process.env, CI: "true" }, stdio: ["ignore", "inherit", "inherit"] },
  );

  if (done.status !== 0) {
    throw new Error(`legs: vitest list ${args.join(" ")} exited ${done.status}`);
  }

  const files: unknown = JSON.parse(readFileSync(out, "utf8"));
  return (Array.isArray(files) ? files : [])
    .flatMap((entry: unknown) =>
      typeof entry === "object" && entry !== null && "file" in entry && typeof entry.file === "string"
        ? [relative(root, entry.file)]
        : [],
    )
    .toSorted();
};

// Under Vitest `import.meta.main` is false, so a test that imports this file never lists or writes.
if (import.meta.main) {
  const root = fileURLToPath(new URL("../../", import.meta.url));
  const workflow = readFileSync(join(root, ".github/workflows/check.yaml"), "utf8");
  const full = { vitest: vitestLegs(workflow).length, e2e: e2eLegs(workflow).length };
  const run: Run = {
    event: process.env["EVENT"] ?? "",
    scope: (process.env["FILTER"] ?? "next/") === "next/" ? "all" : "readers",
    base: process.env["BASE"] ?? "",
    visual: process.env["VISUAL"] === "true",
  };
  const limit = limits(nextMinutes(workflow), budgetOf(process.env["BUDGET"]));
  // `--changed` from the base on a run of all of next/; none on a run of the reader tests alone.
  const changed = run.scope === "all" ? [`--changed=${run.base}`] : [];
  const sized = sizes(run);
  // The reader tests are listed whole, with no `--changed`: Vitest's own match of changes' paths.
  // The merge line's vitest legs run the `next` project alone, and a pull request's end-to-end legs
  // the `next-visual` one, only when it asked (0536).
  const picked = sized && run.scope === "all" ? list(root, ["--project", "next", "next/", ...changed]) : [];
  const readerFiles = sized ? list(root, ["--project", "next", ...readers]) : [];
  const selected: Selected = sized
    ? {
        vitest: withReaders(picked, readerFiles),
        e2e: visual(run) ? list(root, ["--project", "next-visual", ...changed]) : [],
      }
    : { vitest: [], e2e: [] };
  const legs = size(run, selected, full, limit);
  const lines = outputs(run, legs, selected);
  const missed = selected.vitest.length - picked.length;
  const vitestNote =
    run.scope === "all"
      ? `${selected.vitest.length} vitest files (${seconds(selected.vitest, measured).toFixed(1)} s, ${missed} of them reader tests \`--changed\` missed)`
      : `${selected.vitest.length} reader test files (${seconds(selected.vitest, measured).toFixed(1)} s)`;
  const note = sized
    ? `legs: ${vitestNote} on ${legs.vitest} legs of at most ${limit.vitest} s, ${selected.e2e.length} end-to-end files (${seconds(selected.e2e, measured).toFixed(1)} s) on ${legs.e2e} legs`
    : `legs: the full matrix, on ${run.event || "an unknown event"} with all of next/${validSha(run.base) ? "" : " and no base commit"}`;
  console.log(note);
  console.log(lines.join("\n"));
  const output = process.env["GITHUB_OUTPUT"];

  if (output !== undefined && output !== "") {
    appendFileSync(output, `${lines.join("\n")}\n`);
  }

  const summary = process.env["GITHUB_STEP_SUMMARY"];

  if (summary !== undefined && summary !== "") {
    appendFileSync(summary, `${note}\n`);
  }
}
