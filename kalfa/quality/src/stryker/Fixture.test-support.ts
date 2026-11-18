// The one fixture project the plant runner's real-Stryker law (Q11, MutantsStryker.integration.test.ts)
// and the vector that law's report was saved from (Q5, Report.test.ts, fixtures/report-10.1.1.json)
// share: one product file, one law file with two laws, and the one node a plant names.
//
// The node is `n > 0` in `pick`. Stryker 10.1.1 makes four mutants on it: ConditionalExpression `true`
// and `false`, and EqualityOperator `n >= 0` and `n <= 0`. The first law passes a negative number, so
// `true` and `n <= 0` break it; the second law passes only a positive number and kills neither.

export const PRODUCT = "src/pick.ts";

export const TESTS = "src/pick.test.ts";

export const FILES: Readonly<Record<string, string>> = {
  "package.json": `${JSON.stringify({ name: "fixture", private: true, type: "module" })}\n`,
  [PRODUCT]: 'export const pick = (n: number) => (n > 0 ? "big" : "small");\n',
  [TESTS]: [
    'import { describe, expect, it } from "vitest";',
    'import { pick } from "./pick.ts";',
    "",
    'describe("pick", () => {',
    '  it("a negative number picks small", () => {',
    '    expect(pick(-1)).toBe("small");',
    "  });",
    "",
    '  it("any number picks a word", () => {',
    '    expect(typeof pick(1)).toBe("string");',
    "  });",
    "});",
    "",
  ].join("\n"),
};

/** The two laws, named as Stryker 10.1.1 writes a vitest test: the suite chain and the title joined by " > ". */
export const KILLS = { file: TESTS, name: "pick > a negative number picks small" };

export const SPARES = { file: TESTS, name: "pick > any number picks a word" };

/** The node a plant names, as a found target says it: line from 1, column from 0. */
export const TARGET = {
  file: PRODUCT,
  line: 1,
  column: 36,
  endLine: 1,
  endColumn: 41,
  mutator: "ConditionalExpression",
  original: "n > 0",
  replacement: "true",
};
