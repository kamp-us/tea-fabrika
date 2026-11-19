import { readFileSync } from "node:fs";
import { expect, it } from "vitest";
import { parse } from "yaml";
import { lintWorkflow as lint } from "../workflow-lint.ts";
import {
  changedOnPullRequests,
  env,
  guard,
  nextLegs,
  place,
  type Parsed,
  type Plant,
  probe,
  rejects,
  step,
  type Workflow,
} from "./wiring.test-support.ts";

// Today's CI, serving both versions. Covers changes.ts: changes' flags and outputs, the parser's
// pass and the size step (S1). Each plant is given to every generated valid workflow alone
// (wiring.test-support.ts), so an unrelated error cannot mask it.

const plants: Plant[] = [
  [
    "changes hides the build flag",
    (w) => {
      // SAFETY: `valid` in wiring.test-support.ts writes the changes job's outputs as a map of strings.
      delete (w.jobs.changes.outputs as Record<string, string>)["build"];
    },
  ],
  [
    "the classifier is not told the draft",
    (w) => {
      Object.assign(step(w, "changes", "classify"), { env });
    },
  ],
  [
    "changes' size step is not told the visual label",
    (w) => {
      // SAFETY: `valid` gives the size step an `env` map of its own; `step` hands steps back untyped.
      Reflect.deleteProperty(step(w, "changes", "size")["env"] as Record<string, string>, "VISUAL");
    },
  ],
  // S1, changes' size step and next's sized matrix (legs.ts), once the legs job (ticket 985). Each
  // is red alone in every generated workflow. The size step without its event check would size the
  // merge queue and main. Source plants, each run once on workflow-lint.ts and restored: drop the
  // rule that the size step follows the parser's pass (red: sizing, install and all, before it);
  // each gated job on its own flag alone (red: every generated workflow).
  // SAFETY: each row below is a plant's name and the function that applies it, as `Plant` holds them.
  ...(
    [
      ["next needs legs too", (w) => (w.jobs.next.needs = ["changes", "legs"])],
      [
        "next waits on a legs answer",
        (w) => (w.jobs.next.if = `${guard("next").slice(0, -3)} && needs.legs.outputs.next != 'false' }}`),
      ],
      [
        "next matrix with no fallback",
        (w) => (w.jobs.next.strategy.matrix.shard = `\${{ fromJSON(needs.changes.outputs.shards) }}`),
      ],
      [
        "next matrix from another output",
        (w) => (w.jobs.next.strategy.matrix.shard = w.jobs.next.strategy.matrix.shard.replace(".shards", ".files")),
      ],
      [
        "next matrix from the old legs job",
        (w) =>
          (w.jobs.next.strategy.matrix.shard = w.jobs.next.strategy.matrix.shard.replace(
            "needs.changes",
            "needs.legs",
          )),
      ],
      ["next matrix as a plain list", (w) => Object.assign(w.jobs.next.strategy.matrix, { shard: nextLegs(2) })],
      ["changes loses a sizing output", (w) => Reflect.deleteProperty(w.jobs.changes.outputs, "e2e-legs")],
      ["changes adds an output", (w) => (w.jobs.changes.outputs["more"] = `\${{ steps.size.outputs.more }}`)],
      [
        "changes takes shards from another step",
        (w) => (w.jobs.changes.outputs["shards"] = `\${{ steps.diff.outputs.shards }}`),
      ],
      [
        "changes' next ignores the size step",
        (w) => (w.jobs.changes.outputs["next"] = `\${{ steps.same.outputs.next || steps.diff.outputs.next }}`),
      ],
      // 0534: the merge queue and main size their legs too, from their own base, so none of the three
      // runs the whole suite. Each plant puts back a piece of the pull-request-only shape.
      [
        "the size step sizes pull requests alone, so the queue and main run the whole suite",
        (w) =>
          (step(w, "changes", "size")["if"] =
            `${String(step(w, "changes", "size")["if"])} && github.event_name == 'pull_request'`),
      ],
      [
        "the sizing install runs on pull requests alone",
        (w) =>
          (step(w, "changes", "install for sizing")["if"] =
            `${String(step(w, "changes", "install for sizing")["if"])} && github.event_name == 'pull_request'`),
      ],
      [
        "the size step's base is a pull request's alone",
        // SAFETY: the size step that `valid` builds carries an `env` map, where this plant swaps BASE.
        (w) =>
          ((step(w, "changes", "size").env as Record<string, string>)["BASE"] =
            `\${{ github.event.pull_request.base.sha }}`),
      ],
      [
        "the size step's base skips the merge queue's group",
        // SAFETY: this plant rewrites BASE in the same `env` map that `valid` gives the size step.
        (w) =>
          ((step(w, "changes", "size").env as Record<string, string>)["BASE"] =
            `\${{ github.event.pull_request.base.sha || github.event.before }}`),
      ],
      ["changes drops the size step's base", (w) => Reflect.deleteProperty(w.jobs.changes.outputs, "base")],
      [
        "changes takes the base from the classify step",
        (w) => (w.jobs.changes.outputs["base"] = `\${{ steps.diff.outputs.base }}`),
      ],
      [
        "the end-to-end legs narrow on pull requests alone, so the queue and main run every end-to-end file",
        // SAFETY: the end-to-end step in `valid`'s next job has an `env` map with CHANGED in it.
        (w) => ((step(w, "next", "end to end").env as Record<string, string>)["CHANGED"] = changedOnPullRequests),
      ],
      [
        "the end-to-end legs narrow from the event's base, even when the size step did not size them",
        // SAFETY: the plant sets CHANGED in the end-to-end step's `env`, which `valid` writes as a map.
        (w) =>
          ((step(w, "next", "end to end").env as Record<string, string>)["CHANGED"] =
            `\${{ format('--changed={0} --passWithNoTests', github.event.pull_request.base.sha || github.event.merge_group.base_sha || github.event.before) }}`),
      ],
      [
        "the end-to-end legs never narrow",
        // SAFETY: blanking CHANGED edits the end-to-end step's `env` map from `valid`, read untyped through `step`.
        (w) => ((step(w, "next", "end to end").env as Record<string, string>)["CHANGED"] = ""),
      ],
      // Ticket 997: a run of the reader tests alone is sized too, so a queue group of 11 reader
      // files starts one leg, not five. Each plant puts back the old guard that skipped it.
      [
        "the size step skips the reader tests, so they start the full matrix",
        (w) =>
          (step(w, "changes", "size")["if"] =
            `${String(step(w, "changes", "size")["if"])} && (steps.same.outputs.filter || steps.diff.outputs.filter) == 'next/'`),
      ],
      [
        "the sizing install skips the reader tests",
        (w) =>
          (step(w, "changes", "install for sizing")["if"] =
            `${String(step(w, "changes", "install for sizing")["if"])} && (steps.same.outputs.filter || steps.diff.outputs.filter) == 'next/'`),
      ],
      [
        "the setup skips the reader tests",
        (w) =>
          (step(w, "changes", "parser node")["if"] =
            `${probe} || (steps.diff.outputs.next != 'false' && steps.diff.outputs.filter == 'next/')`),
      ],
      [
        "the size step has no budget",
        // SAFETY: the size step's `env` from `valid` is a map that holds BUDGET, which this plant deletes.
        (w) => Reflect.deleteProperty(step(w, "changes", "size")["env"] as Record<string, unknown>, "BUDGET"),
      ],
      [
        "the size step's budget is text",
        // SAFETY: BUDGET sits in the size step's `env` map from `valid`; the plant writes it as text.
        (w) => Object.assign(step(w, "changes", "size")["env"] as Record<string, unknown>, { BUDGET: "240" }),
      ],
      [
        "the size step's budget is zero",
        // SAFETY: the size step's `env` map from `valid`, given a zero BUDGET by this plant.
        (w) => Object.assign(step(w, "changes", "size")["env"] as Record<string, unknown>, { BUDGET: 0 }),
      ],
      [
        "the size step reads the first pass alone",
        (w) =>
          (step(w, "changes", "size")["if"] = String(step(w, "changes", "size")["if"]).replaceAll(
            "steps.same.outputs.next || ",
            "",
          )),
      ],
      ["sizing installs on every run", (w) => Reflect.deleteProperty(step(w, "changes", "install for sizing"), "if")],
      ["the size step fails the job", (w) => Reflect.deleteProperty(step(w, "changes", "size"), "continue-on-error")],
      [
        "sizing's install fails the job",
        (w) => Reflect.deleteProperty(step(w, "changes", "install for sizing"), "continue-on-error"),
      ],
      [
        "the size step runs another script",
        (w) => (step(w, "changes", "size")["run"] = "node .github/ci/legs.ts --all"),
      ],
      ["the size step renamed", (w) => (step(w, "changes", "size")["id"] = "sizes")],
      [
        "sizing installs with scripts",
        (w) => (step(w, "changes", "install for sizing")["run"] = "pnpm install --frozen-lockfile"),
      ],
      [
        "the size step before the parser's pass",
        (w) => {
          const [size] = w.jobs.changes.steps.splice(place(w, "changes", "size"), 1);
          w.jobs.changes.steps.splice(place(w, "changes", "parser pass"), 0, size!);
        },
      ],
      [
        "sizing, install and all, before the parser's pass",
        (w) => {
          const moved = w.jobs.changes.steps.splice(place(w, "changes", "install for sizing"), 2);
          w.jobs.changes.steps.splice(place(w, "changes", "parser pass"), 0, ...moved);
        },
      ],
      [
        "the size step on the merge queue's base",
        // SAFETY: the plant moves BASE in the size step's `env`, which `valid` writes as a map of strings.
        (w) =>
          Object.assign(step(w, "changes", "size")["env"] as Record<string, string>, {
            BASE: `\${{ github.event.merge_group.base_sha }}`,
          }),
      ],
      [
        "the size step without its filter",
        // SAFETY: FILTER is a key of the size step's `env` map in `valid`, and this plant drops it.
        (w) => Reflect.deleteProperty(step(w, "changes", "size")["env"] as Record<string, string>, "FILTER"),
      ],
      [
        "the size step on the first pass's filter",
        // SAFETY: the plant swaps FILTER in the size step's `env` map, as `valid` writes it.
        (w) =>
          Object.assign(step(w, "changes", "size")["env"] as Record<string, string>, {
            FILTER: `\${{ steps.diff.outputs.filter || 'next/' }}`,
          }),
      ],
      ["the setup skips sizing", (w) => (step(w, "changes", "parser pnpm")["if"] = probe)],
      [
        "a legs job comes back",
        (w) => {
          Object.assign(w.jobs, {
            legs: { needs: "changes", "timeout-minutes": 5, steps: [{ run: "node .github/ci/legs.ts" }] },
          });
          w.jobs["ci-required"].needs.push("legs");
        },
      ],
    ] as [string, (w: Workflow) => void][]
  ).map(([fault, mutate]): [string, (w: Workflow) => void] => [
    fault,
    (w) => {
      mutate(w);
    },
  ]),
  [
    "changes skips",
    (w) => {
      Object.assign(w.jobs.changes, { if: "false" });
    },
  ],
  [
    "missing output",
    (w) => {
      delete w.jobs.changes.outputs["next"];
    },
  ],
  ["changes hides its files", (w) => Reflect.deleteProperty(w.jobs.changes.outputs, "files")],
  [
    "changes takes its files from another step",
    (w) => (w.jobs.changes.outputs["files"] = `\${{ steps.diff.outputs.files }}`),
  ],
  ...(["next", "filter"] as const).flatMap((key): [string, (w: Workflow) => void][] => [
    [
      `changes exposes ${key} from the first pass alone`,
      (w) => {
        w.jobs.changes.outputs[key] = `\${{ steps.diff.outputs.${key} }}`;
      },
    ],
    [
      `changes exposes ${key} from the parser's pass alone`,
      (w) => {
        w.jobs.changes.outputs[key] = `\${{ steps.same.outputs.${key} }}`;
      },
    ],
    [
      `changes hides ${key}`,
      (w) => {
        delete w.jobs.changes.outputs[key];
      },
    ],
  ]),
  ...["parser pnpm", "parser node", "parser install", "parser pass"].map(
    (named, at): [string, (w: Workflow) => void] => [
      `the parser's step ${at + 5} fails changes`,
      (w) => {
        delete step(w, "changes", named)["continue-on-error"];
      },
    ],
  ),
  [
    "the parser's pass is gone",
    (w) => {
      w.jobs.changes.steps.splice(place(w, "changes", "parser pass"), 1);
    },
  ],
  [
    "the parser's install is gone",
    (w) => {
      w.jobs.changes.steps.splice(place(w, "changes", "parser install"), 1);
    },
  ],
  [
    "the parser's pass runs before its install",
    (w) => {
      const [pass] = w.jobs.changes.steps.splice(place(w, "changes", "parser pass"), 1);
      w.jobs.changes.steps.splice(place(w, "changes", "parser install"), 0, pass!);
    },
  ],
  [
    "the parser's pass is not told the draft",
    (w) => {
      step(w, "changes", "parser pass")["env"] = env;
    },
  ],
  // The changes job's installs and setups are read wherever they sit, the classifier's own Node setup
  // aside (classify.ts holds that one). Each plant puts one before the classify step, and must fail.
  [
    "an install before the classify step, with no continue-on-error",
    (w) => {
      w.jobs.changes.steps.splice(place(w, "changes", "classify"), 0, { run: "pnpm install --frozen-lockfile" });
    },
  ],
  [
    "an unguarded setup-node before the classify step, under another name",
    (w) => {
      w.jobs.changes.steps.splice(place(w, "changes", "classify"), 0, {
        name: "setup node before classify",
        uses: "actions/setup-node@v7",
        with: { "node-version": "26.13.0" },
      });
    },
  ],
];

