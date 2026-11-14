// Today's CI for both versions. No installed dependencies: changes and field can
// decide what to run before pnpm setup or cache restoration. Only the `--same` pass loads
// program.ts and its parser, after their own install, and a failed load runs all of next/.
import { spawnSync } from "node:child_process";
import { appendFileSync } from "node:fs";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

/** @typedef {{check: boolean, typecheck: boolean, test: boolean, next: boolean, e2e: boolean, field: boolean, today: boolean}} Flags */
/** @typedef {(args: string[]) => {status: number | null, stdout: string}} Runner */
const all = { check: true, typecheck: true, test: true, next: true, e2e: true, field: true, today: true };
const trees = ["apps/", "programs/", "packs/", "wip/", "legacy/", "packages/"];
const helper = "next/apps/fabrika/src/exam/plant.ts";
const commits = "next/apps/fabrika/src/exam/commits.ts";
/**
 * Field rows: a direct `.jsonl` file, or anything in a log's folder, where each new row is its own
 * file (decision 0090). field-check.ts names and checks them; a misnamed file fails there.
 * @param {string} path
 */
const rows = (path) => /^field\/[^/]+\.jsonl$/.test(path) || /^field\/(?:notes|runs|findings)\//.test(path);
const readTrees = ["programs/", "fixtures/", "packages/", "next/"];
const skillTrees = [".agents/skills/", ".claude/skills/"];
/** @param {string} path */
const script = (path) => /^\.agents\/skills\/[^/]+\/scripts\//.test(path);

/** Skill prose is checked in the changes job on every event. @param {string} path */
const prose = (path) =>
  (path.startsWith(".agents/skills/") && path.endsWith(".md") && !script(path)) ||
  /^\.claude\/skills\/[^/]+$/.test(path);

const readFolders = new Set(["brief", "briefs", "prompt", "prompts"]);

/**
 * Markdown a program or test reads: briefs, prompts and fixtures are inputs.
 * @param {string} path
 */
const reads = (path) =>
  path.endsWith(".md") &&
  (readTrees.some((tree) => path.startsWith(tree)) ||
    path
      .split("/")
      .slice(0, -1)
      .some((dir) => readFolders.has(dir)));

/** @param {string} path */
const markdown = (path) => path.endsWith(".md") && !reads(path) && !skillTrees.some((tree) => path.startsWith(tree));

/** @param {string} path */
const safe = (path) => rows(path) || markdown(path);

/** @param {string} path */
const old = (path) => trees.some((tree) => path.startsWith(tree)) && !path.startsWith("packages/fabrika-design/");

/** Paths no heavy job reads: field rows, plain Markdown and skill prose. @param {string} path */
const quiet = (path) => safe(path) || prose(path);

/**
 * A file under .agents/skills/: no next/ test reads one. Today's only file there that is no script
 * and no prose, the lead's gc.plist, is read by the lead's tooling tests, so it still starts test.
 * @param {string} path
 */
const skill = (path) => path.startsWith(".agents/skills/");

/** The one experiments folder a test reads: apps/fabrika/src/pipes.test.ts reads its color scheme. */
const read = ["experiments/177-themes/schemes/"];

/**
 * A file under experiments/ that no test reads and CI does not type-check, so only lint reads it.
 * @param {string} path
 */
const experiment = (path) => path.startsWith("experiments/") && !read.some((folder) => path.startsWith(folder));

/**
 * A file of today's version: its trees, the design package today's app imports, and the toy
 * projects its tests read. Only these start today's own checks (0175): its tests, e2e and build.
 * A file that reruns every test, such as the lockfile or a root config, is not one.
 * @param {string} path
 */
const todays = (path) => (trees.some((tree) => path.startsWith(tree)) || path.startsWith("fixtures/")) && !quiet(path);

/**
 * An event whose jobs follow its changed paths, because it can read them: a pull request, a merge
 * queue's group (0174) and a push to main, whose paths are what that push brought (0175). Any
 * other event runs every job.
 * @param {string} event
 */
const scoped = (event) => event === "pull_request" || event === "merge_group" || event === "push";

/** @typedef {"none" | "readers" | "all"} Scope */

/** Lint rule files: the exam's lint tests copy the config and link the plugin folder. @param {string} path */
const lint = (path) => path === ".oxlintrc.json" || path.startsWith("oxlint-plugins/");

/**
 * The next/ tests that read source as text, lint it or bundle it (the plan for CI paths and
 * experiment 288). Every other next/ test meets a file only by importing it, and an import of a
 * file whose comments alone changed gives the same program. The next job runs these paths alone
 * when nothing else needs all of next/.
 */
