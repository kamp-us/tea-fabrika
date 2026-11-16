import { readFileSync } from "node:fs";
import * as fc from "fast-check";
import { expect, it } from "vitest";
import { parse } from "yaml";
import * as gate from "./gate.mjs";

// Today's CI, serving both versions. Covers gate.mjs, the first job of scheduled.yaml (0581): a push
// to main or the hourly catch-up starts the full run only when no full run on main started within
// the gap (`GAP_MINUTES`), the catch-up only on a head that has had none, and a hand start always.
// GitHub is a fake that answers the run list and the jobs list from a list of runs, filtered by the
// query as GitHub filters it, and records each call.
//
// What gate.mjs exports, as these laws read it:
//   decide(seen)    the pure rule: a Seen in, a Decision out
//   read(env, io)   what the gate read from GitHub: a Seen
//   main(env, io)   the whole step: { code, output, summary, line }, where `output` is the text for
//                   $GITHUB_OUTPUT, `summary` for $GITHUB_STEP_SUMMARY and `line` the log line
// `io` is { send, sleep, now }: the fetch, the wait between tries and the clock, each defaulting
// to the real one.
const options = { seed: 119120, numRuns: 100 };
const MINUTE = 60_000;
const BASE = Date.parse("2026-11-15T14:00:00Z");
/** A time `minutes` after BASE, as GitHub writes one. */
const at = (minutes: number) => new Date(BASE + minutes * MINUTE).toISOString();

type Event = "push" | "schedule" | "workflow_dispatch";

type Job = {
  name: string;
  status: string;
  conclusion: string | null;
  started_at: string | null;
  completed_at: string | null;
};

type Run = {
  id: number;
  head_branch: string;
  head_sha: string;
  event: string;
  status: string;
  conclusion: string | null;
  created_at: string;
  jobs: Job[];
};

type Init = { method?: string; headers?: Record<string, string>; signal?: unknown };
type Call = { url: string; auth: string | undefined; signal: unknown };
/** How one call fails: a status GitHub answers with, or a call that ran into its time limit. */
type Failure = 500 | 403 | "timeout";

const API = "https://api.example";
const TOKEN = "ghs_made-up-token";
const HEAD = "a".repeat(40);
const OLD = ["b".repeat(40), "c".repeat(40)];
const BRANCH = "fabrikalfa/probe";

/** One call the gate makes, with every try of it: a try right after a failed try of the same URL. */
type Ask = { url: string; tries: number; failed: boolean };

/**
 * A fake GitHub over `runs`, read live, so a model can add runs as it goes. `fail` says how try
 * `attempt` of the gate's `index`th call fails, or that it answers.
 */
