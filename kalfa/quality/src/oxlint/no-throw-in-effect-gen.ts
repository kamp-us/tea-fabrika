/**
 * Bans a bare `throw` statement lexically inside an `Effect.gen(...)` generator body or an `Effect.fn(...)` body: the
 * failure must route through the typed `E` channel.
 *
 * A `throw` inside an Effect generator escapes as an uncatchable defect with an empty `E` channel: the caller's
 * `catchTag` never sees it and the type system cannot force it to be handled. The fix keeps the failure in the type:
 * `yield* Effect.fail(new SomeError({...}))` (a `Schema.TaggedError` in `E`) for a recoverable failure, or
 * `yield* Effect.die(cause)` for a genuine defect stated as one.
 *
 * It matches a `throw` anywhere inside a call whose callee is `Effect.gen` or `Effect.fn`, covering the direct form
 * (`Effect.gen(function* ...)`) and the curried, span-named `Effect.fn` form (`Effect.fn("name")(function* ...)`, whose
 * outer call's callee is `Effect.fn("name")`). It reaches any nesting depth, so a `throw` guarded inside an `if` in the
 * generator body is still caught. Containment is lexical: the rule sees no types to tell the generator body from a nested
 * plain closure.
 *
 * A genuine exception (a real defect stated as a throw at a pre-Effect boundary) is a per-line
 * `// oxlint-disable-next-line <this rule> -- <reason>`, never a blanket.
 */
import type { CreateRule } from "@oxlint/plugins";
import { ancestors, dotted, type Node, plainCall } from "./internal/Syntax.ts";

const isEffectBody = (name: string | null): boolean => name === "Effect.gen" || name === "Effect.fn";

const opensEffect = (callee: Node): boolean => isEffectBody(dotted(callee)) || isEffectBody(plainCall(callee));

/**
 * Refuses a `throw` inside an `Effect.gen` or `Effect.fn` body.
 *
 * @category rules
 */
export const noThrowInEffectGen: CreateRule = {
  create(context) {
    return {
      ThrowStatement(node) {
        for (const up of ancestors(node)) {
          if (up.type !== "CallExpression" || !opensEffect(up.callee)) {
            continue;
          }

          context.report({
            node,
            message: `Bare \`throw\` inside an \`Effect.gen\`/\`Effect.fn\` body is banned: a thrown exception escapes the \`E\` channel as an uncatchable defect. Fix: \`yield* Effect.fail(new SomeError({...}))\` (a \`Schema.TaggedError\` in the \`E\` channel) for a recoverable failure, or \`yield* Effect.die(cause)\` for a genuine defect. Exception: // oxlint-disable-next-line ${context.id} -- <reason>.`,
          });

          return;
        }
      },
    };
  },
};
