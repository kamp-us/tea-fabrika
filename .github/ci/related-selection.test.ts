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
import { isTrigger } from "./legs.ts";
import {
  checkDelivery,
  checkFault,
  confirmed,
  consumerArgs,
  outputs,
  run,
  select,
  type Sizing,
  wantsChecklistLaw,
  wantsConsumerLaw,
} from "./related.ts";

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
    expect(Object.keys(emitted)).toEqual(["run", "legs", "files", "projects", "consumer"]);

    expect(Object.keys(result).toSorted()).toEqual(["consumer", "legs", "projects"]);

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
// request's tooling leg. The `tooling-integration` project now keeps such a file out of tooling's
// list; this holds the merge line to the name whatever a list gives. Plants, each run once on
// related.ts and restored: the merge line keeps tooling's `.integration.` files (red, they land on
// legs); every event drops them (red, a push keeps them no more).
it.prop(
  "a pull request or queue group drops every .integration. name from tooling's list, and any other event keeps the list whole",
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
// process's). The changed `.github/ci/related.ts` is on the fault's route, so P1 rides along, listed
// alone by the stand-in as Vitest lists it (T1076 D1).
it.prop(
  "the select step picks by the event the runner set in GITHUB_EVENT_NAME, and lists next-integration only off the merge line",
  { event: Event, decoy: Event, next: Schema.Boolean },
  ({ event, decoy, next }) => {
    const changed = [next ? "next/packages/a/src/b.ts" : ".github/ci/proof.ts", ".github/ci/related.ts"];

    const asked: string[][] = [];

    const integration = "next/packages/a/src/b.integration.test.ts";

    const tooling = [".github/ci/related-selection.test.ts", ".github/ci/workflow-lint/scheduled.integration.test.ts"];

    const consumer = "scripts/kalfa-config.test.ts";

    const { record, lines } = run({
      env: envOf(event, decoy),
      git: gitOf(changed),
      list: (args) => {
        asked.push([...args]);

        if (args.includes(consumer)) {
          return [consumer];
        }

        return args.includes("next-integration") ? [integration] : tooling;
      },
    });

    const merging = event !== "push";

    expect(record.event).toBe(event);

    expect(record.changed).toEqual(changed);

    // Off the merge line the next-integration list is asked for, the readers' too on a next/ change.
    expect(asked.filter((args) => args.includes("next-integration")).length).toBe(merging ? 0 : next ? 2 : 1);

    const ran = Object.values(record.legs).flat().toSorted();

    expect(ran).toEqual(
      merging
        ? [".github/ci/related-selection.test.ts", consumer].toSorted()
        : [...tooling, integration, consumer].toSorted(),
    );

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

// T1076 D1, D2 and D5, after decision 0602: the archive is kept by main's full run, not by a pull request.
// P1 (scripts/kalfa-config.test.ts) is the root tooling consumer and a plain law. `--changed` cannot reach it
// by import, so the selector adds it by path, and only after Vitest lists it alone in tooling. P2 (kalfa/
// config/src/Package.integration.test.ts) builds, packs and installs the package; it is an `.integration.`
// law, so it runs on main's full run alone and no selector adds it. On each numbered leg of that run the
// receipt step judges the leg's own report. What related.ts exports for these laws:
//   wantsConsumerLaw(paths | null): boolean
//   confirmed(selected, listed, file, needed): string[]
//   select(event, lists, sizing) also returns `consumer`, a tooling leg name or "", and outputs() prints it
//   checkDelivery({ ref, event, head, listed, folder, report }): Delivery   (the `--receipt` mode)
//   checkFault({ env, before, faulted, after, rerun }): Fault               (the `--fault` mode)
const PACKAGE = "kalfa/config/src/Package.integration.test.ts";

const CONSUMER = "scripts/kalfa-config.test.ts";

// The paths whose change keeps P1 in the run besides the package: the fault's route. The record guard
// left the route with decision 0602: it holds no delivery rule any more.
const ROUTE = [".github/ci/related.ts", ".github/workflows/check.yaml", ".github/ci/workflow-lint/related.ts"] as const;

const word = Schema.String.check(Schema.isPattern(/^[a-z]{1,8}$/));

const at = Schema.Int.check(Schema.isBetween({ minimum: 0, maximum: ROUTE.length - 1 }));

const Change = Schema.Struct({
  kind: Schema.Literals(["package", "readme", "dist", "route", "record", "next", "docs", "ci", "script"]),
  word,
  at,
});

// A change a git diff can hold without being built output, for the run through a real repository.
const SourceChange = Schema.Struct({
  kind: Schema.Literals(["package", "readme", "route", "record", "next", "docs", "ci", "script"]),
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
    case "record":
      return ".github/ci/workflow-lint/record.ts";
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

// What keeps P1, by construction: a package file other than a built one, or the fault's route.
const keeps = (change: Change) => change.kind === "package" || change.kind === "readme" || change.kind === "route";

// Plants, each run once on related.ts and restored: drop the `kalfa/` rule (red, a package change keeps
// nothing); drop one route path (red); put the record guard back in the route (red, the record change
// keeps P1); stop excluding built files (red, a dist change keeps P1).
it.prop(
  "D1 the package and the fault's route select P1; built files, the record guard, other paths and a known diff do not; unreadable history always does",
  { changes: Schema.NullOr(Schema.Array(Change).check(Schema.isMaxLength(8))), extra: Change },
  ({ changes, extra }) => {
    const paths = changes?.map(pathOf) ?? null;

    expect(wantsConsumerLaw(paths)).toBe(changes === null || changes.some(keeps));

    // Coverage in every run: a package or route change always selects, and a list with none of them,
    // however long, never does, so both answers are reached whatever the generator drew.
    const keeping: Change = { ...extra, kind: keeps(extra) ? extra.kind : "package" };

    const quiet = (changes ?? []).filter((change) => !keeps(change));

    expect(wantsConsumerLaw([...(changes ?? []).map(pathOf), pathOf(keeping)])).toBe(true);
    expect(wantsConsumerLaw(quiet.map(pathOf))).toBe(false);
    expect(wantsConsumerLaw(null)).toBe(true);
    expect(wantsConsumerLaw([])).toBe(false);

    // Every route path keeps P1 alone, and the record guard is no route.
    for (const route of ROUTE) {
      expect(wantsConsumerLaw([route]), route).toBe(true);
    }

    expect(wantsConsumerLaw([".github/ci/workflow-lint/record.ts", ".github/ci/workflow-lint/record.test.ts"])).toBe(
      false,
    );
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

// Plants, each run once on related.ts and restored: let `consumer` name the first leg of any project
// (red, a leg of another project); skip the discovery confirmation (red, a wrong list is accepted); drop
// the owner check (red, P1 in next-integration is accepted); print `archive` again (red, six outputs).
it.prop(
  "D1 the selector adds P1 to exactly one tooling leg, only after Vitest lists it alone, on no event adds P2, and prints five outputs",
  {
    event: Event,
    integration: Schema.Int.check(Schema.isBetween({ minimum: 0, maximum: 30 })),
    tooling: Schema.Int.check(Schema.isBetween({ minimum: 0, maximum: 30 })),
    needed: Schema.Boolean,
    other: word,
  },
  ({ event, integration, tooling, needed, other }) => {
    const ordinary = Array.from({ length: integration }, (_, index) => `next/a-${index}.integration.test.ts`);

    const scripts = Array.from({ length: tooling }, (_, index) => `.github/ci/a-${index}.test.ts`);

    // `confirmed` takes what Vitest listed for the one file in its own project, and adds it once.
    const withConsumer = confirmed(scripts, [CONSUMER], CONSUMER, needed);

    expect(withConsumer).toEqual([...scripts, ...(needed ? [CONSUMER] : [])].toSorted());
    expect(
      confirmed([...scripts, CONSUMER], [CONSUMER], CONSUMER, needed).filter((file) => file === CONSUMER),
    ).toHaveLength(1);

    // Not needed: what Vitest listed is not even read, so a wrong list cannot fail a run that skips it.
    expect(confirmed(scripts, [], CONSUMER, false)).toEqual(scripts.toSorted());
    expect(confirmed(scripts, [`.github/ci/${other}.test.ts`], CONSUMER, false)).toEqual(scripts.toSorted());

    // Needed: a law Vitest did not find in that project, found elsewhere, or found with others fails the selector.
    for (const listed of [[], [`.github/ci/${other}.test.ts`], [CONSUMER, `.github/ci/${other}.test.ts`]]) {
      expect(() => confirmed(scripts, listed, CONSUMER, true)).toThrow();
    }

    const result = select(event, { "next-integration": () => ordinary, tooling: () => withConsumer }, sizing);

    const all = Object.values(result.legs).flat();

    // The merge line lists no integration file at all (0602); any other event lists them. P2 is in neither.
    expect(all.toSorted()).toEqual([...(event === "push" ? ordinary : []), ...withConsumer].toSorted());
    expect(new Set(all).size).toBe(all.length);
    expect(all).not.toContain(PACKAGE);

    if (needed) {
      expect(Object.values(result.legs).filter((paths) => paths.includes(CONSUMER))).toHaveLength(1);
      expect(result.projects[result.consumer]).toBe("tooling");
      expect(result.legs[result.consumer]).toContain(CONSUMER);
    } else {
      expect(result.consumer).toBe("");
    }

    // Exactly the five outputs (0598 took slots away, 1569 took plants, 0602 took the archive), the new one
    // as the owning leg or empty.
    const printed = emitted(result);

    expect(Object.keys(printed).toSorted()).toEqual(["consumer", "files", "legs", "projects", "run"]);
    expect(printed["consumer"]).toBe(result.consumer);
    expect(Object.keys(result).toSorted()).toEqual(["consumer", "legs", "projects"]);

    // Any other placement throws, and the nine-leg cap still does.
    expect(() =>
      select("push", { "next-integration": () => [...ordinary, CONSUMER], tooling: () => scripts }, sizing),
    ).toThrow();

    const heavy = (files: readonly string[]) => Object.fromEntries(files.map((file) => [file, 100]));

    const crowded = {
      "next-integration": Array.from({ length: 9 }, (_, i) => `next/h-${i}.integration.test.ts`),
      tooling: [CONSUMER, ".github/ci/h-1.test.ts", ".github/ci/h-2.test.ts"],
    };

    expect(() =>
      select(
        "push",
        { "next-integration": () => crowded["next-integration"], tooling: () => crowded.tooling },
        {
          "next-integration": { most: 9, limit: 100 },
          tooling: { most: 3, limit: 100 },
          table: heavy([...crowded["next-integration"], ...crowded.tooling]),
        },
      ),
    ).toThrow();
  },
  options,
);

// Plants, each run once on related.ts and restored: add P2 by path again on any event (red, its list is
// asked for and it lands on a leg); stop adding P1 on the route (red, no consumer on a route change).
it.prop(
  "D1 the select step never asks for or adds P2 by path, on any event, whatever changed, and keeps P1 exactly when the package or the fault's route changed or the run is full",
  { event: Event, changes: Schema.Array(Change).check(Schema.isMaxLength(6)), extra: Change },
  ({ event, changes, extra }) => {
    // At least one package change in half the runs by construction, so both answers are reached.
    const drawn = [...changes, ...(extra.at % 2 === 0 ? [{ ...extra, kind: "package" as const }] : [])];

    const paths = [...new Set(drawn.map(pathOf))];

    const asked: string[][] = [];

    const integration = "next/packages/a/src/b.integration.test.ts";

    const { record } = run({
      env: envOf(event, "push"),
      git: gitOf(paths),
      list: (args) => {
        asked.push([...args]);

        // A list that would hand the selector P2 or P1 only if it asked for that file by path.
        if (args.includes(PACKAGE)) {
          return [PACKAGE];
        }

        if (args.includes(CONSUMER)) {
          return [CONSUMER];
        }

        return args.includes("next-integration") ? [integration] : [".github/ci/q.test.ts"];
      },
    });

    const full = paths.some(isTrigger);

    const wanted = full || drawn.some(keeps);

    expect(asked.filter((args) => args.includes(PACKAGE))).toEqual([]);
    expect(Object.values(record.legs).flat()).not.toContain(PACKAGE);

    expect(asked.filter((args) => args.includes(CONSUMER))).toHaveLength(wanted ? 1 : 0);
    expect(Object.values(record.legs).flat().includes(CONSUMER)).toBe(wanted);
    expect(record.consumer === "").toBe(!wanted);
    expect(record.consumer === "" ? "" : record.projects[record.consumer]).toBe(wanted ? "tooling" : "");
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
  readonly event: typeof Event.Type;
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

  // P2 is a next-integration file Vitest can list, unless the case hides it.
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
      GITHUB_EVENT_NAME: given.event,
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

  // Only a P1 Vitest cannot list fails the selector, with no output for the jobs to read. A P2 it cannot
  // list is no selector's business: the receipt of main's full run refuses it (D2).
  if (given.hidden === "consumer" && needed) {
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

  // The merge line lists no next-integration file at all (0602); P2 is listed only on a full run of the
  // other events, as any integration file is, and never added for a package change.
  expect(at("next-integration")).toEqual(
    given.event === "push"
      ? [
          ...new Set([
            ...(full ? run.integration : reached(run.integration)),
            ...(readers ? [INTEGRATION_READER] : []),
          ]),
        ].toSorted()
      : [],
  );

  expect(at("tooling")).toEqual(
    [...new Set([...(full ? run.tooling : reached(run.tooling)), ...(needed ? [CONSUMER] : [])])].toSorted(),
  );

  expect(Object.keys(printed).toSorted()).toEqual(["consumer", "files", "legs", "projects", "run"]);

  if (needed) {
    expect(legs[printed["consumer"]!]?.split(" ")).toContain(CONSUMER);
    expect(projects[printed["consumer"]!]).toBe("tooling");
  } else {
    expect(printed["consumer"]).toBe("");
  }
};

it.prop(
  "D1 the selector, run as CI runs it, selects P1 exactly for a package or route change or a full run, never P2 by path, adds the readers for a package change off the merge line, and fails when Vitest cannot list P1",
  {
    event: Event,
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
  event: "push",
  changes: [{ kind, word: "a", at: 0 }],
  trigger: false,
  hidden: "none",
  reach: [true, false],
  ...extra,
});

it.each([
  ["a package source change", chosen("package")],
  ["a package README change alone", chosen("readme")],
  ["a fault route change", chosen("route", { changes: [{ kind: "route", word: "a", at: 1 }] })],
  ["a record guard change, which is no route", chosen("record")],
  ["a docs change, which keeps no P1", chosen("docs")],
  ["a next/ change, which adds the readers and no P1", chosen("next")],
  ["a rerun trigger, which runs everything and so P1", chosen("docs", { trigger: true })],
  ["a package change on a pull request, which lists no integration file", chosen("package", { event: "pull_request" })],
  ["a route change in a queue group", chosen("route", { event: "merge_group" })],
  ["a package change whose P2 Vitest cannot list, which no selector reads", chosen("package", { hidden: "package" })],
  ["a route change whose P1 Vitest cannot list", chosen("route", { hidden: "consumer" })],
  ["a docs change, whose missing P1 is never read", chosen("docs", { hidden: "consumer" })],
])("scenario: D1 the selector as CI runs it for %s", (_name, given) => expectSelector(given));

// D2. The receipt check, on each numbered leg of main's full run, judges what that leg left: the run's ref
// and event, Vitest's listing of P2, the leg's own report and the delivery folder, if any. Only P2's own
// passing, unskipped result proves the four installed-copy refusals and the restored positive, so the
// receipt alone is never enough. The one leg that ran P2 keeps; the others prove P2 ran elsewhere.
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

const MAIN = "refs/heads/main";

/** The events of main's full run: a push, the hourly catch-up and a hand start. */
const KEEPING = ["push", "schedule", "workflow_dispatch"] as const;

type Plain = Record<string, any>;

type Given = {
  ref: string | undefined;
  event: string | undefined;
  head: string;
  listed: string[];
  archive: Uint8Array;
  receipt: Plain;
  folder: Record<string, Uint8Array> | null;
  report: Plain;
};

const exportsOf = (): Plain => ({
  ...Object.fromEntries(
    SUBPATHS.map((name) => [`./${name}`, { types: `./dist/${name}.d.ts`, default: `./dist/${name}.js` }]),
  ),
  "./package.json": "./package.json",
});

/** A leg's own report: the other laws it ran, and P2 when it is the one leg that ran it. */
const reportOf = (others: readonly string[], withPackage: boolean): Plain => ({
  success: true,
  numFailedTests: 0,
  numFailedTestSuites: 0,
  testResults: [
    ...others.map((name) => ({
      name: `/work/next/${name}.integration.test.ts`,
      status: "passed",
      assertionResults: [{ status: "passed" }],
    })),
    ...(withPackage
      ? [{ name: `/work/${PACKAGE}`, status: "passed", assertionResults: [{ status: "passed" }, { status: "passed" }] }]
      : []),
  ],
});

/** The one leg that ran P2: its folder of the archive and the receipt P2 wrote, both heads the run's commit. */
const goodDelivery = (event: string, head: string, content: string, others: readonly string[]): Given => {
  const archive = text(content);

  const receipt = {
    source: head,
    requested: head,
    archive: ARCHIVE,
    sha256: hex(archive),
    versions: { node: "v26.0.0", pnpm: "11.0.0", npm: "11.0.0", compiler: "7.0.0" },
    exports: exportsOf(),
    stages: Object.fromEntries(STAGES.map((stage) => [stage, "passed"])),
    negatives: Object.fromEntries(REFUSALS.map((name) => [name, "refused"])),
  };

  return {
    ref: MAIN,
    event,
    head,
    listed: [PACKAGE],
    archive,
    receipt,
    folder: { [ARCHIVE]: archive, "receipt.json": text(`${JSON.stringify(receipt, null, 2)}\n`) },
    report: reportOf(others, true),
  };
};

/** Any other numbered leg: P2 ran elsewhere, so no P2 in its report and no folder. */
const goodAbsent = (event: string, head: string, others: readonly string[]): Given => ({
  ...goodDelivery(event, head, "", others),
  folder: null,
  report: reportOf(others, false),
});

type Refused = readonly (typeof reasons)[number][];

const reasons = [
  "event",
  "discovery",
  "stray",
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
type Case = readonly [name: string, reasons: Refused, mutate: (given: Given) => void];

const results = (given: Given): Plain[] => given.report["testResults"];

const p2 = (given: Given): Plain => results(given).find((entry) => entry["name"].endsWith(PACKAGE))!;

/** Writes a changed receipt into the folder, as P2 would have written it. */
const rewrite = (given: Given, change: (receipt: Plain) => void) => {
  change(given.receipt);
  given.folder = { ...given.folder, "receipt.json": text(JSON.stringify(given.receipt)) };
};

const files = (given: Given): Record<string, Uint8Array> => given.folder!;

/** What refuses a leg whatever it holds: the run's ref and event, P2's listing and a report that failed. */
const everyLeg = (token: string): Case[] => [
  ...[
    "refs/heads/other",
    `refs/heads/${token}`,
    "refs/heads/main2",
    "refs/pull/1/merge",
    "refs/tags/main",
    "main",
    "",
  ].map((ref): Case => [`the ref is ${ref || "empty"}`, ["event"], (given) => void (given.ref = ref)]),
  ["the ref is missing", ["event"], (given) => void (given.ref = undefined)],
  ...["pull_request", "merge_group", "pull_request_target", "", token].map((event): Case => [
    `the event is ${event || "empty"}`,
    ["event"],
    (given) => void (given.event = event),
  ]),
  ["the event is missing", ["event"], (given) => void (given.event = undefined)],
  ["P2 is not listed in next-integration", ["discovery"], (given) => void (given.listed = [])],
  [
    "another file is listed in its place",
    ["discovery"],
    (given) => void (given.listed = [`kalfa/config/src/${token}.integration.test.ts`]),
  ],
  [
    "P2 is listed with another file",
    ["discovery"],
    (given) => void (given.listed = [PACKAGE, `next/${token}.test.ts`]),
  ],
  ["P2 is listed twice", ["discovery"], (given) => void (given.listed = [PACKAGE, PACKAGE])],
  ["the report is not a report", ["result"], (given) => void (given.report = { success: true })],
  ["the report says it did not succeed", ["result"], (given) => void (given.report["success"] = false)],
  ["the report counts a failed test", ["result"], (given) => void (given.report["numFailedTests"] = 1)],
  ["the report counts a failed suite", ["result"], (given) => void (given.report["numFailedTestSuites"] = 1)],
];

/** What P2 and its folder get wrong on the leg that ran it. */
const keeperRefusals = (token: string): Case[] => [
  ["P2's folder is missing", ["missing"], (given) => void (given.folder = null)],
  ["the archive is missing", ["missing"], (given) => void delete files(given)[ARCHIVE]],
  ["the receipt is missing", ["missing"], (given) => void delete files(given)["receipt.json"]],
  ["the folder is empty", ["missing"], (given) => void (given.folder = {})],
  ["an extra file sits beside them", ["extra"], (given) => void (files(given)[`${token}.txt`] = text(token))],
  [
    "the archive has another name",
    ["missing"],
    (given) => {
      files(given)["kalfa-config-0.0.1.tgz"] = files(given)[ARCHIVE]!;
      delete files(given)[ARCHIVE];
    },
  ],
  ["the receipt is not JSON", ["unreadable"], (given) => void (files(given)["receipt.json"] = text(`{${token}`))],
  [
    "the archive bytes changed",
    ["digest"],
    (given) => void (files(given)[ARCHIVE] = text(`${new TextDecoder().decode(given.archive)}!`)),
  ],
  [
    "the receipt names another digest",
    ["digest"],
    (given) =>
      rewrite(given, (receipt) => void (receipt["sha256"] = hex(text(`${new TextDecoder().decode(given.archive)}?`)))),
  ],
  [
    "the receipt's source is not the commit checked out",
    ["source"],
    (given) => rewrite(given, (receipt) => void (receipt["source"] = other(given.head))),
  ],
  [
    "the receipt's requested head is not the run's commit",
    ["requested"],
    (given) => rewrite(given, (receipt) => void (receipt["requested"] = other(given.head))),
  ],
  [
    "source and requested are both another commit",
    ["source"],
    (given) =>
      rewrite(given, (receipt) => {
        receipt["source"] = other(given.head);
        receipt["requested"] = other(given.head);
      }),
  ],
  ...STAGES.flatMap((stage): Case[] => [
    [
      `the ${stage} stage failed`,
      ["stage", "unreadable"],
      (given) => rewrite(given, (receipt) => void (receipt["stages"][stage] = "failed")),
    ],
    [
      `the ${stage} stage is not recorded`,
      ["stage", "unreadable"],
      (given) => rewrite(given, (receipt) => void delete receipt["stages"][stage]),
    ],
  ]),
  [
    "a stage no one asked for is recorded",
    ["stage", "unreadable"],
    (given) => rewrite(given, (receipt) => void (receipt["stages"]["extra"] = "passed")),
  ],
  [
    "a refusal no one asked for is recorded",
    ["stage", "unreadable"],
    (given) => rewrite(given, (receipt) => void (receipt["negatives"]["extra"] = "refused")),
  ],
  ...REFUSALS.flatMap((name): Case[] => [
    [
      `the ${name} refusal did not happen`,
      ["stage", "unreadable"],
      (given) => rewrite(given, (receipt) => void (receipt["negatives"][name] = "accepted")),
    ],
    [
      `the ${name} refusal is not recorded`,
      ["stage", "unreadable"],
      (given) => rewrite(given, (receipt) => void delete receipt["negatives"][name]),
    ],
  ]),
  ...["./App", "./Load", "./package.json"].map((key): Case => [
    `the export ${key} is gone`,
    ["exports", "unreadable"],
    (given) => rewrite(given, (receipt) => void delete receipt["exports"][key]),
  ]),
  [
    "an export the package does not publish is listed",
    ["exports", "unreadable"],
    (given) =>
      rewrite(
        given,
        (receipt) => void (receipt["exports"]["./Extra"] = { types: "./dist/Extra.d.ts", default: "./dist/Extra.js" }),
      ),
  ],
  [
    "P2 is not in the leg's report, though the folder is there",
    ["stray"],
    (given) => void (given.report["testResults"] = results(given).filter((entry) => !entry["name"].endsWith(PACKAGE))),
  ],
  ["P2 is in the report twice", ["result"], (given) => void results(given).push(structuredClone(p2(given)))],
  ...["failed", "skipped", "pending", "todo"].flatMap((status): Case[] => [
    [`P2's file result is ${status}`, ["result"], (given) => void (p2(given)["status"] = status)],
    [
      `one of P2's assertions is ${status}`,
      ["result"],
      (given) => void (p2(given)["assertionResults"][1]["status"] = status),
    ],
  ]),
  ["P2 ran no assertion", ["result"], (given) => void (p2(given)["assertionResults"] = [])],
];

/** What a leg that did not run P2 gets wrong. */
const absentRefusals = (token: string): Case[] => [
  [
    "a folder with the archive and receipt is there",
    ["stray"],
    (given) => void (given.folder = { [ARCHIVE]: text(token), "receipt.json": text("{}") }),
  ],
  ["an empty folder is there", ["stray"], (given) => void (given.folder = {})],
  ["a stray file is there", ["stray"], (given) => void (given.folder = { [`${token}.txt`]: text(token) })],
  [
    "P2 is in the report twice, with no folder",
    ["result"],
    (given) =>
      void (given.report["testResults"] = [
        ...results(given),
        ...Array.from({ length: 2 }, () => ({
          name: `/work/${PACKAGE}`,
          status: "passed",
          assertionResults: [{ status: "passed" }],
        })),
      ]),
  ],
  [
    "P2 failed in the report, with no folder",
    ["result"],
    (given) =>
      void (given.report["testResults"] = [
        ...results(given),
        { name: `/work/${PACKAGE}`, status: "failed", assertionResults: [{ status: "failed" }] },
      ]),
  ],
  [
    "P2 was skipped in the report, with no folder",
    ["result"],
    (given) =>
      void (given.report["testResults"] = [
        ...results(given),
        { name: `/work/${PACKAGE}`, status: "skipped", assertionResults: [{ status: "skipped" }] },
      ]),
  ],
];

const input = (given: Given) => ({
  ref: given.ref,
  event: given.event,
  head: given.head,
  listed: given.listed,
  folder: given.folder,
  report: given.report,
});

// Plants, each run once on related.ts and restored: accept a pull request or queue event (red), a branch
// ref (red), P2 missing from the listing (red); keep with a folder on a leg whose report has no P2, or
// keep with P2 in the report and no folder (red); a digest mismatch, `source` or `requested` other than the
// run's commit, a failed stage, a missing refusal, a skipped or duplicated P2 (each red); say `absent`
// for a leg with a folder, or without checking the listing (red).
it.prop(
  "D2 the receipt check keeps only on main's ref and a push, schedule or hand-start event, with P2 listed alone and passed once and a folder of exactly the archive and receipt whose digest and both commits agree; says absent only when the report holds no P2 and no folder is there; every other input is refused for a named reason",
  {
    head: sha,
    content: Schema.String,
    token: word,
    others: Schema.Array(word).check(Schema.isMaxLength(3)),
    event: Schema.Literals(KEEPING),
  },
  ({ head, content, token, others, event }) => {
    // Kept on every event of the full run, with `source` and `requested` both the run's commit.
    for (const each of KEEPING) {
      const good = goodDelivery(each, head, content, others);

      expect(checkDelivery(input(good))).toEqual({ _tag: "kept", sha256: hex(good.archive), source: head });

      expect(checkDelivery(input(goodAbsent(each, head, others)))).toEqual({ _tag: "absent" });
    }

    // The one thing wrong in each refused delivery is the only difference from the kept (or absent) one.
    const refuse = (good: Given, cases: readonly Case[]) => {
      for (const [name, allowed, mutate] of cases) {
        const given = structuredClone(good);

        mutate(given);

        const verdict = checkDelivery(input(given));

        expect(verdict._tag, name).toBe("refused");
        expect(allowed, name).toContain(verdict._tag === "refused" ? verdict.reason : undefined);
      }
    };

    refuse(goodDelivery(event, head, content, others), [...everyLeg(token), ...keeperRefusals(token)]);

    refuse(goodAbsent(event, head, others), [...everyLeg(token), ...absentRefusals(token)]);
  },
  options,
);

// The same check as the step runs it: `node related.ts --receipt` reads RUNNER_TEMP's folder and report,
// lists P2 through Vitest (the stand-in above) and reads the runner's own ref, event and commit. A decoy
// variable sits beside each, so a step that read a name a workflow could set would fail. Each run starts a
// process, so a handful of runs. Plants, each run once on related.ts and restored: read `process.env.HEAD`
// for the commit (red); read `process.env.EVENT` for the event (red); print kept=true for a leg with no
// folder (red).
it.prop(
  "D2 the receipt step, run as a leg runs it, exits 0 and prints kept=true with the digest for the keeping leg, exits 0 and prints kept=false for another leg, and exits 1 printing no kept for any refusal",
  {
    head: sha,
    content: Schema.String,
    leg: Schema.Literals(["keeper", "absent", "digest", "extra", "stray", "event", "ref", "discovery"]),
    event: Schema.Literals(KEEPING),
    others: Schema.Array(word).check(Schema.isMaxLength(2)),
  },
  ({ head, content, leg, event, others }) => {
    const given =
      leg === "absent" || leg === "stray"
        ? goodAbsent(event, head, others)
        : goodDelivery(event, head, content, others);

    const temp = mkdtempSync(join(tmpdir(), "related-receipt-"));

    const folder = join(temp, "kalfa-config-package");

    if (given.folder !== null || leg === "stray") {
      mkdirSync(folder);
    }

    if (given.folder !== null) {
      writeFileSync(join(folder, ARCHIVE), leg === "digest" ? text(`${content}!`) : given.archive);
      writeFileSync(join(folder, "receipt.json"), JSON.stringify(given.receipt));
    }

    if (leg === "extra" || leg === "stray") {
      writeFileSync(join(folder, "other.txt"), "x");
    }

    writeFileSync(join(temp, "results.json"), JSON.stringify(given.report));

    writeFileSync(
      join(temp, "model.json"),
      JSON.stringify({
        root: ROOT,
        universe: { "next-integration": leg === "discovery" ? [INTEGRATION_READER] : [PACKAGE, INTEGRATION_READER] },
        reach: [],
      }),
    );

    const out = join(temp, "out");

    const done = spawnSync(process.execPath, [fileURLToPath(new URL("./related.ts", import.meta.url)), "--receipt"], {
      encoding: "utf8",
      env: {
        PATH: `${join(home, "bin")}:${process.env["PATH"]}`,
        HOME: temp,
        RUNNER_TEMP: temp,
        GITHUB_REF: leg === "ref" ? "refs/heads/other" : MAIN,
        GITHUB_EVENT_NAME: leg === "event" ? "pull_request" : event,
        GITHUB_SHA: head,
        GITHUB_OUTPUT: out,
        STAND_IN_MODEL: join(temp, "model.json"),
        // Names a workflow could set: the step reads the runner's own and none of these.
        EVENT: "pull_request",
        HEAD: other(head),
        REQUESTED: other(head),
      },
    });

    const printed = existsSync(out) ? readFileSync(out, "utf8").split("\n").filter(Boolean) : [];

    const kept = leg === "keeper";

    const passed = kept || leg === "absent";

    expect(done.status, done.stderr).toBe(passed ? 0 : 1);

    // The digest is printed for a kept delivery and for no other; the output says kept or not kept, and
    // a refusal prints none.
    expect(done.stdout.includes(hex(given.archive))).toBe(kept);
    expect(printed).toEqual(kept ? ["kept=true"] : leg === "absent" ? ["kept=false"] : []);
  },
  { arbitrary: { seed: 119120, runs: 16, size: 100 } },
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

// D5, the runner's side. The tooling step has just run P1 in the tree, which fills Vitest 5.0.5's file-system
// module cache; a faulted run that read it would reuse the cached resolution of `@kalfa/config/App`, pass,
// and be refused as not_red though the fault was real (CI run 44228243314). So both P1 runs of the fault mode
// turn the cache off, spelled as the installed CLI lists it (cac chunk, `fsModuleCache`). Plant: drop the flag.
it.prop(
  "D5 each P1 run of the fault mode is the one consumer file in the tooling project, with the module cache off and its report written where asked",
  { out: word, run: Schema.Literals(["faulted", "rerun"]) },
  ({ out, run }) => {
    const args = consumerArgs(`/scratch/${out}/${run}.json`);

    expect(args.slice(0, 6)).toEqual(["exec", "vitest", "run", "--project", "tooling", CONSUMER]);
    expect(args).toContain("--fsModuleCache=false");
    expect(args.filter((arg) => arg.startsWith("--fsModuleCache"))).toHaveLength(1);
    expect(args).toContain("--reporter=json");
    expect(args).toContain(`--outputFile.json=/scratch/${out}/${run}.json`);
    expect(args.filter((arg) => !arg.startsWith("--")).filter((arg) => arg.endsWith(".test.ts"))).toEqual([CONSUMER]);
  },
  options,
);
