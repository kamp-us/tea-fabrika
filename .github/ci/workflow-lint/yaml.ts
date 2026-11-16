// Today's CI, serving both versions. The types of a parsed workflow's values, apart from shared.ts:
// a file that imports effect may not use a raw try/catch, and shared.ts parses with one.
import type { Schema } from "effect";

/**
 * One YAML mapping as `parse` gives it. The `yaml` package reads the core schema by default, so a
 * value in it is only ever JSON's: a string, number, boolean, null, list or mapping.
 */
export type YamlMap = Schema.MutableJsonObject;

/** One value in a YAML mapping. */
export type YamlValue = Schema.MutableJson;
