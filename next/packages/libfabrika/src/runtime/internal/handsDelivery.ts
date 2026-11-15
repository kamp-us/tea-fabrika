// One hands Cmd's delivery, next/ (0037, 0046). The runner saves `pending` or `waiting` on the
// dispatched Cmd and steps this machine with what the Project's `ask` answered. Only `pending` is
// owed, so only it keeps the backoff alarm; a `waiting` job is asked again on a wake or a due. A
// `result` is never saved: its answer letter is placed in the same turn, and a cut before that
// leaves the saved state, so the next ask repeats and settles it again.
import { Machine } from "@demlik/tea/effect";
import { Schema } from "effect";
import { Result } from "../../jobs/Job.ts";
import { Rev } from "../../Rev.ts";
import { Reply } from "../HandsJobs.ts";

/** What a settled delivery answers the program: the job's result, or the refusal of an unset target. */
const Settled = Schema.TaggedUnion({
  ok: { result: Result },
  err: { reason: Schema.Literal("no_hands") },
});

/** @internal */
export const State = Schema.TaggedUnion({
  /** Saved as dispatched; the Project has not confirmed the request. Owed: the backoff retries it. */
  pending: {},
  /** The Project saved the request, and it has no result yet. `rev` and `arrivedAt` are its receipt. */
  waiting: { rev: Rev, arrivedAt: Schema.Int },
  /** A reply settled it; the answer letter is not placed yet. */
  result: { answer: Settled },
  /** The answer letter is placed at `rev`, inbox position `pos`; its fold drops the Cmd. */
  answered: { rev: Rev, pos: Rev },
});
type State = typeof State.Type;

const Msg = Schema.Union([
  Schema.Struct({ type: Schema.Literal("replied"), reply: Reply }),
  Schema.Struct({ type: Schema.Literal("failed"), reason: Schema.Literals(["storage", "unavailable", "conflict"]) }),
  Schema.Struct({ type: Schema.Literal("placed"), rev: Rev, pos: Rev }),
]);

const same = (s: State): [State, []] => [s, []];

/** @internal */
export const handsDelivery = Machine.make({
  model: State,
  msg: Msg,
  cmds: [],
  init: (loaded) => [loaded ?? State.cases.pending.make({}), []],
  update: {
    replied: (s, { reply }) => {
      if (s._tag !== "pending" && s._tag !== "waiting") {
        return same(s);
      }

      if (reply._tag === "finished") {
        return [State.cases.result.make({ answer: Settled.cases.ok.make({ result: reply.result }) }), []];
      }

      if (reply._tag === "refused") {
        // A refusal is only ever the first answer: a saved job is never undone by one.
        return s._tag === "pending"
          ? [State.cases.result.make({ answer: Settled.cases.err.make({ reason: reply.reason }) }), []]
          : same(s);
      }

      return s._tag === "pending"
        ? [State.cases.waiting.make({ rev: reply.rev, arrivedAt: reply.arrivedAt }), []]
        : same(s);
    },
    // A failed ask changes nothing: the Cmd stays as it was, and a pending one keeps its backoff.
    failed: (s) => same(s),
    placed: (s, { rev, pos }) => (s._tag === "result" ? [State.cases.answered.make({ rev, pos }), []] : same(s)),
  },
});
