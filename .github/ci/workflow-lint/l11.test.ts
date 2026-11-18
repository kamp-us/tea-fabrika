import { readFileSync } from "node:fs";
import { it, expect } from "@effect/vitest";
import { runsFor } from "@kampus/vitest";
import { Match, Schema } from "effect";
import { parse, stringify } from "yaml";
import { bootstrap, cached, cases, uncached } from "../l11-cases.ts";
import { lintL11 } from "./l11.ts";
import { allSteps, map } from "./shared.ts";

const options = { arbitrary: { runs: runsFor({ fast: 100, full: 100 }), size: 30, concurrency: 1 } };

const integer = (minimum: number, maximum: number) => Schema.Int.check(Schema.isBetween({ minimum, maximum }));

const Text = Schema.String.check(Schema.isPattern(/^[\x20-\x7e]*$/));

// Policy inputs only. No Actions workflow or real adapter is started here.

const slots = Array.from({ length: 10 }, (_, index) => `slot-${index + 1}`);

const names = ["manifest", "compare", "inputs", "output", ...slots, "collect"];

const checkout = {
  uses: "actions/checkout@v7",
  with: {
    ref: `\${{ github.workflow_sha }}`,
    "persist-credentials": false,
    "fetch-depth": 1,
    submodules: false,
    lfs: false,
  },
};

const trust = {
  run: 'test "$GITHUB_REF" = refs/heads/main\ntest "$GITHUB_WORKFLOW_REF" = "$GITHUB_REPOSITORY/.github/workflows/l11-exercise.yaml@refs/heads/main"\ntest "$(git rev-parse HEAD)" = "$GITHUB_WORKFLOW_SHA"',
};

const workflow = () => ({
  name: "L11 exercise",
  on: {
    workflow_dispatch: {
      inputs: {
        case: { type: "choice", required: true, options: [...cases] },
        sha: { type: "string", required: true, default: cached },
      },
    },
  },
  permissions: { contents: "read" },
  jobs: Object.fromEntries(
    names.map((name) => {
      const slot = slots.indexOf(name);

      const env: Record<string, string> = {
        L11_CASE: `\${{ inputs.case }}`,
        L11_SHA: `\${{ inputs.sha }}`,
        L11_MODE: slot >= 0 ? "batch" : name,
      };

      if (slot >= 0) {
        env["L11_SLOT"] = String(slot + 1);
      }

      if (name === "compare") {
        env["L11_VARIANT"] = `\${{ matrix.variant }}`;
      }

      const when = Match.value(name).pipe(
        Match.when(
          "output",
          () => "inputs.case != 'l11-compare' && inputs.case != 'l11-inputs' && inputs.case != 'l11-batch'",
        ),
        Match.when("collect", () => "always()"),
        Match.orElse(() => `inputs.case == 'l11-${slot >= 0 || name === "manifest" ? "batch" : name}'`),
      );

      return [
        name,
        {
          name: `l11-${name}${name === "compare" ? `-\${{ matrix.variant }}` : ""}`,
          "runs-on": "ubuntu-latest",
          "timeout-minutes": 20,
          if: when,
          ...(slot >= 0
            ? { needs: [slot === 0 ? "manifest" : slots[slot - 1]] }
            : name === "collect"
              ? { needs: names.filter((name) => name !== "collect") }
              : {}),
          ...(name === "compare"
            ? { strategy: { "max-parallel": 1, "fail-fast": false, matrix: { variant: ["uncached", "cached"] } } }
            : {}),
          steps: [
            checkout,
            trust,
            ...(
              [
                [cached, "source-cached"],
                [uncached, "source-uncached"],
              ] as const
            ).map(([ref, path]) => ({ uses: "actions/checkout@v7", with: { ...checkout.with, ref, path } })),
            { run: bootstrap },
            { uses: "./.github/actions/pnpm" },
            { run: 'pnpm install --frozen-lockfile > "$RUNNER_TEMP/l11-trusted-install.log" 2>&1' },
            ...(name === "collect"
              ? [
                  {
                    uses: "actions/download-artifact@v8",
                    with: { pattern: "l11-exercise-*", path: `\${{ runner.temp }}/l11-exercise/collected` },
                  },
                ]
              : []),
            { id: "l11", run: "nice -n 19 node .github/ci/l11-exercise.ts", "timeout-minutes": 17, env },
            {
              uses: "actions/upload-artifact@v7",
              if: "always()",
              with: {
                name: `l11-exercise-${name}${name === "compare" ? `-\${{ matrix.variant }}` : ""}`,
                path: `\${{ runner.temp }}/l11-exercise/public/*.json`,
                "if-no-files-found": "error",
              },
            },
          ],
        },
      ];
    }),
  ),
});

