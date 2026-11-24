/**
 * The JSON-RPC 2.0 frame of a value: one notification, with the sender's trace under `params._meta` as the W3C `traceparent` and `tracestate`.
 *
 * @internal
 */
import { Option, Result, Schema } from "effect";
import * as Headers from "effect/http/Headers";
import * as HttpTraceContext from "effect/http/HttpTraceContext";
import type { Frame } from "../Frame.ts";

/**
 * A trace as the frame writes it: Effect's span ids, and the tracestate the span held.
 *
 * @internal
 */
export interface Trace {
  readonly traceId: string;
  readonly spanId: string;
  readonly sampled: boolean;
  readonly state: Option.Option<string>;
}

/**
 * What one frame holds.
 *
 * @internal
 */
export interface Notification {
  readonly method: string;
  readonly value: unknown;
  readonly trace: Option.Option<Trace>;
}

// A value, and nothing else but a trace, under `params`. `id`, `result` and `error` make a frame a request or an answer, so none may be there.
const Wire = Schema.Struct({
  jsonrpc: Schema.Literal("2.0"),
  method: Schema.String,
  id: Schema.optionalKey(Schema.Never),
  result: Schema.optionalKey(Schema.Never),
  error: Schema.optionalKey(Schema.Never),
  params: Schema.Struct({ value: Schema.Json, _meta: Schema.optionalKey(Schema.Unknown) }),
});

// Anything else in `_meta` is ignored, and a `_meta` or a `traceparent` of the wrong shape is no trace.
const Meta = Schema.Struct({ traceparent: Schema.String, tracestate: Schema.optionalKey(Schema.Unknown) });

// W3C: a tracestate is 1 to 512 printable ASCII characters. One that is not is dropped, and its trace still crosses.
const State = Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(512), Schema.isPattern(/^[ -~]+$/));

const readTraceparent = (traceparent: string) => HttpTraceContext.w3c(Headers.fromRecordUnsafe({ traceparent }));

const readTrace = ({ traceparent, tracestate }: typeof Meta.Type): Option.Option<Trace> =>
  Option.map(readTraceparent(traceparent), ({ traceId, spanId, sampled }) => ({
    traceId,
    spanId,
    sampled,
    state: Option.filter(Option.fromNullishOr(tracestate), Schema.is(State)),
  }));

// A trace id shorter than 32 digits is padded on the left, as Effect's own HTTP writer does. An id that is no W3C id writes no key, since the reader would drop it.
const writeMeta = ({ traceId, spanId, sampled, state }: Trace) => {
  const traceparent = `00-${traceId.padStart(32, "0")}-${spanId}-${sampled ? "01" : "00"}`;

  return Option.isSome(readTraceparent(traceparent))
    ? Option.some({ traceparent, tracestate: Option.getOrUndefined(Option.filter(state, Schema.is(State))) })
    : Option.none();
};

/**
 * Writes one notification as the text of a frame.
 *
 * @internal
 */
export const write = ({ method, value, trace }: Notification): Result.Result<Frame, "value"> =>
  Result.mapError(
    Schema.encodeUnknownResult(Schema.fromJsonString(Schema.Unknown))({
      jsonrpc: "2.0",
      method,
      params: { value, _meta: Option.getOrUndefined(Option.flatMap(trace, writeMeta)) },
    }),
    () => "value",
  );

/**
 * Reads the text of a frame as one notification, or says why it is none: `text` for text that is no JSON, `message` for JSON that is not one notification of a value.
 *
 * @internal
 */
export const read = (frame: Frame): Result.Result<Notification, "text" | "message"> =>
  Schema.decodeUnknownResult(Schema.fromJsonString(Schema.Unknown))(frame).pipe(
    Result.mapError((): "text" | "message" => "text"),
    Result.flatMap((json) =>
      Result.mapError(Schema.decodeUnknownResult(Wire)(json), (): "text" | "message" => "message"),
    ),
    Result.map(({ method, params }) => ({
      method,
      value: params.value,
      trace: Option.fromNullishOr(params._meta).pipe(
        Option.flatMap(Schema.decodeUnknownOption(Meta)),
        Option.flatMap(readTrace),
      ),
    })),
  );
