// The lint rules are the exam, so each one is seen to fail. Each planted line says whether its rule
// must refuse it. The planted files sit beside this one, so the repository's own .oxlintrc.json is
// what runs. `no-secret-env` and `no-redacted-value` are planted in
// packages/fabrika/src/redacted-lint.test.ts, `no-project-settings` in
// packages/fabrika/src/agents/claude/rules.test.ts.
// `no-node-imports` plants next/ paths in its own test file.
// `program-package-layout` reads a program's package.json, so it plants generated program
// packages under next/programs/ in program-package-layout.test.ts.
// The planted lines of our own rules also run in process through oxlint's RuleTester, and every
// plant's file goes through one oxlint run, so the config is still what refuses each one.
import { spawnSync } from "node:child_process";
import {
  copyFileSync,
  mkdirSync,
  readdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, relative } from "node:path";
import { it } from "@effect/vitest";
import { Array as Arr, Effect, Formatter, pipe, Predicate, Record as Rec, Schema, Order, String as Str } from "effect";
import fc from "fast-check";
import { parseSync } from "oxc-parser";
import { RuleTester } from "oxlint/plugins-dev";
import { afterAll, describe, expect } from "vitest";
import {
  BUILTIN_PLANTS,
  GRANT_NO_CONSOLE,
  LIBFABRIKA_NO_CONSOLE,
  NEXT_TSX_PLANTS,
  type Plant,
  PROCESS_OUTPUT,
  REFLECT,
  REFLECT_NEW_FOLDERS,
  TAGGED_ERROR,
  VI_METHODS,
  VI_PROPERTIES,
} from "./builtin-plants.ts";
import fabrika from "./index.ts";
import { plant as lintCopies } from "./plant.ts";

/** A promise the test waits on rejected: the test's own failure, with the rejection as its cause. */
class TestFailure extends Schema.TaggedError<TestFailure, { readonly brand: unique symbol }>()("TestFailure", {
  cause: Schema.Unknown,
}) {}

/** Waits on a promise inside the test's Effect, as `Effect.tryPromise` in its object form. */
const promised = <A>(run: () => PromiseLike<A>) =>
  Effect.tryPromise({ try: run, catch: (cause) => TestFailure.make({ cause }) });

const ROOT = join(import.meta.dirname, "..");

const OXLINT = join(ROOT, "node_modules", ".bin", "oxlint");

type JsoncNode = any;

const jsoncValue = (node: JsoncNode): unknown => {
  if (node.type === "ObjectExpression") {
    return Object.fromEntries(
      node.properties.map((property: JsoncNode) => [
        property.key.value ?? property.key.name,
        jsoncValue(property.value),
      ]),
    );
  }

  if (node.type === "ArrayExpression") {
    return node.elements.map(jsoncValue);
  }

  if (node.type === "Literal") {
    return node.value;
  }

  throw new Error(`.oxlintrc.json holds a ${node.type}`);
};

interface LintConfig {
  overrides: Array<{
    files: string[];
    rules?: Record<string, unknown>;
    [key: string]: unknown;
  }>;
  [key: string]: unknown;
}

const readLintConfig = (text: string): LintConfig => {
  const parsed = parseSync("oxlintrc.ts", `export default ${text}`);
  expect(parsed.errors).toEqual([]);
  const program: JsoncNode = parsed.program;

  return jsoncValue(program.body[0].declaration) as LintConfig;
};

const withoutGrantNoConsole = (text: string): LintConfig => {
  const config = readLintConfig(text);

  const matches = config.overrides.flatMap((override, index) =>
    override.files.length === 1 &&
    override.files[0] === GRANT_NO_CONSOLE.file &&
    override.rules !== undefined &&
    Object.hasOwn(override.rules, GRANT_NO_CONSOLE.rule)
      ? [index]
      : [],
  );

  expect(matches).toHaveLength(1);

  const index = matches[0]!;
  const override = config.overrides[index]!;
  const rules = override.rules!;

  expect(rules[GRANT_NO_CONSOLE.rule]).toBe("error");
  delete rules[GRANT_NO_CONSOLE.rule];

  if (Object.keys(rules).length === 0) {
    delete override.rules;

    if (Object.keys(override).length === 1) {
      config.overrides.splice(index, 1);
    }
  }

  return config;
};

/** The config without one rule on the override whose only glob is `glob`: the control a plant is read against. */
const withoutRuleOn = (text: string, glob: string, rule: string): LintConfig => {
  const config = readLintConfig(text);

  const matches = config.overrides.filter(
    (override) =>
      override.files.length === 1 &&
      override.files[0] === glob &&
      override.rules !== undefined &&
      Object.hasOwn(override.rules, rule),
  );

  expect(matches).toHaveLength(1);
  delete matches[0]!.rules![rule];

  return config;
};

// RuleTester runs each case at once, inside the test that plants it.
RuleTester.describe = (_name, fn) => fn();

RuleTester.it = (_name, fn) => fn();

// From the top of the repo, so a rule reads each planted path as oxlint gives it there.
const tester = new RuleTester({ cwd: ROOT });

const plant = mkdtempSync(join(import.meta.dirname, ".plant-"));

afterAll(() => rmSync(plant, { recursive: true, force: true }));

// What `./b.laws` must be taken for: a file with one more extension, not a named file.
writeFileSync(join(plant, "b.laws.ts"), "export const b = 1;\n");

type Fire = { readonly code: string; readonly line: number };

/** What `pnpm lint`'s oxlint refuses in each of these files, from one run through the repo's config. */
const firesIn = (paths: readonly string[]): ReadonlyMap<string, readonly Fire[]> => {
  const out = spawnSync(OXLINT, ["--format=json", ...Arr.map(paths, (path) => relative(ROOT, path))], {
    cwd: ROOT,
    encoding: "utf8",
  });

  // SAFETY: oxlint's JSON report has a `diagnostics` list in the shape written below.
  const report = JSON.parse(out.stdout) as {
    readonly diagnostics: readonly {
      readonly code: string;
      readonly filename: string;
      readonly labels: readonly { readonly span: { readonly line: number } }[];
    }[];
  };

  const fires = new Map<string, Fire[]>(Arr.map(paths, (path) => [path, []]));

  for (const d of report.diagnostics) {
    if (d.labels[0] !== undefined) {
      fires.get(join(ROOT, d.filename))?.push({ code: d.code, line: d.labels[0].span.line });
    }
  }

  return fires;
};

/** The lines one rule's code refuses, in order. */
const linesOf = (fires: readonly Fire[], code: string): readonly number[] =>
  pipe(
    fires,
    Arr.filter((f) => f.code === code),
    Arr.map((f) => f.line),
  ).sort((a, b) => a - b);

/** The lines `pnpm lint`'s oxlint refuses in this file under one rule's code. */
const fires = (path: string, code: string): readonly number[] => linesOf(firesIn([path]).get(path)!, code);

const EFFECT = 'import {Context, Data, Duration, Effect, Schedule} from "effect";';

/**
 * `fabrika/no-data-taggederror`'s lines. It stays beside oxlint's `no-restricted-properties` entry
 * (0573, the plan's amendment of 2026-11-15), since only ours refuses `Data.TaggedError` in a type
 * position: its `banNames` visits `TSQualifiedName`. L1 below runs these lines in every folder too.
 * Plant: drop `"fabrika/no-data-taggederror"` from `.oxlintrc.json`, and the type lines are not refused.
 */
const DATA_TAGGEDERROR: Plant = {
  code: "fabrika(no-data-taggederror)",
  prelude: [EFFECT, "declare const Other: {TaggedError: (n: string) => new () => object};"],
  lines: [
    ['export class A extends Data.TaggedError("A") {}', true],
    ["export const ref = Data.TaggedError;", true],
    ['export const made = Data.TaggedError("C");', true],
    // Type positions, which no trusted rule refuses.
    ["export type Made = typeof Data.TaggedError;", true],
    ['export type Instance = InstanceType<ReturnType<typeof Data.TaggedError<"X">>>;', true],
    ['export class B extends Other.TaggedError("B") {}', false],
    ["// Data.TaggedError in a comment", false],
    ['export const text = "Data.TaggedError";', false],
  ],
};

