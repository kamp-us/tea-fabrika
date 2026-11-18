// Laws Q4, Q5 and Q13 of docs/plan/quests/kalfa-quality-stryker-PLAN.md: the answer a plant run gives
// from Stryker's JSON report. Stryker remaps test ids to "0", "1" and so on before it writes the
// report, so a mutant's `killedBy` names no test: it has to be looked up in the report's `testFiles`.
//
// fast-check for the generated reports: the input is a whole report with several files, tests of the
// same name in different files and mutants on the same span, which Schema's Arbitrary does not build
// to a plan.
import * as Result from "effect/Result";
import * as Schema from "effect/Schema";
import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { coverage } from "./Built.test-support.ts";
import { KILLS, SPARES, TARGET } from "./Fixture.test-support.ts";
import vector from "./fixtures/report-10.1.1.json" with { type: "json" };
import { plant } from "./Plant.ts";
import * as Report from "./Report.ts";
import * as Target from "./Target.ts";

const options = { seed: 600, numRuns: 100 };

const name = fc.stringMatching(/^[a-z]{3,7} > [a-z]{3,9}$/);

const target = fc.record({
  file: fc.constantFrom("src/a.ts", "src/b.ts", "src/c.ts"),
  line: fc.integer({ min: 1, max: 40 }),
  column: fc.integer({ min: 0, max: 30 }),
  width: fc.integer({ min: 1, max: 12 }),
  mutator: fc.constantFrom("ConditionalExpression", "ObjectLiteral", "LogicalOperator"),
  replacement: fc.constantFrom("true", "false", "{}"),
});

const KINDS = [
  "killed_alone",
  "killed_among_others",
  "elsewhere",
  "elsewhere_same_name",
  "survived",
  "no_coverage",
  "timeout",
  "compile_error",
  "runtime_error",
  "not_run",
] as const;

type Kind = (typeof KINDS)[number];

const TESTFILES = ["src/one.test.ts", "src/two.test.ts", "src/three.test.ts"] as const;

const STATUS: Partial<Record<Kind, string>> = {
  survived: "Survived",
  no_coverage: "NoCoverage",
  timeout: "Timeout",
  compile_error: "CompileError",
  runtime_error: "RuntimeError",
};