const github = (
  runs: readonly Run[],
  fail: (index: number, attempt: number) => Failure | undefined = () => undefined,
) => {
  const calls: Call[] = [];
  const asks: Ask[] = [];
  const answer = <J>(status: number, json: J) =>
    Promise.resolve({ ok: status < 300, status, json: () => Promise.resolve(json) });

  const send = (url: string, init: Init = {}) => {
    calls.push({ url, auth: init.headers?.["authorization"], signal: init.signal });
    const latest = asks.at(-1);
    const ask = latest !== undefined && latest.url === url && latest.failed ? latest : { url, tries: 0, failed: false };

    if (ask !== latest) {
      asks.push(ask);
    }

    const failure = fail(asks.length - 1, ask.tries);
    ask.tries += 1;
    ask.failed = failure !== undefined;

    if (failure === "timeout") {
      return Promise.reject(new DOMException("The operation was aborted due to timeout", "TimeoutError"));
    }

    if (failure !== undefined) {
      return answer(failure, { message: "made up" });
    }

    const parsed = new URL(url);
    const path = parsed.pathname.replace(/^\/repos\/owner\/repo\//, "");
    const query = parsed.searchParams;
    const list = /^actions\/workflows\/([^/]+)\/runs$/.exec(path);

    if (list !== null) {
      if (list[1] !== "scheduled.yaml" || parsed.pathname === path) {
        return answer(404, { message: "Not Found" });
      }

      const status = query.get("status");
      const found = runs
        .filter(
          (run) =>
            (query.get("branch") === null || run.head_branch === query.get("branch")) &&
            (query.get("head_sha") === null || run.head_sha === query.get("head_sha")) &&
            (query.get("event") === null || run.event === query.get("event")) &&
            (status === null || run.status === status || run.conclusion === status),
        )
        .toSorted((a, b) => b.id - a.id);
      const size = Math.min(Number(query.get("per_page") ?? 30), 100);
      const page = Number(query.get("page") ?? 1);
      return answer(200, {
        total_count: found.length,
        workflow_runs: found.slice((page - 1) * size, page * size).map(({ jobs: _, ...run }) => run),
      });
    }

    const jobs = /^actions\/runs\/(\d+)\/jobs$/.exec(path);
    const run = jobs === null ? undefined : runs.find((r) => r.id === Number(jobs[1]));
    return run === undefined
      ? answer(404, { message: "Not Found" })
      : answer(200, { total_count: run.jobs.length, jobs: run.jobs });
  };

  return { calls, asks, send };
};

const envOf = (event: Event, sha: string, gap: number, token = TOKEN, ref = "refs/heads/main") => ({
  GITHUB_TOKEN: token,
  GITHUB_REPOSITORY: "owner/repo",
  GITHUB_WORKFLOW_REF: `owner/repo/.github/workflows/scheduled.yaml@${ref}`,
  GITHUB_API_URL: API,
  GITHUB_SERVER_URL: "https://github.example",
  GITHUB_REF: ref,
  GITHUB_SHA: sha,
  GITHUB_EVENT_NAME: event,
  GITHUB_RUN_ID: "999999",
  GAP_MINUTES: String(gap),
});

/** No real wait between tries: each wait is recorded. */
const waits = () => {
  const asked: number[] = [];
  const sleep = (ms: number) => {
    asked.push(ms);
    return Promise.resolve();
  };
  return { asked, sleep };
};

const job = (name: string, conclusion: string | null, start: number | null, end: number | null): Job => ({
  name,
  status: conclusion === null ? "in_progress" : "completed",
  conclusion,
  started_at: start === null ? null : at(start),
  completed_at: end === null ? null : at(end),
});

/**
 * A run's jobs as GitHub lists them. A full run's test legs are named `tests (<shard>)`; a run whose
 * gate said `false` or failed lists its skipped matrix as one job, `tests`. A full run from before
 * the gate has no gate job, and names its legs by their old two jobs, `next (<shard>)` and
 * `tooling (<shard>)`, as every green full run on main did when the gate landed (run 43780996689).
 * Each job starts at `start` or later.
 */
const jobsOf = (kind: "full" | "skipped" | "gate failed", start: number, gated: boolean): Job[] => {
  if (kind === "full") {
    const legs = gated ? start + 0.5 : start;
    const [e2e, next, tooling] = gated
      ? ["tests (e2e-1)", "tests (1)", "tests (tooling-1)"]
      : ["next (e2e-1)", "next (1)", "tooling (1)"];
    return [
      ...(gated ? [job("gate", "success", start, start + 0.5)] : []),
      job(e2e, "success", legs + 0.2, legs + 9),
      job(next, "success", legs, legs + 12),
      job(tooling, "success", legs + 0.1, legs + 20),
      job("report", "success", legs + 20.2, legs + 20.5),
    ];
  }

  return [
    job("gate", kind === "skipped" ? "success" : "failure", start, start + 0.5),
    job("tests", "skipped", start + 0.5, start + 0.5),
    job(
      "report",
      kind === "skipped" ? "skipped" : "failure",
      start + 0.5,
      kind === "skipped" ? start + 0.5 : start + 1,
    ),
  ];
};

/** A test leg, of the one matrix or of the two jobs before the gate. */
const isLeg = (j: Job) => /^(tests|next|tooling) \(.+\)$/.test(j.name);

// ---------------------------------------------------------------- G1, the rule

it("G1 property: decide starts every hand start, and on a push or the catch-up skips a tested head, skips inside the gap, and starts otherwise", () => {
  // Plant, after build, on gate.mjs and restored: compare with `<=`, so a run exactly one gap after
  // the last is skipped (red on the edge, which the generator reaches on purpose).
  const reached = { edge: 0, inside: 0, past: 0, none: 0, byHand: 0, tested: 0 };
  fc.assert(
    fc.property(
      fc.constantFrom<Event>("push", "schedule", "workflow_dispatch"),
      fc.integer({ min: BASE, max: BASE + 365 * 24 * 60 * MINUTE }),
      fc.integer({ min: 60, max: 1440 }),
      fc.option(
        fc.record({
          id: fc.integer({ min: 1, max: 2 ** 40 }),
          sha: fc.constantFrom(HEAD, ...OLD),
          // How far the last start sits from one gap before now: on the edge, either side of it by
          // a little or a lot, or after now (a clock that disagrees).
          off: fc.oneof(
            fc.constant(0),
            fc.integer({ min: -2 * MINUTE, max: 2 * MINUTE }),
            fc.integer({ min: -3 * 24 * 60 * MINUTE, max: 3 * 24 * 60 * MINUTE }),
          ),
        }),
        { nil: null },
      ),
      fc.boolean(),
      (event, now, gap, near, tested) => {
        const last = near === null ? null : { id: near.id, sha: near.sha, at: now - gap * MINUTE + near.off };
        const decision = gate.decide({ event, now, gap, last, tested });
        const since = last === null ? Infinity : now - last.at;
        reached.edge += last !== null && since === gap * MINUTE ? 1 : 0;
        reached.inside += since < gap * MINUTE ? 1 : 0;
        reached.past += last !== null && since > gap * MINUTE ? 1 : 0;
        reached.none += last === null ? 1 : 0;
        reached.byHand += event === "workflow_dispatch" ? 1 : 0;
        reached.tested += tested && event !== "workflow_dispatch" ? 1 : 0;

        const expected =
          event === "workflow_dispatch"
            ? { _tag: "start", reason: "by_hand" }
            : tested
              ? { _tag: "skip", reason: "tested" }
              : since < gap * MINUTE
                ? { _tag: "skip", reason: "too_soon" }
                : { _tag: "start", reason: "due" };
        expect(decision).toEqual(expected);
      },
    ),
    { ...options, numRuns: 200 },
  );
  expect(
    Object.values(reached).every((count) => count > 0),
    JSON.stringify(reached),
  ).toBe(true);
});

// ---------------------------------------------------------------- G3, the reader

const runKind = fc.constantFrom<"full" | "skipped" | "gate failed">("full", "skipped", "gate failed");

/** Runs of scheduled.yaml, oldest first: on main or a branch, full or not, of any ending. */
const history = fc.array(
  fc.record({
    kind: runKind,
    branch: fc.constantFrom("main", "main", BRANCH),
    sha: fc.constantFrom(HEAD, ...OLD),
    conclusion: fc.constantFrom("success", "failure", "cancelled"),
    event: fc.constantFrom("push", "schedule", "workflow_dispatch"),
    // How long the run waited in the `scheduled` group before its first job started.
    waited: fc.integer({ min: 0, max: 50 }),
    gated: fc.boolean(),
  }),
  { maxLength: 25 },
);

/** The generated history as GitHub's runs, ids rising with age, and this run, still going, last. */
const runsOf = (
  list: readonly {
    kind: "full" | "skipped" | "gate failed";
    branch: string;
    sha: string;
    conclusion: string;
    event: string;
    waited: number;
    gated: boolean;
  }[],
): Run[] => {
  const done = list.map((r, i): Run => {
    const created = i * 30;
    const conclusion = r.kind === "skipped" ? "success" : r.kind === "gate failed" ? "failure" : r.conclusion;
    return {
      id: 100 + i,
      head_branch: r.branch,
      head_sha: r.sha,
      event: r.branch === "main" ? r.event : "workflow_dispatch",
      status: "completed",
      conclusion,
      created_at: at(created),
      jobs: jobsOf(r.kind, created + r.waited, r.gated || r.kind !== "full"),
    };
  });
  const now = list.length * 30;
  return [
    ...done,
    {
      id: 100 + list.length,
      head_branch: "main",
      head_sha: HEAD,
      event: "push",
      status: "in_progress",
      conclusion: null,
      created_at: at(now),
      jobs: [job("gate", null, now, null)],
    },
  ];
};

it("G3 property: the reader asks the two run lists of main and one jobs list per run it walks, stops at the first full run, takes its earliest job start, and counts a run at the head only when it is full and not canceled", async () => {
  // Plants, after build, each on gate.mjs and restored: drop `branch=main`, so a branch run counts
  // (red: a newer full branch run is taken as the last one, and a full branch run at the head as
  // tested); count a canceled full run at the head as tested (red where the head has only canceled
  // full runs).
  const reached = { none: 0, walked: 0, branchNewer: 0, canceledHeadOnly: 0, tested: 0, untested: 0, oldShape: 0 };
  await fc.assert(
    fc.asyncProperty(
      history,
      fc.constantFrom<Event>("push", "schedule"),
      fc.integer({ min: 60, max: 1440 }),
      async (list, event, gap) => {
        const runs = runsOf(list);
        const { calls, send } = github(runs);
        const seen = await gate.read(envOf(event, HEAD, gap), {
          send,
          sleep: waits().sleep,
          now: () => BASE + 9999 * MINUTE,
        });

        const mains = runs
          .filter((r) => r.head_branch === "main" && r.status === "completed")
          .toSorted((a, b) => b.id - a.id);
        const first = mains.findIndex((r) => r.jobs.some(isLeg));
        const walked = first === -1 ? mains : mains.slice(0, first + 1);
        const full = first === -1 ? undefined : mains[first];
        const atHead = mains.filter((r) => r.head_sha === HEAD);
        const tested = atHead.some((r) => r.conclusion !== "cancelled" && r.jobs.some(isLeg));

        expect(seen.event).toBe(event);
        expect(seen.gap).toBe(gap);
        expect(seen.tested).toBe(tested);
        expect(seen.last).toEqual(
          full === undefined
            ? null
            : {
                id: full.id,
                sha: full.head_sha,
                at: Math.min(...full.jobs.flatMap((j) => (j.started_at === null ? [] : [Date.parse(j.started_at)]))),
              },
        );

        // The two run lists, each of main's finished runs; the second at the head.
        const lists = calls
          .map((c) => new URL(c.url))
          .filter((u) => u.pathname.endsWith("/actions/workflows/scheduled.yaml/runs"));
        expect(lists).toHaveLength(2);
        expect(
          lists.every((u) => u.searchParams.get("branch") === "main" && u.searchParams.get("status") === "completed"),
        ).toBe(true);
        expect(lists.map((u) => u.searchParams.get("head_sha")).toSorted()).toEqual([HEAD, null].toSorted());

        // A jobs list for every run walked to the first full one, and for no run past it but those at
        // the head.
        const asked = calls.flatMap((c) => {
          const m = /\/actions\/runs\/(\d+)\/jobs$/.exec(new URL(c.url).pathname);
          return m === null ? [] : [Number(m[1])];
        });
        expect(walked.every((r) => asked.includes(r.id))).toBe(true);
        expect(asked.every((id) => walked.some((r) => r.id === id) || atHead.some((r) => r.id === id))).toBe(true);
        // Each run's jobs are read once: the head's runs that the walk read are not read again
        // (the review of pull request 1404: the walk was 2K+4 calls for K skipped runs).
        expect(new Set(asked).size, JSON.stringify(asked)).toBe(asked.length);
        expect(calls.every((c) => c.auth === `Bearer ${TOKEN}`)).toBe(true);

        reached.none += full === undefined ? 1 : 0;
        reached.oldShape += full !== undefined && !full.jobs.some((j) => j.name === "gate") ? 1 : 0;
        reached.walked += walked.length >= 2 && full !== undefined ? 1 : 0;
        const newestBranchFull = runs.filter((r) => r.head_branch === BRANCH && r.jobs.some(isLeg)).at(-1);
        reached.branchNewer +=
          newestBranchFull !== undefined && (full === undefined || newestBranchFull.id > full.id) ? 1 : 0;
        reached.canceledHeadOnly +=
          !tested && atHead.some((r) => r.conclusion === "cancelled" && r.jobs.some(isLeg)) ? 1 : 0;
        reached.tested += tested ? 1 : 0;
        reached.untested += tested ? 0 : 1;
      },
    ),
    options,
  );
  expect(
    Object.values(reached).every((count) => count > 0),
    JSON.stringify(reached),
  ).toBe(true);
});

// ---------------------------------------------------------------- G2, the group over time

/** One thing that asks for a run of scheduled.yaml: a push to main, or a hand start on main or a branch. */
type Asked = { gap: number; kind: "push" | "by hand on main" | "by hand on a branch"; length: number };

const asks = fc.array(
  fc.record({
    gap: fc.integer({ min: 0, max: 90 }),
    kind: fc.constantFrom<Asked["kind"]>("push", "push", "push", "by hand on main", "by hand on a branch"),
    length: fc.integer({ min: 5, max: 40 }),
  }),
  { minLength: 1, maxLength: 60 },
);

type Ran = { id: number; event: Event; branch: string; sha: string; created: number; gate: number; started: boolean };

/**
 * scheduled.yaml's `scheduled` group, one run at a time, first in first out, over the fake GitHub:
 * each run's gate is the real `main`, run once every run ahead of it ended, with the clock at that
 * moment. A run that starts its tests holds the group for its length; one whose gate said `false`
 * for half a minute. The catch-up fires at `minute` past every hour where `fires` says so.
 */
const simulate = async (list: readonly Asked[], gap: number, minute: number, fires: (hour: number) => boolean) => {
  const runs: Run[] = [];
  const { send } = github(runs);
  type Queued = { event: Event; branch: string; created: number; length: number; sha?: string };
  const queued: Queued[] = [];
  let time = 0;
  let pushes = 0;

  for (const ask of list) {
    time += ask.gap;
    queued.push({
      event: ask.kind === "push" ? "push" : "workflow_dispatch",
      branch: ask.kind === "by hand on a branch" ? BRANCH : "main",
      created: time,
      length: ask.length,
    });
  }

  const busiest = time + list.reduce((sum, ask) => sum + ask.length, 0) + gap + 3 * 60;

  for (let hour = 0; hour * 60 + minute <= busiest; hour++) {
    if (fires(hour)) {
      queued.push({ event: "schedule", branch: "main", created: hour * 60 + minute, length: 30 });
    }
  }

  // Ties go to the earlier ask: a push and a cron in the same minute keep the list's order.
  const order = queued.map((q, i) => ({ q, i })).toSorted((a, b) => a.q.created - b.q.created || a.i - b.i);

  // Main's head at each push, so a cron or a hand start runs the head as it was when it was asked.
  for (const { q } of order) {
    if (q.event === "push") {
      pushes += 1;
      q.sha = `push-${pushes}`;
    }
  }

  const headAt = (minute: number) =>
    order.filter(({ q }) => q.event === "push" && q.created <= minute).at(-1)?.q.sha ?? "push-0";
  const ran: Ran[] = [];
  let free = 0;

  for (const [index, { q }] of order.entries()) {
    const id = 1000 + index;
    const sha = q.branch === "main" ? (q.sha ?? headAt(q.created)) : "branch-head";
    const begin = Math.max(q.created, free);
    // The runs behind this one are in the list too, still queued, with no jobs yet.
    const behind = order.slice(index + 1).filter(({ q: later }) => later.created <= begin);
    const waiting = behind.map(({ q: later }, k): Run => ({
      id: id + 1 + k + order.length,
      head_branch: later.branch,
      head_sha: "queued",
      event: later.event,
      status: "queued",
      conclusion: null,
      created_at: at(later.created),
      jobs: [],
    }));
    const self: Run = {
      id,
      head_branch: q.branch,
      head_sha: sha,
      event: q.event,
      status: "in_progress",
      conclusion: null,
      created_at: at(q.created),
      jobs: [job("gate", null, begin, null)],
    };
    runs.push(self, ...waiting);
    const ref = q.branch === "main" ? "refs/heads/main" : `refs/heads/${q.branch}`;
    const result = await gate.main(envOf(q.event, sha, gap, TOKEN, ref), {
      send,
      sleep: waits().sleep,
      now: () => BASE + begin * MINUTE,
    });
    runs.splice(runs.length - waiting.length, waiting.length);

    if (result.code !== 0) {
      throw new Error(`the gate failed on a GitHub that answers: ${result.line}`);
    }

    const starts = /^start=(true|false)$/m.exec(result.output)?.[1];
    const started = starts === "true";
    self.status = "completed";
    self.conclusion = "success";
    self.jobs = jobsOf(started ? "full" : "skipped", begin, true);
    free = begin + (started ? q.length : 0.5);
    ran.push({ id, event: q.event, branch: q.branch, sha, created: q.created, gate: begin, started });
  }

  return { ran, order };
};

it("G2 property: in the group, no full run on main starts within a gap of the last one except by hand, and when every catch-up fires each head that stays main's head gets one", async () => {
  // Plant, after build, on gate.mjs and restored: read `last.at` as the run's creation time, not
  // its start (red: a run that waited in the group counts as older, so the next starts inside the
  // gap). The generator makes runs wait on purpose: asks closer together than the runs last.
  const reached = { waited: 0, skipped: 0, started: 0, byHand: 0, stayed: 0 };
  await fc.assert(
    fc.asyncProperty(
      asks,
      fc.integer({ min: 60, max: 240 }),
      fc.integer({ min: 1, max: 59 }),
      fc.func(fc.boolean()),
      async (list, gap, minute, dropped) => {
        // Some catch-ups never fire (GitHub drops them): the gap still holds.
        const some = await simulate(list, gap, minute, (hour) => !dropped(hour));
        const mains = some.ran.filter((r) => r.branch === "main" && r.started);

        for (const [i, run] of mains.entries()) {
          if (run.event === "workflow_dispatch") {
            continue;
          }

          for (const before of mains.slice(0, i)) {
            expect(run.gate - before.gate, `run ${run.id} after ${before.id}`).toBeGreaterThanOrEqual(gap);
          }
        }

        reached.waited += some.ran.some((r) => r.gate > r.created) ? 1 : 0;
        reached.skipped += some.ran.some((r) => !r.started) ? 1 : 0;
        reached.started += mains.some((r) => r.event !== "workflow_dispatch") ? 1 : 0;
        reached.byHand += mains.some((r) => r.event === "workflow_dispatch") ? 1 : 0;

        // Every catch-up fires: a head that stays main's head past one gap and an hour after its
        // push's gate ran gets a full run, asked for no later than that.
        const all = await simulate(list, gap, minute, () => true);
        const pushed = all.ran.filter((r) => r.event === "push");

        for (const [i, push] of pushed.entries()) {
          const bound = push.gate + gap + 60;
          const next = pushed[i + 1];

          if (next !== undefined && next.created <= bound) {
            continue;
          }

          reached.stayed += 1;
          const tester = all.ran.find((r) => r.branch === "main" && r.started && r.sha === push.sha);
          expect(tester, `head ${push.sha}`).toBeDefined();
          expect(tester!.created, `head ${push.sha}`).toBeLessThanOrEqual(bound);
        }
      },
    ),
    { ...options, numRuns: 200 },
  );
  expect(
    Object.values(reached).every((count) => count > 0),
    JSON.stringify(reached),
  ).toBe(true);
});

// ---------------------------------------------------------------- G4, the token

/** A token with characters URL encoding changes, so an encoded copy is looked for too. */
const token = fc
  .string({ unit: fc.constantFrom(..."abcXYZ019_-./%?&=+ #:@!~*'()"), minLength: 12, maxLength: 40 })
  .map((s) => `ghs_${s}`);

it("G4 property: [secrets] the token goes only in the authorization header, and in no URL, output line, summary line or error", async () => {
  // Plant, after build, on gate.mjs and restored: put the token in the URL as `?access_token=` (red
  // on every flow). Plants for the other outputs, after build: the token in the summary line; the
  // token in the error after the third failure.
  const reached = { answered: 0, failed: 0 };
  await fc.assert(
    fc.asyncProperty(
      token,
      history,
      fc.constantFrom<Event>("push", "schedule", "workflow_dispatch"),
      fc.option(fc.constantFrom<Failure>(500, 403, "timeout"), { nil: undefined }),
      async (secret, list, event, failure) => {
        const runs = runsOf(list);
        const { calls, send } = github(runs, () => failure);
        const env = envOf(event, HEAD, 60, secret);
        const io = { send, sleep: waits().sleep, now: () => BASE + 9999 * MINUTE };
        const result = await gate.main(env, io);
        const thrown = await gate.read(env, io).then(
          () => "",
          (cause: unknown) =>
            cause instanceof Error ? `${cause.name} ${cause.message} ${String(cause.stack)}` : String(cause),
        );
        const forms = [secret, encodeURIComponent(secret), encodeURI(secret)];
        const outputs = { output: result.output, summary: result.summary, line: result.line, thrown };

        expect(calls.length).toBeGreaterThan(0);

        for (const call of calls) {
          expect(call.auth).toBe(`Bearer ${secret}`);

          for (const form of forms) {
            expect(call.url.includes(form), `the URL ${call.url}`).toBe(false);
            expect(decodeURIComponent(call.url).includes(secret), `the URL ${call.url}`).toBe(false);
          }
        }

        for (const [name, text] of Object.entries(outputs)) {
          for (const form of forms) {
            expect(text.includes(form), name).toBe(false);
          }
        }

        reached.answered += failure === undefined ? 1 : 0;
        reached.failed += failure === undefined ? 0 : 1;
      },
    ),
    options,
  );
  expect(
    Object.values(reached).every((count) => count > 0),
    JSON.stringify(reached),
  ).toBe(true);
});

// ---------------------------------------------------------------- G5, a GitHub that fails

it("G5 property: a call that fails is tried 3 times, and after the third failure the step exits non-zero with no start line; after every call answered it writes exactly one start line", async () => {
  // Plant, after build, on gate.mjs and restored: write `start=true` when the reader fails (red on
  // every flow with a call that failed 3 times).
  const reached = { retried: 0, gaveUp: 0, clean: 0 };
  await fc.assert(
    fc.asyncProperty(
      history,
      fc.constantFrom<Event>("push", "schedule", "workflow_dispatch"),
      // Per call, in the order the gate makes them: how many times it fails before it answers, and how.
      fc.array(fc.tuple(fc.integer({ min: 0, max: 4 }), fc.constantFrom<Failure>(500, 403, "timeout")), {
        minLength: 1,
        maxLength: 8,
      }),
      async (list, event, plan) => {
        const runs = runsOf(list);
        const planOf = (index: number) => plan[index % plan.length]!;
        const { calls, asks, send } = github(runs, (index, attempt) => {
          const [fails, how] = planOf(index);
          return attempt < fails ? how : undefined;
        });
        const { asked, sleep } = waits();
        const result = await gate.main(envOf(event, HEAD, 60), { send, sleep, now: () => BASE + 9999 * MINUTE });
        let gaveUp = false;

        for (const [index, ask] of asks.entries()) {
          const [fails] = planOf(index);
          expect(ask.tries, ask.url).toBe(fails >= 3 ? 3 : fails + 1);
          gaveUp ||= fails >= 3;
        }

        // A call that failed for good is the last one: the gate stops there.
        expect(asks.slice(0, -1).every((ask) => !ask.failed)).toBe(true);
        // Every call has its own time limit.
        expect(calls.every((c) => c.signal instanceof AbortSignal)).toBe(true);
        // One wait before each try after the first.
        expect(asked).toHaveLength(calls.length - asks.length);

        const output: string = result.output;
        const lines = output.split("\n").filter((l) => /^start=/.test(l));

        if (gaveUp) {
          expect(result.code).not.toBe(0);
          expect(lines).toEqual([]);
        } else {
          expect(result.code).toBe(0);
          expect(lines).toHaveLength(1);
          expect(["start=true", "start=false"]).toContain(lines[0]);
        }

        reached.retried += calls.length > asks.length && !gaveUp ? 1 : 0;
        reached.gaveUp += gaveUp ? 1 : 0;
        reached.clean += calls.length === asks.length ? 1 : 0;
      },
    ),
    options,
  );
  expect(
    Object.values(reached).every((count) => count > 0),
    JSON.stringify(reached),
  ).toBe(true);
});

// ---------------------------------------------------------------- G6, the walk's cost

it("G6 property: after K runs at the head whose gate said false, the gate makes K + 3 calls: two run lists and one jobs list per run it walks", async () => {
  // The review of pull request 1404: the head's loop read again the jobs of every run the walk had
  // read, 2K + 4 calls, up to about 200 after a quiet stretch. Plant, run once on gate.mjs and
  // restored: the head loop reads its runs' jobs again (red: 2K + 4).
  await fc.assert(
    fc.asyncProperty(fc.integer({ min: 0, max: 40 }), fc.constantFrom<Event>("push", "schedule"), async (k, event) => {
      // The last full run, at an older commit, then K catch-ups at the head that skipped.
      const list = [
        {
          kind: "full" as const,
          branch: "main",
          sha: OLD[0]!,
          conclusion: "success",
          event: "push",
          waited: 0,
          gated: true,
        },
        ...Array.from({ length: k }, () => ({
          kind: "skipped" as const,
          branch: "main",
          sha: HEAD,
          conclusion: "success",
          event: "schedule",
          waited: 0,
          gated: true,
        })),
      ];
      const { calls, send } = github(runsOf(list));
      const result = await gate.main(envOf(event, HEAD, 60), {
        send,
        sleep: waits().sleep,
        now: () => BASE + 9999 * MINUTE,
      });
      expect(result.code).toBe(0);
      expect(calls).toHaveLength(k + 3);
    }),
    options,
  );
});

// ---------------------------------------------------------------- G7, a walk that runs out of time

/** The gate step's own time limit in scheduled.yaml, which ends the step `failure` when it is hit. */
const stepLimit = (() => {
  const workflow = parse(readFileSync(new URL("../workflows/scheduled.yaml", import.meta.url), "utf8"));
  const steps: { id?: string; "timeout-minutes"?: unknown }[] = workflow?.jobs?.gate?.steps ?? [];
  const limit = steps.find((step) => step.id === "decide")?.["timeout-minutes"];
  return typeof limit === "number" ? limit * MINUTE : Number.NaN;
})();

it("G7 property: a gate whose calls would run past its step's time limit stops before it, with a non-zero exit and no start line, and one that finishes in time answers", async () => {
  // The review of pull request 1404: a gate that ran into its job's limit ended `cancelled`, read
  // as stopped by a person, so no sev1 opened. Plant, run once on gate.mjs and restored: no
  // deadline (red: a slow walk ends past the step's limit).
  expect(Number.isFinite(stepLimit), "scheduled.yaml's decide step has a timeout-minutes").toBe(true);
  const reached = { answered: 0, outOfTime: 0 };
  await fc.assert(
    fc.asyncProperty(
      history,
      // A quiet stretch after it: catch-ups at the head whose gate said false, each one more call.
      fc.integer({ min: 0, max: 60 }),
      fc.constantFrom<Event>("push", "schedule", "workflow_dispatch"),
      // How long each call takes, up to a call's own 10 s limit.
      fc.integer({ min: 100, max: 10_000 }),
      async (list, quiet, event, cost) => {
        let clock = BASE;
        const skipped = {
          kind: "skipped" as const,
          branch: "main",
          sha: HEAD,
          conclusion: "success",
          event: "schedule",
          waited: 0,
          gated: true,
        };
        const fake = github(runsOf([...list, ...Array.from({ length: quiet }, () => skipped)]));
        const send = (url: string, init?: Init) => {
          clock += cost;
          return fake.send(url, init);
        };
        const sleep = (ms: number) => {
          clock += ms;
          return Promise.resolve();
        };
        const result = await gate.main(envOf(event, HEAD, 60), { send, sleep, now: () => clock });
        const lines = result.output.split("\n").filter((l: string) => /^start=/.test(l));

        // Whatever the walk costs, the gate ends inside its step's limit.
        expect(clock - BASE).toBeLessThan(stepLimit);

        if (result.code === 0) {
          expect(lines).toHaveLength(1);
        } else {
          expect(lines).toEqual([]);
        }

        // A walk that fits well inside the limit answers.
        const needed = fake.calls.length * cost;
        expect(result.code === 0 || needed >= stepLimit / 2, `${fake.calls.length} calls of ${cost} ms`).toBe(true);
        reached.answered += result.code === 0 ? 1 : 0;
        reached.outOfTime += result.code === 0 ? 0 : 1;
      },
    ),
    options,
  );
  expect(
    Object.values(reached).every((count) => count > 0),
    JSON.stringify(reached),
  ).toBe(true);
});
