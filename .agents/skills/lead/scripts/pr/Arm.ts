// Arm: how the lead turns on GitHub's merge when ready for one pull request (0530, 0544), the one
// way it is turned on. Today's lead tooling, run on our own laptop; it is not product.
//
//   arm   the pull request is open, into main, and no plan -> the full run (scheduled.yaml) on its
//         branch is read at its head -> green on every job: marked ready if a draft, then merge when
//         ready on, as a squash pinned to that head
//
// A full run that ended `cancelled` is not a run someone stopped: in scheduled.yaml a red leg's last
// step, `stop the run`, cancels its own run, so every leg reads `cancelled` and only the steps show
// which one failed (field/notes/2026-11-15-quotas-merged-on-a-red-branch-run-and-came-back-out.json).
// So the command judges each job, never the run's top line, and on a refusal prints each job that is
// not green, its failed steps and the failing test lines of its log.
//
// No full run at the head, or only one at an older head, refuses unless the caller says so: `--docs`
// for a pull request of only docs paths, which nothing starts a full run for, or `--without-full-run`,
// as 0544 lets a reviewed pull request be armed with no full run first. A full run at the head that
// failed or has not finished refuses whatever the caller says. Read through its module: `Arm.arm(...)`.
import { Effect, Option, Schema } from "effect";
import { Checks } from "../ci/Checks.ts";
import { Job, type Run, Runs } from "../ci/Runs.ts";
import { logText } from "../ci/typecheck.ts";
import { type Detail, PullRequests } from "./PullRequests.ts";

/** The full run's workflow file: the whole suite, which a pull request's own checks never run (0534, 0536). */
export const WORKFLOW = "scheduled.yaml";

/** The folders of a docs pull request: only words, which no full run tests. */
export const DOCS = [".decisions/", "docs/", "field/", ".glossary/", ".runbooks/"] as const;

export const isDocs = (path: string): boolean => DOCS.some((folder) => path.startsWith(folder));

/**
 * The jobs a branch's full run skips by design. scheduled.yaml's `report` job runs only on main
 * (`if: always() && github.ref == 'refs/heads/main'`), so every green branch run skips it. Every
 * other job has no `if` of its own: skipped there means something went wrong.
 */
export const SKIPPED_BY_DESIGN: ReadonlyArray<string> = ["report"];

/** Whether a job counts as green: ended `success`, or ended `skipped` where the workflow skips it. */
export const passes = (job: Job): boolean =>
  job.status === "completed" &&
  (job.conclusion === "success" || (job.conclusion === "skipped" && SKIPPED_BY_DESIGN.includes(job.name)));

/** The steps of a job that failed or ran out of time, by name. */
export const failedSteps = (job: Job): ReadonlyArray<string> =>
  job.steps.filter((s) => s.conclusion === "failure" || s.conclusion === "timed_out").map((s) => s.name);

/** The full run at a pull request's head, as the command found it. */
export const FullRun = Schema.TaggedUnion({
  /** Every job green. */
  green: { run: Schema.Number },
  /** No full run on the branch at all. */
  none: {},
  /** The branch's newest full run is at an older head. */
  older: { run: Schema.Number, head: Schema.String },
  /** The newest run at the head has not ended. */
  unfinished: { run: Schema.Number, status: Schema.String },
  /** Ended, and these jobs are not green. */
  red: { run: Schema.Number, jobs: Schema.Array(Job) },
});
export type FullRun = typeof FullRun.Type;

/** The newest run at `head` among a branch's runs; else the branch's newest, at another head. */
export const pick = (
  head: string,
  runs: ReadonlyArray<Run>,
): { readonly at: Option.Option<Run>; readonly newest: Option.Option<Run> } => {
  const newest = (list: ReadonlyArray<Run>) => Option.fromUndefinedOr(list.toSorted((a, b) => b.id - a.id)[0]);
  return { at: newest(runs.filter((r) => r.head === head)), newest: newest(runs) };
};

