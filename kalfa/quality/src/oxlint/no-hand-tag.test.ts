// Laws O6 and O7 of .kalfa/quests/kalfa-quality-oxlint-PLAN.md. O6: `no-hand-tag` refuses a hand-written `_tag` key, type
// member, class field and computed key (a literal, a template with no hole, a constant of the same file), passes a read, a
// maker, the schema tools and a computed key it cannot read, and skips exactly the files its `allow` option lists. O7: its
// options are taken in each good form, and oxlint fails the run on each bad one before any file is read: RuleTester runs
// the same check against `meta.schema` that oxlint runs on a config.
//
// Plants, each run once on no-hand-tag.ts and undone:
// - ignore the option: the listed file fires (O6);
// - compare the path's last part only: `other/ledger/Log.ts` stops firing (O6);
// - skip the file's constants: `{ [TAG]: x }` stops firing (O6);
// - drop `additionalProperties: false` from the schema: `{ alow: [...] }` is taken (O7);
// - drop the item pattern: `./x.ts` is taken (O7).
import { it } from "@effect/vitest";
import { Array as Arr } from "effect";
import * as fc from "fast-check";
import { expect } from "vitest";
import { noHandTag } from "./no-hand-tag.ts";
import { check, type Json, type Line } from "./Tester.test-support.ts";

/** Lines that write a `_tag` key, one report each. A computed one reads the constant `TAG` or `ALIAS` that the header holds. */
const FIRES: ReadonlyArray<string> = [
  'export const a = { _tag: "x" };',
  'export const a = { "_tag": "x" };',
  'export type A = { readonly _tag: "x" };',
  'export class A { readonly _tag = "c"; }',
  'export const a = Schema.Struct({ _tag: Schema.Literal("x") });',
  "export const a = (_tag: string) => ({ _tag });",
  // A computed key that writes the same name: a literal, a template with no hole, and a constant of the file.
  'export const a = { ["_tag"]: "y" };',
  'export const a = { [`_tag`]: "z" };',
  'export const a = { [TAG]: "x" };',
  "export type A = { readonly [TAG]: string };",
  'export class A { readonly [TAG] = "c"; }',
  'export const a = { [ALIAS]: "w" };',
  'export const a = { ["_tag" satisfies string]: "v" };',
  'export const a = { ["_tag"!]: "u" };',
];

/** Lines that write no `_tag`, or read one. None is reported. */
const PASSES: ReadonlyArray<string> = [
  'export const b = { type: "plus" };',
  'export const b = { "type": "plus" };',
  "export const b = { 1: 2 };",
  'export const b = value._tag === "x";',
  "export const { _tag } = value;",
  'export const b = Fault.cases.abort.make({ name: "counter:1" });',
  "export const b = Schema.TaggedUnion({ x: {}, abort: { name: Schema.String } });",
  'export const b = Schema.TaggedStruct("send", { m: Schema.Unknown });',
  // A computed key the rule cannot read, or one that is not `_tag`.
  "export const b = (key: string) => ({ [key]: 1 });",
  "export const b = { [Symbol.iterator]: 1 };",
  "export const b = { [KEY]: 1 };",
  "export const b = { [LET]: 1 };",
  `export const b = (suffix: string) => ({ [\`_tag\${suffix}\`]: 1 });`,
  'export const b = { ["type"]: 1 };',
];

const HEADER: ReadonlyArray<string> = [
  'const TAG = "_tag";',
  'const ALIAS = "_tag" as const;',
  'const KEY = "type";',
  'let LET = "_tag";',
];

const LISTED = "src/ledger/Log.ts";

/** Files that end like the listed one and are another file. */
const OTHERS: ReadonlyArray<string> = [
  "other/ledger/Log.ts",
  "src/Log.ts",
  "ledger/Log.ts",
  "src/ledger/Log.tsx",
  "src/ledger/log.ts",
  "src/ledger/Log.ts.ts",
];

/** Paths an option may hold: from where oxlint runs, with no leading `./` and no absolute path. */
const path = fc.stringMatching(/^[a-z][a-z0-9/.-]{0,20}$/);

const generated = fc.record({
  fire: fc.nat({ max: FIRES.length - 1 }),
  pass: fc.nat({ max: PASSES.length - 1 }),
  file: fc.oneof(fc.constant(LISTED), fc.constantFrom(...OTHERS)),
  more: fc.array(
    path.filter((value) => value !== LISTED),
    { maxLength: 3 },
  ),
});

it("O6 no-hand-tag keys: refuses each way of writing a `_tag` key, passes a read and a maker, and skips exactly the listed files", () => {
  fc.assert(
    fc.property(generated, ({ fire, pass, file, more }) => {
      const lines = (reports: number): ReadonlyArray<Line> => [
        ...Arr.map(HEADER, (text): Line => [text, 0]),
        [FIRES[fire]!, reports],
        [PASSES[pass]!, 0],
      ];

      // A listed file reports nothing, and every other file reports the key, however the list is filled.
      check("no-hand-tag", noHandTag, lines(file === LISTED ? 0 : 1), {
        filename: file,
        options: [{ allow: [LISTED, ...more] }],
      });
      // With no file listed, every file reports.
      check("no-hand-tag", noHandTag, lines(1), { filename: file });
    }),
    { seed: 119120, numRuns: 100 },
  );
});

/** The five option forms the schema takes, as the options a config gives after the severity. */
const GOOD: fc.Arbitrary<ReadonlyArray<Json> | undefined> = fc.oneof(
  fc.constant(undefined),
  fc.constant<Array<Json>>([]),
  fc.constant<Array<Json>>([{}]),
  fc.constant<Array<Json>>([{ allow: [] }]),
  fc.array(path, { maxLength: 4 }).map((allow) => [{ allow }]),
);

/** Option forms the schema refuses: `allow` that is not a list, an item that is not a string, an item starting with `./` or `/`, and an unknown key. */
const BAD: fc.Arbitrary<ReadonlyArray<Json>> = fc.oneof(
  fc.oneof(fc.string(), fc.integer(), fc.constant(null), fc.constant<Json>({})).map((allow) => [{ allow }]),
  fc.oneof(fc.integer(), fc.constant(null), fc.constant<Json>(["x"])).map((item) => [{ allow: [item] }]),
  fc.tuple(fc.constantFrom("./", "/"), path).map(([lead, rest]) => [{ allow: [`${lead}${rest}`] }]),
  fc
    .tuple(
      fc.stringMatching(/^[a-z]{1,8}$/).filter((key) => key !== "allow"),
      fc.array(path, { maxLength: 2 }),
    )
    .map(([key, value]) => [{ [key]: value }]),
  fc.oneof(fc.string(), fc.integer(), fc.constant(true)).map((option) => [option]),
);

it("O7 no-hand-tag options: takes no option, [], {}, an empty list and a list of paths, and fails the run on any other form", () => {
  fc.assert(
    fc.property(GOOD, BAD, (good, bad) => {
      const lines: ReadonlyArray<Line> = [["export const a = 1;", 0]];

      expect(() => check("no-hand-tag", noHandTag, lines, { options: good })).not.toThrow();
      expect(() => check("no-hand-tag", noHandTag, lines, { options: bad })).toThrow();
    }),
    { seed: 119120, numRuns: 100 },
  );
});
