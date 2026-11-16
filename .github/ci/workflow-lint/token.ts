import { Record as Rec } from "effect";
// Today's CI, serving both versions. check.yaml's M1: changes' classify step and the test jobs' time
// tables are the steps but the stop steps that get the token.
import { map, type Rule, steps, TOKEN } from "./shared.ts";
import { TIME_TABLE, TIMED_LEGS, timeTableEnv } from "./time-tables.ts";

export const token: Rule = ({ jobs }, require) => {
  const changeSteps = steps(map(jobs["changes"]));

  // M1. A push that a merge queue run already tested skips next (changes.mjs's
  // `tested`). The classify step asks GitHub with the job's own token, the workflow's (F3 holds
  // that map to actions and contents, and changes' stop step needs it whole). It and the test legs'
  // time tables, which read their own job's steps, are the steps in the workflow but the stop steps
  // that get the token. A time table counts only in a test job and only with its exact env (TT1's
  // `timeTableEnv`): the same command in another job, or beside one more variable, gets no token.
  const classify = changeSteps.find((s) => s["id"] === "diff");

  const tables = TIMED_LEGS.flatMap(([name, report]) =>
    steps(map(jobs[name])).filter(
      (s) => s["run"] === TIME_TABLE && JSON.stringify(s["env"]) === JSON.stringify(timeTableEnv(report)),
    ),
  );

  require(map(classify?.["env"])["GITHUB_TOKEN"] === TOKEN, "M1: changes' classify step gets the token");
  require(Rec.toEntries(jobs).every(([, job]) =>
    steps(map(job)).every(
      (s) => s === classify || tables.includes(s) || !/github\.token|secrets\.GITHUB_TOKEN/.test(JSON.stringify(s)),
    ),
  ), "M1: only changes' classify step and the test jobs' time tables get the token");
};
