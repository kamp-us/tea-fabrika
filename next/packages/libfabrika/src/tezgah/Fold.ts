/**
 * What a window draws of a workspace at its own size, and which tiles it folds: one geometry, in the
 * library, which the fold, the window's room check and the frame's drawing all read, so they can
 * never drift apart (0277: size belongs to the viewer; plan amendments 13 and 14).
 *
 * A container leaves `GAP` between each two parts. A part all of whose tiles are strips takes
 * `STRIP` along the container's axis: a lone strip, or a band, a container whose tiles all fold,
 * whose strips lie along it and share its length equally. The open parts share what is left by
 * percent, except that the part leading to the focused tile is held at the floor, or at all the
 * container has when that is less. `fold` is the fixpoint on that geometry: a tile folds only when
 * it is drawn under 220x120 where it folds, and the focused tile never folds.
 */
import * as Arr from "effect/Array";
import * as Option from "effect/Option";
import { GAP, order, type Rect } from "./Layout.ts";
import type { Container, Layout, TileId, Workspace } from "./Workspace.ts";

/**
 * The smallest a tile may be drawn open: the readability floor from fold, not tabs. Not a setting.
 *
 * @category constants
 */
export const SMALLEST = { width: 220, height: 120 } as const;

/**
 * How far a strip reaches along its container's axis, in CSS pixels: 22px upright in a row, 20px
 * lying down in a column (the fold note).
 *
 * @category constants
 */
export const STRIP = { row: 22, column: 20 } as const;

/** The area a window lays its tiles out in, inside the frame's padding, in CSS pixels. */
type Size = { readonly width: number; readonly height: number };

/**
 * Returns whether a layout draws as strips only: a tile in `strips`, or a container whose tiles all
 * are (a band).
 *
 * @category getters
 */
export const shut = (node: Layout, strips: ReadonlySet<TileId>): boolean =>
  typeof node === "string" ? strips.has(node) : Arr.every(node.parts, (p) => shut(p.inner, strips));

/**
 * Returns each part's length along a container of `length` pixels, gaps not counted: a part that is
 * shut takes `STRIP`, the open parts share the rest by percent, and the part that leads to `focus`
 * is held at `min(floor, the rest)` when its share is smaller. When the strips alone are longer than
 * the container, they share its length equally and the open parts get nothing: that window is too
 * small for the layout (plan amendment 14).
 *
 * @category getters
 */
export const lengths = (
  node: Container,
  length: number,
  strips: ReadonlySet<TileId>,
  focus: TileId,
): ReadonlyArray<number> => {
  const left = length - (node.parts.length - 1) * GAP;
  const fixed = Arr.map(node.parts, (p) => shut(p.inner, strips));
  const count = Arr.filter(fixed, (f) => f).length;
  const has = left - count * STRIP[node.dir];

  if (has < 0) {
    return Arr.map(fixed, (f) => (f ? Math.max(0, left) / count : 0));
  }

  const total = Arr.reduce(node.parts, 0, (sum, p, i) => (fixed[i] === true ? sum : sum + p.percent));
  const shares = Arr.map(node.parts, (p, i) => (fixed[i] === true ? STRIP[node.dir] : (has * p.percent) / total));
  const lead = Arr.findFirstWithIndex(node.parts, (p) => order(p.inner).includes(focus));
  const least = Math.min(node.dir === "row" ? SMALLEST.width : SMALLEST.height, has);

  if (Option.isNone(lead)) {
    return shares;
  }

  const [held, at] = lead.value;

  if ((shares[at] ?? 0) >= least) {
    return shares;
  }

  const rest = total - held.percent;
  return Arr.map(node.parts, (p, i) =>
    i === at ? least : fixed[i] === true ? STRIP[node.dir] : rest > 0 ? ((has - least) * p.percent) / rest : 0,
  );
};

/**
 * Returns each tile's drawn box in an area of `size`, from its top left, when `strips` are drawn as
 * strips. A band's strips lie along it, one after another with `GAP` between, sharing its length.
 *
 * @category getters
 */
export const drawn = (w: Workspace, size: Size, strips: ReadonlySet<TileId>): ReadonlyMap<string, Rect> => {
  const out = new Map<TileId, Rect>();

  const band = (tiles: ReadonlyArray<TileId>, r: Rect, upright: boolean) => {
    const each = Math.max(0, ((upright ? r.height : r.width) - (tiles.length - 1) * GAP) / tiles.length);

    for (const [i, t] of tiles.entries()) {
      const at = i * (each + GAP);
      out.set(t, upright ? { ...r, y: r.y + at, height: each } : { ...r, x: r.x + at, width: each });
    }
  };

  const walk = (node: Layout, r: Rect): void => {
    if (typeof node === "string") {
      out.set(node, r);

      return;
    }

    const row = node.dir === "row";
    const shares = lengths(node, row ? r.width : r.height, strips, w.focus);
    let at = row ? r.x : r.y;

    for (const [i, p] of node.parts.entries()) {
      const share = shares[i] ?? 0;

      const box = row
        ? { x: at, y: r.y, width: share, height: r.height }
        : { x: r.x, y: at, width: r.width, height: share };

      if (typeof p.inner !== "string" && shut(p.inner, strips)) {
        band(order(p.inner), box, row);
      } else {
        walk(p.inner, box);
      }

      at += share + GAP;
    }
  };

  walk(w.layout, { x: 0, y: 0, width: size.width, height: size.height });

  return out;
};

/**
 * Returns the tiles of workspace `w` that a window of `size` draws as strips: from none, every open
 * tile but the focused one drawn under 220x120, again on the geometry that leaves, until nothing
 * changes. Strips only grow, so it ends within the tile count.
 *
 * @category getters
 */
export const fold = (w: Workspace, size: Size): ReadonlySet<TileId> => {
  let strips: ReadonlySet<TileId> = new Set();

  for (;;) {
    const boxes = drawn(w, size, strips);
    const due = Arr.filter(order(w.layout), (t) => {
      const r = boxes.get(t);

      return (
        !strips.has(t) && t !== w.focus && r !== undefined && (r.width < SMALLEST.width || r.height < SMALLEST.height)
      );
    });

    if (due.length === 0) {
      return strips;
    }

    strips = new Set([...strips, ...due]);
  }
};
