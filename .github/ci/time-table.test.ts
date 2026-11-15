import { resolve } from "node:path";
import { type Duration, Effect } from "effect";
import * as fc from "fast-check";
import { expect, it } from "vitest";
import {
  Unread,
  collect,
  fileName,
  type Io,
  markdown,
  PAUSE,
  readFiles,
  readSteps,
  SLOWEST,
  STEP,
  type Step,
  settled,
  type Timings,
  TRIES,
} from "./time-table.ts";

// Today's CI, both workflows. Covers time-table.ts, each test leg's time table. Inputs are shaped as
// GitHub's jobs API and Vitest's JSON reporter write them; every other input is broken. Each plant
// was run once on time-table.ts and restored, and turned its law red.
const options = { seed: 119120, numRuns: 100 };
const root = resolve("time-table-fixture");

// A jobs API answer read while the time table step runs: the steps before it ended, the upload and
// the stop step not started.
const job = {
  id: 131255816934,
  status: "in_progress",
  steps: [
    {
      name: "Set up job",
      status: "completed",
      conclusion: "success",
      number: 1,
      started_at: "2026-11-14T10:00:00Z",
      completed_at: "2026-11-14T10:00:02Z",
    },
    {
      name: "Run pnpm exec vitest run $FILTER",
      status: "completed",
      conclusion: "failure",
      number: 2,
      started_at: "2026-11-14T10:00:02Z",
      completed_at: "2026-11-14T10:05:14Z",
    },
    {
      name: STEP,
      status: "in_progress",
      conclusion: null,
      number: 3,
      started_at: "2026-11-14T10:05:15Z",
      completed_at: null,
    },
    { name: "timings", status: "pending", conclusion: null, number: 4, started_at: null, completed_at: null },
  ],
};

const testFile = (path: string, start: number, ms: number, tests = 1, status = "passed") => ({
  name: resolve(root, path),
  status,
  startTime: start,
  endTime: start + ms,
  message: "test output the artifact leaves out",
  assertionResults: Array.from({ length: tests }, (_, i) => ({ title: `test ${i}`, status })),
});

const env = {
  GITHUB_RUN_ID: "43633120187",
  GITHUB_RUN_ATTEMPT: "1",
  GITHUB_WORKFLOW: "check",
  GITHUB_EVENT_NAME: "pull_request",
  GITHUB_JOB: "next",
  HEAD: "a".repeat(40),
  LEG: "3",
  JOB_ID: "131255816934",
  REPORT: "/runner/temp/next.json",
};

const io = (answer: () => unknown, report: () => string): Io => ({
  job: () => Effect.sync(answer),
  read: () => Effect.sync(report),
});

// A leg's timings, with no pause between asks unless a law gives one.
const timingsOf = (vars: Readonly<Record<string, string | undefined>>, given: Io, pause: Duration.Input = 0) =>
  Effect.runPromise(collect(vars, root, given, pause));

it("TT1: the jobs API answer gives each step's result, start and end, and a table of the started ones", () => {
  // Plant: take a step's result from `status`, so a failed step reads `completed`.
  const steps = readSteps(job);
  expect(steps).toEqual({
    _tag: "read",
    rows: [
      { name: "Set up job", result: "success", start: "2026-11-14T10:00:00Z", end: "2026-11-14T10:00:02Z" },
      {
        name: "Run pnpm exec vitest run $FILTER",
        result: "failure",
        start: "2026-11-14T10:00:02Z",
        end: "2026-11-14T10:05:14Z",
      },
      { name: STEP, result: "in_progress", start: "2026-11-14T10:05:15Z", end: null },
      { name: "timings", result: "pending", start: null, end: null },
    ],
  });
  expect(settled(steps)).toBe(true);
  const timings: Timings = {
    ...{ run: "1", attempt: "1", workflow: "check", event: "push", sha: "s", job: "next", leg: "3" },
    steps,
    files: { _tag: "read", rows: [] },
  };
  expect(markdown(timings)).toContain(
    [
      "### Steps",
      "",
      "| Step | Result | Seconds |",
      "| --- | --- | ---: |",
      "| Set up job | success | 2 |",
      "| Run pnpm exec vitest run $FILTER | failure | 312 |",
      `| ${STEP} | in_progress | - |`,
      "",
    ].join("\n"),
  );
});

