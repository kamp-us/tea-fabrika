/**
 * The whole-file check of a setting group: a file is read against the settings that may be set in it, and its first fault is the one error. It reads no file and starts nothing.
 */
import * as Diagnostic from "@kalfa/diagnostics/Diagnostic";
import { Effect, Option, Predicate, Schema, SchemaAST, SchemaIssue, type SemVer } from "effect";
import * as Rec from "effect/Record";
import * as Result from "effect/Result";
import type * as Setting from "../Declaration.ts";
import { distance, drop, leaf, lineAt, type Path, same } from "./document.ts";
import { prefix } from "./edit.ts";
import { type SettingsError, stop } from "./error.ts";
import type { Document } from "./format.ts";
import { segments, variable } from "./names.ts";
import { inFile, type Loaded, type Names } from "./place.ts";

export interface Group {
  readonly app: string;
  readonly settings: ReadonlyArray<Setting.Any>;
}

/** The minimum version a repo asks for, and where it asks. */
interface Minimum {
  readonly version: SemVer.SemVer;
  readonly place: Diagnostic.Place;
}

/** The minimum version the repo configuration asks for, or none. Fails when `<app>-version` does not read as a version. The message ends with `closing`, the start's own sentence when none is given. */
export const version = (
  app: string,
  repo: Loaded,
  closing?: string,
): Result.Result<Option.Option<Minimum>, SettingsError> => {
  const key = `${app}-version`;
  const wanted = repo.document.value[key];

  if (wanted === undefined) {
    return Result.succeed(Option.none());
  }

  const place = inFile("repo", repo.name, lineAt(repo.document, [key]));

  return Schema.decodeUnknownResult(Schema.SemVerFromString)(wanted).pipe(
    Result.mapError(() => stop(app, "invalid", `${key} is not a version, as 1.2.3.`, place, undefined, closing)),
    Result.map((asked) => Option.some({ version: asked, place })),
  );
};

/** A setting's default as its JSON codec writes it, or none for a required setting. */
export const encodedDefault = (s: Setting.Any): Option.Option<Schema.Json> =>
  Option.map(s.default, (value) => Schema.encodeSync(Schema.toCodecJson(s.schema))(value));

/** The fields of one level of a file: a table per word and a leaf per setting, each optional and in name order. A leaf carries the setting's description and its JSON-encoded default, which change no decode. */
export const fields = (
  settings: ReadonlyArray<Setting.Any>,
  depth: number,
): Readonly<Record<string, Schema.optionalKey<Schema.Codec<unknown, unknown>>>> =>
  Rec.fromEntries(
    [...new Set(settings.flatMap((s) => segments(s.name)[depth] ?? []))].sort().map((word) => {
      const below = settings.filter((s) => segments(s.name)[depth] === word);
      const own = below.find((s) => segments(s.name).length === depth + 1);

      return [
        word,
        Schema.optionalKey(
          own === undefined
            ? Schema.Struct(fields(below, depth + 1))
            : Schema.toCodecJson(own.schema).pipe(
                Schema.annotateEncoded({
                  description: own.description,
                  ...Option.match(encodedDefault(own), { onNone: () => ({}), onSome: (value) => ({ default: value }) }),
                }),
              ),
        ),
      ];
    }),
  );

/** The setting names within two edits of `typed`, nearest first: the "Did you mean" of the mistyped-key check. */
export const near = (names: ReadonlyArray<string>, typed: string): Option.Option<string> =>
  Option.map(
    Option.fromNullishOr(
      names
        .map((name) => ({ name, edits: distance(name, typed) }))
        .filter(({ edits }) => edits <= 2)
        .sort((a, b) => a.edits - b.edits)[0],
    ),
    ({ name }) => name,
  );

/** Whether `path` is the setting's own name or one of its tables. */
const under = (s: Setting.Any, path: ReadonlyArray<string>) => path.every((word, n) => segments(s.name)[n] === word);

/** The line of the fault at `path`: its own key's, else the nearest table's above it, else the first line of anything below the nearest table that has one, since a table written only by deeper headers has no line of its own. */
const faultLine = (document: Document, path: Path): number | undefined => {
  for (let n = path.length; n > 0; n--) {
    const above = path.slice(0, n);
    const span = document.spans.find((s) => same(s.path, above)) ?? document.spans.find((s) => prefix(above, s.path));

    if (span !== undefined) {
      return span.line;
    }
  }

  return undefined;
};

/** Whether `path` is the setting's own name or goes on inside its value: a member of a record, a field of a table. */
const reaches = (s: Setting.Any, path: ReadonlyArray<string>) => segments(s.name).every((word, n) => path[n] === word);

/** Where a setting may be set, as a message says it: its files, and its variable unless only a file may set it. */
export const places = (app: string, s: Setting.Any, names: Names) =>
  [...s.files.map((file) => names[file]), ...(s.fileOnly ? [] : [`as ${variable(app, s.name)}`])]
    .map((place, n, all) =>
      n === 0 ? place : n === all.length - 1 && place.startsWith("as ") ? `, or ${place}` : ` or ${place}`,
    )
    .join("");

