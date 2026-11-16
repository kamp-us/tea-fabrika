// Law L2 of docs/plan/quests/effect-sweep-PLAN.md, after law 6 of docs/plan/effect-rules-big.md:
// every folder a slice of the Effect-check sweep locked still ends at `error` for its check of
// `@effect/tsgo`, in every project that type-checks it. A folder dropped in a merge is silent, since
// the type check just stops reading it, so the folders each slice locked are saved here.
//
// It walks the real files each project's tsconfig includes, and merges the checker's plugin block
// the way the checker does (0577): the base's keys, then the project's, each key replacing the one
// before, except `diagnosticSeverity`, whose maps merge, and `overrides`, whose lists join. Each
// override a file matches then applies in order, its globs read from its own tsconfig's folder. So an
// `exclude`, a later override or a package block that turns a level down is seen as the checker sees
// it. A check no level names ends at its default from the checker's own schema.
//
// Plants, run once each (field/runs/2026-11-15-effect-e0-tests.json): one glob dropped from E0's
// entry, one level there set to `warning`, and a later override that sets one `off`: each is red.
import { existsSync, globSync, readFileSync, statSync } from "node:fs";
import { dirname, extname, join, matchesGlob, relative, resolve } from "node:path";
import { type Expression, parseSync } from "oxc-parser";
import { expect, it } from "vitest";

const ROOT = join(import.meta.dirname, "..");
const PLUGIN = "@effect/language-service";

// Every project `pnpm typecheck` reads in `next/` and our tooling.
const PROJECTS = [
  ...globSync("next/*/*/tsconfig.json", { cwd: ROOT }),
  ".agents/tsconfig.json",
  ".github/ci/tsconfig.json",
  "oxlint-plugins/tsconfig.json",
].sort();

// The sweep's whole scope, relative to the repo root.
const SCOPE = [
  "next/**/*.ts",
  "next/**/*.tsx",
  "fixtures/next/**/*.ts",
  ".agents/**/*.ts",
  ".github/ci/**/*.ts",
  ".github/ci/**/*.mjs",
  "oxlint-plugins/**/*.ts",
  "oxlint-plugins/**/*.mjs",
  "stylelint.config.ts",
];

// E0: every check with 0 hits in the scope on 2026-11-15, locked for all of it at once.
const ZERO = [
  "abortControllerInEffect",
  "acquireReleaseDisposable",
  "allOfMapToForEach",
  "catchAllTagDispatchToCatchTag",
  "catchAllToMapError",
  "catchChainToFirstSuccessOf",
  "catchDieToOrDie",
  "catchIfTagToCatchTag",
  "catchRefailToTapError",
  "catchTagToCatchReason",
  "catchUnfailableEffect",
  "classSelfMismatch",
  "cryptoRandomUUID",
  "cryptoRandomUUIDInEffect",
  "duplicatePackage",
  "effectDoNotation",
  "effectFnIife",
  "effectFnImplicitAny",
  "effectFnOpportunity",
  "effectGenUsesAdapter",
  "effectInFailure",
  "effectInVoidSuccess",
  "effectMapFlatten",
  "effectMapVoid",
  "effectSleepZeroToYieldNow",
  "errorPayloadShadowsName",
  "experimentalApiUsage",
  "failCauseToConstructor",
  "flatMapIdentityToFlatten",
  "flatMapToMap",
  "flatMapToTap",
  "floatingEffect",
  "floatingEffectInVitest",
  "genericEffectServices",
  "globalRandom",
  "globalRandomInEffect",
  "globalTimersInEffect",
  "layerMergeAllWithDependencies",
  "lazyPromiseInEffectSync",
  "leakingRequirements",
  "manualMetricTapToTrack",
  "mapConstToAs",
  "mapSomeToAsSome",
  "matchEffectToMapBoth",
  "matchEffectToMatch",
  "missingEffectContext",
  "missingEffectError",
  "missingEffectServiceDependency",
  "missingLayerContext",
  "missingReturnYieldStar",
  "missingStarInYieldEffectGen",
  "nonObjectEffectServiceType",
  "obsoleteMatchImport",
  "obsoleteSchemaImport",
  "optionMatchToFromOption",
  "outdatedApi",
  "overriddenSchemaConstructor",
  "preferSchemaTaggedError",
  "preferSchemaTypeProperty",
  "promiseInEffectSuccess",
  "provideLayerSucceedToProvideService",
  "raceFirstWithSleepToTimeout",
  "redundantMapError",
  "redundantOrDie",
  "redundantSchemaTagIdentifier",
  "schemaClassObjectLiteral",
  "schemaLiteralNonFinite",
  "schemaOpaqueInstanceMember",
  "schemaUnionOfLiterals",
  "scopeInLayerEffect",
  "serviceNotAsClass",
  "syncToSucceed",
  "timeoutCatchTagToTimeoutOrElse",
  "tryCatchInEffectGen",
  "unknownInEffectCatch",
  "unnecessaryPipe",
  "unnecessaryPipeChain",
  "unsafeEffectTypeAssertion",
];

