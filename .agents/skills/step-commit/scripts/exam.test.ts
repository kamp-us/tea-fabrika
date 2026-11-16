// S9 of docs/plan/quests/port-scripts-0113-PLAN.md: exam.py, ported to exam.ts. Lead tooling (0033),
// today's version. Written before the port, red until it lands.
//
// The shape these laws hold the port to:
// - `exam.ts` exports `exam`, the `effect/cli` command `exam <list> <path>...`: the list file's path,
//   then zero or more paths. It reads the list through Effect's `FileSystem` and decodes it with
//   `decodeExam`, and it asks `examMatcher` from next/apps/fabrika/src/exam/commits.ts, so the step
//   tools and CI's commits check have one matcher (the plan's Doubts). It has no glob reader of its
//   own.
// - For each path, in the order given, that is an exam path, it prints `path<TAB>glob` through
//   `Console`, once, with the first row of the list whose one-row matcher takes the path. A path
//   with a control character is an exam path by `examMatcher` (p85) and every one-row matcher takes
//   it, so it prints the list's first glob.
// - On any hit the command fails with a tagged error `Found` (as movecheck.ts's), which its
//   `import.meta.main` block maps to exit 1; with no hit it succeeds, exit 0.
//
// Each law runs the command in process, on a `FileSystem` stand-in that holds only the list file
// and on `TestConsole`: no process, no disk. exam.integration.test.ts runs exam.py and exam.ts as
// processes on the same rules until integrator 2's switch.
//
// Each law was planted once (the port changed to break it, the law seen red) and restored by copy;
// the plant is named beside it.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { NodeServices } from "@effect/platform-node";
import { runsFor } from "@kampus/vitest";
import { Effect, Exit, FileSystem, Layer, Option, PlatformError, Predicate } from "effect";
import { Command } from "effect/cli";
import { TestConsole } from "effect/testing";
import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { decodeExam, examMatcher } from "../../../../next/apps/fabrika/src/exam/commits.ts";
import { exam } from "./exam.ts";

const LIST = "exam-paths.json";
const REAL = readFileSync(join(import.meta.dirname, "../../../..", LIST), "utf8");

type Row = { readonly glob: string; readonly reason: string };

const decoded = (text: string): ReadonlyArray<Row> =>
  Option.getOrElse(decodeExam(text), (): ReadonlyArray<Row> => {
    throw new Error("the list did not decode");
  });

/** The lines exam.py prints for these paths, by commits.ts's matcher: the first row that takes each. */
const oracle = (rows: ReadonlyArray<Row>, paths: ReadonlyArray<string>) =>
  paths.flatMap((path) => {
    const row = rows.find((r) => examMatcher([r])(path));
    return row === undefined ? [] : [`${path}\t${row.glob}`];
  });

/** A disk that holds only the list file. */
const disk = (text: string) =>
  FileSystem.layerNoop({
    exists: (path) => Effect.succeed(path === LIST),
    readFileString: (path) =>
      path === LIST
        ? Effect.succeed(text)
        : Effect.fail(
            PlatformError.systemError({
              _tag: "NotFound",
              module: "FileSystem",
              method: "readFileString",
              description: "no such made-up file",
            }),
          ),
  });

/** One run of the command, in process: the exit code its main block gives, and what it printed. */
const runExam = (text: string, paths: ReadonlyArray<string>) =>
  Effect.gen(function* () {
    const exit = yield* Command.runWith(exam, { version: "0.0.0" })([LIST, ...paths]).pipe(Effect.exit);
    const out = (yield* TestConsole.logLines).map(String).join("\n");
    const error = Exit.findErrorOption(exit);
    const code = Exit.isSuccess(exit)
      ? 0
      : Option.isSome(error) && Predicate.isTagged(error.value, "Found")
        ? 1
        : `failed: ${String(Exit.isFailure(exit) ? exit.cause : "")}`;
    return { code, out };
  }).pipe(
    Effect.provide(Layer.mergeAll(disk(text), TestConsole.layer)),
    Effect.provide(NodeServices.layer),
    Effect.runSync,
  );

