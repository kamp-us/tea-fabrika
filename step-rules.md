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

**Every PR body has a `## New names` section (0587; since PR 1454, `land.ts` refuses to arm without it).** List each new exported name the PR adds, with its industry word and a source (a page URL and section), one line each; or write "None." when the PR adds no exported name. Any step that writes or updates a PR body keeps this section true for the diff.

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
RESULT. A permission check that errors with NO verdict (an outage, not a decision) is different: after a
pause, one fresh retry of the same command is allowed; if it errors again, stop and report.

**Plain git, one command per call.** The worktree-isolation check refuses git it cannot prove stays
inside your worktree (seen twice on 2026-11-16: git in a `for` loop with `$(...)` after
`cd ... ||`, and `git -C .`). Run every git command as its own plain call from the worktree root:
no `cd`, no `-C`, no loop, no `$(...)`, no `&&` chain of git commands. Look at files with the Read
and Grep tools, not with shell loops over `git show`. Edit and create files only with the Edit and
Write tools: never a heredoc, `python`, `node -e`, `sed -i` or a shell redirect (refused a third
time the same day, for `python3 <<EOF || node -e`). A command that is not git also must not carry
the word `git` in an argument, a quoted path included: a `node` call whose argument named
skillscheck's path holding `git` was refused the same way (fourth sighting). Run the script by a
path or package script that does not contain it, or ask the coordinator. Never spell a path with a
glob or pattern (`commits-g*chain`) to avoid a word a rule names: that is a way around the rule,
and the classifier refused it as "Undermining Oversight". Edit such a file with the Edit tool only. This is the check's own
instruction, not a work-around; a refusal after it is still a stop.

**A box is small.** In one cloud box, at most two code agents run at once, and only one of them
runs `pnpm lint` or `pnpm typecheck` at a time. With more, the memory limit kills parts of the run
(tsgo parts lost to the out-of-memory kill, and `lint:dead`, `lint:promise-types` and `lint:kind`
dying with EPIPE; both seen 2026-11-16), and the run reads as red for no code reason. A part that
dies that way is run again alone before anyone calls it red.

**The big-PR stack (owner, 2026-11-16).** The merge session builds and lands three PRs as a
stack: 1501 (`fabrikalfa/effect-mechanical`) on main, then 1507
(`fabrikalfa/antislop-mechanical`) on 1501, then 1301 (TestDatabase) on 1507. They stop
re-merging main. Never push to `fabrikalfa/effect-mechanical` or `fabrikalfa/antislop-mechanical`
while the stack is built; a change there goes to the twin, which mails the merge session first.
Effect mechanical round 2 bases on `fabrikalfa/effect-mechanical`, and any anti-slop mechanical
follow-up on `fabrikalfa/antislop-mechanical`, never on main. A judgment slice keeps its own branch,
and folds onto the stack's top only once the stack lands, never onto a stale main.

**A branch takes main once (2026-11-16).** Merge `origin/main` into a branch only right before its
proof run or its fold, never as a habit and never to stay current. To check for conflicts, fetch
main and run `git merge-tree` without merging. A step whose brief says "merge origin/main first"
reads that as: only when this step is the proof run or the fold. Otherwise it works on the branch
as it is.

**The sev0 comes first (owner, 2026-11-16).** The sev0 ends when every fix on its list merges.
Nothing off that list starts. Building @kalfa/cli, records, ci, vitest and oxlint as new published
packages (the list's item 15) moves to right after the sev0; @kalfa/config slice 1 stays and
finishes. A sev0 fix that only lives in one of those packages stays on the list: 0580's law options
on @kalfa/vitest (item 8) keeps going. A session already building one of the five new packages
parks at a clean point: its branch pushed, a field row saying where it stands. A free seat goes, in this
order, to: (1) a fold, or a fix round of a finished slice; (2) the slice that unblocks a fold, the
last one missing from a sweep; (3) a new slice.

**Fetch full history first (2026-11-16).** A cloud box's clone can be shallow. Before any
ancestry, root or commit-range check (`merge-base --is-ancestor`, `rev-list --max-parents=0`,
`rev-list --count`, `leakgrep.sh --commits A..B`), run `git rev-parse --is-shallow-repository`, and
where it prints true, `git fetch --unshallow origin`. A shallow clone once made main look like it
had a second root and 2,202 missing commits; in a full clone main and the stack share one root,
`6e9a51046`. That alarm was false.

**Leak checks on the stack.** The stack lands by squash merge only. A branch built on the stack
runs leakgrep twice: on the lines that land, added lines only
(`git diff -U0 origin/main...HEAD | grep '^+' | grep -v '^+++' > <scratch file>`, then
`leakgrep.sh --text <scratch file>`), and on its own commits (`leakgrep.sh --commits <its base>..HEAD`).
A plain `git diff` carries 3 context lines, and `--text` scans the whole file, so a moved blank line
beside an old fixture drags that line in. The gate still fails closed on any hit in added lines.

**`@effect-diagnostics` ignore lines in a judgment slice (lead ruling, 2026-11-16, after 0589's
no lock lines).** Take an ignore line out only where `pnpm typecheck` reports TS377000 "directive
has no effect" for it: the check is off there, so the line does nothing yet. Where the check is
already on, for example because a mechanical slice locked it, a reasoned ignore line does real work
and stays. In both cases, list the line in the run row: its file:line, and the exact ignore line
with its reason. The judgment sweep's final lock PR adds every line that was taken out, together
with the locks.

**Recount Effect checks with `effect-tsgo tsc`, never `diagnostics --project` (2026-11-16, third
sighting).** `effect-tsgo diagnostics --project` skips files that a tsconfig reaches only by
import, so its "0" can be wrong: E37's row said 0, and 117 hits remained in 15 `.agents/` files.
Every recount, and every review's recount, uses `effect-tsgo tsc` with a scratch tsconfig outside
the repo. That tsconfig extends the project's own and sets only the slice's check at error. A lock
commit recounts this way over every folder it locks, before it adds a line.

**A folder a slice brings to zero (merge session ruling, 2026-11-16).** A judgment slice adds no
lock line, so when it brings a whole folder to zero, `oxlint-plugins/lint.ts` asks to add that
folder to the rule's block, and that one lint part stays red on the slice branch. That is
expected: list the ask in RESULT. The sweep's integrator adds every such entry in one lock commit,
reviewed alone, before the fold lands.

**Folds roll in batches.** Each sweep has one integrator branch. When 5 or more reviewed slices of
a sweep sit unfolded, its integrator folds them (merge, never rebase), and the twin mails the head
for the merge session to stack.

**No slice opens a pull request (one PR per sweep, 0589).** A slice pushes its branch and ends with
its RESULT. Its integrator folds it into the sweep's one PR. A slice brief that says to open or
update a PR is overridden by this line.

**After a worktree agent moves its checkout to the branch head,** check `git status`. If the index
or files still hold the old content, restore them with `git checkout HEAD -- <paths>` before you
read or test anything (seen twice on 2026-11-16).

**PR 1366 is merged to main (2026-11-16).** Its files are no longer off limits. If your branch does not hold it yet, it takes main once, by the rule "A branch takes main once" above (`git merge --no-edit origin/main`, never rebase), and every hit your slice once listed as "waiting on 1366" is now part of your slice: fix it like any other. Do not add a `LOCKED` row to
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
