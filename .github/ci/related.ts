// Today's CI, both versions. The missing projects of an automatic PR/queue check; next and visual
// remain on the existing next matrix. A pull request and a queue group pick tooling's plain laws
// alone: every `.integration.` law, `next-integration`'s and `tooling-integration`'s alike, runs only
// on main's full run (scheduled.yaml, on a push to main and hourly, 0581), never on a pull request, a
// queue group or a branch's proof run (0602, 0584; `onMergeLine`). A selector error fails the
// required check, never means zero.
import { spawnSync } from "node:child_process";
import { appendFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { isIntegration } from "../../oxlint-plugins/test-names.ts";
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
 * Whether the GitHub event that started a related run is the merge line: a pull request or a merge
 * queue group. The owner moved every `.integration.` law back to main's full run on 2026-11-18
 * (0602), after real-resource laws failed about a dozen of that night's pull request and queue runs
 * on code those changes never touched (0536's rule). Any other event, which in check.yaml is a push
 * to main whose changes job failed, picks both lists, as before; tooling's laws that start a process
 * are in neither, since they are `tooling-integration`'s.
 */
const onMergeLine = (event: string | undefined): boolean => event === "pull_request" || event === "merge_group";

/** The projects a related run picks from: tooling alone on the merge line, both otherwise. */
const projectsOf = (event: string | undefined): readonly Project[] => (onMergeLine(event) ? ["tooling"] : PROJECTS);

/** Each project's files, asked for only when the run picks that project, so a skipped one is never listed. */
type Lists = Readonly<Record<Project, () => readonly string[]>>;

/** Separate project legs keep their existing full-depth counts and test-step limits. */

export const select = (event: string | undefined, lists: Lists, sizing: Sizing) => {
  const listed = projectsOf(event).map((project) => [project, lists[project]()] as const);

  const all = listed.flatMap(([, paths]) => paths);

  // Every listed file is checked, a dropped one too: a broken list fails loudly on every event.
  if (all.some((path) => /\s/.test(path)) || new Set(all).size !== all.length) {
    throw new Error("related: selected files must be distinct paths without whitespace");
  }

  // A tooling law that starts a process is an `.integration.` law too (0584). Its own project,
  // `tooling-integration`, already keeps it out of tooling's list; the name holds it off the merge
  // line whatever a list gives.
  const picked = listed.map(
    ([project, paths]) => [project, onMergeLine(event) ? paths.filter((path) => !isIntegration(path)) : paths] as const,
  );

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

/** What the select step reads from outside itself: its variables, git, and Vitest's list of files. */
export type Step = {
  readonly env: Readonly<Record<string, string | undefined>>;
  /** git's trimmed output for `args`, run in the checkout; it throws when git fails. */
  readonly git: (args: readonly string[]) => string;
  /** `vitest list` over `args`, the files it names, from the repo root. */
  readonly list: (args: readonly string[]) => string[];
};

/**
 * The select step, on what `step` gives it: the tested commit and the change from its variables
 * and git, the run's event from `GITHUB_EVENT_NAME`, which the runner sets on every step
 * (`pull_request`, `merge_group` or `push` in check.yaml), and each picked project's files. It
 * gives the record it keeps and the lines it prints, and writes nothing itself.
 */
export const run = (step: Step) => {
  const { env, git } = step;

  const head = git(["rev-parse", "--verify", "HEAD^{commit}"]);

  if (!validSha(head) || head !== env["HEAD"]) {
    throw new Error("related: checkout HEAD must equal this check's tested commit");
  }

  const from = env["BASE"];

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

  const event = env["GITHUB_EVENT_NAME"];

  const lists: Lists = {
    "next-integration": () =>
      withReaders(step.list(["--project", "next-integration", ...narrowed]), [
        ...(!full && changed?.some((path) => path.startsWith("next/"))
          ? step.list(["--project", "next-integration", ...readers])
          : []),
        ...(wantsChecklistLaw(changed) ? [checklistFixture] : []),
      ]),
    tooling: () => step.list(["--project", "tooling", ...narrowed]),
  };

  const sizing: Sizing = {
    "next-integration": {
      most: whole("MOST_INTEGRATION", env["MOST_INTEGRATION"]),
      limit: room(whole("LIMIT_INTEGRATION", env["LIMIT_INTEGRATION"]), E2E_SETUP),
    },
    tooling: {
      most: whole("MOST_TOOLING", env["MOST_TOOLING"]),
      limit: room(whole("LIMIT_TOOLING", env["LIMIT_TOOLING"]), E2E_SETUP),
    },
    table: rowsAt("full"),
  };

  const selected = select(event, lists, sizing);

  return {
    record: { event, base, head, at: new Date().toISOString(), changed, triggers, full, ...selected },
    lines: outputs(selected),
  };
};

if (import.meta.main) {
  const root = fileURLToPath(new URL("../../", import.meta.url));

  const git = (args: readonly string[]): string => {
    const result = spawnSync("git", args, { cwd: root, encoding: "utf8" });

    if (result.status !== 0) {
      throw new Error(`related: git ${args.join(" ")} exited ${result.status}`);
    }

    return result.stdout.trim();
  };

  const { record, lines } = run({ env: process.env, git, list: (args) => list(root, args) });

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
