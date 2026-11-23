/**
 * The whole-file check of a setting group: a file is read against the settings that may be set in it, and its first fault is the one error. It reads no file and starts nothing.
 */
import { Effect, Option, Schema, SchemaAST, SchemaIssue, type SemVer } from "effect";
import * as Rec from "effect/Record";
import * as Result from "effect/Result";
import type * as Setting from "../Declaration.ts";
import { Origin } from "../Sources.ts";
import { distance, leaf, lineAt, same } from "./document.ts";
import { type Position, type SettingsError, stop } from "./error.ts";
import { segments, variable } from "./names.ts";
import type { Loaded, Names } from "./place.ts";

export interface Group {
  readonly app: string;
  readonly settings: ReadonlyArray<Setting.Any>;
}

/** The minimum version a repo asks for, and where it asks. */
interface Minimum {
  readonly version: SemVer.SemVer;
  readonly position: Position;
}

/** The minimum version the repo configuration asks for, or none. Fails when `<app>-version` does not read as a version. */
export const version = (app: string, repo: Loaded): Result.Result<Option.Option<Minimum>, SettingsError> => {
  const key = `${app}-version`;
  const wanted = repo.document.value[key];

  if (wanted === undefined) {
    return Result.succeed(Option.none());
  }

  const position = { file: repo.name, line: lineAt(repo.document, [key]) };

  return Schema.decodeUnknownResult(Schema.SemVerFromString)(wanted).pipe(
    Result.mapError(() => stop(app, "invalid", `${key} is not a version, as 1.2.3.`, position)),
    Result.map((asked) => Option.some({ version: asked, position })),
  );
};

/** The Struct a file is decoded with: every table and leaf optional. */
const struct = (settings: ReadonlyArray<Setting.Any>, depth: number): Schema.Codec<unknown, unknown> =>
  Schema.Struct(
    Rec.fromEntries(
      [...new Set(settings.flatMap((s) => segments(s.name)[depth] ?? []))].map((word) => {
        const below = settings.filter((s) => segments(s.name)[depth] === word);
        const own = below.find((s) => segments(s.name).length === depth + 1);

        return [
          word,
          Schema.optionalKey(own === undefined ? struct(below, depth + 1) : Schema.toCodecJson(own.schema)),
        ];
      }),
    ),
  );

/** Whether `path` is the setting's own name or one of its tables. */
const under = (s: Setting.Any, path: ReadonlyArray<string>) => path.every((word, n) => segments(s.name)[n] === word);

/** Where a setting may be set, as a message says it: its files, and its variable unless only a file may set it. */
export const places = (app: string, s: Setting.Any, names: Names) =>
  [...s.files.map((file) => names[file]), ...(s.fileOnly ? [] : [`as ${variable(app, s.name)}`])]
    .map((place, n, all) =>
      n === 0 ? place : n === all.length - 1 && place.startsWith("as ") ? `, or ${place}` : ` or ${place}`,
    )
    .join("");

/** The one message for the first issue of `file`. An unknown key is named, and its value never is. */
const explain = (group: Group, file: Setting.File, found: Loaded, names: Names, issue: SchemaIssue.Issue) => {
  const { app, settings } = group;
  const path = (SchemaIssue.makeFormatterStandardSchemaV1()(issue).issues[0]?.path ?? []).map(String);
  const own = settings.filter((s) => s.files.includes(file));

  const stopped = (reason: SettingsError["reason"], text: string, key: ReadonlyArray<string>) =>
    stop(app, reason, text, { file: found.name, line: lineAt(found.document, key) });

  if (own.some((s) => under(s, path))) {
    const s = own.find((s) => same(segments(s.name), path));

    return s === undefined
      ? stopped("invalid", `${path.join(".")} is a table of settings, not a value.`, path)
      : refused(app, s, Origin.cases.file.make({ file: found.name, line: lineAt(found.document, path) ?? 0 }));
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

  const near = own
    .map((s) => ({ name: s.name, edits: distance(s.name, key.join(".")) }))
    .filter(({ edits }) => edits <= 2)
    .sort((a, b) => a.edits - b.edits)[0];

  return stopped(
    "unknown",
    `there is no setting ${key.join(".")}.${near === undefined ? "" : ` Did you mean ${near.name}?`}`,
    key,
  );
};

/** The `invalid` error for a value its setting's schema refuses, naming where it was and never what it was. */
export const refused = (app: string, s: Setting.Any, origin: Origin) => {
  const expected = SchemaAST.resolveTitle(s.schema.ast) ?? "a valid value";
  const rule = SchemaAST.resolveDescription(s.schema.ast);
  const text = (name: string) => `${name} is not ${expected}.${rule === undefined ? "" : ` ${rule}`}`;

  return Origin.matchOrElse(
    origin,
    {
      file: ({ file, line }) => stop(app, "invalid", text(s.name), { file, line }),
      default: () => stop(app, "invalid", text(s.name)),
    },
    ({ name }) => stop(app, "invalid", text(name)),
  );
};

/** Checks one file against the settings that may be set in it. Its first fault is the one error. */
export const check = Effect.fnUntraced(function* (group: Group, file: Setting.File, found: Loaded, names: Names) {
  const own = group.settings.filter((s) => s.files.includes(file));
  // The repo's minimum version was checked on its own, ahead of everything else.
  const value = file === "repo" ? Rec.remove(found.document.value, `${group.app}-version`) : found.document.value;

  // A file no setting may be set in refuses every key, where an empty Struct would take any object.
  const schema = own.length === 0 ? Schema.Record(Schema.String, Schema.Never) : struct(own, 0);

  yield* Schema.decodeUnknownEffect(schema)(value, { onExcessProperty: "error" }).pipe(
    Effect.mapError((error) => explain(group, file, found, names, error.issue)),
  );
});
