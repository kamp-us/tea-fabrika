/**
 * The gateway's ready decode, as a service: what a ready answer from the Project must look like.
 */
import { Context } from "effect";
import type * as Effect from "effect/Effect";
import type { LedgerError } from "../ledger/Ledger.ts";
import type { Waited } from "../ledger/Log.ts";

/**
 * Decodes the answer a Project gives to a wait that is ready.
 *
 * **Details**
 *
 * `ready` takes the raw answer and gives the `ready` case of `Waited`, or fails with a `LedgerError`
 * of reason `bad_row` for an answer that does not decode: a malformed answer is a typed failure and
 * never a defect. `WaitsLive.layer` is the one live member, and a law records the call with a
 * `Recorder` over it.
 *
 * @category services
 */
export class Waits extends Context.Service<
  Waits,
  {
    readonly ready: (raw: unknown) => Effect.Effect<typeof Waited.cases.ready.Type, LedgerError>;
  }
>()("@kampus/libfabrika/cloudflare/Waits") {}
