// Today's CI, serving both versions. The full run's report (0534): scheduled.yaml runs all of
// next/ and every tooling test on main, started by a push to main or the hourly catch-up at most
// once an hour through its gate (0581, gate.mjs), and its report job runs this. A run whose gate
// said `false` skips the report, so it leaves the issue as it was. A red run opens
// one GitHub issue labeled `ci-scheduled` naming the commits since the last green scheduled run and
// the failing tests, or comments on the open one; a green run closes it. Those are the only issues
// automation opens on this repository (0534's exception to "no GitHub issues here"), with the
// daily speed check's (0541). That one carries the same label, so the report's own issue is the
// open one with the label and its exact `TITLE`.
//
//   the run           its own open issue           what happens
//   red               none                         open one
//   red               #n                           comment on #n
//   green             #n                           comment on #n, close it
//   green             none                         nothing
//   stopped by hand   either                       nothing
//   on a branch       either                       nothing, whatever the run proved
//
// A red run ends `failure` on GitHub: no step cancels the run (workflow-lint.ts's SC4), a failed
// leg is a failed job, and a leg that runs out of time fails its test step, which holds the limit
// (SC13). The report job fails too unless the run is green, on any branch (`exitCode`), so a red
// run with no failed job, such as a leg that ended odd, still ends `failure`.
//
// No installed dependencies and no type stripping, like required.mjs, so the job runs on the
// runner's own Node with no setup. A pure core (`verdict`, `ending`, `causes`, `limits`,
// `failures`, `jobsOf`, `decide`, `body`), and a thin GitHub reader and writer with the job's own
// token (`github`), as changes.mjs's. The run is red when a step failed, whatever its job's
// conclusion says, so the reader asks for the run's jobs and steps: `needs` folds a matrix's legs
// into one result (ticket 1023). A leg that ran into its time limit is red too, and named as a
// time-out: by its failed step's own run time against the limit, or, for a leg its job's backstop
// canceled, by the leg's run time, since GitHub ends that leg `cancelled` as it ends one its
// matrix's fail-fast stopped (run 43723335863 opened no issue for two timed-out legs).
import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";

/** The one label automation's issues carry. */
export const LABEL = "ci-scheduled";

/**
 * What the run proved: every job passed, a job failed, or none failed and one was stopped.
 * @typedef {"green" | "red" | "stopped"} Verdict
 */

/** @param {unknown} value @returns {value is Record<string, unknown>} */
const isMap = (value) => typeof value === "object" && value !== null && !Array.isArray(value);

/**
 * One step of a job, as GitHub's jobs API lists it: `conclusion` is `null` while it runs, `start`
 * until it starts, and `end` until it ends.
 * @typedef {{name: string, conclusion: string | null, start: string | null, end: string | null}} Step
 */

/**
 * One job of the run, as GitHub's jobs API lists it, each matrix leg its own job. The report job is
 * one of them, still running when it reads the list. `start` and `end` are the job's own times.
 * @typedef {{
 *   name: string,
 *   status: string,
 *   conclusion: string | null,
 *   start: string | null,
 *   end: string | null,
 *   steps: readonly Step[],
 * }} Job
 */

/**
 * Each suite's test step limit, its `timeout-minutes`, by the suite (`next`, `tooling`, as
 * `suiteOf` reads a leg's). The report step's env holds them as `LIMIT_<SUITE>`, aliases of the
 * test steps' own lines, so each limit stays one line (workflow-lint.ts holds them the same, and
 * the job's own limit a backstop past each).
 * @typedef {Readonly<Record<string, number>>} Limits
 */

/**
 * What the run left: `toJSON(needs)` already parsed, the run's jobs and their steps, the failing
 * tests its legs' reports name (`failures`), and each suite's time limit.
 * @typedef {{needs: unknown, jobs: readonly Job[], failed: readonly string[], limits: Limits}} Outcome
 */

/**
 * How one finished leg ended. `failed`: a step or the job failed. `timed out`: a failed step ran
 * for its suite's limit or longer, it was canceled at or past that limit, or GitHub said
 * `timed_out`. `canceled`: it was canceled before its limit, by its matrix's fail-fast after
 * another leg failed, a person, or a sev0's freeze. `odd`: any other conclusion, which proves no
 * pass. `passed`: success, or a skip the workflow meant.
 * @typedef {"passed" | "failed" | "timed out" | "canceled" | "odd"} Ending
 */

