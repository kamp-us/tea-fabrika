// Today's automatic related checks take no job group, so the merge line never waits on a scheduled
// run's groups (0598).
import { compact, map, type Rule, steps, uses } from "./shared.ts";

const FILES = "fromJSON(needs.select.outputs.files)[matrix.shard]";

const INTEGRATION =
  'pnpm exec vitest run --project next-integration $FILES --reporter=verbose --reporter=json --reporter=github-actions --outputFile.json="$RUNNER_TEMP/related.json"';

const TOOLING =
  'pnpm exec vitest run --project tooling $FILES --reporter=verbose --reporter=json --reporter=github-actions --outputFile.json="$RUNNER_TEMP/related.json"';

/** No job-level group at all, in any form: 0598 takes the merge line out of the scheduled groups. */
const ungrouped = (job: Record<string, unknown>) => job["concurrency"] === undefined;

/** The name of a job's group, whether `concurrency` is the bare name or a map with a `group`. */
const groupOf = (job: Record<string, unknown>): string => {
  const value = job["concurrency"];

  const group = typeof value === "string" ? value : map(value)["group"];

  return typeof group === "string" ? group : "";
};

const OUTPUTS = ["run", "legs", "files", "projects", "consumer"];

const selector = (workflow: Record<string, unknown>) => {
  const job = map(map(workflow["jobs"])["select"]);

  const set = steps(job).find((step) => step["id"] === "set");

  const env = map(set?.["env"]);

  const outputs = map(job["outputs"]);

  return (
    ungrouped(job) &&
    set?.["run"] === "node .github/ci/related.ts" &&
    env["RUN_NUMBER"] === undefined &&
    env["HEAD"] === `\${{ github.sha }}` &&
    Object.keys(outputs).length === OUTPUTS.length &&
    OUTPUTS.every((key) => outputs[key] === `\${{ steps.set.outputs.${key} }}`)
  );
};

const FAULT = "node .github/ci/related.ts --fault";

const FAULT_IF = "success()&&needs.select.outputs.consumer==matrix.shard";

/**
 * The related job's one delivery-lane step: P1's source fault, on the leg that owns P1, right in the
 * tooling limit, at full depth and with nothing else (no token, no soft failure). The command list holds
 * its place, once, after `tooling`. The job keeps no receipt and no archive upload: main's full run
 * keeps the archive (0602).
 */
const consumerFault = (job: Record<string, unknown>): boolean => {
  const fault = steps(job).find((candidate) => candidate["run"] === FAULT);

  return (
    ungrouped(job) &&
    fault !== undefined &&
    fault["name"] === "consumer fault" &&
    Object.keys(fault).length === 5 &&
    compact(fault["if"]) === FAULT_IF &&
    fault["timeout-minutes"] === 30 &&
    JSON.stringify(map(fault["env"])) === JSON.stringify({ FABRIKA_TEST_DEPTH: "full" })
  );
};

/** T1 permits tooling only on this exact bounded check job, never another PR workflow. */

export const relatedWorkload = (
  workflow: Record<string, unknown>,
  name: string,
  job: Record<string, unknown>,
  step: Record<string, unknown>,
) =>
  name === "related" &&
  selector(workflow) &&
  ungrouped(job) &&
  (step["run"] === TOOLING || step["run"] === INTEGRATION) &&
  compact(step["if"]) ===
    `fromJSON(needs.select.outputs.projects)[matrix.shard]=='${step["run"] === TOOLING ? "tooling" : "next-integration"}'` &&
  compact(map(step["env"])["FILES"]) === FILES &&
  map(step["env"])["FABRIKA_TEST_DEPTH"] === "full" &&
  Object.keys(map(step["env"])).length === 2 &&
  step["timeout-minutes"] === (step["run"] === TOOLING ? 30 : 17);

