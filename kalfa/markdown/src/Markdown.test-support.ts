// The generators for Markdown's laws (ticket 1928), all Effect `Arbitrary` values built from Schemas and their combinators.
//
// A body is any text, so the generators are built by class of input (the plan's (a) to (p)). Each run draws one `Run`: six seeds for words
// and noise, and a few lists of picks. Every class turns the run into its own variants, a fixed set that is the same every run plus drawn
// ones, so a law checks every class in every run and never leaves one to chance. A law keeps the class ids it checked and fails with
// `unreached` when one is missing, and fails when a variant's `holds` is false, so a class the generator lost fails loudly.
//
// Texts reuse the pools Frontmatter's generators built (line breaks, controls, letters past ASCII, lone surrogates, U+FEFF).
import { Arbitrary, Option, Result, Schema } from "effect";
import type { Nodes, Parents, Root } from "mdast";
import * as Base from "./Frontmatter.test-support.ts";
import * as Frontmatter from "./Frontmatter.ts";

type Point = NonNullable<Root["position"]>["start"];

type NonEmpty<A> = readonly [A, ...ReadonlyArray<A>];

const pick = <A>(list: NonEmpty<A>, n: number): A => list[n % list.length] ?? list[0];

const Pick = Schema.Int.check(Schema.isBetween({ minimum: 0, maximum: 9999 }));

/** One run: everything a law may draw. A law takes what it needs and ignores the rest. */
export interface Run {
  /** Six seeds: words, noise and picks for the classes. */
  readonly seeds: ReadonlyArray<Base.Seed>;
  /** 0 to 40 picks, for the soup of marks and odd characters. */
  readonly soup: ReadonlyArray<number>;
  /** 0 to 10 picks, for the blocks of a body. */
  readonly blocks: ReadonlyArray<number>;
  /** Eight small whole numbers, for the places a law picks. */
  readonly picks: ReadonlyArray<number>;
}

export const run: Arbitrary.Arbitrary<Run> = Arbitrary.all({
  seeds: Base.seeds,
  soup: Arbitrary.array(Arbitrary.schema(Pick), { maxLength: 40 }),
  blocks: Arbitrary.array(Arbitrary.schema(Pick), { maxLength: 10 }),
  picks: Arbitrary.array(Arbitrary.schema(Pick), { minLength: 8, maxLength: 8 }),
});

/** The class ids that a law has checked and that are not all there yet. */
export const unreached = (seen: ReadonlySet<string>, required: ReadonlyArray<string>): ReadonlyArray<string> =>
  required.filter((id) => !seen.has(id));

// ---------------------------------------------------------------------------------------------------------------------
// Words and pieces

const code = (point: number): string => String.fromCodePoint(point);

/** Words that Markdown reads as plain text wherever they stand: no mark, no break, and letters of other scripts. */
const WORDS: NonEmpty<string> = ["x", "word", "two words", "é", "日本", "a1", "Åb", "σ", "Title"];

const drawnWord = (run: Run, i: number): string => {
  const seed = run.seeds[i % run.seeds.length];

  return pick(WORDS, seed === undefined ? i : seed.a + i);
};

const MARKS: NonEmpty<string> = [
  "# ",
  "=",
  "---",
  "* ",
  "1) ",
  "> ",
  "```",
  "~~~",
  "    ",
  "\t",
  "|",
  "|---|",
  "[",
  "](",
  "[^1]: ",
  "<!--",
  "**",
  "__",
  "~~",
  "\\",
  "&amp;",
  "&#0;",
];

const LINE_ENDINGS: NonEmpty<string> = ["\n", "\r\n", "\r"];

// U+0000, a lone high and a lone low surrogate, U+FEFF, U+2028, U+0085, an emoji and letters past ASCII.
const ODD: NonEmpty<string> = [
  code(0),
  code(0xd800),
  code(0xdc00),
  Base.BOM,
  Base.LS,
  Base.NEL,
  code(0x1f600),
  ...Base.LETTERS,
];

const SOUP: NonEmpty<string> = [...MARKS, ...LINE_ENDINGS, ...ODD, "a", " ", "word"];

// ---------------------------------------------------------------------------------------------------------------------
// Blocks: the parts of a body that the types of mdast name

interface Block {
  readonly name: string;
  readonly text: string;
  /** The node types the block must give. */
  readonly types: ReadonlyArray<string>;
}

