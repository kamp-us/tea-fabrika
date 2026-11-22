import * as Schema from "effect/Schema";

/**
 * The one error that stops an app from starting on its settings, with a message written for the user who must fix it.
 *
 * **Details**
 *
 * `reason` says which problem: `version` (the repo needs a newer app), `syntax` (a file is not TOML), `unknown` (no such setting), `scope` (the setting exists, in another file), `invalid` (a value its schema refuses), `missing` (a required setting no source gives) or `read` (a file could not be read). `file` is the file as a person reads it, such as `~/.demo/demo.toml`, and `line` counts from 1. A fault in the environment names the variable in its message and has no file. `cause` holds the failure underneath when there is one. A message never holds a value it refused.
 *
 * @category errors
 */
export class SettingsError extends Schema.TaggedError<SettingsError, { readonly brand: unique symbol }>()(
  "SettingsError",
  {
    reason: Schema.Literals(["version", "syntax", "unknown", "scope", "invalid", "missing", "read"]),
    message: Schema.String,
    file: Schema.optional(Schema.String),
    line: Schema.optional(Schema.Int),
    cause: Schema.optional(Schema.Defect()),
  },
) {}
