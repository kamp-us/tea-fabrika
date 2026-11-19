import { readFileSync } from "node:fs";
import { expect, it } from "vitest";
import { parse } from "yaml";
import { lintHost } from "./host.ts";
import { allSteps, compact, map } from "./shared.ts";

const hostFile = (): Record<string, unknown> =>
  map(parse(readFileSync(new URL("../../workflows/host.yaml", import.meta.url), "utf8")));

const job = (workflow: Record<string, unknown>, name: string) => map(map(workflow["jobs"])[name]);

const input = (workflow: Record<string, unknown>) => map(map(map(workflow["on"])["workflow_dispatch"])["inputs"]);

const run = (workflow: Record<string, unknown>) =>
  allSteps(job(workflow, "e88-r6")).find((step) => step["name"] === "E88 R6")!;

const boxRun = (workflow: Record<string, unknown>) =>
  allSteps(job(workflow, "box")).find((step) => step["name"] === "Box laws")!;

const p8Steps = (workflow: Record<string, unknown>) => allSteps(job(workflow, "p8"));

const p8Run = (workflow: Record<string, unknown>) => p8Steps(workflow).find((step) => step["name"] === "P8 law")!;

const p8Proof = (workflow: Record<string, unknown>) => p8Steps(workflow).find((step) => step["name"] === "P8 proof")!;

it("format: host.yaml keeps L13 as default and exposes the fixed E88 R6, box and P8 dispatches", () => {
  expect(lintHost(JSON.stringify(hostFile()))).toEqual([]);
});

it("scenario: path and mapping order do not change the host workflow's meaning", () => {
  const workflow = hostFile();
  const pull = map(map(workflow["on"])["pull_request"]);
  const paths = pull["paths"];

  if (!Array.isArray(paths)) {
    throw new Error("host workflow has no pull-request paths");
  }

  pull["paths"] = paths.toReversed();
  const proof = allSteps(job(workflow, "e88-r6")).find((step) => step["name"] === "E88 R6 proof")!;
  proof["with"] = Object.fromEntries(Object.entries(map(proof["with"])).toReversed());
  expect(lintHost(JSON.stringify(workflow))).toEqual([]);
});

it("scenario: different suites keep separate groups and newer pushes retain their own PR group", () => {
  const configured = String(map(hostFile()["concurrency"])["group"]);

  const group = (sha: string, suite?: string, pr?: number) =>
    configured.replace(/\$\{\{(.+?)\}\}/g, (_, expression: string) => {
      switch (compact(expression)) {
        case "github.event.pull_request.number||github.sha":
          return String(pr ?? sha);
        case "inputs.suite||'l13'":
          return suite || "l13";
        default:
          throw new Error("host concurrency uses an unverified expression");
      }
    });

  expect(new Set(["l13", "e88-r6", "box", "p8"].map((suite) => group("same-head", suite))).size).toBe(4);

  for (const suite of ["l13", "e88-r6", "box", "p8"]) {
    expect(group("old-head", suite, 1128)).toBe(group("new-head", suite, 1128));
  }

  expect(group("old-head", undefined, 1128)).toBe(group("new-head", "l13", 1128));
  expect(group("old-head", "", 1128)).toBe(group("new-head", "l13", 1128));
  expect(group("same-head")).toBe(group("same-head", "l13"));
  expect(group("same-head", "box")).not.toBe(group("new-head", "box"));
});

