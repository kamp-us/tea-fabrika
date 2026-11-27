import { Array as Arr, ConfigProvider, Effect, Exit } from "effect";
import fc from "fast-check";
import { describe, expect, it } from "vitest";
import {
  Alarm,
  alarm,
  beat,
  check,
  type Gh,
  DEFAULT_LATE_MINUTES,
  issueText,
  LABEL,
  LATE_RANGE,
  line,
  type Pause,
  readPause,
  settings,
  sync,
  TITLE,
} from "./heartbeat.ts";

// Today's lead tooling.
const options = { seed: 119120, numRuns: 300 };

const MINUTE = 60_000;

const LIMIT = DEFAULT_LATE_MINUTES * MINUTE;

const now = fc.integer({ min: 1.7e12, max: 1.9e12 });

const limit = fc.integer({ min: 1, max: 24 * 60 }).map((minutes) => minutes * MINUTE);

/** The merges as `beat` reads them: how many, and the oldest. */
const wait = (merges: ReadonlyArray<number>) => ({
  count: merges.length,
  oldest: merges.length === 0 ? null : Math.min(...merges),
});

const issue = fc.option(fc.integer({ min: 1, max: 9999 }), { nil: null });

const law = <A, E>(effect: Effect.Effect<A, E>) =>
  // oxlint-disable-next-line fabrika/no-effect-run-outside-edge -- edge: Vitest awaits the Promise a test hands back
  Effect.runPromise(effect);

describe("the mutation heartbeat, today's tooling: when it is late", () => {
  it("is late exactly when some merge since the last passing run is older than the limit", () => {
    fc.assert(
      fc.property(now, limit, fc.option(fc.nat()), fc.array(fc.nat(), { maxLength: 8 }), (t, l, pass, rolls) => {
        // Each merge's age is drawn from the limit's own range, so both sides of it are hit.
        const ages = Arr.map(rolls, (r) => (r % (4 * l)) - l);
        const merges = Arr.map(ages, (a) => t - a);
        const b = beat(t, pass === null ? null : t - pass, wait(merges), l, null);
        expect(b._tag).toBe(Arr.some(ages, (a) => a > l) ? "late" : "ok");
        expect(b.merges).toBe(merges.length);

        if (b._tag === "late") {
          expect(b.oldest).toBe(Math.min(...merges));
          expect(b.limit).toBe(l);
        }
      }),
      options,
    );
  });

  it("no merge is never late, however old the last passing run is, or with none, or under any pause", () => {
    fc.assert(
      fc.property(now, limit, fc.option(fc.integer({ min: 0, max: 1e10 })), (t, l, pass) => {
        expect(beat(t, pass === null ? null : t - pass, wait([]), l, null)._tag).toBe("ok");
        expect(beat(t, null, wait([]), l, { until: t + l, reason: "r" })._tag).toBe("ok");
      }),
      options,
    );
  });

  // vector: the edge, a merge exactly at the limit is not late, one ms more is.
  it("vector: the limit is on time and the limit and one ms is late", () => {
    const t = 1_794_386_862_934;
    expect(beat(t, null, wait([t - LIMIT]), LIMIT, null)._tag).toBe("ok");
    expect(beat(t, null, wait([t - LIMIT - 1]), LIMIT, null)._tag).toBe("late");
  });

  // vector: two missed hourly runs. A merge waits up to an hour for the next run, which takes up to
  // 45 minutes; the default allows two of those, so one failed run is not an alarm.
  it("vector: the default limit is 3.5 hours, two runs of an hour and 45 minutes", () => {
    expect(DEFAULT_LATE_MINUTES).toBe(2 * (60 + 45));
    expect(LIMIT).toBe(3.5 * 3_600_000);
  });
});