const PLANTS: readonly Plant[] = [
  {
    code: "fabrika(no-bare-tell)",
    prelude: [
      "declare const run: {tell: (n: string, x: number) => unknown};",
      "declare const tell: (r: unknown, n: string, x: number) => unknown;",
      "declare const xs: number[];",
    ],
    lines: [
      ['tell(run, "n", 1);', true],
      ['run.tell("n", 1);', true],
      ['xs.forEach((x) => run.tell("n", x));', true],
      ['export const told = tell(run, "n", 1);', false],
    ],
  },
  {
    code: "fabrika(no-context-tag)",
    prelude: [EFFECT],
    lines: [
      ['export const a = Context.Tag("a");', true],
      ['export const b = Context.GenericTag("b");', true],
      ['export const c = Effect.Service("c");', true],
      ['export const d = Context.Service("d");', false],
    ],
  },
  DATA_TAGGEDERROR,
  {
    code: "fabrika(no-effect-promise)",
    prelude: [EFFECT, "declare const p: () => Promise<number>;", "declare const c: () => string;"],
    lines: [
      ["export const a = Effect.promise(p);", true],
      ["export const b = Effect.tryPromise(p);", true],
      ["export const d = Effect.tryPromise({try: p, catch: c});", false],
    ],
  },
  {
    code: "fabrika(no-expect-in-if)",
    file: "planted.test.ts",
    prelude: [
      "declare const it: (n: string, f: () => void) => void;",
      "declare const expect: (x: unknown) => {toBe: (y: unknown) => void};",
      "declare const x: number;",
    ],
    lines: [
      ['it("a", () => { if (x > 0) { expect(x).toBe(1); } });', true],
      ['it("b", () => { expect(x).toBe(1); if (x > 0) { expect(x).toBe(1); } });', false],
    ],
  },
  {
    code: "fabrika(no-implicit-effect-concurrency)",
    prelude: [EFFECT, "declare const xs: number[];", "declare const f: (x: number) => unknown;"],
    lines: [
      ["export const a = Effect.all(xs);", true],
      ["export const b = Effect.forEach(xs, f);", true],
      ["export const c = Effect.validate(xs, f);", true],
      ['export const d = Effect.all(xs, {concurrency: "unbounded"});', false],
      ["export const e = Effect.forEach(xs, f, {concurrency: 1});", false],
    ],
  },
  {
    code: "fabrika(no-numeric-duration)",
    prelude: [EFFECT],
    lines: [
      ["export const a = Effect.sleep(5000);", true],
      ["export const b = Schedule.spaced(1000);", true],
      ['export const c = Effect.sleep("5 seconds");', false],
      ["export const d = Effect.sleep(Duration.seconds(5));", false],
    ],
  },
  {
    code: "fabrika(no-raw-try-catch)",
    prelude: [EFFECT, "declare const f: () => void;", "export const e = Effect.void;"],
    lines: [
      ["try { f(); } catch { f(); }", true],
      ["export const g = () => { f(); };", false],
    ],
  },
  {
    code: "fabrika(no-throw-in-effect-gen)",
    prelude: [EFFECT],
    lines: [
      ['export const a = Effect.gen(function* () { throw new Error("a"); });', true],
      ['export const b = () => { throw new Error("b"); };', false],
    ],
  },
  {
    code: "fabrika(no-type-assertions)",
    prelude: ["declare const x: number;"],
    lines: [
      ["export const a = x as any;", true],
      ["export const b = x as unknown as string;", true],
      ["export const c = x as number;", false],
    ],
  },
  {
    code: "fabrika(use-import-extensions)",
    prelude: [],
    lines: [
      ['export {a} from "./thing";', true],
      ['export {b} from "./b.laws";', true],
      ['export const c = import("./thing");', true],
      ['export {d} from "./thing.ts";', false],
      ['export {e} from "effect";', false],
      // Only `b.laws.ts` is there, so Node would not find either of these.
      ['export {f} from "./b.laws.js";', true],
      ['export {g} from "./b.laws.tsx";', true],
      ['export {h} from "./b.laws.ts";', false],
    ],
  },
  {
    code: "fabrika(no-redacted-value)",
    file: "planted.tsx",
    prelude: ['import {Redacted} from "effect";', "declare const Other: {value: () => null};"],
    lines: [
      ["export const a = <Redacted.value />;", true],
      ["export const b = <Redacted.value></Redacted.value>;", true],
      ["export const c = <Other.value />;", false],
    ],
  },
  // Biome's built-in rules that must not be lost in the move.
  {
    code: "eslint(no-unused-vars)",
    prelude: [],
    lines: [
      ['import {gone} from "./gone.ts";', true],
      ["const unused = 1;", true],
      ["export const f = (a: number, _b: number) => a;", false],
      ["export const g = (a: number, b: number) => a;", true],
    ],
  },
  {
    code: "typescript(no-non-null-assertion)",
    prelude: ["declare const x: number | undefined;"],
    lines: [
      ["export const a = x!;", true],
      ["export const b = x ?? 0;", false],
    ],
  },
  {
    code: "typescript(ban-ts-comment)",
    prelude: [],
    lines: [
      ["// @ts-ignore", true],
      ["export const a = 1;", false],
    ],
  },
  {
    // Braces on every body, even on one line (owner, 2026-11-09; 0021).
    code: "eslint(curly)",
    prelude: ["declare let x: number;", "declare const ys: number[];"],
    lines: [
      ["if (x) x++;", true],
      ["if (x) { x++; } else x--;", true],
      ["for (const y of ys) x += y;", true],
      ["while (x) x--;", true],
      ["do x--; while (x);", true],
      ["if (x) { x++; } else { x--; }", false],
    ],
  },
  {
    code: "eslint(no-sequences)",
    prelude: [],
    lines: [
      ["export const a = (1, 2);", true],
      ["export const b = [1, 2];", false],
    ],
  },
  {
    code: "eslint(array-callback-return)",
    prelude: ["declare const xs: number[];", "declare const f: (x: number) => void;"],
    lines: [
      ["xs.forEach((x) => x);", true],
      ["xs.forEach((x) => { f(x); });", false],
    ],
  },
  {
    code: "typescript(no-empty-object-type)",
    prelude: [],
    lines: [
      ["export declare const a: {};", true],
      ["export declare const b: {c: 1};", false],
    ],
  },
  // Code never reaches a primitive (design language call 3's lint half): only the token build,
  // under packages/fabrika-design/src/build/, imports Radix. The path case is below.
  {
    code: "eslint(no-restricted-imports)",
    prelude: [],
    lines: [
      ['import {slateDarkA} from "@radix-ui/colors";', true],
      ['import "@radix-ui/colors/slate-dark-alpha.css";', true],
      ['export {slate} from "effect";', false],
    ],
  },
];

/** Each file the describe below plants, written as it is collected, so one oxlint run reads them all. */
const planted: string[] = [];

const put = (name: string, text: string): string => {
  const file = join(plant, name);
  writeFileSync(file, text);
  planted.push(file);

  return file;
};

/** The planted file, its text and the lines its rule must refuse. */
const write = (p: Plant, name: string) => {
  const text = `${Arr.join([...p.prelude, ...Arr.map(p.lines, ([line]) => line)], "\n")}\n`;
  const file = put(`${name}-${p.file ?? "planted.ts"}`, text);
  const want = Arr.flatMap(p.lines, ([, refused], at) => (refused ? [p.prelude.length + at + 1] : []));

  return { file, text, want };
};

let linted: ReadonlyMap<string, readonly Fire[]> | undefined;

/** The one oxlint run over every planted file, made by the first test that reads it. */
const firesInPlanted = (file: string, code: string): readonly number[] =>
  linesOf((linted ??= firesIn(planted)).get(file)!, code);

/** In process, RuleTester: our own rule refuses exactly the lines it must. */
const inProcess = (p: Plant, { file, text, want }: ReturnType<typeof write>) => {
  const rule = fabrika.rules[p.code.replace(/^fabrika\((.*)\)$/, "$1")]!;
  const filename = relative(ROOT, file);
  tester.run(p.code, rule, {
    valid: want.length === 0 ? [{ code: text, filename }] : [],
    invalid:
      want.length === 0 ? [] : [{ code: text, filename, errors: Arr.map(want, (line) => ({ line, message: /\S/ })) }],
  });
};

