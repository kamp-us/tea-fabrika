import * as Rec from "effect/Record";
// Today's CI, serving both versions. What every workflow-lint rule reads with: the parsed
// workflow's parts, step lists, expression spacing, and the values more than one rule pins.
import * as Result from "effect/Result";
import { parse } from "yaml";

/** A parsed check.yaml, cut into the parts every rule reads. */
export interface Workflow {
  readonly workflow: Record<string, unknown>;
  readonly on: Record<string, unknown>;
  readonly jobs: Record<string, unknown>;
}

/** Adds `reason` to the lint's errors unless `holds`. */
export type Require = (holds: boolean, reason: string) => void;

/** One family of check.yaml's laws: it calls `require` once for each law it holds. */
export type Rule = (workflow: Workflow, require: Require) => void;

export const isMap = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

export const map = (value: unknown): Record<string, unknown> => (isMap(value) ? value : {});

/** Every step of a job, in order, the stop step included. */
export const allSteps = (job: Record<string, unknown>): Record<string, unknown>[] =>
  Array.isArray(job["steps"]) ? job["steps"].filter(isMap) : [];

// Fail fast (ticket 990): every job but ci-required ends with this step. Once an earlier step
// failed, on a pull request or a merge queue group, it cancels the job's own run, so the jobs still
// running free their runners and ci-required, which a normal cancel leaves running, answers at once.
// A push to main runs to the end.
const STOP = {
  name: "stop the run",
  if: "failure()&&github.event_name!='push'",
  env: { GH_TOKEN: `\${{ github.token }}` },
  run: 'gh run cancel "$GITHUB_RUN_ID" --repo "$GITHUB_REPOSITORY"',
};

/** The stop step exactly as STOP writes it, its `if` spaced any way, with nothing else on it. */
export const isStop = (step: Record<string, unknown>) =>
  step["name"] === STOP.name &&
  compact(step["if"]) === STOP.if &&
  JSON.stringify(step["env"]) === JSON.stringify(STOP.env) &&
  step["run"] === STOP.run &&
  Rec.keys(step).length === Rec.keys(STOP).length;

// The CLI's `gh run cancel`, and the REST API's `cancel` and `force-cancel` calls on a run.
const CANCEL = /\brun\s+cancel\b|\/(?:force-)?cancel\b/;

/** A step that cancels a workflow run: by the CLI, by the REST API, or with an action named for it. */
export const cancels = (step: Record<string, unknown>) =>
  (typeof step["run"] === "string" && CANCEL.test(step["run"])) ||
  (typeof step["uses"] === "string" && /cancel/i.test(step["uses"]));

/** A job's own work: its steps less the stop step, which the fail-fast law judges alone. */
export const steps = (job: Record<string, unknown>): Record<string, unknown>[] =>
  allSteps(job).filter((step) => !isStop(step));

export const commands = (job: Record<string, unknown>) =>
  steps(job).flatMap((step) =>
    typeof step["run"] === "string" ? step["run"].split("\n").map((line) => line.trim()) : [],
  );

export const compact = (value: unknown) => {
  if (typeof value !== "string") {
    return "";
  }

  const trimmed = value.trim();
  const expression = trimmed.startsWith("${{") && trimmed.endsWith("}}") ? trimmed.slice(3, -2).trim() : trimmed;
  // Keep quoted strings and names intact. Only operator spacing cannot change meaning.
  return expression.replace(
    /'(?:[^']|'')*'|\s*(==|!=|&&|\|\|)\s*/g,
    (match, operator: string | undefined) => operator ?? match,
  );
};

export const env = {
  BASE: `\${{ github.event.pull_request.base.sha || github.event.merge_group.base_sha || github.event.before }}`,
  HEAD: `\${{ github.event.pull_request.head.sha || github.sha }}`,
  EVENT: `\${{ github.event_name }}`,
};

// The classifier also reads whether the pull request is a draft (0134's amendment of 2026-11-11).
export const classifier = { ...env, DRAFT: `\${{ github.event.pull_request.draft }}` };

// A pull request that asked for its visual tests (0536). Only a pull request has labels, so this is
// false in the merge queue and on main.
export const VISUAL_LABEL = "contains(github.event.pull_request.labels.*.name, 'visual')";

// The token changes' classify step reads.
export const TOKEN = `\${{ github.token }}`;

