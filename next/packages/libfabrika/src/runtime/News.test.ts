// Ticket 1053 slice 1, next/: L1 of the plan (docs/plan/quests/t1053-PLAN.md), written before the
// build. What a client's socket is told is one Schema, `News`, and the view update inside it is
// `Published`: an `Update` with the pid of the process it came from.
//
// The contract this law pins, in runtime/News.ts:
//   `Update`    the Schema of a view update, `whole` or `patch`, told apart by `type`
//   `Published` the Schema of an `Update` with its `pid`
//   `News`      `Schema.TaggedUnion` of `close` ({ code }), `granted` ({ nonce }), `view` ({ update })
//
// Generator contract: every run draws one value of each `News` case from the case's own Schema, and
// one `Published` of each `type`, so no case can go unreached. `news`, `published` and `update` are
// drawn from the whole Schemas beside them.
import { expect, it } from "@effect/vitest";
import { Arbitrary, Effect, Schema } from "effect";
import { News, Published, Update } from "./News.ts";

const published = Arbitrary.schema(Published);

/** What a Schema decodes from what it encoded. */
const again = <S extends Schema.Codec<unknown, unknown>>(schema: S, value: S["Type"]) =>
  Schema.encodeEffect(schema)(value).pipe(Effect.flatMap(Schema.decodeUnknownEffect(schema)));

// Plant: drop the `pid` from the `view` case's update (the case holds `Update`).
it.effect.prop(
  "L1: News, Published and Update each decode what they encode to the value they were given, a view's update keeps its pid, and a Published is its Update with a pid",
  {
    close: News.cases.close,
    granted: News.cases.granted,
    whole: published.pipe(Arbitrary.filter((u) => u.type === "whole")),
    patch: published.pipe(Arbitrary.filter((u) => u.type === "patch")),
    news: News,
    published,
    update: Update,
    pid: Schema.String,
  },
  ({ close, granted, whole, patch, news, published, update, pid }) =>
    Effect.gen(function* () {
      for (const told of [close, granted, news]) {
        expect(yield* again(News, told), "News decodes what it encodes").toEqual(told);
      }

      for (const one of [whole, patch]) {
        const back = yield* again(News, News.cases.view.make({ update: one }));
        expect(News.guards.view(back), "a view stays a view").toBe(true);
        expect(back, "a view's update keeps its pid and every field").toEqual(News.cases.view.make({ update: one }));
        expect(
          News.match(back, { close: () => [], granted: () => [], view: ({ update }) => Object.keys(update) }),
          "the update that came back holds a pid",
        ).toContain("pid");
      }

      for (const one of [whole, patch, published]) {
        expect(yield* again(Published, one), "Published decodes what it encodes").toEqual(one);
        expect(Object.hasOwn(yield* again(Published, one), "pid"), "a Published holds a pid").toBe(true);
        // The same value read as an Update is the update alone.
        const { pid: _, ...alone } = one;
        expect(yield* Schema.decodeUnknownEffect(Update)(one), "a Published read as an Update").toEqual(alone);
      }

      expect(yield* again(Update, update), "Update decodes what it encodes").toEqual(update);
      expect(
        yield* Schema.decodeUnknownEffect(Published)({ ...update, pid }),
        "an Update with a pid is a Published",
      ).toEqual({ ...update, pid });
    }),
  { arbitrary: { seed: 119120, runs: 100 } },
);
