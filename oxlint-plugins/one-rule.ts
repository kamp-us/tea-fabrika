// A config that holds one rule of the repo's own `.oxlintrc.json` and nothing else, for a law that reads one rule's fires. Under the whole config a
// run costs the other rules' work: over the tree's 800 to 950 files it took 16 s (in CI 45 s) and the one rule over the same files takes 0.3 s, and
// one planted file costs 0.35 s, 0.07 s of it with no JS plugin to load. The rule's blocks are the real config's own, in its own order (the base
// entry, then each override that names it, each cut to that one rule), so the rule meets each file as it does under `pnpm lint`.
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Array as Arr, Record as Rec, Schema } from "effect";
import { parseSync } from "oxc-parser";

const Config = Schema.Struct({
  rules: Schema.optional(Schema.Record(Schema.String, Schema.Unknown)),
  overrides: Schema.optional(
    Schema.Array(
      Schema.Struct({
        files: Schema.Array(Schema.String),
        excludeFiles: Schema.optional(Schema.Array(Schema.String)),
        rules: Schema.Record(Schema.String, Schema.Unknown),
      }),
    ),
  ),
});

const decode = Schema.decodeUnknownSync(Config);

type Node = Readonly<{
  type: string;
  value?: unknown;
  properties?: ReadonlyArray<Node & { key: Node & { name?: string }; value: Node }>;
  elements?: ReadonlyArray<Node>;
}>;

/** The value of a JSON-with-comments text, read as the object literal it is: oxc's parser takes the comments. */
const read = (text: string): unknown => {
  const parsed = parseSync("oxlintrc.ts", `export default ${text}`);
  const value = (node: Node): unknown =>
    node.type === "ObjectExpression"
      ? Object.fromEntries(
          (node.properties ?? []).map((property) => [property.key.value ?? property.key.name, value(property.value)]),
        )
      : node.type === "ArrayExpression"
        ? (node.elements ?? []).map(value)
        : node.value;

  return value((parsed.program.body[0] as unknown as { declaration: Node }).declaration);
};

/** One rule's blocks out of the config text (comments allowed): its base entry, if any, and each override that names it. */
export const ruleBlocks = (text: string, rule: string) => {
  const { rules = {}, overrides = [] } = decode(read(text));

  return {
    rules: Rec.has(rules, rule) ? { [rule]: rules[rule] } : {},
    overrides: Arr.flatMap(overrides, ({ files, excludeFiles, rules: named }) =>
      Rec.has(named, rule)
        ? [{ files, ...(excludeFiles === undefined ? {} : { excludeFiles }), rules: { [rule]: named[rule] } }]
        : [],
    ),
  };
};

/**
 * Writes the one-rule config for `rule` of the repo at `root` as the config names it (`fabrika/test-database`, a JS rule of the repo's own plugin, or a built-in
 * one, `eslint/no-restricted-properties`, given `js` false) in a folder of its own and answers its path. The globs are made full paths under `root`, and
 * the plugin is the repo's own `oxlint-plugins/index.ts`, so the file sits anywhere.
 */
export const oneRuleConfig = (root: string, rule: string, js = true): string => {
  const blocks = ruleBlocks(readFileSync(join(root, ".oxlintrc.json"), "utf8"), rule);
  const path = join(mkdtempSync(join(tmpdir(), "one-rule-")), "oxlintrc.json");

  writeFileSync(
    path,
    JSON.stringify({
      plugins: js ? [] : ["eslint"],
      jsPlugins: js ? [join(root, "oxlint-plugins/index.ts")] : [],
      rules: blocks.rules,
      overrides: Arr.map(blocks.overrides, (block) => ({
        ...block,
        files: Arr.map(block.files, (glob) => join(root, glob)),
        ...(block.excludeFiles === undefined
          ? {}
          : { excludeFiles: Arr.map(block.excludeFiles, (glob) => join(root, glob)) }),
      })),
    }),
  );

  return path;
};
