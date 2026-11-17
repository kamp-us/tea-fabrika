// node-kinds.json names exports that code-graph treats as used (0524, ticket 933, L6). A made-up
// name would hide a dead export, so each name must be real: exported by a file its glob matches, and
// bound by that same string somewhere else in next/, as the platform binds a class by its name.
//
// The glob is package-relative, as in code-graph 0.15.0's `conventionMatcher`: "src/brain.ts" matches
// `src/brain.ts` inside the nearest folder with a package.json. Test files are left out, as code-graph
// and exam-paths.json class them.
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join, matchesGlob } from "node:path";
import { String as Str, pipe, Array as Arr, Record as Rec, Option, Schema } from "effect";

import { parseSync } from "oxc-parser";
import { describe, expect, it } from "vitest";

const ROOT = join(import.meta.dirname, "..", "..", "..", "..", "..");

const CODE = /\.[cm]?[jt]sx?$/;

const TEST = /(?:\.test\.tsx?|Test\.ts|\.test-support\.ts)$/;

const Kinds = Schema.fromJsonString(
  Schema.Struct({
    entryExportConventions: Schema.Record(
      Schema.String,
      Schema.Struct({ files: Schema.String, exports: Schema.Array(Schema.String) }),
    ),
  }),
);

/** A folder git never tracks here: installs, builds, run logs at the top, and dot folders. */
const untracked = (path: string, name: string) =>
  name === "node_modules" || name === "dist" || name.startsWith(".") || path === "runs";

/** The checkout's files, from the top, read in this process with no git, so the law is plain (0584). */
const walk = (dir: string): ReadonlyArray<string> =>
  Arr.flatMap(readdirSync(join(ROOT, dir), { withFileTypes: true }), (entry) => {
    const path = dir === "" ? entry.name : `${dir}/${entry.name}`;
    return entry.isDirectory() ? (untracked(path, entry.name) ? [] : walk(path)) : entry.isFile() ? [path] : [];
  });

const tracked = walk("");

const packages = pipe(
  tracked,
  Arr.filter((p) => pipe(p, Str.endsWith("package.json"))),
  Arr.map((p) => dirname(p)),
).sort((a, b) => b.length - a.length);

/** A path inside its nearest package, as code-graph matches a convention's glob against it. */
const inPackage = (path: string) => {
  const dir = Option.getOrElse(
    Arr.findFirst(packages, (d) => d === "." || pipe(path, Str.startsWith(`${d}/`))),
    () => ".",
  );
  return dir === "." ? path : pipe(path, Str.slice(dir.length + 1));
};

const sources = Arr.filter(tracked, (p) => pipe(p, Str.startsWith("next/")) && CODE.test(p) && !TEST.test(p));
const read = (path: string) => readFileSync(join(ROOT, path), "utf8");

/** A file's text with every comment blanked, so a name in a comment is no binding. */
const code = (path: string) => {
  const text = read(path);
  const { comments } = parseSync(path, text);
  return Arr.reduce(
    comments,
    text,
    (out, c) => pipe(out, Str.slice(0, c.start)) + pipe(" ", Str.repeat(c.end - c.start)) + pipe(out, Str.slice(c.end)),
  );
};

const exported = (path: string) =>
  Arr.flatMap(parseSync(path, read(path)).module.staticExports, (e) => Arr.map(e.entries, (x) => x.exportName.name));

/** What is wrong with one names file, as one line per problem; empty when every name is real. */
const problems = (text: string) => {
  const kinds = Schema.decodeSync(Kinds)(text);
  const found: string[] = [];

  for (const [name, { files, exports }] of Rec.toEntries(kinds.entryExportConventions)) {
    const homes = Arr.filter(tracked, (p) => CODE.test(p) && !TEST.test(p) && matchesGlob(inPackage(p), files));

    if (homes.length === 0) {
      found.push(`${name}: its glob ${files} matches no file`);
      continue;
    }

    const names = new Set(Arr.flatMap(homes, exported));
    const others = pipe(
      sources,
      Arr.filter((p) => !homes.includes(p)),
      Arr.map(code),
    );

    for (const binding of exports) {
      if (!names.has(binding)) {
        found.push(`${name}: ${binding} is not exported by ${Arr.join(homes, ", ")}`);
      }

      const literal = new RegExp(`(["'\`])${pipe(binding, Str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"))}\\1`);

      if (!Arr.some(others, (text) => literal.test(text))) {
        found.push(`${name}: ${binding} is bound by no string in next/ outside ${Arr.join(homes, ", ")}`);
      }
    }
  }

  return found;
};

describe("node-kinds.json (L6)", () => {
  it("L6 scenario: every name is exported by a file its glob matches and bound by that string elsewhere in next/", () => {
    // The real file and the tracked tree: on main, RecordPart and IsolateTail, both from src/brain.ts.
    const text = readFileSync(join(ROOT, "node-kinds.json"), "utf8");
    expect(Rec.keys(Schema.decodeSync(Kinds)(text).entryExportConventions)).not.toEqual([]);
    expect(problems(text)).toEqual([]);
  });
});