/** Class (d)'s blocks: every kind of part the plan names. Each is one block and stands alone between two blank lines. */
export const BLOCKS: NonEmpty<Block> = [
  { name: "atx", text: "# Data on top ##", types: ["heading"] },
  { name: "setext", text: "Setext title\n=====", types: ["heading"] },
  { name: "setext two", text: "Second title\n---", types: ["heading"] },
  { name: "hard break", text: "line one  \nline two\\\nline three", types: ["paragraph", "break"] },
  { name: "list two deep", text: "- a\n  - b\n    - c\n- d", types: ["list", "listItem"] },
  { name: "ordered", text: "1. one\n2. two", types: ["list", "listItem"] },
  { name: "block quote", text: "> quote\n> more", types: ["blockquote"] },
  { name: "thematic break", text: "***", types: ["thematicBreak"] },
  { name: "html", text: "<div>\nhi\n</div>", types: ["html"] },
  { name: "definition", text: '[ref]: http://x.y "t"', types: ["definition"] },
  { name: "footnote", text: "see[^1] it\n\n[^1]: note", types: ["footnoteReference", "footnoteDefinition"] },
  { name: "table", text: "| a | b\\|c |\n|:-|-:|\n| 1 | 2 |", types: ["table", "tableRow", "tableCell"] },
  { name: "fenced", text: "```js\n# not a heading\n```", types: ["code"] },
  { name: "indented", text: "\tindented code", types: ["code"] },
];

const blockText = (blocks: ReadonlyArray<Block>): string => blocks.map((block) => block.text).join("\n\n");

/** Every block, in an order where each stands apart from its neighbors, so each gives the part it is named for. */
export const FULL_BODY: string = `${blockText(BLOCKS)}\n`;

/** The node types `FULL_BODY` must give. */
export const FULL_TYPES: ReadonlyArray<string> = [...new Set(BLOCKS.flatMap((block) => block.types))];

/** The drawn blocks, joined by one blank line, or by one line break when a pick says so (a block may then touch the next). */
const drawnBlocks = (run: Run, blocks: ReadonlyArray<Block> = BLOCKS): string => {
  const list: ReadonlyArray<Block> = run.blocks.map((i) => {
    const found = blocks[i % blocks.length];

    return found ?? BLOCKS[0];
  });

  const join = (run.picks[0] ?? 0) % 3 === 0 ? "\n" : "\n\n";

  return `${list.map((block) => block.text).join(join)}\n`;
};

// ---------------------------------------------------------------------------------------------------------------------
// Reading a tree

/** A node and the node above it. */
export interface Visit {
  readonly node: Nodes;
  readonly parent: Parents | undefined;
}

const isParent = (node: Nodes): node is Parents => "children" in node;

/** Every node of the tree, the root first, each before its children. */
export const walk = (root: Nodes): ReadonlyArray<Visit> => {
  const found: Array<Visit> = [];

  const visit = (node: Nodes, parent: Parents | undefined): void => {
    found.push({ node, parent });

    if (isParent(node)) {
      for (const child of node.children) {
        visit(child, node);
      }
    }
  };

  visit(root, undefined);

  return found;
};

/** A node's text as a reader sees it: its `text` and `inlineCode` values, joined. */
export const plain = (root: Nodes): string =>
  walk(root)
    .map(({ node }) => (node.type === "text" || node.type === "inlineCode" ? node.value : ""))
    .join("");

/** The document as JSON with every `position` removed, so two documents compare by what they hold and not by where it sits. */
export const withoutPosition = (document: Root): typeof Schema.JsonObject.Type =>
  Schema.decodeUnknownSync(Schema.fromJsonString(Schema.JsonObject))(
    JSON.stringify(document, (key, value: Base.Json) => (key === "position" ? undefined : value)),
  );

/** Text without a leading U+FEFF, which micromark skips: every offset and column of the tree counts from after it. */
const withoutBom = (text: string): string => (text.startsWith(Base.BOM) ? text.slice(1) : text);

export interface Place {
  readonly line: number;
  readonly column: number;
}

/**
 * The line and column of an offset in a text, counted from 1: a line ending is `\n`, `\r\n` or a lone `\r`, each once, and a column
 * moves one per code unit (a tab is one).
 */
export const locate = (text: string, offset: number): Place => {
  let line = 1;
  let start = 0;

  for (let i = 0; i < offset; i++) {
    if (text[i] === "\r") {
      const next = text[i + 1] === "\n" ? i + 2 : i + 1;

      line += 1;
      start = next;
      i = next - 1;
    } else if (text[i] === "\n") {
      line += 1;
      start = i + 1;
    }
  }

  return { line, column: offset - start + 1 };
};

/** The line endings in a text, each of `\n`, `\r\n` and a lone `\r` counted once. */
export const endings = (text: string): number => locate(text, text.length).line - 1;

const pointText = (point: Point): string => `${point.line}:${point.column}:${point.offset ?? "none"}`;

