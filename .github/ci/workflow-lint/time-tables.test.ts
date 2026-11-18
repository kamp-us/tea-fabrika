import { readFileSync } from "node:fs";
import { expect, it } from "vitest";
import { parse } from "yaml";
import { lintWorkflow as lint } from "../workflow-lint.ts";
import {
  type Parsed,
  place,
  type Plant,
  rejects,
  step,
  stepsOf,
  tableElsewhere,
  type Timed,
  timings,
  type Workflow,
} from "./wiring.test-support.ts";

// Today's CI, serving both versions. Covers time-tables.ts: each test leg's time table and timings
// upload (TT1, TT2). Each plant is given to every generated valid workflow alone
// (wiring.test-support.ts), so an unrelated error cannot mask it.

const plants: Plant[] = [
  // TT1 and TT2: every test leg writes its time table and uploads its timings file. Each plant was
  // also run once on workflow-lint.ts with its rule dropped, and that turned it red.
  ...(["next"] as const).flatMap((job): [string, (w: Workflow) => void][] => {
    // SAFETY: next's steps in `valid` are `NextStep` values, which carry the fields `Timed` reads.
    const steps = (w: Workflow) => stepsOf(w, job) as Timed[];
    const named = (w: Workflow, name: string) => steps(w).find((s) => s["name"] === name)!;
    const table = (w: Workflow) => named(w, "time table");
    const upload = (w: Workflow) => named(w, "timings");

    return [
      [`TT1: ${job} drops its time table`, (w) => void steps(w).splice(place(w, job, "time table"), 1)],
      [`TT1: ${job}'s time table skips a red leg`, (w) => (table(w).if = "success()")],
      [`TT1: ${job}'s time table skips a canceled leg`, (w) => (table(w).if = "!cancelled()")],
      [`TT1: ${job}'s time table can fail the job`, (w) => Reflect.deleteProperty(table(w), "continue-on-error")],
      [`TT1: ${job}'s time table has no time limit`, (w) => Reflect.deleteProperty(table(w), "timeout-minutes")],
      [`TT1: ${job}'s time table has no job id`, (w) => Reflect.deleteProperty(table(w).env!, "JOB_ID")],
      [
        `TT1: ${job}'s time table reads the old tooling legs' report`,
        (w) => (table(w).env!["REPORT"] = `\${{ runner.temp }}/tooling.json`),
      ],
      [
        `TT1: ${job}'s time table comes before shard times, so it misses that step`,
        (w) => {
          const [moved] = steps(w).splice(place(w, job, "time table"), 1);
          steps(w).splice(place(w, job, "shard times"), 0, moved!);
        },
      ],
      [`TT1: ${job} runs its time table twice`, (w) => void steps(w).splice(-1, 0, structuredClone(table(w)))],
      [`TT2: ${job} drops its timings upload`, (w) => void steps(w).splice(place(w, job, "timings"), 1)],
      [
        `TT2: ${job}'s timings lose the attempt, so a rerun's upload clashes`,
        (w) => (upload(w).with!["name"] = `timings-\${{ github.job }}-\${{ matrix.shard }}`),
      ],
      [`TT2: ${job}'s timings skip a red leg`, (w) => (upload(w).if = "success()")],
      [`TT2: ${job}'s timings can fail the job`, (w) => Reflect.deleteProperty(upload(w), "continue-on-error")],
      [`TT2: ${job}'s timings have no time limit`, (w) => Reflect.deleteProperty(upload(w), "timeout-minutes")],
      [
        `TT2: ${job}'s timings upload before the time table writes them`,
        (w) => {
          const [moved] = steps(w).splice(place(w, job, "timings"), 1);
          steps(w).splice(place(w, job, "time table"), 0, moved!);
        },
      ],
    ];
  }),
];

rejects(plants);

// TT1 and TT2 on the checked-in check.yaml: the lint's own words for each, one error each.
for (const [name, plant, error] of [
  [
    "TT1: next's time table skips a red leg",
    (w: Parsed) => {
      step(w, "next", "time table")["if"] = "success()";
    },
    "check.yaml: TT1: next ends its commands with the time table step once, on every result, never failing the job, reading next.json",
  ],
  [
    // A change to its `with:` is Q1's too (the scenario after this block), so this one keeps it.
    "TT2: next's timings skip a red leg",
    (w: Parsed) => {
      step(w, "next", "timings")["if"] = "success()";
    },
    "check.yaml: TT2: next uploads its timings file once, after the time table step, on every result, never failing the job, within a minute",
  ],
  [
    "M1: typecheck runs the time table's command with the token and a loader beside it",
    (w: Parsed) => {
      // Before its stop step, which stays last (F1).
      w.jobs["typecheck"]!.steps.splice(-1, 0, tableElsewhere());
    },
    "check.yaml: M1: only changes' classify step and the test jobs' time tables get the token",
  ],
  [
    "Q1: typecheck uploads a timings file, outside the test jobs",
    (w: Parsed) => {
      // Before its stop step, which stays last (F1).
      w.jobs["typecheck"]!.steps.splice(-1, 0, timings());
    },
    "check.yaml: Q1: the record's upload is the one step in check.yaml that uploads an artifact, beside the test legs' timings",
  ],
] as const) {
  it(`scenario: ${name} is named by its one error`, () => {
    const workflow: Parsed = parse(readFileSync(new URL("../../workflows/check.yaml", import.meta.url), "utf8"));
    plant(workflow);
    expect(lint(JSON.stringify(workflow))).toEqual([error]);
  });
}

it("scenario: Q1 and TT2: a timings upload named as a tested-tree record is refused by both", () => {
  // `matched` (changes.mjs) trusts an artifact by its `tested-<tree>-<base>` name from a green run,
  // so a timings upload under that name could stand in for a record.
  const workflow: Parsed = parse(readFileSync(new URL("../../workflows/check.yaml", import.meta.url), "utf8"));
  // SAFETY: check.yaml's next job has a timings upload step, which takes a `with` map of inputs.
  (step(workflow, "next", "timings")["with"] as Record<string, unknown>)["name"] = `tested-\${{ github.sha }}-base`;
  expect(lint(JSON.stringify(workflow))).toEqual([
    "check.yaml: Q1: the record's upload is the one step in check.yaml that uploads an artifact, beside the test legs' timings",
    "check.yaml: TT2: next uploads its timings file once, after the time table step, on every result, never failing the job, within a minute",
  ]);
});
