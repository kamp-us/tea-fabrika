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
  // mutation.yaml runs by hand on main, so its setup-node cache saves on main.
  const perRef = workflows.filter(([, workflow]) => {
    const on = workflow["on"];
    return ["pull_request", "merge_group"].some((event) =>
      Array.isArray(on) ? on.includes(event) : on === event || event in map(on),
    );
  });
  const everyStep: [string, Record<string, unknown>][] = [
    ...actionSteps.map((step) => [".github/actions/pnpm/action.yml", step] as [string, Record<string, unknown>]),
    ...perRef.flatMap(([path, workflow]) =>
      Object.values(map(workflow["jobs"])).flatMap((job) =>
        steps(map(job)).map((step) => [path, step] as [string, Record<string, unknown>]),
      ),
    ),
  ];

  // C1. Neither of these can be told to restore only: each saves from whatever ref it runs on.
  for (const [path, step] of everyStep) {
    require(!uses(step, "actions/cache"), `${path}: use actions/cache/restore, and actions/cache/save on main only`);
    require(!(
      uses(step, "actions/setup-node") && "cache" in map(step["with"])
    ), `${path}: setup-node's cache saves on every ref; use .github/actions/pnpm`);
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
