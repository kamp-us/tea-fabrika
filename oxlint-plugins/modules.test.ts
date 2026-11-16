import * as Arr from "effect/Array";
import * as Rec from "effect/Record";
import { pipe } from "effect/Function";
// Ticket 477, PR 0: the lint laws of libfabrika's modules (decision 0043), each seen to fire on a
// planted file before a file moves. All of this is `next/`. Three rules carry them:
//   - `fabrika/modules`, hand-written, since no existing rule says these four: no module re-exports
//     another module's names; `src/` holds only the listed modules and top files; every export in an
//     `internal/` file is `@internal`; the shared top files hold values only.
//   - oxlint's own `eslint/no-restricted-imports`: nobody outside a module imports its `internal/`.
//   - oxlint's own `unicorn/filename-case`: a front file is PascalCase and an `internal/` file is
//     camelCase (decision 0040: an existing rule before a hand-written one).
// The planted files are linted with the repository's own `.oxlintrc.json`, at their real paths, so
// the config's lists and path globs are under test with the rule.
//
// A law about the whole file (a folder nobody listed, a file name) may report on any line, so those
// cases ask only whether the rule fired. A law about one statement names its line. Line 1 of every
// planted file is a comment, so no statement shares a line with a whole-file report.
import { spawnSync } from "node:child_process";
import { join } from "node:path";
import * as fc from "fast-check";
import { RuleTester } from "oxlint/plugins-dev";
import { describe, expect, it } from "vitest";
import { plant } from "../next/apps/fabrika/src/exam/plant.ts";
import { modules as modulesRule } from "./modules.ts";

const SRC = "next/packages/libfabrika/src";

const MODULES = [
  "telemetry",
  "ledger",
  "transport",
  "processes",
  "presence",
  "tasks",
  "access",
  "runtime",
  "gateway",
] as const;

/** Every module with every other module: 72 pairs, so no pair is left to a pattern nobody tried. */
const PAIRS = Arr.flatMap(MODULES, (module) =>
  pipe(
    MODULES,
    Arr.filter((other) => other !== module),
    Arr.map((other) => [module, other] as const),
  ),
);

const modules = "fabrika(modules)";

const restricted = "eslint(no-restricted-imports)";

const fileCase = "unicorn(filename-case)";

const file = (...lines: ReadonlyArray<string>): string => Arr.join(["// planted", ...lines, ""], "\n");
const pascal = (name: string): string => `${name.slice(0, 1).toUpperCase()}${name.slice(1)}`;

const own = "export const own = 1;";

const pair = (module: string, other: string) => `${SRC}/${module}/From${pascal(other)}.ts`;
  const reexportFiles = {
    ...Rec.fromEntries(
      Arr.map(PAIRS, ([module, other]) => [
        pair(module, other),
        file(
          `export {a} from "../${other}/Front.ts";`, // 2
          `export type {B} from "../${other}/Front.ts";`, // 3
          `export * from "../${other}/Front.ts";`, // 4
          `export * as other from "../${other}/Front.ts";`, // 5
          `import {e} from "../${other}/Front.ts";`, // 6: an import is the layers' business
          "export {e};", // 7: the same name, sent on in two steps
          'export {f} from "./Own.ts";', // 8: the module's own name
          `export const g = 1;`, // 9
        ),
      ]),
    ),
    // The plan's plant, with its real names.
    [`${SRC}/processes/Mailbox.ts`]: file('export {Rev} from "../ledger/Log.ts";'),
    // A module's `internal/` file is a module file too.
    [`${SRC}/gateway/internal/admit.ts`]: file(
      "/** @internal */",
      'export {Rev} from "../../ledger/Log.ts";', // 3
      "/** @internal */",
      'export {wait} from "./waiting.ts";', // 5
    ),
    // Not module files: the package's entry and the two platform folders put the modules together.
    [`${SRC}/index.ts`]: file('export {Ledger} from "./ledger/Ledger.ts";'),
    [`${SRC}/cloudflare/index.ts`]: file('export {cloudflareSql} from "../ledger/CloudflareSql.ts";'),
    [`${SRC}/node/index.ts`]: file('export * from "../runtime/Runner.ts";'),
    // Another package's folders are not libfabrika's modules.
    "next/packages/tuval/src/door/Door.ts": file('export {a} from "../ledger/Log.ts";'),
};

