// Ticket 1310, kalfa/. An error's hidden cause stays hidden when the error is written as JSON.
// Effect 4.1.3's `Schema.Redacted` hides its value from `String`, `JSON.stringify`, `inspect` and `Cause.pretty`, but its `toCodecJson` link encodes
// with `Redacted.value` (`Schema.ts:17044-17055`), so `Schema.toCodecJson` writes the value in full. A kalfa error that crosses a socket in a Transport
// frame would carry a cause that quotes a secret. `Hidden.Cause` from `@kalfa/diagnostics/Hidden` is held as a `Redacted` and written by every codec as
// the text `<redacted>`. This rule keeps the old shape out of kalfa's error classes and keeps one copy of the new one.
//
// An error class is a class whose `extends` is `<S>.TaggedError<...>()(tag, fields, ...)` or `<S>.Error<...>(id)(fields)`, where `<S>` is Effect's
// `Schema` in any spelling, resolved through the file's own scope so a renamed import is seen and a local of the same name is not:
// - `Schema` imported from `effect` under any name, `effect/Schema` imported as a namespace, and the `effect` barrel imported as a namespace
//   (`E.Schema.TaggedError`).
// Its fields are the object literal, or a same-file `const` the argument or a spread names, followed one step at a time.
// What fires, in the fields of an error class:
// - refusal one: a call of `<S>.Redacted(` or `<S>.RedactedFromValue(` at any depth (inside `optional`, `Union`, `Struct`, an array), or in a same-file
//   `const` the fields name by the argument of a call, a property's value, a spread or an array element;
// - refusal two: a top-level `cause` key whose value is not one of four forms: `<S>.Defect(...)`, `<S>.optional(<S>.Defect(...))`, `Hidden.Cause`, or
//   `<S>.optional(Hidden.Cause)`, where `Hidden` is a namespace import of `@kalfa/diagnostics/Hidden` (or `Cause` imported from it by name), or
//   `./Hidden.ts` inside `kalfa/diagnostics/src/`. A `cause` that holds a refusal-one call is reported once, as refusal one.
// What passes: a `Schema.Redacted(` outside an error class (in `S.Struct`, in `S.is(...)`), a local object named `Schema`, each of the four forms
// of `cause`, a comment and a string.
// Misses: fields built by a call (`Schema.Struct(...).fields`), fields imported from another file, an alias made at run time (`const S = Schema`), and
// anything outside `kalfa/`. `.oxlintrc.json` leaves kalfa's test files and test support out: a test makes errors with any cause to probe them.
import type { CreateRule, Scope, Variable } from "@oxlint/plugins";
import { Predicate } from "effect";
import { below, pathIn } from "./match.ts";
import type { Node } from "./match.ts";

const REDACTED =
  "`Schema.Redacted` writes its value in full through `Schema.toCodecJson`, so an error that crosses a socket would carry it. Hold a cause that may quote a value as `Hidden.Cause` from `@kalfa/diagnostics/Hidden`, which every codec writes as `<redacted>` (oxlint-plugins/hidden-cause.ts).";

const CAUSE =
  "An error's `cause` is `Schema.Defect()` or `Hidden.Cause` from `@kalfa/diagnostics/Hidden`, optional or not, so every hidden cause in kalfa is written one way (oxlint-plugins/hidden-cause.ts).";

const HIDDEN = "@kalfa/diagnostics/Hidden";

/** The import an identifier is bound to: its source and the name it imports (`*` for a namespace). */
const imported = (variable: Variable | undefined): { readonly from: string; readonly name: string } | null => {
  const def = variable?.defs[0];

  if (def === undefined || def.type !== "ImportBinding" || def.parent?.type !== "ImportDeclaration") {
    return null;
  }

  const from = def.parent.source.value;
  const spec = def.node;

  if (spec.type === "ImportNamespaceSpecifier") {
    return { from, name: "*" };
  }

  if (spec.type === "ImportSpecifier") {
    return { from, name: spec.imported.type === "Identifier" ? spec.imported.name : String(spec.imported.value) };
  }

  return null;
};

/** A member's or a key's name, written plainly or as a string literal. */
const written = (key: Node, computed: boolean): string | null => {
  if (!computed && key.type === "Identifier") {
    return key.name;
  }

  return key.type === "Literal" && Predicate.isString(key.value) ? key.value : null;
};