export const readers = [
  "next/apps/fabrika/src/exam/",
  "next/apps/fabrika/src/settings-generated.test.ts",
  "next/apps/fabrika/src/build.test.ts",
  "next/apps/fabrika/src/build-command.test.ts",
  "next/apps/fabrika/src/instance-one-file.test.ts",
  "next/packages/libfabrika/src/node/build/",
];

/** Only a next/ source file can be proven, so only it can lower what next/ needs. @param {string} path */
const provable = (path) => path.startsWith("next/") && /\.tsx?$/.test(path);

const rank = { none: 0, readers: 1, all: 2 };

/**
 * What of next/ one path needs. A path nobody listed lands on `all`, so the list stays closed.
 * @param {string} path
 * @param {readonly string[]} proven
 * @returns {Scope}
 */
const needs = (path, proven) => {
  if (reads(path)) {
    return "all";
  }

  if (quiet(path) || script(path) || old(path) || experiment(path) || skill(path)) {
    return "none";
  }

  if (lint(path) || (provable(path) && proven.includes(path))) {
    return "readers";
  }

  return "all";
};

/**
 * What of next/ a run needs: none, the reader tests, or all of it, the widest need of any path.
 * `proven` holds the paths program.ts proved the same program; it counts only for a next/ source
 * file in `paths`. An event that is not scoped, unreadable history or no path at all needs all.
 * @param {readonly string[] | null} paths
 * @param {string} event
 * @param {readonly string[]} [proven]
 * @returns {Scope}
 */
export const scope = (paths, event, proven = []) => {
  if (!scoped(event) || paths === null || paths.length === 0) {
    return "all";
  }

  /** @type {Scope} */
  let widest = "none";

  for (const path of paths) {
    const need = needs(path, proven);

    if (rank[need] > rank[widest]) {
      widest = need;
    }
  }

  return widest;
};

/**
 * A scoped event skips a job only when every path is explicitly safe for that job.
 * Amendment 3: field's runner starts on every event; this flag gates its install
 * and row check, so Markdown in field/ alone does not install Effect.
 * `today` and `e2e` are true only when a path is one of today's version's files.
 * `test` starts the test job, which runs today's tests when `today` is true and only the tooling
 * tests when it is false. History that cannot be read, no path at all, or an event that is not
 * scoped runs everything.
 * `proven` is taken so a caller can pass what it has, and never changes a flag: a proof only narrows
 * which next/ tests run (`scope`), never whether next runs.
 * @param {readonly string[] | null} paths
 * @param {string} event
 * @param {readonly string[]} [_proven]
 * @returns {Flags}
 */
export const classify = (paths, event, _proven = []) => {
  if (!scoped(event) || paths === null || paths.length === 0) {
    return { ...all };
  }

  const touched = paths.some(todays);

  if (paths.some(reads)) {
    return { ...all, today: touched, e2e: touched, field: paths.some(rows) };
  }

  // The typecheck is its own job so it answers at once, beside lint and build. It reads what check
  // reads, less the experiments, which the root tsconfig leaves out.
  return {
    check: !paths.every(quiet),
    typecheck: !paths.every((path) => quiet(path) || experiment(path)),
    test: !paths.every(
      (path) => quiet(path) || experiment(path) || (path.startsWith("next/") && path !== helper && path !== commits),
    ),
    next: scope(paths, event) !== "none",
    e2e: touched,
    field: paths.some(rows),
    today: touched,
  };
};

/** @typedef {Flags & {build: boolean}} Jobs */

/**
 * What one event runs: classify's flags, plus `build`, the slow half of check (its promises gate
 * and `pnpm build`), which belongs to today's version and so follows `today`. A draft pull request runs only the fast jobs: changes, field, typecheck and
 * check's lint (owner, 2026-11-11, 0134's amendment). Marking it ready starts a run with
 * `draft` false, so the full set runs on that head before it can merge. Only a pull request can
 * be a draft; on any other event, a merge queue's group and a push included, the flag is ignored.
 * @param {readonly string[] | null} paths
 * @param {string} event
 * @param {boolean} draft
 * @param {readonly string[]} [_proven] never changes a job, as in classify
 * @returns {Jobs}
 */
export const jobs = (paths, event, draft, _proven = []) => {
  const flags = classify(paths, event);

  if (event === "pull_request" && draft) {
    return { ...flags, test: false, next: false, e2e: false, build: false };
  }

  return { ...flags, build: flags.today };
};

/** @param {string} sha */
export const validSha = (sha) => /^[a-f0-9]{40}$/.test(sha) && !/^0+$/.test(sha);
/** @type {Runner} */
const git = (args) => spawnSync("git", args, { encoding: "utf8", maxBuffer: 2 ** 28 });