// Whether the part's last line is an underline of `=` or `-` marks, as a setext heading's is (a block quote or a list item may lead it).
const isSetext = (text: string, position: Root["position"]): boolean => {
  const lines = text.slice(position?.start.offset ?? 0, position?.end.offset ?? 0).split(/\r\n|\n|\r/u);

  return /^[ \t>]*(?:=+|-+)[ \t]*$/u.test(lines.at(-1) ?? "");
};

/**
 * What is wrong with a document read from `body`, one line each: the root's fields and its range, a part with no position (only a `link` or
 * a `text` may lack one), a child outside its parent, and siblings out of order or overlapping.
 */
export const problems = (document: Root, body: string): ReadonlyArray<string> => {
  const found: Array<string> = [];
  const text = withoutBom(body);
  const end = locate(text, text.length);

  if (Object.keys(document).sort().join(",") !== "children,position,type") {
    found.push(`the root holds ${Object.keys(document).sort().join(",")}`);
  }

  const root = document.position;

  if (root === undefined) {
    found.push("the root has no position");
  } else {
    if (pointText(root.start) !== "1:1:0") {
      found.push(`the root starts at ${pointText(root.start)}`);
    }

    const want = `${end.line}:${end.column}:${text.length}`;

    if (pointText(root.end) !== want) {
      found.push(`the root ends at ${pointText(root.end)}, not ${want}`);
    }
  }

  for (const { node, parent } of walk(document)) {
    if (node.position === undefined && node.type !== "link" && node.type !== "text") {
      found.push(`a ${node.type} has no position`);
    }

    const inner = node.position;
    const outer = parent?.position;

    if (inner !== undefined && outer !== undefined) {
      if (inner.start.offset === undefined || inner.end.offset === undefined) {
        found.push(`a ${node.type} has no offset`);
      } else if (
        outer.start.offset === undefined ||
        outer.end.offset === undefined ||
        inner.start.offset < outer.start.offset ||
        inner.end.offset > outer.end.offset
      ) {
        found.push(`a ${node.type} at ${pointText(inner.start)} is outside its ${parent?.type}`);
      }
    }

    if (isParent(node)) {
      let before = -1;
      let previous: string | undefined;
      // Where the run of definitions right above the child starts.
      let runStart = -1;

      for (const child of node.children) {
        const at = child.position?.start.offset;

        if (at === undefined) {
          continue;
        }

        if (child.type === "definition" && previous !== "definition") {
          runStart = at;
        }

        // mdast starts a setext heading at the first definition of the run right above it, so those siblings overlap (README: "Only one pair
        // of siblings overlaps: a setext heading and the run of link definitions right above it"). Only that: a setext heading that starts where the run starts and ends below the part before it.
        const cutFromRun =
          child.type === "heading" &&
          previous === "definition" &&
          at === runStart &&
          (child.position?.end.offset ?? 0) > before &&
          isSetext(text, child.position);

        if (at < before && !cutFromRun) {
          found.push(
            `a ${child.type} at ${pointText(child.position?.start ?? { line: 0, column: 0 })} overlaps the part before it`,
          );
        }

        before = Math.max(before, child.position?.end.offset ?? at);
        previous = child.type;
      }
    }
  }

  return found;
};

// ---------------------------------------------------------------------------------------------------------------------
// M1: any text

export interface AnyBody {
  /** The plan's class id: a, b, c or d. */
  readonly cls: string;
  readonly name: string;
  readonly body: string;
  /** Whether the body holds what its class says. A class that is lost fails loudly. */
  readonly holds: boolean;
  /** For (b): the check that must stay in the text. */
  readonly check?: string;
  /** For (d): the node types the document must hold. */
  readonly types?: ReadonlyArray<string>;
}

export const ANY_REQUIRED: ReadonlyArray<string> = ["a", "b", "c", "d"];

const soupBodies = (run: Run): ReadonlyArray<AnyBody> => {
  const piece = (text: string, name: string): AnyBody => ({
    cls: "a",
    name,
    body: `${text}a${text}\n${text}`,
    holds: text !== "" && `${text}a${text}\n${text}`.includes(text),
  });

  const drawn = run.soup.map((i) => pick(SOUP, i)).join("");

  return [
    ...SOUP.map((text, i) => piece(text, `piece ${i}`)),
    { cls: "a", name: "drawn soup", body: drawn, holds: true },
    { cls: "a", name: "every piece", body: SOUP.join(""), holds: true },
    { cls: "a", name: "every piece, a line each", body: SOUP.join("\n"), holds: true },
    { cls: "a", name: "empty", body: "", holds: true },
  ];
};

