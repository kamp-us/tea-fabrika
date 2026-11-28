/**
 * An Effect runs only at an edge the platform demands.
 *
 * The rule refuses a call to any of Effect's run functions, `Effect.runPromise(...)`, `runFork(...)` or
 * `this.runtime.runSync(...)` alike. A `ManagedRuntime` has the same method names, so the object a call is made on does
 * not matter. `runtimePromise` and `makeRuntimePromise` (on `FiberSet`, `FiberMap` and `FiberHandle`) count too: each
 * makes a function that runs an Effect into a Promise. `NodeRuntime.runMain` is not on the list: a program that starts
 * with it needs no edge.
 *
 * There is no list of edge files. The one line a platform demands passes only under an edge comment where it stands,
 * `// oxlint-disable-next-line <this rule> -- edge: <why>`.
 */
import type { CreateRule } from "@oxlint/plugins";

/**
 * Effect 4's run functions (`effect/Effect`), which a `ManagedRuntime` also has as methods, and the two that make a
 * runner for a fiber set, map or handle.
 */
const RUNS = new Set([
  "runCallback",
  "runCallbackWith",
  "runFork",
  "runForkWith",
  "runPromise",
  "runPromiseExit",
  "runPromiseExitWith",
  "runPromiseWith",
  "runSync",
  "runSyncExit",
  "runSyncExitWith",
  "runSyncWith",
  "runtimePromise",
  "makeRuntimePromise",
]);

/**
 * Refuses a call to any of Effect's run functions.
 *
 * @category rules
 */
export const noEffectRunOutsideEdge: CreateRule = {
  create(context) {
    return {
      CallExpression(node) {
        const callee = node.callee;

        const name =
          callee.type === "Identifier"
            ? callee.name
            : callee.type === "MemberExpression" && !callee.computed && callee.property.type === "Identifier"
              ? callee.property.name
              : null;

        if (name === null || !RUNS.has(name)) {
          return;
        }

        context.report({
          node,
          message: `\`${name}\` runs an Effect. Hand the Effect back to your caller. Where the platform demands it, mark that one line with \`// oxlint-disable-next-line ${context.id} -- edge: <why>\`.`,
        });
      },
    };
  },
};