it("TT2: a Vitest report gives every file to the artifact and the ten slowest to the summary", () => {
  // Plant: list the first ten files the report holds instead of the slowest.
  const report = {
    numTotalTests: 30,
    testResults: Array.from({ length: 12 }, (_, i) =>
      testFile(
        `next/t${String(i).padStart(2, "0")}.test.ts`,
        1_000_000,
        (i + 1) * 1500,
        i,
        i === 11 ? "failed" : "passed",
      ),
    ),
  };
  const files = readFiles(report, root);
  expect(files._tag === "read" && files.rows.length).toBe(12);
  expect(files._tag === "read" && files.rows[0]).toEqual({
    path: "next/t00.test.ts",
    seconds: 1.5,
    tests: 0,
    result: "passed",
  });
  const text = markdown({
    ...{ run: "1", attempt: "1", workflow: "check", event: "push", sha: "s", job: "next", leg: "3" },
    steps: { _tag: "read", rows: [] },
    files,
  });
  expect(text).toContain(
    [
      "### Slowest test files",
      "",
      `12 files, 117.0 s in all. The ${SLOWEST} slowest:`,
      "",
      "| File | Seconds | Tests | Result |",
      "| --- | ---: | ---: | --- |",
      "| next/t11.test.ts | 18.0 | 11 | failed |",
      "| next/t10.test.ts | 16.5 | 10 | passed |",
    ].join("\n"),
  );
  expect(text).toContain("| next/t02.test.ts | 4.5 | 2 | passed |");
  expect(text).not.toContain("next/t01.test.ts");
  expect(text).not.toContain("next/t00.test.ts");
});

it("TT3: a leg's artifact holds the run, the event, the head, the leg, every step and every file, and no test output", async () => {
  // Plant: take the sha from GITHUB_SHA, a pull request's merge commit, instead of HEAD.
  const report = { testResults: [testFile("next/a.test.ts", 5000, 2500, 3), testFile("next/b.test.ts", 5000, 500, 1)] };
  const timings = await timingsOf(
    { ...env, GITHUB_SHA: "m".repeat(40) },
    io(
      () => job,
      () => JSON.stringify(report),
    ),
  );
  expect(timings).toEqual({
    run: "43633120187",
    attempt: "1",
    workflow: "check",
    event: "pull_request",
    sha: "a".repeat(40),
    job: "next",
    leg: "3",
    steps: readSteps(job),
    files: {
      _tag: "read",
      rows: [
        { path: "next/a.test.ts", seconds: 2.5, tests: 3, result: "passed" },
        { path: "next/b.test.ts", seconds: 0.5, tests: 1, result: "passed" },
      ],
    },
  });
  expect(JSON.stringify(timings)).not.toContain("test output");
  expect(fileName(timings)).toBe("timings-next-3.json");
});

// What GitHub or a leg could hand over instead: nothing, the wrong JSON, or a near miss.
const broken = fc.oneof(
  fc.anything(),
  fc.constant(undefined),
  fc.constant({ steps: [{ name: "x", status: "completed", started_at: "yesterday" }] }),
  fc.constant({ steps: "none" }),
  fc.constant({ testResults: [{ name: "a.test.ts", status: "passed", startTime: "0", endTime: 1 }] }),
  fc.constant({ testResults: [{ name: "a.test.ts", status: "passed", startTime: 0, endTime: 1 }] }),
);

it("TT4: any input that is not a job or not a report gives an unavailable section, and the other section still prints", () => {
  // Plant: let readFiles skip a broken entry and call the rest read, as shard-times.ts does.
  fc.assert(
    fc.property(broken, broken, (steps, files) => {
      const isJob = Array.isArray((steps as { steps?: unknown } | null)?.steps);
      const isReport = Array.isArray((files as { testResults?: unknown } | null)?.testResults);
      fc.pre(!isJob || readSteps(steps)._tag === "unavailable");
      fc.pre(!isReport || readFiles(files, root)._tag === "unavailable");
      const read = readSteps(job);
      const timings: Timings = {
        ...{ run: "", attempt: "", workflow: "", event: "", sha: "", job: "", leg: "" },
        steps: readSteps(steps),
        files: readFiles(files, root),
      };
      expect(timings.steps._tag).toBe("unavailable");
      expect(timings.files._tag).toBe("unavailable");
      const text = markdown(timings);
      expect(text.match(/^Unavailable: /gm)).toHaveLength(2);
      expect(markdown({ ...timings, steps: read })).toContain("| Set up job | success | 2 |");
      expect(markdown({ ...timings, steps: read }).match(/^Unavailable: /gm)).toHaveLength(1);
    }),
    options,
  );
});

