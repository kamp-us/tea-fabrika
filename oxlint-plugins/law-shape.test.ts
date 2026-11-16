// The edge cases, listed before the rule was written (0040), each a line of the generated file below:
// - `describe` is not a test: only the tests inside it are read.
// - `it.each(rows)(...)`, `it.for(rows)(...)` and `test.skip.each(rows)(...)` are tests: a hand-written
//   table of cases is what 0093 replaces, unless its title is labeled.
// - `it.skip`, `it.only`, `it.fails` and `it.skipIf(c)(...)` are read like `it`. `it.todo` is not
//   read, with a body or without. `it.layer(L)(...)` is a group, so only the tests in it are read.
// - A helper that wraps `it` is read at its own `it`: a property there passes, and a title that is
//   the helper's parameter is not judged.
// - A property inside a labeled example passes, and fires nothing twice. Under `type:` it fires.
// - A template title is judged by its text before the first `${}`, and not judged when that text
//   could still become a label.
// - A shared suite file (`SinkTest.ts`, 0062) is read, and a test file that only calls
//   `SinkTest.suite(...)` holds no test.
// - A body that calls a function this file declares is read through it; an imported helper is not.
//   A body given by name is read the same way, so under `type:` an imported one fires.
// - Each of the five labels meets every line, in its own planted file each run.
// - `fast-check` under any local name, and `@demlik/tea/pbt`'s runners named or through a namespace.
// - The shared runner, `property` from a `Testing.test-support.ts` module, named, renamed or through
//   a namespace. A `property` from any other module, another name from that module, a type-only
//   import, and a local `property` that calls no `assert` still fire.
// - Not tests: `/x/.test(s)`, `it(title)` with no body.
// - A label is one of five lowercase words at the start of the title, with text after its colon.
//   One ticket or law id may stand before it (`T652 scenario: ...`): letters, digits and dots, then
//   a space. Two tokens before it, an id with another sign, an id glued to the label, or a label
//   only in a comment still fire.
// - A `type:` body holds `expectTypeOf` and `assertType` chains, with `type` and `interface`
//   declarations among them, and nothing else that runs (0527). A call in a chain's argument, in a
//   function written there, a `const`, an `if`, `await`, `yield`, `new`, a tagged template,
//   `import()`, an empty body, `it.prop` and `fc.assert` each fire, with the type message.
// - The two names count from a value import of `vitest` or `@effect/vitest`, named, renamed or
//   through a namespace. Another module, a type-only import and a local function of that name fire.
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import * as fc from "fast-check";
import { expect, it } from "vitest";
import { plant } from "../next/apps/fabrika/src/exam/plant.ts";
import { MESSAGE, TYPE_MESSAGE } from "./law-shape.ts";

const CODE = "fabrika(law-shape)";
const ROOT = resolve(import.meta.dirname, "..");
const runs = { seed: 119120, numRuns: 4 };
const LABELS = ["vector", "format", "pinned", "scenario", "type"] as const;

/** A fire's line and what it says, or the message a planted line should fire with: `null` for none. */
type Fire = readonly [number, string];
type Fires = typeof MESSAGE | typeof TYPE_MESSAGE | null;

/** Lints planted files as `pnpm lint` does, and answers the law-shape fires in one of them, each as its line and message. */
const linted = async (files: Readonly<Record<string, string>>): Promise<(file: string) => readonly Fire[]> => {
  const result = await plant(files, (f): Fire => [f.line, f.message]);
  return (file) => result(CODE, file);
};

// Source text has no domain Schema: titles are plain words, none of them a label.
const words = fc
  .array(fc.constantFrom("the", "window", "keeps", "a", "press", "row", "law", "once"), {
    minLength: 1,
    maxLength: 5,
  })
  .map((w) => w.join(" "));

const alias = fc.constantFrom("fc", "check", "F");

// A ticket or law id as titles write them: `T652`, `K2`, `p68b`, `R3.1`.
const id = fc.stringMatching(/^[A-Za-z0-9.]{1,6}$/);

interface Spelling {
  readonly a: string;
  readonly id: string;
  readonly title: string;
  readonly label: string;
  readonly reason: string;
}

