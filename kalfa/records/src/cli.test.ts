// The `records` command: `check` runs the map check on a repo and prints one block per finding, then a count
// line. A map finding is advice, ends in "(advice)", and never fails the command. On a clean repo `check`
// prints nothing and succeeds, and `check map` runs only that check. The repo is held in memory
// (Records.test-support.ts), which Effect's `FileSystem` and our `Tracked` service make possible.
import { expect, it } from "@effect/vitest";
import { runsFor } from "@kampus/vitest";
import { Effect, Exit, Path, Schema } from "effect";
import { Command } from "effect/cli";
import { TestConsole } from "effect/testing";
import { records } from "./cli.ts";
import { cliLayers, fileLines } from "./Records.test-support.ts";

const check = { arbitrary: { seed: 119120, runs: runsFor({ fast: 25, full: 100 }) } };

const Over = Schema.Int.check(Schema.isBetween({ minimum: 0, maximum: 10 }));

/** Runs `records ...args` on the repo and answers its exit, and the lines it printed. */
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

    return { exit, printed };
  }).pipe(Effect.provide(Path.layer));

it.effect.prop(
  "property: a map over the limit prints its block ending in (advice) and the count, and the command succeeds; a map at the limit prints nothing",
  { over: Over, name: Schema.Literals(["check", "map"]) },
  ({ over, name }) =>
    Effect.gen(function* () {
      const args = name === "check" ? ["check"] : ["check", "map"];
      const dirty = yield* run(args, { "AGENTS.md": fileLines(201 + over, 8) });

      expect(Exit.isSuccess(dirty.exit), "advice never fails the command").toBe(true);
      expect(dirty.printed[0]!.startsWith("AGENTS.md"), dirty.printed.join("\n")).toBe(true);
      expect(dirty.printed.at(-2)!.trimEnd().endsWith("(advice)")).toBe(true);
      expect(dirty.printed.at(-1)).toMatch(/\b1 advice\b/);
      expect(dirty.printed.at(-1)).not.toMatch(/finding/);

      const clean = yield* run(args, { "AGENTS.md": fileLines(200 - over, 8) });

      expect(Exit.isSuccess(clean.exit)).toBe(true);
      expect(clean.printed).toEqual([]);
    }),
  check,
);
