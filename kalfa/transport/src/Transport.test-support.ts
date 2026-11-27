// What the laws of @kalfa/transport share: the generators, the harness that runs the two ends of a memory pair at once, a line
// format that is no JSON-RPC (F5), a tracer and a logger that keep what they were handed, and the forms a secret is written in.
// Every generator is an Effect Arbitrary, so the package needs no fast-check. Each law applies, to each value it draws, one value
// made from it for every class the plan names, so every class is reached in every run and no run can pass on less.
import { isDeepStrictEqual } from "node:util";
import { assert, expect } from "@effect/vitest";
import {
  Arbitrary,
  Array as Arr,
  Cause,
  Context,
  Deferred,
  Duration,
  Effect,
  Exit,
  Fiber,
  Inspectable,
  Layer,
  Logger,
  Option,
  Predicate,
  Queue,
  References,
  Schema,
  Scope,
  Stream,
  Tracer,
} from "effect";
import { Socket } from "effect/socket";
import { Format, FormatError, NoSharedVersion, TraceState, Transport } from "./index.ts";
import type { Frame } from "./index.ts";
import * as MemorySocket from "./MemorySocket.ts";

/** The shared seed: a fixed seed makes a red run repeat. */
export const SEED = 119120;

/** A JSON value: what a frame can hold. */
type Json = typeof Schema.Json.Type;

// ---- the small tools the generators are built from

/** A whole number from `minimum` to `maximum`, never `-0`: Effect's JSON codec writes `-0` as `0`, so it never comes back. */
export const between = (minimum: number, maximum: number): Arbitrary.Arbitrary<number> =>
  Arbitrary.schema(Schema.Int.check(Schema.isBetween({ minimum, maximum }))).pipe(Arbitrary.map((n) => n + 0));

/** One of the choices. */
export const pick = <const A>(choices: ReadonlyArray<A>): Arbitrary.Arbitrary<A> =>
  between(0, choices.length - 1).pipe(Arbitrary.map((index) => Arr.getUnsafe(choices, index)));

const LETTERS = "abcdefghijklmnopqrstuvwxyz0123456789".split("");

/** A made-up word of letters and digits: it holds no mark a format or a URL treats as its own. */
export const word: Arbitrary.Arbitrary<string> = Arbitrary.array(pick(LETTERS), { minLength: 3, maxLength: 10 }).pipe(
  Arbitrary.map((letters) => letters.join("")),
);

/** The marks of class (a): quotes, a backslash, CR and LF, U+2028 and U+2029, letters past ASCII, an emoji, a lone surrogate. */
const MARKS = [
  '"',
  "\\",
  "\r",
  "\n",
  String.fromCharCode(0x2028),
  String.fromCharCode(0x2029),
  String.fromCharCode(0),
  String.fromCharCode(0x1f),
  "é",
  "ş",
  "设",
  "😀",
  String.fromCharCode(0xd800),
  String.fromCharCode(0xdfff),
  "\\u0041",
  "</script>",
];

const LONE_SURROGATE = /[\ud800-\udfff]/gu;

/** A piece of a text: a mark, a control character from U+0000 to U+001F, or a word. */
const piece: Arbitrary.Arbitrary<string> = Arbitrary.all({
  kind: between(0, 2),
  mark: pick(MARKS),
  control: between(0, 31),
  word,
}).pipe(Arbitrary.map((each) => Arr.getUnsafe([each.mark, String.fromCharCode(each.control), each.word], each.kind)));

/** A text with quotes, backslashes, line breaks, control characters, letters past ASCII, an emoji and a lone surrogate in it. */
export const awkwardText: Arbitrary.Arbitrary<string> = Arbitrary.all({
  pieces: Arbitrary.array(piece, { minLength: 1, maxLength: 8 }),
  mark: pick(MARKS),
}).pipe(Arbitrary.map(({ pieces, mark }) => `${pieces.join("")}${mark}`));

/** Text that UTF-8 keeps as it is: no lone surrogate. */
export const wellFormedText: Arbitrary.Arbitrary<string> = awkwardText.pipe(
  Arbitrary.map((text) => `${text.replace(LONE_SURROGATE, "")}é设😀`),
);

const HEX = "0123456789abcdef".split("");

const NONZERO_HEX = "123456789abcdef".split("");

/** A lower-case hex text of `length` digits that is no all-zero id. */
const hex = (length: number): Arbitrary.Arbitrary<string> =>
  Arbitrary.all({
    head: pick(NONZERO_HEX),
    rest: Arbitrary.array(pick(HEX), { minLength: length - 1, maxLength: length - 1 }),
  }).pipe(Arbitrary.map(({ head, rest }) => `${head}${rest.join("")}`));

// ---- the messages a stage sends: a struct, a tagged union, with Effect's own derived Arbitrary

export const Progress = Schema.TaggedStruct("Progress", { done: Schema.Int, total: Schema.Int });

const Text = Schema.TaggedStruct("Text", { text: Schema.String });

/** What a test stage sends: a tagged union, as the plan's sketch has it. */
export const Message = Schema.Union([Progress, Text]);

export type Message = typeof Message.Type;

/** A message, from Effect's own Arbitrary for `Message`; a `-0` is made `0`, since Effect's JSON codec does not keep it. */
export const message: Arbitrary.Arbitrary<Message> = Arbitrary.schema(Message).pipe(
  Arbitrary.map((each) =>
    Predicate.isTagged(each, "Progress") ? Progress.make({ done: each.done + 0, total: each.total + 0 }) : each,
  ),
);

/** A progress message made from two numbers: used where a value must be told from another by its content. */
export const progressMessage = (done: number, total = 100): Message => Progress.make({ done, total });

export const textMessage = (text: string): Message => Text.make({ text });

/** What a law can run: a schema with no services. */
export type Plain = Schema.Codec<unknown, unknown, never, never>;

// ---- what a settled run gave

/** The typed failure of an exit, and whether it also holds a defect. */
export const failureFrom = <A, E>(
  exit: Exit.Exit<A, E>,
): { readonly error: Option.Option<E>; readonly defect: boolean } =>
  Exit.isFailure(exit)
    ? { error: Cause.findErrorOption(exit.cause), defect: Cause.hasDies(exit.cause) }
    : { error: Option.none(), defect: false };

/** The close a `SocketError` holds: its code and reason. */
export const closeFrom = (
  error: Socket.SocketError,
): Option.Option<{ readonly code: number; readonly reason: string | undefined }> =>
  Predicate.isTagged(error.reason, "SocketCloseError")
    ? Option.some({ code: error.reason.code, reason: error.reason.closeReason })
    : Option.none();

/** The close a failed exit holds, when its error is a `SocketError` of a close. */
export const exitClose = <A>(exit: Exit.Exit<A, Socket.SocketError>) =>
  Option.flatMap(failureFrom(exit).error, closeFrom);

/** What a `settled` run gave: the law fails when the run stalled or did not succeed. */
export const finished = <A, E>(run: Option.Option<Exit.Exit<A, E>>, name: string): A =>
  Option.match(run, {
    onNone: () => assert.fail(`${name}: the run stalled`),
    onSome: Exit.match({
      onFailure: (cause) => assert.fail(`${name}: the run failed: ${Cause.pretty(cause)}`),
      onSuccess: (value) => value,
    }),
  });

// ---- (a) to (d): the values a stage sends, one class at a time

/** What one drawn run holds for a value: the made-up parts every class is built from. */
interface Seed {
  readonly text: string;
  readonly other: string;
  readonly n: number;
  readonly high: number;
  readonly low: number;
  readonly bytes: ReadonlyArray<number>;
  readonly flag: boolean;
}

export const seed: Arbitrary.Arbitrary<Seed> = Arbitrary.all({
  text: awkwardText,
  other: word,
  n: between(-1_000_000, 1_000_000),
  high: between(0, 2 ** 31 - 1),
  low: between(0, 2 ** 31 - 1),
  bytes: Arbitrary.array(between(0, 255), { maxLength: 24 }),
  flag: Arbitrary.schema(Schema.Boolean),
});

/** A value a law of values sends: JSON, or one of the two Effect's JSON codec writes as JSON (a BigInt, bytes). */
type Value = Json | bigint | Uint8Array;

/** A class of value: its schema, and one value of it for each seed. */
interface ValueClass {
  readonly id: "a" | "b" | "c" | "d";
  readonly name: string;
  readonly schema: Plain;
  readonly values: ReadonlyArray<Value>;
}

const TRACEPARENT = "00-0af7651916cd43dd8448eb211c80319c-b7ad6b7169203331-01";

const Meddling = Schema.Struct({
  _meta: Schema.Struct({ traceparent: Schema.String, tracestate: Schema.String }),
  traceparent: Schema.String,
  jsonrpc: Schema.String,
  method: Schema.String,
  id: Schema.Finite,
  params: Schema.Struct({ value: Schema.String }),
});

/** The names of the classes a law of values must reach, in order. */
export const VALUE_CLASSES = [
  "a: an awkward text",
  "a: an awkward text in a struct",
  "b: a bare string",
  "b: a number",
  "b: true or false",
  "b: null",
  "b: an array",
  "c: an object with a _meta, a traceparent, a jsonrpc, a method, an id and a params of its own",
  "d: a BigInt",
  "d: a Uint8Array",
  "d: NaN",
  "d: Infinity",
  "d: -Infinity",
] as const;

/** One value of every class for each seed, under the class's own schema. */
export const valueClasses = (seeds: ReadonlyArray<Seed>): ReadonlyArray<ValueClass> => {
  const make = (
    id: ValueClass["id"],
    name: (typeof VALUE_CLASSES)[number],
    schema: Plain,
    from: (each: Seed) => Value,
  ): ValueClass => ({ id, name, schema, values: seeds.map(from) });

  // NaN and Infinity are class (d): the schema of those three must take them, and only `Schema.Number` does.
  const nonFinite = (name: (typeof VALUE_CLASSES)[number], value: number) =>
    make(
      "d",
      name,
      // @effect-diagnostics-next-line schemaNumber:off -- NaN and Infinity must reach the JSON check
      Schema.Number,
      () => value,
    );

  return [
    make("a", VALUE_CLASSES[0], Schema.String, ({ text }) => text),
    make("a", VALUE_CLASSES[1], Text, ({ text }) => Text.make({ text })),
    make("b", VALUE_CLASSES[2], Schema.String, ({ other }) => other),
    make("b", VALUE_CLASSES[3], Schema.Finite, ({ n }) => n),
    make("b", VALUE_CLASSES[4], Schema.Boolean, ({ flag }) => flag),
    make("b", VALUE_CLASSES[5], Schema.Null, () => null),
    make("b", VALUE_CLASSES[6], Schema.Array(Schema.Finite), ({ n, high }) => [n, high, 0]),
    make("c", VALUE_CLASSES[7], Meddling, ({ n, text, other }) => ({
      _meta: { traceparent: TRACEPARENT, tracestate: `t=${other}` },
      traceparent: TRACEPARENT,
      jsonrpc: "2.0",
      method: "challenge",
      id: n,
      params: { value: text },
    })),
    make(
      "d",
      VALUE_CLASSES[8],
      Schema.BigInt,
      ({ high, low, flag }) => (flag ? -1n : 1n) * (BigInt(high) * BigInt(2 ** 31) + BigInt(low)),
    ),
    make("d", VALUE_CLASSES[9], Schema.Uint8Array, ({ bytes }) => Uint8Array.from(bytes)),
    nonFinite(VALUE_CLASSES[10], Number.NaN),
    nonFinite(VALUE_CLASSES[11], Number.POSITIVE_INFINITY),
    nonFinite(VALUE_CLASSES[12], Number.NEGATIVE_INFINITY),
  ];
};

