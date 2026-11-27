import { it as effect } from "@effect/vitest";
import { Array as Arr, Effect, FileSystem, Layer, Option, Path, PlatformError, Result, Schema } from "effect";
import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { answer, File, memory, Row } from "./gate.test-support.ts";
import * as Saved from "./gatecache.ts";
import {
  answersIn,
  changed,
  coverage,
  exitCode,
  isAnswered,
  judge,
  lawFolder,
  leftOut,
  mutable,
  normal,
  notAnswers,
  oldestFirst,
  refusalNote,
  refusedIn,
  parentEntries,
  pick,
  picked,
  readAnswers,
  reach,
  resolve,
  recheckText,
  runsFlag,
  staticLines,
  survivorLines,
  testsIn,
  typedText,
} from "./survivors.ts";
import type { Run } from "./survivors.ts";

// Today's tooling: the guard check's pure parts. The run itself starts Docker, so it is tried by hand.
const options = { seed: 119120, numRuns: 200 };

const segment = fc.stringMatching(/^[a-z][a-z0-9-]{0,6}$/);

const folder = fc.array(segment, { minLength: 1, maxLength: 3 }).map((parts) => Arr.join(parts, "/"));

/** A file of any kind the repo holds, under a folder. */
const anyFile = fc
  .tuple(
    folder,
    segment,
    fc.constantFrom(
      ".ts",
      ".tsx",
      ".mjs",
      ".test.ts",
      ".laws.test.ts",
      ".test-support.ts",
      "Test.ts",
      ".d.ts",
      ".md",
      ".json",
    ),
  )
  .map(([dir, name, end]) => `${dir}/${name}${end}`);

describe("survivors, which files a run mutates", () => {
  // Plants: drop the cap check; let a test, a test-support file or a laws kit through; let a named
  // file the head lacks through; keep a changed file twice.
  it("pick takes each changed file it may mutate once, in order, and refuses more than the cap or a bad named file", () => {
    fc.assert(
      fc.property(
        fc.array(anyFile, { maxLength: 12 }),
        fc.integer({ min: 1, max: 8 }),
        fc.boolean(),
        (paths, cap, name) => {
          const tree = new Set(paths);
          const want = [...new Set(Arr.filter(paths, mutable))].sort();
          const got = pick({ changed: [...paths, ...paths], named: name ? want : null, tree, cap });

          if (want.length > cap) {
            expect(Result.isFailure(got)).toBe(true);
            expect(Result.isFailure(got) && got.failure.detail).toContain(`${want.length} product files`);
          } else {
            expect(got).toEqual(Result.succeed(want));
          }

          for (const path of paths) {
            expect(mutable(path), path).toBe(
              /\.(ts|tsx|mjs)$/.test(path) &&
                !path.includes(".test.") &&
                !path.endsWith(".d.ts") &&
                !path.endsWith(".test-support.ts") &&
                !path.endsWith("Test.ts"),
            );
          }

          const absent = "nowhere/missing.ts";
          const bad = pick({ changed: [], named: [...want, absent], tree, cap: 99 });
          expect(Result.isFailure(bad) && bad.failure.detail).toContain(absent);

          for (const notOurs of Arr.filter(paths, (path) => !mutable(path))) {
            const refused = pick({ changed: [], named: [notOurs], tree, cap: 99 });
            expect(Result.isFailure(refused) && refused.failure.detail, notOurs).toContain(notOurs);
          }
        },
      ),
      options,
    );
  });

  // Plants: keep the base's blob when it equals the head's (the file would have no changed line and
  // get no mutant); drop the base's blob when it differs (the file would be mutated whole).
  it("the sample's parent holds the base's version of a changed file, and nothing for a file mutated whole", () => {
    const blob = fc.record({ mode: fc.constantFrom("100644", "100755"), id: fc.constantFrom("a1", "b2", "c3") });

    fc.assert(
      fc.property(
        fc.uniqueArray(fc.tuple(anyFile, fc.option(blob, { nil: undefined }), blob), {
          selector: ([path]) => path,
          maxLength: 8,
        }),
        (rows) => {
          const base = Object.fromEntries(Arr.flatMap(rows, ([path, b]) => (b === undefined ? [] : [[path, b]])));
          const head = Object.fromEntries(Arr.map(rows, ([path, , h]) => [path, h]));

          const got = parentEntries(
            Arr.map(rows, ([path]) => path),
            base,
            head,
          );

          expect(got).toEqual(
            Arr.map(rows, ([path, b, h]) => ({ path, blob: b !== undefined && b.id !== h.id ? b : null })),
          );
        },
      ),
      options,
    );
  });
});

/** The relative specifier from one file to another, as a person writes it. */
const relative = (from: string, to: string) => {
  const a = from.split("/").slice(0, -1);
  const b = to.split("/");
  let same = 0;

  while (same < a.length && same < b.length - 1 && a[same] === b[same]) {
    same++;
  }

  const up = a.length - same;

  return `${up === 0 ? "./" : "../".repeat(up)}${b.slice(same).join("/")}`;
};

