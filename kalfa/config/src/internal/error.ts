import { type ConfigProvider, type PlatformError, Predicate, Redacted, Schema } from "effect";

/**
 * The one error that stops an app from starting on its settings, with a message written for the user who must fix it.
 *
 * **Details**
 *
 * `reason` says which problem: `version` (the repo needs a newer app), `syntax` (a file is not TOML), `unknown` (no such setting), `scope` (the setting exists, but not in this place: another file, or a flag or a variable for a file-only setting), `invalid` (a value its schema refuses), `missing` (a required setting no source gives), `read` (a file could not be read), `edit` (an edit cannot be made in this text as one key, or the edited text would change other data), `write` (a file could not be written, or another change holds its lock file) or `snapshot` (a snapshot does not fit the group it was given to). `file` is the file as a person reads it, such as `~/.demo/demo.toml`, and `line` counts from 1. A fault in the environment names the variable in its message and has no file. `cause` holds the failure underneath when there is one, hidden in a `Redacted` because it may quote a value or a path: read it on purpose with `Redacted.value`. A `read` message says why the read failed, from the failure's kind and its POSIX code, and an `invalid` message names the rule the value broke, from the schema's declared parts. A message never holds a value it refused, a secret or a home path.
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
    cause: Schema.optional(Schema.Redacted(Schema.Defect())),
  },
) {}

export interface Position {
  readonly file: string;
  readonly line?: number | undefined;
}

/** Where a fault was found, as a message opens: `file, line n: `. */
const opening = (position: Position | undefined) =>
  position === undefined ? "" : `${position.file}${position.line === undefined ? "" : `, line ${position.line}`}: `;

/** One error: where it was found, what is wrong and the closing sentence, with the failure beneath it, hidden, when there is one. The closing sentence is `<app> did not start.` unless the caller gives its own. */
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
    cause: cause === undefined ? undefined : Redacted.make(cause),
  });

/** A POSIX error name, as Node gives it in `code`: `EACCES`, `EMFILE`. Anchored, so nothing else in the code is printed. */
const POSIX = /^E[A-Z0-9]+$/u;

/** Why a read failed, as the end of a sentence. It reads the failure's kind and its POSIX code, never its message, its path or its description. */
const because = (cause: PlatformError.PlatformError | ConfigProvider.SourceError): string => {
  if (cause._tag === "SourceError") {
    return "the environment did not answer";
  }

  const { reason } = cause;

  if (reason._tag === "BadArgument") {
    return "its path is not valid";
  }

  const found = reason.cause;

  const named =
    Predicate.hasProperty(found, "code") && Predicate.isString(found.code) && POSIX.test(found.code)
      ? ` (${found.code})`
      : "";

  switch (reason._tag) {
    case "PermissionDenied":
      return `permission was denied${named}`;
    case "BadResource":
      return `it is not a plain file${named}`;
    default:
      return `the system gave the error ${reason._tag}${named}`;
  }
};

/** The one error of a read that failed: what could not be read (a name, or nothing when `position` names the file), why, and the failure beneath, hidden. */
export const unread = (
  app: string,
  cause: PlatformError.PlatformError | ConfigProvider.SourceError,
  options: { readonly subject?: string; readonly position?: Position; readonly closing?: string | undefined } = {},
) =>
  stop(
    app,
    "read",
    `${options.subject === undefined ? "" : `${options.subject} `}could not be read, because ${because(cause)}.`,
    options.position,
    cause,
    options.closing,
  );
