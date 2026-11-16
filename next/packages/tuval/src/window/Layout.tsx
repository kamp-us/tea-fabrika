// next/: one workspace of tezgah's view, drawn as the window's one `main` with one region per open
// tile, in reading order (0503's lesson, read for next/ per 0217). Each container runs in its own
// direction and gives each part its percent. libfabrika's one `GAP` (0492's 4px divider) sits
// between two parts and around the workspace, so what is drawn is what the room check measures
// (plan amendment 7). A tile is the tile guidelines' look: one 1px edge, a 20px mono title bar on
// its wash, and the slate focus edge on the focused tile with its name at weight 500, so color is
// never the only cue (WCAG 1.4.1). Nothing on a tile moves. Each region carries its tile's id for
// the page's focus reading. It is never a Tab stop: a click on its title bar or its empty body
// focuses it for an instant, and DOM focus goes on to the tile's cursor or its top. It keeps focus
// only while the tile has nothing to focus yet.
//
// A window folds what does not fit at its own size (0277): each tile in `strips` draws as a strip
// where it sits, a real button named `open <program>, t<n>` that Tab reaches and Enter or a click
// opens. A strip is no region and holds no body, since programs know nothing about folds (0506).
// Once the page knows its size, every part is drawn at the length libfabrika's one drawn geometry
// gives it (`lengths` in `tezgah/Fold.ts`, plan amendments 13 and 14), the same numbers the fold and
// the room check measure: a strip `STRIP` along its container, the part leading to the focused tile
// held at the floor, and a band, a container whose tiles all fold, one strip's size with its strips
// lying along it, one button per tile, sharing its length. Before the page knows its size, nothing
// folds and the parts share the area by percent.
import { lengths, STRIP, shut } from "@kampus/libfabrika/tezgah/Fold";
import { GAP, order } from "@kampus/libfabrika/tezgah/Layout";
import type { Dir, Layout as Tree, Tile, TileId, Workspace } from "@kampus/libfabrika/tezgah/Workspace";
import * as Arr from "effect/Array";
import * as Function from "effect/Function";
import * as Option from "effect/Option";
import * as Tuple from "effect/Tuple";
import type { ReactElement } from "react";

/**
 * Returns the two words every text that names a tile is built from, so they can never disagree: its
 * program's own name after its pack, as `checklist`, and its handle `t<n>`, the short id other text
 * uses (the tile guidelines' "Program name" and "Tile id").
 */
export const tileWords = (tile: Pick<Tile, "program" | "n">) => ({
  program: tile.program.slice(tile.program.lastIndexOf("/") + 1),
  handle: `t${tile.n}`,
});

/**
 * Returns a tile's accessible name, the one place it is written: `tileWords`' program, then its
 * handle, as `checklist, t2` (0503). Focus is never in it, so a name stays put while focus moves;
 * `aria-current` says which tile has it.
 */
export const tileName = (tile: Pick<Tile, "program" | "n">): string => {
  const { program, handle } = tileWords(tile);
  return `${program}, ${handle}`;
};

/** What a tile's title bar says of it beside its name, and whether a person can use it now. */
type State = { readonly word: string; readonly live: boolean };

type Props = {
  readonly workspace: Workspace;
  readonly tiles: ReadonlyArray<Tile>;
  /** The body drawn inside each tile. */
  readonly children: (tile: Tile) => ReactElement;
  /** The word in a tile's state slot, and whether it takes input; a live tile with no word without it. */
  readonly state?: (tile: Tile) => State;
  /** The tile whose close waits on y or n, which its state slot asks. */
  readonly asking?: TileId | null;
  /** Where DOM focus last sat in a tile (0165), the window's `lastCursor`, whose null means at the
   *  tile's top; without it, the cursor tezgah's view gives the tile. */
  readonly cursor?: (tile: Tile) => string | null;
  /** The area the parts are laid out in, inside the main's padding, in CSS pixels, once the page
   *  has said it. */
  readonly size?: { readonly width: number; readonly height: number } | null;
  /** The tiles this window draws as strips: `fold` of the workspace at the window's size. */
  readonly strips?: ReadonlySet<TileId>;
  /** A strip was pressed, by Enter, Space or a click: the window focuses its tile, so it opens. */
  readonly open?: (tile: Tile) => void;
};

/** What a tile's DOM focus can land on, in document order. */
const FOCUSABLE =
  'input:not([disabled]), button:not([disabled]), select:not([disabled]), textarea:not([disabled]), a[href], [tabindex]:not([tabindex="-1"])';

/**
 * Where DOM focus lands in a tile's `region` (0165, the plan's L28): the element its `cursor` key
 * names, when it is there, else the top of the tile, its first control, or the region itself while
 * it has none.
 */
export const landing = (region: HTMLElement, cursor: string | null): HTMLElement => {
  const row =
    cursor === null
      ? Option.none()
      : Arr.findFirst([...region.querySelectorAll("[data-cursor]")], (e) => e.getAttribute("data-cursor") === cursor);
  return (
    Option.getOrElse(row, () => region.querySelector(".tile-body"))?.querySelector<HTMLElement>(FOCUSABLE) ?? region
  );
};

const LIVE: State = { word: "", live: true };

const NONE: ReadonlySet<TileId> = new Set();

/** A strip's accessible name: `open ` and then `tileName`'s words, so its program is always said. */
const stripName = (tile: Pick<Tile, "program" | "n">): string => `open ${tileName(tile)}`;

/** A box's classes: its own, and the direction it lays its parts in when it holds a container. */
const flow = (own: string, inner: Tree): string => (typeof inner === "string" ? own : `${own} flow-${inner.dir}`);

