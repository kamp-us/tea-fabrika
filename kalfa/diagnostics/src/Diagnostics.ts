/**
 * The service a package reports diagnostics to, and `report`.
 *
 * **Details**
 *
 * This file holds the contract only. Whoever runs the handler provides it: a command that prints, or the test Layer in `TestDiagnostics`. The package never prints and never logs.
 */
import { Context, Effect, Schema } from "effect";
import * as Diagnostic from "./Diagnostic.ts";

/**
 * Service that takes each diagnostic a package reports.
 *
 * @category services
 */
export class Diagnostics extends Context.Service<
  Diagnostics,
  { readonly report: (diagnostic: Diagnostic.Reported) => Effect.Effect<void> }
>()("@kalfa/diagnostics/Diagnostics") {}

/**
 * The fields of a report beside its code, as a caller writes them.
 *
 * @category models
 */
export type Fields = Omit<typeof Diagnostic.Reported.Encoded, "code">;

/**
 * Reports one diagnostic through a declared code.
 *
 * **When to use**
 *
 * Use when a handler finds something to say about a place.
 *
 * **Details**
 *
 * The report is checked as a whole before the service sees it. A blank message or hint, or a bad place, is a bug in the reporting code and not a condition a caller can handle, so the effect dies with the SchemaError that names the field, and nothing is reported.
 *
 * **Example** (Reporting a diagnostic)
 *
 * ```ts
 * import * as Diagnostics from "@kalfa/diagnostics/Diagnostics"
 * import { UnknownSetting } from "./codes.ts"
 *
 * export const warn = Diagnostics.report(UnknownSetting, {
 *   severity: "error",
 *   message: "The setting `service.prot` is not declared.",
 *   place: { path: ".config/settings.toml", line: 4 },
 *   hint: "Did you mean `service.port`?"
 * })
 * ```
 *
 * @category reporting
 */
export const report = Effect.fn("Diagnostics.report")(function* (
  declared: Diagnostic.Declared,
  fields: Fields,
): Effect.fn.Return<void, never, Diagnostics> {
  const reported = yield* Schema.decodeUnknownEffect(Diagnostic.Reported)({ ...fields, code: declared.code }).pipe(
    Effect.orDie,
  );

  yield* Effect.annotateCurrentSpan({ code: reported.code, severity: reported.severity });

  const diagnostics = yield* Diagnostics;

  yield* diagnostics.report(reported);
});
