// LandLogTest.layer: the LandLog service in memory, on one list of lines for each key, as the files would hold them. It reads
// and writes no file. `failing` says which appends fail: the one for a key and a line it returns true for.
import { Effect, Layer } from "effect";
import { type Key, LandLog, LandLogError, type Line } from "./LandLog.ts";

export type World = { readonly records: Map<string, Array<Line>> };

/** A fresh record that holds no line. */
export const world = (): World => ({ records: new Map() });

const named = (key: Key): string => (key._tag === "pr" ? `pr:${key.pr}` : `quest:${key.name}`);

/** The lines the record holds for `key`, oldest first. */
export const lines = (w: World, key: Key): ReadonlyArray<Line> => w.records.get(named(key)) ?? [];

export const layer = (w: World, failing?: (key: Key, line: Line) => boolean): Layer.Layer<LandLog> =>
  Layer.succeed(
    LandLog,
    LandLog.of({
      append: (key, line) =>
        failing?.(key, line) === true
          ? Effect.fail(LandLogError.make({ reason: "the record could not be written" }))
          : Effect.sync(() => {
              w.records.set(named(key), [...lines(w, key), line]);
            }),
      read: (key) => Effect.sync(() => ({ lines: lines(w, key), torn: 0 })),
    }),
  );
