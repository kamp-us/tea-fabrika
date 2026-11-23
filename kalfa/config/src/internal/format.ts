/**
 * One file format an app's configuration files may be written in: how its text is read, and how one key of it is set or removed. TOML is the only one built, and no package entry exports the format.
 */
import type * as Result from "effect/Result";
import * as Schema from "effect/Schema";

/** A parsed file: its values, and where each key and table header starts. */
export interface Document {
  /** The document's values, as plain tables. */
  readonly value: Readonly<Record<string, unknown>>;
  /**
   * One entry per key/value and per table header: the key's segments and the line it starts on, from 1. `"a.b" = 1` is `["a.b"]`; `a.b = 1` is `["a", "b"]`.
   */
  readonly spans: ReadonlyArray<{ readonly path: ReadonlyArray<string>; readonly line: number }>;
}

/** Why a format could not read or edit a text. `line` counts from 1. */
export const Fault = Schema.TaggedUnion({
  /** The text does not parse. */
  Syntax: { line: Schema.Int, cause: Schema.Defect() },
  /** The value cannot be written in this format. */
  Value: { cause: Schema.Defect() },
  /** The path is not one key in this text. */
  Conflict: { line: Schema.Int, cause: Schema.Defect() },
});

export type Fault = typeof Fault.Type;

export interface Format {
  /** The format as a message says it: "this is not valid TOML." */
  readonly name: string;
  /** The file ending: the file is `.<app>/<app>.<extension>`. */
  readonly extension: string;
  readonly parse: (text: string) => Result.Result<Document, Fault>;
  readonly set: (text: string, path: ReadonlyArray<string>, value: unknown) => Result.Result<string, Fault>;
  readonly remove: (text: string, path: ReadonlyArray<string>) => Result.Result<string, Fault>;
}
