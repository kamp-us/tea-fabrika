import { relative, resolve } from "node:path";
import { DateTime, type Duration, Effect } from "effect";
import * as fc from "fast-check";
import { expect, it } from "vitest";
import {
  Unread,
  collect,
  fileName,
  type Io,
  markdown,
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

const leg = { run: "1", attempt: "1", workflow: "check", event: "push", sha: "s", job: "next", leg: "3" };

/** A table's body rows under `heading`, the header and its rule left out. */
const rowsUnder = (text: string, heading: string): string[] => {
  const after = text.slice(text.indexOf(heading));
  const lines = after.split("\n").filter((line) => line.startsWith("| "));
  const end = lines.findIndex((line, i) => i > 1 && line === "| File | Seconds | Tests | Result |");
  return lines.slice(2, end < 0 ? undefined : end);
};

// A time as the jobs API writes it, to the second: 2026-11-14T10:00:00Z.
const iso = (seconds: number) => DateTime.formatIso(DateTime.makeUnsafe(seconds * 1000)).replace(".000Z", "Z");

// A jobs API step: started or not, ended or not, with a conclusion once GitHub gives one. Names are
// single-spaced, so a table cell holds them as they are.
const apiStep = fc
  .record({
    name: fc.stringMatching(/^[A-Za-z][A-Za-z0-9.$-]{0,12}(?: [A-Za-z0-9.$-]{1,8}){0,2}$/),
    status: fc.constantFrom("completed", "in_progress", "queued", "pending"),
    conclusion: fc.option(fc.constantFrom("success", "failure", "skipped", "cancelled")),
    start: fc.option(fc.integer({ min: 1_790_000_000, max: 1_800_000_000 })),
    took: fc.option(fc.integer({ min: 0, max: 1_800 })),
    number: fc.nat(40),
  })
  .map(({ name, status, conclusion, start, took, number }) => ({
    name,
    status,
    conclusion,
    number,
    started_at: start === null ? null : iso(start),
    completed_at: start === null || took === null ? null : iso(start + took),
  }));

// A job answer with the time table somewhere among its steps, or not there at all.
const jobAnswer = fc
  .tuple(fc.array(apiStep, { maxLength: 12 }), fc.option(fc.nat()), apiStep)
  .map(([steps, at, self]) =>
    at === null ? { steps } : { steps: steps.toSpliced(at % (steps.length + 1), 0, { ...self, name: STEP }) },
  );

it("TT1: a jobs API answer gives each step's result, start and end, a table of the started ones, and settles once the steps before the time table ended", () => {
  // Plant: take a step's result from `status`, so a failed step reads `completed`.
  fc.assert(
    fc.property(jobAnswer, (job) => {
      const steps = readSteps(job);
      expect(steps).toEqual({
        _tag: "read",
        rows: job.steps.map((s) => ({
          name: s.name,
          result: s.conclusion ?? s.status,
          start: s.started_at,
          end: s.completed_at,
        })),
      });
      const started = job.steps.filter((s) => s.started_at !== null);
      expect(rowsUnder(markdown({ ...leg, steps, files: { _tag: "read", rows: [] } }), "### Steps")).toEqual(
        started.map((s) => {
          const took =
            s.completed_at === null
              ? "-"
              : String(Math.round((Date.parse(s.completed_at) - Date.parse(s.started_at!)) / 1000));
          return `| ${s.name} | ${s.conclusion ?? s.status} | ${took} |`;
        }),
      );
      const self = job.steps.findIndex((s) => s.name === STEP);
      expect(settled(steps)).toBe(
        self >= 0 && job.steps.slice(0, self).every((s) => s.started_at === null || s.completed_at !== null),
      );
    }),
    options,
  );
});

// A Vitest report: each file once, with its own times, test count and result.
const vitestReport = fc
  .uniqueArray(
    fc.record({
      path: fc.stringMatching(/^next\/[a-z][a-z0-9-]{0,10}\.test\.ts$/),
      start: fc.integer({ min: 0, max: 2_000_000_000_000 }),
      ms: fc.integer({ min: 0, max: 900_000 }),
      tests: fc.nat(20),
      status: fc.constantFrom("passed", "failed"),
    }),
    { selector: (file) => file.path, maxLength: 25 },
  )
  .map((files) => ({
    numTotalTests: files.reduce((sum, file) => sum + file.tests, 0),
    testResults: files.map((file) => testFile(file.path, file.start, file.ms, file.tests, file.status)),
  }));

it("TT2: a Vitest report gives every file to the artifact and the slowest ten, slowest first, to the summary", () => {
  // Plant: list the first ten files the report holds instead of the slowest.
  fc.assert(
    fc.property(vitestReport, (given) => {
      const files = readFiles(given, root);
      const rows = given.testResults.map((file) => ({
        path: relative(root, file.name),
        seconds: (file.endTime - file.startTime) / 1000,
        tests: file.assertionResults.length,
        result: file.status,
      }));
      expect(files).toEqual({ _tag: "read", rows });
      const text = markdown({ ...leg, steps: { _tag: "read", rows: [] }, files });
      const total = rows.reduce((sum, file) => sum + file.seconds, 0);
      const count = Math.min(rows.length, SLOWEST);
      expect(text).toContain(`${rows.length} files, ${total.toFixed(1)} s in all. The ${count} slowest:`);
      const byPath = new Map(rows.map((file) => [file.path, file]));
      const listed = rowsUnder(text, "### Slowest test files").map((line) =>
        byPath.get(line.split(" | ")[0]!.slice(2))!,
      );
      expect(listed).toHaveLength(count);

      for (const [i, file] of listed.entries()) {
        expect(rowsUnder(text, "### Slowest test files")[i]).toBe(
          `| ${file.path} | ${file.seconds.toFixed(1)} | ${file.tests} | ${file.result} |`,
        );
        expect(i === 0 || listed[i - 1]!.seconds >= file.seconds).toBe(true);
      }

      const left = rows.filter((file) => !listed.includes(file));
      expect(left.every((file) => listed.every((shown) => shown.seconds >= file.seconds))).toBe(true);
    }),
    options,
  );
});

it("format: TT3: a leg's artifact holds the run, the event, the head, the leg, every step and every file, and no test output", async () => {
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
  // A short pause, so each run of the law stays quick; the step itself uses time-table.ts's PAUSE.
  const pause = 5;

  // How many answers come before the step just before the time table shows its end: none, some, or
  // more than the tries allow.
  await fc.assert(
    fc.asyncProperty(fc.integer({ min: 0, max: TRIES + 3 }), async (late) => {
      const asked: number[] = [];
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
      expect(asked).toHaveLength(Math.min(late + 1, TRIES));

      // A timer never fires early, so each ask after the first waited at least the pause; the
      // millisecond off allows for the clock's rounding.
      for (const [i, at] of asked.slice(1).entries()) {
        expect(at - asked[i]!).toBeGreaterThanOrEqual(pause - 1);
      }

      expect(settled(timings.steps)).toBe(late < TRIES);
    }),
    { ...options, examples: [[0], [TRIES - 1], [TRIES]] },
  );
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
