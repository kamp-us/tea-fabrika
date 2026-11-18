import { readFileSync } from "node:fs";
import { it as effectIt } from "@effect/vitest";
import { runsFor } from "@kampus/vitest";
import { Array as Arr, Predicate, Record as Rec, Schema, String as Str } from "effect";
import * as fc from "fast-check";
import { afterAll, expect, it } from "vitest";
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

/** The hand start's inputs (ticket 1161): each one's type, whether it is required, its default and the rest. */
type Inputs = Record<string, Record<string, unknown>>;

type Workflow = Record<string, unknown> & {
  on: Record<string, unknown> & { workflow_dispatch: { inputs: Inputs } };
  env?: Record<string, unknown>;
  concurrency: Record<string, unknown>;
  permissions: unknown;
  jobs: Record<string, Job>;
};

const real = (): Workflow => parse(read("scheduled.yaml"));

/** The hand start's two inputs, `scope` and `law`, as a plant reaches them. */
const hand = (w: Workflow): Inputs => w.on.workflow_dispatch.inputs;

/**
 * Moves the legs whose shard `leaves` picks out of the test job into a job of their own, `split`,
 * with the same steps, as two matrices were before 2026-11-15, and has the report wait on it too.
 */
const split = (w: Workflow, leaves: (shard: string) => boolean) => {
  const tests = w.jobs["tests"]!;
  // SAFETY: the real scheduled workflow's test job is a matrix over a list of shard names.
  const all = tests.strategy!.matrix.shard as string[];
  const apart = structuredClone(tests);
  apart.strategy!.matrix.shard = all.filter(leaves);
  apart.strategy!["max-parallel"] = 1;
  tests.strategy!.matrix.shard = all.filter((shard) => !leaves(shard));
  tests.strategy!["max-parallel"] = 1;
  w.jobs["split"] = apart;
  // SAFETY: `real()` reads the report job's `needs` from the workflow, where it is a list of job names.
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
  Predicate.isString(value) ? value.replace(/ *(==|!=|&&|\|\|) */g, `${gap}$1${gap}`) : value;

// 0598's split of the nine test groups: MAIN_SLOTS for main's full run (1 to 8), PROOF_SLOTS for a
// branch's proof, the rest. A `tests` group takes the prefix and the pin map by the ref, so the
// workflow holds two maps, each leg's number in its group; a first leg of each map takes group 1 to N
// in order, and every other leg any group (SC19, SC20).
const REF = "github.ref == 'refs/heads/main'";

/** The names 1 to `count`, as text. */
const upTo = (count: number) => Array.from({ length: count }, (_, index) => String(index + 1));

const counts = (w: Workflow) => ({ main: Number(w.env!["MAIN_SLOTS"]), proof: Number(w.env!["PROOF_SLOTS"]) });

/** Each leg's pin: the first `count` legs take groups 1 to `count` in order, the others `tail`'s group. */
const pinned = (shards: readonly string[], count: number, tail: readonly number[]) =>
  Rec.fromEntries(Arr.map(shards, (shard, i) => [shard, i < count ? String(i + 1) : String((tail[i]! % count) + 1)]));

/** The `tests` group as the real file writes it, from a main map and a proof map. */
const groupOf = (main: unknown, proof: unknown, gap = " ", upper = false) =>
  `\${{${gap}${REF} && '${upper ? "SCHEDULED-MAIN-" : "scheduled-main-"}' || '${upper ? "SCHEDULED-PROOF-" : "scheduled-proof-"}'${gap}}}\${{${gap}fromJSON(${REF} && '${JSON.stringify(main)}' || '${JSON.stringify(proof)}')[matrix.shard]${gap}}}`;

/** The two pin maps of a `tests` group written by `groupOf`, in the text's order: main, then proof. */
const pinsIn = (w: Workflow): [Record<string, unknown>, Record<string, unknown>] => {
  const found = [...String(w.jobs["tests"]!.concurrency!["group"]).matchAll(/'(\{[^']*\})'/g)];

  return [JSON.parse(found[0]![1]!), JSON.parse(found[1]![1]!)];
};

/** The `changed` group's closed identity lookup over the proof groups. */
const rotationSlots = (count: number): Record<string, string> =>
  Rec.fromEntries(Arr.map(upTo(count), (slot) => [slot, slot]));

const rotationGroup = (slots: unknown, gap = " ", upper = false) =>
  `${upper ? "SCHEDULED-PROOF-" : "scheduled-proof-"}\${{${gap}fromJSON('${JSON.stringify(slots)}')[fromJSON(needs.select.outputs.slots)[matrix.shard]]${gap}||${gap}'1'${gap}}}`;

/** One draw of what may change: the minute, the gap, the split, the spacing, the tails, the two flags, the two texts. */
type Variation = readonly [
  number,
  number,
  number,
  string,
  readonly number[],
  readonly number[],
  boolean,
  boolean,
  string,
  string,
];

