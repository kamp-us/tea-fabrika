// Today's CI, both versions. The missing projects of an automatic PR/queue check; next and visual
// remain on the existing next matrix. A selector error fails the required check, never means zero.
import { spawnSync } from "node:child_process";
import { appendFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { rowsAt } from "../../vitest.shards.ts";
import { readers, validSha } from "./changes.mjs";
import { E2E_SETUP, list, room, withReaders } from "./legs.ts";
import type { Request } from "./plant-cases.ts";
import { checklistCases, fixture, wanted } from "./plant-related.ts";
import { isTrigger, legsOf, whole } from "./proof.ts";

const PROJECTS = ["next-integration", "tooling"] as const;

type Project = (typeof PROJECTS)[number];

export type Sizing = Readonly<Record<Project, { readonly most: number; readonly limit: number }>> & {
  readonly table: Readonly<Record<string, number>>;
};

/** Separate project legs keep their existing full-depth counts and test-step limits. */

export const select = (files: Readonly<Record<Project, readonly string[]>>, sizing: Sizing, plants = false) => {
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
    throw new Error("related: the selection must fit check.yaml's related max-parallel of nine legs");
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

  return { legs, projects, plants: assignment };
};

export const outputs = (selection: ReturnType<typeof select>): string[] => [
  `run=${Object.keys(selection.legs).length > 0}`,
  `legs=${JSON.stringify(Object.keys(selection.legs))}`,
  `files=${JSON.stringify(Object.fromEntries(Object.entries(selection.legs).map(([leg, paths]) => [leg, paths.join(" ")])))}`,
  `projects=${JSON.stringify(selection.projects)}`,
  `plants=${JSON.stringify(selection.plants)}`,
];

if (import.meta.main) {
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

  const files = {
    "next-integration": withReaders(integration, [
      ...(!full && changed?.some((path) => path.startsWith("next/"))
        ? list(root, ["--project", "next-integration", ...readers])
        : []),
      ...(plants ? [fixture] : []),
    ]),
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

  const selected = select(files, sizing, plants);

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
