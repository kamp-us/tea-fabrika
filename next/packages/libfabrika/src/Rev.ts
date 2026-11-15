// One of the shared names of 0043, on layer 0 (0091): a value every module may import, with no service
// and no error.
import { Schema } from "effect";
import { InputId } from "./Id.ts";

/** A place in the log or in a stream. Both count from 1; 0 means before the first. */
export const Rev = Schema.Int.check(Schema.isGreaterThanOrEqualTo(0));
export type Rev = typeof Rev.Type;

/**
 * The one page size, for a log read and for the wire: the most entries one page of a read holds
 * past a rev, and so the most one `ledger.read` or `spans.read` answer holds. A page shorter than
 * this is the last. A guess: far under the size of an object call's message for small events.
 */
export const PAGE = 256;

/** Old saved parents keep their original identity. New checked inputs use InputId. */
const LegacyParentText = Schema.String.check(Schema.isPattern(/^in-process_[0-7][0-9a-hjkmnp-tv-z]{25}-[1-9][0-9]*$/));

export const ParentText = Schema.Union([InputId, LegacyParentText]);
