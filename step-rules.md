## Rules for every step session (from the coordinator, the cloud twin)

You are ONE pipeline step for ONE slice. No subagents: do not use the Agent tool, Workflow or
create_session. Do your one step yourself, then stop and give the RESULT block below.

**Setup.** Read `AGENTS.md` and `next/AGENTS.md` first; every rule there holds. Then:

```bash
export PATH=/opt/node-v26.13.0-linux-x64/bin:$PATH   # node --version must print v26.13.0
cd <repo root> && pnpm install --frozen-lockfile
```

Put the PATH line before every command that runs node or pnpm (the shell does not keep it).

**Branch.** Work only on the branch named in your brief. If it exists on origin, fetch it and
continue from its head; if not, create it from `origin/main`. Push only to that branch.

**Committing.** There are no step keys in this box, so signing is the laptop's job:
1. `sh .agents/skills/step-commit/scripts/stepcommit.sh --commit-only <step> <ticket> "T<ticket> <step>: <subject>" <path>...`
   (its path, owner and exam checks run; nothing is signed). If it refuses for a reason other
   than a missing key or a missing box plan, obey it. If it cannot run here at all, use plain
   `git add <paths>` and `git commit` with the same subject and say so in RESULT.
2. `sh .agents/skills/lead/scripts/leakgrep.sh --commits origin/main..HEAD`: stop if it exits non-zero.
3. `git push -u origin <branch>`, retry up to 4 times on a network error.
Never amend, rebase, reset or force-push. Stage your own paths by name.

**Pull request.** If the branch has no pull request yet, the first step that pushes opens a
DRAFT one with the GitHub MCP tool `create_pull_request` (owner `kamp-us`, repo `tea-fabrika`,
base `main`, `draft: true`). Its title and body are written with the pr skill
(`.agents/skills/pr/SKILL.md`). Write the body to a file first and run
`sh .agents/skills/lead/scripts/leakgrep.sh --text <file>`; stop if non-zero. A later step that
changes what the PR says updates the body the same way (`update_pull_request`). Never merge, arm
auto-merge, approve, close, or mark ready. End the body with:

```
🤖 Generated with [Claude Code](https://claude.com/claude-code)
```

**Fixes.** Use whatever tool is fastest and correct (owner ruling, 2026-11-16): the Edit tool, the
checker's quick fix through the client on this branch, a lint autofix through `pnpm format`, or a
script or codemod you write. What stays:

- **A script or codemod lives in your scratchpad, never in the repo** (0113: no new shell or Python
  script enters it), and is never committed.
- **The PR says what changed and how:** per check, how many hits each tool fixed, and the files.
  For the quick-fix client, its `CHANGE <file>:<line>: <title>` lines are that list:

  ```bash
  git fetch -q origin fabrikalfa/twin-tools && git show FETCH_HEAD:checkerfix.mjs > "$SCRATCH/checkerfix.mjs"
  # from the package folder whose tsconfig turns the check on (write the lock first):
  node "$SCRATCH/checkerfix.mjs" <check> . <file>... | tee -a "$SCRATCH/checkerfix.log"
  ```

- **Read your whole diff before you commit.** The checker's quick fix can drop a comment inside a
  block it rewrites, and a script can hit lines it should not: put back every lost comment line (an
  `oxlint-disable-next-line` above all) and undo every change that is not a fix of your check.
- Laws and lint pass, and the review reads the whole diff.

Then `pnpm format`. If the right fix is not clear, or it would change behavior a law should hold,
do not fix that hit: list it in RESULT and in the PR.

**Never:** a disable or `@effect-diagnostics` comment on wrong code, a list entry that lets broken
code pass, a loosened law, a `warning` level, `oxlint-tsgolint` (refused; do not work around it),
a check switched off. No personal names, machine paths or secrets in anything you write.

**Tests you may run, in this box only:** narrow vitest paths and `--changed origin/main`, under
`nice -n 15 pnpm exec vitest run --maxWorkers=3`, plus any `.integration.` law your files reach.
Never the full suite, never a `.visual.` test. One `pnpm typecheck` at the end at most; for a
narrow count use `pnpm exec effect-tsgo diagnostics --format json --project <dir>/tsconfig.json`.
Say in the PR and RESULT which tests ran and at which head.

**Files you never touch:** every file in pull request 1366's diff (read it with the GitHub MCP
tool `pull_request_read`, method `get_files`, pull 1366, all pages). A hit in one of those files
is listed in the PR as waiting for the after-1366 slice. Do not add a `LOCKED` row to
`oxlint-plugins/effect-checks.test.ts` (it waits for E0, pull request 1417). A lock entry goes in
the package's own `tsconfig.json` under the `@effect/language-service` plugin's `overrides`, the
way pull request 1430 (E2) did, never in `tsconfig.base.json`. The tooling folders have their own
tsconfig: `.agents/tsconfig.json`, `.github/ci/tsconfig.json`, `oxlint-plugins/tsconfig.json`.

**Field row.** One `field/runs/<date>-<run>.json` per step, the same day, shaped like the rows in
pull request 1425 and 1430 (see `field/README.md`), committed with your step's work.

**RESULT.** Your last message ends with exactly this block, filled in:

```
RESULT
step: <tests|build|review|lead>
slice: <id>
branch: <branch>
head: <sha pushed, or none>
pr: <full URL, or none>
outcome: <pass|done|send_back|blocked>
hits: met <n>, fixed by quick fix <n>, hand edits <n>, left <n>, waiting on 1366 <n>
build_needed: <yes|no>   (tests step only: are hits left in product files?)
tests_run: <what ran, at which head>
blocked_on: <what, or none>
```
