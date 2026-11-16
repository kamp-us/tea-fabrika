// One hands Cmd's delivery, next/ (0037, 0046). The runner saves `pending` or `waiting` on the
// dispatched Cmd and steps this machine with each reply the Project's `ask` gives. Only `pending` is
// owed, so only it keeps the backoff alarm; a `waiting` task is asked again on a wake or a due. A
// `result` is never saved: its answer letter is placed in the same turn, and that letter's fold drops
// the Cmd, so a cut before it leaves the saved state, and the next ask repeats and settles it again.
// A failed ask is not a reply: the runner leaves the saved state as it was and never steps this.
import { Machine } from "@demlik/tea/effect";
import { Schema } from "effect";
import { Rev } from "../../Rev.ts";
import { Result } from "../../tasks/Task.ts";
import { Refusal, Reply } from "../HandsTasks.ts";

/** What a settled delivery answers the program: the task's result, or the Project's refusal. */
const Settled = Schema.TaggedUnion({
  ok: { result: Result },
  err: { reason: Refusal },
});

/** @internal */
export const State = Schema.TaggedUnion({
  /** Saved as dispatched; the Project has not confirmed the request. Owed: the backoff retries it. */
  pending: {},
  /** The Project saved the request, and it has no result yet. `rev` and `arrivedAt` are its receipt. */
  waiting: { rev: Rev, arrivedAt: Schema.Int },
  /** A reply settled it: the runner places this answer as the Cmd's letter, and nothing moves it. */
  result: { answer: Settled },
});
type State = typeof State.Type;

const Msg = Schema.Struct({ type: Schema.Literal("replied"), reply: Reply });

const same = (s: State): [State, []] => [s, []];
const settled = (answer: typeof Settled.Type): [State, []] => [State.cases.result.make({ answer }), []];

/** @internal */
export const handsDelivery = Machine.make({
  model: State,
  msg: Msg,
  cmds: [],
  init: (loaded) => [loaded ?? State.cases.pending.make({}), []],
  update: {
    replied: (s, { reply }) => {
      if (State.isAnyOf(["result"])(s)) {
        return same(s);
      }

      return Reply.match(reply, {
        finished: (reply) => settled(Settled.cases.ok.make({ result: reply.result })),
        // No hands key is only ever the first answer: a saved task is never undone by one. A task
        // that is not this process's is refused whenever it is found.
        refused: (reply) =>
          State.isAnyOf(["pending"])(s) || reply.reason === "id_reused"
            ? settled(Settled.cases.err.make({ reason: reply.reason }))
            : same(s),
        waiting: (reply): [State, []] =>
          State.isAnyOf(["pending"])(s)
            ? [State.cases.waiting.make({ rev: reply.rev, arrivedAt: reply.arrivedAt }), []]
            : same(s),
      });
    },
  },
});
