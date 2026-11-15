import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import { availableParallelism } from "node:os";
import { basename, isAbsolute, join, relative } from "node:path";
import { configDefaults, defineConfig, type Plugin } from "vitest/config";
import { parseCLI } from "vitest/node";
import { isScript, isTest, load, reached } from "./oxlint-plugins/script-reads.mjs";
import packageJson from "./package.json" with { type: "json" };
import { changedFiles } from "./vitest.changed.ts";
import { Shards } from "./vitest.shards.ts";

// Today's version's tests. It is frozen, and no CI job runs them (0525, 0533); they run on the laptop.
const TODAY = ["apps/*/src/**/*.test.ts", "packages/*/src/**/*.test.ts", "programs/*/src/**/*.test.ts"];

// The tooling tests: those of neither version's product code.
const TOOLING = [
  "oxlint-plugins/*.test.ts",
  "vitest.shards.test.ts",
  "vitest.changed.test.ts",
  ".github/ci/*.test.ts",
  // workflow-lint's families of laws, each test file beside its module.
  ".github/ci/workflow-lint/*.test.ts",
  "scripts/*.test.ts",
  // Any depth, so the flow runner's tests under `lead/scripts/flow/` run, as 0089's hourly
  // mutation run reads them (`flow/**/*.test.ts`).
  // A skill's `fixtures/` is excluded below.
  ".agents/skills/*/scripts/**/*.test.ts",
];

// next/'s tests, by the layer they test against (0536). A file's name says which: a test that drives
// a real resource (a SQLite file, git, workerd, a spawned process, a socket, a bundler, temp files)
// is `*.integration.test.ts`, and one that drives a browser or Electron is `*.visual.test.ts`, each
// beside the module it tests. Every other `next/` test runs on our interfaces' in-memory layers.
// The lint rule `fabrika/integration-test-name` holds the names (oxlint-plugins/README.md).
const NEXT = [
  "next/packages/*/src/**/*.test.{ts,tsx}",
  "next/programs/*/src/**/*.test.{ts,tsx}",
  "next/apps/*/src/**/*.test.{ts,tsx}",
];

const INTEGRATION = ["next/**/*.integration.test.{ts,tsx}"];
const VISUAL = ["next/**/*.visual.test.{ts,tsx}"];

// A toy repo's tests under a skill's scripts are its subject, as with `fixtures/` above.
const EXCLUDE = [...configDefaults.exclude, ".agents/skills/*/scripts/**/fixtures/**", "next/**/dist/**"];

// What every project shares. Importing it never runs the local CLI guard.
const shared = {
  setupFiles: ["./scripts/vitest.setup.ts"],
  // A changed trigger selects every test in CI. Tests read these files without importing them.
  // `--changed` swaps a lockfile, `tsconfig*.json` or `package.json` it can tie to packages for
  // those packages' tests, and leaves the rest to select all (vitest.changed.ts).
  // `.github/` is not one (0534): no next/ test reads it, so a CI change no longer runs all of
  // next/, and the tooling tests that read it reach it through `githubReads` below.
  forceRerunTriggers: [
    ...configDefaults.forceRerunTriggers,
    "**/pnpm-lock.yaml",
    "**/pnpm-workspace.yaml",
    "**/tsconfig*.json",
    "**/.oxlintrc.json",
    "**/.oxfmtrc.json",
    "**/oxlint-plugins/**",
    "**/layer-rules.json",
    "**/fixtures/**",
    "**/.gitattributes",
  ],
  // One time limit for every test, chosen from measured times, not vitest's 5 s default,
  // which turned main red 6 times for slow tests and found no bug (experiment 125).
  // Measured on 2026-10-24: the slowest test in 128 CI runs took 17.9 s (60 s is 3.3 times
  // that); with two whole suites side by side on one laptop, the slowest took 28.4 s (60 s
  // is 2.1 times that). A test does not set its own limit to get room on a busy machine; if
  // tests grow slower, measure again and change this number.
  testTimeout: 60_000,
  // The same limit for a `beforeAll` or `afterAll`, for the same reason, not vitest's 10 s
  // default, which failed a git set-up on CI once with no bug (code-host-local). A hook is
  // set-up for its tests, so it gets their limit. Measured on 2026-10-24 with three whole
  // suites side by side: no file's hooks took more than 1.5 s in all.
  hookTimeout: 60_000,
  // `--shard` gives each machine about the same seconds, from measured times, not the same count
  // of files (vitest.shards.ts).
  sequence: { sequencer: Shards },
};

