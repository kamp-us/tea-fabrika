// Today's lead tooling. ci-speed.ts's laws on the test layer (ci/HistoryTest.ts): nothing here asks
// GitHub. The pure numbers (ci/Speed.ts), the program's reads and its issue writes, and the readers
// of gh's answers (ci/HistoryGh.ts).
import { describe, expect, it } from "@effect/vitest";
import { Effect, Option, Ref, Schema } from "effect";
import { LOOKBACK, SPILL, measure, sync } from "./ci-speed.ts";
import * as HistoryGh from "./ci/HistoryGh.ts";
import * as HistoryTest from "./ci/HistoryTest.ts";
import {
  GOALS,
  LABEL_NAME,
  RUNNERS,
  TITLE,
  busyMinutes,
  markdown,
  moveFor,
  percentile,
  report,
  stageFor,
  type Job,
  type Pull,
  type Report,
  type Run,
} from "./ci/Speed.ts";

const T0 = Date.parse("2026-11-14T00:00:00Z");
/** The ISO time `m` minutes after T0. */
const t = (m: number) => new Date(T0 + m * 60_000).toISOString();

const run = (id: number, o: Partial<Run> & { readonly at: number }): Run => ({
  id,
  workflow: "check",
  event: "pull_request",
  branch: "fabrikalfa/a",
  sha: "a1",
  conclusion: "success",
  created: t(o.at),
  updated: t(o.at + 1),
  ...o,
});

const job = (r: number, from: number, to: number, runner: string | null = "GitHub Actions 7"): Job => ({
  run: r,
  name: "check",
  conclusion: runner === null ? "skipped" : "success",
  runner,
  started: t(from),
  completed: t(to),
});

const pull = (o: Partial<Pull> & { readonly merged: string }): Pull => ({
  number: 7,
  branch: "fabrikalfa/a",
  queue: [],
  ...o,
});

/** The PR entered the queue at minute `m`. */
const added = (m: number) => ({ _tag: "added", at: t(m) }) as const;
/** The queue let the PR go at minute `m`, for `reason` (GitHub's words). */
const removed = (m: number, reason: string) => ({ _tag: "removed", at: t(m), reason }) as const;

/** A report over the 24 hours that end at minute 1440. */
const day = (pulls: ReadonlyArray<Pull>, runs: ReadonlyArray<Run>, jobs: ReadonlyArray<Job>) =>
  report({ now: T0 + 1440 * 60_000, hours: 24, pulls, runs, jobs });

const numbers = (r: Report) =>
  Object.fromEntries(r.stages.map((s) => [s.name, [s.count, Option.getOrNull(s.median), s.over]]));

describe("percentile, today's tooling", () => {
  it.prop(
    "property: the nearest rank is one of the values, at least that share are at or under it, and fewer are under it",
    { values: Schema.Array(Schema.Int).pipe(Schema.check(Schema.isMinLength(1))), p: Schema.Literals([0.5, 0.9]) },
    ({ values, p }) => {
      const found = Option.getOrThrow(percentile(values, p));
      const rank = Math.ceil(p * values.length);
      expect(values).toContain(found);
      expect(values.filter((v) => v <= found).length).toBeGreaterThanOrEqual(rank);
      expect(values.filter((v) => v < found).length).toBeLessThan(rank);
    },
  );

  it("pinned: no values have no percentile, so an empty stage shows none and is never over", () => {
    expect(percentile([], 0.5)).toEqual(Option.none());
    expect(stageFor("pr", [])).toMatchObject({ count: 0, over: false });
  });

  it.prop(
    "property: a stage is over exactly when its median or its worst 10% is past its goal",
    { values: Schema.Array(Schema.Int.pipe(Schema.check(Schema.isBetween({ minimum: 0, maximum: 30 })))) },
    ({ values }) => {
      const stage = stageFor("queue", values);
      const past = (p: number, limit: number) => Option.exists(percentile(values, p), (v) => v > limit);
      expect(stage.over).toBe(past(0.5, GOALS.queue.median) || past(0.9, GOALS.queue.worst));
    },
  );
});

