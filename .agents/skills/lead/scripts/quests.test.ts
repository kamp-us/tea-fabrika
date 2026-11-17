// quests.ts: the reader of a quest's heartbeat (ticket 685). Today's lead tooling. The pure laws step
// `verdict` on fixed clocks; the read laws write a made-up BOXES folder in a temp folder and set
// Effect's test clock: no real quest, box or process is read or touched.
import { NodeServices } from "@effect/platform-node";
import { Effect, FileSystem, Layer, Path, type Scope } from "effect";
import { TestClock } from "effect/testing";
import fc from "fast-check";
import { describe, expect, it } from "vitest";
import * as Beat from "./flow/Beat.ts";
import * as Quests from "./quests.ts";

const options = { seed: 119120, numRuns: 300 };

const T0 = Date.parse("2026-11-12T14:00:00.000Z");

const MIN = 60_000;

const iso = (offset: number) => new Date(T0 + offset).toISOString();

const at = (offset: number) => new Date(T0 + offset);

const beat = (phase: Beat.Phase, sinceMs: number, atMs: number, agentMs: number | null = null): Beat.Beat => ({
  at: iso(atMs),
  phase,
  since: iso(sinceMs),
  agentAt: agentMs === null ? null : iso(agentMs),
});

const closed = (step: string, box: string) => ({
  step,
  startedAt: iso(-60 * MIN),
  endedAt: iso(-50 * MIN),
  line: { box },
});

const opened = (step: string, startedMs: number) => ({ step, startedAt: iso(startedMs), endedAt: null, line: null });

const record = (over: Partial<Quests.Record> = {}): Quests.Record => ({ landed: null, steps: [], ...over });

const seen = (over: Partial<Quests.Seen> & { readonly record?: Quests.Record } = {}): Quests.Seen => ({
  quest: "t1",
  found: Quests.Found.cases.read.make({ record: over.record ?? record() }),
  held: false,
  end: null,
  boxes: [],
  ...over,
});

const phase = fc.constantFrom(...Beat.PHASES);

const span = fc.integer({ min: 0, max: 6 * 60 * MIN });

