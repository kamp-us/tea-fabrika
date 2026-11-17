import { expect, it } from "@effect/vitest";
import { Schema } from "effect";
import { cases } from "./plant-cases.ts";
import { Model, Observation } from "./plant-machine.ts";
import { accepted, fixture } from "./plant-related.ts";

it.prop(
  "automatic PID proof requires the current causal assertion and frame, not another failure",
  { offset: Schema.Int.check(Schema.isBetween({ minimum: 1, maximum: 30 })) },
  ({ offset }) => {
    const details = {
      title: cases["checklist-pid"].title,
      file: fixture,
      ms: 1,
      duration: 1,
      counts: { total: 6, passed: 1, failed: 0, pending: 5, todo: 0 },
      suites: { total: 1, passed: 1, failed: 0, pending: 0 },
    };

    const passed = Observation.cases.passed.make({ ...details, exit: 0 });

    const broken = Observation.cases.failed.make({
      ...details,
      exit: 1,
      category: "assertion",
      diagnostic: "AssertionError: the client heard the checklist's views",
      assertion: { line: 824, column: 80 },
      counts: { ...details.counts, passed: 0, failed: 1 },
      suites: { ...details.suites, passed: 0, failed: 1 },
    });

    const model = Model.cases.recorded.make({ baseline: passed, broken, restored: passed });

    expect(accepted("checklist-pid", model)).toBe(true);

    for (const wrong of [
      { ...broken, diagnostic: "AssertionError: another assertion" },
      { ...broken, assertion: null },
      { ...broken, assertion: { line: 824 + offset, column: 80 } },
      { ...broken, assertion: { line: 824, column: 80 + offset } },
      { ...broken, diagnostic: "AssertionError: a notice names its process", assertion: { line: 828, column: 68 } },
      { ...broken, assertion: { line: 828, column: 68 } },
    ]) {
      expect(accepted("checklist-pid", { ...model, broken: wrong })).toBe(false);
    }

    expect(accepted("checklist-pid", Model.cases.incomplete.make({ reason: "timeout", observations: [] }))).toBe(false);

    expect(accepted("host-pin", model)).toBe(false);
  },
  { arbitrary: { seed: 119120, runs: 100, size: 100 } },
);
