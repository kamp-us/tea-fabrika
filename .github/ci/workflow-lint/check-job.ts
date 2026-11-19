// Today's CI, serving both versions. check.yaml's check job (F1, ticket 985): each step on its own
// flag, the one ratchet step that holds every list file to shrinking (no check reads a list that lets broken code pass), and
// the copy-paste advice step (a new helper names the tools it searched, and a new name cites the industry's word).
import { Predicate } from "effect";
import { compact, map, type Rule, steps } from "./shared.ts";

const BUILD = "needs.changes.outputs.build!='false'";

// The commit a run's change starts from, for vitest's `--changed`: a pull request's base, a merge
// queue group's base, or what main held before a push. All zeros (a first push) is no base.
const TEST_BASE = `\${{ github.event.pull_request.base.sha || github.event.merge_group.base_sha || (github.event.before != '0000000000000000000000000000000000000000' && github.event.before) || '' }}`;

const RATCHET = 'node next/apps/fabrika/src/exam/ratchet.ts --base "$BASE"';

// A new helper names the tools it searched, and a new name cites the industry's word: the clones a pull request adds, as advice. Only a pull request has a base to tell a clone new by.
const COPIES = 'node .github/ci/copies.ts --base "$BASE"';

const COPIES_BASE = `\${{ github.event.pull_request.base.sha }}`;

// The check job's flag: lint on check.
const CHECK = "needs.changes.outputs.check!='false'";

export const checkJob: Rule = ({ jobs }, require) => {
  // A draft's check is lint alone: the build skips on changes' build flag.
  // F1. check's setup runs on any flag, its lint steps on the check flag, the build on build.
  const checkSteps = steps(map(jobs["check"]));

  for (const step of checkSteps) {
    const slow = step["run"] === "pnpm build";
    const setup = Predicate.isString(step["uses"]);
    const expected = slow ? BUILD : CHECK;
    require(setup
      ? !("if" in step)
      : compact(step["if"]) ===
          expected, "F1: check's lint steps run on the check flag, the build on build, its setup on every run");
  }

  require(checkSteps.some(
    (s) => s["run"] === "pnpm install --frozen-lockfile",
  ), "F1: check installs everything for lint");
  const checkout = checkSteps.find((s) => Predicate.isString(s["uses"]) && s["uses"].startsWith("actions/checkout@"));
  require(map(checkout?.["with"])["fetch-depth"] === 0, "F1: check checks out history, which the ratchet diffs");

  // No check reads a list that lets broken code pass: a list file only shrinks. Without its one step a pull request could drop the ratchet and
  // pass with a grown list; a first push's zeros map to no base, as for the test steps.
  const ratchets = checkSteps.filter(
    (step) => Predicate.isString(step["run"]) && step["run"].includes("next/apps/fabrika/src/exam/ratchet"),
  );

  require(ratchets.length === 1 &&
    ratchets[0]?.["run"] === RATCHET &&
    compact(map(ratchets[0]?.["env"])["BASE"]) === compact(TEST_BASE) &&
    compact(ratchets[0]?.["if"]) === CHECK &&
    ratchets[0]?.["continue-on-error"] ===
      undefined, `check runs ${RATCHET} once, on the test base, and its failure blocks`);

  // A new helper names the tools it searched, and a new name cites the industry's word: jscpd is advice until its false alarms are measured, so its step can never fail the job,
  // and it runs before lint, so a red lint still shows the advice.
  const copies = checkSteps.filter((step) => step["run"] === COPIES);
  const lint = checkSteps.findIndex((step) => step["run"] === "pnpm lint");
  require(copies.length === 1 &&
    copies[0]?.["continue-on-error"] === true &&
    compact(copies[0]?.["if"]) === CHECK &&
    compact(map(copies[0]?.["env"])["BASE"]) === compact(COPIES_BASE) &&
    checkSteps.indexOf(copies[0]) <
      lint, `C1: check runs ${COPIES} once, before lint, on the pull request's base, and it never fails the job (a new helper names the tools it searched, and a new name cites the industry's word)`);
};