/** The body a labeled example needs to pass: `plain` for the four, and one type chain for `type:`. */
const ok = (label: string, plain = "{}") => (label === "type" ? "{ expectTypeOf<1>().toEqualTypeOf<1>(); }" : plain);

/** One test per line, and the message the rule fires on it with, `null` for none. */
const cases: readonly ((s: Spelling) => readonly [string, Fires])[] = [
  ({ title }) => [`it("${title}", () => {});`, MESSAGE],
  ({ label, reason }) => [`it("${label}: ${reason}", () => ${ok(label)});`, null],
  ({ label, reason }) => [`test("${label}: ${reason}", () => ${ok(label)});`, null],
  ({ label, reason }) => [`it("${label.toUpperCase()}: ${reason}", () => ${ok(label)});`, MESSAGE],
  ({ label }) => [`it("${label}:", () => ${ok(label)});`, MESSAGE],
  ({ id, label, reason }) => [`it("${id} ${label}: ${reason}", () => ${ok(label)});`, null],
  ({ id, label, reason }) => [`it.each([1])("${id} ${label}: ${reason} %s", (n) => ${ok(label)});`, null],
  ({ id, label, reason }) => [`it("${id} ${id} ${label}: ${reason}", () => ${ok(label)});`, MESSAGE],
  ({ id, label, reason }) => [`it("${id}-x ${label}: ${reason}", () => ${ok(label)});`, MESSAGE],
  ({ id, label, reason }) => [`it("${id}${label}: ${reason}", () => ${ok(label)});`, MESSAGE],
  ({ title, label, reason }) => [`it("the ${title} ${label}: ${reason}", () => ${ok(label)});`, MESSAGE],
  ({ title, label, reason }) => [`/* ${label}: ${reason} */ it("the ${title}", () => ${ok(label)});`, MESSAGE],
  ({ a, title }) => [`it.prop("${title}", [${a}.nat()], ([n]) => n >= 0);`, null],
  ({ a, title }) => [`it.effect.prop("${title}", { n: ${a}.nat() }, ({ n }) => Effect.void);`, null],
  ({ a, title }) => [`it("${title}", () => { ${a}.assert(${a}.property(${a}.nat(), (n) => n >= 0)); });`, null],
  ({ a, title }) => [
    `it("${title}", async () => { await ${a}.assert(${a}.asyncProperty(${a}.nat(), async (n) => n >= 0)); });`,
    null,
  ],
  ({ title }) => [`it("${title}", () => invariant(m, opts));`, null],
  ({ title }) => [`it("${title}", () => Pbt.propertyTrace(m, opts));`, null],
  ({ title }) => [`it("${title}", () => deeper());`, null],
  ({ title }) => [`it("${title}", local);`, null],
  ({ title }) => [`it("${title}", () => plain());`, MESSAGE],
  ({ title }) => [`it("${title}", () => helper());`, MESSAGE],
  ({ title }) => [`it("${title}", () => other.assert(x));`, MESSAGE],
  ({ a, title }) => [
    `it.effect("${title}", () => Effect.sync(() => ${a}.assert(${a}.property(${a}.nat(), () => true))));`,
    null,
  ],
  ({ title }) => [`it.effect("${title}", () => Effect.void);`, MESSAGE],
  ({ title }) => [`it.skip("${title}", () => {});`, MESSAGE],
  ({ title }) => [`it.only("${title}", () => {});`, MESSAGE],
  ({ title }) => [`it.fails("${title}", () => {});`, MESSAGE],
  ({ title }) => [`it.skipIf(true)("${title}", () => {});`, MESSAGE],
  ({ title }) => [`it.each([1, 2])("${title} %s", (n) => {});`, MESSAGE],
  ({ label, reason }) => [`it.each([1, 2])("${label}: ${reason} %s", (n) => ${ok(label)});`, null],
  ({ title }) => [`test.skip.each([1])("${title}", () => {});`, MESSAGE],
  ({ title }) => [`it.for([1])("${title}", () => {});`, MESSAGE],
  ({ title }) => [`it.todo("${title}");`, null],
  ({ title }) => [`it.todo("${title}", () => {});`, null],
  ({ title, label, reason }) => [
    `it.layer(L)("${title}", (it) => { it.effect("${label}: ${reason}", () => ${ok(label, "Effect.void")}); });`,
    null,
  ],
  ({ title, label, reason }) => [
    `it.layer(L)("${label}: ${reason}", (it) => { it.effect("${title}", () => Effect.void); });`,
    MESSAGE,
  ],
  ({ title }) => [`describe("${title}", () => { it("${title}", () => {}); });`, MESSAGE],
  ({ a, label, reason }) => [
    `it("${label}: ${reason}", () => { ${a}.assert(${a}.property(${a}.nat(), () => true)); });`,
    label === "type" ? TYPE_MESSAGE : null,
  ],
  ({ label }) => [`it(\`${label}: \${x}\`, () => ${ok(label)});`, null],
  ({ title }) => [`it(\`the ${title} \${x}\`, () => {});`, MESSAGE],
  ({ id }) => [`it(\`${id} \${x}\`, () => {});`, null],
  ({ id, label }) => [`it(\`${id} ${label}: \${x}\`, () => ${ok(label)});`, null],
  ({ id, label, reason }) => [`it(\`${id} ${label}: ${reason}\`, () => ${ok(label)});`, null],
  ({ title }) => [`it(\`\${x} ${title}\`, () => {});`, null],
  ({ label, reason }) => [`it(\`${label}: ${reason}\`, () => ${ok(label)});`, null],
  ({ title }) => [`/x/.test("${title}");`, null],
  ({ title }) => [`it("${title}");`, null],
  // A type: body that only asserts types passes.
  ({ reason }) => [
    `it("type: ${reason}", () => { type T = 1; interface I { readonly t: T } expectTypeOf<I>().toHaveProperty("t"); });`,
    null,
  ],
  ({ id, reason }) => [`it("${id} type: ${reason}", () => expectTypeOf<1>().not.toBeAny());`, null],
  ({ reason }) => [
    `it("type: ${reason}", () => { assertType<number>(1); expectTypeOf(plain).toBeFunction(); });`,
    null,
  ],
  ({ reason }) => [`it.each([1])("type: ${reason} %s", () => { expectTypeOf<1>().toBeNumber(); });`, null],
  // A type: body that runs anything fires, with the type message.
  ({ reason }) => [
    `it("type: ${reason}", () => { expectTypeOf<1>().toBeNumber(); expect(1).toBe(1); });`,
    TYPE_MESSAGE,
  ],
  ({ a, reason }) => [
    `it("type: ${reason}", () => { ${a}.assert(${a}.property(${a}.nat(), () => true)); });`,
    TYPE_MESSAGE,
  ],
  ({ a, reason }) => [`it.prop("type: ${reason}", [${a}.nat()], ([n]) => n >= 0);`, TYPE_MESSAGE],
  ({ reason }) => [`it("type: ${reason}", () => { expectTypeOf(plain()).toBeNumber(); });`, TYPE_MESSAGE],
  ({ reason }) => [`it("type: ${reason}", () => { expectTypeOf(() => plain()).returns.toBeNumber(); });`, TYPE_MESSAGE],
  ({ reason }) => [`it("type: ${reason}", () => { const one = 1; expectTypeOf(one).toBeNumber(); });`, TYPE_MESSAGE],
  ({ reason }) => [`it("type: ${reason}", async () => { await x; expectTypeOf<1>().toBeNumber(); });`, TYPE_MESSAGE],
  ({ reason }) => [`it("type: ${reason}", () => { if (x) throw y; expectTypeOf<1>().toBeNumber(); });`, TYPE_MESSAGE],
  ({ reason }) => [`it("type: ${reason}", () => {});`, TYPE_MESSAGE],
  ({ reason }) => [`it(\`type: ${reason}\`, () => { expect(1).toBe(1); });`, TYPE_MESSAGE],
  ({ reason }) => [`it("type: ${reason}", () => { expectTypeOf(new Date()).toEqualTypeOf<Date>(); });`, TYPE_MESSAGE],
  ({ reason }) => [`it("type: ${reason}", () => { expectTypeOf(String.raw\`x\`).toBeString(); });`, TYPE_MESSAGE],
  ({ reason }) => [`it("type: ${reason}", () => { expectTypeOf(import("./helper.ts")).toBeObject(); });`, TYPE_MESSAGE],
  ({ reason }) => [`it("type: ${reason}", function* () { yield 1; expectTypeOf<1>().toBeNumber(); });`, TYPE_MESSAGE],
  // A template title with `${}` after its label, and a body that runs: labeled, and under type: it fires.
  ({ label }) => [
    `it(\`${label}: \${x} opens\`, () => { expect(1).toBe(1); });`,
    label === "type" ? TYPE_MESSAGE : null,
  ],
  ({ id, label }) => [
    `it(\`${id} ${label}: \${x} opens\`, () => { expect(1).toBe(1); });`,
    label === "type" ? TYPE_MESSAGE : null,
  ],
  // A body given by name: one this file declares is read through, and one imported cannot be, so under
  // type: it fires.
  ({ label, reason }) => [`it("${label}: ${reason}", typed);`, null],
  ({ label, reason }) => [`it("${label}: ${reason}", local);`, label === "type" ? TYPE_MESSAGE : null],
  ({ label, reason }) => [`it("${label}: ${reason}", helper);`, label === "type" ? TYPE_MESSAGE : null],
];

