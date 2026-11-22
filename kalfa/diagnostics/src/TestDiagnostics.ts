/**
 * The test Layer that collects the diagnostics a program reports, and the read of them.
 *
 * **Details**
 *
 * This file holds a service and its Layer together, as Effect's own `TestConsole` does. That differs from a product service, whose file holds only its contract: a test module is never in a product's bundle, and one import gives a law both the Layer and the read. It holds no helper that checks a message's wording.
 */
import { Array as Arr, Context, Effect, Layer, Ref } from "effect";
import type * as Diagnostic from "./Diagnostic.ts";
import * as Diagnostics from "./Diagnostics.ts";

/**
 * Service that reads back the diagnostics reported under `layer`, in the order they were reported.
 *
 * @category services
 */
export class TestDiagnostics extends Context.Service<
  TestDiagnostics,
  { readonly reported: Effect.Effect<ReadonlyArray<Diagnostic.Reported>> }
>()("@kalfa/diagnostics/TestDiagnostics") {}

/**
 * Layer that provides `Diagnostics` and collects what is reported through it.
 *
 * **Details**
 *
 * Each build starts empty and keeps every report in order, repeats too. The `Diagnostics` service and the `TestDiagnostics` read share one list.
 *
 * @category layers
 */
export const layer: Layer.Layer<Diagnostics.Diagnostics | TestDiagnostics> = Layer.effectContext(
  Effect.map(Ref.make<ReadonlyArray<Diagnostic.Reported>>([]), (seen) =>
    Context.make(Diagnostics.Diagnostics, {
      report: (diagnostic) => Ref.update(seen, Arr.append(diagnostic)),
    }).pipe(Context.add(TestDiagnostics, { reported: Ref.get(seen) })),
  ),
);

/**
 * Reads the diagnostics reported so far under `layer`, in order.
 *
 * **When to use**
 *
 * Use when a test checks what the code under test reported.
 *
 * **Example** (Reading what was reported)
 *
 * ```ts
 * import { Effect } from "effect"
 * import * as TestDiagnostics from "@kalfa/diagnostics/TestDiagnostics"
 *
 * export const seen = Effect.flatMap(TestDiagnostics.reported, (list) => Effect.succeed(list.length)).pipe(
 *   Effect.provide(TestDiagnostics.layer)
 * )
 * ```
 *
 * @category testing
 */
export const reported: Effect.Effect<ReadonlyArray<Diagnostic.Reported>, never, TestDiagnostics> = TestDiagnostics.use(
  (service) => service.reported,
);
