// Today's CI, serving both versions. check.yaml's fail fast (ticket 990): every job but ci-required
// ends with the stop step (F1), only ci-required runs on always() (F2), the token may cancel the run
// and no job sets its own (F3), and no checkout keeps the token in .git/config (F4).
import { allSteps, compact, isStop, map, type Rule } from "./shared.ts";

export const failFast: Rule = ({ workflow, jobs }, require) => {
  // Fail fast (ticket 990). F3: the stop step's token may cancel the run, and reads no more than
  // the checkout needs. ci-required never cancels, so its own map drops `actions`.
  require(JSON.stringify(workflow["permissions"]) ===
    JSON.stringify({
      actions: "write",
      contents: "read",
    }), "F3: the workflow's token grants actions: write and contents: read, nothing more");
  require(JSON.stringify(map(jobs["ci-required"])["permissions"]) ===
    JSON.stringify({ contents: "read" }), "F3: ci-required's token reads contents alone");

  for (const [name, job] of Object.entries(jobs).filter(([name]) => name !== "ci-required")) {
    const list = allSteps(map(job));
    const cancels = list.filter((step) => typeof step["run"] === "string" && step["run"].includes("run cancel"));
    // F1. Last, so `failure()` has seen every other step of the job. The one step that cancels, so
    // no second one can stop a push to main.
    require(list.length > 0 &&
      isStop(list.at(-1) ?? {}) &&
      cancels.length === 1, `F1: ${name} ends with the stop step, its one step that cancels the run`);
    // F2. A job on `always()` survives the cancel and holds its runner to the end. Only ci-required,
    // which gives the verdict, may.
    require(!compact(map(job)["if"]).includes(
      "always()",
    ), `F2: ${name} stops with its run: only ci-required runs on always()`);
    // F3. A job's own `permissions` replaces the workflow's whole map, and its stop step needs that one.
    require(!("permissions" in map(job)), `F3: ${name} keeps the workflow's token, which its stop step needs`);
  }

  // F4. A checkout keeps the token in .git/config unless told not to, where any test or install
  // script could read it, and that token may cancel and re-run this workflow. No job pushes, and the
  // fetches read a public repository, so no checkout needs it.
  for (const [name, job] of Object.entries(jobs)) {
    for (const step of allSteps(map(job)).filter(
      (s) => typeof s["uses"] === "string" && s["uses"].startsWith("actions/checkout@"),
    )) {
      require(map(step["with"])["persist-credentials"] ===
        false, `F4: ${name}'s checkout sets persist-credentials: false, so the token stays out of .git/config`);
    }
  }
};
