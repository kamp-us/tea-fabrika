// next/: one workspace of tezgah's view, drawn as the window's one `main` with one region per open
// tile, in reading order (0503's lesson, read for next/ per 0217). Each container runs in its own
// direction and gives each part its percent. libfabrika's one `GAP` (0492's 4px divider) sits
// between two parts and around the workspace, so what is drawn is what the room check measures
// (plan amendment 7). A tile is the tile guidelines' look: one 1px edge, a 20px mono title bar on
// its wash, and the slate focus edge on the focused tile with its name at weight 500, so color is
// never the only cue (WCAG 1.4.1). Nothing on a tile moves. Each region carries its tile's id for
// the page's focus reading, and takes focus itself only as the last place DOM focus can land in it:
// a click on its title bar, or a tile with nothing to focus yet. It is never a Tab stop.
import { GAP } from "@kampus/libfabrika/tezgah/Layout";
import type { Layout as Tree, Tile, TileId, Workspace } from "@kampus/libfabrika/tezgah/Workspace";
import type { ReactElement } from "react";

/**
 * Returns a tile's accessible name, the one place it is written: its program's own name after its
 * pack, then `t<n>`, as `checklist, t2` (0503). Focus is never in it, so a name stays put while
 * focus moves; `aria-current` says which tile has it.
 */
export const tileName = (tile: Pick<Tile, "program" | "n">): string =>
  `${tile.program.slice(tile.program.lastIndexOf("/") + 1)}, t${tile.n}`;

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
};

const LIVE: State = { word: "", live: true };

/** A box's classes: its own, and the direction it lays its parts in when it holds a container. */
const flow = (own: string, inner: Tree): string => (typeof inner === "string" ? own : `${own} flow-${inner.dir}`);

/** The close question, in the tile guidelines' words, as tmux asks it. */
export const question = (tile: Pick<Tile, "n">): string => `close t${tile.n}? (y/n)`;

const TileRegion = ({
  tile,
  focused,
  state,
  asking,
  children,
}: {
  readonly tile: Tile;
  readonly focused: boolean;
  readonly state: State;
  readonly asking: boolean;
  readonly children: ReactElement;
}) => (
  <section
    className={["tile", focused ? "focused" : "", state.live ? "" : "disconnected"].filter((c) => c !== "").join(" ")}
    aria-label={tileName(tile)}
    aria-current={focused ? "true" : undefined}
    data-tile={tile.id}
    tabIndex={-1}
    inert={!state.live}
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

/**
 * Draws one workspace of tezgah's view: the window's `main`, and inside it each container and
 * tile where tezgah's percents put it.
 */
export const Layout = ({ workspace, tiles, children, state, asking = null }: Props) => {
  const byId = new Map(tiles.map((t) => [t.id, t]));
  const draw = (node: Tree): ReactElement | ReadonlyArray<ReactElement> | null => {
    if (typeof node === "string") {
      const tile = byId.get(node);
      return tile === undefined ? null : (
        <TileRegion
          key={tile.id}
          tile={tile}
          focused={tile.id === workspace.focus}
          state={state?.(tile) ?? LIVE}
          asking={tile.id === asking}
        >
          {children(tile)}
        </TileRegion>
      );
    }

    return node.parts.flatMap((part, i) => [
      ...(i === 0
        ? []
        : [<div key={`divider-${i}`} className="divider" style={{ flexBasis: GAP }} aria-hidden="true" />]),
      <div key={`part-${i}`} className={flow("part", part.inner)} style={{ flexGrow: part.percent }}>
        {draw(part.inner)}
      </div>,
    ]);
  };
  // The padding and the dividers are libfabrika's one gap, the number the room check measures with.
  return (
    <main className={flow("desk", workspace.layout)} style={{ padding: GAP }}>
      {draw(workspace.layout)}
    </main>
  );
};
