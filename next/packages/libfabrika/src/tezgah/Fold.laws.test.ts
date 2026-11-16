// Desk S4, next/ (the desk program fabrika/tezgah, ticket named by its title): law L31's fold half,
// of the approved plan (docs/plan/quests/desk-PLAN.md), rewritten to its thirteenth amendment (one
// drawn geometry for the fold). Tuval's `window/Layout.laws.test.ts` holds L31's markup half, and the
// window machine's laws hold the `fold` client row and L32.
//
// The shape this law holds `Fold.ts` to, from amendment 13 (the build may add more):
// - `STRIP = {row: 22, column: 20}` sits beside `GAP`, and `drawn(w, size, strips)` is pure: each
//   tile's drawn box, from the area's top left, in an area of `size` (the window's `size` Msg, inside
//   the frame's padding) when `strips` are drawn as strips. `fold(w, size)` is the fixpoint on that
//   geometry: from no strips, add every open tile but the focused one drawn under 220x120, again,
//   until nothing changes. Size belongs to the viewer (0277): nothing here is stored or sent.
// - The drawn rule, written below in the test itself and never read from the product to judge it:
//   a container of direction `d` leaves `GAP` between each two parts. A part all of whose tiles are
//   strips takes `STRIP[d]` along `d` (a lone strip, or a container whose tiles all fold: one band).
//   The open parts share what is left (the container's length less its gaps and strips; "what the
//   container has") by their percents. On the focused tile's path the part that leads to it is held at
//   `min(220 in a row or 120 in a column, what the container has)` when its share is smaller, and the
//   other open parts share the rest by their percents. Every part fills the container's other axis.
// - Inside a band, how its strips divide its length is the build's: the law asks only that they lie
//   inside the band, apart from each other.
// - L31 then says: (a) every open tile but the focused one, as drawn, is at least 220x120; (b) the
//   focused tile is drawn at least `min(220x120, what its containers have)`; (c) no extra folds: each
//   strip was under the floor in the geometry it folded in; and the boxes are the rule's, so they tile
//   the area with the gaps.
//
// The generator draws a window size from 320x240 to 2560x1600 and walks a layout from one tile with
// the library's real `Layout.split` and `Layout.remove`: each cut picks a live tile from the layout it
// is folding, and a close only while two or more are live. A run where a tile sits within half a pixel
// of the floor in any round of the fold is left out of the exact checks, so float rounding cannot
// decide the law, and so is a run whose strips and gaps alone overflow a container (an open point the
// amendment does not settle; the law counts them).
import { describe, expect, it } from "@effect/vitest";
import { Schema } from "effect";
import * as fc from "fast-check";
import { drawn, fold, STRIP } from "./Fold.ts";
import * as Layout from "./Layout.ts";
import { type TileId, Workspace } from "./Workspace.ts";

const SEED = 119120;
const ALPHABET = "0123456789abcdefghjkmnpqrstvwxyz";

/** The readability floor from fold, not tabs: a drawn tile under it is a strip (not a setting). */
const SMALLEST = { width: 220, height: 120 } as const;
/** A strip's size along its container, written here from amendment 13. */
const ACROSS = { row: 22, column: 20 } as const;
/** How close to the floor a drawn edge may sit before float rounding could decide the law. */
const EDGE = 0.5;
/** How far a product box may sit from the rule's, in CSS pixels: float rounding only. */
const SAME = 0.01;

/** A canonical UUIDv7 TypeID for `n`, made here so the law does not lean on the generator it checks. */
const typeId = (prefix: string, n: number): string => {
  let uuid = (BigInt(n) << 80n) | (7n << 76n) | (2n << 62n);
  let suffix = "";

  for (let i = 0; i < 26; i++) {
    suffix = ALPHABET[Number(uuid & 31n)] + suffix;
    uuid >>= 5n;
  }

  return `${prefix}_${suffix}`;
};

type Box = { readonly x: number; readonly y: number; readonly width: number; readonly height: number };
type Node = Workspace["layout"];

const under = (r: Box) => r.width < SMALLEST.width || r.height < SMALLEST.height;
const near = (r: Box) => Math.abs(r.width - SMALLEST.width) <= EDGE || Math.abs(r.height - SMALLEST.height) <= EDGE;

const tilesIn = (node: Node): ReadonlyArray<string> =>
  typeof node === "string" ? [node] : node.parts.flatMap((p) => tilesIn(p.inner));

