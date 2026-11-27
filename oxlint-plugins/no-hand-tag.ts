// No hand-written `_tag` in `next/`: Effect Schema writes it. Tier 1's exam, item 5 (docs/plan/tier-1-detail.md, "The exam PR").
//
// It fires on an object key, a class field or a type member named `_tag`, so `{_tag: "x"}`,
// `type X = {readonly _tag: "x"}` and `Schema.Struct({_tag: Schema.Literal("x")})` fire. A read
// passes: `x._tag === "a"`, `const {_tag} = x`, `switch (x._tag)`. Making a value with a maker
// (`Fault.cases.abort.make(...)`) or a schema tool (`Schema.TaggedUnion`, `TaggedStruct`,
// `TaggedError`) passes, since they write the key themselves.
//
// It also fires on a computed key that names `_tag`: `{["_tag"]: x}`, a template with no hole, and a
// constant of the same file that holds the text, `const TAG = "_tag"; {[TAG]: x}`, which writes the
// same key. A computed key it cannot read (a parameter, a call, an imported constant) passes.
//
// It misses a write through a member, `x._tag = "a"`, which the plan does not name. Report it if one
// turns up.
//
// One edge, by its whole path from the top of the repo: the log, which stores any fact and knows no
// cases, so its `Line` holds `_tag` as an open string. A second edge goes back to the owner.
// `.oxlintrc.json` turns it on in `next/**` and leaves tests out: a test feeds raw frames.
import type { CreateRule } from "@oxlint/plugins";
import { Predicate } from "effect";
import { type Node, pathIn } from "./match.ts";

const EDGE = "next/packages/libfabrika/src/ledger/Log.ts";

const TAG = "_tag";

const isTag = (key: Node): boolean =>
  (key.type === "Identifier" && key.name === TAG) || (key.type === "Literal" && key.value === TAG);

/** The text a node writes when it is a literal, a template with no hole, a constant of the file that holds one, or one of them under `as const`, `satisfies` or `!`. */
const written = (node: Node, constants: ReadonlyMap<string, string>): string | null => {
  if (node.type === "Literal") {
    return Predicate.isString(node.value) ? node.value : null;
  }

  if (node.type === "TemplateLiteral") {
    return node.expressions.length === 0 ? (node.quasis[0]?.value.cooked ?? null) : null;
  }

  if (node.type === "TSAsExpression" || node.type === "TSSatisfiesExpression" || node.type === "TSNonNullExpression") {
    return written(node.expression, constants);
  }

  return node.type === "Identifier" ? (constants.get(node.name) ?? null) : null;
};

/** The top-level `const` of a file that holds a text, by name, in the order they are written. */
const constantsOf = (body: ReadonlyArray<Node>): ReadonlyMap<string, string> => {
  const found = new Map<string, string>();

  for (const statement of body) {
    const declaration = statement.type === "ExportNamedDeclaration" ? statement.declaration : statement;

    if (declaration?.type !== "VariableDeclaration" || declaration.kind !== "const") {
      continue;
    }

    for (const declarator of declaration.declarations) {
      const text = declarator.init == null ? null : written(declarator.init, found);

      if (declarator.id.type === "Identifier" && text !== null) {
        found.set(declarator.id.name, text);
      }
    }
  }

  return found;
};

export const noHandTag: CreateRule = {
  create(context) {
    if (pathIn(context) === EDGE) {
      return {};
    }

    let constants: ReadonlyMap<string, string> | undefined;

    const check = (node: Node, key: Node, computed: boolean) => {
      constants ??= constantsOf(context.sourceCode.ast.body);

      if (computed ? written(key, constants) !== TAG : !isTag(key)) {
        return;
      }

      context.report({
        node,
        message:
          "A hand-written `_tag`: Effect Schema writes it. Use `Schema.TaggedUnion`, `Schema.TaggedStruct` or `Schema.TaggedError`, and make a value with its maker (`X.cases.a.make(...)`).",
      });
    };

    return {
      Property(node) {
        // SAFETY: a Property always sits inside an object expression or pattern, which oxlint gives as its `parent`.
        const { parent } = node as Node & { readonly parent: Node };

        if (parent.type === "ObjectExpression") {
          check(node, node.key, node.computed);
        }
      },
      PropertyDefinition(node) {
        check(node, node.key, node.computed);
      },
      TSPropertySignature(node) {
        check(node, node.key, node.computed);
      },
    };
  },
};