// A path piece: a folder or file name, which may start with a dot, never with a dash, so the command
// line never reads a path as a flag.
const seg = fc.stringMatching(/^[a-z0-9._][a-z0-9._-]{0,6}$/);
// What a `*` stands for: maybe nothing, maybe a dotfile's name.
const name = fc.oneof(fc.constant(""), seg);
const folders = (min: number) => fc.array(seg, { minLength: min, maxLength: 2 });

/** A glob's pieces, split where commits.ts splits them. */
const pieces = (glob: string) => glob.split(/(\*\*\/|\/\*\*$|\*\*|\*)/);

/** A path a glob takes: each wildcard filled, a `/**` sometimes with nothing, its folder alone. */
const fill = (glob: string) =>
  fc
    .tuple(
      ...pieces(glob).map((piece) =>
        piece === "**/"
          ? folders(0).map((fs) => fs.map((f) => `${f}/`).join(""))
          : piece === "/**"
            ? fc.oneof(
                fc.constant(""),
                folders(1).map((fs) => `/${fs.join("/")}`),
              )
            : piece === "**"
              ? folders(0).map((fs) => fs.join("/"))
              : piece === "*"
                ? name
                : fc.constant(piece),
      ),
    )
    .map((parts) => parts.join(""));

/** A path near one a glob takes: one more letter, a folder more, a letter less, or a slash in it. */
const near = (path: string) =>
  fc.oneof(
    seg.map((s) => `${path}${s}`),
    seg.map((s) => `${s}/${path}`),
    fc.constant(path.slice(0, -1)),
    fc.nat({ max: Math.max(0, path.length - 1) }).map((i) => `${path.slice(0, i)}/${path.slice(i)}`),
  );

/** A control character, which a path from git can hold and which never passes quietly (p85). */
const control = fc.oneof(fc.integer({ min: 0, max: 0x1f }), fc.constant(0x7f)).map((c) => String.fromCharCode(c));

const pathFor = (globs: ReadonlyArray<string>) => {
  const taken = fc.constantFrom(...globs).chain(fill);
  return fc
    .oneof(
      { weight: 4, arbitrary: taken },
      { weight: 3, arbitrary: taken.chain(near) },
      { weight: 1, arbitrary: folders(1).map((fs) => fs.join("/")) },
      {
        weight: 1,
        arbitrary: fc
          .tuple(taken, fc.nat(), control)
          .map(([p, i, c]) => `${p.slice(0, i % (p.length + 1))}${c}${p.slice(i % (p.length + 1))}`),
      },
    )
    .filter((p) => p !== "" && !p.startsWith("-"));
};

/** A case's paths: maybe none, maybe one twice. */
const pathsFor = (globs: ReadonlyArray<string>) =>
  fc
    .tuple(fc.array(pathFor(globs), { maxLength: 6 }), fc.boolean())
    .map(([ps, twice]) => (twice && ps.length > 0 ? [...ps, ps[0] ?? ""] : ps));

const hasControl = (path: string) => [...path].some((ch) => ch.charCodeAt(0) < 0x20 || ch.charCodeAt(0) === 0x7f);

/** The folder a `<folder>/**` row names, which commits.ts takes and exam.py did not (Findings). */
const stems = (rows: ReadonlyArray<Row>) =>
  new Set(rows.filter((r) => r.glob.endsWith("/**")).map((r) => r.glob.slice(0, -3)));

// A made-up glob: pieces of names, `*` and `**`, joined by slashes, so `**/`, `/**` and `a**b` all
// come up.
const globPiece = fc
  .array(fc.oneof({ weight: 3, arbitrary: seg }, fc.constant("*"), fc.constant("**")), {
    minLength: 1,
    maxLength: 3,
  })
  .map((ps) => ps.join(""));

