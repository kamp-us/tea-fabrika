// What a nested run of Law.fixture.ts registers, passed through vitest's `provide`. Its own file, so
// the integration laws can make a case without loading the fixture's laws into their own run.
import { Schema } from "effect";
import { Label } from "../Law.ts";

export const LawCase = Schema.TaggedUnion({
  /**
   * The package's `it.each` beside vitest's own on the same cases and template: tuple cases, with a
   * law's options on the package's side, and record cases, with none.
   */
  each: {
    tuples: Schema.Array(Schema.Tuple([Schema.String, Schema.Int])),
    records: Schema.Array(Schema.Struct({ word: Schema.String, n: Schema.Int })),
    template: Schema.String,
    plant: Schema.String,
    label: Label,
    reads: Schema.Array(Schema.String),
  },
  /** One law per threshold, failing on a value above it, and one more that no value fails. */
  threshold: { above: Schema.Array(Schema.Int) },
  /** The same failing law on each engine, once per lowest failing value. */
  seed: { lowest: Schema.Array(Schema.Int) },
  /** One law that runs past its timeout, and a law after it that reads what opened late. */
  timeout: { timeout: Schema.Int },
});

export type LawCase = typeof LawCase.Type;