/**
 * Where a run's change starts: a pull request's merge base; a push's before and a merge queue's
 * group's own base, the commit it was built on. `null` when it cannot be read.
 * @param {string} base
 * @param {string} head
 * @param {string} event
 * @param {Runner} run
 * @returns {string | null}
 */
const start = (base, head, event, run) => {
  if (!validSha(base) || !validSha(head)) {
    return null;
  }

  if (event !== "pull_request") {
    return base;
  }

  const merged = run(["merge-base", base, head]);

  if (merged.status !== 0) {
    return null;
  }

  const from = merged.stdout.trim();
  return validSha(from) ? from : null;
};

/**
 * No shell interpolation. PR paths start at the merge base; pushes use before, and a merge
 * queue's group uses its own base, the commit it was built on, so the diff is the group's change.
 * A rename is a deletion and an addition. NUL preserves all legal Git names.
 * @param {string} base
 * @param {string} head
 * @param {string} event
 * @param {Runner} [run]
 * @returns {string[] | null}
 */
export const readPaths = (base, head, event, run = git) => {
  const from = start(base, head, event, run);

  if (from === null) {
    return null;
  }

  const diff = run(["diff", "--no-renames", "--name-only", "-z", from, head, "--"]);

  if (diff.status !== 0 || (diff.stdout !== "" && !diff.stdout.endsWith("\0"))) {
    return null;
  }

  return diff.stdout === "" ? [] : diff.stdout.slice(0, -1).split("\0");
};

/**
 * A merge queue's run of this workflow, as GitHub's API lists it: the fields `tested` reads.
 * @typedef {{id: number, status: string, conclusion: string | null, head_sha: string, head_commit: {tree_id: string} | null}} QueueRun
 */

/**
 * What a push asks GitHub. Each call may reject, and any rejection runs every job.
 * `runs` lists this workflow's passed merge queue runs, `commit` reads one commit's tree and
 * parents, and `caches` lists the keys of main's Actions caches that start with a prefix.
 * @typedef {{
 *   runs: () => Promise<readonly QueueRun[]>,
 *   commit: (sha: string) => Promise<{tree: string, parents: readonly string[]}>,
 *   caches: (prefix: string) => Promise<readonly string[]>,
 * }} Api
 */

/** @typedef {(url: string, init: {headers: Record<string, string>, signal: AbortSignal}) => Promise<{ok: boolean, status: number, json: () => Promise<any>}>} Fetch */

/**
 * GitHub's REST API for this run's repository and workflow, read with the job's own token.
 * `null` when the run gave no token, repository or workflow file: then no push asks, and every job
 * runs. Only the changes job's classify step is given the token (workflow-lint.ts holds that).
 * @param {Record<string, string | undefined>} env
 * @param {Fetch} [get]
 * @returns {Api | null}
 */
export const github = (env, get = globalThis.fetch) => {
  const token = env["GITHUB_TOKEN"];
  const repository = env["GITHUB_REPOSITORY"];
  // `owner/repo/.github/workflows/check.yaml@refs/heads/main`: the file this run started from.
  const workflow = /\/\.github\/workflows\/([^/@]+)@/.exec(env["GITHUB_WORKFLOW_REF"] ?? "")?.[1];

  if (!token || !repository || workflow === undefined) {
    return null;
  }

  const api = env["GITHUB_API_URL"] || "https://api.github.com";
  /** @param {string} path */
  const read = async (path) => {
    const response = await get(`${api}/repos/${repository}/${path}`, {
      headers: {
        accept: "application/vnd.github+json",
        authorization: `Bearer ${token}`,
        "x-github-api-version": "2022-11-28",
      },
      signal: AbortSignal.timeout(10_000),
    });

    if (!response.ok) {
      throw new Error(`GET ${path}: ${response.status}`);
    }

    return response.json();
  };

  return {
    runs: async () =>
      (
        await read(
          `actions/workflows/${workflow}/runs?event=merge_group&status=success&exclude_pull_requests=true&per_page=50`,
        )
      ).workflow_runs,
    commit: async (sha) => {
      const commit = await read(`git/commits/${sha}`);
      return { tree: commit.tree.sha, parents: commit.parents.map((/** @type {{sha: string}} */ p) => p.sha) };
    },
    caches: async (prefix) =>
      (
        await read(`actions/caches?ref=refs%2Fheads%2Fmain&key=${encodeURIComponent(prefix)}&per_page=100`)
      ).actions_caches.map((/** @type {{key: string}} */ cache) => cache.key),
  };
};

