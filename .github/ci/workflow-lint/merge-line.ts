import * as Rec from "effect/Record";
// Today's CI, serving both versions. What the merge line runs no more: no tooling test (T1, 0539),
// in check.yaml and in every other workflow a pull request or the merge queue starts, and nothing of
// today's app (T2) or today's promise checks (T6, 0525, 0533).
import { parse } from "yaml";
import { CHANGED_FROM_BASE, compact, denominator, map, type Rule, SHARD_OF, steps } from "./shared.ts";

// Today's app: its package name, or its folder outside next/. No command in check.yaml runs it.
const TODAYS_APP = /fabrika-app-old|(?<!next\/)apps\/fabrika\b/;

// Today's promise checks: `pnpm promises`, however spelled, or its program by path. Their checks
// and planted breaks test today's pipeline code, so no command in check.yaml runs them (0533).
const TODAYS_PROMISES = /\bpnpm\s+(?:-\S+\s+|run\s+)*promises\b|packages\/promises\//;

// T1 (0539). A shell command that starts vitest: the binary, however reached (`pnpm exec`, `npx`,
// `pnpm dlx`, a path into node_modules), but not a file named `vitest.*`; or a package manager's
// test script, by any of its names (`t`, `tst`, `test`, `test:…`) and after any flags with their
// values: the root `test` script is `vitest run`.
const VITEST_CALL =
  /\bvitest\b(?!\.)|\b(?:pnpm|npm|yarn|bun)\b(?:\s+-{1,2}[\w-]+(?:[=\s]+[^\s-]\S*)?)*\s+(?:run(?:-script)?\s+)?(?:t|tst|test)(?=[\s:]|$)/;

// The variables a vitest call may read, each only as the step's own env sets it: next's leg shard and
// changes' outputs. Any other value could carry a `--project` the lint cannot see.
const VITEST_VARS: Record<string, (value: unknown) => boolean> = {
  SHARD: (value) =>
    typeof value === "string" &&
    new RegExp(
      `^${SHARD_OF}/(?:${denominator("vitest", String.raw`\d+`)}|${denominator("e2e", String.raw`\d+`)})$`,
    ).test(value),
  FILTER: (value) => compact(value) === "needs.changes.outputs.files||needs.changes.outputs.filter||'next/'",
  CHANGED: (value) => compact(value) === compact(CHANGED_FROM_BASE),
};

// A vitest flag that picks another config or root, which could hold projects of any name.
const ELSEWHERE = /(?:^|\s)(?:--config|-c|--root|-r|--dir|--workspace)(?:[=\s]|$)/;

/** A step's script as shell commands: `\`-continued lines joined, then cut at every separator. */
const shellCommands = (script: string) =>
  script
    .replace(/\\\r?\n/g, " ")
    .split(/\n|&&|\|\||[;&|]/)
    .map((part) => part.trim())
    .filter((part) => part !== "");

/**
 * T1 (0539): the jobs of a pull request or merge queue workflow that run a tooling test. A vitest
 * call passes in one of two ways. Either it names its projects, each one of next/'s, and no other
 * config or root: a call with no `--project` runs every project, the tooling one and today's among
 * them. Or its step runs it inside next/ (`working-directory`, with no `..` and no `cd`), and no
 * argument leaves that folder. Either way it reads no shell value but RUNNER_TEMP, untouched, and
 * the step's own pinned `VITEST_VARS`, and no `${{ }}` or command substitution.
 */
const toolingJobs = (workflow: Record<string, unknown>): string[] => {
  const outer = { ...map(workflow["env"]) };

  return Rec.toEntries(map(workflow["jobs"]))
    .filter(([, job]) =>
      steps(map(job)).some((step) => {
        if (typeof step["run"] !== "string") {
          return false;
        }

        const env = map(step["env"]);
        const set = { ...outer, ...map(map(job)["env"]), ...env };
        const parts = shellCommands(step["run"]);
        const folder = typeof step["working-directory"] === "string" ? step["working-directory"] : "";

        const inside =
          /^next\//.test(folder) &&
          !folder.split("/").includes("..") &&
          !parts.some((part) => /^(?:cd|pushd)\b/.test(part));

        return parts
          .filter((part) => VITEST_CALL.test(part))
          .some((part) => {
            const bare = part.replace(/\$\{(\w+)(?:#e2e-)?\}|\$(\w+)\b/g, (whole, braced?: string, plain?: string) => {
              const name = braced ?? plain ?? "";
              const pinned = VITEST_VARS[name];
              const runner = name === "RUNNER_TEMP" && !(name in set);

              return runner || (pinned !== undefined && pinned(env[name])) ? "" : whole;
            });

            const projects = [...part.matchAll(/--project(?:=|\s+)(\S+)/g)].map((found) => found[1] ?? "");

            const named =
              projects.length > 0 && projects.every((project) => /^next(?:-|$)/.test(project)) && !ELSEWHERE.test(part);

            const kept = inside && !part.split(/\s+/).some((word) => /(?:^|[="'/])\.\.|^["']?[/~]/.test(word));

            return /[$`]/.test(bare) || !(named || kept);
          });
      }),
    )
    .map(([name]) => name);
};

/** T1 for one more workflow: a pull request or merge queue one; any other runs no merge line. */
export const lintNoTooling = (path: string, text: string): string[] => {
  const workflow = map(parse(text));
  const on = workflow["on"];
  const events = typeof on === "string" ? [on] : Array.isArray(on) ? on : Rec.keys(map(on));

  return events.includes("pull_request") || events.includes("merge_group")
    ? toolingJobs(workflow).map((job) => `${path}: T1: ${job} runs no tooling test (0539)`)
    : [];
};

export const mergeLine: Rule = ({ workflow, jobs }, require) => {
  // T1 (0539). No event here runs a tooling test: their author runs the narrow ones on the laptop,
  // and the schedule runs them all (scheduled.yaml's tooling job, SC8). Today's version is frozen
  // (0525, 0533), so its tests run on no event either. `toolingJobs` says how a vitest call passes.
  for (const name of toolingJobs(workflow)) {
    require(false, `T1: ${name} runs no tooling test (0539)`);
  }

  // T2 (0525, 0533). No job runs today's app, end to end or otherwise. T6 (0533): no step runs
  // today's promise checks.
  for (const [name, job] of Rec.toEntries(jobs)) {
    for (const step of steps(map(job))) {
      require(![step["run"], step["working-directory"]].some(
        (text) => typeof text === "string" && TODAYS_APP.test(text),
      ), `T2: ${name} runs nothing of today's app`);
      require(!(
        typeof step["run"] === "string" && TODAYS_PROMISES.test(step["run"])
      ), `T6: ${name} runs no promise check of today's version`);
    }
  }
};
