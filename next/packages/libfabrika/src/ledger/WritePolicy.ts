/**
 * The ledger's admission contract: a policy the ledger asks about each new entry inside its own
 * transaction, so an entry and its charge commit together. The ledger knows no quota; a higher
 * module supplies the policy.
 *
 * @stability unstable
 */
import * as Context from "effect/Context";
import type * as Result from "effect/Result";
import * as Schema from "effect/Schema";
import type { Entry } from "./Log.ts";

/**
 * Error kept as the cause of the `LedgerError` that ends a multi-entry transaction when
 * admission refuses one of its entries for quota.
 *
 * @stability unstable
 * @category errors
 */
export class QuotaRefused extends Schema.TaggedError<QuotaRefused>()("QuotaRefused", {}) {}

/**
 * Schema for who trusted code says a write is for: `runtime`, a process's runtime writing its own
 * stream, or `own`, a process's program writing its own entry, as a checked write or a hands task
 * request is.
 *
 * @stability unstable
 * @category schemas
 */
export const Writer = Schema.TaggedUnion({
  runtime: { process: Schema.String },
  own: { process: Schema.String },
});

/**
 * Who trusted code says a write is for: a process's runtime, or a process's program.
 *
 * @stability unstable
 * @category models
 */
export type Writer = typeof Writer.Type;

/**
 * Service that names the `Writer` of the writes inside it. The trusted assembly provides it around
 * a call, and it is never decoded from a request. Left out, the policy finds an entry's owner
 * itself.
 *
 * @stability unstable
 * @category services
 */
export class TrustedWriter extends Context.Service<TrustedWriter, Writer>()(
  "@kampus/libfabrika/ledger/WritePolicy/TrustedWriter",
) {}

/**
 * Service that admits or refuses one new entry before the ledger inserts it. `admit` runs
 * synchronously in the caller's transaction, so it may save the entry's charge there.
 *
 * @stability unstable
 * @category services
 */
export class WritePolicy extends Context.Service<
  WritePolicy,
  {
    readonly admit: (entry: Entry, writer?: Writer) => Result.Result<void, "quota">;
  }
>()("@kampus/libfabrika/ledger/WritePolicy") {}
