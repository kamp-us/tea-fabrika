import { expect, it } from "@effect/vitest";
import { Schema } from "effect";
import { outputs, run, select, type Sizing, wantsChecklistLaw } from "./related.ts";

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

/** Tooling files as `vitest list` gives them: `plain` plain laws and `real` that start a process. */
const toolingOf = (plain: number, real: number) => [
  ...Array.from({ length: plain }, (_, index) => `.github/ci/p-${index}.test.ts`),
  ...Array.from(
    { length: real },
    (_, index) => `.github/ci/workflow-lint/r-${index}.integration.test.${index % 2 === 0 ? "ts" : "tsx"}`,
  ),
];

// scenario: by the same call (0602), a tooling law that starts a process is an `.integration.` law
// and stays on the full run (0584). Run 44278795643 put
// `.github/ci/workflow-lint/scheduled.integration.test.ts`, which spawns a process, on a pull
// request's tooling leg. Plants, each run once on related.ts and restored: the merge line keeps
// tooling's `.integration.` files (red, they land on legs); every event drops them (red, a push keeps
// them no more).
it.prop(
  "a pull request or queue group runs tooling's plain laws alone, and any other event keeps its .integration. laws",
  {
    event: Schema.Literals(["pull_request", "merge_group", "push"]),
    plain: count,
    real: Schema.Int.check(Schema.isBetween({ minimum: 1, maximum: 10 })),
  },
  ({ event, plain, real }) => {
    const tooling = [...toolingOf(plain, real), ".github/ci/workflow-lint/scheduled.integration.test.ts"];

    const result = select(event, { "next-integration": () => [], tooling: () => tooling }, sizing);

    const ran = Object.values(result.legs).flat().toSorted();

    const merging = event !== "push";

    expect(ran).toEqual(tooling.filter((path) => !merging || !/\.integration\./.test(path)).toSorted());

    expect(ran.includes(".github/ci/workflow-lint/scheduled.integration.test.ts")).toBe(!merging);

    // Only plain files left: the related job skips when none is reached.
    expect(emittedBy(result)["run"]).toBe(String(merging ? plain > 0 : true));
  },
  options,
);

const HEAD = "a".repeat(40);

const BASE = "b".repeat(40);

/** The select step's variables as check.yaml's set step gives them, with `event` as the runner's. */
const envOf = (event: string, decoy: string) => ({
  GITHUB_EVENT_NAME: event,
  // A name a careless read could take for the event: the step must read the runner's own.
  EVENT: decoy,
  HEAD,
  BASE,
  MOST_INTEGRATION: "5",
  MOST_TOOLING: "2",
  LIMIT_INTEGRATION: "17",
  LIMIT_TOOLING: "30",
});

/** git as the select step asks it: the tested commit, the merge base and the change. */
const gitOf =
  (changed: readonly string[]) =>
  (args: readonly string[]): string => {
    const [command] = args;

    if (command === "rev-parse") {
      return HEAD;
    }

    if (command === "merge-base") {
      return BASE;
    }

    if (command === "diff") {
      return changed.join("\0");
    }

    throw new Error(`related test: git ${args.join(" ")} was not expected`);
  };

const Event = Schema.Literals(["pull_request", "merge_group", "push"]);

// scenario: the review of the build of 0602's merge line: a plant at related.ts's read of the event,
// `process.env["EVENT"]`, left every law green, since no law ran the step itself. This one runs it
// on its own env, git and list, with a decoy variable beside the runner's. Plants, each run once on
// related.ts and restored: `run` reads `env["EVENT"]` (red); reads `process.env["EVENT"]` (red);
// reads `process.env["GITHUB_EVENT_NAME"]` (red: the property's own event differs from the test
// process's).
it.prop(
  "the select step picks by the event the runner set in GITHUB_EVENT_NAME, and lists next-integration only off the merge line",
  { event: Event, decoy: Event, next: Schema.Boolean },
  ({ event, decoy, next }) => {
    const changed = [next ? "next/packages/a/src/b.ts" : ".github/ci/proof.ts", ".github/ci/related.ts"];

    const asked: string[][] = [];

    const integration = "next/packages/a/src/b.integration.test.ts";

    const tooling = [".github/ci/related-selection.test.ts", ".github/ci/workflow-lint/scheduled.integration.test.ts"];

    const { record, lines } = run({
      env: envOf(event, decoy),
      git: gitOf(changed),
      list: (args) => {
        asked.push([...args]);

        return args.includes("next-integration") ? [integration] : tooling;
      },
    });

    const merging = event !== "push";

    expect(record.event).toBe(event);

    expect(record.changed).toEqual(changed);

    // Off the merge line the next-integration list is asked for, the readers' too on a next/ change.
    expect(asked.filter((args) => args.includes("next-integration")).length).toBe(merging ? 0 : next ? 2 : 1);

    const ran = Object.values(record.legs).flat().toSorted();

    expect(ran).toEqual(merging ? [".github/ci/related-selection.test.ts"] : [...tooling, integration].toSorted());

    expect(lines[0]).toBe("run=true");
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
