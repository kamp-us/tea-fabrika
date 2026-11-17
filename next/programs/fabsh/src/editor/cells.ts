import { TABLE } from "./cells.table.ts";

const CLASSES = [
  "other",
  "L",
  "V",
  "T",
  "LV",
  "LVT",
  "prepend",
  "extend",
  "zwj",
  "ri",
  "pict",
  "base",
  "modifier",
] as const;

type Class = (typeof CLASSES)[number];

export interface Facts {
  readonly width: number;
  readonly class: Class;
  readonly vs: boolean;
}

export const pack = (facts: Facts): number => facts.width | (CLASSES.indexOf(facts.class) << 2) | (facts.vs ? 64 : 0);

/** Run lengths are base 36, followed by two capital letters holding packed facts. */
export const tableText = (packed: Uint8Array): string => {
  let text = "";
  let start = 0;

  for (let end = 1; end <= packed.length; end += 1) {
    if (end === packed.length || packed[end] !== packed[start]) {
      const code = packed[start]!;
      text += (end - start).toString(36) + String.fromCharCode(65 + Math.floor(code / 26), 65 + (code % 26));
      start = end;
    }
  }

  return text;
};

const starts: number[] = [];

const entries: Facts[] = [];

let next = 0;

for (const match of TABLE.matchAll(/([0-9a-z]+)([A-Z]{2})/g)) {
  const letters = match[2]!;
  const code = (letters.charCodeAt(0) - 65) * 26 + letters.charCodeAt(1) - 65;
  starts.push(next);
  entries.push({ width: code & 3, class: CLASSES[(code >> 2) & 15] ?? "other", vs: (code & 64) !== 0 });
  next += Number.parseInt(match[1]!, 36);
}

export const facts = (cp: number): Facts => {
  let low = 0;
  let high = starts.length - 1;

  while (low < high) {
    const middle = (low + high + 1) >>> 1;

    if (starts[middle]! <= cp) {
      low = middle;
    } else {
      high = middle - 1;
    }
  }

  return entries[low] ?? { width: 1, class: "other", vs: false };
};

/** Ghostty's grapheme rule, including its Hangul, flag and emoji joins. */
const joins = (cluster: ReadonlyArray<number>, cp: number): boolean => {
  let pict = false;
  let regional = false;
  let previous = facts(cluster[0] ?? 0).class;
  const boundary = (current: Class): boolean => {
    if (!pict && (previous === "pict" || previous === "base")) {
      pict = true;
    }

    if (previous === "L" && ["L", "V", "LV", "LVT"].includes(current)) {
      return false;
    }

    if ((previous === "LV" || previous === "V") && (current === "V" || current === "T")) {
      return false;
    }

    if ((previous === "LVT" || previous === "T") && current === "T") {
      return false;
    }

    if (current === "extend" || current === "zwj" || previous === "prepend") {
      return false;
    }

    if (previous === "ri" && current === "ri") {
      const second = regional;
      regional = !regional;
      return second;
    }

    if (pict && previous === "zwj" && (current === "pict" || current === "base")) {
      pict = false;
      return false;
    }

    return !(previous === "base" && current === "modifier");
  };

  for (const point of cluster.slice(1)) {
    const current = facts(point).class;
    boundary(current);
    previous = current;
  }

  return !boundary(facts(cp).class);
};

interface Cell {
  readonly points: ReadonlyArray<number>;
  readonly width: "narrow" | "wide" | "tail" | "head";
}

const BLANK: Cell = { points: [], width: "narrow" };

/** The position the next printed character occupies, including pending wraps. */
export function spot(text: string, cols: number): number {
  const width = Math.max(1, cols);
  let row: Cell[] = [];
  let x = 0;
  let rows = 0;
  let pending = false;
  const put = (cell: Cell) => {
    const old = row[x];

    if (old?.width === "wide" && row[x + 1] !== undefined) {
      row[x + 1] = BLANK;
    }

    if (old?.width === "tail" && x > 0) {
      row[x - 1] = BLANK;
    }

    while (row.length < x) {
      row.push(BLANK);
    }

    row[x] = cell;
  };
  const wrap = () => {
    rows += 1;
    row = [];
    x = 0;
    pending = false;
  };

  for (const char of text) {
    const code = char.codePointAt(0) ?? 0;
    const cp = code >= 0xd800 && code <= 0xdfff ? 0xfffd : code;

    if (cp > 0xff && x > 0) {
      // Ghostty looks before the cursor even when a wrap is pending.
      const at = x - (row[x - 1]?.width === "tail" ? 2 : 1);
      const previous = row[at];

      if (previous !== undefined && previous.points.length > 0 && joins(previous.points, cp)) {
        const base = previous.points[0]!;

        if (cp === 0xfe0e || cp === 0xfe0f) {
          if (!facts(base).vs) {
            continue;
          }

          if (cp === 0xfe0f && previous.width !== "wide") {
            x = at;
            put({ points: [base], width: "wide" });
            x += 1;
            put({ points: [], width: "tail" });

            if (x === width - 1) {
              pending = true;
            } else {
              x += 1;
            }
          }

          if (cp === 0xfe0e && previous.width === "wide") {
            row[at] = { ...previous, width: "narrow" };
            row[at + 1] = { ...(row[at + 1] ?? BLANK), width: "narrow" };

            if (x === width - 1) {
              pending = false;
            } else {
              x -= 1;
            }
          }
        }

        const cell = row[at] ?? BLANK;
        row[at] = { ...cell, points: [...cell.points, cp] };
        continue;
      }
    }

    const count = cp <= 0xff ? 1 : facts(cp).width;

    if (count === 0) {
      continue;
    }

    if (pending) {
      wrap();
    }

    if (count === 1) {
      put({ points: [cp], width: "narrow" });
    } else if (width > 1) {
      if (x === width - 1) {
        put({ points: [], width: "head" });
        wrap();
      }

      put({ points: [cp], width: "wide" });
      x += 1;
      put({ points: [], width: "tail" });
    } else {
      put(BLANK);
    }

    if (x === width - 1) {
      pending = true;
    } else {
      x += 1;
    }
  }

  return pending ? (rows + 1) * width : rows * width + x;
}

export const cells = (text: string): number => spot(text, Number.MAX_SAFE_INTEGER);
