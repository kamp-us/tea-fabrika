// Ticket 1061, slice 2, next/. Laws K2, K2b and K2c: the patched tea (demlik 949, decision 0569) routes
// a Msg to its cell, a Cmd to its interpreter, a Sub to its runner and a state to its table row by
// `_tag`, and tea's own pbt draws carry `_tag`. K2c's plants are written above it.
// K2 plants, one at a time in the installed tea: (a) `chunk-SKI5V64W.js` `record[msg._tag]` back to
// `msg.type`; (b) `chunk-BXLD374W.js` `callHandler`'s `cmd._tag` back to `type`; (c) `chunk-BXLD374W.js`
// `runnerFor(sub._tag)` back to `sub.type`; (d) `pbt/index.js` `arbConstantMsg` and `arbRecordMsg`
// writing `type`. K2b plant: `chunk-SKI5V64W.js` `lookupCell`'s `state._tag` back to `state.type`.
import { applyCell, foldMsgs, NoCellError, acceptsOf, type Settled, type Store } from "@demlik/tea";
import { Cmd, Machine, run } from "@demlik/tea/effect";
import { memoryStore } from "@demlik/tea/mem";
import { arbConstantMsg, arbMsg, arbMsgSequence, arbRecordMsg } from "@demlik/tea/pbt";
import { run as runPromise } from "@demlik/tea/promise";
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

// K2c, after demlik 966's `packages/tea/src/effect/tagged-union-machine.test.ts`: a door whose
// State and Msgs are both `Schema.TaggedUnion`s, written as a state table with two Cmds that each
// answer ok or err, runs the same on tea's Promise engine and its Effect engine, stopped and booted
// again from its saved State at a generated point. Both engines are held to a plain reduce written
// here with no tea in it, and each Msg they fold, fresh or an answer, is keyed `_tag` and has no
// `type`. 966's other half, the event-sourced store's default parser dropping a row keyed `type`,
// is not here: no code of ours uses `@demlik/tea/do`, and its store takes Cloudflare's whole
// `DurableObjectStorage`, which a test cannot stand in for without a cast. Our own old row, a saved
// answer keyed `type`, is K3's, in Program.test.ts.
// K2c plants, one at a time in the installed tea: (a) `chunk-5HWE6CAZ.js` `settle`'s `cmd._tag` back
// to `cmd.type`, so the Effect engine takes a declared error for an undeclared one and the engines
// part; (b) K2b's plant, `chunk-SKI5V64W.js` `lookupCell`'s `state._tag` back to `state.type`, so a
// running state table finds no row.
const totals = {
  rings: Schema.Int,
  missed: Schema.Int,
  entries: Schema.Int,
  denied: Schema.Int,
  lastTicket: Schema.Int,
};

const Door = Schema.TaggedUnion({ closed: totals, open: totals, locked: totals });

type Door = typeof Door.Type;

const DoorMsg = Schema.TaggedUnion({
  knock: { attempt: Schema.Int },
  open: {},
  enter: { ticket: Schema.Int },
  close: {},
  lock: {},
});

type DoorMsg = typeof DoorMsg.Type;

/** The errors the two Cmds declare, made by their schemas (0562). */
const Offline = Schema.TaggedStruct("offline", {});

const Invalid = Schema.TaggedStruct("invalid_ticket", {});

const ring = Cmd.make("ring", {
  input: Schema.Struct({ attempt: Schema.Int }),
  ok: Schema.Int,
  err: ["offline"],
});

const admit = Cmd.make("admit", {
  input: Schema.Struct({ ticket: Schema.Int }),
  ok: Schema.Int,
  err: ["invalid_ticket"],
});

/** The answer each Cmd gets: an even number is let in, an odd one is refused. */
const even = (n: number) => n % 2 === 0;

const doorClock = () => 0;

/** A door's counts without its key, so a move to another State is made by that State's maker. */
const counts = (d: Door) => ({
  rings: d.rings,
  missed: d.missed,
  entries: d.entries,
  denied: d.denied,
  lastTicket: d.lastTicket,
});

const shut = Door.cases.closed.make({ rings: 0, missed: 0, entries: 0, denied: 0, lastTicket: -1 });

