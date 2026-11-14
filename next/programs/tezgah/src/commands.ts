// tezgah's commands, next/: the one table of default key rows for `fabrika/tezgah` (0267's one
// `commands` field; the keybindings note's K1). A window is handed these rows as a value, ships them
// to its backend with `Keys.ship` and loads them with `Keys.load`; no window reads a file for them.
// Each command carries its shell word for `fabsh` and its label for the palette, so losing a key
// never loses a command (0278). The keys are tmux's after the prefix, plus the keybindings note's
// pipe key and `-`.
import type { Binding } from "@kampus/libfabrika";

/** tezgah's default rows, in the order the palette lists them. Focus moves join in the next slice. */
export const commands = [
  { does: "tezgah.split_right", keys: ["<prefix>%", "<prefix>|"], word: "split right", label: "Split right" },
  { does: "tezgah.split_down", keys: ['<prefix>"', "<prefix>-"], word: "split down", label: "Split down" },
  { does: "tezgah.close", keys: ["<prefix>x"], word: "close", label: "Close tile" },
] as const satisfies ReadonlyArray<Binding>;
