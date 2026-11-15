// next/: the page draws the library's window client. React only reads and sends Msgs; the run, its
// socket and its timers belong to the scope the caller started it in. The page draws the workspace
// of its person's tezgah (`Layout.tsx`), reads each press for the window's own prefix (0278), and
// says the prefix, the close ask, a refused split and the status messages of one burst (0504) in its
// two live regions, made at boot. Desk focus follows DOM focus, and DOM focus follows desk focus
// (0503's lesson): a click or Tab into a tile tells the window, and a move lands DOM focus on the
// tile's cursor (0165). A focus move says nothing in either live region (the tile guidelines);
// `aria-current` shows it. The page folds what does not fit at its own size (0277): `fold` of the
// drawn workspace at the window's size, worked out on each draw and never kept. Tab onto a strip
// moves no desk focus, since a strip is in no tile; Enter or a click on one focuses its tile, so it
// opens.
import type { EffectRun } from "@demlik/tea/effect";
import { useRuntime } from "@demlik/tea/react";
import * as Keys from "@kampus/libfabrika/client/Keys";
import { optimisticState } from "@kampus/libfabrika/client/Tezgah";
import { lastCursor, type WindowModel, type WindowMsg } from "@kampus/libfabrika/client/WindowMachine";
import { fold } from "@kampus/libfabrika/tezgah/Fold";
import { GAP } from "@kampus/libfabrika/tezgah/Layout";
import { CursorKey, type Tile as TezgahTile } from "@kampus/libfabrika/tezgah/Workspace";
import { Button, useClipboard } from "@manti-ui/react";
import { Effect, Option, Schema } from "effect";
import { StrictMode, useEffect, useRef } from "react";
import { createRoot } from "react-dom/client";
import { landing, question, Layout, tileName } from "./Layout.tsx";
import { refusalFor, spoken, type TileWindow } from "./spoken.ts";
import { bodyWord, stateWord } from "./words.ts";

type LiveWindow = EffectRun<WindowModel, WindowMsg>;

type PageProps = {
  readonly run: LiveWindow;
  readonly origin: string;
  /** The window registered for a program, found by the program a tile shows, never by its name. */
  readonly windowFor: (program: string) => TileWindow | null;
  /** The key table the window machine was made with, so the page leaves every other key alone. */
  readonly keys: Keys.Table;
};

const pickLink = (m: WindowModel) => m.link;
const pickTiles = (m: WindowModel) => m.tiles;
const pickTezgah = (m: WindowModel) => m.tezgah?.client ?? null;
/** The window's tie to its person's tezgah, whose notes of where DOM focus last sat in each tile
 *  `lastCursor` reads. */
const pickTie = (m: WindowModel) => m.tezgah;
/** Whether the window's read of its person's tezgah found no process: the boot starts only the
 *  founder's tezgah, so any other person's window finds none until one is started for them. */
const pickNoTezgah = (m: WindowModel) => m.tezgah?.reach._tag === "missing";
const pickPrefix = (m: WindowModel) => m.prefix;
const pickPolite = (m: WindowModel) => m.polite;
const pickSize = (m: WindowModel) => m.size;

const Waiting = ({
  code,
  fingerprint,
  origin,
}: {
  readonly code: string;
  readonly fingerprint: string;
  readonly origin: string;
}) => {
  const command = `node next/apps/fabrika/grant.ts client ${origin} ${fingerprint} --code=${code} --key=<person-key-file>`;
  const clipboard = useClipboard({ value: command });
  return (
    <main className="screen" aria-labelledby="waiting-title">
      <h1 id="waiting-title">Let this window in</h1>
      <p>Run this on the computer that holds your person key. This window opens when it is granted.</p>
      <dl className="screen-facts">
        <dt>Code</dt>
        <dd data-testid="grant-code">{code}</dd>
        <dt>Window key</dt>
        <dd data-testid="fingerprint">{fingerprint}</dd>
      </dl>
      <div className="screen-command">
        <code data-testid="grant-command">{command}</code>
        <Button variant="secondary" size="sm" onClick={clipboard.copy}>
          {clipboard.copied ? "Copied" : "Copy command"}
        </Button>
      </div>
      <p>Waiting</p>
    </main>
  );
};

type Row = WindowModel["tiles"][number];

/** The word a tile's title bar says and whether it takes input, from the link and its reach. */
const tileState = (link: WindowModel["link"], row: Row | undefined) => ({
  word: stateWord(link, row?.reach),
  live: link._tag === "online" && row?.reach._tag === "open",
});

