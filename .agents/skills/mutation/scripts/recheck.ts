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
//
// The same step first type-checks what lived (ticket 1309, `typedFrom`): a mutant that breaks the types is a type error, which the repo's own
// `tsc` refuses, so it counts as a kill (Stryker's own status for it, `CompileError`) and is never listed or run again. The vitest
// runner strips types and never checks them, so before this a mutant that `tsc` would have refused was listed as a survivor and the builder
// wrote a reason for something already caught (PRs 2311, 2312, 2313, 2319). Measured on this repo, a Git file of 106 mutants and a Config
// file of 49: Stryker's TypeScript checker (native preview) costs +26 s on the Config file and saves 52 s on the Git file (49 of its mutants
// are type errors, which skip the laws), but it needs a second TypeScript (the checker reads the JS API TypeScript 7 does not have) and the
// native preview package under another name, a package extension and a lockfile change, and it checks one tsconfig per run, so a change
// across packages is checked in one of them only. Checking only the mutants that lived costs one `tsc --noEmit` of the mutant's own package
// each (0.7 s for `@kalfa/git`), needs nothing installed, and judges every package.
import { spawnSync } from "node:child_process"; // edge: the one tsc run, a real process
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs"; // edge: the box's checkout and the report, on disk
import { dirname, join, relative, resolve } from "node:path"; // edge: paths of that checkout
import { Array as Arr, Schema, String as Str } from "effect";

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

// ---------------------------------------------------------------- the type check of what lived (ticket 1309)

const Lived = Schema.Struct({
  files: Schema.Record(
    Schema.String,
    Schema.Struct({
      mutants: Schema.Array(
        Schema.Struct({
          id: Schema.String,
          status: Schema.String,
          replacement: Schema.optional(Schema.String),
          location: Schema.Struct({ start: Position, end: Position }),
        }),
      ),
    }),
  ),
});

/** A mutant as the report gives it: where it is (lines and columns from 1, the end exclusive) and the text that replaces what is there. */
type Replaced = {
  readonly replacement: string;
  readonly location: { readonly start: typeof Position.Type; readonly end: typeof Position.Type };
};

/** The source with the mutant applied, or `null` when its place is not in the source. Pure. */
export const mutate = (source: string, mutant: Replaced): string | null => {
  const lines = Str.split(source, "\n");
  const { start, end } = mutant.location;

  if (start.line < 1 || end.line > lines.length || start.line > end.line) {
    return null;
  }

  const offset = (at: typeof Position.Type) =>
    Arr.take(lines, at.line - 1).reduce((n, line) => n + line.length + 1, 0) + at.column - 1;

  return `${source.slice(0, offset(start))}${mutant.replacement}${source.slice(offset(end))}`;
};

/** The error lines of `tsc`'s output: a diagnostic line (`path(1,2): error TS2322: ...`) or a global one (`error TS5083: ...`). Pure. */
export const errorsIn = (output: string): ReadonlyArray<string> =>
  Arr.filter(Str.split(output, "\n"), (line) => /(^|\): )error [A-Za-z]*\d+/.test(line));

/**
 * The errors of one type check of a package, or `null` when it could not judge (the tool did not run, ran out of time, or failed with
 * no error line to show for it): a package that was never checked is not a package that checked clean.
 */
export type Checked = ReadonlyArray<string> | null;

/**
 * Whether a mutant is a type error: the package type-checks as it is (`baseline` is empty), and with the mutant it does not.
 * A package that fails as it is judges nothing, since its errors would not be the mutant's. Pure.
 */
export const isTypeError = (baseline: Checked, mutated: Checked): boolean =>
  baseline !== null && baseline.length === 0 && mutated !== null && mutated.length > 0;

/** The nearest folder under `root` that holds a `tsconfig.json`, from a file's own folder up; `null` when there is none. */
export const tsconfigDir = (root: string, file: string): string | null => {
  for (let dir = dirname(file); dir.startsWith(root) && dir !== root; dir = dirname(dir)) {
    if (existsSync(join(dir, "tsconfig.json"))) {
      return dir;
    }
  }

  return null;
};

/** Stryker's own words for a mutant the type check refused. */
const REFUSED = "CompileError";

/** What `retag` reads and keeps of a report: only the mutants' ids and statuses matter to it. */
type Loose = { files?: Record<string, { mutants?: Array<Record<string, unknown>> }> };

