// Today's CI, serving both versions. check.yaml's changes job (S1): its flags and outputs, the
// parser's pass, and the size step that sizes next's legs (legs.ts).
import { classifier, compact, env, FLAGS, map, ROW_INSTALL, type Rule, steps, VISUAL_LABEL } from "./shared.ts";

// When changes' size step sizes next: any run next tests, all of next/ or the reader tests alone, as
// the parser's pass left next, a pull request, a merge queue group and a push to main alike (0534);
// legs.ts itself prints the full matrix for a run of all of next/ with no base commit. The setup
// also runs for the parser's pass, and reads the first pass alone.
const SIZED = "(steps.same.outputs.next||steps.diff.outputs.next)!='false'";

const PROBE = "steps.diff.outputs.probe=='true'";

const SETUP = `${PROBE}||steps.diff.outputs.next!='false'`;

// changes' outputs from its size step, each beside the name legs.ts prints it under. `next` joins
// changes' own; `files` is a sized run's vitest list, the reader tests included, and `base` the
// commit its end-to-end legs narrow from (legs.ts).
const LEGS_OUTPUTS = [
  ["shards", "shards"],
  ["files", "files"],
  ["vitest-legs", "vitest"],
  ["e2e-legs", "e2e"],
  ["base", "base"],
] as const;

// The size step's base is the run's own: the pull request's, the merge queue group's, or what main
// held before the push (0534), the classify step's BASE.
const SIZE_ENV = {
  EVENT: `\${{ github.event_name }}`,
  FILTER: `\${{ steps.same.outputs.filter || steps.diff.outputs.filter || 'next/' }}`,
  BASE: env.BASE,
  VISUAL: `\${{ ${VISUAL_LABEL} }}`,
};

export const changesJob: Rule = ({ jobs }, require) => {
  const changes = map(jobs["changes"]),
    outputs = map(changes["outputs"]);

  require(!("if" in changes) && !("needs" in changes), "changes starts on every event");

  for (const name of FLAGS) {
    require(compact(outputs[name]) === `steps.diff.outputs.${name}`, `changes exposes ${name}`);
  }

  // The plan for CI paths, slice 2: the parser's pass (`--same`) prints `next` and `filter` again
  // when it proved a next/ file is the same program, and the first pass's stand when it printed
  // nothing. Its install and its run may fail without failing changes, which would run everything
  // and turn ci-required red.
  require(compact(outputs["filter"]) ===
    "steps.same.outputs.filter||steps.diff.outputs.filter", "changes exposes filter from the parser's pass, else the first");
  // S1. The size step's `next` first: false when it picked no next/ test file, so next skips.
  require(compact(outputs["next"]) ===
    "steps.size.outputs.next||steps.same.outputs.next||steps.diff.outputs.next", "S1: changes exposes next from the size step, else the parser's pass, else the first");

  for (const [name, from] of LEGS_OUTPUTS) {
    require(compact(outputs[name]) === `steps.size.outputs.${from}`, `S1: changes exposes ${name} from the size step`);
  }

  const exposed = [...FLAGS, "next", "filter", ...LEGS_OUTPUTS.map(([name]) => name)].toSorted();
  require(JSON.stringify(Object.keys(outputs).toSorted()) ===
    JSON.stringify(exposed), "S1: changes exposes its flags, filter and the size step's outputs, and nothing else");

  const changeSteps = steps(changes);
  const same = changeSteps.find((s) => s["id"] === "same");
  require(same?.["run"] === "node .github/ci/changes.mjs --same" &&
    same["continue-on-error"] === true, "changes runs the parser's pass, and its failure fails nothing");

  for (const [key, expected] of Object.entries(classifier)) {
    require(map(same?.["env"])[key] === expected, `the parser's pass gets event ${key} through env`);
  }

  const sizing = changeSteps.find((s) => s["id"] === "size");

  for (const step of changeSteps.filter(
    (s) =>
      (typeof s["uses"] === "string" && /^(pnpm\/action-setup|actions\/setup-node)@/.test(s["uses"])) ||
      (typeof s["run"] === "string" && s["run"].startsWith("pnpm install")),
  )) {
    const forSizing = step["run"] === "pnpm install --frozen-lockfile --ignore-scripts";
    const before = forSizing ? sizing : same;
    require(step["continue-on-error"] === true &&
      before !== undefined &&
      changeSteps.indexOf(step) <
        changeSteps.indexOf(
          before,
        ), "the parser's setup comes before its pass, sizing's install before its size step, and their failure fails nothing");
    require(compact(step["if"]) ===
      (forSizing
        ? SIZED
        : compact(
            String(step["run"] ?? "").includes("--filter") ? PROBE : SETUP,
          )), "S1: changes' setup runs for the parser or for sizing, each install on its own guard");
  }

  // S1. The size step (legs.ts) runs after the parser's pass, on every run that tests next: a pull
  // request, a merge queue group and a push to main (0534), so none of them runs the whole suite,
  // and a run of the reader tests alone starts only the legs they need. Its install and its sizing
  // may fail without failing changes, so a failure there is the full matrix, never a skipped next.
  require(sizing !== undefined &&
    same !== undefined &&
    changeSteps.indexOf(same) < changeSteps.indexOf(sizing) &&
    sizing["run"] === "node .github/ci/legs.ts" &&
    sizing["continue-on-error"] === true &&
    compact(sizing["if"]) ===
      SIZED, "S1: changes sizes next with legs.ts after the parser's pass, on every run that tests next, and fails open");

  for (const [key, expected] of Object.entries(SIZE_ENV)) {
    require(map(sizing?.["env"])[key] === expected, `S1: the size step gets ${key} through env`);
  }

  // S1. BUDGET is the setting for a vitest leg's seconds (legs.ts): a positive number, declared here
  // once. legs.ts refuses any other value, and its step then prints nothing.
  const budget = map(sizing?.["env"])["BUDGET"];
  require(typeof budget === "number" &&
    Number.isFinite(budget) &&
    budget > 0, "S1: the size step gets BUDGET, a vitest leg's seconds, as a positive number");

  // The parser's own install: sizing's full install comes after the parser's pass, so it cannot
  // stand in for it.
  require(changeSteps.some(
    (s) => s["run"] === ROW_INSTALL && compact(s["if"]) === PROBE,
  ), "changes installs the parser for its pass");
};
