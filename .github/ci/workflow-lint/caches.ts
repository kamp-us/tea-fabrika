// Today's CI, serving both versions. The caches (C1 to C4): saved on main only, the shared setup
// never saves, full-history checkouts are blobless, and the typecheck's buildinfo cache.
import { globSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { parse } from "yaml";
import { compact, map, steps, uses } from "./shared.ts";

const lines = (value: unknown) =>
  typeof value === "string"
    ? value
        .split("\n")
        .map((line) => line.trim())
        .filter((line) => line !== "")
    : [];

/** The files the cache lint reads, each as its text. */
export interface CacheFiles {
  /** Each workflow by its path, check.yaml among them. */
  readonly workflows: Readonly<Record<string, string>>;
  /** .github/actions/pnpm/action.yml, the one setup every pnpm job uses. */
  readonly action: string;
  readonly workspace: string;
  readonly typecheck: string;
}

// A cache is saved on main only: a pull request runs on refs/pull/<n>/merge and a merge queue group
// on gh-readonly-queue/main/..., so only a push to main has this ref here. Any ref can restore
// main's, and a copy per pull request or group filled the repository's 10 GB
// (.github/actions/pnpm/action.yml says when).
/** A path that names pnpm's store: its default folders, a `.pnpm-store`, or `pnpm store path`'s answer. */
const PNPM_STORE = /pnpm[\s\S]*store|store[\s\S]*pnpm/i;

const ON_MAIN = "github.ref=='refs/heads/main'";
// scripts/typecheck.sh's buildinfo path, relative to each package.
const BUILDINFO = /"--tsBuildInfoFile",\s*"([^"]+)"/;
const TSC_HASH = "git ls-files -s pnpm-lock.yaml '*tsconfig*.json' | git hash-object --stdin";
const TSC_PREFIX = `tsc-\${{ runner.os }}-\${{ steps.tsc-key.outputs.hash }}-`;
const TSC_SAVED = `\${{ steps.tsc.outputs.cache-primary-key }}`;

