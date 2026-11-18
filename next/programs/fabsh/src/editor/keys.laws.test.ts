// next/, S1. L13 fault: interpret a newline inside bracketed paste as accept-line.
import { applyCell, replay } from "@demlik/tea";
import { expect, it } from "@effect/vitest";
import { runsFor } from "@kampus/vitest";
import { Arbitrary, Match, Schema } from "effect";
import { editor } from "./editor.ts";

type Model = ReturnType<typeof editor.init>[0];

type EditorCmd = ReturnType<typeof editor.init>[1][number];

type EditorMsg = typeof editor.msg.Type;

const decode = Schema.decodeUnknownSync(Schema.toType(editor.msg));

const hasPasteControl = (text: string) =>
  [...text].some((char) => {
    const codepoint = char.codePointAt(0) ?? 0;
    return codepoint <= 0x08 || (codepoint >= 0x0b && codepoint <= 0x1f) || (codepoint >= 0x7f && codepoint <= 0x9f);
  });

const Paste = Arbitrary.schema(Schema.String).pipe(
  Arbitrary.map((text) => [...text].filter((char) => !hasPasteControl(char)).join("")),
);

it.prop(
  "L13 bracketed paste inserts text across frame boundaries and never submits its newlines",
  {
    text: Paste,
    split: Schema.Int,
  },
  ({ text, split }) => {
    const pasted = `${text}\nsecond\r\nthird`;
    const bytes = `\x1b[200~${pasted}\x1b[201~`;
    const at = Math.abs(split) % (bytes.length + 1);
    const ctx = { programs: new Map(), history: [], historyLimit: 1000 };
    let model = replay(editor, { ctx, msgs: [] }).state;
    const outputs: EditorCmd[] = [];

    for (const data of [bytes.slice(0, at), bytes.slice(at)]) {
      const [next, cmds] = applyCell<Model, EditorMsg, EditorCmd>(editor, model, decode({ type: "keys", data }));
      model = next;
      outputs.push(...cmds);
    }

    expect(
      outputs.flatMap((cmd) =>
        Match.value(cmd).pipe(
          Match.when({ type: "submit" }, (value) => [value.line]),
          Match.orElse(() => []),
        ),
      ),
    ).toEqual([]);
    const inserted = Match.value(model.mode).pipe(
      Match.tag("prompt", ({ line }) => {
        const value = line.left + line.right;
        const chunks = pasted.split(/\r\n|\r|\n/).map((chunk) => chunk.replaceAll(/[.*+?^${}()|[\]\\]/g, "\\$&"));
        expect(value).toMatch(new RegExp(`^${chunks.join("[\\r\\n ]*")}$`));
        return value;
      }),
      Match.orElse(() => expect.fail("paste left prompt mode")),
    );
    const [, cmds] = applyCell<Model, EditorMsg, EditorCmd>(editor, model, decode({ type: "keys", data: "\r" }));
    const submitted = cmds.flatMap((cmd) =>
      Match.value(cmd).pipe(
        Match.when({ type: "submit" }, (value) => [value.line]),
        Match.orElse(() => []),
      ),
    );
    expect(submitted).toEqual([inserted]);
  },
  { arbitrary: { runs: runsFor({ fast: 300, full: 300 }) } },
);
