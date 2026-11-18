// Today's CI, both versions. The missing projects of an automatic PR/queue check; next and visual
// remain on the existing next matrix. A pull request and a queue group pick tooling alone: the
// `next-integration` laws run on main's full run (scheduled.yaml, on a push to main and hourly,
// 0581) and a branch's proof run (0590), never on a pull request or a queue group (`projectsOf`).
// A selector error fails the required check, never means zero.
import { spawnSync } from "node:child_process";
import { appendFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { rowsAt } from "../../vitest.shards.ts";
import { readers, validSha } from "./changes.mjs";
import { E2E_SETUP, list, room, withReaders } from "./legs.ts";
import { isTrigger, legsOf, whole } from "./proof.ts";

const PROJECTS = ["next-integration", "tooling"] as const;

const checklistFixture = "next/apps/fabrika/src/checklist-instance.laws.integration.test.ts";

type Project = (typeof PROJECTS)[number];

export type Sizing = Readonly<Record<Project, { readonly most: number; readonly limit: number }>> & {
  readonly table: Readonly<Record<string, number>>;
};

/**
 * Keep the existing product law in the ordinary related run when its former plant inputs change.
 * It is a `next-integration` file, so only a run that picks that project runs it (`projectsOf`); on
 * a pull request or a queue group it waits for main's full run like every other integration law.
 */
export const wantsChecklistLaw = (paths: readonly string[] | null): boolean =>
  paths === null ||
  paths.some(
    (path) =>
      path === checklistFixture ||
      /^\.github\/ci\/plant(?:-cases|-errors|-machine|-reporter|-related)?\.ts$/.test(path),
  );

/**
 * The projects a related run picks from, by the GitHub event that started it. A pull request and a
 * merge queue group pick tooling alone: the owner moved the `next-integration` laws back to main's
 * full run on 2026-11-18, after real-resource laws failed about a dozen of that night's pull
 * request and queue runs on code those changes never touched (0536's rule). Any other event, which
 * in check.yaml is a push to main whose changes job failed, picks both, as before.
 */
const projectsOf = (event: string | undefined): readonly Project[] =>
  event === "pull_request" || event === "merge_group" ? ["tooling"] : PROJECTS;

/** Each project's files, asked for only when the run picks that project, so a skipped one is never listed. */
type Lists = Readonly<Record<Project, () => readonly string[]>>;

/** Separate project legs keep their existing full-depth counts and test-step limits. */

export const select = (event: string | undefined, lists: Lists, sizing: Sizing) => {
  const picked = projectsOf(event).map((project) => [project, lists[project]()] as const);

  const all = picked.flatMap(([, paths]) => paths);

  if (all.some((path) => /\s/.test(path)) || new Set(all).size !== all.length) {
    throw new Error("related: selected files must be distinct paths without whitespace");
  }

  const legs: Record<string, readonly string[]> = {};

  const projects: Record<string, Project> = {};

  for (const [project, paths] of picked) {
    const split = legsOf(paths, { ...sizing[project], table: sizing.table });

    for (const paths of Object.values(split)) {
      const name = String(Object.keys(legs).length + 1);
      legs[name] = paths;
      projects[name] = project;
    }
  }

  if (Object.keys(legs).length > 9) {
    throw new Error("related: the selection must fit check.yaml's related max-parallel of nine legs");
  }

  return { legs, projects };
};

export const outputs = (selection: ReturnType<typeof select>): string[] => [
  `run=${Object.keys(selection.legs).length > 0}`,
  `legs=${JSON.stringify(Object.keys(selection.legs))}`,
  `files=${JSON.stringify(Object.fromEntries(Object.entries(selection.legs).map(([leg, paths]) => [leg, paths.join(" ")])))}`,
  `projects=${JSON.stringify(selection.projects)}`,
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

  // The runner sets it on every step: `pull_request`, `merge_group` or `push` in check.yaml.
  const event = process.env["GITHUB_EVENT_NAME"];

  const lists: Lists = {
    "next-integration": () =>
      withReaders(list(root, ["--project", "next-integration", ...narrowed]), [
        ...(!full && changed?.some((path) => path.startsWith("next/"))
          ? list(root, ["--project", "next-integration", ...readers])
          : []),
        ...(wantsChecklistLaw(changed) ? [checklistFixture] : []),
      ]),
    tooling: () => list(root, ["--project", "tooling", ...narrowed]),
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

  const selected = select(event, lists, sizing);

  const lines = outputs(selected);

  const record = { event, base, head, at: new Date().toISOString(), changed, triggers, full, ...selected };

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