describe("each rule refuses what it is there to refuse", () => {
  const ours = Arr.map(PLANTS, (p, i) => [p.code, p, write(p, String(i))] as const);
  const builtIn = Arr.map(BUILTIN_PLANTS, (p, i) => [p.code, p, write(p, `builtin-${i}`)] as const);
  const self = put("self.ts", 'import {a} from "./self.ts";\nimport {b} from "./b.laws.ts";\nexport {a, b};\n');

  const poll = put(
    "poll.test.ts",
    `${Arr.join(
      [
        'import {expect, it} from "vitest";',
        'it("a", () => { expect.poll(() => 1).toBe(1); });',
        'it("b", async () => { await expect.poll(() => 1).toBe(1); });',
      ],
      "\n",
    )}\n`,
  );

  const notATest = put(
    "not-a-test.ts",
    `declare const it: any, expect: any, x: number;\n${'it("a", () => { if (x > 0) { expect(x).toBe(1); } });'}\n`,
  );

  it.each(ours)("%s", (_code, p, at) => {
    if (p.code.startsWith("fabrika(")) {
      inProcess(p, at);
    }

    expect(firesInPlanted(at.file, p.code)).toEqual(at.want);
  });

  it.each(builtIn)("built in, on with 0 hits: %s", (_code, p, at) => {
    expect(firesInPlanted(at.file, p.code)).toEqual(at.want);
  });

  // M2, the `vi` lock is a pair: the vitest rule's plant is the built-in one above, and this is the
  // properties rule's, planted in the same lines. A line is held when either refuses it, which is
  // the whole lock; a chained call is held by the properties rule alone, `v.fn()` by the vitest rule alone.
  // Plant: drop the block's `vi` entries from `eslint/no-restricted-properties`, and the two chained
  // lines are not refused; delete the block, and the refused lines are not refused.
  const viProperties = write(VI_PROPERTIES, "vi-properties");

  const viMethods = write(VI_METHODS, "vi-methods");

  it("scenario: built in, on with 0 hits: eslint(no-restricted-properties) refuses the vi member access, chained or not", () => {
    expect(firesInPlanted(viProperties.file, VI_PROPERTIES.code)).toEqual(viProperties.want);
  });

  it("scenario: the vi lock holds every banned line, and no other, through the pair of rules", () => {
    const held = [
      ...new Set([
        ...firesInPlanted(viMethods.file, "vitest(no-restricted-vi-methods)"),
        ...firesInPlanted(viProperties.file, VI_PROPERTIES.code),
      ]),
    ].sort((a, b) => a - b);

    // The two plants hold the same lines in the same order, so one line number is one line of each.
    expect(viMethods.text).toEqual(viProperties.text);
    // Each plant's `want` is the lines it marks refused; the lock holds the union of the two.
    expect(held).toEqual([...new Set([...viMethods.want, ...viProperties.want])].sort((a, b) => a - b));
  });

  it("built in, on with 0 hits: import(no-self-import)", () => {
    expect(firesInPlanted(self, "import(no-self-import)")).toEqual([1]);
  });

  // It reports each line twice, so this one counts lines, not reports.
  it("built in, on with 0 hits: vitest(require-awaited-expect-poll)", () => {
    expect([...new Set(firesInPlanted(poll, "vitest(require-awaited-expect-poll)"))]).toEqual([2]);
  });

  // The React rules on only in next/'s .tsx files, linted whole at their next/ paths (0591).
  it.each(Arr.map(NEXT_TSX_PLANTS, (p) => [Arr.join(Rec.keys(p.fires), ", "), p] as const))(
    "built in, on in next/'s .tsx files: %s",
    async (_codes, p) => {
      const result = await lintCopies(p.files);

      for (const [code, want] of Rec.toEntries(p.fires)) {
        for (const file of Rec.keys(p.files)) {
          expect([code, file, result(code, file)]).toEqual([code, file, want[file] ?? []]);
        }
      }
    },
  );

  it("A3b: raw console calls in the grant entry are refused by its exact override", () => {
    const config = readFileSync(join(ROOT, ".oxlintrc.json"), "utf8");
    const control = withoutGrantNoConsole(config);
    const neighbor = "next/apps/fabrika/grant-neighbor.ts";

    const sources = {
      [GRANT_NO_CONSOLE.file]: GRANT_NO_CONSOLE.text,
      [neighbor]: 'export const log = () => console.log("outside");',
    };

    inConfigCopy(({ lintFiles, lintWithConfig }) => {
      const current = lintFiles(sources);
      const disabled = lintWithConfig(control, sources);

      expect(refusedIn(current, GRANT_NO_CONSOLE.file, GRANT_NO_CONSOLE.code)).toEqual(GRANT_NO_CONSOLE.lines);
      expect(refusedIn(disabled, GRANT_NO_CONSOLE.file, GRANT_NO_CONSOLE.code)).toEqual([]);
      expect(refusedIn(current, neighbor, GRANT_NO_CONSOLE.code)).toEqual([]);
      expect(refusedIn(disabled, neighbor, GRANT_NO_CONSOLE.code)).toEqual([]);
    });
  }, 120_000);

  it("each built-in rule is planted once", () => {
    const codes = [
      ...Arr.map(BUILTIN_PLANTS, (p) => p.code),
      GRANT_NO_CONSOLE.code,
      ...Arr.flatMap(NEXT_TSX_PLANTS, (p) => Rec.keys(p.fires)),
    ];

    expect(new Set(codes).size).toBe(codes.length);
  });

  it("a test file is the only place no-expect-in-if looks", () => {
    expect(firesInPlanted(notATest, "fabrika(no-expect-in-if)")).toEqual([]);
  });

  it.live("the plugin has one planted line or more for every rule it lists", () =>
    Effect.gen(function* () {
      const { default: plugin } = yield* promised(() => import("./index.ts"));
      const planted = new Set(Arr.map(PLANTS, (p) => p.code));

      // `no-bare-disable` reports at the top of the file, so it has its own test below.
      const elsewhere = [
        "prefer-schema-arbitrary", // generated syntax laws in prefer-schema-arbitrary.test.ts
        "law-shape", // one generated line per edge case, at next/ test paths, in law-shape.test.ts
        "no-secret-env",
        "no-redacted-value",
        "no-project-settings",
        "no-bare-disable",
        // P17a's path-scoped rules have plants in their own oxlint-plugins/*.test.ts files.
        "door-is-library",
        "outside-input-constructor",
        // T737's rule reads only libfabrika's src, so service-id.test.ts plants it there.
        "service-id",
        "service-contract", // P19 plants the three desktop contracts and a native import below.
        // Generated files and their fix in padding-line-between-statements.test.ts.
        "padding-line-between-statements",
        // next/'s exam rules, planted at next/ paths through plant.ts, each in its own <rule>.test.ts here
        // (0591 moved them from next/apps/fabrika/src/exam/; no-of's path laws are in no-of.test.ts).
        "no-promises",
        "no-effect-run-outside-edge",
        "edge-comment",
        "effect-functions",
        "no-of",
        "no-hand-tag",
        "one-store-hook",
        "no-clock-in-view",
        // p65's import half, planted as the exam's deps trees at next/ paths in package-deps.test.ts (0591).
        "package-deps",
        // Generated ledger-sql.test.ts plants run at next/ paths with the real lint config.
        "no-ledger-sql",
        "no-node-imports",
        // libfabrika's modules are planted at their real paths in modules.test.ts.
        "modules",
        // E6's docs rule is on for every next/packages folder: jsdocs.test.ts generates its files and
        // plants one per left-out kind at real paths with the real lint config.
        "jsdocs",
        // A service's written type and its static members are planted at next/ paths with the real
        // lint config in written-service-type.test.ts and no-static-layer.test.ts.
        "written-service-type",
        "no-static-layer",
        // Generated no-cause-squash.test.ts plants run at next/ and .agents/ paths with the real lint config.
        "no-cause-squash",
        // P16's rule reads the program package, so generated packages plant it in its own test file.
        "program-package-layout",
        // Generated no-question-word-key.test.ts plants run at next/ and .agents/ paths with the real
        // lint config, beside oxlint's own id-denylist. Generated no-wall-clock.test.ts plants run at
        // next/ paths with the real lint config.
        "no-question-word-key",
        "no-wall-clock",
        "one-machine-per-file", // scoped plant and blocking check below
        "isolate-boundary", // scoped platform-name plant below
        // E1 (0574): no-stability-tag.test.ts plants a tag at in-scope and waiting paths with the real lint config.
        "no-stability-tag",
        // E2 (0577): prefer-namespace-import.test.ts plants imports at in-scope and later folders with the real lint config.
        "prefer-namespace-import",
        // Generated no-stage-word.test.ts plants run at next/ paths with the real lint config.
        "no-stage-word",
        // package-imports.test.ts plants one file per part at its next/ path with the real lint config.
        "package-imports",
        // 0536's rule is on for next/'s test files only: integration-test-name.test.ts plants a plain
        // and a named file under next/ and runs oxlint over them with the real lint config.
        "integration-test-name",
        // Ticket 1029's rule reads only next/'s test files, suites and test kits: test-database.test.ts
        // plants generated lines at those paths, and at product and outside paths it must pass.
        "test-database",
        // 0535's rule reads only next/'s test files: its scoped plant and its in-memory twin are below.
        "runs-from-depth",
        // P12's rule is on for the page entry alone: one-page-runtime.test.ts plants each break there.
        "one-page-runtime",
        // The Reflect ban's L5 counts ignore comments per file, so reflect-disables.test.ts generates
        // its files at next/ and tooling paths and runs them with the real lint config.
        "reflect-disables",
      ];

      const missing = Arr.filter(
        Rec.keys(plugin.rules),
        (rule) => !planted.has(`fabrika(${rule})`) && !elsewhere.includes(rule),
      );

      expect(missing).toEqual([]);
    }),
  );
});

it.live("scenario: T877 L10 only the TOML adapter imports the parser and serializer", () =>
  Effect.gen(function* () {
    // scenario: literal import names at every overriding config path are the rule's inputs.
    const imports = Arr.join(
      [
        'import "toml-eslint-parser";',
        'import "toml-eslint-parser/lib/parser";',
        'import "@decimalturn/toml-patch";',
        'import "@decimalturn/toml-patch/dist/index.js";',
      ],
      "\n",
    );

    const banned = [
      "next/programs/sample/src/machine.ts",
      "next/packages/libfabrika/src/settings/TomlEdit.test.ts",
      "next/packages/libfabrika/src/settings/internal/edit.ts",
      "next/packages/libfabrika/src/node/settings/Load.ts",
      "next/packages/libfabrika/src/runtime/Runner.ts",
      "next/packages/libfabrika/src/access/Access.ts",
      "next/packages/libfabrika/src/gateway/Gateway.ts",
      "next/packages/libfabrika/src/ledger/Ledger.ts",
      "next/apps/fabrika/dev.ts",
      "next/apps/fabrika/src/settings-start.integration.test.ts",
      ".agents/skills/lead/scripts/example.ts",
    ];

    const adapter = "next/packages/libfabrika/src/settings/TomlParser.ts";

    const result = yield* promised(() =>
      lintCopies(Rec.fromEntries(Arr.map([...banned, adapter], (file) => [file, imports]))),
    );

    for (const file of banned) {
      expect(result("eslint(no-restricted-imports)", file), file).toEqual([1, 2, 3, 4]);
    }

    expect(result("eslint(no-restricted-imports)", adapter)).toEqual([]);
  }),
);

// T502 PR 2, next/: the exam's object-imports law (next/apps/fabrika/src/exam/object-imports.integration.test.ts),
// moved here by 0591. The installed no-restricted-imports rule, in the `cloudflare/objects.ts` block of the
// real config, refuses a value import and a side-effect import of anything but Alchemy, for each drawn
// module, and passes erased types. Plant: drop the block's pattern group, and lines 1 and 6 pass.
const OBJECT_MODULES = ["./runtime.ts", "./record.ts", "effect", "node:fs"] as const;

it("object contracts load only Alchemy; erased types do not load services", async () => {
  const drawn = new Set<string>();

  await fc.assert(
    fc.asyncProperty(fc.constantFrom(...OBJECT_MODULES), async (module) => {
      drawn.add(module);
      const file = "next/packages/libfabrika/src/cloudflare/objects.ts";

      const fires = await lintCopies({
        [file]: Arr.join(
          [
            `import { value } from ${Formatter.formatJson(module)};`,
            `import type { Shape } from ${Formatter.formatJson(module)};`,
            'import * as Cloudflare from "@alchemy.run/cloudflare";',
            'import type { Other } from "./runtime.ts";',
            'import { type Mixed } from "./runtime.ts";',
            'import "./runtime.ts";',
            "export { value, Cloudflare }; export type { Shape, Other, Mixed };",
          ],
          "\n",
        ),
      });

      expect([...new Set(fires("eslint(no-restricted-imports)", file))]).toEqual([1, 6]);
    }),
    // fast-check counts examples inside numRuns, so the four runs are the four modules, each once.
    { seed: 119120, numRuns: 4, examples: Arr.map(OBJECT_MODULES, (module) => [module] as [string]) },
  );

  expect([...drawn].sort()).toEqual([...OBJECT_MODULES].sort());
});

// scenario: U11 is path-scoped, so its planted line must run under next/ with the real config.
it.live("scenario: the isolate-boundary rule refuses a platform type outside cloudflare/", () =>
  Effect.gen(function* () {
    const file = "next/packages/libfabrika/src/runtime/usage.ts";
    const result = yield* promised(() => lintCopies({ [file]: "export type Usage = TraceItem;\n" }));
    expect(result("fabrika(isolate-boundary)", file)).toEqual([1]);
  }),
);