const reexports = await plant(reexportFiles);

describe("fabrika/modules: no module file re-exports another module's names", () => {
  // Plant (the plan's): `processes/Mailbox.ts` holds `export {Rev} from "../ledger/Log.ts"`.
  it("fires on every form of re-export, for each of the 72 pairs of modules", () => {
    for (const [module, other] of PAIRS) {
      expect(reexports(modules, pair(module, other)), `${module} from ${other}`).toEqual([2, 3, 4, 5, 7]);
    }

    expect(reexports(modules, `${SRC}/processes/Mailbox.ts`)).toEqual([2]);
    expect(reexports(modules, `${SRC}/gateway/internal/admit.ts`)).toEqual([3]);
  });

  it("takes the entry file, the platform folders and another package", () => {
    for (const path of [
      `${SRC}/index.ts`,
      `${SRC}/cloudflare/index.ts`,
      `${SRC}/node/index.ts`,
      "next/packages/tuval/src/door/Door.ts",
    ]) {
      expect(reexports(modules, path), path).toEqual([]);
    }
  });
});

const unlisted = [
    `${SRC}/utils/x.ts`, // the plan's plant: a folder by kind
    `${SRC}/sync/Merge.ts`,
    `${SRC}/Ledger/Ledger.ts`, // a module's name in another case is another folder
    `${SRC}/LedgerError.ts`, // the plan's plant: no shared error (0043, rule 12)
    `${SRC}/Helpers.ts`,
    `${SRC}/Helpers.test.ts`,
];

const listed = [
  ...Arr.map(MODULES, (module) => `${SRC}/${module}/Front.ts`),
  ...Arr.map(MODULES, (module) => `${SRC}/${module}/Front.test.ts`),
    `${SRC}/node/brain.ts`,
    `${SRC}/cloudflare/brain.ts`,
    `${SRC}/index.ts`,
    `${SRC}/Id.ts`,
    `${SRC}/Id.test.ts`,
    `${SRC}/Id.types.test.ts`,
    `${SRC}/Id.test-support.ts`,
    `${SRC}/Testing.ts`,
    `${SRC}/Testing.test.ts`,
    `${SRC}/ProcessId.ts`,
    `${SRC}/Sql.ts`,
    `${SRC}/Rev.ts`,
    // Outside libfabrika's `src/` the list says nothing.
    "next/packages/libfabrika/utils/x.ts",
    "next/packages/tuval/src/utils/x.ts",
    "next/apps/fabrika/src/utils/x.ts",
];

const places = await plant(Object.fromEntries([...unlisted, ...listed].map((path) => [path, file(own)])));

describe("fabrika/modules: src/ holds only the listed modules and top files", () => {
  // Plants (the plan's): add `src/utils/x.ts`; `src/LedgerError.ts` exists.
  it("fires on a file in a folder or at a top name nobody listed", () => {
    for (const path of unlisted) {
      expect(places(modules, path), path).not.toEqual([]);
    }
  });

  it("takes the nine modules, the platform folders, the listed top files and their tests", () => {
    for (const path of listed) {
      expect(places(modules, path), path).toEqual([]);
    }
  });
});

const internalBody = file(
    "/** @internal */", // 2
    "export const a = 1;", // 3
    "", // 4
    "export const b = 2;", // 5: no comment
    "", // 6
    "/**", // 7
    " * Folds the rows.", // 8
    " *", // 9
    " * @internal", // 10
    " */", // 11
    "export function c() { return 1; }", // 12
    "", // 13
    "export function d() { return 1; }", // 14: no comment
    "", // 15
    "/** Says what it is and not who may use it. */", // 16
    "export type E = number;", // 17: a comment with no tag
    "", // 18
    "/** @internal */", // 19
    "export interface F { readonly n: number }", // 20
    "", // 21
    "const g = 1;", // 22: not exported
    "", // 23
    "/** @internal */", // 24
    "export class H {}", // 25
    "", // 26
    "export class I {}", // 27: no comment
    "", // 28
    "/** @internal */", // 29
    "export const j = g;", // 30
    "", // 31
    "// @internal", // 32: a line comment is not the tag a doc tool reads
    "export const k = 3;", // 33
);
  const internalFiles = {
    ...Rec.fromEntries(Arr.map(MODULES, (module) => [`${SRC}/${module}/internal/part.ts`, internalBody])),
    // The plan's real name, and a folder below `internal/`.
  [`${SRC}/ledger/internal/ledgerStore.ts`]: internalBody,
  [`${SRC}/runtime/internal/holder/state.ts`]: internalBody,
    // A front file's exports are the module's public names, and a test exports nothing.
  [`${SRC}/ledger/Ledger.ts`]: internalBody,
    [`${SRC}/ledger/internal/ledgerStore.test.ts`]: file("const a = 1;", "void a;"),
    // Another package's `internal/` is not a module's.
  "next/packages/tuval/src/desktop/internal/part.ts": internalBody,
};

