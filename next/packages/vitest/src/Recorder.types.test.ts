// Ticket 1067, next/: laws R1 to R4 of docs/plan/quests/recorder-PLAN.md, the Recorder's types
// (0579: typed against the service's interface). Only the compiler checks these: the lead's one
// `pnpm typecheck` reads them, and Vitest does not typecheck, so each body holds type checks only
// (0527). Each `@ts-expect-error` is a line that must not compile; a plant that lets it compile
// leaves the directive unused, which fails the typecheck.
//
// Plants, one per law: widen `Method<S>` to `string` (R1); make `Args` `ReadonlyArray<unknown>`
// (R2); make `Fails`' values `unknown` (R3); give `calls` an environment of `never` (R4).
import { assertType, describe, expectTypeOf, it } from "@effect/vitest";
import type { Effect, Layer } from "effect";
import type * as Recorder from "./Recorder.ts";
import { Full, type Shelf } from "./Shelf.test-support.ts";

type Service = Shelf["Service"];

/** A value of each method's own error type, and one of no service's. Made outside the laws. */
const full = new Full({ item: "the shelf is full" });
const plain = new Error("no Full");

describe("the Recorder's types follow the service's own interface (0579)", () => {
  it("R1 type: a method is exactly an effectful key of the service, and a name the service lacks does not compile in fails or in calls", () => {
    // Data (`label`), a Sink method (`drain`) and a symbol key are not methods.
    expectTypeOf<Recorder.Method<Service>>().toEqualTypeOf<"put" | "count" | "size" | "watch">();
    type _Put = typeof Recorder.calls<Shelf, Service, "put">;
    // @ts-expect-error R1: `nope` is no member of Shelf
    type _Nope = typeof Recorder.calls<Shelf, Service, "nope">;
    // @ts-expect-error R1: `label` is plain data, not a method
    type _Label = typeof Recorder.calls<Shelf, Service, "label">;
    // @ts-expect-error R1: `drain` answers a Sink, which is not watched
    type _Drain = typeof Recorder.calls<Shelf, Service, "drain">;
    // @ts-expect-error R1: `nope` is no member of Shelf
    assertType<Recorder.Fails<Service>>({ nope: full });
  });

  it("R2 type: a method's args are its own parameter list, so a wrong arg type does not compile", () => {
    type Puts = Effect.Success<ReturnType<typeof Recorder.calls<Shelf, Service, "put">>>;
    expectTypeOf<Puts>().toEqualTypeOf<ReadonlyArray<readonly [name: string, count: number]>>();
    expectTypeOf<Recorder.Args<Service, "count">>().toEqualTypeOf<readonly [name: string]>();
    // The Effect member is handed nothing.
    expectTypeOf<Recorder.Args<Service, "size">>().toEqualTypeOf<readonly []>();
    // A check on `method` narrows `args` to that method's list.
    type PutCall = Extract<Recorder.Call<Service>, { readonly method: "put" }>;
    expectTypeOf<PutCall["args"]>().toEqualTypeOf<readonly [name: string, count: number]>();
    expectTypeOf<readonly [1, "a"]>().not.toExtend<Recorder.Args<Service, "put">>();
    // @ts-expect-error R2: put's args are a name then a count, not a count then a name
    assertType<Recorder.Call<Service>>({ method: "put", args: [1, "a"] });
  });

  it("R3 type: fails takes only each method's own error type, and a method that cannot fail cannot be named", () => {
    expectTypeOf<Recorder.Failure<Service, "put">>().toEqualTypeOf<Full>();
    expectTypeOf<Recorder.Failure<Service, "size">>().toEqualTypeOf<Full>();
    expectTypeOf<Recorder.Failure<Service, "watch">>().toEqualTypeOf<Full>();
    expectTypeOf<Recorder.Failure<Service, "count">>().toBeNever();
    assertType<Recorder.Fails<Service>>({ put: full, size: full, watch: full });
    // @ts-expect-error R3: put fails with Full, never with a plain Error
    assertType<Recorder.Fails<Service>>({ put: plain });
    // @ts-expect-error R3: count cannot fail, so no value may be given for it
    assertType<Recorder.Fails<Service>>({ count: full });
  });

  it("R4 type: the layer provides the service and its record, and calls needs that record, so the plain service alone does not do", () => {
    type Made = ReturnType<typeof Recorder.layer<Shelf, Service>>;
    expectTypeOf<Made>().toEqualTypeOf<Layer.Layer<Shelf | Recorder.Recorded<Shelf>>>();
    type Reads = ReturnType<typeof Recorder.calls<Shelf, Service>>;
    expectTypeOf<Effect.Services<Reads>>().toEqualTypeOf<Recorder.Recorded<Shelf>>();
    expectTypeOf<Effect.Services<Reads>>().not.toBeNever();
    // A context with only the plain Shelf in it does not hold what calls needs.
    expectTypeOf<Shelf>().not.toExtend<Effect.Services<Reads>>();
  });
});
