import * as Function from "effect/Function";
// Today's CI, serving both versions. check.yaml's typecheck job, the one place `pnpm typecheck` runs.
import { commands, map, type Require, type Rule, type Workflow } from "./shared.ts";

export const typecheckJob: Rule = Function.dual(2, ({ jobs }: Workflow, require: Require) => {
  // The typecheck is its own job, so its answer comes as soon as it ends and a quest can read it
  // alone (0133). check runs no second one.
  require(commands(map(jobs["typecheck"])).includes("pnpm typecheck"), "the typecheck job runs pnpm typecheck");
  require(!commands(map(jobs["check"])).includes("pnpm typecheck"), "check leaves the typecheck to its own job");
});
