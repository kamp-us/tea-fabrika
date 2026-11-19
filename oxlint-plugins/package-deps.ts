// p65, `next/` stands alone (docs/plan/tier-1-detail.md, "Packages" and p65). `package.json` alone
// stops neither a walk up to the root's `node_modules` nor an import of a file another package keeps
// to itself, so this rule reads each import of a `next/` file and refuses one that walks out:
//
//   unlisted   a package its own `package.json` does not list, in any of the four dependency fields
//   exports    a subpath of one of our packages that its `exports` map does not hold, refuses with a
//              `null` target, or points at no file
//   relative   a relative path that leaves the file's package
//   electron   `electron` in an app, anywhere but `src/entry/electron-main.ts`
//   stray      a file in no package at all
//
// A package is a child folder of `next/packages`, `next/programs` or `next/apps` (pnpm-workspace.yaml's
// next/ globs) that holds a `package.json`. An `exports` map is read the way Node reads it (ticket 477,
// PR 9). The platform's own modules (`node:fs`, `fs`, `cloudflare:workers`) are no package anyone
// lists. This was the import half of the exam's `deps.integration.test.ts` until 0591 made it a lint
// rule; the manifest half is `pnpm lint:manifests` (`next-manifests.ts`). `package-deps.test.ts` plants
// the exam's trees with the repo's own config.
//
// Read: `import`, `export ... from`, a side-effect `import "x"`, a dynamic `import("x")`, a type's
// `import("x")` and `import x = require("x")`, each with a plain string. A name built at run time is
// not seen. The rule judges `next/` files only, so its `.agents/` twin in `.oxlintrc.json` says nothing.
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { builtinModules } from "node:module";
import { dirname, join, relative, sep } from "node:path";
import type { CreateRule } from "@oxlint/plugins";
import { pathIn, type Node } from "./match.ts";

const GROUPS = ["packages", "programs", "apps"] as const;

interface Manifest {
  readonly name: string;
  readonly exports: unknown;
  readonly listed: ReadonlySet<string>;
}

interface Package {
  /** The package's folder, absolute. */
  readonly dir: string;
  readonly group: (typeof GROUPS)[number];
  readonly manifest: Manifest;
}

const record = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const FIELDS = ["dependencies", "devDependencies", "peerDependencies", "optionalDependencies"] as const;

const manifestAt = (file: string): Manifest => {
  const json: unknown = JSON.parse(readFileSync(file, "utf8"));
  const m = record(json) ? json : {};

  return {
    name: typeof m.name === "string" ? m.name : "",
    exports: m.exports,
    listed: new Set(FIELDS.flatMap((field) => Object.keys(record(m[field]) ? m[field] : {}))),
  };
};

/** The packages under one checkout's `next/`, read once per lint run of that checkout. */
const trees = new Map<string, ReadonlyArray<Package>>();

const packagesIn = (root: string): ReadonlyArray<Package> => {
  const known = trees.get(root);

  if (known !== undefined) {
    return known;
  }

  const found = GROUPS.flatMap((group) => {
    const folder = join(root, "next", group);

    return existsSync(folder)
      ? readdirSync(folder, { withFileTypes: true })
          .filter((entry) => entry.isDirectory() && existsSync(join(folder, entry.name, "package.json")))
          .map((entry) => ({
            dir: join(folder, entry.name),
            group,
            manifest: manifestAt(join(folder, entry.name, "package.json")),
          }))
      : [];
  });

  trees.set(root, found);

  return found;
};

/** `@kampus/libfabrika/transport/Wire` is `{name: "@kampus/libfabrika", subpath: "./transport/Wire"}`. */
const packageAt = (spec: string): { readonly name: string; readonly subpath: string } => {
  const parts = spec.split("/");
  const size = spec.startsWith("@") ? 2 : 1;
  const rest = parts.slice(size);

  return { name: parts.slice(0, size).join("/"), subpath: rest.length === 0 ? "." : `./${rest.join("/")}` };
};

/** The file a relative import names, as Node and the bundlers find it, or where it points if none. */
const pointsAt = (from: string, spec: string): string => {
  const base = join(dirname(from), spec);
  const tries = [base, `${base}.ts`, `${base}.tsx`, join(base, "index.ts"), base.replace(/\.js$/, ".ts")];

  return tries.find((path) => existsSync(path) && statSync(path).isFile()) ?? base;
};

/** A package's `exports` map, each key with the file it points at, or `undefined` for a `null` target. */
const exportMap = (pkg: Package): ReadonlyMap<string, string | undefined> => {
  const target = (value: unknown): string | undefined => {
    if (typeof value === "string") {
      return join(pkg.dir, value);
    }

    if (!record(value)) {
      return undefined;
    }

    return target(value["import"] ?? value["default"]);
  };

  const { exports } = pkg.manifest;

  if (!record(exports)) {
    return exports === undefined ? new Map() : new Map([[".", target(exports)]]);
  }

  const entries = Object.entries(exports);

  if (!entries.every(([key]) => key.startsWith("."))) {
    return new Map([[".", target(exports)]]);
  }

  return new Map(entries.map(([key, value]) => [key, target(value)]));
};

/** What an import of a subpath reaches through an `exports` map. */
type Reached =
  | { readonly _tag: "file"; readonly file: string }
  | { readonly _tag: "refused" }
  | { readonly _tag: "missing" };

