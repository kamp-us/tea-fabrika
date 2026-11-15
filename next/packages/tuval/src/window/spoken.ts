// next/: what the page's polite region says. It says the window's newest news, which the step that
// made it wrote into the Model, and never the standing state of the tiles: a tile that stays ended
// shows it in its own state slot (0504, WCAG 4.1.3).
import type { AnyTile, WindowRegistration } from "@kampus/libfabrika";
import type { WindowModel } from "@kampus/libfabrika/client/WindowMachine";
import type { ReactNode } from "react";

export type TileWindow = WindowRegistration<any, ReactNode, AnyTile>;

type Refusal = NonNullable<WindowModel["tiles"][number]["refusal"]>;

/** A refused letter in words, the tile's own or the frame's; unknown free text is never said. */
export const refusalFor = (registration: TileWindow | null, refusal: Refusal | null) => {
  if (refusal === null) {
    return null;
  }

  const reason = /^[a-z_]{1,40}$/.test(refusal.reason) ? refusal.reason : "";
  return registration?.refused?.(refusal.m, reason) ?? (reason === "" ? "Not done." : `Not done (${reason}).`);
};

/** The polite region's words: the newest news only, or nothing before the first. */
export const spoken = (
  m: Pick<WindowModel, "said" | "tiles">,
  windowFor: (name: string) => TileWindow | null,
): string => {
  const news = m.said.news;
  const tile = news === null ? undefined : m.tiles.find((t) => t.id === news.tile);

  if (news === null || tile === undefined) {
    return "";
  }

  return news._tag === "ended"
    ? `${tile.name} ended (${news.reason._tag})`
    : (refusalFor(windowFor(tile.name), news) ?? "");
};
