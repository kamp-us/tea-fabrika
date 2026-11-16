import { readFileSync } from "node:fs";
import * as Rec from "effect/Record";
import * as fc from "fast-check";
import { expect, it } from "vitest";
import { parse } from "yaml";
import { lintIssues } from "./issues.ts";

// Today's CI, serving both versions. Covers issues.ts: who may touch issues.
const options = { seed: 119120, numRuns: 100 };

const read = (path: string) => readFileSync(new URL(`../../workflows/${path}`, import.meta.url), "utf8");

type Step = Record<string, unknown> & { env?: Record<string, unknown>; with?: Record<string, unknown> };

type Job = Record<string, unknown> & {
  steps: Step[];
  strategy?: { "fail-fast"?: unknown; "max-parallel"?: unknown; matrix: { shard: unknown } };
  permissions?: unknown;
  needs?: unknown;
};

type Workflow = Record<string, unknown> & {
  on: Record<string, unknown>;
  concurrency: Record<string, unknown>;
  permissions: unknown;
  jobs: Record<string, Job>;
};

// 0534's and 0541's binding constraint: automation opens issues here from two jobs alone,
// scheduled.yaml's report and ci-speed.yaml's measure.
const RULE = "only scheduled.yaml's report job and ci-speed.yaml's measure job may touch issues (0534, 0541)";

const SCHEDULED = ".github/workflows/scheduled.yaml";

const SPEED = ".github/workflows/ci-speed.yaml";

const ALLOWED: Record<string, string> = { [SCHEDULED]: "report", [SPEED]: "measure" };

const grant = fc.constantFrom<unknown>(
  "write-all",
  { issues: "write" },
  { issues: "read" },
  { contents: "read", issues: "write" },
);

const other = fc.constantFrom(
  ".github/workflows/check.yaml",
  ".github/workflows/host.yaml",
  ".github/workflows/mutation.yaml",
  ".github/workflows/new.yaml",
);

const realWorkflows = () =>
  Rec.fromEntries(
    ["check.yaml", "host.yaml", "mutation.yaml", "scheduled.yaml", "ci-speed.yaml"].map((name) => [
      `.github/workflows/${name}`,
      read(name),
    ]),
  );

it("pinned: the real workflows grant issues nowhere but scheduled.yaml's report and ci-speed.yaml's measure", () => {
  expect(lintIssues(realWorkflows())).toEqual([]);
});

it("property: a job that touches issues passes only as one of the two named jobs, by its file and its name", () => {
  // Paths and job names are drawn from the two allowed pairs crossed with others, so a right file
  // with a wrong job, and a right job name in a wrong file, are both generated.
  const path = fc.constantFrom(SCHEDULED, SPEED, ".github/workflows/check.yaml", ".github/workflows/new.yaml");
  const name = fc.constantFrom("report", "measure", "next", "a");
  fc.assert(
    fc.property(path, name, grant, (file, job, given) => {
      const workflow = { on: { push: {} }, jobs: { [job]: { "runs-on": "ubuntu-latest", permissions: given } } };
      const allowed = ALLOWED[file] === job && given !== "write-all";
      expect(lintIssues({ [file]: JSON.stringify(workflow) })).toEqual(allowed ? [] : [`${file}: job ${job}: ${RULE}`]);
    }),
    options,
  );
});

it("property: a workflow-wide grant that touches issues fails in every file, the two named ones included", () => {
  const path = fc.constantFrom(SCHEDULED, SPEED, ".github/workflows/check.yaml", ".github/workflows/new.yaml");
  fc.assert(
    fc.property(path, grant, (file, given) => {
      const workflow = { on: { push: {} }, permissions: given, jobs: {} };
      expect(lintIssues({ [file]: JSON.stringify(workflow) })).toEqual([`${file}: the workflow's token: ${RULE}`]);
    }),
    options,
  );
});

// Plants on the real workflows, each on a fresh copy, so restoring is reading the files again.
for (const [label, plant, error] of [
  [
    "a third workflow asks for issues",
    (files: Record<string, string>) =>
      void (files[".github/workflows/third.yaml"] = JSON.stringify({
        on: { workflow_dispatch: {} },
        jobs: { notify: { "runs-on": "ubuntu-latest", permissions: { issues: "write" }, steps: [] } },
      })),
    `.github/workflows/third.yaml: job notify: ${RULE}`,
  ],
  [
    "a second job inside ci-speed.yaml asks for issues",
    (files: Record<string, string>) => {
      const speed = parse(files[SPEED]!) as Workflow;
      speed.jobs["again"] = { ...speed.jobs["measure"]!, steps: [] };
      files[SPEED] = JSON.stringify(speed);
    },
    `${SPEED}: job again: ${RULE}`,
  ],
  [
    "check.yaml's typecheck job asks for issues",
    (files: Record<string, string>) => {
      const check = parse(files[".github/workflows/check.yaml"]!) as Workflow;
      check.jobs["typecheck"]!.permissions = { contents: "read", issues: "write" };
      files[".github/workflows/check.yaml"] = JSON.stringify(check);
    },
    `.github/workflows/check.yaml: job typecheck: ${RULE}`,
  ],
] as const) {
  it(`scenario: ${label} is named by its one error`, () => {
    const files = realWorkflows();
    plant(files);
    expect(lintIssues(files)).toEqual([error]);
    expect(lintIssues(realWorkflows())).toEqual([]);
  });
}

it("property: any other workflow that grants issues, at the top or on a job, is named", () => {
  fc.assert(
    fc.property(other, grant, fc.boolean(), (path, given, onJob) => {
      const workflow: Record<string, unknown> = {
        on: { push: {} },
        jobs: { a: { "runs-on": "ubuntu-latest", steps: [] } },
      };

      if (onJob) {
        (workflow["jobs"] as Record<string, Record<string, unknown>>)["a"]!["permissions"] = given;
      } else {
        workflow["permissions"] = given;
      }

      const files = { [path]: JSON.stringify(workflow), ".github/workflows/scheduled.yaml": read("scheduled.yaml") };
      expect(lintIssues(files)).toEqual([onJob ? `${path}: job a: ${RULE}` : `${path}: the workflow's token: ${RULE}`]);
      // The same workflow with a grant that leaves issues alone is fine.
      const clean = structuredClone(workflow);

      if (onJob) {
        (clean["jobs"] as Record<string, Record<string, unknown>>)["a"]!["permissions"] = { contents: "read" };
      } else {
        clean["permissions"] = { contents: "read" };
      }

      expect(lintIssues({ [path]: JSON.stringify(clean) })).toEqual([]);
    }),
    options,
  );
});
