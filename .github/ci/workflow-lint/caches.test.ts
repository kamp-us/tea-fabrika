import { readFileSync } from "node:fs";
import { Record as Rec } from "effect";
import { expect, it } from "vitest";
import { parse } from "yaml";
import { cacheFiles, lintCaches } from "./caches.ts";
import { type Parsed, place, step } from "./wiring.test-support.ts";

// Today's CI, serving both versions. Covers caches.ts. The caches: saved on main only, the shared
// setup never saves, full-history checkouts are blobless, and the typecheck's buildinfo cache keys
// on the lockfile and every tsconfig.
type Files = { workflows: Record<string, Parsed>; action: Parsed; workspace: Parsed; typecheck: string };

const realFiles = (): Files => {
  const read = (path: string) => readFileSync(new URL(`../../../${path}`, import.meta.url), "utf8");
  const files = cacheFiles(read);

  return {
    workflows: Rec.fromEntries(Rec.toEntries(files.workflows).map(([path, text]) => [path, parse(text)])),
    action: parse(files.action),
    workspace: parse(files.workspace),
    typecheck: files.typecheck,
  };
};

const text = (files: Files) => ({
  workflows: Rec.fromEntries(Rec.toEntries(files.workflows).map(([path, w]) => [path, JSON.stringify(w)])),
  action: JSON.stringify(files.action),
  workspace: JSON.stringify(files.workspace),
  typecheck: files.typecheck,
});

const checkYaml = (files: Files) => files.workflows[".github/workflows/check.yaml"]!;

const typecheckStep = (files: Files, name: string) => step(checkYaml(files), "typecheck", name);

// The shared setup's steps, read as the one job of a workflow.
const setup = (files: Files) => ({ jobs: { setup: files.action.runs } });

it("C0: the checked-in workflows, setup, workspace and typecheck pass the cache lint", () => {
  expect(lintCaches(text(realFiles()))).toEqual([]);
});

it("C0 state: the workflow that runs by hand on main uses the shared setup, which caches nothing", () => {
  const files = realFiles();
  const mutation = files.workflows[".github/workflows/mutation.yaml"];
  expect(mutation?.["on"]).not.toHaveProperty("pull_request");
  expect(JSON.stringify(mutation)).not.toContain('"cache":"pnpm"');
  expect(JSON.stringify(mutation)).toContain('"uses":"./.github/actions/pnpm"');
  expect(lintCaches(text(files))).toEqual([]);
});

