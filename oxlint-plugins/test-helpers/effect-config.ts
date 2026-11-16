// The Effect checker's settings for one tsconfig, read the way the checker reads them (0577). Plain
// TypeScript replaces a child's whole `plugins` list, but the checker merges its own plugin block
// through `extends`, key by key: the base's keys, then the project's, each key replacing the one
// before, except `diagnosticSeverity`, whose maps merge, and `overrides`, whose lists join. Each
// override a file matches then applies in order, its globs read from its own tsconfig's folder. A
// check no level names ends at its default from the checker's own schema.
// oxlint-plugins/effect-checks.test.ts and effect-checks-held.test.ts both read the checker's levels through here.
import { readFileSync } from "node:fs";
import { dirname, join, matchesGlob, relative, resolve } from "node:path";
import { type Expression, parseSync } from "oxc-parser";

const ROOT = join(import.meta.dirname, "..", "..");
const PLUGIN = "@effect/language-service";

export type Options = Readonly<Record<string, unknown>>;

/** One override of the checker's block, with the folder its globs read from. */
type Override = {
  readonly dir: string;
  readonly include: ReadonlyArray<string>;
  readonly exclude: ReadonlyArray<string>;
  readonly options: Options;
};

/** The checker's whole block for one tsconfig: its merged options and every override, in order. */
type Block = { readonly options: Options; readonly overrides: ReadonlyArray<Override> };

export const record = (x: unknown): Options =>
  typeof x === "object" && x !== null && !Array.isArray(x) ? Object.fromEntries(Object.entries(x)) : {};

const list = (x: unknown): ReadonlyArray<unknown> => (Array.isArray(x) ? x : []);

export const strings = (x: unknown): ReadonlyArray<string> => list(x).filter((item) => typeof item === "string");

/** A JSON value from a parsed tsconfig, comments dropped. */
const value = (node: Expression): unknown => {
  switch (node.type) {
    case "ParenthesizedExpression":
      return value(node.expression);
    case "Literal":
      return node.value;
    case "ArrayExpression":
      return node.elements.map((element) =>
        element === null || element.type === "SpreadElement" ? null : value(element),
      );
    case "ObjectExpression":
      return Object.fromEntries(
        node.properties.flatMap((property) =>
          property.type === "Property" && property.key.type === "Literal"
            ? [[String(property.key.value), value(property.value)]]
            : [],
        ),
      );
    default:
      throw new Error(`a tsconfig holds a ${node.type}, which is not JSON`);
  }
};

/** A tsconfig's own JSON. A tsconfig has comments, so it is read as a JS expression. */
export const readConfig = (path: string): Options => {
  const parsed = parseSync("tsconfig.ts", `(${readFileSync(path, "utf8")})`);

  if (parsed.errors.length > 0) {
    throw new Error(`${path} did not parse: ${parsed.errors.map((error) => error.message).join("; ")}`);
  }

  const statement = parsed.program.body[0];

  if (statement?.type !== "ExpressionStatement") {
    throw new Error(`${path} did not parse as one expression`);
  }

  return record(value(statement.expression));
};

/** Two plugin option sets, merged as the checker merges `extends` and an override. */
export const merge = (base: Options, child: Options): Options => ({
  ...base,
  ...child,
  diagnosticSeverity: { ...record(base.diagnosticSeverity), ...record(child.diagnosticSeverity) },
});

/** The checker's plugin block for one tsconfig, through its whole `extends` chain. */
export const blockOf = (path: string): Block => {
  const config = readConfig(path);
  const dir = dirname(path);
  const parent: Block =
    typeof config.extends === "string" ? blockOf(resolve(dir, config.extends)) : { options: {}, overrides: [] };
  const plugin = list(record(config.compilerOptions).plugins)
    .map(record)
    .find((entry) => entry.name === PLUGIN);
  const { overrides, ...options } = record(plugin);
  const own = list(overrides)
    .map(record)
    .map((override) => ({
      dir,
      include: strings(override.include),
      exclude: strings(override.exclude),
      options: record(override.options),
    }));

  return { options: merge(parent.options, options), overrides: [...parent.overrides, ...own] };
};

export const matches = (dir: string, globs: ReadonlyArray<string>, file: string): boolean => {
  const path = relative(dir, file).replaceAll("\\", "/");
  return globs.some((glob) => matchesGlob(path, glob));
};

/** The options one file ends with: the block's, then each override it matches, in order. */
export const optionsAt = (block: Block, file: string): Options =>
  block.overrides
    .filter(
      (override) => matches(override.dir, override.include, file) && !matches(override.dir, override.exclude, file),
    )
    .reduce((options, override) => merge(options, override.options), block.options);

const SCHEMA = record(JSON.parse(readFileSync(join(ROOT, "node_modules", "@effect", "tsgo", "schema.json"), "utf8")));

/** Each check's level when no config names it, from the checker's own schema. */
export const DEFAULTS: Options = Object.fromEntries(
  Object.entries(
    record(record(record(SCHEMA.definitions).effectLanguageServicePluginDiagnosticSeverityDefinition).properties),
  ).map(([check, schema]) => [check, record(schema).default]),
);

/** The level a check ends at for one file. An import check is off when its list does not name `effect`. */
export const levelAt = (options: Options, check: string): unknown => {
  const named = (key: string) => strings(options[key]).includes("effect");

  if (check === "preferNamespaceImport" && !named("namespaceImportPackages")) {
    return "off";
  }

  // Named in both lists, a package takes the namespace form (0577).
  if (check === "preferBarrelImport" && (!named("barrelImportPackages") || named("namespaceImportPackages"))) {
    return "off";
  }

  return record(options.diagnosticSeverity)[check] ?? DEFAULTS[check];
};
