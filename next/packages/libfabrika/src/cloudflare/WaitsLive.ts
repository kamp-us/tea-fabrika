/**
 * The `Waits` layer: the ready decode the gateway runs on a Project's answer.
 */
import { Effect, Layer, Schema } from "effect";
import { LedgerError } from "../ledger/Ledger.ts";
import { Waited } from "../ledger/Log.ts";
import { Waits } from "./Waits.ts";

/**
 * Layer that provides `Waits`: `ready` decodes a rev, and an answer that does not decode fails with
 * a `LedgerError` of reason `bad_row`, with the decode failure as its cause.
 *
 * @category layers
 */
export const layer: Layer.Layer<Waits> = Layer.succeed(
  Waits,
  Waits.of({
    ready: Effect.fnUntraced(function* (raw: unknown) {
      const ready = yield* Schema.decodeUnknownEffect(Schema.Struct({ rev: Schema.Int }))(raw).pipe(
        Effect.mapError((cause) => new LedgerError({ reason: "bad_row", cause })),
      );

      return Waited.cases.ready.make(ready);
    }),
  }),
);
