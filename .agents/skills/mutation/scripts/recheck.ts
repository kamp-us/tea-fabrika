// recheck.ts: what the box runs again at full depth after a capped run (ticket 1306). Today's lead tooling, not product.
//
// A property law capped to `MUTATE_RUNS` cases draws other cases than at its own count (depth.ts), so a mutant can
// live at the cap and die at full depth: one law of `@kalfa/git` needed 21 to 25 cases for four of them. The gate
// treats the cap as the fast way and full depth as the fallback: a mutant that lives at the cap is run again at full depth, and
// it is reported as a survivor only when it lives there too.
//
// This file is the plan of that second run, from the first run's report: the ranges to mutate (the same range text the sampler
// writes, so Stryker picks the same mutants), the test files to run, and a pattern for the tests that cover them, so
// the second run does not run every law again at full depth. A mutant no test covered (`NoCoverage`) has no covering test to name, since
// it may be covered at full depth, so any one of those sends every related file with no name pattern. `mutbox-entry.sh` reads
// the plan from here (`planFrom`); `mutbox.ts` reads the second run's answer (`confirm`).
import { Array as Arr, Schema } from "effect";

const Position = Schema.Struct({ line: Schema.Finite, column: Schema.Finite });

const Mutant = Schema.Struct({
  status: Schema.String,
  coveredBy: Schema.optional(Schema.Array(Schema.String)),
  location: Schema.Struct({ start: Position, end: Position }),
});

export const FirstReport = Schema.Struct({
  files: Schema.Record(Schema.String, Schema.Struct({ mutants: Schema.Array(Mutant) })),
  testFiles: Schema.optional(
    Schema.Record(
      Schema.String,
      Schema.Struct({ tests: Schema.Array(Schema.Struct({ id: Schema.String, name: Schema.String })) }),
    ),
  ),
});

/** What the second run is given: `names` is `null` when every test of the files runs. */
export type Plan = {
  readonly ranges: ReadonlyArray<string>;
  readonly related: ReadonlyArray<string>;
  readonly names: string | null;
};

const LIVED = new Set(["Survived", "NoCoverage"]);

const repoPath = (path: string) => path.replace(/^\/repo\//, "");

const escaped = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** A test's title: its name after the last ` > ` of its describe chain. Pure. */
export const title = (name: string): string => {
  const at = name.lastIndexOf(" > ");

  return at < 0 ? name : name.slice(at + 3);
};

/**
 * The second run, or `null` when nothing lived. The ranges are the mutants' own, as the sampler writes them: the report counts
 * columns from 1 and a range from 0. Pure.
 */
export const plan = (report: typeof FirstReport.Type, related: ReadonlyArray<string>): Plan | null => {
  const lived = Arr.flatMap(Object.entries(report.files), ([file, entry]) =>
    Arr.filter(entry.mutants, (m) => LIVED.has(m.status)).map((m) => ({ file: repoPath(file), m })),
  );

  if (lived.length === 0) {
    return null;
  }

  const ranges = Arr.dedupe(
    lived.map(
      ({ file, m }) =>
        `${file}:${m.location.start.line}:${m.location.start.column - 1}-${m.location.end.line}:${m.location.end.column - 1}`,
    ),
  );

  const byId = new Map<string, { readonly file: string; readonly title: string }>();

  for (const [file, entry] of Object.entries(report.testFiles ?? {})) {
    for (const test of entry.tests) {
      byId.set(test.id, { file: repoPath(file), title: title(test.name) });
    }
  }

  const covering = Arr.flatMap(lived, ({ m }) => m.coveredBy ?? []).map((id) => byId.get(id));
  const known = Arr.filter(covering, (test) => test !== undefined);

  // A mutant with no test, or a test the report does not name: all the related files, every test.
  if (
    Arr.some(lived, ({ m }) => m.status === "NoCoverage" || (m.coveredBy ?? []).length === 0) ||
    known.length < covering.length
  ) {
    return { ranges, related, names: null };
  }

  return {
    ranges,
    related: Arr.filter(related, (path) => known.some((test) => test.file === path)),
    names: Arr.dedupe(known.map((test) => escaped(test.title))).join("|"),
  };
};

/** The plan of a first run's report text, or `null` when nothing lived. A report that does not fit is an error. */
export const planFrom = (text: string, related: ReadonlyArray<string>): Plan | null =>
  plan(Schema.decodeUnknownSync(Schema.fromJsonString(FirstReport))(text), related);
