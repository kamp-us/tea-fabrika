// Test support for the plant runner's laws (decision 0600, docs/plan/quests/kalfa-quality-stryker-PLAN.md):
// a source file built from known pieces, and the mutant list Stryker's instrumenter would make for
// it, so a law knows exactly where each node is without asking the code it tests.
//
// `Made` is one mutant as the instrumenter makes it: lines and columns both counted from 0, the
// span being the mutated node's own text. A `Found` target and a Stryker `mutate` range count lines
// from 1 and columns from 0, and the JSON report counts both from 1. Those three bases are the
// facts the plant runner has to keep apart, so these helpers state each one.
import fc from "fast-check";

interface Position {
  readonly line: number;
  readonly column: number;
}

interface Made {
  readonly fileName: string;
  readonly mutatorName: string;
  readonly replacement: string;
  readonly location: { readonly start: Position; readonly end: Position };
}

/** A node of the built file: its tokens, the whitespace between them, and what Stryker would make of it. */
export interface Node {
  readonly tokens: ReadonlyArray<string>;
  readonly gaps: ReadonlyArray<string>;
  readonly mutator: string;
  readonly replacement: string;
}

/** A piece of the file: verbatim text, or a node. */
export type Part = string | Node;

export interface Placed {
  readonly node: Node;
  readonly start: Position;
  readonly end: Position;
}

/** The node's own text, its tokens joined by its gaps. */
export const nodeText = (node: Node): string =>
  node.tokens.reduce((text, token, i) => (i === 0 ? token : `${text}${node.gaps[i - 1] ?? " "}${token}`), "");

/** The position of an offset in `text`, lines and columns from 0. */
const positionOf = (text: string, offset: number): Position => {
  const before = text.slice(0, offset);
  const line = before.split("\n").length - 1;

  return { line, column: offset - (before.lastIndexOf("\n") + 1) };
};

/** The file's text and where each node sits in it. */
export const assemble = (
  parts: ReadonlyArray<Part>,
): { readonly text: string; readonly placed: ReadonlyArray<Placed> } => {
  let text = "";
  const placed: Array<Placed> = [];

  for (const part of parts) {
    if (typeof part === "string") {
      text += part;
    } else {
      const start = positionOf(text, text.length);
      text += nodeText(part);
      placed.push({ node: part, start, end: positionOf(text, text.length) });
    }
  }

  return { text, placed };
};

/**
 * The mutants the instrumenter would make: for each placed node its own mutant, and beside it two
 * others on the same span (another replacement, another mutator), as `n > 0` makes `true`, `false`
 * and `>=`. `noise` adds mutants on other spans.
 */
export const madeFor = (
  fileName: string,
  placed: ReadonlyArray<Placed>,
  noise: ReadonlyArray<Made> = [],
): ReadonlyArray<Made> => [
  ...placed.flatMap(({ node, start, end }) => [
    { fileName, mutatorName: node.mutator, replacement: node.replacement, location: { start, end } },
    { fileName, mutatorName: node.mutator, replacement: `${node.replacement}_decoy`, location: { start, end } },
    { fileName, mutatorName: `${node.mutator}Decoy`, replacement: node.replacement, location: { start, end } },
  ]),
  ...noise,
];

/** A line of the built file that holds no node of ours, and one mutant on it, as noise. */
export const noiseOn = (fileName: string, line: number, text: string): Made => ({
  fileName,
  mutatorName: "StringLiteral",
  replacement: '""',
  location: { start: { line, column: 0 }, end: { line, column: text.length } },
});

/** Required cases of a property: every one must be reached, or the property fails loudly. */
export const coverage = <Case extends string>(required: ReadonlyArray<Case>) => {
  const seen = new Set<Case>();

  return {
    hit: (name: Case) => {
      seen.add(name);
    },
    check: () => {
      const missing = required.filter((name) => !seen.has(name));

      if (missing.length > 0) {
        throw new Error(`the property never reached: ${missing.join(", ")}`);
      }
    },
  };
};

/** Shapes of a node the instrumenter sees in the lead's tooling: tokens joined by one space. */
export const SHAPES: ReadonlyArray<ReadonlyArray<string>> = [
  ["pnpm", "===", "null"],
  ["requested", "??", "(yield*", "repoNode(main))"],
  ["{", "...process.env,", "...env", "}"],
  ["a", "&&", "b"],
  ["n", ">", "0"],
];

export const MUTATORS = ["ConditionalExpression", "LogicalOperator", "ObjectLiteral", "EqualityOperator"] as const;

export const REPLACEMENTS = ["true", "false", "{}", "requested && (yield* repoNode(main))", "n >= 0"] as const;

/** A filler line, with no node of ours in it. */
export const filler: fc.Arbitrary<string> = fc.oneof(
  fc.stringMatching(/^const [a-z]{1,6} = [0-9]{1,3};$/),
  fc.stringMatching(/^\/\/ [a-z ]{0,12}$/),
  fc.constant(""),
  fc.constant("export {};"),
);