/**
 * A leg's suite, the key of its limit: `tooling` for a leg whose shard starts `tooling-`, `next`
 * for every other. GitHub names a matrix leg `<job> (<shard>)`, and no job here sets a `name`, so
 * `tests (tooling-2)` is a tooling leg and `tests (e2e-1)` and `tests (3)` are next legs. The two
 * suites share one job since 2026-11-15, so one fail-fast stops every leg; the job's id names no
 * suite any more.
 * @param {string} name
 * @returns {"next" | "tooling"}
 */
export const suiteOf = (name) => (/\(tooling-[^)]*\)$/.test(name) ? "tooling" : "next");

/**
 * How a finished leg ended. A failed step comes first, whatever the job's conclusion: a cancel
 * that lands on a red leg ends it `cancelled` with its failed step inside (run 43703058643, from
 * when a red leg canceled its own run). A test step that ran into its `timeout-minutes` fails, the
 * same word as a red test, so its own run time tells them apart: GitHub stops it at the limit or a
 * few seconds after (probe run 43778586135: 72 s against 60). A leg its job's backstop limit
 * canceled ends `cancelled`, the same word as a leg stopped after another leg failed (run
 * 43723335863), so the leg's run time tells those apart: canceled at or past the limit is a
 * time-out. A fail-fast cancel that lands in the minute between a leg's step limit and its run time
 * reaching it also reads as one; the run is red either way. A leg whose limit or times are unknown
 * reads as failed or canceled.
 * @param {Job} job
 * @param {Limits} limits
 * @returns {Ending}
 */
export const ending = (job, limits) => {
  const limit = limits[suiteOf(job.name)];
  const ranOut = (/** @type {string | null} */ start, /** @type {string | null} */ end) =>
    limit !== undefined && start !== null && end !== null && Date.parse(end) - Date.parse(start) >= limit * 60_000;
  const failed = job.steps.filter((step) => step.conclusion === "failure");

  if (failed.some((step) => ranOut(step.start, step.end))) {
    return "timed out";
  }

  if (job.conclusion === "failure" || failed.length > 0) {
    return "failed";
  }

  if (job.conclusion === "success" || job.conclusion === "skipped") {
    return "passed";
  }

  if (job.conclusion === "timed_out") {
    return "timed out";
  }

  if (job.conclusion !== "cancelled") {
    return "odd";
  }

  return ranOut(job.start, job.end) ? "timed out" : "canceled";
};

/**
 * Why a leg made the run red, for the issue: it failed, it timed out (with its limit when known),
 * or it ended in a conclusion that proves no pass.
 * @typedef {{_tag: "failed", leg: string}
 *   | {_tag: "timed out", leg: string, minutes: number | null}
 *   | {_tag: "odd", leg: string, conclusion: string | null}} Cause
 */

/**
 * Each finished leg that made the run red, the one that failed first first: failed legs by when
 * their failed step ended, then timed-out legs, then odd ones, each in the jobs API's order. A
 * canceled leg is never a cause: when one leg failed, its matrix's fail-fast canceled the others,
 * and the issue names the leg that failed.
 * @param {readonly Job[]} jobs
 * @param {Limits} limits
 * @returns {Cause[]}
 */
export const causes = (jobs, limits) => {
  const finished = jobs.filter((job) => job.status === "completed");
  const of = (/** @type {Ending} */ end) => finished.filter((job) => ending(job, limits) === end);
  // An ISO time sorts as text; a leg with no time sorts last.
  const failedAt = (/** @type {Job} */ job) =>
    job.steps.find((step) => step.conclusion === "failure")?.end ?? job.end ?? "~";

  return [
    ...of("failed")
      .toSorted((a, b) => failedAt(a).localeCompare(failedAt(b)))
      .map((job) => /** @type {Cause} */ ({ _tag: "failed", leg: job.name })),
    ...of("timed out").map(
      (job) => /** @type {Cause} */ ({ _tag: "timed out", leg: job.name, minutes: limits[suiteOf(job.name)] ?? null }),
    ),
    ...of("odd").map((job) => /** @type {Cause} */ ({ _tag: "odd", leg: job.name, conclusion: job.conclusion })),
  ];
};

/**
 * Each suite's time limit from the report step's env: `LIMIT_NEXT=17` reads as `next: 17`. A
 * value that is not a positive number is left out, so its legs' cancels read as canceled.
 * @param {Record<string, string | undefined>} env
 * @returns {Limits}
 */
