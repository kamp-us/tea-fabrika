/**
 * The status check (decision 0606) and the reading of a decision's frontmatter that the other checks
 * share. A decision is `.decisions/NNNN-slug.md` with a YAML block between two `---` lines.
 */
import { Effect, Predicate, Result, Schema } from "effect";
import { isMap, isScalar, LineCounter, parseDocument } from "yaml";
import { DecisionId, Finding } from "./Finding.ts";
import { decodeStatus } from "./Status.ts";
import { read, Tracked } from "./Tracked.ts";

/**
 * The keys every decision has today.
 *
 * @category models
 */
export const Decision = Schema.Struct({
  id: DecisionId,
  title: Schema.NonEmptyString,
  status: Schema.Literals(["accepted", "superseded"]),
  successor: Schema.optional(DecisionId),
  date: Schema.String.check(Schema.isPattern(/^\d{4}-\d{2}-\d{2}$/)),
  tags: Schema.Array(Schema.String),
});

/** A decision's frontmatter: its values, and the line of each key in the file. */
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
 * Reads the frontmatter block of a decision, or says why it cannot: there is none, or it is not YAML.
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

/**
 * One tracked decision: its path, its four-digit number from the file name, and its text.
 *
 * @category models
 */
interface DecisionFile {
  readonly path: string;
  readonly number: string;
  readonly text: string;
}

const DECISION = /^\.decisions\/(\d{4})-[^/]+\.md$/;

/**
 * Every tracked, regular `.decisions/NNNN-slug.md`, read.
 *
 * @category constructors
 */
export const decisions = Effect.fnUntraced(function* (root: string) {
  const tracked = yield* Tracked;
  const files = yield* tracked.files;

  const named = files.flatMap((file) => {
    const match = DECISION.exec(file.path);

    return match === null || file.symlink ? [] : [{ path: file.path, number: match[1] ?? "" }];
  });

  const texts = yield* read(
    root,
    named.map((file) => file.path),
  );

  const numbers = new Map(named.map((file) => [file.path, file.number]));

  return texts.map(({ path, text }): DecisionFile => ({ path, number: numbers.get(path) ?? "", text }));
});

const status = (path: string, line: number, raw: string) => Finding.cases.status.make({ path, line, raw });

const problems = (record: DecisionFile, known: ReadonlySet<string>): ReadonlyArray<Finding> => {
  const parsed = parse(record.text);

  if (Result.isFailure(parsed)) {
    return [status(record.path, parsed.failure.line, parsed.failure.raw)];
  }

  const { values, lines } = parsed.success;
  const lineOf = (key: string) => lines.get(key) ?? 1;
  const found: Array<Finding> = [];
  const id = Predicate.hasProperty(values, "id") ? values.id : undefined;

  if (id !== record.number) {
    found.push(status(record.path, lineOf("id"), Predicate.isString(id) ? id : ""));
  }

  const decoded = decodeStatus(values, {
    path: record.path,
    line: lineOf("status"),
    successor: lineOf("successor"),
  });

  if (Result.isFailure(decoded)) {
    found.push(decoded.failure);
  } else if (decoded.success._tag === "superseded" && !known.has(decoded.success.successor)) {
    found.push(status(record.path, lineOf("successor"), decoded.success.successor));
  }

  return found;
};

/**
 * The status check: each decision's `id` is its file's number, its status is one of the two, and a successor names a record in the folder.
 *
 * @category constructors
 */
export const check = Effect.fnUntraced(function* (root: string) {
  const all = yield* decisions(root);
  const known = new Set(all.map((record) => record.number));

  return all.flatMap((record) => problems(record, known));
});
