// Ticket 1041, next/: the chunk size a runtime law hands its runner when it sends no chunked mail.
//
// The runtime layer reads no setting (layer-rules.json: `next-runtime` does not import
// `next-settings`; the brain reads settings at its edge, 0086), so a law module here cannot read
// `mail.chunk`'s declaration. A test file can, and passes `mailChunk.default`. A law that sends
// chunked mail sets its own size; every other law runs the same under any size, so this one is not
// the setting's default and nothing depends on it being one.
import { ByteSize } from "effect";

/** @internal A chunk size for a runner whose law sends no `send_chunks`. */
export const ANY_CHUNK = ByteSize.kibibytes(64);
