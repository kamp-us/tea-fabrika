import { readFileSync } from "node:fs";
import * as fc from "fast-check";
import { expect, it } from "vitest";
import * as scheduled from "./scheduled.mjs";

type Jobs = Parameters<typeof scheduled.verdict>[0]["jobs"];

// Today's CI, serving both versions. Covers scheduled.mjs, the report of the scheduled run of every
// test (0534): a red run opens one `ci-scheduled` issue or comments on the open one, a green run
// closes it, a run stopped by hand does nothing. GitHub is a fake that records each call. Each plant
// was run once on scheduled.mjs and restored; each turned its law red.
const options = { seed: 119120, numRuns: 100 };

const result = fc.constantFrom("success", "failure", "cancelled", "skipped", "", undefined);
const jobName = fc.stringMatching(/^[a-z][a-z0-9-]{0,10}$/);

const needs = fc.dictionary(
  jobName,
  result.map((r) => ({ result: r, outputs: {} })),
  { minKeys: 1, maxKeys: 4 },
);

// Each test job's time limit, as the report step's env gives it (`LIMIT_NEXT: *next-limit`).
const LIMITS = { next: 17, tooling: 30 };
const MINUTE = 60_000;
const BASE = Date.parse("2026-11-15T14:15:17Z");
/** A time `ms` after the run started, as the jobs API writes one. */
const at = (ms: number) => new Date(BASE + ms).toISOString();

// A job of the run as the jobs API lists it, with no failure anywhere in it: what a leg canceled by
// another leg's stop step, or by a person, leaves, and the report job still running. A canceled leg
// here ran less than its limit, or its times are unknown, so it is never a time-out.
const quiet = fc.constantFrom("success", "cancelled", "skipped", null);
const stepName = fc.constantFrom("vitest", "end to end", "tooling tests", "results", "time table", "stop the run");
const stepEnd = fc.option(fc.nat({ max: 40 * MINUTE }).map(at), { nil: null });
const steps = fc.array(fc.record({ name: stepName, conclusion: quiet, end: stepEnd }), { maxLength: 6 });

const legName = fc.oneof(
  jobName,
  fc.constantFrom("e2e-1", "e2e-2", "1", "2", "3", "4", "5").map((shard) => `next (${shard})`),
  fc.constantFrom("1", "2").map((shard) => `tooling (${shard})`),
);

/** A job's start and end, ending before `under` minutes, or unknown. */
const shortTimes = (under: number) =>
  fc.oneof(
    fc.constant({ start: null, end: null }),
    fc.nat({ max: under * MINUTE - 1 }).map((ms) => ({ start: at(0), end: at(ms) })),
  );

const calm = fc
  .tuple(
    legName,
    fc.oneof(
      fc.record({ status: fc.constant("completed"), conclusion: fc.constantFrom("success", "cancelled", "skipped") }),
      fc.record({ status: fc.constantFrom("in_progress", "queued"), conclusion: fc.constant(null) }),
    ),
    shortTimes(17),
    steps,
  )
  .map(([name, end, times, list]) => ({ name, ...end, ...times, steps: list }));

const calmJobs = fc.array(calm, { maxLength: 5 });

// What proves a run red: a finished job with a failed step, whatever that job's own conclusion says
// (a red leg's stop step cancels it too), or a failing test named in a leg's report.
const proof = fc.oneof(
  fc
    .tuple(steps, steps, stepName, fc.constantFrom("cancelled", "failure", "success", null), legName, stepEnd)
    .map(([before, after, name, conclusion, job, end]) => ({
      jobs: [
        {
          name: job,
          status: "completed",
          conclusion,
          start: null,
          end: null,
          steps: [...before, { name, conclusion: "failure", end }, ...after],
        },
      ],
      failed: [] as string[],
    })),
  fc.array(fc.stringMatching(/^[a-z]{1,8}\.test\.ts > [a-z]{1,8}$/), { minLength: 1, maxLength: 3 }).map((failed) => ({
    jobs: [] as Jobs,
    failed,
  })),
);

it("property: a run with a failed step or a failing test is red, whatever its jobs' conclusions and needs say", () => {
  // Plant: the old verdict, red only on a `failure` in needs (red: a red leg that ended canceled read
  // as stopped, run 43673342835's bug).
  fc.assert(
    fc.property(needs, calmJobs, proof, fc.nat(), (given, jobs, red, at) => {
      const place = jobs.length === 0 ? 0 : at % (jobs.length + 1);
      const all = [...jobs.slice(0, place), ...red.jobs, ...jobs.slice(place)];
      expect(scheduled.verdict({ needs: given, jobs: all, failed: red.failed, limits: LIMITS })).toBe("red");
    }),
    options,
  );
});

