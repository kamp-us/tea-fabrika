/**
 * Instance starts recorded and read through RPC calls to the object that keeps them.
 *
 * @stability unstable
 */
import { Effect, Layer, Schema } from "effect";
import * as Start from "../settings/Start.ts";
import {
  Decode,
  Missing,
  MissingTarget,
  Refused,
  Starts,
  StartsError,
  Storage,
  Unreachable,
} from "../settings/Starts.ts";
import * as SettingsInput from "./SettingsInput.ts";

/**
 * The two RPC calls the layer makes. The Project object's binding has this shape.
 *
 * @stability unstable
 * @category models
 */
export interface Calls {
  readonly settingsStart: (input: Start.Input) => PromiseLike<unknown>;
  readonly settingsRead: (start: string) => PromiseLike<unknown>;
}

const unreachable = (cause: unknown) => StartsError.make({ reason: Unreachable.make({ cause }) });

/**
 * Layer that records and reads instance starts by calling the object that keeps them.
 *
 * **Details**
 *
 * No reply is trusted as it comes. Each one is decoded. An `ok` receipt is checked again, must be
 * for the asked start, and on `record` must match the input. A call that throws fails with
 * `Unreachable`. A failed reply fails with the same reason here.
 *
 * @stability unstable
 * @category layers
 */
export const layer = (calls: Calls) =>
  Layer.succeed(Starts, {
    record: (input) =>
      call(
        // oxlint-disable-next-line fabrika/no-promises -- edge: trusted Project settings-start RPC enters Effect
        Effect.tryPromise({ try: () => calls.settingsStart(input), catch: unreachable }),
        input.start,
        input,
      ),
    read: (start) =>
      call(
        // oxlint-disable-next-line fabrika/no-promises -- edge: trusted Project settings-read RPC enters Effect
        Effect.tryPromise({ try: () => calls.settingsRead(start), catch: unreachable }),
        start,
      ),
  });

const call = Effect.fnUntraced(function* (
  work: Effect.Effect<unknown, StartsError>,
  start: string,
  input?: Start.Input,
) {
  yield* Schema.decodeUnknownEffect(Start.Input.fields.start)(start).pipe(
    Effect.mapError((cause) => StartsError.make({ reason: Decode.make({ cause }) })),
  );
  const raw = yield* work;
  const reply = yield* Schema.decodeUnknownEffect(Start.Reply)(raw, { onExcessProperty: "error" }).pipe(
    Effect.mapError((cause) => StartsError.make({ reason: Decode.make({ cause }) })),
  );

  if (reply._tag === "ok") {
    const saved = yield* SettingsInput.receipt(reply.value, input).pipe(
      Effect.mapError((cause) => StartsError.make({ reason: Decode.make({ cause }) })),
    );

    if (saved.start !== start) {
      return yield* StartsError.make({ reason: Decode.make({ cause: "Start acknowledgement mismatch" }) });
    }

    return saved;
  }

  const reason =
    reply._tag === "Missing"
      ? Missing.make({ target: MissingTarget.cases.instance.make({ start }) })
      : reply._tag === "Decode"
        ? Decode.make({ cause: reply })
        : reply._tag === "Refused"
          ? Refused.make({ cause: reply })
          : reply._tag === "Storage"
            ? Storage.make({ cause: reply })
            : Unreachable.make({ cause: reply });
  return yield* StartsError.make({ reason });
});
