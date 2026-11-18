/**
 * The lines of a Markdown text that a rule about prose reads: outside fenced code, with inline code
 * taken out. A record may quote the forms it forbids (0605) and a skill may show a link to a record
 * as an example, so what is code is not read.
 */

/**
 * One line outside fenced code: its number from 1, and its text with each inline code span removed.
 *
 * @category models
 */
interface Line {
  readonly line: number;
  readonly text: string;
}

const OPEN = /^ {0,3}(`{3,}|~{3,})(.*)$/;

const CLOSE = /^ {0,3}(`{3,}|~{3,})\s*$/;

const SPAN = /(?<!`)(`+)(?!`)(.+?)(?<!`)\1(?!`)/g;

/**
 * Reads the lines of `text` from index `from` (counted from 0), as CommonMark reads fences: three or more backticks or tildes open one, and a line of the same mark, at least as long, closes it.
 *
 * @category constructors
 */
export const prose = (text: string, from = 0): ReadonlyArray<Line> => {
  const lines: Array<Line> = [];
  let fence: string | undefined;

  text.split("\n").forEach((each, index) => {
    if (index < from) {
      return;
    }

    if (fence !== undefined) {
      const close = CLOSE.exec(each)?.[1];

      if (close !== undefined && close[0] === fence[0] && close.length >= fence.length) {
        fence = undefined;
      }

      return;
    }

    const open = OPEN.exec(each);

    // A backtick fence's info string holds no backtick: otherwise the line is a code span.
    if (open?.[1] !== undefined && !(open[1][0] === "`" && (open[2] ?? "").includes("`"))) {
      fence = open[1];

      return;
    }

    lines.push({ line: index + 1, text: each.replace(SPAN, "") });
  });

  return lines;
};
