import { expect, it } from "@effect/vitest";
import { Schema } from "effect";
import { outputs, select, type Sizing, wantsChecklistLaw } from "./related.ts";

const options = { arbitrary: { seed: 119120, runs: 100, size: 100 } };

const sizing: Sizing = {
  "next-integration": { most: 5, limit: 100 },
  tooling: { most: 2, limit: 200 },
  table: {},
};

it.prop(
  "related selection preserves both missing projects exactly once",
  {
    integration: Schema.Int.check(Schema.isBetween({ minimum: 0, maximum: 30 })),
    tooling: Schema.Int.check(Schema.isBetween({ minimum: 0, maximum: 30 })),
  },
  ({ integration, tooling }) => {
    const files = {
      "next-integration": Array.from({ length: integration }, (_, index) => `next/a-${index}.integration.test.ts`),
      tooling: Array.from({ length: tooling }, (_, index) => `.github/ci/a-${index}.test.ts`),
    };

    const result = select(files, sizing);

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

    const emitted = Object.fromEntries(
      outputs(result).map((line) => {
        const at = line.indexOf("=");

        return [line.slice(0, at), line.slice(at + 1)];
      }),
    );

    // 0598: the related job holds no group, so the selection carries no group map.
    expect(Object.keys(emitted)).toEqual(["run", "legs", "files", "projects"]);

    expect(Object.keys(result).toSorted()).toEqual(["legs", "projects"]);

    expect(emitted["run"]).toBe(String(all.length > 0));

    expect(JSON.parse(emitted["legs"]!)).toEqual(Object.keys(result.legs));

    expect(JSON.parse(emitted["projects"]!)).toEqual(result.projects);

    expect(select(files, sizing)).toEqual(result);
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
  { word: Schema.String.check(Schema.isPattern(/^[a-z]{1,8}$/)) },
  ({ word }) => {
    const path = `next/${word}.integration.test.ts`;

    expect(() => select({ "next-integration": [path], tooling: [path] }, sizing)).toThrow();

    expect(() =>
      select({ "next-integration": [`next/${word} name.integration.test.ts`], tooling: [] }, sizing),
    ).toThrow();
  },
  options,
);