describe("survivors, which laws load a file", () => {
  // Plants: resolve only the exact name, so an import without its extension is lost; let `..` climb
  // past the repo's top; read a bare package name as a path.
  it("an import resolves to the tree file it names, with or without its extension, and nothing else does", () => {
    fc.assert(
      fc.property(
        fc.uniqueArray(fc.tuple(folder, segment), { minLength: 2, maxLength: 6, selector: (x) => x.join("/") }),
        fc.constantFrom(".ts", ".tsx"),
        (pairs, end) => {
          const files = Arr.map(pairs, ([dir, name]) => `${dir}/${name}${end}`);
          const tree = new Set(files);

          for (const from of files) {
            for (const to of files) {
              const spec = relative(from, to);
              expect(resolve(from, spec, tree, null), `${from} -> ${spec}`).toBe(to);
              expect(resolve(from, spec.slice(0, -end.length), tree, null), `${from} -> no extension`).toBe(to);
            }

            expect(resolve(from, "effect", tree, null)).toBeNull();
            expect(resolve(from, `${"../".repeat(from.split("/").length)}x.ts`, tree, null)).toBeNull();
          }
        },
      ),
      options,
    );
  });

  // Plants: ignore the package's own name, so a law that imports `@scope/pkg/Sub` reaches nothing;
  // read an export path from the repo's top, not the package's folder.
  it("an import by the package's own name resolves through its exports, from the package's folder", () => {
    fc.assert(
      fc.property(folder, fc.uniqueArray(segment, { minLength: 1, maxLength: 4 }), (root, subs) => {
        const files = Arr.map(subs, (sub) => `${root}/src/${sub}.ts`);
        const exports = Object.fromEntries(Arr.map(subs, (sub) => [`./${sub}`, `./src/${sub}.ts`]));
        const own = { folder: root, name: "@pkg/self", exports: { ...exports, ".": `./src/${subs[0]}.ts` } };
        const tree = new Set(files);

        for (const sub of subs) {
          expect(resolve(`${root}/src/x.test.ts`, `@pkg/self/${sub}`, tree, own)).toBe(`${root}/src/${sub}.ts`);
        }

        expect(resolve(`${root}/src/x.test.ts`, "@pkg/self", tree, own)).toBe(files[0]);
        expect(resolve(`${root}/src/x.test.ts`, "@pkg/other/a", tree, own)).toBeNull();
      }),
      options,
    );
  });

  // Plants: stop the walk after one step, so a law that loads the file through a helper is lost;
  // count a file no law loads as loaded.
  it("a law loads every file it reaches through any chain of imports, and a file no law reaches is bare", () => {
    fc.assert(
      fc.property(
        fc
          .integer({ min: 2, max: 9 })
          .chain((n) =>
            fc.tuple(
              fc.constant(n),
              fc.array(fc.tuple(fc.nat({ max: n - 1 }), fc.nat({ max: n - 1 })), { maxLength: 20 }),
              fc.uniqueArray(fc.nat({ max: n - 1 }), { minLength: 1, maxLength: n }),
            ),
          ),
        ([n, links, tests]) => {
          const name = (i: number) => `f${i}.ts`;
          const edges = (file: string) => Arr.flatMap(links, ([from, to]) => (name(from) === file ? [name(to)] : []));

          // The closure by repeated widening, the slow way.
          const closure = (start: number) => {
            let seen = new Set([start]);

            for (let round = 0; round < n; round++) {
              seen = new Set([...seen, ...Arr.flatMap(links, ([from, to]) => (seen.has(from) ? [to] : []))]);
            }

            return new Set([...seen].map(name));
          };

          const reached = reach(Arr.map(tests, name), edges);

          for (const t of tests) {
            expect(reached.get(name(t))).toEqual(closure(t));
          }

          const files = Arr.map(Arr.range(0, n - 1), name);
          const { laws, bare } = coverage(files, reached);
          expect(bare).toEqual(Arr.filter(files, (f) => !Arr.some(tests, (t) => closure(t).has(f))));
          expect(laws).toEqual([...Arr.map(tests, name)].sort());
        },
      ),
      options,
    );
  });

  // Ticket 1314. Plants: pick no law by name, so a rule whose test lints through plant.ts is bare (the 89 "no law ran" mutants on no-hand-tag.ts);
  // pick by name a rule that no test is named after, or a test of another folder; list a law found by import as by name too.
  it("a lint rule's own test is picked by name when no import reaches the rule, and a law found by import is not named twice", () => {
    const name = fc.stringMatching(/^[a-z][a-z-]{0,8}[a-z]$/);

    fc.assert(
      fc.property(name, name, (rule, other) => {
        fc.pre(rule !== other);
        const file = `oxlint-plugins/${rule}.ts`;
        const law = `oxlint-plugins/${rule}.test.ts`;
        const plant = "oxlint-plugins/plant.ts";
        const tests = [law, `oxlint-plugins/${other}.test.ts`];

        // The test reaches only plant.ts, which runs oxlint in another process.
        const viaPlant = reach(tests, (from) => (from === plant ? [] : [plant]));
        expect(picked([file], viaPlant, tests)).toEqual({ imported: [], named: [law], laws: [law], bare: [] });

        // The same test imports the rule: found by import, named for nothing.
        const direct = reach(tests, (from) => (from === law ? [file] : []));
        expect(picked([file], direct, tests)).toEqual({ imported: [law], named: [], laws: [law], bare: [] });

        // No test of the rule's name: another test that reaches it is by import, and one that does not leaves the rule bare.
        const rest = [`oxlint-plugins/${other}.test.ts`];
        expect(
          picked(
            [file],
            reach(rest, () => [file]),
            rest,
          ),
        ).toEqual({
          imported: rest,
          named: [],
          laws: rest,
          bare: [],
        });
        expect(
          picked(
            [file],
            reach(rest, () => []),
            rest,
          ),
        ).toEqual({ imported: [], named: [], laws: [], bare: [file] });

        // A file that is no rule is named after nothing: support beside the rules, and a rule of another folder.
        expect(picked([`oxlint-plugins/${rule}.test-support.ts`], viaPlant, tests).laws).toEqual([]);
        expect(picked([`next/${rule}.ts`], viaPlant, tests).laws).toEqual([]);
      }),
      options,
    );
  });

  // Plants: take the repo's top as a package, so every test in the repo is a candidate; skip the
  // nearest package for a farther one.
  it("a file's laws are looked for in its nearest package, or in its own folder when none is above it", () => {
    fc.assert(
      fc.property(
        fc.array(segment, { minLength: 1, maxLength: 4 }),
        fc.array(fc.boolean(), { minLength: 4, maxLength: 4 }),
        (parts, packages) => {
          const file = `${parts.join("/")}/x.ts`;
          const folders = Arr.map(Arr.range(1, parts.length), (k) => parts.slice(0, k).join("/"));
          const marked = Arr.filter(folders, (_, i) => packages[i] === true);
          const tree = new Set([file, "package.json", ...Arr.map(marked, (f) => `${f}/package.json`)]);
          const nearest = marked.at(-1) ?? parts.join("/");

          expect(lawFolder(file, tree)).toBe(nearest);
        },
      ),
      options,
    );
    expect(lawFolder("top.ts", new Set(["top.ts", "package.json"]))).toBe("");
  });

  // Plants: run an integration or type law; drop a test of another folder only partly, by prefix.
  it("the tests in a package are its .test files of a kind the container can run, and the rest are named", () => {
    fc.assert(
      fc.property(
        fc.array(
          fc.tuple(
            fc.constantFrom("pkg", "pkg/src", "pkgs", "other"),
            segment,
            fc.constantFrom(
              ".test.ts",
              ".integration.test.ts",
              ".types.test.ts",
              ".visual.test.tsx",
              ".laws.test.ts",
              ".ts",
            ),
          ),
          { maxLength: 12 },
        ),
        (rows) => {
          const tree = Arr.map(rows, ([dir, name, end]) => `${dir}/${name}${end}`);
          const { tests, left } = testsIn(["pkg"], tree);
          const inside = Arr.filter(tree, (p) => p.startsWith("pkg/") && /\.test\.tsx?$/.test(p));
          expect([...tests, ...Arr.map(left, (l) => l.path)].sort()).toEqual([...inside].sort());

          for (const test of tests) {
            expect(test).not.toMatch(/\.(integration|types|visual)\./);
          }

          for (const l of left) {
            expect(leftOut(l.path)).toBe(l.reason);
            expect(l.path).toMatch(/\.(integration|types|visual)\./);
          }
        },
      ),
      options,
    );
  });

  // Plant: drop the check for climbing past the top.
  it("a path's dots are worked out, and one that climbs past the top is null", () => {
    fc.assert(
      fc.property(fc.array(segment, { maxLength: 5 }), (parts) => {
        const path = parts.join("/");
        expect(normal(`./${path}`)).toBe(path);
        expect(normal(`${path}/x/../y`)).toBe(parts.length === 0 ? "y" : `${path}/y`);
        expect(normal(`${"../".repeat(parts.length + 1)}${path}`)).toBeNull();
      }),
      options,
    );
  });
});

