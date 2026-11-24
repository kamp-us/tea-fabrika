import { describe, expect, it } from "vitest";
import { plan, planFrom, title } from "./recheck.ts";

// Today's lead tooling: the plan of the full-depth recheck of the mutants that lived at the cap (ticket 1306).
const at = (line: number, column: number, endLine: number, endColumn: number) => ({
  start: { line, column },
  end: { line: endLine, column: endColumn },
});

const report = {
  files: {
    "/repo/src/a.ts": {
      mutants: [
        { status: "Killed", coveredBy: ["0"], location: at(1, 1, 1, 5) },
        { status: "Survived", coveredBy: ["0", "2"], location: at(3, 10, 3, 38) },
        { status: "Survived", coveredBy: ["2"], location: at(3, 10, 3, 38) },
        { status: "Ignored", coveredBy: [], location: at(9, 1, 9, 5) },
      ],
    },
  },
  testFiles: {
    "src/a.test.ts": {
      tests: [
        { id: "0", name: "the shared laws > S1 reads (a|b) back" },
        { id: "1", name: "the shared laws > S2 never run" },
        { id: "2", name: "P22 editTree on the stand-in" },
      ],
    },
    "src/b.test.ts": { tests: [{ id: "3", name: "unrelated" }] },
  },
};

describe("the full-depth recheck plan", () => {
  // Plants: keep the report's column (a range counts from 0); plan a mutant that was killed or ignored; drop the repo prefix wrong.
  it("plans each mutant that lived once, with the sampler's own range text", () => {
    const got = plan(report, ["src/a.test.ts", "src/b.test.ts"]);

    expect(got?.ranges).toEqual(["src/a.ts:3:9-3:37"]);
  });

  // Plants: name every test of the report; leave a covering test's file out; leave a regex character unescaped; keep the describe chain.
  it("runs only the files and the titles of the tests that cover them, with regex characters escaped", () => {
    const got = plan(report, ["src/a.test.ts", "src/b.test.ts"]);

    expect(got?.related).toEqual(["src/a.test.ts"]);
    expect(got?.names).toBe("S1 reads \\(a\\|b\\) back|P22 editTree on the stand-in");
    expect(title("a > b > c")).toBe("c");
    expect(title("plain")).toBe("plain");
  });

  // Plants: narrow a run that has a mutant no test covered; plan one when nothing lived.
  it("runs every related test when a mutant had no covering test, and plans nothing when none lived", () => {
    const uncovered = {
      ...report,
      files: { "src/a.ts": { mutants: [{ status: "NoCoverage", location: at(5, 2, 5, 9) }] } },
    };

    expect(plan(uncovered, ["src/a.test.ts", "src/b.test.ts"])).toEqual({
      ranges: ["src/a.ts:5:1-5:8"],
      related: ["src/a.test.ts", "src/b.test.ts"],
      names: null,
    });

    expect(
      plan({ ...report, files: { "src/a.ts": { mutants: [report.files["/repo/src/a.ts"].mutants[0]!] } } }, ["x"]),
    ).toBeNull();
  });

  it("reads the report's own text, and refuses text that is no report", () => {
    expect(planFrom(JSON.stringify(report), ["src/a.test.ts"])?.related).toEqual(["src/a.test.ts"]);
    expect(() => planFrom("{}", ["x"])).toThrow();
  });
});
