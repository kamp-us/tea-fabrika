// Arm: how the lead turns on GitHub's merge when ready for one pull request (0530, 0544), the one
// way it is turned on. Today's lead tooling, run on our own laptop; it is not product.
//
//   arm   the pull request is open, into main, and no plan -> the leak gate (./Leaks.ts) passes on
//         its change, its commits and its words -> the full run (scheduled.yaml) on its branch is
//         read at its head -> green on every job: marked ready if a draft, then merge when ready on,
//         as a squash pinned to that head
//
// A full run that ended `cancelled` is not a run someone stopped: in scheduled.yaml a red leg's last
// step, `stop the run`, cancels its own run, so every leg reads `cancelled` and only the steps show
// which one failed (field/notes/2026-11-15-quotas-merged-on-a-red-branch-run-and-came-back-out.json).
// So the command judges each job, never the run's top line, and on a refusal prints each job that is
// not green, its failed steps and the failing test lines of its log.
//
// No full run at the head arms, as 0544 lets a reviewed pull request be armed with no full run
// first, and says so in one line with how to start one. A full run at the head that is red or has not
// ended refuses. With none at the head, the branch's newest run at an older head counts: green arms
// with the note, red or not ended refuses. Read through its module: `Arm.arm(...)`.
import { Effect, Option, Schema } from "effect";
import { Checks } from "../ci/Checks.ts";
import { Job, type Run, Runs } from "../ci/Runs.ts";
import { logText } from "../ci/typecheck.ts";
import * as Leaks from "./Leaks.ts";
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

/** How one full run stands, judged job by job. */
export const Verdict = Schema.TaggedUnion({
  /** Every job green. */
  green: { run: Schema.Number },
  /** Not ended yet. */
  unfinished: { run: Schema.Number, status: Schema.String },
  /** Ended, and these jobs are not green. */
  red: { run: Schema.Number, jobs: Schema.Array(Job) },
});

export type Verdict = typeof Verdict.Type;

/** The full run a pull request's head is judged by, as the command found it. */
export const FullRun = Schema.TaggedUnion({
  /** No full run on the branch at all. */
  none: {},
  /** The newest run at the head. */
  at: { verdict: Verdict },
  /** None at the head; the branch's newest run, at an older head. */
  older: { head: Schema.String, verdict: Verdict },
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

/** One run judged: not ended, or its jobs read and each judged. */
const judge = Effect.fn("Arm.judge")(function* (run: Run) {
  if (run.status !== "completed") {
    return Verdict.cases.unfinished.make({ run: run.id, status: run.status });
  }

  const jobs = yield* (yield* Runs).jobs(run.id);
  const bad = jobs.filter((job) => !passes(job));

  // A run with no jobs at all (a workflow file GitHub could not read) is not green either.
  return jobs.length > 0 && bad.length === 0
    ? Verdict.cases.green.make({ run: run.id })
    : Verdict.cases.red.make({ run: run.id, jobs: bad });
});

/** The full run on `branch` that `head` is judged by: the newest at the head, else the newest older one. */
export const fullRunAt = Effect.fn("Arm.fullRunAt")(function* (branch: string, head: string) {
  const runs = yield* Runs;
  const { at, newest } = pick(head, yield* runs.on(WORKFLOW, branch));

  if (Option.isSome(at)) {
    return FullRun.cases.at.make({ verdict: yield* judge(at.value) });
  }

  if (Option.isNone(newest)) {
    return FullRun.cases.none.make({});
  }

  return FullRun.cases.older.make({ head: newest.value.head, verdict: yield* judge(newest.value) });
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

export type Ask = {
  readonly repo: string;
  /** A checkout of the repo, to fetch the head into for the leak gate. */
  readonly dir: string;
  readonly pr: number;
};

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

/** The line a head with no full run of its own is armed with (0544), and how to start one. */
const unrunNote = (seen: string, oid: string, branch: string, docsOnly: boolean): string =>
  `no full run at ${oid.slice(0, 12)}${seen}; arming as 0544 allows (${
    docsOnly
      ? `a docs pull request, only ${DOCS.join(", ")} files, starts no full run`
      : `to start one: gh workflow run ${WORKFLOW} --ref ${branch}`
  })`;

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

  // Merge when ready merges later with no one watching, so the leak gate runs before it is turned on.
  yield* Leaks.gate(a.dir, found);

  const files = yield* prs.files(found.number);
  const docsOnly = files.length > 0 && files.every(isDocs);
  const note = (seen: string) => unrunNote(seen, found.oid, found.head, docsOnly);

  // A green run arms with its line; any other refuses, at the head or, with none there, at the older head.
  const judged = (verdict: Verdict, place: string, green: (run: number) => string) =>
    Verdict.match(verdict, {
      green: ({ run }) => Effect.succeed(green(run)),
      unfinished: ({ run, status }) =>
        Effect.fail(
          refuse(`${place}: the full run ${runUrl(a.repo, run)} is ${status}, not ended; arm it once it is green`),
        ),
      red: ({ run, jobs }) =>
        Effect.flatMap(redReport(a.repo, run, jobs), (report) => Effect.fail(refuse(`${place}: ${report}`))),
    });

  const full = yield* fullRunAt(found.head, found.oid);

  const said = yield* FullRun.match(full, {
    none: () => Effect.succeed(note("")),
    at: ({ verdict }) =>
      judged(verdict, "at this head", (run) => `full run ${run} green on every job at ${found.oid.slice(0, 12)}`),
    older: ({ head, verdict }) =>
      judged(verdict, `no full run at this head, and at the older head ${head.slice(0, 12)}`, (run) =>
        note(`, and the newest one, ${run} at the older head ${head.slice(0, 12)}, was green`),
      ),
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