export const limits = (env) =>
  Object.fromEntries(
    Object.entries(env).flatMap(([key, value]) => {
      const minutes = Number(value ?? "");
      return key.startsWith("LIMIT_") && value !== "" && minutes > 0
        ? [[key.slice("LIMIT_".length).toLowerCase(), minutes]]
        : [];
    }),
  );

/**
 * The run's verdict. Red when a finished leg failed, timed out or ended odd (`causes`), when a
 * leg's report names a failing test, or when `needs` says a job failed. The steps come first
 * because `needs` cannot say it: it folds every leg of a matrix into one result, and a cancel that
 * lands on a red leg ends it `cancelled` with its failed step inside (run 43673342835). A report
 * names the tests; the steps also catch a
 * leg that broke before it wrote one (an install, a crash, a time limit). A `continue-on-error`
 * step that failed reads `success` in the jobs API (the runner's ApplyContinueOnError sets its
 * result to Succeeded), so a broken time table never turns a run red. With none of those, a leg
 * canceled before its limit means a person or a sev0's freeze stopped the run: `stopped`, which
 * reports nothing, since it proved neither. Green only when no leg was canceled and every job in
 * `needs` passed; `needs` that cannot be read is `stopped` too.
 * @param {Outcome} outcome
 * @returns {Verdict}
 */
export const verdict = ({ needs, jobs, failed, limits: limit }) => {
  const results = isMap(needs) ? Object.values(needs).map((job) => (isMap(job) ? job["result"] : undefined)) : [];

  if (failed.length > 0 || causes(jobs, limit).length > 0 || results.includes("failure")) {
    return "red";
  }

  const canceled = jobs.some((job) => job.status === "completed" && ending(job, limit) === "canceled");
  return !canceled && results.length > 0 && results.every((result) => result === "success") ? "green" : "stopped";
};

/**
 * The jobs API's answer (`GET /repos/{owner}/{repo}/actions/runs/{run_id}/jobs`) as plain jobs. A
 * field it lacks reads as nothing, so an answer of another shape gives no job, never a throw.
 * @param {unknown} answer
 * @returns {Job[]}
 */
export const jobsOf = (answer) => {
  const text = (/** @type {unknown} */ value) => (typeof value === "string" ? value : null);
  const list = isMap(answer) && Array.isArray(answer["jobs"]) ? answer["jobs"].filter(isMap) : [];

  return list.map((job) => ({
    name: text(job["name"]) ?? "",
    status: text(job["status"]) ?? "",
    conclusion: text(job["conclusion"]),
    start: text(job["started_at"]),
    end: text(job["completed_at"]),
    steps: (Array.isArray(job["steps"]) ? job["steps"].filter(isMap) : []).map((step) => ({
      name: text(step["name"]) ?? "",
      conclusion: text(step["conclusion"]),
      start: text(step["started_at"]),
      end: text(step["completed_at"]),
    })),
  }));
};

/**
 * Whether a run's jobs show its test legs ran: a leg `tests (<shard>)` is in the list. GitHub lists
 * a skipped matrix as one job named `tests`, with no shard (probe run 43795273918), so a run whose
 * gate said `false` is never full. The gate and `lastGreen` read runs by it. `next (<shard>)` and
 * `tooling (<shard>)` are the legs of the shape before the gate, when the two suites were two jobs:
 * every green full run on main when the gate landed has only those (run 43780996689).
 * @param {readonly Job[]} jobs
 * @returns {boolean}
 */
export const isFull = (jobs) => jobs.some((job) => /^(tests|next|tooling) \(.+\)$/.test(job.name));

/**
 * Each failing test in Vitest's JSON reports, as `file > test`, each once, in report order. A file
 * that failed with no failing test in it (an import error, a hook that threw) is listed by its
 * file alone. Paths are made relative to `root`, the checkout.
 * @param {readonly unknown[]} reports
 * @param {string} root
 * @returns {string[]}
 */
export const failures = (reports, root) => {
  /** @type {string[]} */
  const found = [];

  for (const report of reports) {
    const files = isMap(report) && Array.isArray(report["testResults"]) ? report["testResults"] : [];

    for (const file of files.filter(isMap)) {
      const name = typeof file["name"] === "string" ? file["name"] : "";
      const path = name.startsWith(`${root}/`) ? relative(root, name) : name;
      const tests = Array.isArray(file["assertionResults"]) ? file["assertionResults"].filter(isMap) : [];
      const failed = tests.filter((test) => test["status"] === "failed");

      for (const test of failed) {
        found.push(`${path} > ${typeof test["fullName"] === "string" ? test["fullName"] : "(a test with no name)"}`);
      }

      if (failed.length === 0 && file["status"] === "failed") {
        found.push(path);
      }
    }
  }

  return [...new Set(found)];
};

