// Decisions 0535 and 0536: a law over real IO reads the test depth, and a law in memory keeps its own
// count, whatever it is. Each generated count goes through every form at every path in process through
// oxlint's RuleTester; one oxlint run over the same files then proves the repo's own .oxlintrc.json
// turns the rule on.
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { Array as Arr, pipe, Record as Rec } from "effect";
import * as fc from "fast-check";
import { RuleTester } from "oxlint/plugins-dev";
import { expect, it } from "vitest";
import { runsFromDepth } from "./runs-from-depth.ts";

const root = join(import.meta.dirname, "..");

// RuleTester runs each case at once, so a failure throws into fast-check, which shrinks it.
RuleTester.describe = (_name, fn) => fn();

RuleTester.it = (_name, fn) => fn();

const tester = new RuleTester({ cwd: root });

/** Each form, one a line, with whether the rule reads its count as written. */
const forms = (n: number): ReadonlyArray<readonly [string, boolean]> => [
  [`fc.assert(p, { seed: 119120, numRuns: ${n} });`, true],
  [`it.prop("law", {}, () => true, { arbitrary: { seed: 119120, runs: ${n} } });`, true],
  [`const RUNS = ${n}; fc.assert(p, { numRuns: RUNS });`, true],
  [`fc.assert(p, { ...options, "numRuns": ${n} });`, true],
  // Not a count the rule can read as written, or not a law's count at all.
  [`let r = ${n}; fc.assert(p, { numRuns: r });`, false],
  [`fc.sample(a, { seed: 119120, numRuns: ${n} });`, false],
  [`fc.statistics(a, (v) => String(v), { numRuns: ${n} });`, false],
  [`fc.assert(p, { numRuns: runsFor({ fast: 10, full: ${n} }) });`, false],
  [`walk({ runs: ${n} });`, false],
  [`fc.assert(p, { numRuns: ${n} * 2 });`, false],
];

/** Each file name, and whether the rule holds that file when it sits in `next/`. */
const NAMES = [
  ["plant.test.ts", true],
  ["plant.test.tsx", true],
  ["PlantTest.ts", true],
  ["plant.test-support.ts", true],
  ["plant.ts", false],
] as const;

const PRELUDE = "declare const fc: any, p: any, a: any, it: any, options: any, walk: any, runsFor: any;";

/** The second line of a form's file: a law over real IO calls `open`, a law in memory has none. */
const OPENS = `import { DatabaseSync } from "node:sqlite"; const open = () => new DatabaseSync(":memory:");`;

/** Each form inside a test call, over real IO or in memory. */
const law = (form: string, io: boolean): string => `it("law", () => { ${io ? "open(); " : ""}${form} });`;

/** The lines a file must fire on, the prelude being line 1 and the import line 2. */
const expected = (n: number, io: boolean, held: boolean): ReadonlyArray<number> =>
  held && io ? Arr.flatMap(forms(n), ([, count], i) => (count ? [i + 3] : [])) : [];

const check = (filename: string, code: string, lines: ReadonlyArray<number>) => {
  tester.run("runs-from-depth", runsFromDepth, {
    valid: lines.length === 0 ? [{ code, filename }] : [],
    invalid:
      lines.length === 0
        ? []
        : [{ code, filename, errors: Arr.map(lines, (line) => ({ line, message: /test depth/ })) }],
  });
};

/** One oxlint run over every case's files, through the repo's own config: the lines each one fires. */
const cli = (cases: ReadonlyMap<string, ReadonlyArray<number>>) => {
  const out = spawnSync(
    join(root, "node_modules/.bin/oxlint"),
    ["--format=json", ...Arr.map([...cases.keys()], (file) => relative(root, file))],
    // A hundred runs' files report more than spawnSync's 1 MiB default holds, which cut the JSON short.
    { cwd: root, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 },
  );

  const report = JSON.parse(out.stdout) as {
    diagnostics: Array<{ code: string; filename: string; labels: Array<{ span: { line: number } }> }>;
  };

  const found = Arr.map(
    [...cases.keys()],
    (file) =>
      [
        file,
        pipe(
          report.diagnostics,
          Arr.filter((d) => d.code === "fabrika(runs-from-depth)" && join(root, d.filename) === file),
          Arr.map((d) => d.labels[0]!.span.line),
        ).sort((a, b) => a - b),
      ] as const,
  );

  expect(Rec.fromEntries(found)).toEqual(Rec.fromEntries(cases));
};

/**
 * Each way a file can import a name, bound as `Real`, with whether that name is real IO. Ticket 1029
 * (R3) adds the test primitives' SQLite module, which is, and `runsFor` from their root, which is not.
 */
const IMPORTS = [
  [`import { DatabaseSync as Real } from "node:sqlite";`, true],
  [`import { spawnSync as Real } from "node:child_process";`, true],
  [`import { mkdtempSync as Real } from "node:fs";`, true],
  [`import Real from "miniflare";`, true],
  [`import * as Real from "@effect/sql-sqlite-node";`, true],
  [`import * as Real from "@kampus/vitest/TestDatabase";`, true],
  [`import { make as Real } from "@kampus/vitest/TestDatabase";`, true],
  [`import { runsFor as Real } from "@kampus/vitest";`, false],
] as const;

