import { it } from "@effect/vitest";
import { Effect, Option, Schema } from "effect";
import { expect } from "vitest";
import { answer, File, memory, Row } from "./gate.test-support.ts";
import { find, keep, key, version } from "./gatecache.ts";

// Today's tooling: the guard check's saved results, on a file system in memory.
const run = { arbitrary: { seed: 119120, runs: 200 } };

const Word = Schema.String.check(Schema.isPattern(/^[a-f0-9]{1,12}$/));

const Ask = Schema.Struct({
  base: Word,
  tree: Word,
  files: Schema.Array(File),
  version: Word,
  seconds: Schema.Int.check(Schema.isBetween({ minimum: 1, maximum: 900 })),
  field: Schema.Literals(["base", "tree", "files", "version", "seconds"]),
});

it.effect.prop(
  "the key changes with the base, the tree, the files, the scripts and the time budget, and with nothing else",
  Ask.fields,
  ({ field, ...ask }) =>
    Effect.sync(() => {
      const same = key({ ...ask, files: [...ask.files].reverse().concat(ask.files) });
      expect(same, "the order of the files, and a file named twice, change nothing").toBe(key(ask));

      const other = {
        base: { ...ask, base: `${ask.base}0` },
        tree: { ...ask, tree: `${ask.tree}0` },
        files: { ...ask, files: [...ask.files, "z/new.ts"] },
        version: { ...ask, version: `${ask.version}0` },
        seconds: { ...ask, seconds: ask.seconds + 1 },
      }[field];

      expect(key(other), `${field} is in the key`).not.toBe(key(ask));
    }),
  run,
);

it.effect.prop(
  "the version of the scripts changes with the text of any one, and not with the order they are given in",
  {
    scripts: Schema.Array(Schema.Struct({ name: Word, text: Schema.String })).check(Schema.isMinLength(1)),
    edited: Schema.Int.check(Schema.isBetween({ minimum: 0, maximum: 99 })),
  },
  ({ scripts, edited }) =>
    Effect.sync(() => {
      const named = scripts.map((script, at) => ({ ...script, name: `${script.name}${at}` }));
      expect(version([...named].reverse())).toBe(version(named));

      const at = edited % named.length;
      const changed = named.map((script, i) => (i === at ? { ...script, text: `${script.text}!` } : script));
      expect(version(changed)).not.toBe(version(named));
    }),
  run,
);

it.effect.prop(
  "a run is found under the key it was kept with and under no other, and a run of a stuck box is not kept",
  {
    id: Schema.Literals(["aa", "bb", "cc"]),
    outcome: Schema.Literals(["done", "skip", "stuck"]),
    survivors: Schema.Array(Row),
    seconds: Schema.Int.check(Schema.isBetween({ minimum: 1, maximum: 900 })),
  },
  ({ id, outcome, survivors, seconds }) =>
    Effect.gen(function* () {
      const disk = memory();
      const summary = answer(outcome, survivors, seconds);

      const kept = yield* keep("/gate", id, summary).pipe(Effect.provide(disk.layer));
      expect(kept).toBe(outcome !== "stuck");

      const found = yield* find("/gate", id).pipe(Effect.provide(disk.layer));
      expect(Option.map(found, (entry) => entry.summary)).toEqual(
        outcome === "stuck" ? Option.none() : Option.some(summary),
      );

      expect(Option.isNone(yield* find("/gate", `${id}x`).pipe(Effect.provide(disk.layer)))).toBe(true);
      expect([...disk.files.keys()].filter((path) => path.endsWith(".part"))).toEqual([]);

      // A file that is cut off or of another shape is a miss, never an error.
      for (const path of disk.files.keys()) {
        disk.files.set(path, '{"saved": 1, "summary": ');
      }

      expect(Option.isNone(yield* find("/gate", id).pipe(Effect.provide(disk.layer)))).toBe(true);
    }),
  run,
);
