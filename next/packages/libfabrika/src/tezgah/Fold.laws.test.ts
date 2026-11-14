// Desk S4, next/ (the desk program fabrika/tezgah, ticket named by its title): law L31's fold half,
// of the approved plan (docs/plan/lanes/desk-PLAN.md). Written before `tezgah/Fold.ts`. Tuval's
// `window/Layout.laws.test.ts` holds L31's markup half, and the window machine's laws hold the `fold`
// client row and L32.
//
// The shape this law holds `Fold.ts` to, from the plan's "The shape" and amendment 7 (the build may
// add more):
// - `fold(w, size): ReadonlySet<TileId>` is pure: which tiles of workspace `w` draw as strips in a
//   window whose tiles are laid out in an area of `size` (the window's `size` Msg: inside the frame's
//   padding, in CSS pixels). Size belongs to the viewer (0277), so the fold is worked out from the
//   layout, the focus and the size alone, and never stored.
// - A tile under 220x120 at this window's size draws as a strip, and only such a tile: the plan's
//   "tiles under 220x120 draw as strips". A tile's size is the size the frame draws it at, the room
//   check's own measure: `Layout.rects(layout, size, {gap: GAP})` (amendment 7: "S4's fold (L31)
//   reuses it").
// - The focused tile is never a strip, even when the window is too small to draw it at 220x120
//   (focus is always on an open tile, 0506's rule read through 0277). So every open tile but the
//   focused one is at least 220x120; that the focused one may be smaller is an open point for the
//   lead (the plan's L31 says "every open tile").
//
// The generator draws a window size from 320x240 to 2560x1600 and walks a layout from one tile with
// the library's real `Layout.split` and `Layout.remove`: each cut picks a live tile from the layout it
// is folding, and a close only while two or more are live. A tile whose drawn edge sits within half
// a pixel of the floor is left out of the exact half, so float rounding cannot decide the law.
import { describe, expect, it } from "@effect/vitest";
import { Schema } from "effect";
import * as fc from "fast-check";
import { fold } from "./Fold.ts";
import * as Layout from "./Layout.ts";
import { type TileId, Workspace } from "./Workspace.ts";

const SEED = 119120;
const ALPHABET = "0123456789abcdefghjkmnpqrstvwxyz";

/** The readability floor from fold, not tabs: a drawn tile under it is a strip (not a setting). */
const SMALLEST = { width: 220, height: 120 } as const;
/** How close to the floor a drawn edge may sit before float rounding could decide the law. */
const EDGE = 0.5;

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

type Box = { readonly width: number; readonly height: number };

const under = (r: Box) => r.width < SMALLEST.width || r.height < SMALLEST.height;
const near = (r: Box) => Math.abs(r.width - SMALLEST.width) <= EDGE || Math.abs(r.height - SMALLEST.height) <= EDGE;

const Cut = fc.record({ at: fc.nat(), down: fc.boolean(), close: fc.boolean() });

/** A workspace walked from one tile by `cuts`, focus on the live tile `focus` picks. */
const walked = (cuts: ReadonlyArray<typeof Cut extends fc.Arbitrary<infer C> ? C : never>, focus: number) => {
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

describe("Desk S4 L31: a window folds a tile under 220x120 at its own size into a strip, never the focused one", () => {
  it("L31: at any size and layout, the strips are exactly the tiles other than the focused one drawn under 220x120 at this window's size; the focused tile is never a strip, and every other open tile is at least 220x120", () => {
    const seen = { strips: 0, none: 0, both: 0, focusUnder: 0, nested: 0 };
    fc.assert(
      fc.property(Window, ({ width, height, cuts, focus }) => {
        const w = walked(cuts, focus);
        const size = { width, height };
        const before = JSON.stringify(w);
        const strips = fold(w, size);
        const live = Layout.order(w.layout);
        const drawn = Layout.rects(w.layout, size, { gap: Layout.GAP });

        expect(JSON.stringify(w), "L31: fold changes nothing it is given").toBe(before);
        expect(
          [...strips].filter((t) => !live.includes(t)),
          "L31: a strip is a tile of this workspace",
        ).toEqual([]);
        expect(strips.has(w.focus), `L31: the focused tile is never a strip, at ${width}x${height}`).toBe(false);

        for (const t of live.filter((t) => t !== w.focus)) {
          const r = drawn.get(t)!;

          if (!strips.has(t)) {
            expect(
              r.width >= SMALLEST.width - EDGE && r.height >= SMALLEST.height - EDGE,
              `L31: open tile ${t} is drawn at least 220x120 at ${width}x${height}, not ${r.width}x${r.height}`,
            ).toBe(true);
          }

          expect(
            near(r) || strips.has(t) === under(r),
            `L31: tile ${t}, drawn ${r.width}x${r.height} at ${width}x${height}, is a strip exactly when it is under 220x120`,
          ).toBe(true);
        }

        const opened = live.filter((t) => !strips.has(t));
        seen.strips += strips.size > 0 ? 1 : 0;
        seen.none += strips.size === 0 && live.length > 1 ? 1 : 0;
        seen.both += strips.size > 0 && opened.length > 1 ? 1 : 0;
        seen.focusUnder += under(drawn.get(w.focus)!) ? 1 : 0;
        seen.nested +=
          strips.size > 0 && typeof w.layout !== "string" && w.layout.parts.some((p) => typeof p.inner !== "string")
            ? 1
            : 0;
      }),
      { seed: SEED, numRuns: 300 },
    );
    expect(seen.strips, "L31: the walks fold tiles").toBeGreaterThan(0);
    expect(seen.none, "L31: the walks draw several tiles with none folded").toBeGreaterThan(0);
    expect(seen.both, "L31: the walks draw strips beside more than one open tile").toBeGreaterThan(0);
    expect(seen.focusUnder, "L31: the walks focus a tile the window is too small to draw at 220x120").toBeGreaterThan(
      0,
    );
    expect(seen.nested, "L31: the walks fold inside nested containers").toBeGreaterThan(0);
  });

  it("L31: a smaller window folds every tile a larger one folds, on the same workspace: the fold is each window's own, from its size", () => {
    const seen = { more: 0 };
    fc.assert(
      fc.property(
        Window,
        fc.integer({ min: 0, max: 1_200 }),
        fc.integer({ min: 0, max: 800 }),
        ({ width, height, cuts, focus }, wider, taller) => {
          const w = walked(cuts, focus);
          const small = fold(w, { width, height });
          const large = fold(w, { width: width + wider, height: height + taller });
          expect(
            [...large].filter((t) => !small.has(t)),
            `L31: ${width + wider}x${height + taller} folds nothing ${width}x${height} draws open`,
          ).toEqual([]);
          seen.more += small.size > large.size ? 1 : 0;
        },
      ),
      { seed: SEED, numRuns: 300 },
    );
    expect(seen.more, "L31: the walks meet a smaller window that folds more").toBeGreaterThan(0);
  });
});
