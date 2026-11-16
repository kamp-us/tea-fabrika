// WorkflowRunsTest.layer: the WorkflowRuns service in memory, on one list of runs that its writes
// change as GitHub's would. It asks GitHub nothing. `calls` keeps every write, in order.
import { Effect, Layer, Schema, Array as Arr, Option } from "effect";
import { type Run, WorkflowRuns, WorkflowRunsError } from "./WorkflowRuns.ts";

/** One write the layer took, as the caller made it. */
export const Call = Schema.TaggedUnion({
  cancel: { id: Schema.Finite },
});

export type Call = typeof Call.Type;

/** The calls that fail with a reason, by name. */
export type Failing = Partial<Record<"unfinished" | "cancel", string>>;

export type World = { readonly runs: Array<Run>; readonly calls: Array<Call> };

/** A fresh world over these runs; the layer reads and changes it in place. */
export const world = (runs: ReadonlyArray<Run> = []): World => ({ runs: [...runs], calls: [] });

export const layer = (w: World, failing: Failing = {}): Layer.Layer<WorkflowRuns> => {
  const fails = (name: keyof Failing) => {
    const reason = failing[name];

    return reason === undefined ? Effect.void : Effect.fail(WorkflowRunsError.make({ reason }));
  };

  /** Puts `to` on run `id`, as GitHub would; a run it does not hold fails as GitHub's 404. */
  const change = (id: number, to: Partial<Run>) => {
    const at = Arr.findFirstIndex(w.runs, (r) => r.id === id);
    const found = Option.flatMap(at, (i) => Arr.get(w.runs, i));

    if (Option.isNone(at) || Option.isNone(found)) {
      return Effect.fail(WorkflowRunsError.make({ reason: `no run ${id}` }));
    }

    w.runs[at.value] = { ...found.value, ...to };
    return Effect.void;
  };

  return Layer.succeed(
    WorkflowRuns,
    WorkflowRuns.of({
      unfinished: Effect.map(fails("unfinished"), () => Arr.filter(w.runs, (r) => r.status !== "completed")),
      cancel: (id) =>
        fails("cancel").pipe(
          Effect.andThen(change(id, { status: "completed", conclusion: "cancelled" })),
          Effect.andThen(Effect.sync(() => w.calls.push(Call.cases.cancel.make({ id })))),
          Effect.asVoid,
        ),
    }),
  );
};