const TileBody = ({
  run,
  tile,
  windowFor,
}: {
  readonly run: LiveWindow;
  readonly tile: TezgahTile;
  readonly windowFor: PageProps["windowFor"];
}) => {
  const [row, send] = useRuntime(run, (m) => m.tiles.find((t) => t.id === tile.id));
  const [shown] = useRuntime(run, (m) => {
    const t = m.tiles.find((t) => t.id === tile.id);
    return t?.last ? m.client.views[t.last] : undefined;
  });
  const registration = windowFor(tile.program);
  const data =
    registration && shown ? Option.getOrNull(Schema.decodeUnknownOption(registration.data)(shown.view)) : null;

  // The tile guideline's empty state: one word where the view will start, and on an ended tile in
  // place of the ended process's last view.
  const word = bodyWord(row?.reach, registration !== null && data !== null);

  if (row === undefined || word !== null || registration === null || data === null) {
    return <p className="tile-empty">{word}</p>;
  }

  return (
    <registration.View
      data={data}
      tile={row.own}
      press={(m) => send({ type: "press", tile: row.id, m, via: "button" })}
      send={(msg) => send({ type: "tile", id: row.id, msg })}
      refusal={refusalFor(registration, row.refusal)}
    />
  );
};

/** What a window says while its person has no tezgah process, in its status bar and polite region,
 *  never "Opening": the window reads tezgah again on its next dial (plan amendment 11). */
const NO_TEZGAH = "tezgah is not running for you yet";

/** What a split with no room says, in the window that asked, as tmux refuses one. */
const noRoom = (tile: Pick<TezgahTile, "n">): string => `No room to split t${tile.n}`;

/** How the prefix line prints a key the table spells by name: an arrow as its arrow. */
const PRINTED: Readonly<Record<string, string>> = { arrowleft: "←", arrowright: "→", arrowup: "↑", arrowdown: "↓" };

/** The prefix line's hints: each key after the prefix and what it does, from the one table. The way
 *  out, `Esc cancel`, is the line's own right end. */
const prefixHints = (table: Keys.Table): ReadonlyArray<string> =>
  table.rows.flatMap((row) => {
    const keys = row.keys
      .filter((k) => k.startsWith("<prefix>"))
      .map((k) => k.slice("<prefix>".length))
      .map((k) => PRINTED[k] ?? k);
    return keys.length === 0 ? [] : [`${keys.join(" ")} ${row.word}`];
  });

/** The prefix line, one line at every size (the tile guidelines; modes M3): the mode's word at the
 *  left, the way out at the right, and the hints between them, cut with an ellipsis where they run out,
 *  so neither end is ever cut and no tile moves when the prefix arms. A screen reader reads all of
 *  it as one sentence; the dots between hints are hidden from it. */
const PrefixLine = ({ table }: { readonly table: Keys.Table }) => (
  <>
    <span className="mode">prefix</span>
    <span className="hints">
      {prefixHints(table).map((hint) => (
        <span key={hint} className="hint">
          {hint}
        </span>
      ))}
    </span>
    <span className="way-out">Esc cancel</span>
  </>
);

/** Reads every press on the page for the window's prefix. A key the window does not take keeps its
 *  default and reaches the tile; one it takes goes to the window and nowhere else. */
const useKeys = (run: LiveWindow, table: Keys.Table, send: (msg: WindowMsg) => void) =>
  useEffect(() => {
    const listener = (e: KeyboardEvent) => {
      const key = Keys.spell(e);

      if (key === null) {
        return;
      }

      const prefix = run.getState().prefix;
      const routed = Keys.route(table, prefix, null, { key });

      if (routed._tag === "platform" || (routed._tag === "tile" && prefix._tag === "idle")) {
        return;
      }

      // The prefix again passes the prefix key on to the tile, as tmux's send-prefix does.
      if (routed._tag !== "tile") {
        e.preventDefault();
        e.stopPropagation();
      }

      send({ type: "key", key, at: Math.max(0, e.timeStamp) });
    };
    document.addEventListener("keydown", listener, true);
    return () => document.removeEventListener("keydown", listener, true);
  }, [run, table, send]);

/** Tells the window the size of the area its tiles are laid out in, inside the desk's padding,
 *  whenever it changes. */
