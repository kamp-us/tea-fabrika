// Both versions' tooling: the files a law reads as text, not by import, as its declaration names them
// (0591 point 2). A law on the package's `it` says `{ reads: ["next/packages/libfabrika/src/**"] }`
// beside its plant and label, globs from the top of the repo. Vitest picks `--changed`'s tests before
// any test runs, so the list is read from the source, never from a run's `meta`:
//
//   readsOf(path, code)   the globs every law in one test file declares, in source order
//   lawReads(root)        the Vite plugin that hands each tracked file a glob matches to Vitest as a
//                         watched file of the test, so `--changed` and `--related` follow it as an
//                         import, as vitest.config.ts's `githubReads` does for `.github/`
//
// A law is a call rooted at `it` or `test`, through members (`it.effect.prop`) and the calls that make
// a test (`it.each(rows)(...)`), as law-shape.ts and .github/ci/plant-check.ts read one. Its options
// are its last argument when that is an object written at the call and the call has three arguments
// or more, as plant-check takes them, so a property's inputs object is never read as options. A table
// law, `it.each(rows)(name, options, fn)` or `it.for`, has them in vitest's place, between the title
// and the body, so there its second argument is read when the last is not an object.
//
// One form is read: an array of string literals, written at the call, under the key `reads` in any
// spelling (`reads`, `"reads"`, `["reads"]`). Any other value (a name, a spread, a template, a call)
// throws, so the run fails and no declared read is missed in silence. A file that does not parse
// throws too. An options object passed by name, or spread into the one written, is not read: the
// key must be at the call.
import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import { join, relative } from "node:path";
import {
  type CallExpression,
  type Expression,
  type ObjectExpression,
  parseSync,
  type PropertyKey,
  Visitor,
} from "oxc-parser";
import type { Plugin } from "vitest/config";

/** Calls that make a test from their own call: `it.each(rows)` is not a test, `it.each(rows)(...)` is. */
const MAKERS = new Set(["each", "for", "skipIf", "runIf"]);

/** A test file by name, as vitest.config.ts's projects include them. */
const TEST = /\.test\.[cm]?[jt]sx?$/;

/** Whether `callee` is rooted at `it` or `test`, through members and the calls that make a test. */
const isLaw = (callee: Expression): boolean => {
  if (callee.type === "Identifier") {
    return callee.name === "it" || callee.name === "test";
  }

  if (callee.type === "MemberExpression" && !callee.computed) {
    return isLaw(callee.object);
  }

  return (
    callee.type === "CallExpression" &&
    callee.callee.type === "MemberExpression" &&
    !callee.callee.computed &&
    callee.callee.property.type === "Identifier" &&
    MAKERS.has(callee.callee.property.name) &&
    isLaw(callee.callee.object)
  );
};

/** Calls whose returned law takes its options between the title and the body, as vitest's do. */
const TABLES = new Set(["each", "for"]);

/** Whether `callee` is a table's call, `it.each(rows)` or `it.for(rows)`. */
const isTable = (callee: Expression): boolean =>
  callee.type === "CallExpression" &&
  callee.callee.type === "MemberExpression" &&
  !callee.callee.computed &&
  callee.callee.property.type === "Identifier" &&
  TABLES.has(callee.callee.property.name);

/** A law call's options object, if one is written at the call. */
const optionsOf = (node: CallExpression): ObjectExpression | undefined => {
  if (node.arguments.length < 3 || !isLaw(node.callee)) {
    return undefined;
  }

  const last = node.arguments.at(-1);

  if (last?.type === "ObjectExpression") {
    return last;
  }

  const middle = node.arguments[1];
  return isTable(node.callee) && middle?.type === "ObjectExpression" ? middle : undefined;
};

/** A value without the parentheses and the `as const` or `satisfies` around it. */
const bare = (node: Expression): Expression =>
  node.type === "ParenthesizedExpression" || node.type === "TSAsExpression" || node.type === "TSSatisfiesExpression"
    ? bare(node.expression)
    : node;

/** Whether a property's key is `reads`, in any spelling. */
const keyIsReads = (key: PropertyKey, computed: boolean): boolean =>
  (!computed && key.type === "Identifier" && key.name === "reads") ||
  (key.type === "Literal" && key.value === "reads") ||
  (computed &&
    key.type === "TemplateLiteral" &&
    key.expressions.length === 0 &&
    key.quasis[0]?.value.cooked === "reads");

/** Where in the file, for a thrown message. */
const at = (path: string, code: string, start: number) => `${path}:${code.slice(0, start).split("\n").length}`;

/**
 * The globs every law in one test file declares under `reads`, in source order. Throws on a file
 * that does not parse and on a `reads` value that is not an array of string literals.
 */
export const readsOf = (path: string, code: string): ReadonlyArray<string> => {
  const parsed = parseSync(path, code, { sourceType: "module" });

  if (parsed.errors.length > 0) {
    throw new Error(`${path}: does not parse, so its declared reads cannot be read (0591)`);
  }

  const globs: Array<string> = [];
  new Visitor({
    CallExpression(node) {
      const options = optionsOf(node);

      if (options === undefined) {
        return;
      }

      for (const property of options.properties) {
        if (property.type !== "Property" || !keyIsReads(property.key, property.computed)) {
          continue;
        }

        const value = bare(property.value);
        const literal =
          value.type === "ArrayExpression" &&
          value.elements.every((element) => element?.type === "Literal" && typeof element.value === "string");

        if (!literal || property.shorthand) {
          throw new Error(
            `${at(path, code, property.start)}: a law's reads is an array of string literals written at the call, so Vitest can read it before the run (0591)`,
          );
        }

        for (const element of value.elements) {
          if (element?.type === "Literal" && typeof element.value === "string") {
            globs.push(element.value);
          }
        }
      }
    },
  }).visit(parsed.program);
  return globs;
};

// Use Vitest's installed matcher, including its dot-path behavior, as vitest.config.ts does.
const match = createRequire(import.meta.resolve("vitest/package.json"))("picomatch");

/**
 * The Vite plugin: each test file's declared reads, matched against the tracked files under `root`,
 * become that file's watched files. Only tracked files count, since a diff, and so `--changed`, only
 * ever names those. A file that does not hold the word `reads` is not parsed.
 */
export const lawReads = (root: string): Plugin => {
  let tracked: ReadonlyArray<string> | undefined;

  return {
    name: "fabrika-law-reads",
    transform(code, id) {
      const path = relative(root, id);

      if (!TEST.test(path) || path.startsWith("..") || !code.includes("reads")) {
        return null;
      }

      const globs = readsOf(path, code);

      if (globs.length === 0) {
        return null;
      }

      tracked ??= spawnSync("git", ["ls-files", "-z"], { cwd: root, encoding: "utf8" })
        .stdout.split("\0")
        .filter((file) => file !== "");

      for (const file of tracked) {
        if (globs.some((glob) => match.isMatch(file, glob, { dot: true }))) {
          this.addWatchFile(join(root, file));
        }
      }

      return null;
    },
  };
};
