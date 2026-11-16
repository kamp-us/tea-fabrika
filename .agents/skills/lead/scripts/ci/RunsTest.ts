// RunsTest.layer: the Runs service in memory. `on` answers the runs listed for a branch, newest
// first, and `jobs` the jobs kept for a run id. It asks GitHub nothing. `asked` keeps each read, in
// order, so a law can see which run's jobs were read.
import { Effect, Layer } from "effect";
import { type Job, type Run, Runs, RunsError } from "./Runs.ts";

export type World = {
  /** Each branch's runs of the workflow, newest first. */
  readonly runs: Map<string, ReadonlyArray<Run>>;
  /** Each run's jobs, by run id. */
  readonly jobs: Map<number, ReadonlyArray<Job>>;
  readonly asked: Array<string>;
};

export const world = (): World => ({ runs: new Map(), jobs: new Map(), asked: [] });

/** `failing`, when given, is the reason every read fails with. */
export const layer = (w: World, failing?: string): Layer.Layer<Runs> => {
  const fails = failing === undefined ? Effect.void : Effect.fail(new RunsError({ reason: failing }));

  return Layer.succeed(
    Runs,
    Runs.of({
      on: (workflow, branch) =>
        Effect.map(fails, () => {
          w.asked.push(`runs ${workflow} ${branch}`);

          return w.runs.get(branch) ?? [];
        }),
      jobs: (id) =>
        Effect.map(fails, () => {
          w.asked.push(`jobs ${id}`);

          return w.jobs.get(id) ?? [];
        }),
    }),
  );
};