const door = Machine.make({
  model: Door,
  msg: DoorMsg,
  cmds: [ring, admit],
  init: (loaded) => [loaded ?? shut, []],
  update: {
    closed: {
      knock: (s, m) => [s, [ring({ attempt: m.attempt })]],
      open: (s) => [Door.cases.open.make(counts(s)), []],
      lock: (s) => [Door.cases.locked.make(counts(s)), []],
      ring_ok: (s, m) => [Door.cases.closed.make({ ...counts(s), rings: s.rings + m.value }), []],
      ring_err: (s) => [Door.cases.closed.make({ ...counts(s), missed: s.missed + 1 }), []],
    },
    open: {
      enter: (s, m) => [s, [admit({ ticket: m.ticket })]],
      close: (s) => [Door.cases.closed.make(counts(s)), []],
      admit_ok: (s, m) => [Door.cases.open.make({ ...counts(s), entries: s.entries + 1, lastTicket: m.value }), []],
      admit_err: (s) => [Door.cases.open.make({ ...counts(s), denied: s.denied + 1 }), []],
    },
    locked: {
      open: (s) => [Door.cases.open.make(counts(s)), []],
    },
  },
});

/** One fold of the door with no tea in it: the next State and the keys of the Msgs tea folds. */
const doorStep = (s: Door, m: DoorMsg): readonly [Door, ReadonlyArray<string>] =>
  DoorMsg.match(m, {
    knock: (k): readonly [Door, ReadonlyArray<string>] =>
      even(k.attempt)
        ? [Door.cases.closed.make({ ...counts(s), rings: s.rings + 1 }), ["knock", "ring_ok"]]
        : [Door.cases.closed.make({ ...counts(s), missed: s.missed + 1 }), ["knock", "ring_err"]],
    open: (): readonly [Door, ReadonlyArray<string>] => [Door.cases.open.make(counts(s)), ["open"]],
    enter: (e): readonly [Door, ReadonlyArray<string>] =>
      even(e.ticket)
        ? [Door.cases.open.make({ ...counts(s), entries: s.entries + 1, lastTicket: e.ticket }), ["enter", "admit_ok"]]
        : [Door.cases.open.make({ ...counts(s), denied: s.denied + 1 }), ["enter", "admit_err"]],
    close: (): readonly [Door, ReadonlyArray<string>] => [Door.cases.closed.make(counts(s)), ["close"]],
    lock: (): readonly [Door, ReadonlyArray<string>] => [Door.cases.locked.make(counts(s)), ["lock"]],
  });

/** The fresh Msgs each State takes, read from the plain reduce's own rules, not from tea. */
const takes = (s: Door, n: number): ReadonlyArray<DoorMsg> =>
  Door.match(s, {
    closed: () => [DoorMsg.cases.knock.make({ attempt: n }), DoorMsg.cases.open.make({}), DoorMsg.cases.lock.make({})],
    open: () => [DoorMsg.cases.enter.make({ ticket: n }), DoorMsg.cases.close.make({})],
    locked: () => [DoorMsg.cases.open.make({})],
  });

interface Walked {
  readonly inputs: ReadonlyArray<DoorMsg>;
  /** The State after each prefix of `inputs`: `states[i]` is the State after `i` inputs. */
  readonly states: ReadonlyArray<Door>;
  readonly keys: ReadonlyArray<string>;
}

/** Walks the door: each pick chooses among the Msgs the State it reached takes. */
const walkDoor = (picks: ReadonlyArray<{ readonly pick: number; readonly n: number }>): Walked => {
  const inputs: Array<DoorMsg> = [];
  const states: Array<Door> = [shut];
  const keys: Array<string> = [];
  let state: Door = shut;

  for (const { pick, n } of picks) {
    const open = takes(state, n);
    const m = open[pick % open.length];

    if (m === undefined) {
      break;
    }

    const [next, folded] = doorStep(state, m);
    inputs.push(m);
    keys.push(...folded);
    state = next;
    states.push(state);
  }

  return { inputs, states, keys };
};

/** A Msg the door folds: a fresh one, or the answer to one of its Cmds. */
type DoorFolded = DoorMsg | Settled<typeof ring | typeof admit>;

/** One boot of the door on an engine: it folds `inputs` from what `store` holds, then stops. */
type Drive = (
  store: Store<Door>,
  inputs: ReadonlyArray<DoorMsg>,
  observed: Array<DoorFolded>,
  loaded: Door,
) => Promise<Door>;