const preamble = (a: string, star: boolean) => [
  star ? `import * as ${a} from "fast-check";` : `import ${a} from "fast-check";`,
  'import { propertyInvariant as invariant } from "@demlik/tea/pbt";',
  'import * as Pbt from "@demlik/tea/pbt";',
  'import { assertType, describe, expectTypeOf, it, test } from "vitest";',
  'import { helper } from "./helper.ts";',
  `const local = () => ${a}.assert(${a}.property(${a}.nat(), (n) => n >= 0));`,
  "const deeper = () => local();",
  "const plain = () => 1;",
  "const typed = () => { expectTypeOf<1>().toBeNumber(); };",
  `const law = (name: string) => it(name, () => ${a}.assert(${a}.property(${a}.nat(), (n) => n >= 0)));`,
  "const example = (name: string) => it(name, () => {});",
];

// Every run plants one file per label, so each of the five labels meets every case line in each run,
// whatever the seed draws.
it(
  "fires on exactly the tests that are neither a property nor labeled, and on each type: test whose body runs anything, in any order and spelling",
  () =>
    fc.assert(
      fc.asyncProperty(
        fc.record({
          a: alias,
          id,
          star: fc.boolean(),
          title: words,
          reason: words,
          order: fc.shuffledSubarray(
            cases.map((_, i) => i),
            { minLength: cases.length },
          ),
        }),
        async ({ a, id, star, title, reason, order }) => {
          const head = preamble(a, star);
          const files = LABELS.map((label) => {
            const lines = order.flatMap((i) => {
              const make = cases[i];
              return make === undefined ? [] : [make({ a, id, title, label, reason })];
            });
            const text = [...head, ...lines.map(([line]) => line)].join("\n");
            const expected = lines.flatMap(([, fires], i): Fire[] =>
              fires === null ? [] : [[head.length + i + 1, fires]],
            );
            return { path: `next/packages/libfabrika/src/${label}.test.ts`, text, expected };
          });
          const result = await linted(Object.fromEntries(files.map(({ path, text }) => [path, text])));

          for (const { path, text, expected } of files) {
            expect(result(path), text).toEqual(expected);
          }
        },
      ),
      runs,
    ),
  120_000,
);

