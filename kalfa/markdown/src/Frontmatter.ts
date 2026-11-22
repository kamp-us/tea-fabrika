/**
 * Reading and writing the frontmatter of a Markdown file against a Schema, with one YAML reading for both directions.
 */
import { Effect, Option, Predicate, Result, Schema } from "effect";
import type { Node, Pair } from "yaml";
import { Document, isMap, isNode, isScalar, LineCounter, parseDocument, visit } from "yaml";

// The one reading, used by `read` and `write` alike: YAML 1.2's core schema, where only `true`, `false`, `null`, `~` and
// plain numbers are typed, so `0146` is the number 146 and `"0146"` is text. "error" makes a second document an error
// ("silent" drops it with no error) and prints nothing.
const READ = { version: "1.2", schema: "core", logLevel: "error" } as const;

// `lineWidth: 0` writes one value per line and never folds; `aliasDuplicateObjects: false` writes no `&a1` anchors.
const WRITE = { version: "1.2", schema: "core", lineWidth: 0, aliasDuplicateObjects: false } as const;

// A text that plain `stringify` writes as a block scalar or plain scalar that reads back changed is written double-quoted:
// a text with a line break (a first line that is blank and a text that ends in a line break), and a text that starts
// with U+FEFF (a reader drops it at the start of a document).
const NEEDS_QUOTES = /[\n\r]|^﻿/u;

const isFence = (line: string): boolean => line === "---" || line === "---\r";

const lineEnd = (text: string, from: number): number => {
  const found = text.indexOf("\n", from);

  return found < 0 ? text.length : found;
};

const oneLine = (message: string): string =>
  message
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line !== "")
    .join(" ");

// yaml adds ` at line 2, column 1:` and a code frame to a message; the line is its own field here.
const yamlMessage = (message: string): string =>
  (message.split("\n", 1)[0] ?? "").replace(/ at line \d+, column \d+:?$/u, "");

/**
 * A file cut in two: the frontmatter, if the file has it, and the rest.
 *
 * @category models
 */
export interface Split {
  /** The text between the two `---` lines, without them; `""` for an empty block. `Option.none()` when the file has no frontmatter. */
  readonly frontmatter: Option.Option<string>;
  /** The rest of the file, byte for byte, or the whole text when there is no frontmatter. */
  readonly body: string;
}

/**
 * Cuts a file into its frontmatter and its body.
 *
 * **Details**
 *
 * A fence line is `---`, with a `\r` before its line break allowed. The first line must be one, and the frontmatter ends at
 * the next one. A first line that is not a fence, or no second fence, means no frontmatter and the whole text is the body.
 *
 * @category constructors
 */
export const split = (text: string): Split => {
  const none: Split = { frontmatter: Option.none(), body: text };
  const first = lineEnd(text, 0);

  if (!isFence(text.slice(0, first))) {
    return none;
  }

  const start = first + 1;

  for (let at = start; at <= text.length;) {
    const end = lineEnd(text, at);

    if (isFence(text.slice(at, end))) {
      return { frontmatter: Option.some(text.slice(start, at)), body: text.slice(end + 1) };
    }

    at = end + 1;
  }

  return none;
};

/**
 * The file has no frontmatter: its first line is not `---`, or no second `---` line closes the block.
 *
 * @category errors
 */
export class NoFrontmatter extends Schema.TaggedError<NoFrontmatter, { readonly brand: unique symbol }>()(
  "NoFrontmatter",
  {},
) {}

/**
 * The frontmatter cannot be read, or the data cannot be written.
 *
 * **Details**
 *
 * `reason` is `syntax` when the frontmatter is not YAML, `value` when it is YAML but holds what is not a JSON object (a
 * top level that is not a map, a tag that makes a `Set` or a `Date`, `.nan`, a key that is a list, a null key, two keys that
 * give one text; on write, encoded data that is not a JSON object), and `schema` when the caller's Schema refused the data.
 * `line` is the file's line, counted from 1, when one is known. `cause` is the YAML error or the `SchemaError`; ours has none.
 *
 * @category errors
 */
export class BadFrontmatter extends Schema.TaggedError<BadFrontmatter, { readonly brand: unique symbol }>()(
  "BadFrontmatter",
  {
    reason: Schema.Literals(["syntax", "value", "schema"]),
    message: Schema.String,
    line: Schema.optionalKey(Schema.Int),
    cause: Schema.optional(Schema.Defect()),
  },
) {}

type Reason = BadFrontmatter["reason"];

const bad = (
  reason: Reason,
  message: string,
  place: { readonly line?: number | undefined; readonly cause?: unknown } = {},
): BadFrontmatter =>
  new BadFrontmatter({
    reason,
    message,
    ...(place.line === undefined ? {} : { line: place.line }),
    ...(place.cause === undefined ? {} : { cause: place.cause }),
  });

// What yaml says of a position, as a file line: the block starts on the file's second line.
const fileLine = (counter: LineCounter, offset: number | undefined): number | undefined =>
  offset === undefined ? undefined : counter.linePos(offset).line + 1;

const nodeLine = (counter: LineCounter, node: Node | null): number | undefined => fileLine(counter, node?.range?.[0]);

const toJson = Schema.decodeUnknownResult(Schema.JsonObject);

// A key becomes the text its map gives it. Only a text, a number or a boolean scalar has one; the text of a key that is
// null, a list or a map, or that another key of its map gives too, would lose data in yaml's own reading with no error.
const keyText = (pair: Pair): Option.Option<string> =>
  isScalar(pair.key) &&
  (Predicate.isString(pair.key.value) || Predicate.isNumber(pair.key.value) || Predicate.isBoolean(pair.key.value))
    ? Option.some(String(pair.key.value))
    : Option.none();

