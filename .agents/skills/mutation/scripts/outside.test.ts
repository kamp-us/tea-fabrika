import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { ACTIVE_ENV, coverRule, lawNamedFor, mutantIds, ruleBehind } from "./outside.ts";

// Today's tooling (ticket 1314): the pure parts of how a lint rule's laws reach the rule from another process.
const options = { seed: 1314, numRuns: 200 };

const name = fc.stringMatching(/^[a-z][a-z0-9-]{0,10}$/);

describe("outside, a lint rule and the test named after it", () => {
  // Plants: name the test for any folder; read a `.test-support.ts` or a `.test.ts` as a rule; drop the pairing for ruleBehind.
  it("a rule file and its test name each other, inside oxlint-plugins/ only, and test code is no rule", () => {
    fc.assert(
      fc.property(name, (rule) => {
        expect(lawNamedFor(`oxlint-plugins/${rule}.ts`)).toBe(`oxlint-plugins/${rule}.test.ts`);
        expect(ruleBehind(`oxlint-plugins/${rule}.test.ts`)).toBe(`oxlint-plugins/${rule}.ts`);
        expect(lawNamedFor(`oxlint-plugins/${rule}.test.ts`)).toBeNull();
        expect(lawNamedFor(`oxlint-plugins/${rule}.test-support.ts`)).toBeNull();
        expect(lawNamedFor(`oxlint-plugins/sub/${rule}.ts`)).toBeNull();
        expect(lawNamedFor(`next/${rule}.ts`)).toBeNull();
        expect(ruleBehind(`next/${rule}.test.ts`)).toBeNull();
        expect(ruleBehind(`oxlint-plugins/${rule}.ts`)).toBeNull();
      }),
      options,
    );
  });
});

describe("outside, the mutant a child process runs", () => {
  // Plant: name another variable, which an instrumented file never reads.
  it("pinned: an instrumented file reads the active mutant from one variable", () => {
    expect(ACTIVE_ENV).toBe("__STRYKER_ACTIVE_MUTANT__");
  });
});

describe("outside, the rule's mutants a rule's own test covers", () => {
  // Plants: read the helper's own definition as a mutant; list an id once per use; read a number that is no id.
  it("pinned: the ids are those of the calls that switch a mutant on, each once and in order", () => {
    const text = [
      "function stryMutAct_9fa48(id) { return ns.activeMutant === id; }",
      'const a = stryMutAct_9fa48("12") ? 1 : stryMutAct_9fa48("3") ? 2 : 3;',
      'const b = stryMutAct_9fa48("12") ? 1 : stryCov_9fa48("40", "41");',
      "const c = stryMutAct_9fa48(n);",
    ].join("\n");

    expect(mutantIds(text)).toEqual(["12", "3"]);
    expect(mutantIds("export const none = 1;")).toEqual([]);
  });

  // Plants: build a new object, which loses every hit an instrumented file records after it; drop the hits already there; count none.
  it("a test covers each id in place, on top of what it already hit", () => {
    fc.assert(
      fc.property(fc.uniqueArray(fc.nat(500).map(String), { maxLength: 8 }), name, (ids, test) => {
        const kept = { static: { "1": 2 }, perTest: { other: { "7": 1 }, [test]: { "9": 4 } } };
        const coverage = { static: kept.static, perTest: kept.perTest };

        coverRule(coverage, test, ids);

        expect(coverage.static).toBe(kept.static);
        expect(coverage.perTest).toBe(kept.perTest);
        expect(coverage.perTest["other"]).toEqual({ "7": 1 });

        for (const id of ids) {
          expect(coverage.perTest[test]?.[id]).toBe(id === "9" ? 5 : 1);
        }

        expect(coverage.perTest[test]?.["9"]).toBe(ids.includes("9") ? 5 : 4);
      }),
      options,
    );
  });
});