const engines: Record<"Promise" | "Effect", Drive> = {
  Promise: async (store, inputs, observed, loaded) => {
    const booting = runPromise(door, {
      store,
      clock: doorClock,
      interpret: {
        ring: async (cmd, { ok, err }) => (even(cmd.attempt) ? ok(1) : err(Offline.make({}))),
        admit: async (cmd, { ok, err }) => (even(cmd.ticket) ? ok(cmd.ticket) : err(Invalid.make({}))),
      },
    });

    const boots: Array<Door> = [];
    booting.onBoot((s) => {
      boots.push(s);
    });
    booting.observe((m) => {
      observed.push(m);
    });

    try {
      const live = await booting.ready;
      expect(boots).toEqual([loaded]);

      for (const m of inputs) {
        await live.dispatch(m);
        await live.idle();
      }

      return live.getState();
    } finally {
      await booting.stop();
    }
  },
  Effect: (store, inputs, observed, loaded) =>
    Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const booting = yield* run(door, {
            store,
            clock: doorClock,
            interpret: {
              ring: (cmd) => (even(cmd.attempt) ? Effect.succeed(1) : Effect.fail(Offline.make({}))),
              admit: (cmd) => (even(cmd.ticket) ? Effect.succeed(cmd.ticket) : Effect.fail(Invalid.make({}))),
            },
          });

          const boots: Array<Door> = [];
          booting.onBoot((s) => {
            boots.push(s);
          });
          booting.observe((m) => {
            observed.push(m);
          });

          const live = yield* booting.ready;
          expect(boots).toEqual([loaded]);

          for (const m of inputs) {
            yield* live.dispatch(m);
            yield* live.idle();
          }

          const reached = live.getState();
          yield* booting.stop();

          return reached;
        }),
      ),
    ),
};

describe("K2c a tagged-union machine runs the same on both engines", () => {
  it("K2c: a TaggedUnion door with a state table and two answered Cmds folds alike on the Promise and Effect engines, across a restart from its saved State", async () => {
    const reached = new Set<string>();
    const restartedIn = new Set<string>();

    await fc.assert(
      fc.asyncProperty(
        fc.array(fc.record({ pick: fc.nat(), n: fc.nat({ max: 1000 }) }), { minLength: 1, maxLength: 40 }),
        fc.nat(),
        async (picks, at) => {
          const walked = walkDoor(picks);
          const cut = at % (walked.inputs.length + 1);
          const checkpoint = walked.states[cut];
          const final = walked.states[walked.inputs.length];

          if (checkpoint === undefined || final === undefined) {
            throw new Error("the walk lost a State");
          }

          restartedIn.add(checkpoint._tag);
          const traces: Array<ReadonlyArray<DoorFolded>> = [];

          for (const drive of [engines.Promise, engines.Effect]) {
            const store = memoryStore<Door>();
            const observed: Array<DoorFolded> = [];

            const first = await drive(store, walked.inputs.slice(0, cut), observed, shut);
            const saved = Schema.decodeUnknownSync(Door)(await store.load());
            expect(saved).toEqual(first);
            expect(saved).toEqual(checkpoint);

            const last = await drive(store, walked.inputs.slice(cut), observed, saved);
            expect(last).toEqual(final);
            expect(await store.load()).toEqual(final);

            expect(observed.map((m) => m._tag)).toEqual(walked.keys);

            for (const m of observed) {
              expect(m).not.toHaveProperty("type");

              if ("cmd" in m) {
                expect(m.cmd).not.toHaveProperty("type");
                expect(m.cmd._tag).toBe(m._tag.startsWith("ring") ? "ring" : "admit");
              }
            }

            traces.push(observed);
          }

          expect(traces[0]).toEqual(traces[1]);

          for (const key of walked.keys) {
            reached.add(key);
          }
        },
      ),
      CHECK,
    );

    for (const key of ["knock", "open", "enter", "close", "lock", "ring_ok", "ring_err", "admit_ok", "admit_err"]) {
      expect(reached, `no walk reached ${key}`).toContain(key);
    }

    for (const state of ["closed", "open", "locked"]) {
      expect(restartedIn, `no run restarted in ${state}`).toContain(state);
    }
  });
});