/** The most failing tests one issue body lists; the rest are counted. */
export const SHOWN = 50;

/**
 * What the run is: its commit, the last green scheduled run's commit (`null` when there is none),
 * where its page is, and what failed.
 * @typedef {{
 *   sha: string,
 *   last: string | null,
 *   repository: string,
 *   server: string,
 *   run: string,
 *   failed: readonly string[],
 *   causes: readonly Cause[],
 * }} Run
 */

/**
 * One line of the issue per leg that made the run red. A time-out names its limit, and says that
 * no report names the file that was running: the leg was stopped before it wrote one.
 * @param {Cause} cause
 */
const line = (cause) => {
  if (cause._tag === "failed") {
    return `- \`${cause.leg}\` failed.`;
  }

  if (cause._tag === "timed out") {
    const limit = cause.minutes === null ? "its time limit" : `its ${cause.minutes}-minute limit`;
    return `- \`${cause.leg}\` timed out: it ran into ${limit} and GitHub stopped it. A stopped test run writes no report, so none names the test file that was running; the leg's log on the run's page does.`;
  }

  return `- \`${cause.leg}\` ended \`${cause.conclusion ?? "with no conclusion"}\`, which is not a pass.`;
};

/**
 * The commit range since the last green scheduled run, as a compare link, or why there is none.
 * @param {Run} run
 */
const range = (run) => {
  const short = (/** @type {string} */ sha) => sha.slice(0, 9);

  if (run.last === null) {
    return `No scheduled run on main was green before, so no range: this run tested ${short(run.sha)}.`;
  }

  if (run.last === run.sha) {
    return `No new commit since the last green scheduled run, on the same ${short(run.sha)}: a test that fails only sometimes, or something outside the repository.`;
  }

  return `Commits since the last green scheduled run: [${short(run.last)}...${short(run.sha)}](${run.server}/${run.repository}/compare/${run.last}...${run.sha}).`;
};

/**
 * The text of a red run's issue or comment.
 * @param {Run} run
 * @returns {string}
 */
export const body = (run) => {
  const listed = run.failed.slice(0, SHOWN).map((test) => `- \`${test}\``);
  const more = run.failed.length - listed.length;
  const tests =
    run.failed.length === 0
      ? [
          "No test report names a failure: the run broke outside a test (setup, an install, a time limit), or before the red leg wrote its report. The run's page says where.",
        ]
      : [
          "Failing tests, from the legs that wrote a report (a red leg stops the other legs of its job, so theirs are not here):",
          "",
          ...listed,
          ...(more > 0 ? [`- and ${more} more`] : []),
        ];
  const legs =
    run.causes.length === 0
      ? []
      : [
          "The legs that made it red, the one that failed first first (a leg stopped because another failed is not listed):",
          "",
          ...run.causes.map(line),
          "",
        ];
  return [
    `The scheduled run of every next/ and tooling test is red on main at ${run.sha} ([run](${run.run})).`,
    "",
    range(run),
    "",
    ...legs,
    ...tests,
    "",
    `A green scheduled run closes this issue (decision 0534).`,
  ].join("\n");
};

/**
 * What the report does, by the table at the top.
 * @typedef {{_tag: "open", title: string, body: string}
 *   | {_tag: "comment", number: number, body: string}
 *   | {_tag: "close", number: number, body: string}
 *   | {_tag: "none"}} Action
 */

/** The title of the one open issue. */
export const TITLE = "Scheduled CI is red on main";

/**
 * @param {Verdict} result
 * @param {number | null} open the number of the open `ci-scheduled` issue titled `TITLE`, or `null`
 * @param {Run} run
 * @returns {Action}
 */
export const decide = (result, open, run) => {
  if (result === "red") {
    return open === null
      ? { _tag: "open", title: TITLE, body: body(run) }
      : { _tag: "comment", number: open, body: body(run) };
  }

  if (result === "green" && open !== null) {
    return { _tag: "close", number: open, body: `Green again at ${run.sha} ([run](${run.run})).` };
  }

  return { _tag: "none" };
};

