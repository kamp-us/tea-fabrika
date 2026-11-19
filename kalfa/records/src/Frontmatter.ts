/**
 * The reading of a file's frontmatter: a YAML block between two `---` lines.
 */
import { Result } from "effect";
import { isMap, isScalar, LineCounter, parseDocument } from "yaml";

/** A file's frontmatter: its values, and the line of each key in the file. */
interface Parsed {
  readonly values: unknown;
  readonly lines: ReadonlyMap<string, number>;
}

/** Frontmatter that cannot be read: what is wrong, and the line it is on. */
interface Unreadable {
  readonly raw: string;
  readonly line: number;
}

/**
 * Reads the frontmatter block of a file, or says why it cannot: there is none, or it is not YAML.
 *
 * **Details**
 *
 * Every value is read as text (YAML's failsafe schema), so `id: 0146`, which the core schema reads as the number 146, stays `"0146"`, the way the file writes it.
 *
 * @category constructors
 */
export const parse = (text: string): Result.Result<Parsed, Unreadable> => {
  const lines = text.split("\n");
  const end = lines.indexOf("---", 1);

  if (lines[0] !== "---" || end < 0) {
    return Result.fail({ raw: "", line: 1 });
  }

  const counter = new LineCounter();
  const doc = parseDocument(lines.slice(1, end).join("\n"), { schema: "failsafe", lineCounter: counter });

  const error = doc.errors[0];

  if (error !== undefined) {
    // The block starts on the file's second line.
    return Result.fail({
      raw: (error.message.split("\n", 1)[0] ?? "").replace(/:$/, ""),
      line: (error.linePos?.[0].line ?? 1) + 1,
    });
  }

  if (!isMap(doc.contents)) {
    return Result.fail({ raw: "", line: 1 });
  }

  const at = new Map<string, number>();

  for (const pair of doc.contents.items) {
    if (isScalar(pair.key) && pair.key.range != null) {
      // The block starts on the file's second line.
      at.set(String(pair.key.value), counter.linePos(pair.key.range[0]).line + 1);
    }
  }

  return Result.succeed({ values: doc.toJS(), lines: at });
};
