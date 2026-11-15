// next/: what the page's polite region says. It says the status messages of the window's current
// burst, which the steps that made them wrote into the Model, joined into one line (0504, WCAG
// 4.1.3), and never the standing state of the tiles: a tile that stays ended shows it in its own
// state slot.
import type { AnyTile, WindowRegistration } from "@kampus/libfabrika";
import type { WindowModel } from "@kampus/libfabrika/client/WindowMachine";
import type { ReactNode } from "react";

export type TileWindow = WindowRegistration<any, ReactNode, AnyTile>;

type Refusal = NonNullable<WindowModel["tiles"][number]["refusal"]>;
type StatusMessage = WindowModel["said"]["messages"][number];

/** A refused letter in words, the tile's own or the frame's; unknown free text is never said. */
export const refusalFor = (registration: TileWindow | null, refusal: Refusal | null) => {
  if (refusal === null) {
    return null;
  }

  const reason = /^[a-z_]{1,40}$/.test(refusal.reason) ? refusal.reason : "";
  return registration?.refused?.(refusal.m, reason) ?? (reason === "" ? "Not done." : `Not done (${reason}).`);
};

/** One status message in words, or null when its tile is gone. */
const wordsFor = (
  m: Pick<WindowModel, "tiles">,
  message: StatusMessage,
  windowFor: (name: string) => TileWindow | null,
): string | null => {
  const tile = m.tiles.find((t) => t.id === message.tile);

  if (tile === undefined) {
    return null;
  }

  return message._tag === "ended"
    ? `${tile.name} ended (${message.reason._tag})`
    : refusalFor(windowFor(tile.name), message);
};

/** The polite region's words: the current burst's status messages, in order, as one line. */
export const spoken = (
  m: Pick<WindowModel, "said" | "tiles">,
  windowFor: (name: string) => TileWindow | null,
): string => m.said.messages.flatMap((message) => wordsFor(m, message, windowFor) ?? []).join(", ");
