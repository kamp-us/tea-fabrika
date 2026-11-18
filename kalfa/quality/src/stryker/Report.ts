// What a plant run knows after Stryker ran: the JSON report as much as is read, the answer it gives,
// and the one record line a run leaves (decision 0600). Pure.
//
// Three position bases meet here, and each is said where it is read. Stryker's JSON report counts
// lines and columns from 1. A found target counts lines from 1 and columns from 0, as Stryker's
// `mutate` range does. The instrumenter's own mutants count both from 0 (see `Mutants.ts`).
//
// Stryker renumbers its test ids to "0", "1" and so on before it writes the report, so a mutant's
// `killedBy` names no test by itself: it is looked up in the report's `testFiles`.
//
// No failure text is recorded. `statusReason` can echo environment values, so the schemas below do
// not even decode it, and no record or refusal holds a line of the file that was read (law Q13).
import { Match, Schema } from "effect";
import { fold } from "./Plant.ts";
import type { Plant, Law } from "./Plant.ts";

const Position = Schema.Struct({ line: Schema.Int, column: Schema.Int });

const Mutant = Schema.Struct({
  mutatorName: Schema.String,
  replacement: Schema.optional(Schema.String),
  status: Schema.String,
  killedBy: Schema.optional(Schema.Array(Schema.String)),
  coveredBy: Schema.optional(Schema.Array(Schema.String)),
  testsCompleted: Schema.optional(Schema.Finite),
  location: Schema.Struct({ start: Position, end: Position }),
});

/** As much of `mutation-testing-report-schema` 3.8.4's report as is read. A field not named here is dropped at decode. */
export const Report = Schema.Struct({
  files: Schema.Record(Schema.String, Schema.Struct({ mutants: Schema.Array(Mutant) })),
  testFiles: Schema.optional(
    Schema.Record(
      Schema.String,
      Schema.Struct({ tests: Schema.Array(Schema.Struct({ id: Schema.String, name: Schema.String })) }),
    ),
  ),
  framework: Schema.optional(Schema.Struct({ version: Schema.optional(Schema.String) })),
});

export type Report = typeof Report.Type;

/** A found target: the one mutant a plant names, with its place (line from 1, column from 0) and its folded texts. */
export const Found = Schema.Struct({
  file: Schema.String,
  line: Schema.Int,
  column: Schema.Int,
  endLine: Schema.Int,
  endColumn: Schema.Int,
  mutator: Schema.String,
  original: Schema.String,
  replacement: Schema.String,
});

export type Found = typeof Found.Type;

/** A test that killed a mutant, as the report's `testFiles` names it. */
const Test = Schema.Struct({ file: Schema.String, name: Schema.String });

type Test = typeof Test.Type;

/** What a plant run answers. Only `killed` is a pass. */
export const Answer = Schema.TaggedUnion({
  /** The law is among the tests that killed the mutant: the plant holds. */
  killed: { by: Schema.Array(Test) },
  /** Killed, but not by the law. */
  elsewhere: { by: Schema.Array(Test) },
  survived: {},
  /** No test of the law's file reached it. */
  no_coverage: {},
  /** Red, but no test is named, so it never proves the law. */
  timeout: {},
  error: { status: Schema.Literals(["CompileError", "RuntimeError"]) },
  /** The report holds no mutant at the target. */
  not_run: {},
});

export type Answer = typeof Answer.Type;

/** What fails before Stryker starts, or when it cannot, each naming what it looked at and no text of the file. */
export class Refused extends Schema.TaggedError<Refused, { readonly brand: unique symbol }>()("Refused", {
  reason: Schema.Literals([
    "unknown_plant",
    "not_found",
    "ambiguous",
    "within_not_once",
    "needs_in_place",
    "not_allowed",
    "could_not_run",
  ]),
  /** Every place the shape matched, for `ambiguous`; empty for the others. */
  at: Schema.Array(Schema.Struct({ line: Schema.Int, column: Schema.Int })),
}) {
  override get message(): string {
    const places = this.at.map(({ line, column }) => `${line}:${column}`).join(", ");

    return places === "" ? `plant refused: ${this.reason}` : `plant refused: ${this.reason}, at ${places}`;
  }
}

type Reported = Report["files"][string]["mutants"][number];

/** The tests that killed a mutant, each with its file and name, in the order the report lists them. */
const killers = (report: Report, mutant: Reported): ReadonlyArray<Test> => {
  const named = new Map<string, Test>();

  for (const [file, { tests }] of Object.entries(report.testFiles ?? {})) {
    for (const { id, name } of tests) {
      named.set(id, { file, name });
    }
  }

  return (mutant.killedBy ?? []).flatMap((id) => {
    const test = named.get(id);

    return test === undefined ? [] : [test];
  });
};

