// The React Compiler check (exam item 13, C1 and C5): every skip and purity finding fails, and the
// one way out is `"use no memo"` with a ledger row.
// These laws were the exam's (next/apps/fabrika/src/exam/compiler.test.ts) until 0591 moved them beside
// the check they read, which `pnpm lint:compiler` and the build share. Each view is a fixed input: the
// eight planted views of the exam, each a case of the check's findings. Plant: ignore `"use no memo"`
// with no row, and the no-row law fails.

import * as Arr from "effect/Array";
import { describe, expect, it } from "vitest";
import { check, type Row } from "./compiler.ts";

const at = (file: string, text: string, ledger: readonly Row[] = []) =>
  Arr.map(check(new Map([[file, text]]), ledger), (f) => `${f.fn}:${f.line} ${f.reason}`);

const CLEAN = Arr.join(
  [
    'import {useId} from "react";',
    "export const Tip = (props: {readonly text: string}) => {",
    "\tconst id = useId();",
    "\treturn <b id={id}>{props.text}</b>;",
    "};",
  ],
  "\n",
);

const REF_IN_RENDER = Arr.join(
  [
    'import {useRef} from "react";',
    "export const Tip = () => {",
    "\tconst r = useRef(1);",
    "\treturn <b>{r.current}</b>;",
    "};",
  ],
  "\n",
);

const NAMED = Arr.join(
  [
    'import {useRef} from "react";',
    "export const Tip = () => {",
    '\t"use no memo";',
    "\tconst r = useRef(1);",
    "\treturn <b>{r.current}</b>;",
    "};",
  ],
  "\n",
);

const ROW: Row = { file: "next/a.tsx", fn: "Tip", reason: "a planted row" };

describe("the compile step's check", () => {
  it("scenario: passes a view that compiles", () => {
    expect(at("next/a.tsx", CLEAN)).toEqual([]);
  });

  it("scenario: fails a skipped function, with its reason and line", () => {
    expect(at("next/a.tsx", REF_IN_RENDER)).toEqual(["Tip:4 Cannot access refs during render"]);
  });

  it('scenario: passes a function named with "use no memo" and a ledger row', () => {
    expect(at("next/a.tsx", NAMED, [ROW])).toEqual([]);
  });

  it('scenario: fails "use no memo" with no row', () => {
    expect(at("next/a.tsx", NAMED)).toEqual([
      expect.stringMatching(/^Tip:5 Cannot access refs/),
      expect.stringMatching(/^Tip:2 "use no memo" with no row/),
    ]);
  });

  it("scenario: fails a stale row: no directive now, or no file", () => {
    expect(at("next/a.tsx", CLEAN, [ROW])).toEqual([
      expect.stringMatching(/^Tip:0 a stale row in compiler-ledger.json: this function/),
    ]);
    expect(at("next/a.tsx", CLEAN, [{ ...ROW, file: "next/gone.tsx" }])).toEqual([
      expect.stringMatching(/^Tip:0 a stale row in compiler-ledger.json: its file is gone/),
    ]);
  });

  it("scenario: fails a clock read in render", () => {
    const text = Arr.join(["export const Clock = () => <b>{Date.now()}</b>;"], "\n");
    expect(at("next/a.tsx", text)).toEqual([
      expect.stringMatching(/^Clock:1 Cannot call impure function during render/),
    ]);
  });

  it("scenario: counts lines in characters, not bytes, past non-ASCII text", () => {
    const text = Arr.join(["// Görünüm: çok satırlı bir açıklama ✨", REF_IN_RENDER], "\n");
    expect(at("next/a.tsx", text)).toEqual(["Tip:5 Cannot access refs during render"]);
  });

  it("scenario: compiles a dropped store value with no word, so one-store-hook must hold it", () => {
    const text = Arr.join(
      [
        "declare const useModel: (s: unknown) => number;",
        "declare const store: unknown;",
        "declare const shown: {readonly count: number};",
        "export const Frozen = () => {",
        "\tuseModel(store);",
        "\treturn <b>{shown.count}</b>;",
        "};",
      ],
      "\n",
    );

    expect(at("next/a.tsx", text)).toEqual([]);
  });
});