const useSize = (send: (msg: WindowMsg) => void) => {
  const area = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const element = area.current;

    if (element === null) {
      return;
    }

    const observer = new ResizeObserver(([entry]) => {
      if (entry !== undefined) {
        // The tiles are laid out inside the desk's padding, one gap on each side.
        const { width, height } = entry.contentRect;
        send({ type: "size", width: Math.max(0, width - 2 * GAP), height: Math.max(0, height - 2 * GAP) });
      }
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, [send]);
  return area;
};

const isCursor = Schema.is(CursorKey);

/** Where DOM focus is, for the window: the tile whose region holds `target`, and the `data-cursor`
 *  key of the nearest element around it that carries one. A key too long to keep is none. Focus on a
 *  region itself, from a click on its title bar, only passes through on its way to `landing`
 *  (`Layout.tsx`), so it is nothing to tell while the tile has something else to focus: telling it
 *  would wipe the note of the row focus last sat on before the region reads it. */
const focusAt = (target: EventTarget | null) => {
  if (target instanceof HTMLElement && target.matches("section[data-tile]") && landing(target, null) !== target) {
    return null;
  }

  const element = target instanceof Element ? target : null;
  const tile = element?.closest("section[data-tile]")?.getAttribute("data-tile") ?? null;
  const cursor = element?.closest("[data-cursor]")?.getAttribute("data-cursor") ?? null;
  return tile === null ? null : { tile, cursor: cursor !== null && isCursor(cursor) ? cursor : null };
};

/** Desk focus follows DOM focus: each time DOM focus enters an element inside a tile, by a click,
 *  by Tab or by the page itself, the window is told the tile and the cursor key there. */
const useFocusIn = (send: (msg: WindowMsg) => void) =>
  useEffect(() => {
    const listener = (e: FocusEvent) => {
      const at = focusAt(e.target);

      if (at !== null) {
        send({ type: "focus", ...at });
      }
    };
    document.addEventListener("focusin", listener, true);
    return () => document.removeEventListener("focusin", listener, true);
  }, [send]);

/** What DOM focus follows: the drawn focus, its cursor key, whether the tile takes input (an inert
 *  region takes no focus), and the drawn layout, whose change may draw the focused tile anew. */
type Follow = {
  readonly focus: string | null;
  readonly cursor: string | null;
  readonly live: boolean;
  readonly layout: string;
};

/** DOM focus follows desk focus: whenever the drawn focus, its tile's state or the layout changes and
 *  DOM focus is not in the focused tile, it lands where `landing` says. A click on a tile's title bar
 *  is the region's own to follow (`Layout.tsx`). */
const useFollow = (area: { readonly current: HTMLDivElement | null }, { focus, cursor, live, layout }: Follow) =>
  useEffect(() => {
    const region = focus === null ? null : area.current?.querySelector<HTMLElement>(`section[data-tile="${focus}"]`);

    if (region === null || region === undefined || region.contains(document.activeElement)) {
      return;
    }

    landing(region, cursor).focus({ preventScroll: true });
  }, [area, focus, cursor, live, layout]);

const Desk = (props: PageProps) => {
  const [link, send] = useRuntime(props.run, pickLink);
  const [rows] = useRuntime(props.run, pickTiles);
  const [client] = useRuntime(props.run, pickTezgah);
  const [prefix] = useRuntime(props.run, pickPrefix);
  const [polite] = useRuntime(props.run, pickPolite);
  const [none] = useRuntime(props.run, pickNoTezgah);
  const [size] = useRuntime(props.run, pickSize);
  const [tie] = useRuntime(props.run, pickTie);
  const view = none || client === null ? null : optimisticState(client);
  const space = view?.workspaces.find((w) => w.n === client?.workspace);
  const area = useSize(send);
  const roomless = polite === null ? undefined : view?.tiles.find((t) => t.id === polite.tile);
  const focused = view?.tiles.find((t) => t.id === space?.focus);
  /** Where DOM focus last sat in a tile: the one answer both landings read (0165). */
  const cursor = (t: TezgahTile) => lastCursor(tie, t);
  useFocusIn(send);
  useFollow(area, {
    focus: focused?.id ?? null,
    cursor: focused === undefined ? null : cursor(focused),
    live: tileState(
      link,
      rows.find((r) => r.id === focused?.id),
    ).live,
    layout: space === undefined ? "" : JSON.stringify(space.layout),
  });
  const asked = prefix._tag === "asking" ? view?.tiles.find((t) => t.id === prefix.tile) : undefined;
  const line = none ? (
    NO_TEZGAH
  ) : asked !== undefined ? (
    question(asked)
  ) : prefix._tag === "armed" ? (
    <PrefixLine table={props.keys} />
  ) : roomless !== undefined ? (
    noRoom(roomless)
  ) : focused === undefined ? (
    ""
  ) : (
    tileName(focused)
  );
  const said = typeof line === "string" ? <span className="says">{line}</span> : line;
  return (
    <>
      <div className="area" ref={area}>
        {view === null || space === undefined ? (
          <main className="desk">
            {/* With no tezgah the status bar says so, once; the empty desk repeats nothing. */}
            {none ? null : <p className="tile-empty">Opening</p>}
          </main>
        ) : (
          <Layout
            workspace={space}
            tiles={view.tiles}
            state={(t) =>
              tileState(
                link,
                rows.find((r) => r.id === t.id),
              )
            }
            asking={asked?.id ?? null}
            cursor={cursor}
            size={size}
            strips={size === null ? new Set() : fold(space, size)}
            open={(tile) => send({ type: "focus", tile: tile.id, cursor: tile.cursor })}
          >
            {(tile) => <TileBody run={props.run} tile={tile} windowFor={props.windowFor} />}
          </Layout>
        )}
      </div>
      <div className={prefix._tag === "idle" ? "statusbar" : "statusbar on"}>{said}</div>
    </>
  );
};

const Page = (props: PageProps) => {
  const [link, send] = useRuntime(props.run, pickLink);
  const [tiles] = useRuntime(props.run, pickTiles);
  const [client] = useRuntime(props.run, pickTezgah);
  const [dials] = useRuntime(props.run, (m) => m.dials);
  const [views] = useRuntime(props.run, (m) => m.client.views);
  const [trouble] = useRuntime(props.run, (m) => m.trouble);
  const [prefix] = useRuntime(props.run, pickPrefix);
  const [polite] = useRuntime(props.run, pickPolite);
  const [none] = useRuntime(props.run, pickNoTezgah);
  const [said] = useRuntime(props.run, (m) => m.said);
  useKeys(props.run, props.keys, send);
  const view = client === null ? null : optimisticState(client);
  const named = (id: string) => view?.tiles.find((t) => t.id === id);
  // The status messages of the current burst, as one line (0504): a refusal, or a tile whose process
  // ended. A refusal's words are those of the program its tile shows.
  const burst = spoken({ said, tiles }, (id) => {
    const program = named(id)?.program;
    return program === undefined ? null : props.windowFor(program);
  });
  const roomless = polite === null ? undefined : named(polite.tile);
  const words = [
    ...(none ? [NO_TEZGAH] : []),
    ...(burst === "" ? [] : [burst]),
    ...(prefix._tag === "armed" ? ["prefix"] : []),
    ...(roomless === undefined ? [] : [noRoom(roomless)]),
  ].join(" ");
  const asked = prefix._tag === "asking" ? named(prefix.tile) : undefined;
  const content =
    link._tag === "waiting_grant" ? (
      <Waiting code={link.code} fingerprint={link.fingerprint} origin={props.origin} />
    ) : link._tag === "removed" ? (
      <main className="screen">
        <h1>Removed</h1>
        <p>This window was removed</p>
        <p>Ask again to make a new key and wait for a new grant.</p>
        <Button variant="primary" onClick={() => send({ type: "ask_again", dial: dials + 1 })}>
          Ask again
        </Button>
      </main>
    ) : link._tag === "blocked" ? (
      <main className="screen">
        <h1>Blocked</h1>
        <p>The browser could not keep or use this window's key. {link.reason}</p>
      </main>
    ) : link._tag !== "online" && Object.keys(views).length === 0 ? (
      <main className="screen">
        <p>Connecting</p>
      </main>
    ) : (
      <div className="frame">
        <header className="topbar">
          <span role="status">
            {link._tag === "online" ? "Online" : "Connection lost. Retrying."}
            {trouble ? ` ${trouble}` : ""}
          </span>
        </header>
        <Desk {...props} />
      </div>
    );
  return (
    <>
      {content}
      <div className="sr-only" aria-live="polite" aria-atomic="true">
        {/* Each append is a new node under the burst's new id, so a reader hears the line again. */}
        {words === "" ? null : <span key={said.id}>{words}</span>}
      </div>
      <div className="sr-only" role="alert" aria-atomic="true">
        {asked === undefined ? "" : question(asked)}
      </div>
    </>
  );
};

/** Mounting twice cannot start another runtime. Both mounts read the supplied run. */
export const mount = Effect.fn("Window.mount")(function* (element: HTMLElement, props: PageProps) {
  return yield* Effect.acquireRelease(
    Effect.sync(() => {
      const root = createRoot(element);
      root.render(
        <StrictMode>
          <Page {...props} />
        </StrictMode>,
      );
      return root;
    }),
    (root) => Effect.sync(() => root.unmount()),
  );
});
