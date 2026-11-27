/**
 * A cause a typed error holds and never shows: the one schema every kalfa error uses for a cause that may quote a value.
 *
 * **Details**
 *
 * In memory the cause is a `Redacted`, which no rendering shows. Every codec that writes outward (`Schema.toCodecJson`, the string-tree
 * codec and the Go-style JSON codec) writes `placeholder` in its place, and a read gives back an empty hidden cause: the value never
 * left the process, so the reader holds nothing. The codec that stays in the process (`Schema.toCodecIso`) keeps the cause.
 * `Schema.Redacted` alone does not do this: `Schema.toCodecJson` writes the value it holds in full.
 */
import { Redacted, Schema, SchemaGetter } from "effect";

/**
 * What every codec that writes outward writes for a hidden cause. It is Effect's own text for a `Redacted` that has no label.
 *
 * **Example** (The text a codec writes)
 *
 * ```ts
 * import * as Hidden from "@kalfa/diagnostics/Hidden"
 *
 * export const written: "<redacted>" = Hidden.placeholder
 * ```
 *
 * @category constants
 */
export const placeholder = "<redacted>";

/**
 * Schema for a typed error's cause that may quote a value: a `Redacted` in memory, `placeholder` in JSON, and an empty `Redacted` when
 * read back. Make one with `Redacted.make(cause)`, and read it on purpose with `Redacted.value`.
 *
 * **Example** (An error that hides its cause)
 *
 * ```ts
 * import { Redacted, Schema } from "effect"
 * import * as Hidden from "@kalfa/diagnostics/Hidden"
 *
 * export class StoreFailed extends Schema.TaggedError<StoreFailed, { readonly brand: unique symbol }>()("StoreFailed", {
 *   cause: Hidden.Cause
 * }) {}
 *
 * const failed = new StoreFailed({ cause: Redacted.make(new Error("read token abc")) })
 *
 * // { _tag: "StoreFailed", cause: "<redacted>" }
 * export const written = Schema.encodeSync(Schema.toCodecJson(StoreFailed))(failed)
 * ```
 *
 * @category schemas
 */
export const Cause = Schema.declare(
  (candidate: unknown): candidate is Redacted.Redacted<unknown> => Redacted.isRedacted(candidate),
  {
    expected: "a hidden cause",
    // `toCodecJson` and not `toCodec`: the string-tree and Go-style codecs reuse this link, and the iso codec, which stays in the
    // process, keeps the cause.
    toCodecJson: () =>
      Schema.link<Redacted.Redacted<unknown>>()(Schema.Literal(placeholder), {
        decode: SchemaGetter.transform(() => Redacted.make(undefined)),
        encode: SchemaGetter.transform((): typeof placeholder => placeholder),
      }),
  },
);
