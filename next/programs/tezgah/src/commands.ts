// tezgah's commands, next/: the one table of default key rows for `fabrika/tezgah` (0267's one
// `commands` field; the keybindings note's K1). A window is handed these rows as a value, ships them
// to its backend with `Keys.ship` and loads them with `Keys.load`; no window reads a file for them.
// Each command carries its shell word for `fabsh` and its label for the palette, so losing a key
// never loses a command (0278). The keys are tmux's after the prefix, plus the keybindings note's
// pipe key and `-`.
import type * as Keys from "@kampus/libfabrika/client/Keys";

/** tezgah's default rows, in the order the palette lists them. F6 and Shift-F6 move focus as in
 *  0503; a browser tab on Windows or Linux is shipped them without F6, which Chrome keeps. A click
 *  or Tab into a tile is `tezgah.focus`, which no key row names. */
export const commands = [
  { does: "tezgah.split_right", keys: ["<prefix>%", "<prefix>|"], word: "split right", label: "Split right" },
  { does: "tezgah.split_down", keys: ['<prefix>"', "<prefix>-"], word: "split down", label: "Split down" },
  { does: "tezgah.close", keys: ["<prefix>x"], word: "close", label: "Close tile" },
  { does: "tezgah.focus_next", keys: ["<prefix>o", "f6"], word: "focus next", label: "Focus next tile" },
  { does: "tezgah.focus_previous", keys: ["shift+f6"], word: "focus previous", label: "Focus previous tile" },
  { does: "tezgah.focus_last", keys: ["<prefix>;"], word: "focus last", label: "Focus last tile" },
  { does: "tezgah.focus_left", keys: ["<prefix>h", "<prefix>arrowleft"], word: "focus left", label: "Focus tile left" },
  {
    does: "tezgah.focus_right",
    keys: ["<prefix>l", "<prefix>arrowright"],
    word: "focus right",
    label: "Focus tile right",
  },
  { does: "tezgah.focus_up", keys: ["<prefix>k", "<prefix>arrowup"], word: "focus up", label: "Focus tile up" },
  { does: "tezgah.focus_down", keys: ["<prefix>j", "<prefix>arrowdown"], word: "focus down", label: "Focus tile down" },
] as const satisfies ReadonlyArray<Keys.Binding>;