// The folders each slice locked, on the day it landed. A slice adds its check's row or its globs;
// none is taken out, since narrowing a lock waits on the owner (0014).
const LOCKED: Readonly<Record<string, ReadonlyArray<string>>> = {
  ...Object.fromEntries(ZERO.map((check) => [check, SCOPE])),
  // B3.0 (ticket 912), then E0: vitest is a library at zero (0577).
  preferNamespaceImport: [
    "next/packages/libfabrika/src/ci/**/*.ts",
    "next/packages/libfabrika/src/codehost/**/*.ts",
    "next/packages/vitest/**/*.ts",
  ],
  // E0: every program, and our tooling, whose scripts are programs too (call 2 of the plan).
  preferBarrelImport: [
    "next/programs/**/*.ts",
    "next/programs/**/*.tsx",
    ".agents/**/*.ts",
    ".github/ci/**/*.ts",
    ".github/ci/**/*.mjs",
    "oxlint-plugins/**/*.ts",
    "oxlint-plugins/**/*.mjs",
    "stylelint.config.ts",
  ],
};

type Options = Readonly<Record<string, unknown>>;

type Override = {
  readonly dir: string;
  readonly include: ReadonlyArray<string>;
  readonly exclude: ReadonlyArray<string>;
  readonly options: Options;
};

type Block = { readonly options: Options; readonly overrides: ReadonlyArray<Override> };

const record = (x: unknown): Options =>
  typeof x === "object" && x !== null && !Array.isArray(x) ? Object.fromEntries(Object.entries(x)) : {};

const list = (x: unknown): ReadonlyArray<unknown> => (Array.isArray(x) ? x : []);

const strings = (x: unknown): ReadonlyArray<string> => list(x).filter((item) => typeof item === "string");

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
const readConfig = (path: string): Options => {
  const parsed = parseSync("tsconfig.ts", `(${readFileSync(path, "utf8")})`);
  expect(parsed.errors, path).toEqual([]);
  const statement = parsed.program.body[0];

  if (statement?.type !== "ExpressionStatement") {
    throw new Error(`${path} did not parse as one expression`);
  }

  return record(value(statement.expression));
};

/** Two plugin option sets, merged as the checker merges `extends` and an override. */
const merge = (base: Options, child: Options): Options => ({
  ...base,
  ...child,
  diagnosticSeverity: { ...record(base.diagnosticSeverity), ...record(child.diagnosticSeverity) },
});