/**
 * A law at any count, in each form, with whether it reaches real IO when `Real` is real IO (`real`).
 * Each false one is a false alarm the rule had on the tree before it was fixed: a read of the file
 * system, a draw of values, a local that shares a helper's name, a spread whose count is replaced, an
 * Effect read. The Effect write reaches real IO whatever `Real` is.
 */
const ioForms = (n: number, from: string, real: boolean): ReadonlyArray<readonly [string, boolean]> => [
  [from, false],
  [`import { existsSync, readFileSync } from "node:fs";`, false],
  [`import { NodeServices } from "@effect/platform-node";`, false],
  [`const open = () => Real(":memory:");`, false],
  [`const CHECK = { seed: 119120, numRuns: ${n} };`, real],
  [`const SPREAD = { seed: 119120, numRuns: ${n} };`, false],
  [`it("io", () => { open(); fc.assert(p, { numRuns: ${n} }); });`, real],
  [`it("shared", () => { open(); fc.assert(p, CHECK); });`, false],
  [`it("override", () => { open(); fc.assert(p, { ...SPREAD, numRuns: runsFor({ fast: 3, full: 9 }) }); });`, false],
  [`it.effect.prop("io", {}, () => Effect.sync(() => open()), { arbitrary: { seed: 119120, runs: ${n} } });`, real],
  [`it("pure", () => { fc.assert(p, { numRuns: ${n} }); });`, false],
  [`it("exists", () => { existsSync("x"); readFileSync("x"); fc.assert(p, { numRuns: ${n} }); });`, false],
  [`it("draw", () => { open(); fc.sample(a, { numRuns: ${n} }); });`, false],
  [`it("shadow", () => { const open = () => 1; open(); fc.assert(p, { numRuns: ${n} }); });`, false],
  [`it.effect("writes", () => fs.makeTempDirectoryScoped().pipe(() => fc.assert(p, { numRuns: ${n} })));`, true],
  [`it.effect("reads", () => fs.exists("x").pipe(() => fc.assert(p, { numRuns: ${n} })));`, false],
];

const IO_PRELUDE = "declare const fc: any, p: any, a: any, it: any, runsFor: any, Effect: any, fs: any;";

/** A planted file's code, and the lines it must fire on when the rule holds its path. */
type Plant = readonly [string, (held: boolean) => ReadonlyArray<number>];

/** Writes each run's files, checks each in process, and then checks them all through one oxlint run. */
const plant = (count: fc.Arbitrary<Plant>, numRuns: number, examples: Array<[Plant]>) => {
  // One folder in next/, which the rule holds, and one in packages/, which it does not.
  const folders = [
    [mkdtempSync(join(root, "next/.runs-from-depth-")), true],
    [mkdtempSync(join(root, "packages/.runs-from-depth-")), false],
  ] as const;

  try {
    let n = 0;
    const cases = new Map<string, ReadonlyArray<number>>();
    fc.assert(
      fc.property(count, ([code, lines]) => {
        // The one oxlint run reads every run's files, so each run writes them in a folder of its own.
        const run = `${n++}`;

        for (const [folder, inNext] of folders) {
          for (const [name, test] of NAMES) {
            const file = join(folder, run, name);
            const fires = lines(inNext && test);
            check(relative(root, file), code, fires);
            mkdirSync(dirname(file), { recursive: true });
            writeFileSync(file, code);
            cases.set(file, fires);
          }
        }
      }),
      { seed: 119120, numRuns, examples },
    );
    cli(cases);
  } finally {
    for (const [folder] of folders) {
      rmSync(folder, { recursive: true, force: true });
    }
  }
};

/** A case count and the file of every count form it makes in a law, with the lines that must fire. */
const inLaw = (count: number, io: boolean): Plant => [
  Arr.join([PRELUDE, OPENS, ...Arr.map(forms(count), ([line]) => law(line, io)), ""], "\n"),
  (held) => expected(count, io, held),
];

/** A count and an import, with the IO laws' lines that must fire. */
const overIo = (count: number, [from, real]: (typeof IMPORTS)[number]): Plant => {
  const lines = ioForms(count, from, real);

  return [
    Arr.join([IO_PRELUDE, ...Arr.map(lines, ([line]) => line), ""], "\n"),
    (held) => (held ? Arr.flatMap(lines, ([, fires], i) => (fires ? [i + 2] : [])) : []),
  ];
};

it("a written count in a law over real IO is refused in every form the rule reads, and a law in memory keeps any count", () => {
  plant(
    fc.tuple(fc.integer({ min: 1, max: 5000 }), fc.boolean()).map(([count, io]) => inLaw(count, io)),
    6,
    [[inLaw(100, true)], [inLaw(101, false)], [inLaw(300, false)], [inLaw(3000, false)], [inLaw(3000, true)]],
  );
});

// R3 of ticket 1029: the law that reaches `TestDatabase` is held as real IO, and one that imports only
// `runsFor` from the root stays in memory. Plant, run once and restored: leave the module out of `IO`
// (red: the TestDatabase cases passed a bare count).
it("a law that reaches real IO is refused any written count; a law in memory, a draw or a read keeps its own", () => {
  plant(
    fc
      .tuple(fc.integer({ min: 1, max: 5000 }), fc.constantFrom(...IMPORTS))
      .map(([count, from]) => overIo(count, from)),
    100,
    [...Arr.map(IMPORTS, (from): [Plant] => [overIo(100, from)]), [overIo(3000, IMPORTS[0])]],
  );
});