/** The one message for the first issue of `file`. An unknown key is named, and its value never is. */
const explain = (
  group: Group,
  file: Setting.File,
  found: Loaded,
  names: Names,
  issue: SchemaIssue.Issue,
  closing: string | undefined,
) => {
  const { app, settings } = group;
  const path = (SchemaIssue.makeFormatterStandardSchemaV1()(issue).issues[0]?.path ?? []).map(String);
  const own = settings.filter((s) => s.files.includes(file));

  const stopped = (reason: SettingsError["reason"], text: string, key: ReadonlyArray<string>) =>
    stop(app, reason, text, inFile(file, found.name, lineAt(found.document, key)), undefined, closing);

  // A fault inside a setting's value (a member of a record, a field of a table) is the setting's own, at its own line: the member's key is part of the value, and a message never holds one.
  const holder = own.find((s) => reaches(s, path));

  if (holder !== undefined) {
    const line = faultLine(found.document, path);

    return line === undefined
      ? unfit(app, holder, file, found.name, issue, closing)
      : refused(app, holder, inFile(file, found.name, line), issue, closing);
  }

  if (own.some((s) => under(s, path))) {
    return stopped("invalid", `${path.join(".")} is a table of settings, not a value.`, path);
  }

  const key = leaf(found.document.value, path);
  const version = `${app}-version`;

  if (file === "user" && key.join(".") === version) {
    return stopped("scope", `${version} may be set only in ${names.repo}.`, key);
  }

  const other = settings.find((s) => same(segments(s.name), key));

  if (other !== undefined) {
    return stopped("scope", `${other.name} may be set only in ${places(app, other, names)}.`, key);
  }

  const guess = near(
    own.map((s) => s.name),
    key.join("."),
  );

  return stopped(
    "unknown",
    `there is no setting ${key.join(".")}.${Option.match(guess, { onNone: () => "", onSome: (name) => ` Did you mean ${name}?` })}`,
    key,
  );
};

/**
 * What a type was expected to be, as one sentence, from an issue made fresh with no input, so no input can reach it. Effect writes `Expected <type>`, and the schema author's own `message`, where one is declared, as written: that sentence is said as the author wrote it, as a description is, and the other gets its full stop.
 */
const expected = (ast: SchemaAST.AST): string => {
  const text = SchemaIssue.makeFormatterDefault()(new SchemaIssue.InvalidType(ast));

  return Predicate.isString(ast.annotations?.message) ? text : `${text}.`;
};

/**
 * What a refused value had to be, as a sentence, from the declared parts of its issue only: never the input, never a message a check wrote at run time, never a path inside the value.
 */
const rule = (issue: SchemaIssue.Issue): Option.Option<string> => {
  switch (issue._tag) {
    case "Filter":
      return Option.map(
        Option.fromNullishOr(issue.filter.annotations?.expected),
        (declared) => `Expected ${declared}.`,
      );
    case "InvalidType":
    case "AnyOf":
    case "OneOf":
      return Option.some(expected(issue.ast));
    case "Pointer":
    case "Encoding":
      return rule(issue.issue);
    case "Composite":
      return rule(issue.issues[0]);
    case "MissingKey":
      return Option.some("Expected a table with every key it needs.");
    case "UnexpectedKey":
      return Option.some("Expected a table with no other keys.");
    case "InvalidValue":
    case "Forbidden":
      return Option.none();
  }
};

/** What a setting's schema asks for, as a message says it, in place of the value it refused: its title and description, else the rule its issue declares. */
const wanted = (s: Setting.Any, name: string, issue: SchemaIssue.Issue) => {
  const title = SchemaAST.resolveTitle(s.schema.ast);
  const description = SchemaAST.resolveDescription(s.schema.ast);

  const tail =
    description !== undefined
      ? ` ${description}`
      : Option.match(rule(issue), {
          onSome: (said) => ` ${said}`,
          onNone: () => (title === undefined ? " Its schema names no rule." : ""),
        });

  return `${name} is not ${title ?? "a valid value"}.${tail}`;
};

/** The `invalid` error for a value its setting's schema refuses, naming where it was and never what it was. A variable's or a flag's message names it, and any other says the setting; with no place (a default its schema refuses) it names the setting and has none. */
export const refused = (
  app: string,
  s: Setting.Any,
  place: Diagnostic.Place | undefined,
  issue: SchemaIssue.Issue,
  closing?: string,
) =>
  stop(
    app,
    "invalid",
    wanted(
      s,
      place === undefined
        ? s.name
        : Diagnostic.Place.match(place, {
            repo: () => s.name,
            home: () => s.name,
            environment: ({ name }) => name,
            flag: ({ name }) => name,
          }),
      issue,
    ),
    place,
    undefined,
    closing,
  );

/** The `invalid` error for a value an edit was asked to write that its setting's schema refuses: the file is named, no line, and never the value. */
export const unfit = (
  app: string,
  s: Setting.Any,
  file: Setting.File,
  name: string,
  issue: SchemaIssue.Issue,
  closing?: string,
) => stop(app, "invalid", wanted(s, s.name, issue), inFile(file, name), undefined, closing);

/** How a check of one file differs from the start's: the closing sentence, and one key left out. */
interface Options {
  /** The sentence that ends each message. The start's own, `<app> did not start.`, when none is given. */
  readonly closing?: string;
  /** A key whose value is not decoded: an edit is about to replace or take out its old value. */
  readonly without?: Path | undefined;
}

/** Checks one file against the settings that may be set in it. Its first fault is the one error. */
export const check = Effect.fnUntraced(function* (
  group: Group,
  file: Setting.File,
  found: Loaded,
  names: Names,
  options: Options = {},
) {
  const own = group.settings.filter((s) => s.files.includes(file));
  // The repo's minimum version was checked on its own, ahead of everything else.
  const whole = file === "repo" ? Rec.remove(found.document.value, `${group.app}-version`) : found.document.value;
  const value = options.without === undefined ? whole : drop(whole, options.without);

  // A file no setting may be set in refuses every key, where an empty Struct would take any object.
  const schema = own.length === 0 ? Schema.Record(Schema.String, Schema.Never) : Schema.Struct(fields(own, 0));

  yield* Schema.decodeUnknownEffect(schema)(value, { onExcessProperty: "error" }).pipe(
    Effect.mapError((error) => explain(group, file, found, names, error.issue, options.closing)),
  );
});
