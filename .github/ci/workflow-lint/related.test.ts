import { readFileSync } from "node:fs";
import { afterAll, expect, it } from "@effect/vitest";
import { Schema } from "effect";
import { parse } from "yaml";
import { lintWorkflow } from "../workflow-lint.ts";

const text = readFileSync(new URL("../../workflows/check.yaml", import.meta.url), "utf8");

const Fault = Schema.Literals([
  "fault_history",
  "fault_assignment",
  "fault_order",
  "fault_slot",
  "fault_depth",
  "fault_limit",
  "fault_soft",
  "fault_upload",
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
  "automatic related coverage rejects omitted workloads, merge-line job groups and false-green selectors",
  { fault: Fault },
  ({ fault }) => {
    drawn.add(fault);

    expect(lintWorkflow(text)).toEqual([]);

    const workflow = parse(text);

    const selector = workflow.jobs.select.steps.find((step: { id?: string }) => step.id === "set");

    const integration = workflow.jobs.related.steps.find((step: { name?: string }) => step.name === "integration");

    const faults = workflow.jobs.related.steps.find((step: { name?: string }) => step.name === "checklist faults");

    switch (fault) {
      case "fault_history":
        delete workflow.jobs.related.steps.find((step: { uses?: string }) => step.uses?.startsWith("actions/checkout@"))
          .with["fetch-depth"];
        break;
      case "fault_assignment":
        faults.env.PLANTS = "{}";
        break;
      case "fault_order": {
        const index = workflow.jobs.related.steps.indexOf(faults);
        workflow.jobs.related.steps.splice(index, 1);

        const before = workflow.jobs.related.steps.indexOf(integration);
        workflow.jobs.related.steps.splice(before, 0, faults);
        break;
      }

      case "fault_slot":
        faults.if = "true";
        break;
      case "fault_depth":
        faults.env.FABRIKA_TEST_DEPTH = "fast";
        break;
      case "fault_limit":
        faults["timeout-minutes"] = 18;
        break;
      case "fault_soft":
        faults["continue-on-error"] = true;
        break;
      case "fault_upload":
        workflow.jobs.related.steps.find(
          (step: { name?: string }) => step.name === "checklist fault observations",
        ).with.path = "other.json";
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