describe("survivors, what a mutant changed", () => {
  const row = {
    file: "a.ts",
    mutator: "MethodExpression",
    replacement: "x",
    status: "Survived",
  };

  // Plants: read the columns from 0, as the CLI's mutate ranges do, so the span starts one too far;
  // drop the last line of a span over several lines.
  it("the original span is read with lines and columns from 1, and folded to one short line", () => {
    fc.assert(
      fc.property(
        fc.array(fc.stringMatching(/^[a-z (){}.;]{0,30}$/), { minLength: 1, maxLength: 6 }),
        fc.nat(),
        fc.nat(),
        fc.nat(),
        fc.nat(),
        (lines, a, b, c, d) => {
          const source = lines.join("\n");
          const startLine = a % lines.length;
          const endLine = startLine + (b % (lines.length - startLine));
          const startCol = c % ((lines[startLine]?.length ?? 0) + 1);

          const endCol =
            endLine === startLine
              ? startCol + (d % ((lines[endLine]?.length ?? 0) - startCol + 1))
              : d % ((lines[endLine]?.length ?? 0) + 1);

          const span =
            startLine === endLine
              ? (lines[startLine] ?? "").slice(startCol, endCol)
              : [
                  (lines[startLine] ?? "").slice(startCol),
                  ...lines.slice(startLine + 1, endLine),
                  (lines[endLine] ?? "").slice(0, endCol),
                ].join("\n");

          const folded = span.replace(/\s+/g, " ").trim();
          const shown = folded.length > 72 ? `${folded.slice(0, 69)}...` : folded;

          expect(
            changed(source, {
              ...row,
              line: startLine + 1,
              column: startCol + 1,
              endLine: endLine + 1,
              endColumn: endCol + 1,
            }),
          ).toBe(`${shown} -> x`);
        },
      ),
      options,
    );
  });

  // Plants: say "lived" for a mutant no law ran; sort by file only, so two lines of one file swap.
  it("each mutant that lived is one line by place, and each static source line is one line", () => {
    fc.assert(
      fc.property(
        fc.array(
          fc.record({
            file: fc.constantFrom("a.ts", "b.ts"),
            line: fc.integer({ min: 1, max: 3 }),
            column: fc.integer({ min: 1, max: 3 }),
            status: fc.constantFrom("Survived", "NoCoverage", "Ignored"),
            mutator: fc.constantFrom("Regex", "StringLiteral"),
          }),
          { maxLength: 10 },
        ),
        (rows) => {
          const full = Arr.map(rows, (r) => ({ ...r, endLine: r.line, endColumn: r.column, replacement: "y" }));
          const lived = survivorLines(full, () => "abc\ndef\nghi");

          const order = [...full].sort((x, y) =>
            x.file < y.file ? -1 : x.file > y.file ? 1 : x.line - y.line || x.column - y.column,
          );

          expect(lived).toEqual(
            Arr.map(
              order,
              (r) =>
                `${r.status === "NoCoverage" ? "no law ran" : "lived"}  ${r.file}:${r.line} ${r.mutator}: ${changed("abc\ndef\nghi", r)}`,
            ),
          );

          const places = new Set(Arr.map(full, (r) => `${r.file}:${r.line}`));
          expect(staticLines(full)).toHaveLength(places.size);
        },
      ),
      options,
    );
  });
});