const internals = await plant(internalFiles);

describe("fabrika/modules: every export in an internal/ file is @internal", () => {
  // Plant: an `internal/` file with one export that has no `@internal` doc comment.
  it("fires on each export with no @internal doc comment, in every module's internal/", () => {
    for (const path of [
      ...Arr.map(MODULES, (module) => `${SRC}/${module}/internal/part.ts`),
      `${SRC}/ledger/internal/ledgerStore.ts`,
      `${SRC}/runtime/internal/holder/state.ts`,
    ]) {
      expect(internals(modules, path), path).toEqual([5, 14, 17, 27, 33]);
    }
  });

  it("takes a front file, a test and another package", () => {
    for (const path of [
      `${SRC}/ledger/Ledger.ts`,
      `${SRC}/ledger/internal/ledgerStore.test.ts`,
      "next/packages/tuval/src/desktop/internal/part.ts",
    ]) {
      expect(internals(modules, path), path).toEqual([]);
    }
  });
});

const topBody = file(
    'import {Context, Schema} from "effect";', // 2
    'export const Rev = Schema.Int.pipe(Schema.brand("Rev"));', // 3
    "export type Rev = typeof Rev.Type;", // 4
    'export class RevError extends Schema.TaggedError<RevError>()("RevError", {}) {}', // 5: an error
    'export class Revs extends Context.Service<Revs, {readonly next: number}>()("libfabrika/Revs") {}', // 6: a service
    'export class Point extends Schema.Class<Point>("Point")({n: Schema.Number}) {}', // 7: a value
    "export const parse = (text: string): number => Number(text);", // 8
    "export class Fault extends Error {}", // 9: an error
    "export interface Sql { readonly run: (text: string) => void }", // 10: a shape
);

// The same two, reached by other spellings of the import (main's `id.ts` writes `Schema as S`).
const topSpelled = file(
    'import {Schema as S} from "effect";', // 2
    'import * as Context from "effect/Context";', // 3
    'export class SqlError extends S.TaggedError<SqlError>()("SqlError", {}) {}', // 4
    'export class Sqls extends Context.Service<Sqls, {readonly n: number}>()("libfabrika/Sqls") {}', // 5
    "export const SqlValue = S.Union([S.String, S.Number, S.Null]);", // 6
);

const topFiles = {
  [`${SRC}/Rev.ts`]: topBody,
  [`${SRC}/Sql.ts`]: topSpelled,
  [`${SRC}/ProcessId.ts`]: topBody,
    // A module's front file is where its services and errors live.
  [`${SRC}/ledger/Ledger.ts`]: topBody,
    // `Id.ts` is not on the list: main's `id.ts` exports `IdError` and the `Generator` service,
    // and PR 2 only changes the case of its name.
  [`${SRC}/Id.ts`]: topBody,
  [`${SRC}/Testing.ts`]: topBody,
  "next/packages/tuval/src/Rev.ts": topBody,
};

const tops = await plant(topFiles);

describe("fabrika/modules: the shared top files hold values only", () => {
  // Plant (the plan's): `src/Rev.ts` exports a `Schema.TaggedError`.
  it("fires on a service and on an error in Rev.ts, Sql.ts and ProcessId.ts", () => {
    expect(tops(modules, `${SRC}/Rev.ts`)).toEqual([5, 6, 9]);
    expect(tops(modules, `${SRC}/ProcessId.ts`)).toEqual([5, 6, 9]);
    expect(tops(modules, `${SRC}/Sql.ts`)).toEqual([4, 5]);
  });

  it("takes the same lines in a module, in Id.ts, in Testing.ts and in another package", () => {
    for (const path of [
      `${SRC}/ledger/Ledger.ts`,
      `${SRC}/Id.ts`,
      `${SRC}/Testing.ts`,
      "next/packages/tuval/src/Rev.ts",
    ]) {
      expect(tops(modules, path), path).toEqual([]);
    }
  });
});

