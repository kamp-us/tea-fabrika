import { Machine } from "@demlik/tea/effect";
import { Schema } from "effect";

const Command = Schema.Literals([
  "beginning-of-line",
  "end-of-line",
  "backward-char",
  "forward-char",
  "backward-word",
  "forward-word",
  "backward-delete-char",
  "delete-char",
  "kill-line",
  "unix-line-discard",
  "unix-word-rubout",
  "kill-word",
  "backward-kill-word",
  "yank",
  "yank-pop",
  "transpose-chars",
  "clear-screen",
  "accept-line",
  "previous-history",
  "next-history",
  "reverse-search-history",
  "forward-search-history",
  "complete",
  "interrupt",
  "end-of-file",
  "undo",
  "yank-last-arg",
  "upcase-word",
  "downcase-word",
  "capitalize-word",
  "beginning-of-history",
  "end-of-history",
  "cancel",
]);

type Command = typeof Command.Type;

export const Key = Schema.TaggedUnion({ text: { text: Schema.String }, command: { command: Command }, unknown: {} });

export type Key = typeof Key.Type;

const BOUND: ReadonlyMap<string, Command> = new Map([
  ["\x01", "beginning-of-line"],
  ["\x1b[H", "beginning-of-line"],
  ["\x1bOH", "beginning-of-line"],
  ["\x1b[1~", "beginning-of-line"],
  ["\x05", "end-of-line"],
  ["\x1b[F", "end-of-line"],
  ["\x1bOF", "end-of-line"],
  ["\x1b[4~", "end-of-line"],
  ["\x02", "backward-char"],
  ["\x1b[D", "backward-char"],
  ["\x1bOD", "backward-char"],
  ["\x06", "forward-char"],
  ["\x1b[C", "forward-char"],
  ["\x1bOC", "forward-char"],
  ["\x1bb", "backward-word"],
  ["\x1b[1;3D", "backward-word"],
  ["\x1b[1;5D", "backward-word"],
  ["\x1bf", "forward-word"],
  ["\x1b[1;3C", "forward-word"],
  ["\x1b[1;5C", "forward-word"],
  ["\x7f", "backward-delete-char"],
  ["\x08", "backward-delete-char"],
  ["\x1b[3~", "delete-char"],
  ["\x0b", "kill-line"],
  ["\x15", "unix-line-discard"],
  ["\x17", "unix-word-rubout"],
  ["\x1bd", "kill-word"],
  ["\x1b\x7f", "backward-kill-word"],
  ["\x19", "yank"],
  ["\x1by", "yank-pop"],
  ["\x14", "transpose-chars"],
  ["\x0c", "clear-screen"],
  ["\r", "accept-line"],
  ["\n", "accept-line"],
  ["\x10", "previous-history"],
  ["\x1b[A", "previous-history"],
  ["\x1bOA", "previous-history"],
  ["\x0e", "next-history"],
  ["\x1b[B", "next-history"],
  ["\x1bOB", "next-history"],
  ["\x12", "reverse-search-history"],
  ["\x13", "forward-search-history"],
  ["\t", "complete"],
  ["\x03", "interrupt"],
  ["\x04", "end-of-file"],
  ["\x1f", "undo"],
  ["\x18\x15", "undo"],
  ["\x1b.", "yank-last-arg"],
  ["\x1bu", "upcase-word"],
  ["\x1bl", "downcase-word"],
  ["\x1bc", "capitalize-word"],
  ["\x1b<", "beginning-of-history"],
  ["\x1b>", "end-of-history"],
  ["\x1b", "cancel"],
  ["\x07", "cancel"],
]);

export const printable = (char: string): boolean => {
  const cp = char.codePointAt(0) ?? 0;
  return cp >= 0x20 && cp !== 0x7f && (cp < 0x80 || cp > 0x9f);
};