/** Two lists of key and value pairs hold the same pairs, in any order. */
export const sameEntries = (left: readonly [string, unknown][], right: readonly [string, unknown][]) =>
  left.length === right.length &&
  right.every(([key, value]) => left.some(([other, held]) => other === key && held === value));

export const uses = (step: Record<string, unknown>, action: string) =>
  typeof step["uses"] === "string" && step["uses"].startsWith(`${action}@`);

// Chromium's OS packages come from apt, so the step first finds a mirror that answers (apt.sh).
export const chromium =
  "sudo sh .github/ci/apt.sh update\n" + "pnpm --filter @kampus/fabrika exec playwright install --with-deps chromium\n";

// The next job's machines. Each is a string, so a workflow `if` compares a string with a string.
// The end-to-end legs `e2e-1` to `e2e-N` come first; the lint pins their shape, and the count law in
// vitest.shards.test.ts (E4) pins N from measured seconds. The matrix is changes' size step's
// `shards`, else its fallback: the full matrix on a pull request with the `visual` label, and the
// vitest legs alone everywhere else, the merge queue and main among them (0536, legs.ts).
export const E2E_PREFIX = "e2e-";

export const ON_E2E = `startsWith(matrix.shard, '${E2E_PREFIX}')`;
// Chromium is fetched only once a visual file exists.
export const VISUAL_FILES = "hashFiles('next/**/*.visual.test.ts', 'next/**/*.visual.test.tsx') != ''";
const FALLBACKS = /^fromJSON\(needs\.changes\.outputs\.shards\|\|\((.*)&&'(.*)'\|\|'(.*)'\)\)$/s;

const parsed = (text: string | undefined): unknown[] =>
  Result.getOrElse(
    Result.try((): unknown[] => {
      const value: unknown = JSON.parse(text ?? "");
      return Array.isArray(value) ? value : [];
    }),
    (): unknown[] => [],
  );

/**
 * next's matrix, `fromJSON(needs.changes.outputs.shards || (<when> && '<full>' || '<vitest legs>'))`:
 * when the full fallback runs, the full legs, and the other legs, numbers and strings kept apart.
 */
export const fallbacks = (job: Record<string, unknown>) => {
  const found = FALLBACKS.exec(compact(map(map(job["strategy"])["matrix"])["shard"]));
  return { when: found?.[1] ?? "", full: parsed(found?.[2]), plain: parsed(found?.[3]) };
};

/** The full fallback's legs: what a pull request with the `visual` label runs unsized. */
export const legs = (job: Record<string, unknown>): unknown[] => fallbacks(job).full;

/** The legs that run vitest: the ones written as a quoted whole number. */
export const numbered = (all: readonly unknown[]): string[] =>
  all.filter((leg): leg is string => typeof leg === "string" && /^[1-9]\d*$/.test(leg));

/** The legs that run the end-to-end files: the ones written as `e2e-` and a whole number. */
export const ends = (all: readonly unknown[]): string[] =>
  all.filter((leg): leg is string => typeof leg === "string" && /^e2e-[1-9]\d*$/.test(leg));

export const nextJob = (text: string) => map(map(map(parse(text))["jobs"])["next"]);

// changes' flags from its first pass, each a job's or a step's.
// No flag starts today's tests or its app end to end, which run on no event (0525, 0533), and none
// starts the tooling tests, which only the schedule runs (0539).
export const FLAGS = ["check", "typecheck", "field", "build"];

export const ROW_INSTALL = "pnpm install --frozen-lockfile --filter @tea-fabrika/ci --ignore-scripts";

// A leg's `--shard`: `${{ matrix.shard }}/${{ needs.changes.outputs.<kind>-legs || <full count> }}`, so a sized
// run divides by its own count of that kind, and every other run by the full matrix's.
export const SHARD_OF = String.raw`\$\{\{\s*matrix\.shard\s*\}\}`;

export const denominator = (kind: "vitest" | "e2e", full: number | string) =>
  String.raw`\$\{\{\s*needs\.changes\.outputs\.${kind}-legs\s*\|\|\s*${full}\s*\}\}`;

// The end-to-end step's narrowing, from changes' `base` alone (next-job.ts's E-laws hold its use).
export const CHANGED_FROM_BASE = `\${{ needs.changes.outputs.base && format('--changed={0} --passWithNoTests', needs.changes.outputs.base) || '' }}`;
