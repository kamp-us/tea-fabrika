// P39 slice 1, L9 (0095): `Tasks.ts` holds the contract, with its service type written out in the
// tasks module's own types and error, and its one layer is the sibling `TasksLedger.ts`, read through
// its module. No ledger name (`LedgerTurn`, `LedgerError`, `Line`) is part of the contract. CI's
// typecheck is this law's runner. P39 slice 3 (ticket 1040) adds `collected`, which takes the
// collection in the tasks module's own `Collection` type, and the `wrong_process` reason.
// P39 slice 4a, G1 (contract half): `forTarget` answers the open tasks one hands key is asked for and
// the `target:` stream's last rev, in the tasks module's own types and error; `targetStream` names
// that stream from a key. Plant (after build): give `forTarget` a `LedgerError` in its error channel.
import { expectTypeOf, it } from "@effect/vitest";
import type * as Context from "effect/Context";
import type * as Effect from "effect/Effect";
import type * as Layer from "effect/Layer";
import type * as Stream from "effect/Stream";
import type { ProcessId } from "../ProcessId.ts";
import type { Rev } from "../Rev.ts";
import type { Collection, Executor, Task, Recorded, Request, Result } from "./Task.ts";
import type * as TasksFront from "./Tasks.ts";
import type { Tasks, TasksError } from "./Tasks.ts";
import type * as TasksLedger from "./TasksLedger.ts";

type Receipt = { readonly rev: number; readonly arrivedAt: number };
type Taken = Receipt & { readonly execution: string };

it("type: L9 the contract speaks only the tasks module's types and errors, and the service class has no static layer", () => {
  // The five calls, as the contract writes them. A ledger type or error in any of them fails here.
  expectTypeOf<Context.Service.Shape<typeof Tasks>>().toEqualTypeOf<{
    readonly forProcess: (process: typeof ProcessId.Type) => Stream.Stream<Task, TasksError>;
    readonly forTarget: (key: string) => Effect.Effect<{ tasks: ReadonlyArray<Task>; rev: Rev }, TasksError>;
    readonly request: (request: Request, recorded: Recorded) => Effect.Effect<TasksFront.Receipt, TasksError>;
    readonly take: (id: string, executor: Executor, recorded: Recorded) => Effect.Effect<TasksFront.Taken, TasksError>;
    readonly started: (
      id: string,
      execution: string,
      recorded: Recorded,
    ) => Effect.Effect<TasksFront.Receipt, TasksError>;
    readonly finish: (
      id: string,
      execution: string,
      result: Result,
      recorded: Recorded,
    ) => Effect.Effect<TasksFront.Receipt, TasksError>;
    readonly read: (id: string) => Effect.Effect<Task, TasksError>;
    readonly collected: (
      id: string,
      collection: typeof Collection.Type,
      recorded: Recorded,
    ) => Effect.Effect<TasksFront.Receipt, TasksError>;
  }>();
  // A receipt is where the referee placed the event and when it arrived; a take adds its execution.
  expectTypeOf<TasksFront.Receipt>().toEqualTypeOf<Receipt>();
  expectTypeOf<TasksFront.Taken>().toEqualTypeOf<Taken>();
  // The layer serves Tasks and fails with nothing of its own while it is built.
  expectTypeOf<Layer.Success<typeof TasksLedger.layer>>().toEqualTypeOf<Tasks>();
  expectTypeOf<Layer.Error<typeof TasksLedger.layer>>().toEqualTypeOf<never>();
  // No static layer is left on the class, and the contract module exports no layer.
  expectTypeOf<"layer" extends keyof typeof Tasks ? true : false>().toEqualTypeOf<false>();
  expectTypeOf<"layer" extends keyof typeof TasksFront ? true : false>().toEqualTypeOf<false>();
  // Every TasksError reason is the tasks module's own.
  expectTypeOf<TasksError["reason"]>().toEqualTypeOf<
    | "not_found"
    | "conflict"
    | "not_target"
    | "lacks_capability"
    | "wrong_execution"
    | "wrong_state"
    | "wrong_process"
    | "bad_input"
    | "storage"
  >();
  // The error is a schema value of its own, so a refusal crosses a wire as the module wrote it.
  expectTypeOf<TasksError>().toEqualTypeOf<TasksError>();
  // G1: the index stream's name comes from a key alone, a protocol fact, never a setting.
  expectTypeOf<typeof TasksFront.targetStream>().toEqualTypeOf<(key: string) => string>();
});
