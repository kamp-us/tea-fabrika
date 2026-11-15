// Ticket 1041's writer and reader, next/: the fixture programs L9 to L12 run (docs/plan/lanes/
// t1041-PLAN.md). Each is made by a factory, so a law that never runs one never builds it.
//
// The writer turns a person's input into the built-in `send` or `send_chunks` and keeps every answer
// it folds, tagged by the input's own number, so a law reads what the program saw. The reader keeps
// every letter it folds, in order. Each chunked item carries its send's number `s` and its own
// index `i`, so a law can tell the sends apart from what landed alone.
//
// The reader's input type rides as `as`, not the plan's `type`: tea's Cmd input may not hold a
// `type` (`CmdInput` is `{ type?: never }`, and `Cmd.make`'s value is `{ ...input, type: name }`,
// @demlik/tea 0.25.0), so a `type` operand would be overwritten by "send_chunks".
import { Machine } from "@demlik/tea/effect";
import { Schema } from "effect";
import { Program } from "../Program.ts";
import { send, sendChunks } from "../Send.ts";

/** One item of a chunked send: its send's number, its index in that send, and its padding. */
const Item = Schema.Struct({ s: Schema.Int, i: Schema.Int, pad: Schema.String });

/** @internal What the writer folded for one input: `queued`, or the error's tag. */
export const Answer = Schema.Struct({
  n: Schema.Int,
  answer: Schema.String,
  letters: Schema.optionalKey(Schema.Int),
});

/** @internal */
export const WriterModel = Schema.Struct({ answers: Schema.Array(Answer) });

const Letter = Schema.Struct({ type: Schema.Literal("letter"), n: Schema.Int });
const Rows = Schema.Struct({ type: Schema.Literal("rows"), n: Schema.Int, items: Schema.Array(Item) });
/** A send whose items the writer makes itself: `count` items of `size` padding each. */
const Big = Schema.Struct({ type: Schema.Literal("big"), n: Schema.Int, count: Schema.Int, size: Schema.Int });

const numbered = (m: unknown): number => {
  const plain = Schema.decodeUnknownOption(Schema.Struct({ m: Schema.Struct({ n: Schema.Int }) }))(m);

  if (plain._tag === "Some") {
    return plain.value.m.n;
  }

  const rows = Schema.decodeUnknownOption(Schema.Struct({ items: Schema.NonEmptyArray(Item) }))(m);
  return rows._tag === "Some" ? rows.value.items[0].s : -1;
};

const answered = (s: typeof WriterModel.Type, n: number, answer: string, letters?: number) => ({
  answers: [...s.answers, { n, answer, ...(letters === undefined ? {} : { letters }) }],
});

/** @internal A writer whose plain letters go to `peer` with `send` only. */
export const pipeWriter = (peer: string) => {
  const machine = Machine.make({
    model: WriterModel,
    msg: Letter,
    cmds: [send],
    init: (loaded) => [loaded ?? { answers: [] }, []],
    update: {
      letter: (s, m) => [s, [send({ to: peer, m: { type: "letter", n: m.n } })]],
      send_ok: (s, m) => [answered(s, numbered(m.cmd), "queued"), []],
      send_err: (s, m) => [answered(s, numbered(m.cmd), m.error._tag), []],
    },
  });
  return Program.make({
    name: "t1041-writer",
    machine,
    state: { v: 1, upgrades: [] },
    view: (s) => s,
    refuse: () => null,
    inputs: { letter: "Send one letter" },
    outputs: {},
    writes: {},
    wake: () => null,
  });
};

/** @internal A writer that sends plain letters and chunked sends to `peer`. */
export const chunkWriter = (peer: string) => {
  const machine = Machine.make({
    model: WriterModel,
    msg: Schema.Union([Letter, Rows, Big]),
    cmds: [send, sendChunks],
    init: (loaded) => [loaded ?? { answers: [] }, []],
    update: {
      letter: (s, m) => [s, [send({ to: peer, m: { type: "letter", n: m.n } })]],
      rows: (s, m) => [s, [sendChunks({ to: peer, as: "rows", items: m.items })]],
      big: (s, m) => [
        s,
        [
          sendChunks({
            to: peer,
            as: "rows",
            items: Array.from({ length: m.count }, (_, i) => ({ s: m.n, i, pad: "x".repeat(m.size) })),
          }),
        ],
      ],
      send_ok: (s, m) => [answered(s, numbered(m.cmd), "queued"), []],
      send_err: (s, m) => [answered(s, numbered(m.cmd), m.error._tag), []],
      send_chunks_ok: (s, m) => [answered(s, numbered(m.cmd), "queued", m.value.letters), []],
      send_chunks_err: (s, m) => [answered(s, numbered(m.cmd), m.error._tag), []],
    },
  });
  return Program.make({
    name: "t1041-chunk-writer",
    machine,
    state: { v: 1, upgrades: [] },
    view: (s) => s,
    refuse: () => null,
    inputs: { letter: "Send one letter", rows: "Send rows in chunks", big: "Send made rows in chunks" },
    outputs: {},
    writes: {},
    wake: () => null,
  });
};

const Part = Schema.Struct({ id: Schema.String, seq: Schema.Int, last: Schema.Boolean });

/** @internal One letter the reader folded. */
export const Got = Schema.Union([
  Schema.Struct({ type: Schema.Literal("letter"), n: Schema.Int }),
  Schema.Struct({ type: Schema.Literal("rows"), items: Schema.Array(Item), part: Part }),
]);

/** @internal */
export const ReaderModel = Schema.Struct({ got: Schema.Array(Got) });

/** @internal The reader: it keeps every plain letter and every chunk it folds, in order. */
export const pipeReader = () => {
  const machine = Machine.make({
    model: ReaderModel,
    msg: Got,
    cmds: [],
    init: (loaded) => [loaded ?? { got: [] }, []],
    update: {
      letter: (s, m) => [{ got: [...s.got, { type: "letter" as const, n: m.n }] }, []],
      rows: (s, m) => [{ got: [...s.got, { type: "rows" as const, items: m.items, part: m.part }] }, []],
    },
  });
  return Program.make({
    name: "t1041-reader",
    machine,
    state: { v: 1, upgrades: [] },
    view: (s) => s,
    refuse: () => null,
    inputs: { letter: "A plain letter", rows: "One chunk of rows" },
    outputs: {},
    writes: {},
    wake: () => null,
  });
};
