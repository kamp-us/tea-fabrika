/**
 * The trusted hook before a supervised program step.
 */
import * as Context from "effect/Context";
import type * as Effect from "effect/Effect";

/**
 * Identifies the letter and whether this attempt folds saved history.
 *
 * @category models
 */
export type Before = {
  readonly name: string;
  readonly process: string;
  readonly letter: string;
  readonly phase: "fresh" | "saved";
};

/**
 * Allows trusted wiring to fail a step with its original defect.
 *
 * @category services
 */
export class StepFault extends Context.Service<
  StepFault,
  { readonly before: (input: Before) => Effect.Effect<void> }
>()("@kampus/libfabrika/runtime/StepFault") {}