const front = (module: string, other: string) => `${SRC}/${module}/Into${pascal(other)}.ts`;
  const inner = (module: string, other: string) => `${SRC}/${module}/internal/into${pascal(other)}.ts`;
  const importFiles = {
    ...Rec.fromEntries(
      Arr.flatMap(PAIRS, ([module, other]) => [
        [
          front(module, other),
          file(
            `import {a} from "../${other}/internal/part.ts";`, // 2
            `import type {B} from "../${other}/internal/part.ts";`, // 3
            `export {c} from "../${other}/internal/part.ts";`, // 4
            `export * from "../${other}/internal/part.ts";`, // 5
            `import {e} from "./../${other}/internal/part.ts";`, // 6: the same file, spelled longer
            `import {f} from "../${other}/internal/deep/part.ts";`, // 7
            'import {g} from "./internal/part.ts";', // 8: the module's own
            `import {h} from "../${other}/Front.ts";`, // 9: a front file
            "export const all = [a, e, f, g, h];",
          ),
        ],
        [
          inner(module, other),
          file(
            `import {a} from "../../${other}/internal/part.ts";`, // 2
            `import {b} from "./../../${other}/internal/part.ts";`, // 3
            `export {c} from "../../${other}/internal/part.ts";`, // 4
            'import {d} from "./part.ts";', // 5: the module's own
            'import {e} from "../Front.ts";', // 6
            `import {f} from "../../${other}/Front.ts";`, // 7
            "/** @internal */",
            "export const all = [a, b, d, e, f];",
          ),
        ],
      ]),
    ),
    // The plan's two plants, with their real names.
    [`${SRC}/gateway/Gateway.ts`]: file(
      'import {ledgerStore} from "../ledger/internal/ledgerStore.ts";', // 2
      'import {waiting} from "./internal/waiting.ts";', // 3
      // The override repeats the base rule's Radix entry, so it still fires here.
      'import {gray} from "@radix-ui/colors";', // 4
      "export const all = [ledgerStore, waiting, gray];",
    ),
    [`${SRC}/cloudflare/runtime.ts`]: file(
      'import {supervisor} from "../runtime/internal/supervisor.ts";', // 2
      'import {Runner} from "../runtime/Runner.ts";', // 3
      "export const all = [supervisor, Runner];",
    ),
    [`${SRC}/node/brain.ts`]: file(
      'import {recovery} from "../runtime/internal/recovery.ts";', // 2
      "export const all = [recovery];",
    ),
    // The top files are outside every module.
    [`${SRC}/index.ts`]: file(
      'export {ledgerStore} from "./ledger/internal/ledgerStore.ts";', // 2
      'export {Ledger} from "./ledger/Ledger.ts";', // 3
    ),
    [`${SRC}/Testing.ts`]: file(
      'import {supervisor} from "./runtime/internal/supervisor.ts";', // 2
      'import {Runner} from "./runtime/Runner.ts";', // 3
      "export const all = [supervisor, Runner];",
    ),
    // A module's own test reads its own `internal/`.
  [`${SRC}/ledger/Ledger.test.ts`]: file('import {ledgerStore} from "./internal/ledgerStore.ts";', "void ledgerStore;"),
};

const imports = await plant(importFiles);

