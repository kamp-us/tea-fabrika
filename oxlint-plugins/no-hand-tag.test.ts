// `no-hand-tag` (exam item 5): no hand-written `_tag` in next/; a read and a schema tool pass. Its plants
// were the exam's (next/apps/fabrika/src/exam/no-hand-tag.integration.test.ts) until the exam-to-lint rule moved them here.
// Plant: skip a class field named `_tag` (the rule's `PropertyDefinition` visitor), and line 6 stops firing; read a computed key as never `_tag` (the
// `computed ||` of the rule's `check`), and every line of `computed` below stops firing; read a string-literal key as `_tag` whatever it says (the
// `key.value === TAG` of `isTag`), and `passes` fires; read a template with a hole as its first text (the `expressions.length === 0` of `written`), a
// `let` as a constant (the `kind !== "const"` of `constantsOf`), and `computedPasses` fires; stop reading through `satisfies` or `!`, and lines 11 and 12 of `computed` stop firing.

import { Array as Arr } from "effect";
import { describe, expect, it } from "vitest";
import { plant } from "./plant.ts";

const CODE = "fabrika(no-hand-tag)";

const FIRES = "next/packages/libfabrika/src/coordination/fires.ts";

const PASSES = "next/packages/libfabrika/src/coordination/passes.ts";

const COMPUTED = "kalfa/ledger/src/computed.ts";

const LOG = "next/packages/libfabrika/src/ledger/Log.ts";

const fires = Arr.join(
  [
    'import {Schema} from "effect";', // 1
    'export const a = {_tag: "x"};', // 2
    'export type X = {readonly _tag: "x"};', // 3
    'export const S = Schema.Struct({_tag: Schema.Literal("x")});', // 4
    'export const b = {"_tag": "y"};', // 5
    'export class C { readonly _tag = "c"; }', // 6
    "export const d = (_tag: string) => ({_tag});", // 7
  ],
  "\n",
);

// A computed key holds the same name when its constant does: `const TAG = "_tag"` and `{[TAG]: ...}` write a `_tag` as much as `{_tag: ...}` does.
const computed = Arr.join(
  [
    'import {Schema} from "effect";', // 1
    'const TAG = "_tag";', // 2
    'export const a = {[TAG]: "x"};', // 3
    "export type X = {readonly [TAG]: string};", // 4
    "export const S = Schema.Struct({[TAG]: Schema.String});", // 5
    'export class C { readonly [TAG] = "c"; }', // 6
    'export const b = {["_tag"]: "y"};', // 7
    'export const c = {[`_tag`]: "z"};', // 8
    'const ALIAS = "_tag" as const;', // 9
    'export const d = {[ALIAS]: "w"};', // 10
    'export const e = {["_tag" satisfies string]: "v"};', // 11
    'export const f = {["_tag"!]: "u"};', // 12
  ],
  "\n",
);

// A computed key that is not `_tag` passes: a constant of another name, a parameter, a symbol, a literal of another name.
const computedPasses = Arr.join(
  [
    'const KEY = "type";', // 1
    "export const a = {[KEY]: 1};", // 2
    "export const b = (key: string) => ({[key]: 1});", // 3
    "export const c = {[Symbol.iterator]: 1};", // 4
    'export const d = {["type"]: 1};', // 5
    'let LET = "_tag";', // 6
    "export const e = {[LET]: 1};", // 7
    `export const f = (suffix: string) => ({[\`_tag\${suffix}\`]: 1});`, // 8
  ],
  "\n",
);

const passes = Arr.join(
  [
    'import {Schema} from "effect";',
    "export const Fault = Schema.TaggedUnion({x: {}, abort: {name: Schema.String}});",
    'export const fault = Fault.cases.abort.make({name: "counter:1"});',
    "declare const value: typeof Fault.Type;",
    'export const a = value._tag === "x";',
    "export const {_tag} = value;",
    'export const b = {type: "plus"};',
    'export const c = {"type": "plus"};',
    'export const d = {1: "plus"};',
    'export const Send = Schema.TaggedStruct("send", {m: Schema.Unknown});',
  ],
  "\n",
);

const all = await plant({
  [FIRES]: fires,
  [PASSES]: passes,
  [COMPUTED]: computed,
  "kalfa/ledger/src/computedPasses.ts": computedPasses,
  [LOG]: fires,
  "next/packages/libfabrika/src/coordination/fires.test.ts": fires,
});

describe("no-hand-tag", () => {
  it("scenario: fires on a key, a type member and a class field named _tag", () => {
    expect(all(CODE, FIRES)).toEqual([2, 3, 4, 5, 6, 7]);
  });

  it("scenario: passes a read, the schema tools, a maker and tea's `type`", () => {
    expect(all(CODE, PASSES)).toEqual([]);
  });

  it("scenario: fires on a computed key that is `_tag`, written as a literal, a template or a constant", () => {
    expect(all(CODE, COMPUTED)).toEqual([3, 4, 5, 6, 7, 8, 10, 11, 12]);
  });

  it("scenario: passes a computed key that is not `_tag`", () => {
    expect(all(CODE, "kalfa/ledger/src/computedPasses.ts")).toEqual([]);
  });

  it("scenario: leaves the log, its one edge, and tests alone", () => {
    expect(all(CODE, LOG)).toEqual([]);
    expect(all(CODE, "next/packages/libfabrika/src/coordination/fires.test.ts")).toEqual([]);
  });
});