// `-\n[ ] a` and its kin: an empty item, then a line that starts with a check. Parsed in full, GitHub's task-list part throws or loses `[ ]`.
const CHECKS: ReadonlyArray<readonly [string, string]> = [
  ["- [ ] a", "[ ]"],
  ["* [x] b", "[x]"],
  ["-\n[ ] a", "[ ]"],
  ["*\n[x] a", "[x]"],
  ["1.\n[ ] a", "[ ]"],
];

const checkBodies = (run: Run): ReadonlyArray<AnyBody> => {
  const drawn: ReadonlyArray<AnyBody> = CHECKS.flatMap(([text, check], i): ReadonlyArray<AnyBody> => {
    const word = drawnWord(run, i);
    const body = `${word}\n\n${text} ${word}\n`;

    return [{ cls: "b", name: `check ${i} after a word`, body, holds: body.includes(check), check }];
  });

  return [
    ...CHECKS.map(([text, check], i): AnyBody => ({
      cls: "b",
      name: `check ${i}`,
      body: text,
      holds: text.includes(check),
      check,
    })),
    ...drawn,
  ];
};

// A link literal that keeps its position, and three that lose it (a link and its text, from GitHub's link-literal step).
const LINKED = ["www.x.com", "https://a.b", "a@b.co"];

const UNPOSITIONED = ["[a@b.x", "_a@b.co_", "http://.!-"];

const literalBodies = (run: Run): ReadonlyArray<AnyBody> => [
  ...LINKED.map((text, i): AnyBody => ({
    cls: "c",
    name: `link literal ${text}`,
    body: `see ${text} now ${drawnWord(run, i)}`,
    holds: true,
  })),
  ...UNPOSITIONED.map((text): AnyBody => ({ cls: "c", name: `link literal ${text}`, body: text, holds: true })),
  ...UNPOSITIONED.map((text, i): AnyBody => ({
    cls: "c",
    name: `link literal ${text} after a word`,
    body: `${drawnWord(run, i)}\n\n${text}\n`,
    holds: true,
  })),
  { cls: "c", name: "all link literals", body: [...LINKED, ...UNPOSITIONED].join("\n\n"), holds: true },
];

const DEFINITION_HEADINGS: ReadonlyArray<readonly [string, string]> = [
  ["setext on the next line", '[ref]: http://x.y "t"\nSetext title\n=====\n'],
  ["setext dash on the next line", "[a]: b\nT\n---\n"],
  ["setext under two definitions", "[a]: b\n[c]: d\nT\n===\n"],
  ["setext of two lines", "[a]: b\nT1\nT2\n===\n"],
  ["setext after a blank line", "[a]: b\n\nT\n===\n"],
  ["setext in a block quote", "> [a]: b\n> T\n> ===\n"],
  ["setext in a list item", "- [a]: b\n  T\n  ===\n"],
  ["ATX on the next line", "[a]: b\n# T\n"],
  ["ATX after a blank line", "[a]: b\n\n# T\n"],
  ["ATX under two definitions", "[a]: b\n[c]: d\n## T ##\n"],
];

const blockBodies = (run: Run): ReadonlyArray<AnyBody> => [
  { cls: "d", name: "every block", body: FULL_BODY, holds: true, types: FULL_TYPES },
  { cls: "d", name: "drawn blocks", body: drawnBlocks(run), holds: true },
  {
    cls: "d",
    name: "drawn blocks, touching",
    body: drawnBlocks({ ...run, picks: [0, ...run.picks.slice(1)] }),
    holds: true,
  },
  // A link definition above a heading: mdast's one overlap (a setext heading cut from the run of definitions) and the headings that must not get it.
  ...DEFINITION_HEADINGS.map(([name, body]): AnyBody => ({
    cls: "d",
    name: `definition, ${name}`,
    body,
    holds: body.startsWith("[") || body.startsWith(">") || body.startsWith("-"),
  })),
  ...BLOCKS.map((block): AnyBody => ({
    cls: "d",
    name: `block ${block.name}`,
    body: `${block.text}\n`,
    holds: true,
    types: block.types,
  })),
];

/** M1's bodies: classes (a), (b), (c) and (d). */
export const anyBodies = (run: Run): ReadonlyArray<AnyBody> => [
  ...soupBodies(run),
  ...checkBodies(run),
  ...literalBodies(run),
  ...blockBodies(run),
];

// ---------------------------------------------------------------------------------------------------------------------
// M3: two typings of one document

export interface TypedPair {
  /** The plan's class id: e, f, g or h. */
  readonly cls: string;
  readonly name: string;
  readonly a: string;
  readonly b: string;
  readonly holds: boolean;
}

export const PAIR_CLASSES: ReadonlyArray<PairClass> = ["e", "f", "g", "h"];

