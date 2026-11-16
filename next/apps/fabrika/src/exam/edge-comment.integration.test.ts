// `edge-comment` (Tier 1, P35; small-exam item 6): an ignore comment that names `fabrika/no-promises`
// or `fabrika/no-effect-run-outside-edge` is `// oxlint-disable-next-line <rule> -- edge: <why>`,
// names only those two rules, and gives a reason. Each wrong comment stands over a line that really
// fires, so only this rule speaks. And no line of `.oxlintrc.json` turns an edge rule off for a
// `next/` file that is not a test, so the list of edge files cannot come back through the config.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { Array as Arr, Option, Schema, pipe } from "effect";
import { parseSync } from "oxc-parser";
import { describe, expect, it } from "vitest";
import { plant } from "./plant.ts";

const CODE = "fabrika(edge-comment)";
const ROOT = join(import.meta.dirname, "..", "..", "..", "..", "..");

const PRELUDE = ['import {Effect} from "effect";', "declare const p: Promise<number>, thing: Effect.Effect<number>;"];

const PROMISE = "export const a = Effect.tryPromise(() => p);";
const RUN = "export const a = Effect.runPromise(thing);";
const BOTH = "export const a = Effect.runPromise(Effect.tryPromise(() => p));";

/** Each planted file: its comment and the line under it, and whether this rule must refuse it. */
const CASES: Readonly<Record<string, readonly [string, string, boolean]>> = {
  "promises-no-edge": ["// oxlint-disable-next-line fabrika/no-promises -- why", PROMISE, true],
  "runs-no-edge": ["// oxlint-disable-next-line fabrika/no-effect-run-outside-edge -- why", RUN, true],
  "edge-empty": ["// oxlint-disable-next-line fabrika/no-promises -- edge:", PROMISE, true],
  "edge-space": ["// oxlint-disable-next-line fabrika/no-promises -- edge: ", PROMISE, true],
  "edge-capital": ["// oxlint-disable-next-line fabrika/no-promises -- Edge: x", PROMISE, true],
  "whole-file": ["/* oxlint-disable fabrika/no-promises -- edge: x */", PROMISE, true],
  "this-line": ["", `${PROMISE} // oxlint-disable-line fabrika/no-promises -- edge: x`, true],
  "another-rule": [
    "// oxlint-disable-next-line fabrika/no-promises, fabrika/no-secret-env -- edge: x",
    'export const a = Effect.tryPromise(() => fetch(process.env.GITHUB_TOKEN ?? ""));',
    true,
  ],
  "promises-edge": [
    "// oxlint-disable-next-line fabrika/no-promises -- edge: a Durable Object answers a Promise",
    PROMISE,
    false,
  ],
  "runs-edge": [
    "// oxlint-disable-next-line fabrika/no-effect-run-outside-edge -- edge: the platform calls it",
    RUN,
    false,
  ],
  "both-edge": [
    "// oxlint-disable-next-line fabrika/no-promises, fabrika/no-effect-run-outside-edge -- edge: x",
    BOTH,
    false,
  ],
  "not-an-edge": [
    "// oxlint-disable-next-line fabrika/no-type-assertions -- the types need it here",
    "export const a = p as any;",
    false,
  ],
};

const at = (name: string) => `next/packages/libfabrika/src/data/${name}.ts`;
const UNUSED = at("unused");

