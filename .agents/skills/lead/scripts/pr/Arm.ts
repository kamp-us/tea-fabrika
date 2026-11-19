// Arm: how the lead turns on GitHub's merge when ready for one pull request (0530, 0544), the one
// way it is turned on. Today's lead tooling, run on our own laptop; it is not product.
//
//   arm   the pull request is open, into main, and no plan -> the leak gate (./Leaks.ts) passes on
//         its change, its commits and its words -> each new exported name is named under
//         `## New names` (Names.ts, 0587) -> scheduled proof at its head, or automatic ready CI
//         with related-test coverage, is read -> green: marked ready if a draft, then merge when ready on, as a
//         squash pinned to that head
//
// A branch's proof run tests the full set or, since 0590, the changed set: the tests its change
// reaches against origin/main. Its jobs' names say which (`kind`): a full run has `tests (<leg>)`
// legs, a changed-set run has `changed (<leg>)` legs or, for a set of zero files, no leg. Either one
// green at the head arms. A changed set is the set of one diff, so a changed-set run at an older head
// proves nothing about this head's change and refuses; a full run at an older head still arms with
// 0544's note.
//
// A run that ended `cancelled` was once not a run someone stopped: a red leg's old last step,
// `stop the run`, canceled its own run, so every leg read `cancelled` and only the steps showed which
// one failed (field/notes/2026-11-15-quotas-merged-on-a-red-branch-run-and-came-back-out.json). So the
// command judges each job, never the run's top line, and on a refusal prints each job that is not
// green, its failed steps and the failing test lines of its log.
//
// No run at the head arms, as 0544 lets a reviewed pull request be armed with no full run first, and
// says so in one line. A run at the head that is red or has not ended refuses.
// With no scheduled proof at the head, the newest exact-head automatic check can prove the related
// set. It must be a successful ready PR run from this repository, with select, related and the real
// ci-required check complete. Red or unfinished new-route CI refuses. Legacy and draft checks do
// not count. A docs-only change (@kalfa/ci/DocsOnly) needs no select or related legs: its check skipped
// its heavy jobs by design, so ci-required green, with every other job green or skipped, proves it (kind
// `docs`). With no matching automatic route, the branch's newest older scheduled run counts: a green full run arms with
// the note; a changed-set run, or one red or not ended, refuses. Read through its module:
// `Arm.arm(...)`.
//
// Neither route asks for an `.integration.` law (0602): a branch's proof run runs none, on a full
// set or a changed one (proof.ts, scheduled.yaml's `PROJECTS`), and a ready run's related legs are
// the plain tooling laws its change reaches (related.ts's `onMergeLine`). Only main's full run runs
// them, after the merge. Arm reads each job's name and how it ended, never which laws it ran, so
// nothing here names a project.
import { docsOnly } from "@kalfa/ci/DocsOnly";
import { Effect, Option, Schema } from "effect";
import { Checks } from "../ci/Checks.ts";
import { Job, type Run, Runs } from "../ci/Runs.ts";
import { logText } from "../ci/typecheck.ts";
import * as Leaks from "./Leaks.ts";
import * as Names from "./Names.ts";
import { type Detail, PullRequests } from "./PullRequests.ts";

/** The separately started proof workflow, still authoritative when present at the current head. */
export const WORKFLOW = "scheduled.yaml";

const AUTOMATIC = "check.yaml";

/**
 * The jobs a branch's proof run skips by design (0590): `select` on a hand start on main, the test
 * matrix `select` did not choose, and both matrices on a changed set of zero files. GitHub lists a
 * skipped matrix as one job with no leg in its name. The `report` job is never one: it runs on every
 * run a hand start begins (pull request 1404) and fails unless the run is green by what `select`
 * chose (scheduled.mjs's `skippable`), so a skip that was not meant shows as a red report.
 */
export const SKIPPED_BY_DESIGN: ReadonlyArray<string> = ["select", "tests", "changed"];

/** Whether a job counts as green: ended `success`, or ended `skipped` where the workflow skips it. */
export const passes = (job: Job): boolean =>
  job.status === "completed" &&
  (job.conclusion === "success" || (job.conclusion === "skipped" && SKIPPED_BY_DESIGN.includes(job.name)));

/**
 * What a proof run tested: every test, the changed set of its head's diff (0590), or, for a docs-only
 * change, its automatic check alone (`docs`).
 */
const Kind = Schema.Literals(["full", "changed", "automatic", "docs"]);

type Kind = typeof Kind.Type;

/**
 * A run's kind from its jobs' names: `full` when a leg of the full set's matrix ran, `tests (<leg>)`,
 * or `next (<leg>)` and `tooling (<leg>)` from before the two were one matrix, as scheduled.mjs's
 * `isFull` reads main's runs; else `changed`, whose legs are `changed (<leg>)`, or none at all for a
 * changed set of zero files.
 */
