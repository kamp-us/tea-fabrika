// A plant, as the catalog writes it (decision 0600): a Stryker-made mutant named by its code shape,
// and the law that must kill it. Only schemas and one pure helper live here, so importing
// `@kalfa/quality/stryker` loads no Stryker (law Q15).
import { Schema } from "effect";

/** The law that must kill a plant: a test file and the test's full name, the suite chain and the title joined by " > ". */
export const Law = Schema.Struct({
  file: Schema.String,
  name: Schema.String,
});
export type Law = typeof Law.Type;

/**
 * One planted mutant. The node is named by its shape, never by its place: no byte offset or commit
 * is pinned, so a blank line or a squash merge leaves the plant as it was.
 */
export const Plant = Schema.Struct({
  /** What a person types: `host-pnpm-path`. */
  name: Schema.String,
  /** The product file, relative to the repo root. */
  file: Schema.String,
  /** Stryker's own mutator name, such as `ConditionalExpression`. */
  mutator: Schema.String,
  /** The mutated node's text, compared with whitespace folded. */
  original: Schema.String,
  /** What Stryker puts there, compared with whitespace folded. */
  replacement: Schema.String,
  /** A snippet of the file that holds the node and occurs once in it: it picks one of two equal nodes. */
  within: Schema.optional(Schema.String),
  law: Law,
});
export type Plant = typeof Plant.Type;

/** The repo's plants. Two plants never share a name, since a name is what a person types. */
export const Catalog = Schema.Array(Plant).check(
  Schema.makeFilter(
    (plants) => new Set(plants.map(({ name }) => name)).size === plants.length || "plant names must be unique",
  ),
);
export type Catalog = typeof Catalog.Type;

/** A plant from its plain form; it throws on a form that does not decode, which a catalog file wants at load. */
export const plant = (input: typeof Plant.Encoded): Plant => Schema.decodeSync(Plant)(input);

/** Every run of whitespace as one space, and no space at either end: the text of a node whatever its layout. */
export const fold = (text: string): string => text.replace(/\s+/g, " ").trim();
