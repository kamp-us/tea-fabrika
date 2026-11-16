// Today's CI, serving both versions. The full run's gate (0581): the first job of scheduled.yaml,
// which says whether this run starts the tests. A push to main or the hourly catch-up starts them
// only when no full run on main started within the gap (`GAP_MINUTES`, a setting beside the cron
// line), and only on a head that has had no full run; a hand start always does.
//
//   the run's event      main's head had a full run   the last one started   the gate says
//   workflow_dispatch    either                       any time               start, by_hand
//   push or schedule     yes                          any time               skip, tested
//   push or schedule     no                           within the gap         skip, too_soon
//   push or schedule     no                           before it, or never    start, due
//
// It runs while its own run holds the `scheduled` group, so every run ahead of it has ended: the
// last full run's start is read, not guessed. A full run is one whose test legs ran (`isFull`).
// A canceled full run counts for the gap, since it did start, but not for the head, since it
// proved nothing.
//
// No installed dependencies and no type stripping, like scheduled.mjs, so the job runs on the
// runner's own Node with no setup. A pure core (`decide`), a thin reader with the job's own token
// (`read`), and `main`, which writes `start=true` or `start=false` for the next jobs and one line
// for the run's summary. When GitHub cannot be read after three tries, or the read runs out of its
// deadline, the step fails and writes no `start`, so the tests do not run and the report judges the
// run red.
import { appendFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { isFull, jobsOf } from "./scheduled.mjs";

const MINUTE = 60_000;

/**
 * What the gate read: the run's event, the time, the gap in minutes, the newest full run on main
 * (`at` is when it left the queue: the earliest start of its jobs), and whether main's head has had
 * a full run that did not end `cancelled`.
 * @typedef {{
 *   event: string,
 *   now: number,
 *   gap: number,
 *   last: { id: number, sha: string, at: number } | null,
 *   tested: boolean,
 * }} Seen
 */

/**
 * What `read` answers: a Seen, and `started`, the last full run's start as GitHub wrote it (its
 * earliest job's `started_at`), for the log line, so the gate prints GitHub's own text and builds
 * no `Date`; null when there is no last run or no job of it gave a start that parses.
 * @typedef {Seen & { started: string | null }} Read
 */

/**
 * What the gate says.
 * @typedef {{ _tag: "start", reason: "by_hand" | "due" } | { _tag: "skip", reason: "tested" | "too_soon" }} Decision
 */

/**
 * The rule, by the table at the top.
 * @param {Seen} seen
 * @returns {Decision}
 */
export const decide = ({ event, now, gap, last, tested }) => {
  if (event === "workflow_dispatch") {
    return { _tag: "start", reason: "by_hand" };
  }

  if (tested) {
    return { _tag: "skip", reason: "tested" };
  }

  if (last !== null && now - last.at < gap * MINUTE) {
    return { _tag: "skip", reason: "too_soon" };
  }

  return { _tag: "start", reason: "due" };
};

/** @typedef {import("./scheduled.mjs").Fetch} Fetch */

/**
 * What the gate reaches the world through, each the real one by default: GitHub, the wait between
 * tries, and the clock.
 * @typedef {{ send?: Fetch, sleep?: (ms: number) => Promise<void>, now?: () => number }} Io
 */

/** How many times a call is tried, and the wait before each try after the first. */
const TRIES = 3;
const BACKOFF = 2000;
/** A call's own limit. */
const CALL = 10_000;
/**
 * The whole read's limit, well inside the gate step's `timeout-minutes` in scheduled.yaml: a read
 * that runs out of time fails here, loudly, so the step ends `failure` with no `start` and the
 * report judges the run red. Never the job's own limit, which ends it `cancelled`, a run a person
 * stopped (the review of pull request 1404).
 */
const DEADLINE = 90_000;

/** @param {unknown} value @returns {value is Record<string, unknown>} */
const isMap = (value) => typeof value === "object" && value !== null && !Array.isArray(value);

/**
 * Reads what the gate needs from GitHub with the job's own token: the newest full run on main, and
 * on a push or the catch-up whether main's head has had one. Rejects when the run gave no token,
 * repository or workflow file, or when a call failed three times.
 * @param {Record<string, string | undefined>} env
 * @param {Io} [io]
 * @returns {Promise<Read>}
 */
export const read = async (env, io = {}) => {
  const send = io.send ?? globalThis.fetch;
  const sleep = io.sleep ?? ((ms) => new Promise((resolve) => setTimeout(resolve, ms)));
  const now = io.now ?? Date.now;
  const token = env["GITHUB_TOKEN"];
  const repository = env["GITHUB_REPOSITORY"];
  // `owner/repo/.github/workflows/scheduled.yaml@refs/heads/main`: the file this run started from,
  // so a probe copy of the workflow reads its own runs.
  const workflow = /\/\.github\/workflows\/([^/@]+)@/.exec(env["GITHUB_WORKFLOW_REF"] ?? "")?.[1];
  const event = env["GITHUB_EVENT_NAME"] ?? "";
  const head = env["GITHUB_SHA"] ?? "";

  if (!token || !repository || workflow === undefined) {
    throw new Error("gate: no token, repository or workflow file");
  }

  const api = env["GITHUB_API_URL"] || "https://api.github.com";
  const end = now() + DEADLINE;
  const left = () => {
    const ms = end - now();

    if (ms <= 0) {
      throw new Error(`gate: the read ran out of its ${DEADLINE / 1000} s`);
    }

    return ms;
  };
  /** @param {string} path */
  const get = async (path) => {
    for (let attempt = 1; ; attempt++) {
      const limit = Math.min(CALL, left());

      try {
        const response = await send(`${api}/repos/${repository}/${path}`, {
          method: "GET",
          headers: {
            accept: "application/vnd.github+json",
            authorization: `Bearer ${token}`,
            "x-github-api-version": "2022-11-28",
          },
          signal: AbortSignal.timeout(limit),
        });

        if (!response.ok) {
          throw new Error(`GET ${path}: ${response.status}`);
        }

        return await response.json();
      } catch (error) {
        if (attempt >= TRIES) {
          throw error;
        }

        await sleep(Math.min(BACKOFF * attempt, left()));
      }
    }
  };
  // Main's finished runs of this workflow, newest first, of every event: GitHub fires only some
  // schedule slots, so no run kind is trusted to be there. `status=completed` leaves out this run
  // and every run waiting behind it; `branch=main` every hand-started branch run.
  /** @param {string} also */
  const runs = async (also) => {
    const answer = await get(`actions/workflows/${workflow}/runs?branch=main&status=completed${also}&per_page=100`);
    return (isMap(answer) && Array.isArray(answer["workflow_runs"]) ? answer["workflow_runs"] : []).filter(isMap);
  };
  // Each run's jobs are read once: the head's runs are mostly the runs the walk just read.
  /** @type {Map<string, import("./scheduled.mjs").Job[]>} */
  const asked = new Map();
  /** @param {Record<string, unknown>} run */
  const jobs = async (run) => {
    const id = String(run["id"]);
    const known = asked.get(id);

    if (known !== undefined) {
      return known;
    }

    const found = jobsOf(await get(`actions/runs/${id}/jobs?filter=latest&per_page=100`));
    asked.set(id, found);
    return found;
  };

  /** @type {Seen["last"]} */
  let last = null;
  /** @type {string | null} */
  let started = null;

  for (const run of await runs("&exclude_pull_requests=true")) {
    const found = await jobs(run);

    if (isFull(found)) {
      const starts = found.flatMap((job) =>
        job.start === null ? [] : [{ text: job.start, at: Date.parse(job.start) }],
      );
      const at = Math.min(...starts.map((start) => start.at));
      last = {
        id: Number(run["id"]),
        sha: typeof run["head_sha"] === "string" ? run["head_sha"] : "",
        at,
      };
      started = starts.find((start) => start.at === at)?.text ?? null;
      break;
    }
  }

  let tested = false;

  // A hand start always starts, so it asks nothing about the head.
  if (event !== "workflow_dispatch") {
    for (const run of await runs(`&head_sha=${encodeURIComponent(head)}`)) {
      if (run["conclusion"] !== "cancelled" && isFull(await jobs(run))) {
        tested = true;
        break;
      }
    }
  }

  left();
  return { event, now: now(), gap: Number(env["GAP_MINUTES"]), last, tested, started };
};

/**
 * The whole step: what it writes for the next jobs (`output`, for $GITHUB_OUTPUT), the run's
 * summary line (`summary`, for $GITHUB_STEP_SUMMARY), the log line, and the exit code. A failed
 * read writes no `start`, so `start` is empty: the tests skip and the report runs and judges red.
 * @param {Record<string, string | undefined>} env
 * @param {Io} [io]
 * @returns {Promise<{ code: 0 | 1, output: string, summary: string, line: string }>}
 */
export const main = async (env, io = {}) => {
  /** @type {Read} */
  let seen;

  try {
    seen = await read(env, io);
  } catch (error) {
    const why = error instanceof Error ? `${error.name}: ${error.message}` : "an unknown error";
    return { code: 1, output: "", summary: "", line: `gate: cannot read GitHub (${why})` };
  }

  const decision = decide(seen);
  const last =
    seen.last === null
      ? "no full run on main before"
      : `the last full run on main, ${seen.last.id} at ${seen.last.sha.slice(0, 9)}, started ${seen.started ?? "at a time GitHub did not give"}, ${Math.floor((seen.now - seen.last.at) / MINUTE)} minutes ago`;
  const line = `gate: ${seen.event} at ${(env["GITHUB_SHA"] ?? "").slice(0, 9)}: ${decision._tag}, ${decision.reason}; ${last}; the gap is ${seen.gap} minutes${seen.event === "workflow_dispatch" ? "" : `; the head ${seen.tested ? "has had" : "has had no"} full run`}`;
  return { code: 0, output: `start=${decision._tag === "start"}\n`, summary: `${line}\n`, line };
};

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const { code, output, summary, line } = await main(process.env);

  if (output !== "" && process.env["GITHUB_OUTPUT"]) {
    appendFileSync(process.env["GITHUB_OUTPUT"], output);
  }

  if (summary !== "" && process.env["GITHUB_STEP_SUMMARY"]) {
    appendFileSync(process.env["GITHUB_STEP_SUMMARY"], summary);
  }

  if (code === 0) {
    console.log(line);
  } else {
    console.error(line);
  }

  process.exitCode = code;
}