describe("Quests.verdict", () => {
  // Plant: let a beat or an open step win over the quest's own end.
  it("a quest no process holds that ended ask or stuck waits on the lead, whatever its record holds", () => {
    fc.assert(
      fc.property(
        fc.constantFrom("ask" as const, "stuck" as const),
        fc.string(),
        fc.option(fc.tuple(phase, span, span), { nil: null }),
        fc.boolean(),
        span,
        (outcome, reason, left, open, later) => {
          const line = Quests.verdict(
            seen({
              end: { outcome, reason, at: iso(0) },
              record: record({
                steps: [open ? opened("build", -5 * MIN) : closed("build", "t1-build1")],
                ...(left === null ? {} : { beat: beat(left[0], -left[1], -left[2]) }),
              }),
            }),
            at(later),
          );

          expect(line.state).toBe("waits");
          expect(line.since).toBe(iso(0));
          expect(line.text).toBe(`${outcome}: ${reason}`);
          expect(line.step).toBe("build");
        },
      ),
      options,
    );
  });

  // Plant: read the beat with other rules than Beat.says, or let the seconds go negative.
  it("a held quest with a beat is stuck exactly when Beat.says so, and its quiet seconds never go below 0", () => {
    fc.assert(
      fc.property(
        phase,
        span,
        fc.integer({ min: -30 * MIN, max: 30 * MIN }),
        fc.option(span, { nil: null }),
        fc.option(fc.constantFrom("ask" as const, "stuck" as const, "done" as const), { nil: null }),
        (p, since, quiet, agent, old) => {
          const b = beat(p, -since - Math.max(0, quiet), -quiet, agent === null ? null : -agent);

          const line = Quests.verdict(
            seen({
              held: true,
              // An outcome a process printed before the quest was started again.
              end: old === null ? null : { outcome: old, reason: "before the restart", at: iso(-90 * MIN) },
              record: record({ steps: [opened("tests", -since)], beat: b }),
            }),
            at(0),
          );

          const said = Beat.says(b, at(0));
          expect(line.state).toBe(said.stuck ? "stuck" : "running");
          expect(line.text).toBe(said.text);
          expect(line.phase).toBe(p);
          expect(line.since).toBe(b.since);
          expect(line.quietSeconds).toBe(Math.max(0, Math.floor(quiet / 1000)));
        },
      ),
      options,
    );
  });

  it("scenario: a beat written 12 minutes ago, past the 10 minute limit, reads as stuck with its seconds", () => {
    const line = Quests.verdict(
      seen({
        held: true,
        record: record({ steps: [opened("build", -112 * MIN)], beat: beat("cleanup", -110 * MIN, -12 * MIN) }),
      }),
      at(0),
    );

    expect(line).toMatchObject({ state: "stuck", phase: "cleanup", quietSeconds: 720, step: "build" });
    expect(line.text).toBe("cleanup for 1h50m, no beat for 12m: stuck");
  });

  it("scenario: a beat in the future, from a clock that moved, reads as running with 0 quiet seconds", () => {
    const line = Quests.verdict(
      seen({ held: true, record: record({ steps: [opened("tests", 0)], beat: beat("box", 5 * MIN, 5 * MIN) }) }),
      at(0),
    );

    expect(line).toMatchObject({ state: "running", quietSeconds: 0, phase: "box" });
  });

  // Plant: call an open step with no beat running for good, as the status page did (ticket 685).
  it("an open step with no beat is running up to the beat's limit and stuck past it", () => {
    fc.assert(
      fc.property(span, fc.boolean(), (age, held) => {
        const line = Quests.verdict(seen({ held, record: record({ steps: [opened("review", -age)] }) }), at(0));
        expect(line.state).toBe(age > Beat.QUIET ? "stuck" : "running");
        expect(line.quietSeconds).toBeNull();
        expect(line.since).toBe(iso(-age));
        expect(line.text).toContain("no beat in the record");
      }),
      options,
    );
  });

  it("scenario: a record that says when it landed is landed, whatever else it holds", () => {
    const line = Quests.verdict(
      seen({
        held: true,
        end: { outcome: "ask", reason: "an older stop", at: iso(-MIN) },
        record: record({
          landed: iso(-3 * MIN),
          steps: [closed("review", "t1-review2")],
          beat: beat("land", -60 * MIN, -60 * MIN),
        }),
      }),
      at(0),
    );

    expect(line).toMatchObject({ state: "landed", since: iso(-3 * MIN), step: "review", box: "t1-review2" });
  });

  it("scenario: a quest from before the landed field that ended done is landed, since its last output", () => {
    const line = Quests.verdict(
      seen({
        end: { outcome: "done", reason: "PR 7 landed", at: iso(-MIN) },
        record: record({ steps: [closed("review", "")] }),
      }),
      at(0),
    );

    expect(line).toMatchObject({ state: "landed", since: iso(-MIN), text: "PR 7 landed", box: null });
  });

  // Plants: call a queued quest landed; call it queued while a new process holds the quest.
  it("scenario: a record that says when it was queued is queued, never landed, until a process holds the quest again or it lands", () => {
    const queued = record({ queued: iso(-2 * MIN), steps: [closed("review", "t1-review2")] });
    const end = { outcome: "done", reason: "PR 7 queued", at: iso(-MIN) } as const;
    expect(Quests.verdict(seen({ end, record: queued }), at(0))).toMatchObject({
      state: "queued",
      since: iso(-2 * MIN),
      text: "in GitHub's merge queue",
    });
    const again = seen({ held: true, end, record: { ...queued, beat: beat("agent", -MIN, -MIN) } });
    expect(Quests.verdict(again, at(0)).state).toBe("running");
    const landed = seen({ end, record: { ...queued, landed: iso(-MIN) } });
    expect(Quests.verdict(landed, at(0)).state).toBe("landed");
  });

  it("scenario: with no record, an unreadable record, or nothing to go on, the state is unknown and says why", () => {
    const missing = Quests.verdict(seen({ found: Quests.Found.cases.missing.make({}) }), at(0));
    const unreadable = Quests.verdict(seen({ found: Quests.Found.cases.unreadable.make({}) }), at(0));
    const bare = Quests.verdict(seen({ record: record({ steps: [closed("tests", "t1-tests1")] }) }), at(0));
    const held = Quests.verdict(seen({ held: true, record: record() }), at(0));
    expect([missing.state, unreadable.state, bare.state, held.state]).toEqual([
      "unknown",
      "unknown",
      "unknown",
      "unknown",
    ]);
    expect(missing.text).toBe("no chain record");
    expect(unreadable.text).toBe("the chain record does not read");
    expect(bare.text).toBe("no beat, no open step and no outcome line");
    expect(held.text).toBe("a process holds the quest, and its record has no beat and no open step");
  });

  it("scenario: an open step's box is the standing one of that quest and step with the highest number", () => {
    const line = Quests.verdict(
      seen({
        held: true,
        boxes: ["t1-tests2", "t1-tests10", "t1-build11", "t1-tests", "t1-testsx3", "t12-tests99", "t1-tests9"],
        record: record({
          steps: [closed("build", "t1-build11"), opened("tests", -MIN)],
          beat: beat("agent", -MIN, 0, 0),
        }),
      }),
      at(0),
    );

    expect(line.box).toBe("t1-tests10");
  });
});