/** The checker's plugin block for one tsconfig, through its whole `extends` chain. */
const blockOf = (path: string): Block => {
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

const matches = (dir: string, globs: ReadonlyArray<string>, file: string): boolean => {
  const path = relative(dir, file).replaceAll("\\", "/");
  return globs.some((glob) => matchesGlob(path, glob));
};

/** The options one file ends with: the block's, then each override it matches, in order. */
const optionsAt = (block: Block, file: string): Options =>
  block.overrides
    .filter(
      (override) => matches(override.dir, override.include, file) && !matches(override.dir, override.exclude, file),
    )
    .reduce((options, override) => merge(options, override.options), block.options);

const SCHEMA = record(JSON.parse(readFileSync(join(ROOT, "node_modules", "@effect", "tsgo", "schema.json"), "utf8")));

/** Each check's level when no config names it, from the checker's own schema. */
const DEFAULTS: Options = Object.fromEntries(
  Object.entries(
    record(record(record(SCHEMA.definitions).effectLanguageServicePluginDiagnosticSeverityDefinition).properties),
  ).map(([check, schema]) => [check, record(schema).default]),
);

/** The level a check ends at for one file. An import check is off when its list does not name `effect`. */
const levelAt = (options: Options, check: string): unknown => {
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

/**
 * The files a tsconfig's `include` names, as TypeScript reads it: a glob as it is, a file as it is,
 * and a folder as every file under it. Only the extensions TypeScript checks, and with `allowJs` the
 * JavaScript ones too; never under `node_modules`.
 */
const filesOf = (path: string): ReadonlyArray<string> => {
  const config = readConfig(path);
  const dir = dirname(path);
  const extensions = [".ts", ".tsx", ".mts", ".cts"];
  const allowed =
    record(config.compilerOptions).allowJs === true ? [...extensions, ".js", ".jsx", ".mjs", ".cjs"] : extensions;
  const found = strings(config.include).flatMap((entry) => {
    const full = resolve(dir, entry);

    if (entry.includes("*")) {
      return globSync(entry, { cwd: dir }).map((file) => resolve(dir, file));
    }

    if (existsSync(full) && statSync(full).isDirectory()) {
      return globSync("**/*", { cwd: full }).map((file) => resolve(full, file));
    }

    return existsSync(full) ? [full] : [];
  });

  return [...new Set(found)].filter(
    (file) => allowed.includes(extname(file)) && !file.split("/").includes("node_modules"),
  );
};

/** Every file each project type-checks, with that project's plugin block. */
const projectFiles = PROJECTS.flatMap((project) => {
  const path = join(ROOT, project);
  const block = blockOf(path);
  return filesOf(path).map((file) => ({ project, file, block }));
});

it("pinned: every folder a slice of the Effect-check sweep locked still ends at error for its check, in every project that reads it", () => {
  // pinned: the folders locked on the day each slice landed, since a folder dropped in a merge is silent.
  const reached = new Set<string>();
  const wrong: Array<readonly [string, string, string, unknown]> = [];

  for (const { project, file, block } of projectFiles) {
    const locked = Object.entries(LOCKED).filter(([, globs]) => matches(ROOT, globs, file));

    if (locked.length === 0) {
      continue;
    }

    const options = optionsAt(block, file);

    for (const [check, globs] of locked) {
      for (const glob of globs.filter((one) => matches(ROOT, [one], file))) {
        reached.add(`${check} ${glob}`);
      }

      const level = levelAt(options, check);

      if (level !== "error") {
        wrong.push([check, relative(ROOT, file), project, level]);
      }
    }
  }

  // A check the table names is one the checker has, so a renamed check is not passed in silence.
  expect(Object.keys(LOCKED).filter((check) => !(check in DEFAULTS))).toEqual([]);
  // Coverage: each locked glob reads a real file some project checks, so a moved folder is not passed in silence.
  expect(
    Object.entries(LOCKED)
      .flatMap(([check, globs]) => globs.map((glob) => `${check} ${glob}`))
      .filter((key) => !reached.has(key)),
  ).toEqual([]);
  expect(wrong).toEqual([]);
});
