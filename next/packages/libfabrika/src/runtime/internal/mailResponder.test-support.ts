// P41 slice 1's responder, next/ (ticket 744): one tea machine with one `ready` state. Each admitted
// request is answered with its successor, sent to the name the request asks the reply to go to; a
// negative value is refused by the program, so no answer is ever sent for it. `approve` is a
// person-only port, so program mail can never enter it. Command outcomes are messages here too.
import { Machine } from "@demlik/tea/effect";
import { Schema } from "effect";
import { Program } from "../Program.ts";
import { send } from "../Send.ts";

/** @internal */
export const Model = Schema.TaggedStruct("ready", {
  /** Requests answered. */
  answered: Schema.Int,
  /** Send outcomes seen, so an outcome is a message that changes the model. */
  queued: Schema.Int,
  refused: Schema.Int,
});

/** @internal */
export type Model = typeof Model.Type;

/** @internal */
export const Msg = Schema.TaggedUnion({
  request: {
    ref: Schema.NonEmptyString,
    value: Schema.Int,
    reply: Schema.NonEmptyString,
    parent: Schema.optionalKey(Schema.String),
  },
  approve: { parent: Schema.optionalKey(Schema.String) },
});

/** The answer the requester takes, the same shape restated here: the responder shares the shape,
 *  never the requester's code. */
const Answer = Schema.TaggedStruct("answer", { ref: Schema.String, value: Schema.Int });

const machine = Machine.make({
  model: Model,
  msg: Msg,
  cmds: [send],
  init: (loaded) => [loaded ?? Model.make({ answered: 0, queued: 0, refused: 0 }), []],
  update: {
    request: (s, m) => [
      { ...s, answered: s.answered + 1 },
      [send({ to: m.reply, m: Answer.make({ ref: m.ref, value: m.value + 1 }) })],
    ],
    approve: (s) => [s, []],
    send_ok: (s) => [{ ...s, queued: s.queued + 1 }, []],
    send_err: (s) => [{ ...s, refused: s.refused + 1 }, []],
  },
});

/** @internal */
export const mailResponder = Program.make({
  name: "responder",
  machine,
  state: { v: 1, upgrades: [] },
  view: (s) => s,
  refuse: (_s, m) => (Msg.guards.request(m) && m.value < 0 ? { reason: "negative" } : null),
  inputs: {
    request: "Answer a request",
    approve: { description: "Approve", personOnly: true },
  },
  outputs: {},
  writes: {},
  wake: () => null,
});