const job = (value: ReturnType<typeof workflow>, name: string) => map(value.jobs[name]);

const execute = (value: ReturnType<typeof workflow>, name: string) =>
  allSteps(job(value, name)).find((step) => step["id"] === "l11")!;

it.prop(
  "workflow policy accepts supported mapping order, expression spacing and YAML aliases",
  { reverse: Schema.Boolean, yaml: Schema.Boolean },
  ({ reverse, yaml }) => {
    // The actual workflow and generated variants measure zero false alarms before activation.
    // Plant: require manifest first in the YAML mapping rather than through needs.

    const valid = workflow();

    if (reverse) {
      valid.jobs = Object.fromEntries(Object.entries(valid.jobs).toReversed());
      valid.on.workflow_dispatch.inputs.case.options.reverse();
      map(map(job(valid, "compare")["strategy"])["matrix"])["variant"] = ["cached", "uncached"];
    }

    const actual = map(parse(readFileSync(new URL("../../workflows/l11-exercise.yaml", import.meta.url), "utf8")));

    if (reverse) {
      actual["jobs"] = Object.fromEntries(Object.entries(map(actual["jobs"])).toReversed());
      map(map(map(map(actual["on"])["workflow_dispatch"])["inputs"])["case"])["options"] = [...cases].reverse();
    }

    for (const value of [valid, actual]) {
      const text = yaml ? stringify(value, { aliasDuplicateObjects: true }) : JSON.stringify(value);
      expect(lintL11(text)).toEqual([]);
    }
  },
  options,
);

it.prop(
  "workflow policy refuses caller controls, parallel slots, weak trust and raw uploads",
  { slot: integer(2, 10), text: Text },
  ({ slot, text }) => {
    // Plant: stop checking slot needs. Mutations are policy data, never executed fault scripts.

    const mutations: Array<(value: ReturnType<typeof workflow>) => void> = [
      (value) => {
        allSteps(job(value, "inputs"))[4]!["run"] = "true";
      },
      (value) => {
        const steps = allSteps(job(value, "output"));
        [steps[4], steps[5]] = [steps[5]!, steps[4]!];
        job(value, "output")["steps"] = steps;
      },
      (value) => {
        map(allSteps(job(value, "output"))[2]!["with"])["path"] = "source-uncached";
      },
      (value) => {
        map(value.on.workflow_dispatch.inputs)["command"] = { type: "string", default: text };
      },
      (value) => {
        map(value.on)["pull_request"] = {};
      },
      (value) => {
        map(value.permissions)["id-token"] = "write";
      },
      (value) => {
        job(value, "output")["name"] = `\${{ github.token }}`;
      },
      (value) => {
        job(value, `slot-${slot}`)["needs"] = ["manifest"];
      },
      (value) => {
        job(value, `slot-${slot}`)["if"] = "always()";
      },
      (value) => {
        job(value, `slot-${slot}`)["strategy"] = { matrix: { replacement: [1, 2] } };
      },
      (value) => {
        job(value, "compare")["strategy"] = { "max-parallel": 2, matrix: { variant: ["cached", "uncached"] } };
      },
      (value) => {
        execute(value, "output")["timeout-minutes"] = 18;
      },
      (value) => {
        execute(value, "output")["run"] = text;
      },
      (value) => {
        map(execute(value, "inputs")["env"])["CI"] = "true";
      },
      (value) => {
        allSteps(job(value, "inputs"))[1]!["run"] = "true";
      },
      (value) => {
        map(allSteps(job(value, "output"))[0]!["with"])["persist-credentials"] = true;
      },
      (value) => {
        map(allSteps(job(value, "output")).at(-1)!["with"])["path"] = `\${{ runner.temp }}/**`;
      },
      (value) => {
        map(allSteps(job(value, "output")).at(-1)!["with"])["name"] = `l11-exercise-\${{ toJSON(secrets) }}`;
      },
      (value) => {
        job(value, "collect")["needs"] = ["slot-10"];
      },
      (value) => {
        job(value, "collect")["if"] = "success()";
      },
    ];

    for (const mutate of mutations) {
      const changed = structuredClone(workflow());
      mutate(changed);
      expect(lintL11(JSON.stringify(changed)).length).toBeGreaterThan(0);
    }
  },
  options,
);