describe("eslint/no-restricted-imports: nobody outside a module imports its internal/", () => {
  // Plants (the plan's): `gateway/Gateway.ts` imports `../ledger/internal/ledgerStore.ts`, and
  // `cloudflare/runtime.ts` imports `../runtime/internal/supervisor.ts`.
  it("fires on an import and on an export-from, in either spelling, for each of the 72 pairs", () => {
    for (const [module, other] of PAIRS) {
      // A front file of ledger/ is two layers down for three modules: the last describe's law.
      const down = other === "ledger" && ["runtime", "access", "gateway"].includes(module);
      expect(imports(restricted, front(module, other)), `${module} into ${other}`).toEqual(
        down ? [2, 3, 4, 5, 6, 7, 9] : [2, 3, 4, 5, 6, 7],
      );
      expect(imports(restricted, inner(module, other)), `${module} into ${other}`).toEqual(
        down ? [2, 3, 4, 7] : [2, 3, 4],
      );
    }
  });

  it("fires in the platform folders and the top files, and keeps the Radix entry", () => {
    expect(imports(restricted, `${SRC}/gateway/Gateway.ts`)).toEqual([2, 4]);
    expect(imports(restricted, `${SRC}/cloudflare/runtime.ts`)).toEqual([2]);
    expect(imports(restricted, `${SRC}/node/brain.ts`)).toEqual([2]);
    expect(imports(restricted, `${SRC}/index.ts`)).toEqual([2]);
    expect(imports(restricted, `${SRC}/Testing.ts`)).toEqual([2]);
  });

  it("takes a module's own internal/ from its test", () => {
    expect(imports(restricted, `${SRC}/ledger/Ledger.test.ts`)).toEqual([]);
  });
});

// The modules with no file on main. `transport/` joins in PR 2 and `door/` in PR 5, when their
// lowercase files have moved, so the rule fires on nothing on main.
const FRESH = ["telemetry", "ledger", "processes", "presence", "tasks", "access", "runtime"] as const;

const badNames = [
    `${SRC}/ledger/log.ts`, // the plan's plant
    `${SRC}/ledger/internal/LedgerStore.ts`, // the plan's plant
    ...Arr.flatMap(FRESH, (module) => [
      `${SRC}/${module}/kebab-case.ts`,
      `${SRC}/${module}/camelCase.ts`,
      `${SRC}/${module}/kebab-case.test.ts`,
      `${SRC}/${module}/internal/PascalCase.ts`,
      `${SRC}/${module}/internal/kebab-case.ts`,
      `${SRC}/${module}/internal/PascalCase.test.ts`,
    ]),
];

const goodNames = [
  ...Arr.flatMap(FRESH, (module) => [
      `${SRC}/${module}/PascalCase.ts`,
      `${SRC}/${module}/PascalCase.test.ts`,
      `${SRC}/${module}/internal/camelCase.ts`,
      `${SRC}/${module}/internal/camelCase.test.ts`,
    ]),
    // The move's own names (the plan's files tables), with every suffix a file carries there.
    `${SRC}/ledger/Log.ts`,
    `${SRC}/ledger/NodeSqlite.ts`,
    `${SRC}/ledger/internal/ledgerStore.ts`,
    `${SRC}/runtime/Program.types.test.ts`,
    `${SRC}/runtime/BrainLife.laws.test.ts`,
    `${SRC}/runtime/internal/supervisor.laws.test.ts`,
    `${SRC}/processes/Process.test-support.ts`,
    `${SRC}/telemetry/P12Readers.laws.test.ts`,
    `${SRC}/telemetry/internal/measurements.test.ts`,
    `${SRC}/Id.test-support.ts`,
];

const names = await plant(Object.fromEntries([...badNames, ...goodNames].map((path) => [path, file(own)])));

describe("unicorn/filename-case: a front file is PascalCase and an internal/ file is camelCase", () => {
  // Plants (the plan's): add `src/ledger/log.ts` and `src/ledger/internal/LedgerStore.ts`.
  it("fires on a front file not in PascalCase and an internal/ file not in camelCase", () => {
    for (const path of badNames) {
      expect(names(fileCase, path), path).not.toEqual([]);
    }
  });

  it("takes the right case, with .test, .types.test, .laws.test and .test-support suffixes", () => {
    for (const path of goodNames) {
      expect(names(fileCase, path), path).toEqual([]);
    }
  });
});

const ABOVE = ["runtime", "access", "gateway"] as const;

const ledgerBody = (up: string) =>
    file(
      `import {Ledger} from "${up}ledger/Ledger.ts";`, // 2
      `import type {LedgerError} from "${up}ledger/Ledger.ts";`, // 3
      `export {Line} from "${up}ledger/Log.ts";`, // 4
      `import {Sink} from "${up}telemetry/Sink.ts";`, // 5: telemetry is open to every module
      `import {Mailbox} from "${up}processes/Mailbox.ts";`, // 6
      `import {store} from "${up}processes/internal/store.ts";`, // 7: another module's internal/
      'import {cyan} from "@radix-ui/colors";', // 8
      `export const all = [Ledger, Line, Sink, Mailbox, store, cyan];`,
    );