describe("the mutation heartbeat, today's tooling: the alarm", () => {
  const late = (t: number, pause: Pause | null = null) => beat(t, null, wait([t - LIMIT - 1]), LIMIT, pause);

  const ok = (t: number) => beat(t, null, wait([]), LIMIT, null);

  it("silence past the limit opens the issue, or updates the one that is open", () => {
    fc.assert(
      fc.property(now, issue, (t, open) => {
        expect(alarm(late(t), open)).toEqual(
          open === null ? Alarm.cases.open.make({}) : Alarm.cases.comment.make({ number: open }),
        );
      }),
      options,
    );
  });

  it("a green run closes the open issue and does nothing when none is open", () => {
    fc.assert(
      fc.property(now, issue, (t, open) => {
        expect(alarm(ok(t), open)).toEqual(
          open === null ? Alarm.cases.none.make({}) : Alarm.cases.close.make({ number: open }),
        );
      }),
      options,
    );
  });

  it("a pause with an end suppresses the alarm until the end, whatever issue is open", () => {
    fc.assert(
      fc.property(now, fc.integer({ min: 1, max: 1e9 }), issue, (t, ahead, open) => {
        const b = late(t, { until: t + ahead, reason: "the runner image is broken" });
        expect(b._tag).toBe("paused");
        expect(alarm(b, open)).toEqual(Alarm.cases.none.make({}));

        if (b._tag === "paused") {
          expect(b.until).toBe(t + ahead);
          expect(b.reason).toBe("the runner image is broken");
        }
      }),
      options,
    );
  });

  it("an expired pause alarms, and says it ran out", () => {
    fc.assert(
      fc.property(now, fc.integer({ min: 0, max: 1e9 }), issue, (t, past, open) => {
        const pause = { until: t - past, reason: "the runner image is broken" };
        const b = late(t, pause);
        expect(b._tag).toBe("late");
        expect(alarm(b, open)).toEqual(
          open === null ? Alarm.cases.open.make({}) : Alarm.cases.comment.make({ number: open }),
        );

        if (b._tag === "late") {
          expect(b.lapsed).toEqual(pause);
        }
      }),
      options,
    );
  });

  // vector: the end is the first moment the pause no longer holds.
  it("vector: a pause holds up to its end and alarms at it", () => {
    const t = 1_794_386_862_934;
    expect(late(t, { until: t + 1, reason: "r" })._tag).toBe("paused");
    expect(late(t, { until: t, reason: "r" })._tag).toBe("late");
  });

  it("a pause never turns a green run into anything else", () => {
    fc.assert(
      fc.property(now, fc.integer({ min: -1e9, max: 1e9 }), (t, shift) => {
        expect(beat(t, null, wait([t - 1]), LIMIT, { until: t + shift, reason: "r" })._tag).toBe("ok");
      }),
      options,
    );
  });

  it("pinned: its issue carries its own label, never the one that switches on a sev1", () => {
    expect(LABEL).not.toBe("ci-scheduled");
    expect(LABEL).toBe("mutation-heartbeat");
  });

  it("format: the issue text says what is late, that a passing run closes it, and how to pause it", () => {
    const t = Date.parse("2026-11-26T20:00:00Z");
    const b = beat(t, Date.parse("2026-11-26T10:00:00Z"), wait([Date.parse("2026-11-26T10:30:00Z")]), LIMIT, null);
    const text = issueText(t, b);
    expect(TITLE.length).toBeGreaterThan(0);
    expect(text).toContain(line(t, b));
    expect(text).toContain("passing run of mutation.yaml on main closes this issue");
    expect(text).toContain("MUTATION_PAUSE");
    expect(text).toContain("mutation-heartbeat.yaml");
  });
});

describe("the mutation heartbeat, today's tooling: its lines", () => {
  // format: the lines a heartbeat run shows, from 2026-11-11's real gap (last pass 05:40:24Z).
  it("format: the late, paused, lapsed and ok lines", () => {
    const pass = Date.parse("2026-11-11T05:40:24Z");
    const t = Date.parse("2026-11-11T08:51:00Z");
    const oldest = Date.parse("2026-11-11T05:45:38Z");
    const short = 2 * 60 * MINUTE;
    const merges = [oldest, t - 60_000];

    expect(line(t, beat(t, pass, wait(merges), short, null))).toBe(
      "mutation heartbeat: late: 2 merges since the last passing run (2026-11-11T05:40:24Z), the oldest 3.1 h ago, past the 2.0 h limit",
    );

    const until = Date.parse("2026-11-12T00:00:00Z");

    expect(line(t, beat(t, pass, wait(merges), short, { until, reason: "runner image broken" }))).toBe(
      "mutation heartbeat: paused until 2026-11-12T00:00:00Z (runner image broken): 2 merges since the last passing run (2026-11-11T05:40:24Z), the oldest 3.1 h ago, past the 2.0 h limit",
    );

    expect(line(t, beat(t, pass, wait(merges), short, { until: t - 1000, reason: "runner image broken" }))).toBe(
      "mutation heartbeat: late: 2 merges since the last passing run (2026-11-11T05:40:24Z), the oldest 3.1 h ago, past the 2.0 h limit; the pause ended 2026-11-11T08:50:59Z (runner image broken)",
    );

    expect(line(t, beat(t, null, wait([]), short, null))).toBe(
      "mutation heartbeat: ok: 0 merges since the last passing run (none)",
    );
  });
});

