import { Array as Arr, String as Str, DateTime, Effect, Layer, Option, Record as Rec, Schema } from "effect";
// WorkflowRunsGh.layer: the WorkflowRuns service on `gh api -i`, the one way the sev script reaches
// GitHub Actions. Every call names the repo, so the checkout it runs in does not pick it. `-i` prints
// GitHub's status line and headers before the body, on a refused answer too, so each failure keeps
// the status GitHub gave, and a rate limit is read from GitHub's own headers, never from gh's words.
//
// `unfinished` asks once per status that is not `completed`. One list of the newest runs would
// miss an old queued run once enough newer runs had finished, and the list takes one status a
// call. Five calls a beat of 20 seconds is 900 an hour, under the 5,000 a login gets (GitHub's REST
// docs, "Rate limits for the REST API").
//
// `cancel` is one call. `gh run cancel` makes three (it reads the run and its workflow first), and
// it words every 409 as "Cannot cancel a workflow run that is completed", even GitHub's "Cannot
// cancel a workflow run that has not been queued yet" (gh 2.104.0 with GH_DEBUG=api, 2026-11-18).
//
// A 403 or a 429 that names a wait fails as `RateLimited`, by the rules of today's `limitWait` in
// `packages/fabrika/src/host/keys-github.ts`. Its package does not export that file, and today's
// version takes no new exports (0217), so `retryAt` follows its rules rather than importing them.
import { ChildProcessSpawner } from "effect/process";
import { lastLine, run } from "../../lead/scripts/pr/command.ts";
import { RateLimited, type Run, WorkflowRuns, WorkflowRunsError } from "./WorkflowRuns.ts";

/** Each status GitHub gives a run before it completes (`gh run list --help`). */
export const UNFINISHED = ["queued", "in_progress", "waiting", "requested", "pending"] as const;

/** The most runs one list call reads: GitHub's largest page. More of one status is more than a sev0 expects. */
const PAGE = 100;

const Listed = Schema.fromJsonString(
  Schema.Struct({
    total_count: Schema.Finite,
    workflow_runs: Schema.Array(
      Schema.Struct({
        id: Schema.Finite,
        name: Schema.NullOr(Schema.String),
        event: Schema.String,
        head_branch: Schema.NullOr(Schema.String),
        head_sha: Schema.String,
        status: Schema.String,
        conclusion: Schema.NullOr(Schema.String),
        created_at: Schema.String,
      }),
    ),
  }),
);

/** One page of GitHub's list of runs, as `Run`s, and how many runs match in all. */
export const runsIn = (
  body: string,
): Effect.Effect<{ readonly total: number; readonly runs: ReadonlyArray<Run> }, Schema.SchemaError> =>
  Effect.map(Schema.decodeEffect(Listed)(body), (page) => ({
    total: page.total_count,
    runs: Arr.map(page.workflow_runs, (r): Run => ({
      id: r.id,
      workflow: r.name ?? "",
      event: r.event,
      branch: r.head_branch ?? "",
      sha: r.head_sha,
      status: r.status,
      conclusion: r.conclusion,
      created: r.created_at,
    })),
  }));

/** GitHub's answer as `gh api -i` prints it: the status, each header by its lowercase name, and the body. */
export type Answer = {
  readonly status: number;
  readonly headers: Readonly<Record<string, string>>;
  readonly body: string;
};

const STATUS_LINE = /^HTTP\/[0-9.]+ ([0-9]{3})(?: |$)/;