it("property: with no failed step, job, test or time-out: red on a failed need, stopped after a cancel, green when all passed", () => {
  // Plants: a canceled step counts as failed (red: a run stopped by hand opened an issue); a
  // finished job canceled before its limit counts as failed (red: a run a person or a sev0's
  // freeze stopped opened one); green with no job in needs (red: unreadable needs closed the
  // issue); green past a canceled leg (red: a run stopped by hand closed the issue).
  fc.assert(
    fc.property(fc.option(needs, { nil: null }), calmJobs, (given, jobs) => {
      const results = given === null ? [] : Object.values(given).map((job) => job.result);
      const canceled = jobs.some((job) => job.status === "completed" && job.conclusion === "cancelled");
      const expected = results.includes("failure")
        ? "red"
        : !canceled && results.length > 0 && results.every((r) => r === "success")
          ? "green"
          : "stopped";
      expect(scheduled.verdict({ needs: given, jobs, failed: [], limits: LIMITS })).toBe(expected);
    }),
    options,
  );
  expect(scheduled.verdict({ needs: {}, jobs: [], failed: [], limits: LIMITS })).toBe("stopped");
});

// A finished leg that ended any way but a pass or a cancel before its limit: failed, timed out (by
// GitHub's word or by its run time), or a conclusion that proves no pass.
const notPassed = fc
  .tuple(
    fc.constantFrom("e2e-1", "e2e-2", "1", "2", "3", "4", "5").map((shard) => `next (${shard})`),
    fc.oneof(
      fc.constantFrom("failure", "timed_out", "neutral", "action_required", "stale", null).map((conclusion) => ({
        conclusion,
        start: null,
        end: null,
      })),
      // Canceled at or past next's 17 minutes: what a time-out leaves (run 43723335863: 17 min 20 s).
      fc.nat({ max: 5 * MINUTE }).map((over) => ({
        conclusion: "cancelled",
        start: at(0),
        end: at(LIMITS.next * MINUTE + over),
      })),
    ),
    steps,
  )
  .map(([name, end, list]) => ({ name, status: "completed", ...end, steps: list }));

it("property: any set of legs with one that neither passed, was skipped nor was canceled before its limit is red", () => {
  // Plants: only a `failure` is red, as before (red: a timed-out leg read as stopped, run
  // 43723335863's hole); a time-out needs more than its limit (red: a leg canceled at exactly 17
  // minutes read as stopped); an odd conclusion reads as a pass (red: `neutral` read as stopped).
  fc.assert(
    fc.property(fc.option(needs, { nil: null }), calmJobs, notPassed, fc.nat(), (given, jobs, bad, place) => {
      const all: Jobs = (jobs as Jobs).toSpliced(place % (jobs.length + 1), 0, bad);
      expect(scheduled.verdict({ needs: given, jobs: all, failed: [], limits: LIMITS })).toBe("red");
      expect(scheduled.causes(all, LIMITS).map((c) => c.leg)).toContain(bad.name);
    }),
    options,
  );
  // pinned: the edge. A leg canceled at exactly its limit timed out; one canceled a millisecond
  // before it was canceled by something else.
  const leg = (ms: number) => ({
    name: "next (4)",
    status: "completed",
    conclusion: "cancelled",
    start: at(0),
    end: at(ms),
    steps: [],
  });
  expect(scheduled.ending(leg(17 * MINUTE), LIMITS)).toBe("timed out");
  expect(scheduled.ending(leg(17 * MINUTE - 1), LIMITS)).toBe("canceled");
  // A leg whose job has no known limit cannot be told a time-out.
  expect(scheduled.ending(leg(60 * MINUTE), {})).toBe("canceled");
});

// Legs that passed or were skipped, as the jobs API lists them once each has finished.
const passed = fc.array(
  fc.record({
    name: legName,
    status: fc.constant("completed"),
    conclusion: fc.constantFrom("success", "skipped"),
    start: fc.constant(at(0)),
    end: fc.nat({ max: 60 * MINUTE }).map(at),
    steps: fc.array(fc.record({ name: stepName, conclusion: fc.constantFrom("success", "skipped"), end: stepEnd }), {
      maxLength: 6,
    }),
  }),
  { maxLength: 9 },
);

const allPassed = fc.dictionary(jobName, fc.constant({ result: "success", outputs: {} }), { minKeys: 1, maxKeys: 4 });

