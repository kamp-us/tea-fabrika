/**
 * The service a package reports diagnostics to, and `report`.
 *
 * **Details**
 *
 * This file holds the contract only. Whoever runs the handler provides it: a command that prints, or the test Layer in `TestDiagnostics`. The package never prints and never logs.
 */
import { Context, Effect, Schema } from "effect";
import * as Diagnostic from "./Diagnostic.ts";

// A reported diagnostic that came through `report`: its code was declared with `make`, and its fields passed
// `Reported`. The brand is declared, never made: no value outside this file can carry it, and it adds nothing at
// run time, so the value is a plain `Reported`. Neither name is exported.
declare const checked: unique symbol;

type Checked = Diagnostic.Reported & { readonly [checked]: true };

/**
 * Service that takes each diagnostic a package reports.
 *
 * **Details**
 *
 * The method takes only what `report` hands it, so no caller can skip `report`. A provider reads every field of a `Diagnostic.Reported`, and its function may be written over that type.
 *
 * @category services
 */
export class Diagnostics extends Context.Service<
  Diagnostics,
  { readonly report: (diagnostic: Checked) => Effect.Effect<void> }
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
 * Use when a handler finds something to say about a place, or when it handles an error that carries a diagnostic, read with `Diagnostic.fromError`.
 *
 * **Details**
 *
 * The report is checked as a whole before the service sees it, and the service takes nothing that did not come through here. A blank message or hint, or a bad place, is a bug in the reporting code and not a condition a caller can handle, so the effect dies with the SchemaError that names the field, and nothing is reported.
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
 *   place: { _tag: "repo", path: ".config/settings.toml", line: 4 },
 *   hint: "Did you mean `service.port`?"
 * })
 * ```
 *
 * @category reporting
 */
export const report = Effect.fn("diagnostics.report")(function* (
  declared: Diagnostic.Declared,
  fields: Fields,
): Effect.fn.Return<void, never, Diagnostics> {
  const reported = yield* Schema.decodeUnknownEffect(Diagnostic.Reported)({ ...fields, code: declared.code }).pipe(
    Effect.orDie,
  );

  yield* Effect.annotateCurrentSpan({
    "kalfa.diagnostics.code": reported.code,
    "kalfa.diagnostics.severity": reported.severity,
    // Only the kind of place, "repo", "home", "environment" or "flag": never a path or a name.
    "kalfa.diagnostics.place.type": reported.place._tag,
  });

  const diagnostics = yield* Diagnostics;

  // SAFETY: the one place the brand goes on. The code came from a Declared, and the fields just passed Reported.
  yield* diagnostics.report(reported as Checked);
});
