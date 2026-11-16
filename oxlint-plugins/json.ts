// The type of a parsed JSON or YAML file's objects, apart from the rules that parse them: a file
// that imports effect may not use a raw try/catch, and those rules read their files with one.
import type { Schema } from "effect";

/**
 * One object as JSON.parse, yaml's `parse` or `oxlint --print-config` gives it. yaml reads the core
 * schema by default, so a value in it is only ever JSON's.
 */
export type JsonObject = Schema.JsonObject;

/** One value in such a file. */
export type Json = Schema.Json;
