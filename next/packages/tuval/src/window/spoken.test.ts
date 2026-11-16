// next/: the polite region's words. The window machine writes each status message into its Model in the
// step its event happened in (WindowMachine.laws.test.ts, S8), and an end only for a tile that has no
// focus then (S9, where focus is known); this holds that the page says exactly the current burst as
// one line, whatever the tiles show, so a tile that stays ended is never said again. An end is said in
// the tile guideline's words (docs/direction/tile-guidelines.md, "What a screen reader is told",
// 0543): `tracker in t2 ended`, the program's own name and the tile's short handle, the same two the
// tile's own name gives, and no exit reason, which the guideline did not study.
import { describe, expect, it } from "@effect/vitest";
import { WindowModel } from "@kampus/libfabrika/client/WindowMachine";
import * as Arbitrary from "effect/Arbitrary";
import * as Schema from "effect/Schema";
import * as Arr from "effect/Array";
import * as Function from "effect/Function";
import * as Option from "effect/Option";
import { String as Str } from "effect";
import { spoken } from "./spoken.ts";

const SEED = 119120;

// The programs' own names, none inside another, and none a reason's tag.
const NAMES = ["alpha", "bravo", "charlie", "delta", "echo"] as const;

const PACKS = ["fabrika", "acme", "x"] as const;

const Tiles = WindowModel.fields.tiles.check(Schema.isMinLength(1), Schema.isMaxLength(NAMES.length));

const Said = WindowModel.fields.said;

const Pick = Schema.Int.check(Schema.isGreaterThanOrEqualTo(0));

/**
 * The generated window rows under distinct ids and process names, each message on one of them, and
 * the desk tile each row draws: its program after a pack, and its number, which `pick` moves off the
 * row's place so a handle has one or more digits.
 */
const page = (tiles: typeof Tiles.Type, said: typeof Said.Type, pick: number) => {
  const rows = Arr.map(tiles, (t, i) => ({ ...t, id: `tile_${i + 1}`, name: `${NAMES[i]!}:1` }));
  const desk = Arr.map(rows, (t, i) => ({
    id: t.id,
    program: `${PACKS[(pick + i) % PACKS.length]!}/${NAMES[i]!}`,
    n: i + 1 + (pick % 40),
  }));
  const messages = Arr.map(said.messages, (x, i) => ({ ...x, tile: rows[(pick + i) % rows.length]!.id }));
  return { m: { tiles: rows, said: { ...said, messages } }, desk };
};

type Page = ReturnType<typeof page>;

type DeskTile = Page["desk"][number];

const lookup =
  (p: Page) =>
  (id: string): DeskTile | null =>
    Option.getOrElse(
      Arr.findFirst(p.desk, (t) => t.id === id),
      () => null,
    );

/** What the test expects an end to be said as: the guideline's words, written out here by hand. */
const endLine = (t: DeskTile) =>
  `${Option.match(Str.indexOf("/")(t.program), { onNone: () => t.program, onSome: (at) => Str.slice(at + 1)(t.program) })} in t${t.n} ended`;

describe("the polite region says the current burst as one line", () => {
  it.prop(
    "property: the region's text is the joined line of exactly the current status messages, in order: an end is the tile guideline's `<program> in t<n> ended`, with no exit reason; a refusal says the frame's words and names no tile; it names no other tile, ended or not, and it is empty when the list is",
    { tiles: Arbitrary.schema(Tiles), said: Arbitrary.schema(Said), pick: Arbitrary.schema(Pick) },
    ({ tiles, said, pick }) => {
      const p = page(tiles, said, pick);
      const words = spoken(p.m, lookup(p), () => null);
      const ends = new Set(
        Function.pipe(
          p.m.said.messages,
          Arr.filter((x) => x._tag === "ended"),
          Arr.map((x) => x.tile),
        ),
      );

      for (const t of Arr.filter(p.desk, (t) => !ends.has(t.id))) {
        expect(Str.includes(endLine(t))(words), `${endLine(t)} was said, and no end of it is in the burst`).toBe(false);
      }

      if (p.m.said.messages.length === 0) {
        expect(words, "an empty burst, and the region said something").toBe("");

        return true;
      }

      // Each message's own words, as the region says it alone, appear in order, one line.
      const parts = Arr.map(p.m.said.messages, (x) =>
        spoken({ ...p.m, said: { id: p.m.said.id, messages: [x] } }, lookup(p), () => null),
      );
      expect(words, "the burst as one line, in order").toBe(Arr.join(parts, ", "));
      expect(Str.includes("\n")(words), "the burst is one line").toBe(false);

      for (const [x, part] of Arr.map(p.m.said.messages, (x, i) => [x, parts[i]!] as const)) {
        const tile = lookup(p)(x.tile)!;

        if (x._tag === "ended") {
          expect(part, "an end is said in the tile guideline's words").toBe(endLine(tile));
          expect(Str.includes(x.reason._tag)(part) || Str.includes("(")(part), "an end says no exit reason").toBe(
            false,
          );
        } else {
          expect(
            part !== "" && !Str.includes(` in t${tile.n} `)(part),
            "a refusal's words are the frame's, with no tile name",
          ).toBe(true);
        }
      }

      return true;
    },
    { arbitrary: { seed: SEED, runs: 300, size: 30 } },
  );

  it.prop(
    "property: some generated pages hold bursts of two or more, ends of more than one reason, handles of two digits, and an ended tile no message names, so the law above can see each",
    { list: Arbitrary.array(Arbitrary.schema(Schema.Tuple([Tiles, Said, Pick])), { minLength: 30, maxLength: 30 }) },
    ({ list }) => {
      const pages = Arr.map(list, ([tiles, said, pick]) => page(tiles, said, pick));
      const ends = Arr.flatMap(pages, (p) => Arr.filter(p.m.said.messages, (x) => x._tag === "ended"));
      expect(Arr.some(pages, (p) => p.m.said.messages.length >= 2)).toBe(true);
      expect(new Set(Arr.map(ends, (x) => x.reason._tag)).size, "ends of more than one reason").toBeGreaterThan(1);
      expect(Arr.some(pages, (p) => Arr.some(p.desk, (t) => t.n >= 10))).toBe(true);
      expect(
        Arr.some(pages, (p) =>
          Arr.some(p.m.tiles, (t) => t.reach._tag === "ended" && !Arr.some(p.m.said.messages, (x) => x.tile === t.id)),
        ),
      ).toBe(true);

      return true;
    },
    { arbitrary: { seed: SEED, runs: 3, size: 30 } },
  );
});
