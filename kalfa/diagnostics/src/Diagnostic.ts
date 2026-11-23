/**
 * What a diagnostic is: a code, a severity, a message, a place and a hint, the declaration of a code with its long text, and a carried diagnostic, which a typed error holds.
 *
 * **Details**
 *
 * A package declares each code once with `make`, and reports only through a declared code (see `Diagnostics`). A typed error says which diagnostic it is with `carry`, and the command that handles it reads that with `fromError`. Nothing here runs a program, prints or picks an exit code.
 */
import { Option, Predicate, Schema } from "effect";

// A code: a root name, a slash, a name. Lowercase words joined by single hyphens, as in "config/unknown-setting".
// The root starts with a letter, as a subcommand's first word does; the name may start with a digit.
const CODE = /^[a-z][a-z0-9]*(?:-[a-z0-9]+)*\/[a-z0-9]+(?:-[a-z0-9]+)*$/;

/**
 * Schema for a diagnostic's code: a root name, one slash and a name, each made of lowercase words joined by hyphens, as `config/unknown-setting`.
 *
 * **Details**
 *
 * The root starts with a letter. The name may start with a digit.
 *
 * @category models
 */
export const Code = Schema.String.check(Schema.isPattern(CODE)).pipe(Schema.brand("@kalfa/diagnostics/Code"));

export type Code = typeof Code.Type;

/**
 * Schema for how much a diagnostic weighs: `error` fails the subcommand, and `warning` is only advice.
 *
 * @category models
 */
export const Severity = Schema.Literals(["error", "warning"]);

export type Severity = typeof Severity.Type;

// Some text that says something: it is not empty and not only whitespace. This reads no words.
const isSaid = (text: string): boolean => text.trim().length > 0;

const Said = Schema.String.check(
  Schema.makeFilter((text: string) => isSaid(text) || "Expected text that is not blank"),
);

// A name a shell can expand as $NAME: a letter or an underscore, then letters, digits and underscores.
const NAME = /^[A-Za-z_][A-Za-z0-9_]*$/;

// A flag as written on a command line: "-" and exactly one character, or "--" and a name. A character is not
// whitespace, not "=", not a control character (Cc), not a format character (Cf, such as a zero-width space or a
// right-to-left override) and not a lone surrogate (Cs), and a name does not start with a hyphen. So no value rides
// along in it, and nothing hides in it.
const FLAG = /^(?:-[^\s=\p{Cc}\p{Cf}\p{Cs}-]|--[^\s=\p{Cc}\p{Cf}\p{Cs}-][^\s=\p{Cc}\p{Cf}\p{Cs}]*)$/u;

// A first part that never starts a repo path: one that starts with "~" (a home folder, or "~login") or "$" (a
// variable), or holds a ":" (a drive such as "C:" or "C:" joined to the next word, or a scheme such as "file:"). Each
// of those can lead to an absolute path or a login name.
const NOT_A_REPO_START = /^[~$]|:/;

// A segment of a path is not empty, ".", or "..", and holds no backslash.
const isSegment = (segment: string): boolean =>
  segment !== "" && segment !== "." && segment !== ".." && !segment.includes("\\");

// A path from the repo root: "." for the whole repo, else segments joined by "/". So no leading "/", no "./",
// no "//" and no trailing "/". Its first part does not read as a home folder, a variable, a drive or a scheme, so it
// never passes for a file outside the repo.
const isRepoPath = (path: string): boolean =>
  path === "." || (!NOT_A_REPO_START.test(path.split("/")[0] ?? "") && path.split("/").every(isSegment));

// A path under the home folder: "~" or "$NAME", then one or more good parts. So never absolute, and never "~login",
// which names a login.
const isHomePath = (path: string): boolean => {
  const [start = "", ...parts] = path.split("/");
  const named = start === "~" || (start.startsWith("$") && NAME.test(start.slice(1)));

  return named && parts.length > 0 && parts.every(isSegment);
};

// Each refusal's message names the rule and never the input: a refused path may hold a login name.
const RepoPath = Schema.String.check(
  Schema.makeFilter(
    (path: string) => isRepoPath(path) || "Expected a path from the repo root, or `.` for the whole repo",
  ),
);

