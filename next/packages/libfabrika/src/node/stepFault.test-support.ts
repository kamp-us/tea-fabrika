// next/, P17b. The controller belongs to the test scope, so replacements share one arm.
import { Machine } from "@demlik/tea/effect";
import * as Schema from "effect/Schema";

export const ErrorClass = Schema.Literals(["TypeError", "RangeError", "URIError"]);

const Attempt = Schema.Struct({ process: Schema.String, error: ErrorClass });

export const Before = Schema.Struct({
  name: Schema.String,
  process: Schema.String,
  letter: Schema.String,
  phase: Schema.Literals(["fresh", "saved"]),
});

export const Model = Schema.TaggedUnion({
  off: {},
  armed: {
    name: Schema.String,
    letter: Schema.String,
    errors: Schema.Array(ErrorClass),
    attempts: Schema.Array(Attempt),
  },
});

export const Msg = Schema.TaggedUnion({
  arm: { name: Schema.String, letter: Schema.String, errors: Schema.Array(ErrorClass) },
  before: Before.fields,
});

export const controller = Machine.make({
  model: Model,
  msg: Msg,
  cmds: [],
  init: (saved) => [saved ?? Model.cases.off.make({}), []],
  update: {
    arm: (_model, { name, letter, errors }) => [Model.cases.armed.make({ name, letter, errors, attempts: [] }), []],
    before: (model, msg) => {
      if (model._tag !== "armed" || msg.phase !== "fresh" || msg.name !== model.name || msg.letter !== model.letter) {
        return [model, []];
      }

      const error = model.errors[model.attempts.length];

      return error === undefined
        ? [model, []]
        : [{ ...model, attempts: [...model.attempts, { process: msg.process, error }] }, []];
    },
  },
});
