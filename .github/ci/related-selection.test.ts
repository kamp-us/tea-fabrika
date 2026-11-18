import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { expect, it } from "@effect/vitest";
import { Schema } from "effect";
import { projects } from "../../vitest.config.ts";
import { classify } from "./changes.mjs";
import { checklistCases, fixture, wanted } from "./plant-related.ts";
import { checkDelivery, checkFault, confirmed, delivered, outputs, select, type Sizing } from "./related.ts";

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
    expect(Object.keys(emitted)).toEqual(["run", "legs", "files", "projects", "plants", "archive", "consumer"]);

    expect(Object.keys(result).toSorted()).toEqual(["archive", "consumer", "legs", "plants", "projects"]);

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

// T1076 D1, D2 and D5. The delivery of the package's tested archive: P2 (kalfa/config/src/
// Package.integration.test.ts) builds, packs and installs it, and P1 (scripts/kalfa-config.test.ts) is
// the root tooling consumer. `--changed` cannot reach either by import, so the selector adds them by
// path and only after Vitest lists each in its own project. What the build must export from related.ts:
//   delivered(paths | null): boolean
//   confirmed(selected, listed, file, needed): string[]
//   select(...) (0598: no run number, no slots) also returns `archive` and `consumer`, a leg name or "", and outputs() prints both
//   checkDelivery({ event, draft, head, requested, folder, report }): Delivery   (the `--receipt` mode)
//   checkFault({ env, before, faulted, after, rerun }): Fault                     (the `--fault` mode)
// Plants for these laws are run after the build, since the names they break do not exist yet: drop the
// `kalfa/` rule, a route path or the discovery confirmation from `delivered` and `confirmed`; let
// `archive` name a tooling leg; accept the faults each case below lists.
const PACKAGE = "kalfa/config/src/Package.integration.test.ts";

const CONSUMER = "scripts/kalfa-config.test.ts";

// The paths whose change keeps the archive: the route that runs it.
const ROUTE = [
  ".github/ci/related.ts",
  ".github/workflows/check.yaml",
  ".github/ci/workflow-lint/related.ts",
  ".github/ci/workflow-lint/record.ts",
] as const;

const word = Schema.String.check(Schema.isPattern(/^[a-z]{1,8}$/));

const at = Schema.Int.check(Schema.isBetween({ minimum: 0, maximum: ROUTE.length - 1 }));

const Change = Schema.Struct({
  kind: Schema.Literals(["package", "readme", "dist", "route", "next", "docs", "ci", "script"]),
  word,
  at,
});

// A change a git diff can hold without being built output, for the run through a real repository.
const SourceChange = Schema.Struct({
  kind: Schema.Literals(["package", "readme", "route", "next", "docs", "ci", "script"]),
  word,
  at,
});

type Change = typeof Change.Type;

const pathOf = (change: Change): string => {
  switch (change.kind) {
    case "package":
      return `kalfa/config/src/${change.word}.ts`;
    case "readme":
      return "kalfa/config/README.md";
    case "dist":
      return `kalfa/config/dist/${change.word}.js`;
    case "route":
      return ROUTE[change.at]!;
    case "next":
      return `next/packages/libfabrika/src/${change.word}.ts`;
    case "docs":
      return `docs/${change.word}.md`;
    case "ci":
      return `.github/ci/other-${change.word}.ts`;
    case "script":
      return `scripts/other-${change.word}.ts`;
  }
};

// What keeps the archive, by construction: a package file other than a built one, or the route.
const keeps = (change: Change) => change.kind === "package" || change.kind === "readme" || change.kind === "route";

it.prop(
  "D1 the package and its delivery route select P2 and P1; built files, other paths and a known diff do not; unreadable history always does",
  { changes: Schema.NullOr(Schema.Array(Change).check(Schema.isMaxLength(8))), extra: Change },
  ({ changes, extra }) => {
    const paths = changes?.map(pathOf) ?? null;

    expect(delivered(paths)).toBe(changes === null || changes.some(keeps));

    // Coverage in every run: a package or route change always selects, and a list with none of them,
    // however long, never does, so both answers are reached whatever the generator drew.
    const delivering: Change = { ...extra, kind: keeps(extra) ? extra.kind : "package" };

    const quiet = (changes ?? []).filter((change) => !keeps(change));

    expect(delivered([...(changes ?? []).map(pathOf), pathOf(delivering)])).toBe(true);
    expect(delivered(quiet.map(pathOf))).toBe(false);
    expect(delivered(null)).toBe(true);
    expect(delivered([])).toBe(false);
  },
  options,
);

const match = createRequire(import.meta.resolve("vitest/package.json"))("picomatch");

/** Whether the configured Vitest project of that name runs the file, as Vitest's own matcher answers. */
const included = (name: string, file: string) => {
  const project = projects.find((candidate) => candidate.test.name === name);

  return (
    project !== undefined &&
    match.isMatch(file, project.test.include, { dot: true }) &&
    !match.isMatch(file, project.test.exclude, { dot: true })
  );
};

