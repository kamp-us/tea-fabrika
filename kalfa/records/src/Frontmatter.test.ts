// L2 of docs/plan/quests/rules-and-records-build-PLAN.md (slice 8, 0606): a decision's frontmatter. Its `id`
// equals the file's four-digit number, its status is one of the two, and a successor names a record that
// exists in `.decisions/`. A missing successor file, a mismatched id or a bad status is a `status` finding.
//
// Assumed exports:
// - `Frontmatter.ts`: `check(root: string)`, the status check: `Effect<ReadonlyArray<Finding>, E,
//   Tracked | FileSystem | Path>`. It reads the tracked `.decisions/NNNN-slug.md` files through `Tracked`
//   and `FileSystem` (the plan's "temp directory" is an in-memory repo here, see Records.test-support.ts),
//   and `Decision`, the Schema of the keys every decision has.
// - `Tracked.ts`: `Tracked`, the service `git ls-files -s` answers behind (see Records.test-support.ts).
// - A finding's `line` is the line, counted from 1, of the key that is wrong: `id:`, `successor:` or `status:`.
//
// The ids are written as the repo writes them, `id: 0146` unquoted, which `yaml`'s default schema reads as
// the number 146: the check must still match it to the file's `0146`.
import { NodeServices } from "@effect/platform-node";
import { expect, it } from "@effect/vitest";
import { runsFor } from "@kampus/vitest";
import { Effect, FileSystem, Layer, Path, Schema } from "effect";
import { Finding } from "./Finding.ts";
import * as Frontmatter from "./Frontmatter.ts";
import { distinct, lineOf, Number4, pad, record, ROOT, slugOf, Words, world } from "./Records.test-support.ts";
import { Tracked } from "./Tracked.ts";

const check = { arbitrary: { seed: 119120, runs: runsFor({ fast: 25, full: 100 }) } };

const KINDS = ["accepted", "superseded", "dangling", "amended"] as const;

const Spec = Schema.Struct({
  right: Schema.Boolean,
  kind: Schema.Literals(KINDS),
  ghost: Number4,
  name: Words,
});

// Plant: drop the successor lookup, so a successor that names no file passes.
it.effect.prop(
  "L2 an id that is not the file's number, a successor with no file and a status that is not one of two are status findings",
  {
    drawn: Schema.Array(Number4).check(Schema.isBetweenLength(2, 20)),
    specs: Schema.Array(Spec).check(Schema.isBetweenLength(20, 20)),
  },
  ({ drawn, specs }) =>
    Effect.gen(function* () {
      const numbers = distinct(drawn);
      const used = new Set(numbers);
      const files: Record<string, string> = {};
      const expected: Array<{ path: string; line: number; raw?: string }> = [];

      numbers.forEach((number, i) => {
        const spec = specs[i]!;
        const path = `.decisions/${pad(number)}-${slugOf(spec.name)}.md`;
        // Another number than the file's, whatever the file's is.
        const id = spec.right ? pad(number) : pad((number % 9999) + 1);
        // A number that no file has.
        let ghost = spec.ghost;

        while (used.has(ghost)) {
          ghost = (ghost % 9999) + 1;
        }

        // The next file's number: a successor that exists.
        const next = numbers[(i + 1) % numbers.length]!;

        const text =
          spec.kind === "accepted"
            ? record({ id })
            : spec.kind === "superseded"
              ? record({ id, status: "superseded", successor: pad(next) })
              : spec.kind === "dangling"
                ? record({ id, status: "superseded", successor: pad(ghost) })
                : record({ id, status: `amended-in-part by [${pad(next)}](${pad(next)}-x.md)` });

        files[path] = text;

        if (!spec.right) {
          expected.push({ path, line: lineOf(text, "id:") });
        }

        if (spec.kind === "dangling") {
          expected.push({ path, line: lineOf(text, "successor:") });
        }

        if (spec.kind === "amended") {
          expected.push({
            path,
            line: lineOf(text, "status:"),
            raw: `amended-in-part by [${pad(next)}](${pad(next)}-x.md)`,
          });
        }
      });

      // Not a decision, so not read: a plan file with a frontmatter that no record could have.
      files["docs/plan/README.md"] = "---\nid: 7\nstatus: proposed\n---\n\nA plan.\n";
      files["AGENTS.md"] = "# Working here\n";

      const all = yield* Frontmatter.check(ROOT).pipe(Effect.provide(world(ROOT, files)));
      const found = all.filter(Finding.guards.status);

      expect(found, "only status findings").toHaveLength(all.length);

      const order = (a: { path: string; line: number }, b: { path: string; line: number }) =>
        a.path < b.path ? -1 : a.path > b.path ? 1 : a.line - b.line;

      expect(found.map(({ path, line }) => ({ path, line })).sort(order)).toEqual(
        expected.map(({ path, line }) => ({ path, line })).sort(order),
      );

      for (const want of expected.filter(({ raw }) => raw !== undefined)) {
        expect(found.find((f) => f.path === want.path && f.line === want.line)).toMatchObject({ raw: want.raw });
      }
    }),
  check,
);