// The two typings of a run's pairs sit in a body of other blocks (not an indented one: two code blocks one blank line apart become one),
// each pair between two plain paragraphs, so it is not part of a list or a paragraph above it.
const CONTEXT: ReadonlyArray<Block> = BLOCKS.filter((block) => block.name !== "indented");

const placed = (run: Run, part: string): string => {
  const middle = Math.floor(run.blocks.length / 2);
  const before = { ...run, blocks: run.blocks.slice(0, middle) };
  const after = { ...run, blocks: run.blocks.slice(middle) };
  const apart = (r: Run): string => r.blocks.map((i) => (CONTEXT[i % CONTEXT.length] ?? BLOCKS[0]).text).join("\n\n");

  return [apart(before), "between", part, "between", apart(after)].filter((text) => text !== "").join("\n\n");
};

const pair = (run: Run, cls: string, name: string, a: string, b: string): TypedPair => ({
  cls,
  name,
  a: placed(run, a),
  b: placed(run, b),
  holds: a !== b,
});

const strongMarks: ReadonlyArray<readonly [string, string]> = [
  ["**", "__"],
  ["*", "_"],
];

// Each at a word's edge: alone on its line, after a word, before one, in brackets, and between two words.
const EDGES: ReadonlyArray<readonly [string, string]> = [
  ["", ""],
  ["a ", ""],
  ["", " b"],
  ["(", ")"],
  ["a ", " b"],
];

const emphasisPairs = (run: Run): ReadonlyArray<TypedPair> =>
  strongMarks.flatMap(([one, other]) =>
    EDGES.map(([left, right], i) =>
      pair(
        run,
        "e",
        `${one} ${JSON.stringify(left)} ${JSON.stringify(right)}`,
        `${left}${one}${drawnWord(run, i)}${one}${right}`,
        `${left}${other}${drawnWord(run, i)}${other}${right}`,
      ),
    ),
  );

const items = (run: Run): ReadonlyArray<string> => [drawnWord(run, 0), drawnWord(run, 1), drawnWord(run, 2)];

const listPairs = (run: Run): ReadonlyArray<TypedPair> => {
  const markers: ReadonlyArray<readonly [string, string]> = [
    ["- ", "* "],
    ["- ", "+ "],
    ["* ", "+ "],
    ["1. ", "1) "],
  ];

  return markers.flatMap(([one, other]) => {
    const [first, second, third] = items(run);
    const tight = (mark: string) => `${mark}${first}\n${mark}${second}\n${mark}${third}`;
    const loose = (mark: string) => `${mark}${first}\n\n${mark}${second}`;
    const nested = (mark: string) => `${mark}${first}\n   ${mark}${second}`;
    const apart = (mark: string) => `${mark}${first}\n\nbetween\n\n${mark}${second}`;

    return [
      pair(run, "f", `tight ${one}`, tight(one), tight(other)),
      pair(run, "f", `loose ${one}`, loose(one), loose(other)),
      pair(run, "f", `nested ${one}`, nested(one), nested(other)),
      pair(run, "f", `two lists ${one}`, apart(one), apart(other)),
    ];
  });
};

const range = (from: number, to: number): ReadonlyArray<number> =>
  Array.from({ length: to - from }, (_, i) => from + i);

const headingPairs = (run: Run): ReadonlyArray<TypedPair> => {
  const word = drawnWord(run, 3);

  return [
    ...range(1, 9).map((n) => pair(run, "g", `level one, underline of ${n}`, `# ${word}`, `${word}\n${"=".repeat(n)}`)),
    ...range(1, 9).map((n) =>
      pair(run, "g", `level two, underline of ${n}`, `## ${word}`, `${word}\n${"-".repeat(n)}`),
    ),
    pair(run, "g", "closing marks and a setext line", `# ${word} #`, `${word}\n=`),
    pair(run, "g", "closing marks", `# ${word}`, `# ${word} ##`),
    pair(run, "g", "closing marks, level three", `### ${word}`, `### ${word} ###`),
  ];
};

// The lines of a code block: none blank first or last, a blank, a deeper indent and a tab inside.
const CODE_LINES: NonEmpty<ReadonlyArray<string>> = [["a"], ["a", "b"], ["# T", "", "T"], ["x", "  y", "\tz"]];

const codePairs = (run: Run): ReadonlyArray<TypedPair> =>
  CODE_LINES.flatMap((lines, i) => {
    const text = (fence: string) => `${fence}\n${lines.join("\n")}\n${fence}`;
    const indented = lines.map((line) => (line === "" ? "" : `    ${line}`)).join("\n");
    const name = `lines ${i}`;

    return [
      pair(run, "h", `${name}, backticks and tildes`, text("```"), text("~~~")),
      pair(run, "h", `${name}, three backticks and four`, text("```"), text("````")),
      pair(run, "h", `${name}, a fence and four spaces`, text("```"), indented),
      pair(run, "h", `${name}, tildes and four spaces`, text("~~~"), indented),
    ];
  });

