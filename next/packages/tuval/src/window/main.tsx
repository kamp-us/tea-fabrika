// next/: the page draws the library's window client. React only reads and sends Msgs; the run, its
// socket and its timers belong to the scope the caller started it in.
import type { EffectRun } from "@demlik/tea/effect";
import { useRuntime } from "@demlik/tea/react";
import type { WindowModel, WindowMsg } from "@kampus/libfabrika/client/WindowMachine";
import { Button, useClipboard } from "@manti-ui/react";
import { Effect, Option, Schema } from "effect";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { refusalFor, spoken, type TileWindow } from "./spoken.ts";

type LiveWindow = EffectRun<WindowModel, WindowMsg>;

type PageProps = {
  readonly run: LiveWindow;
  readonly origin: string;
  readonly windowFor: (name: string) => TileWindow | null;
};

const pickLink = (m: WindowModel) => m.link;
const pickTiles = (m: WindowModel) => m.tiles;

type Reach = WindowModel["tiles"][number]["reach"];

/** A tile's state in words, never color alone (0502): an ended tile names its exit's reason. */
const stateWord = (link: WindowModel["link"], reach: Reach) => {
  if (link._tag !== "online") {
    return link._tag === "retrying" ? "Retrying" : "Connecting";
  }

  switch (reach._tag) {
    case "open":
      return "Online";
    case "ended":
      return `Ended (${reach.reason._tag})`;
    case "missing":
      return "Missing";
    default:
      return "Opening";
  }
};

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

const Tile = ({
  run,
  id,
  windowFor,
}: {
  readonly run: LiveWindow;
  readonly id: string;
  readonly windowFor: PageProps["windowFor"];
}) => {
  const [tile, send] = useRuntime(run, (m) => m.tiles.find((t) => t.id === id));
  const [shown] = useRuntime(run, (m) => {
    const t = m.tiles.find((t) => t.id === id);
    return t?.last ? m.client.views[t.last] : undefined;
  });
  const [link] = useRuntime(run, pickLink);

  if (tile === undefined) {
    return null;
  }

  const registration = windowFor(tile.name);
  const data =
    registration && shown ? Option.getOrNull(Schema.decodeUnknownOption(registration.data)(shown.view)) : null;
  const offline = link._tag !== "online";
  const state = stateWord(link, tile.reach);
  const refusal = refusalFor(registration, tile.refusal);
  return (
    <section
      className={offline ? "tile disconnected" : "tile"}
      aria-label={tile.name}
      inert={offline || tile.reach._tag !== "open"}
    >
      <header className="titlebar">
        <span className="tile-mark" aria-hidden="true">
          ·
        </span>
        <span className="tile-name">{tile.name}</span>
        <span className="tile-state">{state}</span>
        <span className="tile-id">{tile.id}</span>
      </header>
      <div className="slot">
        {registration === null || data === null ? (
          <p>{tile.reach._tag === "missing" || tile.reach._tag === "ended" ? state : "Opening"}</p>
        ) : (
          <registration.View
            data={data}
            tile={tile.own}
            press={(m) => send({ type: "press", tile: tile.id, m, via: "button" })}
            send={(msg) => send({ type: "tile", id: tile.id, msg })}
            refusal={refusal}
          />
        )}
      </div>
    </section>
  );
};

const Page = (props: PageProps) => {
  const [link, send] = useRuntime(props.run, pickLink);
  const [tiles] = useRuntime(props.run, pickTiles);
  const [dials] = useRuntime(props.run, (m) => m.dials);
  const [views] = useRuntime(props.run, (m) => m.client.views);
  const [trouble] = useRuntime(props.run, (m) => m.trouble);
  const [said] = useRuntime(props.run, (m) => m.said);
  // The polite region says the status messages of one burst as one line (0504): a refusal, or a tile
  // whose process ended. Each append is a new node under the new id, so a reader hears the line again.
  const words = spoken({ said, tiles }, props.windowFor);
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
        <main className="desk">
          {tiles.map((tile) => (
            <Tile key={tile.id} run={props.run} id={tile.id} windowFor={props.windowFor} />
          ))}
        </main>
      </div>
    );
  return (
    <>
      {content}
      <div className="sr-only" aria-live="polite" aria-atomic="true">
        {words === "" ? null : <span key={said.id}>{words}</span>}
      </div>
      <div className="sr-only" role="alert" aria-atomic="true" />
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
