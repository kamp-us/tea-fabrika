// Speed: how fast CI took pull requests to main, against the owner's goal, and how much of the
// runners it used. Pure: it reads facts GitHub gave (History.ts) and answers numbers. ci-speed.ts
// prints them each day. Today's lead tooling; it is not product.
//
//   stage   from                                    to
//   pr      the run that made the merged head green  its last job's end
//   queue   the last time the PR entered the queue   merged
//   merge   the first run at the merged head         merged (the push that head came from)
//
// A stage's numbers are over the pull requests merged in the window. A PR merged without the queue
// (an admin merge) has no queue number, and still counts in the other two.
import { Option, Schema } from "effect";

/** One stage's goal, in minutes: the median, and the worst 10% (the 90th percentile). */
export type Goal = { readonly median: number; readonly worst: number };

/** The owner's goal for each stage (experiment 293). */
export const GOALS = {
  pr: { median: 3, worst: 5 },
  queue: { median: 3, worst: 5 },
  merge: { median: 8, worst: 15 },
} as const satisfies Record<string, Goal>;

export type StageName = keyof typeof GOALS;

/** The concurrent jobs GitHub gives the account's public repositories: the capacity's 100%. */
export const RUNNERS = 20;

/** One workflow run as GitHub lists it. `branch` is the head branch; `sha` its head commit. */
export const Run = Schema.Struct({
  id: Schema.Number,
  workflow: Schema.String,
  event: Schema.String,
  branch: Schema.String,
  sha: Schema.String,
  conclusion: Schema.NullOr(Schema.String),
  created: Schema.String,
  updated: Schema.String,
});
export type Run = typeof Run.Type;

/** One job of a run. `runner` is null for a job no machine ever took (skipped, or canceled while queued). */
export const Job = Schema.Struct({
  run: Schema.Number,
  name: Schema.String,
  conclusion: Schema.NullOr(Schema.String),
  runner: Schema.NullOr(Schema.String),
  started: Schema.NullOr(Schema.String),
  completed: Schema.NullOr(Schema.String),
});
export type Job = typeof Job.Type;

/** One merged pull request: its branch, when it merged, and each time it entered the merge queue. */
export const Pull = Schema.Struct({
  number: Schema.Number,
  branch: Schema.String,
  merged: Schema.String,
  queued: Schema.Array(Schema.String),
});
export type Pull = typeof Pull.Type;

/** One stage over the window: how many PRs it has a number for, and its median and worst 10%. */
export type Stage = {
  readonly name: StageName;
  readonly goal: Goal;
  readonly count: number;
  readonly median: Option.Option<number>;
  readonly worst: Option.Option<number>;
  readonly over: boolean;
};

/** The day's measure: the three stages, and the runners' use. */
export type Report = {
  readonly hours: number;
  readonly pulls: number;
  readonly stages: ReadonlyArray<Stage>;
  /** Machine-minutes of every job that had a runner, inside the window, per hour. */
  readonly perHour: number;
  /** `perHour` as a share of RUNNERS machines busy all hour, in percent. */
  readonly capacity: number;
};

const at = (iso: string): number => Date.parse(iso);
const minutes = (from: number, to: number): number => (to - from) / 60_000;

/** The nearest-rank percentile: the smallest value at least `p` of them do not exceed; none when empty. */
export const percentile = (values: ReadonlyArray<number>, p: number): Option.Option<number> => {
  const sorted = values.toSorted((a, b) => a - b);
  const rank = Math.min(sorted.length, Math.max(1, Math.ceil(p * sorted.length)));
  return Option.fromUndefinedOr(sorted[rank - 1]);
};

/** When a run ended: its last job's end, else GitHub's last update of the run. */
const endedAt = (run: Run, jobs: ReadonlyArray<Job>): number => {
  const ends = jobs.flatMap((job) => (job.completed === null ? [] : [at(job.completed)]));
  return ends.length === 0 ? at(run.updated) : Math.max(...ends);
};

/** One merged PR's three numbers, each none when GitHub kept no fact for it. */
type Times = { readonly [K in StageName]: Option.Option<number> };

/** A PR's last push: the runs at the head it merged with, oldest first, and its last queue entry. */
const lastPush = (pull: Pull, runs: ReadonlyArray<Run>) => {
  const merged = at(pull.merged);
  const entered = pull.queued.map(at).filter((t) => t <= merged);
  const queued = entered.length === 0 ? Option.none<number>() : Option.some(Math.max(...entered));
  const cutoff = Option.getOrElse(queued, () => merged);
  // A run after the PR entered the queue cannot be of the head that merged.
  const before = runs
    .filter((run) => run.event === "pull_request" && run.branch === pull.branch && at(run.created) <= cutoff)
    .toSorted((a, b) => at(a.created) - at(b.created));
  const head = before.at(-1)?.sha;
  return { merged, queued, atHead: before.filter((run) => run.sha === head) };
};

/**
 * One PR's times. Its last push is the head of its newest pull request run before it entered the
 * queue (or merged); the push's time is the first run at that head, and the PR stage is that
 * head's last green run.
 */
export const timesFor = (pull: Pull, runs: ReadonlyArray<Run>, jobs: (run: number) => ReadonlyArray<Job>): Times => {
  const { merged, queued, atHead } = lastPush(pull, runs);
  const ready = Option.fromUndefinedOr(atHead.filter((run) => run.conclusion === "success").at(-1));
  return {
    pr: Option.map(ready, (run) => minutes(at(run.created), endedAt(run, jobs(run.id)))),
    queue: Option.map(queued, (t) => minutes(t, merged)),
    merge: Option.map(Option.fromUndefinedOr(atHead[0]), (run) => minutes(at(run.created), merged)),
  };
};

