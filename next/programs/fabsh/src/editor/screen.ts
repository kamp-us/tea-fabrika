import { Schema } from "effect";
import type { Role, Span } from "../roles.ts";
import { cells, spot } from "./cells.ts";

export const PROMPT = "fabsh$ ";

export const NEWLINE = "\r\n";

export const CLEAR = "\x1b[H\x1b[2J";

export const BELL = "\x07";

// Palette indices are theme independent. The look step before S2 picks their final assignment.
const ANSI: Record<Role["_tag"], { readonly color: number; readonly underline: boolean }> = {
  program: { color: 32, underline: false },
  builtin: { color: 32, underline: false },
  flag: { color: 36, underline: false },
  argument: { color: 37, underline: false },
  input: { color: 36, underline: false },
  pipe: { color: 33, underline: false },
  separator: { color: 33, underline: false },
  mention: { color: 35, underline: false },
  // oxlint-disable-next-line eslint/id-denylist -- a conversation room (0091), not a module
  room: { color: 35, underline: false },
  string: { color: 33, underline: false },
  substitution: { color: 35, underline: false },
  comment: { color: 90, underline: false },
  error: { color: 31, underline: true },
};

export const paint = (line: string, spans: ReadonlyArray<Span>): string => {
  const parts: string[] = [];
  let at = 0;

  for (const span of spans) {
    const style = ANSI[span.role._tag];
    parts.push(
      line.slice(at, span.start),
      `\x1b[${style.underline ? "4;" : ""}${style.color}m`,
      line.slice(span.start, span.end),
      "\x1b[0m",
    );
    at = span.end;
  }

  parts.push(line.slice(at));
  return parts.join("");
};

/** Every program control is visible text; only tabs and normalized newlines remain controls. */
export const shown = (text: string): string =>
  [...text]
    .map((char) => {
      const cp = char.codePointAt(0) ?? 0;

      if (char === "\n") {
        return NEWLINE;
      }

      if (char === "\t") {
        return char;
      }

      if (cp < 0x20 || cp === 0x7f) {
        return `^${String.fromCharCode(cp ^ 0x40)}`;
      }

      if (cp >= 0x80 && cp <= 0x9f) {
        return "\ufffd";
      }

      return char;
    })
    .join("");

const up = (rows: number) => (rows > 0 ? `\x1b[${rows}A` : "");

const right = (cols: number) => (cols > 0 ? `\x1b[${cols}C` : "");

export const back = (at: number, cols: number): string => `\r${up(Math.floor(at / cols))}`;

/** A written blank keeps Ghostty's cursor on a cell it can carry during reflow. */
export const draw = (plain: string, painted: string, at: number, cols: number): string => {
  const end = spot(plain, cols);
  const blanks = Math.max(1, at + 1 - end);
  return `\x1b[J${painted}${" ".repeat(blanks)}${up(Math.floor((end + blanks - 1) / cols) - Math.floor(at / cols))}\r${right(at % cols)}`;
};

export const redrawRow = (text: string, at: number): string => `\r\x1b[K${text} \r${right(at)}`;

export const fitsRow = (text: string, cols: number): boolean =>
  cells(text) < cols && [...text].every((c) => (c.codePointAt(0) ?? 0) < 0x1100);

export const columns = (items: ReadonlyArray<string>, cols: number): string => {
  if (items.length === 0) {
    return "";
  }

  const width = Math.max(...items.map(cells)) + 2;
  const across = Math.max(1, Math.floor(cols / width));
  const down = Math.ceil(items.length / across);
  const lines: string[] = [];

  for (let row = 0; row < down; row += 1) {
    const parts: string[] = [];

    for (let col = 0; col < across; col += 1) {
      const item = items[col * down + row];

      if (item !== undefined) {
        parts.push(item + " ".repeat(width - cells(item)));
      }
    }

    lines.push(parts.join("").trimEnd() + NEWLINE);
  }

  return lines.join("");
};

const Tone = Schema.Literals(["plain", "strong", "muted", "faint", "accent", "warning"]);

const TableCell = Schema.Struct({ text: Schema.String, tone: Tone });