/** Whether the report's mutant sits at the target: the report counts from 1 where a target counts columns from 0. */
const sits = (mutant: Reported, target: Found): boolean =>
  mutant.mutatorName === target.mutator &&
  fold(mutant.replacement ?? "") === fold(target.replacement) &&
  mutant.location.start.line === target.line &&
  mutant.location.start.column === target.column + 1 &&
  mutant.location.end.line === target.endLine &&
  mutant.location.end.column === target.endColumn + 1;

const targetOf = (report: Report, target: Found): Reported | undefined =>
  report.files[target.file]?.mutants.find((mutant) => sits(mutant, target));

/** The answer for the mutant at `target`, as the law's own test kills it or not. */
export const answer = (report: Report, target: Found, law: Law): Answer => {
  const mutant = targetOf(report, target);

  if (mutant === undefined) {
    return Answer.cases.not_run.make({});
  }

  return Match.value(mutant.status).pipe(
    Match.when("Killed", () => {
      const by = killers(report, mutant);

      return by.some(({ file, name }) => file === law.file && name === law.name)
        ? Answer.cases.killed.make({ by })
        : Answer.cases.elsewhere.make({ by });
    }),
    Match.when("Survived", () => Answer.cases.survived.make({})),
    Match.when("NoCoverage", () => Answer.cases.no_coverage.make({})),
    Match.when("Timeout", () => Answer.cases.timeout.make({})),
    Match.when("CompileError", (status) => Answer.cases.error.make({ status })),
    Match.when("RuntimeError", (status) => Answer.cases.error.make({ status })),
    Match.orElse(() => Answer.cases.not_run.make({})),
  );
};

/** One line of the record: another mutant on the target's span, with only its status. */
interface Beside {
  readonly mutator: string;
  readonly replacement: string;
  readonly status: string;
}

/** The record of one plant run, one JSON line: what was found, what was answered, and what ran. */
export interface Line {
  readonly plant: string;
  readonly target: Found;
  readonly law: Law;
  readonly answer: Answer;
  readonly beside: ReadonlyArray<Beside>;
  readonly tests: { readonly covered: number; readonly completed: number };
  readonly seconds: number;
  readonly stryker: string;
  readonly node: string;
}

/** Whether a mutant lies inside the target's span, as the report counts it. */
const inside = (mutant: Reported, target: Found): boolean => {
  const { start, end } = mutant.location;
  const from = start.line > target.line || (start.line === target.line && start.column >= target.column + 1);
  const to = end.line < target.endLine || (end.line === target.endLine && end.column <= target.endColumn + 1);

  return from && to;
};

/**
 * The record of a run. It holds the target, the answer, how many tests covered the mutant, and the
 * other mutants on its span with their statuses. It never holds `statusReason`, a description or
 * the file's source (law Q13).
 */
export const record = (
  plant: Plant,
  target: Found,
  report: Report,
  ran: { readonly seconds: number; readonly node: string; readonly stryker: string },
): Line => {
  const mutant = targetOf(report, target);

  const beside = (report.files[target.file]?.mutants ?? []).filter(
    (other) => other !== mutant && inside(other, target),
  );

  return {
    plant: plant.name,
    target,
    law: plant.law,
    answer: answer(report, target, plant.law),
    beside: beside.map(({ mutatorName, replacement, status }) => ({
      mutator: mutatorName,
      replacement: replacement ?? "",
      status,
    })),
    tests: { covered: mutant?.coveredBy?.length ?? 0, completed: mutant?.testsCompleted ?? 0 },
    seconds: ran.seconds,
    stryker: ran.stryker,
    node: ran.node,
  };
};

/** One mutant of a survey: where it is (line from 1, column from 0), what it is, its status and every test that killed it. */
export interface Row {
  readonly file: string;
  readonly line: number;
  readonly column: number;
  readonly mutator: string;
  readonly replacement: string;
  readonly status: string;
  readonly by: ReadonlyArray<Test>;
}

/** Every mutant the report holds for `file`, as survey rows. */
export const rows = (report: Report, file: string): ReadonlyArray<Row> =>
  (report.files[file]?.mutants ?? []).map((mutant) => ({
    file,
    line: mutant.location.start.line,
    column: mutant.location.start.column - 1,
    mutator: mutant.mutatorName,
    replacement: mutant.replacement ?? "",
    status: mutant.status,
    by: killers(report, mutant),
  }));