/** The class ids of M3's pairs, each a law of its own: a law holds one class's pairs, a quarter of a run's parses. */
export type PairClass = "e" | "f" | "g" | "h";

const PAIRS: Readonly<Record<PairClass, (run: Run) => ReadonlyArray<TypedPair>>> = {
  e: emphasisPairs,
  f: listPairs,
  g: headingPairs,
  h: codePairs,
};

/** M3's pairs of one class: (e), (f), (g) or (h). */
export const typedPairs = (run: Run, cls: PairClass): ReadonlyArray<TypedPair> => PAIRS[cls](run);

// ---------------------------------------------------------------------------------------------------------------------
// M4: code is code

export interface CodeBody {
  /** The plan's class id: i or j. */
  readonly cls: string;
  readonly name: string;
  readonly body: string;
  /** The lines of the block, as its value must hold them. */
  readonly lines: ReadonlyArray<string>;
  /** The list and the block quote the body makes by itself, apart from the code. */
  readonly lists: number;
  readonly quotes: number;
  readonly holds: boolean;
}

export const CODE_REQUIRED: ReadonlyArray<string> = ["i", "j"];

// What a code block holds: lines that would be a heading, a setext heading, a thematic break, a list, a table or a quote anywhere else.
const SNIPPETS: NonEmpty<ReadonlyArray<string>> = [
  ["# T"],
  ["T", "==="],
  ["---"],
  ["- a"],
  ["| a |", "|---|"],
  ["> q"],
  ["# T", "", "T", "===", "---", "- a", "| a |", "|---|", "> q"],
];

// What a block's first line and the lines after it start with, inside nothing, a list item and a block quote.
const CONTAINER_LEADS: Readonly<Record<"none" | "list" | "quote", readonly [string, string]>> = {
  none: ["", ""],
  list: ["- ", "  "],
  quote: ["> ", "> "],
};

const FENCES: NonEmpty<string> = ["```", "```js", "~~~", "~~~ txt"];

const CONTAINERS: NonEmpty<"none" | "list" | "quote"> = ["none", "list", "quote"];

const fencedBodies = (run: Run): ReadonlyArray<CodeBody> => {
  const offset = run.picks[1] ?? 0;
  let n = 0;
  const found: Array<CodeBody> = [];

  for (const container of CONTAINERS) {
    for (const open of [false, true]) {
      for (const fence of FENCES) {
        const lines = pick(SNIPPETS, offset + n);
        const closing = fence.startsWith("`") ? "```" : "~~~";
        const all = open ? [fence, ...lines] : [fence, ...lines, closing];
        const [firstMark, restMark] = CONTAINER_LEADS[container];
        const block = all.map((line, i) => `${i === 0 ? firstMark : restMark}${line}`).join("\n");
        const lead = (run.picks[2] ?? 0) % 2 === 0 ? "between\n\n" : "";

        found.push({
          cls: "i",
          name: `${container}${open ? ", open" : ""}, ${fence}`,
          body: `${lead}${block}`,
          lines,
          lists: container === "list" ? 1 : 0,
          quotes: container === "quote" ? 1 : 0,
          holds: block.includes(fence),
        });
        n += 1;
      }
    }
  }

  return found;
};

const INDENTS: NonEmpty<string> = ["    ", "\t"];

const indentedBodies = (run: Run): ReadonlyArray<CodeBody> =>
  INDENTS.flatMap((indent) =>
    SNIPPETS.flatMap((lines, i): ReadonlyArray<CodeBody> => {
      const block = lines.map((line) => (line === "" ? "" : `${indent}${line}`)).join("\n");
      const lead = (run.picks[3] ?? 0) % 2 === 0 || i % 2 === 0 ? "between\n\n" : "";

      return [
        {
          cls: "j",
          name: `${JSON.stringify(indent)}, snippet ${i}`,
          body: `${lead}${block}`,
          lines,
          lists: 0,
          quotes: 0,
          holds: block.startsWith(indent),
        },
      ];
    }),
  );

/** M4's bodies: classes (i) and (j). */
export const codeBodies = (run: Run): ReadonlyArray<CodeBody> => [...fencedBodies(run), ...indentedBodies(run)];

// ---------------------------------------------------------------------------------------------------------------------
// M5: the first level-one heading

export interface HeadingBody {
  /** The plan's class id: k, l or m. */
  readonly cls: string;
  readonly name: string;
  readonly body: string;
  /** The first level-one heading's text, or `undefined` when the body has none. */
  readonly answer: string | undefined;
  readonly holds: boolean;
}

