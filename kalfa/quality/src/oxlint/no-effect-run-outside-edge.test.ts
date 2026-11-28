// Law O5 of .kalfa/quests/kalfa-quality-oxlint-PLAN.md: `no-effect-run-outside-edge` refuses every run name the installed
// Effect exports, as a bare call, a member call and a runtime's method, and passes `NodeRuntime.runMain`. The names are
// read from the installed `effect` at test time: each `run*` export of `effect/Effect`, and `runtimePromise` and
// `makeRuntimePromise` of `FiberSet`, `FiberMap` and `FiberHandle`. Each generated file holds every name once, each
// under a drawn call form, so no name goes unreached. A line under a disable comment is oxlint's own work, not the
// rule's, and RuleTester does not run it: law M1 holds it against the real oxlint.
//
// Plants, each run once on no-effect-run-outside-edge.ts and undone:
// - drop `runSyncExitWith` from the list: its line stops firing;
// - match member calls only: a bare `runFork(e)` stops firing;
// - drop the `callee.property.type === "Identifier"` check: a private member call `this.#runSync(e)` fires.
import { it } from "@effect/vitest";
import { Array as Arr } from "effect";
import * as Effect from "effect/Effect";
import * as FiberHandle from "effect/FiberHandle";
import * as FiberMap from "effect/FiberMap";
import * as FiberSet from "effect/FiberSet";
import * as fc from "fast-check";
import { noEffectRunOutsideEdge } from "./no-effect-run-outside-edge.ts";
import { check, type Line } from "./Tester.test-support.ts";

const runtimePromises = (module: object): ReadonlyArray<string> =>
  Arr.filter(Object.keys(module), (name) => name.endsWith("untimePromise"));

/** Every name the installed Effect runs an Effect by: the twelve of `effect/Effect` and each fiber collection's two runner makers. */
const NAMES: ReadonlyArray<string> = Arr.dedupe([
  ...Arr.filter(Object.keys(Effect), (name) => name.startsWith("run")),
  ...runtimePromises(FiberSet),
  ...runtimePromises(FiberMap),
  ...runtimePromises(FiberHandle),
]);

/** How a call is written: bare, a member of a module, a method of a runtime, of one a class holds, and the call a runner makes. */
const FORMS: ReadonlyArray<(name: string) => string> = [
  (name) => `${name}(e);`,
  (name) => `Effect.${name}(e);`,
  (name) => `runtime.${name}(e);`,
  (name) => `this.runtime.${name}(e);`,
  (name) => `FiberSet.${name}(set)();`,
];

/** Calls that start with `run` and run nothing the rule refuses: `NodeRuntime.runMain` starts a program and needs no edge. */
const PASSES: ReadonlyArray<string> = [
  'NodeRuntime.runMain(Effect.log("dev"));',
  "Effect.succeed(1);",
  "runtime.runLater(e);",
  "Effect.runnable(e);",
  // A private member is a name of its class, not the run function of the same name.
  "export class Own { #runSync(e: unknown) { return e; } m(e: unknown) { return this.#runSync(e); } }",
];

it("O5 no-effect-run-outside-edge: refuses every run name the installed Effect exports, in every call form, and passes runMain", () => {
  fc.assert(
    fc.property(
      fc.array(fc.nat({ max: FORMS.length - 1 }), { minLength: NAMES.length, maxLength: NAMES.length }),
      (forms) => {
        const lines: ReadonlyArray<Line> = [
          ...Arr.map(NAMES, (name, i): Line => [FORMS[forms[i]!]!(name), 1]),
          ...Arr.map(PASSES, (text): Line => [text, 0]),
        ];

        check("no-effect-run-outside-edge", noEffectRunOutsideEdge, lines);
      },
    ),
    { seed: 119120, numRuns: 100 },
  );
});