// T1076 O4. Each new fault goes through the existing whole-workflow acceptance path alone, on the
// generated valid workflow, whose fallback is the two roots of the `next` project.
plants.push(
  [
    "O4 legacy next-only fallback",
    (w) => {
      Object.assign(step(w, "changes", "size").env!, {
        FILTER: `\${{ steps.same.outputs.filter || steps.diff.outputs.filter || 'next/' }}`,
      });
    },
  ],
  [
    "O4 fallback without the literal separator",
    (w) => {
      Object.assign(step(w, "changes", "size").env!, {
        FILTER: `\${{ steps.same.outputs.filter || steps.diff.outputs.filter || 'next/kalfa/' }}`,
      });
    },
  ],
  [
    "O4 Kalfa-only fallback",
    (w) => {
      Object.assign(step(w, "changes", "size").env!, {
        FILTER: `\${{ steps.same.outputs.filter || steps.diff.outputs.filter || 'kalfa/' }}`,
      });
    },
  ],
  [
    "O4 quoted two-root fallback",
    (w) => {
      Object.assign(step(w, "changes", "size").env!, {
        FILTER: `\${{ steps.same.outputs.filter || steps.diff.outputs.filter || '"next/ kalfa/"' }}`,
      });
    },
  ],
  [
    "O4 reversed two-root fallback",
    (w) => {
      Object.assign(step(w, "changes", "size").env!, {
        FILTER: `\${{ steps.same.outputs.filter || steps.diff.outputs.filter || 'kalfa/ next/' }}`,
      });
    },
  ],
  [
    "O4 extra project in the fallback",
    (w) => {
      Object.assign(step(w, "changes", "size").env!, {
        FILTER: `\${{ steps.same.outputs.filter || steps.diff.outputs.filter || 'next/ kalfa/ --project tooling' }}`,
      });
    },
  ],
  [
    "O4 wrong precedence, the classifier first",
    (w) => {
      Object.assign(step(w, "changes", "size").env!, {
        FILTER: `\${{ steps.diff.outputs.filter || steps.same.outputs.filter || 'next/ kalfa/' }}`,
      });
    },
  ],
  [
    "O4 sizing receives a second narrowing input",
    (w) => {
      Object.assign(step(w, "changes", "size").env!, { CHANGED: "--changed=HEAD" });
    },
  ],
  [
    "O4 sizing adds a project",
    (w) => {
      step(w, "changes", "size").run += " --project tooling";
    },
  ],
  [
    "O4 sizing adds an unlisted env value",
    (w) => {
      Object.assign(step(w, "changes", "size").env!, { PROJECT: "tooling" });
    },
  ],
  [
    "O4 sizing is told the readers instead of the fallback",
    (w) => {
      Object.assign(step(w, "changes", "size").env!, {
        FILTER: `\${{ steps.same.outputs.filter || steps.diff.outputs.filter || 'next/apps/fabrika/src/exam/' }}`,
      });
    },
  ],
);

rejects(plants);

it("scenario: O4 the legacy filter is rejected by the sizing guard itself, whatever another guard says", () => {
  // scenario: the real checked-in workflow with only the size step's fallback put back to next/. The
  // S1 guard must name it, so another rule's error cannot stand in for it.
  const workflow: Parsed = parse(readFileSync(new URL("../../workflows/check.yaml", import.meta.url), "utf8"));
  expect(lint(JSON.stringify(workflow))).toEqual([]);
  const found = workflow.jobs["changes"]!.steps.find((candidate) => candidate["id"] === "size");
  expect(found).toBeDefined();
  Object.assign(found!["env"]!, {
    FILTER: `\${{ steps.same.outputs.filter || steps.diff.outputs.filter || 'next/' }}`,
  });
  expect(lint(JSON.stringify(workflow)).some((error) => error.includes("S1:") && error.includes("FILTER"))).toBe(true);
});
