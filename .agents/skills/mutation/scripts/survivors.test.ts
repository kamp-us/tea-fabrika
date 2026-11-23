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
  parentEntries,
  pick,
  readAnswers,
  reach,
  resolve,
  staticLines,
  survivorLines,
  testsIn,
} from "./survivors.ts";

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

  const answer = fc.record({
    file: anyFile,
    line: fc.option(fc.integer({ min: 1, max: 400 }), { nil: null }),
    reason: words(1),
    evidence: words(2),
  });

  const row = (a: { file: string; line: number | null; reason: string; evidence: string }) =>
    `Survivor: ${a.file}:${a.line ?? "*"} ${a.reason} -- ${a.evidence}`;

  // A line that gives no answer: a missing reason, no ` -- `, no evidence, or one bare word of it.
  const unsound = fc
    .tuple(answer, fc.constantFrom("no reason", "no dashes", "no evidence", "one word"))
    .map(([a, flaw]) =>
      flaw === "no reason"
        ? `Survivor: ${a.file}:${a.line ?? "*"} -- ${a.evidence}`
        : flaw === "no dashes"
          ? `Survivor: ${a.file}:${a.line ?? "*"} ${a.reason} ${a.evidence}`
          : flaw === "no evidence"
            ? `Survivor: ${a.file}:${a.line ?? "*"} ${a.reason} -- `
            : `Survivor: ${a.file}:${a.line ?? "*"} ${a.reason} -- unreachable`,
    );

  const noise = fc.constantFrom(
    "",
    "Plant: a: b: c",
    "tests: add a law",
    "survivor: lower case",
    "  Survivor: indented a.ts:1 r -- e f",
  );

  // Plants: accept a line with no evidence; accept one bare word of evidence; read `*` as a number; match a
  // line by file only; let a file's own `*` answer a different file.
  it("a Survivor: line with a reason and evidence answers its mutant, and nothing else does", () => {
    fc.assert(
      fc.property(
        fc.array(fc.tuple(answer, fc.array(fc.oneof(unsound, noise), { maxLength: 3 })), { maxLength: 6 }),
        fc.nat(),
        (rows, pick) => {
          const text = Arr.join(
            Arr.flatMap(rows, ([a, other]) => [...other, row(a)]),
            "\n",
          );

          const got = answersIn(text);
          expect(got).toEqual(Arr.map(rows, ([a]) => ({ file: a.file, line: a.line })));

          for (const [a] of rows) {
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

  // Plants: let a text of no Survivor: line answer anything; take a line without its evidence.
  it("lines that carry no evidence, or no reason, answer nothing", () => {
    fc.assert(
      fc.property(fc.array(fc.oneof(unsound, noise), { maxLength: 8 }), (rows) => {
        expect(answersIn(Arr.join(rows, "\n"))).toEqual([]);
      }),
      options,
    );
  });
});

describe("survivors, the exit code and the answers file", () => {
  // Zero is as likely as any count, so the case with nothing left to answer is always reached.
  const count = fc.oneof(fc.constant(0), fc.nat({ max: 20 }));

  // Plants: always 0; always 1; count only the mutants that lived and not the files no law loads (or the reverse).
  it("the exit code is 1 while any mutant or any unloaded file has no answer, and 0 otherwise", () => {
    fc.assert(
      fc.property(count, count, (open, unloaded) => {
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
          "Survivor: a/b.ts:3 log text -- the line only words a message and no input changes what runs",
          "Survivor: a/b.ts:* thin glue -- no law loads it, and a call of it only forwards",
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

describe("survivors, a saved run", () => {
  const key = (files: ReadonlyArray<string>) =>
    Saved.key({ base: "b0", tree: "t0", files, version: "v0", seconds: 300 });

  const made =
    (box: () => void) => (): Effect.Effect<{ summary: ReturnType<typeof answer>; reused: false; savedAt: null }> =>
      Effect.sync(() => {
        box();

        return { summary: answer("done", [], 1), reused: false as const, savedAt: null };
      });

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
            answers: Effect.succeed([]),
            box: made(() => void (started += 1)),
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
      Arr.map(rows, (row) => `Survivor: ${row.file}:${row.line} a log line -- no input changes what runs here`),
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
            answers: Effect.sync(() => {
              read += 1;

              return answersIn(body(bodies));
            }),
            box: () =>
              Effect.sync(() => {
                started += 1;

                return { summary: saved, reused: false as const, savedAt: null };
              }),
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
});
