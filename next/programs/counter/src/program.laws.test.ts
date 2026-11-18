// P11 real counter, next/. The pure contract uses inc/dec/reset and view {count}.
// No window export exists until P14. No copied counter implementation lives in the library.
// K9 (ticket 1061, slice 2): these laws draw `_tag` Msgs through tea's own pbt. Plant: tea's lookup
// left on `msg.type` (`chunk-SKI5V64W.js`), and every law here goes red.
import { arbConstantMsg, arbMsg, arbMsgSequence, propertyInvariant } from "@demlik/tea/pbt";
import { describe, expect, it } from "@effect/vitest";
import { Effect, Schema, String as Str } from "effect";
import * as fc from "fast-check";
import { expectTypeOf } from "vitest";

const SEED = 119120;

// Defer export lookup so the red base's missing exports do not prevent law collection.
const LIBRARY = "@kampus/libfabrika";

const TESTING = "@kampus/libfabrika/testing";

/** The counter's Msg, restated by the exam and pinned to the machine's own below (0135). */
const Msg = Schema.TaggedUnion({ inc: {}, dec: {}, reset: {} });

type Msg = typeof Msg.Type;

const msgs = arbMsgSequence(
  arbMsg<Msg>({ inc: arbConstantMsg("inc"), dec: arbConstantMsg("dec"), reset: arbConstantMsg("reset") }),
  { maxLength: 30 },
);

describe("P11 real counter laws", () => {
  it.live("Program.make keeps the exported machine and uses its own schemas", () =>
    Effect.gen(function* () {
      const { counter, counterMachine } = yield* Effect.promise(() => import("./program.ts"));
      fc.assert(
        fc.property(fc.integer(), fc.constantFrom("inc", "dec", "reset"), (count, type) => {
          expectTypeOf<Msg>().toEqualTypeOf<typeof counterMachine.msg.Type>();
          expect(counter.machine).toBe(counterMachine);
          expect(counter.state.schema).toBe(counterMachine.model);
          expect(counter.msg).toBe(counterMachine.msg);
          expect(counter.view.data).toBe(Schema.Json);
          expectTypeOf(counter.view.select({ count }).count).toEqualTypeOf<number>();
          expect(counter.view.select({ count })).toEqual({ count });
          expect(counter.wake({ count })).toBeNull();
          const port = counter.inputs[type];
          expect(port.personOnly).toBe(false);
          expect(Str.trim(port.description).length).toBeGreaterThan(0);
          const made = Msg.cases[type].make({});
          expect(Schema.decodeSync(port.schema)(made)).toEqual(made);
        }),
        { seed: SEED, numRuns: 100 },
      );
    }),
  );
  it.live("S2 plant, lose saved count: every JSON cut preserves every later model and Cmd", () =>
    Effect.gen(function* () {
      const { counter } = yield* Effect.promise(() => import("./program.ts"));
      const { syncTest }: typeof import("@kampus/libfabrika/testing") = yield* Effect.promise(() => import(TESTING));
      fc.assert(
        fc.property(msgs, (list) => {
          syncTest(
            counter.machine,
            {},
            {
              msgs: list,
              encode: Schema.encodeSync(counter.state.schema),
              decode: Schema.decodeUnknownSync(counter.state.schema),
              equals: (a, b) => JSON.stringify(a) === JSON.stringify(b),
              seed: SEED,
            },
          );
        }),
        { seed: SEED, numRuns: 100 },
      );
    }),
  );
  it.live("plant, break an update: inc, dec and reset obey arithmetic at every tea step", () =>
    Effect.gen(function* () {
      const { counter } = yield* Effect.promise(() => import("./program.ts"));
      propertyInvariant(
        counter.machine,
        {},
        msgs,
        ({
          prev,
          msg,
          next,
          cmds,
        }: {
          prev: { count: number };
          msg: Msg;
          next: { count: number };
          cmds: ReadonlyArray<unknown>;
        }) => {
          const expected = Msg.match(msg, { inc: () => prev.count + 1, dec: () => prev.count - 1, reset: () => 0 });

          return next.count === expected && cmds.length === 0;
        },
        { seed: SEED, numRuns: 100 },
      );
    }),
  );
  it.effect.prop(
    "plant, leave a declaration out: real program declares saved state, ports, view and event policy",
    { generated: Schema.Int },
    ({ generated }) =>
      Effect.forEach(
        [0, generated],
        (value) =>
          Effect.gen(function* () {
            const { counter } = yield* Effect.promise(() => import("./program.ts"));

            const { Program, ProgramLoader }: typeof import("@kampus/libfabrika") = yield* Effect.promise(
              () => import(LIBRARY),
            );

            // P40: the core pack is `fabrika`, so the counter's identity is `fabrika/counter` (0083).
            expect(Schema.decodeSync(Program.schema)(counter)).toMatchObject({
              name: "fabrika/counter",
              state: { v: 1 },
              writes: {},
            });

            const p = yield* Effect.gen(function* () {
              return (yield* (yield* ProgramLoader).load("fabrika/counter")).stepper;
            }).pipe(Effect.provide(ProgramLoader.layer({ "fabrika/counter": counter }, {})));

            const boot = p.init(null);
            expect(boot).toMatchObject({ _tag: "stepped", view: { count: 0 }, cmds: [] });

            for (const type of ["inc", "dec", "reset"] as const) {
              expect(counter.refuse({ count: value }, Msg.cases[type].make({}))).toBeNull();
            }

            expect(p.step({ count: value }, { ...Msg.cases.inc.make({}), value: "wrong" })).toMatchObject({
              _tag: "stepped",
              view: { count: value + 1 },
            });
            expect(p.step({ count: value }, Schema.TaggedStruct("unknown", {}).make({}))).toMatchObject({
              _tag: "refused",
              reason: "bad_msg",
            });
          }),
        { concurrency: 1, discard: true },
      ),
    { arbitrary: { seed: 119120, runs: 12 } },
  );
});
