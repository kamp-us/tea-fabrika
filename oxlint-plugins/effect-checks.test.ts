// Law L2 of docs/plan/quests/effect-sweep-PLAN.md, after law 6 of docs/plan/effect-rules-big.md:
// every folder a slice of the Effect-check sweep locked still ends at `error` for its check of
// `@effect/tsgo`, in every project that type-checks it. A folder dropped in a merge is silent, since
// the type check just stops reading it, so the folders each slice locked are saved here.
//
// It walks the real files each project checks: what its tsconfig names, and every file those reach by
// a relative import, which the checker checks too. It merges the checker's plugin block
// the way the checker does (0577): the base's keys, then the project's, each key replacing the one
// before, except `diagnosticSeverity`, whose maps merge, and `overrides`, whose lists join. Each
// override a file matches then applies in order, its globs read from its own tsconfig's folder. So an
// `exclude`, a later override or a package block that turns a level down is seen as the checker sees
// it. A check no level names ends at its default from the checker's own schema.
//
// Plants, run once each (field/runs/2026-11-15-effect-e0-tests.json): one glob dropped from E0's
// entry, one level there set to `warning`, and a later override that sets one `off`: each is red.
// The fold of E0 to E3 (ticket 1075) planted one glob dropped from each of E1's, E2's and E3's lists: red.
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
  // B3.0 (ticket 912), then E0: vitest is a library at zero (0577). E2 (0577): libfabrika's folders at
  // zero, and all of tuval.
  preferNamespaceImport: [
    "next/packages/libfabrika/src/*.ts",
    "next/packages/libfabrika/src/access/**/*.ts",
    "next/packages/libfabrika/src/ci/**/*.ts",
    "next/packages/libfabrika/src/client/**/*.ts",
    "next/packages/libfabrika/src/codehost/**/*.ts",
    "next/packages/libfabrika/src/desktop/**/*.ts",
    "next/packages/libfabrika/src/node/**/*.ts",
    "next/packages/libfabrika/src/packs/**/*.ts",
    "next/packages/libfabrika/src/permissions/**/*.ts",
    "next/packages/libfabrika/src/presence/**/*.ts",
    "next/packages/libfabrika/src/repositories/**/*.ts",
    "next/packages/libfabrika/src/schedules/**/*.ts",
    "next/packages/libfabrika/src/tasks/**/*.ts",
    "next/packages/libfabrika/src/tezgah/**/*.ts",
    "next/packages/libfabrika/src/transport/**/*.ts",
    "next/packages/tuval/**/*.ts",
    "next/packages/tuval/**/*.tsx",
    "next/packages/vitest/**/*.ts",
  ],
  // E1 (0574): the folders where only the named unstable parts of Effect are used.
  unstableApiUsage: [
    ".agents/**/*.ts",
    ".github/ci/**/*.ts",
    ".github/ci/**/*.mjs",
    "next/apps/fabrika/src/entry/**/*.ts",
    "next/apps/fabrika/src/entry/**/*.tsx",
    "next/packages/libfabrika/src/*.ts",
    "next/packages/libfabrika/src/ci/**/*.ts",
    "next/packages/libfabrika/src/codehost/**/*.ts",
    "next/packages/libfabrika/src/presence/**/*.ts",
    "next/packages/libfabrika/src/repositories/**/*.ts",
    "next/packages/libfabrika/src/schedules/**/*.ts",
    "next/packages/libfabrika/src/tezgah/**/*.ts",
    "next/packages/libfabrika/src/transport/**/*.ts",
    "next/packages/tuval/**/*.ts",
    "next/packages/tuval/**/*.tsx",
    "next/packages/vitest/**/*.ts",
    "next/programs/tezgah/**/*.ts",
    "oxlint-plugins/**/*.ts",
    "oxlint-plugins/**/*.mjs",
  ],
  // E3 (ticket 1075): a Schema class is built with `.make`, never `new`, in every folder at zero.
  newSchemaClass: [
    ".agents/**/*.ts",
    ".github/ci/**/*.ts",
    ".github/ci/**/*.mjs",
    "oxlint-plugins/**/*.ts",
    "oxlint-plugins/**/*.mjs",
    "next/packages/tuval/**/*.ts",
    "next/packages/tuval/**/*.tsx",
    "next/packages/vitest/**/*.ts",
    "next/programs/**/*.ts",
    "next/programs/**/*.tsx",
    "next/apps/fabrika/*.ts",
    "next/apps/fabrika/e2e/**/*.ts",
    "next/apps/fabrika/src/exam/**/*.ts",
    "next/apps/fabrika/src/entry/**/*.ts",
    "next/apps/fabrika/src/entry/**/*.tsx",
    "fixtures/next/**/*.ts",
    "next/packages/libfabrika/src/*.ts",
    "next/packages/libfabrika/src/access/**/*.ts",
    "next/packages/libfabrika/src/ci/**/*.ts",
    "next/packages/libfabrika/src/client/**/*.ts",
    "next/packages/libfabrika/src/codehost/**/*.ts",
    "next/packages/libfabrika/src/coordination/**/*.ts",
    "next/packages/libfabrika/src/desktop/**/*.ts",
    "next/packages/libfabrika/src/node/**/*.ts",
    "next/packages/libfabrika/src/packs/**/*.ts",
    "next/packages/libfabrika/src/permissions/**/*.ts",
    "next/packages/libfabrika/src/presence/**/*.ts",
    "next/packages/libfabrika/src/repositories/**/*.ts",
    "next/packages/libfabrika/src/schedules/**/*.ts",
    "next/packages/libfabrika/src/tasks/**/*.ts",
    "next/packages/libfabrika/src/tezgah/**/*.ts",
    "next/packages/libfabrika/src/transport/**/*.ts",
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
    case "ObjectExpression": {
      const keys = node.properties.flatMap((property) =>
        property.type === "Property" && property.key.type === "Literal" ? [String(property.key.value)] : [],
      );

      // A duplicate key hides the earlier block from the compiler, including every lock it holds.
      expect(keys, "config keys must be unique").toEqual([...new Set(keys)]);

      return Object.fromEntries(
        node.properties.flatMap((property) =>
          property.type === "Property" && property.key.type === "Literal"
            ? [[String(property.key.value), value(property.value)]]
            : [],
        ),
      );
    }

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

/** A tsconfig's file keys, each from the nearest config in the `extends` chain that sets it, with that config's folder. */
type Roots = {
  readonly include: { readonly dir: string; readonly list: ReadonlyArray<string> } | undefined;
  readonly files: { readonly dir: string; readonly list: ReadonlyArray<string> } | undefined;
  readonly exclude: { readonly dir: string; readonly list: ReadonlyArray<string> } | undefined;
  readonly allowJs: boolean;
};

const rootsOf = (path: string): Roots => {
  const config = readConfig(path);
  const dir = dirname(path);

  const parent: Roots =
    typeof config.extends === "string"
      ? rootsOf(resolve(dir, config.extends))
      : { include: undefined, files: undefined, exclude: undefined, allowJs: false };

  const own = (key: string) => (key in config ? { dir, list: strings(config[key]) } : undefined);
  const allowJs = record(config.compilerOptions).allowJs;

  return {
    include: own("include") ?? parent.include,
    files: own("files") ?? parent.files,
    exclude: own("exclude") ?? parent.exclude,
    allowJs: typeof allowJs === "boolean" ? allowJs : parent.allowJs,
  };
};

const TS = [".ts", ".tsx", ".mts", ".cts"];

const JS = [".js", ".jsx", ".mjs", ".cjs"];

/** The file a relative import names, as NodeNext resolution with `allowImportingTsExtensions` finds it. */
const resolveImport = (from: string, request: string): string | undefined => {
  const base = resolve(dirname(from), request);
  const stem = base.slice(0, base.length - extname(base).length);

  const swapped: Readonly<Record<string, ReadonlyArray<string>>> = {
    ".js": [".ts", ".tsx"],
    ".jsx": [".tsx"],
    ".mjs": [".mts"],
    ".cjs": [".cts"],
  };

  const candidates = [
    base,
    ...(swapped[extname(base)] ?? []).map((extension) => stem + extension),
    ...[...TS, ".d.ts", ...JS].map((extension) => base + extension),
    ...TS.map((extension) => join(base, `index${extension}`)),
  ];

  return candidates.find((file) => existsSync(file) && statSync(file).isFile());
};

/** The relative imports one file makes: static, re-exports, and dynamic ones with a plain string. */
const importsOf = (file: string): ReadonlyArray<string> => {
  const text = readFileSync(file, "utf8");
  const { module } = parseSync(file, text);

  const requests = [
    ...module.staticImports.map((entry) => entry.moduleRequest.value),
    ...module.staticExports.flatMap((entry) => entry.entries.flatMap((one) => one.moduleRequest?.value ?? [])),
    ...module.dynamicImports.flatMap((entry) => {
      const literal = /^(["'`])([^"'`$]*)\1$/.exec(text.slice(entry.moduleRequest.start, entry.moduleRequest.end));

      return literal?.[2] ?? [];
    }),
  ];

  return requests.filter((request) => request.startsWith("./") || request.startsWith("../"));
};

const excluded = (dir: string, globs: ReadonlyArray<string>, file: string): boolean => {
  const path = relative(dir, file).replaceAll("\\", "/");

  return globs.some((glob) =>
    glob.includes("*") ? matchesGlob(path, glob) : path === glob || path.startsWith(`${glob}/`),
  );
};

/**
 * The files one project type-checks, as the checker does: what its `include` names (a glob as it
 * is, a file as it is, a folder as every file under it) less its `exclude`, then its `files`, then
 * every file those reach by a relative import, which `exclude` does not take out. Only the
 * extensions TypeScript checks, the JavaScript ones with `allowJs`, never under `node_modules`.
 * A relative import that names no file is returned apart, so the law can fail on a file the
 * checker reaches and the walk cannot.
 */
const programOf = (path: string): { readonly files: ReadonlyArray<string>; readonly lost: ReadonlyArray<string> } => {
  const roots = rootsOf(path);
  const allowed = roots.allowJs ? [...TS, ...JS] : TS;
  const checked = (file: string) => allowed.includes(extname(file)) && !file.split("/").includes("node_modules");

  const included = (roots.include?.list ?? []).flatMap((entry) => {
    const dir = roots.include?.dir ?? dirname(path);
    const full = resolve(dir, entry);

    if (entry.includes("*")) {
      return globSync(entry, { cwd: dir }).map((file) => resolve(dir, file));
    }

    if (existsSync(full) && statSync(full).isDirectory()) {
      return globSync("**/*", { cwd: full }).map((file) => resolve(full, file));
    }

    return existsSync(full) ? [full] : [];
  });

  const start = [
    ...included.filter((file) => roots.exclude === undefined || !excluded(roots.exclude.dir, roots.exclude.list, file)),
    ...(roots.files?.list ?? []).map((entry) => resolve(roots.files?.dir ?? dirname(path), entry)),
  ].filter(checked);

  const seen = new Set(start);
  const lost: Array<string> = [];
  const queue = [...start];

  for (let file = queue.pop(); file !== undefined; file = queue.pop()) {
    for (const request of importsOf(file)) {
      const [name = request, query] = request.split("?");

      // `./x.sh?raw` names no code: an ambient `*?raw` module types it (`.agents/raw.d.ts`).
      if (query !== undefined) {
        if (!existsSync(resolve(dirname(file), name))) {
          lost.push(`${relative(ROOT, file)} imports ${request}`);
        }

        continue;
      }

      const target = resolveImport(file, request);

      if (target === undefined) {
        lost.push(`${relative(ROOT, file)} imports ${request}`);
      } else if (checked(target) && !seen.has(target)) {
        seen.add(target);
        queue.push(target);
      }
    }
  }

  return { files: [...seen], lost };
};

const programs = PROJECTS.map((project) => ({
  project,
  block: blockOf(join(ROOT, project)),
  ...programOf(join(ROOT, project)),
}));

/** Every file each project type-checks, with that project's plugin block. */
const projectFiles = programs.flatMap(({ project, block, files }) => files.map((file) => ({ project, file, block })));

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

  // Coverage: every relative import a checked file makes names a file, so the walk reads all the checker reads.
  expect(programs.flatMap(({ lost }) => lost)).toEqual([]);
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
