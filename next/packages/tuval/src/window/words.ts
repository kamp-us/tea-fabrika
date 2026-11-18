// next/: the words a tile shows in place of color (0502), in its title bar's state slot and in its
// body. The body follows the tile guideline's empty state: one word where the content will start, no
// spinner, no skeleton. A tile whose process ended follows that rule too, so it never keeps drawing
// the ended process's last view (docs/direction/tile-guidelines.md, "Empty and loading", and its
// "Tuval" line on a tile kept after a crash).
import type { WindowModel } from "@kampus/libfabrika/client/WindowMachine";

type Link = WindowModel["link"];

type Reach = WindowModel["tiles"][number]["reach"];

/** A tile's state in words, never color alone (0502): an ended tile names its exit's reason, and a
 *  tile with no reach yet, one the window has no row for, is opening. */
export const stateWord = (link: Link, reach: Reach | undefined) => {
  if (link._tag !== "online") {
    return link._tag === "retrying" ? "Retrying" : "Connecting";
  }

  switch (reach?._tag) {
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

/**
 * The one word a tile's body shows where its view will start, or null when it draws the view.
 * `drawn` says whether a view is there to draw. An ended tile shows its word even then: the view is
 * the ended process's last one, and the title bar's state slot says why it ended. A tile with no
 * reach yet is opening.
 */
export const bodyWord = (reach: Reach | undefined, drawn: boolean): string | null => {
  switch (reach?._tag) {
    case "ended":
      return "Ended";
    case "missing":
      return drawn ? null : "Missing";
    default:
      return drawn ? null : "Opening";
  }
};
