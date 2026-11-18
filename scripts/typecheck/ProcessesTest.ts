// ProcessesTest.layer: the Processes service in memory, on one table of processes that a law changes
// in place, as the machine would: a pid starts, ends, or comes back as another process. It runs no
// pgrep, no ps and no kill. Today's tooling (0113), following next/'s rules (0033).
import { Effect, Layer } from "effect";
import { Liveness } from "./Look.ts";
import { type Listing, Processes } from "./Processes.ts";

export type Table = {
  /** Each running pid, and when it started in ms, or `undefined` where ps cannot read it. */
  readonly running: Map<number, number | undefined>;
  /** Each pid's command line; a pid with none reads as `""`, as ps answers where it cannot read it. */
  readonly args: Map<number, string>;
  /** pgrep's answers, one per call, in turn; once one is left it repeats. */
  named: ReadonlyArray<Listing>;
  /** Each name pgrep was asked for, in order. */
  readonly asked: Array<string>;
};

/** A fresh table: nothing runs, and pgrep lists `named` in turn. */
export const table = (named: ReadonlyArray<Listing>): Table => ({
  running: new Map(),
  args: new Map(),
  named,
  asked: [],
});

/** The service as process `self` sees it, over the shared table `t`. */
export const layer = (t: Table, self: number): Layer.Layer<Processes> =>
  Layer.succeed(
    Processes,
    Processes.of({
      self,
      named: (name) =>
        Effect.suspend(() => {
          t.asked.push(name);
          const [first, ...rest] = t.named;

          if (first === undefined) {
            return Effect.die(new Error("ProcessesTest: the law gave pgrep no answer"));
          }

          if (rest.length > 0) {
            t.named = rest;
          }

          return Effect.succeed(first);
        }),
      args: (pid) => Effect.sync(() => t.args.get(pid) ?? ""),
      liveness: (pid) =>
        Effect.sync(() => {
          if (!t.running.has(pid)) {
            return Liveness.cases.gone.make({});
          }

          const startedAt = t.running.get(pid);
          return startedAt === undefined ? Liveness.cases.running.make({}) : Liveness.cases.running.make({ startedAt });
        }),
    }),
  );
