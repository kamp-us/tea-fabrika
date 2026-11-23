// What the laws of @kalfa/transport share: the generators, the harness that runs the two ends of a memory pair at once, a line
// format that is no JSON-RPC (F5), a tracer and a logger that keep what they were handed, and the forms a secret is written in.
// Every generator is an Effect Arbitrary, so the package needs no fast-check. Each law applies, to each value it draws, one value
// made from it for every class the plan names, so every class is reached in every run and no run can pass on less.
import { assert } from "@effect/vitest";
import {
  Arbitrary,
  Array as Arr,
  Cause,
  Context,
  Deferred,
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
  Stream,
  Tracer,
} from "effect";
import { Socket } from "effect/socket";
import { Format, FormatError, TraceState, Transport } from "./index.ts";
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
const awkwardText: Arbitrary.Arbitrary<string> = Arbitrary.all({
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
type Plain = Schema.Codec<unknown, unknown, never, never>;

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
}

export const traceSeed: Arbitrary.Arbitrary<TraceSeed> = Arbitrary.all({
  trace: hex(32),
  span: hex(16),
  state: Arbitrary.array(word, { minLength: 1, maxLength: 4 }).pipe(
    Arbitrary.map((words) => words.map((each, index) => `v${index}=${each}`).join(",")),
  ),
  short: hex(16),
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
] as const;

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
  ];
};

/** A 16-digit trace id is written padded to 32 with zeros on the left, and reads back so. */
export const shortTrace = (each: TraceSeed): WrittenTrace => ({
  name: "o: a 16-digit trace id",
  traceId: each.short,
  spanId: each.span,
  sampled: true,
  state: Option.none(),
});

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