/** Where a type law's check comes from, the statement that calls it, and whether the law fires. */
const checks: readonly (readonly [string, string, boolean])[] = [
  ['import { expectTypeOf } from "vitest";', "expectTypeOf<1>().toEqualTypeOf<1>();", false],
  ['import { expectTypeOf } from "@effect/vitest";', "expectTypeOf<1>().toEqualTypeOf<1>();", false],
  ['import { expectTypeOf as typeOf } from "vitest";', "typeOf<1>().toEqualTypeOf<1>();", false],
  ['import { assertType } from "@effect/vitest";', "assertType<number>(1);", false],
  ['import { assertType as is } from "vitest";', "is<number>(1);", false],
  ['import * as V from "vitest";', "V.expectTypeOf<1>().toEqualTypeOf<1>();", false],
  ['import * as V from "@effect/vitest";', "V.assertType<number>(1);", false],
  ['import { expectTypeOf } from "./helper.ts";', "expectTypeOf<1>().toEqualTypeOf<1>();", true],
  ['import { expectTypeOf } from "fast-check";', "expectTypeOf<1>().toEqualTypeOf<1>();", true],
  ['import * as V from "./helper.ts";', "V.expectTypeOf<1>().toEqualTypeOf<1>();", true],
  ['import { other as expectTypeOf } from "vitest";', "expectTypeOf<1>().toEqualTypeOf<1>();", true],
  ['import type { expectTypeOf } from "vitest";', "expectTypeOf<1>().toEqualTypeOf<1>();", true],
  ['import { type assertType } from "@effect/vitest";', "assertType<number>(1);", true],
  ["const expectTypeOf = () => ({ toEqualTypeOf: () => true });", "expectTypeOf<1>().toEqualTypeOf<1>();", true],
];

