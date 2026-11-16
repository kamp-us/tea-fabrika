/**
 * A workspace's layout, as pure functions: tezgah changes a layout with them, and every window
 * reads its geometry with them, so a client and the brain never disagree on a tree.
 *
 * A split in a container's own direction adds a sibling after the tile; a split the other way
 * nests a new container, so nested containers alternate direction. Every change settles the tree:
 * a container of one part gives way to its part, and a container left inside one of its own
 * direction merges into it (AeroSpace's normalization, read through 0505 and 0277).
 *
 * @stability unstable
 */
import { Predicate, Schema } from "effect";
import { type Container, Dir, type Layout, type Part, type TileId, type Workspace } from "./Workspace.ts";

/** How far a container's percents may drift from 100 by float rounding before it is untidy. */
const DRIFT = 1e-6;

/**
 * Schema for one way a workspace is untidy: a tile shown twice, a container whose parts do not sum
 * to 100, a container of one part, a container inside one of its own direction, a part with no
 * share, a focus or a `recent` entry that names no live tile, or `recent` naming a tile twice.
 *
 * @stability unstable
 * @category schemas
 */
export const Violation = Schema.TaggedUnion({
  twice: { tile: Schema.String },
  sum: { dir: Dir, total: Schema.Number },
  one_part: { dir: Dir },
  same_direction: { dir: Dir },
  no_share: { percent: Schema.Number },
  focus: { tile: Schema.String },
  recent: { tile: Schema.String },
  recent_twice: { tile: Schema.String },
});

/**
 * One way a workspace is untidy, as `Violation` decodes it.
 *
 * @stability unstable
 * @category models
 */
export type Violation = typeof Violation.Type;

/**
 * A rectangle in a window, in pixels from its top left.
 *
 * @stability unstable
 * @category models
 */
export type Rect = { readonly x: number; readonly y: number; readonly width: number; readonly height: number };

const V = Violation.cases;

const isTile = (node: Layout): node is TileId => Predicate.isString(node);

/**
 * Returns the layout's tiles in reading order: a container's parts in order, depth first.
 *
 * @stability unstable
 * @category getters
 */
export const order = (layout: Layout): ReadonlyArray<TileId> =>
  isTile(layout) ? [layout] : layout.parts.flatMap((p) => order(p.inner));

/** Puts `tile` after `at` with half of `at`'s share, in a container of direction `dir`. */
const placed = (node: Layout, at: TileId, dir: Dir, tile: TileId): Layout => {
  if (isTile(node)) {
    return node === at
      ? {
          dir,
          parts: [
            { percent: 50, inner: at },
            { percent: 50, inner: tile },
          ],
        }
      : node;
  }

  if (node.dir === dir && node.parts.some((p) => p.inner === at)) {
    return {
      dir,
      parts: node.parts.flatMap((p) =>
        p.inner === at
          ? [
              { percent: p.percent / 2, inner: at },
              { percent: p.percent / 2, inner: tile },
            ]
          : [p],
      ),
    };
  }

  return {
    dir: node.dir,
    parts: node.parts.map((p) => ({ percent: p.percent, inner: placed(p.inner, at, dir, tile) })),
  };
};

/** The newest focus first, each tile once. */
const focused = (recent: ReadonlyArray<TileId>, tile: TileId): ReadonlyArray<TileId> => [
  tile,
  ...recent.filter((t) => t !== tile),
];

/**
 * Splits tile `at` in direction `dir`: `tile` takes the second half of `at`'s share, after it, and
 * takes focus. A workspace without `at` is returned as it was.
 *
 * @stability unstable
 * @category combinators
 */
export const split = (w: Workspace, at: TileId, dir: Dir, tile: TileId): Workspace =>
  !order(w.layout).includes(at) || order(w.layout).includes(tile)
    ? w
    : { ...w, layout: placed(w.layout, at, dir, tile), focus: tile, recent: focused(w.recent, tile) };

