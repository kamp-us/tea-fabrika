/**
 * What the Ledger answers with when it does not do what it was asked: five refusals, one error of a read's own, three failures, and the two unions a package
 * above wraps.
 *
 * **Details**
 *
 * A refusal says the Ledger will not keep this entry: the writer sent something it should not have. `EmptyTypes` is no refusal, since a read keeps no entry:
 * it says a read asked for entries by type and named no type. A failure says the Ledger could not answer. No error carries a body or metadata, since an
 * entry's content never rides in an error. A failure holds its cause as a `Redacted`, which no rendering shows, since a driver's own error can quote a row:
 * a caller makes it with `Redacted.make(cause)`, and code that needs the cause reads it on purpose with `Redacted.value(error.cause)`. A failure crosses a
 * wire with its tag and its cause written as the text `<redacted>`, and is read back with an empty hidden cause: the value never leaves the process.
 */
import * as Hidden from "@kalfa/diagnostics/Hidden";
import { Schema } from "effect";
import { Revision } from "./Entry.ts";

/**
 * An entry the Ledger refuses because a part of it is wrong. It says which part and nothing of its content.
 *
 * @category refusals
 */
export class BadEntry extends Schema.TaggedError<BadEntry, { readonly brand: unique symbol }>()("BadEntry", {
  part: Schema.Literals(["stream", "id", "entry", "type", "body", "metadata", "expectedRevision"]),
}) {}

/**
 * The same id in the same stream, sent with another body or another type.
 *
 * @category refusals
 */
export class IdReused extends Schema.TaggedError<IdReused, { readonly brand: unique symbol }>()("IdReused", {}) {}

/**
 * An entry past the size limit: the bytes it counts and the limit it met.
 *
 * @category refusals
 */
export class TooBig extends Schema.TaggedError<TooBig, { readonly brand: unique symbol }>()("TooBig", {
  bytes: Schema.Int,
  limit: Schema.Int,
}) {}

/**
 * An admission said no: which one, and its reason as text. Raised first by the admissions of a later slice.
 *
 * @category refusals
 */
export class AdmissionRefused extends Schema.TaggedError<AdmissionRefused, { readonly brand: unique symbol }>()(
  "AdmissionRefused",
  { admission: Schema.String, reason: Schema.String },
) {}

/**
 * An append that named the revision it read, and the stream has moved: what it expected and the stream's head revision now.
 *
 * @category refusals
 */
export class RevisionConflict extends Schema.TaggedError<RevisionConflict, { readonly brand: unique symbol }>()(
  "RevisionConflict",
  { expected: Revision, actual: Revision },
) {}

/**
 * A read that asked for entries by type and named no type. A caller who wants every entry leaves `types` out. It is the read's own error, and no refusal.
 *
 * @category read errors
 */
export class EmptyTypes extends Schema.TaggedError<EmptyTypes, { readonly brand: unique symbol }>()("EmptyTypes", {}) {
  override get message(): string {
    return "types must hold at least one type: leave types out to read every entry";
  }
}

/**
 * The Ledger could not be reached. Its cause is hidden.
 *
 * @category failures
 */
export class Unreachable extends Schema.TaggedError<Unreachable, { readonly brand: unique symbol }>()("Unreachable", {
  cause: Hidden.Cause,
}) {}

/**
 * A stored row could not be read back. Its cause is hidden.
 *
 * @category failures
 */
export class BadRow extends Schema.TaggedError<BadRow, { readonly brand: unique symbol }>()("BadRow", {
  cause: Hidden.Cause,
}) {}

/**
 * The storage under the Ledger failed. Its cause is hidden.
 *
 * @category failures
 */
export class StorageFailed extends Schema.TaggedError<StorageFailed, { readonly brand: unique symbol }>()(
  "StorageFailed",
  { cause: Hidden.Cause },
) {}

/**
 * Every reason the Ledger will not keep an entry, as a union a package above names its own refusal's `reason` with.
 *
 * @category refusals
 */
export const Refusal = Schema.Union([BadEntry, IdReused, TooBig, AdmissionRefused, RevisionConflict]);

export type Refusal = typeof Refusal.Type;

/**
 * Every way the Ledger could not answer, as a union a package above wraps as its own `<Package>Unavailable`.
 *
 * @category failures
 */
export const Failure = Schema.Union([Unreachable, BadRow, StorageFailed]);

export type Failure = typeof Failure.Type;
