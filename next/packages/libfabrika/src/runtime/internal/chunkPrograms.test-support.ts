// Ticket 1041's writer and reader, next/: the fixture programs L9 to L12 run (docs/plan/quests/
// t1041-PLAN.md). Each is made by a factory, so a law that never runs one never builds it.
//
// The writer turns a person's input into the built-in `send` or `send_chunks` and keeps every answer
// it folds, tagged by the input's own number, so a law reads what the program saw. A plain send's
// answer echoes its letter, number included. A chunked send's answer echoes only `{type, to, as}`,
// so the writer keeps its chunked sends' numbers in Cmd order and takes the oldest for each answer:
// it sends every chunked send to one name, whose answers come in that order. The reader keeps
// every letter it folds, in order. Each chunked item carries its send's number `s` and its own
// index `i`, so a law can tell the sends apart from what landed alone.
//
// The reader's input type rides as `as`, not the plan's `type`: tea's Cmd input may not hold a
// `type` (`CmdInput` is `{ type?: never }`, and `Cmd.make`'s value is `{ ...input, type: name }`,
// @demlik/tea 0.25.0), so a `type` operand would be overwritten by "send_chunks".
import { Machine } from "@demlik/tea/effect";
import * as Schema from "effect/Schema";
import { Program } from "../Program.ts";
import { send, sendChunks } from "../Send.ts";

/** One item of a chunked send: its send's number, its index in that send, and its padding. */
const Item = Schema.Struct({ s: Schema.Int, i: Schema.Int, pad: Schema.String });

/** @internal What the writer folded for one input: `queued`, or the error's tag. */
export const Answer = Schema.Struct({
  n: Schema.Int,
  answer: Schema.String,
  letters: Schema.optionalKey(Schema.Int),
  /** A chunked send's `queued` receipt id, which every one of its letters' `part.id` carries. */
  id: Schema.optionalKey(Schema.String),
  /** A chunked send's echoed target and input type, when its answer's Cmd names them. */
  to: Schema.optionalKey(Schema.String),
  as: Schema.optionalKey(Schema.String),
});

/** @internal The answers, and the numbers of the chunked sends still unanswered, oldest first. */
export const WriterModel = Schema.Struct({ answers: Schema.Array(Answer), pending: Schema.Array(Schema.Int) });
type WriterModel = typeof WriterModel.Type;

const Letter = Schema.Struct({ type: Schema.Literal("letter"), n: Schema.Int });
const Rows = Schema.Struct({ type: Schema.Literal("rows"), n: Schema.Int, items: Schema.Array(Item) });
/** A plain letter to the writer's second peer, so a law sees whether another name's mail waits. */
const Aside = Schema.Struct({ type: Schema.Literal("aside"), n: Schema.Int });

/** A send whose items the writer makes itself: `count` items of `size` padding each, the last of
 *  `tail` padding, so a law can put the operands at an exact byte count. */
const Big = Schema.Struct({
  type: Schema.Literal("big"),
  n: Schema.Int,
  count: Schema.Int,
  size: Schema.Int,
  tail: Schema.Int,
});

/** @internal The items a `big` input makes: `count` items of send `n`, the last padded with `tail`. */
export const madeItems = (n: number, count: number, size: number, tail: number) =>
  Array.from({ length: count }, (_, i) => ({ s: n, i, pad: "x".repeat(i === count - 1 ? tail : size) }));

/** A plain send's number, read back from the letter its answer echoes. */
const numbered = (m: unknown): number => {
  const plain = Schema.decodeUnknownOption(Schema.Struct({ m: Schema.Struct({ n: Schema.Int }) }))(m);
  return plain._tag === "Some" ? plain.value.m.n : -1;
};

const decodeEcho = Schema.decodeUnknownOption(
  Schema.Struct({ cmd: Schema.Struct({ to: Schema.String, as: Schema.String }) }),
);

/** A chunked send's echoed `{to, as}`, read back from its answer's Cmd; nothing when it names none. */
const address = (m: unknown): Partial<typeof Answer.Type> => {
  const echo = decodeEcho(m);
  return echo._tag === "Some" ? { to: echo.value.cmd.to, as: echo.value.cmd.as } : {};
};

const answered = (s: WriterModel, n: number, answer: string, extra: Partial<typeof Answer.Type> = {}) => ({
  ...s,
  answers: [...s.answers, { ...extra, n, answer }],
});

/** A chunked send is sent: its number joins the unanswered ones. */
const chunked = (s: WriterModel, n: number): WriterModel => ({ ...s, pending: [...s.pending, n] });

/** A chunked send is answered: the oldest unanswered number is its own. */
const chunkAnswered = (s: WriterModel, answer: string, extra: Partial<typeof Answer.Type> = {}) =>
  answered({ ...s, pending: s.pending.slice(1) }, s.pending[0] ?? -1, answer, extra);

/** @internal A writer whose plain letters go to `peer` with `send` only. */
export const pipeWriter = (peer: string) => {
  const machine = Machine.make({
    model: WriterModel,
    msg: Letter,
    cmds: [send],
    init: (loaded) => [loaded ?? { answers: [], pending: [] }, []],
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

/** @internal A writer that sends plain letters and chunked sends to `peer`, and an `aside` letter to
 *  `other`, `peer` when left out. */
export const chunkWriter = (peer: string, other: string = peer) => {
  const machine = Machine.make({
    model: WriterModel,
    msg: Schema.Union([Letter, Aside, Rows, Big]),
    cmds: [send, sendChunks],
    init: (loaded) => [loaded ?? { answers: [], pending: [] }, []],
    update: {
      letter: (s, m) => [s, [send({ to: peer, m: { type: "letter", n: m.n } })]],
      aside: (s, m) => [s, [send({ to: other, m: { type: "letter", n: m.n } })]],
      rows: (s, m) => [chunked(s, m.n), [sendChunks({ to: peer, as: "rows", items: m.items })]],
      big: (s, m) => [
        chunked(s, m.n),
        [sendChunks({ to: peer, as: "rows", items: madeItems(m.n, m.count, m.size, m.tail) })],
      ],
      send_ok: (s, m) => [answered(s, numbered(m.cmd), "queued"), []],
      send_err: (s, m) => [answered(s, numbered(m.cmd), m.error._tag), []],
      send_chunks_ok: (s, m) => [
        chunkAnswered(s, "queued", { letters: m.value.letters, id: m.value.id, ...address(m) }),
        [],
      ],
      send_chunks_err: (s, m) => [chunkAnswered(s, m.error._tag, address(m)), []],
    },
  });
  return Program.make({
    name: "t1041-chunk-writer",
    machine,
    state: { v: 1, upgrades: [] },
    view: (s) => s,
    refuse: () => null,
    inputs: {
      letter: "Send one letter",
      aside: "Send one letter to the other peer",
      rows: "Send rows in chunks",
      big: "Send made rows in chunks",
    },
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
