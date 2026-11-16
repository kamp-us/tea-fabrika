// `fabrika/no-stability-tag`, E1 of the Effect-check sweep (0574). Law 1 runs in process through
// oxlint's RuleTester on generated doc blocks and reads the exact text the fix writes. Law 2 lints
// planted files at their real paths with the repo's own `.oxlintrc.json`, so the scope is the
// config's: the four folders fire, the 16 files of pull request 1366 and every other path do not.
import * as fc from "fast-check";
import { RuleTester } from "oxlint/plugins-dev";
import { describe, expect, it } from "vitest";
import { plant } from "../next/apps/fabrika/src/exam/plant.ts";
import { noStabilityTag } from "./no-stability-tag.ts";

const RUNS = { seed: 119120, numRuns: 100 };
const CODE = "fabrika(no-stability-tag)";

// RuleTester runs each case at once, so a failure throws into fast-check, which shrinks it.
RuleTester.describe = (_name, fn) => fn();
RuleTester.it = (_name, fn) => fn();
const tester = new RuleTester({ cwd: import.meta.dirname });

const block = (lines: ReadonlyArray<string>): string =>
  ["/**", ...lines.map((l) => (l === "" ? " *" : ` * ${l}`)), " */"].join("\n");

/** The other tags a block may hold, in Effect's order, and the three values of the tag itself. */
const OTHERS = ["@deprecated use b", "@see b", "@category models"] as const;

/**
 * A block with the tag at any place among its other tags, or none. `expected` is the block as it
 * should read once the tag is gone: the description, then a blank line and the other tags when
 * there are any. A block whose only tag was this one must not keep a blank line above `*\/`.
 */
const model = fc
  .record({
    description: fc.array(fc.constantFrom("A planted export.", "More words here."), { minLength: 1, maxLength: 2 }),
    others: fc.subarray([...OTHERS]),
    value: fc.constantFrom("stable", "unstable", "experimental"),
    tagged: fc.boolean(),
    at: fc.nat(),
  })
  .map(({ description, others, value, tagged, at }) => {
    const tags: string[] = [...others];

    if (tagged) {
      tags.splice(at % (tags.length + 1), 0, `@stability ${value}`);
    }

    const join = (rest: ReadonlyArray<string>) => (rest.length > 0 ? ["", ...rest] : []);

    return {
      tagged,
      code: `${block([...description, ...join(tags)])}\nexport const a = 1;\n`,
      expected: `${block([...description, ...join(others)])}\nexport const a = 1;\n`,
    };
  });

describe("law 1: a @stability line is reported once, and the fix writes the block without it and without a blank line left above */", () => {
  it("for any block with the tag among any other tags, or none", () => {
    fc.assert(
      fc.property(model, ({ tagged, code, expected }) => {
        tester.run("no-stability-tag", noStabilityTag, {
          valid: tagged ? [{ code: expected, filename: "case.ts" }] : [{ code, filename: "case.ts" }],
          invalid: tagged
            ? [{ code, filename: "case.ts", errors: [{ message: /No @stability tag/ }], output: expected }]
            : [],
        });
      }),
      RUNS,
    );
  });

  // scenario: a tag on the opening line cannot be taken apart, so it is reported and left to a person;
  // a mention in the middle of a sentence is prose, not a tag, and passes.
  it.each([
    ["on the opening line", "/** @stability unstable */\nexport const a = 1;\n", true],
    [
      "named mid-sentence",
      "/**\n * A planted export that says @stability in prose.\n */\nexport const a = 1;\n",
      false,
    ],
  ])("scenario: a tag %s", (_name, code, reported) => {
    tester.run("no-stability-tag", noStabilityTag, {
      valid: reported ? [] : [{ code, filename: "case.ts" }],
      invalid: reported
        ? [{ code, filename: "case.ts", errors: [{ message: /Delete it by hand/ }], output: null }]
        : [],
    });
  });
});

// The 16 tagged files of pull request 1366 (`gh pr diff 1366 --name-only`, 2026-11-15), which E60
// does once that branch lands.
const WAITING = [
  "next/packages/libfabrika/src/cloudflare/runtime.ts",
  "next/packages/libfabrika/src/gateway/Gateway.ts",
  "next/packages/libfabrika/src/ledger/LedgerTransactionSql.ts",
  "next/packages/libfabrika/src/ledger/Log.ts",
  "next/packages/libfabrika/src/ledger/Referee.ts",
  "next/packages/libfabrika/src/ledger/RefereeSql.ts",
  "next/packages/libfabrika/src/processes/ProcessManager.ts",
  "next/packages/libfabrika/src/processes/ProgramMail.ts",
  "next/packages/libfabrika/src/processes/ProgramMailLedger.ts",
  "next/packages/libfabrika/src/runtime/ProcessStore.ts",
  "next/packages/libfabrika/src/runtime/RecoveryStore.ts",
  "next/packages/libfabrika/src/runtime/RepliesSql.ts",
  "next/packages/libfabrika/src/runtime/Runner.ts",
  "next/packages/libfabrika/src/settings/Declarations.ts",
  "next/packages/libfabrika/src/settings/JsonSchema.ts",
  "next/packages/libfabrika/src/telemetry/Sink.ts",
] as const;

const IN_SCOPE = [
  "next/packages/libfabrika/src/access/Planted.ts",
  "next/packages/libfabrika/src/internal/planted.ts",
  "next/packages/libfabrika/src/transport/Planted.test.ts",
  "next/apps/fabrika/src/planted.ts",
  "next/programs/counter/src/planted.ts",
  ".agents/skills/lead/scripts/planted.ts",
  ".github/ci/planted.mjs",
] as const;

const OUTSIDE = ["packages/fabrika/src/planted.ts", "docs/tutorials/planted.ts", "stylelint.config.ts"] as const;

describe("law 2: with the real config the rule fires in next/, .agents/, .github/ci/ and oxlint-plugins/, and nowhere else", async () => {
  const body = `${block(["A planted export.", "", "@stability unstable", "@category models"])}\nexport const planted = 1;\n`;
  const linted = await plant(Object.fromEntries([...WAITING, ...IN_SCOPE, ...OUTSIDE].map((path) => [path, body])));

  it("fires on the tag line in each folder it covers, tests and internal/ included", () => {
    fc.assert(
      fc.property(fc.constantFrom(...IN_SCOPE), (path) => {
        expect(linted(CODE, path), path).toEqual([4]);
      }),
      { ...RUNS, numRuns: IN_SCOPE.length },
    );
  });

  it("stays silent on the 16 files of pull request 1366 and on paths outside the four folders", () => {
    fc.assert(
      fc.property(fc.constantFrom(...WAITING, ...OUTSIDE), (path) => {
        expect(linted(CODE, path), path).toEqual([]);
      }),
      { ...RUNS, numRuns: WAITING.length + OUTSIDE.length },
    );
  });
});
