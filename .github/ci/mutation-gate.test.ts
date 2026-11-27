import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { decide, GAP_MINUTES, gate } from "./mutation-gate.mjs";
import type { Gh } from "./mutation-runs.mjs";

// Today's lead tooling. Covers mutation-gate.mjs: a push starts the work only when none started within the gap.
const options = { seed: 119120, numRuns: 300 };

const MINUTE = 60_000;

const GAP = GAP_MINUTES * MINUTE;

const API = "repos/{owner}/{repo}";

const now = fc.integer({ min: 1.7e12, max: 1.9e12 });

/** What the table at the top of the gate says, written out for each of its rows. */
const expected = (event: string, tested: boolean, tooSoon: boolean) =>
  event === "workflow_dispatch"
    ? { start: true, reason: "by_hand" }
    : tested
      ? { start: false, reason: "tested" }
      : tooSoon
        ? { start: false, reason: "too_soon" }
        : { start: true, reason: "due" };

describe("the gate, today's tooling", () => {
  it("a hand start always starts; a tested head never does on a push or the cron; else the gap decides", () => {
    fc.assert(
      fc.property(
        fc.constantFrom("push", "schedule", "workflow_dispatch"),
        now,
        fc.option(fc.integer({ min: -2 * GAP, max: 3 * GAP }), { nil: null }),
        fc.boolean(),
        (event, t, ago, tested) => {
          const last = ago === null ? null : t - ago;
          const tooSoon = last !== null && t - last < GAP;
          expect(decide({ event, now: t, gap: GAP, last, tested })).toEqual(expected(event, tested, tooSoon));
        },
      ),
      options,
    );
  });

  // vector: the edge, a run that started exactly one gap ago is not too soon.
  it("vector: a start exactly one gap ago allows the next, one ms less does not", () => {
    const t = 1_794_386_862_934;
    expect(decide({ event: "push", now: t, gap: GAP, last: t - GAP, tested: false }).start).toBe(true);
    expect(decide({ event: "push", now: t, gap: GAP, last: t - GAP + 1, tested: false }).start).toBe(false);
  });

  it("vector: the default gap is an hour, so at most 24 runs of the work a day", () => {
    expect(GAP_MINUTES).toBe(60);
  });

  const table = () => {
    const answers: Record<string, unknown> = {
      [`${API}/actions/workflows/mutation.yaml/runs?status=success&branch=main&per_page=30`]: {
        workflow_runs: [{ id: 5, created_at: "2026-11-26T10:00:00Z", head_sha: "passed5" }],
      },
      [`${API}/actions/runs/5/jobs?per_page=100`]: {
        jobs: [{ name: "mutation", conclusion: "success", started_at: "2026-11-26T10:00:05Z" }],
      },
      [`${API}/actions/workflows/mutation.yaml/runs?branch=main&per_page=30`]: {
        workflow_runs: [{ id: 5, created_at: "2026-11-26T10:00:00Z", head_sha: "passed5" }],
      },
    };

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

  const push = { GITHUB_EVENT_NAME: "push", GITHUB_RUN_ID: "9" };

  it("scenario: a push an hour after the last start, on a new head, starts, and names the last pass's commit as the base", () => {
    expect(gate(push, table(), at("2026-11-26T11:00:06Z"), "mutation.yaml", "mutation", "newhead")).toMatchObject({
      start: true,
      reason: "due",
      base: "passed5",
    });
  });

  it("scenario: a push inside the hour skips, and so does a head the last pass already covered", () => {
    expect(gate(push, table(), at("2026-11-26T10:30:00Z"), "mutation.yaml", "mutation", "newhead")).toMatchObject({
      start: false,
      reason: "too_soon",
    });
    expect(gate(push, table(), at("2026-11-26T15:00:00Z"), "mutation.yaml", "mutation", "passed5")).toMatchObject({
      start: false,
      reason: "tested",
    });
  });

  it("scenario: the gap is a setting, and a bad one fails the gate", () => {
    expect(
      gate(
        { ...push, MUTATION_GAP_MINUTES: "20" },
        table(),
        at("2026-11-26T10:30:00Z"),
        "mutation.yaml",
        "mutation",
        "h",
      ),
    ).toMatchObject({ start: true, reason: "due" });

    for (const bad of ["0", "-1", "1.5", "soon"]) {
      expect(
        () => gate({ ...push, MUTATION_GAP_MINUTES: bad }, table(), 0, "mutation.yaml", "mutation", "h"),
        bad,
      ).toThrow("MUTATION_GAP_MINUTES");
    }
  });

  it("scenario: a gate that cannot read GitHub throws, never answers skip", () => {
    const gh: Gh = () => {
      throw new Error("HTTP 502");
    };

    expect(() => gate({ GITHUB_EVENT_NAME: "push" }, gh, 0, "mutation.yaml", "mutation", "h")).toThrow("HTTP 502");
  });
});
