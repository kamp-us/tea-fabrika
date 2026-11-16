// Today's CI, both workflows. Each test leg's time table: how long each of the job's steps took
// (GitHub's jobs API) and the leg's slowest test files (its Vitest JSON report), in the job summary,
// and the same numbers as one small JSON file the leg uploads, so each leg's balance shows on every
// run and can be followed over time. Advice only: a missing or broken input gives an unavailable
// section and the rest still prints, and the program exits 0 whatever it read.
//
//   check.yaml       next legs                   report $RUNNER_TEMP/next.json
//   scheduled.yaml   next legs and tooling legs  report $RUNNER_TEMP/results.json
import { appendFileSync, readFileSync, writeFileSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import * as Console from "effect/Console";
import type * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as Result from "effect/Result";
import * as Schedule from "effect/Schedule";
import * as Schema from "effect/Schema";

/** The step's name in every test leg; it times the steps before it. workflow-lint.ts holds both. */
export const STEP = "time table";
/** How many test files the summary lists, slowest first. The artifact keeps them all. */
export const SLOWEST = 10;
/** How often to ask the jobs API before the steps before this one all show an end, 2 s apart. */
export const TRIES = 5;
export const PAUSE: Duration.Input = "2 seconds";

/** One step of the job, as the jobs API gave it. `start` and `end` are null until it has them. */
export type Step = {
  readonly name: string;
  readonly result: string;
  readonly start: string | null;
  readonly end: string | null;
};

/** One test file of the leg's report. No test output: only what the balance needs. */
export type TestFile = {
  readonly path: string;
  readonly seconds: number;
  readonly tests: number;
  readonly result: string;
};

/** What a section read, or why it could not. */
export type Section<A> =
  | { readonly _tag: "read"; readonly rows: readonly A[] }
  | { readonly _tag: "unavailable"; readonly reason: string };

/** Which leg of which run, each as GitHub's environment gives it. */
export type Leg = {
  readonly run: string;
  readonly attempt: string;
  readonly workflow: string;
  readonly event: string;
  readonly sha: string;
  readonly job: string;
  readonly leg: string;
};

/** The artifact: one leg's steps and test files. */
export type Timings = Leg & { readonly steps: Section<Step>; readonly files: Section<TestFile> };

const Time = Schema.NullOr(Schema.String.check(Schema.isPattern(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/)));

// GitHub's "Get a job for a workflow run": only the fields read here; the rest are ignored.
const Job = Schema.Struct({
  steps: Schema.Array(
    Schema.Struct({
      name: Schema.String,
      status: Schema.String,
      conclusion: Schema.optionalKey(Schema.NullOr(Schema.String)),
      started_at: Schema.optionalKey(Time),
      completed_at: Schema.optionalKey(Time),
    }),
  ),
});

// Vitest's JSON reporter: one entry per test file, its times in milliseconds since the epoch.
const Report = Schema.Struct({
  testResults: Schema.Array(
    Schema.Struct({
      name: Schema.String,
      status: Schema.String,
      startTime: Schema.Finite,
      endTime: Schema.Finite,
      assertionResults: Schema.Array(Schema.Unknown),
    }),
  ),
});

/** An error's message on one line, short enough for a table's note. */
export const reasonOf = (error: unknown): string =>
  (error instanceof Error ? error.message : String(error)).replaceAll(/\s+/g, " ").trim().slice(0, 300) ||
  "no reason given";

const unavailable = <A>(reason: string): Section<A> => ({ _tag: "unavailable", reason });

/** The job's steps, in order, from a jobs API answer. */
export const readSteps = (input: unknown): Section<Step> => {
  const decoded = Schema.decodeUnknownResult(Job)(input);
  return Result.isSuccess(decoded)
    ? {
        _tag: "read",
        rows: decoded.success.steps.map((step) => ({
          name: step.name,
          result: step.conclusion ?? step.status,
          start: step.started_at ?? null,
          end: step.completed_at ?? null,
        })),
      }
    : unavailable(`the jobs API answer is not a job: ${reasonOf(decoded.failure)}`);
};

/** Each test file of a Vitest JSON report, its path from `root`. */
export const readFiles = (input: unknown, root: string): Section<TestFile> => {
  const decoded = Schema.decodeUnknownResult(Report)(input);
  return Result.isSuccess(decoded)
    ? {
        _tag: "read",
        rows: decoded.success.testResults.map((file) => ({
          path: relative(root, file.name),
          seconds: Math.max(0, file.endTime - file.startTime) / 1000,
          tests: file.assertionResults.length,
          result: file.status,
        })),
      }
    : unavailable(`the report is not Vitest's JSON: ${reasonOf(decoded.failure)}`);
};

/**
 * True once every step before this one shows an end. GitHub writes a step's end a moment after it
 * ends, so a table read at once can miss the step just before.
 */
export const settled = (steps: Section<Step>): boolean => {
  if (steps._tag === "unavailable") {
    return false;
  }

  const self = steps.rows.findIndex((step) => step.name === STEP);
  return self >= 0 && steps.rows.slice(0, self).every((step) => step.start === null || step.end !== null);
};

/** The artifact's file name, beside the leg's report: `timings-<job>-<leg>.json`. */
export const fileName = (leg: Pick<Leg, "job" | "leg">): string => `timings-${leg.job}-${leg.leg}.json`;

const seconds = (step: Step): number | null =>
  step.start === null || step.end === null ? null : (Date.parse(step.end) - Date.parse(step.start)) / 1000;

const cell = (text: string) => text.replaceAll("|", "\\|").replaceAll(/\s+/g, " ").trim();

const table = (header: readonly string[], right: readonly number[], rows: readonly (readonly string[])[]) =>
  [
    `| ${header.join(" | ")} |`,
    `| ${header.map((_, i) => (right.includes(i) ? "---:" : "---")).join(" | ")} |`,
    ...rows.map((row) => `| ${row.map(cell).join(" | ")} |`),
  ].join("\n");

const section = <A>(title: string, read: Section<A>, render: (rows: readonly A[]) => string) =>
  `### ${title}\n\n${read._tag === "read" ? render(read.rows) : `Unavailable: ${cell(read.reason)}`}`;

const stepTable = (rows: readonly Step[]) =>
  table(
    ["Step", "Result", "Seconds"],
    [2],
    rows
      .filter((step) => step.start !== null)
      .map((step) => {
        const took = seconds(step);
        return [step.name, step.result, took === null ? "-" : String(Math.round(took))];
      }),
  );

/** The slowest files first; files that took the same time, by path. */
export const slowest = (rows: readonly TestFile[]): TestFile[] =>
  rows.toSorted((a, b) => b.seconds - a.seconds || (a.path < b.path ? -1 : a.path > b.path ? 1 : 0)).slice(0, SLOWEST);

const fileTable = (rows: readonly TestFile[]) => {
  const total = rows.reduce((sum, file) => sum + file.seconds, 0);
  const listed = slowest(rows);
  return [
    `${rows.length} files, ${total.toFixed(1)} s in all. The ${listed.length} slowest:`,
    "",
    table(
      ["File", "Seconds", "Tests", "Result"],
      [1, 2],
      listed.map((file) => [file.path, file.seconds.toFixed(1), String(file.tests), file.result]),
    ),
  ].join("\n");
};

/** The job summary's Markdown for one leg. */
export const markdown = (timings: Timings): string =>
  [
    `## Time table: ${cell(timings.job)}, leg ${cell(timings.leg)}`,
    section("Steps", timings.steps, stepTable),
    section("Slowest test files", timings.files, fileTable),
    "",
  ].join("\n\n");

/**
 * What the program reads beyond its environment, so a law can hand it any answer or failure: the
 * jobs API's answer for a job id, and a file's text.
 */
export type Io = {
  readonly job: (id: string) => Effect.Effect<unknown, Unread>;
  readonly read: (path: string) => Effect.Effect<string, Unread>;
};

/** An input that could not be read: the network, GitHub's answer, a missing file or bad JSON. */
export class Unread extends Schema.TaggedError<Unread>()("Unread", { cause: Schema.Defect() }) {}

const legOf = (env: Readonly<Record<string, string | undefined>>): Leg => ({
  run: env["GITHUB_RUN_ID"] ?? "",
  attempt: env["GITHUB_RUN_ATTEMPT"] ?? "",
  workflow: env["GITHUB_WORKFLOW"] ?? "",
  event: env["GITHUB_EVENT_NAME"] ?? "",
  sha: env["HEAD"] ?? "",
  job: env["GITHUB_JOB"] ?? "",
  leg: env["LEG"] ?? "",
});

// The jobs API is asked once, then again `pause` apart until the steps before this one all show an
// end, at most TRIES times in all; the last answer stands.
const stepsOf = (id: string | undefined, io: Io, pause: Duration.Input): Effect.Effect<Section<Step>> =>
  id
    ? io.job(id).pipe(
        Effect.map(readSteps),
        Effect.catch((error) =>
          Effect.succeed(unavailable<Step>(`the jobs API could not be read: ${reasonOf(error.cause)}`)),
        ),
        Effect.repeat({ until: settled, times: TRIES - 1, schedule: Schedule.spaced(pause) }),
      )
    : Effect.succeed(unavailable("JOB_ID is not set"));

const filesOf = (path: string | undefined, root: string, io: Io): Effect.Effect<Section<TestFile>> =>
  path
    ? io.read(path).pipe(
        Effect.flatMap((text) => Effect.try({ try: () => JSON.parse(text), catch: (cause) => Unread.make({ cause }) })),
        Effect.map((report) => readFiles(report, root)),
        Effect.catch((error) =>
          Effect.succeed(unavailable<TestFile>(`the report could not be read: ${reasonOf(error.cause)}`)),
        ),
      )
    : Effect.succeed(unavailable("REPORT is not set"));

/**
 * One leg's timings from its environment and what `io` answers. It cannot fail. The two inputs are
 * read side by side: the report needs no wait on the jobs API's pauses.
 */
export const collect = (
  env: Readonly<Record<string, string | undefined>>,
  root: string,
  io: Io,
  pause: Duration.Input = PAUSE,
): Effect.Effect<Timings> =>
  Effect.all(
    { steps: stepsOf(env["JOB_ID"], io, pause), files: filesOf(env["REPORT"], root, io) },
    { concurrency: 2 },
  ).pipe(Effect.map(({ steps, files }) => ({ ...legOf(env), steps, files })));

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const env = process.env;
  const api = env["GITHUB_API_URL"] ?? "https://api.github.com";
  const io: Io = {
    job: (id) =>
      Effect.tryPromise({
        try: async (signal) => {
          const answer = await fetch(`${api}/repos/${env["GITHUB_REPOSITORY"]}/actions/jobs/${id}`, {
            headers: { authorization: `Bearer ${env["GITHUB_TOKEN"] ?? ""}`, accept: "application/vnd.github+json" },
            signal: AbortSignal.any([signal, AbortSignal.timeout(5000)]),
          });

          if (!answer.ok) {
            throw new Error(`GitHub answered ${answer.status}`);
          }

          return answer.json();
        },
        catch: (cause) => Unread.make({ cause }),
      }),
    read: (path) => Effect.try({ try: () => readFileSync(path, "utf8"), catch: (cause) => Unread.make({ cause }) }),
  };

  // The leg's file beside its report, its table in the job summary and the log. A write that fails
  // is said in the log; the step still exits 0.
  const write = (timings: Timings) =>
    Effect.try({
      try: () => {
        const text = markdown(timings);
        writeFileSync(join(env["RUNNER_TEMP"] ?? ".", fileName(timings)), `${JSON.stringify(timings)}\n`);
        return text;
      },
      catch: (cause) => Unread.make({ cause }),
    }).pipe(
      Effect.tap((text) => Console.log(text)),
      Effect.flatMap((text) =>
        Effect.try({
          try: () => {
            if (env["GITHUB_STEP_SUMMARY"]) {
              appendFileSync(env["GITHUB_STEP_SUMMARY"], text);
            }
          },
          catch: (cause) => Unread.make({ cause }),
        }),
      ),
    );

  await Effect.runPromise(
    collect(env, process.cwd(), io).pipe(
      Effect.flatMap(write),
      Effect.catch((error) => Console.log(`time-table: unavailable: ${reasonOf(error.cause)}`)),
    ),
  );
  process.exitCode = 0;
}