export const relatedChecks: Rule = ({ workflow, jobs }, require) => {
  const select = map(jobs["select"]);

  const related = map(jobs["related"]);
  require(selector(
    workflow,
  ), "R1: related selection takes no job group (0598), and uses the tested source and exact outputs");
  require(select["timeout-minutes"] === 10, "R1: related selection keeps its ten-minute job limit");

  const set = steps(select).find((step) => step["id"] === "set");

  const env = map(set?.["env"]);
  require(env["MOST_INTEGRATION"] === 5 &&
    env["MOST_TOOLING"] === 2 &&
    env["LIMIT_INTEGRATION"] === 17 &&
    env["LIMIT_TOOLING"] === 30 &&
    set?.["timeout-minutes"] === 5 &&
    set?.["continue-on-error"] === undefined, "R1: selection preserves project counts and limits and fails loudly");
  require(env["BASE"] ===
    `\${{ github.event.pull_request.base.sha || github.event.merge_group.base_sha || github.event.before }}`, "R1: selection uses the event's actual base");
  require(steps(select).some(
    (step) =>
      uses(step, "actions/checkout") &&
      map(step["with"])["fetch-depth"] === 0 &&
      map(step["with"])["persist-credentials"] === false &&
      !("ref" in map(step["with"])),
  ), "R1: selection checks out this check's tested commit with history");
  require(ungrouped(related), "R1: related tests take no job group (0598)");
  require(JSON.stringify(related["needs"]) === JSON.stringify(["changes", "select"]) &&
    compact(related["if"]) ===
      "!cancelled()&&needs.select.result=='success'&&needs.select.outputs.run=='true'", "R1: related tests follow a successful nonempty selector");

  const strategy = map(related["strategy"]);

  const matrix = map(strategy["matrix"]);
  require(strategy["max-parallel"] === 9 &&
    strategy["fail-fast"] === true &&
    Object.keys(matrix).length === 1 &&
    compact(matrix["shard"]) ===
      `fromJSON(needs.select.outputs.legs||'["1"]')`, "R1: related tests keep the nine-leg cap and one logical matrix axis");
  require(!("name" in related), "R1: related keeps default logical matrix names, including an unexpanded skipped job");

  const commands = steps(related).filter((step) => typeof step["run"] === "string");
  require(JSON.stringify(commands.map((step) => step["run"])) ===
    JSON.stringify([
      "pnpm install --frozen-lockfile",
      INTEGRATION,
      TOOLING,
      FAULT,
      "node .github/ci/time-table.ts",
    ]), "R1: only the declared integration and tooling workloads run");

  for (const [command, project, limit] of [
    [INTEGRATION, "next-integration", 17],
    [TOOLING, "tooling", 30],
  ] as const) {
    const step = commands.find((step) => step["run"] === command);
    require(step !== undefined &&
      compact(step["if"]) === `fromJSON(needs.select.outputs.projects)[matrix.shard]=='${project}'` &&
      compact(map(step["env"])["FILES"]) === FILES &&
      map(step["env"])["FABRIKA_TEST_DEPTH"] === "full" &&
      step["timeout-minutes"] === limit &&
      step["continue-on-error"] ===
        undefined, `R1: ${project} runs each selected file at full depth within its existing limit`);
  }

  require(steps(related).some(
    (step) =>
      uses(step, "actions/checkout") &&
      map(step["with"])["persist-credentials"] === false &&
      map(step["with"])["fetch-depth"] === 0 &&
      map(step["with"])["filter"] === "blob:none" &&
      !("ref" in map(step["with"])),
  ), "R1: related tests use the tested commit with complete ancestry and blobless history");

  require(consumerFault(
    related,
  ), "R1: the consumer fault runs on the leg that owns P1, in the tooling limit, and the job keeps no receipt and no archive");

  const next = map(jobs["next"]);

  require(ungrouped(next), "R1: next takes no job group (0598)");

  const scheduled = Object.entries(jobs).filter(([, job]) => groupOf(map(job)).toLowerCase().startsWith("scheduled-"));
  require(scheduled.length === 0, "R2: no check.yaml job holds a scheduled- group (0598)");
};
