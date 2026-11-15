// P39 slice 3 (ticket 1040), next/, D1 on one hands Cmd's delivery machine (0037, 0046): its real
// `init` and its real reducer, walked by tea's guided sequences from `init` and from a saved
// `waiting`, as the runner loads it. The expected next state is this file's own reading of the plan's
// table, never the machine:
//
//   pending  + replied waiting  -> waiting          pending  + replied finished -> result ok
//   waiting  + replied waiting  -> waiting          waiting  + replied finished -> result ok
//   pending  + replied refused  -> result err       result   + placed           -> answered
//   any      + failed           -> unchanged        answered + anything         -> unchanged
//   anything else               -> unchanged
//
// So the machine never leaves `answered`, never goes from `waiting` back to `pending`, and a failure
// changes nothing. That only `pending` is owed (a waiting job sets no backoff alarm) is the runner's
// half, in `RunnerHandsTest.ts` (L20). Plant (after build): let `failed` move `waiting` back to
// `pending`, so a waiting job re-arms the backoff.
import { arbGuidedSequence, propertyInvariant, stubCtxThrowingProxy } from "@demlik/tea/pbt";
import { describe, expect, it } from "@effect/vitest";
import { Schema } from "effect";
import * as fc from "fast-check";
import { fcResult } from "../../jobs/JobsTest.ts";
import { Reply } from "../HandsJobs.ts";
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
  { weight: 1, arbitrary: fc.constant(Reply.cases.refused.make({ reason: "no_hands" })) },
);

const ctx = stubCtxThrowingProxy<unknown>();

const lists = arbGuidedSequence(
  handsDelivery,
  ctx,
  {
    outside: {
      replied: fc.record({ type: fc.constant("replied" as const), reply }),
      failed: fc.record({
        type: fc.constant("failed" as const),
        reason: fc.constantFrom("storage" as const, "unavailable" as const, "conflict" as const),
      }),
      placed: fc.record({ type: fc.constant("placed" as const), rev, pos: rev }),
    },
  },
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

const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);
const key = (msg: Msg) => (msg.type === "replied" ? `replied:${msg.reply._tag}` : msg.type);

describe("P39 slice 3: one hands Cmd's delivery", () => {
  it("D1: the delivery never leaves answered, never goes from waiting back to pending, and a failure changes nothing", () => {
    const reached = new Set<string>();
    expect(handsDelivery.init(null, undefined)[0]._tag, "D1: a Cmd saved as dispatched starts pending").toBe("pending");
    propertyInvariant(
      handsDelivery,
      ctx,
      lists,
      ({ prev, msg, next }) => {
        reached.add(`${prev._tag}+${key(msg)}`);

        if (prev._tag === "answered") {
          return same(prev, next) || "D1: nothing moves an answered delivery";
        }

        if (msg.type === "failed") {
          return same(prev, next) || "D1: a failed ask changes nothing; the Cmd stays as it was";
        }

        if (prev._tag === "waiting" && next._tag === "pending") {
          return "D1: a saved job never goes back to pending";
        }

        if (msg.type === "replied" && (prev._tag === "pending" || prev._tag === "waiting")) {
          const r = msg.reply;

          if (r._tag === "waiting") {
            return prev._tag === "waiting"
              ? next._tag === "waiting" || "D1: waiting stays waiting on another waiting reply"
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

          return prev._tag === "pending"
            ? (next._tag === "result" && next.answer._tag === "err" && next.answer.reason === "no_hands") ||
                "D1: a refusal settles a pending delivery as no_hands"
            : same(prev, next) || "D1: a refusal never undoes a saved job";
        }

        if (msg.type === "placed" && prev._tag === "result") {
          return (
            (next._tag === "answered" && next.rev === msg.rev && next.pos === msg.pos) ||
            "D1: a placed letter moves a settled delivery to answered, at that letter"
          );
        }

        return same(prev, next) || `D1: ${prev._tag} + ${key(msg)} changes nothing`;
      },
      { ...RUNS, loaded },
    );
    // An empty walk cannot pass: every row of the table ran at least once.
    expect([...reached].sort()).toEqual(
      expect.arrayContaining(
        [
          "pending+replied:waiting",
          "pending+replied:finished",
          "pending+replied:refused",
          "pending+failed",
          "pending+placed",
          "waiting+replied:waiting",
          "waiting+replied:finished",
          "waiting+replied:refused",
          "waiting+failed",
          "waiting+placed",
          "result+placed",
          "result+replied:finished",
          "result+failed",
          "answered+replied:finished",
          "answered+failed",
          "answered+placed",
        ].sort(),
      ),
    );
  });
});
