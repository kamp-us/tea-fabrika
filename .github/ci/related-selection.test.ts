import { expect, it } from "@effect/vitest";
import { Schema } from "effect";
import { outputs, select, type Sizing } from "./related.ts";

const options = { arbitrary: { seed: 119120, numRuns: 100 } };

const sizing: Sizing = {
  "next-integration": { most: 5, limit: 100 },
  tooling: { most: 2, limit: 200 },
  table: {},
};

it.prop(
  "related selection preserves both missing projects exactly once within the shared slots",
  {
    integration: Schema.Int.check(Schema.isBetween({ minimum: 0, maximum: 30 })),
    tooling: Schema.Int.check(Schema.isBetween({ minimum: 0, maximum: 30 })),
    run: Schema.Int.check(Schema.isGreaterThan(0)),
  },
  ({ integration, tooling, run }) => {
    const files = {
      "next-integration": Array.from({ length: integration }, (_, index) => `next/a-${index}.integration.test.ts`),
      tooling: Array.from({ length: tooling }, (_, index) => `.github/ci/a-${index}.test.ts`),
    };
    const result = select(files, sizing, run);
    const all = Object.values(result.legs).flat();
    expect(all.toSorted()).toEqual(Object.values(files).flat().toSorted());
    expect(new Set(all).size).toBe(all.length);
    expect(Object.keys(result.legs).length).toBeLessThanOrEqual(7);
    expect(Object.keys(result.legs).length === 0).toBe(integration + tooling === 0);
    expect(new Set(Object.values(result.slots)).size).toBe(9);
    expect(Object.values(result.slots).toSorted()).toEqual(["1", "2", "3", "4", "5", "6", "7", "8", "9"]);

    for (const [leg, paths] of Object.entries(result.legs)) {
      const project = result.projects[leg]!;
      expect(paths.length).toBeGreaterThan(0);
      expect(paths.every((path) => files[project].includes(path))).toBe(true);
      expect(result.slots[leg]).toBeDefined();
    }

    const emitted = Object.fromEntries(
      outputs(result).map((line) => {
        const at = line.indexOf("=");
        return [line.slice(0, at), line.slice(at + 1)];
      }),
    );
    expect(emitted["run"]).toBe(String(all.length > 0));
    expect(JSON.parse(emitted["legs"]!)).toEqual(Object.keys(result.legs));
    expect(JSON.parse(emitted["projects"]!)).toEqual(result.projects);
    expect(select(files, sizing, run)).toEqual(result);
  },
  options,
);

it.prop(
  "related selection refuses ambiguous file lists and invalid run numbers",
  { word: Schema.String.check(Schema.isPattern(/^[a-z]{1,8}$/)) },
  ({ word }) => {
    const path = `next/${word}.integration.test.ts`;
    expect(() => select({ "next-integration": [path], tooling: [path] }, sizing, 1)).toThrow();
    expect(() =>
      select({ "next-integration": [`next/${word} name.integration.test.ts`], tooling: [] }, sizing, 1),
    ).toThrow();

    for (const run of [0, -1, 1.5, Number.NaN, Infinity, Number.MAX_SAFE_INTEGER + 1]) {
      expect(() => select({ "next-integration": [], tooling: [] }, sizing, run)).toThrow();
    }
  },
  options,
);