const unreadableKey = (counter: LineCounter, doc: Document.Parsed): Result.Result<void, BadFrontmatter> => {
  let found: BadFrontmatter | undefined;

  visit(doc, {
    Map(_key, map) {
      const seen = new Set<string>();

      for (const pair of map.items) {
        const line = isNode(pair.key) ? nodeLine(counter, pair.key) : undefined;
        const text = keyText(pair);

        if (Option.isNone(text)) {
          found = bad("value", "A key must be a text, a number or a boolean", { line });

          return visit.BREAK;
        }

        if (seen.has(text.value)) {
          found = bad("value", `Two keys give the text ${JSON.stringify(text.value)}`, { line });

          return visit.BREAK;
        }

        seen.add(text.value);
      }

      return undefined;
    },
  });

  return found === undefined ? Result.succeed(undefined) : Result.fail(found);
};

// The frontmatter's text as a JSON object, or the first thing wrong with it.
const parse = (frontmatter: string): Result.Result<Schema.JsonObject, BadFrontmatter> => {
  const counter = new LineCounter();
  const doc = parseDocument(frontmatter, { ...READ, lineCounter: counter });
  const error = doc.errors[0];

  if (error !== undefined) {
    return Result.fail(
      bad("syntax", yamlMessage(error.message), { line: fileLine(counter, error.pos[0]), cause: error }),
    );
  }

  const warning = doc.warnings[0];

  if (warning !== undefined) {
    return Result.fail(
      bad("value", yamlMessage(warning.message), { line: fileLine(counter, warning.pos[0]), cause: warning }),
    );
  }

  // Blank lines and comments only: the empty map.
  if (doc.contents === null) {
    return Result.succeed({});
  }

  if (!isMap(doc.contents)) {
    return Result.fail(
      bad("value", "The frontmatter must be a map of keys to values", { line: nodeLine(counter, doc.contents) }),
    );
  }

  return Result.flatMap(unreadableKey(counter, doc), () =>
    Result.flatMap(
      Result.try({
        try: () => doc.toJS(),
        catch: (cause) => bad("value", oneLine(String(cause)), { cause }),
      }),
      (value) => Result.mapError(toJson(value), (cause) => bad("value", oneLine(cause.message), { cause })),
    ),
  );
};

/**
 * Reads a file's frontmatter against a Schema, and gives it with the body.
 *
 * **Details**
 *
 * The frontmatter is read as YAML 1.2's core schema, so `id: 0146` is the number 146 and `yes` is the text `"yes"`. It must
 * be a JSON object. The Schema is run on it last, so a Schema made for JSON sees exactly what the file says. Fails with
 * `NoFrontmatter` when the file has none, and with `BadFrontmatter` when it cannot be read or the Schema refuses it. It makes
 * one span, `markdown.frontmatter.read`, and puts no text of the file in it.
 *
 * @category constructors
 */
export const read = Effect.fn("markdown.frontmatter.read")(function* <
  S extends Schema.ConstraintDecoder<unknown, unknown>,
>(
  text: string,
  schema: S,
): Effect.fn.Return<
  { readonly data: S["Type"]; readonly body: string },
  NoFrontmatter | BadFrontmatter,
  S["DecodingServices"]
> {
  const { frontmatter, body } = split(text);

  if (Option.isNone(frontmatter)) {
    return yield* new NoFrontmatter();
  }

  const json = yield* Effect.fromResult(parse(frontmatter.value));

  const data = yield* Schema.decodeUnknownEffect(schema)(json).pipe(
    Effect.mapError((cause) => bad("schema", oneLine(cause.message), { cause })),
  );

  return { data, body };
});

// Sets every text that needs quotes (see NEEDS_QUOTES) to be written double-quoted, keys included.
const quoted = (doc: Document): void => {
  visit(doc, {
    Scalar(_key, node) {
      if (Predicate.isString(node.value) && NEEDS_QUOTES.test(node.value)) {
        node.type = "QUOTE_DOUBLE";
      }
    },
  });
};

const yamlText = (json: Schema.JsonObject): string => {
  if (Object.keys(json).length === 0) {
    return "";
  }

  const doc = new Document(json, WRITE);

  quoted(doc);

  return doc.toString(WRITE);
};

/**
 * Writes a file: the data as the frontmatter, then the body byte for byte.
 *
 * **Details**
 *
 * The data is encoded with the Schema and must come out as a JSON object, which is written as YAML 1.2's core schema, one
 * value per line, with no anchors. A text that would read back as another type is quoted (`"0146"`), and a text with a line
 * break, or that starts with U+FEFF, is written double-quoted. The empty map is written as `---\n---\n`. A value the Schema
 * refuses, or that is not JSON (a `Date`, `NaN`, `undefined`, a bigint), is a `BadFrontmatter` and gives no text.
 *
 * @category constructors
 */
export const write = <S extends Schema.ConstraintEncoder<unknown>>(
  file: { readonly data: S["Type"]; readonly body: string },
  schema: S,
): Result.Result<string, BadFrontmatter> =>
  Schema.encodeResult(schema)(file.data).pipe(
    Result.mapError((cause) => bad("schema", oneLine(cause.message), { cause })),
    Result.flatMap((encoded) =>
      Result.mapError(toJson(encoded), (cause) => bad("value", oneLine(cause.message), { cause })),
    ),
    Result.map((json) => `---\n${yamlText(json)}---\n${file.body}`),
  );