it("property: when every leg passed or was skipped and every need passed, the run is green with no cause", () => {
  // Plant: a skipped leg reads as odd (red: a skipped step's leg turned the run red).
  fc.assert(
    fc.property(allPassed, passed, (given, jobs) => {
      expect(scheduled.verdict({ needs: given, jobs, failed: [], limits: LIMITS })).toBe("green");
      expect(scheduled.causes(jobs, LIMITS)).toEqual([]);
    }),
    options,
  );
});

it("property: a leg canceled at or past its limit is a time-out, named by its leg and its limit in the issue", () => {
  // Plants: the limit read from the wrong job (red: tooling's 30 minutes judged a next leg); the
  // issue names the leg as failed (red: no "timed out" line); the limit left out of the line.
  fc.assert(
    fc.property(
      passed,
      fc.constantFrom(["next", "e2e-1"], ["next", "4"], ["tooling", "2"]),
      fc.nat({ max: 5 * MINUTE }),
      steps,
      run,
      (others, [id, shard], over, list, r) => {
        const minutes = LIMITS[id as keyof typeof LIMITS];
        const leg = {
          name: `${id} (${shard})`,
          status: "completed",
          conclusion: "cancelled",
          start: at(0),
          end: at(minutes * MINUTE + over),
          steps: list,
        };
        const jobs = [...others, leg];
        const found = scheduled.causes(jobs, LIMITS);
        expect(found).toEqual([{ _tag: "timed out", leg: leg.name, minutes }]);
        const text = scheduled.body({ ...r, causes: found });
        expect(text).toContain(`- \`${leg.name}\` timed out: it ran into its ${minutes}-minute limit`);
      },
    ),
    options,
  );
});

it("property: a run a red leg stopped names the legs that failed, the first first, and none of the legs it canceled", () => {
  // Plants: a canceled leg is a cause too (red: every canceled leg listed); the failed legs in the
  // jobs API's order (red: a later failure listed first).
  fc.assert(
    fc.property(
      fc.uniqueArray(fc.nat({ max: 16 * MINUTE }), { minLength: 1, maxLength: 3 }),
      fc.array(fc.nat({ max: 17 * MINUTE - 1 }), { maxLength: 6 }),
      passed,
      fc.nat(),
      run,
      (fails, cancels, others, seed, r) => {
        const red = fails.map((ms, i) => ({
          name: `next (${i + 1})`,
          status: "completed",
          // A red leg's stop step cancels its own job too (run 43703058643), or the cancel misses it.
          conclusion: seed % 2 === 0 ? "cancelled" : "failure",
          start: at(0),
          end: at(ms + 20_000),
          steps: [
            { name: "vitest", conclusion: "failure", end: at(ms) },
            { name: "stop the run", conclusion: seed % 3 === 0 ? "cancelled" : "success", end: at(ms + 10_000) },
          ],
        }));
        const stopped = cancels.map((ms, i) => ({
          name: `next (e2e-${i + 1})`,
          status: "completed",
          conclusion: "cancelled",
          start: at(0),
          end: at(ms),
          steps: [{ name: "end to end", conclusion: "cancelled", end: at(ms) }],
        }));
        // Every order the jobs API may list them in.
        const jobs = fc.sample(
          fc.shuffledSubarray([...red, ...stopped, ...others], {
            minLength: red.length + stopped.length + others.length,
          }),
          {
            seed,
            numRuns: 1,
          },
        )[0]!;
        const first = red.toSorted((a, b) => Date.parse(a.steps[0]!.end) - Date.parse(b.steps[0]!.end));
        const found = scheduled.causes(jobs, LIMITS);
        expect(found).toEqual(first.map((job) => ({ _tag: "failed", leg: job.name })));
        expect(scheduled.verdict({ needs: { next: { result: "cancelled" } }, jobs, failed: [], limits: LIMITS })).toBe(
          "red",
        );
        const text = scheduled.body({ ...r, causes: found });

        for (const job of stopped) {
          expect(text).not.toContain(`\`${job.name}\``);
        }

        expect(text).toContain(`- \`${first[0]!.name}\` failed.`);
      },
    ),
    options,
  );
});

it("property: the limits are each LIMIT_ variable's positive number, by its job id in lower case, and nothing else", () => {
  // Plants: keep the prefix in the key (red: `limit_next`); keep a zero limit (red: every cancel a
  // time-out).
  fc.assert(
    fc.property(
      fc.dictionary(
        fc.stringMatching(/^[A-Z]{1,8}$/),
        fc.oneof(fc.integer({ min: 1, max: 360 }).map(String), fc.constantFrom("0", "", "x", "-3")),
      ),
      fc.dictionary(fc.stringMatching(/^[A-Z_]{1,8}$/), fc.string()),
      (given, other) => {
        const env = {
          ...Object.fromEntries(Object.entries(other).filter(([key]) => !key.startsWith("LIMIT_"))),
          ...Object.fromEntries(Object.entries(given).map(([id, value]) => [`LIMIT_${id}`, value])),
        };
        const expected = Object.fromEntries(
          Object.entries(given).flatMap(([id, value]) =>
            Number(value) > 0 ? [[id.toLowerCase(), Number(value)]] : [],
          ),
        );
        expect(scheduled.limits(env)).toEqual(expected);
      },
    ),
    options,
  );
});

