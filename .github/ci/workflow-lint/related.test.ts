import { readFileSync } from "node:fs";
import { afterAll, expect, it } from "@effect/vitest";
import { Schema } from "effect";
import { parse } from "yaml";
import { lintWorkflow } from "../workflow-lint.ts";

const text = readFileSync(new URL("../../workflows/check.yaml", import.meta.url), "utf8");

const Fault = Schema.Literals([
  "fault_history",
  "matrix_name",
  "selection_report",
  "results_report",
  "next_group",
  "related_group",
  "select_group",
  "own_group",
  "text_group",
  "select_own",
  "other_group",
  "other_case",
  "depth",
  "projects",
  "head",
  "join",
  "soft_selector",
  "most",
]);

// Coverage: every fault is drawn at least once, or the file fails loudly. A fixed seed makes the
// draw the same each run, so a fault a change to the list leaves unreached shows at once.
const drawn = new Set<string>();

afterAll(() => {
  expect([...drawn].toSorted()).toEqual([...Fault.literals].toSorted());
});

it.prop(
  "automatic related coverage rejects omitted workloads, merge-line groups and false-green selectors",
  { fault: Fault },
  ({ fault }) => {
    drawn.add(fault);

    expect(lintWorkflow(text)).toEqual([]);

    const workflow = parse(text);

    const selector = workflow.jobs.select.steps.find((step: { id?: string }) => step.id === "set");

    const integration = workflow.jobs.related.steps.find((step: { name?: string }) => step.name === "integration");

    switch (fault) {
      case "fault_history":
        delete workflow.jobs.related.steps.find((step: { uses?: string }) => step.uses?.startsWith("actions/checkout@"))
          .with["fetch-depth"];
        break;
      case "matrix_name":
        workflow.jobs.related.name = `related (\${{ matrix.shard }})`;
        break;
      case "selection_report":
        workflow.jobs.select.steps.find((step: { name?: string }) => step.name === "selected files").with.name =
          "tested-injected";
        break;
      case "results_report":
        workflow.jobs.related.steps.find((step: { name?: string }) => step.name === "results").with.path =
          `\${{ runner.temp }}/tested.json`;
        break;
      // Plants for 0598: the merge line takes no job group (R1), and no check.yaml job holds a
      // `scheduled-` one (R2). Each gives one job a group of the stated kind.
      case "next_group":
        workflow.jobs.next.concurrency = { group: "scheduled-proof-1", queue: "max", "cancel-in-progress": false };
        break;
      case "related_group":
        workflow.jobs.related.concurrency = { group: "scheduled-test-1", queue: "max", "cancel-in-progress": false };
        break;
      case "select_group":
        workflow.jobs.select.concurrency = { group: "scheduled-control", queue: "max", "cancel-in-progress": false };
        break;
      case "own_group":
        workflow.jobs.related.concurrency = {
          group: `related-\${{ github.run_id }}`,
          queue: "max",
          "cancel-in-progress": false,
        };
        break;
      case "select_own":
        workflow.jobs.select.concurrency = {
          group: `select-\${{ github.run_id }}`,
          queue: "max",
          "cancel-in-progress": false,
        };
        break;
      case "text_group":
        workflow.jobs.next.concurrency = "next-only";
        break;
      case "other_case":
        workflow.jobs.typecheck.concurrency = {
          group: "SCHEDULED-PROOF-2",
          queue: "max",
          "cancel-in-progress": false,
        };
        break;
      case "other_group":
        workflow.jobs.typecheck.concurrency = {
          group: "scheduled-main-1",
          queue: "max",
          "cancel-in-progress": false,
        };
        break;
      case "depth":
        integration.env.FABRIKA_TEST_DEPTH = "fast";
        break;
      case "projects":
        integration.run = integration.run.replace("next-integration", "today");
        break;
      case "head":
        selector.env.HEAD = `\${{ github.event.pull_request.head.sha }}`;
        break;
      case "join":
        workflow.jobs["ci-required"].needs.pop();
        break;
      case "soft_selector":
        selector["continue-on-error"] = true;
        break;
      case "most":
        selector.env.MOST_INTEGRATION = 9;
        break;
    }

    expect(lintWorkflow(JSON.stringify(workflow))).not.toEqual([]);
  },
  { arbitrary: { seed: 119120, runs: 400, size: 100 } },
);

