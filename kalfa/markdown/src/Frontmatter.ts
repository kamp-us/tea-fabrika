/**
 * Reading and writing the frontmatter of a Markdown file against a Schema, with one YAML reading for both directions.
 */
import { Effect, Equal, Option, Predicate, Result, Schema } from "effect";
import type { Node, Pair, YAMLMap } from "yaml";
import { Document, isMap, isNode, isScalar, isSeq, LineCounter, parseDocument, visit } from "yaml";

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
 * top level that is not a map, a tag that makes a `Set` or a `Date`, `.nan` or `.inf` as a value or a key, a key that is a
 * list, a null key, two keys that give one text; on write and set, encoded data that is not a JSON object), `schema` when
 * the caller's Schema refused the data, and `edit` when `set` cannot make its change in the file's text without changing
 * other data (an alias elsewhere uses the old value's anchor, or the pair has no `:` to set a value after). `line` is the
 * file's line, counted from 1, when one is known. `cause` is the YAML error or the `SchemaError`; ours has none.
 *
 * @category errors
 */
export class BadFrontmatter extends Schema.TaggedError<BadFrontmatter, { readonly brand: unique symbol }>()(
  "BadFrontmatter",
  {
    reason: Schema.Literals(["syntax", "value", "schema", "edit"]),
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

const schemaFailure = (cause: Schema.SchemaError): BadFrontmatter => bad("schema", oneLine(cause.message), { cause });

const valueFailure = (cause: Schema.SchemaError): BadFrontmatter => bad("value", oneLine(cause.message), { cause });

// A key becomes the text its map gives it. Only a text, a finite number or a boolean scalar has one; the text of a key that
// is null, a list or a map, or that another key of its map gives too, would lose data in yaml's own reading with no error,
// and so would `.nan` and `.inf`, which would read as the texts "NaN" and "Infinity".
const keyText = (pair: Pair): Option.Option<string> => {
  const key = pair.key;

  return isScalar(key) &&
    (Predicate.isString(key.value) ||
      Predicate.isBoolean(key.value) ||
      (Predicate.isNumber(key.value) && Number.isFinite(key.value)))
    ? Option.some(String(key.value))
    : Option.none();
};

const unreadableKey = (counter: LineCounter, doc: Document.Parsed): Result.Result<void, BadFrontmatter> => {
  let found: BadFrontmatter | undefined;

  visit(doc, {
    Map(_key, map) {
      const seen = new Set<string>();

      for (const pair of map.items) {
        const line = isNode(pair.key) ? nodeLine(counter, pair.key) : undefined;
        const text = keyText(pair);

        if (Option.isNone(text)) {
          found = bad("value", "A key must be a text, a finite number or a boolean", { line });

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

interface Reading {
  readonly doc: Document.Parsed;
  readonly json: Schema.JsonObject;
}

// The frontmatter's text as a JSON object, with the YAML document it came from, or the first thing wrong with it.
// `keepSourceTokens` makes no difference to what is read: it only lets `set` find where each value's text is.
const reading = (frontmatter: string, keepSourceTokens: boolean): Result.Result<Reading, BadFrontmatter> => {
  const counter = new LineCounter();
  const doc = parseDocument(frontmatter, { ...READ, keepSourceTokens, lineCounter: counter });
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
    return Result.succeed({ doc, json: {} });
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
      (value) => Result.map(Result.mapError(toJson(value), valueFailure), (json) => ({ doc, json })),
    ),
  );
};

const parse = (frontmatter: string): Result.Result<Schema.JsonObject, BadFrontmatter> =>
  Result.map(reading(frontmatter, false), ({ json }) => json);

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

  const data = yield* Schema.decodeUnknownEffect(schema)(json).pipe(Effect.mapError(schemaFailure));

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

// `flow` writes every list and map on one line with no padding inside (`[a, b]`, `{x: 1}`), the way `set` writes a value that
// sits on its key's line.
const FLOW = { ...WRITE, collectionStyle: "flow", flowCollectionPadding: false } as const;

const written = (json: Schema.JsonObject, options: typeof WRITE | typeof FLOW): string => {
  const doc = new Document(json, options);

  quoted(doc);

  return doc.toString(options);
};

const yamlText = (json: Schema.JsonObject): string => (Object.keys(json).length === 0 ? "" : written(json, WRITE));

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
    Result.mapError(schemaFailure),
    Result.flatMap((encoded) => Result.mapError(toJson(encoded), valueFailure)),
    Result.map((json) => `---\n${yamlText(json)}---\n${file.body}`),
  );

type Json = Schema.JsonObject[string];

/** One replacement in the frontmatter's text: the bytes from `from` up to `to` become `text`. */
interface Edit {
  readonly from: number;
  readonly to: number;
  readonly text: string;
}

/** Where one pair's value text is, and how a new value is written there. */
interface Spot {
  readonly from: number;
  readonly to: number;
  readonly write: (value: Json) => string;
}

const nonEmpty = (value: Json): boolean =>
  Array.isArray(value) ? value.length > 0 : Predicate.isObject(value) && Object.keys(value).length > 0;

// `{k: <value>}` with a one letter key: the value's own text is what lies between the braces.
const flowLine = (value: Json): string => written({ k: value }, FLOW).slice("{k: ".length, -"}\n".length);

// `k:` and then the value's lines, each indented by two: the lines, with the indent taken off.
const blockLines = (value: Json): ReadonlyArray<string> =>
  written({ k: value }, WRITE)
    .split("\n")
    .slice(1, -1)
    .map((line) => line.slice(2));

const mapIndent = (map: YAMLMap | undefined): number => (map?.srcToken?.type === "block-map" ? map.srcToken.indent : 0);

const valueRange = (pair: Pair) => (isNode(pair.value) ? pair.value.range : undefined);

const keyRange = (pair: Pair) => (isNode(pair.key) ? pair.key.range : undefined);

const colonToken = (pair: Pair) => pair.srcToken?.sep?.find((token) => token.type === "map-value-ind");

// The first byte after a pair's text, whatever of it there is.
const pairEnd = (pair: Pair): number =>
  Math.max(valueRange(pair)?.[1] ?? 0, (colonToken(pair)?.offset ?? -1) + 1, keyRange(pair)?.[1] ?? 0);

// A value's text runs from its first tag or anchor, else its start, to the end yaml gives it: a comment after it is not in
// it, a block value's last line break is, and so is a comment inside it. A pair with no `:` has none to set a value after.
const findSpot = (pair: Pair, frontmatter: string, map: YAMLMap, eol: string): Option.Option<Spot> => {
  const colon = colonToken(pair);

  if (colon === undefined) {
    return Option.none();
  }

  const after = pair.srcToken?.sep?.slice(pair.srcToken.sep.indexOf(colon) + 1) ?? [];
  const props = after.filter((token) => token.type === "tag" || token.type === "anchor");
  const range = valueRange(pair);
  const from = props[0]?.offset ?? range?.[0];
  const to = Math.max(range?.[1] ?? 0, ...props.map((token) => token.offset + token.source.length));

  // No value text: the new one goes right after the `:`, so a space, a comment or the line's end stays after it.
  if (from === undefined || (props.length === 0 && from === to)) {
    const at = colon.offset + 1;

    return Option.some({ from: at, to: at, write: (value) => ` ${flowLine(value)}` });
  }

  // When the old text ended with a line break, the new text does too.
  const ending = frontmatter.slice(from, to).endsWith("\n") ? eol : "";

  if (map.flow === true || !frontmatter.slice(colon.offset, from).includes("\n")) {
    return Option.some({ from, to, write: (value) => `${flowLine(value)}${ending}` });
  }

  // On a later line: a list or map is block style at the old value's column, and anything else is one line there. A list that
  // sat at its key's column keeps it, and anything else goes two past it, or it would not be the key's value.
  const column = from - (frontmatter.lastIndexOf("\n", from - 1) + 1);
  const value = pair.value;
  const compact = isSeq(value) && value.srcToken?.type === "block-seq" && value.srcToken.indent === mapIndent(map);

  return Option.some({
    from,
    to,
    write: (item) => {
      if (!nonEmpty(item)) {
        return `${" ".repeat(compact ? 2 : 0)}${flowLine(item)}${ending}`;
      }

      const deeper = compact && !Array.isArray(item) ? 2 : 0;

      return `${blockLines(item)
        .map((line, i) => " ".repeat(i === 0 ? deeper : column + deeper) + line)
        .join(eol)}${ending}`;
    },
  });
};

// The keys the file lacks, written as `write` writes them at the first key's column, at the end of the frontmatter, or, in a
// top level flow map, after its last pair.
const newKeysEdit = (frontmatter: string, map: YAMLMap | undefined, added: Schema.JsonObject, eol: string): Edit => {
  if (map?.flow === true) {
    const pairs = written(added, FLOW).slice(1, -"}\n".length);
    const last = map.items.at(-1);
    const at = last === undefined ? (map.srcToken?.offset ?? 0) + 1 : pairEnd(last);

    return { from: at, to: at, text: last === undefined ? pairs : `, ${pairs}` };
  }

  const text = yamlText(added)
    .replace(/^(?!$)/gmu, " ".repeat(mapIndent(map)))
    .replaceAll("\n", eol);

  return { from: frontmatter.length, to: frontmatter.length, text };
};

const splice = (text: string, edits: ReadonlyArray<Edit>): string =>
  edits.reduceRight((acc, edit) => acc.slice(0, edit.from) + edit.text + acc.slice(edit.to), text);

// One edit for each changed key the file has, then one for all that it lacks. The edits are in order of place, and one at the
// same place as another stays after it, so `splice` applies from the end and no offset moves under it.
const editsFor = (
  frontmatter: string,
  map: YAMLMap | undefined,
  changed: ReadonlyArray<readonly [string, Json]>,
  eol: string,
): Result.Result<ReadonlyArray<Edit>, BadFrontmatter> => {
  const edits: Array<Edit> = [];
  const added: Array<readonly [string, Json]> = [];

  for (const [key, value] of changed) {
    const pair = map?.items.find((item) => Option.getOrUndefined(keyText(item)) === key);

    if (map === undefined || pair === undefined) {
      added.push([key, value]);
      continue;
    }

    const spot = findSpot(pair, frontmatter, map, eol);

    if (Option.isNone(spot)) {
      return Result.fail(bad("edit", `The key ${JSON.stringify(key)} has no colon to set a value after`));
    }

    edits.push({ from: spot.value.from, to: spot.value.to, text: spot.value.write(value) });
  }

  edits.sort((a, b) => a.from - b.from);

  return Result.succeed(
    added.length === 0 ? edits : [...edits, newKeysEdit(frontmatter, map, Object.fromEntries(added), eol)],
  );
};

/**
 * Sets values in a file's frontmatter and keeps every other byte.
 *
 * **Details**
 *
 * The file's frontmatter is read and decoded with the Schema, `values` are put over the data, and the result is encoded.
 * Each top level key whose encoded value changed has only its value's text replaced, so a comment after it, the other
 * lines, their spacing and style, the fences and the body are the same bytes. A key the file lacks gets its lines at the end
 * of the frontmatter. A new value is written as `write` writes it: on its key's line in flow style (`[a, b]`, `{x: 1}`), on
 * a later line in block style. The line break is the file's. Values that change nothing give the text back as it came. It
 * never removes a key, and it changes no key below the top level.
 *
 * Before any text comes back the edited frontmatter is read again, and it must read as the old data with only the set keys
 * changed, and pass the Schema. The change cannot be made when it would change other data (an alias elsewhere uses the old
 * value's anchor), which fails as reason `edit`, with no text. Fails with `NoFrontmatter` when the file has none, and with
 * `BadFrontmatter` when `read` would refuse the file, when the Schema refuses the file or the new data (`schema`), or when
 * the change cannot be made (`edit`). It makes one span, `markdown.frontmatter.set`, and puts no text of the file in it.
 *
 * @category constructors
 */
export const set = Effect.fn("markdown.frontmatter.set")(function* <
  S extends Schema.ConstraintCodec<{ readonly [key: string]: unknown }, unknown, unknown, unknown>,
>(
  text: string,
  values: Partial<S["Type"]>,
  schema: S,
): Effect.fn.Return<string, NoFrontmatter | BadFrontmatter, S["DecodingServices"] | S["EncodingServices"]> {
  const { frontmatter } = split(text);

  if (Option.isNone(frontmatter)) {
    return yield* new NoFrontmatter();
  }

  const source = frontmatter.value;
  const start = lineEnd(text, 0) + 1;
  const eol = text.charAt(start - 2) === "\r" ? "\r\n" : "\n";
  const { doc, json } = yield* Effect.fromResult(reading(source, true));
  const old = yield* Schema.decodeUnknownEffect(schema)(json).pipe(Effect.mapError(schemaFailure));

  const encode = (data: S["Type"]) =>
    Schema.encodeEffect(schema)(data).pipe(
      Effect.mapError(schemaFailure),
      Effect.flatMap((encoded) => Effect.fromResult(Result.mapError(toJson(encoded), valueFailure))),
    );

  const before = yield* encode(old);
  const after = yield* encode({ ...old, ...values });

  const changed = Object.entries(after).filter(
    ([key, value]) => !Object.hasOwn(before, key) || !Equal.equals(before[key], value),
  );

  if (changed.length === 0) {
    return text;
  }

  const edits = yield* Effect.fromResult(
    editsFor(source, isMap(doc.contents) ? doc.contents : undefined, changed, eol),
  );

  const edited = splice(source, edits);

  // The check after the edit: the edited frontmatter reads clean, reads as the old data with only the set keys changed, and
  // still passes the Schema.
  const refusal = bad(
    "edit",
    `Setting ${changed.map(([key]) => JSON.stringify(key)).join(", ")} cannot keep the rest of the frontmatter as it is`,
  );

  const reread = yield* Effect.fromResult(Result.mapError(parse(edited), () => refusal));

  if (!Equal.equals(reread, { ...json, ...Object.fromEntries(changed) })) {
    return yield* refusal;
  }

  yield* Schema.decodeUnknownEffect(schema)(reread).pipe(Effect.mapError(schemaFailure));

  return text.slice(0, start) + edited + text.slice(start + source.length);
});
