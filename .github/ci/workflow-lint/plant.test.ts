import { readFileSync } from "node:fs";
import { expect, it } from "@effect/vitest";
import { runsFor } from "@kampus/vitest";
import { Schema } from "effect";
import { parse, stringify } from "yaml";
import { lintPlant } from "./plant.ts";
import { allSteps, map } from "./shared.ts";

const text = readFileSync(new URL("../../workflows/plant.yaml", import.meta.url), "utf8");

it.prop(
  "valid YAML forms pass and changed execution policy is refused",
  { reverse: Schema.Boolean, comment: Schema.String },
  ({ reverse, comment }) => {
    const workflow = map(parse(text));
    const valid = reverse ? Object.fromEntries(Object.entries(workflow).toReversed()) : workflow;
    expect(lintPlant(`${stringify(valid)}\n# ${JSON.stringify(comment)}\n`)).toEqual([]);

    const plants = [
      (w: Record<string, unknown>) => {
        map(w["on"])["pull_request"] = {};
      },
      (w: Record<string, unknown>) => {
        map(w["permissions"])["contents"] = "write";
      },
      (w: Record<string, unknown>) => {
        map(map(map(w["on"])["workflow_dispatch"])["inputs"])["patch"] = { type: "string" };
      },
      (w: Record<string, unknown>) => {
        map(map(w["jobs"])["exercise"])["runs-on"] = "self-hosted";
      },
      (w: Record<string, unknown>) => {
        map(map(w["jobs"])["exercise"])["timeout-minutes"] = 30;
      },
      (w: Record<string, unknown>) => {
        const steps = allSteps(map(map(w["jobs"])["exercise"]));
        steps[0]!["run"] = "true";
      },
      (w: Record<string, unknown>) => {
        const steps = allSteps(map(map(w["jobs"])["exercise"]));
        map(steps[1]!["with"])["persist-credentials"] = true;
      },
      (w: Record<string, unknown>) => {
        const steps = allSteps(map(map(w["jobs"])["exercise"]));
        map(steps[1]!["with"])["path"] = "runner";
      },
      (w: Record<string, unknown>) => {
        const steps = allSteps(map(map(w["jobs"])["exercise"]));
        map(steps[2]!["with"])["ref"] = "main";
      },
      (w: Record<string, unknown>) => {
        const steps = allSteps(map(map(w["jobs"])["exercise"]));
        steps[5]!["env"] = { TOKEN: `\${{ secrets.GITHUB_TOKEN }}` };
      },
      (w: Record<string, unknown>) => {
        const steps = allSteps(map(map(w["jobs"])["exercise"]));
        steps[5]!["run"] = `\${{ inputs.command }}`;
      },
      (w: Record<string, unknown>) => {
        const steps = allSteps(map(map(w["jobs"])["exercise"]));
        map(steps[6]!["with"])["path"] = `\${{ runner.temp }}/**`;
      },
    ];

    for (const plant of plants) {
      const changed = structuredClone(valid);
      plant(changed);
      expect(lintPlant(stringify(changed))).toHaveLength(1);
    }
  },
  {
    arbitrary: { runs: runsFor({ fast: 100, full: 100 }) },
    meta: { plant: "accept a raw report upload or arbitrary command" },
  },
);
