import { Array as Arr, String as Str, DateTime, Effect, Layer, Schema } from "effect";
// WorkflowRunsGh.layer: the WorkflowRuns service on `gh`, the one way the sev script reaches
// GitHub Actions. Every call names the repo, so the checkout it runs in does not pick it.
//
// `unfinished` asks once per status that is not `completed`. One list of the newest runs would
// miss an old queued run once enough newer runs had finished, and `gh run list --status` takes one
// status a call. Five calls a beat of 20 seconds is 900 an hour, under the 5,000 a login gets
// (GitHub's REST docs, "Rate limits for the REST API").
//
// `cancel` posts to GitHub's cancel endpoint with `gh api`: one call, and GitHub's own words when
// it refuses. `gh run cancel` makes three (it reads the run and its workflow first), and it words
// every 409 as "Cannot cancel a workflow run that is completed", even GitHub's "Cannot cancel a
// workflow run that has not been queued yet" (gh 2.104.0 with GH_DEBUG=api, 2026-11-18).
//
// A call GitHub refuses for its rate limit fails as `RateLimited`, with the time it takes calls
// again read from `gh api rate_limit`, which spends none of the limit (the same REST docs).
import { ChildProcessSpawner } from "effect/process";
import { lastLine, run } from "../../lead/scripts/pr/command.ts";
import { RateLimited, type Run, WorkflowRuns, WorkflowRunsError } from "./WorkflowRuns.ts";

/** Each status GitHub gives a run before it completes (`gh run list --help`). */
export const UNFINISHED = ["queued", "in_progress", "waiting", "requested", "pending"] as const;

/** The most runs one list call reads; one status this full means more runs than a sev0 expects. */
const LIMIT = 200;

const FIELDS = "databaseId,workflowName,event,headBranch,headSha,status,conclusion,createdAt";

const Listed = Schema.fromJsonString(
  Schema.Array(
    Schema.Struct({
      databaseId: Schema.Finite,
      workflowName: Schema.String,
      event: Schema.String,
      headBranch: Schema.String,
      headSha: Schema.String,
      status: Schema.String,
      conclusion: Schema.String,
      createdAt: Schema.String,
    }),
  ),
);

/** `gh run list --json`'s rows, as `Run`s; gh writes an empty conclusion before a run completes. */
export const runsIn = (out: string): Effect.Effect<ReadonlyArray<Run>, Schema.SchemaError> =>
  Effect.map(Schema.decodeEffect(Listed)(Str.trim(out) || "[]"), (rows) =>
    Arr.map(rows, (r): Run => ({
      id: r.databaseId,
      workflow: r.workflowName,
      event: r.event,
      branch: r.headBranch,
      sha: r.headSha,
      status: r.status,
      conclusion: r.conclusion === "" ? null : r.conclusion,
      created: r.createdAt,
    })),
  );

/** The REST numbers of `gh api rate_limit`: the calls left, and when the count starts again, in epoch seconds. */
const Core = Schema.fromJsonString(Schema.Struct({ remaining: Schema.Finite, reset: Schema.Finite }));

/**
 * When GitHub takes calls again, from `gh api rate_limit --jq .resources.core` and the time now: at
 * `reset` once no call is left, else in a minute, GitHub's rule for a secondary limit (REST docs,
 * "Best practices for using the REST API").
 */
export const retryAt = (out: string, now: DateTime.Utc): Effect.Effect<DateTime.Utc, Schema.SchemaError> =>
  Effect.map(Schema.decodeEffect(Core)(Str.trim(out)), (core) =>
    core.remaining === 0 ? DateTime.makeUnsafe(core.reset * 1000) : DateTime.add(now, { minutes: 1 }),
  );

/** `repo` is `owner/name`; `cwd` is any folder gh may start in. */
export const layer = (
  repo: string,
  cwd: string,
): Layer.Layer<WorkflowRuns, never, ChildProcessSpawner.ChildProcessSpawner> =>
  Layer.effect(
    WorkflowRuns,
    Effect.gen(function* () {
      const spawner = yield* ChildProcessSpawner.ChildProcessSpawner;

      /** When GitHub takes calls again; in a minute when its rate limit cannot be read. */
      const until = Effect.gen(function* () {
        const now = yield* DateTime.now;
        const asked = yield* run("gh", ["api", "rate_limit", "--jq", ".resources.core"], cwd);

        return yield* Effect.orElseSucceed(retryAt(asked.out, now), () => DateTime.add(now, { minutes: 1 }));
      });

      /** One gh call; any exit but 0 fails it with gh's own last line, as `RateLimited` for a rate limit. */
      const gh = Effect.fn("WorkflowRunsGh.gh")(
        function* (args: ReadonlyArray<string>) {
          const ran = yield* run("gh", args, cwd);

          if (ran.code === 0) {
            return ran.out;
          }

          const reason = `gh ${Arr.join(args.slice(0, 2), " ")} exited ${ran.code}: ${lastLine(ran)}`;

          if (!Str.includes("rate limit")(reason)) {
            return yield* WorkflowRunsError.make({ reason });
          }

          return yield* RateLimited.make({ until: yield* until, reason });
        },
        Effect.provideService(ChildProcessSpawner.ChildProcessSpawner, spawner),
        Effect.catchTag("PlatformError", (e) =>
          Effect.fail(WorkflowRunsError.make({ reason: `gh could not start: ${e.message}` })),
        ),
      );

      const list = Effect.fn("WorkflowRunsGh.list")(function* (args: ReadonlyArray<string>) {
        const out = yield* gh(["run", "list", "-R", repo, "--json", FIELDS, "-L", String(LIMIT), ...args]);

        const runs = yield* runsIn(out).pipe(
          Effect.mapError(() => WorkflowRunsError.make({ reason: "gh run list answered a shape we do not read" })),
        );

        if (runs.length >= LIMIT) {
          return yield* WorkflowRunsError.make({
            reason: `${LIMIT} or more runs in one list: one read cannot hold all`,
          });
        }

        return runs;
      });

      const unfinished = Effect.map(
        Effect.forEach(UNFINISHED, (status) => list(["--status", status]), { concurrency: UNFINISHED.length }),
        (lists) => lists.flat(),
      );

      const cancel = (id: number) =>
        Effect.asVoid(gh(["api", `repos/${repo}/actions/runs/${id}/cancel`, "--method", "POST"]));

      return WorkflowRuns.of({ unfinished, cancel });
    }),
  );
