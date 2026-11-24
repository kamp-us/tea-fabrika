import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import fc from "fast-check";
import { describe, expect, it } from "vitest";
import {
  type Checked,
  errorsIn,
  isTypeError,
  mutate,
  plan,
  planFrom,
  retag,
  title,
  tscCheck,
  tsconfigDir,
  typedFrom,
} from "./recheck.ts";

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

// Ticket 1309: a mutant that breaks the types is a type error, which counts as a kill and is never listed or run again.
const options = { seed: 119120, numRuns: 200 };

describe("the type check of the mutants that lived", () => {
  const piece = fc.stringMatching(/^[a-z \n]{0,12}$/);

  /** Where the end of a text is, as the report counts: the line, and the column from 1, of the character after it. */
  const endAt = (text: string) => {
    const rows = text.split("\n");

    return { line: rows.length, column: (rows.at(-1) ?? "").length + 1 };
  };

  // Plants: read a column from 0; read a line from 0; cut the end one character short or long; put the replacement at the end of the line.
  it("a mutant replaces exactly its place in the source, lines and columns counted from 1, the end excluded", () => {
    fc.assert(
      fc.property(piece, piece, piece, piece, (before, original, replacement, after) => {
        const got = mutate(`${before}${original}${after}`, {
          replacement,
          location: { start: endAt(before), end: endAt(`${before}${original}`) },
        });

        expect(got).toBe(`${before}${replacement}${after}`);
      }),
      options,
    );

    expect(
      mutate("a\nb", { replacement: "x", location: { start: { line: 3, column: 1 }, end: { line: 3, column: 2 } } }),
    ).toBeNull();
    expect(
      mutate("a\nb", { replacement: "x", location: { start: { line: 2, column: 1 }, end: { line: 1, column: 2 } } }),
    ).toBeNull();
  });

  // Plants: count a note or a warning line; miss a global error with no file; miss an error with a path; read any line holding the word.
  it("the error lines of tsc's output are its diagnostics, and nothing else", () => {
    const output = [
      "src/a.ts(3,5): error TS2322: Type 'string' is not assignable to type 'number'.",
      "  The expected type comes from property 'n'.",
      "error TS5083: Cannot read file 'tsconfig.json'.",
      "src/b.ts(1,1): warning TS6133: unused.",
      "the word error appears here",
      "src/c.ts(9,9): error TS2345: Argument of type 'x'.",
    ].join("\n");

    expect(errorsIn(output)).toEqual([
      "src/a.ts(3,5): error TS2322: Type 'string' is not assignable to type 'number'.",
      "error TS5083: Cannot read file 'tsconfig.json'.",
      "src/c.ts(9,9): error TS2345: Argument of type 'x'.",
    ]);

    expect(errorsIn("")).toEqual([]);
  });

  // Plants: judge a package that fails as it is; judge one that was never checked; count a mutant that checks clean; count one that could not be checked.
  it("a mutant is a type error only when the package checks clean as it is and fails with the mutant", () => {
    const clean: Checked = [];
    const broken: Checked = ["a.ts(1,1): error TS2322: x"];

    expect(isTypeError(clean, broken)).toBe(true);
    expect(isTypeError(clean, clean)).toBe(false);
    expect(isTypeError(clean, null)).toBe(false);
    expect(isTypeError(null, broken)).toBe(false);
    expect(isTypeError(broken, broken)).toBe(false);
    expect(isTypeError(broken, clean)).toBe(false);
  });

  const at = (line: number) => ({ start: { line, column: 1 }, end: { line, column: 4 } });

  const lived = {
    schemaVersion: "2",
    files: {
      "src/a.ts": {
        source: "x",
        mutants: [
          { id: "1", status: "Survived", coveredBy: ["0"], replacement: "1", location: at(1) },
          { id: "2", status: "NoCoverage", replacement: "2", location: at(2) },
          { id: "3", status: "Killed", coveredBy: ["0"], replacement: "3", location: at(3) },
          { id: "4", status: "Survived", coveredBy: ["0"], replacement: "4", location: at(4) },
        ],
      },
      "src/b.ts": { mutants: [{ id: "1", status: "Survived", replacement: "5", location: at(1) }] },
    },
  };

  // Plants: retag by id alone (the other file's id 1); retag a mutant not named; drop a report field; leave the status; mutate the report it was given.
  it("retag sets the named mutants to CompileError and keeps the rest of the report as it was", () => {
    const before = JSON.stringify(lived);

    const got: typeof lived = JSON.parse(
      retag(
        before,
        new Map([
          [
            "src/a.ts",
            new Map([
              ["1", "tsc: x"],
              ["3", "tsc: y"],
            ]),
          ],
        ]),
      ),
    );

    expect(JSON.stringify(lived)).toBe(before);
    expect(got.files["src/a.ts"].mutants.map((m) => m.status)).toEqual([
      "CompileError",
      "NoCoverage",
      "CompileError",
      "Survived",
    ]);
    expect(got.files["src/b.ts"].mutants[0]?.status).toBe("Survived");
    expect(got.files["src/a.ts"].mutants[0]).toMatchObject({
      id: "1",
      coveredBy: ["0"],
      replacement: "1",
      statusReason: "tsc: x",
    });
    expect(got.schemaVersion).toBe("2");
    expect(got.files["src/a.ts"].source).toBe("x");
  });

  const project = (source: string, tsconfig = true) => {
    const root = mkdtempSync(join(tmpdir(), "typed-"));
    mkdirSync(join(root, "pkg", "src"), { recursive: true });
    writeFileSync(join(root, "pkg", "src", "a.ts"), source);

    if (tsconfig) {
      writeFileSync(join(root, "pkg", "tsconfig.json"), "{}");
    }

    return root;
  };

  const reportWith = (root: string, ids: ReadonlyArray<readonly [string, string, number]>) => {
    const path = join(root, "report.json");

    writeFileSync(
      path,
      JSON.stringify({
        files: {
          "pkg/src/a.ts": {
            mutants: ids.map(([id, status, line]) => ({ id, status, replacement: `R${id}`, location: at(line) })),
          },
        },
      }),
    );

    return path;
  };

  const statuses = (path: string) => {
    const report: { files: Record<string, { mutants: Array<{ status: string }> }> } = JSON.parse(
      readFileSync(path, "utf8"),
    );

    return report.files["pkg/src/a.ts"]?.mutants.map((m) => m.status);
  };

  // A fake check: the package fails exactly when its file holds a replacement marked bad.
  const fake =
    (root: string, bad: ReadonlyArray<string>, calls: Array<string> = []) =>
    (dir: string): Checked => {
      calls.push(dir);
      const text = readFileSync(join(root, "pkg", "src", "a.ts"), "utf8");

      return bad.some((id) => text.includes(`R${id}`)) ? [`pkg/src/a.ts(1,1): error TS2322: R`] : [];
    };

  // Plants: retag a mutant that checks clean; retag one that was killed; leave the file mutated; judge a mutant of another status; leave the report unchanged when some are typed.
  it("typedFrom sets the lived mutants that break the check to CompileError, puts each file back, and keeps the first report", () => {
    const root = project("aaa\nbbb\nccc\nddd\n");

    try {
      const path = reportWith(root, [
        ["1", "Survived", 1],
        ["2", "NoCoverage", 2],
        ["3", "Killed", 3],
        ["4", "Survived", 4],
      ]);

      const first = readFileSync(path, "utf8");
      const calls: Array<string> = [];

      const got = typedFrom({
        root,
        report: path,
        out: join(root, "out"),
        seconds: 60,
        check: fake(root, ["1", "2", "3"], calls),
      });

      expect(got.typed.map((t) => t.id)).toEqual(["1", "2"]);
      expect(got.checked).toBe(3);
      expect(got.unreached).toBe(0);
      expect(statuses(path)).toEqual(["CompileError", "CompileError", "Killed", "Survived"]);
      expect(readFileSync(join(root, "pkg", "src", "a.ts"), "utf8")).toBe("aaa\nbbb\nccc\nddd\n");
      expect(readFileSync(join(root, "out", "report.stryker.json"), "utf8")).toBe(first);
      expect(JSON.parse(readFileSync(join(root, "out", "typed.json"), "utf8"))).toMatchObject({
        checked: 3,
        unreached: 0,
      });
      expect(planFrom(readFileSync(path, "utf8"), ["t.ts"])?.ranges).toEqual(["pkg/src/a.ts:4:0-4:3"]);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  // Plants: judge a package that fails as it is; judge a file with no package tsconfig; ignore the time limit; leave the file mutated when the check throws.
  it("a package that fails as it is, a file with no tsconfig and a mutant the time ran out on are left as they were", () => {
    const failing = project("aaa\n");
    const loose = project("aaa\n", false);
    const slow = project("aaa\nbbb\n");

    try {
      const as = reportWith(failing, [["1", "Survived", 1]]);

      const none = typedFrom({
        root: failing,
        report: as,
        out: join(failing, "out"),
        seconds: 60,
        check: () => ["a.ts(1,1): error TS1: broken"],
      });

      expect(none.typed).toEqual([]);
      expect(statuses(as)).toEqual(["Survived"]);

      const no = reportWith(loose, [["1", "Survived", 1]]);
      const calls: Array<string> = [];
      expect(
        typedFrom({ root: loose, report: no, out: join(loose, "out"), seconds: 60, check: fake(loose, ["1"], calls) })
          .typed,
      ).toEqual([]);
      expect(calls).toEqual([]);
      expect(statuses(no)).toEqual(["Survived"]);

      const late = reportWith(slow, [
        ["1", "Survived", 1],
        ["2", "Survived", 2],
      ]);

      let clock = 0;

      const timed = typedFrom({
        root: slow,
        report: late,
        out: join(slow, "out"),
        seconds: 1,
        check: fake(slow, ["1", "2"]),
        now: () => (clock += 600),
      });

      expect(timed.unreached).toBeGreaterThan(0);
      expect(timed.typed.length + timed.unreached).toBe(2);

      const thrown = reportWith(slow, [["1", "Survived", 1]]);
      expect(() =>
        typedFrom({
          root: slow,
          report: thrown,
          out: join(slow, "out"),
          seconds: 60,
          check: (dir) => {
            if (readFileSync(join(slow, "pkg", "src", "a.ts"), "utf8").includes("R1")) {
              throw new Error("the checker fell over");
            }

            return fake(slow, [])(dir);
          },
        }),
      ).toThrow("fell over");
      expect(readFileSync(join(slow, "pkg", "src", "a.ts"), "utf8")).toBe("aaa\nbbb\n");
    } finally {
      for (const root of [failing, loose, slow]) {
        rmSync(root, { recursive: true, force: true });
      }
    }
  });

  // Plants: judge by what a killed or missing tsc printed before it stopped; read a tsc that did not run as a clean package.
  it("a type check that could not finish judges nothing: a tsc that runs out of time or is missing gives no answer", () => {
    const root = project("x");
    const slow = join(root, "slow-tsc");
    writeFileSync(slow, '#!/bin/sh\necho "pkg/src/a.ts(1,1): error TS2322: partway"\nsleep 5\n', { mode: 0o755 });

    try {
      expect(tscCheck(slow, root, 0.5)(join(root, "pkg"))).toBeNull();
      expect(tscCheck(join(root, "no-such-tsc"), root)(join(root, "pkg"))).toBeNull();
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("the package of a file is the nearest folder under the root with a tsconfig.json", () => {
    const root = project("x");

    try {
      expect(tsconfigDir(root, join(root, "pkg", "src", "a.ts"))).toBe(join(root, "pkg"));
      expect(tsconfigDir(root, join(root, "other", "b.ts"))).toBeNull();
      writeFileSync(join(root, "tsconfig.json"), "{}");
      expect(tsconfigDir(root, join(root, "other", "b.ts"))).toBeNull();
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  // The real tsc, on a planted mutant: the type check's own proof. Plants: judge by the exit code of a clean run only; take a mutant that keeps the types for a type error; take one that breaks them for a kept one.
  it("with the repo's own tsc, a mutant that breaks a type is typed and one that keeps the types is not", () => {
    const root = project('export const n: number = 1;\nexport const s: string = "a";\n');
    writeFileSync(
      join(root, "pkg", "tsconfig.json"),
      JSON.stringify({
        compilerOptions: {
          strict: true,
          noEmit: true,
          module: "NodeNext",
          moduleResolution: "NodeNext",
          target: "ES2022",
          types: [],
        },
        include: ["src"],
      }),
    );

    try {
      const path = join(root, "report.json");

      const mutant = (id: string, replacement: string, line: number, from: number, to: number) => ({
        id,
        status: "Survived",
        replacement,
        location: { start: { line, column: from }, end: { line, column: to } },
      });

      writeFileSync(
        path,
        JSON.stringify({
          files: {
            "pkg/src/a.ts": {
              mutants: [
                mutant("1", '"x"', 1, 26, 27),
                mutant("2", "2", 1, 26, 27),
                mutant("3", "7", 2, 26, 29),
                mutant("4", "-1", 1, 26, 27),
              ],
            },
          },
        }),
      );

      const tsc = resolve(import.meta.dirname, "../../../../node_modules/.bin/tsc");
      const got = typedFrom({ root, report: path, out: join(root, "out"), seconds: 100, check: tscCheck(tsc, root) });

      expect(got.typed.map((t) => t.id)).toEqual(["1", "3"]);
      expect(statuses(path)).toEqual(["CompileError", "Survived", "CompileError", "Survived"]);
      expect(got.typed[0]?.reason).toContain("TS2322");
      expect(readFileSync(join(root, "pkg", "src", "a.ts"), "utf8")).toBe(
        'export const n: number = 1;\nexport const s: string = "a";\n',
      );
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
