// Today's CI for next/: fixed suites on the disposable macOS runner.
import { parse } from "yaml";
import { allSteps, compact, map, sameEntries } from "./shared.ts";

const PATHS = [
  "next/packages/libfabrika/src/node/launchd/**",
  "next/apps/fabrika/e2e/electron-launchd.visual.test.ts",
  "next/apps/fabrika/e2e/node/P19Launchd.test-support.ts",
  "next/apps/fabrika/e2e/node/P19Brain.test-support.ts",
  "fixtures/next/p19-launchd/brain.ts",
  ".github/workflows/host.yaml",
];

const R6 = [
  'git rev-parse HEAD > "$RUNNER_TEMP/e88-r6-head.txt"',
  'pnpm exec vitest run --project next-integration --maxWorkers=1 --fileParallelism=false --reporter=default --reporter=json --outputFile.json="$RUNNER_TEMP/e88-r6.json"',
  "next/apps/fabrika/src/brain-life.integration.test.ts",
  "next/apps/fabrika/src/instance-wire.integration.test.ts",
  "next/apps/fabrika/src/worker-supervision.integration.test.ts",
].join(" ");

const BOX = [
  'git rev-parse HEAD > "$RUNNER_TEMP/box-head.txt"',
  'pnpm exec vitest run --project tooling --maxWorkers=1 --fileParallelism=false --reporter=default --reporter=json --outputFile.json="$RUNNER_TEMP/box.json"',
  ".agents/skills/lead/scripts/box.test.ts",
].join(" ");

/** The host workflow keeps L13 as its default and exposes only fixed remote law suites. */
export const lintHost = (text: string): string[] => {
  const errors: string[] = [];

  const require = (holds: boolean, reason: string) => {
    if (!holds) {
      errors.push(`host.yaml: ${reason}`);
    }
  };

  let workflow: Record<string, unknown>;

  try {
    workflow = map(parse(text));
  } catch {
    return ["host.yaml: invalid YAML"];
  }

  const on = map(workflow["on"]);
  const inputs = map(map(on["workflow_dispatch"])["inputs"]);
  const suite = map(inputs["suite"]);
  require(Object.keys(inputs).join() === "suite" &&
    suite["type"] === "choice" &&
    suite["required"] === true &&
    suite["default"] === "l13" &&
    JSON.stringify(suite["options"]) ===
      JSON.stringify(["l13", "e88-r6", "box"]), "H1: dispatch selects only l13, e88-r6 or box and defaults to l13");

  const jobs = map(workflow["jobs"]);
  const launchd = map(jobs["launchd"]);
  const e88 = map(jobs["e88-r6"]);
  const box = map(jobs["box"]);
  const l13 = allSteps(launchd).find((step) => step["name"] === "L13");
  const paths = map(on["pull_request"])["paths"];
  require(JSON.stringify(Object.keys(on).toSorted()) === JSON.stringify(["pull_request", "workflow_dispatch"]) &&
    Array.isArray(paths) &&
    paths.length === PATHS.length &&
    PATHS.every((path) => paths.includes(path)) &&
    compact(launchd["if"]) === "github.event_name!='workflow_dispatch'||inputs.suite=='l13'" &&
    l13?.["working-directory"] === "next/apps/fabrika" &&
    String(l13?.["run"]).includes(
      "pnpm exec vitest run --maxWorkers=1 --root e2e --fileParallelism=false --testTimeout=120000 --hookTimeout=120000 electron-launchd.visual.test.ts",
    ), "H2: L13 retains its automatic paths and default command");
  require(JSON.stringify(Object.keys(jobs).toSorted()) === JSON.stringify(["box", "e88-r6", "launchd"]) &&
    [launchd, e88, box].every((job) => job["runs-on"] === "macos-15" && job["timeout-minutes"] === 20) &&
    compact(e88["if"]) ===
      "github.event_name=='workflow_dispatch'&&inputs.suite=='e88-r6'", "H3: E88 R6 is dispatch-only on the existing macOS runner and time limit");

  const list = allSteps(e88);
  const run = list.find((step) => step["name"] === "E88 R6");
  require(String(run?.["run"])
    .replace(/\\\n\s*/g, " ")
    .replace(/\s+/g, " ")
    .trim() === R6 &&
    JSON.stringify(run?.["env"]) === JSON.stringify({ FABRIKA_TEST_DEPTH: "full" }) &&
    Object.keys(map(workflow["env"])).length === 0 &&
    Object.keys(map(e88["env"])).length === 0 &&
    e88["continue-on-error"] === undefined &&
    list.every(
      (step) => step["continue-on-error"] === undefined && (step === run || Object.keys(map(step["env"])).length === 0),
    ) &&
    run?.["if"] ===
      undefined, "H4: E88 R6 runs all three fixed files at full depth, with genuine CI and blocking failures");
  const proof = list.find((step) => step["name"] === "E88 R6 proof");
  require(compact(proof?.["if"]) === "always()" &&
    proof?.["uses"] === "actions/upload-artifact@v7" &&
    sameEntries(
      Object.entries(map(proof?.["with"])),
      Object.entries({
        name: "e88-r6",
        path: `\${{ runner.temp }}/e88-r6*`,
        "if-no-files-found": "error",
      }),
    ), "H5: E88 R6 saves its exact head and JSON results after a failed law too");

  const boxSteps = allSteps(box);
  const boxRun = boxSteps.find((step) => step["name"] === "Box laws");
  require(compact(box["if"]) === "github.event_name=='workflow_dispatch'&&inputs.suite=='box'" &&
    String(boxRun?.["run"])
      .replace(/\\\n\s*/g, " ")
      .replace(/\s+/g, " ")
      .trim() === BOX &&
    JSON.stringify(boxRun?.["env"]) === JSON.stringify({ FABRIKA_TEST_DEPTH: "full" }) &&
    Object.keys(map(workflow["env"])).length === 0 &&
    Object.keys(map(box["env"])).length === 0 &&
    box["continue-on-error"] === undefined &&
    boxSteps.every(
      (step) =>
        step["continue-on-error"] === undefined && (step === boxRun || Object.keys(map(step["env"])).length === 0),
    ) &&
    boxRun?.["if"] ===
      undefined, "H6: box dispatch runs only the fixed tooling file at full depth, with genuine CI and blocking failures");
  const boxProof = boxSteps.find((step) => step["name"] === "Box proof");
  require(compact(boxProof?.["if"]) === "always()" &&
    boxProof?.["uses"] === "actions/upload-artifact@v7" &&
    sameEntries(
      Object.entries(map(boxProof?.["with"])),
      Object.entries({
        name: "box",
        path: `\${{ runner.temp }}/box*`,
        "if-no-files-found": "error",
      }),
    ), "H7: box saves its exact head and JSON results after a failed law too");

  const concurrency = map(workflow["concurrency"]);
  const group = /^host-\$\{\{(.+)\}\}-\$\{\{(.+)\}\}$/.exec(String(concurrency["group"]));
  require(group !== null &&
    compact(group[1]) === "github.event.pull_request.number||github.sha" &&
    compact(group[2]) === "inputs.suite||'l13'" &&
    concurrency["cancel-in-progress"] ===
      true, "H8: separate suites keep independent runners while a newer push replaces its own suite");

  return errors;
};
