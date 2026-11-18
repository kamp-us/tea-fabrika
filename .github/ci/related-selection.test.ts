import { createHash } from "node:crypto";
import { createRequire } from "node:module";
import { expect, it } from "@effect/vitest";
import { Schema } from "effect";
import { projects } from "../../vitest.config.ts";
import { classify, configPath } from "./changes.mjs";
import { checklistCases, fixture, wanted } from "./plant-related.ts";
import { checkedConfig, configConsumer, configEvent, outputs, select, type Sizing, withConfig } from "./related.ts";

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

    const result = select(files, { ...sizing, table }, 1, true);

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

    expect(select(files, sizing, 1).plants).toEqual({});

    expect(() => select({ "next-integration": [], tooling: [] }, sizing, 1, true)).toThrow();
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

    const result = select(files, { ...sizing, table }, 1, true);

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

  const result = select(files, { ...sizing, table }, 1, true);

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

// P4 plants: remove Kalfa discovery, drop the consumer from selection, or change delivered bytes/head.

const match = createRequire(import.meta.resolve("vitest/package.json"))("picomatch");

const sha = Schema.String.check(Schema.isPattern(/^[a-f][a-f0-9]{39}$/));

it.prop(
  "P4 config paths discover ordinary and consumer laws in the existing projects and retain one delivery owner",
  {
    word: Schema.String.check(Schema.isPattern(/^[a-z]{1,8}$/)),
    count: Schema.Int.check(Schema.isBetween({ minimum: 0, maximum: 30 })),
  },
  ({ word, count }) => {
    const included = (name: string, file: string) => {
      const project = projects.find((candidate) => candidate.test.name === name);

      return (
        project !== undefined &&
        match.isMatch(file, project.test.include, { dot: true }) &&
        !match.isMatch(file, project.test.exclude, { dot: true })
      );
    };

    for (const file of ["App.test.ts", "TomlParser.test.ts", "Toml.types.test.ts", `${word}.test.ts`]) {
      expect(included("next", `kalfa/config/src/${file}`)).toBe(true);

      expect(included("next-integration", `kalfa/config/src/${file}`)).toBe(false);

      expect(included("next", `kalfa/config/dist/${file}`)).toBe(false);
    }

    expect(included("next-integration", configConsumer)).toBe(true);

    expect(included("next", configConsumer)).toBe(false);

    expect(included("tooling", "scripts/kalfa-config.test.ts")).toBe(true);

    for (const path of [
      `kalfa/config/src/${word}.ts`,
      "kalfa/config/README.md",
      "scripts/kalfa-config.test.ts",
      ".github/ci/related.ts",
    ]) {
      expect(configPath(path)).toBe(true);

      for (const event of ["pull_request", "merge_group", "push"]) {
        const flags = classify([path], event);

        expect(flags.check).toBe(true);

        expect(flags.typecheck).toBe(true);

        expect(flags.build).toBe(false);
      }
    }

    expect(configPath(`next/${word}.ts`)).toBe(false);

    expect(configEvent("merge_group", undefined)).toBe(true);

    expect(configEvent("pull_request", "false")).toBe(true);

    for (const draft of ["true", "", undefined]) {
      expect(configEvent("pull_request", draft)).toBe(false);
    }

    for (const event of ["push", "workflow_dispatch", "", word, undefined]) {
      expect(configEvent(event, "false")).toBe(false);
    }

    const original = Array.from({ length: count }, (_, index) => `next/${word}-${index}.integration.test.ts`);

    const integration = withConfig(original, [configConsumer], true);

    const result = select({ "next-integration": integration, tooling: ["scripts/kalfa-config.test.ts"] }, sizing, 1);

    expect(Object.values(result.legs).flat().toSorted()).toEqual(
      [...original, configConsumer, "scripts/kalfa-config.test.ts"].toSorted(),
    );

    const owners = Object.keys(result.config);

    expect(owners).toHaveLength(1);

    for (const owner of owners) {
      expect(result.projects[owner]).toBe("next-integration");

      expect(result.legs[owner]).toContain(configConsumer);
    }

    expect(
      withConfig([...original, configConsumer], [configConsumer], true).filter((file) => file === configConsumer),
    ).toHaveLength(1);

    expect(withConfig(original, [], false).toSorted()).toEqual(original.toSorted());

    expect(select({ "next-integration": original, tooling: [] }, sizing, 1).config).toEqual({});

    expect(() => withConfig(original, [], true)).toThrow();

    expect(() => withConfig(original, ["next/wrong.integration.test.ts"], true)).toThrow();

    expect(() => select({ "next-integration": [], tooling: [configConsumer] }, sizing, 1)).toThrow();

    const output = outputs(result).find((line) => line.startsWith("config="));

    expect(output).toBe(`config=${JSON.stringify(result.config)}`);

    expect(new Set(Object.values(result.slots)).size).toBe(9);
  },
  options,
);

