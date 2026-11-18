// Stryker as a service (decision 0600): the mutants it makes on a file, and a run of it. This file
// is the contract only (0095); `node/MutantsStryker.ts` is the real layer and `MutantsMemory.ts` the
// stand-in the laws run on.
import { Context } from "effect";
import type { Effect } from "effect";
import type { Options } from "./Options.ts";
import type { Refused, Report } from "./Report.ts";

/**
 * One mutant as Stryker's instrumenter makes it: lines and columns both counted from 0, the span
 * being the mutated node's own text. (A report counts both from 1, and a `mutate` range lines from
 * 1 and columns from 0: `Report.ts` and `Options.ts` keep the three apart.)
 */
export interface Made {
  readonly mutatorName: string;
  readonly replacement: string;
  readonly location: {
    readonly start: { readonly line: number; readonly column: number };
    readonly end: { readonly line: number; readonly column: number };
  };
}

export class Mutants extends Context.Service<
  Mutants,
  {
    /** Where the vitest runner plugin is, as a path Stryker can load. */
    readonly plugin: string;
    /** Every mutant Stryker makes on the whole of `text`, a file named `file`. Nothing runs. */
    readonly make: (file: string, text: string) => Effect.Effect<ReadonlyArray<Made>, Refused>;
    /** Stryker on `options`, its JSON report read back. Fails as `could_not_run` when it never started or wrote none. */
    readonly run: (options: Options) => Effect.Effect<Report, Refused>;
  }
>()("@kalfa/quality/stryker/Mutants") {}
