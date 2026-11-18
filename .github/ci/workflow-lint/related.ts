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

const OUTPUTS = ["run", "legs", "files", "projects", "archive", "consumer"];

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

const RECEIPT = "node .github/ci/related.ts --receipt";

const FAULT = "node .github/ci/related.ts --fault";

const READY =
  "(github.event_name=='merge_group'||(github.event_name=='pull_request'&&!github.event.pull_request.draft))";

const RECEIPT_IF = `success()&&${READY}&&needs.select.outputs.archive==matrix.shard&&steps.integration.outcome=='success'`;

const FAULT_IF = "success()&&needs.select.outputs.consumer==matrix.shard";

const UPLOAD_IF = `success()&&${READY}&&needs.select.outputs.archive==matrix.shard&&steps.receipt.outcome=='success'`;

/** The three delivery steps of the related job, in one predicate the record guard reuses. */
export const deliveryUpload = (
  workflow: Record<string, unknown>,
  name: string,
  job: Record<string, unknown>,
  step: Record<string, unknown>,
): boolean => {
  const all = steps(job);

  const receipts = all.filter((candidate) => candidate["id"] === "receipt");

  const receipt = receipts[0];

  const integration = all.find((candidate) => candidate["run"] === INTEGRATION);

  const tooling = all.find((candidate) => candidate["run"] === TOOLING);

  const fault = all.find((candidate) => candidate["run"] === FAULT);

  const env = map(receipt?.["env"]);

  const given = map(step["with"]);

  const paths =
    typeof given["path"] === "string"
      ? given["path"]
          .trim()
          .split(/\r?\n/)
          .map((path) => path.trim())
      : [];

  return (
    name === "related" &&
    selector(workflow) &&
    ungrouped(job) &&
    receipts.length === 1 &&
    receipt !== undefined &&
    integration !== undefined &&
    tooling !== undefined &&
    fault !== undefined &&
    integration["id"] === "integration" &&
    receipt["name"] === "package receipt" &&
    receipt["run"] === RECEIPT &&
    Object.keys(receipt).length === 5 &&
    compact(receipt["if"]) === RECEIPT_IF &&
    Object.keys(env).length === 4 &&
    env["EVENT"] === `\${{ github.event_name }}` &&
    env["DRAFT"] === `\${{ github.event.pull_request.draft }}` &&
    env["HEAD"] === `\${{ github.sha }}` &&
    env["REQUESTED"] ===
      `\${{ github.event.pull_request.head.sha || github.event.merge_group.head_sha || github.sha }}` &&
    fault["name"] === "consumer fault" &&
    Object.keys(fault).length === 5 &&
    compact(fault["if"]) === FAULT_IF &&
    fault["timeout-minutes"] === 30 &&
    JSON.stringify(map(fault["env"])) === JSON.stringify({ FABRIKA_TEST_DEPTH: "full" }) &&
    all.indexOf(integration) < all.indexOf(receipt) &&
    all.indexOf(tooling) < all.indexOf(fault) &&
    all.indexOf(receipt) < all.indexOf(step) &&
    all.indexOf(fault) < all.indexOf(step) &&
    step["name"] === "package archive" &&
    uses(step, "actions/upload-artifact") &&
    Object.keys(step).length === 4 &&
    compact(step["if"]) === UPLOAD_IF &&
    Object.keys(given).length === 4 &&
    given["name"] === `kalfa-config-\${{ github.sha }}-attempt-\${{ github.run_attempt }}` &&
    paths.length === 2 &&
    paths[0] === `\${{ runner.temp }}/kalfa-config-package/kalfa-config-0.0.0.tgz` &&
    paths[1] === `\${{ runner.temp }}/kalfa-config-package/receipt.json` &&
    given["if-no-files-found"] === "error" &&
    typeof given["retention-days"] === "number" &&
    given["retention-days"] >= 1
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
      RECEIPT,
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

  const uploads = steps(related).filter((step) => step["name"] === "package archive");
  require(uploads.length === 1 &&
    uploads[0] !== undefined &&
    deliveryUpload(
      workflow,
      "related",
      related,
      uploads[0],
    ), "R1: one receipt, one consumer fault and one exact archive upload follow the owning legs' tests");

  const next = map(jobs["next"]);

  require(ungrouped(next), "R1: next takes no job group (0598)");

  const scheduled = Object.entries(jobs).filter(([, job]) => groupOf(map(job)).toLowerCase().startsWith("scheduled-"));
  require(scheduled.length === 0, "R2: no check.yaml job holds a scheduled- group (0598)");
};