const ledgerRefused = Arr.flatMap(ABOVE, (module) => [
    [`${SRC}/${module}/Front.ts`, "../"],
    [`${SRC}/${module}/Front.test.ts`, "../"],
    [`${SRC}/${module}/internal/front.ts`, "../../"],
]);

const ledgerTaken = (["processes", "presence"] as const).map((module) => [`${SRC}/${module}/Front.ts`, "../"]);

const ledgerImports = await plant(
  Object.fromEntries([...ledgerRefused, ...ledgerTaken].map(([path = "", up = ""]) => [path, ledgerBody(up)])),
);

// scenario: every module and every depth, since the law is a list of paths in the config. 0043, rule
// 11 and its amendments: the module above never sees what is two layers down, so `runtime/`,
// `access/` and `gateway/` import no `ledger/`, types and tests included (0062). The override that
// says so replaces the modules override's options, so its Radix and `internal/` entries must still hold.
describe("runtime/, access/ and gateway/ never import ledger/", () => {
  it("refuses an import or re-export of ledger/, a type too, from each of the three, tests too", () => {
    for (const [path = ""] of ledgerRefused) {
      expect(ledgerImports(restricted, path), path).toEqual([2, 3, 4, 7, 8]);
    }
  });

  it("leaves the modules the law does not name to their own rows, with the modules override's bans", () => {
    for (const [path = ""] of ledgerTaken) {
      expect(ledgerImports(restricted, path), path).toEqual([7, 8]);
    }
  });
});

// L5 of the trusted-rules swap (0573): `fabrika/one-id-module` is gone, and `modules` (rule 2) holds its
// one path, since `data` is no folder the config lists. The retired rule's generated bodies run in
// process through RuleTester with the config's own options, and the first run's four bodies, one of
// each kind, then go through one oxlint run each with the repo's config.
// Plant: add `"data"` to the `folders` list of the `modules` block, and the retired path is taken.
it("refuses the retired Id module at data/id.ts for generated contents, and takes Id.ts and transport/id.ts", async () => {
  const root = join(import.meta.dirname, "..");
  const retired = `${SRC}/data/id.ts`;
  const taken = [`${SRC}/Id.ts`, `${SRC}/transport/id.ts`];

  const printed = spawnSync(join(root, "node_modules", ".bin", "oxlint"), ["--print-config"], {
    cwd: root,
    encoding: "utf8",
    maxBuffer: 2 ** 28,
  });

  const config: { overrides: ReadonlyArray<{ rules: Record<string, unknown> }> } = JSON.parse(printed.stdout);
  // `--print-config` prints a setting as `[level, options]`.
  const setting = config.overrides.map(({ rules }) => rules["fabrika/modules"]).findLast(Array.isArray);
  const given: unknown = setting?.[1];
  expect(Array.isArray(given), "the config sets fabrika/modules with its lists").toBe(true);
  const options = Array.isArray(given) ? given : [];
  // RuleTester runs each case at once, so a failure throws into fast-check, which shrinks it.
  RuleTester.describe = (_name, fn) => fn();
  RuleTester.it = (_name, fn) => fn();
  const tester = new RuleTester({ cwd: root });
  let kinds: ReadonlyArray<string> = [];
  fc.assert(
    fc.property(fc.string(), fc.integer(), (text, count) => {
      const bodies = [
        "",
        `export const value = ${JSON.stringify(text)};`,
        `export const value = ${count};`,
        'export * from "../Id.ts";',
      ];

      if (kinds.length === 0) {
        kinds = bodies;
      }

      for (const code of bodies) {
        tester.run("modules", modulesRule, {
          valid: taken.map((filename) => ({ code, filename, options })),
          invalid: [{ code, filename: retired, options, errors: [{ line: 1, message: /\S/ }] }],
        });
      }
    }),
    { seed: 119120, numRuns: 10 },
  );
  expect(kinds).toHaveLength(4);

  for (const body of kinds) {
    const linted = await plant(Object.fromEntries([retired, ...taken].map((path) => [path, body])));
    expect(linted(modules, retired), body).toEqual([1]);

    for (const path of taken) {
      expect(linted(modules, path), `${path}: ${body}`).toEqual([]);
    }
  }
});
