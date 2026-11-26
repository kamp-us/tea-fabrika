/**
 * One notification of a method, written and read through `Format`: the part of a frame both the stream functions and the hello share.
 *
 * @internal
 */
import { Effect, Schema } from "effect";
import { Format, FormatError } from "../Format.ts";
import type { Frame } from "../Frame.ts";
import type { Traced } from "../Traced.ts";

/**
 * Writes a traced value as one notification of `method`. A value the schema cannot write fails with a `FormatError` of `value`.
 *
 * @internal
 */
export const send =
  (method: string) =>
  <S extends Schema.Top>(schema: S) =>
    Effect.fnUntraced(function* ({ value, trace }: Traced<S["Type"]>) {
      const format = yield* Format;

      const written = yield* Schema.encodeUnknownEffect(format.codecFor(schema))(value).pipe(
        Effect.mapError(() => new FormatError({ reason: "value" })),
      );

      return yield* format.write({ method, value: written, trace });
    });

/**
 * Reads a frame as one notification of `method` and its value under the schema, with the trace it carried.
 *
 * @internal
 */
export const receive =
  (method: string) =>
  <S extends Schema.Top>(schema: S) =>
    Effect.fnUntraced(function* (frame: Frame) {
      const format = yield* Format;
      const read = yield* format.read(frame);

      if (read.method !== method) {
        return yield* new FormatError({ reason: "method" });
      }

      const value: S["Type"] = yield* Schema.decodeUnknownEffect(format.codecFor(schema))(read.value).pipe(
        Effect.mapError(() => new FormatError({ reason: "value" })),
      );

      return { value, trace: read.trace };
    });
