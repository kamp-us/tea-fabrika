// E2 of the Effect-check sweep (0577): a library imports each Effect module by its path, the form
// Effect's own source uses. Effect's checker reports `preferNamespaceImport` for the named form
// and has no fix on its command line, so this rule reports the same imports and writes the fix, and
// `pnpm format` applies it (`lint.ts --fix`): no hand edit and no find-and-replace over the tree.
//
//   import { Effect, type Scope, Duration as D } from "effect";
//   import * as Effect from "effect/Effect";
//   import type * as Scope from "effect/Scope";
//   import * as D from "effect/Duration";
//
// A barrel is `effect` or one of its folders (`effect/process`, `effect/testing`): a name from
// `effect/process` becomes `effect/process/ChildProcess`. A name is a module when its file is in the
// installed package, which is what the exports map `./*` reads. A declaration holding a name that is
// no module (`pipe`, `identity`) is reported with no fix, whole, so the fix never splits what it
// cannot move; a person picks the module that holds the function.
//
// Where it reads: `.oxlintrc.json` turns it on for the folders the checker holds at error in
// libfabrika's and tuval's tsconfig.
import { existsSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import type { CreateRule } from "@oxlint/plugins";

const EFFECT = dirname(createRequire(import.meta.url).resolve("effect/package.json"));
const BARREL = /^effect(?:\/([a-z][a-z0-9-]*))?$/;

/** The folder of modules a barrel names, or `undefined` for a source that is no barrel. */
const folderOf = (source: string): string | undefined => {
  const match = BARREL.exec(source);

  if (match === null) {
    return undefined;
  }

  const folder = match[1];

  // `effect` itself is `dist/`; a folder is a barrel only where it keeps an `index`.
  return folder === undefined || existsSync(join(EFFECT, "dist", folder, "index.js")) ? (folder ?? "") : undefined;
};

const isModule = (folder: string, name: string): boolean =>
  name !== "index" && existsSync(join(EFFECT, "dist", folder, `${name}.js`));

export const preferNamespaceImport: CreateRule = {
  meta: { type: "suggestion", fixable: "code" },
  create(context) {
    return {
      ImportDeclaration(node) {
        const folder = folderOf(String(node.source.value));
        const specifiers = node.specifiers;

        if (
          folder === undefined ||
          specifiers.length === 0 ||
          specifiers.some((specifier) => specifier.type !== "ImportSpecifier")
        ) {
          return;
        }

        const source = String(node.source.value);
        const lines: string[] = [];
        const refused: string[] = [];

        for (const specifier of specifiers) {
          if (specifier.type !== "ImportSpecifier") {
            continue;
          }

          const name =
            specifier.imported.type === "Identifier" ? specifier.imported.name : String(specifier.imported.value);
          const type = node.importKind === "type" || specifier.importKind === "type" ? "import type" : "import";

          if (isModule(folder, name)) {
            lines.push(`${type} * as ${specifier.local.name} from "${source}/${name}";`);
          } else {
            refused.push(name);
          }
        }

        if (refused.length > 0) {
          context.report({
            node,
            message: `${refused.join(", ")} from "${source}" is no module of Effect, so it has no namespace form (0577). Import the function from the module that holds it, by hand.`,
          });

          return;
        }

        context.report({
          node,
          message: `Import each Effect module by its path: \`import * as X from "${source}/X"\` (0577, E2). Fix: \`pnpm format\` writes it.`,
          fix: (fixer) => fixer.replaceText(node, lines.join("\n")),
        });
      },
    };
  },
};
