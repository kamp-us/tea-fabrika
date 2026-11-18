import { expect, it } from "@effect/vitest";
import { Schema } from "effect";
import { checklistCases, fixture, wanted } from "./plant-related.ts";
import { outputs, select, type Sizing } from "./related.ts";

const options = { arbitrary: { seed: 119120, runs: 100, size: 100 } };

const sizing: Sizing = {
  "next-integration": { most: 5, limit: 100 },
  tooling: { most: 2, limit: 200 },
  table: {},
};

it.prop(
  "checklist faults cover every case once across existing integration legs without duplicating ordinary files",
  { count: Schema.Int.check(Schema.isBetween({ minimum: 0, maximum: 30 })) },
  ({ count }) => {
    const files = {
      "next-integration": [
        fixture,
        ...Array.from({ length: count }, (_, index) => `next/other-${index}.integration.test.ts`),
      ],
      tooling: [".github/ci/plant.test.ts"],
    };

    const table = Object.fromEntries(files["next-integration"].map((file, index) => [file, index < 5 ? 100 : 0]));

    const result = select(files, { ...sizing, table }, true);

    const assigned = Object.values(result.plants).flat();

    expect(assigned.toSorted()).toEqual(checklistCases.toSorted());

    expect(new Set(assigned).size).toBe(10);

    if (count >= 4) {
      expect(Object.keys(result.plants)).toHaveLength(5);

      expect(Object.values(result.plants).map((cases) => cases.length)).toEqual([2, 2, 2, 2, 2]);
    }

    for (const [leg, cases] of Object.entries(result.plants)) {
      expect(result.projects[leg]).toBe("next-integration");

      expect(cases.length).toBeGreaterThan(0);
    }

    expect(
      Object.values(result.legs)
        .flat()
        .filter((file) => file === fixture),
    ).toHaveLength(1);

    expect(JSON.parse(Object.fromEntries(outputs(result).map((line) => line.split("=")))["plants"]!)).toEqual(
      result.plants,
    );

    expect(select(files, sizing).plants).toEqual({});

    expect(() => select({ "next-integration": [], tooling: [] }, sizing, true)).toThrow();
  },
  options,
);

it.prop(
  "uniform integration weights choose the fewest equal-load legs",
  { count: Schema.Int.check(Schema.isBetween({ minimum: 0, maximum: 30 })) },
  ({ count }) => {
    const files = {
      "next-integration": [
        fixture,
        ...Array.from({ length: count }, (_, index) => `next/other-${index}.integration.test.ts`),
      ],
      tooling: [".github/ci/plant.test.ts"],
    };

    const table = Object.fromEntries(files["next-integration"].map((file) => [file, 100]));

    const result = select(files, { ...sizing, table }, true);

    const assigned = Object.values(result.plants).flat();

    expect(assigned.toSorted()).toEqual(checklistCases.toSorted());

    expect(new Set(assigned).size).toBe(10);

    const integrationFiles = files["next-integration"].length;

    expect(Object.keys(result.plants)).toHaveLength(Math.ceil(integrationFiles / Math.ceil(integrationFiles / 5)));

    for (const [leg, cases] of Object.entries(result.plants)) {
      expect(result.projects[leg]).toBe("next-integration");

      expect(cases.length).toBeGreaterThan(0);
    }

    expect(
      Object.values(result.legs)
        .flat()
        .filter((file) => file === fixture),
    ).toHaveLength(1);

    expect(JSON.parse(Object.fromEntries(outputs(result).map((line) => line.split("=")))["plants"]!)).toEqual(
      result.plants,
    );
  },
  options,
);

it("uniform sixteen-file selection uses four groups when the best load ties", () => {
  const files = {
    "next-integration": [
      fixture,
      ...Array.from({ length: 15 }, (_, index) => `next/other-${index}.integration.test.ts`),
    ],
    tooling: [".github/ci/plant.test.ts"],
  };

  const table = Object.fromEntries(files["next-integration"].map((file) => [file, 100]));

  const result = select(files, { ...sizing, table }, true);

  expect(Object.keys(result.plants)).toHaveLength(4);
});

it.prop(
  "only fixture and exercise source changes request the existing checklist faults",
  { prefix: Schema.String.check(Schema.isPattern(/^[a-z]{1,8}$/)) },
  ({ prefix }) => {
    for (const file of [fixture, ".github/ci/plant.ts", ".github/ci/plant-cases.ts", ".github/ci/plant-related.ts"]) {
      expect(wanted([file])).toBe(true);
    }

    expect(wanted(null)).toBe(true);

    expect(
      wanted([`next/${prefix}.ts`, "pnpm-lock.yaml", ".github/workflows/check.yaml", ".github/ci/plant.test.ts"]),
    ).toBe(false);
  },
  options,
);

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
    expect(Object.keys(emitted)).toEqual(["run", "legs", "files", "projects", "plants"]);

    expect(Object.keys(result).toSorted()).toEqual(["legs", "plants", "projects"]);

    expect(emitted["run"]).toBe(String(all.length > 0));

    expect(JSON.parse(emitted["legs"]!)).toEqual(Object.keys(result.legs));

    expect(JSON.parse(emitted["projects"]!)).toEqual(result.projects);

    expect(select(files, sizing)).toEqual(result);
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