/**
 * Focuses `tile`: it comes first in `recent`, the rest keep their order, and the layout stays. A
 * workspace without `tile` is returned as it was.
 *
 * @stability unstable
 * @category combinators
 */
export const focus = (w: Workspace, tile: TileId): Workspace =>
  order(w.layout).includes(tile) ? { ...w, focus: tile, recent: focused(w.recent, tile) } : w;

/** A container settled: no part, nothing; one part, that part; a part of its own direction merged
 *  in by its share; the last part takes what float rounding left of 100. */
const settled = (dir: Dir, parts: ReadonlyArray<Part>): Layout | null => {
  const [first, ...others] = parts;

  if (first === undefined) {
    return null;
  }

  if (others.length === 0) {
    return first.inner;
  }

  const merged = parts.flatMap((p): ReadonlyArray<Part> =>
    !isTile(p.inner) && p.inner.dir === dir
      ? p.inner.parts.map((q) => ({ percent: (q.percent * p.percent) / 100, inner: q.inner }))
      : [p],
  );

  const rest = merged.slice(0, -1).reduce((total, p) => total + p.percent, 0);

  return { dir, parts: merged.map((p, i) => (i === merged.length - 1 ? { ...p, percent: 100 - rest } : p)) };
};

/** The layout without `tile`: its share goes to the part before it, or after it when it is first. */
const without = (node: Layout, tile: TileId): Layout | null => {
  if (isTile(node)) {
    return node === tile ? null : node;
  }

  const parts: Array<Part> = [];
  let carry = 0;

  for (const p of node.parts) {
    const inner = without(p.inner, tile);
    const last = parts.at(-1);

    if (inner === null && last !== undefined) {
      parts[parts.length - 1] = { ...last, percent: last.percent + p.percent };
    } else if (inner === null) {
      carry += p.percent;
    } else {
      parts.push({ percent: p.percent + carry, inner });
      carry = 0;
    }
  }

  return settled(node.dir, parts);
};

/**
 * Removes `tile`: its share goes to the part before it, then the tree settles. When it had focus,
 * focus goes to the next tile in reading order, else the one before. A workspace's last tile, or a
 * tile it does not hold, is returned as it was.
 *
 * @stability unstable
 * @category combinators
 */
export const remove = (w: Workspace, tile: TileId): Workspace => {
  const was = order(w.layout);
  const at = was.indexOf(tile);
  const layout = without(w.layout, tile);

  if (at < 0 || layout === null) {
    return w;
  }

  const recent = w.recent.filter((t) => t !== tile);

  if (w.focus !== tile) {
    return { ...w, layout, recent };
  }

  // `layout` is not null, so another tile is left, after `tile` or before it.
  const heir = was[at + 1] ?? was[at - 1] ?? w.focus;

  return { ...w, layout, focus: heir, recent: focused(recent, heir) };
};

/**
 * The gap a frame draws between two parts of a container, and around a workspace, in CSS pixels:
 * 0492's 4px divider. A window's room check and its drawing both read this one number.
 *
 * @stability unstable
 * @category constants
 */
export const GAP = 4;

/**
 * Returns each tile's rectangle in an area of `size`: a row splits its width, a column its height.
 * Each container first leaves `gap` between each two of its parts, then gives each part its percent
 * of what is left, so a nested container loses its own gaps too (plan amendment 7). Without a gap
 * the parts share the whole area.
 *
 * @stability unstable
 * @category getters
 */
export const rects = (
  layout: Layout,
  size: { readonly width: number; readonly height: number },
  options: { readonly gap: number } = { gap: 0 },
): ReadonlyMap<TileId, Rect> => {
  const out = new Map<TileId, Rect>();

  const walk = (node: Layout, r: Rect): void => {
    if (isTile(node)) {
      out.set(node, r);

      return;
    }

    const row = node.dir === "row";
    const left = (row ? r.width : r.height) - (node.parts.length - 1) * options.gap;
    let at = row ? r.x : r.y;

    for (const p of node.parts) {
      const share = (left * p.percent) / 100;
      walk(
        p.inner,
        row ? { x: at, y: r.y, width: share, height: r.height } : { x: r.x, y: at, width: r.width, height: share },
      );
      at += share + options.gap;
    }
  };

  walk(layout, { x: 0, y: 0, width: size.width, height: size.height });

  return out;
};

