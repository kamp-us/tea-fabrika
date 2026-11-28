/**
 * A failure is a typed value. `Cause.squash` turns a typed cause into one unknown value, and the next line then asks
 * what it is. The rule refuses every use of Effect's `squash`. Read the typed failure with `Cause.findErrorOption` or
 * `Exit.findErrorOption`, and a thrown value with `Cause.findDefect`.
 *
 * What counts is resolved through the file's own scope, so a renamed import is seen and a local of the same name is not:
 * - `Cause` imported from `effect` under any name, `effect/Cause` imported as a namespace, and the `effect` barrel
 *   imported as a namespace (`Effect.Cause.squash`);
 * - the member written plainly, optionally (`Cause?.squash`) or as a string-literal computed member (`Cause["squash"]`),
 *   called or only referred to (`xs.map(Cause.squash)`);
 * - `squash` taken out of the module by a pattern: `const { squash } = Cause`;
 * - `squash` imported by name from `effect/Cause`, which fires once, at the import.
 *
 * What passes: another object's `squash`, a local or a parameter named `Cause`, a `Cause` imported from any other module,
 * a comment, a string, and a type position (`typeof Cause.squash`, `import type`). What it misses: an alias made at run
 * time (`const c = Cause; c.squash(x)`) and a re-export.
 *
 * The one place that needs the squashed value, an edge that names whatever failed, takes
 * `// oxlint-disable-next-line <this rule> -- edge: <why>` on its line.
 */
import type { CreateRule, Scope, Variable } from "@oxlint/plugins";
import { Predicate } from "effect";
import { imported, type Node } from "./internal/Syntax.ts";

/** A member's or a key's name, written plainly or as a string literal. */
const written = (key: Node, computed: boolean): string | null => {
  if (!computed && key.type === "Identifier") {
    return key.name;
  }

  return key.type === "Literal" && Predicate.isString(key.value) ? key.value : null;
};

/**
 * Refuses every use of Effect's `Cause.squash`.
 *
 * @category rules
 */
export const noCauseSquash: CreateRule = {
  create(context) {
    const message = `\`Cause.squash\` turns a typed failure into one unknown value. Read the typed failure with \`Cause.findErrorOption\` or \`Exit.findErrorOption\` and match on its tag, and a thrown value with \`Cause.findDefect\`. An edge that must name whatever failed takes \`// oxlint-disable-next-line ${context.id} -- edge: <why>\`.`;

    const resolve = (node: Node & { readonly name: string }): Variable | undefined => {
      let scope: Scope | null = context.sourceCode.getScope(node);

      while (scope !== null) {
        const variable = scope.set.get(node.name);

        if (variable !== undefined) {
          return variable;
        }

        scope = scope.upper;
      }

      return undefined;
    };

    /** Whether a node is Effect's Cause module. */
    const isCause = (given: Node): boolean => {
      const node = given.type === "ChainExpression" ? given.expression : given;

      if (node.type === "Identifier") {
        const at = imported(resolve(node));

        return (
          at !== null &&
          ((at.from === "effect" && at.name === "Cause") || (at.from === "effect/Cause" && at.name === "*"))
        );
      }

      if (
        node.type === "MemberExpression" &&
        written(node.property, node.computed) === "Cause" &&
        node.object.type === "Identifier"
      ) {
        const at = imported(resolve(node.object));

        return at !== null && at.from === "effect" && at.name === "*";
      }

      return false;
    };

    return {
      MemberExpression(node) {
        if (written(node.property, node.computed) === "squash" && isCause(node.object)) {
          context.report({ node, message });
        }
      },
      VariableDeclarator(node) {
        if (node.id.type !== "ObjectPattern" || node.init == null || !isCause(node.init)) {
          return;
        }

        for (const property of node.id.properties) {
          if (property.type === "Property" && written(property.key, property.computed) === "squash") {
            context.report({ node: property, message });
          }
        }
      },
      ImportDeclaration(node) {
        if (node.source.value !== "effect/Cause" || node.importKind === "type") {
          return;
        }

        for (const spec of node.specifiers) {
          if (spec.type !== "ImportSpecifier" || spec.importKind === "type") {
            continue;
          }

          const name = spec.imported.type === "Identifier" ? spec.imported.name : String(spec.imported.value);

          if (name === "squash") {
            context.report({ node: spec, message });
          }
        }
      },
    };
  },
};