describe("edge-comment", async () => {
  const all = await plant({
    ...Object.fromEntries(
      Arr.map(Object.entries(CASES), ([name, [comment, line]]) => [
        at(name),
        Arr.join([...PRELUDE, comment, line], "\n"),
      ]),
    ),
    [UNUSED]: Arr.join(
      [
        ...PRELUDE,
        "// oxlint-disable-next-line fabrika/no-promises -- edge: nothing fires below",
        "export const a = 1;",
      ],
      "\n",
    ),
  });

  it("refuses each wrong edge comment, at the top of the file", () => {
    const refused = Arr.filter(Object.entries(CASES), ([, [, , no]]) => no);
    expect(refused).toHaveLength(8);

    for (const [name] of refused) {
      expect([name, all(CODE, at(name))]).toEqual([name, [1]]);
    }
  });

  it("passes a right one for each rule and for both, and leaves other comments alone", () => {
    const passed = Arr.filter(Object.entries(CASES), ([, [, , no]]) => !no);
    expect(passed).toHaveLength(4);

    for (const [name] of passed) {
      expect([name, all(CODE, at(name))]).toEqual([name, []]);
    }
  });

  it("speaks alone: the line under each comment is silenced and no comment is unused", () => {
    for (const name of Object.keys(CASES)) {
      for (const code of [
        "fabrika(no-promises)",
        "fabrika(no-effect-run-outside-edge)",
        "fabrika(no-secret-env)",
        "fabrika(no-type-assertions)",
        "fabrika(no-bare-disable)",
        "",
      ]) {
        expect([name, code, all(code, at(name))]).toEqual([name, code, []]);
      }
    }
  });

  it("an edge comment over a line where nothing fires is unused, which fails", () => {
    expect(all("", UNUSED)).toEqual([3]);
    expect(all(CODE, UNUSED)).toEqual([]);
  });
});

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
    setting === "off" || setting === 0 || (Arr.isArray(setting) && off(setting[0]));

  it("turns the three rules on in next/**", () => {
    const next = Option.getOrUndefined(
      Arr.findFirst(config.overrides, (o) => o.files.length === 1 && o.files[0] === "next/**"),
    );

    for (const rule of RULES) {
      expect([rule, next?.rules[rule]]).toEqual([rule, "error"]);
    }
  });

  it("turns an edge rule off only for next/'s tests, and ignores no next/ path", () => {
    const loosened = Arr.filter(config.overrides, (o) => Arr.some(RULES, (rule) => off(o.rules[rule])));

    for (const o of loosened) {
      expect(Arr.filter(o.files, (f) => !TESTS.includes(f))).toEqual([]);
    }

    expect(Arr.filter(config.ignorePatterns, (p) => p.startsWith("next"))).toEqual([]);
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
  const mirror = (o: (typeof config.overrides)[number]): boolean =>
    Arr.every(o.files, agents) && !Arr.some(o.files, test);
  const LEVELS: Readonly<Record<string, string>> = { 0: "off", 1: "warn", 2: "error" };
  const level = (setting: unknown): string =>
    Arr.isArray(setting) ? level(setting[0]) : (LEVELS[String(setting)] ?? String(setting));

  it("pinned: the .agents/ override repeats the next/** rule block exactly (0033)", () => {
    const next = Arr.filter(config.overrides, (o) => o.files.length === 1 && o.files[0] === "next/**");
    const mirrors = pipe(
      config.overrides,
      Arr.filter(mirror),
      Arr.map((o) => [o.files, o.rules]),
    );

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
    const unmatched = pipe(
      config.overrides,
      Arr.filter((o) => Arr.some(o.files, agents) && !mirror(o)),
      Arr.flatMap((o) => {
        const tests = pipe(o.files, Arr.filter(agents), Arr.every(test));
        return pipe(
          Object.entries(o.rules),
          Arr.filter(
            ([rule, setting]) =>
              !Arr.some(
                config.overrides,
                (n) =>
                  Arr.some(n.files, (f) => f.startsWith("next/") && test(f) === tests) &&
                  rule in n.rules &&
                  level(n.rules[rule]) === level(setting),
              ),
          ),
          Arr.map(([rule, setting]) => [Arr.join(o.files, ", "), rule, level(setting)]),
        );
      }),
    );

    expect(unmatched).toEqual([]);
  });

  // 0033's binding rule, which the level match above does not hold alone: no override turns a rule
  // off for `.agents/`'s code, only for its tests. The mirror is held to `next/**` by its own law.
  it("pinned: no override turns a rule off for a non-test .agents/ path (0033)", () => {
    const offs = pipe(
      config.overrides,
      Arr.filter((o) => Arr.some(o.files, (f) => agents(f) && !test(f)) && !mirror(o)),
      Arr.flatMap((o) =>
        pipe(
          Object.entries(o.rules),
          Arr.filter(([, setting]) => off(setting)),
          Arr.map(([rule]) => [Arr.join(o.files, ", "), rule]),
        ),
      ),
    );

    expect(offs).toEqual([]);
  });
});
