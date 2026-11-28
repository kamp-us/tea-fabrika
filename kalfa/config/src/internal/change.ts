/**
 * One edit of one configuration file's text, in memory: set one setting's value, or take it out. The text is the only input and the new text the only answer, so nothing is read or written here.
 *
 * Each step stops at the first fault with the one error, and no text comes back after it. A record is compared key by key by the format, and these checks guard that compare as they guard a one-key splice. Before the splice: the setting is one of the group's, its file scope holds the file, a value passes its schema and can be written, the text parses, and the whole file passes with this setting's own old value left out. After it: the answer parses, holds only the one change, and passes the whole check.
 */
import { Effect, Option, Schema } from "effect";
import * as Predicate from "effect/Predicate";
import * as Rec from "effect/Record";
import type * as Setting from "../Declaration.ts";
import { check, type Group, places, unfit, version } from "./check.ts";
import { at, drop, type Path, put, same } from "./document.ts";
import { equal, prefix } from "./edit.ts";
import { type SettingsError, stop } from "./error.ts";
import { type Document, Fault, type Format } from "./format.ts";
import { segments } from "./names.ts";
import { inFile, type Names, parse } from "./place.ts";

/** The file an edit is about: which one, and the names a person reads for both. */
interface Place {
  readonly file: Setting.File;
  readonly names: Names;
}

/** The first line that names the key at `path`: the key itself, its table's header, or a dotted key below it. */
const named = (document: Document, path: Path) => {
  const lines = document.spans.filter((span) => prefix(path, span.path)).map((span) => span.line);

  return lines.length === 0 ? undefined : Math.min(...lines);
};

/** The data the answer must hold: the old data with the one change. A removal takes with it the tables that held only that key, unless a line of the text names them. */
const expected = (before: Document, after: Document, path: Path, written: Option.Option<unknown>) =>
  Option.match(written, {
    onSome: (value) => put(before.value, path, value),
    onNone: () => {
      const spans = [...before.spans, ...after.spans];
      let value = drop(before.value, path);

      for (let n = path.length - 1; n > 0; n--) {
        const parent = path.slice(0, n);
        const table = at(value, parent);

        if (!Predicate.isObject(table) || !Rec.isEmptyRecord(table) || spans.some((span) => same(span.path, parent))) {
          break;
        }

        value = drop(value, parent);
      }

      return value;
    },
  });

/**
 * Edits one key of `text`: sets it to `value`, or takes it out when `value` is none. Fails with the first fault's error, and an answer is the whole new text.
 */
const change = Effect.fnUntraced(function* (
  group: Group,
  format: Format,
  place: Place,
  text: string,
  setting: Setting.Any,
  value: Option.Option<unknown>,
) {
  const { app } = group;
  const file = place.names[place.file];
  const closing = `${file} was not changed.`;

  const refuse = (reason: SettingsError["reason"], words: string, line?: number, cause?: unknown) =>
    stop(app, reason, words, inFile(place.file, file, line), cause, closing);

  // The setting is one of the group's, found by its name, and the file may hold it.
  const own = group.settings.find((s) => s.name === setting.name);

  if (own === undefined) {
    return yield* refuse("unknown", `${setting.name} is not a setting of ${app}.`);
  }

  if (!own.files.includes(place.file)) {
    return yield* refuse("scope", `${own.name} may be set only in ${places(app, own, place.names)}.`);
  }

  // The value, as the file writes it: checked against the schema first, then encoded as a start decodes it.
  const written = yield* Option.match(value, {
    onNone: () => Effect.succeed(Option.none<unknown>()),
    onSome: (given) =>
      Schema.encodeUnknownEffect(Schema.toCodecJson(own.schema))(given).pipe(
        Effect.asSome,
        Effect.mapError((error) => unfit(app, own, place.file, file, error.issue, closing)),
      ),
  });

  const whole = Effect.fnUntraced(function* (document: Document, without?: Path) {
    const found = { name: file, document };

    // The repo file's minimum version is checked on its own, as the start does it.
    if (place.file === "repo") {
      yield* Effect.fromResult(version(app, found, closing));
    }

    yield* check(group, place.file, found, place.names, { closing, without });
  });

  const path = segments(own.name);
  const before = yield* Effect.fromResult(parse(app, format, { name: file, file: place.file }, text, closing));

  // The old value of this setting is left out: an edit is how a bad one is fixed or taken out.
  yield* whole(before.document, path);

  const next = yield* Effect.fromResult(
    Option.match(written, {
      onSome: (given) => format.set(text, path, given),
      onNone: () => format.remove(text, path),
    }),
  ).pipe(
    Effect.mapError((fault) =>
      Fault.match(fault, {
        Syntax: () => refuse("edit", `changing ${own.name} would leave ${file} not valid ${format.name}.`),
        Value: () => refuse("invalid", `${own.name} holds a value ${format.name} cannot write.`),
        Conflict: ({ line, cause }) =>
          refuse(
            "edit",
            `${own.name} is not one key in this text, so it cannot be changed as one.`,
            named(before.document, path) ?? line,
            cause,
          ),
      }),
    ),
  );

  const after = yield* Effect.fromResult(parse(app, format, { name: file, file: place.file }, next, closing)).pipe(
    Effect.mapError(() => refuse("edit", `changing ${own.name} would leave ${file} not valid ${format.name}.`)),
  );

  if (!equal(after.document.value, expected(before.document, after.document, path, written))) {
    return yield* refuse("edit", `changing ${own.name} would change other settings in ${file}.`);
  }

  yield* whole(after.document);

  return next;
});

/** Sets one setting's value in `text`: the new text, with every other byte as it was. */
export const set = (group: Group, format: Format, place: Place, text: string, setting: Setting.Any, value: unknown) =>
  change(group, format, place, text, setting, Option.some(value));

/** Takes one setting out of `text`: the new text, or the same text when the key is not there. */
export const remove = (group: Group, format: Format, place: Place, text: string, setting: Setting.Any) =>
  change(group, format, place, text, setting, Option.none());
