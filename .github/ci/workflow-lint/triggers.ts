// Today's CI, serving both versions. check.yaml's triggers: the events that start a run, the paths
// a pull request ignores, what cancels a run, and a draft's own check names.
import { pipe, String as Str } from "effect";
import { ignored } from "../changes.mjs";
import { compact, map, type Rule } from "./shared.ts";

// A draft's check and ci-required carry their own names, so a draft's green answer on a head never
// stands in for the ready run's on the same head (catchup.sh reads `check`, the ruleset
// `ci-required`).
const DRAFT_NAMES = {
  check: "github.event.pull_request.draft&&'lint'||'check'",
  "ci-required": "github.event.pull_request.draft&&'ci-required (draft)'||'ci-required'",
};

// Marking a draft ready starts the full run; only a new head cancels the run before it. Adding the
// `visual` label starts the same run with the visual legs (0536), and it cancels the one it repeats.
const TYPES = ["opened", "synchronize", "reopened", "ready_for_review", "labeled"];

const CANCEL =
  "github.event_name=='pull_request'&&(github.event.action=='synchronize'||(github.event.action=='labeled'&&github.event.label.name=='visual'))";

export const triggers: Rule = ({ workflow, on, jobs }, require) => {
  const push = map(on["push"]),
    pr = map(on["pull_request"]),
    queue = map(on["merge_group"]);
  require("pull_request" in on &&
    "push" in on &&
    JSON.stringify(push["branches"]) === '["main"]', "run every PR and main push");

  // A pull request's one exclusion is changes.mjs's `ignored`: plan files and rows alone start no
  // run. GitHub compares the whole pull request with its base, so one more path starts it again.
  for (const trigger of [on, push, pr, queue]) {
    require(!["paths", "branches-ignore", "tags", "tags-ignore"].some((key) => key in trigger) &&
      (trigger === pr || !("paths-ignore" in trigger)), "no workflow path or branch exclusions");
  }

  require(JSON.stringify(pr["paths-ignore"]) ===
    JSON.stringify(ignored), "pull requests ignore exactly changes.mjs's ignored paths");
  // Each `*` is a name without a `/`, and no other wildcard is used, so the test's reading of a
  // pattern is GitHub's (its filter pattern cheat sheet).
  const skipped = pr["paths-ignore"];
  require(Array.isArray(skipped) &&
    skipped.every(
      (pattern) =>
        typeof pattern === "string" && /^[\w.-]+(?:\/[\w.*-]+)+$/.test(pattern) && !pipe(pattern, Str.includes("**")),
    ), "ignored paths use no wildcard but a single *");

  require(!("branches" in pr), "all PR bases remain enabled");
  // A merge queue takes a required check only from a `merge_group` run, so without this trigger
  // `ci-required` never reports there and nothing can merge.
  require(JSON.stringify(queue["types"]) === '["checks_requested"]', "the merge queue's group runs the checks");
  const types = pr["types"];
  require(Array.isArray(types) &&
    types.length === TYPES.length &&
    TYPES.every((type) => types.includes(type)), "pull requests run on open, push, reopen and ready for review");
  require(compact(map(workflow["concurrency"])["cancel-in-progress"]) === CANCEL, "only a new head cancels a run");

  for (const [job, expected] of Object.entries(DRAFT_NAMES)) {
    require(compact(map(jobs[job])["name"]) === expected, `${job} has its own name on a draft`);
  }
};
