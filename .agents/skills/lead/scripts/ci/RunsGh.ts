// RunsGh.layer: the Runs service on GitHub's REST API, through `gh api`, the one way the lead
// tooling reaches GitHub (ChecksGh.ts does the same). It reads; it never writes. Runs come from
// "List workflow runs for a workflow", filtered by branch; jobs from "List jobs for a workflow run",
// whose default filter is the latest attempt, with each job's steps.
import { Effect, Layer, Schema } from "effect";
import { ChildProcessSpawner } from "effect/process";
import { lastLine, run } from "../pr/command.ts";
import { type Job, type Run, Runs, RunsError } from "./Runs.ts";

/** The newest runs one read asks for: a branch's full runs are started by hand, a few a day at most. */
export const NEWEST = 30;

const RunsBody = Schema.fromJsonString(
  Schema.Struct({
    workflow_runs: Schema.Array(
      Schema.Struct({
        id: Schema.Number,
        head_sha: Schema.String,
        status: Schema.String,
        conclusion: Schema.NullOr(Schema.String),
      }),
    ),
  }),
);

/** The runs in one page of a workflow's runs, in GitHub's order, newest first. */
export const runsIn = (body: string): Effect.Effect<ReadonlyArray<Run>, Schema.SchemaError> =>
  Effect.map(Schema.decodeUnknownEffect(RunsBody)(body), ({ workflow_runs }) =>
    workflow_runs.map((r) => ({ id: r.id, head: r.head_sha, status: r.status, conclusion: r.conclusion })),
  );

const StepBody = Schema.Struct({
  name: Schema.String,
  status: Schema.String,
  conclusion: Schema.NullOr(Schema.String),
});

const JobsBody = Schema.fromJsonString(
  Schema.Struct({
    jobs: Schema.Array(
      Schema.Struct({
        id: Schema.Number,
        name: Schema.String,
        status: Schema.String,
        conclusion: Schema.NullOr(Schema.String),
        // A job no machine took yet lists no steps at all.
        steps: Schema.optional(Schema.Array(StepBody)),
      }),
    ),
  }),
);

/** A run's jobs, each with its steps; a job that lists none has none. */
export const jobsIn = (body: string): Effect.Effect<ReadonlyArray<Job>, Schema.SchemaError> =>
  Effect.map(Schema.decodeUnknownEffect(JobsBody)(body), ({ jobs }) =>
    jobs.map((j) => ({ id: j.id, name: j.name, status: j.status, conclusion: j.conclusion, steps: j.steps ?? [] })),
  );

/** `repo` is `owner/name`; `cwd` is any folder gh may start in. */
export const layer = (repo: string, cwd: string): Layer.Layer<Runs, never, ChildProcessSpawner.ChildProcessSpawner> =>
  Layer.effect(
    Runs,
    Effect.gen(function* () {
      const spawner = yield* ChildProcessSpawner.ChildProcessSpawner;

      /** One `gh api` read; any exit but 0 fails it with gh's own last line. */
      const gh = Effect.fn("RunsGh.gh")(
        function* (path: string, query: ReadonlyArray<string>) {
          const ran = yield* run("gh", ["api", "-X", "GET", path, ...query], cwd);

          if (ran.code !== 0) {
            return yield* new RunsError({ reason: `gh api ${path} exited ${ran.code}: ${lastLine(ran)}` });
          }

          return ran.out;
        },
        Effect.provideService(ChildProcessSpawner.ChildProcessSpawner, spawner),
        Effect.catchTag("PlatformError", (e) =>
          Effect.fail(new RunsError({ reason: `gh could not start: ${e.message}` })),
        ),
      );

      const on = Effect.fn("RunsGh.on")(function* (workflow: string, branch: string) {
        const path = `repos/${repo}/actions/workflows/${workflow}/runs`;
        const body = yield* gh(path, ["-f", `branch=${branch}`, "-f", `per_page=${NEWEST}`]);

        return yield* runsIn(body).pipe(
          Effect.mapError(() => new RunsError({ reason: `the ${workflow} runs on ${branch} did not parse` })),
        );
      });

      const jobs = Effect.fn("RunsGh.jobs")(function* (id: number) {
        const body = yield* gh(`repos/${repo}/actions/runs/${id}/jobs`, ["-f", "per_page=100"]);

        return yield* jobsIn(body).pipe(
          Effect.mapError(() => new RunsError({ reason: `run ${id}'s jobs did not parse` })),
        );
      });

      return Runs.of({ on, jobs });
    }),
  );
