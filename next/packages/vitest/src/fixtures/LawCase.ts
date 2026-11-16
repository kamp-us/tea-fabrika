// What a nested run of Law.fixture.ts registers, passed through vitest's `provide`. Its own file, so
// the integration laws can make a case without loading the fixture's laws into their own run.
import { Schema } from "effect";

export const LawCase = Schema.TaggedUnion({
  /** One law per threshold, failing on a value above it, and one more that no value fails. */
  threshold: { above: Schema.Array(Schema.Int) },
  /** The same failing law on each engine, once per lowest failing value. */
  seed: { lowest: Schema.Array(Schema.Int) },
  /** One law that runs past its timeout, and a law after it that reads what opened late. */
  timeout: { timeout: Schema.Int },
});

export type LawCase = typeof LawCase.Type;