// T1076 D3 and D4, with Q1's negative cases, after decision 0602: main's full run keeps the archive, so
// the real check.yaml holds the consumer fault step and the one new select output, and no receipt and no
// archive upload. Each isolated fault is given to the real, accepted workflow alone, so another rule's
// error cannot mask it. The original generated fault property above and its input domain stay as they are.
const READY =
  "(github.event_name == 'merge_group' || (github.event_name == 'pull_request' && !github.event.pull_request.draft))";

const squash = (value: unknown) => String(value).replace(/\s+/g, "");

const ARCHIVE_PATHS = [
  `\${{ runner.temp }}/kalfa-config-package/kalfa-config-0.0.0.tgz`,
  `\${{ runner.temp }}/kalfa-config-package/receipt.json`,
];

type Step = Record<string, any>;

/** The one step of `job` named `name`; a missing or doubled step is the failure, not a crash. */
const stepOf = (workflow: any, job: string, name: string): Step => {
  const found: Step[] = workflow.jobs[job].steps.filter((candidate: Step) => candidate["name"] === name);

  expect(found, `${job} needs exactly one step named "${name}"`).toHaveLength(1);

  return found[0]!;
};

/** Takes `moved` out of `job`'s steps and puts it just before (or after) `anchor`. */
const place = (workflow: any, job: string, moved: Step, anchor: Step, side: "before" | "after") => {
  const steps: Step[] = workflow.jobs[job].steps;

  steps.splice(steps.indexOf(moved), 1);
  steps.splice(steps.indexOf(anchor) + (side === "after" ? 1 : 0), 0, moved);
};

/** `text` with `part` taken out; the real step must hold it, so drift in the plan's text fails loudly. */
const without = (text: unknown, part: string): string => {
  const before = String(text);
  const after = before.replace(part, "");

  expect(after, `the step's condition holds "${part}"`).not.toBe(before);

  return after;
};

const swapped = (text: unknown, from: string, to: string): string => {
  const before = String(text);
  const after = before.replace(from, to);

  expect(after, `the step's condition holds "${from}"`).not.toBe(before);

  return after;
};

/** The two steps this lane kept on the merge line before 0602 moved the keep to main's full run. */
const OLD_RECEIPT = (): Step => ({
  name: "package receipt",
  id: "receipt",
  if: `success() && ${READY} && needs.select.outputs.archive == matrix.shard && steps.integration.outcome == 'success'`,
  env: {
    EVENT: `\${{ github.event_name }}`,
    DRAFT: `\${{ github.event.pull_request.draft }}`,
    HEAD: `\${{ github.sha }}`,
    REQUESTED: `\${{ github.event.pull_request.head.sha || github.event.merge_group.head_sha || github.sha }}`,
  },
  run: "node .github/ci/related.ts --receipt",
});

const OLD_ARCHIVE = (): Step => ({
  name: "package archive",
  if: `success() && ${READY} && needs.select.outputs.archive == matrix.shard && steps.receipt.outcome == 'success'`,
  uses: "actions/upload-artifact@v7",
  with: {
    name: `kalfa-config-\${{ github.sha }}-attempt-\${{ github.run_attempt }}`,
    path: ARCHIVE_PATHS.join("\n"),
    "if-no-files-found": "error",
    "retention-days": 90,
  },
});