describe("the three stages of one merged pull request, today's tooling", () => {
  it("scenario: through the queue: push at 0, green at 4, queued at 5, merged at 9", () => {
    const r = day(
      [pull({ merged: t(1009), queue: [added(1005)] })],
      [run(1, { at: 1000 })],
      [job(1, 1000, 1002), job(1, 1001, 1004)],
    );
    expect(numbers(r)).toEqual({ pr: [1, 4, true], queue: [1, 4, true], merge: [1, 9, true] });
  });

  it("scenario: the queue let it go and an admin merge landed it later: no queue number, the other two kept", () => {
    // As PR 1244 on 2026-11-14: queued, the queue cleared, merged by hand long after.
    const r = day(
      [pull({ merged: t(1128), queue: [added(1000), removed(1080, "queue_cleared")] })],
      [run(1, { at: 990 })],
      [job(1, 990, 992)],
    );
    expect(numbers(r)).toEqual({ pr: [1, 2, false], queue: [0, null, false], merge: [1, 138, true] });
  });

  it("scenario: the queue's own merge counts, even when GitHub stamps its removal a second before the merge", () => {
    // As PR 1270: removed for "merged" at 23:30:51, merged at 23:30:52.
    const r = day(
      [pull({ merged: t(1004), queue: [added(1000), removed(1004 - 1 / 60, "merged")] })],
      [run(1, { at: 990 })],
      [job(1, 990, 992)],
    );
    expect(numbers(r).queue).toEqual([1, 4, true]);
  });

  it("scenario: dropped, then queued again and merged by the queue: the last entry counts", () => {
    const queue = [added(1000), removed(1010, "failed_checks"), added(1020), removed(1023, "merged")];
    const r = day([pull({ merged: t(1023), queue })], [run(1, { at: 990 })], [job(1, 990, 992)]);
    expect(numbers(r).queue).toEqual([1, 3, false]);
  });

  it("scenario: an admin merge has no queue number and keeps the other two", () => {
    const r = day([pull({ merged: t(1003) })], [run(1, { at: 1000 })], [job(1, 1000, 1002)]);
    expect(numbers(r)).toEqual({ pr: [1, 2, false], queue: [0, null, false], merge: [1, 3, false] });
  });

  it("scenario: the last push is the newest head before the queue; a draft run, an older head and a later run do not count", () => {
    const runs = [
      run(1, { at: 900, sha: "old" }),
      // The ready run at the head: the draft run at the same head started the push's clock.
      run(2, { at: 1000, sha: "new" }),
      run(3, { at: 1001, sha: "new" }),
      // After the queue entry: GitHub's own branch moved after the merge, never the merged head.
      run(4, { at: 1020, sha: "after" }),
      run(5, { at: 1000, sha: "new", branch: "fabrikalfa/other" }),
    ];
    const jobs = [job(1, 900, 990), job(2, 1000, 1002), job(3, 1001, 1003), job(4, 1020, 1060)];
    const queue = [added(1004), removed(1006, "manual"), added(1010), removed(1012, "merged")];
    const r = day([pull({ merged: t(1012), queue })], runs, jobs);
    expect(numbers(r)).toEqual({ pr: [1, 2, false], queue: [1, 2, false], merge: [1, 12, true] });
  });

  it("scenario: a red last head has no PR number; a PR merged outside the window counts nowhere", () => {
    const r = day(
      [pull({ merged: t(1003) }), pull({ number: 8, branch: "b", merged: t(-5) })],
      [run(1, { at: 1000, conclusion: "failure" })],
      [job(1, 1000, 1002)],
    );
    expect(r.pulls).toBe(1);
    expect(numbers(r)).toEqual({ pr: [0, null, false], queue: [0, null, false], merge: [1, 3, false] });
  });
});

describe("the runners' use, today's tooling", () => {
  it.prop(
    "property: a job counts only the minutes it had a machine inside the window, and never more than the window",
    { jobs: Schema.Array(Schema.Struct({ from: Schema.Int, length: Schema.Int, machine: Schema.Boolean })) },
    ({ jobs }) => {
      const list = jobs.map((j, i) =>
        job(i, j.from % 2000, (j.from % 2000) + Math.abs(j.length % 300), j.machine ? "r" : null),
      );
      const used = busyMinutes(list, T0, T0 + 1440 * 60_000);
      const inside = list
        .filter((j) => j.runner !== null)
        .map((j) =>
          Math.max(
            0,
            Math.min(1440, (Date.parse(j.completed ?? "") - T0) / 60_000) -
              Math.max(0, (Date.parse(j.started ?? "") - T0) / 60_000),
          ),
        );
      expect(used).toBeCloseTo(
        inside.reduce((a, b) => a + b, 0),
        6,
      );
      expect(used).toBeLessThanOrEqual(1440 * list.length + 1e-9);
    },
  );

  it("scenario: 20 machines busy the whole day is 1,200 machine-minutes an hour, 100%", () => {
    const jobs = Array.from({ length: RUNNERS }, (_, i) => job(i, -10, 1450));
    const r = day([], [], jobs);
    expect(r.perHour).toBeCloseTo(1200, 6);
    expect(r.capacity).toBeCloseTo(100, 6);
  });
});

