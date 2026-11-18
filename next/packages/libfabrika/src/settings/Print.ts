/**
 * The plain-text report an app's settings command, as `fabrika settings`, prints from `Reference.rows`.
 *
 * **Details**
 *
 * Explicitly set keys show, and `all` adds the keys their defaults supply. Which rows show depends on each origin's `_tag`, never on a value, so a key set to its own default still shows, and `all` never changes what a row says.
 */
import * as Str from "effect/String";
import type { Row, Warning } from "./Reference.ts";
import { Origin } from "./Sources.ts";

const from = (origin: Origin) =>
  Origin.matchOrElse(
    origin,
    { file: (origin) => `${origin.file}, line ${origin.line}`, default: () => "the default" },
    (origin) => origin.name,
  );

const indent = (text: string) => Str.replace(/\n/g, "\n  ")(text);

/**
 * Formats rows as the report text: one block per shown row, then a count of the hidden ones.
 *
 * **Details**
 *
 * Each block gives the path and value, where it came from (file and line, `the default`, or the flag or environment name), the default, and the setting's doc. Unless `all` is true, rows whose origin is the default are left out and counted in a closing line that points at the app's own list command with `--all`. The text ends with one newline.
 *
 * @category combinators
 */
export const report = (rows: ReadonlyArray<Row>, options: { readonly all: boolean }) => {
  const shown = rows.filter((row) => options.all || row.origin._tag !== "default");

  const blocks = shown.map((row) =>
    [
      `${row.path} = ${JSON.stringify(row.value)}`,
      `  from ${from(row.origin)}`,
      `  default ${JSON.stringify(row.default)}`,
      `  ${indent(row.doc)}`,
    ].join("\n"),
  );

  const hidden = rows.length - shown.length;
  const list = rows[0]?.app.list;
  const rest =
    hidden === 0 || list === undefined ? [] : [`Keys left at their defaults: ${hidden}. ${list} --all shows them.`];

  return `${[...blocks, ...rest].join("\n\n")}\n`;
};

/**
 * Formats each warning as one line, to print apart from the report.
 *
 * **Details**
 *
 * Each line names the key, the release of its app it came in and the repo's stated minimum, and says that the app at that minimum, older than the key, may refuse it.
 *
 * @category combinators
 */
export const warnings = (warnings: ReadonlyArray<Warning>) =>
  warnings.map(
    (w) =>
      `${w.path} came in ${w.app} ${w.since}, and this repo works with ${w.app} ${w.minimum} or newer, which may refuse it.`,
  );
