Approved by the lead agent, builds 0584, 0581, 0536, 0539, 0544, 0541; body cc135b52b8b4
Plancheck-Version: 3

```ts
// A sketch: the whole idea. A test's kind follows what it uses (0584), and code reads it both ways.
type Kind =
  | { readonly _tag: "plain" }                          // reads repo files, or runs on stand-ins
  | { readonly _tag: "integration"; readonly uses: Real } // starts or reaches a real thing

type Real = "instance" | "workerd" | "electron" | "process" | "signal" | "port" | "network"
  | "disk" // a SQLite file or a temp folder: medium in Google's sizes, so integration (0584)

// Where each kind runs, after this plan:
//   plain next/ law      every pull request and queue group its change reaches   (as today)
//   plain tooling law    every pull request and queue group its change reaches   (new, amends 0539)
//   .integration. law    main's full run only                                    (0536, 0581)
```

# Pull request check runs every plain law: a test's kind follows what it uses (ticket 1073, sev0)

Today's version, CI tooling and next/'s test names. Ticket 1073. Decision
[0584](../../../.decisions/0584-a-tests-kind-follows-what-it-uses.md) is written in this same pull
request; it amends 0539, 0544 and 0536 in part and cites 0581.

## Calls taken

- **A law that writes a SQLite file or a temp folder is `.integration.`, until ticket 1070's
  in-memory stand-ins move it to plain. 90%.** Source: the principle the ruling cites, Google's test
  sizes (Software Engineering at Google, chapter 11): a small test may not touch the file system, and
  a test that uses local disk is medium; 0584 maps medium and up to `.integration.`. It agrees with
  0536 and experiment 292, which count a SQLite file and temp files as real. It also fits
  [0541](../../../.decisions/0541-ci-speed-has-a-goal-and-a-daily-check.md)'s limit: the 83 next/
  files in this group take about 2,805 s at pull request depth (71 measured), and a pull request
  that touches `Sql.ts` would reach most of them, about 9 minutes a leg on 5 legs. 0584 and the tests
  skill carry the line, and the lint rule holds it: a plain law that writes to disk fails.
- **The edge-comment law is split, not renamed. 90%.** Its planted half spawns oxlint in a temp
  folder; only its `.oxlintrc.json` half, the `.agents/` mirror law, is plain.
- **Tooling follows the same definition. 85%.** 88 of tooling's 133 test files spawn a process or
  write disk (box, boxrm, plancheck, leakgrep, oxlint plants), so they become `.integration.`.
- **`related.test.ts` is `.integration.`. 75%.** It builds a Vitest in its own process, and while
  Vitest walks the imports, `vitest.config.ts`'s `githubReads` plugin runs `git ls-files`: a child
  process. The import scan missed it; I found it by reading.
- **`node-kinds.test.ts` gets a stand-in (a folder read) in place of `git ls-files`. 75%.**

## The answer first

- **The pull request check runs plain tooling laws** the way it runs plain next/ laws: Vitest's
  `--changed` from the pull request's base picks the tests whose imports reach a changed file, and
  the size step puts them on the `next` job's legs. No new machine starts.
- **The name follows the use, held by lint both ways.** `fabrika/integration-test-name` (oxlint, one
  file) fails a plain test that calls a real-thing starter. A new whole-tree check,
  `oxlint-plugins/test-kind.ts` in `pnpm lint`, fails an `.integration.` file that reaches no
  starter through its imports.
- **The sweep on main:** 148 `.integration.` files in next/. 2 rename to plain, 3 split (the plain
  part leaves, `.agents/` mirror law included), 143 stay. 7 plain next/ tests start a real thing or
  write disk and become `.integration.`: the four git laws, `OpenRepository.test.ts` (a real temp
  folder), `ProcessManagerMemo.test.ts` (real SQLite files) and `settings-generated.test.ts` (it
  spawns oxlint through `exam/plant.ts`). `node-kinds.test.ts` gets a stand-in, and
  `Process.test-support.ts` makes its temp folder on first use, not on import. In tooling, 88 of 133
  test files start a process or write disk and become `.integration.`; 45 stay plain and start
  running on pull requests.
- **Today's three breaks:** the mirror law would now run on its pull requests. `related.test.ts`
  and the quota laws reach a real thing, so they stay on the full run; 0581's hourly run and ticket
  1071's cadence catch those.
- **Cost:** a tooling pull request gains one leg of about 30 s setup plus its few seconds of laws,
  beside `check`, which already takes longer; a next/ pull request gains nothing measurable. It stays
  under 0541's goal (75% sure; the doubt is that none of the 45 plain tooling files but one has a
  measured row).
- **Five pull requests,** the rule and the definition first, then the tooling renames by folder,
  then the check that runs them.

## How others do it

- **Google's test sizes** (Software Engineering at Google, chapter 11, "Test size"; read from
  memory, not fetched this turn): a small test runs in one process and touches no network or disk, a
  medium one stays on one machine (localhost, files, a database), a large one spans machines. Size
  is set by what the test may use, and the test runner enforces it, not the file's name. 0584 takes
  that rule; "plain" here is Google's small, plus reading the repository's own files, which 0536
  already allowed.
- **Vitest's `--changed`** (Vitest 5.0.5, the installed version, its CLI help: "Run tests that are
  affected by the changed files") follows imports from the changed files, and `--project` "can be
  repeated for multiple projects" (same help text). Both are what `legs.ts` already uses for next/;
  this plan adds a second `--project` to the same call. The repo's own `scriptReads` and
  `githubReads` plugins in `vitest.config.ts` already hand Vitest the files a tooling test reaches
  without importing them, so `--changed` follows them too.
- **GitHub Actions** picks no tests itself: `on.pull_request.paths-ignore` (GitHub docs, "Workflow
  syntax for GitHub Actions", read in `check.yaml`'s own comments, not fetched) only decides whether
  the run starts. Which tests run stays the changes job's call, as 0175 says.
- **Elm and OTP** have no answer here; this is CI, not a machine.

## The shape

### The definition, in code the rule reads

```ts
// oxlint-plugins/test-kind.ts, sketch. A starter is a module whose own code opens a real thing.
type Opens =
  | { readonly _tag: "process"; readonly call: string } // child_process spawn/exec/fork; a real ChildProcessSpawner run
  | { readonly _tag: "port"; readonly call: string }    // node:net, http, https, http2 servers and connects
  | { readonly _tag: "browser"; readonly call: string } // Playwright chromium/firefox/webkit/_electron launch
  | { readonly _tag: "instance"; readonly call: string } // localInstance(...), workerd.test-support.ts's starters
  | { readonly _tag: "signal"; readonly call: string }  // process.kill(...)
  | { readonly _tag: "network"; readonly call: string } // fetch("http://...") to a literal outside localhost
  | { readonly _tag: "disk"; readonly call: string }    // new DatabaseSync(file), mkdtemp, makeTempDirectory

type Verdict =
  | { readonly _tag: "ok" }
  | { readonly _tag: "plain_opens"; readonly file: string; readonly via: readonly string[]; readonly opens: Opens }
  | { readonly _tag: "integration_opens_nothing"; readonly file: string }
```

- **Direction 1, plain opens a real thing:** `fabrika/integration-test-name`, the per-file oxlint
  rule that blocks today, keeps reading calls through the module each name came from. Its list
  changes to 0584's: `process.kill(` and the workerd starters join; Rolldown leaves (in-process, reading
  repo files is plain). Disk fires: a SQLite file as today, and now a temp folder too, from
  `mkdtemp`, `mkdtempSync` or `tmpdir()` in `node:`, or a `makeTempDirectory` or `makeTempFile` call
  (scoped or not) in a file that provides `NodeServices.layer` or `NodeFileSystem.layer`. The
  README's line that a temp folder alone does not fire goes; the in-memory git laws it kept on pull
  requests are the four git laws that move anyway. A file that provides `NodeServices.layer` and
  also runs `ChildProcess.make` or a spawner's `spawn` fires as `process`: that is how `Git.test.ts`
  and its three neighbors start real git unseen today.
- **Direction 2, `.integration.` opens nothing:** `test-kind.ts` walks each `*.integration.test.ts`
  file's imports (relative paths and our workspace packages' `exports` maps) and fails a file that
  reaches no starter of any `_tag`, `disk` included. Before writing a reader, the build tries
  `code-graph . --graph` ([0040](../../../.decisions/0040-existing-tools-before-hand-written.md)),
  which `pnpm lint:layers` already runs; if its graph leaves out test files or `node:` imports, the
  reader in `oxlint-plugins/script-reads.mjs` is the fallback.
- **Direction 1 through helpers** (a plain test that reaches a starter only through a helper's
  helper) is what code cannot tell well: an import is not a use. My scan found 28 plain next/ tests
  that import a starter module through helpers; reading them, 3 truly start a real thing or write
  disk that way (`ProcessManagerMemo`, `settings-generated`, and the module-level temp folder in
  `Process.test-support.ts`, which slice 1 makes lazy). So the graph prints those as `advice:` lines that never fail, and review names them, as the
  oxlint rule's README already says for its 61 helper misses.
- **What code cannot tell at all:** a real thing started inside a dependency
  (`secret-types.integration.test.ts` reaches TypeScript 7.0.2's sync API, whose
  `dist/api/syncChannel.js` spawns the compiler), a command built from a string at run time, a
  network URL built at run time, and a spy that stands in for a starter (`alchemy-lifecycle.test.ts`
  spies on `spawn`). Direction 2 errs toward passing (any starter import counts), so these cost a
  missed name, never a false block. Each case is a line in the rule's README.
- **The scope** is every test file under next/ and the tooling folders. Slice 1 covers next/; each
  tooling slice adds its folder to the check's folder scope and renames that folder in the same pull
  request, and slice 4 removes the scope list. A folder list is a scope, not a list of broken
  files: no file is excused inside it
  ([0524](../../../.decisions/0524-no-list-lets-broken-code-pass.md)).

### The projects

```ts
// vitest.config.ts, sketch of the changed part.
const TOOLING_INTEGRATION = TOOLING.map((glob) => glob.replace(/\*\.test\.ts$/, "*.integration.test.ts"));

export const projects = [
  { extends: true, test: { name: "today", include: [...TODAY], exclude: [...EXCLUDE] } },
  { extends: true, test: { name: "tooling", include: [...TOOLING], exclude: [...EXCLUDE, ...TOOLING_INTEGRATION] } },
  { extends: true, test: { name: "tooling-integration", include: [...TOOLING_INTEGRATION], exclude: [...EXCLUDE] } },
  { extends: true, test: { name: "next", include: [...NEXT], exclude: [...EXCLUDE, ...INTEGRATION, ...VISUAL] } },
  // next-integration and next-visual: unchanged
];
```

### What the changes job says

```ts
// .github/ci/changes.mjs, sketch. Today one `Scope` says what of next/ a run needs, and no path
// starts a tooling test. After: a second, separate answer, since the two do not rank.
type Scope = "none" | "readers" | "all";            // unchanged: what of next/ the run needs
type Need = { readonly next: Scope; readonly tooling: boolean };
// tooling is true when any changed path is a tooling test's own file or one it reaches:
// oxlint-plugins/, .github/ci/, .github/workflows/, scripts/, .agents/skills/*/scripts/, vitest.*.ts.
// The `next` job's flag is need.next !== "none" || need.tooling.
```

