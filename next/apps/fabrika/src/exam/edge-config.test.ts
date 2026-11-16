// `edge-comment` (Tier 1, P35; small-exam item 6), the config half: no line of `.oxlintrc.json` turns
// an edge rule off for a `next/` file that is not a test, so the list of edge files cannot come back
// through the config, and `.agents/` is held to next/'s rules (0033). The planted half, which spawns
// oxlint in a temp folder, is edge-comment.integration.test.ts.
//
// K11 (ticket 1073), pinned: today's break after pull requests 1369 and 1371, when the `.agents/`
// mirror law sat in an `.integration.` file and so never ran on the pull requests that broke it. This
// file reads `.oxlintrc.json` only, so it is plain and runs on every pull request and queue group
// (0584). Plant, run once and restored: these laws back in the `.integration.` file, and
// `vitest list --project next` no longer lists them.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { Schema } from "effect";
import { parseSync } from "oxc-parser";
import { describe, expect, it } from "vitest";

const ROOT = join(import.meta.dirname, "..", "..", "..", "..", "..");

// `.oxlintrc.json` is JSON with comments, which a JavaScript parser reads as one object.
const Config = Schema.Struct({
  ignorePatterns: Schema.Array(Schema.String),
  overrides: Schema.Array(
    Schema.Struct({
      files: Schema.Array(Schema.String),
      rules: Schema.Record(Schema.String, Schema.Unknown),
    }),
  ),
});

// oxc-parser's tree, read loosely: only literals, arrays and objects are walked.
type Tree = any;

const toValue = (node: Tree): unknown => {
  if (node.type === "ObjectExpression") {
    return Object.fromEntries(node.properties.map((p: Tree) => [p.key.value ?? p.key.name, toValue(p.value)]));
  }

  if (node.type === "ArrayExpression") {
    return node.elements.map(toValue);
  }

  if (node.type === "Literal") {
    return node.value;
  }

  throw new Error(`.oxlintrc.json holds a ${node.type}`);
};

describe(".oxlintrc.json", () => {
  const text = readFileSync(join(ROOT, ".oxlintrc.json"), "utf8");
  const tree: Tree = parseSync("oxlintrc.ts", `export default ${text}`).program;
  const config = Schema.decodeUnknownSync(Config)(toValue(tree.body[0].declaration));
  const RULES = ["fabrika/no-promises", "fabrika/no-effect-run-outside-edge", "fabrika/edge-comment"];
  const TESTS = ["next/**/*.test.ts", "next/**/*.test.tsx"];
  const off = (setting: unknown): boolean =>
    setting === "off" || setting === 0 || (Array.isArray(setting) && off(setting[0]));

  it("turns the three rules on in next/**", () => {
    const next = config.overrides.find((o) => o.files.length === 1 && o.files[0] === "next/**");

    for (const rule of RULES) {
      expect([rule, next?.rules[rule]]).toEqual([rule, "error"]);
    }
  });

  it("turns an edge rule off only for next/'s tests, and ignores no next/ path", () => {
    const loosened = config.overrides.filter((o) => RULES.some((rule) => off(o.rules[rule])));

    for (const o of loosened) {
      expect(o.files.filter((f) => !TESTS.includes(f))).toEqual([]);
    }

    expect(config.ignorePatterns.filter((p) => p.startsWith("next"))).toEqual([]);
  });

  // `.agents/` is held to next/'s rules (0033) by the three laws below. One override, the mirror,
  // repeats the `next/**` rule block for `.agents/`'s code, since the law above wants that override's
  // files to be exactly `next/**`. Two copies drift, so the copies must stay equal. Every other
  // override that names an `.agents/` path, such as one rule turned on for several folders at once,
  // must give `next/` the same level for each of its rules.
  //
  // The mirror is every override whose paths are all in `.agents/` and none is a test path.
  const agents = (path: string): boolean => path.startsWith(".agents/");
  const test = (path: string): boolean => /\.test\.|Test\.|\.test-support\./.test(path);
  const mirror = (o: (typeof config.overrides)[number]): boolean => o.files.every(agents) && !o.files.some(test);
  const LEVELS: Readonly<Record<string, string>> = { 0: "off", 1: "warn", 2: "error" };
  const level = (setting: unknown): string =>
    Array.isArray(setting) ? level(setting[0]) : (LEVELS[String(setting)] ?? String(setting));

  it("pinned: the .agents/ override repeats the next/** rule block exactly (0033)", () => {
    const next = config.overrides.filter((o) => o.files.length === 1 && o.files[0] === "next/**");
    const mirrors = config.overrides.filter(mirror).map((o) => [o.files, o.rules]);

    // One expect for the count, the files and the rules, so a failure shows all three at once.
    expect(next).toHaveLength(1);
    expect(mirrors).toEqual([[[".agents/**/*.ts", ".agents/**/*.mjs"], next[0]?.rules]]);
  });

  // Each rule of each other override that names an `.agents/` path is matched in `next/`: some
  // override, this one or another, names a `next/` path and sets that rule to the same level (off,
  // warn or error; options may differ, as an override replaces them). The `next/` path must be of the
  // same kind: a test path when the override's `.agents/` paths are all test paths, a non-test path
  // otherwise, so a rule turned off for next/'s tests never excuses `.agents/`'s code.
  it("pinned: every other override naming .agents/ gives next/ the same level for each rule (0033)", () => {
    const unmatched = config.overrides
      .filter((o) => o.files.some(agents) && !mirror(o))
      .flatMap((o) => {
        const tests = o.files.filter(agents).every(test);
        return Object.entries(o.rules)
          .filter(
            ([rule, setting]) =>
              !config.overrides.some(
                (n) =>
                  n.files.some((f) => f.startsWith("next/") && test(f) === tests) &&
                  rule in n.rules &&
                  level(n.rules[rule]) === level(setting),
              ),
          )
          .map(([rule, setting]) => [o.files.join(", "), rule, level(setting)]);
      });

    expect(unmatched).toEqual([]);
  });

  // 0033's binding rule, which the level match above does not hold alone: no override turns a rule
  // off for `.agents/`'s code, only for its tests. The mirror is held to `next/**` by its own law.
  it("pinned: no override turns a rule off for a non-test .agents/ path (0033)", () => {
    const offs = config.overrides
      .filter((o) => o.files.some((f) => agents(f) && !test(f)) && !mirror(o))
      .flatMap((o) =>
        Object.entries(o.rules)
          .filter(([, setting]) => off(setting))
          .map(([rule]) => [o.files.join(", "), rule]),
      );

    expect(offs).toEqual([]);
  });
});
