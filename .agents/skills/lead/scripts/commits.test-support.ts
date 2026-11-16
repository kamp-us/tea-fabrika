// Today's tooling: the commits check's answer lines, as box.test.ts, drive.test.ts and quest.test.ts
// feed them to the readers of that check. The check prints one JSON object per line; this restates
// the two kinds it prints (0135), so each line a law writes is made by a schema and not by hand
// (0562).
import { Schema } from "effect";

/** One answer line of the commits check: a stuck commit, or a question for a person. */
export const CommitsAnswer = Schema.TaggedUnion({
  stuck: {
    reason: Schema.String,
    sha: Schema.optionalKey(Schema.String),
    step: Schema.optional(Schema.String),
  },
  ask: { to: Schema.String, for: Schema.String, paths: Schema.optionalKey(Schema.Array(Schema.String)) },
});
