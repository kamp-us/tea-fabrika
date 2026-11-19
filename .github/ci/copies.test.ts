// Today's CI: copies.ts's laws (0587). jscpd's own report shape, read as its json reporter writes
// it, and the advice lines made from it. Nothing here runs jscpd.
import { Option } from "effect";
import { describe, expect, it } from "vitest";
import { advice, type Clone, decodeReport } from "./copies.ts";

// vector: one clone from a real jscpd 5.4.3 run with --baseline-from-ref origin/main, a copy of
// pr/Queue.ts saved as pr/QueueCopy.ts, its fragment cut.
const REAL = JSON.stringify({
  duplicates: [
    {
      firstFile: {
        end: 294,
        endLoc: { column: 3, line: 294, position: 11977 },
        name: ".agents/skills/lead/scripts/pr/Queue.ts",
        start: 16,
        startLoc: { column: 0, line: 16, position: 1157 },
      },
      format: "typescript",
      fragment: 'import { Duration, Effect, Option, Schedule, Schema } from "effect";',
      isNew: true,
      kind: "exact",
      lines: 279,
      secondFile: {
        end: 294,
        endLoc: { column: 3, line: 294, position: 11977 },
        name: ".agents/skills/lead/scripts/pr/QueueCopy.ts",
        start: 16,
        startLoc: { column: 0, line: 16, position: 1157 },
      },
      tokens: 1961,
    },
  ],
  statistics: {},
});

const side = (name: string, from: number, to: number) => ({ name, startLoc: { line: from }, endLoc: { line: to } });

describe("copies: a pull request's new clones as advice (0587)", () => {
  // Plants: read the report as some other shape, or put the warning on the older side.
  it("vector: a real jscpd report's new clone becomes one warning on its second side that names the first", () => {
    const report = decodeReport(REAL);
    expect(Option.isSome(report)).toBe(true);
    expect(advice(Option.getOrThrow(report).duplicates)).toEqual([
      "::warning file=.agents/skills/lead/scripts/pr/QueueCopy.ts,line=16,endLine=294,title=copied code (advice)::279 lines, 1961 tokens, the same as .agents/skills/lead/scripts/pr/Queue.ts:16-294. Reuse it or say why not in ## Existing tools (0587).",
    ]);
  });

  // Plants: print a clone the base already had, or one from a run with no baseline.
  it("scenario: a clone the base had, or one with no isNew at all, gives no line", () => {
    const clone = (isNew?: boolean): Clone => ({
      firstFile: side("a.ts", 1, 9),
      secondFile: side("b.ts", 3, 11),
      lines: 9,
      tokens: 70,
      ...(isNew === undefined ? {} : { isNew }),
    });

    expect(advice([clone(false), clone()])).toEqual([]);
    expect(advice([clone(true)])).toHaveLength(1);
  });

  // Plant: let a comma or a colon in a path end the warning's file property early.
  it("scenario: a path with a comma or a colon is escaped as GitHub's toolkit escapes a property", () => {
    const [line] = advice([
      { firstFile: side("x.ts", 1, 2), secondFile: side("odd,name:x.ts", 4, 5), lines: 2, tokens: 60, isNew: true },
    ]);

    expect(line).toContain("file=odd%2Cname%3Ax.ts,line=4,endLine=5");
  });

  it("scenario: a report that is not jscpd's shape reads as none", () => {
    expect(Option.isNone(decodeReport('{"clones": []}'))).toBe(true);
    expect(Option.isNone(decodeReport("not json"))).toBe(true);
  });
});