/**
 * What the report asks and tells GitHub. Each call may reject, and a rejection fails the report
 * job, so a red run whose issue could not be written shows a red report too.
 * @typedef {{
 *   jobs: () => Promise<Job[]>,
 *   lastGreen: () => Promise<string | null>,
 *   open: () => Promise<number | null>,
 *   label: () => Promise<void>,
 *   create: (title: string, text: string) => Promise<void>,
 *   comment: (number: number, text: string) => Promise<void>,
 *   close: (number: number) => Promise<void>,
 * }} Api
 */

/** @typedef {(url: string, init: {method: string, headers: Record<string, string>, body?: string, signal: AbortSignal}) => Promise<{ok: boolean, status: number, json: () => Promise<any>}>} Fetch */

/**
 * GitHub's REST API for this run's repository, workflow and run, with the job's own token. `null`
 * when the run gave no token, repository, workflow file or run id.
 * @param {Record<string, string | undefined>} env
 * @param {Fetch} [send]
 * @returns {Api | null}
 */
export const github = (env, send = globalThis.fetch) => {
  const token = env["GITHUB_TOKEN"];
  const repository = env["GITHUB_REPOSITORY"];
  const id = env["GITHUB_RUN_ID"];
  // `owner/repo/.github/workflows/scheduled.yaml@refs/heads/main`: the file this run started from.
  const workflow = /\/\.github\/workflows\/([^/@]+)@/.exec(env["GITHUB_WORKFLOW_REF"] ?? "")?.[1];

  if (!token || !repository || !id || workflow === undefined) {
    return null;
  }

  const api = env["GITHUB_API_URL"] || "https://api.github.com";
  /**
   * @param {string} method
   * @param {string} path
   * @param {unknown} [data]
   * @param {readonly number[]} [also] statuses that are an answer too
   */
  const call = async (method, path, data, also = []) => {
    const response = await send(`${api}/repos/${repository}/${path}`, {
      method,
      headers: {
        accept: "application/vnd.github+json",
        authorization: `Bearer ${token}`,
        "x-github-api-version": "2022-11-28",
        ...(data === undefined ? {} : { "content-type": "application/json" }),
      },
      ...(data === undefined ? {} : { body: JSON.stringify(data) }),
      signal: AbortSignal.timeout(10_000),
    });

    if (!response.ok && !also.includes(response.status)) {
      throw new Error(`${method} ${path}: ${response.status}`);
    }

    return response.ok ? response.json() : null;
  };

  return {
    // The latest attempt's jobs, every leg its own; the run has 10, well under one page of 100.
    jobs: async () => jobsOf(await call("GET", `actions/runs/${id}/jobs?filter=latest&per_page=100`)),
    // Main's newest green run whose test legs ran: a run whose gate said `false` ends `success`
    // too, and names no tested commit (0581). One jobs call per green run stepped over.
    lastGreen: async () => {
      const answer = await call("GET", `actions/workflows/${workflow}/runs?branch=main&status=success&per_page=100`);
      const runs = isMap(answer) && Array.isArray(answer["workflow_runs"]) ? answer["workflow_runs"].filter(isMap) : [];

      for (const run of runs) {
        if (isFull(jobsOf(await call("GET", `actions/runs/${String(run["id"])}/jobs?filter=latest&per_page=100`)))) {
          return typeof run["head_sha"] === "string" ? run["head_sha"] : null;
        }
      }

      return null;
    },
    open: async () => {
      const issues = await call("GET", `issues?labels=${LABEL}&state=open&sort=created&direction=asc&per_page=20`);
      // The issues list holds pull requests too; one with the label is not this report's. The daily
      // speed check keeps an issue with the same label (0541), so the report's own is the one with
      // its own title: taking the first put a red main's report on the speed issue (2026-11-15).
      const issue = (Array.isArray(issues) ? issues : [])
        .filter(isMap)
        .find((item) => !("pull_request" in item) && item["title"] === TITLE);
      return typeof issue?.["number"] === "number" ? issue["number"] : null;
    },
    // 422: the label is there already.
    label: async () => {
      await call(
        "POST",
        "labels",
        { name: LABEL, color: "b60205", description: "The scheduled run of every test is red (decision 0534)" },
        [422],
      );
    },
    create: async (title, text) => {
      await call("POST", "issues", { title, body: text, labels: [LABEL] });
    },
    comment: async (number, text) => {
      await call("POST", `issues/${number}/comments`, { body: text });
    },
    close: async (number) => {
      await call("PATCH", `issues/${number}`, { state: "closed", state_reason: "completed" });
    },
  };
};