const HomePath = Schema.String.check(
  Schema.makeFilter((path: string) => isHomePath(path) || "Expected a path that starts with `~/` or `$NAME/`"),
);

const VariableName = Schema.String.check(
  Schema.makeFilter((name: string) => NAME.test(name) || "Expected an environment variable's name"),
);

const FlagName = Schema.String.check(
  Schema.makeFilter((name: string) => FLAG.test(name) || "Expected a flag as written, such as `--name` or `-n`"),
);

// Lines and columns count from 1, as a compiler's printed `file:line:column` does.
const Count = Schema.Int.check(Schema.isGreaterThanOrEqualTo(1));

const columnNeedsLine = Schema.makeFilter((place: { readonly line?: number; readonly column?: number }) =>
  place.column !== undefined && place.line === undefined ? "Expected a line when there is a column" : undefined,
);

const wholeRepoHasNoLine = Schema.makeFilter((place: { readonly path: string; readonly line?: number }) =>
  place.path === "." && place.line !== undefined ? "Expected no line on the whole repo" : undefined,
);

const Repo = Schema.TaggedStruct("repo", {
  path: RepoPath,
  line: Schema.optionalKey(Count),
  column: Schema.optionalKey(Count),
}).check(columnNeedsLine, wholeRepoHasNoLine);

const Home = Schema.TaggedStruct("home", {
  path: HomePath,
  line: Schema.optionalKey(Count),
  column: Schema.optionalKey(Count),
}).check(columnNeedsLine);

// No line and no column: the key may be left out, and a value for it is refused, at run time and in the type. A
// plain struct would drop the key without a word instead.
const Environment = Schema.TaggedStruct("environment", {
  name: VariableName,
  line: Schema.optionalKey(Schema.Never),
  column: Schema.optionalKey(Schema.Never),
});

const Flag = Schema.TaggedStruct("flag", {
  name: FlagName,
  line: Schema.optionalKey(Schema.Never),
  column: Schema.optionalKey(Schema.Never),
});

/**
 * Schema for where a diagnostic points, of four kinds told apart by `_tag`: a file in the repo, a file under the home folder, an environment variable or a command-line flag.
 *
 * **Details**
 *
 * - `repo`: a path from the repo root, and a line and a column when known. The whole repo is the path `.`. A path has no leading `/`, no `./` start, no `.` or `..` part, no empty part, no trailing `/` and no backslash. Its first part does not start with `~` or `$` and holds no `:`, so it is no drive such as `C:` and no scheme such as `file:`. A `:` deeper in the path is fine.
 * - `home`: a file under the home folder, written `~/` or `$NAME/` and then good parts, with a line and a column when known. So no absolute path and no login name is ever held. The package reads no home folder: a reader's shell expands the start.
 * - `environment`: an environment variable, by its `name`, as a shell reads one.
 * - `flag`: a command-line flag, by its `name` as typed, with its hyphens: `-` and exactly one character, such as `-f`, or `--` and a name, such as `--instance.port`. It holds no `=`, no whitespace, no control or format character and no lone surrogate, so no value rides along and nothing hides in it.
 *
 * A line and a column count from 1. A column needs a line, and `.` takes no line. An environment variable and a flag take neither.
 *
 * **Example** (The four kinds)
 *
 * ```ts
 * import type * as Diagnostic from "@kalfa/diagnostics/Diagnostic"
 *
 * export const places: ReadonlyArray<Diagnostic.Place> = [
 *   { _tag: "repo", path: "docs/setup.md", line: 12 },
 *   { _tag: "home", path: "~/.demo/demo.toml", line: 3, column: 1 },
 *   { _tag: "environment", name: "DEMO_INSTANCE_PORT" },
 *   { _tag: "flag", name: "--instance.port" }
 * ]
 * ```
 *
 * @category models
 */
export const Place = Schema.Union([Repo, Home, Environment, Flag]).pipe(Schema.toTaggedUnion("_tag"));

export type Place = typeof Place.Type;