// Run 43673342835 on main: leg `next (2)` failed its vitest step, its stop step canceled the run and
// the leg with it, so `needs` read `cancelled` twice. The report job is as it saw itself, running.
const run43673342835 = JSON.parse(
  readFileSync(new URL("./fixtures/scheduled-run-43673342835.json", import.meta.url), "utf8"),
) as { needs: unknown; jobs: unknown; reports: unknown[] };

it("pinned: run 43673342835, a red leg that stopped its own run, is red from its steps and from its report alone", () => {
  // pinned: the run whose report printed "stopped, nothing to report" and opened no issue.
  // Plant: the old verdict over needs alone (red: "stopped").
  const jobs = scheduled.jobsOf(run43673342835.jobs);
  const failed = scheduled.failures(run43673342835.reports, "/work/repo");
  expect(failed).toEqual([
    "next/packages/libfabrika/src/node/ProgramMailReads.integration.test.ts > T936 slice 1: a delivery reads the same rows whatever the history L1: a new delivery returns as many rows after h earlier letters to the same target as after none",
  ]);
  expect(scheduled.verdict({ needs: run43673342835.needs, jobs, failed, limits: LIMITS })).toBe("red");
  // Each source alone: the steps, for a leg that broke before it wrote a report; the report, for a
  // jobs list that holds no failed step.
  expect(scheduled.verdict({ needs: run43673342835.needs, jobs, failed: [], limits: LIMITS })).toBe("red");
  expect(scheduled.verdict({ needs: run43673342835.needs, jobs: [], failed, limits: LIMITS })).toBe("red");
});

// The real runs of 2026-11-15, from `gh run view <id> --json jobs`, trimmed to the fields the report
// reads and written in the REST jobs API's own keys (`started_at`, `completed_at`). The report job is
// as it would see itself, running. `needs` is folded from the legs' conclusions as GitHub folds a
// matrix: failure if a leg failed, else cancelled if one was. 43723346561 and 43721881250 ran on
// branches, where the report does not run; here they are judged as if on main.
const fixture = (id: string) =>
  JSON.parse(readFileSync(new URL(`./fixtures/scheduled-run-${id}.json`, import.meta.url), "utf8")) as {
    needs: unknown;
    jobs: unknown;
  };

it.each([
  // On main by hand: next (4) and next (e2e-1) ran into the 17-minute limit (17 min 20 s and 17 min
  // 17 s); the report read the run as stopped and opened no issue. The hole this fixes.
  [
    "43723335863",
    "red",
    [
      { _tag: "timed out", leg: "next (4)", minutes: 17 },
      { _tag: "timed out", leg: "next (e2e-1)", minutes: 17 },
    ],
  ],
  // On main, green: next (4) at 13 min 38 s of its 17.
  ["43726565395", "green", []],
  // A branch: next (3) failed and its stop step canceled five legs, at about 10 minutes each.
  ["43723346561", "red", [{ _tag: "failed", leg: "next (3)" }]],
  // A branch: next (4) failed, and the cancel caught its own stop step.
  ["43721881250", "red", [{ _tag: "failed", leg: "next (4)" }]],
  // On main: next (1) failed and stopped three legs; it opened issue 1308, a path that must hold.
  ["43703058643", "red", [{ _tag: "failed", leg: "next (1)" }]],
] as const)("pinned: run %s is %s, and its causes are its failed or timed-out legs alone", (id, expected, legs) => {
  // Plants: the old verdict (red: 43723335863 "stopped"); a canceled leg is a cause (red: five legs
  // named on 43723346561); a time-out without the limit (red: 43723335863 "stopped").
  const run = fixture(id);
  const jobs = scheduled.jobsOf(run.jobs);
  expect(scheduled.verdict({ needs: run.needs, jobs, failed: [], limits: LIMITS })).toBe(expected);
  expect(scheduled.causes(jobs, LIMITS)).toEqual(legs);
});

