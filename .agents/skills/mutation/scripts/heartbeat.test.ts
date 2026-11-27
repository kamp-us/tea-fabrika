import { Array as Arr, ConfigProvider, Effect, Exit } from "effect";
import fc from "fast-check";
import { describe, expect, it } from "vitest";
import {
  Alarm,
  alarm,
  beat,
  DEFAULT_LATE_MINUTES,
  issueText,
  LABEL,
  line,
  type Pause,
  readPause,
  settings,
  TITLE,
} from "./heartbeat.ts";

// Today's lead tooling.
const options = { seed: 119120, numRuns: 300 };

const MINUTE = 60_000;

const LIMIT = DEFAULT_LATE_MINUTES * MINUTE;

const now = fc.integer({ min: 1.7e12, max: 1.9e12 });

const limit = fc.integer({ min: 1, max: 24 * 60 }).map((minutes) => minutes * MINUTE);

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
        const b = beat(t, pass === null ? null : t - pass, merges, l, null);
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
        expect(beat(t, pass === null ? null : t - pass, [], l, null)._tag).toBe("ok");
        expect(beat(t, null, [], l, { until: t + l, reason: "r" })._tag).toBe("ok");
      }),
      options,
    );
  });

  // vector: the edge, a merge exactly at the limit is not late, one ms more is.
  it("vector: the limit is on time and the limit and one ms is late", () => {
    const t = 1_794_386_862_934;
    expect(beat(t, null, [t - LIMIT], LIMIT, null)._tag).toBe("ok");
    expect(beat(t, null, [t - LIMIT - 1], LIMIT, null)._tag).toBe("late");
  });

  // vector: two missed hourly runs. A merge waits up to an hour for the next run, which takes up to
  // 45 minutes; the default allows two of those, so one failed run is not an alarm.
  it("vector: the default limit is 3.5 hours, two runs of an hour and 45 minutes", () => {
    expect(DEFAULT_LATE_MINUTES).toBe(2 * (60 + 45));
    expect(LIMIT).toBe(3.5 * 3_600_000);
  });
});

describe("the mutation heartbeat, today's tooling: the alarm", () => {
  const late = (t: number, pause: Pause | null = null) => beat(t, null, [t - LIMIT - 1], LIMIT, pause);

  const ok = (t: number) => beat(t, null, [], LIMIT, null);

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
        expect(beat(t, null, [t - 1], LIMIT, { until: t + shift, reason: "r" })._tag).toBe("ok");
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
    const b = beat(t, Date.parse("2026-11-26T10:00:00Z"), [Date.parse("2026-11-26T10:30:00Z")], LIMIT, null);
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

    expect(line(t, beat(t, pass, merges, short, null))).toBe(
      "mutation heartbeat: late: 2 merges since the last passing run (2026-11-11T05:40:24Z), the oldest 3.1 h ago, past the 2.0 h limit",
    );

    const until = Date.parse("2026-11-12T00:00:00Z");

    expect(line(t, beat(t, pass, merges, short, { until, reason: "runner image broken" }))).toBe(
      "mutation heartbeat: paused until 2026-11-12T00:00:00Z (runner image broken): 2 merges since the last passing run (2026-11-11T05:40:24Z), the oldest 3.1 h ago, past the 2.0 h limit",
    );

    expect(line(t, beat(t, pass, merges, short, { until: t - 1000, reason: "runner image broken" }))).toBe(
      "mutation heartbeat: late: 2 merges since the last passing run (2026-11-11T05:40:24Z), the oldest 3.1 h ago, past the 2.0 h limit; the pause ended 2026-11-11T08:50:59Z (runner image broken)",
    );

    expect(line(t, beat(t, null, [], short, null))).toBe(
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
        expect(yield* read({ MUTATION_LATE_MINUTES: "90" })).toEqual(Exit.succeed({ limit: 90 * MINUTE, pause: null }));
      }),
    ));

  it("scenario: a limit that is no whole number of minutes, or under one, is refused", () =>
    law(
      Effect.gen(function* () {
        for (const bad of ["0", "-5", "1.5", "soon"]) {
          expect(Exit.isFailure(yield* read({ MUTATION_LATE_MINUTES: bad })), bad).toBe(true);
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
