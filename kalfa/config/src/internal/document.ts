/**
 * Pure helpers over a parsed settings document, shared by the strict check of today's `Files.ts` and the start of `SettingGroup.ts`: the value at a path, the first leaf under it, the line of a key, a value as a message shows it, and the distance between two names.
 */
import * as Predicate from "effect/Predicate";
import * as Rec from "effect/Record";
import type { Document } from "./format.ts";

export type Path = ReadonlyArray<string>;

export const same = (a: Path, b: Path) => a.length === b.length && a.every((s, n) => s === b[n]);

export const at = (value: Document["value"], path: Path) =>
  path.reduce<unknown>((v, key) => (Predicate.isObject(v) ? v[key] : undefined), value);

/** The first key/value at or under `path`. */
export const leaf = (value: Document["value"], path: Path): Path => {
  const below = at(value, path);
  const key = Predicate.isObject(below) ? Rec.keys(below)[0] : undefined;

  return key === undefined ? path : leaf(value, [...path, key]);
};

/** A value as the message shows it: a scalar as written, an array or a table only by its shape. */
export const shape = (value: unknown) =>
  Array.isArray(value) ? "[…]" : Predicate.isObject(value) ? "{…}" : JSON.stringify(value);

/** The line of the key at `path`, or of its nearest table with a line. */
export const lineAt = (document: Document, path: Path): number | undefined => {
  for (let n = path.length; n > 0; n--) {
    const span = document.spans.find((s) => same(s.path, path.slice(0, n)));

    if (span !== undefined) {
      return span.line;
    }
  }

  return undefined;
};

/** Edits from one key to another, a swap of two letters counting as one. */
export const distance = (a: string, b: string) => {
  const rows = Array.from({ length: a.length + 1 }, (_, i) => Array.from({ length: b.length + 1 }, (_, j) => i + j));
  const cell = (i: number, j: number) => rows[i]?.[j] ?? 0;

  for (let i = 1; i <= a.length; i++) {
    for (let j = 1; j <= b.length; j++) {
      const swap = a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1] && i > 1 && j > 1 ? cell(i - 2, j - 2) + 1 : Infinity;
      const edit = cell(i - 1, j - 1) + (a[i - 1] === b[j - 1] ? 0 : 1);
      rows[i]?.splice(j, 1, Math.min(cell(i - 1, j) + 1, cell(i, j - 1) + 1, edit, swap));
    }
  }

  return cell(a.length, b.length);
};
