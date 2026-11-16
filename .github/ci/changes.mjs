// Today's CI for both versions. No installed dependencies: changes and field can
// decide what to run before pnpm setup or cache restoration. Only the `--same` pass loads
// program.ts and its parser, after their own install, and a failed load runs all of next/.
import { spawnSync } from "node:child_process";
import { appendFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

// Today's version is frozen (0525, 0533), so no flag here starts its tests or its app end to end: there
// is no such flag, on any event. No flag starts the tooling tests either: the merge line runs none of
// them, and the schedule (scheduled.yaml) runs them all (0539).
/** @typedef {{check: boolean, typecheck: boolean, next: boolean, field: boolean, build: boolean}} Flags */
/** @typedef {(args: string[]) => {status: number | null, stdout: string}} Runner */
const all = { check: true, typecheck: true, next: true, field: true, build: true };
const trees = ["apps/", "programs/", "packs/", "wip/", "legacy/", "packages/"];
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
 * check.yaml's `paths-ignore` for a pull request: a pull request that changes only these starts no
 * run at all (ticket 988). Plan files and row files, a few of the quiet paths above. Each `*`
 * stands for any name without a `/`, as in GitHub's filters, and no other wildcard is used, so a
 * folder named `brief` under docs/plan/ is never matched. Skill prose stays out: the changes job's
 * skills check reads it. workflow-lint.ts holds check.yaml to exactly this list, and its test holds
 * every path the list matches to no heavy job here. `pnpm lint` checks the rows instead, with
 * field-check.ts's `--local`. A quest's plans live in docs/plan/quests/; the folder was
 * docs/plan/lanes/ before the rename (0546), and that path stays on the list, so a pull request
 * still open with plan files there is treated the same.
 */
export const ignored = [
  "docs/plan/*.md",
  "docs/plan/quests/*.md",
  "docs/plan/lanes/*.md",
  "field/findings/*.json",
  "field/notes/*.json",
  "field/runs/*.json",
];

/**
 * A file under .agents/skills/: no next/ test reads one. Today's only file there that is no script
 * and no prose, the lead's gc.plist, is read by the lead's tooling tests, which the schedule runs.
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
 * projects its tests read. Only these start today's build (0175), `pnpm build`. Its tests, its
 * promise checks and its e2e run on no event (0525, 0533). A file that reruns every test, such as
 * the lockfile or a root config, is not one.
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
  "next/apps/fabrika/src/build.integration.test.ts",
  "next/apps/fabrika/src/build-command.integration.test.ts",
  "next/apps/fabrika/src/instance-one-file.integration.test.ts",
  "next/packages/libfabrika/src/node/build/",
];

/** Only a next/ source file can be proven, so only it can lower what next/ needs. @param {string} path */
const provable = (path) => path.startsWith("next/") && /\.tsx?$/.test(path);

/**
 * CI's own files: the workflows, the shared setup, and CI's scripts with their tests. No next/ test
 * reads one (0534; `rg '\.github' next --glob '*.test.ts'` finds only commits.test.ts, which names
 * the glob as a string), so a change here needs none of next/. The tooling tests that read them as
 * text reach them through vitest.config.ts's `githubReads` in a local `--changed` run, and the
 * schedule runs them and all of next/.
 * @param {string} path
 */
const ci = (path) => path.startsWith(".github/");

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

  if (quiet(path) || script(path) || old(path) || experiment(path) || skill(path) || ci(path)) {
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
 * `build` is true only when a path is one of today's version's files: it gates check's
 * `pnpm build`, the slow half of check. No flag starts a tooling test: the merge line runs none
 * (0539). History that cannot be read, no path at all, or an event that is not scoped runs everything.
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
    return { ...all, field: paths.some(rows), build: touched };
  }

  // The typecheck is its own job so it answers at once, beside lint and build. It reads what check
  // reads, less the experiments, which the root tsconfig leaves out.
  return {
    check: !paths.every(quiet),
    typecheck: !paths.every((path) => quiet(path) || experiment(path)),
    next: scope(paths, event) !== "none",
    field: paths.some(rows),
    build: touched,
  };
};