// scenario: 0535's rule reads only next/'s test files, so its planted lines run there with the real config.
it.live(
  "scenario: T1031 runs-from-depth refuses a bare count in a law over real IO, and a law in memory keeps it",
  () =>
    Effect.gen(function* () {
      const io = "next/packages/libfabrika/src/plant/OverIo.test.ts";
      const memory = "next/packages/libfabrika/src/plant/InMemory.test.ts";
      const imports = ['import * as fc from "fast-check";', 'import { it } from "vitest";'];

      const law = (body: string, count: string) =>
        `it("law", () => { ${body}fc.assert(fc.property(fc.nat(), () => true), { seed: 119120, numRuns: ${count} }); });`;

      const result = yield* promised(() =>
        lintCopies({
          [io]: Arr.join(
            [
              'import { DatabaseSync } from "node:sqlite";',
              'import { runsFor } from "@kampus/vitest";',
              ...imports,
              law('new DatabaseSync(":memory:"); ', "100"),
              law('new DatabaseSync(":memory:"); ', "runsFor({ fast: 10, full: 100 })"),
              "",
            ],
            "\n",
          ),
          [memory]: Arr.join([...imports, law("", "3000"), ""], "\n"),
        }),
      );

      expect(result("fabrika(runs-from-depth)", io)).toEqual([5]);
      expect(result("fabrika(runs-from-depth)", memory)).toEqual([]);
    }),
);

/** oxlint's `--print-config`: the root rules and each override's globs and rules, a setting as `[level, options]`. */
type Printed = {
  readonly rules: Record<string, unknown>;
  readonly overrides: ReadonlyArray<{ files: string[]; rules: Record<string, unknown> }>;
};

/** One fire of an oxlint JSON report. */
type Diagnostics = ReadonlyArray<{
  readonly code?: string;
  readonly filename: string;
  readonly labels: ReadonlyArray<{ readonly span: { readonly line: number } }>;
}>;

/** True for one entry, `{ object, property }`, in `no-restricted-properties`'s options. */
const isEntry =
  (object: string, property: string) =>
  (entry: unknown): boolean =>
    Predicate.isObjectOrArray(entry) &&
    "object" in entry &&
    entry.object === object &&
    "property" in entry &&
    entry.property === property;

/** The ban's own entry, `{ object: "Reflect", property: "get" }`. */
const isReflectGet = isEntry("Reflect", "get");

/** The swap's entry, `{ object: "Data", property: "TaggedError" }` (0573). */
const isTaggedError = isEntry("Data", "TaggedError");

/** A setting's options, as `--print-config` prints it, `[level, options]`, or none. */
const optionsOf = (setting: unknown): ReadonlyArray<unknown> =>
  Array.isArray(setting) && Array.isArray(setting[1]) ? setting[1] : [];

/**
 * Where a law plants a file for one glob of the config, such as `next/programs/chaos/**`: a file of
 * that folder's own. A glob that names a file is answered with its `*` filled in, so
 * `apps/fabrika/*-e2e.ts` gets `apps/fabrika/planted-e2e.ts`.
 */
const plantPath = (glob: string): string => {
  const folder = glob.replace(/(\/\*\*)?\/\*\*?$/, "");

  return folder === glob ? glob.replaceAll("*", "planted") : `${folder}/planted.ts`;
};

/** The globs of every override whose `no-restricted-properties` holds one entry, each with the rule's level there. */
const globsHolding = (
  printed: Printed,
  holds: (entry: unknown) => boolean,
): ReadonlyArray<{ readonly glob: string; readonly level: unknown }> =>
  Arr.flatMap(printed.overrides, ({ files, rules }) => {
    const setting = rules["no-restricted-properties"];

    return Arr.some(optionsOf(setting), holds)
      ? Arr.map(files, (glob) => ({ glob, level: Arr.isArray(setting) ? setting[0] : setting }))
      : [];
  });

/**
 * Runs `use` in a temp folder that holds a copy of the repo's `.oxlintrc.json` and its rules, with
 * `printed` (its `--print-config`) and `lint` (one oxlint run over files written there).
 */
const inConfigCopy = (
  use: (copy: {
    readonly printed: Printed;
    readonly lint: (text: string, files: ReadonlyArray<string>) => Diagnostics;
    readonly lintFiles: (sources: Readonly<Record<string, string>>) => Diagnostics;
    readonly lintWithConfig: (config: LintConfig, sources: Readonly<Record<string, string>>) => Diagnostics;
  }) => void,
) => {
  const at = realpathSync(mkdtempSync(join(tmpdir(), "restricted-properties-")));

  try {
    copyFileSync(join(ROOT, ".oxlintrc.json"), join(at, ".oxlintrc.json"));
    // The rules are copied, not linked, so a plant under `oxlint-plugins/` stays in the temp repo.
    mkdirSync(join(at, "oxlint-plugins"));

    for (const entry of readdirSync(join(ROOT, "oxlint-plugins"), { withFileTypes: true })) {
      if (entry.isFile()) {
        copyFileSync(join(ROOT, "oxlint-plugins", entry.name), join(at, "oxlint-plugins", entry.name));
      }
    }

    symlinkSync(join(ROOT, "oxlint-plugins", "node_modules"), join(at, "oxlint-plugins", "node_modules"));
    symlinkSync(join(ROOT, "node_modules"), join(at, "node_modules"));
    // The config loads the vendored anti-slop plugins from here (0563).
    symlinkSync(join(ROOT, "vendor"), join(at, "vendor"));

    const printed = spawnSync(OXLINT, [`--config=${join(at, ".oxlintrc.json")}`, "--print-config"], {
      cwd: at,
      encoding: "utf8",
      maxBuffer: 2 ** 28,
    });

    expect(printed.status, printed.stderr).toBe(0);

    const lintFiles = (sources: Readonly<Record<string, string>>): Diagnostics => {
      const files = Object.keys(sources);

      for (const [file, text] of Object.entries(sources)) {
        mkdirSync(dirname(join(at, file)), { recursive: true });
        writeFileSync(join(at, file), text);
      }

      const ran = spawnSync(
        OXLINT,
        [`--config=${join(at, ".oxlintrc.json")}`, "--disable-nested-config", "--format=json", ...files],
        { cwd: at, encoding: "utf8", maxBuffer: 2 ** 28 },
      );

      const report: { readonly diagnostics: Diagnostics } = JSON.parse(ran.stdout);

      return report.diagnostics;
    };

    const lint = (text: string, files: ReadonlyArray<string>): Diagnostics =>
      lintFiles(Object.fromEntries(files.map((file) => [file, text])));

    const lintWithConfig = (config: LintConfig, sources: Readonly<Record<string, string>>): Diagnostics => {
      const configFile = join(at, ".oxlintrc.json");
      const original = readFileSync(configFile, "utf8");

      try {
        const serialized = JSON.stringify(config);

        if (serialized === undefined) {
          throw new Error("the control lint config could not be serialized");
        }

        writeFileSync(configFile, serialized);

        return lintFiles(sources);
      } finally {
        writeFileSync(configFile, original);
      }
    };

    use({ printed: JSON.parse(printed.stdout), lint, lintFiles, lintWithConfig });
  } finally {
    rmSync(at, { recursive: true, force: true });
  }
};

/** The lines of `file` that one rule's code refuses, in order. */
const refusedIn = (diagnostics: Diagnostics, file: string, code: string): ReadonlyArray<number> =>
  pipe(
    diagnostics,
    Arr.filter((d) => d.filename === file && d.code === code),
    Arr.flatMap((d) => (d.labels[0] === undefined ? [] : [d.labels[0].span.line])),
    Arr.sort(Order.Number),
  );

/** A plant's text, and the lines its rule must refuse. */
const textOf = (p: Plant) => ({
  text: `${Arr.join([...p.prelude, ...Arr.map(p.lines, ([line]) => line)], "\n")}\n`,
  want: Arr.flatMap(p.lines, ([, refused], i) => (refused ? [p.prelude.length + i + 1] : [])),
});

describe("L1 of the Reflect ban: every folder a block lists refuses it", () => {
  // scenario: the repo's own config, read by oxlint's own --print-config, so every folder a ban block
  // lists today gets REFLECT's lines, a later slice's folder included.
  // Plant: delete one entry from one block of `.oxlintrc.json`, and that folder's line is not refused.
  it("scenario: REFLECT's lines are refused exactly, in every folder of every ban block", () => {
    inConfigCopy(({ printed, lint }) => {
      // A glob two blocks list, as `oxlint-plugins/**` in the tooling block and the `vi` lock after it,
      // is planted once: the last block holds the ban's entries again, and this run reads them.
      const globs = Arr.dedupeWith(globsHolding(printed, isReflectGet), (a, b) => a.glob === b.glob);
      // Coverage: the tooling, a next/ folder where JSON.parse blocks and one where it still advises.
      expect(Arr.map(globs, ({ glob }) => glob)).toEqual(
        expect.arrayContaining([".agents/**", ".github/**", "oxlint-plugins/**"]),
      );
      expect(Arr.some(globs, ({ glob, level }) => Str.startsWith("next/")(glob) && level === "deny")).toBe(true);
      expect(Arr.some(globs, ({ glob, level }) => Str.startsWith("next/")(glob) && level === "warn")).toBe(true);

      const { text, want } = textOf(REFLECT);
      // A glob a later block copies for another set of files, such as libfabrika's for M13, shares its file.
      const files = Arr.dedupe(Arr.map(globs, ({ glob }) => plantPath(glob)));
      const diagnostics = lint(text, files);

      for (const file of files) {
        expect(refusedIn(diagnostics, file, REFLECT.code), file).toEqual(want);
      }
    });
  }, 120_000);
});