it.prop(
  "D1 the package's ordinary laws are in next alone, built files in no project, P2 in next-integration alone and P1 in tooling alone; a package path runs check and typecheck, never today's build, and no package Markdown is skipped",
  { word, event: Schema.Literals(["pull_request", "merge_group", "push"]) },
  ({ word, event }) => {
    for (const file of [`kalfa/config/src/${word}.test.ts`, "kalfa/config/src/App.test.ts"]) {
      expect(included("next", file), file).toBe(true);
      expect(included("next-integration", file), file).toBe(false);
      expect(included("tooling", file), file).toBe(false);
    }

    for (const file of [`kalfa/config/dist/${word}.test.ts`, `kalfa/config/dist/${word}.integration.test.ts`]) {
      for (const project of ["next", "next-integration", "tooling"]) {
        expect(included(project, file), `${project} ${file}`).toBe(false);
      }
    }

    expect(included("next-integration", PACKAGE)).toBe(true);
    expect(included("next", PACKAGE)).toBe(false);
    expect(included("tooling", PACKAGE)).toBe(false);
    expect(included("tooling", CONSUMER)).toBe(true);
    expect(included("next", CONSUMER)).toBe(false);
    expect(included("next-integration", CONSUMER)).toBe(false);

    for (const path of [`kalfa/config/src/${word}.ts`, "kalfa/config/README.md", `kalfa/config/${word}.md`]) {
      expect(classify([path], event), path).toMatchObject({ check: true, typecheck: true, build: false });
    }
  },
  options,
);

const emitted = (result: ReturnType<typeof select>) =>
  Object.fromEntries(
    outputs(result).map((line) => {
      const at = line.indexOf("=");

      return [line.slice(0, at), line.slice(at + 1)];
    }),
  );

it.prop(
  "D1 the selector adds P2 to exactly one integration leg and P1 to exactly one tooling leg, only after Vitest lists each alone, and prints seven outputs",
  {
    integration: Schema.Int.check(Schema.isBetween({ minimum: 0, maximum: 30 })),
    tooling: Schema.Int.check(Schema.isBetween({ minimum: 0, maximum: 30 })),
    needed: Schema.Boolean,
    other: word,
  },
  ({ integration, tooling, needed, other }) => {
    const ordinary = Array.from({ length: integration }, (_, index) => `next/a-${index}.integration.test.ts`);

    const scripts = Array.from({ length: tooling }, (_, index) => `.github/ci/a-${index}.test.ts`);

    // `confirmed` takes what Vitest listed for the one file in its own project, and adds it once.
    const withPackage = confirmed(ordinary, [PACKAGE], PACKAGE, needed);

    const withConsumer = confirmed(scripts, [CONSUMER], CONSUMER, needed);

    expect(withPackage).toEqual([...ordinary, ...(needed ? [PACKAGE] : [])].toSorted());
    expect(withConsumer).toEqual([...scripts, ...(needed ? [CONSUMER] : [])].toSorted());
    expect(
      confirmed([...ordinary, PACKAGE], [PACKAGE], PACKAGE, needed).filter((file) => file === PACKAGE),
    ).toHaveLength(1);

    // Not needed: what Vitest listed is not even read, so a wrong list cannot fail a run that skips it.
    expect(confirmed(ordinary, [], PACKAGE, false)).toEqual(ordinary.toSorted());
    expect(confirmed(ordinary, [`next/${other}.integration.test.ts`], PACKAGE, false)).toEqual(ordinary.toSorted());

    // Needed: a law Vitest did not find in that project, found elsewhere, or found with others fails the selector.
    for (const listed of [[], [`next/${other}.integration.test.ts`], [PACKAGE, `next/${other}.integration.test.ts`]]) {
      expect(() => confirmed(ordinary, listed, PACKAGE, true)).toThrow();
      expect(() => confirmed(scripts, listed, CONSUMER, true)).toThrow();
    }

    const result = select({ "next-integration": withPackage, tooling: withConsumer }, sizing);

    const all = Object.values(result.legs).flat();

    expect(all.toSorted()).toEqual([...withPackage, ...withConsumer].toSorted());
    expect(new Set(all).size).toBe(all.length);

    if (needed) {
      expect(Object.values(result.legs).filter((paths) => paths.includes(PACKAGE))).toHaveLength(1);
      expect(Object.values(result.legs).filter((paths) => paths.includes(CONSUMER))).toHaveLength(1);
      expect(result.projects[result.archive]).toBe("next-integration");
      expect(result.legs[result.archive]).toContain(PACKAGE);
      expect(result.projects[result.consumer]).toBe("tooling");
      expect(result.legs[result.consumer]).toContain(CONSUMER);
    } else {
      expect(result.archive).toBe("");
      expect(result.consumer).toBe("");
    }

    // Exactly the seven outputs (0598 took slots away), the two new ones as the owning leg or empty.
    const printed = emitted(result);

    expect(Object.keys(printed).toSorted()).toEqual([
      "archive",
      "consumer",
      "files",
      "legs",
      "plants",
      "projects",
      "run",
    ]);
    expect(printed["archive"]).toBe(result.archive);
    expect(printed["consumer"]).toBe(result.consumer);

    // Any other placement throws, and the nine-leg cap still does.
    expect(() => select({ "next-integration": [...ordinary, CONSUMER], tooling: scripts }, sizing)).toThrow();
    expect(() => select({ "next-integration": ordinary, tooling: [...scripts, PACKAGE] }, sizing)).toThrow();

    const heavy = (files: readonly string[]) => Object.fromEntries(files.map((file) => [file, 100]));

    const crowded = {
      "next-integration": [PACKAGE, ...Array.from({ length: 8 }, (_, i) => `next/h-${i}.integration.test.ts`)],
      tooling: [CONSUMER, ".github/ci/h-1.test.ts", ".github/ci/h-2.test.ts"],
    };

    expect(() =>
      select(crowded, {
        "next-integration": { most: 9, limit: 100 },
        tooling: { most: 3, limit: 100 },
        table: heavy([...crowded["next-integration"], ...crowded.tooling]),
      }),
    ).toThrow();
  },
  options,
);

