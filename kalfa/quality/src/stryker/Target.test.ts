import fc from "fast-check";
// Laws Q1 to Q3 of docs/plan/quests/kalfa-quality-stryker-PLAN.md: `Target.find` picks the one mutant a
// plant names by its code shape (mutator, the node's text and Stryker's replacement), and refuses
// loudly when it finds the shape twice or never. Pure: the instrumenter's mutant list is an input.
//
// fast-check, not an Effect Schema, for every law here: the input is built source text with each
// node's place known, which Schema's Arbitrary cannot place.
import { describe, expect, it } from "vitest";
import {
  assemble,
  coverage,
  filler,
  madeFor,
  MUTATORS,
  nodeText,
  noiseOn,
  REPLACEMENTS,
  SHAPES,
} from "./Built.test-support.ts";
import type { Node, Part } from "./Built.test-support.ts";
import { plant } from "./Plant.ts";
import * as Target from "./Target.ts";

const options = { seed: 600, numRuns: 100 };

const FILE = "src/subject.ts";

const LAW = { file: "src/subject.test.ts", name: "subject > holds" };

const shape = fc.record({
  tokens: fc.constantFrom(...SHAPES),
  mutator: fc.constantFrom(...MUTATORS),
  replacement: fc.constantFrom(...REPLACEMENTS),
});

const named = (
  s: { tokens: ReadonlyArray<string>; mutator: string; replacement: string },
  extra?: { within?: string },
) =>
  plant({
    name: "subject",
    file: FILE,
    mutator: s.mutator,
    original: s.tokens.join(" "),
    replacement: s.replacement,
    ...extra,
    law: LAW,
  });

const nodeOf = (s: { tokens: ReadonlyArray<string>; mutator: string; replacement: string }, gap = " "): Node => ({
  tokens: s.tokens,
  gaps: s.tokens.slice(1).map(() => gap),
  mutator: s.mutator,
  replacement: s.replacement,
});

/** A node with other text but the same mutator and replacement: a decoy that only the text tells apart. */
const otherOf = (s: { tokens: ReadonlyArray<string>; mutator: string; replacement: string }): Node =>
  nodeOf({ ...s, tokens: [...s.tokens.slice(0, -1), `${s.tokens.at(-1)}_other`] });

