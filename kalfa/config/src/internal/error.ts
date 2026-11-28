import * as Diagnostic from "@kalfa/diagnostics/Diagnostic";
import * as Hidden from "@kalfa/diagnostics/Hidden";
import { type ConfigProvider, type PlatformError, Predicate, Redacted, Schema } from "effect";

/** The reasons an error has, as `reason` says them. */
const Reason = Schema.Literals([
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
]);

/** The reasons that can carry a diagnostic: each has a place to point at, and a code. A `snapshot` fault never has a place. */
type Placed = Exclude<typeof Reason.Type, "snapshot">;

/** One declared code and its one fixed hint. A hint is the same for every fault of its reason, so it holds no app, value, path or login. */
interface Code {
  readonly declared: Diagnostic.Declared;
  readonly hint: string;
}

const codes: Readonly<Record<Placed, Code>> = {
  version: {
    declared: Diagnostic.make("config/version", {
      explain: "The repo's configuration asks for a newer version of the app than the one that is running.",
    }),
    hint: "Install a newer release of the app, or lower the repo's minimum version.",
  },
  syntax: {
    declared: Diagnostic.make("config/syntax", {
      explain: "A configuration file is not valid TOML, so it cannot be read.",
    }),
    hint: "Fix the text at this place so the file can be read.",
  },
  unknown: {
    declared: Diagnostic.make("config/unknown-setting", {
      explain: "A name does not belong to any setting of the app.",
    }),
    hint: "Check the name against the app's settings reference, or remove the key.",
  },
  scope: {
    declared: Diagnostic.make("config/scope", {
      explain: "A setting exists, but not in this place: it is another file's, or only a file may set it.",
    }),
    hint: "Set it in one of the places the message names.",
  },
  invalid: {
    declared: Diagnostic.make("config/invalid", { explain: "A value is one that the setting's schema refuses." }),
    hint: "Give a value that keeps the rule the message names.",
  },
  missing: {
    declared: Diagnostic.make("config/missing", { explain: "A required setting is set by no source." }),
    hint: "Set it in one of the places the message names.",
  },
  read: {
    declared: Diagnostic.make("config/read", {
      explain: "A configuration file, or the environment, could not be read.",
    }),
    hint: "Check that the app may read this place, then run it again.",
  },
  edit: {
    declared: Diagnostic.make("config/edit", {
      explain: "An edit cannot be made in this text as one key, or the edited text would change other data.",
    }),
    hint: "Make this change by hand in the file.",
  },
  write: {
    declared: Diagnostic.make("config/write", {
      explain: "A configuration file could not be written, or another change holds its lock file.",
    }),
    hint: "Check that the folder is there and may be written, then run it again.",
  },
};

/** How a message opens for a fault found in a file: `file, line n: `. */
const opened = ({ path, line }: { readonly path: string; readonly line?: number }) =>
  `${path}${line === undefined ? "" : `, line ${line}`}: `;

/**
 * The one error that stops an app from starting on its settings, with a message written for the user who must fix it.
 *
 * **Details**
 *
 * `reason` says which problem: `version` (the repo needs a newer app), `syntax` (a file is not TOML), `unknown` (no such setting), `scope` (the setting exists, but not in this place: another file, or a flag or a variable for a file-only setting), `invalid` (a value its schema refuses), `missing` (a required setting no source gives), `read` (a file could not be read), `edit` (an edit cannot be made in this text as one key, or the edited text would change other data), `write` (a file could not be written, or another change holds its lock file) or `snapshot` (a snapshot does not fit the group it was given to).
 *
 * `fault` is what is wrong, as one or more sentences with no place and no closing, and `closing` is the sentence that ends the message. `place` is where the fault is, of the kind it is: the repo's file, the user's file, an environment variable or a flag, as data a program can read. It is left out only for a fault that has no place (a snapshot stream, a bad command line). A fault in a file has the file as a person reads it, such as `~/.demo/demo.toml`, and its line, counted from 1. `message` is made from the three, a file's place opening it, and `diagnostic` is the carried diagnostic of the error: its reason's code, `fault` as its message, `place` and the reason's hint, or none when there is no place.
 *
 * `cause` holds the failure underneath when there is one, held as a `Hidden.Cause` (`@kalfa/diagnostics/Hidden`) because it may quote a value or a path: no rendering shows it, and every codec writes it as `<redacted>`. Read it on purpose with `Redacted.value`. A `read` message says why the read failed, from the failure's kind and its POSIX code, and an `invalid` message names the rule the value broke, from the schema's declared parts. A message never holds a value it refused, a secret or a home path.
 *
 * @category errors
 */
export class SettingsError extends Schema.TaggedError<SettingsError, { readonly brand: unique symbol }>()(
  "SettingsError",
  {
    reason: Reason,
    /** What is wrong: no place and no closing. The diagnostic's message. */
    fault: Schema.String,
    /** The sentence that ends the message: `<app> did not start.`, `<file> was not changed.`, and the rest. */
    closing: Schema.String,
    /** Where the fault is, of the kind it is. Left out only for a fault with no place. */
    place: Schema.optionalKey(Diagnostic.Place),
    cause: Schema.optional(Hidden.Cause),
  },
) {
  /** The text a person reads. A file's place opens it, as a variable's or a flag's name opens the fault itself. A missing setting's place says where to fix it, not where it was found, so it opens nothing. */
  override get message(): string {
    const opening =
      this.place === undefined || this.reason === "missing"
        ? ""
        : Diagnostic.Place.match(this.place, {
            repo: opened,
            home: opened,
            environment: () => "",
            flag: () => "",
          });

    return `${opening}${this.fault}\n  ${this.closing}`;
  }

  /** The diagnostic this error carries: its reason's code, `fault`, `place` and the reason's hint. None with no place. */
  get diagnostic(): Diagnostic.Carried | undefined {
    if (this.place === undefined || this.reason === "snapshot") {
      return undefined;
    }

    const code = codes[this.reason];

    return Diagnostic.carry(code.declared, { message: this.fault, place: this.place, hint: code.hint });
  }
}

/** One error: where it was found, what is wrong and the closing sentence, with the failure beneath it, hidden, when there is one. The closing sentence is `<app> did not start.` unless the caller gives its own. */
export const stop = (
  app: string,
  reason: SettingsError["reason"],
  fault: string,
  place?: Diagnostic.Place,
  cause?: unknown,
  closing = `${app} did not start.`,
) =>
  new SettingsError({
    reason,
    fault,
    closing,
    ...(place === undefined ? {} : { place }),
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

/** The one error of a read that failed: what could not be read (a name, or nothing when `place` names the file), why, and the failure beneath, hidden. */
export const unread = (
  app: string,
  cause: PlatformError.PlatformError | ConfigProvider.SourceError,
  options: { readonly subject?: string; readonly place?: Diagnostic.Place; readonly closing?: string | undefined } = {},
) =>
  stop(
    app,
    "read",
    `${options.subject === undefined ? "" : `${options.subject} `}could not be read, because ${because(cause)}.`,
    options.place,
    cause,
    options.closing,
  );