describe("Quests.lastOutcome", () => {
  // Plant: read only the file's last line, or take a step's own `outcome` words for the quest's.
  it("format: the last line that is a quest's end wins, among any other lines", () => {
    const line = fc.constantFrom(
      "gc: removed 0 boxes and 0 worktrees, 0 MB; kept 217",
      "chain.ts: backstop 8 steps, $20.00",
      "",
      "{not json",
      '{"outcome":"send:tests:step_said","reason":"a step, not a quest"}',
      '{"reason":"no outcome"}',
      "42",
    );

    fc.assert(
      fc.property(
        fc.array(line),
        fc.constantFrom("done" as const, "ask" as const, "stuck" as const),
        fc.string(),
        fc.array(line),
        (before, outcome, reason, after) => {
          const older = JSON.stringify({ outcome: "ask", quest: "t1", reason: "older", exit: 20 });
          const ended = JSON.stringify({ outcome, quest: "t1", rounds: 3, reason, exit: 0 });
          expect(Quests.lastOutcome([older, ...before, ended, ...after].join("\n"))).toEqual({ outcome, reason });
          expect(Quests.lastOutcome([...before, ...after].join("\n"))).toBeNull();
        },
      ),
      options,
    );
  });

  it("scenario: an end line with no reason reads with an empty one", () => {
    expect(Quests.lastOutcome('{"outcome":"stuck","exit":30}\n')).toEqual({ outcome: "stuck", reason: "" });
  });
});

// ---------------------------------------------------------------- the reads

type Files = Readonly<Record<string, string>>;

/** A made-up BOXES folder in a temp folder, given back when the law ends. */
const boxesWith = (files: Files) =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;

    const dir = yield* Effect.acquireRelease(fs.makeTempDirectory({ prefix: "quests-" }), (made) =>
      fs.remove(made, { recursive: true, force: true }).pipe(Effect.ignore),
    );

    yield* fs.makeDirectory(path.join(dir, "state"), { recursive: true });
    yield* Effect.forEach(Object.entries(files), ([name, text]) => fs.writeFileString(path.join(dir, name), text), {
      concurrency: 1,
    });

    return dir;
  });

