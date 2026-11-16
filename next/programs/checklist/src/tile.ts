import { Cmd, Machine } from "@demlik/tea/effect";
import { Schema } from "effect";
import { ChecklistMsg, checklistMachine } from "./program.ts";

const press = Cmd.make("press", {
  input: Schema.Struct({ m: Schema.toType(checklistMachine.msg) }),
  ok: Schema.Null,
  err: [],
});

/** The tile's own inputs: a keystroke in the add field, and its submit. */
export const TileMsg = Schema.TaggedUnion({ typed: { text: Schema.String }, submit: {} });

/** The add field belongs to this tab. The parent turns its press into a letter. */
export const tile = Machine.make({
  model: Schema.Struct({ draft: Schema.String.check(Schema.isMaxLength(80)) }),
  msg: TileMsg,
  cmds: [press],
  init: () => [{ draft: "" }, []],
  update: {
    press_ok: (s) => [s, []],
    press_err: (s) => [s, []],
    typed: (_s, m) => [{ draft: m.text.slice(0, 80) }, []],
    submit: (s) =>
      s.draft === "" ? [s, []] : [{ draft: "" }, [press({ m: ChecklistMsg.cases.add.make({ name: s.draft }) })]],
  },
});
