import { checklist } from "@kampus/checklist";
import { checklistWindow } from "@kampus/checklist/window";
import * as Keys from "@kampus/libfabrika/client/Keys";
import { windowMachineFor } from "@kampus/libfabrika/client/WindowMachine";
import { commands } from "@kampus/tezgah/commands";
import { Result, Schema } from "effect";

/** The workspace of the person's tezgah a tab draws. */
export const tezgah = { workspace: 1 } as const;

/** The window registered for a program: a tile's window is found by the program it shows. */
export const windowFor = (program: string) => (program === checklist.name ? checklistWindow : null);

/** A tab runs on a browser; the hello says no more of its OS, so it keeps every key either could. */
const backend = Keys.backend("browser", "unknown");

/** tezgah's commands, shipped to a tab and loaded: the window's one key table. Shipped defaults
 *  always load (L19), so a failure here is a broken build and stops the page loudly. */
export const keys = Result.getOrThrowWith(
  Keys.load(Keys.ship(commands, backend), backend),
  (failure) => new Error(`tezgah's default keys do not load in a tab: ${JSON.stringify(failure)}`),
);

// Every tile this build draws shows a checklist, the program a new tile starts (tezgah's NEW_TILE).
export const window = windowMachineFor<typeof checklist>({
  decode: () => Schema.decodeUnknownSync(checklistWindow.data),
  tile: () => checklistWindow.tile,
  keys,
});