it("pinned: run 43723335863's report opens the issue and names both legs as time-outs; with no limits it cannot", async () => {
  // pinned: the run that opened no issue. Plant: the report reads no limit from its env (red: no
  // issue). Without LIMIT_ the two time-outs read as cancels, which is why workflow-lint.ts's SC5
  // holds each test job's limit in the report step's env.
  const run = fixture("43723335863");
  const { calls, send } = fake(run.jobs, null, null);
  const { result, action } = await scheduled.report({
    needs: run.needs,
    reports: [],
    env,
    api: scheduled.github(env, send)!,
  });
  expect(result).toBe("red");
  expect(action._tag).toBe("open");
  expect(calls.filter((c) => c.method === "POST").map((c) => c.url.split("/repos/owner/repo/")[1])).toEqual([
    "labels",
    "issues",
  ]);

  if (action._tag === "open") {
    expect(action.body).toContain("- `next (4)` timed out: it ran into its 17-minute limit");
    expect(action.body).toContain("- `next (e2e-1)` timed out: it ran into its 17-minute limit");
  }

  const { LIMIT_NEXT: _next, LIMIT_TOOLING: _tooling, ...bare } = env;
  const blind = await scheduled.report({
    needs: run.needs,
    reports: [],
    env: bare,
    api: scheduled.github(bare, fake(run.jobs, null, null).send)!,
  });
  expect(blind.result).toBe("stopped");
});

it("property: the jobs API's answer reads as each job's name, status, conclusion, times and steps, and any other shape as none", () => {
  // Plants: keep only finished jobs (red: the running one dropped); drop a step's null conclusion to
  // "" (red: a running step read as a result); read the job's start from `created_at` (red: every
  // start null).
  fc.assert(
    fc.property(calmJobs, fc.nat(), (jobs, id) => {
      const answer = {
        total_count: jobs.length,
        jobs: jobs.map(({ start, end, steps: list, ...job }, i) => ({
          id: id + i,
          ...job,
          created_at: at(-1000),
          started_at: start,
          completed_at: end,
          steps: list.map(({ end: done, ...step }, n) => ({
            number: n + 1,
            status: "completed",
            ...step,
            started_at: at(0),
            completed_at: done,
          })),
        })),
      };
      expect(scheduled.jobsOf(answer)).toEqual(jobs);
    }),
    options,
  );
  // pinned: an answer that is not one, as an error page, gives no job and throws nothing.
  expect(scheduled.jobsOf(null)).toEqual([]);
  expect(scheduled.jobsOf({ jobs: "x" })).toEqual([]);
  expect(scheduled.jobsOf({ jobs: [null, { steps: [null, {}] }] })).toEqual([
    {
      name: "",
      status: "",
      conclusion: null,
      start: null,
      end: null,
      steps: [{ name: "", conclusion: null, end: null }],
    },
  ]);
});

// Vitest's JSON report, as `--reporter=json` writes it: a file's tests under `assertionResults`.
const testName = fc.stringMatching(/^[a-z][a-z0-9 ]{0,15}$/);

const file = fc.record({
  name: fc.stringMatching(/^[a-z]{1,8}\/[a-z]{1,8}\.test\.ts$/).map((path) => `/work/repo/${path}`),
  status: fc.constantFrom("passed", "failed"),
  assertionResults: fc.array(
    fc.record({ fullName: testName, status: fc.constantFrom("passed", "failed", "skipped", "pending") }),
    { maxLength: 4 },
  ),
});

const reports = fc.array(fc.record({ testResults: fc.array(file, { maxLength: 4 }) }), { maxLength: 3 });

it("property: the failures are each failed test as file > name, each once, and a failed file with none by its path", () => {
  // Plants: list every test (red: a passed test listed); drop the file-alone line (red: an import
  // error named nothing); drop the Set (red: a test in two legs' reports listed twice).
  fc.assert(
    fc.property(reports, (given) => {
      const expected: string[] = [];

      for (const report of given) {
        for (const f of report.testResults) {
          const path = f.name.replace("/work/repo/", "");
          const failed = f.assertionResults.filter((t) => t.status === "failed");
          expected.push(...failed.map((t) => `${path} > ${t.fullName}`));

          if (failed.length === 0 && f.status === "failed") {
            expected.push(path);
          }
        }
      }

      expect(scheduled.failures(given, "/work/repo")).toEqual([...new Set(expected)]);
    }),
    options,
  );
  // pinned: a report that is not one, as a broken upload, names nothing and throws nothing.
  expect(scheduled.failures([null, "x", { testResults: "x" }, { testResults: [null] }], "/r")).toEqual([]);
});

const sha = fc.stringMatching(/^[a-f0-9]{40}$/);

