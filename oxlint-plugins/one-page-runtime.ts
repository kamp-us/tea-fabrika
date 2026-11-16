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
// It reads written names only: an alias of `runMain` or of a run function is not traced.
import type { CreateRule } from "@oxlint/plugins";
import type { Node } from "./match.ts";

const FROM = "@kampus/tuval/browser";
const NAME = "runMain";
const OTHER_RUN = /^run[A-Z]\w*$/;

const isRunMain = (node: Node | null | undefined): boolean =>
  node != null && node.type === "Identifier" && node.name === NAME;

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
    return {
      Identifier(node) {
        const { parent } = node as Node & { readonly parent: Node };

        if (node.name === NAME) {
          if (parent.type !== "ImportSpecifier") {
            reads.push(node);
          }

          return;
        }

        if (OTHER_RUN.test(node.name)) {
          context.report({
            node,
            message: `\`${node.name}\` runs an Effect the page does not own. The page entry hands its one program to \`runMain\` from \`${FROM}\` and calls no other run function (P12, L11).`,
          });
        }
      },
      "Program:exit"(program) {
        const imports = program.body.filter(
          (node) =>
            node.type === "ImportDeclaration" &&
            node.source.value === FROM &&
            node.specifiers.some((s) => s.type === "ImportSpecifier" && isRunMain(s.imported) && isRunMain(s.local)),
        );

        if (imports.length !== 1) {
          context.report({
            node: imports[1] ?? program,
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
