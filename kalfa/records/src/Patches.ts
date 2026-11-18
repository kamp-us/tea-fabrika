/**
 * The patch check (decision 0605): no record patches another. A decision says what holds now, in its
 * own text, so it has no `## Amendments` section, no sentence that says the rest of an older record
 * still holds, and no sentence that says a rule is carried forward. Fenced and inline code are not read,
 * since 0605 and its neighbors quote the forms they forbid.
 *
 * The record is read as Markdown (`Markdown.ts`): each heading, paragraph, list item's paragraph and
 * table cell is a block, with its links replaced by their text. The two sentences are read one sentence
 * at a time, since a sentence breaks across lines and its links hold dots, and only a sentence that holds
 * a record reference is a patch: plain English that says "the rest holds" or "carried forward" about a
 * note, a count or a date is not.
 */
import { Effect } from "effect";
import { Finding } from "./Finding.ts";
import { decisions } from "./Frontmatter.ts";
import { markdown } from "./Markdown.ts";

/** The words each form is, with `rest` or `carried` captured: where the finding's line is. */
const SENTENCES = [
  { form: "still-holds", pattern: /\b(?:the )?(rest)\b[^.]{0,60}\b(?:still )?holds\b/dgi },
  { form: "carried-forward", pattern: /\b(carried) forward\b/dgi },
] as const;

/** A date, which holds a four-digit number that is a year and not a record. */
const DATE = /\b\d{4}-\d{2}-\d{2}\b/g;

/** A record's number: four digits on their own. */
const NUMBER = /\b\d{4}\b/;

/** The ranges of a block's text that are one sentence each: one ends at `.`, `!` or `?` and a space, or the block's end. */
const sentences = (text: string): ReadonlyArray<{ readonly start: number; readonly end: number }> => {
  const found: Array<{ start: number; end: number }> = [];
  let start = 0;

  for (let i = 0; i < text.length; i += 1) {
    const end = ".!?".includes(text[i] ?? "") && (i + 1 === text.length || /\s/.test(text[i + 1] ?? ""));

    if (end || i + 1 === text.length) {
      found.push({ start, end: i + 1 });
      start = i + 1;
    }
  }

  return found;
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

    return markdown(text, end + 1).blocks.flatMap((block) => {
      const heading =
        block.heading === 2 && block.text.trim() === "Amendments"
          ? [Finding.cases.patch.make({ path, line: block.line, form: "amendments" })]
          : [];

      const found = sentences(block.text).flatMap(({ start, end: stop }) => {
        const sentence = block.text.slice(start, stop);
        const referenced = NUMBER.test(sentence.replace(DATE, "")) || block.refs.slice(start, stop).includes(true);

        return referenced
          ? SENTENCES.flatMap(({ form, pattern }) =>
              [...sentence.matchAll(pattern)].map((match) =>
                Finding.cases.patch.make({
                  path,
                  line: block.lines[start + (match.indices?.[1]?.[0] ?? 0)] ?? 0,
                  form,
                }),
              ),
            )
          : [];
      });

      return [...heading, ...found];
    });
  });
});