/** A report Stryker could have written, with the target's mutant in it as the kind says, and what a reader of it must answer. */
const reports = fc
  .record({
    target,
    lawName: name,
    kind: fc.constantFrom(...KINDS),
    lawFile: fc.constantFrom(...TESTFILES),
    start: fc.integer({ min: 0, max: 20 }),
    siblings: fc.integer({ min: 0, max: 3 }),
    decoys: fc.integer({ min: 0, max: 6 }),
  })
  .map((g) => {
    const found = {
      file: g.target.file,
      line: g.target.line,
      column: g.target.column,
      endLine: g.target.line,
      endColumn: g.target.column + g.target.width,
      mutator: g.target.mutator,
      original: "x",
      replacement: g.target.replacement,
    };

    const law = { file: g.lawFile, name: g.lawName };
    const otherFile = TESTFILES.find((file) => file !== g.lawFile) ?? TESTFILES[0];
    let next = g.start;
    const tests = new Map<string, Array<{ id: string; name: string }>>();

    const add = (file: string, title: string) => {
      const test = { id: String(next++), name: title };
      tests.set(file, [...(tests.get(file) ?? []), test]);

      return { ...test, file };
    };

    const lawTest = add(law.file, law.name);
    const sameName = add(otherFile, law.name);
    const other = add(otherFile, `${law.name} again`);
    const sibling = Array.from({ length: g.siblings }, (_, i) => add(law.file, `${law.name} sibling ${i}`));
    const names = (list: ReadonlyArray<{ id: string }>) => list.map(({ id }) => id);
    let mutantId = 0;

    const mutant = (
      at: { line: number; column: number; width: number },
      mutatorName: string,
      replacement: string,
      status: string,
      killedBy?: ReadonlyArray<string>,
    ) => ({
      id: String(mutantId++),
      mutatorName,
      replacement,
      status,
      static: false,
      testsCompleted: 2,
      ...(killedBy === undefined ? {} : { killedBy }),
      coveredBy: [lawTest.id],
      // The report counts lines and columns from 1; a found target counts columns from 0.
      location: {
        start: { line: at.line, column: at.column + 1 },
        end: { line: at.line, column: at.column + 1 + at.width },
      },
    });

    const here = { line: found.line, column: found.column, width: g.target.width };

    const killers: ReadonlyArray<typeof lawTest> =
      g.kind === "killed_alone"
        ? [lawTest]
        : g.kind === "killed_among_others"
          ? [other, lawTest, ...sibling]
          : g.kind === "elsewhere"
            ? [other]
            : g.kind === "elsewhere_same_name"
              ? [sameName]
              : [];

    const mine =
      g.kind === "not_run"
        ? []
        : [
            mutant(
              here,
              found.mutator,
              found.replacement,
              killers.length > 0 ? "Killed" : (STATUS[g.kind] ?? "Survived"),
              killers.length > 0 ? names(killers) : undefined,
            ),
          ];

    // Decoys: the same span with another mutator or replacement, a neighbor column, and statuses the
    // answer never reads. None of them is the target's mutant.
    const decoys = [
      mutant(here, `${found.mutator}Decoy`, found.replacement, "Killed", [lawTest.id]),
      mutant(here, found.mutator, `${found.replacement}_decoy`, "Killed", [lawTest.id]),
      mutant({ ...here, column: here.column + 1 }, found.mutator, found.replacement, "Killed", [lawTest.id]),
      mutant({ ...here, line: here.line + 1 }, found.mutator, found.replacement, "Survived"),
      mutant(here, "Ignorer", found.replacement, "Ignored"),
      mutant(here, "Pending", found.replacement, "Pending"),
    ].slice(0, g.decoys);

    // The same mutant in another product file, killed by the law: the answer reads only the plant's file.
    const elsewhereFile = found.file === "src/a.ts" ? "src/b.ts" : "src/a.ts";

    const raw = {
      schemaVersion: "1.0",
      thresholds: { high: 80, low: 60 },
      files: {
        [found.file]: { language: "typescript", source: "", mutants: [...decoys, ...mine] },
        [elsewhereFile]: {
          language: "typescript",
          source: "",
          mutants: [mutant(here, found.mutator, found.replacement, "Killed", [lawTest.id])],
        },
      },
      testFiles: Object.fromEntries([...tests].map(([file, list]) => [file, { tests: list, source: "" }])),
    };

    const by = killers.map(({ file, name }) => ({ file, name }));

    const expected =
      g.kind === "killed_alone" || g.kind === "killed_among_others"
        ? { _tag: "killed", by }
        : g.kind === "elsewhere" || g.kind === "elsewhere_same_name"
          ? { _tag: "elsewhere", by }
          : g.kind === "survived"
            ? { _tag: "survived" }
            : g.kind === "no_coverage"
              ? { _tag: "no_coverage" }
              : g.kind === "timeout"
                ? { _tag: "timeout" }
                : g.kind === "compile_error"
                  ? { _tag: "error", status: "CompileError" }
                  : g.kind === "runtime_error"
                    ? { _tag: "error", status: "RuntimeError" }
                    : { _tag: "not_run" };

    return { found, law, raw, expected, kind: g.kind };
  });