// ---- (e): values no JSON holds, under a schema that holds anything

/** The names of the classes of `looseValues`, in order. */
export const LOOSE_CLASSES = [
  "e: a function",
  "e: a symbol",
  "e: a cycle",
  "e: a Map",
  "e: undefined inside an array",
] as const;

/** A value no JSON holds, with the class that names it. */
interface Loose {
  readonly name: (typeof LOOSE_CLASSES)[number];
  readonly value: unknown;
}

export const looseValues = (each: { readonly other: string; readonly n: number }): ReadonlyArray<Loose> => {
  const cycle: Record<string, unknown> = { [each.other]: each.n };
  cycle.self = cycle;

  return [
    { name: LOOSE_CLASSES[0], value: () => each.n },
    { name: LOOSE_CLASSES[1], value: Symbol(each.other) },
    { name: LOOSE_CLASSES[2], value: cycle },
    { name: LOOSE_CLASSES[3], value: new Map([[each.other, each.n]]) },
    { name: LOOSE_CLASSES[4], value: [each.n, undefined, each.other] },
  ];
};

// ---- (f) to (k): the frames `decode` reads

/** What frames decode to: the JSON text of a frame, as a record. A law reads a frame through it, never with a bare parse. */
export const parsed = Schema.decodeUnknownSync(Schema.fromJsonString(Schema.Record(Schema.String, Schema.Unknown)));

/** A record, as a frame's `params` is. */
export const recordFrom = Schema.decodeUnknownSync(Schema.Record(Schema.String, Schema.Unknown));

/** The JSON-RPC text of a notification, written by hand, so the laws hold no code of the package. */
export const notification = (
  method: string,
  value: Json,
  extra: Readonly<Record<string, Json>> = {},
  meta?: Json,
): Frame =>
  JSON.stringify({
    jsonrpc: "2.0",
    method,
    params: meta === undefined ? { value } : { value, _meta: meta },
    ...extra,
  });

/** A frame the plan names a class and a reason for. */
interface Refused {
  readonly klass: "f" | "g" | "h" | "i" | "j" | "k";
  readonly name: string;
  readonly frame: Frame;
  readonly reason: FormatError["reason"];
}

/** The classes of frames `decode` refuses, in order. */
export const FRAME_CLASSES = ["f", "g", "h", "i", "j", "k"] as const;

/** A progress value on the wire, and the text of its frame: the frames of class (k) are made from them. */
const WIRE = Progress.make({ done: 1, total: 1 });

const WIRE_FRAME = notification("value", WIRE);

/** The frames `decode(Message)` must refuse: one made for every class, from one drawn run. */
export const refusedFrames = (each: {
  readonly other: string;
  readonly n: number;
  readonly cut: number;
  readonly body: Message;
}): ReadonlyArray<Refused> => {
  const good = notification("value", each.body);
  const cut = 1 + (each.cut % (good.length - 1));

  const refused = (klass: Refused["klass"], name: string, frame: Frame, reason: Refused["reason"]): Refused => ({
    klass,
    name,
    frame,
    reason,
  });

  const wrapped = (...members: ReadonlyArray<readonly [string, Json]>) =>
    JSON.stringify({ jsonrpc: "2.0", method: "value", params: { value: each.body }, ...Object.fromEntries(members) });

  return [
    refused("f", "f: empty", "", "text"),
    refused("f", "f: spaces", "   ", "text"),
    refused("f", "f: a lone brace", "{", "text"),
    refused("f", "f: a word", `~${each.other}`, "text"),
    refused("f", "f: cut off", good.slice(0, cut), "text"),
    refused("f", "f: two JSON texts", `${good}${good}`, "text"),
    refused("f", "f: text after the JSON", `${good} ${each.other}`, "text"),
    refused("g", "g: a batch", `[${good}]`, "message"),
    refused("g", "g: an empty batch", "[]", "message"),
    refused("g", "g: a number", String(each.n), "message"),
    refused("g", "g: null", "null", "message"),
    refused("g", "g: true", "true", "message"),
    refused("g", "g: a string", JSON.stringify(each.other), "message"),
    refused("g", "g: an empty object", "{}", "message"),
    refused("g", "g: no jsonrpc", JSON.stringify({ method: "value", params: { value: each.body } }), "message"),
    refused("g", "g: jsonrpc 1.0", wrapped(["jsonrpc", "1.0"]), "message"),
    refused("g", "g: jsonrpc a number", wrapped(["jsonrpc", 2]), "message"),
    refused("g", "g: a method that is a number", wrapped(["method", each.n]), "message"),
    refused("g", "g: a method that is null", wrapped(["method", null]), "message"),
    refused("g", "g: a method that is an object", wrapped(["method", { value: 1 }]), "message"),
    refused("h", "h: an id that is a number", notification("value", each.body, { id: each.n }), "message"),
    refused("h", "h: an id that is a text", notification("value", each.body, { id: each.other }), "message"),
    refused("h", "h: an id that is null", notification("value", each.body, { id: null }), "message"),
    refused("h", "h: a result", notification("value", each.body, { result: each.n }), "message"),
    refused("h", "h: a result that is null", notification("value", each.body, { result: null }), "message"),
    refused(
      "h",
      "h: an error",
      notification("value", each.body, { error: { code: each.n, message: each.other } }),
      "message",
    ),
    refused("i", "i: no params", JSON.stringify({ jsonrpc: "2.0", method: "value" }), "message"),
    refused("i", "i: params an array", wrapped(["params", [each.body]]), "message"),
    refused("i", "i: params a string", wrapped(["params", each.other]), "message"),
    refused("i", "i: params null", wrapped(["params", null]), "message"),
    refused("i", "i: params empty", wrapped(["params", {}]), "message"),
    refused("i", "i: params with only a _meta", wrapped(["params", { _meta: {} }]), "message"),
    refused("i", "i: params under another name", wrapped(["params", { values: each.body }]), "message"),
    refused("j", "j: challenge", notification("challenge", each.body), "method"),
    refused("j", "j: hello", notification("hello", each.body), "method"),
    refused("j", "j: ping", notification("ping", each.body), "method"),
    refused("j", "j: Value", notification("Value", each.body), "method"),
    refused("j", "j: value with a space", notification("value ", each.body), "method"),
    refused("j", "j: no word at all", notification("", each.body), "method"),
    refused("k", "k: a number", notification("value", each.n), "value"),
    refused(
      "k",
      "k: an unknown tag",
      WIRE_FRAME.replace(JSON.stringify(WIRE._tag), JSON.stringify(each.other)),
      "value",
    ),
    refused("k", "k: a word for a number", notification("value", { ...WIRE, done: each.other }), "value"),
    refused(
      "k",
      "k: a missing field",
      notification("value", Object.fromEntries(Object.entries(WIRE).filter(([key]) => key !== "total"))),
      "value",
    ),
    refused("k", "k: null", notification("value", null), "value"),
  ];
};

// ---- the traces: (l) to (o)

/** A trace to write: a span's ids and flag, and the tracestate it holds. */
export interface WrittenTrace {
  readonly name: string;
  readonly traceId: string;
  readonly spanId: string;
  readonly sampled: boolean;
  readonly state: Option.Option<string>;
}

/** The names of the classes of valid traces (l), in order. */
export const VALID_TRACE_CLASSES = [
  "l: sampled, no tracestate",
  "l: not sampled, no tracestate",
  "l: sampled, a tracestate",
  "l: not sampled, a tracestate",
  "l: a tracestate of 1 character",
  "l: a tracestate of 512 characters",
] as const;

/** What a drawn run holds for a trace. */
interface TraceSeed {
  readonly trace: string;
  readonly span: string;
  readonly state: string;
  readonly short: string;
  /** Up to 64 hex digits, the first one not zero: a trace id's digits, cut to a drawn length. */
  readonly digits: string;
  /** The length of a short trace id, 1 to 31 digits. */
  readonly length: number;
  /** The length of a trace id that is too long, 33 to 64 digits. */
  readonly long: number;
  /** Where in a short trace id a wrong character goes. */
  readonly at: number;
  /** A character that is no lower-case hex digit. */
  readonly mark: string;
  /** A capital hex letter. */
  readonly capital: string;
}

export const traceSeed: Arbitrary.Arbitrary<TraceSeed> = Arbitrary.all({
  trace: hex(32),
  span: hex(16),
  state: Arbitrary.array(word, { minLength: 1, maxLength: 4 }).pipe(
    Arbitrary.map((words) => words.map((each, index) => `v${index}=${each}`).join(",")),
  ),
  short: hex(16),
  digits: hex(64),
  length: between(1, 31),
  long: between(33, 64),
  at: between(0, 30),
  mark: pick(["g", "z", "-", " ", "_", "G", "é", ":"]),
  capital: pick(["A", "B", "C", "D", "E", "F"]),
});

/** A tracestate of `length` printable characters: made of a made-up word, padded with a letter. */
const paddedState = (state: string, length: number): string => `a=${state}`.padEnd(length, "z").slice(0, length);

export const validTraces = (each: TraceSeed): ReadonlyArray<WrittenTrace> => {
  const make = (
    name: (typeof VALID_TRACE_CLASSES)[number],
    sampled: boolean,
    state: Option.Option<string>,
  ): WrittenTrace => ({ name, traceId: each.trace, spanId: each.span, sampled, state });

  return [
    make(VALID_TRACE_CLASSES[0], true, Option.none()),
    make(VALID_TRACE_CLASSES[1], false, Option.none()),
    make(VALID_TRACE_CLASSES[2], true, Option.some(each.state)),
    make(VALID_TRACE_CLASSES[3], false, Option.some(each.state)),
    make(VALID_TRACE_CLASSES[4], true, Option.some("a")),
    make(VALID_TRACE_CLASSES[5], true, Option.some(paddedState(each.state, 512))),
  ];
};

/** The span an `encodeTraced` call is handed for a trace: Effect's own `ExternalSpan`, the tracestate kept in its annotations. */
export const externalSpanFor = (trace: WrittenTrace): Tracer.ExternalSpan =>
  Tracer.externalSpan({
    traceId: trace.traceId,
    spanId: trace.spanId,
    sampled: trace.sampled,
    annotations: Option.match(trace.state, {
      onNone: () => Context.empty(),
      onSome: (state) => Context.make(TraceState, state),
    }),
  });

