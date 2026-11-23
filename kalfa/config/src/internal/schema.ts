/**
 * The editor's JSON Schema of one configuration file, as the text a repo commits. It is made from the one tree the start's whole-file check reads, so the editor and the start cannot disagree about a key or a value.
 */
import { Schema } from "effect";
import * as Rec from "effect/Record";
import type * as Setting from "../Declaration.ts";
import * as JsonSchema from "../JsonSchema.ts";
import { fields, type Group } from "./check.ts";

/** The text of every whole number from 0 to `limit`, with no leading zero, as a pattern: the shorter ones by length, the ones of the limit's length digit by digit. */
const upTo = (limit: string): string => {
  const same = [...limit].flatMap((digit, at) => {
    const first = at === 0 ? 1 : 0;
    const last = Number(digit) - 1;

    return last < first ? [] : [`${limit.slice(0, at)}[${first}-${last}]\\d{${limit.length - at - 1}}`];
  });

  return `(?:0|[1-9]\\d{0,${limit.length - 2}}|${[...same, limit].join("|")})`;
};

// Effect's `SemVer.ts` reads a number as a safe integer, and an identifier of only digits as one too, so both are
// held to the largest safe integer, 9007199254740991.
const NUMBER = upTo(`${Number.MAX_SAFE_INTEGER}`);

const PRERELEASE = `(?:${NUMBER}|\\d*[A-Za-z-][0-9A-Za-z-]*)`;

/** Strict Semantic Versioning 2.0.0 as Effect's `SemVer.ts` parses it: no leading zeros, no empty identifier, no number above the largest safe integer. */
const SEMVER = new RegExp(
  `^${NUMBER}\\.${NUMBER}\\.${NUMBER}(?:-${PRERELEASE}(?:\\.${PRERELEASE})*)?(?:\\+[0-9A-Za-z-]+(?:\\.[0-9A-Za-z-]+)*)?$`,
  "u",
);

/** The repo configuration's minimum version, as the editor reads it. */
const Version = (app: string) =>
  Schema.String.check(Schema.isPattern(SEMVER)).annotate({
    description: `The oldest ${app} version this repo works with, as 1.2.3.`,
  });

/** The editor's JSON Schema of one file as committed text: the settings its file scope allows, the repo's `<app>-version`, and nothing else. Throws for a schema JSON Schema cannot hold exactly. */
export const text = (group: Group, file: Setting.File): string => {
  const own = {
    ...fields(
      group.settings.filter((s) => s.files.includes(file)),
      0,
    ),
    ...(file === "repo" ? { [`${group.app}-version`]: Schema.optionalKey(Version(group.app)) } : {}),
  };

  // A file no key may be set in refuses every key, where an empty Struct would take any object.
  return JsonSchema.format(
    JsonSchema.make(Rec.isEmptyRecord(own) ? Schema.Record(Schema.String, Schema.Never) : Schema.Struct(own)),
  );
};
