// T953 slice 1, next/: the permission core's type laws L5 to L7 (docs/plan/quests/t953-PLAN.md). Compile
// the exact bad lines; never execute them. The lead and CI run the compiler (`pnpm typecheck`);
// Vitest does not typecheck, so these bodies hold type assertions only (0527).
//
// The contract: `Model.ts` exports fabrika's `Model` and the `StartProgram` right; `Rebac.ts` exports
// `make`, `Permission`, `provide`, `recheck` and `Denied`, and never `mint`, which stays in
// `internal/proof.ts`. A right's class is the context tag of its proof (phoenix's capability, 0107).
import { expectTypeOf, it } from "@effect/vitest";
import type * as Effect from "effect/Effect";
import type * as Result from "effect/Result";
import { Model, StartProgram } from "./Model.ts";
import * as Rebac from "./Rebac.ts";
import type { Tuples } from "./Relation.ts";
import { RelationsError } from "./Relations.ts";
import type { Sender } from "./Senders.ts";

type Passed<R> = R extends Result.Result<infer A, unknown> ? A : never;
type Refused<R> = R extends Result.Result<unknown, infer E> ? E : never;

/** A second right on the same permission and object type: only its id tells it apart. */
class Other extends Rebac.Permission<Other>()("t953/Other", { model: Model, on: "fabrika", permission: "start" }) {}

type StartProof = Passed<ReturnType<typeof StartProgram.within>>;
type OtherProof = Passed<ReturnType<typeof Other.within>>;

/** The values the assertions read. Never called: its body is checked by the compiler only. */
const shapes = (proof: StartProof, other: OtherProof) => {
  const needs = StartProgram;
  return {
    needs,
    provided: needs.pipe(Rebac.provide(proof)),
    wrong: needs.pipe(Rebac.provide(other)),
  };
};

type Shapes = ReturnType<typeof shapes>;

/** L6's names the model does not declare. Never called. */
const undeclared = () => {
  // @ts-expect-error "window" is not an object type of fabrika's model.
  const window = Model.ref("window", "w1");
  const model = Rebac.make("t953-names")
    .type("person", {})
    .type("fabrika", {
      relations: { owner: ["person"] },
      // @ts-expect-error "drive" is no relation or permission of the fabrika type.
      permissions: { start: (p) => p.union("drive") },
    });
  const robots = Rebac.make("t953-robots")
    .type("person", {})
    .type("fabrika", {
      // @ts-expect-error "robot" is not an object type this model declares.
      relations: { owner: ["robot"] },
    });
  // @ts-expect-error the fabrika type declares no permission "view".
  class View extends Rebac.Permission<View>()("t/View", { model: Model, on: "fabrika", permission: "view" }) {}
  // @ts-expect-error the model declares no object type "window" to put a right on.
  class Drive extends Rebac.Permission<Drive>()("t/Drive", { model: Model, on: "window", permission: "start" }) {}
  return [window, model, robots, View, Drive];
};

/** L7's ways to make a proof without a check. Never called. */
const forged = (sender: Sender, tuples: Tuples) => {
  // @ts-expect-error a proof is never an object literal: its brand is a symbol only the module holds.
  const literal: StartProof = { sender, permission: "start", object: "fabrika:demo" };
  // @ts-expect-error `mint` stays in internal/proof.ts; the module's front file does not export it.
  const minted = Rebac.mint(sender, "start", "fabrika:demo", StartProgram);
  // A proof that passes is only ever the answer of a check.
  const checked = StartProgram.within(tuples, sender, Model.ref("fabrika", "demo"));
  return { literal, minted, checked };
};

/**
 * T1062 slice 1, L3 (docs/plan/quests/error-cause-PLAN.md, decision 0568): all three sites that make
 * a `RelationsError` pass a cause (`RelationsLedger.ts:46`, `:64`, `RelationsMemory.ts:39`), so its
 * cause is required and a fourth site cannot leave it out. Never called.
 * Plant: make `Relations.ts:27` optional again; the `@ts-expect-error` goes unused and the typecheck fails.
 */
const uncaused = (cause: unknown) => {
  // @ts-expect-error every caller of RelationsError has a cause, so the field is required (0568).
  const bare = RelationsError.make({ reason: "storage" });
  const kept = RelationsError.make({ reason: "bad_row", cause });
  return { bare, kept };
};

it("type: L5 a step that yields StartProgram needs it, provide removes it, and another right's proof does not", () => {
  expectTypeOf<Effect.Services<Shapes["needs"]>>().toEqualTypeOf<StartProgram>();
  expectTypeOf<Effect.Success<Shapes["needs"]>>().toEqualTypeOf<StartProof>();
  expectTypeOf<Effect.Services<Shapes["provided"]>>().toBeNever();
  expectTypeOf<Effect.Services<Shapes["wrong"]>>().toEqualTypeOf<StartProgram>();
  expectTypeOf<OtherProof>().not.toEqualTypeOf<StartProof>();
  expectTypeOf<Other>().not.toEqualTypeOf<StartProgram>();
  expectTypeOf(shapes).toBeFunction();
});

it("type: L6 a type, relation or permission the model does not declare does not compile", () => {
  // A ref takes exactly the types the model declares, and names its type in its own.
  expectTypeOf<Parameters<typeof Model.ref>[0]>().toEqualTypeOf<"person" | "fabrika">();
  expectTypeOf<Rebac.Ref<"fabrika">>().toEqualTypeOf<`fabrika:${string}`>();
  expectTypeOf(undeclared).toBeFunction();
});

it("type: L7 no code outside the module makes a proof: no literal, no mint, only a check", () => {
  expectTypeOf<ReturnType<typeof forged>["checked"]>().toEqualTypeOf<Result.Result<StartProof, Rebac.Denied>>();
  expectTypeOf<Refused<ReturnType<typeof StartProgram.within>>>().toEqualTypeOf<Rebac.Denied>();
  expectTypeOf<"mint" extends keyof typeof Rebac ? true : false>().toEqualTypeOf<false>();
});

it("type: T1062 L3 a RelationsError is never made without its cause, and its cause is any value", () => {
  expectTypeOf<RelationsError["cause"]>().toEqualTypeOf<unknown>();
  expectTypeOf<ReturnType<typeof uncaused>["kept"]>().toEqualTypeOf<RelationsError>();
  expectTypeOf(uncaused).toBeFunction();
});
