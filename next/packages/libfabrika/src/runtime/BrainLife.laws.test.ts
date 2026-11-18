// P12, next/. Lifecycle events use tea's type; persisted state uses Effect Schema's _tag.
import { applyCell } from "@demlik/tea";
import { propertyInvariant } from "@demlik/tea/pbt";
import { syncTest } from "@kampus/libfabrika/testing";
import { Effect, Schema } from "effect";
import * as fc from "fast-check";
import { describe, expect, it } from "vitest";
import { fcProcessIds, processId } from "../Id.test-support.ts";
import { BrainState, brainLife } from "./BrainLife.ts";

/** The key of each Msg, Cmd and answer these laws write or expect, made by a schema (0569, 0562).
 *  A law hands over only the fields it reads, so a case holds the key alone. */
const Tag = Schema.TaggedUnion({
  braked: {},
  started: {},
  stop: {},
  stopped: {},
  waiting: {},
});

const SEED = 119120;

const start = Effect.runSync(processId);

const after = Effect.runSync(processId);

const events = [
  { ...Tag.cases.started.make({}), start, after: null, build: "build-a", reason: "open" },
  { ...Tag.cases.waiting.make({}), after: start, until: 250, reason: "crash" },
  { ...Tag.cases.started.make({}), start: after, after: start, build: "build-a", reason: "crash" },
  { ...Tag.cases.braked.make({}), after, reason: "intensity" },
  Tag.cases.stop.make({}),
  Tag.cases.stopped.make({}),
] as const;

const lifecycle = fc.record({
  start: fcProcessIds,
  after: fcProcessIds,
  build: fc.string(),
  until: fc.nat(),
  reason: fc.string(),
});

const normalLife = { start, after, build: "build-a", until: 250, reason: "crash" };

const stopInFlight = [events[0], Tag.cases.stop.make({}), events[1], events[2], Tag.cases.stopped.make({})] as const;

const messages = lifecycle.map(
  ({ start, after, build, until, reason }) =>
    [
      { ...Tag.cases.started.make({}), start, after: null, build, reason: "open" },
      { ...Tag.cases.waiting.make({}), after: start, until, reason },
      { ...Tag.cases.started.make({}), start: after, after: start, build, reason },
      { ...Tag.cases.braked.make({}), after, reason },
      Tag.cases.stop.make({}),
      Tag.cases.stopped.make({}),
    ] as const,
);

const message = messages.chain((msgs) => fc.constantFrom(...msgs));

describe("P12 instance machine laws", () => {
  it("p88 plant: missing start or stop transition cannot finish a normal life", () => {
    fc.assert(
      fc.property(lifecycle, ({ start, after, build, until, reason }) => {
        const msgs = [
          { ...Tag.cases.started.make({}), start, after: null, build, reason: "open" },
          { ...Tag.cases.waiting.make({}), after: start, until, reason },
          { ...Tag.cases.started.make({}), start: after, after: start, build, reason },
          { ...Tag.cases.braked.make({}), after, reason },
        ] as const;

        const [initial] = brainLife.init(null, {});
        expect(initial).toMatchObject({ _tag: "starting" });
        const [online] = applyCell(brainLife, initial, msgs[0]);
        expect(online).toMatchObject({ _tag: "online", start, build });
        const [stopping] = applyCell(brainLife, online, Tag.cases.stop.make({}));

        for (const msg of msgs) {
          expect(applyCell(brainLife, stopping, msg)[0]).toEqual(stopping);
        }

        const [stopped] = applyCell(brainLife, stopping, Tag.cases.stopped.make({}));
        expect(stopped).toMatchObject({ _tag: "stopped" });
      }),
      { seed: SEED, examples: [[normalLife]] },
    );
  });
  it("p88 plant: saved pending stop is lost; every generated JSON cut must resume unchanged", () => {
    fc.assert(
      fc.property(fc.array(message, { maxLength: 30 }), (msgs) => {
        syncTest(
          brainLife,
          {},
          {
            msgs,
            encode: Schema.encodeSync(BrainState),
            decode: Schema.decodeUnknownSync(BrainState),
            equals: (a, b) => JSON.stringify(a) === JSON.stringify(b),
            seed: SEED,
          },
        );
      }),
      { seed: SEED, numRuns: 100, examples: [[[...stopInFlight]]] },
    );
  });
  // Pin p81's replacement-after-stop plant; generated events also cover the restart brake.
  it("pinned: p81 replacement-after-stop, a braked or cleanly stopped instance must never launch a replacement", () => {
    propertyInvariant(
      brainLife,
      {},
      fc.array(message, { maxLength: 40 }),
      ({ prev, next, cmds }: { prev: { _tag: string }; next: { _tag: string }; cmds: ReadonlyArray<unknown> }) =>
        !["braked", "stopped"].includes(prev._tag) || (next._tag === prev._tag && cmds.length === 0),
      { seed: SEED, numRuns: 100 },
    );
  });
});
