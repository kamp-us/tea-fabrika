import * as Schema from "effect/Schema";

/**
 * The one error that stops an app from starting on its settings, with a message written for the user who must fix it.
 *
 * **Details**
 *
 * `reason` says which problem: `version` (the repo needs a newer app), `syntax` (a file is not TOML), `unknown` (no such setting), `scope` (the setting exists, but not in this place: another file, or a flag or a variable for a file-only setting), `invalid` (a value its schema refuses), `missing` (a required setting no source gives), `read` (a file could not be read), `edit` (an edit cannot be made in this text as one key, or the edited text would change other data), `write` (a file could not be written, or another change holds its lock file) or `snapshot` (a snapshot does not fit the group it was given to). `file` is the file as a person reads it, such as `~/.demo/demo.toml`, and `line` counts from 1. A fault in the environment names the variable in its message and has no file. `cause` holds the failure underneath when there is one. A message never holds a value it refused.
 *
 * @category errors
 */
export class SettingsError extends Schema.TaggedError<SettingsError, { readonly brand: unique symbol }>()(
  "SettingsError",
  {
    reason: Schema.Literals([
      "version",
      "syntax",
      "unknown",
      "scope",
      "invalid",
      "missing",
      "read",
      "edit",
      "write",
      "snapshot",
    ]),
    message: Schema.String,
    file: Schema.optional(Schema.String),
    line: Schema.optional(Schema.Int),
    cause: Schema.optional(Schema.Defect()),
  },
) {}

export interface Position {
  readonly file: string;
  readonly line?: number | undefined;
}

/** Where a fault was found, as a message opens: `file, line n: `. */
const opening = (position: Position | undefined) =>
  position === undefined ? "" : `${position.file}${position.line === undefined ? "" : `, line ${position.line}`}: `;

/** One error: where it was found, what is wrong and the closing sentence, with the failure beneath it when there is one. The closing sentence is `<app> did not start.` unless the caller gives its own. */
export const stop = (
  app: string,
  reason: SettingsError["reason"],
  text: string,
  position?: Position,
  cause?: unknown,
  closing = `${app} did not start.`,
) =>
  new SettingsError({
    reason,
    message: `${opening(position)}${text}\n  ${closing}`,
    file: position?.file,
    line: position?.line,
    cause,
  });
