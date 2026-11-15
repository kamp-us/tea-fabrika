import * as fc from "fast-check";
import { expect, it } from "vitest";
import * as scheduled from "./scheduled.mjs";

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

it("property: a run is red when any job failed, green when every job passed, and stopped otherwise", () => {
  // Plants: red only when every job failed (red: one red leg among canceled ones read as stopped);
  // green when no job failed (red: a run canceled by hand read as green, and closed the issue).
  fc.assert(
    fc.property(needs, (given) => {
      const results = Object.values(given).map((job) => job.result);
      const expected = results.includes("failure")
        ? "red"
        : results.every((r) => r === "success")
          ? "green"
          : "stopped";
      expect(scheduled.verdict(given)).toBe(expected);
    }),
    {
      ...options,
      examples: [
        // pinned: a red leg stops the run, so the other legs end canceled; that is red, not stopped.
        [{ next: { result: "failure", outputs: {} }, tooling: { result: "cancelled", outputs: {} } }],
      ],
    },
  );
  expect(scheduled.verdict(null)).toBe("stopped");
  expect(scheduled.verdict({})).toBe("stopped");
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

/** A fake GitHub: an open issue or none, a last green run or none, and every call recorded. */
const fake = (open: number | null, last: string | null, failing: readonly string[] = []) => {
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

it("property: the report makes exactly the calls its action needs, each with the job's token", async () => {
  // Plants: close without the comment (red: no comment call); open without the label (red: no
  // label call); ask for the last green run on a green run (red: an extra call).
  await fc.assert(
    fc.asyncProperty(
      needs,
      fc.option(fc.integer({ min: 2, max: 9999 }), { nil: null }),
      fc.option(sha, { nil: null }),
      reports,
      async (given, open, last, results) => {
        const { calls, send } = fake(open, last);
        const api = scheduled.github(env, send)!;
        const action = await scheduled.report({ needs: given, reports: results, env, api });
        const result = scheduled.verdict(given);
        const writes = calls
          .filter((c) => c.method !== "GET")
          .map((c) => `${c.method} ${c.url.split("/repos/owner/repo/")[1]}`);

        expect(calls.every((c) => c.auth === "Bearer token-made-up")).toBe(true);

        if (result === "stopped") {
          expect(calls).toEqual([]);
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
          for (const test of scheduled.failures(results, "/work/repo").slice(0, scheduled.SHOWN)) {
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

it("property: an error from GitHub fails the report, so a red run's issue never goes missing quietly", async () => {
  // Plant: catch and ignore a failed write (red: the report resolved).
  await fc.assert(
    fc.asyncProperty(
      fc.constantFrom("issues", "actions/workflows/"),
      fc.option(fc.integer({ min: 2, max: 9999 }), { nil: null }),
      async (failing, open) => {
        const { send } = fake(open, null, [failing]);
        const api = scheduled.github(env, send)!;
        const red = { next: { result: "failure" }, tooling: { result: "cancelled" } };
        await expect(scheduled.report({ needs: red, reports: [], env, api })).rejects.toThrow();
      },
    ),
    options,
  );
});

it("scenario: with no token, repository or workflow file, no GitHub reader is made", () => {
  // scenario: each of the three missing alone.
  for (const missing of ["GITHUB_TOKEN", "GITHUB_REPOSITORY", "GITHUB_WORKFLOW_REF"]) {
    expect(scheduled.github({ ...env, [missing]: "" }), missing).toBeNull();
  }
});