// The selector as CI runs it, over a stand-in for `vitest list` that follows Vitest's own filter (a
// positional argument keeps the files whose path holds it, `--changed` the files the change reaches) and a
// real git repository for the change. Each run starts a process, so the count is small and every
// route is also held by a scenario below.
const INTEGRATION_READER = "next/apps/fabrika/src/settings-generated.integration.test.ts";

const STAND_IN = (node: string) => `#!${node}
const { readFileSync, writeFileSync } = require("node:fs");
const model = JSON.parse(readFileSync(process.env.STAND_IN_MODEL, "utf8"));
const args = process.argv.slice(2);
const project = args[args.indexOf("--project") + 1];
const out = args.find((arg) => arg.startsWith("--json=")).slice("--json=".length);
const changed = args.some((arg) => arg.startsWith("--changed="));
const filters = args
  .slice(args.indexOf("list") + 1)
  .filter((arg, i, all) => !arg.startsWith("--") && all[i - 1] !== "--project");
const files = (model.universe[project] ?? []).filter(
  (file) => (!changed || model.reach.includes(file)) && (filters.length === 0 || filters.some((filter) => file.includes(filter))),
);
writeFileSync(out, JSON.stringify(files.map((file) => ({ file: model.root + "/" + file }))));
`;

const ROOT = fileURLToPath(new URL("../../", import.meta.url)).replace(/\/$/, "");

const home = mkdtempSync(join(tmpdir(), "related-stand-in-"));

mkdirSync(join(home, "bin"));

writeFileSync(join(home, "bin", "pnpm"), STAND_IN(process.execPath));

chmodSync(join(home, "bin", "pnpm"), 0o755);

type Selected = {
  readonly changes: readonly Change[];
  readonly trigger: boolean;
  readonly hidden: "none" | "package" | "consumer";
  readonly reach: readonly boolean[];
};

/** Runs related.ts over a repository whose last commit changes these paths. */
const selectorRun = (given: Selected) => {
  const dir = mkdtempSync(join(tmpdir(), "related-repo-"));

  const git = (args: readonly string[]) => {
    const done = spawnSync(
      "git",
      ["-c", "user.name=ci", "-c", "user.email=ci@example.com", "-c", "commit.gpgsign=false", ...args],
      { cwd: dir, encoding: "utf8", env: { PATH: process.env["PATH"], HOME: dir, GIT_CONFIG_NOSYSTEM: "1" } },
    );

    expect(done.status, done.stderr).toBe(0);

    return done.stdout.trim();
  };

  git(["init", "-q", "-b", "main"]);
  writeFileSync(join(dir, "seed.txt"), "seed\n");
  git(["add", "."]);
  git(["commit", "-q", "-m", "base"]);

  const base = git(["rev-parse", "HEAD"]);

  const changed = [...new Set([...given.changes.map(pathOf), ...(given.trigger ? ["pnpm-lock.yaml"] : [])])];

  for (const path of changed) {
    mkdirSync(join(dir, path, ".."), { recursive: true });
    writeFileSync(join(dir, path), "x\n");
  }

  git(["add", "."]);
  git(["commit", "-q", "--allow-empty", "-m", "change"]);

  const head = git(["rev-parse", "HEAD"]);

  const integration = [
    ...(given.hidden === "package" ? [] : [PACKAGE]),
    INTEGRATION_READER,
    "next/packages/libfabrika/src/a.integration.test.ts",
    "next/packages/libfabrika/src/b.integration.test.ts",
  ];

  const tooling = [...(given.hidden === "consumer" ? [] : [CONSUMER]), ".github/ci/a.test.ts", ".github/ci/b.test.ts"];

  // What `--changed` reaches by import: ordinary files, never P2 or P1.
  const reachable = [...integration, ...tooling].filter(
    (file, i) =>
      file !== PACKAGE && file !== CONSUMER && file !== INTEGRATION_READER && given.reach[i % given.reach.length],
  );

  const out = join(dir, "out");

  const record = join(dir, "record.json");

  writeFileSync(
    join(dir, "model.json"),
    JSON.stringify({ root: ROOT, universe: { "next-integration": integration, tooling }, reach: reachable }),
  );

  const done = spawnSync(process.execPath, [fileURLToPath(new URL("./related.ts", import.meta.url))], {
    encoding: "utf8",
    env: {
      PATH: `${join(home, "bin")}:${process.env["PATH"]}`,
      HOME: dir,
      GIT_DIR: join(dir, ".git"),
      GIT_CONFIG_NOSYSTEM: "1",
      BASE: base,
      HEAD: head,
      MOST_INTEGRATION: "5",
      MOST_TOOLING: "2",
      LIMIT_INTEGRATION: "17",
      LIMIT_TOOLING: "30",
      RECORD: record,
      GITHUB_OUTPUT: out,
      STAND_IN_MODEL: join(dir, "model.json"),
    },
  });

  const lines = existsSync(out) ? readFileSync(out, "utf8").split("\n").filter(Boolean) : [];

  return { done, lines, integration, tooling, reachable, changed };
};

