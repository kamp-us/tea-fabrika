/**
 * A named function's returned Effect gets its span from `Effect.fn`.
 *
 * The rule matches only the returned chain. A span yielded inside a generator covers part of its work, and
 * `Stream.withSpan` measures consumption, so both stay valid.
 *
 * What it refuses: a function with a name (a `const` arrow, a function declaration, an object property or a
 * class member, a curried arrow returned by a named one) whose body is one returned expression that is
 * `Effect.withSpan(...)` or a `.pipe(...)` holding one, at any place in the pipe or in a chain of pipes. What
 * passes: an inner span, a consumed `Stream.withSpan`, `Effect.fn` and an unnamed callback. `Effect` is read
 * through the file's imports: the named import, a renamed named import and `effect/Effect` as a namespace.
 */
import type { CreateRule, ESTree } from "@oxlint/plugins";
import { Array as Arr } from "effect";
import { dotted, type Node } from "./internal/Syntax.ts";

type FunctionNode = ESTree.ArrowFunctionExpression | ESTree.Function;

const named = (node: FunctionNode): boolean => {
  if (node.type !== "ArrowFunctionExpression" && node.id !== null) {
    return true;
  }

  const parent = node.parent;

  if (parent.type === "ArrowFunctionExpression") {
    return named(parent);
  }

  return (
    (parent.type === "VariableDeclarator" && parent.id.type === "Identifier") ||
    parent.type === "Property" ||
    parent.type === "PropertyDefinition" ||
    parent.type === "MethodDefinition"
  );
};

const returned = (node: FunctionNode): Node | null => {
  const body = node.body;

  if (body === null) {
    return null;
  }

  if (body.type !== "BlockStatement") {
    return body;
  }

  const [only] = body.body;

  return body.body.length === 1 && only?.type === "ReturnStatement" ? only.argument : null;
};

/**
 * Refuses a span wrapper around the Effect a named function returns.
 *
 * @category rules
 */
export const effectFunctions: CreateRule = {
  create(context) {
    const effects = new Set<string>();

    const isSpan = (node: Node): boolean => {
      const name = dotted(node);

      return Arr.some([...effects], (effect) => name === `${effect}.withSpan`);
    };

    const wrapper = (node: Node): Node | null => {
      if (node.type !== "CallExpression") {
        return null;
      }

      if (isSpan(node.callee)) {
        return node;
      }

      const callee = node.callee;

      if (
        callee.type !== "MemberExpression" ||
        callee.computed ||
        callee.property.type !== "Identifier" ||
        callee.property.name !== "pipe"
      ) {
        return null;
      }

      for (const arg of node.arguments) {
        if (arg.type === "CallExpression" && isSpan(arg.callee)) {
          return arg;
        }
      }

      return wrapper(callee.object);
    };

    const check = (node: FunctionNode) => {
      if (!named(node)) {
        return;
      }

      const body = returned(node);
      const span = body === null ? null : wrapper(body);

      if (span === null) {
        return;
      }

      context.report({
        node: span,
        message:
          'A named function\'s returned Effect gets its span from `Effect.fn("name")`, not from `Effect.withSpan` around the whole body. An `Effect.withSpan` on a step inside the body, and a `Stream.withSpan` that measures consumption, are fine.',
      });
    };

    return {
      ImportDeclaration(node) {
        for (const spec of node.specifiers) {
          if (
            (node.source.value === "effect" && spec.type === "ImportSpecifier" && dotted(spec.imported) === "Effect") ||
            (node.source.value === "effect/Effect" && spec.type === "ImportNamespaceSpecifier")
          ) {
            effects.add(spec.local.name);
          }
        }
      },
      ArrowFunctionExpression: check,
      FunctionExpression: check,
      FunctionDeclaration: check,
    };
  },
};