/** What the rule draws: each tile's box outside a band, each band with its tiles, and for each
 *  container on the focused path the floor its focused part is held at, along its direction. */
type Rule = {
  readonly boxes: ReadonlyMap<string, Box>;
  readonly bands: ReadonlyArray<{ readonly box: Box; readonly tiles: ReadonlyArray<string> }>;
  readonly held: ReadonlyArray<{ readonly dir: "row" | "column"; readonly at: number }>;
  readonly overflow: boolean;
};

/** Amendment 13's drawn rule, written here from its words. */
const rule = (w: Workspace, size: { readonly width: number; readonly height: number }, strips: ReadonlySet<string>) => {
  const boxes = new Map<string, Box>();
  const bands: Array<{ box: Box; tiles: ReadonlyArray<string> }> = [];
  const held: Array<{ dir: "row" | "column"; at: number }> = [];
  let overflow = false;
  const walk = (node: Node, box: Box): void => {
    if (typeof node === "string") {
      boxes.set(node, box);
      return;
    }

    const row = node.dir === "row";
    const left = (row ? box.width : box.height) - (node.parts.length - 1) * Layout.GAP;
    const fixed = node.parts.map((p) => tilesIn(p.inner).every((t) => strips.has(t)));
    const has = left - fixed.filter((f) => f).length * ACROSS[node.dir];
    overflow ||= has < 0;
    const open = node.parts.flatMap((p, i) => (fixed[i] ? [] : [p.percent]));
    const total = open.reduce((a, b) => a + b, 0);
    const lead = node.parts.findIndex((p) => tilesIn(p.inner).includes(w.focus));
    let shares = node.parts.map((p, i) => (fixed[i] ? ACROSS[node.dir] : (has * p.percent) / total));

    if (lead >= 0) {
      const least = Math.min(row ? SMALLEST.width : SMALLEST.height, has);
      held.push({ dir: node.dir, at: least });

      if (shares[lead]! < least) {
        const rest = total - node.parts[lead]!.percent;
        shares = node.parts.map((p, i) =>
          i === lead ? least : fixed[i] ? ACROSS[node.dir] : rest > 0 ? ((has - least) * p.percent) / rest : 0,
        );
      }
    }

    let at = row ? box.x : box.y;

    for (const [i, p] of node.parts.entries()) {
      const b = row
        ? { x: at, y: box.y, width: shares[i]!, height: box.height }
        : { x: box.x, y: at, width: box.width, height: shares[i]! };

      if (fixed[i] && typeof p.inner !== "string") {
        bands.push({ box: b, tiles: tilesIn(p.inner) });
      } else {
        walk(p.inner, b);
      }

      at += shares[i]! + Layout.GAP;
    }
  };
  walk(w.layout, { x: 0, y: 0, width: size.width, height: size.height });
  return { boxes, bands, held, overflow } satisfies Rule;
};

/** Replays `strips` round by round in the rule's geometry: each round adds the strips that were open
 *  and under the floor there. Whatever is left was never under the floor when it folded. Also says
 *  whether a round drew a tile within half a pixel of the floor. */
const replay = (
  w: Workspace,
  size: { readonly width: number; readonly height: number },
  strips: ReadonlySet<string>,
) => {
  let folded = new Set<string>();
  let close = false;

  for (;;) {
    const { boxes } = rule(w, size, folded);
    const due = [...strips].filter((t) => !folded.has(t) && boxes.has(t) && under(boxes.get(t)!));
    close ||= [...boxes].some(([t, r]) => !folded.has(t) && t !== w.focus && near(r));

    if (due.length === 0) {
      return { left: [...strips].filter((t) => !folded.has(t)), close };
    }

    folded = new Set([...folded, ...due]);
  }
};

const same = (a: Box, b: Box) =>
  Math.abs(a.x - b.x) <= SAME &&
  Math.abs(a.y - b.y) <= SAME &&
  Math.abs(a.width - b.width) <= SAME &&
  Math.abs(a.height - b.height) <= SAME;

const inside = (a: Box, b: Box) =>
  a.x >= b.x - SAME &&
  a.y >= b.y - SAME &&
  a.x + a.width <= b.x + b.width + SAME &&
  a.y + a.height <= b.y + b.height + SAME;

