import { spawnSync } from "node:child_process";
import { chmodSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { type Gh, passedRun, recent, SCAN } from "./mutation-runs.mjs";

// Today's lead tooling. Covers mutation-runs.mjs: a run counts by its own job, never by the run's conclusion.
const API = "repos/{owner}/{repo}";

const WORKFLOW = `${API}/actions/workflows/mutation.yaml/runs`;

const jobsOf = (id: number) => `${API}/actions/runs/${id}/jobs?per_page=100`;

/** A `gh` that answers only what its table holds, and records each call. */
const fake = (table: Record<string, unknown>) => {
  const calls: string[][] = [];

  const gh: Gh = (args) => {
    calls.push([...args]);
    const answer = table[String(args[1])];

    if (args[0] !== "api" || answer === undefined) {
      throw new Error(`unexpected gh call: ${args.join(" ")}`);
    }

    return JSON.stringify(answer);
  };

  return { gh, calls };
};

const run = (id: number, created: string, sha: string) => ({ id, created_at: created, head_sha: sha });

const job = (name: string, conclusion: string | null, started: string | null) => ({
  name,
  conclusion,
  started_at: started,
});

const PASSED = `${WORKFLOW}?status=success&branch=main&per_page=${SCAN}`;

const RECENT = `${WORKFLOW}?branch=main&per_page=${SCAN}`;

describe("mutation-runs.mjs, today's tooling", () => {
  it("scenario: the last pass is the newest run whose mutation job concluded success, and its calls are exact", () => {
    const { gh, calls } = fake({
      [PASSED]: {
        workflow_runs: [
          run(3, "2026-11-26T12:00:00Z", "c3"),
          run(2, "2026-11-26T11:00:00Z", "c2"),
          run(1, "2026-11-26T10:00:00Z", "c1"),
        ],
      },
      [jobsOf(3)]: {
        jobs: [job("gate", "success", "2026-11-26T12:00:01Z"), job("mutation", "skipped", "2026-11-26T12:00:09Z")],
      },
      [jobsOf(2)]: { jobs: [job("gate", "success", "2026-11-26T11:00:01Z")] },
      [jobsOf(1)]: { jobs: [job("mutation", "success", "2026-11-26T10:00:05Z")] },
    });

    expect(passedRun(gh, "mutation.yaml", "mutation")).toEqual({
      createdAt: Date.parse("2026-11-26T10:00:00Z"),
      headSha: "c1",
    });
    expect(calls.map((c) => c[1])).toEqual([PASSED, jobsOf(3), jobsOf(2), jobsOf(1)]);
  });

  it("scenario: no run whose job passed is no pass, however many runs ended success", () => {
    const { gh } = fake({
      [PASSED]: { workflow_runs: [run(3, "2026-11-26T12:00:00Z", "c3")] },
      [jobsOf(3)]: { jobs: [job("mutation", "skipped", "2026-11-26T12:00:09Z")] },
    });

    expect(passedRun(gh, "mutation.yaml", "mutation")).toBeNull();
  });

  it("scenario: the last start is the newest run whose job ran, red or green, never a skipped job or the run itself, and the failures before the first pass are counted", () => {
    const { gh, calls } = fake({
      [RECENT]: {
        workflow_runs: [
          run(5, "2026-11-26T14:00:00Z", "c5"),
          run(4, "2026-11-26T13:00:00Z", "c4"),
          run(3, "2026-11-26T12:00:00Z", "c3"),
          run(2, "2026-11-26T11:00:00Z", "c2"),
          run(1, "2026-11-26T10:00:00Z", "c1"),
        ],
      },
      [jobsOf(4)]: { jobs: [job("mutation", "failure", "2026-11-26T13:00:30Z")] },
      [jobsOf(3)]: { jobs: [job("mutation", "skipped", "2026-11-26T12:00:09Z")] },
      [jobsOf(2)]: { jobs: [job("mutation", "timed_out", "2026-11-26T11:00:30Z")] },
      [jobsOf(1)]: { jobs: [job("mutation", "success", "2026-11-26T10:00:30Z")] },
    });

    expect(recent(gh, "mutation.yaml", "mutation", 5, 9)).toEqual({
      last: Date.parse("2026-11-26T13:00:30Z"),
      streak: 2,
    });
    expect(calls.map((c) => c[1])).toEqual([RECENT, jobsOf(4), jobsOf(3), jobsOf(2), jobsOf(1)]);
  });

  it("scenario: a skipped job that carries a start time is no start, so a gate-skipped run never refreshes the last start", () => {
    const { gh } = fake({
      [RECENT]: { workflow_runs: [run(3, "2026-11-26T12:00:00Z", "c3"), run(2, "2026-11-26T11:00:00Z", "c2")] },
      [jobsOf(3)]: { jobs: [job("mutation", "skipped", "2026-11-26T12:00:09Z")] },
      [jobsOf(2)]: { jobs: [job("mutation", "failure", "2026-11-26T11:00:30Z")] },
    });

    expect(recent(gh, "mutation.yaml", "mutation", null, 9)).toEqual({
      last: Date.parse("2026-11-26T11:00:30Z"),
      streak: 1,
    });
  });

  it("scenario: a job canceled after it started is a start, and ends neither a streak nor starts one", () => {
    const { gh } = fake({
      [RECENT]: {
        workflow_runs: [
          run(3, "2026-11-26T12:00:00Z", "c3"),
          run(2, "2026-11-26T11:00:00Z", "c2"),
          run(1, "2026-11-26T10:00:00Z", "c1"),
        ],
      },
      [jobsOf(3)]: { jobs: [job("mutation", "cancelled", "2026-11-26T12:00:20Z")] },
      [jobsOf(2)]: { jobs: [job("mutation", "failure", "2026-11-26T11:00:30Z")] },
      [jobsOf(1)]: { jobs: [job("mutation", "success", "2026-11-26T10:00:30Z")] },
    });

    expect(recent(gh, "mutation.yaml", "mutation", null, 9)).toEqual({
      last: Date.parse("2026-11-26T12:00:20Z"),
      streak: 1,
    });
  });

  it("scenario: a pass ends the streak, so a pass newer than the failures reads none", () => {
    const { gh } = fake({
      [RECENT]: { workflow_runs: [run(2, "2026-11-26T11:00:00Z", "c2"), run(1, "2026-11-26T10:00:00Z", "c1")] },
      [jobsOf(2)]: { jobs: [job("mutation", "success", "2026-11-26T11:00:30Z")] },
      [jobsOf(1)]: { jobs: [job("mutation", "failure", "2026-11-26T10:00:30Z")] },
    });

    expect(recent(gh, "mutation.yaml", "mutation", null, 9)).toEqual({
      last: Date.parse("2026-11-26T11:00:30Z"),
      streak: 0,
    });
  });

  it("scenario: the walk stops once the streak reaches the limit, and a canceled job that never started counts for nothing", () => {
    const { gh, calls } = fake({
      [RECENT]: {
        workflow_runs: [
          run(4, "2026-11-26T13:00:00Z", "c4"),
          run(3, "2026-11-26T12:00:00Z", "c3"),
          run(2, "2026-11-26T11:00:00Z", "c2"),
          run(1, "2026-11-26T10:00:00Z", "c1"),
        ],
      },
      [jobsOf(4)]: { jobs: [job("mutation", "cancelled", null)] },
      [jobsOf(3)]: { jobs: [job("mutation", "failure", "2026-11-26T12:00:30Z")] },
      [jobsOf(2)]: { jobs: [job("mutation", "failure", "2026-11-26T11:00:30Z")] },
    });

    expect(recent(gh, "mutation.yaml", "mutation", null, 2)).toEqual({
      last: Date.parse("2026-11-26T12:00:30Z"),
      streak: 2,
    });
    expect(calls.map((c) => c[1])).toEqual([RECENT, jobsOf(4), jobsOf(3), jobsOf(2)]);
  });

  /**
   * heartbeat.ts run as a program against a fake `gh` that answers from `table`, and the line it prints. It is run, not
   * imported, so a change to heartbeat.ts selects only its own tests (related.test.ts).
   */
  const heartbeatLine = (table: Record<string, unknown>) => {
    const dir = mkdtempSync(join(tmpdir(), "mutation-runs-"));

    writeFileSync(
      join(dir, "gh"),
      [
        "#!/usr/bin/env node",
        "const table = JSON.parse(process.env.FAKE_TABLE);",
        "const key = process.argv[2] === 'api' ? process.argv[3] : process.argv.slice(2).join(' ');",
        "const compare = key.includes('/compare/') ? { ahead_by: 1, commits: [{ commit: { committer: { date: '2026-11-26T11:00:00Z' } } }] } : undefined;",
        "const answer = table[key] ?? compare;",
        "if (answer === undefined) { console.error('unexpected gh call: ' + key); process.exit(1); }",
        "console.log(JSON.stringify(answer));",
      ].join("\n"),
    );
    chmodSync(join(dir, "gh"), 0o755);

    return spawnSync(process.execPath, [".agents/skills/mutation/scripts/heartbeat.ts"], {
      encoding: "utf8",
      env: { ...process.env, PATH: `${dir}:${process.env["PATH"]}`, FAKE_TABLE: JSON.stringify(table) },
    }).stdout;
  };

  it("scenario: the gate's read and the heartbeat's read give one last pass", () => {
    const table = {
      [PASSED]: {
        workflow_runs: [run(3, "2026-11-26T12:00:00Z", "c3"), run(2, "2026-11-26T10:00:00Z", "c2")],
      },
      [jobsOf(3)]: { jobs: [job("mutation", "skipped", "2026-11-26T12:00:09Z")] },
      [jobsOf(2)]: { jobs: [job("mutation", "success", "2026-11-26T10:00:05Z")] },
    };

    // The last pass is the run at 10:00 (c2), the older one: the newer run's job was skipped.
    expect(passedRun(fake(table).gh, "mutation.yaml", "mutation")).toEqual({
      createdAt: Date.parse("2026-11-26T10:00:00Z"),
      headSha: "c2",
    });
    expect(heartbeatLine(table)).toContain("since the last passing run (2026-11-26T10:00:00Z)");

    // No run whose job passed: none for both.
    const none = { ...table, [jobsOf(2)]: { jobs: [] } };

    expect(passedRun(fake(none).gh, "mutation.yaml", "mutation")).toBeNull();
    expect(heartbeatLine({ ...none, [`${API}/commits?sha=main&per_page=100`]: [] })).toContain("(none)");
  });
});
