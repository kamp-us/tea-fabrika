// Today's CI, serving both versions. check.yaml's ci-required job, the one required check.
import { compact, map, type Rule, steps } from "./shared.ts";

export const ciRequired: Rule = ({ jobs }, require) => {
  // The one required check: it waits on every other job, never skips, and judges them all.
  const summary = map(jobs["ci-required"]),
    others = Object.keys(jobs).filter((name) => name !== "ci-required");

  const needed = Array.isArray(summary["needs"]) ? summary["needs"] : [];
  require(needed.length === others.length &&
    others.every((name) => needed.includes(name)), "ci-required needs every other job");
  require(compact(summary["if"]) === "always()" &&
    summary["continue-on-error"] === undefined, "ci-required runs after any result and its failure blocks");
  const judged = steps(summary).filter((s) => "run" in s);
  require(judged.length === 1 &&
    judged[0]?.["run"] === "node .github/ci/required.mjs" &&
    compact(map(judged[0]?.["env"])["NEEDS"]) === "toJSON(needs)" &&
    !("if" in (judged[0] ?? {})) &&
    judged[0]?.["continue-on-error"] === undefined, "ci-required judges toJSON(needs) with required.mjs");
};