/** The tracestate a span holds, in its annotations. */
export const stateFrom = (span: Tracer.ExternalSpan): Option.Option<string> =>
  Context.getOption(span.annotations, TraceState);

/** The names of the classes (m) of invalid traceparents in an otherwise valid frame. */
export const BROKEN_TRACE_CLASSES = [
  "m: version 01",
  "m: version ff",
  "m: a fifth part",
  "m: upper-case hex in the trace id",
  "m: upper-case hex in the span id",
  "m: an all-zero trace id",
  "m: an all-zero span id",
  "m: a short trace id",
  "m: a short span id",
  "m: a number in place of the text",
  "m: a _meta that is null",
  "m: a _meta that is a string",
  "m: a _meta that is an array",
] as const;

/** A `_meta` the reader must call no trace, and never an error. */
interface Meta {
  readonly name: string;
  readonly meta: Json;
}

/** The upper-case form of a hex id that differs from it: an id of digits alone gets a capital letter in front. */
const shouted = (id: string): string => (/^[0-9]+$/u.test(id) ? `A${id.slice(1)}` : id.toUpperCase());

/** `_meta` values (m) the reader must call no trace, and never an error. */
export const brokenMetas = (each: TraceSeed): ReadonlyArray<Meta> => {
  const { trace, span } = each;

  return [
    { name: BROKEN_TRACE_CLASSES[0], meta: { traceparent: `01-${trace}-${span}-01` } },
    { name: BROKEN_TRACE_CLASSES[1], meta: { traceparent: `ff-${trace}-${span}-01` } },
    { name: BROKEN_TRACE_CLASSES[2], meta: { traceparent: `00-${trace}-${span}-01-${each.short}` } },
    { name: BROKEN_TRACE_CLASSES[3], meta: { traceparent: `00-${shouted(trace)}-${span}-01` } },
    { name: BROKEN_TRACE_CLASSES[4], meta: { traceparent: `00-${trace}-${shouted(span)}-01` } },
    { name: BROKEN_TRACE_CLASSES[5], meta: { traceparent: `00-${"0".repeat(32)}-${span}-01` } },
    { name: BROKEN_TRACE_CLASSES[6], meta: { traceparent: `00-${trace}-${"0".repeat(16)}-01` } },
    { name: BROKEN_TRACE_CLASSES[7], meta: { traceparent: `00-${trace.slice(1)}-${span}-01` } },
    { name: BROKEN_TRACE_CLASSES[8], meta: { traceparent: `00-${trace}-${span.slice(1)}-01` } },
    { name: BROKEN_TRACE_CLASSES[9], meta: { traceparent: 7 } },
    { name: BROKEN_TRACE_CLASSES[10], meta: null },
    { name: BROKEN_TRACE_CLASSES[11], meta: each.state },
    { name: BROKEN_TRACE_CLASSES[12], meta: [each.trace, each.span] },
  ];
};

/** The names of the classes (n) of a tracestate that must be dropped. */
export const STATE_CLASSES = [
  "n: no traceparent",
  "n: beside a broken traceparent",
  "n: of 513 characters",
  "n: with a control character",
  "n: empty",
] as const;

/** A `_meta` whose tracestate is dropped, and whether a valid traceparent beside it still reads. */
interface Dropped extends Meta {
  readonly kept: boolean;
}

/** `_meta` values (n): the tracestate is dropped, and `kept` says whether a valid traceparent beside it still reads. */
export const droppedStates = (each: TraceSeed): ReadonlyArray<Dropped> => {
  const good = `00-${each.trace}-${each.span}-01`;

  return [
    { name: STATE_CLASSES[0], meta: { tracestate: each.state }, kept: false },
    {
      name: STATE_CLASSES[1],
      meta: { traceparent: `01-${each.trace}-${each.span}-01`, tracestate: each.state },
      kept: false,
    },
    { name: STATE_CLASSES[2], meta: { traceparent: good, tracestate: paddedState(each.state, 513) }, kept: true },
    {
      name: STATE_CLASSES[3],
      meta: { traceparent: good, tracestate: `${each.state}${String.fromCharCode(7)}${each.state}` },
      kept: true,
    },
    { name: STATE_CLASSES[4], meta: { traceparent: good, tracestate: "" }, kept: true },
  ];
};

/** The names of the classes (o) of spans to write that are no W3C ids. */
export const UNWRITABLE_CLASSES = [
  "o: a trace id with a capital letter",
  "o: a span id with a capital letter",
  "o: a trace id with a dash",
  "o: a span id with a dash",
  "o: a span id that is too short",
  "o: a span id that is too long",
  "o: a trace id that is too long",
  "o: an empty trace id",
  "o: an all-zero trace id",
  "o: an all-zero span id",
  "o: ids that are no hex",
  "o: a short trace id with a character that is no hex digit",
  "o: a short trace id with a capital letter",
  "o: a trace id of 33 to 64 digits",
] as const;

/** The digits of a short trace id: a drawn count of 1 to 31 hex digits, the first one not zero. */
const shortDigits = (each: TraceSeed): string => each.digits.slice(0, each.length);

/** The text with one character, at a position that wraps around its length, replaced by another. */
const replacedAt = (text: string, at: number, mark: string): string => {
  const index = at % text.length;

  return `${text.slice(0, index)}${mark}${text.slice(index + 1)}`;
};

/** Spans to write that no reader would accept: the writer writes no trace key for any of them. */
export const unwritableTraces = (each: TraceSeed): ReadonlyArray<WrittenTrace> => {
  const make = (name: (typeof UNWRITABLE_CLASSES)[number], traceId: string, spanId: string): WrittenTrace => ({
    name,
    traceId,
    spanId,
    sampled: true,
    state: Option.some(each.state),
  });

  return [
    make(UNWRITABLE_CLASSES[0], `A${each.trace.slice(1)}`, each.span),
    make(UNWRITABLE_CLASSES[1], each.trace, `B${each.span.slice(1)}`),
    make(UNWRITABLE_CLASSES[2], `${each.trace.slice(0, 15)}-${each.trace.slice(16)}`, each.span),
    make(UNWRITABLE_CLASSES[3], each.trace, `${each.span.slice(0, 7)}-${each.span.slice(8)}`),
    make(UNWRITABLE_CLASSES[4], each.trace, each.span.slice(1)),
    make(UNWRITABLE_CLASSES[5], each.trace, `${each.span}1`),
    make(UNWRITABLE_CLASSES[6], `${each.trace}${each.trace}`, each.span),
    make(UNWRITABLE_CLASSES[7], "", each.span),
    make(UNWRITABLE_CLASSES[8], "0".repeat(32), each.span),
    make(UNWRITABLE_CLASSES[9], each.trace, "0".repeat(16)),
    make(UNWRITABLE_CLASSES[10], "g".repeat(32), "z".repeat(16)),
    make(UNWRITABLE_CLASSES[11], replacedAt(shortDigits(each), each.at, each.mark), each.span),
    make(UNWRITABLE_CLASSES[12], replacedAt(shortDigits(each), each.at, each.capital), each.span),
    make(UNWRITABLE_CLASSES[13], each.digits.slice(0, each.long), each.span),
  ];
};

/** A trace id of a drawn 1 to 31 digits is written padded to 32 with zeros on the left, and reads back so. */
export const shortTrace = (each: TraceSeed): WrittenTrace => ({
  name: "o: a short trace id",
  traceId: shortDigits(each),
  spanId: each.span,
  sampled: true,
  state: Option.none(),
});

/** The names of the classes of a valid span whose tracestate no reader would take, so none is written. */
export const BAD_STATE_CLASSES = [
  "n: written: a tracestate of 513 characters",
  "n: written: a tracestate with a control character",
  "n: written: an empty tracestate",
] as const;

/** Valid spans that hold a tracestate no reader would take: the span crosses, and the tracestate is dropped. */
export const badStateTraces = (each: TraceSeed): ReadonlyArray<WrittenTrace> => {
  const make = (name: (typeof BAD_STATE_CLASSES)[number], state: string): WrittenTrace => ({
    name,
    traceId: each.trace,
    spanId: each.span,
    sampled: true,
    state: Option.some(state),
  });

  return [
    make(BAD_STATE_CLASSES[0], paddedState(each.state, 513)),
    make(BAD_STATE_CLASSES[1], `${each.state}${String.fromCharCode(7)}${each.state}`),
    make(BAD_STATE_CLASSES[2], ""),
  ];
};

/** The `params._meta` of a frame the package wrote: its two trace keys, when it wrote them. */
export const metaFrom = Schema.decodeUnknownSync(
  Schema.fromJsonString(
    Schema.Struct({
      params: Schema.Struct({
        _meta: Schema.optionalKey(
          Schema.Struct({
            traceparent: Schema.optionalKey(Schema.String),
            tracestate: Schema.optionalKey(Schema.String),
          }),
        ),
      }),
    }),
  ),
);

// ---- running a chain

/** The frames a value stream writes, under the format of the run. */
export const framesFrom = (schema: Plain, values: Iterable<Value>) =>
  Stream.fromIterable(values).pipe(Transport.encode(schema), Stream.runCollect);

/** Whether a program ends within a number of scheduler turns: a stalled chain never does, and shows as `Option.none`. */
export const settled = <A, E, R>(
  effect: Effect.Effect<A, E, R>,
  turns = 100_000,
): Effect.Effect<Option.Option<Exit.Exit<A, E>>, never, R> =>
  Effect.gen(function* () {
    const fiber = yield* Effect.forkChild(Effect.exit(effect));

    for (let turn = 0; turn < turns; turn += 1) {
      const polled = fiber.pollUnsafe();

      if (polled !== undefined && Exit.isSuccess(polled)) {
        return Option.some(polled.value);
      }

      yield* Effect.yieldNow;
    }

    yield* Fiber.interrupt(fiber);

    return Option.none();
  });

/**
 * One end of a pair, run to its end: it sends `send` through `chain`, reads what `chain` gives back, and stops when it has sent all
 * and read `expected` values. `react` runs for each value read, so an end can answer one (lockstep, an echo). Nothing is closed
 * until the end has read all it waits for and sent all it has, so a value written is never dropped by an early close.
 */
