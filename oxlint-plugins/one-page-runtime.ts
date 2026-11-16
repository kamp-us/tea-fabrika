// The page has one Effect runtime (P12, L11; 0591). `.oxlintrc.json` turns this rule on for the page
// entry alone, `next/apps/fabrika/src/entry/browser.tsx`. Production React does not repeat mounts, so
// the entry's own module-level boot is what is held: it imports `runMain` from `@kampus/tuval/browser`
// once, under its own name, and starts its one program with it once, as a statement of the module.
//
// A start is `program.pipe(runMain)` (with `runMain` the last argument), `runMain(program)` or
// `runMain(options)(program)`. Any other `runMain` read (in a function, a component, or a second
// start at module scope) is a second page runtime. Any other `run*` name (`Effect.runPromise`,
// `runFork`, `ManagedRuntime.runSync`) is a run the page does not own.
//
// Every import of `runMain`, from any module and under any local name, is counted: only the one from
// `@kampus/tuval/browser` under its own name passes. Every string literal and every template with no
// expressions, wherever it stands, counts as the name it spells: `Effect["runPromise"]`,
// `const k = "runPromise"; Effect[k](page)` and `Reflect.get(Effect, "runFork")` are each a run the
// page does not own, and a `"runMain"` is a second page runtime. An import's source never spells one.
import type { CreateRule } from "@oxlint/plugins";
import type { Node } from "./match.ts";

const FROM = "@kampus/tuval/browser";
const NAME = "runMain";
const OTHER_RUN = /^run[A-Z]\w*$/;

const isRunMain = (node: Node | null | undefined): boolean =>
  node != null && node.type === "Identifier" && node.name === NAME;

/** The name a string literal or a template with no expressions spells, or null. */
const spelled = (node: Node): string | null =>
  node.type === "Literal" && typeof node.value === "string"
    ? node.value
    : node.type === "TemplateLiteral" && node.expressions.length === 0
      ? (node.quasis[0]?.value.cooked ?? null)
      : null;

/** The name an import specifier takes from its module: `runMain` in `{ runMain as boot }` and `{ "runMain" as boot }`. */
const importedName = (node: Node): string | null =>
  node.type === "ImportSpecifier"
    ? node.imported.type === "Identifier"
      ? node.imported.name
      : spelled(node.imported)
    : null;

/** The `runMain` a start statement calls, or null when the statement is not a start. */
const startOf = (statement: Node): Node | null => {
  if (statement.type !== "ExpressionStatement" || statement.expression.type !== "CallExpression") {
    return null;
  }

  const { callee, arguments: args } = statement.expression;
  const last = args.at(-1);

  if (
    callee.type === "MemberExpression" &&
    !callee.computed &&
    callee.property.type === "Identifier" &&
    callee.property.name === "pipe" &&
    isRunMain(last)
  ) {
    return last ?? null;
  }

  if (isRunMain(callee)) {
    return callee;
  }

  if (callee.type === "CallExpression" && isRunMain(callee.callee)) {
    return callee.callee;
  }

  return null;
};

export const onePageRuntime: CreateRule = {
  create(context) {
    const reads: Node[] = [];
    const read = (node: Node, name: string) => {
      if (name === NAME) {
        reads.push(node);
        return;
      }

      if (OTHER_RUN.test(name)) {
        context.report({
          node,
          message: `\`${name}\` runs an Effect the page does not own. The page entry hands its one program to \`runMain\` from \`${FROM}\` and calls no other run function (P12, L11).`,
        });
      }
    };
    return {
      Identifier(node) {
        const { parent } = node as Node & { readonly parent: Node };

        // An import's names are counted in `Program:exit`, by what the specifier imports.
        if (!(node.name === NAME && parent.type === "ImportSpecifier")) {
          read(node, node.name);
        }
      },
      Literal(node) {
        const { parent } = node as Node & { readonly parent: Node };
        const name = spelled(node);

        // A specifier's `"runMain"` is an import, counted in `Program:exit`.
        if (name !== null && !(name === NAME && parent.type === "ImportSpecifier")) {
          read(node, name);
        }
      },
      TemplateLiteral(node) {
        const name = spelled(node);

        if (name !== null) {
          read(node, name);
        }
      },
      "Program:exit"(program) {
        const imports = program.body.flatMap((node) =>
          node.type === "ImportDeclaration"
            ? node.specifiers
                .filter((s) => importedName(s) === NAME)
                .map((s) => ({
                  s,
                  own:
                    node.source.value === FROM &&
                    s.type === "ImportSpecifier" &&
                    isRunMain(s.local) &&
                    isRunMain(s.imported),
                }))
            : [],
        );
        const own = imports.find((i) => i.own);
        // Every other import of `runMain` is refused where it stands; with none at all, the module is.
        const refused: Node[] = imports.filter((i) => i !== own).map((i) => i.s);

        if (own === undefined && refused.length === 0) {
          refused.push(program);
        }

        for (const node of refused) {
          context.report({
            node,
            message: `Import \`runMain\` from \`${FROM}\` once, under its own name: the page's one Effect program starts through it (P12, L11).`,
          });
        }

        const starts = program.body.map(startOf).filter((node) => node !== null);

        if (starts.length === 0) {
          context.report({
            node: program,
            message:
              "Start the page's one Effect program at module scope, as `program.pipe(runMain)`: a React mount never owns the page's Effect run (P12, L11).",
          });
        }

        for (const read of reads) {
          if (read !== starts[0]) {
            context.report({
              node: read,
              message:
                "A second page runtime: the page starts `runMain` once, as a statement of the module, and reads it nowhere else (P12, L11).",
            });
          }
        }
      },
    };
  },
};
