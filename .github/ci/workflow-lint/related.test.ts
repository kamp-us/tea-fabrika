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

// T1076 D3 and D4, with Q1's negative cases. The real check.yaml must hold the three delivery steps
// of the related job and the two new select outputs, and each isolated fault is given to the real,
// accepted workflow alone, so another rule's error cannot mask it. The original generated fault
// property above and its input domain stay as they are.
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

it("scenario: D3 the real workflow has one receipt step, one consumer fault step and one archive upload, in related alone and in order", () => {
  expect(lintWorkflow(text)).toEqual([]);

  const workflow = parse(text);

  const related: Step[] = workflow.jobs.related.steps;

  const receipt = stepOf(workflow, "related", "package receipt");

  const fault = stepOf(workflow, "related", "consumer fault");

  const archive = stepOf(workflow, "related", "package archive");

  const order = ["integration", "package receipt", "tooling", "consumer fault", "package archive", "results"].map(
    (name) => related.findIndex((candidate) => candidate["name"] === name),
  );

  expect(order.every((at) => at >= 0)).toBe(true);
  expect(order).toEqual(order.toSorted((a, b) => a - b));

  for (const [name, job] of Object.entries<Step>(workflow.jobs)) {
    const named = (job["steps"] as Step[]).filter((candidate) =>
      ["package receipt", "consumer fault", "package archive"].includes(candidate["name"]),
    );

    expect(named.length, `${name} holds the delivery steps only if it is related`).toBe(name === "related" ? 3 : 0);
  }

  // The receipt: ready pull request or queue group, the owning leg, after a green integration step.
  expect(stepOf(workflow, "related", "integration")["id"]).toBe("integration");
  expect(receipt["id"]).toBe("receipt");
  expect(receipt["run"]).toBe("node .github/ci/related.ts --receipt");
  expect(receipt["continue-on-error"]).toBeUndefined();

  for (const part of [
    "success()",
    READY,
    "needs.select.outputs.archive==matrix.shard",
    "steps.integration.outcome=='success'",
  ]) {
    expect(squash(receipt["if"]), `receipt needs ${part}`).toContain(squash(part));
  }

  expect(receipt["env"]).toEqual({
    EVENT: `\${{ github.event_name }}`,
    DRAFT: `\${{ github.event.pull_request.draft }}`,
    HEAD: `\${{ github.sha }}`,
    REQUESTED: `\${{ github.event.pull_request.head.sha || github.event.merge_group.head_sha || github.sha }}`,
  });

  // The consumer fault: the leg that owns P1, at full depth, in the tooling limit, after tooling.
  expect(fault["run"]).toBe("node .github/ci/related.ts --fault");
  expect(fault["continue-on-error"]).toBeUndefined();
  expect(fault["timeout-minutes"]).toBe(stepOf(workflow, "related", "tooling")["timeout-minutes"]);
  expect(fault["env"]).toEqual({ FABRIKA_TEST_DEPTH: "full" });

  for (const part of ["success()", "needs.select.outputs.consumer==matrix.shard"]) {
    expect(squash(fault["if"]), `fault needs ${part}`).toContain(squash(part));
  }

  // The upload: the owning leg, after the receipt passed, exactly the archive and the receipt.
  expect(archive["uses"]).toBe("actions/upload-artifact@v7");
  expect(archive["continue-on-error"]).toBeUndefined();

  for (const part of [
    "success()",
    READY,
    "needs.select.outputs.archive==matrix.shard",
    "steps.receipt.outcome=='success'",
  ]) {
    expect(squash(archive["if"]), `upload needs ${part}`).toContain(squash(part));
  }

  expect(archive["with"]["name"]).toBe(`kalfa-config-\${{ github.sha }}-attempt-\${{ github.run_attempt }}`);
  expect(
    String(archive["with"]["path"])
      .trim()
      .split(/\r?\n/)
      .map((line) => line.trim()),
  ).toEqual(ARCHIVE_PATHS);
  expect(archive["with"]["if-no-files-found"]).toBe("error");
  expect(typeof archive["with"]["retention-days"]).toBe("number");
  expect(Object.keys(archive["with"]).toSorted()).toEqual(["if-no-files-found", "name", "path", "retention-days"]);

  // No token reaches the receipt, the fault or the upload.
  expect(JSON.stringify([receipt, fault, archive])).not.toMatch(/token/i);
});

