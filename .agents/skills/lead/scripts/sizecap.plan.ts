// sizecap.plan.ts: the plan side of sizecap.ts, apart so `sizecap.plan.ts <plan.md>` starts cheaply. plancheck.sh runs it on every draft call; with the
// platform and cli layers of sizecap.ts loaded it took 0.35 s of the call's 0.5 s, and here it loads `effect` alone. It prints what
// `sizecap plan <plan.md>` prints and exits as it does (0 when it ran, 2 when it could not read the plan); sizecap.ts takes these names from here.
import { readFileSync } from "node:fs"; // edge: a plain `node` entry that must start without the platform layer, so it reads the one plan file with `node:fs`
import { Array as Arr, String as Str, Option, Result, Schema, pipe } from "effect";

/** One slice of a plan's Size section: its place in the stack, its name, and its estimate when it gives one. */
export interface Slice {
  readonly order: number;
  readonly name: string;
  readonly lines: number | null;
}

/** What a plan says about its size: the files table's total, or null with no such column, and its slices. */
export interface PlanSize {
  readonly table: number | null;
  readonly slices: ReadonlyArray<Slice>;
}

/** The plan's lines with every fenced block blanked, as the plan skill's owner check reads them. */
const unfenced = (text: string): ReadonlyArray<string> => {
  let fence: string | null = null;

  return Arr.map(Str.split(text, "\n"), (line) => {
    const mark = /^\s{0,3}(`{3,}|~{3,})(.*)$/.exec(line);

    if (fence !== null) {
      if (
        mark?.[1] !== undefined &&
        mark[1][0] === fence[0] &&
        mark[1].length >= fence.length &&
        Str.trim(mark[2] ?? "") === ""
      ) {
        fence = null;
      }

      return "";
    }

    if (mark?.[1] !== undefined) {
      fence = mark[1];

      return "";
    }

    return line;
  });
};

/** One table row's cells, split on pipes no backslash escapes. */
const splitRow = (row: string): ReadonlyArray<string> => {
  const cells: Array<string> = [];
  let start = 0;
  let slashes = 0;

  for (let j = 0; j < row.length; j += 1) {
    if (row[j] === "|" && slashes % 2 === 0) {
      cells.push(pipe(row, Str.slice(start, j), Str.trim));
      start = j + 1;
    }

    slashes = row[j] === "\\" ? slashes + 1 : 0;
  }

  cells.push(pipe(row, Str.slice(start), Str.trim));

  return cells.slice(pipe(row, Str.startsWith("|")) ? 1 : 0, start === row.length ? -1 : undefined);
};

const plain = (text: string): string => pipe(text, Str.replaceAll(/[*_`]/g, ""), Str.trim);

const NUMBER = /^~?\s*(\d{1,3}(?:,\d{3})+|\d+)(?!\d)/;

/** The whole number a cell starts with, or null when it starts with a word. */
export const numberIn = (cell: string): number | null => {
  const found = NUMBER.exec(plain(cell));

  return found?.[1] === undefined ? null : Number(pipe(found[1], Str.replaceAll(",", "")));
};

const LINES = /(\d{1,3}(?:,\d{3})+|\d+)\s+(?:product\s+)?lines?\b/i;

export const readPlan = (text: string): PlanSize => {
  const lines = unfenced(text);
  let table: number | null = null;
  let column: number | null = null;
  let inTable = false;
  let section = "";
  const slices: Array<{ order: number; text: string }> = [];

  for (const line of lines) {
    const heading = /^##\s+(.+)$/.exec(line);

    if (heading?.[1] !== undefined) {
      section = pipe(heading[1], Str.trim, Str.toLowerCase);
    }

    const trimmed = Str.trim(line);

    if (!pipe(trimmed, Str.startsWith("|"))) {
      inTable = false;
      column = null;
    } else if (!inTable) {
      inTable = true;
      column = Option.getOrNull(
        Arr.findFirstIndex(splitRow(trimmed), (cell) =>
          pipe(plain(cell), Str.toLowerCase, Str.startsWith("product lines")),
        ),
      );
      table = column === null ? table : (table ?? 0);
    } else if (column !== null) {
      const cells = splitRow(trimmed);

      if (!Arr.every(cells, (cell) => /^:?-+:?$/.test(cell))) {
        table = (table ?? 0) + (numberIn(cells[column] ?? "") ?? 0);
      }
    }

    if (section === "size") {
      const item = /^\s{0,3}(\d+)[.)]\s+(.*)$/.exec(line);
      const last = slices.at(-1);

      if (item?.[1] !== undefined) {
        slices.push({ order: Number(item[1]), text: item[2] ?? "" });
      } else if (last !== undefined && trimmed !== "") {
        last.text += ` ${trimmed}`;
      }
    }
  }

  return {
    table,
    slices: Arr.map(slices, ({ order, text }) => {
      const estimate = LINES.exec(text)?.[1];
      const name = Str.trim(Str.split(plain(text), /[:.]/)[0]);

      return { order, name, lines: estimate === undefined ? null : Number(pipe(estimate, Str.replaceAll(",", ""))) };
    }),
  };
};

/** What the plan check advises, each a line the lead reads. None compares a size with a number (no number caps the size of a pull request). */
export const Advice = Schema.TaggedUnion({
  unsized: { order: Schema.Int, name: Schema.String },
  unknown: {},
});

export type Advice = typeof Advice.Type;

export const advise = (size: PlanSize): ReadonlyArray<Advice> =>
  size.table === null && size.slices.length === 0
    ? [Advice.cases.unknown.make({})]
    : Arr.flatMap(size.slices, (slice): ReadonlyArray<Advice> =>
        slice.lines === null ? [Advice.cases.unsized.make({ order: slice.order, name: slice.name })] : [],
      );

const ADVICE = "(advice only, no number caps the size of a pull request)";

export const adviceLine = (advice: Advice): string => {
  switch (advice._tag) {
    case "unsized":
      return `size: slice ${advice.order} (${advice.name}) gives no "<n> lines" estimate ${ADVICE}`;
    case "unknown":
      return `size: no files table has a "Product lines expected" column and ## Size lists no slices, so the plan records no size ${ADVICE}`;
  }
};

/** The line `plan` prints first, before any advice. */
export const planLine = (size: PlanSize): string => {
  const largest = Math.max(0, ...Arr.map(size.slices, (slice) => slice.lines ?? 0));
  const table = size.table === null ? "no product lines column" : `${size.table} product lines in the files table`;
  const slices = size.slices.length === 0 ? "no slices" : `${size.slices.length} slices, the largest ${largest}`;

  return `size: ${table}, ${slices}`;
};

if (import.meta.main) {
  const file = process.argv[2] ?? "";
  const text = Result.getOrNull(Result.try(() => readFileSync(file, "utf8")));

  if (text === null) {
    console.error(`sizecap: cannot read ${file}`);
    process.exitCode = 2;
  } else {
    const size = readPlan(text);
    console.log(planLine(size));

    for (const advice of advise(size)) {
      console.log(adviceLine(advice));
    }
  }
}