describe("the mutation heartbeat, today's tooling: its settings", () => {
  const read = (env: Record<string, string>) => settings(ConfigProvider.fromEnvRecord(env)).pipe(Effect.exit);

  it("scenario: with nothing set, the default limit and no pause", () =>
    law(
      Effect.gen(function* () {
        expect(yield* read({})).toEqual(Exit.succeed({ limit: DEFAULT_LATE_MINUTES * MINUTE, pause: null }));
      }),
    ));

  it("scenario: the limit is a setting, in minutes", () =>
    law(
      Effect.gen(function* () {
        expect(yield* read({ MUTATION_LATE_MINUTES: "120" })).toEqual(
          Exit.succeed({ limit: 120 * MINUTE, pause: null }),
        );
      }),
    ));

  it("scenario: a limit that is no whole number of minutes, or outside 105 to 1440, is refused", () =>
    law(
      Effect.gen(function* () {
        for (const bad of ["0", "-5", "1.5", "soon", "104", "1441", "100000"]) {
          expect(Exit.isFailure(yield* read({ MUTATION_LATE_MINUTES: bad })), bad).toBe(true);
        }
      }),
    ));

  it("scenario: the edges of the limit's range are allowed", () =>
    law(
      Effect.gen(function* () {
        for (const edge of [LATE_RANGE.least, LATE_RANGE.most]) {
          expect(yield* read({ MUTATION_LATE_MINUTES: String(edge) })).toEqual(
            Exit.succeed({ limit: edge * MINUTE, pause: null }),
          );
        }
      }),
    ));

  it("scenario: a pause carries an end and a reason", () =>
    law(
      Effect.gen(function* () {
        const text = JSON.stringify({ until: "2026-12-01T00:00:00Z", reason: "runner image broken" });

        expect(yield* read({ MUTATION_PAUSE: text })).toEqual(
          Exit.succeed({
            limit: DEFAULT_LATE_MINUTES * MINUTE,
            pause: { until: Date.parse("2026-12-01T00:00:00Z"), reason: "runner image broken" },
          }),
        );
      }),
    ));

  it("scenario: an empty or blank pause is no pause", () =>
    law(
      Effect.gen(function* () {
        for (const blank of ["", "  "]) {
          expect(yield* Effect.exit(readPause(blank))).toEqual(Exit.succeed(null));
        }
      }),
    ));

  it("scenario: a pause with no end, no reason, an empty reason or a bad date is refused, never read as no pause", () =>
    law(
      Effect.gen(function* () {
        const bad = [
          { reason: "x" },
          { until: "2026-12-01T00:00:00Z" },
          { until: "2026-12-01T00:00:00Z", reason: "" },
          { until: "someday", reason: "x" },
        ];

        for (const pause of bad) {
          expect(Exit.isFailure(yield* read({ MUTATION_PAUSE: JSON.stringify(pause) })), JSON.stringify(pause)).toBe(
            true,
          );
        }

        expect(Exit.isFailure(yield* read({ MUTATION_PAUSE: "not json" }))).toBe(true);
      }),
    ));
});