// The same draw as a Schema, for the laws that run as `it.prop` (0579).
const Varied = Schema.Tuple([
  Schema.Int.check(Schema.isBetween({ minimum: 1, maximum: 59 })),
  Schema.Int.check(Schema.isBetween({ minimum: 60, maximum: 1440 })),
  Schema.Int.check(Schema.isBetween({ minimum: 1, maximum: 8 })),
  Schema.Literals(["", " ", "  "]),
  Schema.Array(Schema.Int.check(Schema.isBetween({ minimum: 0, maximum: 1000 }))).check(
    Schema.isMinLength(9),
    Schema.isMaxLength(9),
  ),
  Schema.Array(Schema.Int.check(Schema.isBetween({ minimum: 0, maximum: 1000 }))).check(
    Schema.isMinLength(9),
    Schema.isMaxLength(9),
  ),
  Schema.Boolean,
  Schema.Boolean,
  // S11: the two inputs' descriptions, any text, since what they say changes nothing.
  Schema.String.check(Schema.isMinLength(1)),
  Schema.String.check(Schema.isMinLength(1)),
]);

const vary = ([minute, minutes, main, gap, mainTail, proofTail, numeric, upper, scopeText, lawText]: Variation) => {
  const proof = 9 - main;
  const w = real();
  // SAFETY: the branch is taken only when `schedule` is a list, and each GitHub schedule entry is a map.
  const crons = Array.isArray(w.on["schedule"]) ? (w.on["schedule"] as { cron?: unknown }[]) : [];

  for (const cron of crons) {
    if (Predicate.isString(cron.cron)) {
      cron.cron = cron.cron.replace(/^\d+ /, `${minute} `);
    }
  }

  w.env = { GAP_MINUTES: minutes, MAIN_SLOTS: main, PROOF_SLOTS: proof };

  w.concurrency["group"] = `${upper ? "SCHEDULED" : "scheduled"}-\${{${gap}github.ref${gap}}}`;
  // The count of groups is a setting, and `max-parallel` of the test job and MOST are its copies (0598).
  w.jobs["tests"]!.strategy!["max-parallel"] = spaced(`\${{ ${REF} && ${main} || ${proof} }}`, gap);
  w.jobs["changed"]!.strategy!["max-parallel"] = proof;
  step(w, "select", "set").env!["MOST"] = proof;
  // S11: the set step reads the two inputs with the spacing of the rest of the file.
  step(w, "select", "set").env!["SCOPE"] = `\${{${gap}inputs.scope${gap}}}`;
  step(w, "select", "set").env!["LAW"] = `\${{${gap}inputs.law${gap}}}`;
  hand(w)["scope"]!["description"] = scopeText;
  hand(w)["law"]!["description"] = lawText;

  const shards = w.jobs["tests"]!.strategy!.matrix.shard as string[];

  const asValue = (pins: Record<string, string>): Record<string, string | number> =>
    numeric ? Rec.fromEntries(Arr.map(Rec.toEntries(pins), ([leg, group]) => [leg, Number(group)])) : pins;

  const pins = (count: number, tail: readonly number[]) => {
    const all = asValue(pinned(shards, count, tail));

    return upper ? Rec.fromEntries(Arr.reverse(Rec.toEntries(all))) : all;
  };

  w.jobs["tests"]!.concurrency!["group"] = spaced(
    groupOf(pins(main, mainTail), pins(proof, proofTail), gap, upper),
    gap,
  );

  w.jobs["changed"]!.concurrency!["group"] = rotationGroup(rotationSlots(proof), gap, upper);

  for (const job of Rec.values(w.jobs)) {
    if (upper && typeof job.concurrency?.["group"] === "string") {
      job.concurrency["group"] = Str.replace(/^scheduled-/, "SCHEDULED-")(job.concurrency["group"]);
    }
  }

  for (const job of Rec.values(w.jobs)) {
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
};

const scheduled = fc
  .tuple(
    fc.integer({ min: 1, max: 59 }),
    fc.integer({ min: 60, max: 1440 }),
    fc.integer({ min: 1, max: 8 }),
    fc.constantFrom("", " ", "  "),
    fc.array(fc.integer({ min: 0, max: 1000 }), { minLength: 9, maxLength: 9 }),
    fc.array(fc.integer({ min: 0, max: 1000 }), { minLength: 9, maxLength: 9 }),
    fc.boolean(),
    fc.boolean(),
    // S11: the two inputs' descriptions, any text, since what they say changes nothing.
    fc.string({ minLength: 1 }),
    fc.string({ minLength: 1 }),
  )
  .map(vary);

const lint = (w: Workflow) => lintScheduled(JSON.stringify(w), check);

const changedRotation = (w: Workflow, slots: unknown = rotationSlots(counts(w).proof)) => {
  step(w, "select", "set").env!["RUN_NUMBER"] = `\${{ github.run_number }}`;
  w.jobs["select"]!.outputs!["slots"] = `\${{ steps.set.outputs.slots }}`;
  w.jobs["changed"]!.concurrency!["group"] = rotationGroup(slots);

  return w;
};

// S1. Plant: keep the nine-slot `TEST_SLOTS` in SC19 (red: every split fails). A split is any
// MAIN_SLOTS from 1 to 8 with the rest PROOF_SLOTS, so the count of groups of each ref is a setting, not
// nine fixed slots, and the pins start every group at once.
it("property: SC19 accepts any split of nine test groups into MAIN_SLOTS and PROOF_SLOTS, with pins that start every group at once and the proof rotation through a closed lookup", () => {
  const splits = new Set<number>();
  fc.assert(
    fc.property(scheduled, (w) => {
      const { main, proof } = counts(w);
      splits.add(main);
      expect(main + proof).toBe(9);
      expect(lint(changedRotation(w))).toEqual([]);
      const [mains, proofs] = pinsIn(w);
      // Every group's first leg is among the first legs, in order: the matrix start is the pins' start.
      const shards = w.jobs["tests"]!.strategy!.matrix.shard as string[];
      expect(shards.slice(0, main).map((shard) => String(mains[shard]))).toEqual(upTo(main));
      expect(shards.slice(0, proof).map((shard) => String(proofs[shard]))).toEqual(upTo(proof));
    }),
    options,
  );
  expect([...splits].toSorted(), "every split from 1 to 8 reached").toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
});

/** The leg at place `index` of the test matrix, which is the order the legs start in. */
const legAt = (w: Workflow, index: number) => (w.jobs["tests"]!.strategy!.matrix.shard as string[])[index]!;

/** Rebuilds the full matrix's two closed pin maps from its legs, then applies one isolated mutation. */
const remap = (w: Workflow, change: (main: Record<string, string>, proof: Record<string, string>) => void) => {
  const shards = w.jobs["tests"]!.strategy!.matrix.shard;

  if (!Array.isArray(shards) || !shards.every((shard) => typeof shard === "string")) {
    throw new Error("the full matrix has no literal shard list");
  }

  const { main, proof } = counts(w);

  const mains = pinned(
    shards,
    main,
    shards.map(() => 0),
  );

  const proofs = pinned(
    shards,
    proof,
    shards.map(() => 0),
  );

  change(mains, proofs);
  w.jobs["tests"]!.concurrency!["group"] = groupOf(mains, proofs);
};

// SC18's message, which a scenario on the next limit expects beside SC13's.
const CHANGED_RULE =
  "SC18: changed runs only when select said changed with a leg, each leg its own list over proof.ts's projects, none of them next-integration (0602), at next's limit and backstop, select's LIMIT that limit, chromium first for a visual file, and nothing else";

it("pinned: the real scheduled.yaml passes, against the real check.yaml", () => {
  expect(lintScheduled(read("scheduled.yaml"), check)).toEqual([]);
});

// S5. Plant, run once on the real scheduled.yaml and restored: e2e-1 first in the matrix, in group 1
// before tooling-1 (red: the order differs).
it("vector: the real scheduled.yaml's start order, both pin maps and both counts are decision 0598's", () => {
  // From run 44155250216's leg times (tooling-1 11.7 min, 3 11.6, 2 10.7, 5 10.1, tooling-2 9.3, ...):
  // the five longest legs first, one to a group, then each leg behind the group that frees first. The
  // proof's four groups are the same order by longest processing time first (Graham, 1969).
  const w = real();
  expect(w.env).toEqual({ GAP_MINUTES: 60, MAIN_SLOTS: 5, PROOF_SLOTS: 4 });
  expect(w.jobs["tests"]!.strategy!.matrix.shard).toEqual([
    "tooling-1",
    "3",
    "2",
    "5",
    "tooling-2",
    "e2e-2",
    "1",
    "4",
    "e2e-1",
  ]);
  expect(pinsIn(w)).toEqual([
    {
      "tooling-1": "1",
      "3": "2",
      "2": "3",
      "5": "4",
      "tooling-2": "5",
      "e2e-2": "4",
      "1": "3",
      "4": "2",
      "e2e-1": "1",
    },
    {
      "tooling-1": "1",
      "3": "2",
      "2": "3",
      "5": "4",
      "tooling-2": "4",
      "e2e-2": "3",
      "1": "2",
      "4": "1",
      "e2e-1": "1",
    },
  ]);
  expect(w.jobs["tests"]!.strategy!["max-parallel"]).toBe(`\${{ ${REF} && 5 || 4 }}`);
  expect(w.jobs["changed"]!.strategy!["max-parallel"]).toBe(4);
  expect(step(w, "select", "set").env!["MOST"]).toBe(4);
});

// S4. Plant: drop the "first legs in order" check in SC20 (red: a swap of tooling-1 and e2e-2 passes).
// A first leg swapped with any other leg is refused exactly when a group is then left waiting while
// another has no first leg, which is the pins' first legs no longer in order in main's or the proof's.
it("property: SC20 refuses a swap of two legs exactly when some group's first leg is no longer first", () => {
  const reached = new Set<string>();
  fc.assert(
    fc.property(scheduled, fc.nat(8), fc.nat(8), (clean, a, b) => {
      const w = structuredClone(clean);
      const shards = w.jobs["tests"]!.strategy!.matrix.shard as string[];
      [shards[a], shards[b]] = [shards[b]!, shards[a]!];
      const [mains, proofs] = pinsIn(w);
      const { main, proof } = counts(w);

      const ordered =
        shards.slice(0, main).every((shard, index) => String(mains[shard]) === String(index + 1)) &&
        shards.slice(0, proof).every((shard, index) => String(proofs[shard]) === String(index + 1));

      reached.add(ordered ? "ordered" : "waiting");
      const errors = lint(w);
      expect(
        errors.some((error) => error.startsWith("scheduled.yaml: SC20:")),
        JSON.stringify(errors),
      ).toBe(!ordered);
      expect(errors.length === 0, JSON.stringify(errors)).toBe(ordered);
    }),
    options,
  );
  expect([...reached].toSorted(), "both a swap that keeps the order and one that breaks it").toEqual([
    "ordered",
    "waiting",
  ]);
});

it("property: a schedule varied only where its meaning holds passes", () => {
  const reached = new Set<string>();
  fc.assert(
    fc.property(scheduled, (w) => {
      const group = String(w.jobs["tests"]!.concurrency?.["group"]);
      reached.add(group.includes("SCHEDULED-MAIN-") ? "upper" : "lower");
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
  [
    "SC19: rotation reaches a proof group past PROOF_SLOTS",
    (w) => void changedRotation(w, { ...rotationSlots(counts(w).proof), "1": String(counts(w).proof + 1) }),
  ],
  [
    "SC19: rotation reuses a slot",
    // With one proof group this adds a key instead; either way the lookup is no longer the identity.
    (w) => void changedRotation(w, { ...rotationSlots(counts(w).proof), "2": "1" }),
  ],
  [
    "SC19: rotation hides the recorded physical slots",
    (w) => void changedRotation(w, { ...rotationSlots(counts(w).proof), "1": "2", "2": "1" }),
  ],
  [
    "SC19: rotation adds another key",
    (w) => void changedRotation(w, { ...rotationSlots(counts(w).proof), [String(counts(w).proof + 1)]: "1" }),
  ],
  [
    "SC19: rotation loses a key",
    (w) => {
      const slots = rotationSlots(counts(w).proof);
      Reflect.deleteProperty(slots, "1");
      changedRotation(w, slots);
    },
  ],
  ["SC19: rotation has a JSON list", (w) => void changedRotation(w, upTo(counts(w).proof))],
  ["SC19: rotation runs over nine groups, as 0595's did", (w) => void changedRotation(w, rotationSlots(9))],
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
  // SC16: the gap, a setting of an hour at least (0581's binding constraint), and the two counts of
  // groups (0598): the env is these three, nothing else.
  ["SC16: a gap of half an hour", (w) => (w.env = { ...w.env, GAP_MINUTES: 30 })],
  ["SC16: a gap a minute short of an hour", (w) => (w.env = { ...w.env, GAP_MINUTES: 59 })],
  ["SC16: a gap in words", (w) => (w.env = { ...w.env, GAP_MINUTES: "1h" })],
  ["SC16: a gap as text", (w) => (w.env = { ...w.env, GAP_MINUTES: "60" })],
  ["SC16: a count is text", (w) => (w.env = { ...w.env, PROOF_SLOTS: `${counts(w).proof}` })],
  ["SC16: a count of 0", (w) => (w.env = { ...w.env, MAIN_SLOTS: 0 })],
  ["SC16: a count is missing", (w) => Reflect.deleteProperty(w.env!, "PROOF_SLOTS")],
  ["SC16: a count is fractional", (w) => (w.env = { ...w.env, MAIN_SLOTS: counts(w).main + 0.5 })],
  [
    "SC16: the gap moved to the gate's step",
    (w) => {
      Reflect.deleteProperty(w.env!, "GAP_MINUTES");
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
    (w) => Reflect.deleteProperty(gate(w).steps.find((s) => Predicate.isString(s["uses"]))!.with!, "sparse-checkout"),
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
        gate(w).steps.find((s) => Predicate.isString(s["uses"]))!,
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
    (w) => (gate(w).steps.find((s) => Predicate.isString(s["uses"]))!["if"] = false),
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
  ["SC19: the full slot map loses a shard", (w) => remap(w, (main) => Reflect.deleteProperty(main, "e2e-1"))],
  ["SC19: the full slot map adds a shard", (w) => remap(w, (main) => (main["extra"] = "1"))],
  ["SC19: the proof pins lose a shard", (w) => remap(w, (_, proof) => Reflect.deleteProperty(proof, "e2e-1"))],
  [
    "SC19: two full shards share one slot",
    // With two or more main groups, the second leg joins the first's group and leaves group 2 empty;
    // with one, it goes to a group past it. Either way the pins are not 1 to MAIN_SLOTS in order.
    (w) => remap(w, (main) => (main["3"] = counts(w).main > 1 ? main["tooling-1"]! : "2")),
  ],
  [
    "SC19: the main pins reach a group past MAIN_SLOTS",
    (w) => remap(w, (main) => (main["e2e-1"] = String(counts(w).main + 1))),
  ],
  [
    "SC19: the main pins leave a main group unused",
    // The leg that starts main group MAIN_SLOTS goes to group 1, so that group has no leg; with one
    // main group, it goes to a group past it, so none stays unused.
    (w) => remap(w, (main) => (main[legAt(w, counts(w).main - 1)] = counts(w).main > 1 ? "1" : "2")),
  ],
  [
    "SC19: the proof pins reach a group past PROOF_SLOTS",
    (w) => remap(w, (_, proof) => (proof["e2e-1"] = String(counts(w).proof + 1))),
  ],
  [
    "SC19: the proof pins leave a proof group unused",
    (w) => remap(w, (_, proof) => (proof[legAt(w, counts(w).proof - 1)] = counts(w).proof > 1 ? "1" : "2")),
  ],
  [
    "SC19: the full slot map is malformed JSON",
    (w) =>
      (w.jobs["tests"]!.concurrency!["group"] = String(w.jobs["tests"]!.concurrency!["group"]).replace(
        /'\{[^']*\}'/,
        "'{'",
      )),
  ],
  [
    "SC19: the full slot map is a JSON list",
    (w) =>
      (w.jobs["tests"]!.concurrency!["group"] = String(w.jobs["tests"]!.concurrency!["group"]).replace(
        /'\{[^']*\}'/,
        "'[1,2,3,4,5,6,7,8,9]'",
      )),
  ],
  [
    "SC19: tests uses 0595's scheduled-test- names",
    (w) =>
      (w.jobs["tests"]!.concurrency!["group"] =
        `scheduled-test-\${{ fromJSON('${JSON.stringify(pinsIn(w)[0])}')[matrix.shard] }}`),
  ],
  [
    "SC19: the test groups follow a push, not main's ref",
    (w) =>
      (w.jobs["tests"]!.concurrency!["group"] = String(w.jobs["tests"]!.concurrency!["group"]).replaceAll(
        /github\.ref\s*==\s*'refs\/heads\/main'/g,
        "github.event_name == 'push'",
      )),
  ],
  [
    "SC19: changed uses main's groups",
    (w) =>
      (w.jobs["changed"]!.concurrency!["group"] = String(w.jobs["changed"]!.concurrency!["group"]).replace(
        /^scheduled-proof-/i,
        "scheduled-main-",
      )),
  ],
  ["SC19: the workflow holds the control job's group", (w) => (w.concurrency["group"] = "SCHEDULED-CONTROL")],
  ["SC19: the workflow holds a test job's group", (w) => (w.concurrency["group"] = "SCHEDULED-MAIN-1")],
  ["SC19: the workflow holds a proof job's group", (w) => (w.concurrency["group"] = "SCHEDULED-PROOF-1")],
  [
    "SC19: the group counts add up to more than the ten jobs",
    (w) => (w.env = { ...w.env, MAIN_SLOTS: counts(w).main + 1 }),
  ],
  [
    "SC19: select's MOST differs from PROOF_SLOTS",
    (w) => (step(w, "select", "set").env!["MOST"] = counts(w).proof === 1 ? 2 : counts(w).proof - 1),
  ],
  [
    "SC19: changed's parallel count differs from PROOF_SLOTS",
    (w) => (w.jobs["changed"]!.strategy!["max-parallel"] = counts(w).proof === 1 ? 2 : counts(w).proof - 1),
  ],
  [
    "SC19: the full matrix gains another dimension",
    (w) => void Object.assign(w.jobs["tests"]!.strategy!.matrix, { extra: ["a", "b"] }),
  ],
  [
    "SC19: changed can name a proof group past PROOF_SLOTS",
    (w) => {
      w.jobs["changed"]!.strategy!["max-parallel"] = counts(w).proof + 1;
      step(w, "select", "set").env!["MOST"] = counts(w).proof + 1;
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
      const checkout = gate(w).steps.find((s) => Predicate.isString(s["uses"]))!;
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
  [
    "SC6: the test job's max-parallel is a number, not the count of its ref",
    (w) => (w.jobs["tests"]!.strategy!["max-parallel"] = counts(w).main),
  ],
  [
    "SC6: the test job's two counts are swapped",
    (w) => (w.jobs["tests"]!.strategy!["max-parallel"] = `\${{ ${REF} && ${counts(w).proof} || ${counts(w).main} }}`),
  ],
  [
    "SC6: the tests no longer wait on the gate, so they run beside it: 11 machines",
    (w) => {
      Reflect.deleteProperty(w.jobs["tests"]!, "needs");
      w.jobs["tests"]!.strategy!["max-parallel"] = `\${{ ${REF} && 10 || 10 }}`;
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
      w.jobs["extra"] = { "runs-on": "ubuntu-latest", "timeout-minutes": 5, steps: [{ run: "true" }] };
      // SAFETY: the report job of the real workflow lists its `needs` as an array of job names.
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
  // SC20: the start order. The first legs of each pin map take groups 1 to N in order.
  [
    "SC20: a first leg swaps with a later one, so a group waits while another is empty",
    // The first two legs pin to different groups in one map at least (the two counts add up to 9), so
    // swapping them breaks that map's order whatever the split.
    (w) => {
      const shards = w.jobs["tests"]!.strategy!.matrix.shard as string[];
      [shards[0], shards[1]] = [shards[1]!, shards[0]!];
    },
  ],
  ["SC20: a leg is listed twice", (w) => void (w.jobs["tests"]!.strategy!.matrix.shard as string[]).push("tooling-1")],
  [
    "SC8: a tooling leg is renamed",
    (w) => {
      const shards = w.jobs["tests"]!.strategy!.matrix.shard as string[];
      shards[shards.indexOf("tooling-2")] = "tooling-9";
    },
  ],
  // SC8: the tooling legs, among next's.
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
      s["run"] = String(s["run"]).replace("$PROJECTS ", "next/ ");
    },
  ],
  // 0602: main's full run runs every real-resource law, and a branch's full set none. Plants, each
  // run once on scheduled.ts and restored: SC7's PROJECTS check dropped (red on the first three, the
  // fourth caught by the command check above it).
  [
    "SC7: main's full run drops next-integration, so the real-resource laws run nowhere",
    (w) => (step(w, "tests", "vitest").env!["PROJECTS"] = `\${{ ${REF} && '--project next' || '--project next' }}`),
  ],
  [
    "SC7: a branch's full set runs the real-resource laws, which only main's full run runs",
    (w) =>
      (step(w, "tests", "vitest").env!["PROJECTS"] =
        `\${{ ${REF} && '--project next --project next-integration' || '--project next --project next-integration' }}`),
  ],
  [
    "SC7: next's vitest legs lose their projects, so an empty $PROJECTS runs every project",
    (w) => Reflect.deleteProperty(step(w, "tests", "vitest").env!, "PROJECTS"),
  ],
  [
    "SC7: next's vitest legs name both projects in the command again, so a branch's full set runs next-integration",
    (w) => {
      const s = step(w, "tests", "vitest");
      s["run"] = String(s["run"]).replace("$PROJECTS ", "--project next --project next-integration ");
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
    (w) =>
      (step(w, "tests", "tooling tests").env!["PROJECTS"] =
        `\${{ ${REF} && '--project tooling --project tooling-integration --project today' || '--project tooling' }}`),
  ],
  [
    "SC8: tooling loses its projects, so an empty $PROJECTS runs every project",
    (w) => Reflect.deleteProperty(step(w, "tests", "tooling tests").env!, "PROJECTS"),
  ],
  [
    "SC8: tooling leaves the trees out with --exclude, which a project ignores",
    (w) => {
      const s = step(w, "tests", "tooling tests");
      s["run"] = String(s["run"]).replace(
        "$PROJECTS ",
        "--exclude 'next/**' --exclude 'apps/**' --exclude 'packages/**' --exclude 'programs/**' ",
      );
    },
  ],
  // 0602 and 0584: main's full run runs every tooling law that starts a process, and a branch's full
  // set none. Plants, each run once on scheduled.ts and restored: SC8's PROJECTS check dropped (red on
  // the first two, and on "tooling runs today's tests too" and "tooling loses its projects" above;
  // the third is caught by the command check above it).
  [
    "SC8: main's full run drops tooling-integration, so the tooling laws that start a process run nowhere",
    (w) =>
      (step(w, "tests", "tooling tests").env!["PROJECTS"] =
        `\${{ ${REF} && '--project tooling' || '--project tooling' }}`),
  ],
  [
    "SC8: a branch's full set runs tooling-integration, which only main's full run runs",
    (w) =>
      (step(w, "tests", "tooling tests").env!["PROJECTS"] =
        `\${{ ${REF} && '--project tooling --project tooling-integration' || '--project tooling --project tooling-integration' }}`),
  ],
  [
    "SC8: the tooling legs name both projects in the command again, so a branch's full set runs tooling-integration",
    (w) => {
      const s = step(w, "tests", "tooling tests");
      s["run"] = String(s["run"]).replace("$PROJECTS ", "--project tooling --project tooling-integration ");
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
  // SC17's two reads, ticket 1161. Plants, each run once on scheduled.ts and restored: SC17's key list
  // admits any extra key (red on the seventh key); SC17's two value checks dropped (red on the other
  // seven: the literal, the two bare names, the two swapped and the github.event.inputs read).
  ["SC17: select's step has no SCOPE", (w) => Reflect.deleteProperty(step(w, "select", "set").env!, "SCOPE")],
  ["SC17: select's step has no LAW", (w) => Reflect.deleteProperty(step(w, "select", "set").env!, "LAW")],
  ["SC17: SCOPE is the literal full", (w) => (step(w, "select", "set").env!["SCOPE"] = "full")],
  // A bare name is text, not a read: the step would get the words `inputs.scope`, not the input.
  ["SC17: SCOPE is the bare text inputs.scope", (w) => (step(w, "select", "set").env!["SCOPE"] = "inputs.scope")],
  ["SC17: LAW is the bare text inputs.law", (w) => (step(w, "select", "set").env!["LAW"] = "inputs.law")],
  [
    "SC17: SCOPE reads github.event.inputs",
    (w) => (step(w, "select", "set").env!["SCOPE"] = `\${{ github.event.inputs.scope }}`),
  ],
  [
    "SC17: SCOPE and LAW are swapped",
    (w) => {
      const env = step(w, "select", "set").env!;
      [env["SCOPE"], env["LAW"]] = [env["LAW"], env["SCOPE"]];
    },
  ],
  ["SC17: select's step gets a seventh env key", (w) => (step(w, "select", "set").env!["EXTRA"] = "x")],
  // SC21, ticket 1161: the hand start's two inputs. Plants, each run once on scheduled.ts and restored:
  // SC21's input check dropped (red on each of these).
  ["SC21: the scope default is full", (w) => (hand(w)["scope"]!["default"] = "full")],
  ["SC21: the scope has no default", (w) => Reflect.deleteProperty(hand(w)["scope"]!, "default")],
  ["SC21: the scope options gain readers", (w) => (hand(w)["scope"]!["options"] = ["changed", "full", "readers"])],
  ["SC21: the scope options lose full", (w) => (hand(w)["scope"]!["options"] = ["changed"])],
  ["SC21: the scope is a string", (w) => (hand(w)["scope"]!["type"] = "string")],
  ["SC21: the scope is not required", (w) => (hand(w)["scope"]!["required"] = false)],
  ["SC21: the scope has no description", (w) => Reflect.deleteProperty(hand(w)["scope"]!, "description")],
  ["SC21: the law has no description", (w) => Reflect.deleteProperty(hand(w)["law"]!, "description")],
  ["SC21: a third input", (w) => (hand(w)["extra"] = { type: "string", required: false, default: "" })],
  ["SC21: the law input is missing", (w) => Reflect.deleteProperty(hand(w), "law")],
  ["SC21: the law is required", (w) => (hand(w)["law"]!["required"] = true)],
  ["SC21: the law has a default of a path", (w) => (hand(w)["law"]!["default"] = ".github/ci/proof.test.ts")],
  // SC18, 0590: a changed set's legs. Plants, each run once on scheduled.ts and restored: SC18's
  // `if` check dropped (red on the first two); its command checks dropped (red on the next four);
  // its limit checks dropped (red on the three limits).
  ["SC18: the changed legs run on main too", (w) => (w.jobs["changed"]!["if"] = "needs.gate.outputs.start == 'true'")],
  [
    "SC18: the changed legs start on a set of zero files",
    (w) => (w.jobs["changed"]!["if"] = "needs.gate.outputs.start == 'true' && needs.select.outputs.scope == 'changed'"),
  ],
  // 0602: a changed leg runs no real-resource law, so it names no next-integration project.
  // proof.test.ts holds the same list against proof.ts's PROJECTS.
  [
    "SC18: a changed leg runs the real-resource laws, which only main's full run runs",
    (w) =>
      (step(w, "changed", "vitest")["run"] = String(step(w, "changed", "vitest")["run"]).replace(
        "--project next ",
        "--project next --project next-integration ",
      )),
  ],
  [
    "SC18: a changed leg leaves out the in-memory laws",
    (w) =>
      (step(w, "changed", "vitest")["run"] = String(step(w, "changed", "vitest")["run"]).replace(
        "--project next ",
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
  beside.jobs["extra"] = { "runs-on": "ubuntu-latest", "timeout-minutes": 5, steps: [{ run: "true" }] };
  // SAFETY: `beside` is `real()`, whose report job waits on a list of job names.
  (beside.jobs["report"]!.needs as string[]).push("extra");
  expect(lint(beside)).toEqual([
    ONE,
    "scheduled.yaml: SC19: every admitted job is one of the five jobs with shared slots",
  ]);
});

it("SC6 scenario: on the real scheduled.yaml, the per-run budget counts the larger of the two counts at the tests' step, so 6 more jobs there make 11 machines and 5 make 10", () => {
  // 0598: main runs 5 legs at once and a proof 4, but a run is one or the other, so the step holds the
  // larger, 5. Plant, run once on scheduled.ts and restored: the smaller count taken (red: 6 more jobs
  // at 4 make 10 and pass).
  const BUDGET_RULE = "scheduled.yaml: SC6: its jobs take at most 10 machines at once, half of the 20 runners";

  const crowd = (extra: number) => {
    const w = real();

    for (let index = 0; index < extra; index++) {
      w.jobs[`extra-${index}`] = {
        needs: ["gate", "select"],
        "runs-on": "ubuntu-latest",
        "timeout-minutes": 5,
        steps: [{ run: "true" }],
      };
      (w.jobs["report"]!.needs as string[]).push(`extra-${index}`);
    }

    return lint(w);
  };

  expect(crowd(5)).not.toContain(BUDGET_RULE);
  expect(crowd(6)).toContain(BUDGET_RULE);
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

// Where a read of the hand start's inputs may be put, and the forms a read takes (ticket 1161).
const JOBS = ["gate", "tests", "select", "changed", "report"] as const;

const places: [string, (w: Workflow, read: string, at: number) => void][] = [
  ...JOBS.flatMap((job): [string, (w: Workflow, read: string, at: number) => void][] => [
    [`${job}'s if`, (w, read) => (w.jobs[job]!["if"] = `\${{ ${read} == 'x' }}`)],
    [`${job}'s group`, (w, read) => (w.jobs[job]!.concurrency!["group"] = `scheduled-\${{ ${read} }}`)],
    [
      `${job}'s step env`,
      (w, read, at) => {
        const target = w.jobs[job]!.steps[at % w.jobs[job]!.steps.length]!;
        target.env = { ...target.env, FROM_INPUTS: `\${{ ${read} }}` };
      },
    ],
  ]),
  ["the workflow's group", (w, read) => (w.concurrency["group"] = `scheduled-\${{ ${read} }}`)],
  ["tests's max-parallel", (w, read) => (w.jobs["tests"]!.strategy!["max-parallel"] = `\${{ ${read} }}`)],
];

// The forms a read takes: the `inputs` context in dot and bracket form, `github.event.inputs`, the whole
// `github` context or its `event` as JSON, in any form of the dot, the index and the `*` filter, and the
// same in capitals, since GitHub's context and function names do not tell the case.
const READS = [
  "inputs.scope",
  "inputs.law",
  "inputs['scope']",
  "github.event.inputs.scope",
  "toJSON(github)",
  "toJSON(github.*)",
  "toJSON(github['*'])",
  "toJSON(github.event)",
  "toJSON(github['event'])",
  "toJSON(github.event.*)",
  "toJSON(github['event']['*'])",
  "INPUTS.SCOPE",
  "TOJSON(GITHUB)",
  "TOJSON(GITHUB.*)",
  "TOJSON(GITHUB.EVENT)",
  "toJson(GitHub['Event'])",
];

const reachedS9 = new Set<string>();

effectIt.prop(
  "S9 property: a read of the hand start's inputs anywhere but select's set step is named by SC21, whatever the place and the form",
  {
    varied: Varied,
    place: Schema.Literals(places.map(([name]) => name)),
    read: Schema.Literals(READS),
    at: Schema.Int.check(Schema.isBetween({ minimum: 0, maximum: 8 })),
  },
  ({ varied, place, read, at }) => {
    // Plants, each run once on scheduled.ts and restored: SC21's read check scans only `tests`'s `if`
    // (red: the gate's env reading `inputs.scope` passes); READS_INPUTS drops its `i` flag (red: the
    // capital forms pass); a bracket read is not taken as a dot read (red: `github['event']` passes);
    // a whole `github` or `github.event` read is not counted (red: the `toJSON` and `.*` forms pass).
    const broken = vary(varied);
    places.find(([name]) => name === place)![1](broken, read, at);
    reachedS9.add(`${place} reads ${read}`);
    const errors = lint(broken);
    expect(
      errors.some((error) => error.startsWith("scheduled.yaml: SC21:")),
      `${place} reads ${read}: ${JSON.stringify(errors)}`,
    ).toBe(true);
  },
  { arbitrary: { runs: runsFor({ fast: 100, full: 100 }) } },
);

// What is not a read of the inputs: any other property of `github` or of its event, in the dot form, the
// index form and capitals. A lint that names these would reject the real workflow's own `github.ref`.
const OTHER_PROPERTIES = [
  "github.ref",
  "github['ref']",
  "github.event_name",
  "GITHUB['Event_Name']",
  "github.run_number",
  "github.event.schedule",
  "github['event']['schedule']",
  "github.event['schedule']",
  "GitHub.Event.Pull_Request.Head.SHA",
];

const reachedS9Other = new Set<string>();

afterAll(() => {
  // Each S9 law reached every place and every form it names. Nothing reached means the law was
  // filtered out of this run, not that it missed one.
  const found = [...reachedS9].map((reached) => reached.split(" reads "));

  expect(reachedS9.size === 0 ? [] : [...new Set(found.map(([place]) => place))].toSorted()).toEqual(
    reachedS9.size === 0 ? [] : places.map(([place]) => place).toSorted(),
  );

  expect(reachedS9.size === 0 ? [] : [...new Set(found.map(([, read]) => read))].toSorted()).toEqual(
    reachedS9.size === 0 ? [] : READS.toSorted(),
  );

  expect(reachedS9Other.size === 0 ? [] : [...reachedS9Other].toSorted()).toEqual(
    reachedS9Other.size === 0 ? [] : OTHER_PROPERTIES.toSorted(),
  );
});

effectIt.prop(
  "S9 property: a read of another property of github or of its event is not named by SC21, in any place and form",
  {
    varied: Varied,
    place: Schema.Literals(places.map(([name]) => name)),
    read: Schema.Literals(OTHER_PROPERTIES),
    at: Schema.Int.check(Schema.isBetween({ minimum: 0, maximum: 8 })),
  },
  ({ varied, place, read, at }) => {
    // Plant, run once on scheduled.ts and restored: an index with a quoted name is not read as a dot
    // (red: `github['ref']` reads as the whole `github` context).
    const w = vary(varied);
    places.find(([name]) => name === place)![1](w, read, at);
    reachedS9Other.add(read);
    const errors = lint(w);
    expect(
      errors.some((error) => error.startsWith("scheduled.yaml: SC21:")),
      `${place} reads ${read}: ${JSON.stringify(errors)}`,
    ).toBe(false);
  },
  { arbitrary: { runs: runsFor({ fast: 100, full: 100 }) } },
);

it("S12 scenario: on the real scheduled.yaml the only reads of the inputs are select's SCOPE and LAW, and a read added to tests's if is named by SC15 and SC21", () => {
  // Plant, run once on scheduled.ts and restored: SC21's read check dropped (red: the plant gives
  // SC15's error alone).
  const w = real();
  expect(lint(w)).toEqual([]);
  expect(JSON.stringify(w.jobs).match(/\binputs\b/g)).toHaveLength(2);
  expect(step(w, "select", "set").env!["SCOPE"]).toContain("inputs.scope");
  expect(step(w, "select", "set").env!["LAW"]).toContain("inputs.law");

  w.jobs["tests"]!["if"] = `${String(w.jobs["tests"]!["if"]).replace(/ \}\}$/, "")} && inputs.scope != 'changed' }}`;
  const errors = lint(w);
  expect(
    errors.some((error) => error.startsWith("scheduled.yaml: SC15:")),
    JSON.stringify(errors),
  ).toBe(true);
  expect(
    errors.some((error) => error.startsWith("scheduled.yaml: SC21:")),
    JSON.stringify(errors),
  ).toBe(true);
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
        w.env = { ...w.env, GAP_MINUTES: gap };
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
    Rec.values(reached).every((count) => count > 0),
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

effectIt.prop(
  "P7 every scheduled test command requires its progress reporter and existing reporters and changed leg identity",
  { index: Schema.Int.check(Schema.isBetween({ minimum: 0, maximum: 3 })), substitute: Schema.Boolean },
  ({ index, substitute }) => {
    // Plant: remove the custom reporter requirement from the shared exact command rule.
    const good = real();
    expect(lintScheduled(JSON.stringify(good), check)).toEqual([]);

    const targets = Object.values(good.jobs)
      .flatMap((job) => job.steps)
      .filter((item) => typeof item["run"] === "string" && item["run"].startsWith("pnpm exec vitest run"));

    expect(targets).toHaveLength(4);
    const item = targets[index]!;
    item["run"] = String(item["run"]).replace(
      "--reporter=./.github/ci/progress-reporter.ts ",
      substitute ? "--reporter=./other.ts " : "",
    );
    expect(lintScheduled(JSON.stringify(good), check).length).toBeGreaterThan(0);
    const missingLeg = real();
    Reflect.deleteProperty(step(missingLeg, "changed", "vitest").env!, "LEG");
    expect(lintScheduled(JSON.stringify(missingLeg), check).length).toBeGreaterThan(0);
  },
  { arbitrary: { runs: runsFor({ fast: 100, full: 100 }), size: 30, concurrency: 1 } },
);
