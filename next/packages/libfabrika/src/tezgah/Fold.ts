/**
 * Which tiles a window draws as strips: a fold is the viewer's, worked out from the layout, the
 * focus and the window's own size, and never stored or sent (0277: size belongs to the viewer).
 *
 * A tile the frame would draw under 220x120 at its full percent share, with the frame's gap between
 * parts (`rects` with `GAP`), draws as a strip. The focused tile never does, even when the window is
 * too small for it, since focus is always on an open tile (0506's lesson, plan amendment 12). A strip
 * is drawn thinner than its share, so the open tiles beside it only grow past what the fold measured.
 *
 * @stability unstable
 */
import { GAP, order, rects } from "./Layout.ts";
import type { TileId, Workspace } from "./Workspace.ts";

/**
 * The smallest a tile may be drawn open: the readability floor from fold, not tabs. Not a setting.
 *
 * @stability unstable
 * @category constants
 */
export const SMALLEST = { width: 220, height: 120 } as const;

/** The area a window lays its tiles out in, inside the frame's padding, in CSS pixels. */
type Size = { readonly width: number; readonly height: number };

/**
 * Returns the tiles of workspace `w` that a window of `size` draws as strips: every tile but the
 * focused one that the frame draws under 220x120 there.
 *
 * @stability unstable
 * @category getters
 */
export const fold = (w: Workspace, size: Size): ReadonlySet<TileId> => {
  const drawn = rects(w.layout, size, { gap: GAP });
  return new Set(
    order(w.layout).filter((t) => {
      const r = drawn.get(t);
      return t !== w.focus && r !== undefined && (r.width < SMALLEST.width || r.height < SMALLEST.height);
    }),
  );
};
