/**
 * A value together with the trace of the span that sent it.
 */
import type { Option, Tracer } from "effect";

/**
 * A value with the trace of the span that sent it, when it has one.
 *
 * **Details**
 *
 * The trace is Effect's own `ExternalSpan`, so a receiver makes its own span with it as the parent. `encodeTraced` writes it into the frame and `decodeTraced` reads it back.
 *
 * @category models
 */
export interface Traced<A> {
  readonly value: A;
  readonly trace: Option.Option<Tracer.ExternalSpan>;
}
