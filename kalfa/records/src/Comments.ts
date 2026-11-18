/**
 * The comments of a code file, line by line, so a rule about what comments say (a path to a record,
 * 0607) never reads a string, a regex literal or a statement. oxc reads the JavaScript family, as
 * `next/apps/fabrika/src/exam/edges.ts` does; the `#` comments of shell and YAML have a small reader here.
 */
import { parseSync } from "oxc-parser";

/**
 * One line of comment text: its number from 1, and what is on it.
 *
 * @category models
 */
interface Line {
  readonly line: number;
  readonly text: string;
}

/** The comments of a `.ts`, `.tsx`, `.js` or `.mjs` file, each split at its line breaks. */
const slashes = (file: string, text: string): ReadonlyArray<Line> => {
  const found: Array<Line> = [];
  let line = 1;
  let from = 0;

  // oxc lists the comments in file order, so the line of each follows from the one before.
  for (const comment of parseSync(file, text).comments) {
    line += text.slice(from, comment.start).split("\n").length - 1;
    from = comment.start;

    const each = text.slice(comment.start, comment.end).split("\n");

    for (const [index, part] of each.entries()) {
      found.push({ line: line + index, text: part });
    }
  }

  return found;
};

// No catalog parser reads shell, and a `#` after a quote in YAML is the one rule shared by both files.
/** The comments of a shell or YAML file: a `#` at the start of a line or after a space, outside quotes. */
const hashes = (text: string): ReadonlyArray<Line> =>
  text.split("\n").flatMap((each, index) => {
    let quote: string | undefined;

    for (let i = 0; i < each.length; i += 1) {
      const here = each[i];

      if (quote !== undefined) {
        quote = here === quote ? undefined : quote;
      } else if (here === "'" || here === '"') {
        quote = here;
      } else if (here === "#" && (i === 0 || each[i - 1] === " " || each[i - 1] === "\t")) {
        return [{ line: index + 1, text: each.slice(i) }];
      }
    }

    return [];
  });

/**
 * The comments of the file `file` with this `text`, by the kind of file: `#` for shell and YAML, `//` and block comments for the rest.
 *
 * @category constructors
 */
export const comments = (file: string, text: string): ReadonlyArray<Line> =>
  /\.(sh|yaml)$/.test(file) ? hashes(text) : slashes(file, text);
