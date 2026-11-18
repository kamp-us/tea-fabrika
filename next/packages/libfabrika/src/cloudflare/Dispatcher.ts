/**
 * The control door's dispatch, as a service: the one call `control` makes against the bindings.
 */
import { Context, Schema } from "effect";
import type * as Effect from "effect/Effect";
import type { ProgramSource } from "./index.ts";
import type { Env } from "./runtime.ts";

/** One control request, as the door decodes it from its JSON body. */
export const Request = Schema.Struct({
  target: Schema.Literals(["project", "process", "record", "loader", "bucket"]),
  project: Schema.String,
  name: Schema.String,
  method: Schema.String,
  args: Schema.Array(Schema.Unknown),
});

/**
 * Runs one control request against the Worker's bindings.
 *
 * **Details**
 *
 * `dispatch` answers the called method's value, or fails with that call's own failure: a
 * `LedgerError` for arguments that do not decode, a `{ reason }` for a method the door refuses, and
 * whatever the called target fails with, so the failure is `unknown`. `DispatcherLive.layer` is the
 * one live member, and a law records the call with a `Recorder` over it.
 *
 * @category services
 */
export class Dispatcher extends Context.Service<
  Dispatcher,
  {
    readonly dispatch: (
      env: Env,
      programs: Readonly<Record<string, ProgramSource>>,
      request: typeof Request.Type,
    ) => Effect.Effect<unknown, unknown>;
  }
>()("@kampus/libfabrika/cloudflare/Dispatcher") {}
