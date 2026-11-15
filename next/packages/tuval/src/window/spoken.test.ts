// next/: the polite region's words. The window machine writes the newest news into its Model in the
// step its event happened in (WindowMachine.laws.test.ts, S8); this holds that the page says only that
// news, whatever the tiles show, so a tile that stays ended is never said again by a later change.
import { describe, expect, it } from "@effect/vitest";
import { WindowModel } from "@kampus/libfabrika/client/WindowMachine";
import { Arbitrary, Schema } from "effect";
import { spoken } from "./spoken.ts";

const SEED = 119120;
const NAMES = ["alpha:1", "bravo:1", "charlie:1", "delta:1", "echo:1"] as const;

const Tiles = WindowModel.fields.tiles.check(Schema.isMinLength(1), Schema.isMaxLength(NAMES.length));
const Said = WindowModel.fields.said;
const Pick = Schema.Int.check(Schema.isGreaterThanOrEqualTo(0));

/** The generated tiles under distinct names, none inside another, and the news on one of them. */
const page = (tiles: typeof Tiles.Type, said: typeof Said.Type, pick: number) => {
  const named = tiles.map((t, i) => ({ ...t, id: `tile_${i + 1}`, name: NAMES[i]! }));
  const on = named[pick % named.length]!.id;
  return { tiles: named, said: { ...said, news: said.news === null ? null : { ...said.news, tile: on } } };
};

describe("the polite region says the newest news only", () => {
  it.prop(
    "property: an ended news names its tile and its reason, a refusal says its words and names no tile, no news says nothing, and no other tile is named, ended or not",
    { tiles: Arbitrary.schema(Tiles), said: Arbitrary.schema(Said), pick: Arbitrary.schema(Pick) },
    ({ tiles, said, pick }) => {
      const m = page(tiles, said, pick);
      const words = spoken(m, () => null);
      const news = m.said.news;
      const own = m.tiles.find((t) => t.id === news?.tile);
      const others = m.tiles.filter((t) => t !== own);

      for (const t of others) {
        expect(words.includes(t.name), `${t.name} (${t.reach._tag}) was said, and it is not the news`).toBe(false);
      }

      if (news === null) {
        expect(words, "no news, and the region said something").toBe("");
      } else if (news._tag === "ended") {
        expect(words.includes(own!.name), "the ended tile's name").toBe(true);
        expect(words.includes(`(${news.reason._tag})`), "the ended tile's reason").toBe(true);
      } else {
        expect(words, "a refusal says words").not.toBe("");
        expect(words.includes(own!.name), "a refusal's words are the frame's, with no tile name").toBe(false);
      }

      return true;
    },
    { arbitrary: { seed: SEED, runs: 300, size: 30 } },
  );

  it.prop(
    "property: some generated pages hold an ended tile that is not the news, so the law above can see it said",
    { list: Arbitrary.array(Arbitrary.schema(Schema.Tuple([Tiles, Said, Pick])), { minLength: 30, maxLength: 30 }) },
    ({ list }) => {
      const quiet = list.some(([tiles, said, pick]) => {
        const m = page(tiles, said, pick);
        return m.tiles.some((t) => t.reach._tag === "ended" && t.id !== m.said.news?.tile);
      });
      expect(quiet).toBe(true);
      return true;
    },
    { arbitrary: { seed: SEED, runs: 3, size: 30 } },
  );
});
