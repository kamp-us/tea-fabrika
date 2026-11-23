/**
 * The editor's JSON Schema of one configuration file, as the text a repo commits. It is made from the one tree the start's whole-file check reads, so the editor and the start cannot disagree about a key or a value.
 */
import { Schema } from "effect";
import * as Rec from "effect/Record";
import type * as Setting from "../Declaration.ts";
import * as JsonSchema from "../JsonSchema.ts";
import { fields, type Group } from "./check.ts";

/** Strict Semantic Versioning 2.0.0 as Effect's `SemVer.ts` parses it: no leading zeros, no empty identifier. It cannot say Effect's last rule, that no number is above the largest safe integer. */
const SEMVER =
  /^(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)(?:-(?:0|[1-9]\d*|\d*[A-Za-z-][0-9A-Za-z-]*)(?:\.(?:0|[1-9]\d*|\d*[A-Za-z-][0-9A-Za-z-]*))*)?(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/u;

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
