// Lines of bytes, for the memory adapter's diff: split a file into lines that keep their own ends, tell a binary file as git
// does, and find the fewest lines to remove and add to turn one text into another (Myers, in linear space).
const NEWLINE = 0x0a;

// git looks for a NUL in the first 8000 bytes of a file, and calls it binary when it finds one.
const BINARY_WINDOW = 8000;

/**
 * Splits bytes into lines, each keeping its own end. A last line with no end is a line too, and no bytes are no lines.
 *
 * @internal
 */
export const split = (bytes: Uint8Array): ReadonlyArray<Uint8Array> => {
  const found: Array<Uint8Array> = [];
  let start = 0;

  for (let end = bytes.indexOf(NEWLINE); end !== -1; end = bytes.indexOf(NEWLINE, start)) {
    found.push(bytes.subarray(start, end + 1));
    start = end + 1;
  }

  return start < bytes.length ? [...found, bytes.subarray(start)] : found;
};

/**
 * Whether git calls a file binary: a NUL byte among its first 8000 bytes.
 *
 * @internal
 */
export const isBinary = (bytes: Uint8Array): boolean => bytes.subarray(0, BINARY_WINDOW).includes(0);

/**
 * One run of changed lines: the lines removed from the first text and the lines added in the second, each with where it starts, counting from 0. A block with nothing removed holds where the first text takes the added lines.
 *
 * @internal
 */
export interface Block {
  readonly removedAt: number;
  readonly removed: ReadonlyArray<Uint8Array>;
  readonly addedAt: number;
  readonly added: ReadonlyArray<Uint8Array>;
}

// A line's bytes as text, one character for each byte, so two lines are equal exactly when their texts are.
const key = (line: Uint8Array): string => {
  let text = "";

  for (const octet of line) {
    text += String.fromCharCode(octet);
  }

  return text;
};

// Each line as a number, equal exactly when the lines are.
const numbered = (before: ReadonlyArray<Uint8Array>, after: ReadonlyArray<Uint8Array>) => {
  const numbers = new Map<string, number>();

  const number = (line: Uint8Array): number => {
    const text = key(line);
    const known = numbers.get(text) ?? numbers.size;
    numbers.set(text, known);

    return known;
  };

  return { old: before.map(number), next: after.map(number) };
};

interface Snake {
  // Where the middle snake starts and ends in the two ranges, counting from each range's start.
  readonly fromX: number;
  readonly fromY: number;
  readonly toX: number;
  readonly toY: number;
}

// The middle of a shortest path through the edit graph of `a[aLo, aHi)` and `b[bLo, bHi)`: paths run from both corners and
// meet halfway (Myers 1986, section 4b). The ranges are not empty and have no common first or last line.
const middle = (
  a: ReadonlyArray<number>,
  b: ReadonlyArray<number>,
  [aLo, aHi]: readonly [number, number],
  [bLo, bHi]: readonly [number, number],
): Snake => {
  const n = aHi - aLo;
  const m = bHi - bLo;
  const delta = n - m;
  const odd = delta % 2 !== 0;
  const most = Math.ceil((n + m) / 2);
  const here = most + 1;
  // `forward[here + k]` is the furthest x a path from the start reaches on diagonal k; `reverse` is the same from the end.
  const forward = new Int32Array(2 * most + 3);
  const reverse = new Int32Array(2 * most + 3);
  forward[here + 1] = 0;
  reverse[here + 1] = 0;

  for (let d = 0; d <= most; d++) {
    for (let k = -d; k <= d; k += 2) {
      const down = k === -d || (k !== d && (forward[here + k - 1] ?? 0) < (forward[here + k + 1] ?? 0));
      const fromX = down ? (forward[here + k + 1] ?? 0) : (forward[here + k - 1] ?? 0) + 1;
      const fromY = fromX - k;
      let x = fromX;
      let y = fromY;

      while (x < n && y < m && a[aLo + x] === b[bLo + y]) {
        x += 1;
        y += 1;
      }

      forward[here + k] = x;

      if (odd && k >= delta - (d - 1) && k <= delta + (d - 1) && x + (reverse[here + delta - k] ?? 0) >= n) {
        return { fromX, fromY, toX: x, toY: y };
      }
    }

    for (let k = -d; k <= d; k += 2) {
      const down = k === -d || (k !== d && (reverse[here + k - 1] ?? 0) < (reverse[here + k + 1] ?? 0));
      const fromX = down ? (reverse[here + k + 1] ?? 0) : (reverse[here + k - 1] ?? 0) + 1;
      const fromY = fromX - k;
      let x = fromX;
      let y = fromY;

      while (x < n && y < m && a[aHi - 1 - x] === b[bHi - 1 - y]) {
        x += 1;
        y += 1;
      }

      reverse[here + k] = x;

      if (!odd && k >= delta - d && k <= delta + d && x + (forward[here + delta - k] ?? 0) >= n) {
        // The snake was walked from the end, so it is turned round into the start's frame.
        return { fromX: n - x, fromY: m - y, toX: n - fromX, toY: m - fromY };
      }
    }
  }

  // Both paths always meet by `most` steps.
  throw new Error("the two paths of a diff never met");
};

