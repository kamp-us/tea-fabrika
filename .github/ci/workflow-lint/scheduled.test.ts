import { readFileSync } from "node:fs";
import * as fc from "fast-check";
import { expect, it } from "vitest";
import { parse } from "yaml";
import { lintScheduled } from "./scheduled.ts";

// Today's CI, serving both versions. Covers scheduled.ts's laws on scheduled.yaml, the full run of
// all of next/ and every tooling test on main (0534), which a push to main or the hourly catch-up
// starts through its gate, at most once an hour (0581). Each generated workflow is the real
// one with what does not change its meaning varied, and each plant is applied to it alone, so an
// unrelated error cannot mask it. Each plant was also run once on workflow-lint.ts with its rule
// dropped, and that turned this law red.
const options = { seed: 119120, numRuns: 100 };

const read = (path: string) => readFileSync(new URL(`../../workflows/${path}`, import.meta.url), "utf8");

const check = read("check.yaml");

type Step = Record<string, unknown> & { env?: Record<string, unknown>; with?: Record<string, unknown> };

type Job = Record<string, unknown> & {
  steps: Step[];
  outputs?: Record<string, unknown>;
  concurrency?: Record<string, unknown>;
  strategy?: { "fail-fast"?: unknown; "max-parallel"?: unknown; matrix: { shard: unknown } };
  permissions?: unknown;
  needs?: unknown;
};

type Workflow = Record<string, unknown> & {
  on: Record<string, unknown>;
  env?: Record<string, unknown>;
  concurrency: Record<string, unknown>;
  permissions: unknown;
  jobs: Record<string, Job>;
};

const real = (): Workflow => parse(read("scheduled.yaml"));

/**
 * Moves the legs whose shard `leaves` picks out of the test job into a job of their own, `split`,
 * with the same steps, as two matrices were before 2026-11-15, and has the report wait on it too.
 */
const split = (w: Workflow, leaves: (shard: string) => boolean) => {
  const tests = w.jobs["tests"]!;
  const all = tests.strategy!.matrix.shard as string[];
  const apart = structuredClone(tests);
  apart.strategy!.matrix.shard = all.filter(leaves);
  apart.strategy!["max-parallel"] = 1;
  tests.strategy!.matrix.shard = all.filter((shard) => !leaves(shard));
  tests.strategy!["max-parallel"] = 1;
  w.jobs["split"] = apart;
  (w.jobs["report"]!.needs as string[]).push("split");
};

/** The one step of `job` named `name`, so a plant never depends on where a step sits. */
const step = (w: Workflow, job: string, name: string): Step => {
  const found = w.jobs[job]!.steps.filter((s) => s["name"] === name);

  if (found.length !== 1) {
    throw new Error(`${job} has ${found.length} steps named "${name}"`);
  }

  return found[0]!;
};

// What may change without changing what the full run does: the catch-up's minute (0581 fixes the
// cron hourly, and its minute stays a choice), the gap (a setting, 0069, an hour at least), the
// workflow group's case and spacing, how many legs run at once within the cap, and the spacing in an `if`,
// a job's or a step's. Each is varied only where the real workflow has it, so a part it lacks stays
// missing.
const spaced = (value: unknown, gap: string) =>
  typeof value === "string" ? value.replace(/ *(==|!=|&&|\|\|) */g, `${gap}$1${gap}`) : value;

const scheduled = fc
  .tuple(
    fc.integer({ min: 1, max: 59 }),
    fc.integer({ min: 60, max: 1440 }),
    fc.integer({ min: 1, max: 9 }),
    fc.constantFrom("", " ", "  "),
    fc.shuffledSubarray(["1", "2", "3", "4", "5", "6", "7", "8", "9"], { minLength: 9, maxLength: 9 }),
    fc.boolean(),
    fc.boolean(),
  )
  .map(([minute, minutes, most, gap, slots, numeric, upper]) => {
    const w = real();
    const crons = Array.isArray(w.on["schedule"]) ? (w.on["schedule"] as { cron?: unknown }[]) : [];

    for (const cron of crons) {
      if (typeof cron.cron === "string") {
        cron.cron = cron.cron.replace(/^\d+ /, `${minute} `);
      }
    }

    if (w.env !== undefined && "GAP_MINUTES" in w.env) {
      w.env["GAP_MINUTES"] = minutes;
    }

    w.concurrency["group"] = `${upper ? "SCHEDULED" : "scheduled"}-\${{${gap}github.ref${gap}}}`;
    w.jobs["tests"]!.strategy!["max-parallel"] = most;
    // The most changed legs at once is one setting, MOST, the matrix's alias of it (0590).
    w.jobs["changed"]!.strategy!["max-parallel"] = most;
    step(w, "select", "set").env!["MOST"] = most;

    const shards = w.jobs["tests"]!.strategy!.matrix.shard;
    const full = w.jobs["tests"]!.concurrency;

    if (Array.isArray(shards) && full !== undefined && "group" in full) {
      const pairs = shards.map((shard, i) => [shard, numeric ? Number(slots[i]) : slots[i]]);
      const values = Object.fromEntries(upper ? pairs.toReversed() : pairs);
      full["group"] = `scheduled-test-\${{${gap}fromJSON('${JSON.stringify(values)}')[matrix.shard]${gap}}}`;
    }

    for (const job of Object.values(w.jobs)) {
      if (upper && typeof job.concurrency?.["group"] === "string") {
        job.concurrency["group"] = job.concurrency["group"].replace(/^scheduled-/, "SCHEDULED-");
      }
    }

    for (const job of Object.values(w.jobs)) {
      if ("if" in job) {
        job["if"] = spaced(job["if"], gap);
      }

      for (const s of job.steps) {
        if ("if" in s) {
          s["if"] = spaced(s["if"], gap);
        }
      }
    }

    return w;
  });

const lint = (w: Workflow) => lintScheduled(JSON.stringify(w), check);

const rotationSlots = () =>
  Object.fromEntries(Array.from({ length: 9 }, (_, index) => [String(index + 1), String(index + 1)]));

const changedRotation = (w: Workflow, slots: unknown = rotationSlots()) => {
  step(w, "select", "set").env!["RUN_NUMBER"] = `\${{ github.run_number }}`;
  w.jobs["select"]!.outputs!["slots"] = `\${{ steps.set.outputs.slots }}`;
  w.jobs["changed"]!.concurrency!["group"] =
    `scheduled-test-\${{ fromJSON('${JSON.stringify(slots)}')[fromJSON(needs.select.outputs.slots)[matrix.shard]] || '1' }}`;
  return w;
};

// Plant: keep the old direct-slot-only guard, so the bounded rotation cannot pass preflight.
it("property: SC19 accepts the run-number rotation through a closed nine-slot lookup", () => {
  fc.assert(
    fc.property(scheduled, (w) => {
      expect(lint(changedRotation(w))).toEqual([]);
      w.jobs["changed"]!.concurrency!["group"] = `scheduled-test-\${{ matrix.shard }}`;
      Reflect.deleteProperty(step(w, "select", "set").env!, "RUN_NUMBER");
      Reflect.deleteProperty(w.jobs["select"]!.outputs!, "slots");
      expect(lint(w)).toEqual([]);
    }),
    options,
  );
});