it("TT5: whatever the environment holds and whatever GitHub or the report file answer, the leg's timings come back", async () => {
  // Plant: let a failed read escape collect as a defect, as a bare JSON.parse of a missing report would.
  const key = fc.constantFrom(...Object.keys(env));
  await fc.assert(
    fc.asyncProperty(
      fc.uniqueArray(key),
      fc.oneof(broken, fc.constant(job)),
      fc.boolean(),
      fc.oneof(fc.string(), fc.constant("{}"), fc.constant('{"testResults":[]}')),
      fc.boolean(),
      async (dropped, answer, apiThrows, report, readThrows) => {
        const partial = Object.fromEntries(Object.entries(env).filter(([name]) => !dropped.includes(name)));
        const timings = await timingsOf(partial, {
          job: () =>
            apiThrows ? Effect.fail(new Unread({ cause: new Error("socket hang up") })) : Effect.succeed(answer),
          read: () =>
            readThrows ? Effect.fail(new Unread({ cause: new Error("ENOENT: no such file") })) : Effect.succeed(report),
        });
        expect(["read", "unavailable"]).toContain(timings.steps._tag);
        expect(["read", "unavailable"]).toContain(timings.files._tag);
        expect(timings.job).toBe(partial["GITHUB_JOB"] ?? "");

        if (dropped.includes("JOB_ID") || apiThrows) {
          expect(timings.steps).toMatchObject({ _tag: "unavailable" });
        }

        if (dropped.includes("REPORT") || readThrows) {
          expect(timings.files).toMatchObject({ _tag: "unavailable" });
        }

        expect(() => markdown(timings)).not.toThrow();
      },
    ),
    options,
  );
});

it("TT6: the jobs API is asked again, a pause apart, until the steps before this one show an end, at most TRIES times", async () => {
  // Plant: read the answer once, so the step just before is timed as never ended.
  const running = structuredClone(job);
  running.steps[1]!.completed_at = null;

  const pause = 10;

  for (const late of [0, 1, 2, TRIES + 3]) {
    const asked: number[] = [];
    const started = performance.now();
    const timings = await timingsOf(
      env,
      io(
        () => {
          asked.push(performance.now());
          return asked.length > late ? job : running;
        },
        () => "{}",
      ),
      pause,
    );
    const times = Math.min(late + 1, TRIES);
    expect(asked).toHaveLength(times);
    // A timer never fires early, so each ask after the first waited at least the pause; the
    // millisecond off allows for the clock's rounding.
    expect(asked[0]! - started).toBeGreaterThanOrEqual(0);

    for (const [i, at] of asked.slice(1).entries()) {
      expect(at - asked[i]!).toBeGreaterThanOrEqual(pause - 1);
    }

    expect(settled(timings.steps)).toBe(late < TRIES);
  }

  expect(PAUSE).toBe("2 seconds");
});

it("TT7: a step or file name with a pipe or a line break stays in its own cell", () => {
  // Plant: write names into the table as they are.
  fc.assert(
    fc.property(fc.array(fc.string(), { minLength: 1, maxLength: 5 }), (names) => {
      const rows: Step[] = names.map((name) => ({
        name,
        result: "success",
        start: "2026-11-14T10:00:00Z",
        end: "2026-11-14T10:00:01Z",
      }));
      const text = markdown({
        ...{ run: "", attempt: "", workflow: "", event: "", sha: "", job: "a|b", leg: "1\n2" },
        steps: { _tag: "read", rows },
        files: { _tag: "read", rows: names.map((path) => ({ path, seconds: 1, tests: 1, result: "passed" })) },
      });
      const lines = text
        .split("\n")
        .filter((line) => line.startsWith("| ") && !/^\| ---:?(?: \| ---:?)* \|$/.test(line));
      expect(lines).toHaveLength(2 + names.length + Math.min(names.length, SLOWEST));

      for (const line of lines) {
        const cells = line.split(/(?<!\\)\|/).length - 2;
        expect([3, 4]).toContain(cells);
      }

      expect(text.split("\n")[0]).toBe("## Time table: a\\|b, leg 1 2");
    }),
    options,
  );
});