/** The close question, in the tile guidelines' words, as tmux asks it. */
export const question = (tile: Pick<Tile, "n">): string => `close t${tile.n}? (y/n)`;

const TileRegion = ({
  tile,
  focused,
  state,
  asking,
  cursor,
  children,
}: {
  readonly tile: Tile;
  readonly focused: boolean;
  readonly state: State;
  readonly asking: boolean;
  readonly cursor: string | null;
  readonly children: ReactElement;
}) => (
  <section
    className={Function.pipe(
      ["tile", focused ? "focused" : "", state.live ? "" : "disconnected"],
      Arr.filter((c) => c !== ""),
      Arr.join(" "),
    )}
    aria-label={tileName(tile)}
    aria-current={focused ? "true" : undefined}
    data-tile={tile.id}
    tabIndex={-1}
    inert={!state.live}
    // A click on the title bar or on the body's empty space focuses the region itself: DOM focus goes
    // on to where `landing` says, on the row it last sat on, so what a person types next reaches the tile.
    onFocus={(e) => {
      const to = e.target === e.currentTarget ? landing(e.currentTarget, cursor) : e.currentTarget;

      if (to !== e.currentTarget) {
        to.focus({ preventScroll: true });
      }
    }}
  >
    <header className="titlebar">
      <span className="tile-mark" aria-hidden="true">
        ·
      </span>
      <span className="tile-name">{tile.program.slice(tile.program.lastIndexOf("/") + 1)}</span>
      {asking ? (
        <span className="tile-state question">{question(tile)}</span>
      ) : state.word === "" ? null : (
        <span className="tile-state">{state.word}</span>
      )}
      <span className="tile-id" aria-hidden="true">
        t{tile.n}
      </span>
    </header>
    <div className="tile-body">{children}</div>
  </section>
);

/** A folded tile, drawn where it sits: a button whose words are its tile's name, upright in a row. */
const Strip = ({
  tile,
  dir,
  open,
}: {
  readonly tile: Tile;
  readonly dir: Dir;
  readonly open: ((tile: Tile) => void) | undefined;
}) => (
  <button
    type="button"
    className={`strip strip-${dir}`}
    aria-label={stripName(tile)}
    data-strip={tile.id}
    onClick={() => open?.(tile)}
  >
    <span className="strip-name">{tileName(tile)}</span>
  </button>
);

/**
 * Draws one workspace of tezgah's view: the window's `main`, and inside it each container and
 * tile where tezgah's percents put it, each tile in `strips` as a strip.
 */
export const Layout = ({
  workspace,
  tiles,
  children,
  state,
  asking = null,
  cursor,
  size = null,
  strips = NONE,
  open,
}: Props) => {
  const byId = new Map(Arr.map(tiles, (t) => Tuple.make(t.id, t)));
  const divider = (i: number) => (
    <div key={`divider-${i}`} className="divider" style={{ flexBasis: GAP }} aria-hidden="true" />
  );
  const strip = (id: TileId, dir: Dir) => {
    const tile = byId.get(id);
    return tile === undefined ? [] : [<Strip key={tile.id} tile={tile} dir={dir} open={open} />];
  };
  /** Draws `node` in a box of `box` (null before the page knows its size), inside a container of
   *  direction `dir`. */
  const draw = (
    node: Tree,
    dir: Dir,
    box: { readonly width: number; readonly height: number } | null,
  ): ReactElement | ReadonlyArray<ReactElement> | null => {
    if (typeof node === "string") {
      const tile = byId.get(node);

      if (tile !== undefined && node !== workspace.focus && strips.has(node)) {
        return strip(node, dir);
      }

      return tile === undefined ? null : (
        <TileRegion
          key={tile.id}
          tile={tile}
          focused={tile.id === workspace.focus}
          state={state?.(tile) ?? LIVE}
          asking={tile.id === asking}
          cursor={cursor === undefined ? tile.cursor : cursor(tile)}
        >
          {children(tile)}
        </TileRegion>
      );
    }

    const row = node.dir === "row";
    const shares = box === null ? null : lengths(node, row ? box.width : box.height, strips, workspace.focus);
    return Arr.flatMap(node.parts, (part, i) => {
      const share = shares?.[i];
      const inner =
        box === null || share === undefined
          ? null
          : row
            ? { width: share, height: box.height }
            : { width: box.width, height: share };
      const folded = shut(part.inner, strips);
      const style =
        share !== undefined
          ? { flexGrow: 0, flexShrink: 1, flexBasis: share }
          : folded
            ? { flexGrow: 0, flexShrink: 0, flexBasis: STRIP[node.dir] }
            : { flexGrow: part.percent };
      // A band: every tile of a folded container lies along it, one strip each, sharing its length.
      const body =
        folded && typeof part.inner !== "string"
          ? Arr.flatMap(order(part.inner), (t, k) => [...(k === 0 ? [] : [divider(k)]), ...strip(t, node.dir)])
          : draw(part.inner, node.dir, inner);
      const flows =
        folded && typeof part.inner !== "string"
          ? `part band flow-${row ? "column" : "row"}`
          : flow("part", part.inner);
      return [
        ...(i === 0 ? [] : [divider(i)]),
        <div key={`part-${i}`} className={flows} style={style}>
          {body}
        </div>,
      ];
    });
  };
  // The padding and the dividers are libfabrika's one gap, the number the room check measures with.
  return (
    <main className={flow("desk", workspace.layout)} style={{ padding: GAP }}>
      {draw(workspace.layout, "row", size)}
    </main>
  );
};
