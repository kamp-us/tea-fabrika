import { Predicate, Record as Rec } from "effect";
// Today's CI, serving both versions. check.yaml's changes job, its own work: the small scans that
// run after any failure, the full-history checkout, the pinned Node and the link to @kalfa/ci that the
// classify step needs, and the classify step with the run's event.
import { classifier, commands, compact, map, type Rule, steps, uses } from "./shared.ts";

// The link the changes job makes before its classify step (check.yaml), so the classifier's import of
// @kalfa/ci/DocsOnly resolves with no install.
const LINK = "mkdir -p .github/ci/node_modules/@kalfa && ln -s ../../../../kalfa/ci .github/ci/node_modules/@kalfa/ci";

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
      Predicate.isString(s["uses"]) &&
      s["uses"].startsWith("actions/checkout@") &&
      map(s["with"])["fetch-depth"] === 0 &&
      !("if" in s),
  ), "changes checks out history");
  require(classify?.["run"] === "node .github/ci/changes.mjs" &&
    !("if" in (classify ?? {})), "changes calls the classifier");

  // The pinned Node and the link come after the checkout and before the classify step. Neither has an
  // `if` or a `continue-on-error`: the classifier imports @kalfa/ci/DocsOnly through them.
  const setup = list.find((s) => s["name"] === "setup node for the classifier");
  const link = list.find((s) => s["name"] === "link @kalfa/ci");
  const position = (step: Record<string, unknown> | undefined) => (step === undefined ? -1 : list.indexOf(step));

  require(setup !== undefined &&
    uses(setup, "actions/setup-node") &&
    map(setup["with"])["node-version"] === "26.13.0" &&
    !("if" in setup) &&
    !(
      "continue-on-error" in setup
    ), "changes sets up Node 26.13.0 for the classifier, with no if or continue-on-error");
  require(link !== undefined &&
    link["run"] === LINK &&
    !("if" in link) &&
    !("continue-on-error" in link), "changes links @kalfa/ci with its one command, with no if or continue-on-error");
  require(list.findIndex((s) => uses(s, "actions/checkout")) < position(setup) &&
    position(setup) < position(link) &&
    position(link) <
      position(classify), "changes sets up Node and links @kalfa/ci after the checkout and before the classify step");

  for (const [key, expected] of Rec.toEntries(classifier)) {
    require(map(classify?.["env"])[key] === expected, `changes passes event ${key} through env`);
  }
};