describe("survivors, which mutants a Survivor: line answers", () => {
  const words = (min: number) =>
    fc.array(fc.stringMatching(/^[a-z]{1,8}$/), { minLength: min, maxLength: 5 }).map((parts) => Arr.join(parts, " "));

  // The three proofs (ticket 1309): a plant run with its result, a search with what it found, a law's id. Prose may come before one.
  const proof = fc.oneof(
    fc.tuple(words(1), words(1)).map(([command, result]) => `plant: ${command} => ${result}`),
    fc.tuple(words(1), words(1)).map(([search, found]) => `rg: ${search} => ${found}`),
    fc.stringMatching(/^[A-Z][A-Za-z]{0,3}[0-9]{1,2}$/).map((id) => `law: ${id}`),
  );

  const evidence = fc
    .tuple(fc.option(words(1), { nil: null }), proof)
    .map(([prose, p]) => (prose === null ? p : `${prose} ${p}`));

  const answer = fc.record({
    file: anyFile,
    line: fc.option(fc.integer({ min: 1, max: 400 }), { nil: null }),
    reason: words(1),
    evidence,
  });

  const row = (a: { file: string; line: number | null; reason: string; evidence: string }) =>
    `Survivor: ${a.file}:${a.line ?? "*"} ${a.reason} -- ${a.evidence}`;

  // A line that gives no answer: a missing reason, no ` -- `, no evidence, one bare word of it, words that name no proof, or a proof marker
  // without its result or its id.
  const unsound = fc
    .tuple(
      answer,
      fc.constantFrom(
        "no reason",
        "no dashes",
        "no evidence",
        "one word",
        "prose only",
        "plant without result",
        "rg without result",
        "plant without command",
        "rg without command",
        "law without id",
        "no colon",
      ),
      words(2),
    )
    .map(([a, flaw, prose]) => {
      const at = `Survivor: ${a.file}:${a.line ?? "*"}`;

      switch (flaw) {
        case "no reason":
          return `${at} -- ${a.evidence}`;
        case "no dashes":
          return `${at} ${a.reason} ${a.evidence}`;
        case "no evidence":
          return `${at} ${a.reason} -- `;
        case "one word":
          return `${at} ${a.reason} -- unreachable`;
        case "prose only":
          return `${at} ${a.reason} -- ${prose}`;
        case "plant without result":
          return `${at} ${a.reason} -- plant: ${prose}`;
        case "rg without result":
          return `${at} ${a.reason} -- rg: ${prose} =>`;
        case "plant without command":
          return `${at} ${a.reason} -- plant: => ${prose} => ${prose}`;
        case "rg without command":
          return `${at} ${a.reason} -- rg:=> ${prose} => ${prose}`;
        case "law without id":
          return `${at} ${a.reason} -- law: ${prose}`;
        default:
          return `${at} ${a.reason} -- plant ${prose} => green`;
      }
    });

  const noise = fc.constantFrom(
    "",
    "Plant: a: b: c",
    "tests: add a law",
    "survivor: lower case",
    "  Survivor: indented a.ts:1 r -- plant: e => f",
  );

  /** Rows with a place of their own each (the index in front of the file), so no row stands down for another. */
  const distinct = (rows: ReadonlyArray<string>) =>
    Arr.map(rows, (text, i) => text.replace(/^Survivor: /, `Survivor: ${i}/`));

  // Plants: accept a line with no evidence; accept one bare word of evidence; accept evidence that names no proof; read `*` as a number; match a
  // line by file only; let a file's own `*` answer a different file.
  it("a Survivor: line with a reason and a plant, search or law answers its mutant, and nothing else does", () => {
    fc.assert(
      fc.property(
        fc.array(fc.tuple(answer, fc.array(fc.oneof(unsound, noise), { maxLength: 3 })), { maxLength: 6 }),
        fc.nat(),
        (rows, pick) => {
          const entries = Arr.flatMap(rows, ([a, other]) => [
            ...Arr.map(other, (text) => ({ text, a: null })),
            { text: row(a), a },
          ]);

          const text = Arr.join(distinct(Arr.map(entries, (e) => e.text)), "\n");

          const want = Arr.flatMap(entries, (e, i) =>
            e.a === null ? [] : [{ file: `${i}/${e.a.file}`, line: e.a.line }],
          );

          const got = answersIn(text);
          expect(got).toEqual(want);

          for (const a of want) {
            // A file's own line is answered, and a `*` answers any line of its file and the file no law loads.
            expect(isAnswered(got, a.file, a.line ?? pick)).toBe(true);
            expect(isAnswered(got, a.file, null)).toBe(Arr.some(got, (g) => g.file === a.file && g.line === null));
          }

          expect(isAnswered(got, "nowhere/else.ts", pick)).toBe(false);
          expect(isAnswered(got, "nowhere/else.ts", null)).toBe(false);

          const lines = Arr.filter(got, (g) => g.line !== null);

          for (const g of lines) {
            expect(isAnswered(got, g.file, 1000)).toBe(Arr.some(got, (h) => h.file === g.file && h.line === null));
          }
        },
      ),
      options,
    );
  });

  // Plants: let the oldest row of a place win; let any row with a proof win; keep every row of a place; let a newer row with no proof leave an older proof standing;
  // treat `file:*` and `file:12` as one place.
  it("the newest row of a place wins: an older row with no proof stands down for a newer one with it, and a newer one with none takes the answer away", () => {
    fc.assert(
      fc.property(
        answer,
        fc.array(fc.boolean(), { minLength: 1, maxLength: 5 }),
        fc.array(fc.oneof(unsound, noise), { maxLength: 3 }),
        (a, proven, other) => {
          const here = (ok: boolean, i: number) =>
            ok ? row({ ...a, reason: `r${i}` }) : `Survivor: ${a.file}:${a.line ?? "*"} r${i} -- unreachable`;

          const mine = Arr.map(proven, here);

          const elsewhere = Arr.map(distinct(other), (text) =>
            text.replace(/^Survivor: (\d+)\//, "Survivor: elsewhere$1/"),
          );

          const text = Arr.join([...elsewhere, ...mine], "\n");
          const last = proven.at(-1) === true;

          expect(Arr.filter(answersIn(text), (x) => x.file === a.file && x.line === a.line)).toEqual(
            last ? [{ file: a.file, line: a.line }] : [],
          );

          expect(Arr.filter(refusedIn(text), (r) => r.startsWith(`Survivor: ${a.file}:${a.line ?? "*"} `))).toEqual(
            last ? [] : [here(false, proven.length - 1)],
          );

          // Another place is its own: a `*` row does not stand in for a line row.
          const star = `Survivor: ${a.file}:* r -- unreachable`;
          const line = `Survivor: ${a.file}:7 r -- unreachable`;
          expect(refusedIn(`${star}\n${line}`)).toEqual([star, line]);
        },
      ),
      options,
    );
  });

  // Plants: read the log newest first (an older row without proof then wins); keep the empty piece after the last separator as a body.
  it("the commit bodies of git log are read oldest first, so a newer commit's proof clears an older commit's bare row", () => {
    const old = "Survivor: a/b.ts:3 r -- unreachable";
    const fresh = "Survivor: a/b.ts:3 r -- plant: sed -i s/x/y/ a/b.ts => still green";
    const log = `${fresh}\n\u0000${old}\n\u0000`;

    expect(answersIn(oldestFirst(log))).toEqual([{ file: "a/b.ts", line: 3 }]);
    expect(refusedIn(oldestFirst(log))).toEqual([]);

    // The other order: the proof is older and a newer commit says it with none.
    const back = `${old}\n\u0000${fresh}\n\u0000`;
    expect(answersIn(oldestFirst(back))).toEqual([]);
    expect(refusedIn(oldestFirst(back))).toEqual([old]);
    expect(oldestFirst("")).toBe("");
  });

  const place = (a: { file: string; line: number | null }) => `${a.file}:${a.line ?? "*"}`;

  const withdraw = (a: { file: string; line: number | null }, reason: string) =>
    `Survivor-withdrawn: ${place(a)} ${reason}`;

  // A withdrawal that says nothing sound: no reason (bare, or with trailing blanks), no place, or a place that is no `file:line`.
  const unsoundWithdrawal = fc
    .tuple(answer, fc.constantFrom("no reason", "blank reason", "no place", "no line"), words(2))
    .map(([a, flaw, prose]) => {
      switch (flaw) {
        case "no reason":
          return `Survivor-withdrawn: ${place(a)}`;
        case "blank reason":
          return `Survivor-withdrawn: ${place(a)}   `;
        case "no place":
          return `Survivor-withdrawn: ${prose}`;
        default:
          return `Survivor-withdrawn: ${a.file} ${prose}`;
      }
    });

  // Ticket 2320: a refused row, once in a branch's history, kept the gate at exit 1 and a builder had to answer old line numbers
  // again. Plants: let a withdrawn row keep its answer; keep its refusal; read the withdrawal oldest-wins (a row written after it is
  // then ignored); let a withdrawal before a row remove that row; list a well-formed withdrawal as a row that answers nothing.
  it("a withdrawn place no longer counts, answer or refusal, and a row written after the withdrawal counts again", () => {
    fc.assert(
      fc.property(answer, fc.boolean(), words(1), words(1), (a, proven, reason, note) => {
        const old = proven ? row(a) : `Survivor: ${place(a)} r -- unreachable`;
        const gone = `${old}\n${withdraw(a, note)}`;

        expect(answersIn(gone)).toEqual([]);
        expect(refusedIn(gone)).toEqual([]);
        expect(notAnswers(withdraw(a, note))).toEqual([]);

        // A newer row of the place stands again, with its own proof or its own refusal.
        const again = `${gone}\n${row({ ...a, reason })}`;
        expect(answersIn(again)).toEqual([{ file: a.file, line: a.line }]);
        expect(refusedIn(again)).toEqual([]);

        const bare = `${gone}\nSurvivor: ${place(a)} r -- unreachable`;
        expect(answersIn(bare)).toEqual([]);
        expect(refusedIn(bare)).toEqual([`Survivor: ${place(a)} r -- unreachable`]);

        // A withdrawal written before a row withdraws nothing: the row is newer.
        expect(answersIn(`${withdraw(a, note)}\n${row(a)}`)).toEqual([{ file: a.file, line: a.line }]);
      }),
      options,
    );
  });

  // Plants: withdraw every row of the file; read `file:*` and `file:12` as one place; withdraw the first row by place alone; withdraw
  // every row of the same line number in another file; drop the withdrawn place's neighbors.
  it("a withdrawal clears its own place only: another line, `file:*`, or another file keeps its answer and its refusal", () => {
    fc.assert(
      fc.property(answer, words(1), (a, note) => {
        const line = a.line ?? 7;
        const mine = { ...a, line };
        const star = { ...a, line: null };
        const bare = (at: string) => `Survivor: ${at} r -- unreachable`;

        const text = Arr.join(
          [
            row(mine),
            row(star),
            row({ ...a, line: line + 1 }),
            row({ ...a, file: `other/${a.file}`, line }),
            bare(`${a.file}:${line + 2}`),
            withdraw(mine, note),
          ],
          "\n",
        );

        expect(answersIn(text)).toEqual([
          { file: a.file, line: null },
          { file: a.file, line: line + 1 },
          { file: `other/${a.file}`, line },
        ]);

        expect(refusedIn(text)).toEqual([bare(`${a.file}:${line + 2}`)]);

        // The other way round: `file:*` withdrawn leaves the line rows.
        const starred = `${row(mine)}\n${row(star)}\n${withdraw(star, note)}`;
        expect(answersIn(starred)).toEqual([{ file: a.file, line }]);
      }),
      options,
    );
  });

  // Plants: let a withdrawal with no reason, no place or no line withdraw; leave it out of notAnswers; leave it out of refusedIn; drop its
  // place from the key so a newer proven row cannot clear it.
  it("a malformed withdrawal is refused like a malformed Survivor: line, and a newer row or a sound withdrawal of its place clears it", () => {
    fc.assert(
      fc.property(unsoundWithdrawal, answer, words(1), (bad, a, note) => {
        expect(notAnswers(bad)).toEqual([bad]);
        expect(refusedIn(bad)).toEqual([bad]);
        expect(answersIn(bad)).toEqual([]);

        // It withdraws nothing: an older place with a proof is not made open by a broken withdrawal elsewhere.
        const other = { ...a, file: `other/${a.file}` };
        expect(answersIn(`${row(other)}\n${bad}`)).toEqual([{ file: other.file, line: other.line }]);
        expect(refusedIn(`${row(other)}\n${bad}`)).toEqual([bad]);

        // A broken withdrawal that names its place is cleared by a newer row or a sound withdrawal of that place.
        const named = /^Survivor-withdrawn: (\S+:(?:\d+|\*))(?:[ \t]*)$/.exec(bad)?.[1];

        if (named !== undefined) {
          const [file = "", at = "*"] = [
            named.slice(0, named.lastIndexOf(":")),
            named.slice(named.lastIndexOf(":") + 1),
          ];

          const target = { file, line: at === "*" ? null : Number(at) };
          expect(refusedIn(`${bad}\n${withdraw(target, note)}`)).toEqual([]);
          expect(refusedIn(`${bad}\n${row({ ...target, reason: note, evidence: a.evidence })}`)).toEqual([]);
        }
      }),
      options,
    );
  });

  // A bare `Survivor: <file>:<line>` row (no reason, nothing after the place) still names its place, so the newest row of that place wins.
  // Plants: give a bare row no place (a later proven row then leaves its refusal standing for good); let an older proof outlive a newer bare row.
  it("a bare Survivor: row names its place: a later proven row clears its refusal, and a later bare row takes a proof away", () => {
    fc.assert(
      fc.property(answer, (a) => {
        const bare = `Survivor: ${place(a)}`;

        expect(refusedIn(bare)).toEqual([bare]);
        expect(refusedIn(`${bare}\n${row(a)}`)).toEqual([]);
        expect(answersIn(`${bare}\n${row(a)}`)).toEqual([{ file: a.file, line: a.line }]);

        expect(answersIn(`${row(a)}\n${bare}`)).toEqual([]);
        expect(refusedIn(`${row(a)}\n${bare}`)).toEqual([bare]);
      }),
      options,
    );
  });

  // The words a refused row prints name what that row lacks. Plants: print the proof words for a withdrawal; print the withdrawal words for a
  // Survivor: row; drop the way out (a withdrawal) from either.
  it("a refused row says what it lacks: a Survivor: row a proof, a withdrawal a place and a reason", () => {
    fc.assert(
      fc.property(answer, fc.boolean(), (a, withdrawal) => {
        const text = refusalNote(
          withdrawal ? `Survivor-withdrawn: ${place(a)}` : `Survivor: ${place(a)} r -- unreachable`,
        );

        expect(text).toContain("Survivor-withdrawn: <file>:<line> <reason>");

        if (withdrawal) {
          expect(text).toContain("needs a <file>:<line> and a reason");
          expect(text).not.toContain("plant:");
        } else {
          expect(text).toContain("names no plant:, rg: or law:");
        }
      }),
      options,
    );
  });

  // The three forms by example, as the build skill shows them. Plants: refuse one form; accept the same line with its marker, its result or its id cut.
  it("each of the three proofs answers, and the same line without its marker, result or id does not", () => {
    const at = "Survivor: kalfa/git/src/Ref.ts:12 the arm cannot run";

    const forms = [
      "plant: sed -i 's/true/false/' kalfa/git/src/Ref.ts && pnpm exec vitest run kalfa/git/src/Ref.test.ts => 12 passed, still green",
      'rg: rg -n "parseRef" kalfa --glob "*.ts" => one caller, kalfa/git/src/Repository.ts:40, which never passes a bare name',
      "law: R3 fails with the line planted",
    ];

    for (const form of forms) {
      expect(answersIn(`${at} -- ${form}`), form).toEqual([{ file: "kalfa/git/src/Ref.ts", line: 12 }]);
    }

    const cut = [
      "sed -i 's/true/false/' kalfa/git/src/Ref.ts and the laws stayed green",
      "plant: sed -i 's/true/false/' kalfa/git/src/Ref.ts",
      'rg: rg -n "parseRef" kalfa =>',
      "the laws never call it, rg found one caller",
      "law:  fails with the line planted",
      "law: three",
      "plant: => 12 passed => still green",
      "rg: => one caller => none reads it",
      "rg:=> one caller => none reads it",
    ];

    for (const form of cut) {
      expect(answersIn(`${at} -- ${form}`), form).toEqual([]);
    }
  });

  // Plants: list a row that answers; leave out a blank-free row that answers nothing; list a blank row; list rows by their first word alone.
  it("notAnswers lists the nonblank rows that answer nothing, in order", () => {
    fc.assert(
      fc.property(fc.array(fc.oneof(answer.map(row), unsound, noise), { maxLength: 8 }), (rows) => {
        expect(notAnswers(Arr.join(rows, "\n"))).toEqual(
          Arr.filter(rows, (r) => r.trim() !== "" && answersIn(r).length === 0),
        );
      }),
      options,
    );
  });

  // Plants: list a Survivor: row that answers; leave out one that answers nothing; list a row that is no Survivor: row; list the rows out of order.
  it("refusedIn lists the Survivor: rows that answer nothing, in order, and no other row", () => {
    fc.assert(
      fc.property(fc.array(fc.oneof(answer.map(row), unsound, noise), { maxLength: 8 }), (all) => {
        const rows = distinct(all);

        expect(refusedIn(Arr.join(rows, "\n"))).toEqual(
          Arr.filter(rows, (r) => r.startsWith("Survivor:") && answersIn(r).length === 0),
        );
      }),
      options,
    );
  });

  // Plants: let a text of no Survivor: line answer anything; take a line without its evidence or its proof.
  it("lines that carry no proof, or no reason, answer nothing", () => {
    fc.assert(
      fc.property(fc.array(fc.oneof(unsound, noise), { maxLength: 8 }), (rows) => {
        expect(answersIn(Arr.join(distinct(rows), "\n"))).toEqual([]);
      }),
      options,
    );
  });
});

describe("survivors, the exit code and the answers file", () => {
  // Zero is as likely as any count, so the case with nothing left to answer is always reached.
  const count = fc.oneof(fc.constant(0), fc.nat({ max: 20 }));

  // Plants: always 0; always 1; count only the mutants that lived and not the files no law loads (or the reverse); leave a refused line out.
  it("the exit code is 1 while any mutant or any unloaded file has no answer or a Survivor: line was refused, and 0 otherwise", () => {
    fc.assert(
      fc.property(count, count, count, (open, unloaded, refused) => {
        expect(exitCode(open, unloaded, refused)).toBe(open === 0 && unloaded === 0 && refused === 0 ? 0 : 1);
        expect(exitCode(open, unloaded)).toBe(open === 0 && unloaded === 0 ? 0 : 1);
      }),
      options,
    );
  });

  const disk = (files: Readonly<Record<string, string>>) =>
    Layer.mergeAll(
      Path.layer,
      FileSystem.layerNoop({
        readFileString: (path) =>
          path in files
            ? Effect.succeed(files[path] ?? "")
            : Effect.fail(
                PlatformError.systemError({
                  _tag: "NotFound",
                  module: "FileSystem",
                  method: "readFileString",
                  pathOrDescriptor: path,
                }),
              ),
      }),
    );

  // Plants: let a read that failed give no answers; name the wrong file in the refusal; read a different file.
  effect.effect.prop(
    "--answers reads the Survivor: lines of its file, and a file that cannot be read is a refusal naming it",
    {
      dir: Schema.String.check(Schema.isPattern(/^[a-z]{1,8}$/)),
      name: Schema.String.check(Schema.isPattern(/^[a-z]{1,8}$/)),
      lines: Schema.Array(
        Schema.Literals([
          "Survivor: a/b.ts:3 log text -- rg: rg -n message a => the line only words a message and no reader branches on it",
          "Survivor: a/b.ts:* thin glue -- law: G1 pins what the glue forwards",
          "Survivor: a/b.ts:4 log text -- the line only words a message and no input changes what runs",
          "Plant: a law: a break: red",
        ]),
      ),
    },
    ({ dir, name, lines }) =>
      Effect.gen(function* () {
        const file = `/${dir}/${name}.txt`;
        const text = Arr.join(lines, "\n");

        expect(yield* readAnswers(file).pipe(Effect.provide(disk({ [file]: text })))).toEqual(answersIn(text));

        const refused = yield* readAnswers(file).pipe(Effect.flip, Effect.provide(disk({})));

        expect(refused._tag).toBe("Refused");
        expect(refused.detail).toContain(file);
      }),
    { arbitrary: { seed: options.seed, runs: options.numRuns } },
  );
});

describe("survivors, the run depth it hands the box", () => {
  // Ticket 1306. Plants: pass `--runs full`; pass no flag for a number; pass the number under another flag.
  it("a depth is mutbox's --runs flag, and full is no flag, so the box leaves each law its own count", () => {
    fc.assert(
      fc.property(fc.integer({ min: 1, max: 5000 }), (n) => {
        expect(runsFlag(n)).toEqual(["--runs", String(n)]);
      }),
      options,
    );
    expect(runsFlag("full")).toEqual([]);
  });

  // Plants: print a recheck when none ran; leave out how many died, or how many lived, at full depth.
  it("the last line gives the counts at both depths: none when no recheck ran, else how many died and how many lived at full depth", () => {
    expect(recheckText(null, 25)).toBe("");

    const text = recheckText({ asked: 5, cleared: [], confirmed: 2, unreached: 1 }, 25);
    expect(text).toContain("0 of the 5 that lived at 25 cases died there");
    expect(text).toContain("2 lived there too (1 not reached)");
    expect(recheckText({ asked: 1, cleared: [], confirmed: 1, unreached: 0 }, 25)).not.toContain("not reached");
  });

  // Plants: print the count when none is a type error; leave the count out; count a status other than CompileError.
  it("the last line says how many mutants do not type-check and count as kills, and nothing when none does", () => {
    expect(typedText({ Killed: 9, Survived: 2 })).toBe("");
    expect(typedText({ CompileError: 0 })).toBe("");

    const text = typedText({ Killed: 9, CompileError: 4 });
    expect(text).toContain("4 mutants do not type-check");
    expect(text).toContain("count as kills");
  });
});

describe("survivors, a saved run", () => {
  const key = (files: ReadonlyArray<string>) =>
    Saved.key({ base: "b0", tree: "t0", files, version: "v0", seconds: 300, runs: 10 });

  /** The wait for a turn with nobody in line: the box is free, and a box taken in that moment is not looked for. */
  const direct = <E, R>(turn: { readonly use: Effect.Effect<Option.Option<Run>, E, R> }) =>
    Effect.flatMap(turn.use, (got) => (Option.isSome(got) ? Effect.succeed(got.value) : Effect.die("busy")));

  // Plants: skip the look at the saved runs (a hit starts a box); leave the files out of the key (a
  // changed file hits); never save the box's answer (a second call starts a box).
  effect.effect.prop(
    "a call with a key already saved starts no box, and a call with a changed file starts one",
    {
      calls: Schema.Array(Schema.Array(File).check(Schema.isMaxLength(3))).check(
        Schema.isMinLength(1),
        Schema.isMaxLength(8),
      ),
    },
    ({ calls }) =>
      Effect.gen(function* () {
        const disk = memory();
        let started = 0;

        for (const files of calls) {
          const before = started;

          const got = yield* judge({
            dir: "/gate",
            key: key(files),
            days: 7,
            answers: Effect.succeed([]),
            start: Effect.sync(() => {
              started += 1;

              return Option.some(answer("done", [], 1));
            }),
            line: direct,
          }).pipe(Effect.provide(disk.layer));

          const seen = calls.slice(0, calls.indexOf(files)).some((earlier) => key(earlier) === key(files));
          expect(started - before, "a box starts for a key not seen before, and for no other").toBe(seen ? 0 : 1);
          expect(got.reused).toBe(seen);
        }

        expect(started).toBe(new Set(calls.map(key)).size);
      }),
    { arbitrary: { seed: options.seed, runs: options.numRuns } },
  );

  const body = (rows: ReadonlyArray<typeof Row.Type>) =>
    Arr.join(
      Arr.map(
        rows,
        (row) => `Survivor: ${row.file}:${row.line} a log line -- plant: sed -n 1p ${row.file} => no law fails`,
      ),
      "\n",
    );

  // Plants: on a hit, read no answers (every survivor is open again); on a hit, use the answers of the
  // run that made the saved result; read the answers before the lookup and not after it.
  effect.effect.prop(
    "on a saved run the Survivor: lines are read again from the commit bodies as they are now",
    {
      rows: Schema.Array(Row).check(Schema.isMinLength(1), Schema.isMaxLength(6)),
      mask: Schema.Array(Schema.Boolean),
    },
    ({ rows, mask }) =>
      Effect.gen(function* () {
        const disk = memory();
        let started = 0;
        let read = 0;
        const saved = answer("done", rows, 1);

        const call = (bodies: ReadonlyArray<typeof Row.Type>) =>
          judge({
            dir: "/gate",
            key: "k1",
            days: 7,
            answers: Effect.sync(() => {
              read += 1;

              return answersIn(body(bodies));
            }),
            start: Effect.sync(() => {
              started += 1;

              return Option.some(saved);
            }),
            line: direct,
          }).pipe(Effect.provide(disk.layer));

        const first = yield* call([]);
        expect(first.open, "no line answers anything").toEqual(rows);

        const written = rows.filter((_, i) => mask[i] === true);
        const second = yield* call(written);
        const answered = new Set(written.map((row) => `${row.file}:${row.line}`));

        expect(second.reused).toBe(true);
        expect(started, "the second call started no box").toBe(1);
        expect(read, "the lines were read on each call").toBe(2);
        expect(second.open).toEqual(rows.filter((row) => !answered.has(`${row.file}:${row.line}`)));
        expect(Option.isSome(yield* Saved.find("/gate", "k1").pipe(Effect.provide(disk.layer)))).toBe(true);
      }),
    { arbitrary: { seed: options.seed, runs: options.numRuns } },
  );

  // Plants: leave the withdrawn answer in force (the mutant stays answered); open every mutant when any place is withdrawn; open a mutant
  // of another place; leave the exit code at 0 with a mutant open.
  effect.effect.prop(
    "a withdrawn answer opens its mutant again, and the gate still exits 1 for any mutant that lived with no live answer",
    {
      rows: Schema.Array(Row).check(Schema.isMinLength(1), Schema.isMaxLength(6)),
      mask: Schema.Array(Schema.Boolean),
    },
    ({ rows, mask }) =>
      Effect.gen(function* () {
        const withdrawn = rows.filter((_, i) => mask[i] === true);
        const gone = new Set(withdrawn.map((row) => `${row.file}:${row.line}`));

        const text = Arr.join(
          [body(rows), ...Arr.map(withdrawn, (row) => `Survivor-withdrawn: ${row.file}:${row.line} the code moved`)],
          "\n",
        );

        const got = yield* judge({
          dir: "/gate",
          key: "k3",
          days: 7,
          answers: Effect.succeed(answersIn(text)),
          start: Effect.succeed(Option.some(answer("done", rows, 1))),
          line: direct,
        }).pipe(Effect.provide(memory().layer));

        expect(got.open).toEqual(rows.filter((row) => gone.has(`${row.file}:${row.line}`)));
        expect(refusedIn(text)).toEqual([]);
        expect(exitCode(got.open.length, 0, refusedIn(text).length)).toBe(gone.size === 0 ? 0 : 1);
      }),
    { arbitrary: { seed: options.seed, runs: options.numRuns } },
  );

  // Plants: save after the place in line is given up (a run waiting for the same key takes the box and
  // starts a second one); save a run when the box was busy (nothing to save).
  effect.effect.prop(
    "the answer is saved before the place in line is given up, and a busy box saves nothing",
    { rows: Schema.Array(Row).check(Schema.isMaxLength(3)), busy: Schema.Boolean },
    ({ rows, busy }) =>
      Effect.gen(function* () {
        const events: Array<string> = [];

        const disk = memory((path) => {
          if (path.endsWith(".json")) {
            events.push("saved");
          }
        });

        yield* judge({
          dir: "/gate",
          key: "k2",
          days: 7,
          answers: Effect.succeed([]),
          start: Effect.sync(() => {
            events.push("started");

            return busy ? Option.none() : Option.some(answer("done", rows, 1));
          }),
          // The line of one run: its turn once, then the place given back.
          line: ({ use }) =>
            Effect.map(use, (got) => {
              events.push(Option.isSome(got) ? "released" : "busy");

              return Option.getOrElse(got, () => ({ summary: answer("done", [], 1), reused: false, savedAt: null }));
            }),
        }).pipe(Effect.provide(disk.layer));

        expect(events).toEqual(busy ? ["started", "busy"] : ["started", "saved", "released"]);
      }),
    { arbitrary: { seed: options.seed, runs: options.numRuns } },
  );
});