const HEADER = /^([!#$%&'*+.^_`|~0-9A-Za-z-]+):[ \t]*(.*?)[ \t]*$/;

/**
 * GitHub's answer in what `gh api -i` printed: a status line, headers up to a blank line, then the
 * body, the shape of an HTTP message (RFC 9112, section 2.1). None when it holds no status line, so
 * no answer came back.
 */
export const answerIn = (out: string): Option.Option<Answer> => {
  const gap = out.search(/\r?\n\r?\n/);
  const head = Str.split(gap === -1 ? out : out.slice(0, gap), /\r?\n/);
  const status = STATUS_LINE.exec(head[0] ?? "")?.[1];

  if (status === undefined) {
    return Option.none();
  }

  const headers = Rec.fromEntries(
    Arr.flatMap(head.slice(1), (line) => {
      const [, name, value] = HEADER.exec(line) ?? [];

      return name === undefined || value === undefined ? [] : [[Str.toLowerCase(name), value] as const];
    }),
  );

  return Option.some({
    status: Number(status),
    headers,
    body: gap === -1 ? "" : out.slice(gap).replace(/^\r?\n\r?\n/, ""),
  });
};

/** The longest wait for a spent rate limit, in ms: GitHub's limit is counted by the hour (`LIMIT_WAIT_MS`). */
const LONGEST = 60 * 60_000;

const DIGITS = /^[0-9]+$/;

const HttpDate = Schema.decodeOption(Schema.DateTimeUtcFromHttpDate);

/**
 * When GitHub takes calls again after an answer of `status` with these headers, or `null` when it
 * names no wait: `limitWait`'s rules, as a time. Only a 403 or a 429 counts. `retry-after` comes
 * first, as RFC 9110 section 10.2.3 gives it: seconds (digits only) or an HTTP date. Then
 * `x-ratelimit-reset` (seconds since 1970, digits only) when `x-ratelimit-remaining` is 0. A header
 * in any other shape is read as no header. Never before `now`, and at most an hour after it.
 */
export const retryAt = (
  status: number,
  headers: Readonly<Record<string, string>>,
  now: DateTime.Utc,
): DateTime.Utc | null => {
  if (status !== 403 && status !== 429) {
    return null;
  }

  const from = DateTime.toEpochMillis(now);
  const after = Str.trim(headers["retry-after"] ?? "");
  const reset = Str.trim(headers["x-ratelimit-reset"] ?? "");
  const date = HttpDate(after);
  const spent = Str.trim(headers["x-ratelimit-remaining"] ?? "") === "0" && DIGITS.test(reset);

  const at = DIGITS.test(after)
    ? from + Number(after) * 1000
    : Option.isSome(date)
      ? DateTime.toEpochMillis(date.value)
      : spent
        ? Number(reset) * 1000
        : null;

  return at === null ? null : DateTime.add(now, { milliseconds: Math.min(Math.max(at - from, 0), LONGEST) });
};

/** `repo` is `owner/name`; `cwd` is any folder gh may start in. */
export const layer = (
  repo: string,
  cwd: string,
): Layer.Layer<WorkflowRuns, never, ChildProcessSpawner.ChildProcessSpawner> =>
  Layer.effect(
    WorkflowRuns,
    Effect.gen(function* () {
      const spawner = yield* ChildProcessSpawner.ChildProcessSpawner;

      /**
       * One call to GitHub's REST API at `endpoint`, answering the body. Any exit but 0 fails it with
       * gh's own last line and GitHub's status: as `RateLimited` when the answer names a wait.
       */
      const gh = Effect.fn("WorkflowRunsGh.gh")(
        function* (endpoint: string, args: ReadonlyArray<string> = []) {
          const ran = yield* run("gh", ["api", "-i", endpoint, ...args], cwd);
          const answer = answerIn(ran.out);

          if (ran.code === 0 && Option.isSome(answer)) {
            return answer.value.body;
          }

          const reason = `gh api ${endpoint} exited ${ran.code}: ${lastLine(ran)}`;

          if (Option.isNone(answer)) {
            return yield* WorkflowRunsError.make({ reason, status: null });
          }

          const until = retryAt(answer.value.status, answer.value.headers, yield* DateTime.now);

          if (until !== null) {
            return yield* RateLimited.make({ until, reason });
          }

          return yield* WorkflowRunsError.make({ reason, status: answer.value.status });
        },
        Effect.provideService(ChildProcessSpawner.ChildProcessSpawner, spawner),
        Effect.catchTag("PlatformError", (e) =>
          Effect.fail(WorkflowRunsError.make({ reason: `gh could not start: ${e.message}`, status: null })),
        ),
      );

      const list = Effect.fn("WorkflowRunsGh.list")(function* (status: string) {
        const body = yield* gh(
          `repos/${repo}/actions/runs?status=${status}&per_page=${PAGE}&exclude_pull_requests=true`,
        );

        const page = yield* runsIn(body).pipe(
          Effect.mapError(() =>
            WorkflowRunsError.make({ reason: "GitHub listed the runs in a shape we do not read", status: null }),
          ),
        );

        if (page.total > page.runs.length) {
          return yield* WorkflowRunsError.make({
            reason: `${page.total} runs are ${status}: one read of ${PAGE} cannot hold all`,
            status: null,
          });
        }

        return page.runs;
      });

      const unfinished = Effect.map(Effect.forEach(UNFINISHED, list, { concurrency: UNFINISHED.length }), (lists) =>
        lists.flat(),
      );

      const cancel = (id: number) => Effect.asVoid(gh(`repos/${repo}/actions/runs/${id}/cancel`, ["--method", "POST"]));

      return WorkflowRuns.of({ unfinished, cancel });
    }),
  );
