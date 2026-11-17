import { readFileSync } from "node:fs";
import { expect, it } from "@effect/vitest";
import { Schema } from "effect";
import { parse } from "yaml";
import { lintWorkflow } from "../workflow-lint.ts";

const text = readFileSync(new URL("../../workflows/check.yaml", import.meta.url), "utf8");

const Fault = Schema.Literals([
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

    switch (fault) {
      case "next_pool":
        delete workflow.jobs.next.concurrency;
        break;
      case "related_pool":
        delete workflow.jobs.related.concurrency;
        break;
      case "private_group":
        workflow.jobs.related.concurrency.group += "-${{ github.run_id }}";
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
        selector.env.HEAD = "${{ github.event.pull_request.head.sha }}";
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