/** The runs whose jobs `timesFor` reads: each pull's green runs at its last push. */
export const readyRuns = (pulls: ReadonlyArray<Pull>, runs: ReadonlyArray<Run>): ReadonlyArray<number> => [
  ...new Set(
    pulls.flatMap((pull) =>
      lastPush(pull, runs)
        .atHead.filter((run) => run.conclusion === "success")
        .map((run) => run.id),
    ),
  ),
];

/** A stage from its PRs' numbers, flagged over when its median or its worst 10% is past the goal. */
export const stageFor = (name: StageName, values: ReadonlyArray<number>): Stage => {
  const goal = GOALS[name];
  const median = percentile(values, 0.5);
  const worst = percentile(values, 0.9);
  const past = (value: Option.Option<number>, limit: number) => Option.exists(value, (v) => v > limit);
  return {
    name,
    goal,
    count: values.length,
    median,
    worst,
    over: past(median, goal.median) || past(worst, goal.worst),
  };
};

/** Machine-minutes of the jobs that had a runner, each cut to [from, to). */
export const busyMinutes = (jobs: ReadonlyArray<Job>, from: number, to: number): number =>
  jobs.reduce((sum, job) => {
    if (job.runner === null || job.started === null || job.completed === null) {
      return sum;
    }

    const start = Math.max(from, at(job.started));
    const end = Math.min(to, at(job.completed));
    return end > start ? sum + minutes(start, end) : sum;
  }, 0);

/** What the measure reads: the window's end, its length, and GitHub's facts. */
export type Facts = {
  readonly now: number;
  readonly hours: number;
  readonly pulls: ReadonlyArray<Pull>;
  /** check.yaml's runs, from before the window too, so a PR's first push inside it is found. */
  readonly runs: ReadonlyArray<Run>;
  /** The jobs of each run the measure needs: the window's runs of every workflow, and the ready runs. */
  readonly jobs: ReadonlyArray<Job>;
};

/** The day's measure. A PR counts when it merged inside the window; a job's minutes when they fell inside it. */
export const report = (facts: Facts): Report => {
  const from = facts.now - facts.hours * 3_600_000;
  const byRun = Map.groupBy(facts.jobs, (job) => job.run);
  const jobs = (run: number) => byRun.get(run) ?? [];
  const pulls = facts.pulls.filter((pull) => at(pull.merged) >= from && at(pull.merged) <= facts.now);
  const times = pulls.map((pull) => timesFor(pull, facts.runs, jobs));
  const values = (name: StageName) => times.flatMap((t) => Option.toArray(t[name]));
  const perHour = busyMinutes(facts.jobs, from, facts.now) / facts.hours;
  return {
    hours: facts.hours,
    pulls: pulls.length,
    stages: (["pr", "queue", "merge"] as const).map((name) => stageFor(name, values(name))),
    perHour,
    capacity: (perHour / (60 * RUNNERS)) * 100,
  };
};

/** The words for each stage, as a person reads the goal. */
const LABEL: Record<StageName, string> = {
  pr: "PR checks, ready to green",
  queue: "Merge queue, entering to merged",
  merge: "Last push to merged",
};

const shown = (value: Option.Option<number>) => Option.match(value, { onNone: () => "-", onSome: (v) => v.toFixed(1) });

/** The report as Markdown, for a terminal and for a job summary: one table, then the runners' use. */
export const markdown = (r: Report): string => {
  const rows = r.stages.map(
    (s) =>
      `| ${LABEL[s.name]} | ${s.count} | ${shown(s.median)} | ${shown(s.worst)} | ${s.goal.median} / ${s.goal.worst} | ${s.over ? "**over**" : "ok"} |`,
  );
  const over = r.stages.filter((s) => s.over).map((s) => LABEL[s.name]);
  return [
    `## CI speed, the last ${r.hours} hours`,
    "",
    `${r.pulls} pull requests merged. Minutes, median and worst 10%.`,
    "",
    "| Stage | PRs | Median | Worst 10% | Goal | |",
    "|---|---|---|---|---|---|",
    ...rows,
    "",
    `Runners: ${r.perHour.toFixed(0)} machine-minutes an hour, ${r.capacity.toFixed(0)}% of ${RUNNERS} machines.`,
    "",
    over.length === 0 ? "Every stage is within its goal." : `Over its goal: ${over.join(", ")}.`,
  ].join("\n");
};

/** An open issue as GitHub lists it. */
export type Issue = { readonly number: number; readonly title: string };

/** The one label automation may open issues with here (0534, 0541), and the title this measure's issue starts with. */
export const LABEL_NAME = "ci-scheduled";
export const TITLE = "CI speed: a stage is over its goal";

/** What the daily run does with its issue: open one, add to the open one, close it, or nothing. */
export const Move = Schema.TaggedUnion({
  open: {},
  comment: { number: Schema.Number },
  close: { number: Schema.Number },
  none: {},
});
export type Move = typeof Move.Type;

/** Over goal: add to this measure's open issue, or open one. Within it: close the open one, if any. */
export const moveFor = (r: Report, open: ReadonlyArray<Issue>): Move => {
  const ours = open.find((issue) => issue.title.startsWith("CI speed"));
  const over = r.stages.some((s) => s.over);

  if (over) {
    return ours === undefined ? Move.cases.open.make({}) : Move.cases.comment.make({ number: ours.number });
  }

  return ours === undefined ? Move.cases.none.make({}) : Move.cases.close.make({ number: ours.number });
};