/** Rebuilds the full matrix's closed slot map, then applies one isolated input mutation. */
const remap = (w: Workflow, change: (slots: Record<string, string>) => void) => {
  const shards = w.jobs["tests"]!.strategy!.matrix.shard;

  if (!Array.isArray(shards) || !shards.every((shard) => typeof shard === "string")) {
    throw new Error("the full matrix has no literal shard list");
  }

  const slots = Object.fromEntries(shards.map((shard, i) => [shard, String(i + 1)]));
  change(slots);
  w.jobs["tests"]!.concurrency!["group"] = `scheduled-test-\${{ fromJSON('${JSON.stringify(slots)}')[matrix.shard] }}`;
};

// SC18's message, which a scenario on the next limit expects beside SC13's.
const CHANGED_RULE =
  "SC18: changed runs only when select said changed with a leg, each leg its own list over every project at next's limit and backstop, select's LIMIT that limit, chromium first for a visual file, and nothing else";

it("pinned: the real scheduled.yaml passes, against the real check.yaml", () => {
  expect(lintScheduled(read("scheduled.yaml"), check)).toEqual([]);
});

it("property: a schedule varied only where its meaning holds passes", () => {
  const reached = new Set<string>();
  fc.assert(
    fc.property(scheduled, (w) => {
      const group = String(w.jobs["tests"]!.concurrency?.["group"]);
      reached.add(group.startsWith("SCHEDULED-") ? "upper" : "lower");
      reached.add(/:"[1-9]"/.test(group) ? "text" : "number");
      reached.add(String(w.concurrency["group"]).includes(`\${{github.ref}}`) ? "compact" : "spaced");
      expect(lint(w)).toEqual([]);
    }),
    options,
  );
  expect(
    ["upper", "lower", "text", "number", "compact", "spaced"].every((kind) => reached.has(kind)),
    [...reached].join(", "),
  ).toBe(true);
});

// The step that ended each test job until 2026-11-15: after a failure it canceled the job's own
// run, and GitHub ended that run `cancelled`, never `failure`.
const stop = {
  name: "stop the run",
  if: `\${{ failure() && github.event_name != 'push' }}`,
  env: { GH_TOKEN: `\${{ github.token }}` },
  run: 'gh run cancel "$GITHUB_RUN_ID" --repo "$GITHUB_REPOSITORY"',
};

/** The gate job, which the real workflow must have for its plants to apply. */
const gate = (w: Workflow): Job => {
  const job = w.jobs["gate"];

  if (job === undefined) {
    throw new Error("scheduled.yaml has no gate job");
  }

  return job;
};

// Each fault starts from a valid rotation, including while main still uses direct slots.
const rotationPlants: [string, (w: Workflow) => void][] = [
  ["SC19: rotation has no run number", (w) => Reflect.deleteProperty(step(w, "select", "set").env!, "RUN_NUMBER")],
  [
    "SC19: rotation changes on retry",
    (w) => (step(w, "select", "set").env!["RUN_NUMBER"] = `\${{ github.run_attempt }}`),
  ],
  [
    "SC19: rotation reads a private run source",
    (w) => (step(w, "select", "set").env!["RUN_NUMBER"] = `\${{ vars.RUN_NUMBER }}`),
  ],
  ["SC19: rotation has no slot output", (w) => Reflect.deleteProperty(w.jobs["select"]!.outputs!, "slots")],
  [
    "SC19: rotation reads another step's output",
    (w) => (w.jobs["select"]!.outputs!["slots"] = `\${{ steps.other.outputs.slots }}`),
  ],
  ["SC19: rotation reaches a tenth slot", (w) => void changedRotation(w, { ...rotationSlots(), "1": "10" })],
  ["SC19: rotation reuses a slot", (w) => void changedRotation(w, { ...rotationSlots(), "2": "1" })],
  [
    "SC19: rotation hides the recorded physical slots",
    (w) => void changedRotation(w, { ...rotationSlots(), "1": "2", "2": "1" }),
  ],
  ["SC19: rotation adds another key", (w) => void changedRotation(w, { ...rotationSlots(), "10": "1" })],
  [
    "SC19: rotation loses a key",
    (w) => {
      const slots = rotationSlots();
      Reflect.deleteProperty(slots, "1");
      changedRotation(w, slots);
    },
  ],
  ["SC19: rotation has a JSON list", (w) => void changedRotation(w, ["1", "2", "3", "4", "5", "6", "7", "8", "9"])],
  [
    "SC19: rotation has malformed JSON",
    (w) => {
      w.jobs["changed"]!.concurrency!["group"] = String(w.jobs["changed"]!.concurrency!["group"]).replace(
        '"1":"1"',
        '"1":',
      );
    },
  ],
  [
    "SC19: rotation takes a private suffix",
    (w) => {
      w.jobs["changed"]!.concurrency!["group"] = `${String(w.jobs["changed"]!.concurrency!["group"])}-private`;
    },
  ],
  [
    "SC19: rotation reads arbitrary runtime slots",
    (w) => {
      w.jobs["changed"]!.concurrency!["group"] = String(w.jobs["changed"]!.concurrency!["group"]).replace(
        "needs.select.outputs.slots",
        "vars.slots",
      );
    },
  ],
  [
    "SC19: rotation falls back outside the shared slots",
    (w) => {
      w.jobs["changed"]!.concurrency!["group"] = String(w.jobs["changed"]!.concurrency!["group"]).replace(
        "|| '1'",
        "|| '10'",
      );
    },
  ],
];

