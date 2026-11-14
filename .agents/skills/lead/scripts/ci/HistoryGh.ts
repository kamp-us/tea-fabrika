// HistoryGh.layer: History and Issues on GitHub's API, through `gh api`, the one way the lead
// tooling reaches GitHub (ChecksGh.ts does the same). Runs and jobs come from the REST API, merged
// pull requests and their merge queue entries from one GraphQL search.
//
// GitHub answers at most 1,000 runs to one filtered list ("List workflow runs for a repository":
// "This endpoint will return up to 1,000 results for each search"), and a busy day here had about
// 470 runs (experiment 292). So `runs` asks in slices of SLICE hours, each well under that cap.
import { Context, Effect, Layer, Schema, Stream } from "effect";
import { ChildProcess, ChildProcessSpawner } from "effect/process";
import { History, HistoryError, Issues } from "./History.ts";
import type { Issue, Job, Pull, Run } from "./Speed.ts";

/** Hours per runs query: 6 hours held at most 160 runs on the busiest day measured. */
export const SLICE = 6;

/** Runs a page holds; GitHub's most. */
const PAGE = 100;

const RunsBody = Schema.fromJsonString(
  Schema.Struct({
    workflow_runs: Schema.Array(
      Schema.Struct({
        id: Schema.Number,
        name: Schema.NullOr(Schema.String),
        event: Schema.String,
        head_branch: Schema.NullOr(Schema.String),
        head_sha: Schema.String,
        conclusion: Schema.NullOr(Schema.String),
        created_at: Schema.String,
        updated_at: Schema.String,
      }),
    ),
  }),
);

/** The runs in one page of `actions/runs`. */
export const runsIn = (body: string): Effect.Effect<ReadonlyArray<Run>, Schema.SchemaError> =>
  Effect.map(Schema.decodeUnknownEffect(RunsBody)(body), ({ workflow_runs }) =>
    workflow_runs.map((r) => ({
      id: r.id,
      workflow: r.name ?? "",
      event: r.event,
      branch: r.head_branch ?? "",
      sha: r.head_sha,
      conclusion: r.conclusion,
      created: r.created_at,
      updated: r.updated_at,
    })),
  );

const JobsBody = Schema.fromJsonString(
  Schema.Struct({
    jobs: Schema.Array(
      Schema.Struct({
        run_id: Schema.Number,
        name: Schema.String,
        conclusion: Schema.NullOr(Schema.String),
        runner_name: Schema.optional(Schema.NullOr(Schema.String)),
        started_at: Schema.NullOr(Schema.String),
        completed_at: Schema.NullOr(Schema.String),
      }),
    ),
  }),
);

/** A run's jobs. GitHub names no runner for a job no machine took, as null or as "". */
export const jobsIn = (body: string): Effect.Effect<ReadonlyArray<Job>, Schema.SchemaError> =>
  Effect.map(Schema.decodeUnknownEffect(JobsBody)(body), ({ jobs }) =>
    jobs.map((j) => ({
      run: j.run_id,
      name: j.name,
      conclusion: j.conclusion,
      runner: j.runner_name === undefined || j.runner_name === null || j.runner_name === "" ? null : j.runner_name,
      started: j.started_at,
      completed: j.completed_at,
    })),
  );

/** The GraphQL search for merged pull requests, with the times each entered the merge queue. */
export const MERGED = `query($q: String!, $after: String) {
  search(query: $q, type: ISSUE, first: 50, after: $after) {
    pageInfo { hasNextPage endCursor }
    nodes { ... on PullRequest {
      number headRefName mergedAt
      timelineItems(last: 20, itemTypes: [ADDED_TO_MERGE_QUEUE_EVENT]) {
        nodes { ... on AddedToMergeQueueEvent { createdAt } }
      }
    } }
  }
}`;

const MergedBody = Schema.fromJsonString(
  Schema.Struct({
    data: Schema.Struct({
      search: Schema.Struct({
        pageInfo: Schema.Struct({ hasNextPage: Schema.Boolean, endCursor: Schema.NullOr(Schema.String) }),
        nodes: Schema.Array(
          Schema.Struct({
            number: Schema.Number,
            headRefName: Schema.String,
            mergedAt: Schema.String,
            timelineItems: Schema.Struct({ nodes: Schema.Array(Schema.Struct({ createdAt: Schema.String })) }),
          }),
        ),
      }),
    }),
  }),
);

/** One page of the search: its pulls, and the cursor of the next page when there is one. */
export const pullsIn = (
  body: string,
): Effect.Effect<{ readonly pulls: ReadonlyArray<Pull>; readonly next: string | null }, Schema.SchemaError> =>
  Effect.map(Schema.decodeUnknownEffect(MergedBody)(body), ({ data }) => ({
    pulls: data.search.nodes.map((n) => ({
      number: n.number,
      branch: n.headRefName,
      merged: n.mergedAt,
      queued: n.timelineItems.nodes.map((e) => e.createdAt),
    })),
    next: data.search.pageInfo.hasNextPage ? data.search.pageInfo.endCursor : null,
  }));

const IssuesBody = Schema.fromJsonString(
  Schema.Array(
    Schema.Struct({
      number: Schema.Number,
      title: Schema.String,
      pull_request: Schema.optional(Schema.Unknown),
    }),
  ),
);