for (const [name, plant, rule] of [
  [
    "a free-text test input",
    (w) => {
      map(input(w)["suite"])["type"] = "string";
    },
    "H1",
  ],
  [
    "an arbitrary path input",
    (w) => {
      input(w)["files"] = { type: "string" };
    },
    "H1",
  ],
  [
    "E88 becomes the default",
    (w) => {
      map(input(w)["suite"])["default"] = "e88-r6";
    },
    "H1",
  ],
  [
    "another suite",
    (w) => {
      map(input(w)["suite"])["options"] = ["l13", "e88-r6", "box", "p8", "all"];
    },
    "H1",
  ],
  [
    "p8 missing from the suite's options",
    (w) => {
      map(input(w)["suite"])["options"] = ["l13", "e88-r6", "box"];
    },
    "H1",
  ],
  [
    "L13 loses its automatic trigger",
    (w) => {
      delete map(w["on"])["pull_request"];
    },
    "H2",
  ],
  [
    "L13 loses its default route",
    (w) => {
      delete job(w, "launchd")["if"];
    },
    "H2",
  ],
  [
    "L13 runs a different file",
    (w) => {
      allSteps(job(w, "launchd")).find((step) => step["name"] === "L13")!["run"] = "pnpm exec vitest run other.test.ts";
    },
    "H2",
  ],
  [
    "R6 runs on every event",
    (w) => {
      delete job(w, "e88-r6")["if"];
    },
    "H3",
  ],
  [
    "R6 runs on Linux",
    (w) => {
      job(w, "e88-r6")["runs-on"] = "ubuntu-latest";
    },
    "H3",
  ],
  [
    "R6 loses a target",
    (w) => {
      run(w)["run"] = String(run(w)["run"]).replace("next/apps/fabrika/src/brain-life.integration.test.ts", "");
    },
    "H4",
  ],
  [
    "R6 clears CI",
    (w) => {
      map(run(w)["env"])["CI"] = "";
    },
    "H4",
  ],
  [
    "R6 spoofs an approval",
    (w) => {
      job(w, "e88-r6")["env"] = { FABRIKA_HOST_RUN_OWNER_APPROVED: "1" };
    },
    "H4",
  ],
  [
    "R6 ignores a failed law",
    (w) => {
      run(w)["continue-on-error"] = true;
    },
    "H4",
  ],
  [
    "R6 uses fast depth",
    (w) => {
      map(run(w)["env"])["FABRIKA_TEST_DEPTH"] = "fast";
    },
    "H4",
  ],
  [
    "proof is lost on failure",
    (w) => {
      delete allSteps(job(w, "e88-r6")).find((step) => step["name"] === "E88 R6 proof")!["if"];
    },
    "H5",
  ],
  [
    "box runs on Linux",
    (w) => {
      job(w, "box")["runs-on"] = "ubuntu-latest";
    },
    "H3",
  ],
  [
    "box runs on every event",
    (w) => {
      delete job(w, "box")["if"];
    },
    "H6",
  ],
  [
    "box runs another file",
    (w) => {
      boxRun(w)["run"] = String(boxRun(w)["run"]).replace("box.test.ts", "another.test.ts");
    },
    "H6",
  ],
  [
    "box clears CI",
    (w) => {
      map(boxRun(w)["env"])["CI"] = "";
    },
    "H6",
  ],
  [
    "box spoofs an approval",
    (w) => {
      job(w, "box")["env"] = { FABRIKA_HOST_RUN_OWNER_APPROVED: "1" };
    },
    "H6",
  ],
  [
    "box ignores a failed law",
    (w) => {
      boxRun(w)["continue-on-error"] = true;
    },
    "H6",
  ],
  [
    "box uses fast depth",
    (w) => {
      map(boxRun(w)["env"])["FABRIKA_TEST_DEPTH"] = "fast";
    },
    "H6",
  ],
  [
    "box proof is lost on failure",
    (w) => {
      delete allSteps(job(w, "box")).find((step) => step["name"] === "Box proof")!["if"];
    },
    "H7",
  ],
  [
    "p8 runs on every event",
    (w) => {
      delete job(w, "p8")["if"];
    },
    "H9",
  ],
  [
    "p8 runs on macOS",
    (w) => {
      job(w, "p8")["runs-on"] = "macos-15";
    },
    "H9",
  ],
  [
    "p8 has no time limit",
    (w) => {
      delete job(w, "p8")["timeout-minutes"];
    },
    "H9",
  ],
  [
    "p8 runs another test file",
    (w) => {
      p8Run(w)["run"] = String(p8Run(w)["run"]).replace("progress-reporter.integration.test.ts", "another.test.ts");
    },
    "H9",
  ],
  [
    "p8 runs a second test file",
    (w) => {
      p8Run(w)["run"] = `${String(p8Run(w)["run"]).trimEnd()} .github/ci/proof.test.ts`;
    },
    "H9",
  ],
  [
    "p8 clears CI",
    (w) => {
      map(p8Run(w)["env"])["CI"] = "";
    },
    "H9",
  ],
  [
    "p8 spoofs an approval",
    (w) => {
      job(w, "p8")["env"] = { FABRIKA_HOST_RUN_OWNER_APPROVED: "1" };
    },
    "H9",
  ],
  [
    "p8 ignores a failed law",
    (w) => {
      p8Run(w)["continue-on-error"] = true;
    },
    "H9",
  ],
  [
    "p8 uses fast depth",
    (w) => {
      map(p8Run(w)["env"])["FABRIKA_TEST_DEPTH"] = "fast";
    },
    "H9",
  ],
  [
    "p8 proof is saved only after a passing law",
    (w) => {
      p8Proof(w)["if"] = "success()";
    },
    "H9",
  ],
  [
    "p8 proof saves another path",
    (w) => {
      map(p8Proof(w)["with"])["path"] = `\${{ runner.temp }}/*`;
    },
    "H9",
  ],
  [
    "different suites share one concurrency group",
    (w) => {
      map(w["concurrency"])["group"] = `host-\${{ github.event.pull_request.number || github.sha }}`;
    },
    "H8",
  ],
  [
    "legacy dispatch loses its L13 group",
    (w) => {
      map(w["concurrency"])["group"] =
        `host-\${{ github.event.pull_request.number || github.sha }}-\${{ inputs.suite }}`;
    },
    "H8",
  ],
  [
    "newer pushes lose cancellation within their suite",
    (w) => {
      map(w["concurrency"])["cancel-in-progress"] = false;
    },
    "H8",
  ],
  [
    "newer pushes to the same PR get different groups",
    (w) => {
      map(w["concurrency"])["group"] = `host-\${{ github.sha }}-\${{ inputs.suite || 'l13' }}`;
    },
    "H8",
  ],
] satisfies ReadonlyArray<readonly [string, (workflow: Record<string, unknown>) => void, string]>) {
  it(`scenario: host workflow refuses ${name}`, () => {
    const workflow = hostFile();
    plant(workflow);
    const errors = lintHost(JSON.stringify(workflow));
    expect(errors).toHaveLength(1);
    expect(errors[0]).toContain(rule);
  });
}