/**
 * The report text with each mutant in `typed` (its id, by file) set to `CompileError`, the status Stryker's TypeScript checker gives a
 * mutant that does not compile, and a reason beside it. Everything else of the report stays as it was. Pure.
 */
export const retag = (report: string, typed: ReadonlyMap<string, ReadonlyMap<string, string>>): string => {
  const copy: Loose = JSON.parse(report);

  for (const [file, entry] of Object.entries(copy.files ?? {})) {
    for (const mutant of entry.mutants ?? []) {
      const reason = typed.get(file)?.get(String(mutant["id"]));

      if (reason !== undefined) {
        mutant["status"] = REFUSED;
        mutant["statusReason"] = reason;
      }
    }
  }

  return JSON.stringify(copy);
};

/** `tsc --noEmit` of a package folder, run from `root`; the real `Checked`. */
export const tscCheck =
  (tsc: string, root: string, seconds = 120) =>
  (dir: string): Checked => {
    const ran = spawnSync(tsc, ["--noEmit", "-p", dir], {
      cwd: root,
      encoding: "utf8",
      timeout: seconds * 1000,
      maxBuffer: 64 * 1024 * 1024,
    });

    if (ran.error !== undefined || ran.status === null) {
      return null;
    }

    const errors = errorsIn(`${ran.stdout}\n${ran.stderr}`);

    return ran.status === 0 ? [] : errors.length > 0 ? errors : null;
  };

/** What the type check found: the mutants it refused, how many it checked, and how many the time ran out on. */
export type Typed = {
  readonly checked: number;
  readonly typed: ReadonlyArray<{ readonly file: string; readonly id: string; readonly reason: string }>;
  readonly unreached: number;
};

/**
 * Type-checks each mutant that lived (`Survived`, `NoCoverage`) in a first run's report, in its own package, and rewrites the report so
 * the ones that do not compile read `CompileError`: `plan` then leaves them out, and mutbox counts them as kills. The original report is kept as
 * `<out>/report.stryker.json` and the finding as `<out>/typed.json`. Each file is put back as it was, mutant by mutant. A mutant left
 * when `seconds` ran out, or one in a file with no package `tsconfig.json`, stays as it was. `check` is `tscCheck` in the box. Edge.
 */
export const typedFrom = (o: {
  readonly root: string;
  readonly report: string;
  readonly out: string;
  readonly seconds: number;
  readonly check: (dir: string) => Checked;
  readonly now?: () => number;
}): Typed => {
  const now = o.now ?? Date.now;
  const began = now();
  const text = readFileSync(o.report, "utf8");
  const report = Schema.decodeUnknownSync(Schema.fromJsonString(Lived))(text);
  const baselines = new Map<string, Checked>();
  const found = new Map<string, Map<string, string>>();
  const typed: Array<{ file: string; id: string; reason: string }> = [];
  let checked = 0;
  let unreached = 0;

  for (const [file, entry] of Object.entries(report.files)) {
    const path = resolve(o.root, file);
    const dir = tsconfigDir(o.root, path);
    const lived = Arr.filter(entry.mutants, (m) => LIVED.has(m.status) && m.replacement !== undefined);

    if (dir === null || lived.length === 0) {
      continue;
    }

    if (!baselines.has(dir)) {
      baselines.set(dir, o.check(dir));
    }

    const baseline = baselines.get(dir) ?? null;
    const original = readFileSync(path, "utf8");

    for (const m of lived) {
      if (now() - began > o.seconds * 1000) {
        unreached += 1;
        continue;
      }

      const mutated = mutate(original, { replacement: m.replacement ?? "", location: m.location });

      if (mutated === null) {
        continue;
      }

      writeFileSync(path, mutated);

      try {
        const got = o.check(dir);
        checked += 1;

        if (isTypeError(baseline, got)) {
          const reason = `tsc ${relative(o.root, dir)}: ${got?.[0] ?? ""}`;
          typed.push({ file, id: m.id, reason });
          found.set(file, (found.get(file) ?? new Map()).set(m.id, reason));
        }
      } finally {
        writeFileSync(path, original);
      }
    }
  }

  mkdirSync(o.out, { recursive: true });
  writeFileSync(join(o.out, "report.stryker.json"), text);
  writeFileSync(join(o.out, "typed.json"), JSON.stringify({ checked, unreached, typed }));

  if (typed.length > 0) {
    writeFileSync(o.report, retag(text, found));
  }

  return { checked, typed, unreached };
};