describe("L10 of the Reflect ban: after the fold the base blocks hold it for all of next/, and no list block is left", () => {
  // scenario: the repo's own config, read by oxlint's own --print-config, and one oxlint run over
  // REFLECT's lines planted in folders that no block names, at generated names under each shape in
  // REFLECT_NEW_FOLDERS. The prefix keeps a name from being a folder that exists. The second half
  // reads the blocks, in order: of the overrides that name a next/ folder and hold the ban, one is next/
  // whole, then comes the JSON.parse warn block, the only list there is, and client/ comes last. A file
  // takes the last block that matches it, so client/ after the warn block means no glob added to the
  // warn block can strip client/'s retry entries or turn its JSON.parse into advice (L4 holds the files).
  // Plant: leave the four Reflect entries out of the next/ block, and the folders are not refused
  // and the blocks are two; put one of the three deleted list blocks back, and the blocks are four;
  // move client/'s block back before the warn block, and the order is red.
  it("scenario: REFLECT's lines are refused in a folder no block names, and the only blocks that hold the ban for next/ are the three base blocks", () => {
    inConfigCopy(({ printed, lint }) => {
      const names = fc.sample(fc.stringMatching(/^[a-z]{3,8}$/), {
        seed: 119_120,
        numRuns: REFLECT_NEW_FOLDERS.length * 2,
      });

      const files = Arr.dedupe(
        Arr.flatMap(REFLECT_NEW_FOLDERS, (folder, i) =>
          Arr.map(
            [names[i * 2], names[i * 2 + 1]],
            (name) => `${folder.replace("NAME", `planted-${name}`)}/planted.ts`,
          ),
        ),
      );

      // Coverage: every shape was drawn, with two names each, none the same as another.
      expect(files.length).toBe(REFLECT_NEW_FOLDERS.length * 2);

      const { text, want } = textOf(REFLECT);
      const diagnostics = lint(text, files);

      for (const file of files) {
        expect(refusedIn(diagnostics, file, REFLECT.code), file).toEqual(want);
      }

      const blocks = Arr.filter(
        printed.overrides,
        ({ files: globs, rules }) =>
          Arr.some(globs, (glob) => glob.startsWith("next/")) &&
          Arr.some(optionsOf(rules["no-restricted-properties"]), isReflectGet),
      );

      // One block names one glob and another names the folders of the JSON.parse warn block, so a
      // leftover list block, blocking or warning, makes a fourth or a second list. Each of the three
      // base blocks has one copy right after it for libfabrika's files but its tests, with the two
      // `process` entries added (M13), so the order is each block and then its copy, and client/'s
      // copy is last.
      expect(
        Arr.map(blocks, ({ files: globs }) => (globs.length === 1 ? globs[0] : "a list of folders")),
        "the blocks that hold the ban for next/, in the order oxlint applies them",
      ).toEqual([
        "next/**/*",
        "next/packages/libfabrika/src/**",
        "a list of folders",
        "a list of folders",
        "next/packages/libfabrika/src/client/**",
        "next/packages/libfabrika/src/client/**",
      ]);

      // The list is the JSON.parse warn block and its copy: they advise for that entry alone, and the
      // rest of their fires block (advice.test.ts).
      expect(
        Arr.map(blocks, ({ rules }) => {
          const setting = rules["no-restricted-properties"];

          return Arr.isArray(setting) ? setting[0] : setting;
        }),
      ).toEqual(["deny", "deny", "warn", "warn", "deny", "deny"]);
    });
  }, 120_000);
});

/** libfabrika's source folder, and its top, as the folders a law plants a file in, a new folder included. */
const LIBFABRIKA_SRC = "next/packages/libfabrika/src";

const libfabrikaFolders: ReadonlyArray<string> = [
  LIBFABRIKA_SRC,
  ...Arr.map(
    Arr.filter(readdirSync(join(ROOT, LIBFABRIKA_SRC), { withFileTypes: true }), (entry) => entry.isDirectory()),
    (entry) => `${LIBFABRIKA_SRC}/${entry.name}`,
  ),
  `${LIBFABRIKA_SRC}/node/client`,
];

/** The three kinds of file a libfabrika folder holds that the two rules below tell apart. */
const libfabrikaKinds = [
  { kind: "product", name: "planted.ts", left: false },
  { kind: "test-support", name: "planted.test-support.ts", left: false },
  { kind: "test", name: "planted.test.ts", left: true },
] as const;

describe("M12 and M13 (decision 0592): libfabrika writes output through Effect's Console", () => {
  // M12. scenario: the repo's own config, with the lines of LIBFABRIKA_NO_CONSOLE planted in each
  // libfabrika folder as a product file, a test-support file and a test file, and in a folder outside it.
  // Plant: drop the libfabrika glob from the `no-console` block of `.oxlintrc.json`, and a product
  // path takes `console.log(secret)`: the control below, which does it, takes them all.
  it("scenario: M12 raw console calls are refused in libfabrika's product and test-support files, and taken in its test files and outside it", () => {
    const config = readFileSync(join(ROOT, ".oxlintrc.json"), "utf8");
    const control = withoutRuleOn(config, `${LIBFABRIKA_SRC}/**`, "eslint/no-console");
    const { text, want } = textOf(LIBFABRIKA_NO_CONSOLE);

    const planted = Arr.flatMap(libfabrikaFolders, (folder) =>
      Arr.map(libfabrikaKinds, (kind) => ({ ...kind, file: `${folder}/${kind.name}` })),
    );

    const outside = ["next/apps/fabrika/src/planted.ts", "next/packages/tuval/src/planted.ts"];

    const sources = Object.fromEntries(
      [...Arr.map(planted, ({ file }) => file), ...outside].map((file) => [file, text]),
    );

    // Coverage: libfabrika's top and its folders, each with three kinds of file.
    expect(libfabrikaFolders.length).toBeGreaterThan(10);

    inConfigCopy(({ lintFiles, lintWithConfig }) => {
      const current = lintFiles(sources);
      const dropped = lintWithConfig(control, sources);

      for (const { file, left } of planted) {
        expect(refusedIn(current, file, LIBFABRIKA_NO_CONSOLE.code), file).toEqual(left ? [] : want);
        expect(refusedIn(dropped, file, LIBFABRIKA_NO_CONSOLE.code), `${file} with the block dropped`).toEqual([]);
      }

      for (const file of outside) {
        expect(refusedIn(current, file, LIBFABRIKA_NO_CONSOLE.code), file).toEqual([]);
      }
    });
  }, 120_000);

  // M13. scenario: the repo's own config, with PROCESS_OUTPUT's lines planted in each libfabrika
  // folder as a product file, a test-support file and a test file, beside the entries every block
  // writes out again: REFLECT, TAGGED_ERROR, a JSON.parse line, and in client/ the two retry entries.
  // None of them may be lost, since an override replaces a rule's options.
  // Plants: (a) drop the two `process` entries from one block that reaches libfabrika, and a product
  // path in that block's folders takes the planted write; (b) add a block for libfabrika after the
  // others that lists only the two `process` entries, and the other entries' lines are taken in its
  // paths; (c) add `process.stdout.write(cause)` to a product file, and `pnpm lint` is red.
  it("scenario: M13 process stdout and stderr are refused in libfabrika's product and test-support files, taken in its test files, and no other entry is lost", () => {
    const retries: Plant = {
      code: PROCESS_OUTPUT.code,
      prelude: ['import {Effect, Stream} from "effect";'],
      lines: [
        ["export const effectRetry = Effect.retry;", true],
        ["export const streamRetry = Stream.retry;", true],
      ],
    };

    const parse: Plant = {
      code: PROCESS_OUTPUT.code,
      prelude: [],
      lines: [['export const parsed = JSON.parse("{}");', true]],
    };

    const kept: ReadonlyArray<{
      readonly plant: Plant;
      readonly name: string;
      readonly folders: ReadonlyArray<string>;
    }> = [
      { plant: REFLECT, name: "reflect", folders: libfabrikaFolders },
      { plant: TAGGED_ERROR, name: "tagged", folders: libfabrikaFolders },
      { plant: parse, name: "parse", folders: libfabrikaFolders },
      { plant: retries, name: "retries", folders: [`${LIBFABRIKA_SRC}/client`] },
    ];

    const planted = Arr.flatMap(libfabrikaFolders, (folder) =>
      Arr.flatMap(libfabrikaKinds, (kind) => [
        { plant: PROCESS_OUTPUT, name: "process", left: kind.left, file: `${folder}/process-${kind.name}` },
        ...Arr.flatMap(kept, ({ plant, name, folders }) =>
          folders.includes(folder) ? [{ plant, name, left: false, file: `${folder}/${name}-${kind.name}` }] : [],
        ),
      ]),
    );

    // Coverage: every folder and kind has the process lines, and client/ has its retry lines.
    expect(Arr.filter(planted, ({ name }) => name === "process")).toHaveLength(
      libfabrikaFolders.length * libfabrikaKinds.length,
    );

    expect(Arr.filter(planted, ({ name }) => name === "retries")).toHaveLength(libfabrikaKinds.length);

    const sources = Object.fromEntries(Arr.map(planted, ({ plant, file }) => [file, textOf(plant).text]));

    inConfigCopy(({ lintFiles }) => {
      const current = lintFiles(sources);

      for (const { plant, left, file } of planted) {
        expect(refusedIn(current, file, plant.code), file).toEqual(left ? [] : textOf(plant).want);
      }
    });
  }, 180_000);
});

