// Today's CI, serving both versions. Who may touch issues (0534, 0541).
import { parse } from "yaml";
import { VERDICT } from "./scheduled.ts";
import { isMap, map } from "./shared.ts";

/**
 * The two jobs that may hold the `issues` permission, each by its workflow file and its job name
 * (0534, 0541): the 3-hour run's report and the daily speed measure, both under the `ci-scheduled`
 * label. lintScheduled and lintCiSpeed hold what each grants.
 */
const ISSUE_JOBS: Readonly<Record<string, string>> = {
  ".github/workflows/scheduled.yaml": VERDICT,
  ".github/workflows/ci-speed.yaml": "measure",
};

const ISSUES_RULE = "only scheduled.yaml's report job and ci-speed.yaml's measure job may touch issues (0534, 0541)";

/** A grant that touches issues: `write-all`, or a map that names `issues`. */
const touchesIssues = (grant: unknown) => grant === "write-all" || (isMap(grant) && "issues" in grant);

/**
 * 0534's and 0541's binding constraint: automation opens issues here from those two jobs alone. A
 * workflow-wide grant that touches issues fails in every workflow, the two included, and so does a
 * job's, unless it is one of ISSUE_JOBS asking by name; `write-all` fails there too.
 */
export const lintIssues = (workflows: Readonly<Record<string, string>>): string[] =>
  Object.entries(workflows).flatMap(([path, text]) => {
    let workflow: Record<string, unknown>;

    try {
      workflow = map(parse(text));
    } catch {
      return [`${path}: invalid YAML`];
    }

    const top = touchesIssues(workflow["permissions"]) ? [`${path}: the workflow's token: ${ISSUES_RULE}`] : [];
    const jobs = Object.entries(map(workflow["jobs"]))
      .filter(([name, job]) => {
        const grant = map(job)["permissions"];
        return touchesIssues(grant) && (ISSUE_JOBS[path] !== name || grant === "write-all");
      })
      .map(([name]) => `${path}: job ${name}: ${ISSUES_RULE}`);
    return [...top, ...jobs];
  });