describe("the day's issue, today's tooling", () => {
  const over = day([pull({ merged: t(1009), queue: [added(1005)] })], [run(1, { at: 1000 })], [job(1, 1000, 1004)]);
  const within = day([pull({ merged: t(1003) })], [run(1, { at: 1000 })], [job(1, 1000, 1002)]);
  const ours = { number: 41, title: TITLE };
  const other = { number: 42, title: "Scheduled run red on main" };

  it("vector: over goal opens one or adds to the open one; within goal closes the open one or does nothing", () => {
    expect(moveFor(over, [])._tag).toBe("open");
    expect(moveFor(over, [other])._tag).toBe("open");
    expect(moveFor(over, [other, ours])).toEqual({ _tag: "comment", number: 41 });
    expect(moveFor(within, [ours])).toEqual({ _tag: "close", number: 41 });
    expect(moveFor(within, [other])._tag).toBe("none");
  });

  it("format: the summary has one row per stage, the goal beside it, and names each stage over", () => {
    const text = markdown(over);
    expect(text).toContain("| PR checks, ready to green | 1 | 4.00 | 4.00 | 3 / 5 | **over** |");
    expect(text).toContain("| Last push to merged | 1 | 9.00 | 9.00 | 8 / 15 | **over** |");
    expect(text).toContain(
      "Over its goal: PR checks, ready to green, Merge queue, entering to merged, Last push to merged.",
    );
    expect(markdown(within)).toContain("Every stage is within its goal.");
  });

  it("format: a number just past its goal shows two decimals, so 3.033 over a goal of 3 reads 3.03, never 3.0", () => {
    const close: Report = { hours: 24, pulls: 1, stages: [stageFor("queue", [3.033])], perHour: 0, capacity: 0 };
    expect(markdown(close)).toContain("| Merge queue, entering to merged | 1 | 3.03 | 3.03 | 3 / 5 | **over** |");
  });

  const synced = (r: Report, issues: HistoryTest.Facts["issues"]) =>
    Effect.gen(function* () {
      const writes = yield* Ref.make<ReadonlyArray<HistoryTest.Write>>([]);
      const asked = yield* Ref.make<ReadonlyArray<number>>([]);
      const move = yield* sync(r).pipe(
        Effect.provide(HistoryTest.layer({ runs: [], jobs: [], pulls: [], issues }, writes, asked)),
      );
      return { move, writes: yield* Ref.get(writes) };
    });

  it.effect(
    "scenario: over goal with no issue open opens one, labeled ci-scheduled, with the summary as its body",
    () =>
      Effect.gen(function* () {
        const { writes } = yield* synced(over, [
          { ...other, label: LABEL_NAME },
          { ...ours, label: "bug" },
        ]);
        expect(writes).toEqual([{ _tag: "create", title: TITLE, body: markdown(over), label: LABEL_NAME }]);
      }),
  );

  it.effect(
    "scenario: over goal again adds the day's numbers to the open issue; within goal says so and closes it",
    () =>
      Effect.gen(function* () {
        const open = [{ ...ours, label: LABEL_NAME }];
        expect((yield* synced(over, open)).writes).toEqual([{ _tag: "comment", number: 41, body: markdown(over) }]);
        const closed = yield* synced(within, open);
        expect(closed.writes.map((w) => w._tag)).toEqual(["comment", "close"]);
        expect((yield* synced(within, [])).writes).toEqual([]);
      }),
  );
});

describe("measure reads only what it needs, today's tooling", () => {
  it.effect(
    "scenario: runs from the lookback, jobs of the window's runs (plus the spill hour) and of each ready run",
    () =>
      Effect.gen(function* () {
        const now = T0 + 1440 * 60_000;
        const runs = [
          run(1, { at: -LOOKBACK * 60 + 10 }), // the ready run of a PR merged in the window, pushed long before
          run(2, { at: -SPILL * 60 - 5, branch: "x" }), // before the spill hour: not read
          run(3, { at: -SPILL * 60 + 5, branch: "x" }), // in the spill hour: its jobs ran into the window
          run(4, { at: 600, branch: "y", workflow: "mutation", event: "workflow_dispatch" }),
          run(5, { at: -LOOKBACK * 60 - 10, branch: "z" }), // before the lookback: never listed
        ];
        const jobs = [job(1, 0, 4), job(3, -30, 30), job(4, 600, 640)];
        const writes = yield* Ref.make<ReadonlyArray<HistoryTest.Write>>([]);
        const asked = yield* Ref.make<ReadonlyArray<number>>([]);
        const facts = { runs, jobs, pulls: [pull({ merged: t(5) })], issues: [] };
        const r = yield* measure(now, 24).pipe(Effect.provide(HistoryTest.layer(facts, writes, asked)));
        expect((yield* Ref.get(asked)).toSorted()).toEqual([1, 3, 4]);
        expect(numbers(r).merge).toEqual([1, LOOKBACK * 60 - 10 + 5, true]);
        // 4 of run 1's minutes, 30 of run 3's inside the window, 40 of the mutation run's.
        expect(r.perHour * 24).toBeCloseTo(74, 6);
      }),
  );
});

