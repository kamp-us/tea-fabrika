// next/: the polite region's words. The window machine writes each status message into its Model in the
// step its event happened in (WindowMachine.laws.test.ts, S8); this holds that the page says exactly
// the current burst as one line, whatever the tiles show, so a tile that stays ended is never said again.
import { describe, expect, it } from "@effect/vitest";
import { WindowModel } from "@kampus/libfabrika/client/WindowMachine";
import { Arbitrary, Schema } from "effect";
import { spoken } from "./spoken.ts";

const SEED = 119120;
const NAMES = ["alpha:1", "bravo:1", "charlie:1", "delta:1", "echo:1"] as const;

const Tiles = WindowModel.fields.tiles.check(Schema.isMinLength(1), Schema.isMaxLength(NAMES.length));
const Said = WindowModel.fields.said;
const Pick = Schema.Int.check(Schema.isGreaterThanOrEqualTo(0));

/** The generated tiles under distinct names, none inside another, and each message on one of them. */
const page = (tiles: typeof Tiles.Type, said: typeof Said.Type, pick: number) => {
  const named = tiles.map((t, i) => ({ ...t, id: `tile_${i + 1}`, name: NAMES[i]! }));
  const messages = said.messages.map((x, i) => ({ ...x, tile: named[(pick + i) % named.length]!.id }));
  return { tiles: named, said: { ...said, messages } };
};

describe("the polite region says the current burst as one line", () => {
  it.prop(
    "property: the region's text is the joined line of exactly the current status messages, in order: an end names its tile and its reason, a refusal says the frame's words and names no tile; it names no other tile, ended or not, and it is empty when the list is",
    { tiles: Arbitrary.schema(Tiles), said: Arbitrary.schema(Said), pick: Arbitrary.schema(Pick) },
    ({ tiles, said, pick }) => {
      const m = page(tiles, said, pick);
      const words = spoken(m, () => null);
      const ends = new Set(m.said.messages.filter((x) => x._tag === "ended").map((x) => x.tile));

      for (const t of m.tiles.filter((t) => !ends.has(t.id))) {
        expect(words.includes(t.name), `${t.name} (${t.reach._tag}) was said, and no end of it is in the burst`).toBe(
          false,
        );
      }

      if (m.said.messages.length === 0) {
        expect(words, "an empty burst, and the region said something").toBe("");
        return true;
      }

      // Each message's own words, as the region says it alone, appear in order, one line.
      const parts = m.said.messages.map((x) =>
        spoken({ tiles: m.tiles, said: { id: m.said.id, messages: [x] } }, () => null),
      );
      expect(words, "the burst as one line, in order").toBe(parts.join(", "));
      expect(words.includes("\n"), "the burst is one line").toBe(false);

      for (const [x, part] of m.said.messages.map((x, i) => [x, parts[i]!] as const)) {
        const tile = m.tiles.find((t) => t.id === x.tile)!;

        if (x._tag === "ended") {
          expect(part.includes(tile.name) && part.includes(`(${x.reason._tag})`), "an end's tile and reason").toBe(
            true,
          );
          // The tile guideline's words for an end, `tracker in t2 ended`, name the tile's id too.
          expect(part.includes(` in ${tile.id} `), "an end names the tile's id").toBe(true);
        } else {
          expect(part !== "" && !part.includes(tile.name), "a refusal's words are the frame's, with no tile name").toBe(
            true,
          );
        }
      }

      return true;
    },
    { arbitrary: { seed: SEED, runs: 300, size: 30 } },
  );

  it.prop(
    "property: some generated pages hold bursts of two or more and an ended tile no message names, so the law above can see both",
    { list: Arbitrary.array(Arbitrary.schema(Schema.Tuple([Tiles, Said, Pick])), { minLength: 30, maxLength: 30 }) },
    ({ list }) => {
      const pages = list.map(([tiles, said, pick]) => page(tiles, said, pick));
      expect(pages.some((m) => m.said.messages.length >= 2)).toBe(true);
      expect(
        pages.some((m) =>
          m.tiles.some((t) => t.reach._tag === "ended" && !m.said.messages.some((x) => x.tile === t.id)),
        ),
      ).toBe(true);
      return true;
    },
    { arbitrary: { seed: SEED, runs: 3, size: 30 } },
  );
});