/** The lines for a made-up BOXES folder, with Effect's clock set to T0. */
const linesAt = (
  files: Files,
  ask: {
    readonly named?: ReadonlyArray<string>;
    readonly all?: boolean;
    readonly outAt?: Readonly<Record<string, number>>;
  } = {},
) =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;
    const boxes = yield* boxesWith(files);
    yield* Effect.forEach(
      Object.entries(ask.outAt ?? {}),
      ([name, offset]) => fs.utimes(path.join(boxes, name), at(offset), at(offset)),
      { concurrency: 1 },
    );
    yield* TestClock.setTime(T0);

    return yield* Quests.read(boxes, { named: ask.named ?? [], all: ask.all ?? false });
  });

const ran = <A, E>(law: Effect.Effect<A, E, NodeServices.NodeServices | Scope.Scope>) =>
  // oxlint-disable-next-line fabrika/no-effect-run-outside-edge -- edge: Vitest awaits the Promise a test hands back
  Effect.runPromise(law.pipe(Effect.scoped, Effect.provide(Layer.mergeAll(NodeServices.layer, TestClock.layer()))));

const chain = (r: Quests.Record) => JSON.stringify({ quest: "made-up", pr: null, ...r }, null, "\t");

const ended = (outcome: string, reason: string) => `${JSON.stringify({ outcome, reason, exit: 20 })}\n`;

