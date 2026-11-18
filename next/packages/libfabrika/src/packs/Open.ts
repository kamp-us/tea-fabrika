/**
 * One client's repository opening, held as the state of the opening machine.
 */
import { applyCell } from "@demlik/tea";
import * as Effect from "effect/Effect";
import * as Ref from "effect/Ref";
import { machine, Msg as OpenMsg } from "./internal/open.ts";

/**
 * A selection after its checks: the repository's id and key, a label to show, the pinned branch,
 * commit and document hash, whether the document is there, its settings snapshot, and the person
 * opening it.
 *
 * @category models
 */
export type CheckedSelection = import("./internal/open.ts").CheckedSelection;

/**
 * Schema for what an opening session is told, each Msg made with `Msg.cases.<name>.make`.
 *
 * @category schemas
 */
export const Msg = OpenMsg;

type Msg = typeof Msg.Type;

type State = typeof machine.model.Type;

/**
 * Creates one client's opening session: the state of one repository opening, which changes only
 * when `send` hands the opening machine a Msg. `send` answers the state after the Msg.
 *
 * **Details**
 *
 * The states are `closed`, `checking`, `awaiting_trust`, `saving`, `ready` and `refused`. A Msg
 * out of turn, or for another selection, leaves the state as it is; `select` and `close` always
 * apply.
 *
 * @category constructors
 */
export const session = Effect.fn("repositoryOpen.session")(function* () {
  const state = yield* Ref.make(machine.init(null, undefined)[0]);

  return {
    send: Effect.fn("repositoryOpen.send")(function* (msg: Msg): Effect.fn.Return<State> {
      return yield* Ref.modify(state, (current) => {
        const [next] = applyCell(machine, current, msg);

        return [next, next];
      });
    }),
  };
});