it("scenario: D4 select prints exactly the six outputs from its set step, and related reads them through needs only", () => {
  expect(lintWorkflow(text)).toEqual([]);

  const workflow = parse(text);

  const six = ["archive", "consumer", "files", "legs", "projects", "run"];

  expect(Object.keys(workflow.jobs.select.outputs).toSorted()).toEqual(six);

  for (const key of six) {
    expect(workflow.jobs.select.outputs[key]).toBe(`\${{ steps.set.outputs.${key} }}`);
  }

  const read = JSON.stringify(workflow.jobs.related);

  expect(read).not.toMatch(/steps\.set\./);
  expect(read).toContain("needs.select.outputs.archive");
  expect(read).toContain("needs.select.outputs.consumer");
});

// R1 is the related guard's: the three steps, the two outputs and the command list. Q1 is the record
// guard's: the one upload tuple it permits and no other new upload. Each fault names the guard that
// must refuse it.
type Delivery = (workflow: any) => void;

const R1_FAULTS: Record<string, Delivery> = {
  output_archive_missing: (w) => delete w.jobs.select.outputs.archive,
  output_consumer_missing: (w) => delete w.jobs.select.outputs.consumer,
  output_archive_other_step: (w) => (w.jobs.select.outputs.archive = `\${{ steps.other.outputs.archive }}`),
  output_consumer_other_step: (w) => (w.jobs.select.outputs.consumer = `\${{ steps.other.outputs.consumer }}`),
  output_ninth: (w) => (w.jobs.select.outputs.ninth = `\${{ steps.set.outputs.ninth }}`),
  output_read_from_set: (w) => {
    const receipt = stepOf(w, "related", "package receipt");

    receipt["if"] = swapped(receipt["if"], "needs.select.outputs.archive", "steps.set.outputs.archive");
  },
  integration_id_missing: (w) => delete stepOf(w, "related", "integration")["id"],
  receipt_missing: (w) => {
    const steps: Step[] = w.jobs.related.steps;

    steps.splice(steps.indexOf(stepOf(w, "related", "package receipt")), 1);
  },
  receipt_command: (w) => (stepOf(w, "related", "package receipt")["run"] = "node .github/ci/related.ts"),
  receipt_event_env: (w) => (stepOf(w, "related", "package receipt")["env"].EVENT = "workflow_dispatch"),
  receipt_draft_env: (w) => (stepOf(w, "related", "package receipt")["env"].DRAFT = "false"),
  receipt_head: (w) =>
    (stepOf(w, "related", "package receipt")["env"].HEAD = `\${{ github.event.pull_request.head.sha }}`),
  receipt_requested: (w) => (stepOf(w, "related", "package receipt")["env"].REQUESTED = `\${{ github.sha }}`),
  receipt_swapped_commits: (w) => {
    const env = stepOf(w, "related", "package receipt")["env"];

    [env.HEAD, env.REQUESTED] = [env.REQUESTED, env.HEAD];
  },
  receipt_no_success: (w) => {
    const receipt = stepOf(w, "related", "package receipt");

    receipt["if"] = without(receipt["if"], "success() && ");
  },
  receipt_no_event_clause: (w) => {
    const receipt = stepOf(w, "related", "package receipt");

    receipt["if"] = without(receipt["if"], ` && ${READY}`);
  },
  receipt_unselected_leg: (w) => {
    const receipt = stepOf(w, "related", "package receipt");

    receipt["if"] = swapped(receipt["if"], "needs.select.outputs.archive == matrix.shard", "true");
  },
  receipt_no_integration_outcome: (w) => {
    const receipt = stepOf(w, "related", "package receipt");

    receipt["if"] = without(receipt["if"], " && steps.integration.outcome == 'success'");
  },
  receipt_soft: (w) => (stepOf(w, "related", "package receipt")["continue-on-error"] = true),
  receipt_token: (w) => (stepOf(w, "related", "package receipt")["env"].GITHUB_TOKEN = `\${{ github.token }}`),
  receipt_before_integration: (w) =>
    place(w, "related", stepOf(w, "related", "package receipt"), stepOf(w, "related", "integration"), "before"),
  receipt_after_tooling: (w) =>
    place(w, "related", stepOf(w, "related", "package receipt"), stepOf(w, "related", "tooling"), "after"),
  fault_missing: (w) => {
    const steps: Step[] = w.jobs.related.steps;

    steps.splice(steps.indexOf(stepOf(w, "related", "consumer fault")), 1);
  },
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
  archive_missing: (w) => {
    const steps: Step[] = w.jobs.related.steps;

    steps.splice(steps.indexOf(stepOf(w, "related", "package archive")), 1);
  },
};

