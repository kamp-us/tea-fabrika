// Today's CI, serving both versions. check.yaml's check job (F1, ticket 985): each step on its own
// flag, the field rows and the plant check (0580) last, and the one ratchet step that holds every list file to shrinking (0524).
import { compact, env, map, ROW_INSTALL, type Rule, steps } from "./shared.ts";

const BUILD = "needs.changes.outputs.build!='false'";
// The commit a run's change starts from, for vitest's `--changed`: a pull request's base, a merge
// queue group's base, or what main held before a push. All zeros (a first push) is no base.
const TEST_BASE = `\${{ github.event.pull_request.base.sha || github.event.merge_group.base_sha || (github.event.before != '0000000000000000000000000000000000000000' && github.event.before) || '' }}`;
const RATCHET = 'node next/apps/fabrika/src/exam/ratchet.ts --base "$BASE"';

// The check job's flags (ticket 985): lint on check, field rows on field, the CI package's install
// when only rows changed.
const CHECK = "needs.changes.outputs.check!='false'";

const ROWS = "!cancelled()&&needs.changes.outputs.field!='false'";
const ROWS_ALONE = "needs.changes.outputs.check=='false'";

export const checkJob: Rule = ({ jobs }, require) => {
  // A draft's check is lint alone: the build skips on changes' build flag.
  // F1. check also holds the field row check (ticket 985): its setup runs on any flag, its full
  // install and lint on the check flag, the CI package's install when only rows changed, and the
  // row check last, after any failure, on the field flag, so a red lint never hides red rows.
  const checkSteps = steps(map(jobs["check"]));
  const rows = checkSteps.filter((s) => s["run"] === "node .github/ci/field-check.ts");
  // 0580: the plant check runs beside the row check, on the same flag and inputs, right after it.
  const plants = checkSteps.filter((s) => s["run"] === "node .github/ci/plant-check.ts");
  const rowInstall = checkSteps.filter((s) => s["run"] === ROW_INSTALL);

  for (const step of checkSteps) {
    const slow = step["run"] === "pnpm build";
    const setup = typeof step["uses"] === "string";
    const expected = slow
      ? BUILD
      : rows.includes(step) || plants.includes(step)
        ? ROWS
        : rowInstall.includes(step)
          ? ROWS_ALONE
          : CHECK;
    require(setup
      ? !("if" in step)
      : compact(step["if"]) ===
          expected, "F1: check's lint steps run on the check flag, the build on build, the rows on field, its setup on every run");
  }

  require(plants.length === 1 &&
    rows.length === 1 &&
    plants[0] === checkSteps.at(-1) &&
    rows[0] === checkSteps.at(-2) &&
    plants[0]?.["continue-on-error"] === undefined &&
    JSON.stringify(plants[0]?.["env"]) ===
      JSON.stringify(
        env,
      ), "0580: check runs the plant check once, last, right after the row check, with the run's base, head and event, and its failure blocks");
  require(rows.length === 1 &&
    rows[0] === checkSteps.at(-2) &&
    rows[0]?.["continue-on-error"] === undefined &&
    JSON.stringify(rows[0]?.["env"]) ===
      JSON.stringify(
        env,
      ), "F1: check runs the row check once, before only the plant check, with the run's base, head and event, and its failure blocks");
  require(rowInstall.length === 1 &&
    checkSteps.some(
      (s) => s["run"] === "pnpm install --frozen-lockfile",
    ), "F1: check installs everything for lint, and only the CI package for rows alone");
  const checkout = checkSteps.find((s) => typeof s["uses"] === "string" && s["uses"].startsWith("actions/checkout@"));
  require(map(checkout?.["with"])["fetch-depth"] === 0, "F1: check checks out history, which the row check diffs");

  // 0524: a list file only shrinks. Without its one step a pull request could drop the ratchet and
  // pass with a grown list; a first push's zeros map to no base, as for the test steps.
  const ratchets = checkSteps.filter(
    (step) => typeof step["run"] === "string" && step["run"].includes("next/apps/fabrika/src/exam/ratchet"),
  );
  require(ratchets.length === 1 &&
    ratchets[0]?.["run"] === RATCHET &&
    compact(map(ratchets[0]?.["env"])["BASE"]) === compact(TEST_BASE) &&
    compact(ratchets[0]?.["if"]) === CHECK &&
    ratchets[0]?.["continue-on-error"] ===
      undefined, `check runs ${RATCHET} once, on the test base, and its failure blocks`);
};
