import { readFileSync } from "node:fs";
import * as fc from "fast-check";
import { expect, it } from "vitest";
import { lintIssues } from "./issues.ts";

// Today's CI, serving both versions. Covers issues.ts: who may touch issues.
const options = { seed: 119120, numRuns: 100 };
const read = (path: string) => readFileSync(new URL(`../../workflows/${path}`, import.meta.url), "utf8");

// 0534's binding constraint: the only issues automation opens here are the scheduled report's.
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

it("pinned: the real workflows grant issues nowhere but scheduled.yaml", () => {
  const workflows = Object.fromEntries(
    ["check.yaml", "host.yaml", "mutation.yaml", "scheduled.yaml"].map((name) => [
      `.github/workflows/${name}`,
      read(name),
    ]),
  );
  expect(lintIssues(workflows)).toEqual([]);
});

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
      expect(lintIssues(files)).toEqual([`${path}: only scheduled.yaml's report job may touch issues (0534)`]);
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
