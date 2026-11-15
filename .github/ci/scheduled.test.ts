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

// A job of the run as the jobs API lists it, with no failure anywhere in it: what a leg canceled by
// another leg's stop step, or by a person, leaves, and the report job still running.
const quiet = fc.constantFrom("success", "cancelled", "skipped", null);
const stepName = fc.constantFrom("vitest", "end to end", "tooling tests", "results", "time table", "stop the run");
const steps = fc.array(fc.record({ name: stepName, conclusion: quiet }), { maxLength: 6 });

const calm = fc.record({
  name: jobName,
  status: fc.constantFrom("completed", "in_progress", "queued"),
  conclusion: quiet,
  steps,
});

const calmJobs = fc.array(calm, { maxLength: 5 });

// What proves a run red: a finished job with a failed step, whatever that job's own conclusion says
// (a red leg's stop step cancels it too), or a failing test named in a leg's report.
const proof = fc.oneof(
  fc
    .tuple(steps, steps, stepName, fc.constantFrom("cancelled", "failure", "success", null), jobName)
    .map(([before, after, name, conclusion, job]) => ({
      jobs: [
        { name: job, status: "completed", conclusion, steps: [...before, { name, conclusion: "failure" }, ...after] },
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
      expect(scheduled.verdict({ needs: given, jobs: all, failed: red.failed })).toBe("red");
    }),
    options,
  );
});

it("property: with no failed step, job or test, needs decides: red on a failed job, green when all passed, else stopped", () => {
  // Plants: a canceled step counts as failed (red: a run stopped by hand opened an issue); a
  // finished job not `success` counts as failed (red: a leg canceled by hand opened one); green
  // with no job in needs (red: unreadable needs closed the issue).
  fc.assert(
    fc.property(fc.option(needs, { nil: null }), calmJobs, (given, jobs) => {
      const results = given === null ? [] : Object.values(given).map((job) => job.result);
      const expected = results.includes("failure")
        ? "red"
        : results.length > 0 && results.every((r) => r === "success")
          ? "green"
          : "stopped";
      expect(scheduled.verdict({ needs: given, jobs, failed: [] })).toBe(expected);
    }),
    options,
  );
  expect(scheduled.verdict({ needs: {}, jobs: [], failed: [] })).toBe("stopped");
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
  expect(scheduled.verdict({ needs: run43673342835.needs, jobs, failed })).toBe("red");
  // Each source alone: the steps, for a leg that broke before it wrote a report; the report, for a
  // jobs list that holds no failed step.
  expect(scheduled.verdict({ needs: run43673342835.needs, jobs, failed: [] })).toBe("red");
  expect(scheduled.verdict({ needs: run43673342835.needs, jobs: [], failed })).toBe("red");
});

it("property: the jobs API's answer reads as each job's name, status, conclusion and steps, and any other shape as none", () => {
  // Plants: keep only finished jobs (red: the running one dropped); drop a step's null conclusion to
  // "" (red: a running step read as a result).
  fc.assert(
    fc.property(calmJobs, fc.nat(), (jobs, id) => {
      const answer = {
        total_count: jobs.length,
        jobs: jobs.map((job, i) => ({
          id: id + i,
          ...job,
          steps: job.steps.map((step, n) => ({ number: n + 1, status: "completed", ...step })),
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
    { name: "", status: "", conclusion: null, steps: [{ name: "", conclusion: null }] },
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

/**
 * A fake GitHub: the run's jobs as the jobs API answers them, an open issue or none, a last green
 * run or none, and every call recorded.
 */
const fake = (jobs: unknown, open: number | null, last: string | null, failing: readonly string[] = []) => {
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
          { number: 1, pull_request: {} },
          ...(open === null ? [] : [{ number: open }]),
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
};

/** The jobs API's answer for this run's jobs. */
const answer = (jobs: Jobs) => ({ total_count: jobs.length, jobs });

/** The run's jobs, some with a failed step, as `proof` makes them. */
const runJobs = fc.oneof(
  calmJobs,
  fc.tuple(calmJobs, proof).map(([jobs, red]) => [...jobs, ...red.jobs]),
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

        expect(result).toBe(scheduled.verdict({ needs: given, jobs, failed }));
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

it("scenario: with no token, repository, workflow file or run id, no GitHub reader is made", () => {
  // scenario: each of the four missing alone.
  for (const missing of ["GITHUB_TOKEN", "GITHUB_REPOSITORY", "GITHUB_WORKFLOW_REF", "GITHUB_RUN_ID"]) {
    expect(scheduled.github({ ...env, [missing]: "" }), missing).toBeNull();
  }
});
