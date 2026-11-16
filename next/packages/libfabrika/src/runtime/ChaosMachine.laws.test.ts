// next/: the chaos machine on its real `init` and reducer (0037, 0046), walked by tea's guided
// sequences (0093): each step is an outside start, timer or stop, or the answer to a Cmd that really
// waits. Two laws: a fault request is saved before it leaves, and its answer is kept once (the
// header's "saved requests precede outside work, and unanswered work stays unknown"); and the sync
// test (S2, docs/direction/saved-state.md) through `Model`, the complete saved control state. The
// chaos program's own laws (`next/programs/chaos/src/program.laws.test.ts`) hold the rest.
import { applyCell } from "@demlik/tea";
import { arbGuidedSequence } from "@demlik/tea/pbt";
import { describe, expect, it } from "@effect/vitest";
import { Schema } from "effect";
import * as fc from "fast-check";
import * as Id from "../Id.ts";
import { syncTest } from "../Testing.ts";
import * as Chaos from "./Chaos.ts";
import { chaosMachine, fire, inspect, Model, now } from "./ChaosMachine.ts";

const SEED = 119120;
const options = { seed: SEED, numRuns: 100 };

const isFire = Schema.is(Chaos.Fire);
type Phase = (typeof Model.Type)["phase"];

const id = (n: number) =>
  Schema.decodeUnknownSync(Chaos.ExperimentId)(`chaos_0000000000e008${n.toString(16).padStart(12, "0")}`);

const process = (n: number) =>
  Schema.decodeUnknownSync(Id.Process)(`process_0000000000e008${n.toString(16).padStart(12, "0")}`);

const starts = fc.record({
  id: fc.nat({ max: 3 }).map(id),
  seed: fc.integer({ min: 1, max: 0xffffffff }),
  target: fc.nat({ max: 3 }).map((n) =>
    Chaos.Target.make({
      program: "fabrika/checklist",
      name: `checklist:${n}`,
      process: process(n),
      client: `client:${n}`,
      key: `public:${n}`,
    }),
  ),
  most: fc.integer({ min: 1, max: 4 }),
  gap: fc.integer({ min: 1, max: 50 }),
});

const fired = fc.constantFrom(
  Chaos.Fired.cases.fired.make({ hit: null }),
  Chaos.Fired.cases.refused.make({ reason: "stale" }),
);

const report = Chaos.Report.make({
  letters: 0,
  doubled: 0,
  gaps: 0,
  stream: "inbox/checklist:1",
  boundary: 0,
  processStream: "processes/checklist:1",
  processBoundary: 0,
  restarts: [],
});

const walks = arbGuidedSequence(
  chaosMachine,
  {},
  {
    outside: {
      start: starts.map((start) => ({ type: "start" as const, ...start })),
      timer: fc.integer({ min: 0, max: 400 }).map((at) => ({ type: "timer" as const, at })),
      stop: fc.constant({ type: "stop" as const }),
    },
    answers: {
      now: { draw: fc.integer({ min: 0, max: 200 }), make: (cmd, at) => now.ok(cmd, at, at) },
      fire: {
        draw: fc.record({ ok: fc.boolean(), value: fired, at: fc.nat({ max: 400 }) }),
        make: (cmd, { ok, value, at }) =>
          ok ? fire.ok(cmd, value, at) : fire.err(cmd, { _tag: "handler_failed" }, at),
      },
      inspect: { draw: fc.nat({ max: 400 }), make: (cmd, at) => inspect.ok(cmd, report, at) },
    },
  },
  { maxLength: 80, size: "max" },
);

/** The asked and answered history a phase keeps, or none before the experiment has its clock. */
const history = (phase: Phase) =>
  phase._tag === "idle" || phase._tag === "starting" ? null : phase._tag === "stopped" ? phase : phase.experiment;

/** JSON text with sorted keys: a decoded copy may order its fields differently. */
const canon = (value: unknown): string =>
  JSON.stringify(value, (_key, v: unknown) =>
    v !== null && typeof v === "object" && !Array.isArray(v)
      ? Object.fromEntries(Object.entries(v).toSorted(([a], [b]) => a.localeCompare(b)))
      : v,
  );

describe("the chaos machine", () => {
  // Plant, run once (0093): the timer sends its fault request without saving it in `asked`: red,
  // "a fault request leaves only once it is saved".
  it("a fault request leaves only once it is saved, and each answer is kept once, for a request that was asked", () => {
    const reached = new Set<string>();
    fc.assert(
      fc.property(walks, (msgs) => {
        let [model] = chaosMachine.init(null, {});

        for (const msg of msgs) {
          const [next, cmds] = applyCell(chaosMachine, model, msg);
          reached.add(`${msg.type}:${next.phase._tag}`);
          const kept = history(next.phase);

          for (const cmd of cmds.filter((c) => c.type === "fire")) {
            expect(
              isFire(cmd) && kept?.asked.some((a) => a.ordinal === cmd.ordinal && canon(a.fault) === canon(cmd.fault)),
              "a fault request leaves only once it is saved",
            ).toBe(true);
          }

          const answered = kept?.answers.map((a) => a.ordinal) ?? [];
          expect(new Set(answered).size, "each answer is kept once").toBe(answered.length);
          expect(
            answered.every((o) => kept?.asked.some((a) => a.ordinal === o)),
            "an answer is kept only for a request that was asked",
          ).toBe(true);
          model = next;
        }
      }),
      options,
    );
    expect([...reached], "the walks fire faults, check and stop").toEqual(
      expect.arrayContaining(["timer:active", "timer:checking", "fire_ok:checking", "stop:stopped"]),
    );
  });

  // Plant, run once (0093): `init` ignores the saved model and starts idle at number 0: red.
  it("S2: every save and load of a walk, through the saved Model, resumes to the same models and Cmds", () => {
    const Saved = Schema.fromJsonString(Model);
    fc.assert(
      fc.property(walks, (msgs) => {
        syncTest(
          chaosMachine,
          {},
          {
            msgs,
            encode: Schema.encodeSync(Saved),
            decode: Schema.decodeUnknownSync(Saved),
            equals: (a, b) => canon(a) === canon(b),
            seed: SEED,
          },
        );
      }),
      options,
    );
  });
});