/**
 * Node's rule for a subpath (ticket 477, PR 9): an exact key without a `*` first; else, among the keys
 * with one `*` that the subpath fits, the one whose part before the `*` is longest, then the longer
 * key. A `null` target refuses the subpath, so `"./ledger/internal/*": null` beats `"./ledger/*"`. The
 * `*` of the target takes what the `*` of the key matched.
 */
export const exportAt = (map: ReadonlyMap<string, string | undefined>, subpath: string): Reached => {
  if (map.has(subpath) && !subpath.includes("*")) {
    const file = map.get(subpath);

    return file === undefined ? { _tag: "refused" } : { _tag: "file", file };
  }

  const [best] = [...map.keys()]
    .map((key) => ({ key, parts: key.split("*") }))
    .filter(
      ({ key, parts }) =>
        parts.length === 2 &&
        subpath.length >= key.length &&
        subpath.startsWith(parts[0] ?? "") &&
        subpath.endsWith(parts[1] ?? ""),
    )
    .sort((a, b) => (b.parts[0] ?? "").length - (a.parts[0] ?? "").length || b.key.length - a.key.length);

  if (best === undefined) {
    return { _tag: "missing" };
  }

  const file = map.get(best.key);
  const matched = subpath.slice((best.parts[0] ?? "").length, subpath.length - (best.parts[1] ?? "").length);

  return file === undefined ? { _tag: "refused" } : { _tag: "file", file: file.split("*").join(matched) };
};

/** `node:fs`, `fs`, `cloudflare:workers`: the platform's own, not a package anyone lists. */
const isPlatform = (spec: string): boolean => spec.includes(":") || builtinModules.includes(spec.split("/")[0] ?? "");

/** Files the exam owns that may sit outside a package until `next/apps/fabrika` has one. */
const EXAM = /^next\/apps\/fabrika\/(?:e2e\.ts$|e2e\/|src\/exam\/)/;

/** The one file of an app that may import `electron`. */
const ELECTRON_MAIN = "src/entry/electron-main.ts";

/** What each fault says, by its kind; the test reads a fire's kind through these. */
export const MESSAGES = {
  stray: () =>
    "This file sits in no next/ package (p65): put it in a folder of next/packages, next/programs or next/apps that holds a package.json.",
  unlisted: (spec: string, name: string) =>
    `"${spec}": ${name} is not in this package's package.json (p65). List it there, so no import walks up to the root's node_modules.`,
  missing: (spec: string, subpath: string, name: string) =>
    `"${spec}": ${subpath} is not in ${name}'s exports (p65). Import a name its exports map holds.`,
  refused: (spec: string, subpath: string, name: string) =>
    `"${spec}": ${subpath} is refused by ${name}'s exports (p65, ticket 477): an internal file stays inside its package.`,
  nofile: (spec: string, subpath: string, name: string) => `"${spec}": ${subpath} names no file in ${name} (p65).`,
  relative: (spec: string) =>
    `"${spec}": a relative path out of this file's package (p65). Import the other package by its name.`,
  electron: (spec: string) => `"${spec}": in an app, only ${ELECTRON_MAIN} may import electron (p65).`,
} as const;

/** A plain string a module source holds: a literal, or a template with no `${}`. */
const written = (source: Node | null | undefined): string | null => {
  if (source?.type === "Literal") {
    return typeof source.value === "string" ? source.value : null;
  }

  return source?.type === "TemplateLiteral" && source.expressions.length === 0
    ? (source.quasis[0]?.value.cooked ?? null)
    : null;
};

export const packageDeps: CreateRule = {
  meta: { type: "problem" },
  create(context) {
    const file = pathIn(context);

    if (!file.startsWith("next/")) {
      return {};
    }

    const packages = packagesIn(context.cwd);
    const full = join(context.cwd, file);
    const pkg = packages.find((each) => full.startsWith(`${each.dir}${sep}`));

    if (pkg === undefined) {
      return EXAM.test(file)
        ? {}
        : {
            Program(node) {
              context.report({ node, message: MESSAGES.stray() });
            },
          };
    }

    const byName = new Map(packages.map((each) => [each.manifest.name, each]));
    const inApp = pkg.group === "apps" && relative(pkg.dir, full).split(sep).join("/") !== ELECTRON_MAIN;

    const check = (source: Node | null | undefined) => {
      const spec = written(source);

      if (spec === null || source == null) {
        return;
      }

      const report = (message: string) => context.report({ node: source, message });

      if (spec.startsWith(".")) {
        if (!pointsAt(full, spec).startsWith(`${pkg.dir}${sep}`)) {
          report(MESSAGES.relative(spec));
        }

        return;
      }

      if (isPlatform(spec)) {
        return;
      }

      const { name, subpath } = packageAt(spec);

      if (name !== pkg.manifest.name && !pkg.manifest.listed.has(name)) {
        report(MESSAGES.unlisted(spec, name));
      }

      const target = byName.get(name);
      const reached = target === undefined ? undefined : exportAt(exportMap(target), subpath);

      if (reached?._tag === "missing") {
        report(MESSAGES.missing(spec, subpath, name));
      }

      if (reached?._tag === "refused") {
        report(MESSAGES.refused(spec, subpath, name));
      }

      if (reached?._tag === "file" && !existsSync(reached.file)) {
        report(MESSAGES.nofile(spec, subpath, name));
      }

      if (name === "electron" && inApp) {
        report(MESSAGES.electron(spec));
      }
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
