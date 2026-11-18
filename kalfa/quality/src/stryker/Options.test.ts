// Law Q6 of docs/plan/quests/kalfa-quality-stryker-PLAN.md: the Stryker options for one plant name one
// place and one test file. A `mutate` entry counts lines from 1 and columns from 0 (the same as a
// found target), and Stryker runs every test of a `testFiles` entry, so a folder there would
// widen the answer to tests the plant never named.
//
// fast-check: the input is a record of spans, file paths and settings, shaped by hand.
import { Option } from "effect";
import fc from "fast-check";
import { describe, expect, it } from "vitest";
import * as Options from "./Options.ts";
import { plant } from "./Plant.ts";

const options = { seed: 600, numRuns: 100 };

const path = fc
  .array(fc.stringMatching(/^[a-z][a-z0-9-]{0,7}$/), { minLength: 1, maxLength: 4 })
  .map((parts) => parts.join("/"));

const span = fc.record({
  line: fc.integer({ min: 1, max: 500 }),
  column: fc.integer({ min: 0, max: 200 }),
  lines: fc.integer({ min: 0, max: 6 }),
  endColumn: fc.integer({ min: 0, max: 200 }),
});

const settings = fc.record({
  catalog: path,
  concurrency: fc.integer({ min: 1, max: 8 }),
  timeout: fc.integer({ min: 1, max: 600_000 }),
  inPlace: fc.boolean(),
  ignore: fc.array(fc.stringMatching(/^[a-z.]{1,8}$/), { maxLength: 4 }),
  vitest: fc.option(path, { nil: undefined }).map(Option.fromUndefinedOr),
  nice: fc.integer({ min: 0, max: 19 }),
});

describe("Options, one place and one test file", () => {
  // Plants: (a) count columns from 1; (b) add the law's folder to `testFiles`.
  it("Q6: one mutate entry that is the target's span, the law's file alone, bail off, per-test coverage, each setting in its key", () => {
    fc.assert(
      fc.property(path, path, path, span, settings, (file, lawFile, lawFolder, at, settings) => {
        const target = {
          file,
          line: at.line,
          column: at.column,
          endLine: at.line + at.lines,
          endColumn: at.lines === 0 ? at.column + at.endColumn : at.endColumn,
          mutator: "ConditionalExpression",
          original: "a === b",
          replacement: "true",
        };

        const ask = plant({
          name: "subject",
          file,
          mutator: target.mutator,
          original: target.original,
          replacement: target.replacement,
          law: { file: `${lawFolder}/${lawFile}.test.ts`, name: "suite > title" },
        });

        const got = Options.make(target, ask, settings, { dir: "/scoped/temp", plugin: "/plugins/vitest-runner.js" });

        expect(got.mutate).toEqual([`${file}:${target.line}:${target.column}-${target.endLine}:${target.endColumn}`]);
        expect(got.testFiles).toEqual([ask.law.file]);
        expect(got.disableBail).toBe(true);
        expect(got.coverageAnalysis).toBe("perTest");
        expect(got.testRunner).toBe("vitest");
        expect(got.plugins).toContain("/plugins/vitest-runner.js");
        expect(got.reporters).toEqual(["json"]);
        expect(got.concurrency).toBe(settings.concurrency);
        expect(got.timeoutMS).toBe(settings.timeout);
        expect(got.inPlace).toBe(settings.inPlace);
        expect(got.ignorePatterns).toEqual(settings.ignore);
        expect(got.vitest).toEqual({
          related: false,
          ...(Option.isSome(settings.vitest) ? { configFile: settings.vitest.value } : {}),
        });
        // Every file the run writes is in its own temp folder.
        expect(got.jsonReporter.fileName.startsWith("/scoped/temp/")).toBe(true);
        expect(got.tempDirName.startsWith("/scoped/temp/")).toBe(true);
        expect(got.tsconfigFile.startsWith("/scoped/temp/")).toBe(true);
      }),
      options,
    );
  });
});