// A file's text: the path, then the line and the column when there are any, as `file:line:column`.
const fileText = ({
  path,
  line,
  column,
}: {
  readonly path: string;
  readonly line?: number;
  readonly column?: number;
}) => [path, line, column].filter((part) => part !== undefined).join(":");

/**
 * A place's plain text, for a person to read.
 *
 * **When to use**
 *
 * Use when a command prints a place. An agent reads `_tag` and the other fields, not this text.
 *
 * **Details**
 *
 * A file in the repo or under the home folder is its path, then `:line` and `:column` when known, so the whole repo is `.`. An environment variable is `environment variable NAME`, and a flag is `flag --name`. The function reads nothing, prints nothing and runs no Effect. It escapes nothing.
 *
 * **Example** (Printing each kind)
 *
 * ```ts
 * import * as Diagnostic from "@kalfa/diagnostics/Diagnostic"
 *
 * Diagnostic.formatPlace({ _tag: "home", path: "~/.demo/demo.toml", line: 3, column: 1 }) // "~/.demo/demo.toml:3:1"
 * Diagnostic.formatPlace({ _tag: "environment", name: "DEMO_INSTANCE_PORT" }) // "environment variable DEMO_INSTANCE_PORT"
 * Diagnostic.formatPlace({ _tag: "flag", name: "--instance.port" }) // "flag --instance.port"
 * ```
 *
 * @category formatting
 */
export const formatPlace = (place: Place): string =>
  Place.match(place, {
    repo: fileText,
    home: fileText,
    environment: ({ name }) => `environment variable ${name}`,
    flag: ({ name }) => `flag ${name}`,
  });

/**
 * Schema for one reported diagnostic: its code, severity, message, place and hint, all five required.
 *
 * **Details**
 *
 * A message and a hint are text that is not only whitespace. The message says what is so, as a fact, and never quotes text that must stay private. The hint says what to do next, or that only a person can decide.
 *
 * @category models
 */
export const Reported = Schema.Struct({
  code: Code,
  severity: Severity,
  message: Said,
  place: Place,
  hint: Said,
});

export type Reported = typeof Reported.Type;

// Only `make` builds a Declared: the key is a symbol this module does not export, so an object with a code and a
// text is not one, and `report` takes no plain string.
const TypeId: unique symbol = Symbol.for("@kalfa/diagnostics/Declared");

/**
 * A declared code: the code and its long text, made by `make`.
 *
 * **Details**
 *
 * It is a declared code, not a reported diagnostic. A package declares each code once, and reports through it.
 *
 * @category models
 */
export interface Declared {
  readonly [TypeId]: typeof TypeId;
  /** The code. */
  readonly code: Code;
  /** The long text, Markdown, kept exactly as given. */
  readonly explain: string;
}

/**
 * Declares a code with its long text.
 *
 * **When to use**
 *
 * Use to declare each code once, at a module's top level, and report through the result.
 *
 * **Details**
 *
 * The long text is kept exactly as given. The call throws when the code is malformed or the long text is blank, so a bad declaration stops the import where it is written.
 *
 * **Example** (Declaring a code)
 *
 * ```ts
 * import * as Diagnostic from "@kalfa/diagnostics/Diagnostic"
 *
 * export const UnknownSetting = Diagnostic.make("config/unknown-setting", {
 *   explain: "A settings file names a setting that no app declares."
 * })
 * ```
 *
 * @category constructors
 */
export const make = (code: string, options: { readonly explain: string }): Declared => {
  if (!Schema.is(Code)(code)) {
    throw new Error(
      `"${code}" is not a diagnostic code: write a root name, a slash and a name, each in lowercase words joined by hyphens, as "config/unknown-setting".`,
    );
  }

  if (!isSaid(options.explain)) {
    throw new Error(`The long text (explain) of "${code}" is blank: write what the code means, in Markdown.`);
  }

  return { [TypeId]: TypeId, code, explain: options.explain };
};

// Only `carry` builds a Carried: the key is a symbol this module does not export. `Symbol.for`, as for Declared, so a
// second copy of the package reads the same key.
const CarriedId: unique symbol = Symbol.for("@kalfa/diagnostics/Carried");