export const HEADING_REQUIRED: ReadonlyArray<string> = ["k", "l", "m"];

interface Title {
  /** The title as typed. */
  readonly source: string;
  /** The text a reader sees: its `text` and `inlineCode` values, joined. */
  readonly text: string;
}

const plainTitle = (run: Run): Title => {
  const word = drawnWord(run, 4);

  return { source: word, text: word };
};

// A title with bold, inline code and a link in it.
const richTitle = (run: Run): Title => {
  const [one, two, three, four] = [drawnWord(run, 0), drawnWord(run, 1), drawnWord(run, 2), drawnWord(run, 3)];

  return {
    source: `${one} **${two}** \`${three}\` [${four}](http://x.y) end`,
    text: `${one} ${two} ${three} ${four} end`,
  };
};

const formBodies = (run: Run): ReadonlyArray<HeadingBody> => {
  const plainOne = plainTitle(run);
  const rich = richTitle(run);

  const forms: ReadonlyArray<readonly [string, string, Title]> = [
    ["ATX", `# ${plainOne.source}`, plainOne],
    ["ATX, one space before", ` # ${plainOne.source}`, plainOne],
    ["ATX, two spaces before", `  # ${plainOne.source}`, plainOne],
    ["ATX, three spaces before", `   # ${plainOne.source}`, plainOne],
    ["ATX, closing marks", `# ${plainOne.source} #`, plainOne],
    ["ATX, closing marks and spaces", `# ${plainOne.source} ##   `, plainOne],
    ["ATX, a tab", `#\t${plainOne.source}`, plainOne],
    ["ATX, rich", `# ${rich.source}`, rich],
    ["setext", `${plainOne.source}\n===`, plainOne],
    ["setext, a long underline", `${plainOne.source}\n=========`, plainOne],
    ["setext, three spaces before", `   ${plainOne.source}\n===`, plainOne],
    ["setext, rich", `${rich.source}\n===`, rich],
  ];

  return forms.map(([name, body, title]) => ({
    cls: "k",
    name,
    body: `${body}\n`,
    answer: title.text,
    holds: body.includes(title.source),
  }));
};

// What may stand before the title: none of it is a level-one heading among the root's children.
const BEFORE: NonEmpty<readonly [string, string]> = [
  ["h2", "## A"],
  ["h3", "### A"],
  ["h4", "#### A"],
  ["h5", "##### A"],
  ["h6", "###### A"],
  ["setext dash", "S\n---"],
  ["paragraph", "just text"],
  ["fenced fake", "```\n# fake\n```"],
  ["tilde fake", "~~~\n# fake\n~~~"],
  ["block quote", "> # quoted"],
  ["list item", "- # quoted"],
  ["html", "<h1>fake</h1>"],
];

const beforeBodies = (run: Run): ReadonlyArray<HeadingBody> => {
  const title = plainTitle(run);
  const every = BEFORE.map(([, text]) => text);
  const drawn = run.soup.slice(0, 6).map((i) => pick(BEFORE, i)[1]);

  return [
    ...BEFORE.map(([name, text]): HeadingBody => ({
      cls: "l",
      name: `after ${name}`,
      body: `${text}\n\n# ${title.source}\n`,
      answer: title.text,
      holds: text !== "",
    })),
    {
      cls: "l",
      name: "after every part",
      body: `${every.join("\n\n")}\n\n# ${title.source}\n`,
      answer: title.text,
      holds: true,
    },
    {
      cls: "l",
      name: "after drawn parts",
      body: `${drawn.join("\n\n")}\n\n# ${title.source}\n`,
      answer: title.text,
      holds: true,
    },
  ];
};

// Text that looks like a level-one heading and is not one.
const FAKES: ReadonlyArray<readonly [string, string]> = [
  ["indented four spaces", "    # fake"],
  ["no space", "#x"],
  ["escaped", "\\# x"],
  ["inside a paragraph", "a # b"],
];

const noneBodies = (run: Run): ReadonlyArray<HeadingBody> => [
  ...FAKES.map(([name, text]): HeadingBody => ({
    cls: "m",
    name,
    body: `${text}\n`,
    answer: undefined,
    holds: text !== "",
  })),
  ...FAKES.map(([name, text]): HeadingBody => ({
    cls: "m",
    name: `${name}, after a level two heading`,
    body: `## ${drawnWord(run, 0)}\n\n${text}\n`,
    answer: undefined,
    holds: text !== "",
  })),
  {
    cls: "m",
    name: "every one",
    body: `${FAKES.map(([, text]) => text).join("\n\n")}\n`,
    answer: undefined,
    holds: true,
  },
  { cls: "m", name: "nothing", body: "", answer: undefined, holds: true },
];