// Each plant on the checked-in files, one at a time, and the one error it must give.
for (const [name, plant, error] of [
  [
    "C1: actions/cache, which saves on every ref",
    (f: Files) => {
      step(f.workflows[".github/workflows/host.yaml"]!, "launchd", "restore electron")["uses"] = "actions/cache@v6";
    },
    ".github/workflows/host.yaml: use actions/cache/restore, and actions/cache/save on main only",
  ],
  [
    "C1: setup-node's own cache in the shared setup",
    (f: Files) => {
      step(setup(f), "setup", "node").with!["cache"] = "pnpm";
    },
    ".github/actions/pnpm/action.yml: setup-node's cache is a pnpm store cache; use .github/actions/pnpm",
  ],
  [
    "C1b: setup-node's own cache in a workflow that runs on main only",
    (f: Files) => {
      const jobs = Rec.values(
        f.workflows[".github/workflows/mutation.yaml"]!["jobs"] as Record<string, { steps: unknown[] }>,
      );

      jobs[0]!.steps.push({ uses: "actions/setup-node@v7", with: { "node-version": "26.13.0", cache: "pnpm" } });
    },
    ".github/workflows/mutation.yaml: setup-node's cache is a pnpm store cache; use .github/actions/pnpm",
  ],
  [
    "C1b: pnpm/action-setup's own cache in the shared setup",
    (f: Files) => {
      step(setup(f), "setup", "pnpm").with!["cache"] = true;
    },
    ".github/actions/pnpm/action.yml: pnpm/action-setup's cache is a pnpm store cache; use .github/actions/pnpm",
  ],
  [
    "C1b: pnpm/action-setup's own cache in a workflow that runs on main only",
    (f: Files) => {
      const jobs = Rec.values(
        f.workflows[".github/workflows/mutation.yaml"]!["jobs"] as Record<string, { steps: unknown[] }>,
      );

      jobs[0]!.steps.push({ uses: "pnpm/action-setup@v6", with: { run_install: false, cache: true } });
    },
    ".github/workflows/mutation.yaml: pnpm/action-setup's cache is a pnpm store cache; use .github/actions/pnpm",
  ],
  [
    "C1b: a main-only save of the pnpm store",
    (f: Files) => {
      const jobs = Rec.values(
        f.workflows[".github/workflows/mutation.yaml"]!["jobs"] as Record<string, { steps: unknown[] }>,
      );

      jobs[0]!.steps.push({
        uses: "actions/cache/save@v6",
        if: `\${{ github.ref == 'refs/heads/main' }}`,
        with: { path: "~/.local/share/pnpm/store", key: "store" },
      });
    },
    ".github/workflows/mutation.yaml: a cache of the pnpm store did not pay; use .github/actions/pnpm",
  ],
  [
    "C2: the shared setup saving on main",
    (f: Files) => {
      f.action.runs.steps.push({ uses: "actions/cache/save@v6", if: `\${{ github.ref == 'refs/heads/main' }}` });
    },
    "the pnpm action caches nothing: a restored pnpm store cost more than its download",
  ],
  [
    "C2: the shared setup restoring the store",
    (f: Files) => {
      f.action.runs.steps.push({ uses: "actions/cache/restore@v6", with: { path: "~/.local/share/pnpm/store" } });
    },
    "the pnpm action caches nothing: a restored pnpm store cost more than its download",
  ],
  [
    "C2: a save with no if",
    (f: Files) => {
      delete typecheckStep(f, "save the tsc cache")["if"];
    },
    ".github/workflows/check.yaml: a cache save runs on main only, its if starting github.ref=='refs/heads/main'",
  ],
  [
    "C2: a save on every ref after a failure",
    (f: Files) => {
      typecheckStep(f, "save the tsc cache")["if"] = `\${{ always() }}`;
    },
    ".github/workflows/check.yaml: a cache save runs on main only, its if starting github.ref=='refs/heads/main'",
  ],
  [
    "C3: a full-history checkout with every blob",
    (f: Files) => {
      const steps = checkYaml(f).jobs["next"]!.steps;
      delete steps.find((s) => String(s["uses"]).startsWith("actions/checkout@"))!.with!["filter"];
    },
    "check.yaml: next's full-history checkout is blobless (filter: blob:none)",
  ],
  [
    "C4: a restore prefix without the lockfile and tsconfig hash",
    (f: Files) => {
      typecheckStep(f, "restore the tsc cache").with!["restore-keys"] = `tsc-\${{ runner.os }}-`;
    },
    `check.yaml: the tsc cache's key is tsc-\${{ runner.os }}-\${{ steps.tsc-key.outputs.hash }}-<sha>, and it restores only that prefix`,
  ],
  [
    "C4: a hash that leaves the tsconfigs out",
    (f: Files) => {
      typecheckStep(f, "tsc key")["run"] =
        'echo "hash=$(git ls-files -s pnpm-lock.yaml | git hash-object --stdin)" >> "$GITHUB_OUTPUT"';
    },
    "check.yaml: the typecheck job's tsc-key step hashes git ls-files -s pnpm-lock.yaml '*tsconfig*.json' | git hash-object --stdin",
  ],
  [
    "C4: a workspace package glob the cache does not hold",
    (f: Files) => {
      (f.workspace["packages"] as string[]).push("tools/*");
    },
    "check.yaml: the tsc cache restores and saves node_modules/.cache/tsc in each pnpm-workspace.yaml package glob, in its order",
  ],
  [
    "C4: a buildinfo folder the cache does not hold",
    (f: Files) => {
      f.typecheck = f.typecheck.replace("node_modules/.cache/tsc/", "node_modules/.cache/tsc-old/");
    },
    "check.yaml: the tsc cache restores and saves node_modules/.cache/tsc-old in each pnpm-workspace.yaml package glob, in its order",
  ],
  [
    "C4: a restore after the typecheck",
    (f: Files) => {
      const workflow = checkYaml(f);
      const list = workflow.jobs["typecheck"]!.steps;
      const [restore] = list.splice(place(workflow, "typecheck", "restore the tsc cache"), 1);
      list.splice(place(workflow, "typecheck", "typecheck") + 1, 0, restore!);
    },
    "check.yaml: the typecheck job installs, restores the tsc cache, typechecks, then saves",
  ],
] as const) {
  it(`${name} is named by its one error`, () => {
    const files = realFiles();
    plant(files);
    expect(lintCaches(text(files))).toEqual([error]);
  });
}