```ts
// .github/ci/legs.ts, sketch: the one `vitest list` call grows a project, and drops its `next/` path
// filter so tooling files can be picked. Readers stay next/'s alone.
const picked = sized && (need.next === "all" || need.tooling)
  ? list(root, ["--project", "next", "--project", "tooling", ...changed])
  : [];
```

```yaml
# .github/workflows/check.yaml, sketch of the next job's vitest step: the legs run the listed files.
- run: pnpm exec vitest run --project next --project tooling $FILTER --shard "$SHARD" ...
# .github/workflows/scheduled.yaml, the tooling legs:
- run: pnpm exec vitest run --project tooling --project tooling-integration --shard ...
```

- The `next` job keeps its name: `ci-required` and the ruleset read it, and a rename is churn for
  no reader. Its comment says it runs plain tooling laws too.
- Workflow lint T1 (`.github/ci/workflow-lint/merge-line.ts`, 0539) today fails any pull request or
  queue vitest call that names a project outside next/. It changes to: a call names only `next`,
  `tooling` or `next-visual`, never `next-integration`, `tooling-integration` or `today`. That is a
  law loosened by an owner ruling (0584), so it is decided, not new.
- The merge queue runs the same selection (legs.ts's `LINE` holds `merge_group`).
- The full run still runs every project.

## One value traced through

A pull request that changes `.github/ci/workflow-lint/next-job.ts`, after slice 5.

1. The changes job: the path is under `.github/ci/`, so `need` is `{ next: "none", tooling: true }`
   and the `next` flag is on.
2. The size step: `vitest list --project next --project tooling --changed=<base>` picks
   `.github/ci/workflow-lint/next-job.test.ts` and `.github/ci/workflow-lint.test.ts` (they import
   the file), and the plain others `githubReads` ties to `.github/`. No next/ file.
   `.github/ci/legs.integration.test.ts` and `.github/ci/related.integration.test.ts` are not picked:
   they are in `tooling-integration`.
3. Seconds: files with no row count at the table's median, 0.4 s each; one leg fits 240 s.
4. The `next` job runs one leg: about 30 s of setup and the picked laws. `check` runs beside it and
   takes longer, so the pull request's time to `ci-required` does not move.
5. The full run later runs all four tooling and next projects, as today.

## Laws

| Law | Kind | Generator | Plant that must fail | Law lives in | Runs |
|---|---|---|---|---|---|
| K1: a plain next/ or tooling test file whose own code calls a starter of each `_tag` (spawn, exec, fork, a net server, a Playwright launch, `localInstance`, a workerd starter, `process.kill`, a remote `fetch` literal, `NodeServices.layer` with `ChildProcess.make`, a SQLite file, `mkdtemp`, `makeTempDirectory` beside `NodeServices.layer`) fires at that call's line; the same file named `.integration.` or `.visual.` does not | test | fc.record: the call, its import spelling (named, renamed, namespace), the folder (next/ app, library, program; each tooling folder), `.ts` or `.tsx`; 100 runs, seed 119120 | Drop `process.kill` from the openers: a planted kill in a plain file passes | `oxlint-plugins/integration-test-name.test.ts` | lint, the merge line, the full run |
| K2: stand-ins never fire: a spy on `spawn`, `ChildProcessSpawner.make`, SQLite on `:memory:`, Rolldown in memory, `FileSystem.layerNoop`, a fake FileSystem whose `makeTempDirectory` is an object key (`Command.test.ts`), `MemoryFiles.test-support.ts` | test | fc.constantFrom: the six cases, each in a generated plain file; 100 runs | Keep `rolldown` in the openers: `client-manager-contract.test.ts`'s call fires | `oxlint-plugins/integration-test-name.test.ts` | lint, the merge line, the full run |
| K3: on a planted tree, an `.integration.` file fails exactly when no import chain from it (0 to 3 hops, relative or through a workspace `exports` map, a `*` pattern included) reaches a starter of any `_tag`, `disk` included | test | fc.record: chain length, each hop's import kind, whether the last module opens and with which `_tag`; 100 runs | Stop the walk after the first hop: a two-hop integration file fails | `oxlint-plugins/test-kind.test.ts` | lint, the merge line, the full run |
| K4: the plain-through-helpers lines are `advice:` and never change the exit; a K3 failure exits 1 | test | fc.record: planted trees with and without each kind of finding; 100 runs | Exit 1 on an advice line | `oxlint-plugins/test-kind.test.ts` | lint, the merge line, the full run |
| K5: the real tree is at zero both ways in the folders in scope | lint | lint | Rename `client-manager-contract.test.ts` back to `.integration.`: direction 2 fails it | `oxlint-plugins/test-kind.ts`, in `pnpm lint` | lint, the merge line |
| K6: every tooling `*.integration.test.ts` is in exactly `tooling-integration`, every other tooling test in exactly `tooling`, and each file in exactly one project | test | fc.record: generated names in each tooling folder, with and without `.integration.`; 100 runs | Leave `TOOLING_INTEGRATION` out of `tooling`'s `exclude`: a file is in two projects | `vitest.shards.test.ts` | the merge line, the full run |
| K7: for generated changed paths, `need.tooling` is true exactly when a path is under a tooling folder, and `need.next` is what `scope` says today | test | fc.array: 1 to 8 paths drawn from every tree changes.mjs knows; 200 runs | Map a tooling path to `tooling: false` | `.github/ci/changes.integration.test.ts` | the full run |
| K8: a pull request that touches a tooling script lists the plain tooling law that reaches it, and never a `tooling-integration` file; a pull request that touches nothing a tooling test reaches lists no tooling file | test | fc.record: event, scope, tooling flag, generated `vitest list` answers over a fake lister; 100 runs | List with `--project next` alone: the tooling law is missing | `.github/ci/legs.integration.test.ts` | the full run |
| K9: T1 passes a pull request vitest call that names only `next`, `tooling` or `next-visual`, and fails one that names `next-integration`, `tooling-integration`, `today`, or no project | test | fc.record: the real check.yaml with a generated project list and spacing; 100 runs | Let `tooling-integration` pass | `.github/ci/workflow-lint/merge-line.test.ts` | lint, the merge line, the full run |
| K10: the scheduled tooling legs run `--project tooling --project tooling-integration` | test | fc.tuple: the real scheduled.yaml with generated spacing; 100 runs | Drop `--project tooling-integration`: the process laws never run | `.github/ci/workflow-lint/scheduled.test.ts` | lint, the merge line, the full run |
| K11: the `.agents/` mirror law and the `.oxlintrc.json` laws run on the merge line | pinned: today's break after pull requests 1369 and 1371 | pinned: the mirror law in `edge-config.test.ts`, under `--project next` | Move it back into the `.integration.` file: `vitest list --project next` no longer lists it | `next/apps/fabrika/src/exam/edge-config.test.ts` | the merge line, the full run |

- **Lint, type or test:** the rule itself is lint (K5); its laws are tests over planted files, as
  every rule here has. The CI laws are tests over the scripts.
- **No law here is host-only,** and none needs a real instance. K7 and K8 live in files that start a
  process (`changes` and `legs` run git and `vitest list`), so by 0584 they are `.integration.` and
  run in the full run; their pure parts are already plain neighbors. This is a new `.integration.`
  law by 0581's line, and its reason is that the file under test spawns git.

## Files

The tests step owns every exam path: `.github/**`, `oxlint-plugins/**`, `vitest.config.ts`, the
tooling test files and every next/ test. The build owns the skill text and the timing table.
"Slice" is the pull request in Size.

| File | Change | Product lines expected | Owner | Slice | How judged |
|---|---|---|---|---|---|
| `.decisions/0584-a-tests-kind-follows-what-it-uses.md` | New, in this plan's pull request | docs | lead | 0 | the owner's ruling |
| `.decisions/0539-the-merge-line-runs-no-tooling-tests.md` | Status: amended in part by 0584 | docs | lead | 0 | adr skill |
| `.decisions/0544-every-reviewed-pull-request-is-armed.md` | Status: amended in part by 0584 | docs | lead | 0 | adr skill |
| `.decisions/0536-real-resource-tests-run-only-on-the-schedule.md` | Status: amended in part by 0584 | docs | lead | 0 | adr skill |
| `.agents/skills/tests/SKILL.md` | Done in this pull request: the real-resource bullet says 0584's definition, local disk included | docs | lead | 0 | 0584 |
| `oxlint-plugins/integration-test-name.ts` | 0584's openers: add `process.kill`, the workerd starters, a remote `fetch` literal, `NodeServices.layer` with `ChildProcess.make`; drop Rolldown; the message says the full run, not the 3-hour schedule | 40 | tests | 1 | 0584 |
| `oxlint-plugins/integration-test-name.test.ts` | K1, K2 | tests | tests | 1 | laws |
| `oxlint-plugins/test-kind.ts` | New: direction 2 and the helper advice, with a folder scope | 200 | tests | 1 | 0584 |
| `oxlint-plugins/test-kind.test.ts` | New: K3, K4 | tests | tests | 1 | laws |
| `oxlint-plugins/README.md` | The rule's section: both directions, what code cannot tell, the measured false alarms | 40 | tests | 1 | 0523 |
| `next/apps/fabrika/src/exam/edge-config.test.ts` | New, by `git mv` from the split: K11 | tests | tests | 1 | reads `.oxlintrc.json` only |
| `next/apps/fabrika/src/exam/laws-scan.test.ts` | New, by the split: the scan of the real tree | tests | tests | 1 | reads repo files only |
| `next/apps/fabrika/src/exam/deps.test.ts` | New, by the split: the real next/ and import-reading blocks | tests | tests | 1 | reads repo files, Rolldown in memory |
| `next/packages/libfabrika/src/node/repositories/Git.test.ts`, `next/packages/libfabrika/src/node/repositories/Git.integration.test.ts` | `git mv`, first to second | tests | tests | 1 | real git through the Node spawner; its memory twin laws stay plain |
| `next/packages/libfabrika/src/node/repositories/Sources.test.ts`, `next/packages/libfabrika/src/node/repositories/Sources.integration.test.ts` | `git mv`, first to second | tests | tests | 1 | `ChildProcess.make("git")` on `NodeServices.layer` |
| `next/packages/libfabrika/src/node/repositories/RepositoriesGit.test.ts`, `next/packages/libfabrika/src/node/repositories/RepositoriesGit.integration.test.ts` | `git mv`, first to second | tests | tests | 1 | its spawner passes commands to the real one |
| `next/packages/libfabrika/src/node/repositories/RepositoriesGit.identity.test.ts`, `next/packages/libfabrika/src/node/repositories/RepositoriesGit.identity.integration.test.ts` | `git mv`, first to second | tests | tests | 1 | `real.spawn(command)` on the Node spawner |
| `next/apps/fabrika/src/exam/node-kinds.test.ts` | Stand-in: read the tree with `readdirSync` in place of `git ls-files`; the disable comment goes | tests | tests | 1 | its one child process only lists files |
| `next/packages/libfabrika/src/node/repositories/OpenRepository.test.ts`, `next/packages/libfabrika/src/node/repositories/OpenRepository.integration.test.ts` | `git mv`, first to second | tests | tests | 1 | a real temp folder through `NodeServices.layer` at its line 260; its spawner at line 397 is fake |
| `next/packages/libfabrika/src/node/settings/Command.test.ts` | None: its temp calls are object keys of a fake FileSystem, so K1 does not fire (K2) | 0 | tests | none | read by hand |
| `next/packages/libfabrika/src/processes/ProcessManagerMemo.test.ts`, `next/packages/libfabrika/src/processes/ProcessManagerMemo.integration.test.ts` | `git mv`, first to second | tests | tests | 1 | `storage()` reopens real SQLite files (Process.test-support.ts) |
| `next/apps/fabrika/src/settings-generated.test.ts`, `next/apps/fabrika/src/settings-generated.integration.test.ts` | `git mv`, first to second | tests | tests | 1 | it calls `plant`, which spawns oxlint in a temp folder |
| `next/packages/libfabrika/src/processes/Process.test-support.ts` | Its temp folder is made on the first `storage()` call, not on import, so the plain tests that import it and never call `storage()` touch no disk | 10 | tests | 1 | module-level `mkdtempSync` at its line 160 |
| `.github/ci/changes.mjs` | Slice 1: the `readers` entry for `settings-generated.test.ts` follows its new name, and so does `changes.test.ts`'s expected list | 1 | tests | 1 | the reader list names the file |
| `next/apps/fabrika/src/exam/alchemy-lifecycle.test.ts` | None: a spy on `spawn`, a stand-in (K2) | 0 | tests | none | read by hand |
| `next/apps/fabrika/src/grant-readers.laws.test.ts` | None: it mocks `NodeServices` with a fake command layer | 0 | tests | none | read by hand |
| `.oxlintrc.json` | Not changed; the split law reads it | 0 | tests | none | read only |
| `.github/**`, `.github/`, `.github/ci`, `.github/ci/`, `.github/workflows`, `.github/workflows/`, `oxlint-plugins/**`, `oxlint-plugins/`, `next/**/*.integration.test.ts`, `next/**/*.integration.test.tsx` | Named only: folders and globs the prose names; every file changed in them is its own row | 0 | tests | none | not files |
| `next/apps/fabrika/src/exam/plant.ts`, `oxlint-plugins/script-reads.mjs` | Not changed: read to judge the sweep, or tried as the reader | 0 | tests | none | read only |
| `vitest.config.ts` | The `tooling-integration` project; `tooling` excludes it; the projects comment | 25 | tests | 2 | 0584 |
| `vitest.shards.test.ts` | K6 | tests | tests | 2 | laws |
| `.github/workflows/scheduled.yaml` | The tooling step runs both tooling projects; its leg table comment | 4 | tests | 2 | 0584; shared with ticket 1071 |
| `.github/ci/workflow-lint/scheduled.ts` | `TOOLING_PROJECT` and the whole-tooling command | 10 | tests | 2 | shared with ticket 1071 |
| `.github/ci/workflow-lint/scheduled.test.ts` | K10 | tests | tests | 2 | laws |
| `vitest.shards.json` | Rows move with each renamed file | 90 | build | 1 to 4 | shard-rows.ts's own check |
| `.github/ci/changes.mjs` | `Need`, the tooling folders, the `next` flag; the "no flag starts a tooling test" comments go | 60 | tests | 5 | shared with ticket 1071 at its comment line 241 |
| `.github/ci/changes.integration.test.ts` | K7 | tests | tests | 5 | laws |
| `.github/ci/legs.ts` | The list call takes both projects; the note line counts tooling files | 40 | tests | 5 | Vitest `--changed` |
| `.github/ci/legs.integration.test.ts` | K8 | tests | tests | 5 | laws |
| `.github/workflows/check.yaml` | The `next` job's vitest step and comments, lines 27 to 33 and 393 to 455 | 20 | tests | 5 | shared with ticket 1071 at its lines 31 and 403 |
| `.github/ci/workflow-lint/merge-line.ts` | T1 as 0584 has it | 30 | tests | 5 | 0584 |
| `.github/ci/workflow-lint/merge-line.test.ts` | K9 | tests | tests | 5 | laws |
| `.github/ci/workflow-lint/next-job.ts` | The pinned vitest command | 10 | tests | 5 | follows check.yaml |
| `docs/plan/README.md` | Where we are now, one line, with slice 5 | docs | lead | 5 | 0013 |

## The sweep: next/'s 148 `.integration.` files on main

Counted with `git ls-files 'next/**/*.integration.test.ts' 'next/**/*.integration.test.tsx'` at
`82296f5cf`: 148. How I judged each: a read-only scan of each file's own code and of the files it
imports (relative paths and our packages' `exports` maps), looking for a starter of each kind in
the sketch, then a read by hand of every file the scan left in doubt. "Through X" names the first
helper on the way. The rule (K5) is the check that matters: the test writer confirms each row by
reading before any `git mv`, and slice 1 lands only at zero. Of the 148: 63 reach a real thing in
the ruling's list, 83 write a SQLite file or a temp folder (local disk, medium), 2 reach nothing, and 3 of the 146 that
stay split off a plain part.

| File | Change | Product lines expected | Owner | Slice | How judged |
|---|---|---|---|---|---|
| `next/apps/fabrika/e2e/chaos-revoke.integration.test.ts` | None: stays `.integration.` | 0 | tests | none | net in its own code |
| `next/apps/fabrika/e2e/reload.test-support.integration.test.ts` | None: stays `.integration.` | 0 | tests | none | process, net through reload.test-support.ts, record-wire.test-support.ts, port.test-support.ts |
| `next/apps/fabrika/e2e/stored.integration.test.ts` | None: stays `.integration.`: local disk is medium (0584) | 0 | tests | none | writes a SQLite file or temp folder itself |
| `next/apps/fabrika/src/brain-life.integration.test.ts` | None: stays `.integration.` | 0 | tests | none | process, signal, net in its own code |
| `next/apps/fabrika/src/build-command.integration.test.ts` | None: stays `.integration.` | 0 | tests | none | process in its own code |
| `next/apps/fabrika/src/build.integration.test.ts` | None: stays `.integration.`: local disk is medium (0584) | 0 | tests | none | writes a SQLite file or temp folder itself |
| `next/apps/fabrika/src/chaos.laws.integration.test.ts` | None: stays `.integration.`: local disk is medium (0584) | 0 | tests | none | writes a SQLite file or temp folder through Chaos.test-support.ts |
| `next/apps/fabrika/src/checklist-instance.laws.integration.test.ts` | None: stays `.integration.` | 0 | tests | none | net through record-wire.test-support.ts, port.test-support.ts, Process.test-support.ts |
| `next/apps/fabrika/src/checklist-runner.laws.integration.test.ts` | None: stays `.integration.`: local disk is medium (0584) | 0 | tests | none | writes a SQLite file or temp folder itself |
| `next/apps/fabrika/src/door-recovery.integration.test.ts` | None: stays `.integration.`: local disk is medium (0584) | 0 | tests | none | writes a SQLite file or temp folder itself |
| `next/apps/fabrika/src/door.integration.test.ts` | None: stays `.integration.`: local disk is medium (0584) | 0 | tests | none | writes a SQLite file or temp folder itself |
| `next/apps/fabrika/src/exam/bytes.integration.test.ts` | None: stays `.integration.`: local disk is medium (0584) | 0 | tests | none | writes a SQLite file or temp folder itself |
| `next/apps/fabrika/src/exam/client-manager-contract.integration.test.ts`, `next/apps/fabrika/src/exam/client-manager-contract.test.ts` | `git mv`, first to second | tests | tests | 1 | reaches no real thing: it reads repo files in its own process, Rolldown in memory |
| `next/apps/fabrika/src/exam/clock.integration.test.ts` | None: stays `.integration.` | 0 | tests | none | process through plant.ts |
| `next/apps/fabrika/src/exam/commits-git-chain.integration.test.ts` | None: stays `.integration.` | 0 | tests | none | process through commits-git.test-support.ts, commits.ts |
| `next/apps/fabrika/src/exam/commits-git-person.integration.test.ts` | None: stays `.integration.` | 0 | tests | none | process through commits.ts, commits-git.test-support.ts |
| `next/apps/fabrika/src/exam/commits-git-signatures.integration.test.ts` | None: stays `.integration.` | 0 | tests | none | process in its own code |
| `next/apps/fabrika/src/exam/commits-git-steps.integration.test.ts` | None: stays `.integration.` | 0 | tests | none | process in its own code |
| `next/apps/fabrika/src/exam/deps.integration.test.ts` | Split: `the real next/` and `reading imports` blocks move to `next/apps/fabrika/src/exam/deps.test.ts`; `planted breaks`, which writes a temp folder, stays | tests | tests | 1 | spawned oxlint or a temp folder in one part only; the other part reads repo files |
| `next/apps/fabrika/src/exam/edge-comment.integration.test.ts` | Split: the `.oxlintrc.json` describe block, the `.agents/` mirror law with it, moves with `git mv` to `next/apps/fabrika/src/exam/edge-config.test.ts`; the planted-lint part stays | tests | tests | 1 | spawned oxlint or a temp folder in one part only; the other part reads repo files |
| `next/apps/fabrika/src/exam/edges.integration.test.ts` | None: stays `.integration.` | 0 | tests | none | process in its own code |
| `next/apps/fabrika/src/exam/effect-functions.integration.test.ts` | None: stays `.integration.` | 0 | tests | none | process through plant.ts, edges.ts |
| `next/apps/fabrika/src/exam/laws-scan.integration.test.ts` | Split: the scan of the real `next/` tree moves to `next/apps/fabrika/src/exam/laws-scan.test.ts`; the planted machines, which write a temp folder, stay | tests | tests | 1 | spawned oxlint or a temp folder in one part only; the other part reads repo files |
| `next/apps/fabrika/src/exam/layers.integration.test.ts` | None: stays `.integration.` | 0 | tests | none | process in its own code |
| `next/apps/fabrika/src/exam/ledger-sql.integration.test.ts` | None: stays `.integration.` | 0 | tests | none | process through plant.ts |
| `next/apps/fabrika/src/exam/no-effect-run-outside-edge.integration.test.ts` | None: stays `.integration.` | 0 | tests | none | process through plant.ts |
| `next/apps/fabrika/src/exam/no-hand-tag.integration.test.ts` | None: stays `.integration.` | 0 | tests | none | process through plant.ts |
| `next/apps/fabrika/src/exam/no-of.integration.test.ts` | None: stays `.integration.` | 0 | tests | none | process through plant.ts |
| `next/apps/fabrika/src/exam/no-promises.integration.test.ts` | None: stays `.integration.` | 0 | tests | none | process through plant.ts |
| `next/apps/fabrika/src/exam/object-imports.integration.test.ts` | None: stays `.integration.` | 0 | tests | none | process through plant.ts |
| `next/apps/fabrika/src/exam/one-store-hook.integration.test.ts` | None: stays `.integration.` | 0 | tests | none | process in its own code |
| `next/apps/fabrika/src/exam/ratchet.integration.test.ts` | None: stays `.integration.` | 0 | tests | none | process in its own code |
| `next/apps/fabrika/src/exam/react-rules.integration.test.ts` | None: stays `.integration.` | 0 | tests | none | process through plant.ts |
| `next/apps/fabrika/src/exam/secret-types.integration.test.ts` | None: stays `.integration.`: local disk is medium (0584) | 0 | tests | none | writes a SQLite file or temp folder itself |
| `next/apps/fabrika/src/exam/tsconfig-scope.integration.test.ts` | None: stays `.integration.` | 0 | tests | none | process in its own code |
| `next/apps/fabrika/src/exam/twin.integration.test.ts` | None: stays `.integration.` | 0 | tests | none | process in its own code |
| `next/apps/fabrika/src/file-services.laws.integration.test.ts` | None: stays `.integration.` | 0 | tests | none | process in its own code |
| `next/apps/fabrika/src/hands-launcher.integration.test.ts` | None: stays `.integration.` | 0 | tests | none | process, net in its own code |
| `next/apps/fabrika/src/inbox-runner.laws.integration.test.ts` | None: stays `.integration.`: local disk is medium (0584) | 0 | tests | none | writes a SQLite file or temp folder itself |
| `next/apps/fabrika/src/input-recording.integration.test.ts` | None: stays `.integration.` | 0 | tests | none | net through record-wire.test-support.ts, port.test-support.ts, instance-database.test-support.ts |
| `next/apps/fabrika/src/instance-database.integration.test.ts` | None: stays `.integration.` | 0 | tests | none | process in its own code |
| `next/apps/fabrika/src/instance-one-file.integration.test.ts` | None: stays `.integration.` | 0 | tests | none | process, net in its own code |
| `next/apps/fabrika/src/instance-records.integration.test.ts` | None: stays `.integration.` | 0 | tests | none | process, net, signal in its own code |
| `next/apps/fabrika/src/instance-wire.integration.test.ts` | None: stays `.integration.` | 0 | tests | none | process, net, signal in its own code |
| `next/apps/fabrika/src/local-instance.integration.test.ts` | None: stays `.integration.` | 0 | tests | none | process, net through rss.fixture.ts, record-wire.test-support.ts, port.test-support.ts |
| `next/apps/fabrika/src/memory-replace.laws.integration.test.ts` | None: stays `.integration.` | 0 | tests | none | process, net in its own code |
| `next/apps/fabrika/src/port-home-guard.integration.test.ts` | None: stays `.integration.`: local disk is medium (0584) | 0 | tests | none | writes a SQLite file or temp folder itself |
| `next/apps/fabrika/src/port-home.laws.integration.test.ts` | None: stays `.integration.` | 0 | tests | none | net through record-wire.test-support.ts, port.test-support.ts, port-home.test-support.ts |
| `next/apps/fabrika/src/port.integration.test.ts` | None: stays `.integration.` | 0 | tests | none | net in its own code |
| `next/apps/fabrika/src/record.laws.integration.test.ts` | None: stays `.integration.` | 0 | tests | none | net through record-wire.test-support.ts, port.test-support.ts |
| `next/apps/fabrika/src/repository-open.integration.test.ts` | None: stays `.integration.` | 0 | tests | none | process, net in its own code |
| `next/apps/fabrika/src/runtime-recovery.laws.integration.test.ts` | None: stays `.integration.` | 0 | tests | none | net through record-wire.test-support.ts, port.test-support.ts, Process.test-support.ts |
| `next/apps/fabrika/src/runtime.laws.integration.test.ts` | None: stays `.integration.` | 0 | tests | none | net through record-wire.test-support.ts, port.test-support.ts |
| `next/apps/fabrika/src/scheduled-job-alarm.integration.test.ts` | None: stays `.integration.` | 0 | tests | none | net through record-wire.test-support.ts, port.test-support.ts |
| `next/apps/fabrika/src/settings-start.integration.test.ts` | None: stays `.integration.` | 0 | tests | none | process, signal, net in its own code |
| `next/apps/fabrika/src/sibling.laws.integration.test.ts` | None: stays `.integration.` | 0 | tests | none | net through port.test-support.ts |
| `next/apps/fabrika/src/start-child.laws.integration.test.ts` | None: stays `.integration.` | 0 | tests | none | net through start-child.test-support.ts, record-wire.test-support.ts, port.test-support.ts |
| `next/apps/fabrika/src/start-member.laws.integration.test.ts` | None: stays `.integration.` | 0 | tests | none | net through start-child.test-support.ts, record-wire.test-support.ts, port.test-support.ts |
| `next/apps/fabrika/src/tasks-wire.integration.test.ts` | None: stays `.integration.` | 0 | tests | none | net through record-wire.test-support.ts, port.test-support.ts |
| `next/apps/fabrika/src/tezgah-runner.laws.integration.test.ts` | None: stays `.integration.` | 0 | tests | none | net through record-wire.test-support.ts, port.test-support.ts |
| `next/apps/fabrika/src/worker-mail.integration.test.ts` | None: stays `.integration.` | 0 | tests | none | net through record-wire.test-support.ts, port.test-support.ts |
| `next/apps/fabrika/src/worker-monitor.integration.test.ts` | None: stays `.integration.` | 0 | tests | none | net through record-wire.test-support.ts, port.test-support.ts |
| `next/apps/fabrika/src/worker-supervision.integration.test.ts` | None: stays `.integration.` | 0 | tests | none | process, signal through workerd.test-support.ts, instance-database.test-support.ts, record-wire.test-support.ts |
| `next/apps/fabrika/src/worker-usage.integration.test.ts` | None: stays `.integration.` | 0 | tests | none | net through record-wire.test-support.ts, port.test-support.ts, instance-database.test-support.ts |
| `next/packages/libfabrika/src/access/AccessSpans.integration.test.ts` | None: stays `.integration.`: local disk is medium (0584) | 0 | tests | none | writes a SQLite file or temp folder itself |
| `next/packages/libfabrika/src/access/Authorization.integration.test.ts` | None: stays `.integration.`: local disk is medium (0584) | 0 | tests | none | writes a SQLite file or temp folder itself |
| `next/packages/libfabrika/src/access/ClientManager.integration.test.ts` | None: stays `.integration.`: local disk is medium (0584) | 0 | tests | none | writes a SQLite file or temp folder itself |
| `next/packages/libfabrika/src/cloudflare/supervision.laws.integration.test.ts` | None: stays `.integration.`: local disk is medium (0584) | 0 | tests | none | writes a SQLite file or temp folder through Process.test-support.ts |
| `next/packages/libfabrika/src/gateway/GatewayRevocation.integration.test.ts` | None: stays `.integration.`: local disk is medium (0584) | 0 | tests | none | writes a SQLite file or temp folder itself |
| `next/packages/libfabrika/src/ledger/Ledger.integration.test.ts` | None: stays `.integration.`: local disk is medium (0584) | 0 | tests | none | writes a SQLite file or temp folder itself |
| `next/packages/libfabrika/src/ledger/LedgerSpans.integration.test.ts` | None: stays `.integration.`: local disk is medium (0584) | 0 | tests | none | writes a SQLite file or temp folder itself |
| `next/packages/libfabrika/src/ledger/LedgerTurnReads.integration.test.ts` | None: stays `.integration.`: local disk is medium (0584) | 0 | tests | none | writes a SQLite file or temp folder itself |
| `next/packages/libfabrika/src/ledger/Log.integration.test.ts` | None: stays `.integration.`: local disk is medium (0584) | 0 | tests | none | writes a SQLite file or temp folder itself |
| `next/packages/libfabrika/src/ledger/Rings.integration.test.ts` | None: stays `.integration.`: local disk is medium (0584) | 0 | tests | none | writes a SQLite file or temp folder itself |
| `next/packages/libfabrika/src/node/Children.integration.test.ts` | None: stays `.integration.`: local disk is medium (0584) | 0 | tests | none | writes a SQLite file or temp folder itself |
| `next/packages/libfabrika/src/node/ChildrenMember.integration.test.ts` | None: stays `.integration.`: local disk is medium (0584) | 0 | tests | none | writes a SQLite file or temp folder itself |
| `next/packages/libfabrika/src/node/CodeStore.integration.test.ts` | None: stays `.integration.`: local disk is medium (0584) | 0 | tests | none | writes a SQLite file or temp folder itself |
| `next/packages/libfabrika/src/node/ExitReason.integration.test.ts` | None: stays `.integration.`: local disk is medium (0584) | 0 | tests | none | writes a SQLite file or temp folder itself |
| `next/packages/libfabrika/src/node/IsolateUsage.integration.test.ts` | None: stays `.integration.`: local disk is medium (0584) | 0 | tests | none | writes a SQLite file or temp folder itself |
| `next/packages/libfabrika/src/node/Monitor.integration.test.ts` | None: stays `.integration.`: local disk is medium (0584) | 0 | tests | none | writes a SQLite file or temp folder itself |
| `next/packages/libfabrika/src/node/Monitors.integration.test.ts` | None: stays `.integration.`: local disk is medium (0584) | 0 | tests | none | writes a SQLite file or temp folder itself |
| `next/packages/libfabrika/src/node/Nemesis.laws.integration.test.ts` | None: stays `.integration.`: local disk is medium (0584) | 0 | tests | none | writes a SQLite file or temp folder itself |
| `next/packages/libfabrika/src/node/ProgramMail.integration.test.ts` | None: stays `.integration.`: local disk is medium (0584) | 0 | tests | none | writes a SQLite file or temp folder through ProgramMail.test-support.ts, Process.test-support.ts |
| `next/packages/libfabrika/src/node/ProgramMailReads.integration.test.ts` | None: stays `.integration.`: local disk is medium (0584) | 0 | tests | none | writes a SQLite file or temp folder through ProgramMail.test-support.ts, Process.test-support.ts |
| `next/packages/libfabrika/src/node/ProgramMailRuntime.integration.test.ts` | None: stays `.integration.`: local disk is medium (0584) | 0 | tests | none | writes a SQLite file or temp folder through ProgramMail.test-support.ts, Process.test-support.ts |
| `next/packages/libfabrika/src/node/RecordPart.integration.test.ts` | None: stays `.integration.`: local disk is medium (0584) | 0 | tests | none | writes a SQLite file or temp folder through RecordPart.test-support.ts |
| `next/packages/libfabrika/src/node/RecordPartResources.integration.test.ts` | None: stays `.integration.`: local disk is medium (0584) | 0 | tests | none | writes a SQLite file or temp folder through RecordPart.test-support.ts |
| `next/packages/libfabrika/src/node/RecoveryJournal.integration.test.ts` | None: stays `.integration.`: local disk is medium (0584) | 0 | tests | none | writes a SQLite file or temp folder itself |
| `next/packages/libfabrika/src/node/RecoveryStoreReads.integration.test.ts` | None: stays `.integration.`: local disk is medium (0584) | 0 | tests | none | writes a SQLite file or temp folder itself |
| `next/packages/libfabrika/src/node/Relations.integration.test.ts` | None: stays `.integration.`: local disk is medium (0584) | 0 | tests | none | writes a SQLite file or temp folder itself |
| `next/packages/libfabrika/src/node/Reload.integration.test.ts` | None: stays `.integration.`: local disk is medium (0584) | 0 | tests | none | writes a SQLite file or temp folder itself |
| `next/packages/libfabrika/src/node/Replies.integration.test.ts` | None: stays `.integration.`: local disk is medium (0584) | 0 | tests | none | writes a SQLite file or temp folder itself |
| `next/packages/libfabrika/src/node/RunnerAdmission.integration.test.ts` | None: stays `.integration.`: local disk is medium (0584) | 0 | tests | none | writes a SQLite file or temp folder itself |
| `next/packages/libfabrika/src/node/StartChild.integration.test.ts` | None: stays `.integration.`: local disk is medium (0584) | 0 | tests | none | writes a SQLite file or temp folder through StartChild.test-support.ts |
| `next/packages/libfabrika/src/node/StartChildBoundary.integration.test.ts` | None: stays `.integration.`: local disk is medium (0584) | 0 | tests | none | writes a SQLite file or temp folder through StartChild.test-support.ts |
| `next/packages/libfabrika/src/node/StartChildExit.integration.test.ts` | None: stays `.integration.`: local disk is medium (0584) | 0 | tests | none | writes a SQLite file or temp folder through StartChild.test-support.ts |
| `next/packages/libfabrika/src/node/Watchers.integration.test.ts` | None: stays `.integration.`: local disk is medium (0584) | 0 | tests | none | writes a SQLite file or temp folder itself |
| `next/packages/libfabrika/src/node/access/SessionManager.integration.test.ts` | None: stays `.integration.`: local disk is medium (0584) | 0 | tests | none | writes a SQLite file or temp folder itself |
| `next/packages/libfabrika/src/node/access/SessionSender.integration.test.ts` | None: stays `.integration.`: local disk is medium (0584) | 0 | tests | none | writes a SQLite file or temp folder itself |
| `next/packages/libfabrika/src/node/build/build-assets.integration.test.ts` | None: stays `.integration.`: local disk is medium (0584) | 0 | tests | none | writes a SQLite file or temp folder itself |
| `next/packages/libfabrika/src/node/build/build-one-file.integration.test.ts` | None: stays `.integration.` | 0 | tests | none | process in its own code |
| `next/packages/libfabrika/src/node/build/css.integration.test.ts` | None: stays `.integration.`: local disk is medium (0584) | 0 | tests | none | writes a SQLite file or temp folder itself |
| `next/packages/libfabrika/src/node/build/error-cause.integration.test.ts`, `next/packages/libfabrika/src/node/build/error-cause.test.ts` | `git mv`, first to second | tests | tests | 1 | reaches no real thing: it reads repo files in its own process and gives FileSystem generated failures, a stand-in |
| `next/packages/libfabrika/src/node/client/CommandsNode.integration.test.ts` | None: stays `.integration.` | 0 | tests | none | process, signal in its own code |
| `next/packages/libfabrika/src/node/client/JournalSqlite.integration.test.ts` | None: stays `.integration.` | 0 | tests | none | process in its own code |
| `next/packages/libfabrika/src/node/client/KeyFile.integration.test.ts` | None: stays `.integration.`: local disk is medium (0584) | 0 | tests | none | writes a SQLite file or temp folder itself |
| `next/packages/libfabrika/src/node/dev/dev-control.laws.integration.test.ts` | None: stays `.integration.` | 0 | tests | none | process through dev.fixture.ts |
| `next/packages/libfabrika/src/node/dev/dev-errors.laws.integration.test.ts` | None: stays `.integration.` | 0 | tests | none | process in its own code |
| `next/packages/libfabrika/src/node/dev/dev-recording.laws.integration.test.ts` | None: stays `.integration.`: local disk is medium (0584) | 0 | tests | none | writes a SQLite file or temp folder itself |
| `next/packages/libfabrika/src/node/dev/dev-secrets.laws.integration.test.ts` | None: stays `.integration.` | 0 | tests | none | process through dev.fixture.ts |
| `next/packages/libfabrika/src/node/dev/dev.laws.integration.test.ts` | None: stays `.integration.` | 0 | tests | none | process through dev.fixture.ts |
| `next/packages/libfabrika/src/node/dev/local-dev.integration.test.ts` | None: stays `.integration.`: local disk is medium (0584) | 0 | tests | none | writes a SQLite file or temp folder itself |
| `next/packages/libfabrika/src/node/dev/supervision-spans.integration.test.ts` | None: stays `.integration.`: local disk is medium (0584) | 0 | tests | none | writes a SQLite file or temp folder through Process.test-support.ts |
| `next/packages/libfabrika/src/node/dev/watch.laws.integration.test.ts` | None: stays `.integration.`: local disk is medium (0584) | 0 | tests | none | writes a SQLite file or temp folder itself |
| `next/packages/libfabrika/src/node/gateway/RateLimit.integration.test.ts` | None: stays `.integration.`: local disk is medium (0584) | 0 | tests | none | writes a SQLite file or temp folder itself |
| `next/packages/libfabrika/src/node/gateway/Tasks.integration.test.ts` | None: stays `.integration.`: local disk is medium (0584) | 0 | tests | none | writes a SQLite file or temp folder itself |
| `next/packages/libfabrika/src/node/launchd/BrainControlLaunchd.laws.integration.test.ts` | None: stays `.integration.` | 0 | tests | none | process through Launchd.test-support.ts |
| `next/packages/libfabrika/src/node/ledger/LedgerStreams.integration.test.ts` | None: stays `.integration.`: local disk is medium (0584) | 0 | tests | none | writes a SQLite file or temp folder itself |
| `next/packages/libfabrika/src/node/repositories/OpenRepository.integration.test.ts` | None: stays `.integration.` | 0 | tests | none | process in its own code |
| `next/packages/libfabrika/src/node/repositories/RepositoryTrust.integration.test.ts` | None: stays `.integration.`: local disk is medium (0584) | 0 | tests | none | writes a SQLite file or temp folder itself |
| `next/packages/libfabrika/src/node/runtime/RunnerHands.integration.test.ts` | None: stays `.integration.`: local disk is medium (0584) | 0 | tests | none | writes a SQLite file or temp folder itself |
| `next/packages/libfabrika/src/node/runtime/RunnerInit.integration.test.ts` | None: stays `.integration.`: local disk is medium (0584) | 0 | tests | none | writes a SQLite file or temp folder itself |
| `next/packages/libfabrika/src/node/settings/Load.integration.test.ts` | None: stays `.integration.`: local disk is medium (0584) | 0 | tests | none | writes a SQLite file or temp folder itself |
| `next/packages/libfabrika/src/node/tasks/TasksDiscovery.integration.test.ts` | None: stays `.integration.`: local disk is medium (0584) | 0 | tests | none | writes a SQLite file or temp folder through TasksLedger.test-support.ts |
| `next/packages/libfabrika/src/node/tasks/TasksLedger.integration.test.ts` | None: stays `.integration.`: local disk is medium (0584) | 0 | tests | none | writes a SQLite file or temp folder through TasksLedger.test-support.ts |
| `next/packages/libfabrika/src/presence/Connections.integration.test.ts` | None: stays `.integration.`: local disk is medium (0584) | 0 | tests | none | writes a SQLite file or temp folder through Process.test-support.ts |
| `next/packages/libfabrika/src/processes/ProcessLifecycle.integration.test.ts` | None: stays `.integration.`: local disk is medium (0584) | 0 | tests | none | writes a SQLite file or temp folder through Process.test-support.ts |
| `next/packages/libfabrika/src/processes/ProcessManager.integration.test.ts` | None: stays `.integration.`: local disk is medium (0584) | 0 | tests | none | writes a SQLite file or temp folder through Process.test-support.ts |
| `next/packages/libfabrika/src/processes/ProcessMonitors.integration.test.ts` | None: stays `.integration.`: local disk is medium (0584) | 0 | tests | none | writes a SQLite file or temp folder through Process.test-support.ts |
| `next/packages/libfabrika/src/processes/ProcessSpans.integration.test.ts` | None: stays `.integration.`: local disk is medium (0584) | 0 | tests | none | writes a SQLite file or temp folder through Process.test-support.ts |
| `next/packages/libfabrika/src/processes/ProcessStreams.integration.test.ts` | None: stays `.integration.`: local disk is medium (0584) | 0 | tests | none | writes a SQLite file or temp folder through Process.test-support.ts |
| `next/packages/libfabrika/src/processes/ProcessTextCaps.integration.test.ts` | None: stays `.integration.`: local disk is medium (0584) | 0 | tests | none | writes a SQLite file or temp folder through Process.test-support.ts |
| `next/packages/libfabrika/src/processes/ProcessWindow.integration.test.ts` | None: stays `.integration.`: local disk is medium (0584) | 0 | tests | none | writes a SQLite file or temp folder through Process.test-support.ts |
| `next/packages/libfabrika/src/runtime/ProcessStore.integration.test.ts` | None: stays `.integration.`: local disk is medium (0584) | 0 | tests | none | writes a SQLite file or temp folder itself |
| `next/packages/libfabrika/src/runtime/RecoveryGaps.integration.test.ts` | None: stays `.integration.`: local disk is medium (0584) | 0 | tests | none | writes a SQLite file or temp folder through Process.test-support.ts |
| `next/packages/libfabrika/src/runtime/RecoveryStore.integration.test.ts` | None: stays `.integration.`: local disk is medium (0584) | 0 | tests | none | writes a SQLite file or temp folder through Process.test-support.ts |
| `next/packages/libfabrika/src/runtime/Runner.integration.test.ts` | None: stays `.integration.`: local disk is medium (0584) | 0 | tests | none | writes a SQLite file or temp folder itself |
| `next/packages/libfabrika/src/runtime/RunnerOptions.integration.test.ts` | None: stays `.integration.`: local disk is medium (0584) | 0 | tests | none | writes a SQLite file or temp folder through Process.test-support.ts |
| `next/packages/libfabrika/src/runtime/RunnerSupervision.integration.test.ts` | None: stays `.integration.`: local disk is medium (0584) | 0 | tests | none | writes a SQLite file or temp folder through Process.test-support.ts |
| `next/packages/libfabrika/src/runtime/internal/recovery.integration.test.ts` | None: stays `.integration.`: local disk is medium (0584) | 0 | tests | none | writes a SQLite file or temp folder through Process.test-support.ts |
| `next/packages/libfabrika/src/telemetry/Records.integration.test.ts` | None: stays `.integration.`: local disk is medium (0584) | 0 | tests | none | writes a SQLite file or temp folder itself |
| `next/packages/libfabrika/src/telemetry/Sink.integration.test.ts` | None: stays `.integration.`: local disk is medium (0584) | 0 | tests | none | writes a SQLite file or temp folder itself |
| `next/packages/libfabrika/src/telemetry/internal/measurements.integration.test.ts` | None: stays `.integration.`: local disk is medium (0584) | 0 | tests | none | writes a SQLite file or temp folder itself |
| `next/packages/libfabrika/src/transport/Sshsig.integration.test.ts` | None: stays `.integration.` | 0 | tests | none | process in its own code |
| `next/packages/libfabrika/src/transport/SshsigWebauthn.integration.test.ts` | None: stays `.integration.` | 0 | tests | none | process in its own code |
| `next/programs/counter/src/runner.laws.integration.test.ts` | None: stays `.integration.`: local disk is medium (0584) | 0 | tests | none | writes a SQLite file or temp folder itself |
| `next/programs/pipeline/src/node/queue.laws.integration.test.ts` | None: stays `.integration.`: local disk is medium (0584) | 0 | tests | none | writes a SQLite file or temp folder itself |
| `next/programs/pipeline/src/node/runner.laws.integration.test.ts` | None: stays `.integration.`: local disk is medium (0584) | 0 | tests | none | writes a SQLite file or temp folder itself |

## The sweep: tooling's 133 test files

The tooling project's files on main (`vitest.config.ts`'s `TOOLING` globs, fixtures left out):
133. Judged the same way. 88 start a process (most run the script they test, or oxlint through
`next/apps/fabrika/src/exam/plant.ts`), send a signal, open a port, or write disk; each becomes
`.integration.` with `git mv`, by folder, and its references move with it (`vitest.shards.json`
rows, and any test or script that names the file; the test writer greps each old name). The other
45 reach nothing real and stay plain, so slice 5 starts running them on pull requests; they are the
last rows.

| File | Change | Product lines expected | Owner | Slice | How judged |
|---|---|---|---|---|---|
| `.github/ci/apt.test.ts`, `.github/ci/apt.integration.test.ts` | `git mv`, first to second | tests | tests | 2 | process in its own code |
| `.github/ci/changes.test.ts`, `.github/ci/changes.integration.test.ts` | `git mv`, first to second | tests | tests | 2 | process in its own code |
| `.github/ci/field-check.test.ts`, `.github/ci/field-check.integration.test.ts` | `git mv`, first to second | tests | tests | 2 | process in its own code |
| `.github/ci/legs.test.ts`, `.github/ci/legs.integration.test.ts` | `git mv`, first to second | tests | tests | 2 | process in its own code |
| `.github/ci/required.test.ts`, `.github/ci/required.integration.test.ts` | `git mv`, first to second | tests | tests | 2 | process in its own code |
| `.github/ci/shard-rows.test.ts`, `.github/ci/shard-rows.integration.test.ts` | `git mv`, first to second | tests | tests | 2 | process in its own code |
| `.github/ci/workflow-lint/triggers.test.ts`, `.github/ci/workflow-lint/triggers.integration.test.ts` | `git mv`, first to second | tests | tests | 2 | process in its own code |
| `scripts/caps.test.ts`, `scripts/caps.integration.test.ts` | `git mv`, first to second | tests | tests | 2 | process, signal in its own code |
| `scripts/testhome.test.ts`, `scripts/testhome.integration.test.ts` | `git mv`, first to second | tests | tests | 2 | process in its own code |
| `vitest.changed.test.ts`, `vitest.changed.integration.test.ts` | `git mv`, first to second | tests | tests | 2 | process in its own code |
| `oxlint-plugins/advice.test.ts`, `oxlint-plugins/advice.integration.test.ts` | `git mv`, first to second | tests | tests | 3 | process in its own code |
| `oxlint-plugins/after-hooks.test.ts`, `oxlint-plugins/after-hooks.integration.test.ts` | `git mv`, first to second | tests | tests | 3 | process through plant.ts |
| `oxlint-plugins/decode-guards.test.ts`, `oxlint-plugins/decode-guards.integration.test.ts` | `git mv`, first to second | tests | tests | 3 | process in its own code |
| `oxlint-plugins/door-is-library.test.ts`, `oxlint-plugins/door-is-library.integration.test.ts` | `git mv`, first to second | tests | tests | 3 | process through plant.ts |
| `oxlint-plugins/exact-versions.test.ts`, `oxlint-plugins/exact-versions.integration.test.ts` | `git mv`, first to second | tests | tests | 3 | process in its own code |
| `oxlint-plugins/integration-test-name.test.ts`, `oxlint-plugins/integration-test-name.integration.test.ts` | `git mv`, first to second | tests | tests | 3 | process, net, Playwright or Electron in its own code |
| `oxlint-plugins/isolate-boundary.test.ts`, `oxlint-plugins/isolate-boundary.integration.test.ts` | `git mv`, first to second | tests | tests | 3 | process through plant.ts |
| `oxlint-plugins/jsdocs.test.ts`, `oxlint-plugins/jsdocs.integration.test.ts` | `git mv`, first to second | tests | tests | 3 | process in its own code |
| `oxlint-plugins/law-shape.test.ts`, `oxlint-plugins/law-shape.integration.test.ts` | `git mv`, first to second | tests | tests | 3 | process in its own code |
| `oxlint-plugins/ledger.test.ts`, `oxlint-plugins/ledger.integration.test.ts` | `git mv`, first to second | tests | tests | 3 | process through plant.ts |
| `oxlint-plugins/modules.test.ts`, `oxlint-plugins/modules.integration.test.ts` | `git mv`, first to second | tests | tests | 3 | process through plant.ts |
| `oxlint-plugins/no-cause-squash.test.ts`, `oxlint-plugins/no-cause-squash.integration.test.ts` | `git mv`, first to second | tests | tests | 3 | process through plant.ts |
| `oxlint-plugins/no-default-export.test.ts`, `oxlint-plugins/no-default-export.integration.test.ts` | `git mv`, first to second | tests | tests | 3 | process through plant.ts |
| `oxlint-plugins/no-node-filesystem.test.ts`, `oxlint-plugins/no-node-filesystem.integration.test.ts` | `git mv`, first to second | tests | tests | 3 | process in its own code |
| `oxlint-plugins/no-node-imports.test.ts`, `oxlint-plugins/no-node-imports.integration.test.ts` | `git mv`, first to second | tests | tests | 3 | process through plant.ts |
| `oxlint-plugins/no-question-word-key.test.ts`, `oxlint-plugins/no-question-word-key.integration.test.ts` | `git mv`, first to second | tests | tests | 3 | process through plant.ts |
| `oxlint-plugins/no-stage-word.test.ts`, `oxlint-plugins/no-stage-word.integration.test.ts` | `git mv`, first to second | tests | tests | 3 | process through plant.ts |
| `oxlint-plugins/no-static-layer.test.ts`, `oxlint-plugins/no-static-layer.integration.test.ts` | `git mv`, first to second | tests | tests | 3 | process through plant.ts |
| `oxlint-plugins/no-wall-clock.test.ts`, `oxlint-plugins/no-wall-clock.integration.test.ts` | `git mv`, first to second | tests | tests | 3 | process through plant.ts |
| `oxlint-plugins/one-id-module.test.ts`, `oxlint-plugins/one-id-module.integration.test.ts` | `git mv`, first to second | tests | tests | 3 | process through plant.ts |
| `oxlint-plugins/one-machine-per-file.test.ts`, `oxlint-plugins/one-machine-per-file.integration.test.ts` | `git mv`, first to second | tests | tests | 3 | process in its own code |
| `oxlint-plugins/outside-input-constructor.test.ts`, `oxlint-plugins/outside-input-constructor.integration.test.ts` | `git mv`, first to second | tests | tests | 3 | process through plant.ts |
| `oxlint-plugins/package-imports.test.ts`, `oxlint-plugins/package-imports.integration.test.ts` | `git mv`, first to second | tests | tests | 3 | process through plant.ts |
| `oxlint-plugins/padding-line-between-statements.test.ts`, `oxlint-plugins/padding-line-between-statements.integration.test.ts` | `git mv`, first to second | tests | tests | 3 | process in its own code |
| `oxlint-plugins/parallel.test.ts`, `oxlint-plugins/parallel.integration.test.ts` | `git mv`, first to second | tests | tests | 3 | process in its own code |
| `oxlint-plugins/plants.test.ts`, `oxlint-plugins/plants.integration.test.ts` | `git mv`, first to second | tests | tests | 3 | process, Playwright or Electron in its own code |
| `oxlint-plugins/prefer-schema-arbitrary.test.ts`, `oxlint-plugins/prefer-schema-arbitrary.integration.test.ts` | `git mv`, first to second | tests | tests | 3 | process in its own code |
| `oxlint-plugins/program-package-layout.test.ts`, `oxlint-plugins/program-package-layout.integration.test.ts` | `git mv`, first to second | tests | tests | 3 | process, workerd in its own code |
| `oxlint-plugins/runs-from-depth.test.ts`, `oxlint-plugins/runs-from-depth.integration.test.ts` | `git mv`, first to second | tests | tests | 3 | process, workerd in its own code |
| `oxlint-plugins/script-reads.test.ts`, `oxlint-plugins/script-reads.integration.test.ts` | `git mv`, first to second | tests | tests | 3 | process in its own code |
| `oxlint-plugins/service-contract.test.ts`, `oxlint-plugins/service-contract.integration.test.ts` | `git mv`, first to second | tests | tests | 3 | Playwright or Electron, process in its own code |
| `oxlint-plugins/service-id.test.ts`, `oxlint-plugins/service-id.integration.test.ts` | `git mv`, first to second | tests | tests | 3 | process in its own code |
| `oxlint-plugins/stylelint.test.ts`, `oxlint-plugins/stylelint.integration.test.ts` | `git mv`, first to second | tests | tests | 3 | process in its own code |
| `oxlint-plugins/terminology.test.ts`, `oxlint-plugins/terminology.integration.test.ts` | `git mv`, first to second | tests | tests | 3 | process through plant.ts |
| `oxlint-plugins/workspace-reach.test.ts`, `oxlint-plugins/workspace-reach.integration.test.ts` | `git mv`, first to second | tests | tests | 3 | process in its own code |
| `oxlint-plugins/written-service-type.test.ts`, `oxlint-plugins/written-service-type.integration.test.ts` | `git mv`, first to second | tests | tests | 3 | process through plant.ts |
| `.agents/skills/lead/scripts/agents.test.ts`, `.agents/skills/lead/scripts/agents.integration.test.ts` | `git mv`, first to second | tests | tests | 4 | writes a SQLite file or temp folder itself |
| `.agents/skills/lead/scripts/botpush.test.ts`, `.agents/skills/lead/scripts/botpush.integration.test.ts` | `git mv`, first to second | tests | tests | 4 | process in its own code |
| `.agents/skills/lead/scripts/box.test.ts`, `.agents/skills/lead/scripts/box.integration.test.ts` | `git mv`, first to second | tests | tests | 4 | process, signal in its own code |
| `.agents/skills/lead/scripts/boxfiles.test.ts`, `.agents/skills/lead/scripts/boxfiles.integration.test.ts` | `git mv`, first to second | tests | tests | 4 | process in its own code |
| `.agents/skills/lead/scripts/boxrm.guards.test.ts`, `.agents/skills/lead/scripts/boxrm.guards.integration.test.ts` | `git mv`, first to second | tests | tests | 4 | process in its own code |
| `.agents/skills/lead/scripts/boxrm.storage.test.ts`, `.agents/skills/lead/scripts/boxrm.storage.integration.test.ts` | `git mv`, first to second | tests | tests | 4 | process through boxrm.test-support.ts |
| `.agents/skills/lead/scripts/boxrm.test.ts`, `.agents/skills/lead/scripts/boxrm.integration.test.ts` | `git mv`, first to second | tests | tests | 4 | process in its own code |
| `.agents/skills/lead/scripts/chain.test.ts`, `.agents/skills/lead/scripts/chain.integration.test.ts` | `git mv`, first to second | tests | tests | 4 | writes a SQLite file or temp folder itself |
| `.agents/skills/lead/scripts/ci/ChecksGh.test.ts`, `.agents/skills/lead/scripts/ci/ChecksGh.integration.test.ts` | `git mv`, first to second | tests | tests | 4 | process in its own code |
| `.agents/skills/lead/scripts/clauderow.test.ts`, `.agents/skills/lead/scripts/clauderow.integration.test.ts` | `git mv`, first to second | tests | tests | 4 | process in its own code |
| `.agents/skills/lead/scripts/codexexec.test.ts`, `.agents/skills/lead/scripts/codexexec.integration.test.ts` | `git mv`, first to second | tests | tests | 4 | writes a SQLite file or temp folder itself |
| `.agents/skills/lead/scripts/drive.test.ts`, `.agents/skills/lead/scripts/drive.integration.test.ts` | `git mv`, first to second | tests | tests | 4 | process in its own code |
| `.agents/skills/lead/scripts/fieldfile.test.ts`, `.agents/skills/lead/scripts/fieldfile.integration.test.ts` | `git mv`, first to second | tests | tests | 4 | process in its own code |
| `.agents/skills/lead/scripts/flow/host.test.ts`, `.agents/skills/lead/scripts/flow/host.integration.test.ts` | `git mv`, first to second | tests | tests | 4 | writes a SQLite file or temp folder itself |
| `.agents/skills/lead/scripts/flow/walk.test.ts`, `.agents/skills/lead/scripts/flow/walk.integration.test.ts` | `git mv`, first to second | tests | tests | 4 | writes a SQLite file or temp folder itself |
| `.agents/skills/lead/scripts/gc.test.ts`, `.agents/skills/lead/scripts/gc.integration.test.ts` | `git mv`, first to second | tests | tests | 4 | process in its own code |
| `.agents/skills/lead/scripts/gcloop.test.ts`, `.agents/skills/lead/scripts/gcloop.integration.test.ts` | `git mv`, first to second | tests | tests | 4 | writes a SQLite file or temp folder itself |
| `.agents/skills/lead/scripts/keepruns.test.ts`, `.agents/skills/lead/scripts/keepruns.integration.test.ts` | `git mv`, first to second | tests | tests | 4 | process in its own code |
| `.agents/skills/lead/scripts/land.test.ts`, `.agents/skills/lead/scripts/land.integration.test.ts` | `git mv`, first to second | tests | tests | 4 | process in its own code |
| `.agents/skills/lead/scripts/leakgrep.commits.test.ts`, `.agents/skills/lead/scripts/leakgrep.commits.integration.test.ts` | `git mv`, first to second | tests | tests | 4 | process in its own code |
| `.agents/skills/lead/scripts/leakgrep.lines.test.ts`, `.agents/skills/lead/scripts/leakgrep.lines.integration.test.ts` | `git mv`, first to second | tests | tests | 4 | process in its own code |
| `.agents/skills/lead/scripts/leakgrep.patches.test.ts`, `.agents/skills/lead/scripts/leakgrep.patches.integration.test.ts` | `git mv`, first to second | tests | tests | 4 | process in its own code |
| `.agents/skills/lead/scripts/leakgrep.respaced.test.ts`, `.agents/skills/lead/scripts/leakgrep.respaced.integration.test.ts` | `git mv`, first to second | tests | tests | 4 | process in its own code |
| `.agents/skills/lead/scripts/leakgrep.test.ts`, `.agents/skills/lead/scripts/leakgrep.integration.test.ts` | `git mv`, first to second | tests | tests | 4 | process in its own code |
| `.agents/skills/lead/scripts/loosening.test.ts`, `.agents/skills/lead/scripts/loosening.integration.test.ts` | `git mv`, first to second | tests | tests | 4 | process in its own code |
| `.agents/skills/lead/scripts/mutbox.test.ts`, `.agents/skills/lead/scripts/mutbox.integration.test.ts` | `git mv`, first to second | tests | tests | 4 | process, Playwright or Electron in its own code |
| `.agents/skills/lead/scripts/pr/Unlisted.test.ts`, `.agents/skills/lead/scripts/pr/Unlisted.integration.test.ts` | `git mv`, first to second | tests | tests | 4 | process in its own code |
| `.agents/skills/lead/scripts/quests.test.ts`, `.agents/skills/lead/scripts/quests.integration.test.ts` | `git mv`, first to second | tests | tests | 4 | writes a SQLite file or temp folder itself |
| `.agents/skills/lead/scripts/records.test.ts`, `.agents/skills/lead/scripts/records.integration.test.ts` | `git mv`, first to second | tests | tests | 4 | process in its own code |
| `.agents/skills/lead/scripts/redact.test.ts`, `.agents/skills/lead/scripts/redact.integration.test.ts` | `git mv`, first to second | tests | tests | 4 | process in its own code |
| `.agents/skills/lead/scripts/sizecap.test.ts`, `.agents/skills/lead/scripts/sizecap.integration.test.ts` | `git mv`, first to second | tests | tests | 4 | process in its own code |
| `.agents/skills/lead/scripts/skillscheck.test.ts`, `.agents/skills/lead/scripts/skillscheck.integration.test.ts` | `git mv`, first to second | tests | tests | 4 | process in its own code |
| `.agents/skills/mutation/scripts/limit.test.ts`, `.agents/skills/mutation/scripts/limit.integration.test.ts` | `git mv`, first to second | tests | tests | 4 | process in its own code |
| `.agents/skills/mutation/scripts/run.test.ts`, `.agents/skills/mutation/scripts/run.integration.test.ts` | `git mv`, first to second | tests | tests | 4 | process, signal in its own code |
| `.agents/skills/mutation/scripts/sample.test.ts`, `.agents/skills/mutation/scripts/sample.integration.test.ts` | `git mv`, first to second | tests | tests | 4 | process in its own code |
| `.agents/skills/plan/scripts/plancheck.draft.test.ts`, `.agents/skills/plan/scripts/plancheck.draft.integration.test.ts` | `git mv`, first to second | tests | tests | 4 | process in its own code |
| `.agents/skills/plan/scripts/plancheck.test.ts`, `.agents/skills/plan/scripts/plancheck.integration.test.ts` | `git mv`, first to second | tests | tests | 4 | process through plancheck.test-support.ts |
| `.agents/skills/sev/scripts/Freeze.test.ts`, `.agents/skills/sev/scripts/Freeze.integration.test.ts` | `git mv`, first to second | tests | tests | 4 | writes a SQLite file or temp folder itself |
| `.agents/skills/sev/scripts/Incident.test.ts`, `.agents/skills/sev/scripts/Incident.integration.test.ts` | `git mv`, first to second | tests | tests | 4 | writes a SQLite file or temp folder itself |
| `.agents/skills/sev/scripts/Level.test.ts`, `.agents/skills/sev/scripts/Level.integration.test.ts` | `git mv`, first to second | tests | tests | 4 | writes a SQLite file or temp folder itself |
| `.agents/skills/step-commit/scripts/stepcommit.test.ts`, `.agents/skills/step-commit/scripts/stepcommit.integration.test.ts` | `git mv`, first to second | tests | tests | 4 | process in its own code |
| `.agents/skills/lead/scripts/box.rm.test.ts` | None: stays plain, and runs on pull requests from slice 5 | 0 | tests | 5 | reaches no starter through its imports |
| `.agents/skills/lead/scripts/boxnode.test.ts` | None: stays plain, and runs on pull requests from slice 5 | 0 | tests | 5 | reaches no starter through its imports |
| `.agents/skills/lead/scripts/ci-speed.test.ts` | None: stays plain, and runs on pull requests from slice 5 | 0 | tests | 5 | reaches no starter through its imports |
| `.agents/skills/lead/scripts/ci/typecheck.test.ts` | None: stays plain, and runs on pull requests from slice 5 | 0 | tests | 5 | reaches no starter through its imports |
| `.agents/skills/lead/scripts/flow/Beat.test.ts` | None: stays plain, and runs on pull requests from slice 5 | 0 | tests | 5 | reaches no starter through its imports |
| `.agents/skills/lead/scripts/flow/landing.test.ts` | None: stays plain, and runs on pull requests from slice 5 | 0 | tests | 5 | reaches no starter through its imports |
| `.agents/skills/lead/scripts/flow/machine.test.ts` | None: stays plain, and runs on pull requests from slice 5 | 0 | tests | 5 | reaches no starter through its imports |
| `.agents/skills/lead/scripts/movecheck.test.ts` | None: stays plain, and runs on pull requests from slice 5 | 0 | tests | 5 | reaches no starter through its imports |
| `.agents/skills/lead/scripts/pgrep.test.ts` | None: stays plain, and runs on pull requests from slice 5 | 0 | tests | 5 | reaches no starter through its imports |
| `.agents/skills/lead/scripts/pin.test.ts` | None: stays plain, and runs on pull requests from slice 5 | 0 | tests | 5 | reaches no starter through its imports |
| `.agents/skills/lead/scripts/plants.test.ts` | None: stays plain, and runs on pull requests from slice 5 | 0 | tests | 5 | reaches no starter through its imports |
| `.agents/skills/lead/scripts/pr/Arm.test.ts` | None: stays plain, and runs on pull requests from slice 5 | 0 | tests | 5 | reaches no starter through its imports |
| `.agents/skills/lead/scripts/pr/Publish.test.ts` | None: stays plain, and runs on pull requests from slice 5 | 0 | tests | 5 | reaches no starter through its imports |
| `.agents/skills/lead/scripts/pr/Queue.test.ts` | None: stays plain, and runs on pull requests from slice 5 | 0 | tests | 5 | reaches no starter through its imports |
| `.agents/skills/lead/scripts/quest.test.ts` | None: stays plain, and runs on pull requests from slice 5 | 0 | tests | 5 | reaches no starter through its imports |
| `.agents/skills/lead/scripts/runid.test.ts` | None: stays plain, and runs on pull requests from slice 5 | 0 | tests | 5 | reaches no starter through its imports |
| `.agents/skills/mutation/scripts/heartbeat.test.ts` | None: stays plain, and runs on pull requests from slice 5 | 0 | tests | 5 | reaches no starter through its imports |
| `.agents/skills/mutation/scripts/scope.test.ts` | None: stays plain, and runs on pull requests from slice 5 | 0 | tests | 5 | reaches no starter through its imports |
| `.agents/skills/sev/scripts/AlertsGh.test.ts` | None: stays plain, and runs on pull requests from slice 5 | 0 | tests | 5 | reaches no starter through its imports |
| `.agents/skills/sev/scripts/WorkflowRunsGh.test.ts` | None: stays plain, and runs on pull requests from slice 5 | 0 | tests | 5 | reaches no starter through its imports |
| `.github/ci/program.test.ts` | None: stays plain, and runs on pull requests from slice 5 | 0 | tests | 5 | reaches no starter through its imports |
| `.github/ci/related.test.ts`, `.github/ci/related.integration.test.ts` | `git mv`, first to second | tests | tests | 2 | it builds a Vitest in its own process, and the config's `githubReads` plugin runs `git ls-files` while Vitest walks the imports: a child process the import scan cannot see, found by reading |
| `.github/ci/scheduled.test.ts` | None: stays plain, and runs on pull requests from slice 5 | 0 | tests | 5 | reaches no starter through its imports |
| `.github/ci/shard-times.test.ts` | None: stays plain, and runs on pull requests from slice 5 | 0 | tests | 5 | reaches no starter through its imports |
| `.github/ci/time-table.test.ts` | None: stays plain, and runs on pull requests from slice 5 | 0 | tests | 5 | reaches no starter through its imports |
| `.github/ci/workflow-lint.test.ts` | None: stays plain, and runs on pull requests from slice 5 | 0 | tests | 5 | reaches no starter through its imports |
| `.github/ci/workflow-lint/caches.test.ts` | None: stays plain, and runs on pull requests from slice 5 | 0 | tests | 5 | reaches no starter through its imports |
| `.github/ci/workflow-lint/changes.test.ts` | None: stays plain, and runs on pull requests from slice 5 | 0 | tests | 5 | reaches no starter through its imports |
| `.github/ci/workflow-lint/check-job.test.ts` | None: stays plain, and runs on pull requests from slice 5 | 0 | tests | 5 | reaches no starter through its imports |
| `.github/ci/workflow-lint/ci-required.test.ts` | None: stays plain, and runs on pull requests from slice 5 | 0 | tests | 5 | reaches no starter through its imports |
| `.github/ci/workflow-lint/ci-speed.test.ts` | None: stays plain, and runs on pull requests from slice 5 | 0 | tests | 5 | reaches no starter through its imports |
| `.github/ci/workflow-lint/classify.test.ts` | None: stays plain, and runs on pull requests from slice 5 | 0 | tests | 5 | reaches no starter through its imports |
| `.github/ci/workflow-lint/fail-fast.test.ts` | None: stays plain, and runs on pull requests from slice 5 | 0 | tests | 5 | reaches no starter through its imports |
| `.github/ci/workflow-lint/issues.test.ts` | None: stays plain, and runs on pull requests from slice 5 | 0 | tests | 5 | reaches no starter through its imports |
| `.github/ci/workflow-lint/jobs.test.ts` | None: stays plain, and runs on pull requests from slice 5 | 0 | tests | 5 | reaches no starter through its imports |
| `.github/ci/workflow-lint/merge-line.test.ts` | None: stays plain, and runs on pull requests from slice 5 | 0 | tests | 5 | reaches no starter through its imports |
| `.github/ci/workflow-lint/next-job.test.ts` | None: stays plain, and runs on pull requests from slice 5 | 0 | tests | 5 | reaches no starter through its imports |
| `.github/ci/workflow-lint/record.test.ts` | None: stays plain, and runs on pull requests from slice 5 | 0 | tests | 5 | reaches no starter through its imports |
| `.github/ci/workflow-lint/scheduled.test.ts` | None: stays plain, and runs on pull requests from slice 5 | 0 | tests | 5 | reaches no starter through its imports |
| `.github/ci/workflow-lint/time-tables.test.ts` | None: stays plain, and runs on pull requests from slice 5 | 0 | tests | 5 | reaches no starter through its imports |
| `.github/ci/workflow-lint/token.test.ts` | None: stays plain, and runs on pull requests from slice 5 | 0 | tests | 5 | reaches no starter through its imports |
| `.github/ci/workflow-lint/typecheck-job.test.ts` | None: stays plain, and runs on pull requests from slice 5 | 0 | tests | 5 | reaches no starter through its imports |
| `oxlint-plugins/namespace-imports.test.ts` | None: stays plain, and runs on pull requests from slice 5 | 0 | tests | 5 | reaches no starter through its imports |
| `oxlint-plugins/no-of.test.ts` | None: stays plain, and runs on pull requests from slice 5 | 0 | tests | 5 | reaches no starter through its imports |
| `scripts/effect-arbitrary.test.ts` | None: stays plain, and runs on pull requests from slice 5 | 0 | tests | 5 | reaches no starter through its imports |
| `vitest.shards.test.ts` | None: stays plain, and runs on pull requests from slice 5 | 0 | tests | 5 | reaches no starter through its imports |

## Beside the cadence plan (ticket 1071)

[Pull request 1404](https://github.com/kamp-us/tea-fabrika/pull/1404) plans main's full run on a
push or an hourly catch-up. The files both plans change:

- `.github/workflows/scheduled.yaml`: 1071 changes its triggers and adds the gate job; this plan
  changes one line in the tooling step and the leg table comment (slice 2). No line is shared.
- `.github/ci/workflow-lint/scheduled.ts` and its test: 1071 changes SC1, SC5 and SC6 and adds
  SC14 to SC16; this plan changes the pinned tooling command (K10). Different laws, same files.
- `.github/workflows/check.yaml`: 1071 changes the comments at its lines 31 and 403; slice 5
  rewrites the comment blocks around both. Whoever lands second takes the other's wording.
- `.github/ci/changes.mjs`: 1071 changes the comment at its line 241, which slice 5 rewrites
  ("No event starts a tooling test"). The same.
- `vitest.config.ts` and `oxlint-plugins/integration-test-name.ts`: 1071's slice 2 changes their
  "3-hour" words; slices 1 and 2 here rewrite those same comments and the rule's message to "the
  full run", so 1071's slice 2 can drop both files.

**Order:** 1071's slice 1 is ahead in the pipeline; this plan's slices rebase on it. Neither changes
what the other decides. Call, 90%.

## Cost against the speed goal

0541's goal for pull request checks: 3 minutes median, 5 minutes worst 10%, from a ready run's start
to `ci-required` green. The last 20 green pull request runs of `check.yaml` took 23 to 227 s,
median about 145 s.

- **The next/ side moves little.** Renamed to plain: `client-manager-contract` 13.9 s and
  `error-cause` 0.3 s at pull request depth, and three split-off parts of files whose whole time is
  4.1 s or less. Leaving the pull request: the four git laws, 99 s (`Sources` 23.2, `RepositoriesGit`
  28.0, `RepositoriesGit.identity` 31.9, `Git` under 0.1). A pull request that reaches the
  repositories folder gets about 85 s faster.
- **The tooling side.** Only 1 of the 45 plain tooling files has a row in `vitest.shards.json`
  (`vitest.shards.test.ts`, 0.3 s); the size step counts the others at the table's median. The whole
  tooling project took 6 to 8.5 minutes a leg on 2 legs in the last three green full runs
  (43780996689, 43765797242, 43734956911), almost all of it in the 88 process and disk laws that stay there.
- **A tooling-only pull request** (today: no `next` leg at all) gains one leg: about 30 s of setup
  (`legs.ts`'s `SETUP`, the median of 10 measured legs) plus its laws. It runs beside `check`, which
  is on every such run and takes longer, so the time to `ci-required` should not move. About one
  machine-minute more per such run.
- **A change to a rerun trigger** (`oxlint-plugins/**`, `.oxlintrc.json`, a lockfile) already picks
  every plain next/ test; it now picks the 45 plain tooling files too, on the same legs, sized by the
  same 240 s budget.
- **Stays under the goal: 75% sure.** The doubt is the 44 unmeasured plain tooling files. What settles it: the first slice-5 run's time table rows, and the daily
  speed job (0541), which opens its issue if a stage goes over.

## Is this a setting?

| Choice | Setting? | Answer and why |
|---|---|---|
| Which things are real | No | 0584 decides it; a person does not flip it per run |
| The folder scope of `test-kind.ts` | No | A step of the rollout; slice 4 deletes it |
| The tooling folders `changes.mjs` treats as tooling | No | They are `vitest.config.ts`'s `TOOLING` globs; the build reads them from there if it can, so there is one list |
| The leg budget | Already one | `BUDGET: 240` in check.yaml, unchanged |
| The disk case | No | 0584 decides it from Google's sizes |

## Records

- **What is lost if not recorded now:** the per-file classification on main. A rename erases the
  old name's history from `vitest.shards.json`'s rows unless the row moves with it, so each slice
  moves rows, never drops them (shard-rows.ts holds that). This plan's tables are the record of how
  each file was judged.
- **Field rows** for each step, the same day, as the lead skill says.
- **The measured false alarms** for both directions on main go in the rule's README section, with
  the commit they were counted at (0523).
- **No glossary word is coined.** "Plain law" and "`.integration.` law" are used as the tests skill
  already uses them; the build adds one `.glossary/TERMS.md` row only if a reviewer finds the word
  missing.

## Validation

- `pnpm lint` (it runs `test-kind.ts` and the oxlint rule), and the narrow vitest paths of each law
  file named above, as `AGENTS.md`'s checks table says for code.
- The two directions measured on main before slice 1 blocks: one run of each over the whole tree,
  every hit read by hand and named in the README.
- After slice 5, the first pull request run's `legs:` note line shows tooling files picked, and the
  first full run shows `tooling-integration` running.

## Size

Sized by the files table, in product lines; about 80% sure of each number, less for slice 1's new
check (70%), whose reader may come from `code-graph` or be our own.

1. **The rule both ways, and next/ at zero: 300 lines.** The oxlint rule's new openers, disk
   included, `test-kind.ts` with next/ in scope, its README, the 2 renames, 3 splits, 7 plain laws
   to `.integration.`, `Process.test-support.ts`'s lazy folder and `node-kinds.test.ts`'s stand-in.
   The definition is already in 0584 and the tests skill, in this pull request. What the owner sees
   first: the `.agents/` mirror law runs on pull requests.
2. **The tooling projects and `.github/ci`, `scripts/` and the root: 130 lines.** `vitest.config.ts`'s
   `tooling-integration`, the scheduled tooling step and its lint, `test-kind.ts`'s scope, 11
   renames (`related.test.ts` among them) and their `vitest.shards.json` rows.
3. **`oxlint-plugins/`: 30 lines.** 36 renames, their rows and references, the scope.
4. **`.agents/skills/`: 40 lines.** 41 renames, their rows and references; the scope list goes.
5. **The pull request check runs plain tooling laws: 180 lines.** `changes.mjs`'s `Need`,
   `legs.ts`, `check.yaml`, T1 and the next-job lint, and the plan's README line. The sev0's payoff: the 45 plain
   tooling laws, the workflow lints among them, run on their pull requests.

Each slice lands whole. Slices 2 to 4 are mechanical and can follow each other the same day; slice
5 waits for them, since a plain name must mean plain before a pull request runs it.

Priced at about $3 a step, from ticket 1071's plan for CI work of the same kind
(field/runs rows carry no cost to price from). Five slices, each a tests, build and review step,
plus three likely send-backs.

Estimate: 18 steps, $54

## What this cannot tell us

- Whether the classification is right in every row: it comes from a read-only scan and my reading
  of the doubtful files. Import reach over-approximates use; K5 at zero on main is the real check.
- The real seconds of the 44 unmeasured plain tooling files on a pull request.
- Whether `code-graph --graph` sees test files and `node:` imports; slice 1 finds out.
- Whether a real thing hides where no code can see it (a command string run by a script, a URL built
  at run time). The rule's README names the kinds; review catches the rest.
- How often a plain tooling law will now turn a pull request red that it would have let through. That
  is the point, but nobody has counted it.
- **A break like pull request 1392's still gets past the pull request check.** With 88 tooling
  files on the full run only, `related.test.ts` among them (it reaches `git ls-files` through the
  config's `githubReads` plugin, so it lands in the `.integration.` set), a fixture that breaks it
  is caught only by main's hourly run, not by the pull request check. A folder read in place of
  that one `git ls-files` call would make it plain; this plan does not do it.

## Open questions

None.

## Findings

None.
