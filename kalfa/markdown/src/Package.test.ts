// Ticket 1926 P1 and P2, as ticket 1928 changes P1: what the package's own files say. Plants: P1, add `@kalfa/diagnostics` to the dependencies;
// P2, write a comment with the word `record` in Markdown.ts.
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { expect, it } from "@effect/vitest";
import { Schema } from "effect";

const root = join(import.meta.dirname, "..");

const Manifest = Schema.Struct({
  dependencies: Schema.Record(Schema.String, Schema.String),
  peerDependencies: Schema.Record(Schema.String, Schema.String),
  devDependencies: Schema.optionalKey(Schema.Record(Schema.String, Schema.String)),
  optionalDependencies: Schema.optionalKey(Schema.Record(Schema.String, Schema.String)),
  exports: Schema.Record(Schema.String, Schema.Unknown),
  publishConfig: Schema.Struct({ exports: Schema.Record(Schema.String, Schema.Unknown) }),
});

const manifest = Schema.decodeUnknownSync(Schema.fromJsonString(Manifest))(
  readFileSync(join(root, "package.json"), "utf8"),
);

// The package's files, as the tree shows them, less what a build or an install makes.
const files = readdirSync(root, { recursive: true, encoding: "utf8" })
  .filter((path) => !/(^|\/)(node_modules|dist)(\/|$)/u.test(path))
  .filter((path) => statSync(join(root, path)).isFile())
  .sort();

// A word this package must not hold is built from parts, so this file does not hold it either.
const part = (...pieces: ReadonlyArray<string>): string => pieces.join("");

it("scenario: P1 the manifest: the Markdown reader's four packages and yaml are the dependencies, effect the one peer, no sibling package, three exports", () => {
  expect(Object.keys(manifest.dependencies).sort()).toEqual([
    "@types/mdast",
    "mdast-util-from-markdown",
    "mdast-util-gfm",
    "micromark-extension-gfm",
    "yaml",
  ]);
  expect(Object.keys(manifest.peerDependencies)).toEqual(["effect"]);
  expect(Object.keys(manifest.exports).sort()).toEqual(["./Frontmatter", "./Markdown", "./package.json"]);

  for (const name of ["Frontmatter", "Markdown"]) {
    expect(manifest.publishConfig.exports[`./${name}`]).toEqual({
      types: `./dist/${name}.d.ts`,
      default: `./dist/${name}.js`,
    });
  }

  const named = [
    ...Object.keys(manifest.dependencies),
    ...Object.keys(manifest.peerDependencies),
    ...Object.keys(manifest.devDependencies ?? {}),
    ...Object.keys(manifest.optionalDependencies ?? {}),
  ];

  for (const scope of ["@kalfa/", part("@kamp", "us/")]) {
    expect(
      named.filter((name) => name.startsWith(scope)),
      `a dependency in ${scope}`,
    ).toEqual([]);
  }
});

it("scenario: P2 nothing of this repo: no file names it, and no source file holds a word that is Records' or a decision's", () => {
  expect(files).toContain("package.json");

  const names = [part("fabri", "ka"), part("kamp", "us"), part("kamp", "-us"), part(".kal", "fa/")];
  const words = /\b(?:record|records|kind|decision)\b/iu;

  for (const path of files) {
    const text = readFileSync(join(root, path), "utf8").toLowerCase();

    for (const name of names) {
      expect(text.includes(name), `${relative(root, join(root, path))} holds ${name}`).toBe(false);
    }

    if (path.startsWith("src/") && !/\.test(?:-support)?\.ts$/u.test(path)) {
      expect(words.test(text), `${path} holds a word that is not this package's`).toBe(false);
    }
  }
});