it("scenario: D3 the real workflow has one consumer fault step in related alone, after tooling, and no receipt and no archive upload", () => {
  expect(lintWorkflow(text)).toEqual([]);

  const workflow = parse(text);

  const related: Step[] = workflow.jobs.related.steps;

  const fault = stepOf(workflow, "related", "consumer fault");

  const order = ["integration", "tooling", "consumer fault", "results"].map((name) =>
    related.findIndex((candidate) => candidate["name"] === name),
  );

  expect(order.every((at) => at >= 0)).toBe(true);
  expect(order).toEqual(order.toSorted((a, b) => a - b));

  // The fault step is related's alone; no job of check.yaml holds a receipt or an archive upload, and
  // nothing uploads a name starting `kalfa-config-`: main's full run keeps the archive (0602).
  for (const [name, job] of Object.entries<Step>(workflow.jobs)) {
    const steps: Step[] = job["steps"] ?? [];

    expect(
      steps.filter((candidate) => candidate["name"] === "consumer fault").length,
      `${name} holds the consumer fault only if it is related`,
    ).toBe(name === "related" ? 1 : 0);

    expect(
      steps.filter((candidate) => String(candidate["run"] ?? "").includes("--receipt")),
      `${name} runs no receipt`,
    ).toEqual([]);

    expect(
      steps.filter((candidate) => String(candidate["with"]?.["name"] ?? "").startsWith("kalfa-config-")),
      `${name} uploads no archive`,
    ).toEqual([]);

    expect(
      steps.filter((candidate) => candidate["name"] === "package receipt" || candidate["name"] === "package archive"),
      `${name} has no package receipt or package archive step`,
    ).toEqual([]);
  }

  expect(stepOf(workflow, "related", "integration")["id"]).toBeUndefined();

  // The consumer fault: the leg that owns P1, at full depth, in the tooling limit, after tooling.
  expect(fault["run"]).toBe("node .github/ci/related.ts --fault");
  expect(fault["continue-on-error"]).toBeUndefined();
  expect(fault["timeout-minutes"]).toBe(stepOf(workflow, "related", "tooling")["timeout-minutes"]);
  expect(fault["env"]).toEqual({ FABRIKA_TEST_DEPTH: "full" });

  for (const part of ["success()", "needs.select.outputs.consumer==matrix.shard"]) {
    expect(squash(fault["if"]), `fault needs ${part}`).toContain(squash(part));
  }

  // No token reaches the fault, and no step of related is the old receipt's.
  expect(JSON.stringify(fault)).not.toMatch(/token/i);
  expect(JSON.stringify(workflow.jobs.related)).not.toContain("select.outputs.archive");
});

it("scenario: D4 select prints exactly the five outputs from its set step, and related reads them through needs only", () => {
  expect(lintWorkflow(text)).toEqual([]);

  const workflow = parse(text);

  const five = ["consumer", "files", "legs", "projects", "run"];

  expect(Object.keys(workflow.jobs.select.outputs).toSorted()).toEqual(five);

  for (const key of five) {
    expect(workflow.jobs.select.outputs[key]).toBe(`\${{ steps.set.outputs.${key} }}`);
  }

  const read = JSON.stringify(workflow.jobs.related);

  expect(read).not.toMatch(/steps\.set\./);
  expect(read).toContain("needs.select.outputs.consumer");
});

// R1 is the related guard's: the fault step, the one new output and the command list. Q1 is the record
// guard, back at its parent's bytes: check.yaml uploads the record, the reports and the timings, and no
// archive. Each fault names the guard that must refuse it. Plants, each run once on the real file and
// restored: the old `package receipt` or `package archive` step put back (red for each), and the `archive`
// output put back (red).
type Edit = (workflow: any) => void;

