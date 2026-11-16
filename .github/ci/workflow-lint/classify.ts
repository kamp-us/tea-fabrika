// Today's CI, serving both versions. check.yaml's changes job, its own work: the small scans that
// run after any failure, the full-history checkout, and the classify step with the run's event.
import { pipe } from "effect/Function";
import * as Str from "effect/String";
import { classifier, commands, compact, map, type Rule, steps } from "./shared.ts";

export const classifyStep: Rule = ({ jobs }, require) => {
  const changes = map(jobs["changes"]);
  const classify = steps(changes).find((s) => s["id"] === "diff");

  require(commands(changes).includes("sh .agents/skills/lead/scripts/skillscheck.sh"), "changes runs the skills check");
  require(commands(changes).includes(
    "node oxlint-plugins/gitignore.mjs",
  ), "changes runs the shared tracked-file check");

  for (const command of ["sh .agents/skills/lead/scripts/skillscheck.sh", "node oxlint-plugins/gitignore.mjs"]) {
    require(steps(changes).some(
      (s) => s["run"] === command && compact(s["if"]) === "!cancelled()",
    ), "small scans still run after classifier failure");
  }

  const list = steps(changes);
  require(list.some(
    (s) =>
      typeof s["uses"] === "string" &&
      pipe(s["uses"], Str.startsWith("actions/checkout@")) &&
      map(s["with"])["fetch-depth"] === 0 &&
      !("if" in s),
  ), "changes checks out history");
  require(classify?.["run"] === "node .github/ci/changes.mjs" &&
    !("if" in (classify ?? {})), "changes calls the classifier");

  for (const [key, expected] of Object.entries(classifier)) {
    require(map(classify?.["env"])[key] === expected, `changes passes event ${key} through env`);
  }
};
