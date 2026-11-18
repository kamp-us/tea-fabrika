/**
 * The patch check (decision 0605): no record patches another. A decision says what holds now, in its
 * own text, so it has no `## Amendments` section, no sentence that says the rest of an older record
 * still holds, and no sentence that says a rule is carried forward. Fenced and inline code are not read,
 * since 0605 and its neighbors quote the forms they forbid.
 *
 * The heading is read line by line. The two sentences are read as a block, because a sentence breaks
 * across lines and its links hold dots: the prose of a paragraph or list item is joined with single
 * spaces, and each Markdown link is replaced by its text, before the patterns match.
 */
import { Effect } from "effect";
import { Finding } from "./Finding.ts";
import { decisions } from "./Frontmatter.ts";
import { prose } from "./Prose.ts";

/** One prose line, as `prose` reads it. */
type Line = ReturnType<typeof prose>[number];

const HEADING = /^## Amendments\s*$/;

/** A line that ends the block before it and stands alone: a Markdown heading. */
const TITLE = /^\s{0,3}#{1,6}(\s|$)/;

/** A line that starts a list item, and so a block of its own. */
const ITEM = /^\s*([-*+]|\d+\.)\s/;

/** The words each form is, with `rest` or `carried` captured: where the finding's line is. */
const SENTENCES = [
  { form: "still-holds", pattern: /\b(?:the )?(rest)\b[^.]{0,60}\b(?:still )?holds\b/dgi },
  { form: "carried-forward", pattern: /\b(carried) forward\b/dgi },
] as const;

/** `[text](target)` and `[text][reference]`, with its text captured. */
const LINK = /\[([^\]]*)\]\([^)]*\)|\[([^\]]*)\]\[[^\]]*\]/g;

/** A block of prose: its text, and the file line of each character of it. */
interface Block {
  readonly text: string;
  readonly lines: ReadonlyArray<number>;
}

/** Consecutive prose lines as blocks: a blank line, a heading, a list item's start or a fence ends one. */
const blocks = (all: ReadonlyArray<Line>): ReadonlyArray<ReadonlyArray<Line>> => {
  const found: Array<Array<Line>> = [];
  let open: Array<Line> | undefined;

  for (const each of all) {
    const last = open?.[open.length - 1];

    if (each.text.trim() === "" || TITLE.test(each.text)) {
      open = undefined;
    } else if (open === undefined || last === undefined || each.line !== last.line + 1 || ITEM.test(each.text)) {
      open = [each];
      found.push(open);
    } else {
      open.push(each);
    }
  }

  return found;
};

/** The lines joined with single spaces, and each link replaced by its text, keeping the line of every character. */
const joined = (lines: ReadonlyArray<Line>): Block => {
  const text: Array<string> = [];
  const at: Array<number> = [];

  lines.forEach(({ line, text: each }, index) => {
    const trimmed = each.trim();

    if (index > 0) {
      text.push(" ");
      at.push(line);
    }

    for (const char of trimmed) {
      text.push(char);
      at.push(line);
    }
  });

  const flat = text.join("");
  const out: Array<string> = [];
  const lineAt: Array<number> = [];
  let from = 0;

  const keep = (start: number, end: number) => {
    for (let i = start; i < end; i += 1) {
      out.push(flat[i] ?? "");
      lineAt.push(at[i] ?? 0);
    }
  };

  for (const link of flat.matchAll(LINK)) {
    const label = link[1] ?? link[2] ?? "";
    const start = link.index + 1;

    keep(from, link.index);
    keep(start, start + label.length);
    from = link.index + link[0].length;
  }

  keep(from, flat.length);

  return { text: out.join(""), lines: lineAt };
};

/**
 * Every decision's `patch` findings: the heading, the still-holds sentence and the carried-forward sentence, each with the line of the file where it begins.
 *
 * @category constructors
 */
export const check = Effect.fnUntraced(function* (root: string) {
  const all = yield* decisions(root);

  return all.flatMap(({ path, text }) => {
    const lines = text.split("\n");
    const end = lines[0] === "---" ? lines.indexOf("---", 1) : -1;
    const read = prose(text, end + 1);

    const headings = read
      .filter(({ text: each }) => HEADING.test(each))
      .map(({ line }) => Finding.cases.patch.make({ path, line, form: "amendments" }));

    const sentences = blocks(read).flatMap((block) => {
      const { text: flat, lines: at } = joined(block);

      return SENTENCES.flatMap(({ form, pattern }) =>
        [...flat.matchAll(pattern)].map((match) =>
          Finding.cases.patch.make({ path, line: at[match.indices?.[1]?.[0] ?? 0] ?? 0, form }),
        ),
      );
    });

    return [...headings, ...sentences];
  });
});
