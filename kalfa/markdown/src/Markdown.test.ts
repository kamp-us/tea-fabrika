// Ticket 1928: reading a body into a document. Laws M1 to M7.
//
// Every property law takes one `run` (see Markdown.test-support.ts) and checks it once per class of input, so each class is reached in every
// run. A law keeps the class ids it checked and fails when one of its classes is not all there, or when a body does not hold what its class says.
// Each plant below is one wrong rule in Markdown.ts, run once by hand against a copy of the product and never kept.
import { expect, it } from "@effect/vitest";
import { deepStrictEqual, strictEqual } from "@effect/vitest/utils";
import * as Base from "./Frontmatter.test-support.ts";
import * as Frontmatter from "./Frontmatter.ts";
import * as Support from "./Markdown.test-support.ts";
import * as Markdown from "./Markdown.ts";

const runs = (count: number) => ({ arbitrary: { runs: count } });

// A body or a file, cut short for a message.
const short = (text: string): string => JSON.stringify(text).slice(0, 120);

// The types of a document's parts, in order, every one of them.
const partTypes = (document: Markdown.Document): ReadonlySet<string> =>
  new Set(Support.walk(document).map(({ node }) => node.type));

// The first child of the root that is a heading of depth 1: the line a caller writes, as the README says.
const firstTitle = (document: Markdown.Document) =>
  document.children.find((part) => part.type === "heading" && part.depth === 1);

// M1. Plants: throw on U+0000 or a lone surrogate before reading, (a) red; drop the `tasklistCheck` line, so the development build throws and
// the default one puts `checked` on the root and loses `[ ]`, (b) red; give a part with no position its parent's, so siblings overlap, (c) red;
// read without `gfm()`, so a table is a paragraph and its cells' text runs together, (d) red.
it.prop(
  "M1 any text is a document: it returns, the root holds only type, children and position, every part has its place, and a check keeps its [ ]",
  { run: Support.run },
  ({ run }) => {
    const seen = new Set<string>();

    for (const variant of Support.anyBodies(run)) {
      const label = `${variant.cls} ${variant.name} ${short(variant.body)}`;

      strictEqual(variant.holds, true, `${label}: the body does not hold what its class says`);

      const document = Markdown.parse(variant.body);

      deepStrictEqual(Support.problems(document, variant.body), [], label);

      if (variant.check !== undefined) {
        expect(Support.plain(document), `${label}: the check is lost`).toContain(variant.check);
      }

      for (const type of variant.types ?? []) {
        expect(partTypes(document).has(type), `${label}: no ${type} in the document`).toBe(true);
      }

      seen.add(variant.cls);
    }

    deepStrictEqual(Support.unreached(seen, Support.ANY_REQUIRED), [], "classes never checked in this run");
  },
  runs(300),
);

// M2. Plant: cut a leading `---` block inside `parse`, as if it read frontmatter: the whole file shows no thematic break, red.
it("scenario: M2 a body, not a file: a whole file gives a thematic break and a level-two heading, its body gives the one title", () => {
  const file = "---\ntitle: x\n---\n# A\n";
  const whole = Markdown.parse(file);

  deepStrictEqual(
    whole.children.map((part) => part.type),
    ["thematicBreak", "heading", "heading"],
  );

  const [, second, third] = whole.children;

  strictEqual(second?.type === "heading" ? second.depth : undefined, 2);
  strictEqual(second === undefined ? undefined : Support.plain(second), "title: x");
  strictEqual(third?.type === "heading" ? third.depth : undefined, 1);

  const body = Markdown.parse(Frontmatter.split(file).body);

  strictEqual(body.children.length, 1);

  const title = firstTitle(body);

  strictEqual(title === undefined ? undefined : Support.plain(title), "A");
});

// M3. Plants, each an exit handler in `parse`'s mdast options that keeps the typed mark in `data`: on strong and emphasis, (e) red; on lists and
// list items, (f) red; on headings, (g) red; on code, (h) red.
// Each class is a law of its own with 300 runs: one law over the four took 30 s of CI's 60 s limit, so a law holds a quarter of a run's parses.
for (const cls of Support.PAIR_CLASSES) {
  it.prop(
    `M3 two typings give one document, class ${cls}: the bodies differ and their documents are equal once every position is removed`,
    { run: Support.run },
    ({ run }) => {
      const seen = new Set<string>();

      for (const pair of Support.typedPairs(run, cls)) {
        const label = `${pair.cls} ${pair.name}`;

        strictEqual(pair.holds, true, `${label}: the two bodies are the same`);
        expect(pair.a, `${label}: the bodies are the same`).not.toBe(pair.b);

        deepStrictEqual(
          Support.withoutPosition(Markdown.parse(pair.a)),
          Support.withoutPosition(Markdown.parse(pair.b)),
          `${label}: ${short(pair.a)} against ${short(pair.b)}`,
        );

        seen.add(pair.cls);
      }

      deepStrictEqual(Support.unreached(seen, [cls]), [], "classes never checked in this run");
    },
    runs(300),
  );
}

