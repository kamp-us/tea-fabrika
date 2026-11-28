/**
 * Forbids the type-assertion forms that fully erase type information.
 *
 * Type assertions blind the TypeScript compiler: they assert a shape it can no longer verify. Decode at boundaries with
 * `Schema.decodeUnknownSync`, or type the value properly. The rule bans:
 * - `as any`, which disables checking on the whole expression;
 * - the double cast through the top or bottom type, in every spelling: `x as unknown as T`, `(x as unknown) as T`,
 *   `x as never as T`, `(x as never) as T`. The inner `as unknown` or `as never` launders the value past the compiler, so
 *   the outer cast to `T` is unchecked. One pair of parentheses around the inner cast does not change that;
 * - `<T>x`, the angle-bracket cast, which erases the same as `x as T` and is harder to find.
 *
 * Out of scope, since the rule sees no types and cannot tell a safe narrowing from an unsafe one: `as const`, which
 * narrows to a literal or readonly type and adds information, and a single `x as SomeType`, a plain narrowing cast to a
 * named type that is left to code review. `as (any)` and an inner cast with two pairs of parentheses pass too.
 *
 * A file that bridges Node or test types to runtime surfaces carries a justified
 * `// oxlint-disable-next-line <this rule> -- <reason>`.
 */
import type { CreateRule, ESTree } from "@oxlint/plugins";
import { grouped } from "./internal/Syntax.ts";

/**
 * Refuses `as any`, the double casts through `unknown` and `never`, and `<T>x`.
 *
 * @category rules
 */
export const noTypeAssertions: CreateRule = {
  create(context) {
    const source = context.sourceCode;

    /** The type right after `as`, with no parentheses of its own: `as (any)` is not `as any`. */
    const asKeyword = (node: ESTree.TSAsExpression, kind: string): boolean =>
      node.typeAnnotation.type === kind && source.getTokenBefore(node.typeAnnotation)?.value === "as";

    return {
      TSAsExpression(node) {
        const inner = node.expression;

        if (inner.type === "TSAsExpression" && grouped(source, inner) <= 1) {
          const message = asKeyword(inner, "TSUnknownKeyword")
            ? "Type assertions are forbidden: `as unknown as` blinds the compiler. Decode at boundaries with Schema.decodeUnknownSync, or type the value properly."
            : asKeyword(inner, "TSNeverKeyword")
              ? "Type assertions are forbidden: `as never as T` launders a value past the compiler. Construct/type the value properly instead."
              : null;

          if (message !== null) {
            context.report({ node: inner.expression, message });

            return;
          }
        }

        if (asKeyword(node, "TSAnyKeyword")) {
          context.report({
            node,
            message: "`as any` is forbidden: it disables type checking. Type the value properly.",
          });
        }
      },
      TSTypeAssertion(node) {
        context.report({
          node,
          message:
            "Angle-bracket type assertions (`<T>x`) are forbidden: same erasure as `x as T`. Decode at boundaries with Schema.decodeUnknownSync, or type the value properly.",
        });
      },
    };
  },
};