describe("the mutation heartbeat, today's tooling: what it asks GitHub", () => {
  const API = "repos/{owner}/{repo}";
  const RUNS = `${API}/actions/workflows/mutation.yaml/runs?status=success&branch=main&per_page=30`;
  const jobs = (id: number) => `${API}/actions/runs/${id}/jobs?per_page=100`;

  /** A `gh` that answers only what its table holds, and records each call. */
  const fake = (table: Record<string, unknown>) => {
    const calls: string[][] = [];

    const gh: Gh = (args) => {
      calls.push([...args]);
      const answer = table[args[0] === "api" ? String(args[1]) : args.join(" ")];

      if (answer === undefined) {
        throw new Error(`unexpected gh call: ${args.join(" ")}`);
      }

      return JSON.stringify(answer);
    };

    return { gh, calls };
  };

  const t = Date.parse("2026-11-26T20:00:00Z");

  const job = (name: string, conclusion: string) => ({
    name,
    conclusion,
    started_at: "2026-11-26T09:00:00Z",
  });

  it("scenario: the last pass is a run whose mutation job passed, never a run the gate skipped, and the count is GitHub's ahead_by", () => {
    const { gh, calls } = fake({
      [RUNS]: {
        workflow_runs: [
          { id: 9, created_at: "2026-11-26T12:00:00Z", head_sha: "skipped9" },
          { id: 8, created_at: "2026-11-26T10:00:00Z", head_sha: "passed8" },
        ],
      },
      [jobs(9)]: { jobs: [job("gate", "success"), job("mutation", "skipped")] },
      [jobs(8)]: { jobs: [job("gate", "success"), job("mutation", "success")] },
      [`${API}/compare/passed8...main?per_page=1`]: {
        ahead_by: 250,
        commits: [{ commit: { committer: { date: "2026-11-26T10:30:00Z" } } }],
      },
    });

    const b = check(t, LIMIT, null, gh);

    expect(calls).toEqual([
      ["api", RUNS],
      ["api", jobs(9)],
      ["api", jobs(8)],
      ["api", `${API}/compare/passed8...main?per_page=1`],
    ]);
    expect(b).toMatchObject({ _tag: "late", merges: 250, lastPass: Date.parse("2026-11-26T10:00:00Z") });
    expect(line(t, b)).toContain("250 merges since the last passing run (2026-11-26T10:00:00Z)");
  });

  it("scenario: no passing run ever reads the newest 100 commits", () => {
    const { gh, calls } = fake({
      [RUNS]: { workflow_runs: [] },
      [`${API}/commits?sha=main&per_page=100`]: [
        { commit: { committer: { date: "2026-11-26T10:30:00Z" } } },
        { commit: { committer: { date: "2026-11-26T10:00:00Z" } } },
      ],
    });

    // The oldest of the commits, not the newest: the older one has waited longest.
    expect(check(t, LIMIT, null, gh)).toMatchObject({
      _tag: "late",
      merges: 2,
      lastPass: null,
      oldest: Date.parse("2026-11-26T10:00:00Z"),
    });
    expect(calls).toEqual([
      ["api", RUNS],
      ["api", `${API}/commits?sha=main&per_page=100`],
    ]);
  });

  const LIST = ["issue", "list", "--label", LABEL, "--state", "open", "--json", "number,title", "--limit", "20"];

  const late = beat(t, null, { count: 3, oldest: t - LIMIT - 1 }, LIMIT, null);

  it("scenario: it opens an issue when no open one has its title, even when another open issue has its label", () => {
    const calls: string[][] = [];

    const gh: Gh = (args) => {
      calls.push([...args]);

      return args[1] === "list" ? JSON.stringify([{ number: 5, title: "something else" }]) : "";
    };

    sync(t, late, gh);

    expect(calls.map((c) => c.slice(0, 2).join(" "))).toEqual(["issue list", "label create", "issue create"]);
    expect(calls[0]).toEqual(LIST);
    expect(calls[2]).toEqual(["issue", "create", "--title", TITLE, "--label", LABEL, "--body", issueText(t, late)]);
  });

  it("scenario: it comments on the open issue with its title, and closes it when green", () => {
    const calls: string[][] = [];

    const gh: Gh = (args) => {
      calls.push([...args]);

      return args[1] === "list" ? JSON.stringify([{ number: 7, title: TITLE }]) : "";
    };

    sync(t, late, gh);
    sync(t, beat(t, null, { count: 0, oldest: null }, LIMIT, null), gh);

    expect(calls.filter((c) => c[1] !== "list")).toEqual([
      ["issue", "comment", "7", "--body", issueText(t, late)],
      ["issue", "close", "7", "--reason", "completed", "--comment", expect.stringContaining("mutation heartbeat: ok")],
    ]);
  });
});
