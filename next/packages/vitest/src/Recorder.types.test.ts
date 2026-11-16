// Ticket 1067, next/: laws R1 to R4 of docs/plan/quests/recorder-PLAN.md, the Recorder's types, and
// R14 to R17 of its first fix round (field/runs/2026-11-15-t1067-review1.json)
// (0579: typed against the service's interface). Only the compiler checks these: the lead's one
// `pnpm typecheck` reads them, and Vitest does not typecheck, so each body holds type checks only
// (0527). Each `@ts-expect-error` is a line that must not compile; a plant that lets it compile
// leaves the directive unused, which fails the typecheck.
//
// Plants, one per law: widen `Method<S>` to `string` (R1); make `Args` `ReadonlyArray<unknown>`
// (R2); make `Fails`' values `unknown` (R3); give `calls` an environment of `never` (R4); read
// `Args` without splitting it over each name (R14); read a member as `S[K]`, `undefined` and all
// (R15); drop the refusal of an overloaded method (R16); let `fails` name every method again (R17).
import { assertType, describe, expectTypeOf, it } from "@effect/vitest";
import type { Effect, Layer } from "effect";
import type * as Recorder from "./Recorder.ts";
import { Full, type Shelf, type ShelfId } from "./Shelf.test-support.ts";

type Service = Shelf["Service"];

/** A value of each method's own error type, and one of no service's. Made outside the laws. */
const full = new Full({ item: "the shelf is full" });
const plain = new Error("no Full");

/** A service with an optional effectful member, which a Recorder records when it runs. */
interface Spare {
  readonly put: (name: string) => Effect.Effect<void>;
  readonly maybe?: (count: number) => Effect.Effect<void, Full>;
}

/** A service with an overloaded method, whose args no one parameter list can type. */
interface Picker {
  readonly pick: {
    (name: string): Effect.Effect<string>;
    (index: number): Effect.Effect<number>;
  };
}

/** A service with a generic method: one parameter list, so it is no overload. */
interface Echo {
  readonly echo: <A>(value: A) => Effect.Effect<A>;
}

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

  it("R14 type: calls with a union of names answers each name's own arg list, so a wrong arg type does not compile", () => {
    type Both = Effect.Success<ReturnType<typeof Recorder.calls<Shelf, Service, "put" | "count">>>;
    expectTypeOf<Both>().toEqualTypeOf<
      ReadonlyArray<readonly [name: string, count: number] | readonly [name: string]>
    >();
    expectTypeOf<Recorder.Args<Service, "put" | "size">>().toEqualTypeOf<
      readonly [name: string, count: number] | readonly []
    >();
    expectTypeOf<Recorder.Failure<Service, "put" | "count">>().toEqualTypeOf<Full>();
    // @ts-expect-error R14: neither put nor count is handed a count first
    assertType<Both[number]>([1, "a"]);
  });

  it("R15 type: an optional effectful member is a method, typed as if it were there", () => {
    type Service = Spare;
    expectTypeOf<Recorder.Method<Service>>().toEqualTypeOf<"put" | "maybe">();
    expectTypeOf<Recorder.Args<Service, "maybe">>().toEqualTypeOf<readonly [count: number]>();
    expectTypeOf<Recorder.Failure<Service, "maybe">>().toEqualTypeOf<Full>();
    type MaybeCall = Extract<Recorder.Call<Service>, { readonly method: "maybe" }>;
    expectTypeOf<MaybeCall["args"]>().toEqualTypeOf<readonly [count: number]>();
    assertType<Recorder.Fails<Service>>({ maybe: full });
    // @ts-expect-error R15: maybe is handed a count, not a name
    assertType<Recorder.Call<Service>>({ method: "maybe", args: ["a"] });
  });

  it("R16 type: a service with an overloaded method does not compile as a Recorder layer, and a generic method does", () => {
    type Picking = Parameters<typeof Recorder.layer<Picker, Picker>>[1];
    // @ts-expect-error R16: pick is overloaded, so no one arg list types what it was handed
    assertType<Picking>({});
    assertType<Parameters<typeof Recorder.layer<Echo, Echo>>[1]>({});
    expectTypeOf<Recorder.Args<Echo, "echo">>().toEqualTypeOf<readonly [value: unknown]>();
  });

  it("R17 type: fails names only a method impl gives, and impl names only the service's own members", () => {
    type Data = Pick<Service, typeof ShelfId | "label" | "drain">;
    type Putting = Data & Pick<Service, "put">;
    type Counting = Data & Pick<Service, "count">;
    type Stray = Counting & { readonly nope: Service["count"] };
    type Options<P extends Layer.PartialEffectful<Service>> = NonNullable<
      Parameters<typeof Recorder.layer<Shelf, Service, P>>[2]
    >;
    // A method impl gives may fail.
    assertType<Options<Putting>>({ fails: { put: full } });
    // @ts-expect-error R17: put is left out of impl, so naming it in fails does not compile
    assertType<Options<Counting>>({ fails: { put: full } });
    // The same, when fails is a value typed for every method.
    expectTypeOf<{ readonly fails: Recorder.Fails<Service> }>().not.toExtend<Options<Counting>>();
    expectTypeOf<Putting>().toExtend<Parameters<typeof Recorder.layer<Shelf, Service, Putting>>[1]>();
    // nope is no member of Shelf.
    expectTypeOf<Stray>().not.toExtend<Parameters<typeof Recorder.layer<Shelf, Service, Stray>>[1]>();
  });
});