const apart = (a: Box, b: Box) =>
  a.x + a.width <= b.x + SAME ||
  b.x + b.width <= a.x + SAME ||
  a.y + a.height <= b.y + SAME ||
  b.y + b.height <= a.y + SAME;

const Cut = fc.record({ at: fc.nat(), down: fc.boolean(), close: fc.boolean() });
type Cut = typeof Cut extends fc.Arbitrary<infer C> ? C : never;

/** A workspace walked from one tile by `cuts`, focus on the live tile `focus` picks. */
const walked = (cuts: ReadonlyArray<Cut>, focus: number) => {
  const first = typeId("tile", 1) as TileId;
  let w: Workspace = Schema.decodeUnknownSync(Workspace)({
    id: typeId("workspace", 1),
    n: 1,
    layout: first,
    focus: first,
    recent: [first],
  });

  for (const [k, cut] of cuts.entries()) {
    const live = Layout.order(w.layout);
    const at = live[cut.at % live.length]!;
    w =
      cut.close && live.length > 1
        ? Layout.remove(w, at)
        : Layout.split(w, at, cut.down ? "column" : "row", typeId("tile", k + 2) as TileId);
  }

  const live = Layout.order(w.layout);
  const on = live[focus % live.length]!;
  return Layout.focus(w, on);
};

const Window = fc.record({
  width: fc.integer({ min: 320, max: 2_560 }),
  height: fc.integer({ min: 240, max: 1_600 }),
  cuts: fc.array(Cut, { minLength: 0, maxLength: 12 }),
  focus: fc.nat(),
});

const right = (at: number) => ({ at, down: false, close: false });

/** pinned: S4's first review. The fold measured full shares while the frame drew strips at 22px, so
 *  a row `[t1 75, t3 12.5, t4 6.25, t5 3.125, t6 3.125]` (split t1 right, t2 right, remove t2, then
 *  t3, t4 and t5 right) focused on t3 at 320x400 drew t1 open at 204px, under the floor. */
const REVIEW_BUG = {
  width: 320,
  height: 400,
  cuts: [right(0), right(1), { at: 1, down: false, close: true }, right(1), right(2), right(3)],
  focus: 1,
};

