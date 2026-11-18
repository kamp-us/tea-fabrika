// LocksTest.layer: the Locks service in memory. `hold` is granted at once and never waits; it keeps
// the path it was handed, and the shared log `log` gets one line when the lock is held, one per pid
// the holder writes down for its running command, and one when the scope lets the lock go. A law
// reads that log beside CommandsTest's and NodeModulesTest's lines to see what ran under the lock.
// It writes no file. Today's tooling (0113), following next/'s rules (0033).
import { Effect, Layer, Option } from "effect";
import { Locks } from "./Locks.ts";

export type Taken = {
  /** Each path `hold` was handed, in order. */
  readonly paths: Array<string>;
  /** The shared log: `hold <path>`, `running <pid>` or `running none`, and `release <path>`. */
  readonly log: Array<string>;
};

/** A fresh record over the shared log `log`. */
export const taken = (log: Array<string>): Taken => ({ paths: [], log });

export const layer = (t: Taken): Layer.Layer<Locks> =>
  Layer.succeed(
    Locks,
    Locks.of({
      hold: (path) =>
        Effect.acquireRelease(
          Effect.sync(() => {
            t.paths.push(path);
            t.log.push(`hold ${path}`);
            return {
              running: (pid: Option.Option<number>) =>
                Effect.sync(() => {
                  t.log.push(`running ${Option.match(pid, { onNone: () => "none", onSome: String })}`);
                }),
            };
          }),
          () =>
            Effect.sync(() => {
              t.log.push(`release ${path}`);
            }),
        ),
    }),
  );