const plants: [string, (w: Workflow) => void][] = [
  // SC1: a push to main, the hourly catch-up and a hand start, nothing else (0581); no merge line
  // event runs the whole suite. The plants of SC1, SC5, SC6 and SC14 to SC16 were each run once on
  // scheduled.ts with its rule dropped, over a draft of the new scheduled.yaml that was then
  // restored, and each turned its law red.
  ["SC1: a pull request starts the full run", (w) => (w.on["pull_request"] = {})],
  ["SC1: the merge queue starts the full run", (w) => (w.on["merge_group"] = { types: ["checks_requested"] })],
  ["SC1: no schedule", (w) => Reflect.deleteProperty(w.on, "schedule")],
  ["SC1: two cron lines", (w) => (w.on["schedule"] = [{ cron: "7 * * * *" }, { cron: "37 * * * *" }])],
  ["SC1: the old 3-hour cron", (w) => (w.on["schedule"] = [{ cron: "17 */3 * * *" }])],
  ["SC1: the catch-up at minute 0, the busiest", (w) => (w.on["schedule"] = [{ cron: "0 * * * *" }])],
  ["SC1: a push to main no longer starts it", (w) => Reflect.deleteProperty(w.on, "push")],
  ["SC1: a push to any branch starts it", (w) => (w.on["push"] = {})],
  ["SC1: a push to main skips some paths", (w) => (w.on["push"] = { branches: ["main"], "paths-ignore": ["docs/**"] })],
  ["SC1: no hand start", (w) => Reflect.deleteProperty(w.on, "workflow_dispatch")],
  // SC16: the gap, a setting of an hour at least (0581's binding constraint).
  ["SC16: a gap of half an hour", (w) => (w.env = { GAP_MINUTES: 30 })],
  ["SC16: a gap a minute short of an hour", (w) => (w.env = { GAP_MINUTES: 59 })],
  ["SC16: a gap in words", (w) => (w.env = { GAP_MINUTES: "1h" })],
  ["SC16: a gap as text", (w) => (w.env = { GAP_MINUTES: "60" })],
  [
    "SC16: the gap moved to the gate's step",
    (w) => {
      Reflect.deleteProperty(w, "env");
      const decide = gate(w).steps.find((s) => s["id"] === "decide")!;
      decide.env = { ...decide.env, GAP_MINUTES: 60 };
    },
  ],
  ["SC16: a second workflow env value", (w) => (w.env = { ...w.env, FABRIKA_TEST_DEPTH: "full" })],
  // SC14: the gate, first, with its one output.
  ["SC14: the gate waits on the tests", (w) => (gate(w).needs = ["tests"])],
  ["SC14: the gate runs only on a push", (w) => (gate(w)["if"] = "github.event_name == 'push'")],
  [
    "SC14: the gate's output is read from another step",
    (w) => (gate(w)["outputs"] = { start: `\${{ steps.other.outputs.start }}` }),
  ],
  [
    "SC14: the gate gives a second output",
    (w) => (gate(w)["outputs"] = { start: `\${{ steps.decide.outputs.start }}`, why: "x" }),
  ],
  [
    "SC14: the gate's step has no token",
    (w) =>
      Reflect.deleteProperty(
        gate(w).steps.find((s) => s["id"] === "decide")!,
        "env",
      ),
  ],
  [
    "SC14: the gate's step takes a secret",
    (w) => (gate(w).steps.find((s) => s["id"] === "decide")!.env = { GITHUB_TOKEN: `\${{ secrets.BOT }}` }),
  ],
  [
    "SC14: the gate runs another script",
    (w) => (gate(w).steps.find((s) => s["id"] === "decide")!["run"] = "node .github/ci/scheduled.mjs"),
  ],
  ["SC14: the gate's step has another id", (w) => (gate(w).steps.find((s) => s["id"] === "decide")!["id"] = "read")],
  [
    "SC14: the gate checks out the whole repository",
    (w) => Reflect.deleteProperty(gate(w).steps.find((s) => typeof s["uses"] === "string")!.with!, "sparse-checkout"),
  ],
  // SC14, the review of pull request 1404: a gate that ends with no `start` and no failure leaves
  // main unproven with no sev1. A job that hits its own limit ends `cancelled`, read as stopped by
  // a person; `continue-on-error` reads a failed read as a success. Plants, each run once on
  // scheduled.ts and restored: the step-limit check dropped (red on the first three); the
  // continue-on-error check dropped (red on the last two).
  [
    "SC14: the gate's step has no time limit of its own, so only the job's limit stops it",
    (w) =>
      Reflect.deleteProperty(
        gate(w).steps.find((s) => s["id"] === "decide")!,
        "timeout-minutes",
      ),
  ],
  [
    "SC14: the gate's checkout has no time limit of its own",
    (w) =>
      Reflect.deleteProperty(
        gate(w).steps.find((s) => typeof s["uses"] === "string")!,
        "timeout-minutes",
      ),
  ],
  ["SC14: the gate job's limit is no backstop past its steps'", (w) => (gate(w)["timeout-minutes"] = 1)],
  [
    "SC14: the gate's step continues on error",
    (w) => (gate(w).steps.find((s) => s["id"] === "decide")!["continue-on-error"] = true),
  ],
  ["SC14: the gate job continues on error", (w) => (gate(w)["continue-on-error"] = true)],
  // SC14, the recheck of pull request 1404: a skipped gate step ends the job `success` with no
  // `start`, which the report reads as stopped. Plant, run once on scheduled.ts and restored: the
  // step `if` check dropped (red on all three).
  ["SC14: the gate's step never runs", (w) => (gate(w).steps.find((s) => s["id"] === "decide")!["if"] = false)],
  [
    "SC14: the gate's step runs only on a push",
    (w) => (gate(w).steps.find((s) => s["id"] === "decide")!["if"] = `\${{ github.event_name == 'push' }}`),
  ],
  [
    "SC14: the gate's checkout never runs",
    (w) => (gate(w).steps.find((s) => typeof s["uses"] === "string")!["if"] = false),
  ],
  // SC15: the tests start only on the gate's `true`.
  ["SC15: the tests run whatever the gate said", (w) => Reflect.deleteProperty(w.jobs["tests"]!, "if")],
  ["SC15: the tests run when the gate passed", (w) => (w.jobs["tests"]!["if"] = "needs.gate.result == 'success'")],
  [
    "SC15: the tests run unless the gate said false",
    (w) => (w.jobs["tests"]!["if"] = "needs.gate.outputs.start != 'false'"),
  ],
  ["SC15: the tests wait on nothing", (w) => Reflect.deleteProperty(w.jobs["tests"]!, "needs")],
  // SC2: one run per ref at a time, never cut short. Plants run once: the old literal-group
  // guard rejects valid refs; dropping SC2 admits each break below. Restored after each run.
  ["SC2: a newer run cancels the running one", (w) => (w.concurrency["cancel-in-progress"] = true)],
  ["SC2: no group", (w) => Reflect.deleteProperty(w.concurrency, "group")],
  ["SC2: no explicit cancellation policy", (w) => Reflect.deleteProperty(w.concurrency, "cancel-in-progress")],
  ["SC2: one global group delays unrelated refs", (w) => (w.concurrency["group"] = "scheduled")],
  ["SC2: one group per commit overlaps main runs", (w) => (w.concurrency["group"] = `scheduled-\${{ github.sha }}`)],
  ["SC2: one group per run overlaps main runs", (w) => (w.concurrency["group"] = `scheduled-\${{ github.run_id }}`)],
  ["SC2: a short ref can mix a branch and tag", (w) => (w.concurrency["group"] = `scheduled-\${{ github.ref_name }}`)],
  [
    "SC2: an event suffix separates main's triggers",
    (w) => (w.concurrency["group"] = `scheduled-\${{ github.ref }}-\${{ github.event_name }}`),
  ],
  ["SC2: another prefix separates participating runs", (w) => (w.concurrency["group"] = `proof-\${{ github.ref }}`)],
  // SC12: a newer run never cancels a waiting run on the same ref.
  ["SC12: no queue, so a newer run cancels the waiting one", (w) => Reflect.deleteProperty(w.concurrency, "queue")],
  ["SC12: one waiting run at most", (w) => (w.concurrency["queue"] = "single")],
  // SC19: the same nine test groups and one control group across participating workflows.
  // Plants, each run once with its new guard dropped and restored, must fail their own rule.
  ...rotationPlants.map(([name, mutate]): [string, (w: Workflow) => void] => [
    name,
    (w) => {
      changedRotation(w);
      mutate(w);
    },
  ]),
  ["SC19: an extra job has no shared slot", (w) => (w.jobs["extra"] = { "runs-on": "ubuntu-latest", steps: [] })],
  [
    "SC19: changed adds another matrix axis",
    (w) => void Object.assign(w.jobs["changed"]!.strategy!.matrix, { extra: ["a", "b"] }),
  ],
  ["SC19: changed admits a fixed unmapped slot", (w) => (w.jobs["changed"]!.strategy!.matrix.shard = ["10"])],
  [
    "SC19: changed reads arbitrary slots",
    (w) => (w.jobs["changed"]!.strategy!.matrix.shard = `\${{ fromJSON(vars.shards) }}`),
  ],
  [
    "SC19: changed's parallel count differs from its slot selection",
    (w) => (w.jobs["changed"]!.strategy!["max-parallel"] = 10),
  ],
  ...(["gate", "select", "report", "tests", "changed"] as const).flatMap((job): [string, (w: Workflow) => void][] => [
    [`SC19: ${job} has no shared job group`, (w) => Reflect.deleteProperty(w.jobs[job]!, "concurrency")],
    [`SC19: ${job} replaces a waiting job`, (w) => Reflect.deleteProperty(w.jobs[job]!.concurrency!, "queue")],
    [`SC19: ${job} keeps only one waiting job`, (w) => (w.jobs[job]!.concurrency!["queue"] = "single")],
    [`SC19: ${job} cancels a running job`, (w) => (w.jobs[job]!.concurrency!["cancel-in-progress"] = true)],
    [
      `SC19: ${job} has no explicit cancellation policy`,
      (w) => Reflect.deleteProperty(w.jobs[job]!.concurrency!, "cancel-in-progress"),
    ],
    [
      `SC19: ${job} has a group per ref`,
      (w) => (w.jobs[job]!.concurrency!["group"] = `${String(w.jobs[job]!.concurrency!["group"])}-\${{ github.ref }}`),
    ],
    [
      `SC19: ${job} has a group per source`,
      (w) => (w.jobs[job]!.concurrency!["group"] = `${String(w.jobs[job]!.concurrency!["group"])}-\${{ github.sha }}`),
    ],
    [
      `SC19: ${job} has a group per run`,
      (w) =>
        (w.jobs[job]!.concurrency!["group"] = `${String(w.jobs[job]!.concurrency!["group"])}-\${{ github.run_id }}`),
    ],
  ]),
  ["SC19: gate uses another control group", (w) => (w.jobs["gate"]!.concurrency!["group"] = "scheduled-select")],
  [
    "SC19: changed uses its own slot namespace",
    (w) => (w.jobs["changed"]!.concurrency!["group"] = `scheduled-changed-\${{ matrix.shard }}`),
  ],
  ["SC19: the full slot map loses a shard", (w) => remap(w, (slots) => Reflect.deleteProperty(slots, "e2e-1"))],
  ["SC19: the full slot map adds a shard", (w) => remap(w, (slots) => (slots["extra"] = "1"))],
  ["SC19: two full shards share one slot", (w) => remap(w, (slots) => (slots["e2e-2"] = slots["e2e-1"]!))],
  ["SC19: the full slot map reaches a tenth test slot", (w) => remap(w, (slots) => (slots["e2e-1"] = "10"))],
  [
    "SC19: the full slot map is malformed JSON",
    (w) => (w.jobs["tests"]!.concurrency!["group"] = `scheduled-test-\${{ fromJSON('{')[matrix.shard] }}`),
  ],
  [
    "SC19: the full slot map is a JSON list",
    (w) =>
      (w.jobs["tests"]!.concurrency!["group"] = `scheduled-test-\${{ fromJSON('[1,2,3,4,5,6,7,8,9]')[matrix.shard] }}`),
  ],
  ["SC19: the workflow holds the control job's group", (w) => (w.concurrency["group"] = "SCHEDULED-CONTROL")],
  ["SC19: the workflow holds a test job's group", (w) => (w.concurrency["group"] = "SCHEDULED-TEST-1")],
  [
    "SC19: the full matrix gains another dimension",
    (w) => void Object.assign(w.jobs["tests"]!.strategy!.matrix, { extra: ["a", "b"] }),
  ],
  [
    "SC19: changed can name a tenth test slot",
    (w) => {
      w.jobs["changed"]!.strategy!["max-parallel"] = 10;
      step(w, "select", "set").env!["MOST"] = 10;
    },
  ],
  // SC3: the token, the gate's included.
  ["SC3: the gate's own token writes actions", (w) => (gate(w).permissions = { actions: "write" })],
  [
    "SC3: the workflow's token writes issues",
    (w) => (w.permissions = { actions: "read", contents: "read", issues: "write" }),
  ],
  ["SC3: the workflow's token is write-all", (w) => (w.permissions = "write-all")],
  [
    "SC3: the workflow's token writes actions, so a step could cancel the run again",
    (w) => (w.permissions = { actions: "write", contents: "read" }),
  ],
  [
    "SC3: the workflow's token loses actions: read, so no time table reads its job",
    (w) => (w.permissions = { contents: "read" }),
  ],
  [
    "SC3: the report's token writes contents",
    (w) => (w.jobs["report"]!.permissions = { actions: "read", contents: "write", issues: "write" }),
  ],
  [
    "SC3: the report cannot write issues",
    (w) => (w.jobs["report"]!.permissions = { actions: "read", contents: "read" }),
  ],
  [
    "SC3: a test job takes issues: write",
    (w) => (w.jobs["tests"]!.permissions = { actions: "read", contents: "read", issues: "write" }),
  ],
  ["SC3: a test job's own token writes actions", (w) => (w.jobs["tests"]!.permissions = { actions: "write" })],
  // SC4: no step cancels the run, time limits, the token out of .git/config.
  [
    "SC4: a step calls the REST API's cancel",
    (w) =>
      void w.jobs["tests"]!.steps.push({
        if: "failure()",
        run: 'gh api -X POST "repos/$GITHUB_REPOSITORY/actions/runs/$GITHUB_RUN_ID/cancel"',
      }),
  ],
  [
    "SC4: a step force-cancels",
    (w) =>
      void w.jobs["tests"]!.steps.push({
        run: 'gh api -X POST "repos/$GITHUB_REPOSITORY/actions/runs/$GITHUB_RUN_ID/force-cancel"',
      }),
  ],
  [
    "SC4: an action cancels the run",
    (w) => void w.jobs["tests"]!.steps.push({ uses: "someone/cancel-workflow-action@v1" }),
  ],
  ["SC4: the test job runs on always()", (w) => (w.jobs["tests"]!["if"] = "always()")],
  ["SC4: the test job has no time limit", (w) => Reflect.deleteProperty(w.jobs["tests"]!, "timeout-minutes")],
  ["SC4: the report's time limit is an expression", (w) => (w.jobs["report"]!["timeout-minutes"] = `\${{ 5 }}`)],
  ["SC4: the report has no time limit", (w) => Reflect.deleteProperty(w.jobs["report"]!, "timeout-minutes")],
  [
    "SC4: next's checkout keeps the token in .git/config",
    (w) => Reflect.deleteProperty(w.jobs["tests"]!.steps[0]!.with!, "persist-credentials"),
  ],
  [
    "SC4: the report's checkout keeps the token in .git/config",
    (w) => (w.jobs["report"]!.steps[0]!.with!["persist-credentials"] = true),
  ],
  // SC5: the report.
  ["SC5: the report skips after a red leg", (w) => (w.jobs["report"]!["if"] = "github.ref == 'refs/heads/main'")],
  // A skipped run would judge itself and close the open issue.
  ["SC5: the report runs on a run whose gate said false", (w) => (w.jobs["report"]!["if"] = "always()")],
  [
    "SC5: the report skips a run whose gate failed",
    (w) => (w.jobs["report"]!["if"] = "always() && needs.gate.outputs.start == 'true'"),
  ],
  ["SC5: the report does not wait on the gate", (w) => (w.jobs["report"]!.needs = ["tests"])],
  [
    "SC5: the gate's checkout gets the token",
    (w) => {
      const checkout = gate(w).steps.find((s) => typeof s["uses"] === "string")!;
      checkout.env = { GITHUB_TOKEN: `\${{ github.token }}` };
    },
  ],
  [
    "SC5: the report runs on main alone, so a branch's run with a timed-out leg ends cancelled",
    (w) => (w.jobs["report"]!["if"] = `\${{ always() && github.ref == 'refs/heads/main' }}`),
  ],
  ["SC5: the report waits on nothing", (w) => (w.jobs["report"]!.needs = [])],
  ["SC5: the report waits on the tests alone", (w) => (w.jobs["report"]!.needs = ["tests"])],
  ["SC5: the report's failure is hidden", (w) => (step(w, "report", "report")["continue-on-error"] = true)],
  ["SC5: the report runs another script", (w) => (step(w, "report", "report")["run"] = "node .github/ci/required.mjs")],
  ["SC5: the report is not told the needs", (w) => Reflect.deleteProperty(step(w, "report", "report").env!, "NEEDS")],
  ["SC5: the report takes a secret", (w) => (step(w, "report", "report").env!["GITHUB_TOKEN"] = `\${{ secrets.BOT }}`)],
  [
    "SC5: a test step gets the token",
    (w) => (step(w, "tests", "vitest").env!["GITHUB_TOKEN"] = `\${{ github.token }}`),
  ],
  // The report tells a timed-out leg by its test steps' limit: a missing or stale one reads a
  // time-out as a red test or a leg canceled by hand (run 43723335863 opened no issue).
  [
    "SC5: the report is not told next's limit",
    (w) => Reflect.deleteProperty(step(w, "report", "report").env!, "LIMIT_NEXT"),
  ],
  [
    "SC5: next's test steps' limit is raised, and the report's is not",
    (w) => {
      step(w, "tests", "vitest")["timeout-minutes"] = 19;
      step(w, "tests", "end to end")["timeout-minutes"] = 19;
      w.jobs["tests"]!["timeout-minutes"] = `\${{ startsWith(matrix.shard, 'tooling-') && 33 || 22 }}`;
    },
  ],
  // SC13: the limit on the test steps, the job's own a backstop past it.
  [
    "SC13: next's vitest step has no limit",
    (w) => Reflect.deleteProperty(step(w, "tests", "vitest"), "timeout-minutes"),
  ],
  ["SC13: next's two test steps differ", (w) => (step(w, "tests", "end to end")["timeout-minutes"] = 16)],
  [
    "SC13: tooling's tests step has no limit",
    (w) => Reflect.deleteProperty(step(w, "tests", "tooling tests"), "timeout-minutes"),
  ],
  [
    "SC13: the job's limit equals a next step's, so a hung next test ends the run cancelled",
    (w) => (w.jobs["tests"]!["timeout-minutes"] = `\${{ startsWith(matrix.shard, 'tooling-') && 33 || 17 }}`),
  ],
  [
    "SC13: tooling's backstop is not 3 minutes",
    (w) => (w.jobs["tests"]!["timeout-minutes"] = `\${{ startsWith(matrix.shard, 'tooling-') && 40 || 20 }}`),
  ],
  ["SC13: one backstop for both suites", (w) => (w.jobs["tests"]!["timeout-minutes"] = 33)],
  [
    "SC13: the backstop asks the other suite first",
    (w) => (w.jobs["tests"]!["timeout-minutes"] = `\${{ !startsWith(matrix.shard, 'tooling-') && 20 || 33 }}`),
  ],
  [
    "SC13: a test step's limit is not a whole number",
    (w) => {
      step(w, "tests", "tooling tests")["timeout-minutes"] = "30";
      step(w, "report", "report").env!["LIMIT_TOOLING"] = "30";
    },
  ],
  [
    "SC5: the report's tooling limit is its own number",
    (w) => (step(w, "report", "report").env!["LIMIT_TOOLING"] = 25),
  ],
  [
    "SC5: the test job names its legs, so a leg's name loses its shard",
    (w) => (w.jobs["tests"]!["name"] = "full suite"),
  ],
  // SC6: one matrix for every test leg, at most half the runners.
  ["SC6: one more leg at once than the cap holds", (w) => (w.jobs["tests"]!.strategy!["max-parallel"] = 10)],
  [
    "SC6: the tests no longer wait on the gate, so they run beside it: 11 machines",
    (w) => {
      Reflect.deleteProperty(w.jobs["tests"]!, "needs");
      w.jobs["tests"]!.strategy!["max-parallel"] = 10;
    },
  ],
  ["SC6: the test job has no max-parallel", (w) => Reflect.deleteProperty(w.jobs["tests"]!.strategy!, "max-parallel")],
  // GitHub's own fail fast stops a job's other legs and leaves the run's conclusion `failure`.
  ["SC6: a red leg holds the others' runners", (w) => (w.jobs["tests"]!.strategy!["fail-fast"] = false)],
  // GitHub's fail fast reaches only the red leg's own matrix, so a second matrix runs on after a red
  // leg in the first: a red tooling leg would leave next's legs running, and the other way round.
  ["SC6: the tooling legs in a job of their own", (w) => split(w, (shard) => shard.startsWith("tooling-"))],
  ["SC6: the next legs in a job of their own", (w) => split(w, (shard) => !shard.startsWith("tooling-"))],
  [
    "SC6: a new job, in the cap",
    (w) => {
      w.jobs["tests"]!.strategy!["max-parallel"] = 8;
      w.jobs["extra"] = { "runs-on": "ubuntu-latest", "timeout-minutes": 5, steps: [{ run: "true" }] };
      (w.jobs["report"]!.needs as string[]).push("extra");
    },
  ],
  // SC7 to SC9: the whole suite, nothing narrowed.
  [
    "SC7: next drops a leg",
    (w) => (w.jobs["tests"]!.strategy!.matrix.shard = ["e2e-1", "e2e-2", "1", "2", "3", "4", "tooling-1", "tooling-2"]),
  ],
  [
    "SC7: the legs come from an expression",
    (w) => (w.jobs["tests"]!.strategy!.matrix.shard = `\${{ fromJSON('["1"]') }}`),
  ],
  [
    "SC7: vitest runs on the tooling legs too",
    (w) => (step(w, "tests", "vitest")["if"] = `\${{ !startsWith(matrix.shard, 'e2e-') }}`),
  ],
  // SC8: the tooling legs, after next's.
  [
    "SC8: a tooling leg comes before the next legs",
    (w) =>
      (w.jobs["tests"]!.strategy!.matrix.shard = ["tooling-1", "e2e-1", "e2e-2", "1", "2", "3", "4", "5", "tooling-2"]),
  ],
  [
    "SC8: the tooling legs are numbered like next's",
    (w) => (w.jobs["tests"]!.strategy!.matrix.shard = ["e2e-1", "e2e-2", "1", "2", "3", "4", "5", "6", "7"]),
  ],
  [
    "SC8: no tooling legs",
    (w) => (w.jobs["tests"]!.strategy!.matrix.shard = ["e2e-1", "e2e-2", "1", "2", "3", "4", "5"]),
  ],
  ["SC8: the tooling tests run on every leg", (w) => Reflect.deleteProperty(step(w, "tests", "tooling tests"), "if")],
  [
    "SC8: the tooling tests take the leg's whole name as their shard",
    (w) =>
      (step(w, "tests", "tooling tests")["run"] = String(step(w, "tests", "tooling tests")["run"]).replace(
        `"\${SHARD#tooling-}"`,
        '"$SHARD"',
      )),
  ],
  [
    "SC7: next's vitest legs each take a fourth",
    (w) => (step(w, "tests", "vitest").env!["SHARD"] = `\${{ matrix.shard }}/4`),
  ],
  [
    "SC7: next's end-to-end legs each take a third",
    (w) => (step(w, "tests", "end to end").env!["SHARD"] = `\${{ matrix.shard }}/3`),
  ],
  [
    "SC7: next narrows to what changed",
    (w) => {
      const s = step(w, "tests", "vitest");
      s["run"] = String(s["run"]).replace("--shard", '--changed "$BASE" --shard');
    },
  ],
  [
    "SC7: next runs a list",
    (w) => {
      const s = step(w, "tests", "vitest");
      s["run"] = String(s["run"]).replace("--shard", "$FILTER --shard");
    },
  ],
  [
    "SC7: the end-to-end legs narrow",
    (w) => {
      const s = step(w, "tests", "end to end");
      s["run"] = String(s["run"]).replace("--project next-visual ", "--project next-visual --changed=main ");
    },
  ],
  // 0536: a project, not a path, picks each leg's files. Each plant was run once on the real
  // scheduled.yaml too, and restored.
  [
    "SC7: next runs next/ as a path, so next-visual starts on legs with no Chromium",
    (w) => {
      const s = step(w, "tests", "vitest");
      s["run"] = String(s["run"]).replace("--project next --project next-integration ", "next/ ");
    },
  ],
  [
    "SC7: next drops next-integration, so the real-resource tests run nowhere",
    (w) => {
      const s = step(w, "tests", "vitest");
      s["run"] = String(s["run"]).replace(" --project next-integration", "");
    },
  ],
  [
    "SC7: the end-to-end legs lose their project, so they run every next/ test",
    (w) => {
      const s = step(w, "tests", "end to end");
      s["run"] = String(s["run"]).replace("--project next-visual ", "");
    },
  ],
  [
    "SC7: the end-to-end legs run the old runner, which 0536 removed",
    (w) => {
      const s = step(w, "tests", "end to end");
      s["run"] = String(s["run"]).replace(
        "pnpm exec vitest run --project next-visual ",
        "node next/apps/fabrika/e2e.ts ",
      );
    },
  ],
  [
    "SC7: chromium waits on the old end-to-end folder",
    (w) => {
      const s = step(w, "tests", "chromium");
      s["if"] = "startsWith(matrix.shard, 'e2e-') && hashFiles('next/apps/fabrika/e2e/*.test.ts') != ''";
    },
  ],
  ["SC7: vitest runs on the e2e legs too", (w) => Reflect.deleteProperty(step(w, "tests", "vitest"), "if")],
  [
    "SC7: no chromium",
    (w) => w.jobs["tests"]!.steps.splice(w.jobs["tests"]!.steps.indexOf(step(w, "tests", "chromium")), 1),
  ],
  [
    "SC8: tooling narrows to what changed",
    (w) => {
      const s = step(w, "tests", "tooling tests");
      s["run"] = String(s["run"]).replace("--shard", '--changed "$BASE" --shard');
    },
  ],
  [
    "SC8: tooling runs today's tests too",
    (w) => {
      const s = step(w, "tests", "tooling tests");
      s["run"] = String(s["run"]).replace("--project tooling", "--project tooling --project today");
    },
  ],
  [
    "SC8: tooling loses its project, so it runs every project",
    (w) => {
      const s = step(w, "tests", "tooling tests");
      s["run"] = String(s["run"]).replace("--project tooling ", "");
    },
  ],
  [
    "SC8: tooling leaves the trees out with --exclude, which a project ignores",
    (w) => {
      const s = step(w, "tests", "tooling tests");
      s["run"] = String(s["run"]).replace(
        "--project tooling ",
        "--exclude 'next/**' --exclude 'apps/**' --exclude 'packages/**' --exclude 'programs/**' ",
      );
    },
  ],
  [
    "SC8: tooling's two legs each take a third",
    (w) => (step(w, "tests", "tooling tests").env!["SHARD"] = `\${{ matrix.shard }}/3`),
  ],
  [
    "SC9: next runs one more command",
    (w) => w.jobs["tests"]!.steps.splice(3, 0, { run: "pnpm exec vitest run next/apps" }),
  ],
  ["SC9: tooling runs one more command", (w) => w.jobs["tests"]!.steps.splice(3, 0, { run: "pnpm test" })],
  // SC11: every test leg at full depth (pull request 1274). Each plant was run once on workflow-lint.ts
  // with SC11 dropped, and that turned this law red.
  [
    "SC11: next's vitest legs run at the merge line's depth",
    (w) => Reflect.deleteProperty(step(w, "tests", "vitest").env!, "FABRIKA_TEST_DEPTH"),
  ],
  ["SC11: the end-to-end legs run fast", (w) => (step(w, "tests", "end to end").env!["FABRIKA_TEST_DEPTH"] = "fast")],
  [
    "SC11: tooling runs at the merge line's depth",
    (w) => Reflect.deleteProperty(step(w, "tests", "tooling tests").env!, "FABRIKA_TEST_DEPTH"),
  ],
  // SC10: the reports the issue names its tests from.
  ["SC10: next's report is dropped after a red step", (w) => (step(w, "tests", "results")["if"] = "success()")],
  [
    "SC10: tooling uploads no report",
    (w) => w.jobs["tests"]!.steps.splice(w.jobs["tests"]!.steps.indexOf(step(w, "tests", "results")), 1),
  ],
  [
    "SC10: the upload comes before the tests",
    (w) => {
      const list = w.jobs["tests"]!.steps;
      const upload = step(w, "tests", "results");
      list.splice(list.indexOf(upload), 1);
      list.splice(2, 0, upload);
    },
  ],
  // TT1 and TT2, as in check.yaml: each leg's time table and its timings file. A leg's steps are
  // copied before a plant, so a plant on one leg leaves the other's alias as it was.
  ...(["tests", "changed"] as const).flatMap((job): [string, (w: Workflow) => void][] => {
    const own = (w: Workflow, name: string) => {
      const list = w.jobs[job]!.steps;
      const at = list.indexOf(step(w, job, name));
      list[at] = structuredClone(list[at]!);

      return list[at]!;
    };

    return [
      [
        `TT1: ${job} drops its time table`,
        (w) => void w.jobs[job]!.steps.splice(w.jobs[job]!.steps.indexOf(step(w, job, "time table")), 1),
      ],
      [`TT1: ${job}'s time table skips a red leg`, (w) => (own(w, "time table")["if"] = "success()")],
      [
        `TT1: ${job}'s time table reads another report`,
        (w) => (own(w, "time table").env!["REPORT"] = `\${{ runner.temp }}/next.json`),
      ],
      [
        `TT1: ${job}'s time table can fail the job`,
        (w) => Reflect.deleteProperty(own(w, "time table"), "continue-on-error"),
      ],
      [
        `TT2: ${job} drops its timings upload`,
        (w) => void w.jobs[job]!.steps.splice(w.jobs[job]!.steps.indexOf(step(w, job, "timings")), 1),
      ],
      [
        `TT2: ${job}'s timings lose the attempt`,
        (w) => (own(w, "timings").with!["name"] = `timings-\${{ github.job }}-\${{ matrix.shard }}`),
      ],
      [`TT2: ${job}'s timings skip a red leg`, (w) => (own(w, "timings")["if"] = "success()")],
    ];
  }),
  // SC5: the time table's exact step is the one test step that gets the token.
  [
    "SC5: the results upload gets the token",
    (w) => (step(w, "tests", "results").env = { GITHUB_TOKEN: `\${{ github.token }}` }),
  ], // SC15 and SC17, 0590: main's push, catch-up and hand start run every test. Plants, each run once
  // on scheduled.ts and restored: SC15's `if` check dropped (red on SC15's first three here, and on
  // its three older ones above); SC17's `if` check dropped (red on SC17's first three).
  [
    "SC15: the tests skip when select is skipped, so a push to main runs no test",
    (w) =>
      (w.jobs["tests"]!["if"] =
        `\${{ !cancelled() && needs.gate.outputs.start == 'true' && needs.select.outputs.scope == 'full' }}`),
  ],
  [
    "SC15: the tests run beside a changed set too",
    (w) => (w.jobs["tests"]!["if"] = `\${{ !cancelled() && needs.gate.outputs.start == 'true' }}`),
  ],
  [
    "SC15: the tests run after a select that failed",
    (w) =>
      (w.jobs["tests"]!["if"] =
        `\${{ !cancelled() && needs.gate.outputs.start == 'true' && needs.select.outputs.scope != 'changed' }}`),
  ],
  ["SC15: the tests wait on the gate alone", (w) => (w.jobs["tests"]!.needs = ["gate"])],
  [
    "SC17: select runs on a push to main, so main's full run narrows",
    (w) => (w.jobs["select"]!["if"] = "needs.gate.outputs.start == 'true' && github.ref != 'refs/heads/main'"),
  ],
  [
    "SC17: select runs on a hand start on main",
    (w) => (w.jobs["select"]!["if"] = "needs.gate.outputs.start == 'true' && github.event_name == 'workflow_dispatch'"),
  ],
  [
    "SC17: select runs whatever the gate said",
    (w) => (w.jobs["select"]!["if"] = "github.event_name == 'workflow_dispatch' && github.ref != 'refs/heads/main'"),
  ],
  ["SC17: select waits on nothing", (w) => Reflect.deleteProperty(w.jobs["select"]!, "needs")],
  ["SC17: select runs another script", (w) => (step(w, "select", "set")["run"] = "node .github/ci/legs.ts")],
  ["SC17: select's step can skip", (w) => (step(w, "select", "set")["if"] = "github.ref != 'refs/heads/x'")],
  [
    "SC17: select's step gets the token",
    (w) => (step(w, "select", "set").env!["GITHUB_TOKEN"] = `\${{ github.token }}`),
  ],
  [
    "SC17: select gives a fourth output",
    (w) => (w.jobs["select"]!["outputs"] = { ...(w.jobs["select"]!["outputs"] as object), base: "x" }),
  ],
  [
    "SC17: select checks out one commit, so it cannot diff with origin/main",
    (w) =>
      Reflect.deleteProperty(w.jobs["select"]!.steps.find((s) => typeof s["uses"] === "string")!.with!, "fetch-depth"),
  ],
  [
    "SC17: select keeps no record",
    (w) => void w.jobs["select"]!.steps.splice(w.jobs["select"]!.steps.indexOf(step(w, "select", "record")), 1),
  ],
  ["SC17: a red select loses its record", (w) => (step(w, "select", "record")["if"] = "success()")],
  ["SC17: the record takes another name", (w) => (step(w, "select", "record").with!["name"] = "results-set")],
  // SC18, 0590: a changed set's legs. Plants, each run once on scheduled.ts and restored: SC18's
  // `if` check dropped (red on the first two); its command checks dropped (red on the next three);
  // its limit checks dropped (red on the three limits).
  ["SC18: the changed legs run on main too", (w) => (w.jobs["changed"]!["if"] = "needs.gate.outputs.start == 'true'")],
  [
    "SC18: the changed legs start on a set of zero files",
    (w) => (w.jobs["changed"]!["if"] = "needs.gate.outputs.start == 'true' && needs.select.outputs.scope == 'changed'"),
  ],
  [
    "SC18: a changed leg leaves out the real-resource laws",
    (w) =>
      (step(w, "changed", "vitest")["run"] = String(step(w, "changed", "vitest")["run"]).replace(
        "--project next-integration ",
        "",
      )),
  ],
  [
    "SC18: a changed leg leaves out the visual laws",
    (w) =>
      (step(w, "changed", "vitest")["run"] = String(step(w, "changed", "vitest")["run"]).replace(
        "--project next-visual ",
        "",
      )),
  ],
  [
    "SC18: a changed leg narrows again from origin/main",
    (w) =>
      (step(w, "changed", "vitest")["run"] = String(step(w, "changed", "vitest")["run"]).replace(
        "$FILES",
        "--changed origin/main",
      )),
  ],
  [
    "SC18: a changed leg is not told its list",
    (w) => Reflect.deleteProperty(step(w, "changed", "vitest").env!, "FILES"),
  ],
  [
    "SC18: a changed leg runs at fast depth",
    (w) => Reflect.deleteProperty(step(w, "changed", "vitest").env!, "FABRIKA_TEST_DEPTH"),
  ],
  ["SC18: a changed leg's own step limit", (w) => (step(w, "changed", "vitest")["timeout-minutes"] = 30)],
  ["SC18: the changed legs' job limit is no backstop", (w) => (w.jobs["changed"]!["timeout-minutes"] = 17)],
  ["SC18: select sizes the legs for another limit", (w) => (step(w, "select", "set").env!["LIMIT"] = 30)],
  ["SC18: chromium on every changed leg", (w) => Reflect.deleteProperty(step(w, "changed", "chromium"), "if")],
  ["SC18: the changed legs are a fixed list", (w) => (w.jobs["changed"]!.strategy!.matrix.shard = ["1"])],
  ["SC18: the changed legs wait on the gate alone", (w) => (w.jobs["changed"]!.needs = ["gate"])],
  // SC6 and SC10 on the changed legs: one fail-fast, MOST at once, and the report kept.
  [
    "SC6: the changed legs hold their runners after a red leg",
    (w) => (w.jobs["changed"]!.strategy!["fail-fast"] = false),
  ],
  [
    "SC6: the changed matrix runs another count at once than proof.ts makes",
    (w) => (w.jobs["changed"]!.strategy!["max-parallel"] = (Number(step(w, "select", "set").env!["MOST"]) % 9) + 1),
  ],
  [
    "SC10: a changed leg keeps no report",
    (w) => void w.jobs["changed"]!.steps.splice(w.jobs["changed"]!.steps.indexOf(step(w, "changed", "results")), 1),
  ],
];

