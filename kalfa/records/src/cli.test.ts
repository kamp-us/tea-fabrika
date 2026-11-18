// L8 of docs/plan/quests/rules-and-records-build-PLAN.md (slice 8), as the lead changed it after slice 6 made
// the map check advice: the command. `check` runs all four checks on a repo and prints one block per finding
// in path order, then a count line. A status, patch or link finding is a finding and fails the command; a map
// finding is advice, ends in "(advice)", and never fails it. On a clean repo `check` prints nothing and
// succeeds, and `check <name>` runs only that check.
//
// Assumed export, `cli.ts`: `records`, the `effect/cli` command, with `check` as a subcommand that takes one
// optional name, `status`, `patch`, `link` or `map`. It prints through `Console.log`, takes the repo's root
// from the working folder (`Path.resolve()`, as `@kalfa/quality`'s cli does), lists files through `Tracked` and
// reads them through `FileSystem`; it loads no setting. A finding starts a line with its path and may go on
// in indented lines, the last of which ends in "(advice)" for advice. The last line counts the findings and
// the advice, only the parts that are not zero: "3 findings, 1 advice", "1 advice". "Fails" is the command's
// failure: `bin.ts` is the edge that turns it into the exit code.
//
// This is a plain test, not an integration one: the plan says "a temp directory", and the repo here is held
// in memory (Records.test-support.ts), which Effect's `FileSystem` and our `Tracked` service make possible.
import { expect, it } from "@effect/vitest";
import { runsFor } from "@kampus/vitest";
import { Effect, Exit, Path, Schema } from "effect";
import { Command } from "effect/cli";
import { TestConsole } from "effect/testing";
import { records } from "./cli.ts";
import {
  cliLayers,
  distinct,
  fileLines,
  Number4,
  pad,
  record,
  sentence,
  slugOf,
  Words,
} from "./Records.test-support.ts";

const check = { arbitrary: { seed: 119120, runs: runsFor({ fast: 25, full: 100 }) } };

const NAMES = ["status", "patch", "link", "map"] as const;

const Drawn = Schema.Struct({
  numbers: Schema.Array(Number4).check(Schema.isBetweenLength(4, 4)),
  names: Schema.Array(Words).check(Schema.isBetweenLength(4, 4)),
  words: Words,
  before: Schema.Int.check(Schema.isBetween({ minimum: 0, maximum: 6 })),
  over: Schema.Int.check(Schema.isBetween({ minimum: 0, maximum: 10 })),
});

/** The repo's paths, from what was drawn: two records, a page and the root map. */
const places = (d: typeof Drawn.Type) => {
  const ids = distinct(d.numbers).map(pad);
  const names = d.names.map(slugOf);

  return { ids, names, file: (i: number) => `.decisions/${ids[i]}-${names[i]}.md` };
};

/** What is wrong in the repo: the three findings of the records, and the map's advice, each on its own. */
const repo = (d: typeof Drawn.Type, wrong: { readonly records: boolean; readonly map: boolean }) => {
  const { ids, names, file } = places(d);
  const a = ids[0]!;
  const b = ids[1]!;
  const c = ids[2]!;
  const e = ids[3]!;
  const text = sentence(d.words);
  const gap = Array.from({ length: d.before }, () => text);

  return {
    [file(0)]: record({ id: a, status: wrong.records ? `amended-in-part by [${b}](${b}-${names[1]}.md)` : "accepted" }),
    [file(1)]: record({ id: b, body: wrong.records ? [text, "", "## Amendments", "", text] : [text] }),
    [file(2)]: record({ id: c, status: "superseded", successor: e }),
    [file(3)]: record({ id: e }),
    "docs/plan/README.md": `${[...gap, `See [it](../../${wrong.records ? file(2) : file(3)}).`].join("\n")}\n`,
    "AGENTS.md": fileLines(wrong.map ? 201 + d.over : 200 - d.over, 8),
  };
};