describe("Report, the answer a plant run gives", () => {
  // Plants: (a) match the killer by name only, so a same-named test in another file passes; (b) read
  // the raw id of `killedBy` as the test's name.
  it("Q4: killed exactly when the law's own test kills the target's mutant, found through testFiles", () => {
    const seen = coverage(KINDS);

    fc.assert(
      fc.property(reports, ({ found, law, raw, expected, kind }) => {
        seen.hit(kind);
        const report = Schema.decodeUnknownSync(Report.Report)(raw);
        expect(Report.answer(report, found, law)).toMatchObject(expected);
      }),
      options,
    );
    seen.check();
  });

  // Plant: decode `killedBy` as test names without the `testFiles` lookup.
  it("vector: Q5, the report Stryker 10.1.1 wrote on the fixture decodes and its killer resolves to the law's name", () => {
    // vector: fixtures/report-10.1.1.json is `stryker run` 10.1.1's own JSON report, written once by
    //   cd <the Fixture.test-support.ts project, in a temp folder, node_modules linked to this package's> &&
    //   nice -n 15 node node_modules/@stryker-mutator/core/bin/stryker.js run stryker.json
    // with stryker.json = { testRunner: "vitest", plugins: [<vitest-runner's index.js>], mutate:
    // ["src/pick.ts:1:36-1:41"], testFiles: ["src/pick.test.ts"], disableBail: true, coverageAnalysis:
    // "perTest", reporters: ["json"], jsonReporter: { fileName }, inPlace: false, concurrency: 1,
    // timeoutMS: 60000, tsconfigFile: <an absent file>, vitest: { related: false } }.
    // Only `projectRoot` and `config`, which hold paths of the machine that ran it, were dropped.
    const report = Schema.decodeUnknownSync(Report.Report)(vector);

    expect(Report.answer(report, TARGET, KILLS)).toEqual({ _tag: "killed", by: [KILLS] });
    // The same mutant answered for the law that does not kill it: killed, but elsewhere.
    expect(Report.answer(report, TARGET, SPARES)).toEqual({ _tag: "elsewhere", by: [KILLS] });
    // `false` on the same node survives: no law passes a positive number and expects "small".
    expect(Report.answer(report, { ...TARGET, replacement: "false" }, KILLS)).toEqual({ _tag: "survived" });
    // Stryker counts columns from 1 here, and a target from 0: the node at column 36 is the one at 37.
    expect(Report.answer(report, { ...TARGET, column: 37, endColumn: 42 }, KILLS)).toEqual({ _tag: "not_run" });
  });

  // Plant: copy `statusReason` into the record.
  it("Q13 [secrets]: no failure text, description, note or source of the report is recorded", () => {
    const word = fc.stringMatching(/^[A-Za-z0-9]{8,16}$/);

    const fields = fc.subarray(["statusReason", "description", "note", "source"] as const, { minLength: 1 });

    fc.assert(
      fc.property(reports, word, fields, ({ found, law, raw }, word, spot) => {
        const marker = `private-${word}/%?\n`;

        // The secret goes where Stryker puts failure text and prose, in every file and every mutant.
        const dirty = structuredClone(raw);

        for (const file of Object.values(dirty.files)) {
          for (const m of file.mutants) {
            Object.assign(m, {
              ...(spot.includes("statusReason") ? { statusReason: marker } : {}),
              ...(spot.includes("description") ? { description: marker } : {}),
            });
          }

          if (spot.includes("source")) {
            file.source = marker;
          }
        }

        for (const file of Object.values(dirty.testFiles)) {
          for (const test of file.tests) {
            Object.assign(test, spot.includes("note") ? { note: marker } : {});
          }

          if (spot.includes("source")) {
            Object.assign(file, { source: marker });
          }
        }

        const report = Schema.decodeUnknownSync(Report.Report)(dirty);

        const ask = plant({
          name: "subject",
          file: found.file,
          mutator: found.mutator,
          original: found.original,
          replacement: found.replacement,
          law,
        });

        const line = Report.record(ask, found, report, { seconds: 1, node: "v0", stryker: "10.1.1" });
        const published = JSON.stringify(line);

        // The record still says what happened, so an empty one cannot pass.
        expect(line.plant).toBe("subject");
        expect(line.answer).toEqual(Report.answer(report, found, law));

        for (const spelling of [word, encodeURIComponent(marker), JSON.stringify(marker).slice(1, -1)]) {
          expect(published).not.toContain(spelling);
        }

        // A refusal's message carries no text of the file it read, either.
        const text = `// ${marker}\nconst x = 1;\n`;
        const refused = Target.find(text, [], ask);
        const message = Result.isFailure(refused) ? `${refused.failure.message}${JSON.stringify(refused.failure)}` : "";
        expect(Result.isFailure(refused)).toBe(true);

        for (const spelling of [word, encodeURIComponent(marker), JSON.stringify(marker).slice(1, -1)]) {
          expect(message).not.toContain(spelling);
        }
      }),
      options,
    );
  });
});