describe("the Data.TaggedError entry, which stands beside fabrika/no-data-taggederror (0573)", () => {
  // L1. scenario: the repo's own config, read by oxlint's own --print-config, so every folder that
  // any block setting `no-restricted-properties` lists gets TAGGED_ERROR's lines and ours'
  // (DATA_TAGGEDERROR), a block that lands later included, and so do a file at the top and one under
  // no block, which the root rules hold. Ours alone refuses the type-position lines.
  // Plant: delete the `Data.TaggedError` entry from one block of `.oxlintrc.json`, and that folder's
  // lines are not refused; drop `"fabrika/no-data-taggederror"`, and no folder refuses the type lines.
  it("L1 scenario: TAGGED_ERROR's lines and ours' type-position lines are refused exactly, in every folder of every block that sets the rule, and under none", () => {
    inConfigCopy(({ printed, lint }) => {
      const globs = globsHolding(printed, () => true);
      // Coverage: today's app, next/ where JSON.parse blocks and where it advises, and the tooling.
      expect(Arr.map(globs, ({ glob }) => glob)).toEqual(
        expect.arrayContaining(["apps/fabrika/e2e.ts", "next/**/*", ".agents/**", ".github/**", "oxlint-plugins/**"]),
      );
      expect(Arr.some(globs, ({ glob, level }) => Str.startsWith("next/")(glob) && level === "warn")).toBe(true);

      const files = [
        ...new Set(Arr.map(globs, ({ glob }) => plantPath(glob))),
        // Under no block that sets the rule: the root rules hold these.
        "planted-tagged-error.ts",
        "scripts/planted-tagged-error.ts",
      ];

      // Coverage: ours' plant has type-position lines it must refuse.
      expect(DATA_TAGGEDERROR.lines.some(([line, refused]) => refused && line.startsWith("export type"))).toBe(true);

      for (const p of [TAGGED_ERROR, DATA_TAGGEDERROR]) {
        const { text, want } = textOf(p);
        const diagnostics = lint(text, files);

        for (const file of files) {
          expect(refusedIn(diagnostics, file, p.code), `${p.code} in ${file}`).toEqual(want);
        }
      }
    });
  }, 120_000);

  // L2. scenario: every override in --print-config. An override replaces the rule's options for its
  // files, so a block without the entry would drop it for every folder it lists.
  // Plant: add a block that sets the rule with only the JSON.parse entry for one folder.
  it("L2 scenario: the root rules and every override that sets no-restricted-properties carry the entry", () => {
    inConfigCopy(({ printed }) => {
      expect(optionsOf(printed.rules["no-restricted-properties"]).some(isTaggedError), "the root rules").toBe(true);
      const setting = printed.overrides.filter(({ rules }) => rules["no-restricted-properties"] !== undefined);
      // Coverage: the five blocks that set the rule after the Reflect ban's fold, at least: today's
      // e2e scripts, next/ whole, client/, the JSON.parse warn block and the tooling.
      expect(setting.length).toBeGreaterThanOrEqual(5);
      expect(
        setting
          .filter(({ rules }) => !optionsOf(rules["no-restricted-properties"]).some(isTaggedError))
          .map(({ files }) => files),
      ).toEqual([]);
    });
  }, 120_000);
});

describe("lint.ts, the first step of pnpm lint", () => {
  const lint = (path: string) =>
    spawnSync(process.execPath, ["oxlint-plugins/lint.ts", relative(ROOT, path)], {
      cwd: ROOT,
      encoding: "utf8",
    });

  const tried = join(plant, "tried.ts");
  const blocking = join(plant, "blocking.ts");

  // scenario: T930 L6, the plant folder has no warn line, so it is at zero and the old advice rule blocks (0523).
  it("scenario: T930 L6 a no-raw-try-catch fire in a folder at zero blocks", () => {
    writeFileSync(
      tried,
      Arr.join(
        [
          'import {Effect} from "effect";',
          "",
          "declare const f: () => void;",
          "",
          "export const e = Effect.void;",
          "",
          "try { f(); } catch { f(); }",
          "",
        ],
        "\n",
      ),
    );
    const out = lint(tried);
    expect(out.stdout).toContain("fabrika(no-raw-try-catch)");
    expect(out.stdout).toContain("oxlint: 1 blocking, 0 advice");
    expect(out.status).toBe(1);
  });

  it("fails on a warning from a blocking rule", () => {
    writeFileSync(blocking, "declare const x: number;\nexport const a = x as any;\n");
    const out = lint(blocking);
    expect(out.stdout).toContain("fabrika(no-type-assertions)");
    expect(out.status).toBe(1);
  });

  it("fails when oxlint looked at nothing, so a clean run cannot be faked by a bad path", () => {
    const out = lint(join(plant, "no-such-file.ts"));
    expect(out.status).not.toBe(0);
  });
});

const SECRET = "export const a = process.env.GITHUB_TOKEN;";

// The Effect checker reads its directive anywhere in the text, a string too, so the planted ones are built.
const CHECKER = ["@effect", "diagnostics"].join("-");

describe("an ignore comment names its rules and says why", () => {
  const run = (name: string, text: string) => {
    const file = join(plant, name);
    writeFileSync(file, text);

    return spawnSync(process.execPath, ["oxlint-plugins/lint.ts", relative(ROOT, file)], {
      cwd: ROOT,
      encoding: "utf8",
    });
  };

  it.each([
    ["no rule, the next line", `// oxlint-disable-next-line\n${SECRET}\n`],
    ["no reason", `// oxlint-disable-next-line fabrika/no-secret-env\n${SECRET}\n`],
    ["no rule, a reason", `// oxlint-disable-next-line -- why\n${SECRET}\n`],
    ["dashes for a rule, the next line", `// oxlint-disable-next-line -- -- edge: x\n${SECRET}\n`],
    ["dashes for a rule, the whole file", `/* oxlint-disable -- -- x */\n${SECRET}\n`],
    ["three dashes for a rule", `// oxlint-disable-next-line --- -- x\n${SECRET}\n`],
    ["two dashed rules", `// oxlint-disable-next-line --, -- -- x\n${SECRET}\n`],
    ["dashes glued to the reason", `// oxlint-disable-next-line -- --x\n${SECRET}\n`],
    ["an empty reason", `// oxlint-disable-next-line fabrika/no-secret-env -- \n${SECRET}\n`],
    ["words but no dashes", `// oxlint-disable-next-line fabrika/no-secret-env why\n${SECRET}\n`],
    ["no rule, the whole file", `/* oxlint-disable */\n${SECRET}\n`],
    ["no rule, lower down", `\n\n/* oxlint-disable */\n${SECRET}\n`],
    ["no rule, this line", `${SECRET} // oxlint-disable-line\n`],
    ["a rule glued on", `/* oxlint-disablefabrika/no-secret-env */\n${SECRET}\n`],
    ["eslint, the whole file", `/* eslint-disable */\n${SECRET}\n`],
    ["eslint, the next line", `// eslint-disable-next-line\n${SECRET}\n`],
    ["eslint, in full", `// eslint-disable-next-line fabrika/no-secret-env -- why\n${SECRET}\n`],
    ["JSX", `export const a = (\n\t<a>\n\t\t{/* oxlint-disable-next-line */}\n\t\t<b />\n\t</a>\n);\n`],
    // L3 of docs/plan/quests/effect-sweep-PLAN.md: the Effect checker's own ignore comment.
    ["the checker's, no reason", `// ${CHECKER}-next-line preferEffectArray:off\n${SECRET}\n`],
    ["the checker's, the whole file", `// ${CHECKER} preferEffectArray:off -- why\n${SECRET}\n`],
    ["the checker's, skip-file", `// ${CHECKER} skip-file\n${SECRET}\n`],
    ["the checker's, no level", `// ${CHECKER}-next-line preferEffectArray -- why\n${SECRET}\n`],
    ["the checker's, no check", `// ${CHECKER}-next-line -- why\n${SECRET}\n`],
    ["the checker's, an empty reason", `// ${CHECKER}-next-line preferEffectArray:off -- \n${SECRET}\n`],
    ["the checker's, in a block", `/* ${CHECKER}-next-line preferEffectArray:off */\n${SECRET}\n`],
    ["the checker's, after other words", `// see // ${CHECKER}-next-line preferEffectArray:off\n${SECRET}\n`],
    // Four forms @effect/tsgo 0.63.0 obeys, found at review: each silenced a planted hit.
    ["the checker's, after plain words", `// see the ${CHECKER}-next-line floatingEffect:off\n${SECRET}\n`],
    ["the checker's, in a doc block", `/**\n * ${CHECKER}-next-line floatingEffect:off -- why\n */\n${SECRET}\n`],
    ["the checker's, in a string", `export const s = "// ${CHECKER} floatingEffect:off";\n${SECRET}\n`],
    [
      "the checker's, a check in the reason",
      `// ${CHECKER}-next-line preferEffectArray:off -- and floatingEffect:off\n${SECRET}\n`,
    ],
  ])("refuses %s, and that comment cannot silence the refusal", (name, text) => {
    const out = run(`bare-${name.replaceAll(/\W/g, "-")}.tsx`, text);
    expect(out.stdout).toContain("fabrika(no-bare-disable)");
    expect(out.status).toBe(1);
  });

  it("says which line, since it reports at the top of the file", () => {
    const out = run("line.ts", `\n\n// oxlint-disable-next-line\n${SECRET}\n`);
    expect(out.stdout).toContain("on line 3");
  });

  it.each([
    ["one rule", `// oxlint-disable-next-line fabrika/no-secret-env -- why\n${SECRET}\n`],
    ["from here on", `/* oxlint-disable fabrika/no-secret-env -- why\n more why */\n${SECRET}\n`],
    ["two rules", `// oxlint-disable-next-line fabrika/no-secret-env, no-debugger -- why\n${SECRET}\ndebugger;\n`],
    ["words that only mention it", `// the oxlint-disable comment\nexport const b = 1;\n`],
    [
      "the checker's, one check",
      `// ${CHECKER}-next-line preferEffectArray:off -- the platform hands back a plain array\nexport const b = [1];\n`,
    ],
    [
      "the checker's, two checks",
      `// ${CHECKER}-next-line preferEffectArray:off globalDate:off -- why\nexport const b = [Date.now()];\n`,
    ],
    [
      "a reason with a colon in it",
      `// ${CHECKER}-next-line globalDate:off -- the time: a fixture\nexport const b = [Date.now()];\n`,
    ],
  ])("takes %s", (_name, text) => {
    const out = run("named.ts", text);
    expect(out.stdout).not.toContain("no-bare-disable");
  });
});

