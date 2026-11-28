/**
 * Bans a raw `try/catch` in any file that imports Effect, and asks for `Effect.try` or `Effect.tryPromise`.
 *
 * Real Effect code models failure in the `E` channel through `Effect.try` and `Effect.tryPromise`; a bare `try/catch`
 * inside a file that imports Effect lets the failure escape the type system. The rule is scoped to files that import
 * `effect` (the bare name or an `effect/...` subpath), so a plain Node script that uses `try/catch` on purpose is not
 * touched.
 *
 * A genuine pre-runtime bootstrap `try/catch` (a dynamic-import guard that must run before the Effect runtime loads) is
 * exempted per line with `// oxlint-disable-next-line <this rule> -- <reason>`, never as a blanket.
 *
 * The finding underlines the offending `try`, not the whole module, and appears only when the file also imports `effect`.
 * A `try` with a `finally` is left alone: the rule looks at `try/catch` only.
 */
import type { CreateRule } from "@oxlint/plugins";
import { Array as Arr } from "effect";
import type { Node } from "./internal/Syntax.ts";

const isEffect = (text: string): boolean => text === "effect" || text.startsWith("effect/");

const named = (specifier: Node): boolean =>
  specifier.type === "ImportSpecifier" && specifier.imported.type === "Literal" && isEffect(specifier.imported.value);

/**
 * Refuses a `try/catch` in a file that imports Effect.
 *
 * @category rules
 */
export const noRawTryCatch: CreateRule = {
  create(context) {
    let imports = false;

    return {
      Program(program) {
        imports = Arr.some(
          program.body,
          (item) =>
            item.type === "ImportDeclaration" && (isEffect(item.source.value) || Arr.some(item.specifiers, named)),
        );
      },
      TryStatement(node) {
        if (!imports || node.handler === null || node.finalizer !== null) {
          return;
        }

        context.report({
          node,
          message: `Raw \`try/catch\` is discouraged in an effect-importing file: real Effect code models failure in the \`E\` channel, not a native throw. Fix: use \`Effect.try({ try, catch })\` (sync) or \`Effect.tryPromise({ try, catch })\` (async), mapping the cause into a \`Schema.TaggedError\`. Exception (e.g. a pre-runtime bootstrap guard): // oxlint-disable-next-line ${context.id} -- <reason>.`,
        });
      },
    };
  },
};
