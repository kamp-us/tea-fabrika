// M7: the line diff of the memory adapter (ticket 1933). It splits bytes into lines that keep their own ends, follows git's rule
// for a binary file, and answers the smallest change blocks between two texts, each block's removed lines first.
import { expect, it } from "@effect/vitest";
import { Arbitrary, Schema } from "effect";
import * as Lines from "./lines.ts";

const int = (minimum: number, maximum: number): Arbitrary.Arbitrary<number> =>
  Arbitrary.schema(Schema.Int.check(Schema.isBetween({ minimum, maximum })));

const latin1 = (octets: Uint8Array): string => Array.from(octets, (octet) => String.fromCharCode(octet)).join("");

const fromText = (text: string): Uint8Array => Uint8Array.from(text, (character) => character.charCodeAt(0));

// Few different lines, so a draw repeats lines and two texts share many: that is index a diff that is not the smallest shows.
const WORDS = ["a", "b", "c", "", "x y", "\u00ff", "long line of text"];

const ENDS = ["\n", "\r\n", "\n", "\n"];

const textArb: Arbitrary.Arbitrary<Uint8Array> = Arbitrary.all({
  lines: Arbitrary.array(Arbitrary.all({ word: int(0, WORDS.length - 1), end: int(0, ENDS.length - 1) }), {
    minLength: 0,
    maxLength: 12,
  }),
  open: Arbitrary.schema(Schema.Boolean),
}).pipe(
  Arbitrary.map(({ lines, open }) =>
    fromText(
      lines
        .map(({ word, end }, i) => `${WORDS[word] ?? ""}${open && i === lines.length - 1 ? "" : (ENDS[end] ?? "\n")}`)
        .join(""),
    ),
  ),
);

const same = (a: ReadonlyArray<Uint8Array>, b: ReadonlyArray<Uint8Array>): boolean =>
  a.length === b.length && a.every((line, i) => latin1(line) === latin1(b[i] ?? new Uint8Array()));

// The longest run of lines two lists share, in order, from a plain table.
const longest = (a: ReadonlyArray<Uint8Array>, b: ReadonlyArray<Uint8Array>): number => {
  const table = Array.from({ length: a.length + 1 }, () => Array.from({ length: b.length + 1 }, () => 0));

  for (let i = a.length - 1; i >= 0; i--) {
    for (let j = b.length - 1; j >= 0; j--) {
      const down = table[i + 1]?.[j] ?? 0;
      const right = table[i]?.[j + 1] ?? 0;

      const row = table[i];

      if (row !== undefined) {
        row[j] =
          latin1(a[i] ?? new Uint8Array()) === latin1(b[j] ?? new Uint8Array())
            ? (table[i + 1]?.[j + 1] ?? 0) + 1
            : Math.max(down, right);
      }
    }
  }

  return table[0]?.[0] ?? 0;
};

const join = (parts: ReadonlyArray<Uint8Array>): string => parts.map(latin1).join("");

// Plant: match lines greedily from the top, so a change that moves a line is not the smallest; leave a line's end off its text;
// give a block its added lines before its removed ones; end a block one kept line late, so two blocks run into one; start a
// text with no newline at the end as one line more.
it.prop(
  "M7 lines: split keeps every line's own end, and blocks turn the first text into the second by the fewest lines, removed first",
  { before: textArb, after: textArb },
  ({ before, after }) => {
    const old = Lines.split(before);
    const next = Lines.split(after);

    for (const [text, lines] of [
      [before, old],
      [after, next],
    ] as const) {
      expect(join(lines), "the lines make the text again").toBe(latin1(text));
      expect(
        lines.slice(0, -1).every((line) => line.at(-1) === 0x0a),
        "every line but the last ends with its newline",
      ).toBe(true);
      expect(
        lines.every((line) => line.indexOf(0x0a) === line.length - 1 || !line.includes(0x0a)),
        "a newline is only ever a line's end",
      ).toBe(true);
      expect(lines.length === 0, "no bytes, no lines").toBe(text.length === 0);

      if (text.length > 0) {
        expect(lines.at(-1)?.at(-1) === 0x0a, "the last line has an end exactly when the text does").toBe(
          text.at(-1) === 0x0a,
        );
      }
    }

    const blocks = Lines.blocks(before, after);
    let changed = 0;
    let oldAt = 0;
    let newAt = 0;
    const rebuilt: Array<Uint8Array> = [];

    for (const [k, block] of blocks.entries()) {
      expect(block.removed.length + block.added.length, `block ${k} changes something`).toBeGreaterThan(0);
      expect(
        same(block.removed, old.slice(block.removedAt, block.removedAt + block.removed.length)),
        `block ${k}'s removed lines are the first text's`,
      ).toBe(true);
      expect(
        same(block.added, next.slice(block.addedAt, block.addedAt + block.added.length)),
        `block ${k}'s added lines are the second text's`,
      ).toBe(true);

      const keptOld = old.slice(oldAt, block.removedAt);
      const keptNew = next.slice(newAt, block.addedAt);
      expect(same(keptOld, keptNew), `the lines before block ${k} are kept as they were`).toBe(true);

      if (k > 0) {
        expect(keptOld.length, `block ${k} is apart from the one before: a kept line lies between`).toBeGreaterThan(0);
      }

      rebuilt.push(...keptNew, ...block.added);
      changed += block.removed.length + block.added.length;
      oldAt = block.removedAt + block.removed.length;
      newAt = block.addedAt + block.added.length;
    }

    expect(same(old.slice(oldAt), next.slice(newAt)), "the lines after the last block are kept as they were").toBe(
      true,
    );
    rebuilt.push(...next.slice(newAt));
    expect(join(rebuilt), "the blocks turn the first text into the second").toBe(latin1(after));
    expect(changed, "no smaller set of lines does it").toBe(old.length + next.length - 2 * longest(old, next));
  },
  { arbitrary: { runs: 300, seed: 119120 } },
);

const FILLER = Arbitrary.array(int(1, 255), { minLength: 0, maxLength: 40 });

// Plant: look for the NUL in the whole file; look in the first 8001 bytes; look in the first 7999.
it.prop(
  "M7 lines: a file is binary exactly when a NUL byte is among its first 8000 bytes",
  { filler: FILLER, tail: FILLER, near: int(0, 3), index: int(0, 5) },
  ({ filler, tail, near, index }) => {
    const text = (length: number): Uint8Array =>
      Uint8Array.from({ length }, (_, i) => (filler[i % Math.max(1, filler.length)] ?? 0x61) || 0x61);

    expect(Lines.isBinary(Uint8Array.from(filler)), "no NUL, no binary").toBe(false);
    expect(Lines.isBinary(new Uint8Array()), "no bytes, no binary").toBe(false);

    // A NUL at index k is the (k + 1)th byte: 8000 bytes come first when k is 8000 or more.
    for (const k of [index, 7998 - near, 7999, 8000, 8001 + near, 9000]) {
      const octets = Uint8Array.from([...text(k), 0, ...tail]);
      expect(Lines.isBinary(octets), `a NUL at index ${k}`).toBe(k < 8000);
    }
  },
  { arbitrary: { runs: 200, seed: 119120 } },
);
