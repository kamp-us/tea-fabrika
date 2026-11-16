
Plancheck-Version: 3

# Plan: the last fifteen shell and Python scripts become TypeScript and Effect, behind services with a test layer, and lint refuses a new one (ticket 766)

This is our tooling: `.agents/`, the root lint list, two CI files. Today's app, `next/` and product
code are not touched. It builds [0113](../../../.decisions/0113-no-shell-or-python-scripts.md) (port
every script, behind services with a real and a test layer, and a lint check that refuses a new
one), under [0589](../../../.decisions/0589-agents-edit-files-with-any-tool.md) (a sweep lands as
few pull requests, never one per slice), [0033](../../../.decisions/0033-agents-code-follows-next-rules.md)
(lead tooling follows `next/`'s code rules), [0040](../../../.decisions/0040-existing-tools-before-hand-written.md)
and [0587](../../../.decisions/0587-new-helpers-and-names-cite-sources.md) (name the tools searched),
[0524](../../../.decisions/0524-no-list-lets-broken-code-pass.md) (no list lets broken code pass) and
[0408](../../../.decisions/0408-skills-keep-only-judgment.md) (a rule code checks leaves the prose).
`scripts/typecheck.sh` is its own job (branch `fabrikalfa/port-typecheck`) and is left out, except
where an order below depends on it.

```ts
// The whole idea, a sketch. Before: leakgrep.sh, a shell file that runs 200 lines of Python,
// tested only by starting sh, python3 and git for every generated case.
//   sh .agents/skills/lead/scripts/leakgrep.sh --text plan.md
// After: the same command line, in TypeScript; the logic is a pure function, and what it touches
// (git, files, the leak-word file) is a service with a real layer and a test layer.
//   node .agents/skills/lead/scripts/leakgrep.ts --text plan.md
export const scan = (text: string, mode: Mode, draft?: string): Scan => { /* pure, today's rules */ };
export class Commits extends Context.Service<Commits, {
  readonly list: (revs: ReadonlyArray<string>) => Effect.Effect<ReadonlyArray<Commit>, GitError>;
  readonly diff: (from: string, to: string) => Effect.Effect<string, GitError>;
}>()("lead/git/Commits") {}
// GitProcess.layer runs real git through pr/command.ts's `run`; GitTest.layer answers from a
// model in memory, so the generated cases start no process (0113's binding constraint).

// And the hold, a lint step: a tracked .sh or .py file fails `pnpm lint` unless it is on a list
// that only shrinks, or carries one edge line with its reason, as .github/ci/apt.sh will.
```

## Doubts, read these first

- **Where the five checks land (75%).** [0585](../../../.decisions/0585-kalfa-is-six-domain-packages.md)
  (2026-11-15) puts leakgrep, loosening, governance, skillscheck and redact into `@kalfa/ci/checks`,
  and says a shell or Python check "becomes TypeScript and Effect as it moves". 0113 (2026-11-11)
  says port now. The `@kalfa/ci` build waits for the sev0's tail, so this plan ports them in place,
  under `.agents/`, in the shape a `@kalfa/ci/checks` subpath takes (an `effect/cli` command per
  check, its services in their own files), so the later move is a `git mv`. Open question 1.
- **0585 says the step runner (`box`, `mutbox`, `chain`, `drive`) gets fixes only (80%).** 0113
  names `box.sh` itself as the first port, and its binding constraint covers every tracked script.
  A port that keeps every command line and law is read here as allowed. Open question 1 asks too.
- **The exam-path matcher (75%).** `exam.py` and `next/apps/fabrika/src/exam/commits.ts` read the
  same `exam-paths.json` with two hand-written glob translators that differ in two cases (see
  Findings). The lean is one matcher, the exam's: `exam.ts` imports `examMatcher` from `commits.ts`,
  so the step tools and CI's commits check can never disagree. Both differences make more paths
  exam paths, never fewer, so no law loosens. What would settle it: the lead's yes at approval.
- **The mutation container's entry runs before `pnpm install` (70%).** Open question 2.

## What changes, in one paragraph

Fifteen scripts, 2,230 lines, become TypeScript and Effect: eight are shell wrapping Python, two
are Python files, five are plain shell. Each is one slice with its own tests, build and review
steps in its box. The slices fold into **three integrator pull requests**, cut by what they touch:
the leaves first (nothing on the commit path), then the commit path (the five tools every step
commit and push runs), then the box and mutation runner. Each port keeps its command line
(arguments, stdout and stderr lines, exit codes); only `sh <name>.sh` becomes `node <name>.ts`, and
every caller changes in the same integrator. A new lint step refuses any tracked `.sh` or `.py`
file outside a list that only shrinks; `.github/ci/apt.sh` stays as 0113's edge, marked on its own
line. When the last integrator and the typecheck port have landed, the list is empty and is
deleted with its reader's list code.

## What is there today

Read on `origin/main` at `bcad008`, with `git ls-files '*.sh' '*.py' | xargs wc -l`: 17 files.
This plan covers 15. No tracked file is outside the brief's list, so no open question comes from it.

| Script | Lines | Inside | Today's laws (files, `it` count) |
|---|---|---|---|
| `lead/scripts/box.sh` | 412 | Python | `box.test.ts` (45), plus `drive.test.ts` and `chain.test.ts` calls |
| `lead/scripts/loosening.sh` | 420 | Python | `loosening.test.ts` (30) |
| `plan/scripts/plancheck.sh` | 312 | Python | `plancheck.test.ts` (12), `plancheck.draft.test.ts` (17) |
| `lead/scripts/leakgrep.sh` | 219 | Python | five `leakgrep*.test.ts` files (42) |
| `lead/scripts/skillscheck.sh` | 219 | Python | `skillscheck.test.ts` (9) |
| `step-commit/scripts/stepcommit.sh` | 177 | Python | `stepcommit.test.ts` (20) |
| `lead/scripts/redact.sh` | 124 | Python | `redact.test.ts` (7) |
| `mutation/scripts/run.sh` | 87 | shell, Node inline | `mutation/scripts/run.test.ts` (11), `scripts/caps.test.ts` reads it as text |
| `lead/scripts/mutbox-entry.sh` | 81 | shell | `mutbox.test.ts` (29), which imports it `?raw` |
| `lead/scripts/governance.sh` | 60 | Python | none |
| `lead/scripts/fieldrow.py` | 40 | Python | through `box.test.ts` and `chain.test.ts` |
| `lead/scripts/keepruns.sh` | 33 | shell | `keepruns.test.ts` (2), the box rm suite on real git |
| `lead/scripts/env.sh` | 22 | shell, sourced | through every caller |
| `step-commit/scripts/exam.py` | 17 | Python | through `stepcommit.test.ts` and the plancheck tests |
| `lead/scripts/runplan.sh` | 11 | shell | named in `box.test.ts` and `skillscheck.test.ts` |

All paths above are under `.agents/skills/`. Three of them are exam paths in `exam-paths.json`
(`leakgrep.sh`, `loosening.sh`, `skillscheck.sh`), so their ports are the tests step's to write,
and their `exam-paths.json` rows move to the `.ts` files in the same slice.

Open pull requests that touch these files, read on 2026-11-16 by fetching all 74 open heads:
only https://github.com/kamp-us/tea-fabrika/pull/1454 (0587's checks) changes `plancheck.sh` and
its two tests. Pull requests 1462, 1480 and 1485 change `mutbox.test.ts` and `mutbox.ts` (Effect
checks), not the entry script. The branch `fabrikalfa/port-typecheck` is not on origin yet.

## How others do it

- **Effect's own way to run a process.** The installed Effect is 4.1.3 (the lockfile). Its
  `AGENTS.md` (in the installed package, read whole) points child processes at the
  `effect/process` modules, `ChildProcess` and `ChildProcessSpawner`, and command lines at
  `effect/cli`. This repo already runs every process layer through one helper,
  `.agents/skills/lead/scripts/pr/command.ts` (`run`: stdout, stderr and the exit code, scoped),
  which `sev/scripts` imports across skill folders. Every slice reuses it.
- **Effect's file system and clock.** `FileSystem` (with `FileSystem.layerNoop` for a test layer,
  `FileSystem.d.ts:543`) and `Clock` (with `TestClock`) are the platform's own services. A slice
  that touches files or the time uses them, never `node:fs` or `Date.now()`.
