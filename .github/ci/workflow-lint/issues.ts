import { Record as Rec, Result } from "effect";
// Today's CI, serving both versions. Who may touch issues (the merge line runs only the tests a change reaches, and a schedule runs every test; CI speed has a goal, and a daily job measures it).
import { parse } from "yaml";
import { VERDICT } from "./scheduled.ts";
import { isMap, map } from "./shared.ts";

/**
 * The three jobs that may hold the `issues` permission, each by its workflow file and its job name
 * (the merge line runs only the tests a change reaches, and a schedule runs every test; CI speed has a goal, and a daily job measures it): the full run's report and the daily speed measure, both under the `ci-scheduled`
 * label, and the hourly mutation run's heartbeat, under its own label (`mutation-heartbeat`, which switches on no sev1). lintScheduled, lintCiSpeed and lintMutation hold what each grants.
 */
const ISSUE_JOBS: Readonly<Record<string, string>> = {
  ".github/workflows/scheduled.yaml": VERDICT,
  ".github/workflows/ci-speed.yaml": "measure",
  ".github/workflows/mutation-heartbeat.yaml": "heartbeat",
};

const ISSUES_RULE =
  "only scheduled.yaml's report job, ci-speed.yaml's measure job and mutation-heartbeat.yaml's heartbeat job may touch issues (the merge line runs only the tests a change reaches, and a schedule runs every test; CI speed has a goal, and a daily job measures it; the hourly mutation run has a heartbeat)";

/** A grant that touches issues: `write-all`, or a map that names `issues`. */
const touchesIssues = (grant: unknown) => grant === "write-all" || (isMap(grant) && "issues" in grant);

/**
 * The changed-tests rule's and the CI speed goal's binding constraint: automation opens issues here from those three jobs alone. A
 * workflow-wide grant that touches issues fails in every workflow, the two included, and so does a
 * job's, unless it is one of ISSUE_JOBS asking by name; `write-all` fails there too.
 */
export const lintIssues = (workflows: Readonly<Record<string, string>>): string[] =>
  Rec.toEntries(workflows).flatMap(([path, text]) => {
    const parsed = Result.try(() => map(parse(text)));

    if (Result.isFailure(parsed)) {
      return [`${path}: invalid YAML`];
    }

    const workflow = parsed.success;

    const top = touchesIssues(workflow["permissions"]) ? [`${path}: the workflow's token: ${ISSUES_RULE}`] : [];

    const jobs = Rec.toEntries(map(workflow["jobs"]))
      .filter(([name, job]) => {
        const grant = map(job)["permissions"];

        return touchesIssues(grant) && (ISSUE_JOBS[path] !== name || grant === "write-all");
      })
      .map(([name]) => `${path}: job ${name}: ${ISSUES_RULE}`);

    return [...top, ...jobs];
  });