describe("Desk S4 L31: one drawn geometry; a window folds a tile under 220x120 into a strip, never the focused one", () => {
  it("L31: at any size and layout, every open tile but the focused one is drawn at least 220x120, the focused tile at least the floor its containers can give, each strip was under the floor in the geometry it folded in, and every box is the amendment's drawn rule, so the boxes tile the area with the gaps", () => {
    expect(STRIP, "L31: STRIP is 22 across a row and 20 across a column").toEqual(ACROSS);
    const seen = { strips: 0, thin: 0, bands: 0, held: 0, overflow: 0, close: 0, runs: 0 };
    fc.assert(
      fc.property(Window, ({ width, height, cuts, focus }) => {
        const w = walked(cuts, focus);
        const size = { width, height };
        const before = JSON.stringify(w);
        const strips = fold(w, size);
        const live = Layout.order(w.layout);
        seen.runs++;
        expect(JSON.stringify(w), "L31: fold changes nothing it is given").toBe(before);
        expect(
          [...strips].filter((t) => !live.includes(t)),
          "L31: a strip is a tile of this workspace",
        ).toEqual([]);
        expect(strips.has(w.focus), `L31: the focused tile is never a strip, at ${width}x${height}`).toBe(false);
        const { left, close } = replay(w, size, strips);
        const want = rule(w, size, strips);

        if (close || want.overflow) {
          seen.close += close ? 1 : 0;
          seen.overflow += want.overflow ? 1 : 0;
          return;
        }

        expect(
          left,
          `L31 (c): at ${width}x${height} no tile folds unless it was under the floor where it folded`,
        ).toEqual([]);
        const boxes = drawn(w, size, strips);
        const banded = new Set(want.bands.flatMap((b) => b.tiles));

        for (const t of live.filter((t) => !banded.has(t))) {
          const got = boxes.get(t);
          expect(
            got !== undefined && same(got, want.boxes.get(t)!),
            `L31: ${t} is drawn at ${JSON.stringify(got)}, the rule's ${JSON.stringify(want.boxes.get(t))}, at ${width}x${height}`,
          ).toBe(true);
        }

        for (const band of want.bands) {
          const got = band.tiles.map((t) => boxes.get(t));
          expect(
            got.every((b) => b !== undefined && inside(b, band.box)),
            `L31: the strips of a folded container lie inside its band ${JSON.stringify(band.box)}`,
          ).toBe(true);
          expect(
            got.every((a, i) => got.every((b, j) => i === j || (a !== undefined && b !== undefined && apart(a, b)))),
            "L31: the strips of a band lie apart",
          ).toBe(true);
        }

        for (const t of live.filter((t) => t !== w.focus && !strips.has(t))) {
          expect(under(boxes.get(t)!), `L31 (a): open ${t} is drawn at least 220x120 at ${width}x${height}`).toBe(
            false,
          );
        }

        const f = boxes.get(w.focus)!;

        for (const dir of ["row", "column"] as const) {
          const last = want.held.filter((h) => h.dir === dir).at(-1);
          expect(
            last === undefined || (dir === "row" ? f.width : f.height) >= last.at - SAME,
            `L31 (b): the focused tile is drawn at least ${last?.at} along its ${dir} at ${width}x${height}`,
          ).toBe(true);
        }

        seen.strips += strips.size > 0 ? 1 : 0;
        const first = rule(w, size, new Set()).boxes;
        seen.thin += [...strips].some((t) => {
          const r = first.get(t)!;
          return r.width < ACROSS.row || r.height < ACROSS.column;
        })
          ? 1
          : 0;
        seen.bands += want.bands.length > 0 ? 1 : 0;
        seen.held += want.held.some((h) => h.at < (h.dir === "row" ? SMALLEST.width : SMALLEST.height)) ? 1 : 0;
      }),
      { seed: SEED, numRuns: 300, examples: [[REVIEW_BUG]] },
    );
    expect(seen.strips, "L31: the walks fold tiles").toBeGreaterThan(0);
    expect(seen.thin, "L31: the walks fold a tile whose full share is thinner than a strip").toBeGreaterThan(0);
    expect(seen.bands, "L31: the walks fold a whole container into one band").toBeGreaterThan(0);
    expect(
      seen.held,
      "L31: the walks hold a focused part at less than the floor, all its container has",
    ).toBeGreaterThan(0);
    expect(seen.close + seen.overflow, "L31: most runs are judged exactly").toBeLessThan(seen.runs / 2);
  });

  it("scenario: a 2x2 at 400x300 with t1 focused folds the bottom row whole: one band 20px tall across the area, its two strips lying along it apart, and t1 holds the rest beside c's 22px strip (amendment 13, point 3)", () => {
    const [t1, c, a, b] = [1, 2, 3, 4].map((n) => typeId("tile", n) as TileId);
    let w: Workspace = Schema.decodeUnknownSync(Workspace)({
      id: typeId("workspace", 1),
      n: 1,
      layout: t1,
      focus: t1,
      recent: [t1],
    });
    w = Layout.split(w, t1!, "column", a!);
    w = Layout.split(w, a!, "row", b!);
    w = Layout.split(w, t1!, "row", c!);
    w = Layout.focus(w, t1!);
    const size = { width: 400, height: 300 };
    const strips = fold(w, size);
    expect([...strips].sort(), "the bottom row and c fold at 400x300").toEqual([c, a, b].sort());
    const boxes = drawn(w, size, strips);
    const band = { x: 0, y: 300 - ACROSS.column, width: 400, height: ACROSS.column };
    const bottom = [boxes.get(a!)!, boxes.get(b!)!];
    expect(
      bottom.every((x) => inside(x, band) && Math.abs(x.height - ACROSS.column) <= SAME),
      `the bottom row is one band ${JSON.stringify(band)}, its strips ${JSON.stringify(bottom)} lying along it`,
    ).toBe(true);
    expect(apart(bottom[0]!, bottom[1]!), "the band's two strips lie apart").toBe(true);
    expect(
      bottom.every((x) => x.width > ACROSS.row),
      "each strip in the band lies along it, wider than a row strip, so its name can be read",
    ).toBe(true);
    expect(boxes.get(c!)!.width, "c is a 22px strip beside t1").toBeCloseTo(ACROSS.row);
    expect(
      same(boxes.get(t1!)!, { x: 0, y: 0, width: 400 - ACROSS.row - 4, height: 300 - ACROSS.column - 4 }),
      `t1 holds the rest: ${JSON.stringify(boxes.get(t1!))}`,
    ).toBe(true);
  });
});