describe("Quests.read", () => {
  it("scenario: with no state folder, or no chain record in it, nothing is printed", () =>
    ran(
      Effect.gen(function* () {
        const boxes = yield* boxesWith({ "state/t1.json": "{}", "state/t1.md": "- a note\n" });
        expect(yield* Quests.read(boxes, { named: [], all: true })).toEqual([]);
        expect(yield* Quests.read(`${boxes}/gone`, { named: [], all: true })).toEqual([]);
      }),
    ));

  it("scenario: a quest named with no state file is unknown, with no chain record", () =>
    ran(
      Effect.gen(function* () {
        const lines = yield* linesAt({}, { named: ["ghost"] });
        expect(lines).toEqual([
          {
            quest: "ghost",
            state: "unknown",
            step: null,
            box: null,
            phase: null,
            quietSeconds: null,
            since: null,
            text: "no chain record",
          },
        ]);
      }),
    ));

  it("scenario: two quests print in name order, one running on a fresh beat, one stuck on an old one", () =>
    ran(
      Effect.gen(function* () {
        const quiet = beat("agent", -20 * MIN, -15 * MIN, -15 * MIN);
        const fresh = beat("agent", -2 * MIN, -10_000, -4_000);

        const lines = yield* linesAt({
          "state/t2-chain.json": chain(record({ steps: [opened("build", -30 * MIN)], beat: quiet })),
          "state/t2.lock": "4242\n",
          "state/t2-build3.box": "quest: t2\n",
          "state/t1-chain.json": chain(record({ steps: [opened("tests", -3 * MIN)], beat: fresh })),
          "state/t1.lock": "4141\n",
          "state/t1-tests1.box": "quest: t1\n",
        });

        expect(lines).toEqual([
          {
            quest: "t1",
            state: "running",
            step: "tests",
            box: "t1-tests1",
            phase: "agent",
            quietSeconds: 10,
            since: iso(-2 * MIN),
            text: "agent for 2m, last agent output 4s ago",
          },
          {
            quest: "t2",
            state: "stuck",
            step: "build",
            box: "t2-build3",
            phase: "agent",
            quietSeconds: 900,
            since: iso(-20 * MIN),
            text: "agent for 20m, no beat for 15m: stuck",
          },
        ]);
      }),
    ));

  it("scenario: a half-written record reads as unknown, and the quest beside it still prints", () =>
    ran(
      Effect.gen(function* () {
        const whole = chain(record({ steps: [opened("tests", -MIN)], beat: beat("box", -MIN, -1000) }));

        const lines = yield* linesAt({
          "state/half-chain.json": whole.slice(0, whole.length / 2),
          "state/other-chain.json": '{"quest":"other","steps":"not a list"}',
          "state/t1-chain.json": whole,
          "state/t1.lock": "1\n",
        });

        expect(lines.map((l) => [l.quest, l.state, l.text])).toEqual([
          ["half", "unknown", "the chain record does not read"],
          ["other", "unknown", "the chain record does not read"],
          ["t1", "running", "box for 1m, no agent output yet"],
        ]);
      }),
    ));

  it("scenario: a quest that ended ask waits on the lead since its out file was last written, never stuck", () =>
    ran(
      Effect.gen(function* () {
        // The chain died after its last line: an open step and an old beat stay in the record.
        const left = record({ steps: [opened("review", -300 * MIN)], beat: beat("judge", -290 * MIN, -280 * MIN) });

        const lines = yield* linesAt(
          {
            "state/t1-chain.json": chain(left),
            "t1-chain.out": `chain.ts: backstop 8 steps\n${ended("ask", "the plan needs ticket 695 first")}`,
          },
          { outAt: { "t1-chain.out": -45 * MIN } },
        );

        expect(lines).toEqual([
          {
            quest: "t1",
            state: "waits",
            step: "review",
            box: null,
            phase: null,
            quietSeconds: null,
            since: iso(-45 * MIN),
            text: "ask: the plan needs ticket 695 first",
          },
        ]);
      }),
    ));

  it("scenario: a quest started again after an ask is held, so its fresh beat decides, not the old line", () =>
    ran(
      Effect.gen(function* () {
        const again = record({
          steps: [closed("tests", "t1-tests1"), opened("build", -MIN)],
          beat: beat("wait", -MIN, -2000),
        });

        const lines = yield* linesAt({
          "state/t1-chain.json": chain(again),
          "state/t1.lock": "77\n",
          "t1-chain.out": ended("ask", "answered since"),
        });

        expect(lines.map((l) => [l.state, l.step, l.phase, l.quietSeconds])).toEqual([["running", "build", "wait", 2]]);
      }),
    ));

  it("scenario: a record with no beat, from before the heartbeat, goes by its outcome line or its open step", () =>
    ran(
      Effect.gen(function* () {
        const lines = yield* linesAt(
          {
            "state/a-chain.json": chain(record({ steps: [closed("mutation", "a-mutation2")] })),
            "a-chain.out": ended("stuck", "3 stucks in a row"),
            "state/b-chain.json": chain(record({ steps: [opened("build", -110 * MIN)] })),
            "state/c-chain.json": chain(record({ steps: [opened("build", -4 * MIN)] })),
          },
          { outAt: { "a-chain.out": -MIN } },
        );

        expect(lines.map((l) => [l.quest, l.state, l.box, l.text])).toEqual([
          ["a", "waits", "a-mutation2", "stuck: 3 stucks in a row"],
          ["b", "stuck", null, "build open for 1h50m, no beat in the record: stuck"],
          ["c", "running", null, "build open for 4m, no beat in the record"],
        ]);
      }),
    ));

  it("scenario: a landed quest is left out, and printed when named or with all", () =>
    ran(
      Effect.gen(function* () {
        const files = {
          "state/t1-chain.json": chain(record({ landed: iso(-MIN), steps: [closed("review", "t1-review1")] })),
          "t1-chain.out": ended("done", "PR 9 landed"),
          "state/t2-chain.json": chain(record({ steps: [closed("review", "t2-review1")] })),
          "t2-chain.out": ended("done", "PR 10 landed"),
        };

        const states = (lines: ReadonlyArray<Quests.Line>) => lines.map((l) => [l.quest, l.state]);
        expect(states(yield* linesAt(files))).toEqual([]);
        expect(states(yield* linesAt(files, { all: true }))).toEqual([
          ["t1", "landed"],
          ["t2", "landed"],
        ]);
        expect(states(yield* linesAt(files, { named: ["t2"] }))).toEqual([["t2", "landed"]]);

        const queued = {
          "state/t3-chain.json": chain(record({ queued: iso(-MIN) })),
          "t3-chain.out": ended("done", "PR 11 queued"),
        };

        expect(states(yield* linesAt(queued))).toEqual([]);
        expect(states(yield* linesAt(queued, { all: true }))).toEqual([["t3", "queued"]]);
      }),
    ));
});
