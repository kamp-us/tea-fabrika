// Law Q14 of docs/plan/quests/kalfa-quality-stryker-PLAN.md (decision 0585): `./cli` exports an
// effect/cli `Command` named `quality`, the root a future `kalfa` finds through the package's
// `kalfa.cli` field. A compile-time law: tsc is red when the root is named anything else, and the
// lead runs it with the typecheck. The command's subcommands are runtime data, which a type cannot
// name: cli.test.ts holds them.
import { expectTypeOf, it } from "@effect/vitest";
import type { Command } from "effect/cli";
import type { quality } from "./cli.ts";

// Plant: name the root `kalfa`, so tsc fails.
const contract = () => {
  expectTypeOf<typeof quality>().toExtend<Command.Command<"quality", any, any, any, any>>();
  expectTypeOf<(typeof quality)["name"]>().toEqualTypeOf<"quality">();
};

it("Q14 type: the cli's root command is named quality", () => {
  // This compile-time law needs tsc, which the lead runs after build.
  expectTypeOf(contract).toBeFunction();
});
