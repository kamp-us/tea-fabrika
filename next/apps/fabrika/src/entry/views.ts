import { checklist } from "@kampus/checklist";
import { checklistWindow } from "@kampus/checklist/window";
import { counter } from "@kampus/counter";
import { counterWindow } from "@kampus/counter/window";
import { fabsh } from "@kampus/fabsh";
import { fabshWindow } from "@kampus/fabsh/window";
import * as Keys from "@kampus/libfabrika/client/Keys";
import { windowMachineFor } from "@kampus/libfabrika/client/WindowMachine";
import { commands } from "@kampus/tezgah/commands";
import { Result, Schema } from "effect";

/** The workspace of the person's tezgah a tab draws. */
export const tezgah = { workspace: 1 } as const;

/** Each program a tile may show, with its own package's window: every program of the build but
 *  tezgah, which is the frame. `tezgah.new` may name any of them, so each needs its window. */
const WINDOWS = {
  [checklist.name]: checklistWindow,
  [counter.name]: counterWindow,
  [fabsh.name]: fabshWindow,
};

/** The window registered for a program: a tile's window is found by the program it shows. */
export const windowFor = (program: string) => (Object.hasOwn(WINDOWS, program) ? (WINDOWS[program] ?? null) : null);

/** A tab runs on a browser; the hello says no more of its OS, so it keeps every key either could. */
const backend = Keys.backend("browser", "unknown");

/** tezgah's commands, shipped to a tab and loaded: the window's one key table. Shipped defaults
 *  always load (L19), so a failure here is a broken build and stops the page loudly. */
export const keys = Result.getOrThrowWith(
  Keys.load(Keys.ship(commands, backend), backend),
  (failure) => new Error(`tezgah's default keys do not load in a tab: ${JSON.stringify(failure)}`),
);

// A tab's tiles come from tezgah, whose view names each tile's program: its decoder and its tile
// machine are that program's window's. A view with no program, or one the build lacks, decodes as
// nothing, so no other window's decoder ever takes it.
export const window = windowMachineFor({
  decode: (_pid, program) => Schema.decodeUnknownSync(windowFor(program ?? "")?.data ?? Schema.Never),
  tile: (_name, program) => windowFor(program ?? "")?.tile,
  keys,
});