/** The selector's answer for a run, as the model says it must be. */
const expectSelector = (given: Selected) => {
  const run = selectorRun(given);

  const kinds = new Set(given.changes.map((change) => change.kind));

  const needed = given.trigger || given.changes.some(keeps);

  const hidden = (given.hidden === "package" || given.hidden === "consumer") && needed;

  if (hidden) {
    // A law Vitest cannot find in its project fails the selector, with no output for the jobs to read.
    expect(run.done.status).not.toBe(0);
    expect(run.lines).toEqual([]);

    return;
  }

  expect(run.done.status, run.done.stderr).toBe(0);

  const printed = Object.fromEntries(
    run.lines.map((line) => [line.slice(0, line.indexOf("=")), line.slice(line.indexOf("=") + 1)]),
  );

  const legs: Record<string, string> = JSON.parse(printed["files"]!);

  const projects: Record<string, string> = JSON.parse(printed["projects"]!);

  const at = (project: string) =>
    Object.entries(legs)
      .filter(([leg]) => projects[leg] === project)
      .flatMap(([, files]) => files.split(" ").filter(Boolean))
      .toSorted();

  // A package or next/ change adds the reader tests, which read the parser adapter under kalfa/config/src.
  const readers = given.trigger || kinds.has("next") || kinds.has("package") || kinds.has("readme");

  const full = given.trigger;

  const reached = (universe: readonly string[]) => universe.filter((file) => run.reachable.includes(file));

  expect(at("next-integration")).toEqual(
    [
      ...new Set([
        ...(full ? run.integration : reached(run.integration)),
        ...(readers ? [INTEGRATION_READER] : []),
        ...(needed ? [PACKAGE] : []),
      ]),
    ].toSorted(),
  );

  expect(at("tooling")).toEqual(
    [...new Set([...(full ? run.tooling : reached(run.tooling)), ...(needed ? [CONSUMER] : [])])].toSorted(),
  );

  expect(printed["archive"]).toBeDefined();
  expect(printed["consumer"]).toBeDefined();

  if (needed) {
    expect(legs[printed["archive"]!]?.split(" ")).toContain(PACKAGE);
    expect(projects[printed["archive"]!]).toBe("next-integration");
    expect(legs[printed["consumer"]!]?.split(" ")).toContain(CONSUMER);
    expect(projects[printed["consumer"]!]).toBe("tooling");
  } else {
    expect(printed["archive"]).toBe("");
    expect(printed["consumer"]).toBe("");
  }
};

it.prop(
  "D1 the selector, run as CI runs it, selects P2 and P1 exactly for a package or route change or a full run, adds the readers for a package change, and fails when Vitest cannot list one",
  {
    changes: Schema.Array(SourceChange).check(Schema.isMaxLength(5)),
    trigger: Schema.Boolean,
    hidden: Schema.Literals(["none", "package", "consumer"]),
    reach: Schema.Array(Schema.Boolean).check(Schema.isMinLength(1), Schema.isMaxLength(8)),
  },
  (given) => expectSelector(given),
  // Each run starts a process: a dozen runs, with the routes below each held once as a scenario.
  { arbitrary: { seed: 119120, runs: 12, size: 100 } },
);

const chosen = (kind: Change["kind"], extra: Partial<Selected> = {}): Selected => ({
  changes: [{ kind, word: "a", at: 0 }],
  trigger: false,
  hidden: "none",
  reach: [true, false],
  ...extra,
});

