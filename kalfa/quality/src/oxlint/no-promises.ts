/**
 * No Promise: the code is Effect all the way.
 *
 * The rule refuses `async`, `await` (and `for await`), `new Promise(...)`, any `Promise.x(...)` call, `.then(...)`,
 * `import(...)`, `.catch(...)` unless the object is a name imported from Effect (so `Effect.catch(...)` and
 * `Stream.catch(...)` pass), and Effect's own calls that take or make a Promise: `Effect.promise`, `Effect.tryPromise` in
 * either form, Schema's four `...Promise` decoders and encoders, and Stream's `fromAsyncIterable` and `toAsyncIterable`
 * with its two variants (Effect 4). Those are matched on `Effect`, `Schema` or `Stream` as written, or on any name
 * imported from Effect, with or without type arguments: `Effect.promise<number>(...)` counts.
 *
 * It sees four spellings of such a call:
 * - the module name as written: `Effect.promise(...)`, `Schema.decodePromise(...)`, `Stream.toAsyncIterable(...)`;
 * - a renamed named import: `import { Effect as E } from "effect"`, then `E.promise(...)`;
 * - a module namespace: `import * as E from "effect/Effect"`, then `E.promise(...)`;
 * - the member imported by its own name: `import { tryPromise } from "effect/Effect"`, then `tryPromise(...)`.
 *
 * It sees no types. It misses a call two names deep, `import * as X from "effect"`, then `X.Effect.promise(...)`: the
 * object of the call is a member and not a name. A `.catch` is told apart by the name it is called on, so an Effect module
 * bound to a name not imported from Effect, or a Promise reached through a helper, passes this syntax rule. A check with
 * types is the way to catch those.
 *
 * The one line a platform demands passes only under an edge comment,
 * `// oxlint-disable-next-line <this rule> -- edge: <why>`.
 */
import type { CreateRule, ESTree } from "@oxlint/plugins";
import { effectNames, type Node } from "./internal/Syntax.ts";

/** Effect 4's calls that take or make a Promise, by the name after the dot. */
const PROMISE_CALLS: ReadonlySet<string> = new Set([
  "promise",
  "tryPromise",
  "decodePromise",
  "encodePromise",
  "decodeUnknownPromise",
  "encodeUnknownPromise",
  "fromAsyncIterable",
  "toAsyncIterable",
  "toAsyncIterableWith",
  "toAsyncIterableEffect",
]);

/** The modules those calls live on, as written when the file does not import them by name. */
const MODULES: ReadonlySet<string> = new Set(["Effect", "Schema", "Stream"]);

/**
 * Refuses every Promise shape and each of Effect's calls that take or make a Promise.
 *
 * @category rules
 */
export const noPromises: CreateRule = {
  create(context) {
    const effect = effectNames(context.sourceCode.ast);

    const refuse = (node: Node, shape: string) =>
      context.report({
        node,
        message: `${shape}: this code is Effect all the way. Write it as an Effect, or mark the one line the platform demands with \`// oxlint-disable-next-line ${context.id} -- edge: <why>\`.`,
      });

    const asyncFn = (node: ESTree.Function | ESTree.ArrowFunctionExpression) => {
      if (node.async) {
        refuse(node, "An `async` function makes a Promise");
      }
    };

    return {
      FunctionDeclaration: asyncFn,
      FunctionExpression: asyncFn,
      ArrowFunctionExpression: asyncFn,
      AwaitExpression(node) {
        refuse(node, "`await` waits on a Promise");
      },
      ForOfStatement(node) {
        if (node.await) {
          refuse(node, "`for await` waits on Promises");
        }
      },
      ImportExpression(node) {
        refuse(node, "`import()` answers a Promise");
      },
      NewExpression(node) {
        if (node.callee.type === "Identifier" && node.callee.name === "Promise") {
          refuse(node, "`new Promise` makes a Promise");
        }
      },
      CallExpression(node) {
        const callee = node.callee;

        if (callee.type === "Identifier" && PROMISE_CALLS.has(callee.name)) {
          if (effect.has(callee.name)) {
            refuse(node, `\`${callee.name}\` takes or makes a Promise`);
          }

          return;
        }

        if (callee.type !== "MemberExpression" || callee.computed) {
          return;
        }

        if (callee.property.type !== "Identifier") {
          return;
        }

        const name = callee.property.name;
        const on = callee.object.type === "Identifier" ? callee.object.name : null;

        if (on !== null && PROMISE_CALLS.has(name) && (MODULES.has(on) || effect.has(on))) {
          refuse(node, `\`${on}.${name}\` takes or makes a Promise`);
        } else if (on === "Promise") {
          refuse(node, `\`Promise.${name}\` works on Promises`);
        } else if (name === "then") {
          refuse(node, "`.then` chains a Promise");
        } else if (name === "catch" && !(callee.object.type === "Identifier" && effect.has(callee.object.name))) {
          refuse(node, "`.catch` on something not imported from Effect is a Promise's");
        }
      },
    };
  },
};
