// WorkflowRunsGh.layer: the WorkflowRuns service on `gh run`, the one way the sev script reaches
// GitHub Actions. Every call names the repo, so the checkout it runs in does not pick it.
//
// `unfinished` asks once per status that is not `completed`. One list of the newest runs would
// miss an old queued run once enough newer runs had finished, and `gh run list --status` takes one
// status a call. Five calls a beat of 20 seconds is 900 an hour, under the 5,000 a login gets
// (GitHub's REST docs, "Rate limits for the REST API").
import { Effect, Layer, Schema } from "effect";
import { ChildProcessSpawner } from "effect/process";
import { lastLine, run } from "../../lead/scripts/pr/command.ts";
import { type Run, WorkflowRuns, WorkflowRunsError } from "./WorkflowRuns.ts";

/** Each status GitHub gives a run before it completes (`gh run list --help`). */
export const UNFINISHED = ["queued", "in_progress", "waiting", "requested", "pending"] as const;

/** The most runs one list call reads; one status this full means more runs than a sev0 expects. */
const LIMIT = 200;

const FIELDS = "databaseId,workflowName,event,headBranch,headSha,status,conclusion,createdAt";

const Listed = Schema.fromJsonString(
  Schema.Array(
    Schema.Struct({
      databaseId: Schema.Number,
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
  Effect.map(Schema.decodeUnknownEffect(Listed)(out.trim() || "[]"), (rows) =>
    rows.map((r): Run => ({
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

/** `repo` is `owner/name`; `cwd` is any folder gh may start in. */
export const layer = (
  repo: string,
  cwd: string,
): Layer.Layer<WorkflowRuns, never, ChildProcessSpawner.ChildProcessSpawner> =>
  Layer.effect(
    WorkflowRuns,
    Effect.gen(function* () {
      const spawner = yield* ChildProcessSpawner.ChildProcessSpawner;

      /** One gh call; any exit but 0 fails it with gh's own last line. */
      const gh = Effect.fn("WorkflowRunsGh.gh")(
        function* (args: ReadonlyArray<string>) {
          const ran = yield* run("gh", args, cwd);

          if (ran.code !== 0) {
            return yield* new WorkflowRunsError({
              reason: `gh ${args.slice(0, 2).join(" ")} exited ${ran.code}: ${lastLine(ran)}`,
            });
          }

          return ran.out;
        },
        Effect.provideService(ChildProcessSpawner.ChildProcessSpawner, spawner),
        Effect.catchTag("PlatformError", (e) =>
          Effect.fail(new WorkflowRunsError({ reason: `gh could not start: ${e.message}` })),
        ),
      );

      const list = Effect.fn("WorkflowRunsGh.list")(function* (args: ReadonlyArray<string>) {
        const out = yield* gh(["run", "list", "-R", repo, "--json", FIELDS, "-L", String(LIMIT), ...args]);

        const runs = yield* runsIn(out).pipe(
          Effect.mapError(() => new WorkflowRunsError({ reason: "gh run list answered a shape we do not read" })),
        );

        if (runs.length >= LIMIT) {
          return yield* new WorkflowRunsError({
            reason: `${LIMIT} or more runs in one list: one read cannot hold all`,
          });
        }

        return runs;
      });

      const unfinished = Effect.map(
        Effect.forEach(UNFINISHED, (status) => list(["--status", status]), { concurrency: UNFINISHED.length }),
        (lists) => lists.flat(),
      );

      const cancel = (id: number) => Effect.asVoid(gh(["run", "cancel", String(id), "-R", repo]));

      return WorkflowRuns.of({ unfinished, cancel });
    }),
  );