/**
 * A side of a tile, for a focus move: tmux's `select-pane -L -R -U -D`.
 *
 * @stability unstable
 * @category models
 */
export type Side = "left" | "right" | "up" | "down";

/** How close two edges or two overlaps must be to count as the same, after float rounding. */
const NEAR = 1e-9;

/** How much of `from`'s `side` edge `other` shares, or 0 when it does not touch that edge. */
const shared = (from: Rect, other: Rect, side: Side): number => {
  const edge = {
    left: other.x + other.width - from.x,
    right: from.x + from.width - other.x,
    up: other.y + other.height - from.y,
    down: from.y + from.height - other.y,
  }[side];

  const across =
    side === "left" || side === "right"
      ? Math.min(from.y + from.height, other.y + other.height) - Math.max(from.y, other.y)
      : Math.min(from.x + from.width, other.x + other.width) - Math.max(from.x, other.x);

  return Math.abs(edge) < NEAR && across > NEAR ? across : 0;
};

/**
 * Returns the tile on `side` of `from` that shares the most of that edge, from the percents alone;
 * a tie goes to the tile first in reading order. Null when `from` sits on the workspace's edge
 * there, or is not in the layout: a move with no neighbor does nothing, as in tmux.
 *
 * @stability unstable
 * @category getters
 */
export const neighbor = (layout: Layout, from: TileId, side: Side): TileId | null => {
  const boxes = rects(layout, { width: 1, height: 1 });
  const box = boxes.get(from);

  if (box === undefined) {
    return null;
  }

  const shares = [...boxes].flatMap(([t, other]) => {
    const share = t === from ? 0 : shared(box, other, side);

    return share > 0 ? [{ t, share }] : [];
  });

  const most = Math.max(0, ...shares.map((x) => x.share));

  // Float rounding may split a tie by a hair: anything this close to the most is the most.
  return shares.find((x) => x.share > most - 1e-6)?.t ?? null;
};

/** Every way one container and the containers in it are untidy. */
const untidy = (node: Container, parent: Dir | null): ReadonlyArray<Violation> => {
  const total = node.parts.reduce((sum, p) => sum + p.percent, 0);

  return [
    ...(node.parts.length < 2 ? [V.one_part.make({ dir: node.dir })] : []),
    ...(parent === node.dir ? [V.same_direction.make({ dir: node.dir })] : []),
    ...(Math.abs(total - 100) > DRIFT ? [V.sum.make({ dir: node.dir, total })] : []),
    ...node.parts.flatMap((p) => [
      ...(p.percent > 0 ? [] : [V.no_share.make({ percent: p.percent })]),
      ...(isTile(p.inner) ? [] : untidy(p.inner, node.dir)),
    ]),
  ];
};

/**
 * Returns every way the workspace is untidy, empty when it is tidy: each tile once, each
 * container's parts summing to 100 with a share each, no container of one part, directions
 * alternating, and focus and `recent` naming only live tiles, each once.
 *
 * @stability unstable
 * @category getters
 */
export const check = (w: Workspace): ReadonlyArray<Violation> => {
  const tiles = order(w.layout);
  const live = new Set<string>(tiles);
  const twice = tiles.filter((t, i) => tiles.indexOf(t) !== i);
  const again = w.recent.filter((t, i) => w.recent.indexOf(t) !== i);

  return [
    ...(isTile(w.layout) ? [] : untidy(w.layout, null)),
    ...[...new Set(twice)].map((tile) => V.twice.make({ tile })),
    ...(live.has(w.focus) ? [] : [V.focus.make({ tile: w.focus })]),
    ...w.recent.filter((t) => !live.has(t)).map((tile) => V.recent.make({ tile })),
    ...[...new Set(again)].map((tile) => V.recent_twice.make({ tile })),
  ];
};
