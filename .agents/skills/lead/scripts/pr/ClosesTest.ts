// ClosesTest.layer: the Closes service in memory, on one list of records that a close adds to, as the
// file would. It reads and writes no file. `failing` is the reason every read and write fails with.
import { Effect, Layer } from "effect";
import { type Close, Closes, ClosesError } from "./Closes.ts";

export type World = { readonly records: Array<Close> };

/** A fresh record that already holds these closes. */
export const world = (records: ReadonlyArray<Close> = []): World => ({ records: [...records] });

export const layer = (w: World, failing?: string): Layer.Layer<Closes> => {
  const refuse = Effect.fail(new ClosesError({ reason: failing ?? "" }));

  return Layer.succeed(
    Closes,
    Closes.of({
      all: failing === undefined ? Effect.sync(() => [...w.records]) : refuse,
      record: (close) =>
        failing === undefined
          ? Effect.sync(() => {
              w.records.push(close);
            })
          : refuse,
    }),
  );
};
