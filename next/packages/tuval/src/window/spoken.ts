// next/: what the page's polite region says. It says the status messages of the window's current
// burst, which the steps that made them wrote into the Model, joined into one line (0504, WCAG
// 4.1.3), and never the standing state of the tiles: a tile that stays ended shows it in its own
// state slot. An end is said in the tile guideline's words, `tracker in t2 ended`, as written (0543):
// the program and the handle come from `tileWords`, the source the tile's own name reads, and the
// exit reason stays in the title bar. The machine writes an end only for a tile without focus.
import type { AnyTile, WindowRegistration } from "@kampus/libfabrika";
import type { WindowModel } from "@kampus/libfabrika/client/WindowMachine";
import type { Tile } from "@kampus/libfabrika/tezgah/Workspace";
import { Function } from "effect";
import type { ReactNode } from "react";
import { tileWords } from "./Layout.tsx";

export type TileWindow = WindowRegistration<any, ReactNode, AnyTile>;

type Refusal = NonNullable<WindowModel["tiles"][number]["refusal"]>;
type StatusMessage = WindowModel["said"]["messages"][number];

/** The desk tile a status message names, as much of it as the words need. */
type Named = Pick<Tile, "program" | "n">;

/** A refused letter in words, the tile's own or the frame's; unknown free text is never said. */
export const refusalFor: {
  (refusal: Refusal | null): (registration: TileWindow | null) => string | null;
  (registration: TileWindow | null, refusal: Refusal | null): string | null;
} = Function.dual(2, (registration: TileWindow | null, refusal: Refusal | null): string | null => {
  if (refusal === null) {
    return null;
  }

  const reason = /^[a-z_]{1,40}$/.test(refusal.reason) ? refusal.reason : "";
  return registration?.refused?.(refusal.m, reason) ?? (reason === "" ? "Not done." : `Not done (${reason}).`);
});

/** One status message in words, or null when its tile is gone. `lookup` finds the desk tile by its
 *  id, and `windowFor` the window registered for the program that tile shows. */
const wordsFor = <T extends Named>(
  message: StatusMessage,
  lookup: (id: string) => T | null,
  windowFor: (tile: T) => TileWindow | null,
): string | null => {
  const tile = lookup(message.tile);

  if (tile === null) {
    return null;
  }

  const { program, handle } = tileWords(tile);
  return message._tag === "ended" ? `${program} in ${handle} ended` : refusalFor(windowFor(tile), message);
};

/** The polite region's words: the current burst's status messages, in order, as one line. */
export const spoken: {
  <T extends Named>(
    lookup: (id: string) => T | null,
    windowFor: (tile: T) => TileWindow | null,
  ): (m: Pick<WindowModel, "said">) => string;
  <T extends Named>(
    m: Pick<WindowModel, "said">,
    lookup: (id: string) => T | null,
    windowFor: (tile: T) => TileWindow | null,
  ): string;
} = Function.dual(
  3,
  <T extends Named>(
    m: Pick<WindowModel, "said">,
    lookup: (id: string) => T | null,
    windowFor: (tile: T) => TileWindow | null,
  ): string => m.said.messages.flatMap((message) => wordsFor(message, lookup, windowFor) ?? []).join(", "),
);