/** M5's bodies: classes (k), (l) and (m). */
export const headingBodies = (run: Run): ReadonlyArray<HeadingBody> => [
  ...formBodies(run),
  ...beforeBodies(run),
  ...noneBodies(run),
];

// ---------------------------------------------------------------------------------------------------------------------
// M6: a part's place in the whole file

export interface PlacedFile {
  /** The plan's class id: d, n, o or p. */
  readonly cls: string;
  readonly name: string;
  readonly file: string;
  /** The body, as `Frontmatter.split` cuts it from the file. */
  readonly body: string;
  readonly holds: boolean;
}

export const PLACED_REQUIRED: ReadonlyArray<string> = ["d", "n", "o", "p"];

const BAR_LF = "---\n";

// A start from class (n): what stands before the body. `cut` says how `Frontmatter.split` must cut it.
const starts = (run: Run): ReadonlyArray<{ readonly name: string; readonly text: string; readonly cut: boolean }> => {
  const written = Result.getOrThrow(Frontmatter.write({ data: { a: 1, b: drawnWord(run, 5) }, body: "" }, Base.S1));

  return [
    { name: "written", text: written, cut: true },
    { name: "written, CRLF fences", text: written.replaceAll("\n", "\r\n"), cut: true },
    { name: "empty block", text: `${BAR_LF}${BAR_LF}`, cut: true },
    { name: "a lone CR in a comment line", text: `${BAR_LF}# a\rb\n${BAR_LF}`, cut: true },
    { name: "no frontmatter", text: "", cut: false },
    { name: "no closing fence", text: `${BAR_LF}not closed\n`, cut: false },
  ];
};

const placedFile = (
  cls: string,
  name: string,
  start: { readonly text: string; readonly cut: boolean },
  text: string,
): PlacedFile => {
  // A start with no closing fence must not meet a `---` line in its body, which would close it.
  const body = start.cut || start.text === "" ? text : text.replace(/^---$/gmu, "- - -");
  const file = `${start.text}${body}`;
  const split = Frontmatter.split(file);

  return {
    cls,
    name,
    file,
    body: split.body,
    // A file with frontmatter is cut after its closing fence, one without keeps all of it as the body.
    holds: start.cut ? split.body === body && Option.isSome(split.frontmatter) : split.body === file,
  };
};

// A file of class (p) holds what it says only when the body the split gives starts with U+FEFF.
const withBom = (file: PlacedFile): PlacedFile => ({ ...file, holds: file.holds && file.body.startsWith(Base.BOM) });

// The same body with each line ending turned into one of `\n`, `\r\n` or a lone `\r`, by a rule.
const withEndings = (body: string, rule: (i: number) => string): string => {
  let i = 0;

  return body.replaceAll("\n", () => rule(i++));
};

/** M6's files: classes (d), (n), (o) and (p), each a start and a body. */
export const placedFiles = (run: Run): ReadonlyArray<PlacedFile> => {
  const all = starts(run);
  const written = all[0] ?? { name: "written", text: "", cut: false };
  const body = drawnBlocks(run);
  const turn = run.picks[4] ?? 0;
  const lead = all[(run.picks[5] ?? 0) % all.length] ?? written;

  return [
    placedFile("d", "every block", written, FULL_BODY),
    placedFile("d", "drawn blocks", written, body),
    ...all.map((start) => placedFile("n", start.name, start, FULL_BODY)),
    ...all.map((start) => placedFile("n", `${start.name}, drawn blocks`, start, body)),
    placedFile("o", "LF", lead, FULL_BODY),
    placedFile(
      "o",
      "CRLF",
      lead,
      withEndings(FULL_BODY, () => "\r\n"),
    ),
    placedFile(
      "o",
      "lone CR",
      lead,
      withEndings(FULL_BODY, () => "\r"),
    ),
    placedFile(
      "o",
      "all three mixed",
      lead,
      withEndings(FULL_BODY, (i) => pick(LINE_ENDINGS, i + turn)),
    ),
    placedFile("o", "no final line ending", lead, FULL_BODY.replace(/\n$/u, "")),
    placedFile("o", "an empty first line", lead, `\n${FULL_BODY}`),
    placedFile("o", "an empty first line, CRLF", lead, `\r\n${withEndings(FULL_BODY, () => "\r\n")}`),
    ...all
      .filter((start) => start.cut || start.text === "")
      .flatMap((start) =>
        [FULL_BODY, body].map((text, i) =>
          withBom(
            placedFile(
              "p",
              `${start.name}, U+FEFF first, ${i === 0 ? "every block" : "drawn blocks"}`,
              start,
              `${Base.BOM}${text}`,
            ),
          ),
        ),
      ),
  ];
};
