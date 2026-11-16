## Rules for every step session (from the coordinator, the cloud twin)

You are ONE pipeline step for ONE slice. No subagents: do not use the Agent tool, Workflow or
create_session. Do your one step yourself, then stop and give the RESULT block below.

**Setup.** Read `AGENTS.md` and `next/AGENTS.md` first; every rule there holds. Then:

```bash
export PATH=/opt/node-v26.13.0-linux-x64/bin:$PATH   # node --version must print v26.13.0
cd <repo root> && pnpm install --frozen-lockfile
```

Put the PATH line before every command that runs node or pnpm (the shell does not keep it).
`pnpm lint:dead` aborts with SIGABRT (exit 134) in a cloud box because it runs out of heap. Run
`pnpm lint` with `NODE_OPTIONS=--max-old-space-size=6144` set, and it passes; that is not a skip.

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

**GitHub only through its MCP tool.** Open or change a pull request, its title or its body only with the GitHub MCP tools (`create_pull_request`, `update_pull_request`). Never `gh pr`, `gh api` or curl for that: in this cloud environment `gh` is for search only.

**Pull request: one per sweep, never one per slice (owner ruling).** A slice opens NO pull
request. It works on its own branch and pushes there; an integrator folds reviewed slice branches
into the sweep's one PR (`fabrikalfa/effect-mechanical`, `fabrikalfa/effect-judgment`,
`fabrikalfa/reflect-rest`, `fabrikalfa/mock-plans`, `fabrikalfa/antislop-mechanical`,
`fabrikalfa/antislop-judgment`). What a PR body would have said goes in your field row and your
RESULT instead: per check or rule, hits met, fixed by which tool, left with file:line and why,
waiting on 1366, tests run at which head, and the review's verdict. If a slice PR was opened
earlier, leave it exactly as it is. Only an integrator, or a job your brief names as its own PR
(pipe slice 1, @kalfa/config, the review checker, the flaky door law), opens a PR, as a draft, with
the pr skill, its body leakgrepped first (`leakgrep.sh --text <file>`), ending with:

```
🤖 Generated with [Claude Code](https://claude.com/claude-code)
```

Never merge, arm auto-merge, approve, close, or mark ready.

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

**Two lessons from folding E0 to E3 (PR 1462):**
- `effect-tsgo diagnostics --project` undercounts: it misses files a tsconfig reaches only by
  import (314 real sites where it said 262). Prove zero with `pnpm typecheck` (or the package's own
  typecheck) before you call a check done or write a lock, not with diagnostics alone.
- `pnpm format`'s import sort can hoist an import above a module's doc block, which then fails the
  `jsdocs` lint rule. After formatting, run `pnpm lint` and put any doc block back on top.

**Never:** a disable or `@effect-diagnostics` comment on wrong code, a list entry that lets broken
code pass, a loosened law, a `warning` level, `oxlint-tsgolint` (refused; do not work around it),
a check switched off. No personal names, machine paths or secrets in anything you write.

**Tests you may run, in this box only:** narrow vitest paths and `--changed origin/main`, under
`nice -n 15 pnpm exec vitest run --maxWorkers=3`, plus any `.integration.` law your files reach.
Never the full suite, and no `.visual.` test unless your brief names it. One `pnpm typecheck` at the end at most; for a
narrow count use `pnpm exec effect-tsgo diagnostics --format json --project <dir>/tsconfig.json`.
Say in the PR and RESULT which tests ran and at which head.

**The 0178 guard.** No box sets `FABRIKA_HOST_RUN_OWNER_APPROVED`, ever. A `.integration.` or
`.visual.` law that the guard refuses is listed in your field row and RESULT as "not run: 0178
guard", with its path. PR 1508 narrows the guard: it allows a run when `CI` is set or when
`CLAUDE_CODE_REMOTE=true` on Linux. Once your branch holds it (main after 1508, or merge
`origin/main` in), run your reached `.integration.` and `.visual.` laws in the box as usual, with no
override, and still list any the guard refuses. If your own permission check refuses any command, do
not retry it and do not look for another way: stop, and report the refusal and what it blocked in
RESULT.

**PR 1366 is merged to main (2026-11-16).** Its files are no longer off limits. Merge `origin/main` into your branch first (`git merge --no-edit origin/main`, never rebase), and every hit your slice once listed as "waiting on 1366" is now part of your slice: fix it like any other. Do not add a `LOCKED` row to
`oxlint-plugins/effect-checks.test.ts` unless your brief says so. A lock entry goes in
the package's own `tsconfig.json` under the `@effect/language-service` plugin's `overrides`, the
way pull request 1430 (E2) did, never in `tsconfig.base.json`. The tooling folders have their own
tsconfig: `.agents/tsconfig.json`, `.github/ci/tsconfig.json`, `oxlint-plugins/tsconfig.json`.

**Field row.** One `field/runs/<date>-<run>.json` per step, the same day, with real times (read
them with `TZ=America/Los_Angeles date -Iseconds` at start and end) or `null`, never made up, shaped like the rows in
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
