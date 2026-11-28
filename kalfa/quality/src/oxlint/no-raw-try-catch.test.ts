// Law O9 of .kalfa/quests/kalfa-quality-oxlint-PLAN.md: `no-raw-try-catch` refuses a `try/catch` only in a file that
// imports Effect (the barrel, a subpath, a string-named specifier), and passes `try/finally` and a file with no Effect
// import. A `pinned:` law, the plan's reason: each import form is named once, so there is nothing to generate.
//
// Plants, each run once on no-raw-try-catch.ts and undone:
// - drop the import gate: a plain file's `try/catch` fires;
// - report `try/catch/finally` too: the line with all three fires.
import { it } from "@effect/vitest";
import { noRawTryCatch } from "./no-raw-try-catch.ts";
import { check, type Line } from "./Tester.test-support.ts";

/** Each way a file imports Effect, and whether the rule reads it as one. */
const IMPORTS: ReadonlyArray<readonly [header: string, imports: boolean]> = [
  ['import { Effect } from "effect";', true],
  ['import * as Effect from "effect/Effect";', true],
  ['import { Schema } from "effect/Schema";', true],
  ['import { "effect" as Effect } from "./other.ts";', true],
  ['import { Effect } from "@effect/platform";', false],
  ['import { Effect } from "./effect.ts";', false],
  ["", false],
];

const TRIES: ReadonlyArray<readonly [text: string, catches: boolean]> = [
  ["try { f(); } catch { f(); }", true],
  ["try { f(); } catch (e) { f(e); }", true],
  ["try { f(); } finally { f(); }", false],
  ["try { f(); } catch { f(); } finally { f(); }", false],
];

it("O9 pinned: no-raw-try-catch refuses try/catch only in a file that imports Effect, and passes try/finally", () => {
  for (const [header, imports] of IMPORTS) {
    const lines: ReadonlyArray<Line> = [
      [header, 0],
      ["declare const f: (e?: unknown) => void;", 0],
      ...TRIES.map(([text, catches]): Line => [text, imports && catches ? 1 : 0]),
    ];

    check("no-raw-try-catch", noRawTryCatch, lines);
  }
});
