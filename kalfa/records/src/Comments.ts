/**
 * The comments of a code file, line by line, so a rule about what comments say (a path to a record,
 * 0607) never reads a string or a statement. Two grammars: `//` and block comments for the
 * JavaScript family, and `#` for shell and YAML.
 */

/**
 * One line of comment text: its number from 1, and what is on it.
 *
 * @category models
 */
interface Line {
  readonly line: number;
  readonly text: string;
}

type Mode = "code" | "'" | '"' | "`" | "//" | "/*";

/** The comments of a TypeScript or JavaScript file. A quote ends at its line, as a string cannot cross one. */
const slashes = (text: string): ReadonlyArray<Line> => {
  const out: Array<Line> = [];
  let mode: Mode = "code";
  let line = 1;
  let from = 0;
  let i = 0;

  const flush = (end: number) => out.push({ line, text: text.slice(from, end) });

  while (i < text.length) {
    const here = text[i];
    const next = text[i + 1];

    if (here === "\n") {
      if (mode === "//") {
        flush(i);
        mode = "code";
      } else if (mode === "/*") {
        flush(i);
        from = i + 1;
      } else if (mode === "'" || mode === '"') {
        mode = "code";
      }

      line += 1;
      i += 1;
    } else if (mode === "code") {
      if (here === "/" && next === "/") {
        mode = "//";
        from = i;
        i += 2;
      } else if (here === "/" && next === "*") {
        mode = "/*";
        from = i;
        i += 2;
      } else {
        mode = here === "'" || here === '"' || here === "`" ? here : "code";
        i += 1;
      }
    } else if (mode === "/*") {
      if (here === "*" && next === "/") {
        flush(i + 2);
        mode = "code";
        i += 2;
      } else {
        i += 1;
      }
    } else if (mode === "//") {
      i += 1;
    } else if (here === "\\") {
      i += next === "\n" ? 1 : 2;
    } else {
      mode = here === mode ? "code" : mode;
      i += 1;
    }
  }

  if (mode === "//" || mode === "/*") {
    flush(text.length);
  }

  return out;
};

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
 * The comments of `text`, by the kind of file: `hash` for shell and YAML, `slashes` for the rest.
 *
 * @category constructors
 */
export const comments = (text: string, grammar: "slashes" | "hash"): ReadonlyArray<Line> =>
  grammar === "hash" ? hashes(text) : slashes(text);
