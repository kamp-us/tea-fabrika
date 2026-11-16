// Ticket 1061, slice 2, next/. Laws K2 and K2b: the patched tea (demlik 949, decision 0569) routes
// a Msg to its cell, a Cmd to its interpreter, a Sub to its runner and a state to its table row by
// `_tag`, and tea's own pbt draws carry `_tag`.
// K2 plants, one at a time in the installed tea: (a) `chunk-SKI5V64W.js` `record[msg._tag]` back to
// `msg.type`; (b) `chunk-BXLD374W.js` `callHandler`'s `cmd._tag` back to `type`; (c) `chunk-BXLD374W.js`
// `runnerFor(sub._tag)` back to `sub.type`; (d) `pbt/index.js` `arbConstantMsg` and `arbRecordMsg`
// writing `type`. K2b plant: `chunk-SKI5V64W.js` `lookupCell`'s `state._tag` back to `state.type`.
import { applyCell, foldMsgs, NoCellError, acceptsOf } from "@demlik/tea";
import { Cmd, Machine, run } from "@demlik/tea/effect";
import { arbConstantMsg, arbMsg, arbMsgSequence, arbRecordMsg } from "@demlik/tea/pbt";
import { describe, expect, it } from "@effect/vitest";
import { runsFor } from "@kampus/vitest";
import { Effect, Schema } from "effect";
import { TestClock } from "effect/testing";
import * as fc from "fast-check";

const CHECK = { seed: 119120, numRuns: runsFor({ fast: 20, full: 100 }) };
const TIMER_MS = 10;

const Model = Schema.Struct({
  count: Schema.Int,
  stored: Schema.Int,
  armed: Schema.Boolean,
  ticks: Schema.Int,
});
type Model = typeof Model.Type;

const Msg = Schema.TaggedUnion({
  inc: {},
  save: { n: Schema.Int },
  arm: {},
  tick: {},
});
type Msg = typeof Msg.Type;

const Tick = Msg.cases.tick.make({});

const store = Cmd.make("store", {
  input: Schema.Struct({ n: Schema.Int }),
  ok: Schema.Int,
  err: [],
});

const start: Model = { count: 0, stored: 0, armed: false, ticks: 0 };

const machine = Machine.make({
  model: Model,
  msg: Msg,
  cmds: [store],
  init: (loaded) => [loaded ?? start, []],
  update: {
    inc: (s) => [{ ...s, count: s.count + 1 }, []],
    save: (s, m) => [s, [store({ n: m.n })]],
    arm: (s) => [{ ...s, armed: true }, []],
    tick: (s) => [{ ...s, armed: false, ticks: s.ticks + 1 }, []],
    store_ok: (s, m) => [{ ...s, stored: s.stored + m.value }, []],
    store_err: (s) => [s, []],
  },
  // A Sub entry has no maker in tea, so its key is written here as tea reads it (plan, "Calls taken").
  subs: [{ _tag: "timer", deps: (s) => (s.armed ? { ms: TIMER_MS, msg: Tick } : null) }],
});

/** The model a plain reduce over the cells reaches when every Cmd is answered and every armed
 *  timer fires before the next Msg: the oracle both engines are held to. */
const expected = (msgs: ReadonlyArray<Msg>): Model =>
  msgs.reduce<Model>(
    (s, m) =>
      Msg.match(m, {
        inc: () => ({ ...s, count: s.count + 1 }),
        save: (saved) => ({ ...s, stored: s.stored + saved.n }),
        arm: () => ({ ...s, ticks: s.ticks + 1 }),
        tick: () => ({ ...s, armed: false, ticks: s.ticks + 1 }),
      }),
    start,
  );

/** The Msgs tea folds for a run: each fresh Msg, then the answer or the timer's Msg it causes. */
const withAnswers = (msgs: ReadonlyArray<Msg>) =>
  msgs.flatMap((m) =>
    Msg.match(m, {
      inc: () => [m],
      save: (saved) => [m, store.ok(store({ n: saved.n }), saved.n, 0)],
      arm: () => [m, Tick],
      tick: () => [m],
    }),
  );

// tea's own draws, so plant (d) is seen: a draw keyed `type` is no Msg of this schema.
const Fresh = arbMsg<Exclude<Msg, { readonly _tag: "tick" }>>({
  inc: arbConstantMsg("inc"),
  save: arbRecordMsg("save", { n: fc.integer({ min: -1000, max: 1000 }) }),
  arm: arbConstantMsg("arm"),
});

