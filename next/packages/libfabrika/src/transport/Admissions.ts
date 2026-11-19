/**
 * The hello's admission, the one service `checkHello` asks for.
 */
import * as Context from "effect/Context";
import type * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";
import type { Admission } from "./Wire.ts";

/**
 * What admission failed with, in the door's own words, kept as the cause.
 *
 * @category errors
 */
export class AdmissionError extends Schema.TaggedError<AdmissionError, { readonly brand: unique symbol }>()(
  "AdmissionError",
  { cause: Schema.Defect() },
) {}

/**
 * The two calls a checked hello makes on its door: admit its key, then spend its nonce.
 *
 * @category services
 */
export class Admissions extends Context.Service<
  Admissions,
  {
    /** Admits or refuses this key fingerprint. */
    readonly admit: (key: string) => Effect.Effect<typeof Admission.Type, AdmissionError>;
    /** Spends the hello's nonce, once; false when it was spent already. */
    readonly consume: Effect.Effect<boolean>;
  }
>()("@kampus/libfabrika/transport/Admissions") {}