// SC4, 2026-11-15: a red run on a branch that had canceled itself ended `cancelled`, was read as cut
// off, and its pull request merged with two red laws. The old step also takes the token, which SC5
// names too, so this looks for SC4's own error on the job that gained it.
// Plant, run once on scheduled.ts and restored: SC4's cancel check dropped (red on each job).
it.each(["tests", "report"])("SC4: %s with the old stop step back is named by SC4's error for that job", (job) => {
  fc.assert(
    fc.property(scheduled, (broken) => {
      broken.jobs[job]!.steps.push(structuredClone(stop));
      expect(lint(broken)).toContain(
        `scheduled.yaml: SC4: no step of ${job} cancels the run: a canceled run ends cancelled, never failure`,
      );
    }),
    { ...options, numRuns: 20 },
  );
});

it("SC3, SC5 and SC6 scenario: on the real scheduled.yaml, what ends a red run as failure is each held by its one error", () => {
  // Plants, each run once on scheduled.ts and restored: SC3's map check dropped; SC5's `if` check
  // dropped; SC6's fail-fast check dropped.
  const writes = real();
  writes.permissions = { actions: "write", contents: "read" };
  expect(lint(writes)).toEqual([
    "scheduled.yaml: SC3: the workflow's token grants actions: read and contents: read, nothing more",
  ]);

  const mainOnly = real();
  mainOnly.jobs["report"]!["if"] = `\${{ always() && github.ref == 'refs/heads/main' }}`;
  expect(lint(mainOnly)).toEqual([
    "scheduled.yaml: SC5: the report needs every other job, and runs after any result, on every branch, unless the gate said false",
  ]);

  const slow = real();
  slow.jobs["tests"]!.strategy!["fail-fast"] = false;
  expect(lint(slow)).toEqual([
    "scheduled.yaml: SC6: tests sets max-parallel to at most its legs, and its first red leg stops the others",
  ]);
});