/** The issues in a list of issues; GitHub lists pull requests there too, and those are left out. */
export const issuesIn = (body: string): Effect.Effect<ReadonlyArray<Issue>, Schema.SchemaError> =>
  Effect.map(Schema.decodeUnknownEffect(IssuesBody)(body), (list) =>
    list.filter((i) => i.pull_request === undefined).map((i) => ({ number: i.number, title: i.title })),
  );

const Created = Schema.fromJsonString(Schema.Struct({ number: Schema.Number }));

/** The slices [from, to) splits into, each at most SLICE hours, as ISO times. */
export const slices = (from: string, to: string): ReadonlyArray<readonly [string, string]> => {
  const end = Date.parse(to);
  const step = SLICE * 3_600_000;
  const starts = Array.from({ length: Math.max(0, Math.ceil((end - Date.parse(from)) / step)) }, (_, i) => {
    return Date.parse(from) + i * step;
  });
  return starts.map((start) => [new Date(start).toISOString(), new Date(Math.min(end, start + step)).toISOString()]);
};

/** `repo` is `owner/name`. */
export const layer = (repo: string): Layer.Layer<History | Issues, never, ChildProcessSpawner.ChildProcessSpawner> =>
  Layer.effectContext(
    Effect.gen(function* () {
      const spawner = yield* ChildProcessSpawner.ChildProcessSpawner;

      /** One `gh api` call; any exit but 0 fails with gh's own last line. */
      const gh = Effect.fn("HistoryGh.gh")(
        function* (args: ReadonlyArray<string>) {
          const handle = yield* ChildProcess.make("gh", ["api", ...args], { stdin: "ignore" });
          const [out, err, code] = yield* Effect.all(
            [
              Stream.mkString(Stream.decodeText(handle.stdout)),
              Stream.mkString(Stream.decodeText(handle.stderr)),
              handle.exitCode,
            ],
            { concurrency: 3 },
          );

          if (Number(code) !== 0) {
            const last = err.trim().split("\n").at(-1) ?? "";
            return yield* new HistoryError({ reason: `gh api ${args[0] ?? ""} exited ${code}: ${last}` });
          }

          return out;
        },
        Effect.scoped,
        Effect.provideService(ChildProcessSpawner.ChildProcessSpawner, spawner),
        Effect.catchTag("PlatformError", (e) =>
          Effect.fail(new HistoryError({ reason: `gh could not start: ${e.message}` })),
        ),
      );

      /** A decode of what GitHub said, its failure named for what was asked. */
      const read = <A>(asked: string, decoded: Effect.Effect<A, Schema.SchemaError>) =>
        decoded.pipe(Effect.mapError(() => new HistoryError({ reason: `GitHub's ${asked} did not parse` })));

      const slice = Effect.fn("HistoryGh.slice")(function* (from: string, to: string) {
        const found: Run[] = [];

        for (let page = 1; ; page += 1) {
          const path = `repos/${repo}/actions/runs?per_page=${PAGE}&page=${page}&created=${from}..${to}`;
          const runs = yield* read("runs", runsIn(yield* gh([path])));
          found.push(...runs);

          if (runs.length < PAGE) {
            return found;
          }
        }
      });

      const runs = Effect.fn("HistoryGh.runs")(function* (from: string, to: string) {
        const all = yield* Effect.forEach(slices(from, to), ([a, b]) => slice(a, b), { concurrency: 2 });
        // A run created on a slice's edge is in both slices' answers; `to` itself is not in [from, to).
        const unique = new Map(all.flat().map((run) => [run.id, run]));
        return [...unique.values()].filter((run) => run.created < to);
      });

      const jobs = Effect.fn("HistoryGh.jobs")(function* (id: number) {
        return yield* read(
          "jobs",
          jobsIn(yield* gh([`repos/${repo}/actions/runs/${id}/jobs?filter=all&per_page=100`])),
        );
      });

      const merged = Effect.fn("HistoryGh.merged")(function* (since: string) {
        const found: Pull[] = [];
        let after: string | null = null;

        do {
          const query = ["graphql", "-f", `query=${MERGED}`, "-f", `q=repo:${repo} is:pr is:merged merged:>=${since}`];
          const page = yield* read(
            "merged pull requests",
            pullsIn(yield* gh([...query, ...(after === null ? [] : ["-f", `after=${after}`])])),
          );
          found.push(...page.pulls);
          after = page.next;
        } while (after !== null);

        return found;
      });

      const issues = `repos/${repo}/issues`;

      const open = Effect.fn("HistoryGh.open")(function* (label: string) {
        return yield* read("issues", issuesIn(yield* gh([`${issues}?labels=${label}&state=open&per_page=100`])));
      });

      const create = Effect.fn("HistoryGh.create")(function* (title: string, body: string, label: string) {
        const made = yield* gh([
          "-X",
          "POST",
          issues,
          "-f",
          `title=${title}`,
          "-f",
          `body=${body}`,
          "-f",
          `labels[]=${label}`,
        ]);
        return (yield* read("new issue", Schema.decodeUnknownEffect(Created)(made))).number;
      });

      const comment = Effect.fn("HistoryGh.comment")(function* (number: number, body: string) {
        yield* gh(["-X", "POST", `${issues}/${number}/comments`, "-f", `body=${body}`]);
      });

      const close = Effect.fn("HistoryGh.close")(function* (number: number) {
        yield* gh(["-X", "PATCH", `${issues}/${number}`, "-f", "state=closed"]);
      });

      return Context.make(History, History.of({ runs, jobs, merged })).pipe(
        Context.add(Issues, Issues.of({ open, create, comment, close })),
      );
    }),
  );