const Valid = Schema.Struct({
  number: Number4,
  title: Schema.Literals(["A rule", "No record patches another"]),
  status: Schema.Literals(["accepted", "superseded"]),
  year: Schema.Int.check(Schema.isBetween({ minimum: 2020, maximum: 2030 })),
  month: Schema.Int.check(Schema.isBetween({ minimum: 1, maximum: 12 })),
  day: Schema.Int.check(Schema.isBetween({ minimum: 1, maximum: 28 })),
  tags: Schema.Array(Schema.Literals(["records", "lint", "kalfa-records"])).check(Schema.isBetweenLength(0, 4)),
  successor: Schema.UndefinedOr(Number4),
});

// Plant: let `id` be any string.
it.prop(
  "L2 the Decision schema takes the keys every decision has, and refuses a short id, an empty title, an unknown status or a badly written date",
  { valid: Valid },
  ({ valid }) => {
    const is = Schema.is(Frontmatter.Decision);
    const month = String(valid.month).padStart(2, "0");
    const day = String(valid.day).padStart(2, "0");

    const keys = {
      id: pad(valid.number),
      title: valid.title,
      status: valid.status,
      date: `${valid.year}-${month}-${day}`,
      tags: valid.tags,
    };

    const whole = valid.successor === undefined ? keys : { ...keys, successor: pad(valid.successor) };

    expect(is(whole)).toBe(true);

    for (const bad of [
      { ...whole, id: "605" },
      { ...whole, id: 605 },
      { ...whole, id: "06050" },
      { ...whole, title: "" },
      { ...whole, status: "proposed" },
      { ...whole, status: "amended-in-part by [0539](0539-x.md)" },
      { ...whole, date: "2026-1-8" },
      { ...whole, date: "18 November 2026" },
      { ...whole, tags: "records" },
      { ...whole, successor: "12" },
    ]) {
      expect(is(bad), JSON.stringify(bad)).toBe(false);
    }
  },
  check,
);

// Plant: compare `id` as a string the yaml parser has turned into the number 605.
it.effect("L2 scenario: the four records 0605 to 0608, as committed, have no status finding", () =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;
    const root = path.resolve(import.meta.dirname, "../../..");
    const names = (yield* fs.readDirectory(path.join(root, ".decisions"))).filter((name) => /^060[5-8]-/.test(name));

    expect(names).toHaveLength(4);

    const tracked = names.map((name) => ({ path: `.decisions/${name}`, symlink: false }));

    const found = yield* Frontmatter.check(root).pipe(
      Effect.provide(Layer.succeed(Tracked, { files: Effect.succeed(tracked) })),
    );

    expect(found).toEqual([]);
  }).pipe(Effect.provide(NodeServices.layer)),
);
