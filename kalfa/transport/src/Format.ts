/**
 * The format: how a value becomes a frame and a frame becomes a value, the failure of a frame the format refuses, and JSON-RPC 2.0, the one format Transport ships.
 *
 * **Details**
 *
 * The stream functions of `Transport` ask the `Format` service for every frame, so another format is a Layer in its place and no stream function changes.
 */
import { Context, Effect, Layer, Option, Schema, Tracer } from "effect";
import type { Frame } from "./Frame.ts";
import * as JsonRpc from "./internal/jsonRpc.ts";

/**
 * What a format carries in one frame: a method word, a value already written by `codecFor`, and the sender's trace.
 *
 * @category models
 */
export interface Notification {
  readonly method: string;
  readonly value: unknown;
  readonly trace: Option.Option<Tracer.ExternalSpan>;
}

/**
 * A frame or a value the format refuses, and why.
 *
 * **Details**
 *
 * `text` is text that is not the format's own, `message` is the format's text that is not one message of a value, `method` is a message with another method word, and `value` is a value that does not fit its schema, whether it was read or written. The error holds no frame and no value, since a frame can hold a person's secret: this is the whole of what it says.
 *
 * @category errors
 */
export class FormatError extends Schema.TaggedError<FormatError, { readonly brand: unique symbol }>()("FormatError", {
  reason: Schema.Literals(["text", "message", "method", "value"]),
}) {}

/**
 * The W3C tracestate a trace carried, kept in the `annotations` of the `ExternalSpan` that holds the trace.
 *
 * @category services
 */
export class TraceState extends Context.Service<TraceState, string>()("@kalfa/transport/TraceState") {}

/**
 * The service that turns values into frames and frames into values.
 *
 * **Details**
 *
 * `codecFor` is how a schema's value becomes data and back, `write` is how data becomes a frame, and `read` is how a frame becomes data. `Format.layerJsonRpc` is JSON-RPC 2.0: one notification in each frame, the value under `params.value`, and the trace under `params._meta`.
 *
 * @category services
 */
export class Format extends Context.Service<
  Format,
  {
    readonly codecFor: <S extends Schema.Top>(
      schema: S,
    ) => Schema.Codec<S["Type"], unknown, S["DecodingServices"], S["EncodingServices"]>;
    readonly write: (notification: Notification) => Effect.Effect<Frame, FormatError>;
    readonly read: (frame: Frame) => Effect.Effect<Notification, FormatError>;
  }
>()("@kalfa/transport/Format") {
  /**
   * JSON-RPC 2.0, with Effect's JSON codec for values.
   *
   * **Details**
   *
   * A frame is one notification of the method the stream functions write, with no `id`. The value is under `params.value`, never spread into `params`, so a bare string or a number has a place. The trace is `params._meta.traceparent` and `params._meta.tracestate`, as MCP carries it, and a frame with no trace holds neither key.
   */
  static readonly layerJsonRpc: Layer.Layer<Format> = Layer.succeed(
    Format,
    Format.of({
      codecFor: (schema) => Schema.toCodecJson(schema),
      write: ({ method, value, trace }) =>
        Effect.fromResult(
          JsonRpc.write({
            method,
            value,
            trace: Option.map(trace, ({ traceId, spanId, sampled, annotations }) => ({
              traceId,
              spanId,
              sampled,
              state: Context.getOption(annotations, TraceState),
            })),
          }),
        ).pipe(Effect.mapError((reason) => new FormatError({ reason }))),
      read: (frame) =>
        Effect.fromResult(JsonRpc.read(frame)).pipe(
          Effect.mapError((reason) => new FormatError({ reason })),
          Effect.map(({ method, value, trace }) => ({
            method,
            value,
            trace: Option.map(trace, ({ traceId, spanId, sampled, state }) =>
              Tracer.externalSpan({
                traceId,
                spanId,
                sampled,
                annotations: Option.getOrUndefined(
                  Option.map(state, (tracestate) => Context.make(TraceState, tracestate)),
                ),
              }),
            ),
          })),
        ),
    }),
  );
}