const key = (raw: string): Key => {
  const command = BOUND.get(raw);
  return command !== undefined
    ? Key.cases.command.make({ command })
    : raw !== "" && [...raw].every(printable)
      ? Key.cases.text.make({ text: raw })
      : Key.cases.unknown.make({});
};

const Frame = Schema.TaggedUnion({ normal: { pending: Schema.String }, paste: { pending: Schema.String } });

const Input = Schema.Struct({ raw: Schema.String, key: Key });

const Model = Schema.Struct({ frame: Frame, keys: Schema.Array(Input) });

const START = "\x1b[200~";

const END = "\x1b[201~";

/** The unconsumed bytes, including the opening paste mark when a paste is incomplete. */
export const pending = (state: typeof Model.Type): string =>
  Frame.match(state.frame, {
    normal: ({ pending }) => pending,
    paste: ({ pending }) => START + pending,
  });

/** Read one key. The untouched suffix stays after it, even if the parent enters busy. */
const read = (state: typeof Model.Type, more: string): typeof Model.Type => {
  let frame = state.frame;
  let data = frame.pending + more;

  for (;;) {
    if (Frame.guards.paste(frame)) {
      const end = data.indexOf(END);

      if (end < 0) {
        return { frame: Frame.cases.paste.make({ pending: data }), keys: [] };
      }

      const text = [...data.slice(0, end).replaceAll(/\r\n|\r|\n|\t/g, " ")].filter(printable).join("");
      const raw = START + data.slice(0, end) + END;
      data = data.slice(end + END.length);
      frame = Frame.cases.normal.make({ pending: "" });

      if (text !== "") {
        return {
          frame: Frame.cases.normal.make({ pending: data }),
          keys: [{ raw, key: Key.cases.text.make({ text }) }],
        };
      }

      continue;
    }

    if (data === "") {
      return { frame: Frame.cases.normal.make({ pending: "" }), keys: [] };
    }

    if (data.startsWith(START)) {
      frame = Frame.cases.paste.make({ pending: "" });
      data = data.slice(START.length);
      continue;
    }

    if (START.startsWith(data) || data === "\x18") {
      return { frame: Frame.cases.normal.make({ pending: data }), keys: [] };
    }

    let end = 1;

    if (data.startsWith("\x1b[")) {
      const final = /[\x40-\x7e]/.exec(data.slice(2));

      if (final === null) {
        return { frame: Frame.cases.normal.make({ pending: data }), keys: [] };
      }

      end = 3 + final.index;
    } else if (data.startsWith("\x1bO")) {
      if (data.length < 3) {
        return { frame: Frame.cases.normal.make({ pending: data }), keys: [] };
      }

      end = 3;
    } else if (data.startsWith("\x1b") || data.startsWith("\x18\x15")) {
      end = 2;
    } else if (printable(data.charAt(0))) {
      while (end < data.length && printable(data.charAt(end))) {
        end += 1;
      }
    }

    const raw = data.slice(0, end);
    return { frame: Frame.cases.normal.make({ pending: data.slice(end) }), keys: [{ raw, key: key(raw) }] };
  }
};

/** The parent drains one key at a time. Only flush declares a pending Esc standalone. */
export const keys = Machine.make({
  model: Model,
  msg: Schema.Union([
    Schema.Struct({ type: Schema.Literal("data"), data: Schema.String }),
    Schema.Struct({ type: Schema.Literal("flush") }),
  ]),
  cmds: [],
  init: () => [{ frame: Frame.cases.normal.make({ pending: "" }), keys: [] }, []],
  update: {
    data: (state, msg) => [read(state, msg.data), []],
    flush: (state) => [
      Frame.guards.normal(state.frame) && state.frame.pending === "\x1b"
        ? {
            frame: Frame.cases.normal.make({ pending: "" }),
            keys: [{ raw: "\x1b", key: key("\x1b") }],
          }
        : { ...state, keys: [] },
      [],
    ],
  },
});
