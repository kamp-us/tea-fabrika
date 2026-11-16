// Effect's own checks that block in `next/` alone are lines of `tsconfig.base.json`, under the
// Effect plugin's `overrides` (ticket 910, law 13 of `docs/plan/effect-rules-small.md`). The type
// check is what refuses the code. This file holds only that the lines are there: a line lost in a
// merge of that shared file turns its check off, and nothing else says so.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { Array as Arr, pipe, Record as Rec } from "effect";
import * as Schema from "effect/Schema";
import { parseSync } from "oxc-parser";
import { describe, expect, it } from "vitest";

const ROOT = join(import.meta.dirname, "..", "..", "..", "..", "..");

const PLUGIN = "@effect/language-service";

const NEXT = ["next/**/*.ts", "next/**/*.tsx"];

const TESTS = ["next/**/*.test.ts", "next/**/*.test.tsx"];

/** Each check, and what its override leaves out of `next/`. */
const CHECKS: ReadonlyArray<readonly [check: string, exclude: ReadonlyArray<string>]> = [
  ["globalFetchInEffect", TESTS],
  ["globalDateInEffect", TESTS],
];

// `tsconfig.base.json` is JSON with comments, which a JavaScript parser reads as one object. An
// override may set no severity at all, as the checker's own schema allows (@effect/tsgo's
// `effectLanguageServicePluginOverrideOptionsDefinition` requires no field): the `.agents/**`
// override carries only `allowedDuplicatedPackages`. Such an override sets no check, so it cannot
// lower one either.
const Config = Schema.Struct({
  compilerOptions: Schema.Struct({
    plugins: Schema.Array(
      Schema.Struct({
        name: Schema.String,
        overrides: Schema.Array(
          Schema.Struct({
            include: Schema.Array(Schema.String),
            exclude: Schema.optional(Schema.Array(Schema.String)),
            options: Schema.Struct({
              diagnosticSeverity: Schema.optional(Schema.Record(Schema.String, Schema.String)),
            }),
          }),
        ),
      }),
    ),
  }),
});

// oxc-parser's tree, read loosely: only literals, arrays and objects are walked.
type Tree = any;

const toValue = (node: Tree): unknown => {
  if (node.type === "ObjectExpression") {
    return Rec.fromEntries(node.properties.map((p: Tree) => [p.key.value ?? p.key.name, toValue(p.value)]));
  }

  if (node.type === "ArrayExpression") {
    return node.elements.map(toValue);
  }

  if (node.type === "Literal") {
    return node.value;
  }

  throw new Error(`tsconfig.base.json holds a ${node.type}`);
};

describe("tsconfig.base.json", () => {
  const text = readFileSync(join(ROOT, "tsconfig.base.json"), "utf8");
  const tree: Tree = parseSync("tsconfig.ts", `export default ${text}`).program;
  const config = Schema.decodeUnknownSync(Config)(toValue(tree.body[0].declaration));
  const overrides = pipe(
    config.compilerOptions.plugins,
    Arr.filter((p) => p.name === PLUGIN),
    Arr.flatMap((p) => p.overrides),
  );

  // pinned: the config's own lines, since a check lost in a merge is silent: the type check passes
  // with it gone. Each check is set once, at `error`, for all of next/ less the paths named here.
  it("T910 pinned: Effect's checks for next/ are set at error under the plugin's next/ overrides", () => {
    for (const [check, exclude] of CHECKS) {
      const set = pipe(
        overrides,
        Arr.filter((o) => check in (o.options.diagnosticSeverity ?? {})),
        Arr.map((o) => ({
          severity: o.options.diagnosticSeverity?.[check],
          include: o.include,
          exclude: o.exclude ?? [],
        })),
      );

      expect([check, set]).toEqual([check, [{ severity: "error", include: NEXT, exclude }]]);
    }
  });
});
