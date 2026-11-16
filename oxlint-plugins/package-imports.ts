// p32 and p65, strict layers (docs/plan/tier-1-detail.md, "Strict layers"): which of our own
// packages each part of next/ may import by name. `pnpm lint:layers` (code-graph, `layer-rules.json`)
// judges the file an import reaches, so it holds the relative imports and which part may reach which.
// This rule holds the names: it reads the import as written, so it tells `transport/Link` from
// `transport/Connection`, both in one layer, and sees a stylesheet code-graph cannot place.
//
// The table is the config's, in `.oxlintrc.json`:
//   scope  the names the rule reads: an import that does not start with it is someone else's.
//   parts  each a name, the files it holds as globs from the top of the repo, and `may`, the exact
//          names under `scope` its files may import. A file's part is the first one whose glob
//          matches it; a file in no part is not judged (next/apps is the wiring).
//   tests  optional, in a part: the packages under `scope` its test files (`*.test.ts`,
//          `*.test.tsx`) may import, each with every subpath. A part without it leaves its tests to
//          code-graph, upward only. The library has it, so none of its files, tests included and
//          wherever they sit in the package, imports tuval, a program or the app by name.
// With no options the rule says nothing.
//
// Read: `import`, `export ... from`, a side-effect `import "x"`, a dynamic `import("x")`, a type's
// `import("x")` and `import x = require("x")`, each with a plain string. A name built at run time is
// not seen. `package-imports.test.ts` plants each part's allowed and refused names, with the repo's
// own config.
import { matchesGlob } from "node:path";
import type { CreateRule } from "@oxlint/plugins";
import { pipe } from "effect/Function";
import * as Str from "effect/String";
import { pathIn, type Node } from "./match.ts";

interface Part {
  readonly name: string;
  readonly files: ReadonlyArray<string>;
  readonly may: ReadonlySet<string>;
  /** The packages its tests may import, or `null` when its tests are not judged here. */
  readonly tests: ReadonlyArray<string> | null;
}

interface Table {
  readonly scope: string;
  readonly parts: ReadonlyArray<Part>;
}

const strings = (value: unknown): ReadonlyArray<string> =>
  Array.isArray(value) ? value.filter((item) => typeof item === "string") : [];

const record = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null;

/** The config's table, or `null` when the rule was given none. */
const tableIn = (options: ReadonlyArray<unknown>): Table | null => {
  const [given] = options;

  if (!record(given) || typeof given.scope !== "string" || !Array.isArray(given.parts)) {
    return null;
  }

  return {
    scope: given.scope,
    parts: given.parts.filter(record).map((part) => ({
      name: typeof part.name === "string" ? part.name : "",
      files: strings(part.files),
      may: new Set(strings(part.may)),
      tests: Array.isArray(part.tests) ? strings(part.tests) : null,
    })),
  };
};

const isTest = (file: string): boolean => /\.test\.tsx?$/.test(file);

/** The name is one of these packages, or a subpath of one. */
const within = (packages: ReadonlyArray<string>, name: string): boolean =>
  packages.some((pkg) => name === pkg || pipe(name, Str.startsWith(`${pkg}/`)));

/** A plain string a module source holds: a literal, or a template with no `${}`. */
const written = (source: Node | null | undefined): string | null => {
  if (source?.type === "Literal") {
    return typeof source.value === "string" ? source.value : null;
  }

  return source?.type === "TemplateLiteral" && source.expressions.length === 0
    ? (source.quasis[0]?.value.cooked ?? null)
    : null;
};

const NAMES = { type: "array", items: { type: "string" }, uniqueItems: true } as const;

export const packageImports: CreateRule = {
  meta: {
    type: "problem",
    // oxlint refuses options for a rule that has no schema.
    schema: [
      {
        type: "object",
        properties: {
          scope: { type: "string" },
          parts: {
            type: "array",
            items: {
              type: "object",
              properties: { name: { type: "string" }, files: NAMES, may: NAMES, tests: NAMES },
              required: ["name", "files", "may"],
              additionalProperties: false,
            },
          },
        },
        required: ["scope", "parts"],
        additionalProperties: false,
      },
    ],
  },
  create(context) {
    const table = tableIn(context.options);
    const file = pathIn(context);

    if (table === null) {
      return {};
    }

    const part = table.parts.find((each) => each.files.some((glob) => matchesGlob(file, glob)));
    const test = isTest(file);

    if (part === undefined || (test && part.tests === null)) {
      return {};
    }

    // A test here is judged by its part's `tests`, every other file by its part's `may`.
    const tests = test ? part.tests : null;

    const listed = (names: Iterable<string>) => [...names].map((name) => `"${name}"`).join(", ");
    const none = `imports none of ${table.scope}*`;
    const { who, takes, allowed } =
      tests !== null
        ? {
            who: `A test of the ${part.name} part`,
            takes: (name: string) => within(tests, name),
            allowed: tests.length === 0 ? none : `imports only ${listed(tests)}, each with its subpaths`,
          }
        : {
            who: `The ${part.name} part`,
            takes: (name: string) => part.may.has(name),
            allowed: part.may.size === 0 ? none : `imports only ${listed(part.may)}`,
          };

    const check = (source: Node | null | undefined) => {
      const name = written(source);

      if (name === null || source == null || !pipe(name, Str.startsWith(table.scope)) || takes(name)) {
        return;
      }

      context.report({
        node: source,
        message: `${who} may not import "${name}": it ${allowed} (docs/plan/tier-1-detail.md, "Strict layers"). Import through a name the table in .oxlintrc.json gives this part, or by a relative path inside the package.`,
      });
    };

    return {
      ImportDeclaration: (node) => check(node.source),
      ExportNamedDeclaration: (node) => check(node.source),
      ExportAllDeclaration: (node) => check(node.source),
      ImportExpression: (node) => check(node.source),
      TSImportType: (node) => check(node.source),
      TSImportEqualsDeclaration(node) {
        if (node.moduleReference.type === "TSExternalModuleReference") {
          check(node.moduleReference.expression);
        }
      },
    };
  },
};