/** @param {string} sha @param {Runner} run @returns {string | null} */
const treeOf = (sha, run) => {
  if (!validSha(sha)) {
    return null;
  }

  const tree = run(["rev-parse", "--verify", "--quiet", `${sha}^{tree}`]);
  const id = tree.stdout.trim();
  return tree.status === 0 && validSha(id) ? id : null;
};

/**
 * The merge queue run that already tested what this push brings, or `null`. A queue run counts
 * only when it passed, its head has the push's tree, and its head's first parent, the commit the
 * queue built it on, has the tree main held before the push. Same base tree and same head tree
 * give the same changed paths and the same `--changed` tests, so its jobs were this push's jobs on
 * the same files. The match is by tree, never by commit message. Any doubt is `null`: a tree git
 * cannot read, a rejected or malformed answer, or no such run (an admin merge, a direct push, a
 * queue run that failed or was canceled, or a push of more than one queue entry at once).
 * @param {string} before what main held before the push
 * @param {string} head the push's commit
 * @param {Runner} run
 * @param {Api} api
 * @returns {Promise<number | null>}
 */
const tested = async (before, head, run, api) => {
  const tree = treeOf(head, run);
  const from = treeOf(before, run);

  if (tree === null || from === null) {
    return null;
  }

  try {
    for (const queued of await api.runs()) {
      if (queued.status !== "completed" || queued.conclusion !== "success" || queued.head_commit?.tree_id !== tree) {
        continue;
      }

      const [base] = (await api.commit(queued.head_sha)).parents;

      if (base !== undefined && validSha(base) && (await api.commit(base)).tree === from) {
        return queued.id;
      }
    }
  } catch {
    return null;
  }

  return null;
};

/**
 * Whether main holds an Electron cache for this lockfile, the one the e2e job saves on main only:
 * a key `electron-<os>-<arch>-<lock>`, where `lock` is `hashFiles('pnpm-lock.yaml')`. An
 * unreadable answer is `false`, so e2e runs and saves one.
 * @param {string} lock
 * @param {Api} api
 */
const warm = async (lock, api) => {
  if (!/^[a-f0-9]{64}$/.test(lock)) {
    return false;
  }

  try {
    return (await api.caches("electron-")).some((key) => key.startsWith("electron-") && key.endsWith(`-${lock}`));
  } catch {
    return false;
  }
};

/**
 * A push whose tree and base tree a passed queue run already tested skips the jobs that would
 * repeat it: test, next and e2e. e2e still runs when main has no Electron cache for this lockfile,
 * since only e2e on main saves one. check and typecheck run: they are light, and typecheck saves
 * main's tsc cache. A skip only turns a flag off.
 * @param {Jobs} flags
 * @param {boolean} cached
 * @returns {Jobs}
 */
const skipTested = (flags, cached) => ({ ...flags, test: false, next: false, e2e: flags.e2e && !cached });

/** What the next job runs: its path argument, the reader tests or all of next/. @param {Scope} need */
const filterOf = (need) => (need === "readers" ? readers.join(" ") : "next/");

/**
 * The paths a proof could lower: next/ paths that need all of next/ only because nobody proved
 * them. Proving any other path changes nothing.
 * @param {readonly string[]} paths
 */
const candidates = (paths) => paths.filter((path) => path.startsWith("next/") && needs(path, []) === "all");

/** A changed line that starts like a comment, or is blank. @param {string} line */
const commentLike = (line) => /^\s*(?:\/\/|\/\*|\*|$)/.test(line);

/**
 * Whether the parser is worth installing: next would run all of next/, proving every candidate
 * would lower that to the readers, and every changed line of every candidate starts like a comment
 * or is blank, from `git diff -U0`. It decides no skip; only the parser's pass can.
 * @param {readonly string[]} paths
 * @param {string} event
 * @param {Jobs} flags
 * @param {string} from
 * @param {string} head
 * @param {Runner} run
 */
const probe = (paths, event, flags, from, head, run) => {
  const files = candidates(paths);

  if (
    !flags.next ||
    files.length === 0 ||
    !files.every(provable) ||
    scope(paths, event) !== "all" ||
    scope(paths, event, files) !== "readers"
  ) {
    return false;
  }

  const diff = run(["diff", "-U0", "--no-color", "--no-ext-diff", "--no-renames", from, head, "--", ...files]);

  if (diff.status !== 0) {
    return false;
  }

  // A file header runs from `diff --git` to its first `@@`; a header that adds, deletes or calls
  // the file binary leaves nothing to prove.
  let header = false;

  for (const line of diff.stdout.split("\n")) {
    if (line.startsWith("diff ")) {
      header = true;
    } else if (line.startsWith("@@")) {
      header = false;
    } else if (header) {
      if (/^(?:new file|deleted file|Binary files)/.test(line)) {
        return false;
      }
    } else if ((line.startsWith("+") || line.startsWith("-")) && !commentLike(line.slice(1))) {
      return false;
    }
  }

  return true;
};

