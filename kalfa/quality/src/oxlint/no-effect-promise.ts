/**
 * Bans `Effect.promise(...)` and single-argument `Effect.tryPromise(...)`, and asks for the object notation
 * `Effect.tryPromise({ try, catch })` with an explicit tagged-error `catch`.
 *
 * `Effect.promise` and the single-argument `Effect.tryPromise(() => p)` carry no `catch`, so a rejection surfaces as an
 * uncatchable defect with an empty `E` channel instead of a typed, recoverable failure. The object form forces a `catch`
 * that maps the cause into a tagged error, keeping the failure in `E`.
 *
 * The discriminator: the object form's sole argument is an object literal, and the thunk form is anything else (an
 * arrow, a function expression, a bare name). So `Effect.tryPromise(x)` is refused when its one argument is not an
 * object literal, and the object-notation call is left alone. A call with no argument, with more than one, or with the
 * object in parentheses is refused too.
 */
import type { CreateRule } from "@oxlint/plugins";
import { grouped, plainCall } from "./internal/Syntax.ts";

/**
 * Refuses `Effect.promise` and each `Effect.tryPromise` that is not one plain object.
 *
 * @category rules
 */
export const noEffectPromise: CreateRule = {
  create(context) {
    const exception = `Exception: // oxlint-disable-next-line ${context.id} -- <reason>.`;

    return {
      CallExpression(node) {
        const name = plainCall(node);

        if (name === "Effect.promise") {
          context.report({
            node: node.arguments[0] ?? node,
            message: `\`Effect.promise(...)\` is discouraged: a rejection becomes an uncatchable defect with an empty error channel. Fix: use object-notation \`Effect.tryPromise({ try, catch: (cause) => new SomeError({ cause }) })\` with a \`Schema.TaggedError\`, or lift the pure core to an \`Effect.fn\` returning a typed \`Effect\`. ${exception}`,
          });
        }

        if (name === "Effect.tryPromise") {
          const [only] = node.arguments;

          const isObject =
            node.arguments.length === 1 && only?.type === "ObjectExpression" && grouped(context.sourceCode, only) === 0;

          if (isObject) {
            return;
          }

          context.report({
            node: only ?? node,
            message: `Single-arg \`Effect.tryPromise(() => ...)\` is discouraged: with no \`catch\` a rejection becomes an uncatchable defect with an empty error channel. Fix: use object-notation \`Effect.tryPromise({ try, catch: (cause) => new SomeError({ cause }) })\` with a \`Schema.TaggedError\`. ${exception}`,
          });
        }
      },
    };
  },
};