describe("gh's answers, today's tooling", () => {
  it.effect("format: a run, a job with no runner, a search page and an issue list read as the measure's facts", () =>
    Effect.gen(function* () {
      const runs = yield* HistoryGh.runsIn(
        JSON.stringify({
          total_count: 1,
          workflow_runs: [
            {
              id: 9,
              name: "check",
              event: "merge_group",
              head_branch: "gh-readonly-queue/main/pr-7-abc",
              head_sha: "abc",
              conclusion: null,
              created_at: t(0),
              updated_at: t(1),
              extra: true,
            },
          ],
        }),
      );
      expect(runs).toEqual([
        {
          id: 9,
          workflow: "check",
          event: "merge_group",
          branch: "gh-readonly-queue/main/pr-7-abc",
          sha: "abc",
          conclusion: null,
          created: t(0),
          updated: t(1),
        },
      ]);
      const jobs = yield* HistoryGh.jobsIn(
        JSON.stringify({
          jobs: [
            {
              run_id: 9,
              name: "next (1)",
              conclusion: "cancelled",
              runner_name: "",
              started_at: t(0),
              completed_at: t(0),
            },
            {
              run_id: 9,
              name: "check",
              conclusion: "skipped",
              runner_name: null,
              started_at: null,
              completed_at: null,
            },
            {
              run_id: 9,
              name: "lint",
              conclusion: "success",
              runner_name: "GitHub Actions 3",
              started_at: t(0),
              completed_at: t(2),
            },
          ],
        }),
      );
      expect(jobs.map((j) => j.runner)).toEqual([null, null, "GitHub Actions 3"]);
      const page = yield* HistoryGh.pullsIn(
        JSON.stringify({
          data: {
            search: {
              pageInfo: { hasNextPage: true, endCursor: "Y3Vy" },
              nodes: [
                {
                  number: 7,
                  headRefName: "a",
                  mergedAt: t(9),
                  timelineItems: {
                    nodes: [
                      { __typename: "AddedToMergeQueueEvent", createdAt: t(1) },
                      { __typename: "RemovedFromMergeQueueEvent", createdAt: t(3), reason: "queue_cleared" },
                      { __typename: "AddedToMergeQueueEvent", createdAt: t(5) },
                      { __typename: "RemovedFromMergeQueueEvent", createdAt: t(9), reason: "merged" },
                    ],
                  },
                },
              ],
            },
          },
        }),
      );
      expect(page).toEqual({
        pulls: [
          {
            number: 7,
            branch: "a",
            merged: t(9),
            queue: [added(1), removed(3, "queue_cleared"), added(5), removed(9, "merged")],
          },
        ],
        next: "Y3Vy",
      });
      expect(HistoryGh.MERGED).toContain("REMOVED_FROM_MERGE_QUEUE_EVENT");
      expect(HistoryGh.MERGED).toContain("... on RemovedFromMergeQueueEvent { createdAt reason }");
      const issues = yield* HistoryGh.issuesIn(
        JSON.stringify([
          { number: 41, title: TITLE },
          { number: 43, title: "a pull request", pull_request: { url: "x" } },
        ]),
      );
      expect(issues).toEqual([{ number: 41, title: TITLE }]);
    }),
  );

  it.prop(
    "property: the slices cover [from, to) in order, end to end, none longer than SLICE hours",
    {
      hours: Schema.Int.pipe(Schema.check(Schema.isBetween({ minimum: 0, maximum: 100 }))),
      extra: Schema.Int.pipe(Schema.check(Schema.isBetween({ minimum: 0, maximum: 59 }))),
    },
    ({ hours, extra }) => {
      const from = t(0);
      const to = t(hours * 60 + extra);
      const parts = HistoryGh.slices(from, to);
      expect(parts[0]?.[0] ?? to).toBe(from === to ? to : from);
      expect(parts.at(-1)?.[1] ?? from).toBe(to);

      for (const [i, [a, b]] of parts.entries()) {
        expect(Date.parse(b) - Date.parse(a)).toBeLessThanOrEqual(HistoryGh.SLICE * 3_600_000);
        expect(Date.parse(b)).toBeGreaterThan(Date.parse(a));
        expect(i === 0 || parts[i - 1]?.[1] === a).toBe(true);
      }
    },
  );
});
