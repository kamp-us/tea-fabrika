/**
 * Why a process ended, as data: the exit reason, when two reasons are the same exit, and the
 * decoder for a reason that comes from outside.
 *
 * @stability unstable
 */
import { Function, Schema } from "effect";

/** A captured failure's class, such as `TypeError`: the same 256-character bound as other brain text. */
const ErrorClass = Schema.NonEmptyString.check(Schema.isMaxLength(256));

/**
 * Why a process ended, as OTP keeps it: `normal`, `shutdown`, `kill`, or `crashed` with the phase that
 * failed and the captured error class. Never an exception's message or stack.
 *
 * @stability unstable
 * @category schemas
 */
export const ExitReason = Schema.TaggedUnion({
  normal: {},
  shutdown: {},
  kill: {},
  crashed: {
    phase: Schema.Literals(["step", "saved_letter", "interrupted"]),
    error: Schema.optionalKey(ErrorClass),
  },
});
/**
 * Why a process ended, as `ExitReason` decodes it.
 *
 * @stability unstable
 * @category models
 */
export type ExitReason = typeof ExitReason.Type;

const sameReasonBody = Schema.toEquivalence(ExitReason);

/**
 * Equivalence under which two exit reasons are the same exit when their fields are, wherever each
 * copy came from.
 *
 * @stability unstable
 * @category guards
 */
export const sameReason: {
  (that: ExitReason): (self: ExitReason) => boolean;
  (self: ExitReason, that: ExitReason): boolean;
} = Function.dual(2, sameReasonBody);

// The decoder takes the input alone: no caller passes parse options, and a decoder with a second,
// optional argument has no pipeable form that a call could not misread.
const exitReasonDecoder = Schema.decodeUnknownResult(ExitReason, { onExcessProperty: "error" });

/**
 * Decodes untrusted input to one exit reason, as a `Result`. A string, an unknown tag or an extra
 * field is refused.
 *
 * @stability unstable
 * @category decoding
 */
export const decodeExitReason = (input: unknown) => exitReasonDecoder(input);
