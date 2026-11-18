// Finding the one mutant a plant names, by its code shape (decision 0600). Pure.
//
// `made` is every mutant Stryker's instrumenter makes on the whole file. For each, the node's own
// text is sliced from the file and every run of whitespace is folded to one space; a mutant is a
// match when its mutator, its folded original and its folded replacement all equal the plant's.
// Exactly one match is a target. No byte offset or commit is pinned, so a blank line or a re-indent
// anywhere leaves the answer the same (law Q2).
import { Result } from "effect";
import type { Made } from "./Mutants.ts";
import { fold } from "./Plant.ts";
import type { Plant } from "./Plant.ts";
import { Refused } from "./Report.ts";
import type { Found } from "./Report.ts";

type Position = { readonly line: number; readonly column: number };

/** The offset of each line's first character. A line is what a `\n` ends. */
const lineStarts = (text: string): ReadonlyArray<number> => [
  0,
  ...[...text.matchAll(/\n/g)].map(({ index }) => index + 1),
];

/** Where a position (line and column from 0) is in the text, or nothing when the text has no such place. */
const offsetOf = (starts: ReadonlyArray<number>, at: Position): number | undefined => {
  const start = starts[at.line];

  return start === undefined ? undefined : start + at.column;
};

/** The text with every run of whitespace as one space, and for each character of that, its offset in the text. */
const folded = (text: string): { readonly text: string; readonly offsets: ReadonlyArray<number> } => {
  const runs = [...text.matchAll(/\s+|\S+/g)];

  return {
    text: runs.map(([run]) => (/^\s/.test(run) ? " " : run)).join(""),
    offsets: runs.flatMap(({ 0: run, index }) =>
      /^\s/.test(run) ? [index] : Array.from({ length: run.length }, (_, i) => index + i),
    ),
  };
};

/** Where `snippet` (folded) occurs in the folded text, as [from, to) offsets of the original text, one per occurrence. */
const spansOf = (text: string, snippet: string): ReadonlyArray<readonly [number, number]> => {
  const { text: flat, offsets } = folded(text);
  const wanted = fold(snippet);
  const at: Array<number> = [];

  for (let i = flat.indexOf(wanted); wanted !== "" && i >= 0; i = flat.indexOf(wanted, i + 1)) {
    at.push(i);
  }

  return at.flatMap((i) => {
    const from = offsets[i];
    const last = offsets[i + wanted.length - 1];

    return from === undefined || last === undefined ? [] : [[from, last + 1] as const];
  });
};

const refuse = (reason: Refused["reason"], at: ReadonlyArray<Position> = []) =>
  Result.fail(new Refused({ reason, at: at.map(({ line, column }) => ({ line, column })) }));

/**
 * The one mutant of `made` that is `plant`'s shape in `text`, with its place: line from 1, column from 0.
 * Refused as `not_found` for none, `ambiguous` for two or more (naming every place), and
 * `within_not_once` when the plant's `within` snippet does not occur exactly once.
 */
export const find = (text: string, made: ReadonlyArray<Made>, plant: Plant): Result.Result<Found, Refused> => {
  const starts = lineStarts(text);
  const inside = plant.within === undefined ? undefined : spansOf(text, plant.within);

  if (inside !== undefined && inside.length !== 1) {
    return refuse("within_not_once");
  }

  const original = fold(plant.original);
  const replacement = fold(plant.replacement);

  const matches = made.flatMap((mutant) => {
    const from = offsetOf(starts, mutant.location.start);
    const to = offsetOf(starts, mutant.location.end);

    if (from === undefined || to === undefined || mutant.mutatorName !== plant.mutator) {
      return [];
    }

    const fits = inside === undefined || inside.every(([lo, hi]) => from >= lo && to <= hi);

    return fits && fold(text.slice(from, to)) === original && fold(mutant.replacement) === replacement
      ? [mutant.location]
      : [];
  });

  const [only, ...more] = matches;

  if (only === undefined) {
    return refuse("not_found");
  }

  if (more.length > 0) {
    return refuse(
      "ambiguous",
      matches.map(({ start }) => ({ line: start.line + 1, column: start.column })),
    );
  }

  return Result.succeed({
    file: plant.file,
    line: only.start.line + 1,
    column: only.start.column,
    endLine: only.end.line + 1,
    endColumn: only.end.column,
    mutator: plant.mutator,
    original,
    replacement,
  });
};