it(
  "counts expectTypeOf and assertType only from a value import of vitest or @effect/vitest, under any name or a namespace",
  () =>
    fc.assert(
      fc.asyncProperty(fc.record({ reason: words, nested: fc.boolean() }), async ({ reason, nested }) => {
        const files = checks.map(([source, call, fires], i) => {
          const law = `it("type: ${reason}", () => { ${call} });`;
          const text = [
            'import { describe, it } from "vitest";',
            source,
            nested ? `describe("${reason}", () => { ${law} });` : law,
          ].join("\n");
          return { source, path: `next/packages/libfabrika/src/types/Check${i}.test.ts`, text, fires };
        });
        const result = await linted(Object.fromEntries(files.map(({ path, text }) => [path, text])));
        const fired = Object.fromEntries(files.map(({ source, path }) => [source, result(path)]));
        const expected = Object.fromEntries(
          files.map(({ source, fires }) => [source, fires ? [[3, TYPE_MESSAGE]] : []]),
        );
        expect(fired, files[0]?.text).toEqual(expected);
      }),
      { ...runs, numRuns: 2 },
    ),
  120_000,
);

/** Where a law's `property` comes from, the call that names it, and whether the law fires. */
const sources: readonly (readonly [string, string, boolean])[] = [
  ['import { property } from "../Testing.test-support.ts";', "property", false],
  ['import { property } from "./Testing.test-support.ts";', "property", false],
  ['import { property as shared } from "../../src/Testing.test-support.ts";', "shared", false],
  ['import * as Testing from "../Testing.test-support.ts";', "Testing.property", false],
  ["const property = () => fc.assert(fc.property(fc.nat(), () => true));", "property", false],
  ['import { property } from "../Testing.ts";', "property", true],
  ['import { property } from "../MyTesting.test-support.ts";', "property", true],
  ['import { property } from "./helper.ts";', "property", true],
  ['import { property } from "fast-check";', "property", true],
  ['import { property } from "@demlik/tea/pbt";', "property", true],
  ['import * as Testing from "../Testing.ts";', "Testing.property", true],
  ['import { other as property } from "../Testing.test-support.ts";', "property", true],
  ['import type { property } from "../Testing.test-support.ts";', "property", true],
  ["const property = (a: unknown, law: unknown, p: unknown) => 1;", "property", true],
];

it(
  "counts the shared runner, property from Testing.test-support.ts, as a property, and no other property",
  () =>
    fc.assert(
      fc.asyncProperty(fc.record({ title: words, nested: fc.boolean() }), async ({ title, nested }) => {
        const files = sources.map(([source, call, fires], i) => {
          const run = `${call}(fc.nat(), () => Effect.void, { numRuns: 1 })`;
          const body = nested ? `Effect.gen(function* () { yield* ${run}; })` : run;
          const text = [
            'import { it } from "@effect/vitest";',
            'import { Effect } from "effect";',
            'import * as fc from "fast-check";',
            source,
            `it.effect("${title}", () => ${body});`,
          ].join("\n");
          return { source, path: `next/packages/libfabrika/src/processes/Shared${i}Test.ts`, text, fires };
        });
        const result = await linted(Object.fromEntries(files.map(({ path, text }) => [path, text])));
        const fired = Object.fromEntries(files.map(({ source, path }) => [source, result(path)]));
        const expected = Object.fromEntries(files.map(({ source, fires }) => [source, fires ? [[5, MESSAGE]] : []]));
        expect(fired, files[0]?.text).toEqual(expected);
      }),
      { ...runs, numRuns: 2 },
    ),
  120_000,
);

