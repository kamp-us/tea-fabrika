// json.ts: the type of a parsed JSON file's values, apart from the scripts that parse them: a file
// that imports effect may not use a raw try/catch, and quest.ts reads its files with one. Today's
// lead tooling, run on our own laptop; it is not product.
import type { Schema } from "effect";

/** One value as JSON.parse gives it. */
export type Json = Schema.Json;