const run = fc.record({
  sha,
  last: fc.option(sha, { nil: null }),
  repository: fc.constant("owner/repo"),
  server: fc.constant("https://github.example"),
  run: fc.constant("https://github.example/owner/repo/actions/runs/7"),
  failed: fc.array(fc.stringMatching(/^[a-z]{1,8}\.test\.ts > [a-z]{1,8}$/), { maxLength: 70 }),
  causes: fc.constant([]),
});

it("property: red opens an issue or comments on the open one, green closes the open one, and nothing else acts", () => {
  // Plants: red with an open issue opens another (red: two issues); green with none opens one.
  fc.assert(
    fc.property(
      fc.constantFrom("red", "green", "stopped"),
      fc.option(fc.integer({ min: 1, max: 9999 }), { nil: null }),
      run,
      (given, open, r) => {
        const action = scheduled.decide(given, open, r);
        const expected =
          given === "red"
            ? open === null
              ? "open"
              : "comment"
            : given === "green" && open !== null
              ? "close"
              : "none";
        expect(action._tag).toBe(expected);

        if (action._tag === "comment" || action._tag === "close") {
          expect(action.number).toBe(open);
        }
      },
    ),
    options,
  );
});

it("format: a red run's body names the commit range since the last green run, the run, and each failing test up to the cap", () => {
  // format: the issue is read by a person, and its links are GitHub's compare and run pages.
  // Plants: compare from the run's own commit (red: no range); list every test (red: past the cap).
  fc.assert(
    fc.property(run, (r) => {
      const text = scheduled.body(r);
      expect(text).toContain(r.sha);
      expect(text).toContain(r.run);

      if (r.last !== null && r.last !== r.sha) {
        expect(text).toContain(`${r.server}/${r.repository}/compare/${r.last}...${r.sha}`);
      } else {
        expect(text).not.toContain("/compare/");
      }

      const shown = r.failed.slice(0, scheduled.SHOWN);

      for (const test of shown) {
        expect(text).toContain(`- \`${test}\``);
      }

      for (const test of r.failed.slice(scheduled.SHOWN).filter((t) => !shown.includes(t))) {
        expect(text).not.toContain(`- \`${test}\``);
      }

      expect(text.includes(`and ${r.failed.length - scheduled.SHOWN} more`)).toBe(r.failed.length > scheduled.SHOWN);
    }),
    options,
  );
});

type Call = { method: string; url: string; body: unknown; auth: string | undefined };

/** An open issue as the issues list gives it, cut to the fields the report reads. */
type Listed = { number: number; title: string };

/**
 * A fake GitHub: the run's jobs as the jobs API answers them, the report's own open issue or none,
 * a last green run or none, and every call recorded. `others` are open issues with the same label
 * that are not the report's, as the daily speed check's (0541), listed before the report's own.
 */
const fake = (
  jobs: unknown,
  open: number | null,
  last: string | null,
  failing: readonly string[] = [],
  others: readonly Listed[] = [],
) => {
  const calls: Call[] = [];
  const send = (url: string, init: { method: string; headers: Record<string, string>; body?: string }) => {
    calls.push({
      method: init.method,
      url,
      body: init.body === undefined ? undefined : JSON.parse(init.body),
      auth: init.headers["authorization"],
    });
    const path = url.replace("https://api.example/repos/owner/repo/", "");
    const fail = failing.some((prefix) => path.startsWith(prefix));
    const json = path.startsWith("issues?")
      ? [
          // A pull request with the label is in the issues list too, and is never the report's.
          { number: 1, title: scheduled.TITLE, pull_request: {} },
          ...others,
          ...(open === null ? [] : [{ number: open, title: scheduled.TITLE }]),
        ]
      : path.startsWith("actions/workflows/")
        ? { workflow_runs: last === null ? [] : [{ head_sha: last }] }
        : path.startsWith("actions/runs/")
          ? jobs
          : {};
    const status = fail ? 500 : path === "labels" ? 422 : 200;
    return Promise.resolve({ ok: status < 300, status, json: () => Promise.resolve(json) });
  };
  return { calls, send };
};

const env = {
  GITHUB_TOKEN: "token-made-up",
  GITHUB_REPOSITORY: "owner/repo",
  GITHUB_WORKFLOW_REF: "owner/repo/.github/workflows/scheduled.yaml@refs/heads/main",
  GITHUB_API_URL: "https://api.example",
  GITHUB_SERVER_URL: "https://github.example",
  GITHUB_SHA: "c".repeat(40),
  GITHUB_RUN_ID: "7",
  GITHUB_WORKSPACE: "/work/repo",
  // The report step's limits, as scheduled.yaml's aliases give them.
  LIMIT_NEXT: "17",
  LIMIT_TOOLING: "30",
};

