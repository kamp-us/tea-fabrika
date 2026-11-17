import { readFileSync } from "node:fs";
import { expect, it } from "vitest";
import { parse } from "yaml";
import { lintHost } from "./host.ts";
import { allSteps, map } from "./shared.ts";

const hostFile = (): Record<string, unknown> =>
  map(parse(readFileSync(new URL("../../workflows/host.yaml", import.meta.url), "utf8")));

const job = (workflow: Record<string, unknown>, name: string) => map(map(workflow["jobs"])[name]);

const input = (workflow: Record<string, unknown>) => map(map(map(workflow["on"])["workflow_dispatch"])["inputs"]);

const run = (workflow: Record<string, unknown>) =>
  allSteps(job(workflow, "e88-r6")).find((step) => step["name"] === "E88 R6")!;

const boxRun = (workflow: Record<string, unknown>) =>
  allSteps(job(workflow, "box")).find((step) => step["name"] === "Box laws")!;

it("format: host.yaml keeps L13 as default and exposes the fixed E88 R6 and box dispatches", () => {
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
      map(input(w)["suite"])["options"] = ["l13", "e88-r6", "box", "all"];
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
] satisfies ReadonlyArray<readonly [string, (workflow: Record<string, unknown>) => void, string]>) {
  it(`scenario: host workflow refuses ${name}`, () => {
    const workflow = hostFile();
    plant(workflow);
    const errors = lintHost(JSON.stringify(workflow));
    expect(errors).toHaveLength(1);
    expect(errors[0]).toContain(rule);
  });
}