describe("K2 the patched engine routes by _tag", () => {
  it("K2: run and foldMsgs reach the plain reduce's model; Cmds, answers and the timer go by _tag", async () => {
    const reached = new Set<string>();
    await fc.assert(
      fc.asyncProperty(arbMsgSequence(Fresh, { minLength: 1, maxLength: 12 }), (msgs) =>
        Effect.runPromise(
          Effect.scoped(
            Effect.gen(function* () {
              for (const m of msgs) {
                expect(Schema.is(Msg)(m)).toBe(true);
              }

              const booted = yield* run(machine, {
                interpret: { store: (cmd) => Effect.succeed(cmd.n) },
              });
              const live = yield* booted.ready;
              const seen: Array<string> = [];
              live.observe((m) => {
                seen.push(m._tag);
              });

              for (const m of msgs) {
                yield* live.dispatch(m);
                yield* TestClock.adjust(TIMER_MS);
                yield* live.idle();
              }

              for (const tag of seen) {
                reached.add(tag);
              }

              const folded = foldMsgs(machine, start, withAnswers(msgs));
              const oracle = { ...expected(msgs), armed: false };
              expect(live.getState()).toEqual(oracle);
              expect(folded).toEqual(oracle);
              expect(seen).toEqual(withAnswers(msgs).map((m) => m._tag));
              // A Msg keyed `type` finds no cell: tea reads `_tag` only.
              // @ts-expect-error The old key on purpose: `{ type: "inc" }` is not a Msg of this machine.
              expect(() => applyCell(machine, folded, { type: "inc" })).toThrowError(NoCellError);
            }),
          ).pipe(Effect.provide(TestClock.layer())),
        ),
      ),
      CHECK,
    );

    for (const tag of ["inc", "save", "arm", "store_ok", "tick"]) {
      expect(reached, `no run reached ${tag}`).toContain(tag);
    }
  });
});

const Phase = Schema.TaggedUnion({
  idle: { runs: Schema.Int },
  running: { runs: Schema.Int, ticks: Schema.Int },
});
type Phase = typeof Phase.Type;

const PhaseMsg = Schema.TaggedUnion({ go: {}, tick: {}, halt: {} });
type PhaseMsg = typeof PhaseMsg.Type;

const go = PhaseMsg.cases.go.make({});
const tick = PhaseMsg.cases.tick.make({});
const halt = PhaseMsg.cases.halt.make({});
const first = Phase.cases.idle.make({ runs: 0 });

const table = Machine.make({
  model: Phase,
  msg: PhaseMsg,
  cmds: [],
  init: (loaded) => [loaded ?? first, []],
  update: {
    idle: { go: (s) => [Phase.cases.running.make({ runs: s.runs + 1, ticks: 0 }), []] },
    running: {
      tick: (s) => [Phase.cases.running.make({ runs: s.runs, ticks: s.ticks + 1 }), []],
      halt: (s) => [Phase.cases.idle.make({ runs: s.runs }), []],
    },
  },
});

/** One reducer answer: the next phase and no Cmd. */
type Stepped = readonly [Phase, ReadonlyArray<never>];

const reducer = Machine.make({
  model: Phase,
  msg: PhaseMsg,
  cmds: [],
  init: (loaded) => [loaded ?? first, []],
  update: {
    go: (s) =>
      Phase.match(s, {
        idle: (i): Stepped => [Phase.cases.running.make({ runs: i.runs + 1, ticks: 0 }), []],
        running: (r): Stepped => [r, []],
      }),
    tick: (s) =>
      Phase.match(s, {
        idle: (i): Stepped => [i, []],
        running: (r): Stepped => [Phase.cases.running.make({ runs: r.runs, ticks: r.ticks + 1 }), []],
      }),
    halt: (s) =>
      Phase.match(s, {
        idle: (i): Stepped => [i, []],
        running: (r): Stepped => [Phase.cases.idle.make({ runs: r.runs }), []],
      }),
  },
});

/** Walks the table: each pick chooses among the Msgs the state it reached accepts. */
const walk = (picks: ReadonlyArray<number>): ReadonlyArray<PhaseMsg> => {
  const msgs: Array<PhaseMsg> = [];
  let state: Phase = first;

  for (const pick of picks) {
    const accepted = acceptsOf(table, state._tag);
    const open = [go, tick, halt].filter((m) => accepted.includes(m._tag));
    const m = open[pick % open.length];

    if (m === undefined) {
      break;
    }

    msgs.push(m);
    state = foldMsgs(table, state, [m]);
  }

  return msgs;
};

describe("K2b the state table keys on _tag", () => {
  it("K2b: a Transitions machine over a TaggedUnion model folds like the same machine as a reducer", () => {
    const reached = new Set<string>();
    fc.assert(
      fc.property(fc.array(fc.nat(), { minLength: 1, maxLength: 40 }), (picks) => {
        const msgs = walk(picks);

        for (const m of msgs) {
          reached.add(m._tag);
        }

        expect(foldMsgs(table, first, msgs)).toEqual(foldMsgs(reducer, first, msgs));
      }),
      CHECK,
    );

    for (const tag of ["go", "tick", "halt"]) {
      expect(reached, `no walk reached ${tag}`).toContain(tag);
    }
  });
});
