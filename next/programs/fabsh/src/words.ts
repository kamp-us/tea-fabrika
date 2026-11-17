import { Schema } from "effect";

export const At = Schema.Struct({ start: Schema.Int, end: Schema.Int });

export type At = typeof At.Type;

const Op = Schema.Literals(["|", "&", ";", "$(", ")", "&&", "||"]);

export const Token = Schema.TaggedUnion({
  word: { start: Schema.Int, end: Schema.Int, text: Schema.String },
  op: { start: Schema.Int, end: Schema.Int, op: Op },
});

export type Token = typeof Token.Type;

/** Read shell words without losing their source offsets, including quotes and escapes. */
export function words(line: string) {
  const tokens: Token[] = [];
  const comments: At[] = [];
  let at = 0;
  let open = false;

  while (at < line.length) {
    const char = line.charAt(at);

    if (char === " " || char === "\t" || char === "\r") {
      at += 1;
      continue;
    }

    if (char === "#") {
      const next = line.indexOf("\n", at);
      const end = next < 0 ? line.length : next;
      comments.push({ start: at, end });
      at = end;
      continue;
    }

    const pair = line.slice(at, at + 2);
    const double = pair === "$(" || pair === "&&" || pair === "||" ? pair : null;
    const single = char === "|" || char === "&" || char === ";" || char === ")" ? char : char === "\n" ? ";" : null;

    if (double !== null || single !== null) {
      const op = double ?? single!;
      const length = double === null ? 1 : 2;
      tokens.push(Token.cases.op.make({ start: at, end: at + length, op }));
      at += length;
      continue;
    }

    const start = at;
    let text = "";
    let quote: string | null = null;

    while (at < line.length) {
      const c = line.charAt(at);

      if (quote !== null) {
        if (c === quote) {
          quote = null;
        } else if (quote === '"' && c === "\\" && ['"', "\\"].includes(line.charAt(at + 1))) {
          at += 1;
          text += line.charAt(at);
        } else {
          text += c;
        }

        at += 1;
        continue;
      }

      if (c === "'" || c === '"') {
        quote = c;
        at += 1;
      } else if (c === "\\") {
        text += line.charAt(at + 1);
        at = Math.min(line.length, at + 2);
      } else if (/[ \t\r\n|&;)]/.test(c) || line.slice(at, at + 2) === "$(") {
        break;
      } else {
        text += c;
        at += 1;
      }
    }

    open = quote !== null;
    tokens.push(Token.cases.word.make({ start, end: at, text }));
  }

  const last = tokens.at(-1);
  const trailing = last === undefined || Token.guards.op(last) || (!open && last.end < line.length);
  return { tokens, comments, open, trailing };
}
