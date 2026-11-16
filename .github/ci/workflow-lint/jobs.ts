// Today's CI, serving both versions. check.yaml's jobs: what each gated job waits on and when it
// skips, which jobs may not come back (F3, ticket 985), and every job's time limit (ticket 496).
import { Predicate } from "effect";
import { gated, gates } from "../required.mjs";
import { compact, map, type Rule } from "./shared.ts";

export const jobLaws: Rule = ({ jobs }, require) => {
  // Each gated job needs changes alone, and runs unless every flag it runs on is false
  // (required.mjs's `gates`): check on check or field rows, next on next, which already holds the
  // sizing.
  for (const name of gated) {
    const job = map(jobs[name]);
    const flags = gates[name].map((flag) => `needs.changes.outputs.${flag} != 'false'`).join(" || ");
    require(job["needs"] === "changes", `${name} needs changes`);
    require(compact(job["if"]) ===
      compact(
        `!cancelled() && (needs.changes.result != 'success' || ${flags})`,
      ), `${name} must run after classifier failure and skip only when its flags are false`);
  }

  // F3. legs and field are steps of changes and check now, so no job of either name comes back.
  require(!("legs" in jobs) &&
    !("field" in jobs), "F3: no legs or field job: changes sizes next, and check checks the rows");

  // A job with no limit runs for GitHub's 360 minute default when a step hangs (ticket 496).
  for (const [name, job] of Object.entries(jobs)) {
    const limit = map(job)["timeout-minutes"];
    require(Predicate.isNumber(limit) && limit > 0 && limit < 360, `${name} sets timeout-minutes`);
  }
};
