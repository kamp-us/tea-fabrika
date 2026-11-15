// Today's CI, serving both versions. Who may touch issues (0534).
import { parse } from "yaml";
import { isMap, map } from "./shared.ts";

/**
 * 0534's binding constraint: the only issues automation opens here are the scheduled report's. No
 * workflow but scheduled.yaml grants `issues` (or `write-all`), at the top or on a job; that one
 * grants it on its report job alone, which lintScheduled holds.
 */
export const lintIssues = (workflows: Readonly<Record<string, string>>): string[] =>
  Object.entries(workflows).flatMap(([path, text]) => {
    if (path.endsWith("/scheduled.yaml")) {
      return [];
    }

    let workflow: Record<string, unknown>;

    try {
      workflow = map(parse(text));
    } catch {
      return [`${path}: invalid YAML`];
    }

    const grants = [
      workflow["permissions"],
      ...Object.values(map(workflow["jobs"])).map((job) => map(job)["permissions"]),
    ];
    return grants.some((grant) => grant === "write-all" || (isMap(grant) && "issues" in grant))
      ? [`${path}: only scheduled.yaml's report job may touch issues (0534)`]
      : [];
  });
