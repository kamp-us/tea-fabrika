// P39 slice 3 (ticket 1040), next/, D1 on one hands Cmd's delivery machine (0037, 0046): its real
// `init` and its real reducer, walked by tea's guided sequences from `init` and from a saved
// `waiting`, as the runner loads it. The machine takes one Msg, the Project's reply; a failed ask is
// no reply, and the runner never steps the machine with it. The expected next state is this file's
// own reading of the plan's table, as the fix round left it:
//
//   pending + replied waiting  -> waiting       pending + replied finished -> result ok
//   waiting + replied waiting  -> waiting       waiting + replied finished -> result ok
//   pending + replied refused  -> result err    waiting + replied refused  -> result err, id_reused only
//   result  + anything         -> unchanged
//
// So a settled delivery never moves again, a saved task never goes back to pending, and no hands key
// never undoes a saved task. That only `pending` is owed (a waiting task sets no backoff alarm) is the
// runner's half, in `RunnerHandsTest.ts` (L20). Plants: let a `no_hands` refusal settle a waiting
// delivery; let a second finished reply settle a settled one again.
import { arbGuidedSequence, propertyInvariant, stubCtxThrowingProxy } from "@demlik/tea/pbt";
import { describe, expect, it } from "@effect/vitest";
import { Schema } from "effect";
import * as fc from "fast-check";
import { fcResult } from "../../tasks/TasksTest.ts";
import { Reply } from "../HandsTasks.ts";
import { handsDelivery, State } from "./handsDelivery.ts";

const RUNS = { seed: 119120, numRuns: 100 };

type Msg = (typeof handsDelivery)["msg"]["Type"];

const rev = fc.integer({ min: 1, max: 1_000_000 });
const arrivedAt = fc.integer({ min: 1_700_000_000_000, max: 1_900_000_000_000 });

const reply = fc.oneof(
  { weight: 3, arbitrary: fc.record({ rev, arrivedAt }).map((fields) => Reply.cases.waiting.make(fields)) },
  {
    weight: 3,
    arbitrary: fc.record({ result: fcResult, rev, arrivedAt }).map((fields) => Reply.cases.finished.make(fields)),
  },
  {
    weight: 2,
    arbitrary: fc
      .constantFrom("no_hands" as const, "id_reused" as const)
      .map((reason) => Reply.cases.refused.make({ reason })),
  },
);

const ctx = stubCtxThrowingProxy<unknown>();

const lists = arbGuidedSequence(
  handsDelivery,
  ctx,
  { outside: { replied: fc.record({ type: fc.constant("replied" as const), reply }) } },
  { maxLength: 30 },
);

/**
 * A saved `waiting`, as the runner reads it back from a dispatched Cmd after a restart: the plan's
 * saved shape is the request's receipt under `waiting`, the same JSON as the `waiting` reply.
 */
const loaded = fc.oneof(
  fc.constant(null),
  fc
    .record({ rev, arrivedAt })
    .map((fields) => Schema.decodeUnknownSync(State)(Schema.encodeSync(Reply)(Reply.cases.waiting.make(fields)))),
);

const same = (a: Schema.Json, b: Schema.Json) => JSON.stringify(a) === JSON.stringify(b);

const key = (msg: Msg) =>
  msg.reply._tag === "refused" ? `replied:refused:${msg.reply.reason}` : `replied:${msg.reply._tag}`;

describe("P39 slice 3: one hands Cmd's delivery", () => {
  it("D1: a settled delivery never moves again, a saved task never goes back to pending, and a refusal settles only an unsaved task or one that is another process's", () => {
    const reached = new Set<string>();
    expect(handsDelivery.init(null, undefined)[0]._tag, "D1: a Cmd saved as dispatched starts pending").toBe("pending");
    propertyInvariant(
      handsDelivery,
      ctx,
      lists,
      ({ prev, msg, next }) => {
        reached.add(`${prev._tag}+${key(msg)}`);
        const r = msg.reply;

        if (prev._tag === "result") {
          return same(prev, next) || "D1: nothing moves a settled delivery";
        }

        if (prev._tag === "waiting" && next._tag === "pending") {
          return "D1: a saved task never goes back to pending";
        }

        if (r._tag === "waiting") {
          return prev._tag === "waiting"
            ? same(prev, next) || "D1: waiting stays waiting, at its first receipt, on another waiting reply"
            : (next._tag === "waiting" && next.rev === r.rev && next.arrivedAt === r.arrivedAt) ||
                "D1: pending moves to waiting with the request's receipt";
        }

        if (r._tag === "finished") {
          return (
            (next._tag === "result" &&
              next.answer._tag === "ok" &&
              same(next.answer.result, r.result) &&
              Object.keys(next.answer).sort().join() === "_tag,result") ||
            "D1: a finished reply settles the delivery with that result"
          );
        }

        if (prev._tag === "pending" || r.reason === "id_reused") {
          return (
            (next._tag === "result" &&
              next.answer._tag === "err" &&
              next.answer.reason === r.reason &&
              Object.keys(next.answer).sort().join() === "_tag,reason") ||
            `D1: a ${r.reason} refusal settles a ${prev._tag} delivery with that reason`
          );
        }

        return same(prev, next) || "D1: no hands key never undoes a saved task";
      },
      { ...RUNS, loaded },
    );
    // An empty walk cannot pass: every row of the table ran at least once.
    expect([...reached].sort()).toEqual(
      [
        "pending+replied:waiting",
        "pending+replied:finished",
        "pending+replied:refused:no_hands",
        "pending+replied:refused:id_reused",
        "waiting+replied:waiting",
        "waiting+replied:finished",
        "waiting+replied:refused:no_hands",
        "waiting+replied:refused:id_reused",
        "result+replied:waiting",
        "result+replied:finished",
        "result+replied:refused:no_hands",
        "result+replied:refused:id_reused",
      ].sort(),
    );
  });
});
