/**
 * The `Gateway` service's own error and its reasons. It sits in a file of its own so the
 * gateway's store and nonce files can build it without importing `Gateway.ts`, which imports them.
 */
import { Schema } from "effect";

/**
 * Reason for gateway state that could not be read or written: the `Sql` threw, a saved key is not
 * one the gateway could have made, or the store of spent nonces is full. A throw or a decoder's
 * failure is kept as `cause`; a key of the wrong length and a full store have none.
 *
 * @category errors
 */
export class Storage extends Schema.TaggedError<Storage, { readonly brand: unique symbol }>()("Storage", {
  cause: Schema.Defect(),
}) {}

/**
 * Reason for a saved gateway state value that does not decode. The decoder's failure is kept as
 * `cause`.
 *
 * @category errors
 */
export class BadRow extends Schema.TaggedError<BadRow, { readonly brand: unique symbol }>()("BadRow", {
  cause: Schema.Defect(),
}) {}

/**
 * Reason for a WebCrypto call that failed: importing the challenge key, signing a nonce or
 * checking one. The rejection is kept as `cause`.
 *
 * @category errors
 */
export class Crypto extends Schema.TaggedError<Crypto, { readonly brand: unique symbol }>()("Crypto", {
  cause: Schema.Defect(),
}) {}

/**
 * Error of the `Gateway` service for a fault below its rules: its own tables, or the crypto it
 * runs. A refusal by the rules is an answer or `NotGranted` instead.
 *
 * @category errors
 */
export class GatewayError extends Schema.TaggedError<GatewayError, { readonly brand: unique symbol }>()(
  "GatewayError",
  {
    reason: Schema.Union([Storage, BadRow, Crypto]),
  },
) {}