- **The service shape is already in the repo.** `pr/Branches.ts` (contract only, 0095),
  `pr/BranchesGit.ts` (real git) and `pr/BranchesTest.ts` (a model in memory); `box/BoxGit.ts`,
  `box/BoxGitProcess.ts`, `box/BoxGitTest.ts`; `box/Runs.ts` with `box/RunsProcess.ts`, which today
  runs `keepruns.sh`. The ports copy that shape exactly.
- **A cross-process lock.** Python's `fcntl.flock` has no Node twin. The repo's own answer is a
  pid file written with the `wx` flag, reclaimed when its pid is dead
  (`.agents/skills/lead/scripts/flow/host.ts`'s Electron lock, `mutbox.ts`'s Docker lock). The
  ports reuse that, as one `Lock` service. `proper-lockfile` on npm does the same with a folder and
  a heartbeat; not fetched for this plan, and not needed while the repo's own one works.
- **A TypeScript lexer.** `loosening.sh` hand-lexes TypeScript in Python. `oxc-parser` is installed
  (0.157.0, used by `oxlint-plugins/script-reads.mjs`) and gives the real tree and comments. Open
  question 3.
- **A check that refuses file types.** ls-lint (https://ls-lint.org) checks file names per folder;
  not fetched, read from memory: it reads the work tree, not git's tracked files, so a person's
  untracked scratch `.sh` would fail their lint, and it adds a Go binary. oxlint reads only
  JavaScript and TypeScript files (0113's context), so it cannot see a `.sh` file at all. So the
  hold is a lint step over `git ls-files`, like the workflow lint step in CI's folder is.

## Existing tools

Each new code file in the files table, and what was searched before it was planned.

- `.agents/skills/lead/scripts/git/Git.ts`, `git/GitProcess.ts`, `git/GitTest.ts`: searched `.agents/`
  for git services and found `pr/Branches` and `box/BoxGit`, each a narrow contract for one
  question set. The new one holds the reads and writes the ports share (show, cat-file, diff,
  rev-list, notes, ls-files, add, commit), and the two old ones stay as they are.
- `.agents/skills/lead/scripts/sys/Lock.ts`, `sys/LockFs.ts`, `sys/LockTest.ts`: searched `.agents/` for
  `flock`, `wx` and `lock` and found the pid-file lock in `flow/host.ts` and `mutbox.ts`; searched
  npm in memory for `proper-lockfile`. The service lifts `flow/host.ts`'s lock into one place.
- `.agents/skills/lead/scripts/Env.ts`: searched `.agents/` for how a TS script reads `env.sh` and found
  five copies of "spawn `sh -c '. env.sh; echo $MAIN'`" (`drive.ts`, `gc.ts`, `land.ts`,
  `gcloop.ts`, `flow/run.ts`). Effect's `Config` reads the environment; the service adds the git
  lookups and `local.env`.
- `.agents/skills/lead/scripts/governance.ts`: searched `records.ts`, whose `find` ranks records by
  shared rare words; it reads `origin/main` and ranks, while governance lists every decision whose
  slug, title or tags share a word with a diff. The pure word match is new; the record listing
  reuses `records.ts`'s frontmatter reader.
- `.agents/skills/lead/scripts/fieldrow.ts`: searched `agents.ts` and `clauderow.ts`, which already
  write a run row "in the shape fieldrow.py and clauderow.ts write". The Codex row becomes a
  function beside them in `agents.ts`; `fieldrow.ts` is only its command line.
- `.agents/skills/lead/scripts/box/RunsFs.ts`: searched `box/Runs.ts`, the service `keepruns.sh` sits
  behind today. The new file is its real layer on `FileSystem`, replacing `box/RunsProcess.ts`.
- `.agents/skills/lead/scripts/redact.ts`, `redact/Redact.ts`, `redact/RedactTest.ts`: searched npm in
  memory for a secret scrubber (gitleaks, trufflehog); both find secrets, neither rewrites a file
  in place through JSON and URL escapes with a count, which is what the run needs. The patterns
  keep `leakgrep.sh`'s cited gitleaks lengths.
- `.agents/skills/lead/scripts/runplan.ts`: searched nothing more; it is one call of `redact.ts`'s run.
- `.agents/skills/step-commit/scripts/exam.ts`: searched for a second exam matcher and found
  `examMatcher` in `commits.ts`; reused, not rewritten. Node's `path.matchesGlob` was read and
  refused: its `*` skips dotfiles, and the list names globs under dot folders.
- `.agents/skills/plan/scripts/plancheck.ts`: searched for a Markdown parser (`remark`, `marked`,
  `markdown-it`); none is installed, and the check splits tables and fences by its own written
  rules, which its laws pin. It keeps its own small reader.
- `.agents/skills/step-commit/scripts/stepcommit.ts`: searched `pr/Pushes.ts`, `publish.ts` and
  `land.ts` for a commit helper; `publish.ts` pushes and is reused as is. The staging and owner
  checks are new code over `Git`.
- `.agents/skills/mutation/scripts/run.ts`, `.agents/skills/lead/scripts/mutbox-entry.ts`: searched for
  a process-group runner and found none in `.agents/`. `ChildProcess` in `effect/process` gives a
  scoped handle, so closing the scope ends the child; whether it ends the child's whole group, as
  `run.sh`'s inline Node supervisor does with a negative pid, was not read, and S15's tests step
  checks it first and keeps a marked `process.kill` edge if it does not.
- `.agents/skills/lead/scripts/box/BoxNew.ts`, `box/BoxRun.ts`, `box/BoxFetch.ts`, `box/Signer.ts`,
  `box/SignerSsh.ts`, `box/SignerTest.ts`: searched `.agents/` for the step-note checks and found
  them in `box.sh` only; `PullRequests` (`pr/PullRequests.ts`) already lists open pull requests and
  replaces `box.sh`'s raw `gh pr list`.

The same list, one line per new code file, as 0587's check reads it:

- `.agents/skills/lead/scripts/git/Git.ts`: searched `pr/Branches`, `box/BoxGit`.
- `.agents/skills/lead/scripts/git/GitProcess.ts`: searched `pr/BranchesGit.ts`, `box/BoxGitProcess.ts`.
- `.agents/skills/lead/scripts/sys/Lock.ts`: searched `flow/host.ts`, `mutbox.ts`, npm `proper-lockfile`.
- `.agents/skills/lead/scripts/sys/LockFs.ts`: searched `flow/host.ts`'s pid-file lock.
- `.agents/skills/lead/scripts/Env.ts`: searched the five `env.sh` readers.
- `.agents/skills/lead/scripts/governance.ts`: searched `records.ts`.
- `.agents/skills/lead/scripts/fieldrow.ts`: searched `agents.ts`, `clauderow.ts`.
- `.agents/skills/lead/scripts/box/RunsFs.ts`: searched `box/Runs.ts`.
- `.agents/skills/lead/scripts/redact.ts`: searched gitleaks, trufflehog.
- `.agents/skills/lead/scripts/redact/Redact.ts`: searched gitleaks, trufflehog.
- `.agents/skills/lead/scripts/runplan.ts`: searched nothing more.
- `.agents/skills/step-commit/scripts/exam.ts`: searched `commits.ts`, `path.matchesGlob`.
- `.agents/skills/plan/scripts/plancheck.ts`: searched remark, marked, markdown-it.
- `.agents/skills/step-commit/scripts/stepcommit.ts`: searched `pr/Pushes.ts`, `publish.ts`, `land.ts`.
- `.agents/skills/mutation/scripts/run.ts`: searched `effect/process`.
- `.agents/skills/lead/scripts/mutbox-entry.ts`: searched `effect/process`.
- `.agents/skills/lead/scripts/box/BoxNew.ts`: searched `box.sh`, `pr/PullRequests.ts`.
- `.agents/skills/lead/scripts/box/BoxRun.ts`: searched `box.sh`, `redact.ts`.
- `.agents/skills/lead/scripts/box/BoxFetch.ts`: searched `box.sh`, `pr/Branches.ts`.
- `.agents/skills/lead/scripts/box/Signer.ts`: searched `box.sh`'s ssh-keygen calls.
- `.agents/skills/lead/scripts/box/SignerSsh.ts`: searched `box.sh`'s ssh-keygen calls.

## New names

- `Git`: the shared git service, named for the tool it fronts, as `Branches` and `BoxGit` are.
- `Lock`: a lock, the operating system's word (POSIX `flock`, `lockf`).
- `Env`: the lead's environment, the word `env.sh` already uses.
- `Redact`: to redact, the word the script and its receipts use (`redacted N`).
- `Signer`: one who signs; OpenSSH's `ssh-keygen -Y sign` and git's `gpg.ssh` call it the signer.
- `RunsFs`: the `Runs` service's layer on the file system, as `BranchesGit` is on git.

## The shape

### Shared services, made once and reused

| Service | Lives in | Real layer on | Test layer | First slice | Reused by |
|---|---|---|---|---|---|
| `run` (process runner) | `pr/command.ts`, unchanged | `ChildProcess` | `ChildProcessSpawner` stand-in, as today | already there | every slice |
| `Git` | `git/Git.ts`, `GitProcess.ts`, `GitTest.ts` | `run("git", ...)` | a model: commits as path-to-bytes maps, notes, an index | S2 | S5, S9 to S14 |
| `Lock` | `sys/Lock.ts`, `LockFs.ts`, `LockTest.ts` | pid file, `wx` flag | a `Ref` of held names | S5 | S14 |
| `Env` | `Env.ts` | `Config` plus `Git` | a fixed record | S6 | S7, S14, the five TS callers |
| `PullRequests` | `pr/PullRequests.ts`, unchanged | `gh` | `PullRequestsTest` | already there | S12, S14 |
| `FileSystem`, `Clock` | Effect's own | Node platform | `layerNoop`, `TestClock` | S2 | every slice |

```ts
// git/Git.ts, a sketch: the contract only (0095). Only the calls the ports make.
export class GitError extends Schema.TaggedError<GitError>()("GitError", {
  command: Schema.String,
  reason: Schema.String,
}) {}

export type Commit = { readonly sha: string; readonly parents: ReadonlyArray<string> };

export class Git extends Context.Service<Git, {
  readonly top: Effect.Effect<string, GitError>;
  readonly show: (ref: string, path: string) => Effect.Effect<Option.Option<string>, GitError>;
  readonly diff: (args: ReadonlyArray<string>) => Effect.Effect<string, GitError>;
  readonly commits: (revs: ReadonlyArray<string>) => Effect.Effect<ReadonlyArray<Commit>, GitError>;
  readonly note: (sha: string) => Effect.Effect<Option.Option<string>, GitError>;
  readonly tracked: Effect.Effect<ReadonlyArray<string>, GitError>;
  readonly stage: (paths: ReadonlyArray<string>) => Effect.Effect<void, GitError>;
  readonly unstage: (paths: ReadonlyArray<string>) => Effect.Effect<void, GitError>;
  readonly staged: Effect.Effect<ReadonlyArray<string>, GitError>;
  readonly commit: (subject: string, body: string, as: Author) => Effect.Effect<string, GitError>;
}>()("lead/git/Git") {}
```

A slice adds a call to `Git` only when its port needs it, with its line in both layers and a law
that the two layers answer alike on a small real repo (the real-layer set).

### Each port, in the same five parts

```text
<name>.ts            the command line: effect/cli Command, same flags, same output, same exit codes
<name>/<Pure>.ts     the logic, pure: parsers, matchers, the rules (laws run here on generated input)
<Service>.ts         a contract, if the job touches the outside and no shared service covers it
<Service>Process.ts  its real layer on `run`, Git, FileSystem
<Service>Test.ts     its test layer, in memory
```

A one-file script stays one file when it touches nothing a shared service does not cover
(`exam.ts`, `fieldrow.ts`, `runplan.ts`).

### The lint hold

A lint step, not an oxlint rule: oxlint reads only JavaScript and TypeScript, so it never sees a
`.sh` file. It runs in `pnpm lint`'s parallel list, beside `workflow-lint.ts`.

```ts
// oxlint-plugins/tracked-scripts.ts, a sketch.
// The scripts 0113 orders ported that are still on main. Only shrinks: a port deletes its line in
// the commit that deletes its file. When it is empty, this list and its check go (0524).
const NOT_YET_PORTED = [
  ".agents/skills/lead/scripts/box.sh",
  // ... the 15 of this plan, and scripts/typecheck.sh
] as const;
// An edge is one line in the file's first five: `# edge: <reason> (0113)`, as 0524's `edge:` lines.
const EDGE = /^#\s*edge:\s*\S.*\(0113\)\s*$/;

type Finding =
  | { readonly _tag: "new_script"; readonly path: string }      // tracked, not listed, no edge line
  | { readonly _tag: "stale_entry"; readonly path: string }     // listed, not tracked: drop the line
  | { readonly _tag: "edge_unmarked"; readonly path: string };  // never, kept for the message
```

How this list differs from the lists 0524 empties: those let broken code pass a check that is on.
This one lets a file that 0113 itself ordered ported exist until its port lands, it can only lose
lines (a stale entry fails lint, and a law fixes the list as a subset of the 16 files named here),
it sits in the check's own source in the oxlint-plugins folder, an exam path, so no build step can edit
it, and it ends empty and deleted. The one lasting exception, `apt.sh`, is not on any list: it
carries its own `edge:` line, which is the form 0524 keeps.

The message on a hit: `tracked-scripts: <path> is a shell or Python file. Write it in TypeScript
and Effect (0113); a script that must run before Node exists carries one "# edge: <why> (0113)"
line in its first five lines, decided in its pull request.`

### Keeping the commit path working while it is ported

`stepcommit.sh`, `leakgrep.sh` and `plancheck.sh` run in every step's box, from the box's own
branch, and the coordinator's `step-rules.md` (on the `fabrikalfa/twin-tools` branch, not on main)
names them by path. So no slice deletes a commit-path script:

1. A commit-path slice **adds** `<name>.ts` beside `<name>.sh` and changes no caller.
2. Its law files run over **both** entry points: the leak grep's tests already take
   `TEST_LEAKGREP`; the others get the same switch. Both stay green, which proves the port
   matches.
3. The integrator's **last commit**, the switch, flips every caller to `node <name>.ts`, deletes the
   `.sh` and its list line, and drops the second entry point from the law files. On main the switch
   is one merge, so a box made after it sees only the new names.
4. The lead tells the coordinator in the merge report, so `step-rules.md` changes the same hour.

Leaf scripts (integrator 1) and the box runner (integrator 3) need no double run: nothing runs
them on every commit. Each of those slices switches its callers and deletes its script itself.

## One value traced through

`sh .agents/skills/step-commit/scripts/stepcommit.sh --commit-only plan 766 "T766 plan: x" a.md`,
after integrator 2's switch, is `node .agents/skills/step-commit/scripts/stepcommit.ts --commit-only
plan 766 "T766 plan: x" a.md`:

1. `effect/cli` parses `--commit-only`, the step, the ticket, the subject and one path. The step
   `plan` is now known (S12 adds it); an unknown step still fails with today's line,
   `stepcommit: unknown step <step>`, and exit 2. Today `stepcommit.sh` refuses `plan`, so a
   cloud plan commit is a plain git commit (the merge session tickets it).
2. `Git.staged` answers `[]`, so the "index already holds staged changes" refusal (exit 4) does not
   fire.
3. `Paths.named` (pure) normalizes `a.md`, refuses folders, `..` and absolute paths.
4. With no box state, no owners are read; with one, `plancheck.ts --owners-json` is a function call,
   not a process.
5. `Git.stage(["a.md"])`, then `Git.staged`, then the staged bytes are formatted in a temp folder
   from `FileSystem.makeTempDirectoryScoped`, which the scope removes.
6. `Git.commit(subject, "Co-authored-by: ...", bot)` returns the sha; `--commit-only` skips the
   signer and the push. Stdout holds `git log --oneline -1`'s line, as today.

On `StepCommitTest`, steps 2 to 6 run on `GitTest` and `FileSystem.layerNoop`, so the 20 laws of
`stepcommit.test.ts` run with no git process. Six of them also run on the real layer.

## The slices

Sixteen slices in three integrators. Sizes are product lines, the TypeScript that replaces each
script; test lines are listed apart. Each slice is tests, build and review in its own box; S1, S8,
S11 and S13 are exam paths, so their tests step writes the port and their build step only fixes
callers that are not exam paths.

### Integrator 1, `fabrikalfa/port-scripts-leaves`: nothing on the commit path

| Slice | Script | Services | Callers changed here |
|---|---|---|---|
| S1 | the lint hold, plus `apt.sh`'s edge line | `Git.tracked` (or one `git ls-files -z`) | `package.json` lint list |
| S2 | `governance.sh` | `Git` (first), `FileSystem` | `flow/landing.ts`; adr, lead, review skills |
| S3 | `fieldrow.py` | `FileSystem`, `Clock` | `box.sh`'s one call line; `agents.ts`'s comments; lead skill |
| S4 | `keepruns.sh` | `box/Runs` real layer on `FileSystem` (`RunsFs`) | `box.ts`, `gc.ts`, `box/RunsProcess.ts` (deleted), `box/BoxTestGit.ts` |
| S5 | `redact.sh` | `Redact`, `Lock` (first), `run` | `drive.ts`, `chain.ts`, `agents.ts`; `box.sh` and `runplan.sh` call `node redact.ts` |
| S6 | `env.sh`, its TypeScript readers | `Env` | `drive.ts`, `gc.ts`, `land.ts`, `gcloop.ts`, `flow/run.ts`, `box.ts`; `env.sh` stays for `box.sh` until S14 |
| S7 | `runplan.sh` | `Env`, `Redact`, `run` | lead skill; `box.test.ts`'s and `skillscheck.test.ts`'s mentions |
| S8 | `skillscheck.sh` | `FileSystem` (links read with `readLink`) | `package.json` lint list, `check.yaml`, `workflow-lint/classify.ts`, `wiring.test-support.ts`, `AGENTS.md`, `.agents/skills/README.md`, `docs/plan/README.md`, `script-reads.mjs`'s comment, `exam-paths.json` |

S1 goes first in the integrator, so no new script enters during the sweep. S8 goes last in it:
its clause table names other scripts by file name (`leakgrep.sh checks added text...`,
`stepcommit.sh checks named paths...`, `box.sh new checks...`, `typecheck.sh`), so every later
slice that renames one edits a clause row in `skillscheck.ts` and the skill line together.

### Integrator 2, `fabrikalfa/port-scripts-commit-path`: what every step runs

| Slice | Script | Services | Callers changed at the switch |
|---|---|---|---|
| S9 | `exam.py` | none: `examMatcher` from `commits.ts`, `FileSystem` | `stepcommit.sh`, `plancheck.sh`, `loosening.sh`, `box.sh` (one line each, until their own ports), `drive.ts`, `ci/typecheck.ts`, step-commit skill, `docs/plan/ticket-900-docs-lint.md` |
| S10 | `plancheck.sh` | `FileSystem`, `run` for `sizecap.ts` (or its function) | `box.sh`, `drive.ts`, `land.ts`, `mutbox.ts`, `stepcommit`, plan and lead skills, `plancheck.test-support.ts` |
| S11 | `leakgrep.sh` | `Git`, `FileSystem` | `pr/PushesProcess.ts` (calls `scan` in process), `land.ts`, `botpush.mjs`, `flow/landing.ts`, `plancheck`, seven skills, `exam-paths.json`, two direction notes |
| S12 | `stepcommit.sh` | `Git`, `FileSystem`, `PullRequests`, `run` for the signer and `publish.ts` | `drive.ts`, `flow/host.ts`, `flow/landing.ts`, `land.ts`, `publish.ts`'s comment, step-commit and lead skills, `docs/how-to/sign-a-step-commit.md` |
| S13 | `loosening.sh` | `Git` | `chain.ts`, `ci/typecheck.ts`'s comment, `AGENTS.md`, build, lead, pr, review and tests skills, `exam-paths.json`, `docs/plan/README.md` |

S12 also takes `plan` as a step. Today `stepcommit.sh` knows only tests, build, mutation and lead,
so a plan step's commit falls back to plain git; the merge session tickets that, and the fix folds
into this slice. The lean (80%): `plan` is accepted with `--commit-only` only, and in a box its paths
go through the plan's owner rows like any step's; the signed route refuses `plan` with its own line,
`stepcommit: no plan key; commit with --commit-only`, since no plan step key exists to sign with.

S10 waits for https://github.com/kamp-us/tea-fabrika/pull/1454 to merge (it adds 0587's Existing
tools check to `plancheck.sh`); if it has not merged when S10 starts, S10 ports main's version and
1454 rebases onto the port. S9 goes first: four of the others call it.

### Integrator 3, `fabrikalfa/port-scripts-runner`: the box and the mutation runner

| Slice | Script | Services | Callers changed here |
|---|---|---|---|
| S14 | `box.sh` `new`, `run`, `fetch`, and `env.sh` | `Git`, `Env`, `Lock`, `Redact`, `PullRequests`, `Signer` (ssh-keygen verify, `pnpm commits sign`), `run` | `drive.ts` (`node box.ts`), `gcloop.ts` (`node gc.ts`), `flow/host.ts`, `boxrm.test-support.ts`, lead and step-commit skills, two direction notes, `script-reads.mjs`'s comment |
| S15 | `mutation/scripts/run.sh` | `run` (process group), `FileSystem`, `Clock` (the 300 s cap) | `mutbox-entry`, `scripts/caps.test.ts` (imports the config builder in place of reading text), mutation skill, `mutation.yaml`'s comment |
| S16 | `mutbox-entry.sh` | see open question 2 | `mutbox.Dockerfile`, `mutbox.ts`, `mutbox.test.ts`, `.agents/raw.d.ts` (deleted with its last `?raw` reader) |

S14 deletes `env.sh` with `box.sh`, its last reader. When S14 lands and the typecheck port has too,
whichever lands last deletes `NOT_YET_PORTED` and the code that reads it.

## Laws

Every law of today's test files is kept: same title, same assertions, same generators and run
counts. Where a file runs the script as a process for each generated case, the case moves to the
pure function or the test layer, and a small set stays on the real layer. A real-layer law starts
git or a process, so it is a `*.integration.test.ts` file under 0536; no stand-in can show that real
git writes the diff the pure scanner reads. Each slice's pull request section carries a mapping
table (`Removed`, `Replacement`) with every title, which `loosening.sh` reads.

| Law | Slice | Kind | Generator | Plant |
|---|---|---|---|---|
| A tracked `.sh` or `.py` file that is not listed and has no edge line fails lint, and names the file | S1 | test | fc.stringMatching: a file name under a generated folder, 50 runs | the check skips `.py` |
| A listed file that git does not track fails lint as a stale entry | S1 | test | fc.subarray: of the list, 50 runs | the check ignores stale entries |
| The list is a subset of the 16 files this plan names | S1 | test | pinned: the 16 paths of this plan | a 17th entry |
| `apt.sh` passes by its edge line alone, and an edge line without `(0113)` or a reason fails | S1 | test | fc.string: the reason text, 50 runs | the check accepts `# edge:` with no reason |
| A diff's words list every decision whose slug, title or tags share a word of four letters or more, edited ones first | S2 | test | fc.array: generated decision records and diff lines, 100 runs | the stop list drops a real word |
| `governance.ts` always exits 0 and prints the no-match line when nothing matches | S2 | test | scenario: an empty diff | exit 1 on no match |
| The Codex row's fields, sums and list price match `fieldrow.py`'s for the same events file | S3 | test | fc.array: generated `turn.completed` events, 100 runs | `cachedTokens` billed at the input rate |
| Every old law of `keepruns.test.ts` holds on `RunsFs` with `FileSystem.layerNoop`, and the rm suite's real-git world uses `RunsFs` | S4 | test | scenario: the old file's own cases | a taken name is overwritten |
| [secrets] Every old K19 law of `redact.test.ts` holds on the scrub function, through every escape depth | S5 | test | fc.string: generated secrets and their JSON and URL spellings, 100 runs | one decoding depth fewer |
| [secrets] `redact.ts --run` scrubs both files before the config restore, and a failed scrub deletes them | S5 | test | fc.constantFrom: each failure point, 20 runs | restore before scrub |
| Two runs in one folder never hold the `.npmrc` swap at once | S5 | test | fc.integer: 2 to 4 runs at once on `LockTest`, 30 runs | the lock is skipped |
| `Env` gives the values `env.sh` gives, each overridable from outside, and `local.env` sets the model | S6 | test | fc.record: generated values for each variable, 100 runs | `local.env` wins over an outside value |
| `runplan.ts` runs the plan writer through `Redact`'s run with the model and effort from `Env` | S7 | test | scenario: one brief on the test layer | the effort is dropped |
| Every old law of `skillscheck.test.ts` holds on `skillscheck.ts` | S8 | test | scenario: the old file's own generated trees | a fenced clause counts |
| `exam.ts` prints `path<TAB>glob` for each exam path and exits 1 on any hit, 0 on none | S9 | test | fc.array: generated paths against the real list, 100 runs | exit 0 on a hit |
| `exam.ts` agrees with `commits.ts`'s matcher on every generated path | S9 | test | fc.array: generated paths and globs, 200 runs | `**/` read as `*/` |
| Every old law of `plancheck.test.ts` and `plancheck.draft.test.ts` holds on `plancheck.ts`, digest lines byte for byte | S10 | test | scenario: the old files' own plans | the digest over CRLF-normalized text |
| Every old law of the five `leakgrep*.test.ts` files holds, on the `.sh` and the `.ts` until the switch | S11 | test | scenario: the old files' own generated inputs | `scan` skips `+++` lines |
| A diagnostic never holds matched text or a private word, on every output path | S11 | test | fc.string: generated private words, 100 runs | the hit line quotes the word |
| Every old law of `stepcommit.test.ts` holds, on the `.sh` and the `.ts` until the switch | S12 | test | scenario: the old file's own cases | a staged folder passes |
| `plan` is a known step: `--commit-only plan` commits the named paths, and a signed `plan` commit refuses with its own line and exit 2, leaving the index as it was | S12 | test | fc.constantFrom: each step name, known and unknown, 30 runs | `plan` refused as unknown |
| A refused commit leaves the index as it was | S12 | test | fc.constantFrom: each refusal, 30 runs | `unstage` skipped on a format refusal |
| Every old law of `loosening.test.ts` holds, exit codes 0, 1 and 2 included | S13 | test | scenario: the old file's own cases | a removed `expect` passes |
| Every old law of `box.test.ts` holds on `BoxTest` layers, and its process laws on the real layer | S14 | test | scenario: the old file's own cases | the slot limit 8 becomes 9 |
| `box.ts new` prints the `phase <name> <ms>` lines drive reads, in order | S14 | test | scenario: one start on `TestClock` | a phase dropped |
| The Stryker config `run.ts` writes equals the one `run.sh` emitted, and `caps.test.ts` reads it as a value | S15 | test | fc.record: generated `RELATED`, `SINCE`, `FINAL`, `IN_PLACE`, `BASELINE`, 100 runs | `concurrency` 2 |
| A run past 300 s exits 124 and leaves no `vitest.mutation.config.ts` | S15 | test | scenario: `TestClock` past the cap | the config file kept |
| Every old law of `mutbox.test.ts` that reads the entry holds on the new entry | S16 | test | scenario: the old file's own cases | exit 71 for a failed install |
| No tracked `.sh` or `.py` file is left but `apt.sh` (and `typecheck.sh` until its port) | S14 | lint | lint | `env.sh` left behind |

No host-only law: nothing here needs launchd, the real Electron app or a signal on the owner's
Mac. The real-layer sets run in a box on real git, which any Linux box has.

## Files

| File | Owner | Slice | Product lines expected |
|---|---|---|---|
| `oxlint-plugins/tracked-scripts.ts` | tests | S1 | 70 |
| `oxlint-plugins/tracked-scripts.test.ts` | tests | S1 | tests |
| `package.json` | tests | S1, S8 | 2 |
| `.github/ci/apt.sh` | tests | S1 | 1 |
| `.agents/skills/lead/scripts/git/Git.ts` | build | S2 | 60 |
| `.agents/skills/lead/scripts/git/GitProcess.ts` | build | S2 | 120 |
| `.agents/skills/lead/scripts/git/GitTest.ts` | tests | S2 | tests |
| `.agents/skills/lead/scripts/git/git.integration.test.ts` | tests | S2 | tests |
| `.agents/skills/lead/scripts/governance.ts` | build | S2 | 80 |
| `.agents/skills/lead/scripts/governance.test.ts` | tests | S2 | tests |
| `.agents/skills/lead/scripts/governance.sh` | build | S2 | -60 |
| `.agents/skills/lead/scripts/flow/landing.ts` | build | S2, S11, S12 | 6 |
| `.agents/skills/lead/scripts/fieldrow.ts` | build | S3 | 30 |
| `.agents/skills/lead/scripts/agents.ts` | build | S3, S5 | 50 |
| `.agents/skills/lead/scripts/fieldrow.test.ts` | tests | S3 | tests |
| `.agents/skills/lead/scripts/fieldrow.py` | build | S3 | -40 |
| `.agents/skills/lead/scripts/box/RunsFs.ts` | build | S4 | 50 |
| `.agents/skills/lead/scripts/box/RunsProcess.ts` | build | S4 | -34 |
| `.agents/skills/lead/scripts/box/BoxTestGit.ts` | tests | S4 | tests |
| `.agents/skills/lead/scripts/keepruns.test.ts` | tests | S4 | tests |
| `.agents/skills/lead/scripts/keepruns.sh` | build | S4 | -33 |
| `.agents/skills/lead/scripts/gc.ts` | build | S4, S6 | 20 |
| `.agents/skills/lead/scripts/box.ts` | build | S4, S6, S14 | 200 |
| `.agents/skills/lead/scripts/sys/Lock.ts` | build | S5 | 25 |
| `.agents/skills/lead/scripts/sys/LockFs.ts` | build | S5 | 50 |
| `.agents/skills/lead/scripts/sys/LockTest.ts` | tests | S5 | tests |
| `.agents/skills/lead/scripts/redact.ts` | build | S5 | 60 |
| `.agents/skills/lead/scripts/redact/Redact.ts` | build | S5 | 130 |
| `.agents/skills/lead/scripts/redact/RedactTest.ts` | tests | S5 | tests |
| `.agents/skills/lead/scripts/redact.test.ts` | tests | S5 | tests |
| `.agents/skills/lead/scripts/redact.sh` | build | S5 | -124 |
| `.agents/skills/lead/scripts/chain.ts` | build | S5, S13 | 12 |
| `.agents/skills/lead/scripts/chain.test.ts` | tests | S5, S13 | tests |
| `.agents/skills/lead/scripts/drive.ts` | build | S5, S6, S9, S10, S12, S14 | 60 |
| `.agents/skills/lead/scripts/drive.test.ts` | tests | S6, S14 | tests |
| `.agents/skills/lead/scripts/Env.ts` | build | S6 | 70 |
| `.agents/skills/lead/scripts/Env.test.ts` | tests | S6 | tests |
| `.agents/skills/lead/scripts/land.ts` | build | S6, S10, S11, S12 | 20 |
| `.agents/skills/lead/scripts/land.test.ts` | tests | S10 | tests |
| `.agents/skills/lead/scripts/gcloop.ts` | build | S6, S14 | 15 |
| `.agents/skills/lead/scripts/gcloop.test.ts` | tests | S14 | tests |
| `.agents/skills/lead/scripts/flow/run.ts` | build | S6 | 10 |
| `.agents/skills/lead/scripts/runplan.ts` | build | S7 | 30 |
| `.agents/skills/lead/scripts/runplan.test.ts` | tests | S7 | tests |
| `.agents/skills/lead/scripts/runplan.sh` | build | S7 | -11 |
| `.agents/skills/lead/scripts/skillscheck.ts` | tests | S8 | 200 |
| `.agents/skills/lead/scripts/skillscheck.sh` | tests | S8 | -219 |
| `.agents/skills/lead/scripts/skillscheck.test.ts` | tests | S8 | tests |
| `.github/workflows/check.yaml` | tests | S8 | 1 |
| `.github/ci/workflow-lint/classify.ts` | tests | S8 | 2 |
| `.github/ci/workflow-lint/wiring.test-support.ts` | tests | S8 | tests |
| `oxlint-plugins/script-reads.mjs` | tests | S8, S14 | 2 |
| `oxlint-plugins/script-reads.test.ts` | tests | S8 | tests |
| `exam-paths.json` | tests | S8, S11, S13 | 6 |
| `.agents/skills/step-commit/scripts/exam.ts` | build | S9 | 30 |
| `.agents/skills/step-commit/scripts/exam.test.ts` | tests | S9 | tests |
| `.agents/skills/step-commit/scripts/exam.py` | build | S9 | -17 |
| `next/apps/fabrika/src/exam/commits.ts` | tests | S9 | 0, read and imported, not changed |
| `next/apps/fabrika/src/exam/commits.test.ts` | tests | S11 | 0, its exam-list fixture is text and stays |
| `.agents/skills/lead/scripts/ci/typecheck.ts` | build | S9 | 8 |
| `.agents/skills/plan/scripts/plancheck.ts` | build | S10 | 300 |
| `.agents/skills/plan/scripts/plancheck.sh` | build | S10 | -312 |
| `.agents/skills/plan/scripts/plancheck.test.ts` | tests | S10 | tests |
| `.agents/skills/plan/scripts/plancheck.draft.test.ts` | tests | S10 | tests |
| `.agents/skills/plan/scripts/plancheck.test-support.ts` | tests | S10 | tests |
| `.agents/skills/lead/scripts/mutbox.ts` | build | S10, S16 | 15 |
| `.agents/skills/lead/scripts/mutbox.test.ts` | tests | S10, S16 | tests |
| `.agents/skills/lead/scripts/leakgrep.ts` | tests | S11 | 230 |
| `.agents/skills/lead/scripts/leakgrep.sh` | tests | S11 | -219 |
| `.agents/skills/lead/scripts/leakgrep.test.ts` | tests | S11 | tests |
| `.agents/skills/lead/scripts/leakgrep.commits.test.ts` | tests | S11 | tests |
| `.agents/skills/lead/scripts/leakgrep.lines.test.ts` | tests | S11 | tests |
| `.agents/skills/lead/scripts/leakgrep.patches.test.ts` | tests | S11 | tests |
| `.agents/skills/lead/scripts/leakgrep.respaced.test.ts` | tests | S11 | tests |
| `.agents/skills/lead/scripts/pr/PushesProcess.ts` | build | S11 | 20 |
| `.agents/skills/lead/scripts/pr/Arm.test.ts` | tests | S11 | tests |
| `.agents/skills/lead/scripts/pr/Merge.test.ts` | tests | S11 | tests |
| `.agents/skills/lead/scripts/botpush.mjs` | build | S11 | 4 |
| `.agents/skills/lead/scripts/botpush.test.ts` | tests | S11 | tests |
| `.agents/skills/step-commit/scripts/stepcommit.ts` | build | S12 | 230 |
| `.agents/skills/step-commit/scripts/stepcommit.sh` | build | S12 | -177 |
| `.agents/skills/step-commit/scripts/stepcommit.test.ts` | tests | S12 | tests |
| `.agents/skills/lead/scripts/flow/host.ts` | build | S12, S14 | 10 |
| `.agents/skills/lead/scripts/publish.ts` | build | S12 | 2 |
| `.agents/skills/lead/scripts/loosening.ts` | tests | S13 | 400 |
| `.agents/skills/lead/scripts/loosening.sh` | tests | S13 | -420 |
| `.agents/skills/lead/scripts/loosening.test.ts` | tests | S13 | tests |
| `.agents/skills/lead/scripts/box/BoxNew.ts` | build | S14 | 180 |
| `.agents/skills/lead/scripts/box/BoxRun.ts` | build | S14 | 110 |
| `.agents/skills/lead/scripts/box/BoxFetch.ts` | build | S14 | 170 |
| `.agents/skills/lead/scripts/box/Signer.ts` | build | S14 | 25 |
| `.agents/skills/lead/scripts/box/SignerSsh.ts` | build | S14 | 60 |
| `.agents/skills/lead/scripts/box/SignerTest.ts` | tests | S14 | tests |
| `.agents/skills/lead/scripts/box.test.ts` | tests | S14 | tests |
| `.agents/skills/lead/scripts/boxrm.test-support.ts` | tests | S14 | tests |
| `.agents/skills/lead/scripts/box.sh` | build | S3, S5, S9, S10, S14 | -412 |
| `.agents/skills/lead/scripts/env.sh` | build | S14 | -22 |
| `.agents/skills/mutation/scripts/run.ts` | build | S15 | 110 |
| `.agents/skills/mutation/scripts/run.sh` | build | S15 | -87 |
| `.agents/skills/mutation/scripts/run.test.ts` | tests | S15 | tests |
| `scripts/caps.test.ts` | tests | S15 | tests |
| `.github/workflows/mutation.yaml` | tests | S15 | 1 |
| `.agents/skills/lead/scripts/mutbox-entry.ts` | build | S16 | 90 |
| `.agents/skills/lead/scripts/mutbox-entry.sh` | build | S16 | -81 |
| `.agents/skills/lead/scripts/mutbox.Dockerfile` | build | S16 | 2 |
| `.agents/raw.d.ts` | build | S16 | -5 |
| `.agents/skills/lead/SKILL.md` | lead | S2 to S14 | docs |
| `.agents/skills/step-commit/SKILL.md` | lead | S9, S12, S14 | docs |
| `.agents/skills/plan/SKILL.md` | lead | S10, S11 | docs |
| `.agents/skills/adr/SKILL.md` | lead | S2 | docs |
| `.agents/skills/review/SKILL.md` | lead | S2, S13 | docs |
| `.agents/skills/build/SKILL.md` | lead | S11, S13 | docs |
| `.agents/skills/tests/SKILL.md` | lead | S11, S13 | docs |
| `.agents/skills/pr/SKILL.md` | lead | S11, S13 | docs |
| `.agents/skills/guidelines/SKILL.md` | lead | S11 | docs |
| `.agents/skills/mutation/SKILL.md` | lead | S15 | docs |
| `.agents/skills/README.md` | lead | S8 | docs |
| `AGENTS.md` | lead | S8, S13 | docs |
| `docs/plan/README.md` | lead | S8, S13, each integrator | docs |
| `docs/how-to/sign-a-step-commit.md` | lead | S12 | docs |
| `docs/plan/ticket-900-docs-lint.md` | lead | S9 | docs |
| `docs/direction/how-we-get-work-done.md` | lead | S11, S13 | docs |
| `docs/direction/skills-hold-only-judgment.md` | lead | S11 | docs |
| `docs/direction/a-unit-of-work-is-a-commit.md` | lead | S13, S14 | docs |
| `docs/direction/lane-queue-or-scheduled-job.md` | lead | S5, S13, S14 | docs |
| `docs/direction/next-is-a-pipeline-pre-run.md` | lead | S13 | docs |
| `docs/direction/agents-run-on-codex.md` | lead | S6 | docs |

The skill prose rows are the lead's in each slice: they change a file name in a command and the
matching clause row in `skillscheck.ts`, which S8's tests step owns, so a slice after S8 hands that
one row to its own tests step. A link in `.claude/skills/` points at a skill folder, not a script,
so no link changes; `skillscheck` keeps checking them.

Callers that read a script as text, named apart: `mutbox.ts` (reads `mutbox-entry.sh` into the
image's build folder), `mutbox.test.ts` (`?raw` import), `scripts/caps.test.ts` (reads `run.sh` and
cuts the config out), `oxlint-plugins/script-reads.mjs` (derives each test's reads from script
names, so it follows every rename with no edit), and the `skillscheck` clause table (script names
as prose). Outside main: `step-rules.md` on the `fabrikalfa/twin-tools` branch.

Is any new choice a setting? The only new value is the lock's stale-pid reclaim, which follows
the pid's life, not a time; and the list, which is not a choice. No new setting (0069).

What fact is lost if not recorded now: none new. Each port keeps every row and receipt its script
writes today (`redacted N`, the `.box` facts, the field row, the `phase` lines).

## Records

- Each slice writes one field row per step, `field/runs/<date>-port-<slice>-<step>.json`, the same
  day, with real times.
- Each integrator pull request lists, per slice, the mapping table of laws, the tests run at which
  head, and the review's verdict.
- `docs/plan/README.md`'s "where we are" names ticket 766's state after each integrator lands.
- No decision file: this plan builds decided notes. If the owner answers open question 1 or 2 with
  a new rule, that answer is recorded with `/adr` in its own docs pull request.

## Size

1. S1, the lint hold: 70 lines.
2. S2, governance and the `Git` service: 260 lines.
3. S3, fieldrow: 70 lines.
4. S4, keepruns: 50 lines.
5. S5, redact and the `Lock` service: 315 lines.
6. S6, env: 120 lines.
7. S7, runplan: 30 lines.
8. S8, skillscheck: 200 lines.
9. S9, exam: 40 lines.
10. S10, plancheck: 300 lines.
11. S11, leakgrep: 250 lines.
12. S12, stepcommit: 240 lines.
13. S13, loosening: 400 lines.
14. S14, box and env.sh's end: 750 lines.
15. S15, mutation run: 110 lines.
16. S16, mutbox entry: 90 lines.

About 3,300 TypeScript lines added and 2,230 shell and Python lines removed, plus the laws, which
move rather than grow. About 60 files touched. Confidence in the sizes: 70%; `box.sh` and
`loosening.sh` carry the most doubt, since both hold long rules in dense Python.

Three integrator pull requests: integrator 1 holds S1 to S8 (about 1,100 lines), integrator 2
holds S9 to S13 (about 1,230), integrator 3 holds S14 to S16 (about 950).

The estimate is 16 slices times three steps (48), six likely send-backs, and three integrator folds
priced as lead steps. Prices are medians of the dollar-priced rows in `field/runs.jsonl` and
`field/runs/`: about $1.31 a tests step, $1.21 a build, $1.39 a review and $8.91 a lead step.

Estimate: 57 steps, $100

## What this cannot tell us

- Whether every rule in `box.sh` and `loosening.sh` is pinned by a law. Both carry comments that
  name incidents; a rule with no law can be lost in a port without any test going red. Each slice's
  tests step lists the comments that name a rule with no law, and writes the law first.
- How much faster CI gets. 0113 expects the process-heavy tests to shrink; this plan does not
  measure it. The integrator pull requests can name the test times before and after.
- Whether the in-memory `GitTest` model stays honest as it grows. The real-layer set is the guard,
  and it runs on the schedule, not on every pull request.

## Open questions

1. **Do the five checks 0585 sends to `@kalfa/ci/checks` (leakgrep, loosening, governance,
   skillscheck, redact) port now in place under `.agents/`, and does the step runner (`box.sh`,
   `mutbox-entry.sh`, `run.sh`) port although 0585 says it gets fixes only?** 0113 says now, and
   0585 says a check becomes TypeScript as it moves, at the sev0's tail. Lean: port all fifteen now,
   in the shape of a `@kalfa/ci/checks` subpath, so the move is a `git mv` (75%). If the owner
   says the checks wait, S2, S5, S8, S11 and S13 leave this plan and the lint list keeps them
   until the `@kalfa/ci` build.
2. **The mutation container's entry: one TypeScript file on Node built-ins as marked edges, or a
   third edge in shell?** It runs before `pnpm install`, so it cannot import Effect. Lean: a
   `mutbox-entry.ts` that does the checkout and the offline install with `node:child_process` and
   `node:fs` as one marked `edge:` line each (0250), then runs the arms by importing
   `.agents/skills/mutation/scripts/run.ts` from the commit under test, falling back to `run.sh`
   for a commit from before S15 (70%). The other road keeps `mutbox-entry.sh` as a second marked
   edge beside `apt.sh`, which 0113 allows only for a script that runs before Node exists; Node does
   exist in the container, so the lean is the TypeScript file.
3. **Does `loosening.ts` read test files with `oxc-parser`'s tree, or keep `loosening.sh`'s own
   lexer, ported line for line?** The tree finds `it`, `expect` and `numRuns` exactly, but every law
   was written against the lexer, and a parse error must still fail closed (exit 2). Lean: the
   tree, with the old lexer's 30 laws unchanged and a law that a file `oxc-parser` cannot parse
   exits 2 (65%). What would settle it: the tests step running the old laws against a tree-based
   draft in S13's box before the build.

## Findings

```json
{"id":"2026-11-16-two-exam-path-matchers-disagree","date":"2026-11-16","rule":"one meaning, one way (0212)","what":"exam.py and next/apps/fabrika/src/exam/commits.ts both turn exam-paths.json's globs into regexes, by different rules. A glob ending in /** matches its own folder name in commits.ts (`(?:/.*)?`) and not in exam.py (`/.*`), and commits.ts counts any path with a control character as an exam path while exam.py does not. So a step tool and CI's commits check can answer differently for the same path.","proof":"Read on origin/main at bcad008: .agents/skills/step-commit/scripts/exam.py lines 4 to 11, and commits.ts's globRegex and examMatcher, lines 169 to 200.","where":".agents/skills/step-commit/scripts/exam.py","next":"S9 of docs/plan/quests/port-scripts-0113-PLAN.md replaces exam.py with an import of examMatcher."}
```