export const lintCaches = (files: CacheFiles): string[] => {
  const errors: string[] = [];
  const require = (holds: boolean, reason: string) => {
    if (!holds) {
      errors.push(reason);
    }
  };
  let action: Record<string, unknown>, workspace: Record<string, unknown>;
  const workflows: [string, Record<string, unknown>][] = [];

  try {
    action = map(parse(files.action));
    workspace = map(parse(files.workspace));

    for (const [path, text] of Object.entries(files.workflows)) {
      workflows.push([path, map(parse(text))]);
    }
  } catch {
    return ["cache lint: a file is not valid YAML"];
  }

  const actionSteps = steps(map(action["runs"]));
  // Only a workflow that runs for a pull request or a merge queue group saves on a ref of its own.
  const perRef = workflows.filter(([, workflow]) => {
    const on = workflow["on"];
    return ["pull_request", "merge_group"].some((event) =>
      Array.isArray(on) ? on.includes(event) : on === event || event in map(on),
    );
  });
  const everyStep: [string, Record<string, unknown>][] = [
    // SAFETY: the arrow builds a two-item array of a path and a step, and the cast names it as that tuple.
    ...actionSteps.map((step) => [".github/actions/pnpm/action.yml", step] as [string, Record<string, unknown>]),
    ...perRef.flatMap(([path, workflow]) =>
      Object.values(map(workflow["jobs"])).flatMap((job) =>
        // SAFETY: `steps` returns each step as a map, so the pair here is a path and a step map, as the tuple says.
        steps(map(job)).map((step) => [path, step] as [string, Record<string, unknown>]),
      ),
    ),
  ];

  // C1. actions/cache cannot be told to restore only: it saves from whatever ref it runs on.
  for (const [path, step] of everyStep) {
    require(!uses(step, "actions/cache"), `${path}: use actions/cache/restore, and actions/cache/save on main only`);
  }

  // C1b. A pnpm store cache did not pay on any ref, main included (action.yml gives the seconds),
  // so no workflow keeps one: not setup-node's own cache, not pnpm/action-setup's, and no cache
  // step whose path is the store.
  const allSteps: [string, Record<string, unknown>][] = [
    // SAFETY: the setup action's own steps, paired with action.yml's path: a literal two-item path-and-step tuple.
    ...actionSteps.map((step) => [".github/actions/pnpm/action.yml", step] as [string, Record<string, unknown>]),
    ...workflows.flatMap(([path, workflow]) =>
      Object.values(map(workflow["jobs"])).flatMap((job) =>
        // SAFETY: each workflow step comes from `steps`, which answers maps, so this pair is the tuple it is cast to.
        steps(map(job)).map((step) => [path, step] as [string, Record<string, unknown>]),
      ),
    ),
  ];

  for (const [path, step] of allSteps) {
    require(!(
      uses(step, "actions/setup-node") && "cache" in map(step["with"])
    ), `${path}: setup-node's cache is a pnpm store cache; use .github/actions/pnpm`);
    require(!(
      uses(step, "pnpm/action-setup") && "cache" in map(step["with"])
    ), `${path}: pnpm/action-setup's cache is a pnpm store cache; use .github/actions/pnpm`);
  }

  // The shared setup's own cache steps are C2's: it caches nothing at all.
  for (const [path, step] of allSteps.filter(([at]) => at !== ".github/actions/pnpm/action.yml")) {
    const cache = ["actions/cache", "actions/cache/save", "actions/cache/restore"].some((name) => uses(step, name));
    require(!(
      cache && PNPM_STORE.test(String(map(step["with"])["path"] ?? ""))
    ), `${path}: a cache of the pnpm store did not pay; use .github/actions/pnpm`);
  }

  // C2. The shared setup caches nothing: a restored pnpm store cost more than its download
  // (action.yml gives the seconds). Each save anywhere is on main.
  require(!actionSteps.some((step) =>
    String(step["uses"]).startsWith("actions/cache"),
  ), "the pnpm action caches nothing: a restored pnpm store cost more than its download");

  for (const [path, step] of everyStep.filter(([, s]) => uses(s, "actions/cache/save"))) {
    const condition = compact(step["if"]);
    require(condition === ON_MAIN ||
      condition.startsWith(`${ON_MAIN}&&`), `${path}: a cache save runs on main only, its if starting ${ON_MAIN}`);
  }

  const check = map(workflows.find(([path]) => path.endsWith("check.yaml"))?.[1]),
    jobs = map(check["jobs"]);

  // C3. A full-history checkout fetches every commit and tree, and only the head's files.
  for (const [name, job] of Object.entries(jobs)) {
    for (const step of steps(map(job)).filter((s) => uses(s, "actions/checkout"))) {
      const options = map(step["with"]);
      require(options["fetch-depth"] !== 0 ||
        options["filter"] ===
          "blob:none", `check.yaml: ${name}'s full-history checkout is blobless (filter: blob:none)`);
    }
  }

  // C4. The typecheck job's buildinfo cache. Its key and restore prefix both hold the lockfile and
  // every tsconfig, so a change to the compiler or its settings never starts from old answers; its
  // paths are where scripts/typecheck.sh writes, one per workspace package glob.
  const typecheckSteps = steps(map(jobs["typecheck"]));
  const buildinfo = BUILDINFO.exec(files.typecheck)?.[1];
  const folder = buildinfo?.slice(0, buildinfo.lastIndexOf("/"));
  const globs = Array.isArray(workspace["packages"]) ? workspace["packages"] : [];
  const paths = globs.map((glob) => `${String(glob)}/${folder}`);
  const keyStep = typecheckSteps.find((s) => s["id"] === "tsc-key");
  const restore = typecheckSteps.find((s) => s["id"] === "tsc");
  const save = typecheckSteps.find((s) => uses(s, "actions/cache/save") && map(s["with"])["key"] === TSC_SAVED);
  const at = (step: Record<string, unknown> | undefined) => (step === undefined ? -1 : typecheckSteps.indexOf(step));
  const install = typecheckSteps.find((s) => s["run"] === "pnpm install --frozen-lockfile");
  const run = typecheckSteps.find((s) => s["run"] === "pnpm typecheck");
  require(folder !== undefined && folder !== "", "scripts/typecheck.sh passes --tsBuildInfoFile under a folder");
  require(keyStep?.["run"] ===
    `echo "hash=$(${TSC_HASH})" >> "$GITHUB_OUTPUT"`, `check.yaml: the typecheck job's tsc-key step hashes ${TSC_HASH}`);
  require(restore !== undefined &&
    uses(restore, "actions/cache/restore") &&
    map(restore["with"])["key"] === `${TSC_PREFIX}\${{ github.sha }}` &&
    map(restore["with"])["restore-keys"] ===
      TSC_PREFIX, `check.yaml: the tsc cache's key is ${TSC_PREFIX}<sha>, and it restores only that prefix`);
  require(JSON.stringify(lines(map(restore?.["with"])["path"])) === JSON.stringify(paths) &&
    JSON.stringify(lines(map(save?.["with"])["path"])) ===
      JSON.stringify(
        paths,
      ), `check.yaml: the tsc cache restores and saves ${folder} in each pnpm-workspace.yaml package glob, in its order`);
  require(at(install) >= 0 &&
    at(install) < at(keyStep) &&
    at(keyStep) < at(restore) &&
    at(restore) < at(run) &&
    at(run) < at(save), "check.yaml: the typecheck job installs, restores the tsc cache, typechecks, then saves");

  return errors;
};

/** The checked-in files lintCaches reads, through a reader of repo-relative paths. */
export const cacheFiles = (read: (path: string) => string): CacheFiles => ({
  workflows: Object.fromEntries(
    globSync([".github/workflows/*.yaml", ".github/workflows/*.yml"], {
      cwd: fileURLToPath(new URL("../../../", import.meta.url)),
    })
      .toSorted()
      .map((path) => [path, read(path)]),
  ),
  action: read(".github/actions/pnpm/action.yml"),
  workspace: read("pnpm-workspace.yaml"),
  typecheck: read("scripts/typecheck.sh"),
});