it("SC6 scenario: on the real scheduled.yaml, the tooling legs or the next legs in a job of their own is named by SC6, so a red leg of either suite stops the other's legs", () => {
  // The review of pull request 1383: GitHub's fail fast stops only the red leg's own matrix (probe
  // run 43778347612), so with two matrices a red tooling leg left next's 7 legs running, up to about
  // 59 runner minutes, and a red next leg left the 2 tooling legs, up to about 14. Plant, run once
  // on scheduled.ts and restored: SC6's one-matrix check dropped (red on both splits).
  const ONE =
    "scheduled.yaml: SC6: every test leg a run starts is in one matrix, the tests job or the changed job, so its first red leg stops all the others";

  const toolingApart = real();
  split(toolingApart, (shard) => shard.startsWith("tooling-"));
  expect(lint(toolingApart)).toContain(ONE);

  const nextApart = real();
  split(nextApart, (shard) => !shard.startsWith("tooling-"));
  expect(lint(nextApart)).toContain(ONE);

  // One more job beside the test job, even with no matrix, is not the one-matrix shape either.
  const beside = real();
  beside.jobs["tests"]!.strategy!["max-parallel"] = 8;
  beside.jobs["extra"] = { "runs-on": "ubuntu-latest", "timeout-minutes": 5, steps: [{ run: "true" }] };
  (beside.jobs["report"]!.needs as string[]).push("extra");
  expect(lint(beside)).toEqual([
    ONE,
    "scheduled.yaml: SC19: every admitted job is one of the five jobs with shared slots",
  ]);
});

