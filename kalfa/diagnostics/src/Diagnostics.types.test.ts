// D8, D9 and D16: the public types of `report`, of the test Layer and of the service's own method. They are
// checked by the compiler, not by a test run.
import { expectTypeOf, it } from "@effect/vitest";
import { type Context, Effect, type Layer } from "effect";
import type * as Diagnostic from "./Diagnostic.ts";
import * as Diagnostics from "./Diagnostics.ts";
import * as TestDiagnostics from "./TestDiagnostics.ts";

type Fields = Parameters<typeof Diagnostics.report>[1];

const reportContract = (declared: Diagnostic.Declared) => {
  const fields: Fields = { severity: "error", message: "m", place: { path: "." }, hint: "h" };

  // D8 plant: widen the first parameter to `Declared | string`, and the string line compiles.
  expectTypeOf(Diagnostics.report(declared, fields)).toEqualTypeOf<
    Effect.Effect<void, never, Diagnostics.Diagnostics>
  >();
  expectTypeOf<Fields["severity"]>().toEqualTypeOf<"error" | "warning">();
  expectTypeOf<"code" extends keyof Fields ? true : false>().toEqualTypeOf<false>();

  // @ts-expect-error a code written as a string is not a declared code
  expectTypeOf(Diagnostics.report("config/unknown-setting", fields)).toBeObject();
  // @ts-expect-error an object with a code and a text is not a declared code: only `make` builds one
  expectTypeOf(Diagnostics.report({ code: "config/unknown-setting", explain: "A long text." }, fields)).toBeObject();
  // @ts-expect-error a report with no hint
  expectTypeOf(Diagnostics.report(declared, { severity: "error", message: "m", place: { path: "." } })).toBeObject();
  // @ts-expect-error a severity other than error and warning
  expectTypeOf(Diagnostics.report(declared, { ...fields, severity: "info" })).toBeObject();
};

const testLayerContract = () => {
  // D9 plant: read through a cast with `never` as its requirement, as TestConsole does, and the last check fails.
  expectTypeOf(TestDiagnostics.layer).toEqualTypeOf<
    Layer.Layer<Diagnostics.Diagnostics | TestDiagnostics.TestDiagnostics>
  >();
  expectTypeOf(TestDiagnostics.reported).toEqualTypeOf<
    Effect.Effect<ReadonlyArray<Diagnostic.Reported>, never, TestDiagnostics.TestDiagnostics>
  >();

  // A read with no test Layer is an Effect that still needs one, so it is no Effect that needs nothing.
  expectTypeOf(TestDiagnostics.reported).not.toExtend<Effect.Effect<ReadonlyArray<Diagnostic.Reported>>>();
};

it("D8 type: report takes only a declared code and the fields beside it", () => {
  // These compile-time laws need tsc, which the lead runs after the build.
  expectTypeOf(reportContract).toBeFunction();
});

it("D9 type: the test Layer provides both services and a read needs the test service", () => {
  // These compile-time laws need tsc, which the lead runs after the build.
  expectTypeOf(testLayerContract).toBeFunction();
});

type Service = Context.Service.Shape<typeof Diagnostics.Diagnostics>;

const serviceContract = (service: Service, decoded: Diagnostic.Reported) => {
  // D16 plant: widen the service method's parameter back to `Diagnostic.Reported`, or keep it but drop the
  // brand, or give the brand an optional key: both lines below compile, and their `@ts-expect-error` is unused.
  // @ts-expect-error a value decoded with the public Schemas is not what `report` hands the service
  expectTypeOf(service.report(decoded)).toBeObject();
  // @ts-expect-error nor is one that never passed `report`'s checks: a blank message and hint and a bad place
  expectTypeOf(service.report({ ...decoded, message: "", hint: "", place: { path: "/etc/../x" } })).toBeObject();

  // A provider may read every field without naming the brand: a function over the wider type fits.
  const provider = (diagnostic: Diagnostic.Reported): Effect.Effect<void> =>
    Effect.sync(() => {
      void [diagnostic.code, diagnostic.severity, diagnostic.message, diagnostic.place, diagnostic.hint];
    });

  expectTypeOf(provider).toExtend<Service["report"]>();
};

it("D16 type: only report hands the service a diagnostic", () => {
  // These compile-time laws need tsc, which the lead runs after the build.
  expectTypeOf(serviceContract).toBeFunction();
});