/** The full run on `branch` at `head`: its runs read, then the jobs of the one at the head. */
export const fullRunAt = Effect.fn("Arm.fullRunAt")(function* (branch: string, head: string) {
  const runs = yield* Runs;
  const { at, newest } = pick(head, yield* runs.on(WORKFLOW, branch));

  if (Option.isNone(at)) {
    return Option.match(newest, {
      onNone: () => FullRun.cases.none.make({}),
      onSome: (run) => FullRun.cases.older.make({ run: run.id, head: run.head }),
    });
  }

  if (at.value.status !== "completed") {
    return FullRun.cases.unfinished.make({ run: at.value.id, status: at.value.status });
  }

  const jobs = yield* runs.jobs(at.value.id);
  const bad = jobs.filter((job) => !passes(job));
  // A run with no jobs at all (a workflow file GitHub could not read) is not green either.
  return jobs.length > 0 && bad.length === 0
    ? FullRun.cases.green.make({ run: at.value.id })
    : FullRun.cases.red.make({ run: at.value.id, jobs: bad });
});

/** The longest line a refusal prints from a log, and the most lines it prints per job. */
const WIDTH = 200;
const MOST = 15;

const cut = (line: string) => (line.length > WIDTH ? `${line.slice(0, WIDTH - 3)}...` : line);

/** What a failing test leaves in a Vitest log, most telling first: the counts, the files, the tests. */
const TOLD: ReadonlyArray<RegExp> = [
  /^\s*Test Files\s.*\bfailed\b/,
  /^\s*Tests\s.*\bfailed\b/,
  /^\s*FAIL\s/,
  /^\s*[×✗]\s/,
];

/**
 * The lines of a job's log that say what failed, cut to a readable size: Vitest's counts, its FAIL
 * and × lines, and each error GitHub marked (`##[error]...Error: ...`). A log with none of them
 * (an install that broke) gives its last lines instead.
 */
export const failingLines = (log: string): ReadonlyArray<string> => {
  const raw = log.split("\n");
  const lines = raw.map((line) => logText(line).trimEnd());
  const marked = lines.filter((line, i) => raw[i]?.includes("##[error]") === true && /^\s*\w*Error\b/.test(line));
  const found = [...TOLD.map((told) => lines.filter((line) => told.test(line))), marked].flat();
  const shown = [...new Set(found.length > 0 ? found : lines.filter((line) => line.trim() !== "").slice(-8))].map(cut);
  return shown.length > MOST ? [...shown.slice(0, MOST), `... and ${shown.length - MOST} more`] : shown;
};

/** The pull request was not armed, and nothing was asked of GitHub's merge. */
export class NotArmed extends Schema.TaggedError<NotArmed>()("NotArmed", { reason: Schema.String }) {}

/** What to do when the head has no full run of its own: refuse, or arm a docs pull request, or any. */
export const NoRun = Schema.Literals(["refuse", "docs", "any"]);
export type NoRun = typeof NoRun.Type;

export type Ask = { readonly repo: string; readonly pr: number; readonly noRun: NoRun };

/** Why a pull request may not be armed whatever its runs say, or `null` when it may. A draft may. */
export const refusal = (found: Detail): string | null => {
  if (found.state !== "OPEN") {
    return `${found.state.toLowerCase()}, not open; refused`;
  }

  if (found.base !== "main") {
    return `merges into ${found.base}, not main; refused`;
  }

  // An open pull request for a plan to be read is titled `Plan: ...` (1279, 1344, 1365, 1373). A
  // lowercase `plan:` title is how a change to the plan files merges (485, 1158), so it may be armed.
  return found.title.startsWith("Plan:")
    ? "its title starts `Plan:`, a plan's pull request, which is never armed; give it the title it lands with first (the pr skill)"
    : null;
};

/** What `arm` did: turned merge when ready on at this head, or found it merged already. */
export const Armed = Schema.TaggedUnion({
  armed: { pr: Schema.Number, oid: Schema.String, readied: Schema.Boolean, full: Schema.String },
  merged: { pr: Schema.Number, commit: Schema.String },
});
export type Armed = typeof Armed.Type;

const runUrl = (repo: string, run: number) => `https://github.com/${repo}/actions/runs/${run}`;