// Shared by local Vitest and Stryker's config: one run over every package, which the default export
// splits into its projects. `fixtures/` holds toy repos with their own `node --test` files. They are
// the quest's subject, not this repo's tests.
export const testConfig = {
  test: { ...shared, include: [...TODAY, ...TOOLING, ...NEXT, ...INTEGRATION, ...VISUAL], exclude: EXCLUDE },
};

// Use Vitest's installed matcher, including its dot-path behavior.
const match = createRequire(import.meta.resolve("vitest/package.json"))("picomatch");
const workers = Number(process.env.FABRIKA_MAX_WORKERS ?? 3);

if (!Number.isInteger(workers) || workers < 1) {
  throw new Error("FABRIKA_MAX_WORKERS must be a positive integer");
}

const localLimits = () => {
  if (!/^vitest(?:\.[cm]?js)?$/.test(basename(process.argv[1] ?? ""))) {
    return;
  }

  const pinned = packageJson.engines.node;

  if (!process.env.CI && process.versions.node !== pinned) {
    throw new Error(
      `Local test run refused. Running Node ${process.version}; pinned Node v${pinned}. Use: volta run --node ${pinned} pnpm exec vitest run --maxWorkers=1 <narrow path>`,
    );
  }

  const cli = parseCLI(["vitest", ...process.argv.slice(2)], { allowUnknownOptions: true });
  const narrow = (filter: string) => {
    const path = isAbsolute(filter) ? relative(process.cwd(), filter) : filter.replace(/^\.\//, "");
    return !/[*?[\]{}]/.test(path) && /(?:^|\/)[^/]+\.test\.[cm]?[jt]sx?(?::[\d-]+)?$/.test(path);
  };

  if (!process.env.CI && !(cli.filter.length > 0 && cli.filter.every(narrow))) {
    const changed = cli.options.changed;
    // The same three sets as Vitest 5.0.5's GitVCSProvider. A net diff loses staged
    // changes canceled in the worktree; two endpoints lose divergent branch changes.
    const commands = [
      ...(typeof changed === "string" ? [["diff", "--name-only", "-z", `${changed}...HEAD`]] : []),
      ["diff", "--cached", "--name-only", "-z"],
      ["ls-files", "-z", "--other", "--modified", "--exclude-standard"],
    ];
    const diffs = changed === undefined ? [] : commands.map((args) => spawnSync("git", args, { encoding: "utf8" }));
    const forced = diffs.some((diff) =>
      diff.stdout
        .split("\0")
        .some((path) => path && match.isMatch(path, testConfig.test.forceRerunTriggers, { dot: true })),
    );

    if (changed === undefined || diffs.some((diff) => diff.status !== 0) || forced) {
      throw new Error("Local broad test run refused. Use: pnpm exec vitest run --maxWorkers=1 <narrow path>");
    }
  }

  const value = cli.options.maxWorkers ?? workers;
  // Vitest resolves percentages against availableParallelism, rounded and clamped.
  const requested =
    typeof value === "string" && value.trim().endsWith("%")
      ? Math.max(
          1,
          Math.min(availableParallelism(), Math.round((Number.parseInt(value, 10) / 100) * availableParallelism())),
        )
      : Number(value);

  if (!Number.isInteger(requested) || requested < 1 || requested > workers) {
    throw new Error("--maxWorkers exceeds FABRIKA_MAX_WORKERS or is invalid");
  }

  return { test: { maxWorkers: requested } };
};

const root = import.meta.dirname;

// A lead-script test starts its scripts as child processes, which Vitest's import graph cannot see.
// The files each one reaches are derived from the scripts (oxlint-plugins/script-reads.mjs) and
// handed to Vitest as watched files, which its `--changed` and `--related` walk follows as edges.
// Nothing is declared in a test.
const scriptReads: Plugin = {
  name: "fabrika-script-reads",
  transform(_code, id) {
    const path = relative(root, id);

    if (isScript(path) && isTest(path)) {
      const { tree, exists } = load(root);

      for (const file of reached(tree, exists, path).keys()) {
        this.addWatchFile(join(root, file));
      }
    }

    return null;
  },
};

/** A visual test's limit: Vitest's own 5 s times 24, the one the end-to-end runner gave each file. */
const VISUAL_LIMIT = 120_000;

// One Vitest project per layer, picked by `--project` (0536). Pull requests and the merge queue run
// `next`; the 3-hour schedule runs `next-integration` and `next-visual` too; a pull request runs
// `next-visual` only when it carries the `visual` label (check.yaml). The tooling tests are their
// own project and today's version's theirs (`today`), so `--project tooling` leaves today's out.
// The visual project starts one file at a time, since each starts a brain, Chromium or Electron,
// and keeps no setup file, as the end-to-end runner did. A file is in exactly one project: `next`
// leaves the other two names out.
export const projects = [
  { extends: true, test: { name: "today", include: [...TODAY], exclude: [...EXCLUDE] } },
  { extends: true, test: { name: "tooling", include: [...TOOLING], exclude: [...EXCLUDE] } },
  { extends: true, test: { name: "next", include: [...NEXT], exclude: [...EXCLUDE, ...INTEGRATION, ...VISUAL] } },
  { extends: true, test: { name: "next-integration", include: [...INTEGRATION], exclude: [...EXCLUDE] } },
  {
    extends: false,
    test: {
      name: "next-visual",
      root: import.meta.dirname,
      include: [...VISUAL],
      exclude: [...EXCLUDE],
      maxWorkers: 1,
      fileParallelism: false,
      testTimeout: VISUAL_LIMIT,
      hookTimeout: VISUAL_LIMIT,
    },
  },
];

// A tooling test that reads CI's files as text (check.yaml, the pnpm action, the CI scripts) names
// them in its source: `.github/...` from the top, or `../workflows/...` beside it. Each such test
// outside next/ gets every file under `.github/` as a watched file, so `--changed` picks it when one
// changes, now that `.github/` is no rerun trigger (0534). A name in a comment or a fixture counts,
// as in `scriptReads`: that over-matches, which reruns a test and never misses one. next/ is left
// out: none of its tests reads `.github/`, and the merge line runs none of next/ for a CI change.
const GITHUB_NAME = /\.github\/|\bworkflows\//;
let githubFiles: string[] | undefined;

const githubReads: Plugin = {
  name: "fabrika-github-reads",
  transform(code, id) {
    const path = relative(root, id);

    if (isTest(path) && !path.startsWith("next/") && GITHUB_NAME.test(code)) {
      // The tracked ones: a diff, and so `--changed`, only ever names those.
      githubFiles ??= spawnSync("git", ["ls-files", "-z", "--", ".github"], { cwd: root, encoding: "utf8" })
        .stdout.split("\0")
        .filter((file) => file !== "")
        .map((file) => join(root, file));

      for (const file of githubFiles) {
        this.addWatchFile(file);
      }
    }

    return null;
  },
};

// vitest.shards.ts reads its table, vitest.shards.json, from disk, so that a row edit is no file the
// config imports, which would select every test. The table is that module's watched file here, so
// `--changed` follows it as an edge: a row edit selects the tests that import vitest.shards.ts.
const shardTable: Plugin = {
  name: "fabrika-shard-table",
  transform(_code, id) {
    if (relative(root, id) === "vitest.shards.ts") {
      this.addWatchFile(join(root, "vitest.shards.json"));
    }

    return null;
  },
};

export default defineConfig({
  test: {
    ...shared,
    maxWorkers: workers,
    projects: [...projects],
    // What `--changed` starts from: git's changed files, with a lockfile, tsconfig or package.json
    // change narrowed to the packages it reaches (vitest.changed.ts). Vitest reads it from the root.
    experimental: { vcsProvider: changedFiles },
  },
  // Vite runs this hook only while resolving a run. Importers can merge or spread the object.
  plugins: [
    { name: "fabrika-local-test-limits", enforce: "post", config: localLimits },
    scriptReads,
    githubReads,
    shardTable,
  ],
});
