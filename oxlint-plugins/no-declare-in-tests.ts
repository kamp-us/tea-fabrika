// Ban `declare const`, `declare let` and `declare var` in test files (`*.test.ts` and `*.test-support.ts`).
//
// Why: `declare` makes a name for the type checker and writes no value. tsc passes, but vitest runs the file, and the first
// read of the name throws "ReferenceError: <name> is not defined" when the file loads. The type checker alone cannot tell.
//
// Fix: write a real value, take the value as a parameter of a function that is never called, or for a type-only check
// write `expectTypeOf<T>()`. A `declare function`, `declare module` and `declare global` stay allowed: they hold no value
// of a test's own.
//
// The scope is the `overrides` block of `.oxlintrc.json` for these two file kinds.
import type { CreateRule } from "@oxlint/plugins";

export const noDeclareInTests: CreateRule = {
  create(context) {
    return {
      VariableDeclaration(node) {
        if (!node.declare) {
          return;
        }

        context.report({
          node,
          message: `\`declare ${node.kind}\` gives a test file a name with no value: vitest runs the file, so reading it throws "ReferenceError: ... is not defined" while tsc passes. Write a real value, take it as a parameter of a function nothing calls, or for a type-only check write \`expectTypeOf<T>()\`.`,
        });
      },
    };
  },
};
