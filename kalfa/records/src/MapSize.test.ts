// L6 of docs/plan/quests/rules-and-records-build-PLAN.md (slice 8, 0608): the map fits its readers' limit. An
// agent reads the root `AGENTS.md`, then the folder's: a finding comes when the root alone, or the root
// plus one folder's `AGENTS.md`, is over the limit, and names that chain and its bytes.
//
// Assumed export, `MapSize.ts`: `check(root: string, max: number)`: `Effect<ReadonlyArray<Finding>, E,
// Tracked | FileSystem | Path>`; a finding is `{ _tag: "map", chain, bytes, max }`, `chain` the repo-relative
// paths in reading order (`["AGENTS.md"]`, `["AGENTS.md", "next/AGENTS.md"]`), `bytes` their UTF-8 bytes
// added, and over means more than `max`. The folder files are the tracked `AGENTS.md` one folder down.
//
// The plan leaves one thing open, and this law does not decide it: when the root alone is over the limit,
// whether the longer chains over the limit are findings too. A finding is exactly a chain over the limit
// with its true bytes; when the root alone is not over, the findings are exactly the over chains of root
// plus one folder file.
import { expect, it } from "@effect/vitest";
import { runsFor } from "@kampus/vitest";
import { Effect, Schema } from "effect";
import { Finding } from "./Finding.ts";
import * as MapSize from "./MapSize.ts";
import { bytesOf, ROOT, world } from "./Records.test-support.ts";

const check = { arbitrary: { seed: 119120, runs: runsFor({ fast: 100, full: 300 }) } };

const FOLDERS = ["next/AGENTS.md", "kalfa/AGENTS.md", "docs/AGENTS.md"] as const;

const MOST = 70_000;

// A size drawn anywhere from 0 to 70,000, within 2 of the limit, or below it: the line between over and not
// over is crossed as often as any other.
const Size = Schema.Struct({
  mode: Schema.Literals([0, 1, 2]),
  n: Schema.Int.check(Schema.isBetween({ minimum: 0, maximum: MOST })),
});

const sizeFrom = ({ mode, n }: typeof Size.Type, max: number) =>
  mode === 0 ? n : mode === 1 ? Math.max(0, max + (n % 5) - 2) : n % (max + 1);

// Plant: compare each folder file alone, not with the root, so a 20 KB root and a 15 KB folder pass at 32,768.
it.effect.prop(
  "L6 a finding comes when the root, or the root plus one folder file, is over the limit, and names its chain and bytes",
  {
    max: Schema.Int.check(Schema.isBetween({ minimum: 1, maximum: MOST })),
    size: Size,
    sizes: Schema.Array(Size).check(Schema.isBetweenLength(0, 3)),
    twos: Schema.Int.check(Schema.isBetween({ minimum: 0, maximum: 5000 })),
  },
  ({ max, size, sizes, twos }) =>
    Effect.gen(function* () {
      const root = sizeFrom(size, max);
      const folders = sizes.map((each) => sizeFrom(each, max));
      const files: Record<string, string> = { "AGENTS.md": bytesOf(root, twos), "CLAUDE.md": "@AGENTS.md\n" };

      folders.forEach((bytes, i) => {
        files[FOLDERS[i]!] = bytesOf(bytes, twos);
      });

      const chains = [
        { chain: ["AGENTS.md"], bytes: root },
        ...folders.map((bytes, i) => ({ chain: ["AGENTS.md", FOLDERS[i]!], bytes: root + bytes })),
      ];

      const over = chains.filter(({ bytes }) => bytes > max);
      const all = yield* MapSize.check(ROOT, max).pipe(Effect.provide(world(ROOT, files)));
      const found = all.filter(Finding.guards.map);

      expect(found, "only map findings").toHaveLength(all.length);
      expect(found.length > 0).toBe(over.length > 0);

      const named = found.map((finding) => finding.chain.join(" + "));

      expect(new Set(named).size, "one finding for a chain").toBe(named.length);

      for (const finding of found) {
        expect(finding.max).toBe(max);

        const real = chains.find(({ chain }) => chain.join(" + ") === finding.chain.join(" + "));

        expect(real, `${finding.chain.join(" + ")} is a chain an agent reads`).toBeDefined();
        expect(finding.bytes).toBe(real?.bytes);
        expect(finding.bytes).toBeGreaterThan(max);
      }

      if (root <= max) {
        expect(named.sort()).toEqual(over.map(({ chain }) => chain.join(" + ")).sort());
      }
    }),
  check,
);