export const kind = (jobs: ReadonlyArray<Job>): Kind =>
  jobs.some((job) => /^(tests|next|tooling) \(.+\)$/.test(job.name)) ? "full" : "changed";

/** The steps of a job that failed or ran out of time, by name. */
export const failedSteps = (job: Job): ReadonlyArray<string> =>
  job.steps.filter((s) => s.conclusion === "failure" || s.conclusion === "timed_out").map((s) => s.name);

/** How one full run stands, judged job by job. */
export const Verdict = Schema.TaggedUnion({
  /** Every job green, and what the run tested. */
  green: { run: Schema.Finite, kind: Kind },
  /** Not ended yet. */
  unfinished: { run: Schema.Finite, status: Schema.String },
  /** Ended, and these jobs are not green. */
  red: { run: Schema.Finite, jobs: Schema.Array(Job), reason: Schema.optional(Schema.String) },
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
    ? Verdict.cases.green.make({ run: run.id, kind: kind(jobs) })
    : Verdict.cases.red.make({ run: run.id, jobs: bad });
});

/**
 * Ready CI's required check covers both the existing next matrix and the related tooling matrix. A
 * docs-only change (`docs`) takes the other route the file's header names: its skipped heavy jobs prove it.
 */
const automaticAt = Effect.fn("Arm.automaticAt")(function* (branch: string, head: string, docs: boolean) {
  const runs = yield* Runs;
  const { at } = pick(head, yield* runs.on(AUTOMATIC, branch));

  if (Option.isNone(at)) {
    return Option.none<Verdict>();
  }

  const run = at.value;
  const source = run.source;

  if (
    source === undefined ||
    source.event !== "pull_request" ||
    source.path !== `.github/workflows/${AUTOMATIC}` ||
    !Number.isSafeInteger(source.repository) ||
    source.repository <= 0 ||
    !Number.isSafeInteger(source.headRepository) ||
    source.headRepository <= 0 ||
    source.repository !== source.headRepository
  ) {
    return Option.none<Verdict>();
  }

  const jobs = yield* runs.jobs(run.id);

  // Queued jobs may not exist yet; absence cannot stand in for completed coverage.
  if (run.status !== "completed") {
    return Option.some(Verdict.cases.unfinished.make({ run: run.id, status: run.status }));
  }

  if (run.conclusion !== "success") {
    return Option.some(
      Verdict.cases.red.make({
        run: run.id,
        jobs,
        reason: `automatic check ended ${run.conclusion ?? "without a conclusion"}; completed success required`,
      }),
    );
  }

  const succeeded = (name: string) => {
    const found = jobs.filter((job) => job.name === name);

    return found.length === 1 && found.every((job) => job.status === "completed" && job.conclusion === "success");
  };

  // A docs-only change's heavy jobs are skipped by design (@kalfa/ci/DocsOnly), so the run proves it when
  // ci-required passed and every job ended green or skipped. A draft or legacy run never does.
  if (
    docs &&
    !jobs.some((job) => job.name === "ci-required (draft)" || job.name === "lint") &&
    succeeded("ci-required") &&
    jobs.every((job) => job.status === "completed" && (job.conclusion === "success" || job.conclusion === "skipped"))
  ) {
    return Option.some(Verdict.cases.green.make({ run: run.id, kind: "docs" }));
  }

  const related = jobs.filter((job) => job.name.startsWith("related"));

  // A legacy or draft run never stands in for ready CI's related coverage, its plain tooling laws.
  if (
    (!jobs.some((job) => job.name === "select") && related.length === 0) ||
    jobs.some((job) => job.name === "ci-required (draft)" || job.name === "lint")
  ) {
    return Option.none<Verdict>();
  }

  const skipped = related.length === 1 && related[0]?.name === "related" && related[0]?.conclusion === "skipped";

  const legs =
    related.length <= 9 &&
    related
      .toSorted((a, b) => a.name.localeCompare(b.name))
      .every((job, i) => job.name === `related (${i + 1})` && job.conclusion === "success");

  const covered =
    related.length > 0 &&
    new Set(related.map((job) => job.name)).size === related.length &&
    related.every((job) => job.status === "completed") &&
    (skipped || legs);

  return succeeded("ci-required") && succeeded("select") && covered
    ? Option.some(Verdict.cases.green.make({ run: run.id, kind: "automatic" }))
    : Option.some(
        Verdict.cases.red.make({
          run: run.id,
          jobs,
          reason:
            "automatic ready CI needs a successful run, ci-required and select, and complete successful related legs or one explicitly skipped empty related matrix",
        }),
      );
});

/**
 * The full run on `branch` that `head` is judged by: the newest at the head, else the newest older one.
 * `docs` says the change is docs only (@kalfa/ci/DocsOnly), which lets its automatic check prove the head.
 */
