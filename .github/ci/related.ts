// Today's CI, both versions. The missing projects of an automatic PR/queue check; next and visual
// remain on the existing next matrix. A selector error fails the required check, never means zero.
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { appendFileSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { Schema } from "effect";
import { rowsAt } from "../../vitest.shards.ts";
import { configPath, readers, validSha } from "./changes.mjs";
import { E2E_SETUP, list, room, withReaders } from "./legs.ts";
import type { Request } from "./plant-cases.ts";
import { checklistCases, fixture, wanted } from "./plant-related.ts";
import { isTrigger, legsOf, slots, whole } from "./proof.ts";

export const configConsumer = "kalfa/config/src/Package.integration.test.ts";

/** Config delivery is automatic on a ready pull request or the protected merge queue. */
export const configEvent = (event: string | undefined, draft: string | undefined): boolean =>
  event === "merge_group" || (event === "pull_request" && draft === "false");

/** Add the real package consumer only after Vitest confirms it exists in the integration project. */
export const withConfig = (selected: readonly string[], discovered: readonly string[], needed: boolean): string[] => {
  if (needed && (discovered.length !== 1 || discovered[0] !== configConsumer)) {
    throw new Error("related: config consumer must be discovered in the existing integration project");
  }

  return withReaders(selected, needed ? discovered : []);
};

const Receipt = Schema.Struct({
  source: Schema.String,
  requested: Schema.String,
  archive: Schema.Literal("kalfa-config-0.0.0.tgz"),
  sha256: Schema.String.check(Schema.isPattern(/^[a-f0-9]{64}$/)),
  versions: Schema.Struct({ node: Schema.String, pnpm: Schema.String, npm: Schema.String, compiler: Schema.String }),
  exports: Schema.Record(Schema.String, Schema.Unknown),
  stages: Schema.Struct({
    build: Schema.Literal("passed"),
    pack: Schema.Literal("passed"),
    install: Schema.Literal("passed"),
    runtime: Schema.Literal("passed"),
    imports: Schema.Literal("passed"),
    private: Schema.Literal("passed"),
    types: Schema.Literal("passed"),
  }),
  negatives: Schema.Struct({
    source: Schema.Literal("refused"),
    parser: Schema.Literal("refused"),
    declarations: Schema.Literal("refused"),
    workspace: Schema.Literal("refused"),
  }),
});

const Results = Schema.Struct({
  success: Schema.Literal(true),
  numFailedTests: Schema.Literal(0),
  numFailedTestSuites: Schema.Literal(0),
  testResults: Schema.Array(
    Schema.Struct({
      name: Schema.String,
      status: Schema.String,
      assertionResults: Schema.Array(Schema.Struct({ status: Schema.String })),
    }),
  ),
});

/** Verify the delivered bytes against the consumer's own receipt and the successful test report. */
export const checkedConfig = (
  receipt: unknown,
  archive: Uint8Array,
  results: unknown,
  source: string,
  requested: string,
) => {
  const value = Schema.decodeUnknownSync(Receipt)(receipt);

  const report = Schema.decodeUnknownSync(Results)(results);

  const consumers = report.testResults.filter(
    (file) => file.name.replaceAll("\\", "/").endsWith(`/${configConsumer}`) || file.name === configConsumer,
  );

  if (!validSha(source) || !validSha(requested) || value.source !== source || value.requested !== requested) {
    throw new Error("related: config receipt must name the actual checkout and requested head separately");
  }

  if (value.sha256 !== createHash("sha256").update(archive).digest("hex")) {
    throw new Error("related: config archive differs from the tested receipt digest");
  }

  const consumer = consumers[0];

  if (
    consumers.length !== 1 ||
    consumer === undefined ||
    consumer.status !== "passed" ||
    consumer.assertionResults.length === 0 ||
    consumer.assertionResults.some((test) => test.status !== "passed")
  ) {
    throw new Error("related: config upload requires the successful, unskipped consumer result");
  }

  return value;
};

const PROJECTS = ["next-integration", "tooling"] as const;

type Project = (typeof PROJECTS)[number];

export type Sizing = Readonly<Record<Project, { readonly most: number; readonly limit: number }>> & {
  readonly table: Readonly<Record<string, number>>;
};

/** Separate project legs keep their existing full-depth counts and test-step limits. */

export const select = (
  files: Readonly<Record<Project, readonly string[]>>,
  sizing: Sizing,
  run: number,
  plants = false,
) => {
  const groups = slots(run);

  const all = PROJECTS.flatMap((project) => files[project]);

  if (all.some((path) => /\s/.test(path)) || new Set(all).size !== all.length) {
    throw new Error("related: selected files must be distinct paths without whitespace");
  }

  const legs: Record<string, readonly string[]> = {};

  const projects: Record<string, Project> = {};

  for (const project of PROJECTS) {
    const split = legsOf(files[project], { ...sizing[project], table: sizing.table });

    for (const paths of Object.values(split)) {
      const name = String(Object.keys(legs).length + 1);
      legs[name] = paths;
      projects[name] = project;
    }
  }

  if (Object.keys(legs).length > 9) {
    throw new Error("related: the existing nine shared test groups cannot hold this selection");
  }

  const owners = Object.entries(legs).filter(
    ([leg, paths]) => projects[leg] === "next-integration" && paths.includes(fixture),
  );

  if (plants && owners.length !== 1) {
    throw new Error("related: checklist faults need exactly one owning integration leg");
  }

  const integration = Object.keys(legs).filter((leg) => projects[leg] === "next-integration");

  const assignment: Record<string, readonly Request["case"][]> = plants
    ? Object.fromEntries(
        integration.map((leg, offset) => [
          leg,
          checklistCases.filter((_, index) => index % integration.length === offset),
        ]),
      )
    : {};

  if (
    plants &&
    (Object.values(assignment).flat().length !== 10 || new Set(Object.values(assignment).flat()).size !== 10)
  ) {
    throw new Error("related: every checklist case must have exactly one existing integration leg");
  }

  const config = Object.fromEntries(
    Object.entries(legs)
      .filter(([leg, paths]) => projects[leg] === "next-integration" && paths.includes(configConsumer))
      .map(([leg]) => [leg, true]),
  );

  if (all.includes(configConsumer) && Object.keys(config).length !== 1) {
    throw new Error("related: config consumer must have one integration owner");
  }

  return { legs, projects, slots: groups, plants: assignment, config };
};

export const outputs = (selection: ReturnType<typeof select>): string[] => [
  `run=${Object.keys(selection.legs).length > 0}`,
  `legs=${JSON.stringify(Object.keys(selection.legs))}`,
  `files=${JSON.stringify(Object.fromEntries(Object.entries(selection.legs).map(([leg, paths]) => [leg, paths.join(" ")])))}`,
  `projects=${JSON.stringify(selection.projects)}`,
  `slots=${JSON.stringify(selection.slots)}`,
  `plants=${JSON.stringify(selection.plants)}`,
  `config=${JSON.stringify(selection.config)}`,
];

if (import.meta.main && process.argv[2] === "--config") {
  const directory = process.env["RUNNER_TEMP"];

  const source = process.env["HEAD"];

  const requested = process.env["REQUESTED"];

  if (!directory || !source || !requested) {
    throw new Error("related: config verification requires the runner directory, tested commit and requested head");
  }

  if (!configEvent(process.env["EVENT"], process.env["DRAFT"])) {
    throw new Error("related: config delivery requires a ready pull request or protected merge queue event");
  }

  const decodeJson = Schema.decodeUnknownSync(Schema.fromJsonString(Schema.Unknown));

  checkedConfig(
    decodeJson(readFileSync(join(directory, "kalfa-config-package/receipt.json"), "utf8")),
    readFileSync(join(directory, "kalfa-config-package/kalfa-config-0.0.0.tgz")),
    decodeJson(readFileSync(join(directory, "related.json"), "utf8")),
    source,
    requested,
  );

  console.log("related: exact tested config archive and receipt verified");
} else if (import.meta.main) {
  const run = whole("RUN_NUMBER", process.env["RUN_NUMBER"]);
  slots(run);

  const root = fileURLToPath(new URL("../../", import.meta.url));

  const git = (args: readonly string[]): string => {
    const result = spawnSync("git", args, { cwd: root, encoding: "utf8" });

    if (result.status !== 0) {
      throw new Error(`related: git ${args.join(" ")} exited ${result.status}`);
    }

    return result.stdout.trim();
  };

  const head = git(["rev-parse", "--verify", "HEAD^{commit}"]);

  const expected = process.env["HEAD"];

  if (!validSha(head) || head !== expected) {
    throw new Error("related: checkout HEAD must equal this check's tested commit");
  }

  const from = process.env["BASE"];

  const base = from !== undefined && validSha(from) ? git(["merge-base", from, head]) : null;

  const changed =
    base === null
      ? null
      : git(["diff", "--name-only", "-z", `${base}...${head}`])
          .split("\0")
          .filter(Boolean);

  const triggers = changed?.filter(isTrigger) ?? [];

  const full = changed === null || triggers.length > 0;

  const narrowed = !full && base !== null ? [`--changed=${base}`] : [];

  const integration = list(root, ["--project", "next-integration", ...narrowed]);

  const plants = wanted(changed);

  const configNeeded = full || changed?.some(configPath) === true;

  const configFiles = configNeeded ? list(root, ["--project", "next-integration", configConsumer]) : [];

  const files = {
    "next-integration": withConfig(
      withReaders(integration, [
        ...(!full && changed?.some((path) => path.startsWith("next/") || path.startsWith("kalfa/"))
          ? list(root, ["--project", "next-integration", ...readers])
          : []),
        ...(plants ? [fixture] : []),
      ]),
      configFiles,
      configNeeded,
    ),
    tooling: list(root, ["--project", "tooling", ...narrowed]),
  };

  const sizing: Sizing = {
    "next-integration": {
      most: whole("MOST_INTEGRATION", process.env["MOST_INTEGRATION"]),
      limit: room(whole("LIMIT_INTEGRATION", process.env["LIMIT_INTEGRATION"]), E2E_SETUP),
    },
    tooling: {
      most: whole("MOST_TOOLING", process.env["MOST_TOOLING"]),
      limit: room(whole("LIMIT_TOOLING", process.env["LIMIT_TOOLING"]), E2E_SETUP),
    },
    table: rowsAt("full"),
  };

  const selected = select(files, sizing, run, plants);

  const lines = outputs(selected);

  const record = { base, head, at: new Date().toISOString(), changed, triggers, full, ...selected };

  const target = process.env["RECORD"];

  if (target) {
    writeFileSync(target, `${JSON.stringify(record, null, 2)}\n`);
  }

  console.log(JSON.stringify(record));
  console.log(lines.join("\n"));

  const output = process.env["GITHUB_OUTPUT"];

  if (output) {
    appendFileSync(output, `${lines.join("\n")}\n`);
  }
}