// The pairs of equal lines of a shortest diff, in order, as `[index in a, index in b]`.
const matched = (
  a: ReadonlyArray<number>,
  b: ReadonlyArray<number>,
  within: readonly [readonly [number, number], readonly [number, number]],
  found: Array<readonly [number, number]>,
): void => {
  let [[aLo, aHi], [bLo, bHi]] = within;

  // Lines the two ranges share at their first and last places match. The last ones are added after the middle.
  while (aLo < aHi && bLo < bHi && a[aLo] === b[bLo]) {
    found.push([aLo, bLo]);
    aLo += 1;
    bLo += 1;
  }

  const tail: Array<readonly [number, number]> = [];

  while (aLo < aHi && bLo < bHi && a[aHi - 1] === b[bHi - 1]) {
    aHi -= 1;
    bHi -= 1;
    tail.push([aHi, bHi]);
  }

  if (aLo < aHi && bLo < bHi) {
    const snake = middle(a, b, [aLo, aHi], [bLo, bHi]);
    matched(
      a,
      b,
      [
        [aLo, aLo + snake.fromX],
        [bLo, bLo + snake.fromY],
      ],
      found,
    );

    for (let step = 0; step < snake.toX - snake.fromX; step++) {
      found.push([aLo + snake.fromX + step, bLo + snake.fromY + step]);
    }

    matched(
      a,
      b,
      [
        [aLo + snake.toX, aHi],
        [bLo + snake.toY, bHi],
      ],
      found,
    );
  }

  for (const pair of tail.reverse()) {
    found.push(pair);
  }
};

/**
 * The fewest lines to remove from `before` and add in `after` to make it, as blocks in file order: each block has its removed lines, then its added lines, and a kept line lies between two blocks.
 *
 * @internal
 */
export const blocks = (before: Uint8Array, after: Uint8Array): ReadonlyArray<Block> => {
  const old = split(before);
  const next = split(after);
  const numbers = numbered(old, next);
  const pairs: Array<readonly [number, number]> = [];
  matched(
    numbers.old,
    numbers.next,
    [
      [0, old.length],
      [0, next.length],
    ],
    pairs,
  );

  const changes: Array<Block> = [];
  let oldAt = 0;
  let newAt = 0;

  for (const [i, j] of [...pairs, [old.length, next.length] as const]) {
    if (i > oldAt || j > newAt) {
      changes.push({
        removedAt: oldAt,
        removed: old.slice(oldAt, i),
        addedAt: newAt,
        added: next.slice(newAt, j),
      });
    }

    oldAt = i + 1;
    newAt = j + 1;
  }

  return changes;
};