export const end = <V, A, E, R>(options: {
  readonly socket: Socket.Socket;
  readonly send: Stream.Stream<V>;
  readonly expected: number;
  readonly chain: (values: Stream.Stream<V>) => Stream.Stream<A, E, R>;
  readonly react?: (value: A, index: number) => Effect.Effect<void>;
}): Effect.Effect<ReadonlyArray<A>, E, Exclude<R, Socket.Socket>> =>
  Effect.gen(function* () {
    const done = yield* Deferred.make<void>();
    const received: Array<A> = [];
    let sent = false;

    const settle = Effect.suspend(() =>
      sent && received.length >= options.expected ? Deferred.succeed(done, undefined) : Effect.void,
    );

    const values = options.send.pipe(
      Stream.onEnd(
        Effect.suspend(() => {
          sent = true;

          return settle;
        }),
      ),
    );

    yield* options.chain(values).pipe(
      Stream.interruptWhen(Deferred.await(done)),
      Stream.runForEach((value) =>
        Effect.suspend(() => {
          received.push(value);

          return Effect.andThen(options.react?.(value, received.length - 1) ?? Effect.void, settle);
        }),
      ),
      Effect.provideService(Socket.Socket, options.socket),
    );

    return received;
  });

/** A stream of the values of a queue that ends when `finish` is called. */
export const mailbox = <A>() =>
  Effect.gen(function* () {
    const queue = yield* Queue.unbounded<A, Cause.Done>();

    return {
      stream: Stream.fromQueue(queue),
      send: (value: A): Effect.Effect<void> => Effect.asVoid(Queue.offer(queue, value)),
      finish: Effect.asVoid(Queue.end(queue)),
    };
  });

/** `schema`'s chain: values in, through `encode`, `socket` and `decode`, values out. */
export const through =
  (schema: Plain) =>
  <E, R>(values: Stream.Stream<unknown, E, R>) =>
    values.pipe(Transport.encode(schema), Transport.socket, Transport.decode(schema));

/** The values an end sends: numbered, and told apart by `total`, so a value read at the wrong end shows. */
export const sends = (side: 1 | 2, count: number) =>
  Array.from({ length: count }, (_, index) => progressMessage(index, side));

/** Both ends send at once, each reads what the other sent. */
export const bothWays = (left: ReadonlyArray<unknown>, right: ReadonlyArray<unknown>) =>
  Effect.gen(function* () {
    const [near, far] = yield* MemorySocket.pair;

    return yield* Effect.all(
      [
        end({ socket: near, send: Stream.fromIterable(left), expected: right.length, chain: through(Message) }),
        end({ socket: far, send: Stream.fromIterable(right), expected: left.length, chain: through(Message) }),
      ],
      { concurrency: "unbounded" },
    );
  }).pipe(Effect.scoped);

/**
 * Values sent from the left end of a pair to a right end that sends each one back, through `schema`'s chain: what the left end
 * reads is what it sent. The right end answers each value it reads, so it sends nothing before it has read: a chain that waits
 * to finish sending before it reads stalls (a stalled run is `settled`'s to tell).
 */
export const echoed = (schema: Plain, values: ReadonlyArray<unknown>) =>
  Effect.gen(function* () {
    const [left, right] = yield* MemorySocket.pair;
    const box = yield* mailbox<unknown>();

    if (values.length === 0) {
      yield* box.finish;
    }

    const [got] = yield* Effect.all(
      [
        end({ socket: left, send: Stream.fromIterable(values), expected: values.length, chain: through(schema) }),
        end({
          socket: right,
          send: box.stream,
          expected: values.length,
          chain: through(schema),
          react: (value, index) =>
            Effect.andThen(box.send(value), index + 1 >= values.length ? box.finish : Effect.void),
        }),
      ],
      { concurrency: "unbounded" },
    );

    return got;
  }).pipe(Effect.scoped);

// ---- the line format (F5): a format that is no JSON-RPC

/** The line format's text: the method, a space, and the value as JSON. No part of it is JSON-RPC. */
export const lineFormat: Layer.Layer<Format> = Layer.succeed(
  Format,
  Format.of({
    codecFor: (schema) => Schema.toCodecJson(schema),
    write: ({ method, value }) => Effect.succeed(`${method} ${JSON.stringify(value)}`),
    read: (frame) =>
      Effect.gen(function* () {
        const space = frame.indexOf(" ");

        if (space < 0) {
          return yield* new FormatError({ reason: "message" });
        }

        const value = yield* Schema.decodeUnknownEffect(Schema.fromJsonString(Schema.Unknown))(
          frame.slice(space + 1),
        ).pipe(Effect.mapError(() => new FormatError({ reason: "text" })));

        return { method: frame.slice(0, space), value, trace: Option.none() };
      }),
  }),
);

// ---- what a run saw: a tracer and a logger that keep what they were handed

/** Every span a tracer made, under a tracer that delegates to the one the test runs under. */
export const watching = Effect.gen(function* () {
  const delegate = yield* Tracer.Tracer;
  const spans: Array<Tracer.Span> = [];

  const tracer = Tracer.make({
    span(options) {
      const span = delegate.span(options);
      spans.push(span);

      return span;
    },
  });

  return { spans, tracer };
});

/** Every line a logger was handed, at every level. */
export const recording = () => {
  const lines: Array<string> = [];

  const logger = Logger.make((options) => {
    lines.push(
      [
        options.logLevel,
        ...Arr.ensure(options.message).map((part) => Inspectable.toStringUnknown(part)),
        Inspectable.toStringUnknown(options.cause),
        Inspectable.toStringUnknown(options.fiber.getRef(References.CurrentLogAnnotations)),
      ].join(" "),
    );
  });

  return { lines, layer: Logger.layer([logger]) };
};

/** The text a span holds: its name, its attributes, its events, and how it ended. */
export const spanText = (span: Tracer.Span): string => {
  const { status } = span;

  const ended =
    Predicate.isTagged(status, "Ended") && Exit.isFailure(status.exit)
      ? [
          Cause.pretty(status.exit.cause),
          ...Cause.prettyErrors(status.exit.cause).map((error) => `${error.message}\n${error.stack ?? ""}`),
        ]
      : [];

  return [
    span.name,
    ...[...span.attributes].map(([key, value]) => `${key}=${Inspectable.toStringUnknown(value)}`),
    Inspectable.toStringUnknown(Predicate.hasProperty(span, "events") ? span.events : []),
    ...ended,
  ].join("\n");
};

// ---- a secret that must never show (t)

