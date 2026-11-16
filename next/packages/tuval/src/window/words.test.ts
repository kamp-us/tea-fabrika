// next/: the words a tile shows. The tile guideline's empty state (docs/direction/tile-guidelines.md,
// "Empty and loading") is one word where the content will start, and a tile whose process ended
// follows it, so its body never keeps drawing the ended process's last view; the title bar's state
// slot keeps the reason (0502). The page draws `bodyWord` in place of the view whenever it is not null.
import { describe, expect, it } from "@effect/vitest";
import { WindowModel } from "@kampus/libfabrika/client/WindowMachine";
import { Arbitrary, Schema } from "effect";
import * as Arr from "effect/Array";
import { bodyWord, stateWord } from "./words.ts";

const SEED = 119120;

const Reach = WindowModel.fields.tiles.value.fields.reach;
const Link = WindowModel.fields.link;

describe("an ended tile shows one word where its view was", () => {
  it.prop(
    "property: an ended tile's body is one word, whether or not a last view is there to draw, while its online title bar names the exit's reason; an open tile with a view draws it",
    { reach: Arbitrary.schema(Reach), link: Arbitrary.schema(Link), drawn: Arbitrary.schema(Schema.Boolean) },
    ({ reach, link, drawn }) => {
      const word = bodyWord(reach, drawn);
      const ended = reach._tag === "ended";

      expect(!ended || word !== null, "an ended tile drew its last view").toBe(true);
      expect(
        !ended || /^\S+$/.test(word ?? ""),
        `the ended tile's body says one word, not ${JSON.stringify(word)}`,
      ).toBe(true);
      expect(!ended || bodyWord(reach, !drawn) === word, "the body's word hangs on whether a last view is there").toBe(
        true,
      );
      expect(
        reach._tag !== "ended" || link._tag !== "online" || stateWord(link, reach).includes(reach.reason._tag),
        "the online state slot of an ended tile names the reason",
      ).toBe(true);
      expect(reach._tag !== "open" || !drawn || word === null, "an open tile's view was hidden").toBe(true);
      expect(drawn || word !== null, "a tile with no view to draw left its body blank").toBe(true);

      return true;
    },
    { arbitrary: { seed: SEED, runs: 300, size: 30 } },
  );

  it.prop(
    "property: the generated tiles hold ended tiles with and without a last view, so the law above can see both",
    {
      list: Arbitrary.array(Arbitrary.schema(Schema.Tuple([Reach, Schema.Boolean])), {
        minLength: 60,
        maxLength: 60,
      }),
    },
    ({ list }) => {
      expect(Arr.some(list, ([reach, drawn]) => reach._tag === "ended" && drawn)).toBe(true);
      expect(Arr.some(list, ([reach, drawn]) => reach._tag === "ended" && !drawn)).toBe(true);
      return true;
    },
    { arbitrary: { seed: SEED, runs: 3, size: 30 } },
  );
});
