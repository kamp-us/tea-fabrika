// Ticket 1029, decision 0538: a next/ test opens a SQLite file through one module of the test
// primitives, `TestDatabase` in `@kampus/vitest/TestDatabase`. `make(file)` opens a file the test
// owns with its journal in memory and no disk sync, so a law never waits on the disk (0052, ticket
// 1028); `open(file)` opens a file another party owns and changes nothing in it. So a test file, a
// shared suite (`*Test.ts`) or a test kit (`*.test-support.ts`) in next/ may not write
// `new DatabaseSync(file)` itself:
//
//   new DatabaseSync(file)                 // refused: SQLite's default mode syncs the disk on commit
//   new DatabaseSync(":memory:")           // passes: inside the process, no file
//   yield* TestDatabase.make(file)         // passes
//
// It reads the constructor through the module its name came from: `DatabaseSync` named or renamed
// from `node:sqlite`, or `sqlite.DatabaseSync` through a namespace or default import of it. A local
// class of the same name, a parameter that shadows the import, and product code do not fire.
//
// Counted on 2026-11-14 on `origin/main` at `86a7668d6`: 62 calls in 53 files, every one a file
// store that moves to `make` (47) or a file another party owns that moves to `open` (7 calls in 6
// files). None is right as it is once `open` exists, so 0 false alarms in 62, and it blocks
// (AGENTS.md, "Checks"). The 28 in-memory files and the child script inside a template string in
// `instance-database.integration.test.ts` do not fire by construction.
//
// It reads syntax: a `DatabaseSync` reached through another module's helper, or `Reflect.construct`,
// slips past it.
import type { CreateRule, ESTree, Scope, Variable } from "@oxlint/plugins";
import { pathIn, type Node } from "./match.ts";

/** The files it holds: next/'s test files, shared suites and test kits. */
const TEST_FILE = /(?:\.test\.tsx?|Test\.tsx?|\.test-support\.tsx?)$/;

const SQLITE = /^(?:node:)?sqlite$/;

const MESSAGE =
  'A test opens a SQLite file with `TestDatabase.make(file)` from `@kampus/vitest/TestDatabase`, or `TestDatabase.open(file)` for a file another party owns (ticket 1029). `new DatabaseSync(":memory:")` stays as it is.';

/** A string written in the source with nothing built into it, or `null`. */
const written = (node: Node | undefined): string | null =>
  node?.type === "Literal" && typeof node.value === "string"
    ? node.value
    : node?.type === "TemplateLiteral" && node.expressions.length === 0
      ? (node.quasis[0]?.value.cooked ?? null)
      : null;

export const testDatabase: CreateRule = {
  create(context) {
    const file = pathIn(context);

    if (!file.startsWith("next/") || !TEST_FILE.test(file)) {
      return {};
    }

    /** The variable a name resolves to from where it is written. */
    const resolve = (node: Node & { readonly name: string }): Variable | undefined => {
      for (let scope: Scope | null = context.sourceCode.getScope(node); scope !== null; scope = scope.upper) {
        const variable = scope.set.get(node.name);

        if (variable !== undefined) {
          return variable;
        }
      }

      return undefined;
    };

    // `DatabaseSync` as the file names it, and the names that hold the whole module.
    const constructors = new Set<Variable>();
    const spaces = new Set<Variable>();
    const news: ESTree.NewExpression[] = [];

    /** Whether a name, where it is written, is one of these imports. */
    const isOneOf = (imports: ReadonlySet<Variable>, node: Node & { readonly name: string }): boolean => {
      const variable = resolve(node);
      return variable !== undefined && imports.has(variable);
    };

    return {
      ImportDeclaration(node) {
        if (!SQLITE.test(node.source.value)) {
          return;
        }

        for (const spec of node.specifiers) {
          const variable = resolve(spec.local);
          const imported =
            spec.type === "ImportSpecifier"
              ? spec.imported.type === "Identifier"
                ? spec.imported.name
                : spec.imported.value
              : null;

          if (variable === undefined) {
            continue;
          }

          if (imported === null) {
            spaces.add(variable);
          } else if (imported === "DatabaseSync") {
            constructors.add(variable);
          }
        }
      },
      NewExpression(node) {
        news.push(node);
      },
      "Program:exit"() {
        for (const node of news) {
          const callee = node.callee as Node;
          const named =
            callee.type === "Identifier"
              ? isOneOf(constructors, callee)
              : callee.type === "MemberExpression" &&
                !callee.computed &&
                callee.property.type === "Identifier" &&
                callee.property.name === "DatabaseSync" &&
                callee.object.type === "Identifier" &&
                isOneOf(spaces, callee.object);

          if (named && written(node.arguments[0] as Node | undefined) !== ":memory:") {
            context.report({ node, message: MESSAGE });
          }
        }
      },
    };
  },
};
