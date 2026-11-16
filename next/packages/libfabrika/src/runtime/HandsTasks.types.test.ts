// P39 slice 3 (ticket 1040), next/, T1 (0095, 0043): `HandsTasks.ts` holds the contract the runner
// talks to, in the runtime module's own types and error and the shared names. The tasks module's
// `TasksError` and the ledger's `LedgerError` are translated at the service, never part of it, and
// its one layer is the sibling `HandsTasksLive.ts`, read through its module. CI's typecheck is this
// law's runner. Plant (after build): put `TasksError` in `ask`'s error channel.
import { expectTypeOf, it } from "@effect/vitest";
import type { Context, Effect, Layer } from "effect";
import type { From } from "../processes/Mailbox.ts";
import type { Tasks, TasksError } from "../tasks/Tasks.ts";
import type * as HandsTasksFront from "./HandsTasks.ts";
import type { Ask, HandsTasks, HandsTasksError, Reply } from "./HandsTasks.ts";
import type * as HandsTasksLive from "./HandsTasksLive.ts";

it("type: T1 HandsTasks speaks its own error and shared names only, never TasksError or LedgerError", () => {
  // The one call, as the contract writes it. A tasks or ledger error in its error channel fails here.
  expectTypeOf<Context.Service.Shape<typeof HandsTasks>>().toEqualTypeOf<{
    readonly ask: (ask: typeof Ask.Type, from: From) => Effect.Effect<typeof Reply.Type, HandsTasksError>;
  }>();
  expectTypeOf<Extract<HandsTasksError, TasksError>>().toEqualTypeOf<never>();
  // Its reasons are its own, and each may pass: a lost or failed call, or a failed read or write.
  expectTypeOf<HandsTasksError["reason"]>().toEqualTypeOf<"storage" | "unavailable">();
  // The answer is one of three cases, each the runner's to read.
  expectTypeOf<(typeof Reply.Type)["_tag"]>().toEqualTypeOf<"waiting" | "finished" | "refused">();
  // A refusal is for good, and an answer: no hands key, or a task under the id that is not this process's.
  expectTypeOf<Extract<typeof Reply.Type, { _tag: "refused" }>["reason"]>().toEqualTypeOf<"no_hands" | "id_reused">();
  // The layer serves HandsTasks over the tasks service, and fails with nothing of its own while built.
  type Live = ReturnType<typeof HandsTasksLive.layer>;
  expectTypeOf<Layer.Success<Live>>().toEqualTypeOf<HandsTasks>();
  expectTypeOf<Layer.Error<Live>>().toEqualTypeOf<never>();
  expectTypeOf<Layer.Services<Live>>().toEqualTypeOf<Tasks>();
  // No static layer on the class, and the contract module exports no layer.
  expectTypeOf<"layer" extends keyof typeof HandsTasks ? true : false>().toEqualTypeOf<false>();
  expectTypeOf<"layer" extends keyof typeof HandsTasksFront ? true : false>().toEqualTypeOf<false>();
  // The error is a schema value of its own, so it crosses the Project RPC as the module wrote it.
  expectTypeOf<HandsTasksError>().toEqualTypeOf<HandsTasksError>();
});