/** Each job that is not green, its failed steps, and what its log says failed. */
const redReport = Effect.fn("Arm.redReport")(function* (repo: string, run: number, jobs: ReadonlyArray<Job>) {
  const checks = yield* Checks;
  const lines = [`the full run ${runUrl(repo, run)} is not green on every job:`];

  if (jobs.length === 0) {
    lines.push("  it has no jobs at all");
  }

  // The jobs with a failed step first: they say why; the rest were stopped by them.
  for (const job of jobs.toSorted((a, b) => failedSteps(b).length - failedSteps(a).length)) {
    const failed = failedSteps(job);
    const stands = job.conclusion ?? job.status;

    if (failed.length === 0) {
      lines.push(`  ${job.name}: ${stands}, no step failed (stopped by a red leg's stop step, or at its time limit)`);
      continue;
    }

    lines.push(`  ${job.name}: ${stands}, failed step: ${failed.join(", ")}`);
    const told = yield* Effect.match(checks.log(job.id), {
      onFailure: (e) => [`its log did not read: ${e.reason}`],
      onSuccess: failingLines,
    });
    lines.push(...told.map((line) => `    ${line}`));
  }

  return lines.join("\n");
});

/** Why a head with no full run of its own is refused, after what was found, and the two ways on. */
const noRunReason = (seen: string, branch: string, docsOnly: boolean): string =>
  docsOnly
    ? `${seen}. A docs pull request (only ${DOCS.join(", ")} files) starts no full run: pass --docs to arm it`
    : `${seen}. Start one (gh workflow run ${WORKFLOW} --ref ${branch}) and arm once it is green, or pass --without-full-run to arm it with none, as 0544 allows`;

export const arm = Effect.fn("Arm.arm")(function* (a: Ask) {
  const prs = yield* PullRequests;
  const found = yield* prs.view(a.pr);
  const refuse = (reason: string) => new NotArmed({ reason: `pr ${found.number}: ${reason}` });

  if (found.state === "MERGED") {
    return Armed.cases.merged.make({ pr: found.number, commit: found.mergeCommit ?? found.oid });
  }

  const refused = refusal(found);

  if (refused !== null) {
    return yield* refuse(refused);
  }

  const files = yield* prs.files(found.number);
  const docsOnly = files.length > 0 && files.every(isDocs);

  if (a.noRun === "docs" && !docsOnly) {
    const others = files.filter((path) => !isDocs(path));
    const named = others.length > 5 ? [...others.slice(0, 5), `and ${others.length - 5} more`] : others;
    return yield* refuse(
      `--docs is for a pull request of only ${DOCS.join(", ")} files; it also changes ${named.join(", ")}`,
    );
  }

  const full = yield* fullRunAt(found.head, found.oid);
  const unrun = (seen: string) =>
    a.noRun === "refuse"
      ? Effect.fail(refuse(noRunReason(seen, found.head, docsOnly)))
      : Effect.succeed(`${seen}; armed with --${a.noRun === "docs" ? "docs" : "without-full-run"}`);
  const said = yield* FullRun.match(full, {
    green: ({ run }) => Effect.succeed(`full run ${run} green on every job at ${found.oid.slice(0, 12)}`),
    none: () => unrun(`no ${WORKFLOW} run on ${found.head}`),
    older: ({ head }) =>
      unrun(
        `the newest ${WORKFLOW} run on ${found.head} is at ${head.slice(0, 12)}, not the head ${found.oid.slice(0, 12)}`,
      ),
    unfinished: ({ run, status }) =>
      Effect.fail(
        refuse(`the full run ${runUrl(a.repo, run)} at this head is ${status}, not ended; arm it once it is green`),
      ),
    red: ({ run, jobs }) => Effect.flatMap(redReport(a.repo, run, jobs), (report) => Effect.fail(refuse(report))),
  });

  if (found.draft) {
    yield* prs.ready(found.number);
  }

  yield* prs.arm(found.number, found.oid);
  return Armed.cases.armed.make({ pr: found.number, oid: found.oid, readied: found.draft, full: said });
});

/** One line for a log: what `arm` did. */
export const line = (armed: Armed): string =>
  Armed.match(armed, {
    armed: ({ pr, oid, readied, full }) =>
      `pr ${pr}: ${full}; ${readied ? "marked ready; " : ""}merge when ready on at ${oid}, a squash: GitHub queues it once ci-required is green there`,
    merged: ({ pr, commit }) => `pr ${pr}: already merged at ${commit}`,
  });
