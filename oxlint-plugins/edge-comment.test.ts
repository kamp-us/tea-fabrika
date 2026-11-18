// `edge-comment` (Tier 1, P35; small-exam item 6): an ignore comment that names `fabrika/no-promises`
// or `fabrika/no-effect-run-outside-edge` is `// oxlint-disable-next-line <rule> -- edge: <why>`,
// names only those two rules, and gives a reason. Each wrong comment stands over a line that really
// fires, so only this rule speaks. These planted laws were the exam's
// (next/apps/fabrika/src/exam/edge-comment.integration.test.ts) until 0591 moved them here. The
// `.oxlintrc.json` laws stay plain in next/apps/fabrika/src/exam/edge-config.test.ts, where pull request
// 1420 (K11) put them so they run on every pull request. Plant: accept `Edge:` as `edge:` in the rule,
// and the `edge-capital` case passes.
import { Array as Arr, Record as Rec } from "effect";
import { describe, expect, it } from "vitest";
import { plant } from "./plant.ts";

const CODE = "fabrika(edge-comment)";

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

const all = await plant({
  ...Rec.fromEntries(
    Arr.map(Rec.toEntries(CASES), ([name, [comment, line]]) => [at(name), Arr.join([...PRELUDE, comment, line], "\n")]),
  ),
  [UNUSED]: Arr.join(
    [...PRELUDE, "// oxlint-disable-next-line fabrika/no-promises -- edge: nothing fires below", "export const a = 1;"],
    "\n",
  ),
});

describe("edge-comment", () => {
  it("scenario: refuses each wrong edge comment, at the top of the file", () => {
    const refused = Arr.filter(Rec.toEntries(CASES), ([, [, , no]]) => no);
    expect(refused).toHaveLength(8);

    for (const [name] of refused) {
      expect([name, all(CODE, at(name))]).toEqual([name, [1]]);
    }
  });

  it("scenario: passes a right one for each rule and for both, and leaves other comments alone", () => {
    const passed = Arr.filter(Rec.toEntries(CASES), ([, [, , no]]) => !no);
    expect(passed).toHaveLength(4);

    for (const [name] of passed) {
      expect([name, all(CODE, at(name))]).toEqual([name, []]);
    }
  });

  it("scenario: speaks alone: the line under each comment is silenced and no comment is unused", () => {
    for (const name of Rec.keys(CASES)) {
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

  it("scenario: an edge comment over a line where nothing fires is unused, which fails", () => {
    expect(all("", UNUSED)).toEqual([3]);
    expect(all(CODE, UNUSED)).toEqual([]);
  });
});
