// The other half of law Q14 of docs/plan/quests/kalfa-quality-stryker-PLAN.md: the command tree's names.
// Effect's `Command` type does not carry its subcommands' names, so cli.types.test.ts can pin only the
// root, and the tree itself is read here.
//
// format: the names are text a person types (`kalfa quality stryker plant <name>`, decision 0585), so
// they are pinned exactly, with the one flag each command's output takes.
import { expect, it } from "@effect/vitest";
import { quality } from "./cli.ts";

// Plant: add a third subcommand, or rename `survey`.
it("format: Q14 the root is `quality`, its only subcommand `stryker`, which has exactly `plant` and `survey`", () => {
  expect(quality.name).toBe("quality");
  expect(quality.subcommands.flatMap((group) => group.commands.map((command) => command.name))).toEqual(["stryker"]);

  const stryker = quality.subcommands[0]?.commands[0];
  expect(stryker?.subcommands.flatMap((group) => group.commands.map((command) => command.name)).sort()).toEqual([
    "plant",
    "survey",
  ]);
});