const Q1_FAULTS: Record<string, Delivery> = {
  archive_wildcard_path: (w) =>
    (stepOf(w, "related", "package archive")["with"].path = `\${{ runner.temp }}/kalfa-config-package/**`),
  archive_third_path: (w) =>
    (stepOf(w, "related", "package archive")["with"].path = [...ARCHIVE_PATHS, `\${{ runner.temp }}/other.json`].join(
      "\n",
    )),
  archive_whole_folder: (w) =>
    (stepOf(w, "related", "package archive")["with"].path = `\${{ runner.temp }}/kalfa-config-package`),
  archive_no_archive_path: (w) => (stepOf(w, "related", "package archive")["with"].path = ARCHIVE_PATHS[1]),
  archive_no_receipt_path: (w) => (stepOf(w, "related", "package archive")["with"].path = ARCHIVE_PATHS[0]),
  archive_missing_warns: (w) => (stepOf(w, "related", "package archive")["with"]["if-no-files-found"] = "warn"),
  archive_missing_ignored: (w) => (stepOf(w, "related", "package archive")["with"]["if-no-files-found"] = "ignore"),
  archive_name_of_another_kind: (w) =>
    (stepOf(w, "related", "package archive")["with"].name = `tested-\${{ github.sha }}`),
  archive_name_without_attempt: (w) =>
    (stepOf(w, "related", "package archive")["with"].name = `kalfa-config-\${{ github.sha }}`),
  archive_no_success: (w) => {
    const archive = stepOf(w, "related", "package archive");

    archive["if"] = without(archive["if"], "success() && ");
  },
  archive_no_event_clause: (w) => {
    const archive = stepOf(w, "related", "package archive");

    archive["if"] = without(archive["if"], ` && ${READY}`);
  },
  archive_unselected_leg: (w) => {
    const archive = stepOf(w, "related", "package archive");

    archive["if"] = swapped(archive["if"], "needs.select.outputs.archive == matrix.shard", "true");
  },
  archive_no_receipt_outcome: (w) => {
    const archive = stepOf(w, "related", "package archive");

    archive["if"] = without(archive["if"], " && steps.receipt.outcome == 'success'");
  },
  archive_soft: (w) => (stepOf(w, "related", "package archive")["continue-on-error"] = true),
  archive_token: (w) => (stepOf(w, "related", "package archive")["with"]["github-token"] = `\${{ github.token }}`),
  archive_before_receipt: (w) =>
    place(w, "related", stepOf(w, "related", "package archive"), stepOf(w, "related", "package receipt"), "before"),
  archive_second_upload: (w) => {
    const archive = stepOf(w, "related", "package archive");

    w.jobs.related.steps.splice(w.jobs.related.steps.indexOf(archive), 0, structuredClone(archive));
  },
  archive_in_another_job: (w) => {
    const steps: Step[] = w.jobs.related.steps;

    const [archive] = steps.splice(steps.indexOf(stepOf(w, "related", "package archive")), 1);

    w.jobs.next.steps.splice(-1, 0, archive);
  },
  other_upload_beside_the_archive: (w) => {
    const archive = stepOf(w, "related", "package archive");

    w.jobs.related.steps.splice(w.jobs.related.steps.indexOf(archive) + 1, 0, {
      ...structuredClone(archive),
      name: "another archive",
      with: { ...archive["with"], name: `other-\${{ github.sha }}`, path: `\${{ runner.temp }}/other.json` },
    });
  },
};

const refusing = (faults: Record<string, Delivery>, guard: "R1" | "Q1") =>
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
