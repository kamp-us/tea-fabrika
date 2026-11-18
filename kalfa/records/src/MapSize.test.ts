// L6 and L7 of docs/plan/quests/rules-and-records-build-PLAN.md (slice 8), as the lead changed them after
// slice 6 dropped the byte limit: the map check is advice. Each tracked `AGENTS.md` it reads, the root and each
// `<folder>/AGENTS.md` one folder down (a symlink is skipped), with more than 200 lines is one `map` finding.
// The 200 is a constant of MapSize.ts, `maxLines`, cited to https://code.claude.com/docs/en/memory; it is
// not a setting.
//
// Assumed exports:
// - `Finding.ts`: the `map` case is `{ _tag: "map", path, lines, max }`.
// - `MapSize.ts`: `maxLines` (200) and `check(root: string)`: `Effect<ReadonlyArray<Finding>, E, Tracked |
//   FileSystem | Path>`, no limit argument. Lines are counted as `wc -l` counts a file that ends in a newline:
//   `text.split("\n")` without the empty piece after the last newline.
//
// Each run holds a root and up to three folder files with drawn line counts, and in every run the files the
// check must not read: a symlinked folder file, a file two folders down and a `CLAUDE.md`, all over 200 lines.
import { expect, it } from "@effect/vitest";
import { runsFor } from "@kampus/vitest";
import { Effect, Schema } from "effect";
import { Finding } from "./Finding.ts";
import * as MapSize from "./MapSize.ts";
import { fileLines, ROOT, world } from "./Records.test-support.ts";

const check = { arbitrary: { seed: 119120, runs: runsFor({ fast: 100, full: 300 }) } };

const FOLDERS = ["next/AGENTS.md", "kalfa/AGENTS.md", "docs/AGENTS.md"] as const;

const MOST = 600;

// A line count drawn anywhere from 0 to 600, or within 2 of 200, so the line between over and not over is
// crossed as often as any other.
const Count = Schema.Struct({
  near: Schema.Boolean,
  n: Schema.Int.check(Schema.isBetween({ minimum: 0, maximum: MOST })),
});

const countFrom = ({ near, n }: typeof Count.Type) => (near ? 200 + (n % 5) - 2 : n);

// Plant: compare with >= instead of >, or sum the root into each folder file.
it.effect.prop(
  "L6 a map finding comes for each AGENTS.md of the root and one folder down that has more than 200 lines, naming its path and its lines",
  {
    root: Count,
    folders: Schema.Array(Count).check(Schema.isBetweenLength(0, 3)),
    width: Schema.Int.check(Schema.isBetween({ minimum: 0, maximum: 300 })),
  },
  ({ root, folders, width }) =>
    Effect.gen(function* () {
      const counts = [
        { path: "AGENTS.md", lines: countFrom(root) },
        ...folders.map((each, i) => ({ path: FOLDERS[i]!, lines: countFrom(each) })),
      ];

      const files: Record<string, string | { text: string; symlink: true }> = {
        "CLAUDE.md": fileLines(MOST, width),
        "next/packages/deep/AGENTS.md": fileLines(MOST, width),
      };

      for (const { path, lines } of counts) {
        files[path] = fileLines(lines, width);
      }

      // A folder file that is a symlink is read once, where it points.
      files["tools/AGENTS.md"] = { text: fileLines(MOST, width), symlink: true };

      const all = yield* MapSize.check(ROOT).pipe(Effect.provide(world(ROOT, files)));
      const found = all.filter(Finding.guards.map);

      expect(found, "only map findings").toHaveLength(all.length);

      const expected = counts
        .filter(({ lines }) => lines > 200)
        .map(({ path, lines }) => ({ _tag: "map", path, lines, max: 200 }));

      const order = (a: { path: string }, b: { path: string }) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0);

      expect([...found].sort(order)).toEqual(expected.sort(order));
    }),
  check,
);

// Plant: set `maxLines` to 199.
it.effect(
  "L7 scenario: maxLines is 200, a 201-line AGENTS.md is one finding with max 200, and a 200-line one is none",
  () =>
    Effect.gen(function* () {
      expect(MapSize.maxLines).toBe(200);

      const over = yield* MapSize.check(ROOT).pipe(Effect.provide(world(ROOT, { "AGENTS.md": fileLines(201, 10) })));
      const at = yield* MapSize.check(ROOT).pipe(Effect.provide(world(ROOT, { "AGENTS.md": fileLines(200, 10) })));

      expect(over).toEqual([{ _tag: "map", path: "AGENTS.md", lines: 201, max: 200 }]);
      expect(at).toEqual([]);
    }),
);
