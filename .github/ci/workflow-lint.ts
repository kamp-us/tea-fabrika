// Today's CI, serving both versions. Static workflow shape belongs in lint. Each family of laws is
// its own module under workflow-lint/, with its test beside it; this file runs them all, in the
// order their messages print, and is what `pnpm lint` calls.
import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { Record as Rec, Result } from "effect";
import { parse } from "yaml";
import { cacheFiles, lintCaches } from "./workflow-lint/caches.ts";
import { changesJob } from "./workflow-lint/changes.ts";
import { checkJob } from "./workflow-lint/check-job.ts";
import { ciRequired } from "./workflow-lint/ci-required.ts";
import { lintCiSpeed } from "./workflow-lint/ci-speed.ts";
import { classifyStep } from "./workflow-lint/classify.ts";
import { failFast } from "./workflow-lint/fail-fast.ts";
import { lintHost } from "./workflow-lint/host.ts";
import { lintIssues } from "./workflow-lint/issues.ts";
import { jobLaws } from "./workflow-lint/jobs.ts";
import { lintNoTooling, mergeLine } from "./workflow-lint/merge-line.ts";
import { nextLaws } from "./workflow-lint/next-job.ts";
import { lintPlant } from "./workflow-lint/plant.ts";
import { record } from "./workflow-lint/record.ts";
import { lintScheduled } from "./workflow-lint/scheduled.ts";
import { ends, legs, map, nextJob, numbered, type Require, type Rule } from "./workflow-lint/shared.ts";
import { timeTables } from "./workflow-lint/time-tables.ts";
import { token } from "./workflow-lint/token.ts";
import { triggers } from "./workflow-lint/triggers.ts";
import { typecheckJob } from "./workflow-lint/typecheck-job.ts";

/** The next job's full vitest legs in a workflow's text, for the law on how the table splits. */
export const vitestLegs = (text: string): string[] => numbered(legs(nextJob(text)));

/** The next job's full end-to-end legs in a workflow's text, for the law on how many there are. */
export const e2eLegs = (text: string): string[] => ends(legs(nextJob(text)));

/** The next job's `timeout-minutes` in a workflow's text, for the same law: a leg gets half of it. */
export const nextMinutes = (text: string): number => Number(nextJob(text)["timeout-minutes"]);

// check.yaml's families of laws, in the order their messages print.
const CHECK_RULES: readonly Rule[] = [
  triggers,
  checkJob,
  jobLaws,
  failFast,
  ciRequired,
  changesJob,
  token,
  record,
  typecheckJob,
  classifyStep,
  mergeLine,
  nextLaws,
  timeTables,
];

export const lintWorkflow = (text: string): string[] => {
  const source = Result.try((): unknown => parse(text));

  if (Result.isFailure(source)) {
    return ["check.yaml: invalid YAML"];
  }

  const workflow = map(source.success);
  const errors: string[] = [];

  const require: Require = (holds, reason) => {
    if (!holds) {
      errors.push(`check.yaml: ${reason}`);
    }
  };

  for (const rule of CHECK_RULES) {
    rule({ workflow, on: map(workflow["on"]), jobs: map(workflow["jobs"]) }, require);
  }

  return errors;
};

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const ran = Result.try(() => {
    const read = (path: string) => readFileSync(new URL(`../../${path}`, import.meta.url), "utf8");
    const check = read(".github/workflows/check.yaml");
    const files = cacheFiles(read);

    const errors = [
      ...lintWorkflow(check),
      ...lintScheduled(read(".github/workflows/scheduled.yaml"), check),
      // T1 on the other workflows a pull request or the merge queue starts; lintWorkflow holds check.yaml.
      ...Rec.toEntries(files.workflows)
        .filter(([path]) => path !== ".github/workflows/check.yaml")
        .flatMap(([path, text]) => lintNoTooling(path, text)),
      ...lintIssues(files.workflows),
      ...lintCaches(files),
      ...lintCiSpeed(read(".github/workflows/ci-speed.yaml")),
      ...lintHost(read(".github/workflows/host.yaml")),
      ...lintPlant(read(".github/workflows/plant.yaml")),
    ];

    const manifest: unknown = JSON.parse(read("package.json"));

    const lint = String(map(map(manifest)["scripts"])["lint"]);

    if (!lint.includes("node .github/ci/workflow-lint.ts")) {
      errors.push("pnpm lint must run workflow-lint.ts");
    }

    // A pull request of ignored paths starts no run, so its rows are checked only here.
    if (!lint.includes("node .github/ci/field-check.ts --local")) {
      errors.push("pnpm lint must run field-check.ts --local: a pull request of rows alone starts no CI run");
    }

    if (!read("oxlint-plugins/lint.ts").includes('import { checkTracked } from "./gitignore.mjs"')) {
      errors.push("full lint must use the shared tracked-file check");
    }

    if (existsSync(new URL("./pnpm-lock.yaml", import.meta.url))) {
      errors.push("CI uses the workspace lockfile, never a second one");
    }

    for (const error of errors) {
      console.error(error);
    }

    console.log(`workflow-lint: ${errors.length} errors`);
    process.exitCode = errors.length === 0 ? 0 : 1;
  });

  if (Result.isFailure(ran)) {
    console.error("workflow-lint: input could not be read");
    process.exitCode = 2;
  }
}
