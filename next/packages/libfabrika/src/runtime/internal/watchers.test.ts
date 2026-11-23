// next/, W1 and W3: membership is control state, including at every saved cut.
import { applyCell } from "@demlik/tea";
import { foldEvents } from "@demlik/tea/pbt";
import { describe, expect, it } from "@effect/vitest";
import { Arbitrary, Schema } from "effect";
import * as Arr from "effect/Array";
import { syncTest } from "../../Testing.ts";
import { nth } from "../RepliesTest.ts";
import { Model, watchers } from "./watchers.ts";

/** The key of each Msg, Cmd and answer these laws write or expect, made by a schema (0569, 0562).
 *  A law hands over only the fields it reads, so a case holds the key alone. */
const Tag = Schema.TaggedUnion({
  end: {},
  open: {},
});

const Client = Schema.Struct({
  client: Schema.NonEmptyString.check(Schema.isMaxLength(256)),
  at: Schema.Number,
  position: Schema.Int.check(Schema.isGreaterThanOrEqualTo(0)),
});

const entropy = Arbitrary.schema(Client);

const Walk = Arbitrary.array(
  Arbitrary.all([Arbitrary.schema(Schema.Int.check(Schema.isGreaterThanOrEqualTo(0))), entropy]),
  { minLength: 4, maxLength: 40 },
);

const clients = (model: typeof Model.Type) => (model._tag === "empty" ? [] : model.clients);

describe("saved view membership, next/", () => {
  it.prop(
    "W1: every saved cut keeps membership and order; end is idempotent",
    [Walk],
    ([walk]) => {
      let [state] = watchers.init(null, {});
      const msgs: Array<{ _tag: "open"; watch: typeof Client.Type } | { _tag: "end"; client: string }> = [];
      let expected: Array<typeof Client.Type> = [];

      for (const [pick, fresh] of walk) {
        const held = clients(state);
        const client = held.length > 0 && pick % 3 !== 0 ? nth(held, pick).client : fresh.client;

        if (pick % 3 === 2) {
          const msg = { ...Tag.cases.end.make({}), client };
          msgs.push(msg, msg);
          [state] = applyCell(watchers, state, msg);
          const [again, cmds] = applyCell(watchers, state, msg);
          expect(again).toEqual(state);
          expect(cmds).toEqual([]);
          expected = Arr.filter(expected, (c) => c.client !== client);
        } else {
          const watch = { ...fresh, client };
          const msg = { ...Tag.cases.open.make({}), watch };
          msgs.push(msg);
          [state] = applyCell(watchers, state, msg);
          expected = [...Arr.filter(expected, (c) => c.client !== client), watch].slice(-1024);
        }

        expect(clients(state)).toEqual(expected);
      }

      expect(foldEvents(watchers, {}, null, msgs).finalState).toEqual(state);
      syncTest(
        watchers,
        {},
        {
          msgs,
          encode: Schema.encodeSync(Schema.fromJsonString(Model)),
          decode: Schema.decodeUnknownSync(Schema.fromJsonString(Model)),
          equals: (a, b) => JSON.stringify(a) === JSON.stringify(b),
          seed: 119120,
        },
      );
    },
    { arbitrary: { seed: 119120, runs: 200 } },
  );

  // Only the fixed fill is shared. Each run keeps the original generated walk, including colliding fresh ids; the churn law checks every step
  // and the drain law drains that walked state through every size.
  const opened = Array.from({ length: 1026 }, (_, i) => ({ client: `client-${i}`, at: i, position: i }));
  let filled: typeof Model.Type | undefined;

  // 1,026 clients opened in turn: the state at the bound of 1,024, made once for both laws.
  const atTheBound = () => {
    if (filled === undefined) {
      let [state] = watchers.init(null, {});

      for (const watch of opened) {
        [state] = applyCell(watchers, state, { ...Tag.cases.open.make({}), watch });
      }

      filled = state;
    }

    return filled;
  };

  it.prop(
    "W3: churn at the bound refreshes order and evicts the oldest without tombstones",
    [Walk],
    ([walk]) => {
      const bounded = atTheBound();
      expect(bounded).toStrictEqual({ _tag: "watching", clients: opened.slice(2) });

      let [state] = watchers.init(bounded, {});
      let expected = [...clients(bounded)];

      for (const [pick, fresh] of walk) {
        const held = clients(state);
        const client = held.length > 0 && pick % 3 !== 0 ? nth(held, pick).client : fresh.client;

        if (pick % 3 === 2) {
          [state] = applyCell(watchers, state, { ...Tag.cases.end.make({}), client });
          expected = Arr.filter(expected, (c) => c.client !== client);
        } else {
          const watch = { ...fresh, client };
          [state] = applyCell(watchers, state, { ...Tag.cases.open.make({}), watch });
          expected = [...Arr.filter(expected, (c) => c.client !== client), watch].slice(-1024);
        }

        expect(clients(state)).toEqual(expected);
        expect(new Set(Arr.map(clients(state), (c) => c.client)).size).toBe(clients(state).length);
        expect(clients(state).length).toBeLessThanOrEqual(1024);
      }
    },
    { arbitrary: { seed: 119120, runs: 100 } },
  );

  // The drain of W3, a law of its own. Each `end` of a full state checks the whole new state against its Schema, so the 1,024 ends of one run took
  // 0.1 s, a third of the churn law's time in CI with the drain inside it. A drain does not depend on the walk, only on the names in the state,
  // so it is four laws of 25 runs, one seed each: its 100 runs, 4 s locally for each part, and the churn keeps its 100.
  for (const part of [0, 1, 2, 3]) {
    it.prop(
      `W3: a state walked at the bound drains through every size to empty, part ${part + 1}`,
      [Walk],
      ([walk]) => {
        let [state] = watchers.init(atTheBound(), {});

        for (const [pick, fresh] of walk) {
          const open = clients(state);
          const client = open.length > 0 && pick % 3 !== 0 ? nth(open, pick).client : fresh.client;

          [state] =
            pick % 3 === 2
              ? applyCell(watchers, state, { ...Tag.cases.end.make({}), client })
              : applyCell(watchers, state, { ...Tag.cases.open.make({}), watch: { ...fresh, client } });
        }

        for (const c of [...clients(state)]) {
          [state] = applyCell(watchers, state, { ...Tag.cases.end.make({}), client: c.client });
        }

        expect(state).toEqual(Model.cases.empty.make({}));
      },
      { arbitrary: { seed: 119120 + part, runs: 25 } },
    );
  }
});