/** The parser's version, for the run's record; this pass alone has it installed. */
const parserVersion = () => {
  try {
    return String(createRequire(import.meta.url)("oxc-parser/package.json").version);
  } catch {
    return "unknown";
  }
};

/**
 * What one pass prints. The first pass (`same` false) needs no install: every job's flag, then
 * `filter` from the paths alone and `probe`. The parser's pass (`same` true) runs after the
 * parser's install and prints `next` and `filter` again, with the paths program.ts proved; when
 * program.ts cannot load, it prints what the first pass printed, so a failed install runs every
 * next/ test. `note` hears one line per candidate file and the parser's version.
 * On a push, the first pass also asks `api` whether a merge queue run already passed the same
 * change (`tested`), and then prints test, next and e2e off and that run's id as `tested`. With no
 * `api`, as when the run gave no token, it asks nothing. Since next is then off, `probe` is false
 * and the parser's pass does not run.
 * @param {{same: boolean, env: Record<string, string | undefined>, run?: Runner, load?: () => Promise<{samePaths: (base: string, head: string, paths: readonly string[], run: Runner, note?: (path: string, verdict: string) => void) => string[]}>, note?: (line: string) => void, api?: Api | null}} options
 * @returns {Promise<Record<string, string>>}
 */
export const outputs = async ({
  same,
  env,
  run = git,
  load = () => import("./program.ts"),
  note = () => {},
  api = github(env),
}) => {
  const event = env["EVENT"] ?? "";
  const base = env["BASE"] ?? "";
  const head = env["HEAD"] ?? "";
  const paths = readPaths(base, head, event, run);
  // `github.event.pull_request.draft`: "true" on a draft, "false" or empty otherwise. Anything but
  // "true" runs the full set, so a value we cannot read never skips a job.
  const changed = jobs(paths, event, env["DRAFT"] === "true");
  const from = start(base, head, event, run);
  const first = scope(paths, event);

  if (!same) {
    const queued = event === "push" && paths !== null && api !== null ? await tested(base, head, run, api) : null;
    const flags =
      queued === null || api === null
        ? changed
        : skipTested(changed, changed.e2e && (await warm(env["LOCK"] ?? "", api)));

    if (queued !== null) {
      note(`merge queue run ${queued} passed this tree from the same base tree, so test and next skip`);
      note(
        flags.e2e
          ? "e2e runs: main has no Electron cache for this lockfile, and only e2e on main saves one"
          : "e2e skips",
      );
    }

    const worth = paths !== null && from !== null && probe(paths, event, flags, from, head, run);
    return {
      ...Object.fromEntries(Object.entries(flags).map(([job, on]) => [job, String(on)])),
      filter: filterOf(first),
      probe: String(worth),
      tested: queued === null ? "" : String(queued),
    };
  }

  const stand = { next: String(changed.next), filter: filterOf(first) };

  if (paths === null || from === null) {
    return stand;
  }

  let program;

  try {
    program = await load();
  } catch (error) {
    note(
      `the parser could not load, so every next/ test runs: ${error instanceof Error ? error.message : String(error)}`,
    );
    return stand;
  }

  note(`oxc-parser ${parserVersion()}`);
  const proven = program.samePaths(from, head, candidates(paths), run, (path, verdict) => note(`${path}: ${verdict}`));
  return {
    next: String(jobs(paths, event, env["DRAFT"] === "true", proven).next),
    filter: filterOf(scope(paths, event, proven)),
  };
};

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const same = process.argv.includes("--same");
  const summary = process.env["GITHUB_STEP_SUMMARY"];
  /** @param {string} line */
  const note = (line) => {
    process.stdout.write(`${line}\n`);

    if (summary) {
      appendFileSync(summary, `- ${line}\n`);
    }
  };
  const printed = await outputs({ same, env: process.env, note });
  const output = `${Object.entries(printed)
    .map(([key, value]) => `${key}=${value}`)
    .join("\n")}\n`;
  process.stdout.write(output);
  const file = process.env["GITHUB_OUTPUT"];

  if (file) {
    appendFileSync(file, output);
  }

  if (readPaths(process.env["BASE"] ?? "", process.env["HEAD"] ?? "", process.env["EVENT"] ?? "") === null) {
    console.error("changes: history could not be read; every job is enabled");
    process.exitCode = 1;
  }
}
