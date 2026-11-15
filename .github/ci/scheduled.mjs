// Today's CI, serving both versions. The scheduled run's report (0534): scheduled.yaml runs all of
// next/ and every tooling test on main every 3 hours, and its report job runs this. A red run opens
// one GitHub issue labeled `ci-scheduled` naming the commits since the last green scheduled run and
// the failing tests, or comments on the open one; a green run closes it. Those are the only issues
// automation opens on this repository (0534's exception to "no GitHub issues here").
//
//   the run           an open ci-scheduled issue   what happens
//   red               none                         open one
//   red               #n                           comment on #n
//   green             #n                           comment on #n, close it
//   green             none                         nothing
//   stopped by hand   either                       nothing
//
// No installed dependencies and no type stripping, like required.mjs, so the job runs on the
// runner's own Node with no setup. A pure core (`verdict`, `failures`, `decide`, `body`), and a thin
// GitHub reader and writer with the job's own token (`github`), as changes.mjs's.
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
 * The run's verdict from `toJSON(needs)`, already parsed. Red when any job failed: a red leg stops
 * the run (its stop step), so the other legs end `cancelled`, and the one that failed says why.
 * Green only when every job passed. Anything else, a run stopped by hand or `needs` that cannot be
 * read, is `stopped`, and reports nothing: it proved neither.
 * @param {unknown} needs
 * @returns {Verdict}
 */
export const verdict = (needs) => {
  if (!isMap(needs) || Object.keys(needs).length === 0) {
    return "stopped";
  }

  const results = Object.values(needs).map((job) => (isMap(job) ? job["result"] : undefined));

  if (results.includes("failure")) {
    return "red";
  }

  return results.every((result) => result === "success") ? "green" : "stopped";
};

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
 * }} Run
 */

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
          "Failing tests, from the leg that failed first (a red leg stops the others, so their reports are not here):",
          "",
          ...listed,
          ...(more > 0 ? [`- and ${more} more`] : []),
        ];
  return [
    `The scheduled run of every next/ and tooling test is red on main at ${run.sha} ([run](${run.run})).`,
    "",
    range(run),
    "",
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
 * @param {number | null} open the open `ci-scheduled` issue's number, or `null`
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
 * GitHub's REST API for this run's repository and workflow, with the job's own token. `null` when
 * the run gave no token, repository or workflow file.
 * @param {Record<string, string | undefined>} env
 * @param {Fetch} [send]
 * @returns {Api | null}
 */
export const github = (env, send = globalThis.fetch) => {
  const token = env["GITHUB_TOKEN"];
  const repository = env["GITHUB_REPOSITORY"];
  // `owner/repo/.github/workflows/scheduled.yaml@refs/heads/main`: the file this run started from.
  const workflow = /\/\.github\/workflows\/([^/@]+)@/.exec(env["GITHUB_WORKFLOW_REF"] ?? "")?.[1];

  if (!token || !repository || workflow === undefined) {
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
    lastGreen: async () => {
      const runs = (await call("GET", `actions/workflows/${workflow}/runs?branch=main&status=success&per_page=1`))
        .workflow_runs;
      const sha = Array.isArray(runs) && isMap(runs[0]) ? runs[0]["head_sha"] : undefined;
      return typeof sha === "string" ? sha : null;
    },
    open: async () => {
      const issues = await call("GET", `issues?labels=${LABEL}&state=open&sort=created&direction=asc&per_page=20`);
      // The issues list holds pull requests too; one with the label is not this report's.
      const issue = (Array.isArray(issues) ? issues : []).filter(isMap).find((item) => !("pull_request" in item));
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

/**
 * Decide and do it: reads the open issue and the last green run, then opens, comments or closes.
 * A run that is neither red nor green asks nothing.
 * @param {{needs: unknown, reports: readonly unknown[], env: Record<string, string | undefined>, api: Api}} options
 * @returns {Promise<Action>}
 */
export const report = async ({ needs, reports, env, api }) => {
  const result = verdict(needs);

  if (result === "stopped") {
    return { _tag: "none" };
  }

  const open = await api.open();

  if (result === "green" && open === null) {
    return { _tag: "none" };
  }

  const root = env["GITHUB_WORKSPACE"] ?? "";
  const server = env["GITHUB_SERVER_URL"] || "https://github.com";
  const repository = env["GITHUB_REPOSITORY"] ?? "";
  const run = {
    sha: env["GITHUB_SHA"] ?? "",
    last: result === "red" ? await api.lastGreen() : null,
    repository,
    server,
    run: `${server}/${repository}/actions/runs/${env["GITHUB_RUN_ID"] ?? ""}`,
    failed: failures(reports, root),
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

  return action;
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

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const api = github(process.env);

  if (api === null) {
    console.error("scheduled: no token, repository or workflow file, so nothing can be reported");
    process.exitCode = 1;
  } else {
    /** @type {unknown} */
    let needs = null;

    try {
      needs = JSON.parse(process.env["NEEDS"] ?? "");
    } catch {
      needs = null;
    }

    const action = await report({ needs, reports: readReports(process.env["RESULTS"] ?? ""), env: process.env, api });
    console.log(
      action._tag === "none" ? `scheduled: ${verdict(needs)}, nothing to report` : `scheduled: ${action._tag}`,
    );
  }
}
