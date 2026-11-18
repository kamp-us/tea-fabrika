// L8 of docs/plan/quests/rules-and-records-build-PLAN.md (slice 8): the command. `check` runs all four checks
// on a repo and prints one line per finding in path order, then the count, and fails; on a clean repo it
// prints nothing and succeeds; `check <name>` runs only that check.
//
// Assumed export, `cli.ts`: `records`, the `effect/cli` command, with `check` as a subcommand that takes one
// optional name, `status`, `patch`, `link` or `map`. It prints through `Console.log`, takes the repo's root
// from the working folder (`Path.resolve()`, as `@kalfa/quality`'s cli does), lists files through `Tracked`,
// reads them through `FileSystem`, and loads its limit with `@kalfa/config` from the repo's `.kalfa/kalfa.toml`
// (it needs `@kalfa/config`'s `Toml` service and a `Digest`, which `bin.ts` provides and the test layer stands in for). A finding line starts with its path (the map
// finding with its chain's first path) and may go on in indented lines; the last line holds the count. "Exit
// 1" is the command's failure: `bin.ts` is the edge that turns it into the exit code.
//
// This is a plain test, not an integration one: the plan says "a temp directory", and the repo here is held
// in memory (Records.test-support.ts), which Effect's `FileSystem` and our `Tracked` service make possible.
import { expect, it } from "@effect/vitest";
import { runsFor } from "@kampus/vitest";
import { Effect, Exit, Path, Schema } from "effect";
import { Command } from "effect/cli";
import { TestConsole } from "effect/testing";
import { records } from "./cli.ts";
import { bytesOf, cliLayers, distinct, Number4, pad, record, sentence, slugOf, Words } from "./Records.test-support.ts";

const check = { arbitrary: { seed: 119120, runs: runsFor({ fast: 25, full: 100 }) } };

const LIMIT = 50;

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

/** One finding of each kind, or none. */
const repo = (d: typeof Drawn.Type, dirty: boolean) => {
  const { ids, names, file } = places(d);
  const a = ids[0]!;
  const b = ids[1]!;
  const c = ids[2]!;
  const e = ids[3]!;
  const text = sentence(d.words);
  const gap = Array.from({ length: d.before }, () => text);

  return {
    [file(0)]: record({ id: a, status: dirty ? `amended-in-part by [${b}](${b}-${names[1]}.md)` : "accepted" }),
    [file(1)]: record({ id: b, body: dirty ? [text, "", "## Amendments", "", text] : [text] }),
    [file(2)]: record({ id: c, status: "superseded", successor: e }),
    [file(3)]: record({ id: e }),
    "docs/plan/README.md": `${[...gap, `See [it](../../${dirty ? file(2) : file(3)}).`].join("\n")}\n`,
    "AGENTS.md": bytesOf(dirty ? LIMIT + 1 + d.over : LIMIT - d.over, d.over),
    ".kalfa/kalfa.toml": `[records.map]\nmax-bytes = ${LIMIT}\n`,
  };
};

/** Runs `records ...args` on the repo and answers its exit and the lines it printed. */
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

    return { exit, printed, top: printed.filter((line) => line.trim() !== "" && !/^\s/.test(line)) };
  }).pipe(Effect.provide(Path.layer));

// Plant: make `check` stop at the first check with findings, so three of the four lines are missing.
it.effect.prop(
  "L8 `check` prints one line per finding in path order, then the count, and fails; on a clean repo it prints nothing and succeeds",
  { d: Drawn },
  ({ d }) =>
    Effect.gen(function* () {
      const { file } = places(d);
      const dirty = yield* run(["check"], repo(d, true));

      // The four paths, in the order they print: `.decisions/` before `AGENTS.md` before `docs/`.
      const paths = [file(0), file(1), "AGENTS.md", "docs/plan/README.md"].sort();

      expect(Exit.isFailure(dirty.exit)).toBe(true);
      expect(dirty.top, dirty.printed.join("\n")).toHaveLength(5);
      expect(dirty.top.slice(0, 4).map((line) => paths.find((path) => line.startsWith(path)))).toEqual(paths);
      expect(dirty.top[4]).toMatch(/\b4\b/);

      const clean = yield* run(["check"], repo(d, false));

      expect(Exit.isSuccess(clean.exit)).toBe(true);
      expect(clean.printed).toEqual([]);
    }),
  check,
);

it.effect.prop(
  "L8 `check` with a name runs only that check",
  { d: Drawn, name: Schema.Literals(NAMES) },
  ({ d, name }) =>
    Effect.gen(function* () {
      const { file } = places(d);
      const only = yield* run(["check", name], repo(d, true));

      // The record the check is about: the amended status's, the Amendments heading's, the page's, the root's.
      const path = {
        status: file(0),
        patch: file(1),
        link: "docs/plan/README.md",
        map: "AGENTS.md",
      }[name];

      expect(Exit.isFailure(only.exit)).toBe(true);
      expect(only.top, only.printed.join("\n")).toHaveLength(2);
      expect(only.top[0]?.startsWith(path), only.top[0]).toBe(true);
      expect(only.top[1]).toMatch(/\b1\b/);

      const clean = yield* run(["check", name], repo(d, false));

      expect(Exit.isSuccess(clean.exit)).toBe(true);
      expect(clean.printed).toEqual([]);
    }),
  check,
);