/** Runs `records ...args` on the repo and answers its exit, the lines it printed, and them as blocks. */
const run = (args: ReadonlyArray<string>, files: Record<string, string>) =>
  Effect.gen(function* () {
    const path = yield* Path.Path;
    const root = path.resolve();
    // The console keeps every line of the test: this run's are those after what was already there.
    const already = (yield* TestConsole.logLines).length;

    const exit = yield* Effect.exit(
      Command.runWith(records, { version: "0.0.0" })(args).pipe(Effect.provide(cliLayers(root, files))),
    );

    const printed = (yield* TestConsole.logLines).slice(already).flatMap((line) => String(line).split("\n"));

    // A block starts at a line with no indent and takes the indented lines after it.
    const blocks: Array<Array<string>> = [];

    for (const line of printed.filter((each) => each.trim() !== "")) {
      if (/^\s/.test(line) && blocks.length > 0) {
        blocks[blocks.length - 1]!.push(line);
      } else {
        blocks.push([line]);
      }
    }

    return { exit, printed, blocks };
  }).pipe(Effect.provide(Path.layer));

// Plant: make `check` stop at the first check with findings, so three of the four blocks are missing.
it.effect.prop(
  "L8 `check` prints one block per finding in path order, the map's ending in (advice), then the count, and fails on a finding; on a clean repo it prints nothing and succeeds",
  { d: Drawn },
  ({ d }) =>
    Effect.gen(function* () {
      const { file } = places(d);
      const dirty = yield* run(["check"], repo(d, { records: true, map: true }));

      // The four paths, in the order they print: `.decisions/` before `AGENTS.md` before `docs/`.
      const paths = [file(0), file(1), "AGENTS.md", "docs/plan/README.md"].sort();
      const shown = dirty.blocks.slice(0, 4);

      expect(Exit.isFailure(dirty.exit), "a finding fails the command").toBe(true);
      expect(dirty.blocks, dirty.printed.join("\n")).toHaveLength(5);
      expect(shown.map((block) => paths.find((path) => block[0]!.startsWith(path)))).toEqual(paths);

      for (const block of shown) {
        const advice = block[0]!.startsWith("AGENTS.md");

        expect(block.at(-1)!.trimEnd().endsWith("(advice)"), block.join("\n")).toBe(advice);
      }

      const count = dirty.blocks[4]!.join(" ");

      expect(count).toMatch(/\b3 findings\b/);
      expect(count).toMatch(/\b1 advice\b/);

      const clean = yield* run(["check"], repo(d, { records: false, map: false }));

      expect(Exit.isSuccess(clean.exit)).toBe(true);
      expect(clean.printed).toEqual([]);
    }),
  check,
);

it.effect.prop(
  "L8 a repo whose only finding is the map's advice prints it and the count, and the command succeeds",
  { d: Drawn },
  ({ d }) =>
    Effect.gen(function* () {
      const only = yield* run(["check"], repo(d, { records: false, map: true }));

      expect(Exit.isSuccess(only.exit), "advice never fails the command").toBe(true);
      expect(only.blocks, only.printed.join("\n")).toHaveLength(2);
      expect(only.blocks[0]![0]!.startsWith("AGENTS.md")).toBe(true);
      expect(only.blocks[0]!.at(-1)!.trimEnd().endsWith("(advice)")).toBe(true);
      expect(only.blocks[1]!.join(" ")).toMatch(/\b1 advice\b/);
      expect(only.blocks[1]!.join(" ")).not.toMatch(/finding/);
    }),
  check,
);

it.effect.prop(
  "L8 `check` with a name runs only that check, and only a status, patch or link finding fails it",
  { d: Drawn, name: Schema.Literals(NAMES) },
  ({ d, name }) =>
    Effect.gen(function* () {
      const { file } = places(d);
      const only = yield* run(["check", name], repo(d, { records: true, map: true }));

      // The record the check is about: the amended status's, the Amendments heading's, the page's, the root's.
      const path = {
        status: file(0),
        patch: file(1),
        link: "docs/plan/README.md",
        map: "AGENTS.md",
      }[name];

      expect(Exit.isFailure(only.exit), name).toBe(name !== "map");
      expect(only.blocks, only.printed.join("\n")).toHaveLength(2);
      expect(only.blocks[0]![0]!.startsWith(path), only.blocks[0]![0]).toBe(true);
      expect(only.blocks[1]!.join(" ")).toMatch(name === "map" ? /\b1 advice\b/ : /\b1 finding/);

      const clean = yield* run(["check", name], repo(d, { records: false, map: false }));

      expect(Exit.isSuccess(clean.exit)).toBe(true);
      expect(clean.printed).toEqual([]);
    }),
  check,
);