/** The jobs API's answer for this run's jobs, in its own keys. */
const answer = (jobs: Jobs) => ({
  total_count: jobs.length,
  jobs: jobs.map(({ start, end, steps: list, ...job }) => ({
    ...job,
    started_at: start,
    completed_at: end,
    steps: list.map(({ end: done, ...step }) => ({ ...step, completed_at: done })),
  })),
});

/** The run's jobs, some with a failed step as `proof` makes them, or a leg that did not pass. */
const runJobs = fc.oneof(
  calmJobs,
  fc.tuple(calmJobs, proof).map(([jobs, red]) => [...jobs, ...red.jobs]),
  fc.tuple(calmJobs, notPassed).map(([jobs, bad]) => [...jobs, bad]),
);

const JOBS_CALL = "GET actions/runs/7/jobs?filter=latest&per_page=100";

it("property: the report reads the run's jobs first, then makes exactly the calls its action needs, each with the job's token", async () => {
  // Plants: close without the comment (red: no comment call); open without the label (red: no
  // label call); ask for the last green run on a green run (red: an extra call); judge before
  // reading the jobs (red: no jobs call, and a failed step missed).
  await fc.assert(
    fc.asyncProperty(
      needs,
      runJobs,
      fc.option(fc.integer({ min: 2, max: 9999 }), { nil: null }),
      fc.option(sha, { nil: null }),
      reports,
      async (given, jobs, open, last, results) => {
        const { calls, send } = fake(answer(jobs), open, last);
        const api = scheduled.github(env, send)!;
        const { result, action } = await scheduled.report({ needs: given, reports: results, env, api });
        const failed = scheduled.failures(results, "/work/repo");
        const writes = calls
          .filter((c) => c.method !== "GET")
          .map((c) => `${c.method} ${c.url.split("/repos/owner/repo/")[1]}`);

        expect(result).toBe(scheduled.verdict({ needs: given, jobs, failed, limits: LIMITS }));
        expect(calls.every((c) => c.auth === "Bearer token-made-up")).toBe(true);
        expect(calls.map((c) => `${c.method} ${c.url.split("/repos/owner/repo/")[1]}`)[0]).toBe(JOBS_CALL);

        if (result === "stopped") {
          expect(calls).toHaveLength(1);
          expect(action._tag).toBe("none");
          return;
        }

        if (result === "red" && open === null) {
          expect(writes).toEqual(["POST labels", "POST issues"]);
          expect(calls.find((c) => c.url.endsWith("/issues") && c.method === "POST")?.body).toMatchObject({
            title: scheduled.TITLE,
            labels: [scheduled.LABEL],
          });
        } else if (result === "red") {
          expect(writes).toEqual([`POST issues/${open}/comments`]);
        } else if (open !== null) {
          expect(writes).toEqual([`POST issues/${open}/comments`, `PATCH issues/${open}`]);
          expect(calls.at(-1)?.body).toMatchObject({ state: "closed" });
        } else {
          expect(writes).toEqual([]);
        }

        // Only a red run needs the range, so only it asks for the last green run.
        expect(
          calls.some((c) => c.url.includes("/actions/workflows/scheduled.yaml/runs?branch=main&status=success")),
        ).toBe(result === "red");

        if (action._tag === "open" || action._tag === "comment") {
          for (const test of failed.slice(0, scheduled.SHOWN)) {
            expect(action.body).toContain(test);
          }

          // Each leg that made it red is named in the issue.
          for (const cause of scheduled.causes(jobs, LIMITS)) {
            expect(action.body).toContain(`- \`${cause.leg}\` `);
          }

          if (last !== null && last !== env.GITHUB_SHA) {
            expect(action.body).toContain(`/compare/${last}...${env.GITHUB_SHA}`);
          }
        }
      },
    ),
    options,
  );
});

it("pinned: run 43673342835's report opens the issue, naming its failing test, and does so from its jobs alone too", async () => {
  // pinned: the run that printed "stopped, nothing to report". Plants: the old verdict over needs
  // alone (red: no issue); the report passes no jobs to the verdict (red: no issue without the
  // report file, as for a leg that broke before writing one).
  for (const reports of [run43673342835.reports, []]) {
    const { calls, send } = fake(run43673342835.jobs, null, null);
    const api = scheduled.github(env, send)!;
    const { result, action } = await scheduled.report({ needs: run43673342835.needs, reports, env, api });
    expect(result).toBe("red");
    expect(action._tag).toBe("open");
    expect(calls.filter((c) => c.method === "POST").map((c) => c.url.split("/repos/owner/repo/")[1])).toEqual([
      "labels",
      "issues",
    ]);

    if (action._tag === "open") {
      expect(action.body.includes("ProgramMailReads.integration.test.ts")).toBe(reports.length > 0);
    }
  }
});