it.each([
  ["a package source change", chosen("package")],
  ["a package README change alone", chosen("readme")],
  ["a delivery route change", chosen("route", { changes: [{ kind: "route", word: "a", at: 1 }] })],
  ["a docs change, which keeps no archive", chosen("docs")],
  ["a next/ change, which adds the readers and no archive", chosen("next")],
  ["a rerun trigger, which runs everything and so both laws", chosen("docs", { trigger: true })],
  ["a package change whose P2 Vitest cannot list", chosen("package", { hidden: "package" })],
  ["a route change whose P1 Vitest cannot list", chosen("route", { hidden: "consumer" })],
  ["a docs change, whose missing P2 is never read", chosen("docs", { hidden: "package" })],
])("scenario: D1 the selector as CI runs it for %s", (_name, given) => expectSelector(given));

// D2. The receipt check judges what the integration step left: the event, the folder, the receipt P2
// wrote and the Vitest report of the same step. Only P2's own passing, unskipped result proves the four
// installed-copy refusals and the restored positive, so the receipt alone is never enough.
const sha = Schema.String.check(Schema.isPattern(/^[a-f][a-f0-9]{39}$/));

const hex = (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex");

const text = (value: string) => new TextEncoder().encode(value);

const other = (value: string) => (value.startsWith("a") ? "b" : "a") + value.slice(1);

const ARCHIVE = "kalfa-config-0.0.0.tgz";

const SUBPATHS = [
  "App",
  "Setting",
  "Sources",
  "Toml",
  "TomlParser",
  "Codec",
  "Files",
  "JsonSchema",
  "Reference",
  "Print",
  "Snapshot",
  "Load",
] as const;

const STAGES = ["build", "pack", "install", "runtime", "imports", "private", "types"] as const;

const REFUSALS = ["source", "parser", "declarations", "workspace"] as const;

type Plain = Record<string, any>;

type Given = {
  event: string | undefined;
  draft: string | undefined;
  head: string;
  requested: string;
  archive: Uint8Array;
  receipt: Plain;
  receiptBytes: Uint8Array | undefined;
  extra: Record<string, Uint8Array>;
  report: Plain;
};

const exportsOf = (): Plain => ({
  ...Object.fromEntries(
    SUBPATHS.map((name) => [`./${name}`, { types: `./dist/${name}.d.ts`, default: `./dist/${name}.js` }]),
  ),
  "./package.json": "./package.json",
});

const reportOf = (others: readonly string[]): Plain => ({
  success: true,
  numFailedTests: 0,
  numFailedTestSuites: 0,
  testResults: [
    ...others.map((name) => ({
      name: `/work/next/${name}.integration.test.ts`,
      status: "passed",
      assertionResults: [{ status: "passed" }],
    })),
    { name: `/work/${PACKAGE}`, status: "passed", assertionResults: [{ status: "passed" }, { status: "passed" }] },
  ],
});

const goodDelivery = (head: string, requested: string, content: string, others: readonly string[]): Given => {
  const archive = text(content);

  return {
    event: "pull_request",
    draft: "false",
    head,
    requested,
    archive,
    receipt: {
      source: head,
      requested,
      archive: ARCHIVE,
      sha256: hex(archive),
      versions: { node: "v26.0.0", pnpm: "11.0.0", npm: "11.0.0", compiler: "7.0.0" },
      exports: exportsOf(),
      stages: Object.fromEntries(STAGES.map((stage) => [stage, "passed"])),
      negatives: Object.fromEntries(REFUSALS.map((name) => [name, "refused"])),
    },
    receiptBytes: undefined,
    extra: {},
    report: reportOf(others),
  };
};

/** The folder the step reads: the archive and the receipt, as bytes, plus anything the case adds. */
const folderOf = (given: Given): Record<string, Uint8Array> => ({
  [ARCHIVE]: given.archive,
  "receipt.json": given.receiptBytes ?? text(`${JSON.stringify(given.receipt, null, 2)}\n`),
  ...given.extra,
});

type Refused = readonly (typeof reasons)[number][];

const reasons = [
  "event",
  "missing",
  "extra",
  "unreadable",
  "digest",
  "source",
  "requested",
  "stage",
  "exports",
  "result",
] as const;

/** One way to break a good delivery, and the reasons the check may give for it. */
type Case = readonly [
  name: string,
  reasons: Refused,
  mutate: (given: Given, folder: Record<string, Uint8Array>) => void,
];

const results = (given: Given): Plain[] => given.report["testResults"];

const p2 = (given: Given): Plain => results(given).find((entry) => entry["name"].endsWith(PACKAGE))!;

const refusals = (token: string): Case[] => [
  ...["push", "workflow_dispatch", "schedule", "", token].map((event): Case => [
    `the event is ${event || "empty"}`,
    ["event"],
    (given) => void (given.event = event),
  ]),
  ["the event is missing", ["event"], (given) => void (given.event = undefined)],
  ...["true", "", "False", undefined].map((draft): Case => [
    `a pull request whose draft is ${draft === undefined ? "missing" : JSON.stringify(draft)}`,
    ["event"],
    (given) => void (given.draft = draft),
  ]),
  ["the archive is missing", ["missing"], (_given, folder) => void delete folder[ARCHIVE]],
  ["the receipt is missing", ["missing"], (_given, folder) => void delete folder["receipt.json"]],
  [
    "the folder is empty",
    ["missing"],
    (_given, folder) => {
      for (const name of Object.keys(folder)) {
        delete folder[name];
      }
    },
  ],
  ["an extra file sits beside them", ["extra"], (_given, folder) => void (folder[`${token}.txt`] = text(token))],
  [
    "the archive has another name",
    ["missing", "extra"],
    (_given, folder) => {
      folder["kalfa-config-0.0.1.tgz"] = folder[ARCHIVE]!;
      delete folder[ARCHIVE];
    },
  ],
  ["the receipt is not JSON", ["unreadable"], (_given, folder) => void (folder["receipt.json"] = text(`{${token}`))],
  [
    "the archive bytes changed",
    ["digest"],
    (given, folder) => void (folder[ARCHIVE] = text(`${new TextDecoder().decode(given.archive)}!`)),
  ],
  [
    "the receipt names another digest",
    ["digest"],
    (given, folder) => {
      given.receipt["sha256"] = hex(text(`${new TextDecoder().decode(given.archive)}?`));
      folder["receipt.json"] = text(JSON.stringify(given.receipt));
    },
  ],
  [
    "the receipt's source is not the commit checked out",
    ["source"],
    (given, folder) => {
      given.receipt["source"] = other(given.head);
      folder["receipt.json"] = text(JSON.stringify(given.receipt));
    },
  ],
  [
    "the receipt's requested head is not the event's",
    ["requested"],
    (given, folder) => {
      given.receipt["requested"] = other(given.requested);
      folder["receipt.json"] = text(JSON.stringify(given.receipt));
    },
  ],
  [
    "source and requested are swapped",
    ["source", "requested"],
    (given, folder) => {
      given.receipt["source"] = given.requested;
      given.receipt["requested"] = given.head;
      folder["receipt.json"] = text(JSON.stringify(given.receipt));
    },
  ],
  ...STAGES.flatMap((stage): Case[] => [
    [
      `the ${stage} stage failed`,
      ["stage", "unreadable"],
      (given, folder) => {
        given.receipt["stages"][stage] = "failed";
        folder["receipt.json"] = text(JSON.stringify(given.receipt));
      },
    ],
    [
      `the ${stage} stage is not recorded`,
      ["stage", "unreadable"],
      (given, folder) => {
        delete given.receipt["stages"][stage];
        folder["receipt.json"] = text(JSON.stringify(given.receipt));
      },
    ],
  ]),
  ...REFUSALS.flatMap((name): Case[] => [
    [
      `the ${name} refusal did not happen`,
      ["stage", "unreadable"],
      (given, folder) => {
        given.receipt["negatives"][name] = "accepted";
        folder["receipt.json"] = text(JSON.stringify(given.receipt));
      },
    ],
    [
      `the ${name} refusal is not recorded`,
      ["stage", "unreadable"],
      (given, folder) => {
        delete given.receipt["negatives"][name];
        folder["receipt.json"] = text(JSON.stringify(given.receipt));
      },
    ],
  ]),
  ...["./App", "./Load", "./package.json"].map((key): Case => [
    `the export ${key} is gone`,
    ["exports", "unreadable"],
    (given, folder) => {
      delete given.receipt["exports"][key];
      folder["receipt.json"] = text(JSON.stringify(given.receipt));
    },
  ]),
  [
    "an export the package does not publish is listed",
    ["exports", "unreadable"],
    (given, folder) => {
      given.receipt["exports"]["./Extra"] = { types: "./dist/Extra.d.ts", default: "./dist/Extra.js" };
      folder["receipt.json"] = text(JSON.stringify(given.receipt));
    },
  ],
  [
    "P2 is not in the report",
    ["result", "unreadable"],
    (given) => void (given.report["testResults"] = results(given).filter((entry) => !entry["name"].endsWith(PACKAGE))),
  ],
  [
    "P2 is in the report twice",
    ["result", "unreadable"],
    (given) => void results(given).push(structuredClone(p2(given))),
  ],
  ...["failed", "skipped", "pending", "todo"].flatMap((status): Case[] => [
    [`P2's file result is ${status}`, ["result", "unreadable"], (given) => void (p2(given)["status"] = status)],
    [
      `one of P2's assertions is ${status}`,
      ["result", "unreadable"],
      (given) => void (p2(given)["assertionResults"][1]["status"] = status),
    ],
  ]),
  ["P2 ran no assertion", ["result", "unreadable"], (given) => void (p2(given)["assertionResults"] = [])],
  ["the report says it did not succeed", ["result", "unreadable"], (given) => void (given.report["success"] = false)],
  ["the report counts a failed test", ["result", "unreadable"], (given) => void (given.report["numFailedTests"] = 1)],
  [
    "the report counts a failed suite",
    ["result", "unreadable"],
    (given) => void (given.report["numFailedTestSuites"] = 1),
  ],
];

const input = (given: Given, folder: Record<string, Uint8Array>) => ({
  event: given.event,
  draft: given.draft,
  head: given.head,
  requested: given.requested,
  folder,
  report: given.report,
});

it.prop(
  "D2 the receipt check keeps only a ready or queue event, a folder of exactly the archive and receipt, a receipt whose digest, commits, stages, refusals and exports agree, and P2 once, passed and unskipped; every other delivery is refused for a named reason",
  {
    head: sha,
    requested: sha,
    content: Schema.String,
    token: word,
    others: Schema.Array(word).check(Schema.isMaxLength(3)),
  },
  ({ head, requested, content, token, others }) => {
    // Two different commits, as a merge commit and a pull request head are, even once shrunk.
    const good = goodDelivery(head, requested === head ? other(head) : requested, content, others);

    // Kept: a ready pull request, a queue group with its own draft value, and one commit named twice.
    for (const [event, draft] of [
      ["pull_request", "false"],
      ["merge_group", ""],
      ["merge_group", undefined],
    ] as const) {
      const made = structuredClone(good);
      const kept = checkDelivery(input({ ...made, event, draft }, folderOf(made)));

      expect(kept).toEqual({ _tag: "kept", sha256: hex(good.archive), source: head });
    }

    const same = goodDelivery(head, head, content, others);

    expect(checkDelivery(input(same, folderOf(same)))._tag).toBe("kept");

    // The one thing wrong in each refused delivery is the only difference from the kept one.
    for (const [name, allowed, mutate] of refusals(token)) {
      const given = structuredClone(good);
      given.archive = good.archive;

      const folder = folderOf(given);

      mutate(given, folder);

      const verdict = checkDelivery(input(given, folder));

      expect(verdict._tag, name).toBe("refused");
      expect(allowed, name).toContain(verdict._tag === "refused" ? verdict.reason : undefined);
    }
  },
  options,
);

// The same check as the step runs it: `node related.ts --receipt` reads RUNNER_TEMP's folder and report
// and the event from the environment. Each run starts a process, so a handful of runs.
it.prop(
  "D2 the receipt step exits 0 and prints the digest for a good delivery, and exits 1 for a digest, folder, event or requested-head fault",
  {
    head: sha,
    requested: sha,
    content: Schema.String,
    fault: Schema.Literals(["none", "digest", "extra", "push", "requested"]),
    others: Schema.Array(word).check(Schema.isMaxLength(2)),
  },
  ({ head, requested, content, fault, others }) => {
    const given = goodDelivery(head, requested, content, others);

    const temp = mkdtempSync(join(tmpdir(), "related-receipt-"));

    const folder = join(temp, "kalfa-config-package");

    mkdirSync(folder);
    writeFileSync(join(folder, ARCHIVE), fault === "digest" ? text(`${content}!`) : given.archive);
    writeFileSync(join(folder, "receipt.json"), JSON.stringify(given.receipt));
    writeFileSync(join(temp, "related.json"), JSON.stringify(given.report));

    if (fault === "extra") {
      writeFileSync(join(folder, "other.txt"), "x");
    }

    const done = spawnSync(process.execPath, [fileURLToPath(new URL("./related.ts", import.meta.url)), "--receipt"], {
      encoding: "utf8",
      env: {
        PATH: process.env["PATH"],
        HOME: temp,
        RUNNER_TEMP: temp,
        EVENT: fault === "push" ? "push" : "pull_request",
        DRAFT: "false",
        HEAD: head,
        REQUESTED: fault === "requested" ? other(requested) : requested,
      },
    });

    // The digest is printed for a kept delivery and for no other.
    expect(done.status, done.stderr).toBe(fault === "none" ? 0 : 1);
    expect(done.stdout.includes(hex(given.archive))).toBe(fault === "none");
  },
  { arbitrary: { seed: 119120, runs: 10, size: 100 } },
);

// D5. The fault decision: P1 is proven only when the faulted run fails for the export, the manifest's
// bytes come back unchanged, and the second run passes, unskipped. CI only.
const EXPORT = "@kalfa/config/App";

const P1 = `/work/${CONSUMER}`;

const verdict = (status: number, entries: readonly Plain[], more: Plain = {}) => ({
  status,
  report: {
    success: status === 0,
    numFailedTests: status === 0 ? 0 : 1,
    numFailedTestSuites: 0,
    testResults: entries,
    ...more,
  },
});

const passed = (): Plain => ({ name: P1, status: "passed", assertionResults: [{ status: "passed" }] });

type Words = { readonly before: string; readonly after: string; readonly a: string; readonly b: string };

/** A faulted run that failed on resolving the export, the reason written in the suite or in an assertion. */
const failedOnExport = (words: Words, inAssertion: boolean): Plain =>
  inAssertion
    ? {
        name: P1,
        status: "failed",
        message: "",
        assertionResults: [
          {
            status: "failed",
            failureMessages: [`${words.before} Failed to resolve "${EXPORT}" ${words.after}`],
          },
        ],
      }
    : {
        name: P1,
        status: "failed",
        message: `${words.before} Failed to resolve import "${EXPORT}" from "${CONSUMER}" ${words.after}`,
        assertionResults: [],
      };

const failedOnOther = (words: Words): Plain => ({
  name: P1,
  status: "failed",
  message: "",
  assertionResults: [
    { status: "failed", failureMessages: [`AssertionError: expected ${words.a} to equal ${words.b}`] },
  ],
});

const CI = { CI: "true", GITHUB_ACTIONS: "true" };

type Run = { status: number; report: unknown };

type FaultCase = readonly [
  name: string,
  reasons: readonly string[],
  mutate: (given: {
    env: Record<string, string | undefined>;
    before: Uint8Array;
    faulted: Run;
    after: Uint8Array;
    rerun: Run;
  }) => void,
];

const faultCases = (words: Words): FaultCase[] => [
  ...(
    [
      [{}],
      [{ CI: "true" }],
      [{ GITHUB_ACTIONS: "true" }],
      [{ CI: "1", GITHUB_ACTIONS: "true" }],
      [{ CI: "true", GITHUB_ACTIONS: "false" }],
      [{ CI: "", GITHUB_ACTIONS: "" }],
    ] as const
  ).map(([env]): FaultCase => [
    `the environment is ${JSON.stringify(env)}`,
    ["environment"],
    (given) => void (given.env = { ...env }),
  ]),
  ["the faulted run passed", ["not_red"], (given) => void (given.faulted = verdict(0, [passed()]))],
  [
    "the faulted run failed for another reason",
    ["wrong_reason"],
    (given) => void (given.faulted = verdict(1, [failedOnOther(words)])),
  ],
  [
    "the faulted run failed and P1 is not in its report",
    ["wrong_reason", "not_red"],
    (given) => void (given.faulted = verdict(1, [])),
  ],
  [
    "the faulted run failed elsewhere and P1 passed",
    ["wrong_reason", "not_red"],
    (given) =>
      void (given.faulted = verdict(1, [
        passed(),
        { name: "/work/other.test.ts", status: "failed", assertionResults: [] },
      ])),
  ],
  [
    "the manifest came back with other bytes",
    ["not_restored"],
    (given) => void (given.after = new TextEncoder().encode(`${new TextDecoder().decode(given.before)}#${words.a}`)),
  ],
  [
    "the manifest came back one byte longer",
    ["not_restored"],
    (given) => void (given.after = new Uint8Array([...given.before, 10])),
  ],
  ["the manifest did not come back", ["not_restored"], (given) => void (given.after = new Uint8Array())],
  ["the second run failed", ["not_green"], (given) => void (given.rerun = verdict(1, [failedOnExport(words, false)]))],
  [
    "the second run exited non-zero while its report shows P1 passed",
    ["not_green"],
    (given) => void (given.rerun = verdict(1, [passed()])),
  ],
  [
    "the second run exited zero with P1 failed",
    ["not_green"],
    (given) => void (given.rerun = verdict(0, [{ ...passed(), status: "failed" }])),
  ],
  ...["skipped", "todo", "pending"].map((status): FaultCase => [
    `the second run skipped P1 as ${status}`,
    ["not_green"],
    (given) => void (given.rerun = verdict(0, [{ name: P1, status, assertionResults: [{ status }] }])),
  ]),
  [
    "the second run ran no assertion of P1",
    ["not_green"],
    (given) => void (given.rerun = verdict(0, [{ name: P1, status: "passed", assertionResults: [] }])),
  ],
  ["the second run has no P1", ["not_green"], (given) => void (given.rerun = verdict(0, []))],
  ["the second run has P1 twice", ["not_green"], (given) => void (given.rerun = verdict(0, [passed(), passed()]))],
];

it.prop(
  "D5 the fault check proves P1 only when the faulted run fails for the export, the manifest's bytes are restored to the same digest and the second run passes unskipped, and only in CI",
  {
    manifest: Schema.String.check(Schema.isMinLength(1)),
    before: Schema.String,
    after: Schema.String,
    a: word,
    b: word,
  },
  ({ manifest, before, after, a, b }) => {
    const words: Words = { before, after, a, b };

    const bytes = text(manifest);

    const base = () => ({
      env: { ...CI } as Record<string, string | undefined>,
      before: bytes,
      faulted: verdict(1, [failedOnExport(words, false)]) as Run,
      after: new Uint8Array(bytes),
      rerun: verdict(0, [passed()]) as Run,
    });

    // Proven, whether the export's failure is written in the suite or in an assertion, and the digest
    // is of the manifest's own bytes.
    for (const inAssertion of [false, true]) {
      const given = { ...base(), faulted: verdict(1, [failedOnExport(words, inAssertion)]) };

      expect(checkFault(given)).toEqual({ _tag: "proven", digest: hex(bytes) });
    }

    // The one thing wrong in each refused case is the only difference from the proven one.
    for (const [name, allowed, mutate] of faultCases(words)) {
      const given = base();

      mutate(given);

      const decided = checkFault(given);

      expect(decided._tag, name).toBe("refused");
      expect(allowed, name).toContain(decided._tag === "refused" ? decided.reason : undefined);
    }
  },
  options,
);
