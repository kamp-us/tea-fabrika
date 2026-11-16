/**
 * The editor's JSON Schema for a settings file, written by Effect from the file's own schema (`Files.schema`), so validation and editor hints share one tree.
 *
 * **Details**
 *
 * A key no declaration names is refused, and a default is only an annotation. A leaf JSON Schema cannot hold exactly stops generation rather than shipping a looser schema.
 *
 * @stability unstable
 */
import { Predicate, Schema } from "effect";
import * as Arr from "effect/Array";

const DIALECT = "https://json-schema.org/draft/2020-12/schema";

/** Whether a representation holds a node Effect writes as a looser JSON Schema than it decodes. */
const loose = (node: unknown, seen: Set<unknown>): boolean => {
  if (!Predicate.isObjectOrArray(node) || seen.has(node)) {
    return false;
  }

  seen.add(node);

  // An opaque declaration becomes `{}`; a check with no exact JSON Schema is left out or widened.
  if (!Arr.isArray(node) && node._tag === "Declaration") {
    return true;
  }

  if (!Arr.isArray(node) && (node._tag === "Filter" || node._tag === "FilterGroup")) {
    const write = Predicate.isObject(node.annotations) ? node.annotations.toJsonSchema : undefined;

    if (!Predicate.isFunction(write) || Arr.isArray(write({ type: undefined, schemas: [] }))) {
      return true;
    }
  }

  return Arr.some(Object.values(node), (value) => loose(value, seen));
};

/**
 * Writes the JSON Schema document for a settings file's schema.
 *
 * **Details**
 *
 * The result is a draft 2020-12 document with its definitions under `$defs`, and excess properties are refused.
 *
 * **Gotchas**
 *
 * Throws an `Error` when any part of the schema would be written looser than it decodes: an opaque declaration, or a check with no exact JSON Schema form.
 *
 * @stability unstable
 * @category constructors
 */
export const make = (schema: Schema.Top) => {
  if (loose(Schema.toRepresentation(Schema.toCodecJson(schema)), new Set())) {
    throw new Error("A setting's schema cannot be written as JSON Schema without loosening it.");
  }

  const document = Schema.toJsonSchemaDocument(schema, { onExcessProperty: "error" });
  return { $schema: DIALECT, ...document.schema, $defs: document.definitions };
};

/** The repo formatter's line width, from `.oxfmtrc.json`. */
const WIDTH = 120;

/**
 * One JSON value as the repo's formatter prints it: every object over several lines, and an array
 * of plain values on one line when it fits the width, so the committed text needs no reformatting.
 */
const printed = (value: unknown, indent: string, taken: number): string => {
  if (value === null || typeof value !== "object") {
    return JSON.stringify(value);
  }

  const inner = `${indent}  `;

  if (Arr.isArray(value)) {
    if (value.length === 0) {
      return "[]";
    }

    const flat = Arr.every(value, (item) => item === null || typeof item !== "object");
    const plain = Arr.map(value, (item) => JSON.stringify(item));
    const line = `[${Arr.join(plain, ", ")}]`;

    if (flat && indent.length + taken + line.length <= WIDTH) {
      return line;
    }

    const items = Arr.map(value, (item, n) => `${inner}${printed(item, inner, n < value.length - 1 ? 1 : 0)}`);
    return `[\n${Arr.join(items, ",\n")}\n${indent}]`;
  }

  const entries = Object.entries(value);

  if (entries.length === 0) {
    return "{}";
  }

  const fields = Arr.map(entries, ([key, item], n) => {
    const name = `${JSON.stringify(key)}: `;
    return `${inner}${name}${printed(item, inner, name.length + (n < entries.length - 1 ? 1 : 0))}`;
  });
  return `{\n${Arr.join(fields, ",\n")}\n${indent}}`;
};

/**
 * Returns a document as the text that is committed: two-space JSON as the repo's formatter prints
 * it, and one trailing newline.
 *
 * **Details**
 *
 * An object always takes several lines. An array of plain values takes one line when it fits in
 * 120 columns, and one line per item when it does not, so `pnpm format` leaves the file as it is.
 *
 * @stability unstable
 * @category combinators
 */
export const format = (document: ReturnType<typeof make>) => `${printed(document, "", 0)}\n`;