export const Table = Schema.Struct({
  title: Schema.String,
  note: Schema.NullOr(Schema.String),
  total: Schema.Int.check(Schema.isGreaterThanOrEqualTo(0)),
  columns: Schema.NonEmptyArray(Schema.Struct({ header: Schema.String, align: Schema.Literals(["left", "right"]) })),
  cut: Schema.Int.check(Schema.isGreaterThanOrEqualTo(0)),
  rows: Schema.Array(Schema.Array(TableCell)),
  hints: Schema.Array(Schema.Struct({ line: Schema.String, for: Schema.String })),
}).check(
  Schema.makeFilter(
    (table) =>
      table.cut < table.columns.length &&
      table.rows.length <= table.total &&
      table.rows.every((row) => row.length === table.columns.length),
  ),
);

const TONES: Record<typeof Tone.Type, string> = {
  plain: "0",
  strong: "1",
  muted: "90",
  faint: "90",
  accent: "34",
  warning: "33",
};

const single = (text: string) => shown(text).replaceAll(/\r\n|\t/g, " ");

const toned = (text: string, tone: typeof Tone.Type) => `\x1b[${TONES[tone]}m${text}\x1b[0m`;

const clipped = (text: string, width: number): string => {
  if (cells(text) <= width) {
    return text;
  }

  let cut = "";

  for (const char of text) {
    if (cells(cut + char) > width - 1) {
      break;
    }

    cut += char;
  }

  return `${cut}…`;
};

/** Table data is laid out at the viewer's width, and every cell is made safe before painting. */
export const table = (value: typeof Table.Type, cols: number): string => {
  const lines = [
    "",
    toned(single(value.title), "strong") +
      toned(`  ${value.total}${value.note === null ? "" : ` · ${single(value.note)}`}`, "muted"),
    "",
  ];

  if (value.rows.length === 0) {
    return lines.join(NEWLINE) + NEWLINE;
  }

  const natural = value.columns.map((column, i) =>
    Math.max(cells(single(column.header)), ...value.rows.map((row) => cells(single(row[i]?.text ?? "")))),
  );
  let fixed = 2 + 3 * (value.columns.length - 1);

  for (let i = 0; i < natural.length; i += 1) {
    if (i !== value.cut) {
      const width = natural.at(i);

      if (width === undefined) {
        throw new Error(`table column ${i} has no width`);
      }

      fixed += width;
    }
  }

  const widths = natural.map((n, i) => (i === value.cut ? Math.max(12, Math.min(n, cols - fixed, 80)) : n));
  const row = (entries: ReadonlyArray<typeof TableCell.Type>) =>
    "  " +
    entries
      .map((cell, i) => {
        const width = widths.at(i);

        if (width === undefined) {
          throw new Error(`table column ${i} has no width`);
        }

        const text = i === value.cut ? clipped(single(cell.text), width) : single(cell.text);
        const pad = " ".repeat(Math.max(0, width - cells(text)));
        return value.columns[i]?.align === "right"
          ? pad + toned(text, cell.tone)
          : toned(text, cell.tone) + (i === entries.length - 1 ? "" : pad);
      })
      .join("   ");
  lines.push(row(value.columns.map((column) => ({ text: column.header.toUpperCase(), tone: "faint" }))));
  lines.push(...value.rows.map(row));
  const more = value.total - value.rows.length;

  if (more > 0) {
    lines.push("");
    let line = toned(`${more} more.`, "muted");
    let used = cells(`${more} more.`);

    for (const hint of value.hints) {
      const command = single(hint.line);
      const words = single(hint.for).split(" ");

      for (const part of [
        { text: command, tone: "accent" as const },
        ...words.map((text) => ({ text, tone: "muted" as const })),
      ]) {
        const width = cells(part.text);

        if (used > 0 && used + 1 + width > cols) {
          lines.push(line);
          line = "";
          used = 0;
        }

        line += `${used === 0 ? "" : " "}${toned(part.text, part.tone)}`;
        used += (used === 0 ? 0 : 1) + width;
      }
    }

    lines.push(line);
  }

  lines.push("");
  return lines.join(NEWLINE) + NEWLINE;
};