// M4. Plants: turn off `codeFenced`, so the fenced `# T` is a heading, (i) red; turn off `codeIndented`, so a four-space `# T` is a heading, (j) red.
it.prop(
  "M4 code is code: a block's lines are one code part's value, and no heading, list, table, quote or thematic break comes from them",
  { run: Support.run },
  ({ run }) => {
    const seen = new Set<string>();

    for (const variant of Support.codeBodies(run)) {
      const label = `${variant.cls} ${variant.name} ${short(variant.body)}`;

      strictEqual(variant.holds, true, `${label}: the body does not hold what its class says`);

      const document = Markdown.parse(variant.body);
      const parts = Support.walk(document).map(({ node }) => node);
      const count = (type: string) => parts.filter((node) => node.type === type).length;

      const values = parts.flatMap((node) => (node.type === "code" ? [node.value] : []));

      deepStrictEqual(values, [variant.lines.join("\n")], `${label}: the code parts' values`);

      for (const type of ["heading", "table", "thematicBreak"]) {
        strictEqual(count(type), 0, `${label}: a ${type} came from the block`);
      }

      strictEqual(count("list"), variant.lists, `${label}: lists`);
      strictEqual(count("blockquote"), variant.quotes, `${label}: block quotes`);

      seen.add(variant.cls);
    }

    deepStrictEqual(Support.unreached(seen, Support.CODE_REQUIRED), [], "classes never checked in this run");
  },
  runs(300),
);

// M5. Plants: turn off `setextUnderline`, so a setext title is a paragraph, (k) red; turn off `codeFenced`, so `# fake` comes first, (l) red;
// turn off `codeIndented`, so `    # fake` is a heading, (m) red.
it.prop(
  "M5 the first level-one heading, from the document alone: the first such child of the root has the answer's text, or there is none",
  { run: Support.run },
  ({ run }) => {
    const seen = new Set<string>();

    for (const variant of Support.headingBodies(run)) {
      const label = `${variant.cls} ${variant.name} ${short(variant.body)}`;

      strictEqual(variant.holds, true, `${label}: the body does not hold what its class says`);

      const title = firstTitle(Markdown.parse(variant.body));

      strictEqual(title === undefined ? undefined : Support.plain(title), variant.answer, label);

      seen.add(variant.cls);
    }

    deepStrictEqual(Support.unreached(seen, Support.HEADING_REQUIRED), [], "classes never checked in this run");
  },
  runs(300),
);

// M6. Plants: turn each tab into four spaces before reading, (d) red; drop a leading `---` line before reading, as if it were a fence, (n) red;
// turn each `\r\n` into `\n` before reading, (o) red; turn a leading U+FEFF into a space before reading, so it is counted, (p) red.
it.prop(
  "M6 a part's place in the file: its line plus the line endings before the body, its column, its offset plus the length before it, plus one for U+FEFF",
  { run: Support.run },
  ({ run }) => {
    const seen = new Set<string>();

    for (const variant of Support.placedFiles(run)) {
      const label = `${variant.cls} ${variant.name} ${short(variant.file)}`;

      strictEqual(variant.holds, true, `${label}: the file does not hold what its class says`);

      // The README's rule: the text before the body is the file less the body, since the body is the end of the file byte for byte.
      const before = variant.file.slice(0, variant.file.length - variant.body.length);
      const bom = variant.body.startsWith(Base.BOM) ? 1 : 0;
      const lines = Support.endings(before);
      const document = Markdown.parse(variant.body);

      for (const { node } of Support.walk(document)) {
        for (const [which, point] of [
          ["start", node.position?.start],
          ["end", node.position?.end],
        ] as const) {
          if (point === undefined) {
            continue;
          }

          strictEqual(point.offset === undefined, false, `${label}: a ${node.type} ${which} has no offset`);

          const offset = (point.offset ?? 0) + before.length + bom;
          const line = point.line + lines;
          const column = point.column + (bom === 1 && point.line === 1 ? 1 : 0);

          deepStrictEqual(
            { line, column },
            Support.locate(variant.file, offset),
            `${label}: the ${node.type} ${which} at ${point.line}:${point.column}:${point.offset}`,
          );
        }
      }

      seen.add(variant.cls);
    }

    deepStrictEqual(Support.unreached(seen, Support.PLACED_REQUIRED), [], "classes never checked in this run");
  },
  runs(300),
);

// M7. Plants: read without `gfm()`, so the table is a paragraph, red; drop the `tasklistCheck` line, so the item is `checked: false`, red.
it("pinned: M7 the parts of GitHub's Markdown the README states: a table's alignment, strikethrough, a link literal, a footnote, and a check as text", () => {
  const table = Markdown.parse("| a | b | c |\n|:-|:-:|-:|\n| 1 | 2 | 3 |\n");
  const first = table.children[0];

  strictEqual(first?.type, "table");
  deepStrictEqual(first?.type === "table" ? first.align : undefined, ["left", "center", "right"]);

  expect(partTypes(Markdown.parse("~~s~~\n")).has("delete")).toBe(true);
  expect(partTypes(Markdown.parse("www.x.com\n")).has("link")).toBe(true);

  const footnote = partTypes(Markdown.parse("a[^1]\n\n[^1]: n\n"));

  expect(footnote.has("footnoteReference")).toBe(true);
  expect(footnote.has("footnoteDefinition")).toBe(true);

  const checked = Markdown.parse("- [ ] a\n");
  const list = checked.children[0];
  const item = list?.type === "list" ? list.children[0] : undefined;

  strictEqual(item?.type, "listItem");
  strictEqual(item?.checked, null);
  strictEqual(item === undefined ? undefined : Support.plain(item), "[ ] a");
});
