// How a piped value travels, next/ (pipe slice 1, 0553): one way underneath, as items in chunk
// messages, and only the two runners see it. The writer's runner wraps by the writer's declared shape
// and the reader's runner unwraps by the same shape, read from the `piped` row, so the two ends cannot
// disagree. A list goes as its items; anything else, a union holding a list and `Schema.Unknown`
// included, goes as a list of one item.
import { Option, Result, type Schema, SchemaRepresentation } from "effect";
import type { Shape } from "../../processes/Fit.ts";

/**
 * Whether a declared shape is a list: its top node is `Arrays` with only a `rest` node.
 *
 * @internal
 */
export const listed = (shape: Shape): boolean => {
  if (shape === null) {
    return false;
  }

  const doc = Result.try(() => SchemaRepresentation.fromJson(shape.doc));

  if (Result.isFailure(doc)) {
    return false;
  }

  const top = doc.success.representation;
  return top._tag === "Arrays" && top.elements.length === 0 && top.rest.length === 1;
};

/**
 * On the way out: a list goes as its items, anything else as a list of one item (0553).
 *
 * @internal
 */
export const wrap = (writer: Shape, value: Schema.Json): ReadonlyArray<Schema.Json> =>
  listed(writer) && Array.isArray(value) ? value : [value];

/**
 * On the way in, by what the writer declared: a list comes back as the items, anything else as its
 * one item. Items that cannot be a single value's (none, several, or one `null`) are no value.
 *
 * @internal
 */
export const unwrap = (writer: Shape, items: ReadonlyArray<Schema.Json>): Option.Option<Schema.Json> => {
  if (listed(writer)) {
    return Option.some(items);
  }

  const [one, ...more] = items;
  return items.length === 1 && more.length === 0 && one !== undefined && one !== null
    ? Option.some(one)
    : Option.none();
};
