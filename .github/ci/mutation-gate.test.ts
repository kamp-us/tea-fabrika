import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { decide, FAIL_GAP_MINUTES, FAIL_STREAK, GAP_MINUTES, gate } from "./mutation-gate.mjs";
import type { Gh } from "./mutation-runs.mjs";

// Today's lead tooling. Covers mutation-gate.mjs: a push starts the work only when none started within the gap.
const options = { seed: 119120, numRuns: 300 };

const MINUTE = 60_000;

const GAP = GAP_MINUTES * MINUTE;

const API = "repos/{owner}/{repo}";

const now = fc.integer({ min: 1.7e12, max: 1.9e12 });

const MINUTE_FAIL = 60 * MINUTE;

/** What the table at the top of the gate says, written out for each of its rows. */
const expected = (event: string, tested: boolean, tooSoon: boolean, backoff: boolean) =>
  event === "workflow_dispatch"
    ? { start: true, reason: "by_hand" }
    : tested
      ? { start: false, reason: "tested" }
      : tooSoon
        ? { start: false, reason: "too_soon" }
        : backoff
          ? { start: false, reason: "backoff" }
          : { start: true, reason: "due" };

describe("the gate, today's tooling", () => {
  it("a hand start always starts; a tested head never does; a paced gate waits its gap; a failing run backs off; else it starts", () => {
    fc.assert(
      fc.property(
        fc.constantFrom("push", "schedule", "workflow_dispatch"),
        now,
        fc.option(fc.integer({ min: -2 * GAP, max: 3 * GAP }), { nil: null }),
        fc.boolean(),
        fc.boolean(),
        fc.integer({ min: 0, max: 6 }),
        (event, t, ago, tested, paced, streak) => {
          const last = ago === null ? null : t - ago;
          const gap = paced ? GAP : 0;
          const answer = decide({ event, now: t, gap, last, tested, streak, streakLimit: 3, failGap: MINUTE_FAIL });
          const tooSoon = last !== null && t - last < gap;
          const backoff = streak >= 3 && last !== null && t - last < MINUTE_FAIL;
          expect(answer).toEqual(expected(event, tested, tooSoon, backoff));
        },
      ),
      options,
    );
  });

  // vector: no gap and no streak: a push right after a start still starts, because concurrency paces the run.
  it("vector: with no gap and no failures a push seconds after the last start starts", () => {
    const t = 1_794_386_862_934;

    const seen = {
      event: "push",
      now: t,
      gap: 0,
      last: t - 1000,
      tested: false,
      streak: 0,
      streakLimit: 3,
      failGap: MINUTE_FAIL,
    };

    expect(decide(seen)).toEqual({ start: true, reason: "due" });
    // After three failures in a row it waits the fail gap: one ms inside is skipped, the gap itself starts.
    expect(decide({ ...seen, streak: 3, last: t - MINUTE_FAIL + 1 })).toEqual({ start: false, reason: "backoff" });
    expect(decide({ ...seen, streak: 3, last: t - MINUTE_FAIL })).toEqual({ start: true, reason: "due" });
    expect(decide({ ...seen, streak: 2, last: t - 1000 }).start).toBe(true);
  });

  // vector: the paced edge, a start exactly one gap ago allows the next, one ms less does not.
  it("vector: a paced start exactly one gap ago allows the next, one ms less does not", () => {
    const t = 1_794_386_862_934;
    const seen = { event: "push", now: t, gap: GAP, tested: false, streak: 0, streakLimit: 3, failGap: MINUTE_FAIL };
    expect(decide({ ...seen, last: t - GAP }).start).toBe(true);
    expect(decide({ ...seen, last: t - GAP + 1 }).start).toBe(false);
  });

  it("vector: the defaults are a 60-minute heartbeat gap, a streak of 3 and a 60-minute fail gap", () => {
    expect([GAP_MINUTES, FAIL_STREAK, FAIL_GAP_MINUTES]).toEqual([60, 3, 60]);
  });

  interface Seen {
    readonly id: number;
    readonly sha: string;
    readonly conclusion: string;
    readonly started: string;
  }

  /** A `gh` for `workflow` whose runs, newest first, each ran its `job` as `Seen` says. */
  const table = (seen: ReadonlyArray<Seen>, workflow = "mutation.yaml", job = "mutation") => {
    const runs = seen.map((r) => ({ id: r.id, created_at: r.started, head_sha: r.sha, conclusion: r.conclusion }));

    const answers: Record<string, unknown> = {
      [`${API}/actions/workflows/${workflow}/runs?status=success&branch=main&per_page=30`]: {
        workflow_runs: runs.filter((r) => r.conclusion === "success"),
      },
      [`${API}/actions/workflows/${workflow}/runs?branch=main&per_page=30`]: { workflow_runs: runs },
    };

    for (const r of seen) {
      answers[`${API}/actions/runs/${r.id}/jobs?per_page=100`] = {
        jobs: [{ name: job, conclusion: r.conclusion, started_at: r.started }],
      };
    }

    const gh: Gh = (args) => {
      const answer = answers[String(args[1])];

      if (answer === undefined) {
        throw new Error(`unexpected gh call: ${args.join(" ")}`);
      }

      return JSON.stringify(answer);
    };

    return gh;
  };

  const at = (iso: string) => Date.parse(iso);

  const push = { GITHUB_EVENT_NAME: "push", GITHUB_RUN_ID: "99" };

  const passed = { id: 5, sha: "passed5", conclusion: "success", started: "2026-11-26T10:00:05Z" };

  const failed = (id: number, started: string) => ({ id, sha: `f${id}`, conclusion: "failure", started });

  it("scenario: a push seconds after the last start, on a new head, starts, and names the last pass's commit as the base", () => {
    expect(
      gate(push, table([passed]), at("2026-11-26T10:00:20Z"), "mutation.yaml", "mutation", "newhead", false),
    ).toMatchObject({
      start: true,
      reason: "due",
      base: "passed5",
    });
  });

  it("scenario: a head the last pass already covered is skipped as tested", () => {
    expect(
      gate(push, table([passed]), at("2026-11-26T15:00:00Z"), "mutation.yaml", "mutation", "passed5", false),
    ).toMatchObject({
      start: false,
      reason: "tested",
    });
  });

  it("scenario: three failed runs in a row back off for the fail gap, and a pass between them resets the count", () => {
    const three = [
      failed(8, "2026-11-26T12:00:00Z"),
      failed(7, "2026-11-26T11:00:00Z"),
      failed(6, "2026-11-26T10:30:00Z"),
      passed,
    ];

    const soon = at("2026-11-26T12:30:00Z");
    const later = at("2026-11-26T13:00:01Z");

    expect(gate(push, table(three), soon, "mutation.yaml", "mutation", "h", false)).toMatchObject({
      start: false,
      reason: "backoff",
    });
    expect(gate(push, table(three), later, "mutation.yaml", "mutation", "h", false)).toMatchObject({
      start: true,
      reason: "due",
    });
    // Two failures after a pass are not a streak of three.
    expect(gate(push, table(three.slice(1)), soon, "mutation.yaml", "mutation", "h", false)).toMatchObject({
      start: true,
      reason: "due",
    });
    // A pass newest of all ends it.
    const healed = [{ id: 9, sha: "p9", conclusion: "success", started: "2026-11-26T12:10:00Z" }, ...three];
    expect(gate(push, table(healed), soon, "mutation.yaml", "mutation", "h", false)).toMatchObject({
      start: true,
      reason: "due",
    });
  });

  it("scenario: the streak is a setting, and a hand start ignores the backoff", () => {
    const three = [
      failed(8, "2026-11-26T12:00:00Z"),
      failed(7, "2026-11-26T11:00:00Z"),
      failed(6, "2026-11-26T10:30:00Z"),
      passed,
    ];

    const soon = at("2026-11-26T12:30:00Z");

    expect(
      gate({ ...push, MUTATION_FAIL_STREAK: "4" }, table(three), soon, "mutation.yaml", "mutation", "h", false),
    ).toMatchObject({ start: true });
    expect(
      gate(
        { ...push, MUTATION_FAIL_STREAK: "2", MUTATION_FAIL_GAP_MINUTES: "10" },
        table(three),
        at("2026-11-26T12:11:00Z"),
        "mutation.yaml",
        "mutation",
        "h",
        false,
      ),
    ).toMatchObject({ start: true });
    expect(
      gate(
        { GITHUB_EVENT_NAME: "workflow_dispatch", GITHUB_RUN_ID: "99" },
        table(three),
        soon,
        "mutation.yaml",
        "mutation",
        "h",
        false,
      ),
    ).toMatchObject({ start: true, reason: "by_hand" });
  });

  it("scenario: the paced heartbeat gate waits its gap and the gap is a setting; the mutation gate reads no gap at all", () => {
    const beat = table(
      [{ id: 5, sha: "x", conclusion: "success", started: "2026-11-26T10:00:05Z" }],
      "mutation-heartbeat.yaml",
      "heartbeat",
    );

    expect(
      gate(push, beat, at("2026-11-26T10:30:00Z"), "mutation-heartbeat.yaml", "heartbeat", null, true),
    ).toMatchObject({ start: false, reason: "too_soon" });
    expect(
      gate(push, beat, at("2026-11-26T11:01:00Z"), "mutation-heartbeat.yaml", "heartbeat", null, true),
    ).toMatchObject({ start: true, reason: "due" });
    expect(
      gate(
        { ...push, MUTATION_GAP_MINUTES: "20" },
        beat,
        at("2026-11-26T10:30:00Z"),
        "mutation-heartbeat.yaml",
        "heartbeat",
        null,
        true,
      ),
    ).toMatchObject({ start: true });
    // The mutation gate is not paced, so a bad gap setting is not read.
    expect(() =>
      gate({ ...push, MUTATION_GAP_MINUTES: "soon" }, table([passed]), 0, "mutation.yaml", "mutation", "h", false),
    ).not.toThrow();
  });

  it("scenario: a bad setting fails the gate", () => {
    for (const name of ["MUTATION_GAP_MINUTES", "MUTATION_FAIL_STREAK", "MUTATION_FAIL_GAP_MINUTES"]) {
      for (const bad of ["0", "-1", "1.5", "soon"]) {
        expect(
          () => gate({ ...push, [name]: bad }, table([passed]), 0, "mutation.yaml", "mutation", "h", true),
          `${name}=${bad}`,
        ).toThrow(name);
      }
    }
  });

  it("scenario: a gate that cannot read GitHub throws, never answers skip", () => {
    const gh: Gh = () => {
      throw new Error("HTTP 502");
    };

    expect(() => gate({ GITHUB_EVENT_NAME: "push" }, gh, 0, "mutation.yaml", "mutation", "h", false)).toThrow(
      "HTTP 502",
    );
  });
});