it("SC13 scenario: on the real scheduled.yaml, a test step with no limit of its own, or a job limit that is no backstop, is named by SC13", () => {
  // A job that runs into its own limit ends `cancelled`, and its run with it, even when the report
  // fails after it (probe run 43778355238); a test step that runs into its own ends `failure` (probe
  // run 43778586135). Plant, run once on scheduled.ts and restored: SC13 dropped (red on each case).
  const STEPS = (suite: string) => `scheduled.yaml: SC13: ${suite}'s test steps share one whole timeout-minutes`;
  const JOB = "scheduled.yaml: SC13: tests's own timeout-minutes is each leg's suite limit and 3 minutes more";

  const LIMIT_TEXT =
    "scheduled.yaml: SC5: the report runs node .github/ci/scheduled.mjs once, with the needs, the results, the token and each suite's time limit, and its failure shows";

  // The changed legs run at next's limit (SC18), so a next limit that is no longer one names them too.
  const CHANGED = `scheduled.yaml: ${CHANGED_RULE}`;

  const backstop = (tooling: number, next: number) =>
    `\${{ startsWith(matrix.shard, 'tooling-') && ${tooling} || ${next} }}`;

  // The shape before 2026-11-15: the limit on the job alone, which a hung leg ran into.
  const onJob = real();
  Reflect.deleteProperty(step(onJob, "tests", "vitest"), "timeout-minutes");
  Reflect.deleteProperty(step(onJob, "tests", "end to end"), "timeout-minutes");
  onJob.jobs["tests"]!["timeout-minutes"] = 17;
  expect(lint(onJob)).toEqual([LIMIT_TEXT, CHANGED, STEPS("next"), JOB]);

  for (const [tooling, next] of [
    [30, 20],
    [32, 20],
    [34, 20],
    [33, 17],
    [33, 19],
    [33, 21],
  ] as const) {
    const near = real();
    near.jobs["tests"]!["timeout-minutes"] = backstop(tooling, next);
    expect(lint(near)).toEqual([JOB]);
  }

  // The backstop keeps its meaning however it is spaced.
  const spaced = real();
  spaced.jobs["tests"]!["timeout-minutes"] = `\${{startsWith(matrix.shard, 'tooling-')&&33||20}}`;
  expect(lint(spaced)).toEqual([]);

  const apart = real();
  step(apart, "tests", "end to end")["timeout-minutes"] = 16;
  expect(lint(apart)).toEqual([LIMIT_TEXT, CHANGED, STEPS("next"), JOB]);
});