describe("a plain file cannot take a folder out of the checks", () => {
  const LINT = join(ROOT, "oxlint-plugins", "lint.ts");
  const FORMAT = join(ROOT, "oxlint-plugins", "format.ts");

  const inFolder = (files: Readonly<Record<string, string>>) => {
    const folder = mkdtempSync(join(plant, "hide-"));
    mkdirSync(join(folder, "sub"));

    for (const [name, text] of Rec.toEntries(files)) {
      writeFileSync(join(folder, name), text);
    }

    return folder;
  };

  const node = (script: string, cwd: string, ...args: readonly string[]) =>
    spawnSync(process.execPath, [script, ...args], { cwd, encoding: "utf8" });

  it.each([
    ["a .eslintignore", ".eslintignore", "sub/\n"],
    ["a nested .oxlintrc.json", "sub/.oxlintrc.json", "{}\n"],
    ["a nested oxlint.config.ts", "sub/oxlint.config.ts", "export default {};\n"],
  ])("oxlint still refuses a secret beside %s", (_name, file, text) => {
    const cwd = inFolder({ "sub/a.ts": `${SECRET}\n`, [file]: text });
    const out = node(LINT, cwd, ".");
    expect(out.stdout).toContain("fabrika(no-secret-env)");
    expect(out.status).toBe(1);
  });

  it.each([
    ["a .prettierignore", ".prettierignore", "sub/\n"],
    ["a nested .oxfmtrc.json", "sub/.oxfmtrc.json", '{"ignorePatterns": ["**"]}\n'],
  ])("oxfmt still refuses unformatted code beside %s", (_name, file, text) => {
    const cwd = inFolder({ "sub/a.ts": "export   const a   = 1\n", [file]: text });
    const out = node(FORMAT, cwd, "--check", ".");
    expect(out.stdout).toContain("sub/a.ts");
    expect(out.status).toBe(1);
  });

  it("oxfmt takes formatted code, so the two above fail for the right reason", () => {
    const cwd = inFolder({ "sub/a.ts": "export const a = 1;\n" });
    expect(node(FORMAT, cwd, "--check", ".").status).toBe(0);
  });

  it("a .gitignore over a tracked file fails lint.ts, and names the file", () => {
    const cwd = inFolder({ "sub/a.ts": `${SECRET}\n`, "sub/.gitignore": "*\n" });
    spawnSync("git", ["init", "-q"], { cwd });
    spawnSync("git", ["add", "-f", "sub/a.ts"], { cwd });
    const out = node(LINT, cwd, ".");
    expect(out.stderr).toContain("sub/a.ts");
    expect(out.status).toBe(2);
  });
});

describe("rules that apply by path", () => {
  const plantIn = (folder: string, text: string, name = "planted.ts") => {
    const at = mkdtempSync(join(ROOT, folder, ".plant-"));
    const file = join(at, name);
    writeFileSync(file, text);

    return { at, file };
  };

  const made: string[] = [];
  afterAll(() => {
    for (const at of made) {
      rmSync(at, { recursive: true, force: true });
    }
  });

  it.each([
    ["eslint(prefer-template)", 'export const f = (a: string) => a + "b";\n'],
    ["eslint(prefer-arrow-callback)", "export const a = [1].map(function (x) { return x; });\n"],
    ["eslint(require-yield)", "export const a = function* () { return 1; };\n"],
  ])("experiments/ is under %s", (code, text) => {
    const { at, file } = plantIn("experiments", text);
    made.push(at);
    expect(fires(file, code)).toEqual([1]);
  });

  const HOOK = 'import {useState} from "react";\nexport const f = (x: number) => { if (x) useState(0); };\n';

  it.each(["apps", "programs"])("a hook in a .ts file under %s/ is checked", (folder) => {
    const { at, file } = plantIn(folder, HOOK);
    made.push(at);
    expect(fires(file, "react-hooks(rules-of-hooks)")).toEqual([2]);
  });

  const EFFECTS = Arr.join(
    [
      'import {useEffect, useEffectEvent} from "react";',
      "export const stale = (n: number) => {",
      "\tuseEffect(() => console.log(n), []);",
      "};",
      "export const fresh = (n: number) => {",
      "\tconst log = useEffectEvent(() => console.log(n));",
      "\tuseEffect(() => log(), [n]);",
      "};",
      "",
    ],
    "\n",
  );

  it.each(["apps", "programs"])("an effect's stale value under %s/ is refused", (folder) => {
    const { at, file } = plantIn(folder, EFFECTS);
    made.push(at);
    expect(fires(file, "react-hooks(exhaustive-deps)")).toEqual([3]);
  });

  const RADIX = 'import {slateDarkA} from "@radix-ui/colors";\nexport const a9 = slateDarkA.slateA9;\n';

  it("the token build, under packages/fabrika-design/src/build/, may import Radix", () => {
    mkdirSync(join(ROOT, "packages/fabrika-design/src/build"), { recursive: true });
    const { at, file } = plantIn("packages/fabrika-design/src/build", RADIX);
    made.push(at);
    expect(fires(file, "eslint(no-restricted-imports)")).toEqual([]);
  });

  it("the rest of the design package may not, so the exception is the build's folder alone", () => {
    const { at, file } = plantIn("packages/fabrika-design/src", RADIX);
    made.push(at);
    expect(fires(file, "eslint(no-restricted-imports)")).toEqual([1]);
  });

  // pinned: S1 checks the rule's own diagnostic, so an unresolved import cannot prove the ban.
  describe.each(["program.ts", "tile.ts"])("S1 inbox %s imports", (name) => {
    it.each([
      ['import { x } from "@kampus/tuval";', [1]],
      ['import { x } from "@kampus/tuval/window";', [1]],
      ['import { x } from "../../../../packages/tuval/src/index.ts";', [1]],
      ['import { Program } from "@kampus/libfabrika";', []],
      ['import { slateDarkA } from "@radix-ui/colors";', [1]],
      ['import "@radix-ui/colors/slate-dark-alpha.css";', [1]],
      ['import { _electron } from "playwright";', [1]],
      ['import { _electron } from "@playwright/test";', [1]],
      ['import { parse } from "toml-eslint-parser";', [1]],
      ['import "toml-eslint-parser/lib/parser";', [1]],
      ['import { TomlParser } from "@kampus/libfabrika/settings/TomlParser";', [1]],
      ['import { TomlParser } from "../../../../packages/libfabrika/src/settings/TomlParser.ts";', [1]],
    ])("pinned: S1 preserves the import limits for %s", (text, lines) => {
      const { at, file } = plantIn("next/programs/inbox/src", `${text}\n`, name);
      made.push(at);
      expect(fires(file, "eslint(no-restricted-imports)")).toEqual(lines);
    });
  });

  it("a `use` in a .ts file under packages/ is left alone: it is Effect's, not a hook", () => {
    const { at, file } = plantIn("packages", HOOK);
    made.push(at);
    expect(fires(file, "react-hooks(rules-of-hooks)")).toEqual([]);
  });

  const SELF_SPREAD =
    "declare const xs: number[];\nexport const f = () => { let out: number[] = []; for (const x of xs) { out = [...out, x]; } return out; };\n";

  // scenario: the override's own globs are the thing checked, so each row is one real folder, read
  // by the real oxlint through the repository's own config (0559).
  // Plants, run once: with the rule moved to the root `rules`, the three rows for today's app are
  // red; with one folder dropped from the override's `files`, that folder's row is red.
  it.each(["next", ".agents", "oxlint-plugins", ".github/ci"])(
    "scenario: a result spread back into itself in a loop under %s/ is refused",
    (folder) => {
      const { at, file } = plantIn(folder, SELF_SPREAD);
      made.push(at);
      expect(fires(file, "oxc(no-accumulating-spread)")).toEqual([2]);
    },
  );

  const VI_FN = 'import { vi } from "vitest";\nexport const f = vi.fn();\n';

  // M3, scenario: the `vi` lock (0555, 0579) is on only where a folder is at zero, so each row is one
  // real folder, read by the real oxlint through the repository's own config; both halves of the pair.
  // Plants, run once: with the pair moved to the root `rules`, the `next/` and `packages/` rows are
  // red; with `oxlint-plugins/**` dropped from the block's `files`, its row is red.
  it("scenario: a vi.fn() in a test under oxlint-plugins/ is refused by both halves of the lock", () => {
    const { at, file } = plantIn("oxlint-plugins", VI_FN, "planted.test.ts");
    made.push(at);
    expect(fires(file, "vitest(no-restricted-vi-methods)")).toEqual([2]);
    expect(fires(file, "eslint(no-restricted-properties)")).toEqual([2]);
  });

  it.each(["next", "packages"])("scenario: the same vi.fn() under %s/, not yet at zero, is left alone", (folder) => {
    const { at, file } = plantIn(folder, VI_FN, "planted.test.ts");
    made.push(at);
    expect(fires(file, "vitest(no-restricted-vi-methods)")).toEqual([]);
    expect(fires(file, "eslint(no-restricted-properties)")).toEqual([]);
  });

  it.each(["packages", "programs", "apps"])(
    "scenario: the same line under %s/, today's app, is left alone",
    (folder) => {
      const { at, file } = plantIn(folder, SELF_SPREAD);
      made.push(at);
      expect(fires(file, "oxc(no-accumulating-spread)")).toEqual([]);
    },
  );
});