/** The forms a secret is written in elsewhere: as it is, JSON-escaped, in base64 and base64url, and percent-encoded. */
export const secretForms = (secret: string): ReadonlyArray<string> => {
  const base64 = btoa(String.fromCharCode(...new TextEncoder().encode(secret)));

  return [
    secret,
    JSON.stringify(secret).slice(1, -1),
    base64,
    base64.replace(/\+/gu, "-").replace(/\//gu, "_").replace(/=+$/u, ""),
    encodeURIComponent(secret),
  ];
};

/** Every text a value's own properties reach, names included, cause chains and nested objects too. */
export const reachable = (root: object): ReadonlyArray<string> => {
  const seen = new Set<object>();
  const found: Array<string> = [];
  const pending: Array<object> = [root];

  while (pending.length > 0) {
    const next = pending.pop();

    if (next === undefined || seen.has(next)) {
      continue;
    }

    seen.add(next);

    for (const key of Reflect.ownKeys(next)) {
      found.push(String(key));

      const value: unknown = Object.getOwnPropertyDescriptor(next, key)?.value;

      if (Predicate.isString(value)) {
        found.push(value);
      } else if (Predicate.isObjectOrArray(value)) {
        pending.push(value);
      }
    }
  }

  return found;
};

/** A secret: a word no other part of a run holds, long enough that no form of it is found by chance. */
export const secretFrom = (each: { readonly secret: string; readonly n: number }): string =>
  `zq9${each.secret}${(Math.abs(each.n) % 997).toString(36)}Xk`;

// ---- the hello: the test app, the far end of a connection, the dialing stand-in and the cases the laws of the hello draw (2068)
// Nothing here reads a name of the package at module load, so the older laws that share this file load as before.

/** The test app's nonce: a text that is not empty, branded, so a challenge can be refused for its range. */
const Nonce = Schema.NonEmptyString.pipe(Schema.brand("Nonce"));

/** The test app's challenge. */
export const Challenge = Schema.Struct({ nonce: Nonce });

/** The test app's proof: a key and a signature made from the nonce, so a proof for another nonce fails the app's check. */
export const Proof = Schema.Struct({ key: Schema.String, signature: Schema.String });

/** What the test app answers a hello with: admitted, waiting or refused. */
export const Admitted = Schema.TaggedStruct("admitted", { name: Schema.String });

const Waiting = Schema.TaggedStruct("waiting", { code: Schema.String });

export const Refused = Schema.TaggedStruct("refused", { reason: Schema.String });

export const SignInAnswer = Schema.Union([Admitted, Waiting, Refused]);

export type SignInAnswer = typeof SignInAnswer.Type;

/** The app's own failure while it makes a proof. */
class AppFailure extends Schema.TaggedError<AppFailure, { readonly brand: unique symbol }>()("AppFailure", {
  word: Schema.String,
}) {}

/** A failure of a stage the caller wrote, that must come out of a chain as it went in. */
export class StageError extends Schema.TaggedError<StageError, { readonly brand: unique symbol }>()("StageError", {
  word: Schema.String,
}) {}

/** An app as the laws use it: its two schemas, how it makes a proof from a challenge, and how it checks a proof. */
interface App {
  readonly name: string;
  readonly challenge: Plain;
  readonly proof: Plain;
  readonly make: (challenge: Plain["Type"]) => Effect.Effect<unknown, unknown>;
  readonly valid: (proof: Plain["Type"], challenge: Plain["Type"]) => boolean;
}

const makeApp = <C, P>(options: {
  readonly name: string;
  readonly challenge: Schema.Codec<C, unknown>;
  readonly proof: Schema.Codec<P, unknown>;
  readonly make: (challenge: C) => P;
  readonly valid: (proof: P, challenge: C) => boolean;
}): App => {
  const isChallenge = Schema.is(options.challenge);
  const isProof = Schema.is(options.proof);

  return {
    name: options.name,
    challenge: options.challenge,
    proof: options.proof,
    make: (challenge) =>
      isChallenge(challenge) ? Effect.succeed(options.make(challenge)) : Effect.die("not the app's challenge"),
    valid: (proof, challenge) => isProof(proof) && isChallenge(challenge) && options.valid(proof, challenge),
  };
};

/** The key the test app signs with. */
const KEY = "ed25519:AAAA";

/** The proof the test app makes for a nonce. */
export const signed = (nonce: string): typeof Proof.Type => ({ key: KEY, signature: `${KEY}/${nonce}` });

/** A challenge of the test app. */
export const challengeFrom = (nonce: string): typeof Challenge.Type => Challenge.make({ nonce: Nonce.make(nonce) });

/** The sign-in app of the plan's sketch: a nonce, and a proof made from it. */
export const signInApp: App = makeApp({
  name: "sign-in",
  challenge: Challenge,
  proof: Proof,
  make: ({ nonce }) => signed(nonce),
  valid: (proof, { nonce }) => proof.key === KEY && proof.signature === signed(nonce).signature,
});

/** The same app, whose proof fails with the app's own error. */
const failingApp = (word: string): App => ({
  ...signInApp,
  name: "failing",
  make: () => Effect.fail(new AppFailure({ word })),
});

/** An app whose challenge is a value of one of the classes (a) to (d): the proof holds the challenge as its signature. */
const classApp = (klass: { readonly id: string; readonly name: string; readonly schema: Plain }): App =>
  makeApp({
    name: klass.name,
    challenge: klass.schema,
    proof: Schema.Struct({ key: Schema.String, signature: klass.schema }),
    make: (challenge) => ({ key: KEY, signature: challenge }),
    valid: (proof, challenge) => proof.key === KEY && isDeepStrictEqual(proof.signature, challenge),
  });

/** An app whose proof is any value at all: a proof the hello can fail to write. */
const looseApp: App = makeApp({
  name: "loose",
  challenge: Challenge,
  proof: Schema.Unknown,
  make: () => undefined,
  valid: () => true,
});

// ---- the far end of a connection

/** What a far end saw of one connection. */
interface Seen {
  /** Every frame it read, in order. */
  readonly frames: Array<Frame>;
  /** The challenges it sent. */
  challenges: number;
  /** The close that ended its reading. */
  close: Option.Option<{ readonly code: number; readonly reason: string | undefined }>;
  /** What a program failed with that was no socket's failure: a law of the hello reads this empty. */
  readonly errors: Array<unknown>;
  /** Done when the far end has read to the end of the connection. */
  readonly ended: Deferred.Deferred<void>;
}

export const newSeen = (): Seen => ({
  frames: [],
  challenges: 0,
  close: Option.none(),
  errors: [],
  ended: Deferred.makeUnsafe<void>(),
});

/** The far end's own tools: read one frame, send frames as one batch, close. */
interface Far {
  readonly read: Effect.Effect<Frame, Socket.SocketError>;
  readonly send: (frames: readonly [Frame, ...Array<Frame>]) => Effect.Effect<void, Socket.SocketError>;
  readonly close: (code: number, reason?: string) => Effect.Effect<void, Socket.SocketError>;
}

/** What a far end does on one connection. */
export type Program = (far: Far, seen: Seen) => Effect.Effect<void, unknown, Format>;

const textFrom = (chunk: string | Uint8Array): Frame =>
  Predicate.isString(chunk) ? chunk : new TextDecoder().decode(chunk);

const farEnd = (socket: Socket.Socket, seen: Seen): Effect.Effect<Far, never, Scope.Scope> =>
  Effect.gen(function* () {
    const reader = yield* Effect.orDie(socket.reader);
    const writer = yield* socket.writer;
    const kept: Array<Frame> = [];

    const read = Effect.suspend(() => {
      const first = kept.shift();

      return first === undefined
        ? Effect.map(reader.pull, (chunk) => {
            const [head, ...rest] = Arr.map(chunk, textFrom);
            kept.push(...rest);

            return head;
          })
        : Effect.succeed(first);
    }).pipe(Effect.tap((frame) => Effect.sync(() => seen.frames.push(frame))));

    return {
      read,
      send: (frames) => writer.writeAll(frames),
      close: (code, reason) => writer.write(new Socket.CloseEvent(code, reason)),
    };
  });

const noted = (seen: Seen) => (cause: Cause.Cause<unknown>) =>
  Effect.sync(() => {
    const error = Cause.findErrorOption(cause);

    if (Option.isSome(error) && Socket.isSocketError(error.value)) {
      const closed = error.value;
      seen.close = Option.orElse(seen.close, () => closeFrom(closed));
    } else {
      seen.errors.push(Option.isSome(error) ? error.value : Cause.pretty(cause));
    }
  });

/** Runs a program on the far end of a socket, then reads on until the connection ends, so the close it ended with is seen. */
export const serveFar = (program: Program, socket: Socket.Socket, seen: Seen): Effect.Effect<void, never, Format> =>
  Effect.gen(function* () {
    const far = yield* farEnd(socket, seen);
    yield* program(far, seen).pipe(Effect.catchCause(noted(seen)));
    yield* Effect.forever(far.read).pipe(Effect.catchCause(noted(seen)));
    yield* Deferred.succeed(seen.ended, undefined);
  }).pipe(Effect.scoped);

/** What the far ends of a harness have seen in all. */
export interface World {
  /** How many times the client dialed: reader acquisitions of the stand-in, or sockets a server accepted. */
  acquisitions: number;
  /** One for each connection served, in order. */
  readonly connections: Array<Seen>;
}

/** Where a law of the hello runs: a client socket, a far end to serve it, and a way to fail instead of hanging. */
export interface Harness {
  readonly world: World;
  /** The next connection is served by this program. */
  readonly serve: (program: Program) => Effect.Effect<void>;
  /** The client's socket. */
  readonly client: Layer.Layer<Socket.Socket>;
  /** Runs an effect and fails when it does not end. */
  readonly within: <A, E, R>(effect: Effect.Effect<A, E, R>) => Effect.Effect<A, E | Cause.TimeoutError, R>;
}

/** A far end that does nothing but read to the end of its connection. */
export const idle: Program = () => Effect.void;

/** How many scheduler turns a connection of the hello may take before it counts as stalled: a working one takes a few hundred. */
export const TURNS = 10_000;

/** A run that fails, with a name, when the effect never ends: a scheduler-turn count, no clock. */
export const mustEnd = <A, E, R>(effect: Effect.Effect<A, E, R>): Effect.Effect<A, E, R> =>
  Effect.flatMap(
    settled(effect, TURNS),
    Option.match({
      onNone: () => Effect.sync(() => assert.fail("the run stalled")),
      onSome: (exit) => exit,
    }),
  );

/**
 * A client socket that dials like a real one: each reader acquisition makes a new memory pair, serves its far end with the next
 * program, and counts one dial. The writer writes to the connection of the latest acquisition.
 */
export const dialing: Effect.Effect<Harness & { readonly socket: Socket.Socket }, never, Format> = Effect.gen(
  function* () {
    const format = yield* Format;
    const world: World = { acquisitions: 0, connections: [] };
    const programs: Array<Program> = [];
    let current: Socket.Writer | undefined;

    const socket = Socket.make({
      reader: Effect.gen(function* () {
        world.acquisitions += 1;
        // The far end lives as long as its own connection, never as long as the client's reader: a server does not stop when its client leaves.
        const farScope = yield* Scope.make();
        const [near, far] = yield* MemorySocket.pair.pipe(Scope.provide(farScope));
        const seen = newSeen();
        world.connections.push(seen);
        yield* Effect.forkDetach(
          serveFar(programs.shift() ?? idle, far, seen).pipe(
            Effect.provideService(Format, format),
            Effect.ensuring(Scope.close(farScope, Exit.void)),
          ),
        );
        current = yield* near.writer;

        return yield* near.reader;
      }),
      writer: Effect.succeed({
        write: (chunk) => (current === undefined ? Effect.void : current.write(chunk)),
        writeAll: (chunks) => (current === undefined ? Effect.void : current.writeAll(chunks)),
      }),
    });

    return {
      socket,
      world,
      serve: (program) => Effect.sync(() => void programs.push(program)),
      client: Layer.succeed(Socket.Socket, socket),
      within: mustEnd,
    };
  },
);

// ---- the programs a far end runs

/** The frame of a message. */
const frameFrom = (value: Message) => Effect.map(framesFrom(Message, [value]), (frames) => frames[0] ?? "");

/** The challenge frame the test app's schema accepts, written by hand. */
export const goodChallenge = (nonce: string): Frame => notification("challenge", { nonce });

/** The answer frame of a gateway, written by hand: the versions, the ping in milliseconds and the app's answer. */
export const answerFrame = (version: number, ping: number, answer: Json): Frame =>
  notification("answer", wire("Answer", { version, ping, answer }));

/** A value of the wire written by hand, with a tag of any word: the laws hold no schema of the package for it. */
export const wire = (tag: string, fields: Readonly<Record<string, Json>>): Json =>
  Object.fromEntries([["_tag", tag], ...Object.entries(fields)]);

/** A far end that sends a frame first, and after it reads the hello, sends another. Either is left out with `none`. */
export const scripted =
  (first: Option.Option<Frame>, after: Option.Option<Frame>): Program =>
  (far) =>
    Effect.gen(function* () {
      if (Option.isSome(first)) {
        yield* far.send([first.value]);
      }

      if (Option.isSome(after)) {
        yield* far.read;
        yield* far.send([after.value]);
      }
    });

/** A far end that closes: before it sends anything, or after it sent a valid challenge and read the hello. */
export const closing =
  (
    when: "before the challenge" | "after the hello",
    code: number,
    reason: string | undefined,
    nonce: string,
  ): Program =>
  (far) =>
    Effect.gen(function* () {
      if (when === "after the hello") {
        yield* far.send([goodChallenge(nonce)]);
        yield* far.read;
      }

      yield* far.close(code, reason);
    });

/** The last value a gateway sends when the client's chain ends first: it says every value the client sent was read. */
export const ACK = textMessage("ack");

/** What an honest gateway does for one connection. */
interface Honest {
  readonly app: App;
  readonly challenge: Plain["Type"];
  /** The versions the gateway speaks. */
  readonly versions: ReadonlyArray<number>;
  /** The ping interval in whole milliseconds. */
  readonly ping: number;
  /** What it answers when the proof is right. */
  readonly answer: SignInAnswer;
  /** The values sent in the same batch as the answer. */
  readonly batch: ReadonlyArray<Message>;
  /** The values sent after, one write each. */
  readonly later: ReadonlyArray<Message>;
  /** How many values it reads from the client before it closes, when it closes first. */
  readonly reads: number;
  readonly closes: "never" | "after reading";
}

/** The gateway of the test app, built from the package's own `challenge`, `accept` and `answer`. */
export const honest =
  (each: Honest): Program =>
  (far, seen) =>
    Effect.gen(function* () {
      yield* far.send([yield* Transport.challenge(each.app.challenge)(each.challenge)]);
      seen.challenges += 1;

      const hello = yield* Transport.accept({ versions: each.versions, hello: each.app.proof })(yield* far.read);

      const reply: SignInAnswer = each.app.valid(hello.proof, each.challenge)
        ? each.answer
        : Refused.make({ reason: "the proof is wrong" });

      const answered = yield* Transport.answer(SignInAnswer)({
        version: hello.version,
        ping: Duration.millis(each.ping),
        answer: reply,
      });

      const batch = yield* Effect.forEach(each.batch, (value) => frameFrom(value), { concurrency: 1 });
      yield* far.send([answered, ...batch]);

      for (const value of each.later) {
        yield* far.send([yield* frameFrom(value)]);
      }

      // It reads what the client sends, then closes, or sends one last value so the client knows all of it arrived: a chain that
      // ended on the last value it read could end before its own last write.
      yield* Effect.forEach(Array.from({ length: each.reads }), () => far.read, { discard: true, concurrency: 1 });

      if (each.closes === "after reading") {
        yield* far.close(1000);
      } else {
        yield* far.send([yield* frameFrom(ACK)]);
      }
    });

/** The messages a far end read after the hello, as the values they carry. */
const readBy = (seen: Seen) =>
  Stream.fromIterable(seen.frames.slice(1)).pipe(Transport.decode(Message), Stream.runCollect);

// ---- (a) to (z): what one drawn run holds, and the classes made from it

/** What a drawn run holds for the hello: the made-up parts every class is built from. */
interface HelloDraw {
  readonly seeds: ReadonlyArray<Seed>;
  readonly text: string;
  readonly nonce: string;
  /** Six different whole numbers of 1 or more: the versions the lists are made from. */
  readonly pool: ReadonlyArray<number>;
  readonly features: ReadonlyArray<string>;
  /** The gateway's ping, in whole milliseconds, 1 to 600000. */
  readonly ping: number;
  readonly batch: ReadonlyArray<Message>;
  readonly later: ReadonlyArray<Message>;
  readonly sent: ReadonlyArray<Message>;
  readonly code: number;
  readonly reason: string;
  readonly left: ReadonlyArray<number>;
  readonly right: ReadonlyArray<number>;
}

export const helloDraw: Arbitrary.Arbitrary<HelloDraw> = Arbitrary.all({
  seeds: Arbitrary.array(seed, { minLength: 1, maxLength: 2 }),
  text: awkwardText,
  nonce: word,
  // A number made from n and its place is never another place's: the six are different.
  pool: Arbitrary.array(between(1, 40), { minLength: 6, maxLength: 6 }).pipe(
    Arbitrary.map((numbers) => numbers.map((n, index) => n * 6 + index)),
  ),
  features: Arbitrary.array(word, { maxLength: 4 }),
  ping: between(1, 600_000),
  batch: Arbitrary.array(message, { minLength: 1, maxLength: 10 }),
  later: Arbitrary.array(message, { maxLength: 10 }),
  sent: Arbitrary.array(message, { maxLength: 20 }),
  code: between(4000, 4999),
  reason: word,
  left: Arbitrary.array(between(-5, 60), { maxLength: 6 }),
  right: Arbitrary.array(between(-5, 60), { maxLength: 6 }),
});

// ---- (n) and (o): the lists of versions

/** Two lists of versions, and the version the pick must give, when they share one. */
interface Lists {
  readonly id: "n" | "o";
  readonly name: string;
  readonly client: ReadonlyArray<number>;
  readonly gateway: ReadonlyArray<number>;
  readonly picked: Option.Option<number>;
}

/** The names of the classes (n) and (o), in order. */
export const LIST_CLASSES = [
  "n: one shared",
  "n: several shared, the highest wins",
  "n: unordered",
  "n: with repeats",
  "n: the gateway's highest is missing from the client's",
  "o: disjoint",
  "o: the client's list is empty",
  "o: the gateway's list is empty",
] as const;

export const versionLists = (pool: ReadonlyArray<number>): ReadonlyArray<Lists> => {
  const [p0 = 1, p1 = 2, p2 = 3, p3 = 4] = pool;
  const top = Math.max(...pool) + 1;

  const make = (
    id: Lists["id"],
    name: (typeof LIST_CLASSES)[number],
    client: ReadonlyArray<number>,
    gateway: ReadonlyArray<number>,
    picked: number | undefined,
  ): Lists => ({ id, name, client, gateway, picked: Option.fromNullishOr(picked) });

  return [
    make("n", LIST_CLASSES[0], [p0, p1], [p0, p2], p0),
    make("n", LIST_CLASSES[1], [p0, p1, p2], [p2, p0, p3], Math.max(p0, p2)),
    make("n", LIST_CLASSES[2], [p2, p0, p1], [p1, p3, p0], Math.max(p0, p1)),
    make("n", LIST_CLASSES[3], [p0, p0, p1, p1], [p1, p1, p2, p0], Math.max(p0, p1)),
    make("n", LIST_CLASSES[4], [p0, p1], [p0, top], p0),
    make("o", LIST_CLASSES[5], [p0, p1], [p2, p3], undefined),
    make("o", LIST_CLASSES[6], [], [p0, p1], undefined),
    make("o", LIST_CLASSES[7], [p0, p1], [], undefined),
  ];
};

// ---- the cases of a connection that succeeds: (m), (n), (r), (k), (t)

/** The three answers (m) the test app gives, each holding the drawn awkward text. */
export const answersFrom = (text: string): ReadonlyArray<SignInAnswer> => [
  Admitted.make({ name: text }),
  Waiting.make({ code: text }),
  Refused.make({ reason: text }),
];

/** One connection that succeeds, and what must come of it. */
export interface ConnectionCase {
  readonly name: string;
  readonly app: App;
  readonly challenge: Plain["Type"];
  readonly client: { readonly versions: ReadonlyArray<number>; readonly features: ReadonlyArray<string> };
  readonly gateway: Pick<Honest, "versions" | "ping" | "answer">;
  /** The version the pick gives. */
  readonly picked: number;
  readonly batch: ReadonlyArray<Message>;
  readonly later: ReadonlyArray<Message>;
  readonly sent: ReadonlyArray<Message>;
  /** Which end's chain ends first. */
  readonly first: "client" | "gateway";
}

/**
 * The connections a drawn run makes: one for each of the 14 values of (r), the sign-in app and the 13 classes (a) to (d), each with
 * one of the three answers (m), one of the lists (n) that share, a batch of values (k) and the values (t) each end sends.
 */
export const connectionCases = (draw: HelloDraw): ReadonlyArray<ConnectionCase> => {
  const sharing = versionLists(draw.pool).filter(({ id }) => id === "n");
  const answers = answersFrom(draw.text);

  const challenges: ReadonlyArray<{ readonly app: App; readonly challenge: Plain["Type"]; readonly name: string }> = [
    {
      app: signInApp,
      challenge: challengeFrom(`${draw.nonce}${draw.text}`),
      name: "r: the sign-in app with an awkward nonce",
    },
    ...valueClasses(draw.seeds).flatMap((klass) =>
      klass.values.map((challenge) => ({ app: classApp(klass), challenge, name: `r: ${klass.name}` })),
    ),
  ];

  return challenges.map(({ app, challenge, name }, index) => {
    const lists = Arr.getUnsafe(sharing, index % sharing.length);
    const answer = Arr.getUnsafe(answers, index % answers.length);

    return {
      name: `${name}, ${lists.name}, ${answer._tag}`,
      app,
      challenge,
      client: { versions: lists.client, features: draw.features },
      gateway: { versions: lists.gateway, ping: draw.ping, answer },
      picked: Option.getOrThrow(lists.picked),
      batch: draw.batch,
      later: draw.later,
      sent: draw.sent,
      first: index % 2 === 0 ? "client" : "gateway",
    };
  });
};

/** What one connection came to. */
interface CaseOutcome {
  readonly version: number;
  readonly ping: Duration.Duration;
  readonly answer: unknown;
  /** What `make` was called with, in order. */
  readonly made: ReadonlyArray<unknown>;
  /** The values the client's chain read. */
  readonly read: ReadonlyArray<Message>;
  /** The values the gateway read after the hello. */
  readonly gatewayRead: ReadonlyArray<Message>;
  /** The far end's view of the connection, once it ended. */
  readonly seen: Seen;
  /** How many times the client dialed, and how many connections were served, for this connection alone. */
  readonly dials: number;
  readonly served: number;
}

/** Runs one connection of a case on a harness, with a chain on the socket `connect` gave, and waits for the far end to end. */
export const runCase = (harness: Harness, each: ConnectionCase) =>
  Effect.gen(function* () {
    const before = { dials: harness.world.acquisitions, served: harness.world.connections.length };

    yield* harness.serve(
      honest({
        app: each.app,
        challenge: each.challenge,
        versions: each.gateway.versions,
        ping: each.gateway.ping,
        answer: each.gateway.answer,
        batch: each.batch,
        later: each.later,
        reads: each.sent.length,
        closes: each.first === "gateway" ? "after reading" : "never",
      }),
    );

    const made: Array<unknown> = [];

    const run = yield* harness.within(
      Effect.gen(function* () {
        const connected = yield* Transport.connect({
          versions: each.client.versions,
          features: each.client.features,
          challenge: each.app.challenge,
          hello: {
            schema: each.app.proof,
            make: (challenge: Plain["Type"]) => {
              made.push(challenge);

              return each.app.make(challenge);
            },
          },
          answer: SignInAnswer,
        });

        const read = yield* end({
          socket: connected.socket,
          send: Stream.fromIterable(each.sent),
          // The client's chain ends on the last value of the gateway, or, when the gateway closes first, on its close.
          expected: each.first === "client" ? each.batch.length + each.later.length + 1 : Number.MAX_SAFE_INTEGER,
          chain: through(Message),
        });

        return { connected, read };
      }).pipe(Effect.scoped, Effect.provide(harness.client)),
    );

    const seen = harness.world.connections[before.served];

    if (seen === undefined) {
      return assert.fail(`${each.name}: no connection was served`);
    }

    yield* harness.within(Deferred.await(seen.ended));

    const gatewayRead = yield* readBy(seen);

    const outcome: CaseOutcome = {
      version: run.connected.version,
      ping: run.connected.ping,
      answer: run.connected.answer,
      made,
      read: Schema.decodeUnknownSync(Schema.Array(Message))(run.read).slice(0, each.batch.length + each.later.length),
      gatewayRead,
      seen,
      dials: harness.world.acquisitions - before.dials,
      served: harness.world.connections.length - before.served,
    };

    return outcome;
  });

// ---- the connections that do not succeed: (a) to (j)

/** What a failed `connect` must come to. */
type Expected =
  | { readonly kind: "format"; readonly reason: FormatError["reason"] }
  | { readonly kind: "noShared"; readonly client: ReadonlyArray<number>; readonly gateway: ReadonlyArray<number> }
  | { readonly kind: "app"; readonly error: AppFailure };

/** One connection that fails, and how. */
interface Handshake {
  readonly id: string;
  readonly name: string;
  readonly app: App;
  readonly client: { readonly versions: ReadonlyArray<number>; readonly features: ReadonlyArray<string> };
  readonly program: Program;
  readonly expected: Expected;
  /** The steps of `connect` that are reached, in order. */
  readonly steps: ReadonlyArray<"challenge" | "hello" | "answer">;
  /** Whether the far end reads a hello frame. */
  readonly hello: boolean;
  /** The close `connect` writes when it fails: 1000, or a refusal of Transport's own, which is a code of 4000 to 4999. */
  readonly close: 1000 | "refused";
}

const STEPS = ["challenge", "hello", "answer"] as const;

/** The codes a refusal of Transport's own may close with: the range a browser lets a client use for its own. */
export const REFUSED = { low: 4000, high: 4999 } as const;

/** The names of the classes of `handshakes`, in order. */
export const HANDSHAKE_CLASSES = [
  "a: no JSON",
  "a: a batch",
  "a: a notification with an id",
  "b: a value notification",
  "b: a hello notification",
  "b: an answer notification",
  "b: a notification of the method Challenge",
  "c: a nonce of the wrong type",
  "c: no nonce",
  "c: an empty nonce, out of the branded range",
  "d: the app's make fails",
  "g: an answer that is no JSON",
  "g: an answer that is a batch",
  "g: an answer that is a notification with an id",
  "g: an answer of the method value",
  "g: an answer of the method challenge",
  "g: an answer of the method Answer",
  "h: the app's answer is refused by its schema",
  "h: a ping of 0",
  "h: a ping of -1",
  "h: a ping of 1.5",
  "h: a ping that is a text",
  "h: no ping",
  "h: a version of 0",
  "h: no version",
  "h: an unknown tag",
  "i: the gateway's NoSharedVersion reply",
  "j: an answer naming a version the client did not list",
] as const;

/** The connections that fail, one for each class: each is a far end that sends the frames of its class, and what `connect` must come to. */
export const handshakes = (draw: HelloDraw): ReadonlyArray<Handshake> => {
  const [p0 = 1, p1 = 2] = draw.pool;
  const client = { versions: [p0, p1], features: draw.features };
  const good = goodChallenge(draw.nonce);
  const admitted = Admitted.make({ name: draw.text });
  const valid = answerFrame(p0, draw.ping, admitted);

  // An answer value with one thing wrong: a field changed, or taken out with `undefined`, or another tag.
  const answerValue = (changes: Readonly<Record<string, Json | undefined>>, tag = "Answer") => {
    const value: Record<string, Json | undefined> = {
      version: p0,
      ping: draw.ping,
      answer: admitted,
      ...changes,
    };

    return notification(
      "answer",
      wire(
        tag,
        Object.fromEntries(Object.entries(value).filter((entry): entry is [string, Json] => entry[1] !== undefined)),
      ),
    );
  };

  // The far end sends this frame first and nothing more: no hello is read.
  const first = (id: string, name: (typeof HANDSHAKE_CLASSES)[number], frame: Frame, reason: FormatError["reason"]) =>
    ({
      id,
      name,
      app: signInApp,
      client,
      program: scripted(Option.some(frame), Option.none()),
      expected: { kind: "format", reason },
      steps: STEPS.slice(0, 1),
      hello: false,
      close: "refused",
    }) satisfies Handshake;

  // The far end sends a good challenge, reads the hello, and answers with this frame.
  const answered = (
    id: string,
    name: (typeof HANDSHAKE_CLASSES)[number],
    frame: Frame,
    expected: Expected,
  ): Handshake => ({
    id,
    name,
    app: signInApp,
    client,
    program: scripted(Option.some(good), Option.some(frame)),
    expected,
    steps: STEPS,
    hello: true,
    close: "refused",
  });

  const refused = (id: string, name: (typeof HANDSHAKE_CLASSES)[number], frame: Frame) =>
    answered(id, name, frame, { kind: "format", reason: "value" });

  const unlisted = Math.max(...draw.pool) + 1;

  return [
    first("a", HANDSHAKE_CLASSES[0], `~${draw.nonce}`, "text"),
    first("a", HANDSHAKE_CLASSES[1], `[${good}]`, "message"),
    first("a", HANDSHAKE_CLASSES[2], notification("challenge", { nonce: draw.nonce }, { id: 1 }), "message"),
    first("b", HANDSHAKE_CLASSES[3], notification("value", { nonce: draw.nonce }), "method"),
    first("b", HANDSHAKE_CLASSES[4], notification("hello", { nonce: draw.nonce }), "method"),
    first("b", HANDSHAKE_CLASSES[5], notification("answer", { nonce: draw.nonce }), "method"),
    first("b", HANDSHAKE_CLASSES[6], notification("Challenge", { nonce: draw.nonce }), "method"),
    first("c", HANDSHAKE_CLASSES[7], notification("challenge", { nonce: 7 }), "value"),
    first("c", HANDSHAKE_CLASSES[8], notification("challenge", {}), "value"),
    first("c", HANDSHAKE_CLASSES[9], notification("challenge", { nonce: "" }), "value"),
    {
      id: "d",
      name: HANDSHAKE_CLASSES[10],
      app: failingApp(draw.reason),
      client,
      program: scripted(Option.some(good), Option.none()),
      expected: { kind: "app", error: new AppFailure({ word: draw.reason }) },
      steps: STEPS.slice(0, 2),
      hello: false,
      close: 1000,
    },
    answered("g", HANDSHAKE_CLASSES[11], `~${draw.nonce}`, { kind: "format", reason: "text" }),
    answered("g", HANDSHAKE_CLASSES[12], `[${valid}]`, { kind: "format", reason: "message" }),
    answered("g", HANDSHAKE_CLASSES[13], notification("answer", wire("Answer", {}), { id: 1 }), {
      kind: "format",
      reason: "message",
    }),
    answered(
      "g",
      HANDSHAKE_CLASSES[14],
      notification("value", wire("Answer", { version: p0, ping: draw.ping, answer: admitted })),
      {
        kind: "format",
        reason: "method",
      },
    ),
    answered(
      "g",
      HANDSHAKE_CLASSES[15],
      notification("challenge", wire("Answer", { version: p0, ping: draw.ping, answer: admitted })),
      {
        kind: "format",
        reason: "method",
      },
    ),
    answered(
      "g",
      HANDSHAKE_CLASSES[16],
      notification("Answer", wire("Answer", { version: p0, ping: draw.ping, answer: admitted })),
      {
        kind: "format",
        reason: "method",
      },
    ),
    refused("h", HANDSHAKE_CLASSES[17], answerValue({ answer: wire("admitted", {}) })),
    refused("h", HANDSHAKE_CLASSES[18], answerValue({ ping: 0 })),
    refused("h", HANDSHAKE_CLASSES[19], answerValue({ ping: -1 })),
    refused("h", HANDSHAKE_CLASSES[20], answerValue({ ping: 1.5 })),
    refused("h", HANDSHAKE_CLASSES[21], answerValue({ ping: String(draw.ping) })),
    refused("h", HANDSHAKE_CLASSES[22], answerValue({ ping: undefined })),
    refused("h", HANDSHAKE_CLASSES[23], answerValue({ version: 0 })),
    refused("h", HANDSHAKE_CLASSES[24], answerValue({ version: undefined })),
    refused("h", HANDSHAKE_CLASSES[25], answerValue({}, draw.nonce)),
    answered(
      "i",
      HANDSHAKE_CLASSES[26],
      notification("answer", wire("NoSharedVersion", { client: draw.left, gateway: draw.right })),
      { kind: "noShared", client: draw.left, gateway: draw.right },
    ),
    answered("j", HANDSHAKE_CLASSES[27], answerValue({ version: unlisted }), {
      kind: "noShared",
      client: client.versions,
      gateway: [unlisted],
    }),
  ];
};

/** One `connect` that was tried on a stand-in, read while the caller's scope was still open. */
interface Attempt {
  /** How it ended, none when it stalled. */
  readonly exit: Option.Option<Exit.Exit<unknown, unknown>>;
  /** What `make` was called with, in order. */
  readonly made: ReadonlyArray<unknown>;
  readonly seen: Seen;
  /** Whether the far end had read to the end of the connection before the caller's scope ended. */
  readonly closedEarly: boolean;
  readonly dials: number;
}

/** Tries `connect` against a far end program on a dialing stand-in, and gives what the far end saw while the scope was still open. */
export const attempt = (each: {
  readonly app: App;
  readonly client: { readonly versions: ReadonlyArray<number>; readonly features: ReadonlyArray<string> };
  readonly program: Program;
}) =>
  Effect.gen(function* () {
    const standIn = yield* dialing;
    yield* standIn.serve(each.program);
    const made: Array<unknown> = [];
    const scope = yield* Scope.make();

    const exit = yield* settled(
      Transport.connect({
        versions: each.client.versions,
        features: each.client.features,
        challenge: each.app.challenge,
        hello: {
          schema: each.app.proof,
          make: (challenge: Plain["Type"]) => {
            made.push(challenge);

            return each.app.make(challenge);
          },
        },
        answer: SignInAnswer,
      }).pipe(Effect.provideService(Socket.Socket, standIn.socket), Scope.provide(scope)),
      TURNS,
    );

    const seen = standIn.world.connections[0];

    if (seen === undefined) {
      return assert.fail("no connection was served");
    }

    const ended = yield* settled(Deferred.await(seen.ended), TURNS);
    yield* Scope.close(scope, Exit.void);

    const result: Attempt = {
      exit,
      made,
      seen,
      closedEarly: Option.isSome(ended),
      dials: standIn.world.acquisitions,
    };

    return result;
  });

/** What `connect` came to over a socket whose reader fails with a `SocketError` of its own, and what it was given to write. */
interface ReaderFailure {
  /** How `connect` ended, none when it stalled. */
  readonly exit: Option.Option<Exit.Exit<unknown, unknown>>;
  /** The codes of the closes written to the socket, in order. */
  readonly closes: ReadonlyArray<number>;
  /** How many frames of text were written to it. */
  readonly frames: number;
}

/**
 * Runs `connect` over a socket that is no memory pair: it gives the gateway's challenge when asked to, then its reader fails with a
 * `SocketReadError`, before the challenge or after the hello was written. It keeps what it was given to write.
 */
export const readerFailure = (when: "before the challenge" | "after the hello", nonce: string) =>
  Effect.gen(function* () {
    const written: Array<string | Uint8Array | Socket.CloseEvent> = [];
    let pulls = 0;

    const socket = Socket.make({
      reader: Effect.succeed({
        pull: Effect.suspend(() => {
          pulls += 1;

          return when === "after the hello" && pulls === 1
            ? Effect.succeed([goodChallenge(nonce)])
            : Effect.fail(new Socket.SocketError({ reason: new Socket.SocketReadError({ cause: "the line broke" }) }));
        }),
        upgrade: Socket.SocketUpgradeError.unsupported,
      }),
      writer: Effect.succeed({
        write: (chunk) =>
          Effect.sync(() => {
            written.push(chunk);
          }),
        writeAll: (chunks) =>
          Effect.sync(() => {
            written.push(...chunks);
          }),
      }),
    });

    const scope = yield* Scope.make();

    const exit = yield* settled(
      Transport.connect({
        versions: [1],
        features: [],
        challenge: signInApp.challenge,
        hello: { schema: signInApp.proof, make: (challenge: Plain["Type"]) => signInApp.make(challenge) },
        answer: SignInAnswer,
      }).pipe(Effect.provideService(Socket.Socket, socket), Scope.provide(scope)),
      TURNS,
    );

    yield* Scope.close(scope, Exit.void);

    const result: ReaderFailure = {
      exit,
      closes: written.filter(Socket.isCloseEvent).map(({ code }) => code),
      frames: written.filter(Predicate.isString).length,
    };

    return result;
  });

/** Checks what a failed `connect` came to: the error, no defect, and what the far end saw. */
export const checkFailed = (each: Handshake, run: Attempt) => {
  const exit = Option.getOrElse(run.exit, () => assert.fail(`${each.name}: connect stalled`));
  const { error, defect } = failureFrom(exit);
  expect(defect, `${each.name}: never a defect`).toBe(false);

  const expected = each.expected;

  switch (expected.kind) {
    case "format":
      expect(
        Option.map(error, (value) => (Schema.is(FormatError)(value) ? value.reason : value)),
        `${each.name}: the frame is refused`,
      ).toEqual(Option.some(expected.reason));
      break;
    case "noShared":
      expect(
        Option.map(error, (value) =>
          Schema.is(NoSharedVersion)(value) ? { client: value.client, gateway: value.gateway } : value,
        ),
        `${each.name}: no version is shared`,
      ).toEqual(Option.some({ client: expected.client, gateway: expected.gateway }));
      break;
    case "app":
      assert.deepStrictEqual(Option.getOrUndefined(error), expected.error, `${each.name}: the app's own error`);
      break;
  }

  expect(run.made.length, `${each.name}: make is called once for each step past the challenge`).toBe(
    each.steps.includes("hello") ? 1 : 0,
  );
  expect(run.seen.errors, `${each.name}: the far end failed on nothing of its own`).toEqual([]);
  expect(run.seen.frames.length, `${each.name}: the far end reads a hello frame only when one was sent`).toBe(
    each.hello ? 1 : 0,
  );
  expect(run.closedEarly, `${each.name}: the connection is closed before the caller's scope ends`).toBe(true);
  expect(
    Option.map(run.seen.close, ({ code }) => (code >= REFUSED.low && code <= REFUSED.high ? "refused" : code)),
    `${each.name}: the close code`,
  ).toEqual(Option.some(each.close));
};

// ---- (e) and (f): the hello the client cannot write

/** The names of the classes (e) of client versions, in order. */
export const VERSION_CLASSES = ["e: 0", "e: -1", "e: 1.5", "e: NaN", "e: Infinity"] as const;

/** The names of the classes (f) of proofs the hello schema cannot write, in order. */
export const PROOF_CLASSES = LOOSE_CLASSES.map((name) => name.replace("e:", "f:"));

/** Connections whose hello cannot be written: `connect` fails with a `FormatError` of `value`, and the hello is never sent. */
export const unwritableHellos = (draw: HelloDraw): ReadonlyArray<Handshake> => {
  const [p0 = 1] = draw.pool;
  const good = Option.some(goodChallenge(draw.nonce));

  const base = {
    program: scripted(good, Option.none()),
    expected: { kind: "format", reason: "value" },
    steps: STEPS.slice(0, 2),
    hello: false,
    close: "refused",
  } as const;

  const versions = [0, -1, 1.5, Number.NaN, Number.POSITIVE_INFINITY].map((bad, index): Handshake => ({
    ...base,
    id: "e",
    name: VERSION_CLASSES[index] ?? "e",
    app: signInApp,
    client: { versions: [p0, bad], features: draw.features },
  }));

  const proofs = looseValues({ other: draw.nonce, n: draw.ping }).map(({ value }, index): Handshake => ({
    ...base,
    id: "f",
    name: PROOF_CLASSES[index] ?? "f",
    app: { ...looseApp, make: () => Effect.succeed(value) },
    client: { versions: [p0], features: draw.features },
  }));

  return [...versions, ...proofs];
};

// ---- (p) to (r): the hellos a gateway reads

/** A hello frame, and why `accept` refuses it. */
interface HelloFrame {
  readonly id: "p" | "q";
  readonly name: string;
  readonly frame: Frame;
  readonly reason: FormatError["reason"];
}

/** The names of the classes (p) and (q), in order. */
export const HELLO_CLASSES = [
  "p: no JSON",
  "p: a batch",
  "p: a notification with an id",
  "p: the method value",
  "p: the method challenge",
  "p: the method answer",
  "p: the method Hello",
  "q: no versions",
  "q: versions that is no array",
  "q: a version of 0",
  "q: a version of 1.5",
  "q: a version that is a text",
  "q: features that hold a number",
  "q: has in place of features",
  "q: a proof the app's schema refuses",
  "q: no proof",
] as const;

/** The value of a hello that fits, with a proof of the test app. */
export const helloValue = (draw: HelloDraw, changes: Readonly<Record<string, Json | undefined>> = {}) => {
  const [p0 = 1] = draw.pool;

  const value: Record<string, Json | undefined> = {
    versions: [p0],
    features: draw.features,
    proof: signed(draw.nonce),
    ...changes,
  };

  return Object.fromEntries(Object.entries(value).filter((entry): entry is [string, Json] => entry[1] !== undefined));
};

export const hellos = (draw: HelloDraw): ReadonlyArray<HelloFrame> => {
  const good = notification("hello", helloValue(draw));

  const make = (
    id: HelloFrame["id"],
    name: (typeof HELLO_CLASSES)[number],
    frame: Frame,
    reason: HelloFrame["reason"],
  ) => ({
    id,
    name,
    frame,
    reason,
  });

  const value = (name: (typeof HELLO_CLASSES)[number], changes: Readonly<Record<string, Json | undefined>>) =>
    make("q", name, notification("hello", helloValue(draw, changes)), "value");

  const { features: _features, ...withoutFeatures } = helloValue(draw);

  return [
    make("p", HELLO_CLASSES[0], `~${draw.nonce}`, "text"),
    make("p", HELLO_CLASSES[1], `[${good}]`, "message"),
    make("p", HELLO_CLASSES[2], notification("hello", helloValue(draw), { id: 2 }), "message"),
    make("p", HELLO_CLASSES[3], notification("value", helloValue(draw)), "method"),
    make("p", HELLO_CLASSES[4], notification("challenge", helloValue(draw)), "method"),
    make("p", HELLO_CLASSES[5], notification("answer", helloValue(draw)), "method"),
    make("p", HELLO_CLASSES[6], notification("Hello", helloValue(draw)), "method"),
    value(HELLO_CLASSES[7], { versions: undefined }),
    value(HELLO_CLASSES[8], { versions: draw.nonce }),
    value(HELLO_CLASSES[9], { versions: [0] }),
    value(HELLO_CLASSES[10], { versions: [1.5] }),
    value(HELLO_CLASSES[11], { versions: ["1"] }),
    value(HELLO_CLASSES[12], { features: [draw.ping] }),
    make("q", HELLO_CLASSES[13], notification("hello", { ...withoutFeatures, has: draw.features }), "value"),
    value(HELLO_CLASSES[14], { proof: { key: draw.ping } }),
    value(HELLO_CLASSES[15], { proof: undefined }),
  ];
};

// ---- (s): the pings a gateway cannot write

/** The names of the classes (s) of pings, in order. */
export const PING_CLASSES = ["s: zero", "s: a negative", "s: infinity", "s: a fraction of a millisecond"] as const;

export const unwritablePings = (
  draw: HelloDraw,
): ReadonlyArray<{ readonly name: string; readonly ping: Duration.Duration }> => [
  { name: PING_CLASSES[0], ping: Duration.zero },
  { name: PING_CLASSES[1], ping: Duration.millis(-(draw.ping + 1)) },
  { name: PING_CLASSES[2], ping: Duration.infinity },
  { name: PING_CLASSES[3], ping: Duration.micros(BigInt(draw.ping) * 1000n + 500n) },
];

/** The notification a frame holds, as the keys of its method, its value and its params. */
export const holds = Schema.decodeUnknownSync(
  Schema.fromJsonString(
    Schema.Struct({
      method: Schema.String,
      params: Schema.Struct({ value: Schema.Record(Schema.String, Schema.Unknown) }),
    }),
  ),
);

/** The value of a frame of one of the hello's methods, written by the package, as plain data. */
export const valueFrom = Schema.decodeUnknownSync(
  Schema.fromJsonString(Schema.Struct({ method: Schema.String, params: Schema.Struct({ value: Schema.Json }) })),
);

// ---- what a connection that succeeded must show: the assertions of H1, H6 and O1, shared with the real socket's W2

const isSignInAnswer = Schema.is(SignInAnswer);

const sameSignInAnswer = Schema.toEquivalence(SignInAnswer);

// Building an equivalence is the slow part of a check, so each schema's is built once.
const equivalences = new Map<Plain, (left: Plain["Type"], right: Plain["Type"]) => boolean>();

const equivalenceFor = (schema: Plain) => {
  const known = equivalences.get(schema);

  if (known !== undefined) {
    return known;
  }

  const made = Schema.toEquivalence(schema);
  equivalences.set(schema, made);

  return made;
};

/** H1: the answer comes back whole, with the version the pick gives, the ping, and a `make` called once with the challenge sent. */
export const checkWhole = (each: ConnectionCase, out: CaseOutcome) => {
  expect(out.version, `${each.name}: the highest version in both lists`).toBe(each.picked);
  expect(Duration.toMillis(out.ping), `${each.name}: the gateway's ping`).toBe(each.gateway.ping);
  expect(
    isSignInAnswer(out.answer) && sameSignInAnswer(out.answer, each.gateway.answer),
    `${each.name}: the app's answer, whole`,
  ).toBe(true);
  expect(out.made.length, `${each.name}: make is called once`).toBe(1);
  expect(
    equivalenceFor(each.app.challenge)(out.made[0], each.challenge),
    `${each.name}: with the challenge the gateway sent`,
  ).toBe(true);
  expect(out.seen.errors, `${each.name}: the gateway failed on nothing of its own`).toEqual([]);
};

/** H6: the chain reads the frames of the answer's batch first, then the later ones, none lost and none twice, and the gateway reads what the client sent. */
export const checkOrder = (each: ConnectionCase, out: CaseOutcome) => {
  assert.deepStrictEqual(out.read, [...each.batch, ...each.later], `${each.name}: the values the chain read, in order`);
  assert.deepStrictEqual(
    out.gatewayRead,
    [...each.sent].slice(0, out.gatewayRead.length),
    `${each.name}: what the gateway read, in order`,
  );
  expect(out.gatewayRead.length, `${each.name}: and all of it`).toBe(each.sent.length);
};

/** O1: one dial, one connection served, one challenge sent, and the gateway reads the close 1000. */
export const checkOneDial = (each: ConnectionCase, out: CaseOutcome) => {
  expect(out.dials, `${each.name}: one dial`).toBe(1);
  expect(out.served, `${each.name}: one connection served`).toBe(1);
  expect(out.seen.challenges, `${each.name}: one challenge sent`).toBe(1);
  expect(
    Option.map(out.seen.close, ({ code }) => code),
    `${each.name}: the connection ends with the close 1000`,
  ).toEqual(Option.some(1000));
};
