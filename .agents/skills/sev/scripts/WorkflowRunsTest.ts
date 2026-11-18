// WorkflowRunsTest.layer: the WorkflowRuns service in memory, built on the Recorder (0579), on one
// list of runs that its cancels change as GitHub's would. It asks GitHub nothing. The Recorder keeps
// every call in order, each list and each cancel, answered or refused, so a law reads what the loop
// spent of GitHub's rate limit with `Recorder.calls(WorkflowRuns)`, inside the layer it provided.
import { Recorder } from "@kampus/vitest";
import { Array as Arr, DateTime, Effect, type Layer, Option } from "effect";
import { RateLimited, type Run, WorkflowRuns, WorkflowRunsError } from "./WorkflowRuns.ts";

/**
 * GitHub as the layer sees it: its runs, and the answer it gives to the cancel of each run it
 * refuses. A refused cancel changes no run; a law may change either while a loop runs.
 */
export type World = { readonly runs: Array<Run>; readonly refusing: Map<number, WorkflowRunsError> };

/** A fresh world over these runs and refusals; the layer reads and changes it in place. */
export const world = (
  runs: ReadonlyArray<Run> = [],
  refusing: ReadonlyArray<readonly [number, WorkflowRunsError]> = [],
): World => ({ runs: [...runs], refusing: new Map(refusing) });

/** The methods that refuse every call, each with the error it refuses with. A refused cancel changes no run. */
export type Failing = Recorder.Fails<WorkflowRuns["Service"]>;

/**
 * GitHub's rate limit: the first `left` calls are answered, then each is refused as `RateLimited`
 * until `reset` on the clock, and every call from `reset` on is answered.
 */
export type Limit = { readonly left: number; readonly reset: DateTime.Utc };

export const layer = (
  w: World,
  given: { readonly failing?: Failing; readonly limit?: Limit } = {},
): Layer.Layer<WorkflowRuns | Recorder.Recorded<WorkflowRuns>> => {
  let answered = 0;

  /** Counts one call against the limit, or refuses it for the limit until its reset. */
  const spend = Effect.gen(function* () {
    const limit = given.limit;

    if (
      limit === undefined ||
      answered < limit.left ||
      DateTime.isGreaterThanOrEqualTo(yield* DateTime.now, limit.reset)
    ) {
      answered += 1;

      return;
    }

    return yield* RateLimited.make({ until: limit.reset, reason: "HTTP 403: API rate limit exceeded" });
  });

  /** Puts `to` on run `id`, as GitHub would; a run it does not hold fails as GitHub's 404. */
  const change = (id: number, to: Partial<Run>) => {
    const at = Arr.findFirstIndex(w.runs, (r) => r.id === id);
    const found = Option.flatMap(at, (i) => Arr.get(w.runs, i));

    if (Option.isNone(at) || Option.isNone(found)) {
      return Effect.fail(WorkflowRunsError.make({ reason: `no run ${id}`, status: 404 }));
    }

    w.runs[at.value] = { ...found.value, ...to };

    return Effect.void;
  };

  return Recorder.layer(
    WorkflowRuns,
    {
      unfinished: Effect.map(spend, () => Arr.filter(w.runs, (r) => r.status !== "completed")),
      cancel: (id) =>
        Effect.andThen(spend, () => {
          const refusal = w.refusing.get(id);

          return refusal === undefined
            ? change(id, { status: "completed", conclusion: "cancelled" })
            : Effect.fail(refusal);
        }),
    },
    { fails: given.failing ?? {} },
  );
};