export const fullRunAt = Effect.fn("Arm.fullRunAt")(function* (branch: string, head: string, docs: boolean) {
  const runs = yield* Runs;
  const { at, newest } = pick(head, yield* runs.on(WORKFLOW, branch));

  if (Option.isSome(at)) {
    return FullRun.cases.at.make({ verdict: yield* judge(at.value) });
  }

  const automatic = yield* automaticAt(branch, head, docs);

  if (Option.isSome(automatic)) {
    return FullRun.cases.at.make({ verdict: automatic.value });
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
export class NotArmed extends Schema.TaggedError<NotArmed, { readonly brand: unique symbol }>()("NotArmed", {
  reason: Schema.String,
}) {}

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
  armed: { pr: Schema.Finite, oid: Schema.String, readied: Schema.Boolean, full: Schema.String },
  merged: { pr: Schema.Finite, commit: Schema.String },
});

export type Armed = typeof Armed.Type;

const runUrl = (repo: string, run: number) => `https://github.com/${repo}/actions/runs/${run}`;

/** Each job that is not green, its failed steps, and what its log says failed. */
const redReport = Effect.fn("Arm.redReport")(function* (
  repo: string,
  run: number,
  jobs: ReadonlyArray<Job>,
  reason?: string,
) {
  const checks = yield* Checks;
  const lines = [`the full run ${runUrl(repo, run)} is not green on every job:`];

  if (reason !== undefined) {
    lines.push(`  ${reason}`);
  }

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

const proofNote = "automatic ready and queue CI provide the required checks";

/** The line a head with no full run of its own is armed with (0544). */
const unrunNote = (seen: string, oid: string, docs: boolean): string =>
  `no full run at ${oid.slice(0, 12)}${seen}; arming as 0544 allows (${
    docs ? "a docs-only pull request (@kalfa/ci/DocsOnly) starts no full run" : proofNote
  })`;

/** What a green run arms with: the kind of run it was, and the head it was green at. */
const judgedBy = (run: number, kind: Kind, oid: string): string => {
  const head = oid.slice(0, 12);

  if (kind === "full") {
    return `full run ${run} green on every job at ${head}`;
  }

  if (kind === "automatic") {
    return `automatic ready check ${run} green with related-test coverage at ${head}`;
  }

  if (kind === "docs") {
    return `automatic ready check ${run} green at ${head}: docs only (@kalfa/ci/DocsOnly), so CI skipped its heavy jobs and ci-required passed`;
  }

  return `changed-set run ${run} green on every job at ${head}, the tests this change reaches (0590)`;
};

export const arm = Effect.fn("Arm.arm")(function* (a: Ask) {
  const prs = yield* PullRequests;
  const found = yield* prs.view(a.pr);
  const refuse = (reason: string) => NotArmed.make({ reason: `pr ${found.number}: ${reason}` });

  if (found.state === "MERGED") {
    return Armed.cases.merged.make({ pr: found.number, commit: found.mergeCommit ?? found.oid });
  }

  const refused = refusal(found);

  if (refused !== null) {
    return yield* refuse(refused);
  }

  // Merge when ready merges later with no one watching, so the leak gate runs before it is turned on.
  yield* Leaks.gate(a.dir, found);

  const unnamed = Names.refusal(found.body, yield* prs.patches(found.number));

  if (unnamed !== null) {
    return yield* refuse(unnamed);
  }

  const files = yield* prs.files(found.number);
  const docs = docsOnly(files);

  const note = (seen: string) => Effect.succeed(unrunNote(seen, found.oid, docs));

  // A green run arms with its line; any other refuses, at the head or, with none there, at the older head.
  const judged = (
    verdict: Verdict,
    place: string,
    green: (run: number, kind: Kind) => Effect.Effect<string, NotArmed>,
  ) =>
    Verdict.match(verdict, {
      green: ({ run, kind }) => green(run, kind),
      unfinished: ({ run, status }) =>
        Effect.fail(
          refuse(`${place}: the full run ${runUrl(a.repo, run)} is ${status}, not ended; arm it once it is green`),
        ),
      red: ({ run, jobs, reason }) =>
        Effect.flatMap(redReport(a.repo, run, jobs, reason), (report) => Effect.fail(refuse(`${place}: ${report}`))),
    });

  const full = yield* fullRunAt(found.head, found.oid, docs);

  const said = yield* FullRun.match(full, {
    none: () => note(""),
    at: ({ verdict }) => judged(verdict, "at this head", (run, kind) => Effect.succeed(judgedBy(run, kind, found.oid))),
    older: ({ head, verdict }) => {
      const place = `no full run at this head, and at the older head ${head.slice(0, 12)}`;

      return judged(verdict, place, (run, kind) =>
        kind === "full"
          ? note(`, and the newest one, ${run} at the older head ${head.slice(0, 12)}, was green`)
          : Effect.fail(
              refuse(
                `${place}: the changed-set run ${runUrl(a.repo, run)} tested that head's change, not this one (0590); ${proofNote}`,
              ),
            ),
      );
    },
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