// Each plant is named by its own law: a plant's name starts with the law it breaks, and that law's
// error is among the errors, so a plant another law happens to catch still proves its own law.
it.each(plants)("rejects the schedule's plant: %s", (plant, mutate) => {
  const law = plant.split(":")[0]!;
  fc.assert(
    fc.property(scheduled, (clean) => {
      const broken = structuredClone(clean);
      mutate(broken);
      const errors = lint(broken);
      expect(errors, plant).not.toEqual([]);
      expect(
        errors.some((error) => error.startsWith(`scheduled.yaml: ${law}:`)),
        `${plant}: ${JSON.stringify(errors)}`,
      ).toBe(true);
    }),
    { ...options, numRuns: 20 },
  );
});

it("SC1 and SC16 property: a cron at any minute from 1 to 59 every hour, and any whole gap of an hour or more, pass; minute 0 and a gap under an hour do not", () => {
  // Plants, each run once on scheduled.ts and restored: SC1's hourly check dropped (red: the 3-hour
  // and minute-0 crons pass); SC16's floor dropped (red: a 59-minute gap passes).
  const reached = { minuteZero: 0, notHourly: 0, short: 0, clean: 0 };
  fc.assert(
    fc.property(
      scheduled,
      fc.oneof(fc.constant(0), fc.integer({ min: 1, max: 59 })),
      fc.constantFrom("*", "*/3", "*/2", "9-17"),
      fc.oneof(fc.integer({ min: 1, max: 59 }), fc.integer({ min: 60, max: 1440 })),
      (clean, minute, hours, gap) => {
        const w = structuredClone(clean);
        w.on["schedule"] = [{ cron: `${minute} ${hours} * * *` }];
        w.env = { GAP_MINUTES: gap };
        const errors = lint(w);
        const hourly = minute >= 1 && hours === "*";
        reached.minuteZero += minute === 0 ? 1 : 0;
        reached.notHourly += hours === "*" ? 0 : 1;
        reached.short += gap < 60 ? 1 : 0;
        reached.clean += hourly && gap >= 60 ? 1 : 0;
        expect(errors.some((e) => e.startsWith("scheduled.yaml: SC1:"))).toBe(!hourly);
        expect(errors.some((e) => e.startsWith("scheduled.yaml: SC16:"))).toBe(gap < 60);
        expect(errors.length === 0).toBe(hourly && gap >= 60);
      },
    ),
    options,
  );
  expect(
    Object.values(reached).every((count) => count > 0),
    JSON.stringify(reached),
  ).toBe(true);
});

it("property: the schedule's legs follow check.yaml's full matrix, so a new leg there fails here until both agree", () => {
  fc.assert(
    fc.property(fc.integer({ min: 1, max: 4 }), (e2es) => {
      const legs = [...Array.from({ length: e2es }, (_, i) => `e2e-${i + 1}`), "1", "2", "3", "4", "5"];
      const otherCheck = check.replace(`'["e2e-1","e2e-2","1","2","3","4","5"]'`, `'${JSON.stringify(legs)}'`);
      expect(otherCheck.includes(JSON.stringify(legs)), "the plant found check.yaml's fallback").toBe(true);
      const errors = lintScheduled(read("scheduled.yaml"), otherCheck);
      expect(errors.length === 0).toBe(e2es === 2);
    }),
    options,
  );
});