/**
 * What one event runs: classify's flags. A draft pull request runs only the fast jobs: changes,
 * field, typecheck and check's lint (owner, 2026-11-11, 0134's amendment). Marking it ready starts
 * a run with `draft` false, so the full set runs on that head before it can merge. Only a pull
 * request can be a draft; on any other event, a merge queue's group and a push included, the flag
 * is ignored. No event starts a tooling test (0539): their author runs the narrow ones on the
 * laptop, and the full run (scheduled.yaml) runs them all, at most once an hour (0581).
 * @param {readonly string[] | null} paths
 * @param {string} event
 * @param {boolean} draft
 * @param {readonly string[]} [_proven] never changes a job, as in classify
 * @returns {Flags}
 */
export const jobs = (paths, event, draft, _proven = []) => {
  const flags = classify(paths, event);

  if (event === "pull_request" && draft) {
    return { ...flags, next: false, build: false };
  }

  return flags;
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
 * An artifact, as GitHub's API lists it: the fields `matched` reads.
 * @typedef {{name: string, expired: boolean, workflow_run: {id: number} | null}} Artifact
 */

/**
 * One run of this workflow, as GitHub's API reads it: the fields `vouches` reads.
 * @typedef {{
 *   event: string,
 *   status: string,
 *   conclusion: string | null,
 *   path: string,
 *   html_url: string,
 *   repository: {id: number},
 *   head_repository: {id: number} | null,
 * }} WorkflowRun
 */

/** One job of a run, as GitHub's API lists it. @typedef {{name: string, conclusion: string | null}} Job */

/**
 * What a push or a merge queue's group asks GitHub. Each call may reject, and any rejection runs
 * every job. `runs` lists this workflow's passed merge queue runs, and `commit` reads one commit's
 * tree and parents: a push asks those. `artifacts` lists the artifacts of one name, `run` reads one
 * run and `jobs` lists its jobs: a group asks those. `workflow` is this run's workflow file.
 * @typedef {{
 *   workflow: string,
 *   runs: () => Promise<readonly QueueRun[]>,
 *   commit: (sha: string) => Promise<{tree: string, parents: readonly string[]}>,
 *   artifacts: (name: string) => Promise<readonly Artifact[]>,
 *   run: (id: number) => Promise<WorkflowRun>,
 *   jobs: (id: number) => Promise<readonly Job[]>,
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
    workflow,
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
    artifacts: async (name) => (await read(`actions/artifacts?name=${encodeURIComponent(name)}&per_page=20`)).artifacts,
    run: (id) => read(`actions/runs/${id}`),
    jobs: async (id) => (await read(`actions/runs/${id}/jobs?per_page=100`)).jobs,
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
 * A push whose tree and base tree a passed queue run already tested skips the jobs that would
 * repeat it: next. check and typecheck run: they
 * are light, and typecheck saves main's tsc cache. A skip only turns a flag off.
 * @param {Flags} flags
 * @returns {Flags}
 */
const skipTested = (flags) => ({ ...flags, next: false });

// A merge queue's group whose tree a ready pull request run already tested green passes at once
// (experiment 293, change 5). GitHub runs a pull request's checks on `refs/pull/<n>/merge`: the pull
// request merged onto main as main was then. A group of one entry is the same pull request merged
// onto main as main is now. When main has not moved, both are one tree, and the group would test
// byte-identical files. But GitHub lists a pull request run under its branch's head, whose tree is
// not the one it tested, so the run records it: the changes job's record step (`--record`) uploads
// an artifact named for the tree it tested and the tree of the base it picked its tests from. A
// group asks for the artifact of its own two trees, the same pair `tested` matches for a push.

/** @typedef {Flags & {scope: Scope}} Selection */

/** The jobs whose flags a selection holds beside next, which `covers` judges with its scope. */
const flagged = /** @type {const} */ (["check", "typecheck", "field", "build"]);

/**
 * The record's artifact name: the tree a pull request run tested and the tree of its base.
 * @param {string} tree
 * @param {string} base
 */
export const recordName = (tree, base) => `tested-${tree}-${base}`;

/**
 * What a run's changes job selected, from what it printed: a job runs only when its flag is exactly
 * "true", so an empty or unknown value counts as a job that did not run. The filter names all of
 * next/ or the reader tests; anything else covers no next/ test.
 * @param {Record<string, string | undefined>} printed
 * @returns {Selection}
 */
export const selectionOf = (printed) => ({
  check: printed["check"] === "true",
  typecheck: printed["typecheck"] === "true",
  next: printed["next"] === "true",
  field: printed["field"] === "true",
  build: printed["build"] === "true",
  scope: printed["filter"] === "next/" ? "all" : printed["filter"] === readers.join(" ") ? "readers" : "none",
});

/**
 * Whether a run that selected `ran` tested at least what one that needs `needed` runs: every job
 * `needed` runs, `ran` ran, and when `needed` runs next, `ran` ran it over as much of next/ or more.
 * The two runs this compares have the same tree and the same base tree, so their next/ tests on the
 * same scope are the same files: the size step lists Vitest's `--changed` from that base over those
 * files, and a run whose size step failed ran every file.
 * @param {Selection} ran
 * @param {Selection} needed
 */
export const covers = (ran, needed) =>
  flagged.every((job) => !needed[job] || ran[job]) &&
  (!needed.next || (ran.next && rank[ran.scope] >= rank[needed.scope]));

/**
 * What a merge queue's group from `base` to `head` needs, on its first pass: its jobs and how much
 * of next/. The parser's pass and the size step only narrow it. `null` when git cannot read it.
 * @param {string} base
 * @param {string} head
 * @param {Runner} run
 * @returns {Selection | null}
 */
const groupNeeds = (base, head, run) => {
  const paths = readPaths(base, head, "merge_group", run);
  return paths === null ? null : { ...jobs(paths, "merge_group", false), scope: scope(paths, "merge_group") };
};

/**
 * A ready pull request run's record, or why it records none. The run tested TESTED (`github.sha`,
 * the merge commit) and picked its tests from BASE; CHECK to FILTER are what its changes job
 * printed. It records only when that selection covers what a merge queue group of the same two trees
 * needs, so a run that tested less never stands in for one. A draft run records nothing: it runs
 * no test. Nor does any other event, or a tree git cannot read.
 * @param {Record<string, string | undefined>} env
 * @param {Runner} [run]
 * @returns {{name: string, record: {tree: string, base: string, ran: Selection, needed: Selection}} | {name: null, reason: string}}
 */
export const record = (env, run = git) => {
  if (env["EVENT"] !== "pull_request" || env["DRAFT"] !== "false") {
    return { name: null, reason: "only a ready pull request's run records the tree it tested" };
  }

  const merge = env["TESTED"] ?? "";
  const from = env["BASE"] ?? "";
  const tree = treeOf(merge, run);
  const base = treeOf(from, run);
  const needed = groupNeeds(from, merge, run);

  if (tree === null || base === null || needed === null) {
    return { name: null, reason: "git could not read the tested tree or its base" };
  }

  const ran = selectionOf({
    check: env["CHECK"],
    typecheck: env["TYPECHECK"],
    next: env["NEXT"],
    field: env["FIELD"],
    build: env["BUILD"],
    filter: env["FILTER"],
  });

  if (!covers(ran, needed)) {
    return { name: null, reason: "this run tests less than a merge queue group of the same trees needs" };
  }

  return { name: recordName(tree, base), record: { tree, base, ran, needed } };
};

/**
 * Whether a run found through its record vouches for a group's tree: a run of this workflow on a
 * pull request from this repository, not a fork, that ended `success` with its required check
 * `ci-required` green. A draft's is `ci-required (draft)`, so a draft run never vouches.
 * @param {WorkflowRun} found
 * @param {readonly Job[]} list
 * @param {string} workflow
 */
export const vouches = (found, list, workflow) =>
  found.event === "pull_request" &&
  found.status === "completed" &&
  found.conclusion === "success" &&
  found.path === `.github/workflows/${workflow}` &&
  found.head_repository?.id === found.repository.id &&
  list.some((job) => job.name === "ci-required" && job.conclusion === "success");

/**
 * The pull request run that already tested this group's tree from its base's tree, or `null`. It
 * asks for the record of the group's two trees, then reads each run that left one. Any doubt is
 * `null`: a tree git cannot read, a rejected or malformed answer, an expired record, or no run that
 * vouches (main moved since the run, the group holds more than one entry, or the run failed).
 * @param {string} base the commit the group was built on
 * @param {string} head the group's commit
 * @param {Runner} run
 * @param {Api} api
 * @returns {Promise<{id: number, url: string, tree: string} | null>}
 */
const matched = async (base, head, run, api) => {
  const tree = treeOf(head, run);
  const from = treeOf(base, run);

  if (tree === null || from === null) {
    return null;
  }

  const name = recordName(tree, from);

  try {
    for (const artifact of await api.artifacts(name)) {
      const id = artifact.workflow_run?.id;

      if (artifact.name !== name || artifact.expired || typeof id !== "number") {
        continue;
      }

      const found = await api.run(id);

      if (vouches(found, await api.jobs(id), api.workflow)) {
        return { id, url: found.html_url, tree };
      }
    }
  } catch {
    return null;
  }

  return null;
};

/** A group a pull request run already tested runs no job but changes and ci-required. @type {Flags} */
const none = { check: false, typecheck: false, next: false, field: false, build: false };

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
 * @param {Flags} flags
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
 * change (`tested`), and then prints next off and that run's id as `tested`. On a merge queue's
 * group, it asks for a pull request run's record of the group's two trees (`matched`), and when a
 * run vouches for it prints every job off and that run's id as `tested`. With no `api`, as when the
 * run gave no token, it asks nothing. Since next is then off, `probe` is false and the parser's
 * pass does not run.
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
    const pulled =
      event === "merge_group" && paths !== null && api !== null ? await matched(base, head, run, api) : null;
    const flags = pulled !== null ? none : queued === null ? changed : skipTested(changed);

    if (queued !== null) {
      note(`merge queue run ${queued} passed this tree from the same base tree, so next skips`);
    }

    if (pulled !== null) {
      note(
        `pull request run ${pulled.url} passed tree ${pulled.tree} from the same base tree, and its tests covered this group's, so every job but changes and ci-required skips`,
      );
    }

    const worth = paths !== null && from !== null && probe(paths, event, flags, from, head, run);
    return {
      ...Object.fromEntries(Object.entries(flags).map(([job, on]) => [job, String(on)])),
      filter: filterOf(first),
      probe: String(worth),
      tested: pulled !== null ? String(pulled.id) : queued === null ? "" : String(queued),
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

/**
 * The record step's pass (`--record`): writes the record to RUNNER_TEMP's tested.json and prints its
 * artifact name as `name`, or prints an empty `name` and says why not. The upload step that follows
 * runs only on a name.
 * @param {Record<string, string | undefined>} env
 * @param {(line: string) => void} note
 * @returns {Record<string, string>}
 */
const recorded = (env, note) => {
  const made = record(env);

  if (made.name === null) {
    note(`no record of the tested tree: ${made.reason}`);
    return { name: "" };
  }

  writeFileSync(join(env["RUNNER_TEMP"] ?? tmpdir(), "tested.json"), `${JSON.stringify(made.record, null, 2)}\n`);
  note(
    `recorded tree ${made.record.tree} from base tree ${made.record.base}, for a merge queue group of the same trees`,
  );
  return { name: made.name };
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
  const recording = process.argv.includes("--record");
  const printed = recording ? recorded(process.env, note) : await outputs({ same, env: process.env, note });
  const output = `${Object.entries(printed)
    .map(([key, value]) => `${key}=${value}`)
    .join("\n")}\n`;
  process.stdout.write(output);
  const file = process.env["GITHUB_OUTPUT"];

  if (file) {
    appendFileSync(file, output);
  }

  if (
    !recording &&
    readPaths(process.env["BASE"] ?? "", process.env["HEAD"] ?? "", process.env["EVENT"] ?? "") === null
  ) {
    console.error("changes: history could not be read; every job is enabled");
    process.exitCode = 1;
  }
}
