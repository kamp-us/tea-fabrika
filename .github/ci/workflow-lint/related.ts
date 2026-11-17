// Today's automatic related checks share the schedule's native job groups (0595).
import { Result, Schema } from "effect";
import { compact, legs, map, type Rule, steps, uses } from "./shared.ts";

const FILES = "fromJSON(needs.select.outputs.files)[matrix.shard]";

const INTEGRATION =
  'pnpm exec vitest run --project next-integration $FILES --reporter=verbose --reporter=json --reporter=github-actions --outputFile.json="$RUNNER_TEMP/related.json"';

const TOOLING =
  'pnpm exec vitest run --project tooling $FILES --reporter=verbose --reporter=json --reporter=github-actions --outputFile.json="$RUNNER_TEMP/related.json"';

const decode = Schema.decodeResult(Schema.fromJsonString(Schema.Record(Schema.String, Schema.String)));

const slots = Array.from({ length: 9 }, (_, index) => String(index + 1));

const lookup = (value: unknown, rotated: boolean): Record<string, string> => {
  const expression = typeof value === "string" ? compact(value) : "";

  const match = rotated
    ? /^scheduled-test-\$\{\{\s*fromJSON\('([^']*)'\)\[fromJSON\(needs\.select\.outputs\.slots\)\[matrix\.shard\]\]\|\|'1'\s*\}\}$/i.exec(
        expression,
      )
    : /^scheduled-test-\$\{\{\s*fromJSON\('([^']*)'\)\[matrix\.shard\]\|\|'1'\s*\}\}$/i.exec(expression);

  return Result.getOrElse(decode(match?.[1] ?? ""), () => ({}));
};

const held = (job: Record<string, unknown>) => {
  const value = map(job["concurrency"]);

  return Object.keys(value).length === 3 && value["queue"] === "max" && value["cancel-in-progress"] === false;
};

const mapped = (job: Record<string, unknown>) => {
  const values = lookup(map(job["concurrency"])["group"], true);

  return held(job) && Object.keys(values).length === 9 && slots.every((slot) => values[slot] === slot);
};

const selector = (workflow: Record<string, unknown>) => {
  const job = map(map(workflow["jobs"])["select"]);

  const set = steps(job).find((step) => step["id"] === "set");

  const env = map(set?.["env"]);

  const outputs = map(job["outputs"]);

  return (
    held(job) &&
    map(job["concurrency"])["group"] === "scheduled-control" &&
    set?.["run"] === "node .github/ci/related.ts" &&
    env["RUN_NUMBER"] === `\${{ github.run_number }}` &&
    env["HEAD"] === `\${{ github.sha }}` &&
    ["run", "legs", "files", "projects", "slots", "plants"].every(
      (key) => outputs[key] === `\${{ steps.set.outputs.${key} }}`,
    )
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
  mapped(job) &&
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
  require(selector(workflow), "R1: related selection uses the shared control group, tested source and exact outputs");
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
  require(mapped(related), "R1: related jobs share only the existing nine test groups with a bounded fallback");
  require(JSON.stringify(related["needs"]) === JSON.stringify(["changes", "select"]) &&
    compact(related["if"]) ===
      "!cancelled()&&needs.select.result=='success'&&needs.select.outputs.run=='true'", "R1: related tests follow a successful nonempty selector");

  const strategy = map(related["strategy"]);

  const matrix = map(strategy["matrix"]);
  require(strategy["max-parallel"] === 9 &&
    strategy["fail-fast"] === true &&
    Object.keys(matrix).length === 1 &&
    compact(matrix["shard"]) ===
      `fromJSON(needs.select.outputs.legs||'["1"]')`, "R1: related tests keep the nine-slot cap and one logical matrix axis");
  require(!("name" in related), "R1: related keeps default logical matrix names, including an unexpanded skipped job");

  const commands = steps(related).filter((step) => typeof step["run"] === "string");
  require(JSON.stringify(commands.map((step) => step["run"])) ===
    JSON.stringify([
      "pnpm install --frozen-lockfile",
      INTEGRATION,
      "node .github/ci/plant-related.ts",
      TOOLING,
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

  const faults = commands.find((step) => step["run"] === "node .github/ci/plant-related.ts");

  const integration = commands.find((step) => step["run"] === INTEGRATION);
  require(faults !== undefined &&
    integration !== undefined &&
    commands.indexOf(faults) > commands.indexOf(integration) &&
    compact(faults["if"]) === "fromJSON(needs.select.outputs.plants)[matrix.shard]!=null" &&
    faults["timeout-minutes"] === 17 &&
    faults["continue-on-error"] === undefined &&
    Object.keys(map(faults["env"])).length === 4 &&
    compact(map(faults["env"])["FILES"]) === FILES &&
    map(faults["env"])["FABRIKA_TEST_DEPTH"] === "full" &&
    map(faults["env"])["PLANTS"] === `\${{ needs.select.outputs.plants }}` &&
    map(faults["env"])["LEG"] ===
      `\${{ matrix.shard }}`, "R1: checklist faults follow each leg's ordinary files in its held integration slot and existing limit");

  require(steps(related).some(
    (step) =>
      uses(step, "actions/checkout") &&
      map(step["with"])["persist-credentials"] === false &&
      map(step["with"])["fetch-depth"] === 0 &&
      map(step["with"])["filter"] === "blob:none" &&
      !("ref" in map(step["with"])),
  ), "R1: related tests use the tested commit with complete ancestry and blobless history");

  const next = map(jobs["next"]);

  const nextSlots = lookup(map(next["concurrency"])["group"], false);

  const shards = legs(next);
  require(held(next) &&
    Object.keys(nextSlots).length === shards.length &&
    new Set(Object.values(nextSlots)).size === shards.length &&
    shards.every(
      (shard) => typeof shard === "string" && slots.includes(nextSlots[shard] ?? ""),
    ), "R1: existing next and visual jobs share the same nine test groups, with no independent pool");
};