describe("Target.find, a plant's shape is found exactly once", () => {
  // Plant: return the first match when there are two.
  it("Q1: found for one match, not_found for none, and ambiguous naming every place for two or more", () => {
    const seen = coverage(["none", "one", "many"] as const);

    fc.assert(
      fc.property(
        shape,
        fc.integer({ min: 0, max: 3 }),
        fc.array(filler, { minLength: 4, maxLength: 12 }),
        fc.array(fc.nat({ max: 11 }), { minLength: 3, maxLength: 3 }),
        fc.nat({ max: 11 }),
        (s, k, lines, slots, decoySlot) => {
          // The target node k times, a decoy node (same mutator and replacement, other text) once,
          // each as a line of its own among the filler lines.
          const rows: Array<Array<Part>> = lines.map((line) => [line]);

          rows.splice(decoySlot % (rows.length + 1), 0, ["const decoy = ", otherOf(s), ";"]);

          for (const [i, slot] of slots.slice(0, k).entries()) {
            rows.splice(slot % (rows.length + 1), 0, [`const t${i} = `, nodeOf(s), ";"]);
          }

          const { text, placed } = assemble(rows.flatMap((row) => [...row, "\n"]));
          const mine = placed.filter(({ node }) => node.tokens.join(" ") === s.tokens.join(" "));
          // Noise: a mutant on every line, none of them with a mutator of ours.
          const made = madeFor(
            FILE,
            placed,
            text.split("\n").map((line, i) => noiseOn(FILE, i, line)),
          );

          const got = Target.find(text, made, named(s));

          seen.hit(k === 0 ? "none" : k === 1 ? "one" : "many");

          const found = got._tag === "Success" ? got.success : undefined;
          const refused = got._tag === "Failure" ? got.failure : undefined;
          const places = (list: ReadonlyArray<{ line: number; column: number }>) =>
            list.map(({ line, column }) => `${line}:${column}`).sort();

          // The one outcome each count has, said whole: a place for one, a refusal naming every place otherwise.
          expect({
            reason: refused?.reason,
            found: found && {
              line: found.line,
              column: found.column,
              endLine: found.endLine,
              endColumn: found.endColumn,
              mutator: found.mutator,
              original: found.original,
              replacement: found.replacement,
            },
            places: refused?.reason === "ambiguous" ? places(refused.at) : undefined,
          }).toEqual(
            k === 0
              ? { reason: "not_found", found: undefined, places: undefined }
              : k === 1
                ? {
                    reason: undefined,
                    found: {
                      line: mine[0]!.start.line + 1,
                      column: mine[0]!.start.column,
                      endLine: mine[0]!.end.line + 1,
                      endColumn: mine[0]!.end.column,
                      mutator: s.mutator,
                      original: s.tokens.join(" "),
                      replacement: s.replacement,
                    },
                    places: undefined,
                  }
                : {
                    reason: "ambiguous",
                    found: undefined,
                    places: places(mine.map(({ start }) => ({ line: start.line + 1, column: start.column }))),
                  },
          );
        },
      ),
      options,
    );
    seen.check();
  });

  // Plant: compare the original without folding whitespace.
  it("Q2: a blank line, an indent or a re-wrap anywhere changes the place, never the answer", () => {
    const gap = fc.stringMatching(/^[ \t\n]{1,3}$/);

    fc.assert(
      fc.property(
        shape,
        fc.array(gap, { minLength: 4, maxLength: 4 }),
        fc.array(filler, { minLength: 3, maxLength: 8 }),
        fc.nat({ max: 8 }),
        fc.array(fc.nat({ max: 2 }), { minLength: 9, maxLength: 9 }),
        fc.nat({ max: 6 }),
        (s, gaps, lines, slot, blanks, indent) => {
          const at = slot % (lines.length + 1);
          const plain = nodeOf(s);
          const wrapped: Node = { ...plain, gaps: s.tokens.slice(1).map((_, i) => gaps[i % gaps.length]!) };

          // One layout is the file as written; the other adds blank lines above the node, an indent
          // on every line, and re-wraps the node between its tokens.
          const layout = (node: Node, extra: boolean) => {
            const pad = extra ? " ".repeat(indent) : "";
            const parts: Array<Part> = [];

            for (const [i, line] of lines.entries()) {
              if (i === at) {
                parts.push(`${pad}const t = `, node, ";\n");
              }

              parts.push(`${pad}${line}\n`);

              for (let n = 0; extra && n < (blanks[i] ?? 0); n++) {
                parts.push("\n");
              }
            }

            if (at >= lines.length) {
              parts.push(`${pad}const t = `, node, ";\n");
            }

            return assemble(parts);
          };

          const base = layout(plain, false);
          const moved = layout(wrapped, true);
          const ask = named(s);
          const before = Target.find(base.text, madeFor(FILE, base.placed), ask);
          const after = Target.find(moved.text, madeFor(FILE, moved.placed), ask);

          const a = before._tag === "Success" ? before.success : undefined;
          const b = after._tag === "Success" ? after.success : undefined;
          const added = blanks.slice(0, at).reduce((sum, n) => sum + n, 0);
          const where = moved.placed[0]!;

          expect(a).toBeDefined();
          // The same mutator and texts as in the file as written, at the place the node really is in
          // this file: the line moved by exactly the lines added above it.
          expect(b && { mutator: b.mutator, original: b.original, replacement: b.replacement }).toEqual(
            a && { mutator: a.mutator, original: a.original, replacement: a.replacement },
          );
          expect(b && [b.line, b.column, b.endLine, b.endColumn]).toEqual([
            where.start.line + 1,
            where.start.column,
            where.end.line + 1,
            where.end.column,
          ]);
          expect(b?.line).toBe(a && a.line + added);
        },
      ),
      options,
    );
  });

  // Plant: ignore `within`, so two copies stay ambiguous.
  it("Q3: within narrows two copies to one, and is refused unless its snippet occurs exactly once", () => {
    const seen = coverage(["narrowed", "twice", "never"] as const);
    const name = fc.stringMatching(/^[a-z]{3,8}$/);

    fc.assert(
      fc.property(
        shape,
        name,
        name,
        fc.boolean(),
        fc.constantFrom("once", "twice", "never"),
        (s, one, two, pickFirst, count) => {
          const node = nodeOf(s);
          const first = `function ${one}_a() { return `;
          const second = `function ${two}_b() { return `;
          const wrapper = (head: string) => `${head}${nodeText(node)}; }`;
          const parts: Array<Part> =
            count === "twice"
              ? [first, node, "; }\n", first, node, "; }\n"]
              : [first, node, "; }\n", second, node, "; }\n"];
          const { text, placed } = assemble(parts);
          const snippet =
            count === "never"
              ? `function ${one}_missing() { return ${nodeText(node)}; }`
              : wrapper(pickFirst || count === "twice" ? first : second);
          const got = Target.find(text, madeFor(FILE, placed), named(s, { within: snippet }));

          seen.hit(count === "once" ? "narrowed" : count);

          const found = got._tag === "Success" ? got.success : undefined;
          const refused = got._tag === "Failure" ? got.failure : undefined;
          const where = placed[pickFirst ? 0 : 1]!;

          expect({ at: found && [found.line, found.column], reason: refused?.reason }).toEqual(
            count === "once"
              ? { at: [where.start.line + 1, where.start.column], reason: undefined }
              : { at: undefined, reason: "within_not_once" },
          );
        },
      ),
      options,
    );
    seen.check();
  });
});