// What a typed error holds beside the code: a message, a place and a hint, as a caller writes them.
type CarriedText = Omit<typeof Reported.Encoded, "code" | "severity">;

/**
 * A carried diagnostic: a declared code and the fields beside it, which a typed error holds, made by `carry`.
 *
 * **Details**
 *
 * The fields are kept as given and checked only when the code that handles the error reports them. A carried diagnostic is always an error, never a warning, since the subcommand stopped. The `fields` fit `Diagnostics.Fields`, so a handler passes them straight to `report`.
 *
 * @category models
 */
export interface Carried {
  readonly [CarriedId]: typeof CarriedId;
  /** The declared code. */
  readonly declared: Declared;
  /** The message, place and hint as given, unchecked, and the severity `"error"`. */
  readonly fields: CarriedText & { readonly severity: "error" };
}

/**
 * Makes the carried diagnostic that a typed error holds.
 *
 * **When to use**
 *
 * Use to say, in the `diagnostic` getter of a typed error, which diagnostic the error is.
 *
 * **Details**
 *
 * It takes no severity: a carried diagnostic is always an error. It checks nothing, and keeps the message, place and hint exactly as given. A blank message or a bad place is caught when the handler reports it, and `report` dies then. Only the message, place and hint are copied, so a severity hidden in a wider object never rides along.
 *
 * **Example** (A typed error that carries its diagnostic)
 *
 * ```ts
 * import * as Diagnostic from "@kalfa/diagnostics/Diagnostic"
 * import { Schema } from "effect"
 * import { UnknownSetting } from "./codes.ts"
 *
 * export class UnknownSettingError extends Schema.TaggedError<UnknownSettingError>()("UnknownSettingError", {
 *   setting: Schema.String,
 *   line: Schema.Int
 * }) {
 *   get diagnostic(): Diagnostic.Carried {
 *     return Diagnostic.carry(UnknownSetting, {
 *       message: `The setting \`${this.setting}\` is not declared.`,
 *       place: Diagnostic.Place.cases.repo.make({ path: ".config/settings.toml", line: this.line }),
 *       hint: "Check the spelling against the settings reference."
 *     })
 *   }
 * }
 * ```
 *
 * @category constructors
 */
export const carry = (declared: Declared, fields: CarriedText): Carried => ({
  [CarriedId]: CarriedId,
  declared,
  fields: { severity: "error", message: fields.message, place: fields.place, hint: fields.hint },
});

const isCarried = (value: unknown): value is Carried => Predicate.hasProperty(value, CarriedId);

/**
 * Reads the carried diagnostic from any value a subcommand failed with.
 *
 * **When to use**
 *
 * Use when a failure is handled, to report what it carries, or to find out that it carries nothing.
 *
 * **Details**
 *
 * It answers `Option.some` of what the value holds under `diagnostic`, whether the value holds the key itself or its class gives it with a getter, and `Option.none()` when it carries none. Only a value that `carry` made counts: a plain reported diagnostic or a look-alike reads as carrying none. A getter that throws is not caught, and no `cause` is followed: an error that wraps another says itself which diagnostic it is.
 *
 * **Example** (Reporting what a failure carries)
 *
 * ```ts
 * import * as Diagnostic from "@kalfa/diagnostics/Diagnostic"
 * import * as Diagnostics from "@kalfa/diagnostics/Diagnostics"
 * import { Effect, Option } from "effect"
 *
 * export const reportCarried = (cause: unknown) =>
 *   Option.match(Diagnostic.fromError(cause), {
 *     onNone: () => Effect.void,
 *     onSome: (carried) => Diagnostics.report(carried.declared, carried.fields)
 *   })
 * ```
 *
 * @category reading
 */
export const fromError = (cause: unknown): Option.Option<Carried> => {
  const diagnostic = Predicate.hasProperty(cause, "diagnostic") ? cause.diagnostic : undefined;

  return isCarried(diagnostic) ? Option.some(diagnostic) : Option.none();
};