const R1_FAULTS: Record<string, Edit> = {
  output_consumer_missing: (w) => delete w.jobs.select.outputs.consumer,
  output_consumer_other_step: (w) => (w.jobs.select.outputs.consumer = `\${{ steps.other.outputs.consumer }}`),
  output_archive_back: (w) => (w.jobs.select.outputs.archive = `\${{ steps.set.outputs.archive }}`),
  output_sixth: (w) => (w.jobs.select.outputs.sixth = `\${{ steps.set.outputs.sixth }}`),
  output_read_from_set: (w) => {
    const fault = stepOf(w, "related", "consumer fault");

    fault["if"] = swapped(fault["if"], "needs.select.outputs.consumer", "steps.set.outputs.consumer");
  },
  old_receipt_back: (w) => {
    const steps: Step[] = w.jobs.related.steps;

    steps.splice(steps.indexOf(stepOf(w, "related", "integration")) + 1, 0, OLD_RECEIPT());
  },
  fault_missing: (w) => {
    const steps: Step[] = w.jobs.related.steps;

    steps.splice(steps.indexOf(stepOf(w, "related", "consumer fault")), 1);
  },
  fault_renamed: (w) => (stepOf(w, "related", "consumer fault")["name"] = "package receipt"),
  fault_command: (w) => (stepOf(w, "related", "consumer fault")["run"] = "node .github/ci/related.ts"),
  fault_no_success: (w) => {
    const fault = stepOf(w, "related", "consumer fault");

    fault["if"] = without(fault["if"], "success() && ");
  },
  fault_unselected_leg: (w) => {
    const fault = stepOf(w, "related", "consumer fault");

    fault["if"] = swapped(fault["if"], "needs.select.outputs.consumer == matrix.shard", "true");
  },
  fault_soft: (w) => (stepOf(w, "related", "consumer fault")["continue-on-error"] = true),
  fault_depth: (w) => (stepOf(w, "related", "consumer fault")["env"].FABRIKA_TEST_DEPTH = "fast"),
  fault_limit: (w) => (stepOf(w, "related", "consumer fault")["timeout-minutes"] = 31),
  fault_token: (w) => (stepOf(w, "related", "consumer fault")["env"].GITHUB_TOKEN = `\${{ github.token }}`),
  fault_before_tooling: (w) =>
    place(w, "related", stepOf(w, "related", "consumer fault"), stepOf(w, "related", "tooling"), "before"),
  fault_twice: (w) => {
    const fault = stepOf(w, "related", "consumer fault");

    w.jobs.related.steps.splice(w.jobs.related.steps.indexOf(fault), 0, structuredClone(fault));
  },
};

const Q1_FAULTS: Record<string, Edit> = {
  old_archive_back: (w) => {
    const steps: Step[] = w.jobs.related.steps;

    steps.splice(steps.indexOf(stepOf(w, "related", "consumer fault")) + 1, 0, OLD_ARCHIVE());
  },
  old_archive_in_next: (w) => void w.jobs.next.steps.splice(-1, 0, OLD_ARCHIVE()),
  old_archive_in_changes: (w) => void w.jobs.changes.steps.push(OLD_ARCHIVE()),
  another_kalfa_upload: (w) =>
    void w.jobs.related.steps.splice(-1, 0, {
      ...OLD_ARCHIVE(),
      name: "another archive",
      with: { ...OLD_ARCHIVE().with, name: `kalfa-config-other`, path: `\${{ runner.temp }}/other.json` },
    }),
  archive_upload_soft: (w) => {
    const archive = { ...OLD_ARCHIVE(), "continue-on-error": true };

    w.jobs.related.steps.splice(-1, 0, archive);
  },
};

const refusing = (faults: Record<string, Edit>, guard: "R1" | "Q1") =>
  it.each(Object.entries(faults))(`scenario: ${guard} rejects the isolated delivery fault %s`, (_name, apply) => {
    expect(lintWorkflow(text), "the real workflow is accepted before the fault").toEqual([]);

    const workflow = parse(text);

    apply(workflow);

    const errors = lintWorkflow(JSON.stringify(workflow));

    expect(
      errors.some((error) => error.startsWith(`check.yaml: ${guard}:`)),
      `the ${guard} guard itself must refuse this isolated fault, not only another rule`,
    ).toBe(true);
  });

refusing(R1_FAULTS, "R1");

refusing(Q1_FAULTS, "Q1");
