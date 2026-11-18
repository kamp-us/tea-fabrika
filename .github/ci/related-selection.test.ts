import { expect, it } from "@effect/vitest";
import { Schema } from "effect";
import { outputs, select, type Sizing, wantsChecklistLaw } from "./related.ts";

const options = { arbitrary: { seed: 119120, runs: 100, size: 100 } };

const sizing: Sizing = {
  "next-integration": { most: 5, limit: 100 },
  tooling: { most: 2, limit: 200 },
  table: {},
};

const count = Schema.Int.check(Schema.isBetween({ minimum: 0, maximum: 30 }));

/** Generated files of both projects, as a run's `vitest list` would give them. */
const filesOf = (integration: number, tooling: number) => ({
  "next-integration": Array.from({ length: integration }, (_, index) => `next/a-${index}.integration.test.ts`),
  tooling: Array.from({ length: tooling }, (_, index) => `.github/ci/a-${index}.test.ts`),
});

/** The step's printed outputs, by name. */
const emittedBy = (result: ReturnType<typeof select>) =>
  Object.fromEntries(
    outputs(result).map((line) => {
      const at = line.indexOf("=");

      return [line.slice(0, at), line.slice(at + 1)];
    }),
  );

// scenario: a push to main whose changes job failed, the one other event check.yaml's select job
// runs on, picks both projects as it did before the merge line left the integration laws.
it.prop(
  "related selection preserves both missing projects exactly once",
  { integration: count, tooling: count },
  ({ integration, tooling }) => {
    const files = filesOf(integration, tooling);

    const lists = { "next-integration": () => files["next-integration"], tooling: () => files.tooling };

    const result = select("push", lists, sizing);

    const all = Object.values(result.legs).flat();

    expect(all.toSorted()).toEqual(Object.values(files).flat().toSorted());

    expect(new Set(all).size).toBe(all.length);

    expect(Object.keys(result.legs).length).toBeLessThanOrEqual(7);

    expect(Object.keys(result.legs).length === 0).toBe(integration + tooling === 0);

    for (const [leg, paths] of Object.entries(result.legs)) {
      const project = result.projects[leg]!;

      expect(paths.length).toBeGreaterThan(0);

      expect(paths.every((path) => files[project].includes(path))).toBe(true);
    }

    const emitted = emittedBy(result);

    // 0598: the related job holds no group, so the selection carries no group map.
    expect(Object.keys(emitted)).toEqual(["run", "legs", "files", "projects"]);

    expect(Object.keys(result).toSorted()).toEqual(["legs", "projects"]);

    expect(emitted["run"]).toBe(String(all.length > 0));

    expect(JSON.parse(emitted["legs"]!)).toEqual(Object.keys(result.legs));

    expect(JSON.parse(emitted["projects"]!)).toEqual(result.projects);

    expect(select("push", lists, sizing)).toEqual(result);
  },
  options,
);

// The owner's call of 2026-11-18: the merge line runs no integration law, main's full run does.
// Plants, each run once on related.ts and restored: `projectsOf` returning both projects for every
// event (red, integration files land on legs and their list is asked for); returning tooling alone
// for every event (red, the push law above loses its integration files).
it.prop(
  "a pull request or queue group change that reaches integration laws selects none of them and the same tooling legs",
  {
    event: Schema.Literals(["pull_request", "merge_group"]),
    integration: Schema.Int.check(Schema.isBetween({ minimum: 1, maximum: 30 })),
    tooling: count,
  },
  ({ event, integration, tooling }) => {
    const files = filesOf(integration, tooling);

    let asked = 0;

    const result = select(
      event,
      {
        "next-integration": () => {
          asked += 1;

          return files["next-integration"];
        },
        tooling: () => files.tooling,
      },
      sizing,
    );

    // The integration list is never asked for, so the step starts no `vitest list` for it.
    expect(asked).toBe(0);

    expect(Object.values(result.legs).flat().toSorted()).toEqual(files.tooling.toSorted());

    expect(Object.values(result.projects).every((project) => project === "tooling")).toBe(true);

    // Tooling picks exactly what it picks when no integration law is reached at all.
    expect(result).toEqual(select("push", { "next-integration": () => [], tooling: () => files.tooling }, sizing));

    // With no tooling file the related job skips: `run=false`, no legs.
    expect(emittedBy(result)["run"]).toBe(String(tooling > 0));
  },
  options,
);

it.prop(
  "the checklist integration law stays in ordinary runs for former plant sources",
  { prefix: Schema.String.check(Schema.isPattern(/^[a-z]{1,8}$/)) },
  ({ prefix }) => {
    const fixture = "next/apps/fabrika/src/checklist-instance.laws.integration.test.ts";

    for (const file of [
      fixture,
      ".github/ci/plant.ts",
      ".github/ci/plant-cases.ts",
      ".github/ci/plant-errors.ts",
      ".github/ci/plant-machine.ts",
      ".github/ci/plant-reporter.ts",
      ".github/ci/plant-related.ts",
    ]) {
      expect(wantsChecklistLaw([file])).toBe(true);
    }

    expect(wantsChecklistLaw(null)).toBe(true);

    expect(wantsChecklistLaw([`next/${prefix}.ts`, "pnpm-lock.yaml", ".github/workflows/check.yaml"])).toBe(false);
  },
  options,
);

it.prop(
  "related selection refuses ambiguous file lists",
  {
    word: Schema.String.check(Schema.isPattern(/^[a-z]{1,8}$/)),
    event: Schema.Literals(["pull_request", "merge_group"]),
  },
  ({ word, event }) => {
    const path = `next/${word}.integration.test.ts`;

    const none = () => [];

    expect(() => select("push", { "next-integration": () => [path], tooling: () => [path] }, sizing)).toThrow();

    expect(() =>
      select("push", { "next-integration": () => [`next/${word} name.integration.test.ts`], tooling: none }, sizing),
    ).toThrow();

    // The merge line's tooling list keeps the same guard.
    const tool = `.github/ci/${word}.test.ts`;

    expect(() => select(event, { "next-integration": none, tooling: () => [tool, tool] }, sizing)).toThrow();

    expect(() =>
      select(event, { "next-integration": none, tooling: () => [`.github/ci/${word} a.test.ts`] }, sizing),
    ).toThrow();
  },
  options,
);