it(
  "reads next/ and .agents/ tests and shared suites, and leaves today's tests and product files alone",
  () =>
    fc.assert(
      fc.asyncProperty(fc.record({ title: words }), async ({ title }) => {
        const text = [
          'import { describe, expectTypeOf, it } from "vitest";',
          ...LABELS.map((label) => `it("${label}: kept", () => ${ok(label)});`),
          `export const suite = (sql: unknown) => describe("s", () => { it("${title}", () => {}); });`,
        ].join("\n");
        const read = ["next/a.test.ts", "next/a.test.tsx", "next/a/SinkTest.ts", ".agents/skills/x/a.test.ts"];
        const left = ["next/a.ts", "packages/a.test.ts", "apps/a.test.ts", "programs/a.test.ts", "docs/a.test.ts"];
        const caller = "next/a/sink.test.ts";
        const result = await linted({
          ...Object.fromEntries([...read, ...left].map((path) => [path, text])),
          [caller]: 'import * as SinkTest from "./SinkTest.ts";\nSinkTest.suite(nodeSql);\n',
        });

        for (const path of read) {
          expect(result(path), path).toEqual([[LABELS.length + 2, MESSAGE]]);
        }

        for (const path of [...left, caller]) {
          expect(result(path), path).toEqual([]);
        }
      }),
      { ...runs, numRuns: 2 },
    ),
  120_000,
);

/** Runs `pnpm lint`'s own runner on one planted law at `next/unit.test.ts`, in a clean git checkout under `next/`. */
const lintOne = (text: string) => {
  const dir = realpathSync(mkdtempSync(join(ROOT, "next", ".law-shape-")));

  try {
    spawnSync("git", ["init", "-q", dir]);
    const file = join(dir, "next/unit.test.ts");
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, text);
    return spawnSync(process.execPath, [join(ROOT, "oxlint-plugins/lint.ts"), "next/unit.test.ts"], {
      cwd: dir,
      encoding: "utf8",
      timeout: 20_000,
    });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
};

// scenario: T930 L7, `pnpm lint`'s own runner fails on an unlabeled law in a `next/` folder at zero,
// and its message names both shapes and the five labels (0093, 0523, 0527).
it("scenario: T930 L7 lint.ts blocks on an unlabeled law in a clean folder and names both shapes", () => {
  const ran = lintOne('import { it } from "vitest";\n\nit("adds one", () => {});\n');
  expect(ran.stdout).toContain(CODE);
  expect(ran.stdout).not.toMatch(/Advice|does not block/);
  expect(ran.stdout).toContain("it.prop");
  expect(ran.stdout).toContain("vector:, format:, pinned:, scenario:, type:");
  expect(ran.stdout).toContain("1 blocking, 0 advice");
  expect(ran.status, ran.stdout + ran.stderr).toBe(1);
});

// scenario: T971 L4, `pnpm lint`'s own runner fails on a type: law that also checks at run time, in a
// `next/` folder at zero, and says what a type: body may hold (0527).
it("scenario: T971 L4 lint.ts blocks a type: law whose body runs a check, with the type message", () => {
  const ran = lintOne(
    'import { expect, expectTypeOf, it } from "vitest";\n\nit("type: one is a number", () => {\n  expectTypeOf(1).toBeNumber();\n  expect(1).toBe(1);\n});\n',
  );
  expect(ran.stdout).toContain(CODE);
  expect(ran.stdout).not.toMatch(/Advice|does not block/);
  expect(ran.stdout).toContain(TYPE_MESSAGE);
  expect(ran.stdout).not.toContain(MESSAGE);
  expect(ran.stdout).toContain("1 blocking, 0 advice");
  expect(ran.status, ran.stdout + ran.stderr).toBe(1);
});
