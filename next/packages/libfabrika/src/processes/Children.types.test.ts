// T953 slice 2, next/: law L16 of the approved plan (docs/plan/lanes/t953-PLAN.md). The write step of a
// sender's start needs the proof in its context, so a start that skips `Rebac.provide(proof)` does not
// compile. The lead and CI run the compiler; Vitest does not typecheck, so the body holds type
// assertions only (0527).
//
// The plan's plant: delete `.pipe(Rebac.provide(...))` in ChildrenLedger.ts. Then `place` still needs
// `StartProgram`, and either ChildrenLedger.ts fails to compile or the layer's requirements grow, which
// the pinned layer type below refuses.
import { expectTypeOf, it } from "@effect/vitest";
import type { Effect, Layer } from "effect";
import type { LedgerTransaction } from "../ledger/LedgerTransaction.ts";
import type { StartProgram } from "../permissions/Model.ts";
import type * as Rebac from "../permissions/Rebac.ts";
import type { Relations } from "../permissions/Relations.ts";
import type { Senders } from "../permissions/Senders.ts";
import type { Children, ChildrenError, Started } from "./Children.ts";
import type * as ChildrenLedger from "./ChildrenLedger.ts";
import type { ProcessManager } from "./ProcessManager.ts";

/** A start whose write still needs its proof: what a start that skips `Rebac.provide(proof)` is. */
type Unproved = Effect.Effect<Started, ChildrenError, StartProgram>;

it("type: L16 a sender's start does not compile without its proof, and the layer needs no StartProgram", () => {
  expectTypeOf<ReturnType<typeof ChildrenLedger.layer>>().toEqualTypeOf<
    Layer.Layer<Children, never, LedgerTransaction | ProcessManager | Relations | Senders>
  >();
  expectTypeOf<Parameters<typeof ChildrenLedger.layer>[0]["fabrika"]>().toEqualTypeOf<Rebac.Ref<"fabrika">>();
  expectTypeOf<ReturnType<Children["Service"]["start"]>>().toEqualTypeOf<Effect.Effect<Started, ChildrenError>>();
  // A start that still needs StartProgram is not the service's start: provide the proof.
  expectTypeOf<Unproved>().not.toExtend<ReturnType<Children["Service"]["start"]>>();
});