it.prop(
  "P4 delivery accepts only the tested archive with successful consumer stages and matching source/requested heads",
  { source: sha, requested: sha, content: Schema.String },
  ({ source, requested, content }) => {
    const archive = new TextEncoder().encode(content);

    const receipt = {
      source,
      requested,
      archive: "kalfa-config-0.0.0.tgz",
      sha256: createHash("sha256").update(archive).digest("hex"),
      versions: { node: "node-version", pnpm: "pnpm-version", npm: "npm-version", compiler: "compiler-version" },
      exports: { "./App": { types: "./dist/App.d.ts", default: "./dist/App.js" } },
      stages: {
        build: "passed",
        pack: "passed",
        install: "passed",
        runtime: "passed",
        imports: "passed",
        private: "passed",
        types: "passed",
      },
      negatives: { source: "refused", parser: "refused", declarations: "refused", workspace: "refused" },
    };

    const report = {
      success: true,
      numFailedTests: 0,
      numFailedTestSuites: 0,
      testResults: [
        { name: `/checkout/${configConsumer}`, status: "passed", assertionResults: [{ status: "passed" }] },
      ],
    };

    expect(checkedConfig(receipt, archive, report, source, requested).sha256).toBe(receipt.sha256);

    const other = (value: string) => (value.startsWith("a") ? "b" : "a") + value.slice(1);

    expect(() =>
      checkedConfig(receipt, new TextEncoder().encode(content + "changed"), report, source, requested),
    ).toThrow();

    expect(() => checkedConfig({ ...receipt, source: other(source) }, archive, report, source, requested)).toThrow();

    expect(() =>
      checkedConfig({ ...receipt, requested: other(requested) }, archive, report, source, requested),
    ).toThrow();

    expect(() => checkedConfig({ ...receipt, archive: "different.tgz" }, archive, report, source, requested)).toThrow();

    expect(() => checkedConfig({ ...receipt, sha256: "invalid" }, archive, report, source, requested)).toThrow();

    expect(() => checkedConfig(receipt, archive, report, "not-a-commit", requested)).toThrow();

    expect(() => checkedConfig(receipt, archive, report, source, "not-a-commit")).toThrow();

    for (const stage of Object.keys(receipt.stages)) {
      expect(() =>
        checkedConfig(
          { ...receipt, stages: { ...receipt.stages, [stage]: "failed" } },
          archive,
          report,
          source,
          requested,
        ),
      ).toThrow();
    }

    for (const fault of Object.keys(receipt.negatives)) {
      expect(() =>
        checkedConfig(
          { ...receipt, negatives: { ...receipt.negatives, [fault]: "not-run" } },
          archive,
          report,
          source,
          requested,
        ),
      ).toThrow();
    }

    expect(() => checkedConfig(receipt, archive, { ...report, success: false }, source, requested)).toThrow();

    expect(() => checkedConfig(receipt, archive, { ...report, numFailedTests: 1 }, source, requested)).toThrow();

    expect(() => checkedConfig(receipt, archive, { ...report, numFailedTestSuites: 1 }, source, requested)).toThrow();

    expect(() => checkedConfig(receipt, archive, { ...report, testResults: [] }, source, requested)).toThrow();

    expect(() =>
      checkedConfig(
        receipt,
        archive,
        { ...report, testResults: [...report.testResults, ...report.testResults] },
        source,
        requested,
      ),
    ).toThrow();

    for (const status of ["failed", "skipped", "todo", "pending"]) {
      expect(() =>
        checkedConfig(
          receipt,
          archive,
          { ...report, testResults: [{ ...report.testResults[0], status }] },
          source,
          requested,
        ),
      ).toThrow();

      expect(() =>
        checkedConfig(
          receipt,
          archive,
          { ...report, testResults: [{ ...report.testResults[0], assertionResults: [{ status }] }] },
          source,
          requested,
        ),
      ).toThrow();
    }

    expect(() =>
      checkedConfig(
        receipt,
        archive,
        { ...report, testResults: [{ ...report.testResults[0], name: "next/other.integration.test.ts" }] },
        source,
        requested,
      ),
    ).toThrow();

    expect(() =>
      checkedConfig(
        receipt,
        archive,
        { ...report, testResults: [{ ...report.testResults[0], assertionResults: [] }] },
        source,
        requested,
      ),
    ).toThrow();
  },
  options,
);