const glob = fc.array(globPiece, { minLength: 1, maxLength: 4 }).map((ps) => ps.join("/"));
const list = fc.array(glob, { minLength: 1, maxLength: 5 });

describe("exam.ts", () => {
  // Plant, run once: the command succeeded on a hit (exit 0). Red: a case with an exam path
  // exited 0.
  it("property: exam.ts prints path<TAB>glob for each exam path and exits 1 on any hit, 0 on none", () => {
    const rows = decoded(REAL);
    const globs = rows.map((r) => r.glob);
    const ownFolders = stems(rows);
    const reached = new Set<string>();
    fc.assert(
      fc.property(pathsFor(globs), (paths) => {
        const want = oracle(rows, paths);
        const got = runExam(REAL, paths);
        expect(got.code).toBe(want.length > 0 ? 1 : 0);
        expect(got.out).toBe(want.join("\n"));

        reached.add(paths.length === 0 ? "no paths" : "");
        reached.add(want.length > 0 ? "exit 1" : "exit 0");
        reached.add(want.length > 0 && want.length < paths.length ? "a hit beside a miss" : "");
        reached.add(paths.some((p) => rows.filter((r) => examMatcher([r])(p)).length > 1) ? "two rows take it" : "");
        reached.add(paths.some((p) => ownFolders.has(p)) ? "a /** row's own folder" : "");
        reached.add(paths.some(hasControl) ? "a control character" : "");
        reached.add(paths.length > 1 && new Set(paths).size < paths.length ? "a path twice" : "");
      }),
      { seed: 119120, numRuns: runsFor({ fast: 100, full: 100 }) },
    );
    expect([...reached].filter((r) => r !== "").toSorted()).toEqual(
      [
        "a /** row's own folder",
        "a control character",
        "a hit beside a miss",
        "a path twice",
        "exit 0",
        "exit 1",
        "no paths",
        "two rows take it",
      ].toSorted(),
    );
  });

  // Plant, run once: exam.ts turned each `**/` of a glob into `*/` before it asked the matcher.
  // Red: `**/x` no longer took a path `x` at the top.
  it("property: exam.ts agrees with commits.ts's matcher on every generated path", () => {
    const reached = new Set<string>();
    fc.assert(
      fc.property(
        list.chain((globs) => fc.tuple(fc.constant(globs), pathsFor(globs))),
        ([globs, paths]) => {
          const rows = globs.map((g) => ({ glob: g, reason: "made up" }));
          // The list file as the repo writes it: its rows keep the root config's own key spelling.
          const text = `[${rows.map((r) => `{"glob":${JSON.stringify(r.glob)},"why":${JSON.stringify(r.reason)}}`).join(",")}]`;
          const isExam = examMatcher(decoded(text));
          const got = runExam(text, paths);
          expect(got.code).toBe(paths.some(isExam) ? 1 : 0);
          expect(got.out).toBe(oracle(rows, paths).join("\n"));

          for (const p of paths) {
            reached.add(isExam(p) ? "a hit" : "a miss");
            reached.add(hasControl(p) ? "a control character" : "");
            reached.add(stems(rows).has(p) ? "a /** glob's own folder" : "");
            reached.add(
              rows.some((r) => examMatcher([r])(p) && !examMatcher([{ ...r, glob: r.glob.replaceAll("**/", "*/") }])(p))
                ? "a **/ across no folder"
                : "",
            );
            reached.add(
              !isExam(p) && rows.some((r) => examMatcher([{ ...r, glob: r.glob.replace(/(?<!\*)\*(?!\*)/g, "**") }])(p))
                ? "a * that stops at a slash"
                : "",
            );
          }
        },
      ),
      { seed: 119120, numRuns: runsFor({ fast: 200, full: 200 }) },
    );
    expect([...reached].filter((r) => r !== "").toSorted()).toEqual(
      [
        "a * that stops at a slash",
        "a **/ across no folder",
        "a /** glob's own folder",
        "a control character",
        "a hit",
        "a miss",
      ].toSorted(),
    );
  });
});
