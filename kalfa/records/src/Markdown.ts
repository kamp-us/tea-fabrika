/**
 * Markdown read as Markdown, for the rules about what prose says (0605, 0607). micromark reads it, as
 * `programs/markdown` does, with GitHub's tables: fenced and indented code and inline code are code
 * and so are never read as prose, a link's text may wrap, and a table cell is its own place.
 */
import type * as Mdast from "mdast";
import { fromMarkdown } from "mdast-util-from-markdown";
import { gfmFromMarkdown } from "mdast-util-gfm";
import { gfm } from "micromark-extension-gfm";

/**
 * One link or link definition: where it points, and the line of its target, counted from 1: the line of the `)` of an inline link, and the line of a definition.
 *
 * @category models
 */
interface Link {
  readonly url: string;
  readonly line: number;
}

/**
 * One block of prose: a heading, a paragraph, or a table cell, with each link replaced by its text, inline code left out and a line break read as a space. A list item's paragraph is a paragraph.
 *
 * **Details**
 *
 * `lines` and `refs` hold one entry for each character of `text`: the line of the file the character is on, and whether it is in the text of a link to a `NNNN-slug.md` record.
 *
 * @category models
 */
interface Block {
  readonly text: string;
  readonly lines: ReadonlyArray<number>;
  readonly refs: ReadonlyArray<boolean>;
  /** The depth of the heading, or `0` for any other block. */
  readonly heading: number;
  /** The line the block begins on. */
  readonly line: number;
}

/** A link target that is a record: a file named `NNNN-slug.md`. */
const RECORD = /(^|\/)\d{4}-[^/#?]*\.md([#?].*)?$/;

/** Characters collected, with the file line of each and whether it is in the text of a link to a record. */
interface Chars {
  readonly text: Array<string>;
  readonly lines: Array<number>;
  readonly refs: Array<boolean>;
}

/** The text of inline nodes, appended to `out`. */
const inline = (nodes: ReadonlyArray<Mdast.PhrasingContent>, out: Chars, ref: boolean) => {
  for (const node of nodes) {
    const line = node.position?.start.line ?? 0;

    switch (node.type) {
      case "text": {
        // A line break in the value is a line break of the file, and the next character is on the next line.
        let at = line;

        for (const char of node.value) {
          out.text.push(char === "\n" ? " " : char);
          out.lines.push(at);
          out.refs.push(ref);
          at += char === "\n" ? 1 : 0;
        }

        break;
      }

      case "break":
        out.text.push(" ");
        out.lines.push(line);
        out.refs.push(ref);
        break;
      case "link":
        inline(node.children, out, ref || RECORD.test(node.url));
        break;
      case "linkReference":
      case "emphasis":
      case "strong":
      case "delete":
        inline(node.children, out, ref);
        break;
      default:
        // Inline code, images, HTML and footnote references say nothing in words.
        break;
    }
  }
};

/** What a block is made of: the heading, paragraph or cell's own inline nodes. */
const block = (node: Mdast.Heading | Mdast.Paragraph | Mdast.TableCell): Block => {
  const out: Chars = { text: [], lines: [], refs: [] };

  inline(node.children, out, false);

  return {
    text: out.text.join(""),
    lines: out.lines,
    refs: out.refs,
    heading: node.type === "heading" ? node.depth : 0,
    line: node.position?.start.line ?? 0,
  };
};

/**
 * Reads a Markdown `text`: its links and link definitions, and its blocks of prose, each in file order. Lines before index `from` (counted from 0) are not read, as a decision's frontmatter is not prose.
 *
 * @category constructors
 */
export const markdown = (
  text: string,
  from = 0,
): { readonly links: ReadonlyArray<Link>; readonly blocks: ReadonlyArray<Block> } => {
  // Blank lines in place of the skipped ones, so every line keeps its number.
  const source = text
    .split("\n")
    .map((each, index) => (index < from ? "" : each))
    .join("\n");

  const tree = fromMarkdown(source, { extensions: [gfm()], mdastExtensions: [gfmFromMarkdown()] });
  const links: Array<Link> = [];
  const blocks: Array<Block> = [];

  const visit = (node: Mdast.Nodes) => {
    if (node.type === "link") {
      links.push({ url: node.url, line: node.position?.end.line ?? 0 });
    } else if (node.type === "definition") {
      links.push({ url: node.url, line: node.position?.start.line ?? 0 });
    } else if (node.type === "heading" || node.type === "paragraph" || node.type === "tableCell") {
      blocks.push(block(node));
    }

    if ("children" in node) {
      node.children.forEach(visit);
    }
  };

  visit(tree);

  return { links, blocks };
};