export const hiddenCause: CreateRule = {
  create(context) {
    const inDiagnostics = pathIn(context).startsWith("kalfa/diagnostics/src/");
    const reported = new Set<Node>();

    const report = (node: Node, message: string) => {
      if (!reported.has(node)) {
        reported.add(node);
        context.report({ node, message });
      }
    };

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
    const schemaCall = (node: Node, names: ReadonlyArray<string>) =>
      node.type === "CallExpression" && !node.optional && names.includes(schemaMember(node.callee) ?? "") ? node : null;

    /** Whether a node is the hidden cause of Diagnostics: `Hidden.Cause`, or `Cause` taken from its module by name. */
    const isHidden = (node: Node): boolean => {
      if (node.type === "Identifier") {
        const at = imported(resolve(node));

        return (
          at !== null && at.name === "Cause" && (at.from === HIDDEN || (inDiagnostics && at.from === "./Hidden.ts"))
        );
      }

      if (
        node.type === "MemberExpression" &&
        written(node.property, node.computed) === "Cause" &&
        node.object.type === "Identifier"
      ) {
        const at = imported(resolve(node.object));

        return at !== null && at.name === "*" && (at.from === HIDDEN || (inDiagnostics && at.from === "./Hidden.ts"));
      }

      return false;
    };

    /** Whether a node is `Schema.Defect(...)`. */
    const isDefect = (node: Node): boolean => schemaCall(node, ["Defect"]) !== null;

    /** One of the four forms a cause may take. */
    const allowed = (node: Node): boolean => {
      if (isDefect(node) || isHidden(node)) {
        return true;
      }

      const optional = schemaCall(node, ["optional"]);
      const [inner, ...rest] = optional?.arguments ?? [];

      return optional !== null && rest.length === 0 && inner !== undefined && (isDefect(inner) || isHidden(inner));
    };

    /** The initializer of the same-file `const` an identifier names, one step. */
    const followed = (node: Node): Node | null => {
      if (node.type !== "Identifier") {
        return null;
      }

      const def = resolve(node)?.defs[0];

      return def?.type === "Variable" &&
        def.node.type === "VariableDeclarator" &&
        def.node.id.type === "Identifier" &&
        def.parent?.type === "VariableDeclaration" &&
        def.parent.kind === "const"
        ? def.node.init
        : null;
    };

    /** The `Redacted` calls under a node, and under each same-file `const` it names in the places a value is taken from one. */
    const redacted = (node: Node, seen = new Set<Node>()): ReadonlyArray<Node> => {
      if (seen.has(node)) {
        return [];
      }

      seen.add(node);

      const found: Array<Node> = [];

      const follow = (named: Node | null | undefined) => {
        const init = named == null ? null : followed(named);

        if (init !== null) {
          found.push(...redacted(init, seen));
        }
      };

      for (const each of below(node)) {
        if (schemaCall(each, ["Redacted", "RedactedFromValue"]) !== null) {
          found.push(each);
        }

        if (each.type === "CallExpression") {
          each.arguments.forEach(follow);
        }

        if (each.type === "Property") {
          follow(each.value);
        }

        if (each.type === "SpreadElement") {
          follow(each.argument);
        }

        if (each.type === "ArrayExpression") {
          each.elements.forEach(follow);
        }
      }

      return found;
    };

    /** The properties of a fields object, a same-file `const` it names, and each object it spreads. */
    const properties = (fields: Node, seen = new Set<Node>()): ReadonlyArray<Node> => {
      const object = fields.type === "Identifier" ? followed(fields) : fields;

      if (object == null || object.type !== "ObjectExpression" || seen.has(object)) {
        return [];
      }

      seen.add(object);

      return object.properties.flatMap((each) =>
        each.type === "SpreadElement" ? properties(each.argument, seen) : [each],
      );
    };

    /** The fields of an error class: `S.TaggedError<...>()(tag, fields)` or `S.Error<...>(id)(fields)`. */
    const fieldsOf = (superClass: Node | null | undefined): Node | null => {
      if (superClass == null || superClass.type !== "CallExpression" || superClass.callee.type !== "CallExpression") {
        return null;
      }

      const name = schemaMember(superClass.callee.callee);
      const [first, second] = superClass.arguments;

      return (name === "TaggedError" ? second : name === "Error" ? first : null) ?? null;
    };

    const check = (node: Node & { readonly superClass?: Node | null }) => {
      const fields = fieldsOf(node.superClass);

      if (fields === null) {
        return;
      }

      for (const call of redacted(followed(fields) ?? fields)) {
        report(call, REDACTED);
      }

      for (const each of properties(fields)) {
        if (each.type !== "Property" || written(each.key, each.computed) !== "cause") {
          continue;
        }

        const value = followed(each.value) ?? each.value;

        if (redacted(value).length === 0 && !allowed(value)) {
          report(each, CAUSE);
        }
      }
    };

    return { ClassDeclaration: check, ClassExpression: check };
  },
};
