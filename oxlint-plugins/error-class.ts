// What an error class is, for the rules that read kalfa's error classes: `fabrika/hidden-cause` (ticket 1310) and `fabrika/inner-cause` (ticket 2018). The code
// moved here out of hidden-cause.ts, so two rules cannot disagree on what an error class is or on what a name stands for.
//
// An error class is a class whose `extends` is `<S>.TaggedError<...>()(tag, fields, ...)` or `<S>.Error<...>(id)(fields)`, where `<S>` is Effect's `Schema`
// in any spelling, resolved through the file's own scope so a renamed import is seen and a local of the same name is not:
// - `Schema` imported from `effect` under any name, `effect/Schema` imported as a namespace, and the `effect` barrel imported as a namespace
//   (`E.Schema.TaggedError`).
// Its fields are the object literal, or a same-file `const` the argument or a spread names, followed step by step. A class that extends a same-file
// `const` which holds the `TaggedError` call is an error class too.
import type { Context, Scope, Variable } from "@oxlint/plugins";
import { Predicate } from "effect";
import { imported } from "./match.ts";
import type { Node } from "./match.ts";

/** A member's or a key's name, written plainly or as a string literal. */
export const written = (key: Node, computed: boolean): string | null => {
  if (!computed && key.type === "Identifier") {
    return key.name;
  }

  if (key.type === "TemplateLiteral" && key.expressions.length === 0 && key.quasis.length === 1) {
    return key.quasis[0]?.value.cooked ?? null;
  }

  return key.type === "Literal" && Predicate.isString(key.value) ? key.value : null;
};

/** The questions a rule asks of one file's syntax, answered through that file's own scope. */
export const errorClass = (context: Context) => {
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

  /** Whether a node is Effect's Schema module. */
  const isSchema = (given: Node): boolean => {
    if (given.type === "Identifier") {
      const at = imported(resolve(given));

      return (
        at !== null &&
        ((at.from === "effect" && at.name === "Schema") || (at.from === "effect/Schema" && at.name === "*"))
      );
    }

    if (
      given.type === "MemberExpression" &&
      written(given.property, given.computed) === "Schema" &&
      given.object.type === "Identifier"
    ) {
      const at = imported(resolve(given.object));

      return at !== null && at.from === "effect" && at.name === "*";
    }

    return false;
  };

  /** The name of the member a call or a node reads off Effect's Schema: `Redacted` in `S.Redacted(x)`. */
  const schemaMember = (node: Node): string | null =>
    node.type === "MemberExpression" && isSchema(node.object) ? written(node.property, node.computed) : null;

  /** A call of one of Effect's Schema members, and its arguments. */
  const schemaCall = (node: Node, names: ReadonlyArray<string>) => {
    if (node.type !== "CallExpression" || node.optional) {
      return null;
    }

    const name = schemaMember(node.callee);

    return names.some((each) => each === name) ? node : null;
  };

  /** The initializer of the same-file `const` an identifier names, one step. */
  const constInit = (node: Node & { readonly name: string }): Node | null => {
    const def = resolve(node)?.defs[0];

    return def?.type === "Variable" &&
      def.node.type === "VariableDeclarator" &&
      def.node.id.type === "Identifier" &&
      def.parent?.type === "VariableDeclaration" &&
      def.parent.kind === "const"
      ? def.node.init
      : null;
  };

  /** The base of the same-file class an identifier names: what it extends, one step. */
  const classBase = (node: Node): Node | null => {
    if (node.type !== "Identifier") {
      return null;
    }

    const def = resolve(node)?.defs[0];

    return def?.type === "ClassName" && def.node.type === "ClassDeclaration" ? (def.node.superClass ?? null) : null;
  };

  /** What an expression stands for: a name is replaced by its same-file `const`'s value, however many steps deep, and a member of a `const` object by that property's value. */
  const resolved = (node: Node, seen = new Set<Node>()): Node => {
    if (seen.has(node)) {
      return node;
    }

    seen.add(node);

    if (node.type === "Identifier") {
      const init = constInit(node);

      return init === null ? node : resolved(init, seen);
    }

    if (node.type === "MemberExpression") {
      const object = resolved(node.object, seen);

      if (object.type === "ObjectExpression") {
        const name = written(node.property, node.computed);

        const found = object.properties.find(
          (each) => each.type === "Property" && name !== null && written(each.key, each.computed) === name,
        );

        // A member read with a computed name that is no text could be any of them: the whole object stands for it.
        if (found?.type === "Property") {
          return resolved(found.value, seen);
        }

        return name === null ? object : node;
      }
    }

    return node;
  };

  /** What a name stands for, or `null` when it stands for itself. */
  const followed = (node: Node): Node | null => {
    const found = resolved(node);

    return found === node ? null : found;
  };

  /** The properties of a fields object, a same-file `const` it names, and each object it spreads. */
  const properties = (fields: Node, seen = new Set<Node>()): ReadonlyArray<Node> => {
    const object = resolved(fields);

    if (object.type !== "ObjectExpression" || seen.has(object)) {
      return [];
    }

    seen.add(object);

    return object.properties.flatMap((each) =>
      each.type === "SpreadElement" ? properties(each.argument, seen) : [each],
    );
  };

  /** The fields of an error class: `S.TaggedError<...>()(tag, fields)` or `S.Error<...>(id)(fields)`. */
  const fieldsOf = (given: Node | null | undefined): Node | null => {
    // `class K extends Base {}`, with `Base` a same-file `const` that holds the call, is an error class as much as the call written there.
    const superClass = given == null ? null : resolved(given);

    if (superClass === null || superClass.type !== "CallExpression" || superClass.callee.type !== "CallExpression") {
      return null;
    }

    const name = schemaMember(superClass.callee.callee);
    const [first, second] = superClass.arguments;

    return (name === "TaggedError" ? second : name === "Error" ? first : null) ?? null;
  };

  return { resolve, isSchema, schemaCall, classBase, resolved, followed, properties, fieldsOf };
};