/** The one branch whose runs open, update or close the issue. */
const MAIN = "refs/heads/main";

/**
 * The report job's exit code: 0 for a green run alone. A red run fails the job, so the run ends
 * `failure` on GitHub even when no leg failed outright (a leg that ended odd). A `stopped` run
 * fails it too, since it proved no pass. Neither turns a run GitHub ends `cancelled` into a
 * failure: a person's cancel, or a job that hit its own limit, keeps the run `cancelled` whatever
 * a later job does (probe runs 43778362939 and 43778355238).
 * @param {Verdict} result
 * @returns {0 | 1}
 */
export const exitCode = (result) => (result === "green" ? 0 : 1);

/**
 * Decide and do it: reads the run's jobs, then the open issue and the last green run, then opens,
 * comments or closes. A run that is neither red nor green asks nothing past its jobs, and neither
 * does a run on a branch (`GITHUB_REF` is not main): it is judged, and it writes nothing.
 * @param {{needs: unknown, reports: readonly unknown[], env: Record<string, string | undefined>, api: Api}} options
 * @returns {Promise<{result: Verdict, action: Action}>}
 */
export const report = async ({ needs, reports, env, api }) => {
  const root = env["GITHUB_WORKSPACE"] ?? "";
  const failed = failures(reports, root);
  const limit = limits(env);
  const jobs = await api.jobs();
  const result = verdict({ needs, jobs, failed, limits: limit });

  if (result === "stopped" || env["GITHUB_REF"] !== MAIN) {
    return { result, action: { _tag: "none" } };
  }

  const open = await api.open();

  if (result === "green" && open === null) {
    return { result, action: { _tag: "none" } };
  }

  const server = env["GITHUB_SERVER_URL"] || "https://github.com";
  const repository = env["GITHUB_REPOSITORY"] ?? "";
  const run = {
    sha: env["GITHUB_SHA"] ?? "",
    last: result === "red" ? await api.lastGreen() : null,
    repository,
    server,
    run: `${server}/${repository}/actions/runs/${env["GITHUB_RUN_ID"] ?? ""}`,
    failed,
    causes: causes(jobs, limit),
  };
  const action = decide(result, open, run);

  if (action._tag === "open") {
    await api.label();
    await api.create(action.title, action.body);
  } else if (action._tag === "comment") {
    await api.comment(action.number, action.body);
  } else if (action._tag === "close") {
    await api.comment(action.number, action.body);
    await api.close(action.number);
  }

  return { result, action };
};

/**
 * Every Vitest report under `folder`, one per leg (download-artifact puts each in a folder of its
 * own). A missing folder or a report that does not parse is skipped.
 * @param {string} folder
 * @returns {unknown[]}
 */
const readReports = (folder) => {
  try {
    return readdirSync(folder, { recursive: true, encoding: "utf8" })
      .filter((path) => path.endsWith(".json"))
      .toSorted()
      .flatMap((path) => {
        try {
          return [JSON.parse(readFileSync(join(folder, path), "utf8"))];
        } catch {
          return [];
        }
      });
  } catch {
    return [];
  }
};

/**
 * The whole report job: the line it prints and its exit code. With no token, repository, workflow
 * file or run id nothing can be judged, which fails the job.
 * @param {Record<string, string | undefined>} env
 * @param {readonly unknown[]} reports
 * @param {Fetch} [send]
 * @returns {Promise<{line: string, code: 0 | 1}>}
 */
export const main = async (env, reports, send) => {
  const api = github(env, send);

  if (api === null) {
    return { line: "scheduled: no token, repository, workflow file or run id, so nothing can be reported", code: 1 };
  }

  /** @type {unknown} */
  let needs = null;

  try {
    needs = JSON.parse(env["NEEDS"] ?? "");
  } catch {
    needs = null;
  }

  const { result, action } = await report({ needs, reports, env, api });
  const done = action._tag === "none" ? "nothing to report" : action._tag;
  return { line: `scheduled: ${result}, ${done}`, code: exitCode(result) };
};

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const { line, code } = await main(process.env, readReports(process.env["RESULTS"] ?? ""));

  if (code === 0) {
    console.log(line);
  } else {
    console.error(line);
  }

  process.exitCode = code;
}