it("property: an error from GitHub fails the report, so a red run's issue never goes missing quietly", async () => {
  // Plant: catch and ignore a failed write or read (red: the report resolved).
  await fc.assert(
    fc.asyncProperty(
      fc.constantFrom("issues", "actions/workflows/", "actions/runs/"),
      fc.option(fc.integer({ min: 2, max: 9999 }), { nil: null }),
      async (failing, open) => {
        const { send } = fake(answer([]), open, null, [failing]);
        const api = scheduled.github(env, send)!;
        const red = { next: { result: "failure" }, tooling: { result: "cancelled" } };
        await expect(scheduled.report({ needs: red, reports: [], env, api })).rejects.toThrow();
      },
    ),
    options,
  );
});

// The daily speed check's issue carries the same label (0541), with its own title (`TITLE` in
// `.agents/skills/lead/scripts/ci/Speed.ts`, written here again so this file reads no lead script).
const SPEED = "CI speed: a stage is over its goal";

it("property: the report acts only on the open issue with its own title, never on the speed check's, which it leaves untouched", async () => {
  // Plant: the report takes the first open `ci-scheduled` issue as its own, as before (red: on
  // 2026-11-15 a red main commented on the speed issue and opened none, and a green run would have
  // closed the speed issue).
  await fc.assert(
    fc.asyncProperty(
      fc.constantFrom("red", "green"),
      fc.integer({ min: 2, max: 4999 }),
      fc.option(fc.integer({ min: 5000, max: 9999 }), { nil: null }),
      async (given, speed, own) => {
        const { calls, send } = fake(answer([]), own, null, [], [{ number: speed, title: SPEED }]);
        const api = scheduled.github(env, send)!;
        const needed = { next: { result: given === "red" ? "failure" : "success" } };
        const { result, action } = await scheduled.report({ needs: needed, reports: [], env, api });
        const writes = calls
          .filter((c) => c.method !== "GET")
          .map((c) => `${c.method} ${c.url.split("/repos/owner/repo/")[1]}`);

        expect(result).toBe(given);
        expect(writes.some((w) => w.split(" ")[1]?.split("/")[1] === String(speed))).toBe(false);

        if (given === "red" && own === null) {
          expect(action).toMatchObject({ _tag: "open", title: scheduled.TITLE });
          expect(writes).toEqual(["POST labels", "POST issues"]);
        } else if (given === "red") {
          expect(action).toMatchObject({ _tag: "comment", number: own });
          expect(writes).toEqual([`POST issues/${own}/comments`]);
        } else if (own === null) {
          expect(action._tag).toBe("none");
          expect(writes).toEqual([]);
        } else {
          expect(action).toMatchObject({ _tag: "close", number: own });
          expect(writes).toEqual([`POST issues/${own}/comments`, `PATCH issues/${own}`]);
        }
      },
    ),
    options,
  );
});

it("pinned: 2026-11-15, a red main with only the speed issue open opens its own issue, and a green run then leaves the speed issue open", async () => {
  // pinned: the run whose red report went onto the speed issue as a comment. Plant: the old reader
  // (red: a comment on issue 1350, and no new issue; then a close of 1350).
  const speed = { number: 1350, title: SPEED };
  const red = fake(answer([]), null, null, [], [speed]);
  const opened = await scheduled.report({
    needs: { next: { result: "failure" } },
    reports: [],
    env,
    api: scheduled.github(env, red.send)!,
  });
  expect(opened.action).toMatchObject({ _tag: "open", title: scheduled.TITLE });
  expect(red.calls.find((c) => c.method === "POST" && c.url.endsWith("/issues"))?.body).toMatchObject({
    title: scheduled.TITLE,
    labels: [scheduled.LABEL],
  });

  const green = fake(answer([]), null, null, [], [speed]);
  const closed = await scheduled.report({
    needs: { next: { result: "success" } },
    reports: [],
    env,
    api: scheduled.github(env, green.send)!,
  });
  expect(closed).toEqual({ result: "green", action: { _tag: "none" } });
  expect(green.calls.filter((c) => c.method !== "GET")).toEqual([]);
});

it("scenario: with no token, repository, workflow file or run id, no GitHub reader is made", () => {
  // scenario: each of the four missing alone.
  for (const missing of ["GITHUB_TOKEN", "GITHUB_REPOSITORY", "GITHUB_WORKFLOW_REF", "GITHUB_RUN_ID"]) {
    expect(scheduled.github({ ...env, [missing]: "" }), missing).toBeNull();
  }
});
