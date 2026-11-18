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

// P4 is an exact workflow scenario: every bounded refusal is exercised once against the real
// checked-in workflow. Keep the original generated fault property and its input domain unchanged.
const CONFIG_FAULTS = [
  "output",
  "verify",
  "event",
  "draft",
  "event_guard",
  "unselected",
  "success",
  "integration_success",
  "verified_success",
  "head",
  "requested",
  "order",
  "result",
  "path",
  "extra_path",
  "no_archive",
  "no_receipt",
  "missing_warn",
  "missing_ignore",
  "name",
  "soft",
  "upload_soft",
  "duplicate",
  "other_job",
  "token",
] as const;

it.each(CONFIG_FAULTS)("scenario: P4/Q1 rejects the isolated config upload fault %s", (fault) => {
  expect(lintWorkflow(text)).toEqual([]);

  const workflow = parse(text);

  const config = workflow.jobs.related.steps.find((step: { id?: string }) => step.id === "config");

  const archive = workflow.jobs.related.steps.find((step: { name?: string }) => step.name === "config archive");

  const integration = workflow.jobs.related.steps.find((step: { name?: string }) => step.name === "integration");

  switch (fault) {
    case "output":
      delete workflow.jobs.select.outputs.config;
      break;
    case "verify":
      config.run = "node .github/ci/related.ts";
      break;
    case "event":
      config.env.EVENT = "workflow_dispatch";
      break;
    case "draft":
      config.env.DRAFT = "false";
      break;
    case "event_guard":
      archive.if = archive.if.replace("github.event_name == 'merge_group'", "github.event_name != 'workflow_dispatch'");
      break;
    case "unselected":
      archive.if = archive.if.replace("fromJSON(needs.select.outputs.config)[matrix.shard] == true", "true");
      break;
    case "success":
      archive.if = archive.if.replace("success()", "always()");
      break;
    case "integration_success":
      config.if = config.if.replace("steps.integration.outcome == 'success'", "true");
      break;
    case "verified_success":
      archive.if = archive.if.replace("steps.config.outcome == 'success'", "true");
      break;
    case "head":
      config.env.HEAD = `\${{ github.event.pull_request.head.sha }}`;
      break;
    case "requested":
      config.env.REQUESTED = `\${{ github.sha }}`;
      break;
    case "order": {
      const at = workflow.jobs.related.steps.indexOf(config);
      workflow.jobs.related.steps.splice(at, 1);
      workflow.jobs.related.steps.splice(workflow.jobs.related.steps.indexOf(integration), 0, config);
      break;
    }
    case "result":
      delete integration.id;
      break;
    case "path":
      archive.with.path = `\${{ runner.temp }}/kalfa-config-package/**`;
      break;
    case "extra_path":
      archive.with.path += `\n\${{ runner.temp }}/other.json`;
      break;
    case "no_archive":
      archive.with.path = archive.with.path
        .split("\n")
        .filter((path: string) => !path.includes(".tgz"))
        .join("\n");
      break;
    case "no_receipt":
      archive.with.path = archive.with.path
        .split("\n")
        .filter((path: string) => !path.includes("receipt.json"))
        .join("\n");
      break;
    case "missing_warn":
      archive.with["if-no-files-found"] = "warn";
      break;
    case "missing_ignore":
      archive.with["if-no-files-found"] = "ignore";
      break;
    case "name":
      archive.with.name = `tested-\${{ github.sha }}`;
      break;
    case "soft":
      config["continue-on-error"] = true;
      break;
    case "upload_soft":
      archive["continue-on-error"] = true;
      break;
    case "duplicate":
      workflow.jobs.related.steps.splice(workflow.jobs.related.steps.indexOf(archive), 0, structuredClone(archive));
      break;
    case "other_job":
      workflow.jobs.related.steps.splice(workflow.jobs.related.steps.indexOf(archive), 1);
      workflow.jobs.next.steps.splice(-1, 0, archive);
      break;
    case "token":
      config.env.GITHUB_TOKEN = `\${{ github.token }}`;
      break;
  }

  const errors = lintWorkflow(JSON.stringify(workflow));

  expect(
    errors.some((error) => error.includes("Q1:")),
    "the global uploader guard itself rejects this isolated fault",
  ).toBe(true);
});
