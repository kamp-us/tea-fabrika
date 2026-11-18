/**
 * The stand-in `Mutants` the laws run on: scripted mutants and a scripted report, and a count of what
 * it was asked. It runs nothing.
 */
import { Effect, Layer, Schema } from "effect";
import type { Made } from "./Mutants.ts";
import { Mutants } from "./Mutants.ts";
import type { Options } from "./Options.ts";
import { Refused, Report } from "./Report.ts";

/** What a run was asked, in order. */
interface Calls {
  readonly made: Array<{ readonly file: string; readonly text: string }>;
  readonly ran: Array<Options>;
}

/**
 * A layer that answers `make` with `script.made(file, text)` and `run` with `script.report(options)`,
 * the second a report in the shape Stryker writes, as plain data. `calls` lists what it was asked.
 *
 * @category constructors
 */
export const make = (script: {
  readonly made: (file: string, text: string) => ReadonlyArray<Made>;
  readonly report: (options: Options) => unknown;
}): { readonly layer: Layer.Layer<Mutants>; readonly calls: Calls } => {
  const calls: Calls = { made: [], ran: [] };

  return {
    calls,
    layer: Layer.succeed(Mutants, {
      plugin: "/plugins/vitest-runner.js",
      node: "v0.0.0",
      make: (file, text) =>
        Effect.sync(() => {
          calls.made.push({ file, text });

          return script.made(file, text);
        }),
      run: (options) =>
        Effect.sync(() => {
          calls.ran.push(options);
        }).pipe(
          Effect.flatMap(() => Schema.decodeUnknownEffect(Report)(script.report(options))),
          Effect.mapError(() => new Refused({ reason: "could_not_run", at: [] })),
        ),
    }),
  };
};