// pinned: 0046 is blocking from its first commit and the real config must enable it.
it.live("pinned: L6 a second machine is planted and lint.ts exits 1", () =>
  Effect.gen(function* () {
    const text =
      'import {Machine} from "@demlik/tea/effect";\nexport const first = Machine.make({});\nexport const second = Machine.make({});\n';

    const result = yield* promised(() => lintCopies({ "next/machine.ts": text }));
    expect(result("fabrika(one-machine-per-file)", "next/machine.ts")).toEqual([3]);
    // Copy the wrapper as well: its ROOT is its own folder's parent. Keep cwd in the real
    // checkout so its read-only git check still sees a repository. No real product file is planted.
    const at = mkdtempSync(join(plant, "blocking-machine-"));
    mkdirSync(join(at, "oxlint-plugins"));

    for (const entry of readdirSync(join(ROOT, "oxlint-plugins"), { withFileTypes: true })) {
      if (entry.isFile()) {
        copyFileSync(join(ROOT, "oxlint-plugins", entry.name), join(at, "oxlint-plugins", entry.name));
      }
    }

    copyFileSync(join(ROOT, ".oxlintrc.json"), join(at, ".oxlintrc.json"));
    symlinkSync(join(ROOT, "node_modules"), join(at, "node_modules"));
    // The config loads the vendored anti-slop plugins from here (0563).
    symlinkSync(join(ROOT, "vendor"), join(at, "vendor"));
    mkdirSync(join(at, ".agents/skills"), { recursive: true });
    mkdirSync(join(at, "next"));
    const file = join(at, "next/machine.ts");
    writeFileSync(file, text);

    const out = spawnSync(process.execPath, [join(at, "oxlint-plugins/lint.ts"), file], {
      cwd: ROOT,
      encoding: "utf8",
    });

    expect(out.stdout).toContain("fabrika(one-machine-per-file)");
    expect(out.status).toBe(1);
  }),
);

// format: the contract's forbidden Layer import is a lint input, including its static implementation.
it.live("format: P21 L12 a PersonCheck contract cannot carry a Layer implementation", () =>
  Effect.gen(function* () {
    const file = "next/packages/libfabrika/src/desktop/PersonCheck.ts";

    const result = yield* promised(() =>
      lintCopies({
        [file]: Arr.join(
          [
            'import { Context, Effect, Layer, Schema } from "effect";',
            'export const Answer = Schema.TaggedUnion({ checked: { check: Schema.Literals(["touch", "click"]) }, declined: {} });',
            'export class PersonCheck extends Context.Service<PersonCheck, { readonly ask: (reason: string) => Effect.Effect<typeof Answer.Type> }>()("@kampus/libfabrika/desktop/PersonCheck") {',
            '  static readonly layer = Layer.succeed(PersonCheck, { ask: () => Effect.succeed({ _tag: "checked", check: "touch" }) });',
            "}",
          ],
          "\n",
        ),
      }),
    );

    expect(result("eslint(no-restricted-imports)", file)).toContain(1);
  }),
);

// format: the second exported machine is an input to the existing one-machine lint rule.
it.live("format: P21 L12 Menu exports only one tea machine", () =>
  Effect.gen(function* () {
    const file = "next/packages/libfabrika/src/desktop/Menu.ts";

    const result = yield* promised(() =>
      lintCopies({
        [file]: Arr.join(
          [
            'import { Machine } from "@demlik/tea/effect";',
            'import { Schema } from "effect";',
            "const Model = Schema.TaggedUnion({ idle: {} });",
            'const Msg = Schema.Struct({ type: Schema.Literal("enter") });',
            'export const machine = Machine.make({ model: Model, msg: Msg, cmds: [], init: () => [{ _tag: "idle" }, []], update: { enter: (s) => [s, []] } });',
            'export const second = Machine.make({ model: Model, msg: Msg, cmds: [], init: () => [{ _tag: "idle" }, []], update: { enter: (s) => [s, []] } });',
          ],
          "\n",
        ),
      }),
    );

    expect(result("fabrika(one-machine-per-file)", file)).toContain(6);
  }),
);

// format: these are compile-time platform names; lint must catch them even when imports erase.
it.live("format: P21 L11 desktop public types cannot name Electron, Node or the DOM", () =>
  Effect.gen(function* () {
    const imported = "next/packages/libfabrika/src/desktop/Menu.ts";
    const globals = "next/packages/libfabrika/src/desktop/PersonCheck.ts";

    const result = yield* promised(() =>
      lintCopies({
        [imported]: 'import type { BrowserWindow } from "electron";\nexport type Handle = BrowserWindow;\n',
        [globals]: Arr.join(
          [
            "export type DomWindow = Window;",
            "export type DomDocument = Document;",
            "export type NodeTimer = NodeJS.Timeout;",
            "export type ElectronWindow = Electron.BrowserWindow;",
          ],
          "\n",
        ),
      }),
    );

    expect.soft(result("eslint(no-restricted-imports)", imported)).toContain(1);
    expect.soft(result("typescript(no-restricted-types)", globals)).toEqual([1, 2, 3, 4]);
  }),
);

// format: these module paths include erased imports because platform types count too.
it.live("format: P21 L12 desktop refuses gateway and platform imports while admitting access", () =>
  Effect.gen(function* () {
    const file = "next/packages/libfabrika/src/desktop/Menu.ts";

    const result = yield* promised(() =>
      lintCopies({
        [file]: Arr.join(
          [
            'import type { Grant } from "../access/Access.ts";',
            'import type { Gateway } from "../gateway/Gateway.ts";',
            'import type { Load } from "../node/settings/Load.ts";',
            'import type { Extra } from "../electron/Extra.ts";',
            'import type { Brain } from "../cloudflare/objects.ts";',
            'import type { Stats } from "node:fs";',
            'import type { Document } from "@types/web";',
          ],
          "\n",
        ),
      }),
    );

    expect(result("eslint(no-restricted-imports)", file)).toEqual([2, 3, 4, 5, 6, 7]);
  }),
);

// format: module admission and PascalCase apply to desktop's new front files too.
it.live("format: P21 desktop is admitted as a module and keeps the front-file naming rule", () =>
  Effect.gen(function* () {
    const front = "next/packages/libfabrika/src/desktop/Menu.ts";
    const bad = "next/packages/libfabrika/src/desktop/bad.ts";
    const contract = "next/packages/libfabrika/src/desktop/PersonCheck.ts";
    const layer = "next/packages/libfabrika/src/desktop/PersonCheckTest.ts";

    const result = yield* promised(() =>
      lintCopies({
        [front]: "export const view = () => [];\n",
        [bad]: "export const view = () => [];\n",
        [contract]: 'import { Context, Schema } from "effect";\nexport const Answer = Schema.String;\n',
        [layer]: 'import { Layer } from "effect";\nexport const layer = Layer.empty;\n',
      }),
    );

    expect(result("fabrika(modules)", front)).toEqual([]);
    expect(result("unicorn(filename-case)", front)).toEqual([]);
    expect(result("unicorn(filename-case)", bad)).toEqual([1]);
    expect(result("eslint(no-restricted-imports)", contract)).toEqual([]);
    expect(result("eslint(no-restricted-imports)", layer)).toEqual([]);
  }),
);

// L12 kept lint inputs. These copies exercise the actual desktop config.
it.live("scenario: P19 a Layer on the service class is refused", () =>
  Effect.gen(function* () {
    const path = "next/packages/libfabrika/src/desktop/BrainService.ts";

    const result = yield* promised(() =>
      lintCopies({
        [path]:
          'import {Context, Layer} from "effect";\nexport class BrainService extends Context.Service<BrainService, {}>()("@kampus/libfabrika/desktop/BrainService") { static layer = Layer.empty; }\n',
      }),
    );

    expect(result("fabrika(service-contract)", path)).toEqual([2]);
  }),
);

it.live("scenario: P19 desktop-core refuses a native import through the real config", () =>
  Effect.gen(function* () {
    const path = "next/packages/libfabrika/src/desktop/BrainServiceManaged.ts";

    const result = yield* promised(() =>
      lintCopies({ [path]: 'import { readFile } from "node:fs";\nexport const read = readFile;\n' }),
    );

    expect(result("fabrika(service-contract)", path)).toEqual([1]);
  }),
);

// scenario: L12 checks the real config at the new module's paths, including both filename rules.
it.live("scenario: T878 L12 repositories keeps private imports, names and one-machine rules", () =>
  Effect.gen(function* () {
    const src = "next/packages/libfabrika/src/";

    const files = {
      [`${src}repositories/Repositories.ts`]: "export const snapshot = 1;\n",
      [`${src}repositories/repositories.ts`]: "export const snapshot = 1;\n",
      [`${src}repositories/internal/read.ts`]: "/** @internal */\nexport const read = 1;\n",
      [`${src}repositories/internal/Read.ts`]: "/** @internal */\nexport const read = 1;\n",
      [`${src}repositories/Private.ts`]: 'import {open} from "../packs/internal/open.ts";\nexport {open};\n',
      [`${src}packs/Private.ts`]: 'import {read} from "../repositories/internal/read.ts";\nexport {read};\n',
      [`${src}repositories/Names.ts`]: "export const snapshotOf = 1;\n",
      [`${src}repositories/Machines.ts`]:
        'import {Machine} from "@demlik/tea/effect";\nexport const first = Machine.make({});\nexport const second = Machine.make({});\n',
      [`${src}repositories/Platform.ts`]: 'import {spawn} from "node:child_process";\nexport {spawn};\n',
    };

    const result = yield* promised(() => lintCopies(files));
    expect(result("fabrika(modules)", `${src}repositories/Repositories.ts`)).toEqual([]);
    expect(result("unicorn(filename-case)", `${src}repositories/Repositories.ts`)).toEqual([]);
    expect(result("unicorn(filename-case)", `${src}repositories/repositories.ts`)).toEqual([1]);
    expect(result("unicorn(filename-case)", `${src}repositories/internal/read.ts`)).toEqual([]);
    expect(result("unicorn(filename-case)", `${src}repositories/internal/Read.ts`)).toEqual([1]);
    expect([...new Set(result("eslint(no-restricted-imports)", `${src}repositories/Private.ts`))]).toEqual([1]);
    expect([...new Set(result("eslint(no-restricted-imports)", `${src}packs/Private.ts`))]).toEqual([1]);
    expect(result("fabrika(no-of)", `${src}repositories/Names.ts`)).toEqual([1]);
    expect(result("fabrika(one-machine-per-file)", `${src}repositories/Machines.ts`)).toEqual([3]);
    expect(result("fabrika(no-node-imports)", `${src}repositories/Platform.ts`)).toEqual([1]);
  }),
);
