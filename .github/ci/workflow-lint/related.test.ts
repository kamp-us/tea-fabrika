import { readFileSync } from "node:fs";
import { expect, it } from "@effect/vitest";
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
  "next_pool",
  "related_pool",
  "private_group",
  "cancel",
  "depth",
  "projects",
  "head",
  "join",
  "soft_selector",
  "most",
]);

it.prop(
  "automatic related coverage rejects omitted workloads, unbounded pools and false-green selectors",
  { fault: Fault },
  ({ fault }) => {
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
      case "next_pool":
        delete workflow.jobs.next.concurrency;
        break;
      case "related_pool":
        delete workflow.jobs.related.concurrency;
        break;
      case "private_group":
        workflow.jobs.related.concurrency.group += `-\${{ github.run_id }}`;
        break;
      case "cancel":
        workflow.jobs.related.concurrency["cancel-in-progress"] = true;
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
  { arbitrary: { seed: 119120, runs: 100, size: 100 } },
);
