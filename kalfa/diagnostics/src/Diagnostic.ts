/**
 * What a diagnostic is: a code, a severity, a message, a place and a hint, and the declaration of a code with its long text.
 *
 * **Details**
 *
 * A package declares each code once with `make`, and reports only through a declared code (see `Diagnostics`). Nothing here runs a program, prints or picks an exit code.
 */
import { Schema } from "effect";

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

// A segment of a path is not empty, ".", or "..", and holds no backslash.
const isSegment = (segment: string): boolean =>
  segment !== "" && segment !== "." && segment !== ".." && !segment.includes("\\");

// A path from the repo root: "." for the whole repo, else segments joined by "/". So no leading "/", no "./",
// no "//" and no trailing "/".
const isRepoPath = (path: string): boolean => path === "." || path.split("/").every(isSegment);

const Path = Schema.String.check(
  Schema.makeFilter(
    (path: string) => isRepoPath(path) || "Expected a path from the repo root, or `.` for the whole repo",
  ),
);

// Lines and columns count from 1, as a compiler's printed `file:line:column` does.
const Count = Schema.Int.check(Schema.isGreaterThanOrEqualTo(1));

/**
 * Schema for where a diagnostic points: a path from the repo root, and a line and a column when known.
 *
 * **Details**
 *
 * The whole repo is the path `.`. A path has no leading `/`, no `./` start, no `.` or `..` segment, no empty segment, no trailing `/` and no backslash. A line and a column count from 1. A column needs a line, and `.` takes no line.
 *
 * @category models
 */
export const Place = Schema.Struct({
  path: Path,
  line: Schema.optionalKey(Count),
  column: Schema.optionalKey(Count),
}).check(
  Schema.makeFilter((place) =>
    place.column !== undefined && place.line === undefined ? "Expected a line when there is a column" : undefined,
  ),
  Schema.makeFilter((place) =>
    place.path === "." && place.line !== undefined ? "Expected no line on the whole repo" : undefined,
  ),
);

export type Place = typeof Place.Type;

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
