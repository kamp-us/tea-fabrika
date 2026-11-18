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
        id: Schema.Finite,
        head_sha: Schema.String,
        status: Schema.String,
        conclusion: Schema.NullOr(Schema.String),
        event: Schema.optional(Schema.String),
        path: Schema.optional(Schema.String),
        repository: Schema.optional(Schema.Struct({ id: Schema.Finite })),
        head_repository: Schema.optional(Schema.NullOr(Schema.Struct({ id: Schema.Finite }))),
      }),
    ),
  }),
);

/** The runs in one page of a workflow's runs, in GitHub's order, newest first. */
export const runsIn = (body: string): Effect.Effect<ReadonlyArray<Run>, Schema.SchemaError> =>
  Effect.map(Schema.decodeEffect(RunsBody)(body), ({ workflow_runs }) =>
    workflow_runs.map((r) => ({
      id: r.id,
      head: r.head_sha,
      status: r.status,
      conclusion: r.conclusion,
      ...(r.event !== undefined && r.path !== undefined && r.repository !== undefined && r.head_repository != null
        ? {
            source: {
              event: r.event,
              path: r.path,
              repository: r.repository.id,
              headRepository: r.head_repository.id,
            },
          }
        : {}),
    })),
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
        id: Schema.Finite,
        name: Schema.String,
        status: Schema.String,
        conclusion: Schema.NullOr(Schema.String),
        // A job no machine took yet lists no steps at all.
        steps: Schema.optional(Schema.Array(StepBody)),
      }),
    ),
  }),
);

const Head = Schema.String.check(Schema.isPattern(/^[0-9a-f]{40}$/));

const RefBody = Schema.fromJsonString(
  Schema.Struct({ object: Schema.Struct({ type: Schema.Literal("commit"), sha: Head }) }),
);

/** A run's jobs, each with its steps; a job that lists none has none. */
export const jobsIn = (body: string): Effect.Effect<ReadonlyArray<Job>, Schema.SchemaError> =>
  Effect.map(Schema.decodeEffect(JobsBody)(body), ({ jobs }) =>
    jobs.map((j) => ({ id: j.id, name: j.name, status: j.status, conclusion: j.conclusion, steps: j.steps ?? [] })),
  );

/** `repo` is `owner/name`; `cwd` is the trusted repo checkout whose SC19 checker reads candidate YAML. */
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
            return yield* RunsError.make({ reason: `gh api ${path} exited ${ran.code}: ${lastLine(ran)}` });
          }

          return ran.out;
        },
        Effect.provideService(ChildProcessSpawner.ChildProcessSpawner, spawner),
        Effect.catchTag("PlatformError", (e) =>
          Effect.fail(RunsError.make({ reason: `gh could not start: ${e.message}` })),
        ),
      );

      const on = Effect.fn("RunsGh.on")(function* (workflow: string, branch: string) {
        const path = `repos/${repo}/actions/workflows/${workflow}/runs`;
        const body = yield* gh(path, ["-f", `branch=${branch}`, "-f", `per_page=${NEWEST}`]);

        return yield* runsIn(body).pipe(
          Effect.mapError(() => RunsError.make({ reason: `the ${workflow} runs on ${branch} did not parse` })),
        );
      });

      const jobs = Effect.fn("RunsGh.jobs")(function* (id: number) {
        const body = yield* gh(`repos/${repo}/actions/runs/${id}/jobs`, ["-f", "per_page=100"]);

        return yield* jobsIn(body).pipe(
          Effect.mapError(() => RunsError.make({ reason: `run ${id}'s jobs did not parse` })),
        );
      });

      const preflight = Effect.fn("RunsGh.preflight")(
        function* (branch: string, head: string) {
          yield* Schema.decodeEffect(Head)(head).pipe(
            Effect.mapError(() => RunsError.make({ reason: "proof needs an exact forty-character commit SHA" })),
          );

          const ref = yield* gh(`repos/${repo}/git/ref/heads/${encodeURIComponent(branch)}`, []);

          const found = yield* Schema.decodeEffect(RefBody)(ref).pipe(
            Effect.mapError(() => RunsError.make({ reason: `the branch head of ${branch} did not parse` })),
          );

          if (found.object.sha !== head) {
            return yield* RunsError.make({
              reason: `${branch} moved from ${head} to ${found.object.sha}; read its current head first`,
            });
          }

          const text = yield* gh(`repos/${repo}/contents/.github/workflows/scheduled.yaml`, [
            "-f",
            `ref=${head}`,
            "-H",
            "Accept: application/vnd.github.raw+json",
          ]);

          // Run the trusted local linter, never code read from the requested branch.
          const checked = yield* run("node", [".github/ci/workflow-lint/scheduled.ts", "--job-slots"], cwd, {
            stdin: text,
          });

          if (checked.code !== 0 || checked.out.trim() !== "scheduled job slots conform") {
            return yield* RunsError.make({
              reason: `new proof on ${branch} at ${head} refused: ${lastLine(checked) || "the trusted job-slot check did not confirm conformance"}`,
            });
          }
        },
        Effect.provideService(ChildProcessSpawner.ChildProcessSpawner, spawner),
        Effect.catchTag("PlatformError", (e) =>
          Effect.fail(RunsError.make({ reason: `the proof preflight could not start: ${e.message}` })),
        ),
      );

      return Runs.of({ on, jobs, preflight });
    }),
  );
