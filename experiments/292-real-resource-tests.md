---
date: "2026-11-14"
scripts: "none committed; a static import scan over next/'s 280 test files at 4120e0500, per-file times from the seven next job logs of push run 43630065544, and a hand read of every file the scan was unsure of. Raw data stayed under the worktree's runs/real-tests/"
summary: "next/ only, read-only, at origin/main 4120e0500. 133 of next/'s 280 test files drive a real resource (SQLite files, git, workerd, a spawned process, a browser or Electron, rolldown, sockets, temp files); they take 5,630 of 6,025 file-seconds, 93%. Counting node:sqlite on :memory: as real too, it is 151 files and 97%. Class 1 (the same suite already runs on a memory layer) is empty: no shared suite of 0062 runs on both a memory layer and a real driver; 26 of 34 run only on a SQLite file. Class 2 is 132 files: 92 whose law is about our logic and would come back with a memory layer (Sql under Ledger and Referee, 59 files, 3,030 s; the local instance, 17 files, 655 s; the git service, 3 files, 537 s; git for the commit check, 3 files, 194 s; Effect's FileSystem, 10 files, 96 s), and 40 whose subject is the real tool itself (bundler, lint runs, ssh-keygen, the port helper, end to end). Class 3 has one candidate, the commit check's forged-signature laws. A full next/ pull request run drops from about 59 machine-minutes on 7 machines to about 3 on 1. Mechanism: three Vitest projects, picked by file name (*.integration.test.ts, *.visual.test.ts), held by a lint rule; visual files run on a pull request only with a label."
---

# 292. Which next/ tests need a real resource, and how they leave the merge line

**The answer.** This is about `next/` only, at `origin/main` `4120e0500`.

- **133 of 280 test files drive a real resource. They take 5,630 of 6,025 file-seconds, 93%** of
  `next/`'s CI test time. The other 147 files take 395 s.
- **Counting SQLite opened as `:memory:` as real too** (the brief's reading), it is 151 files and
  5,832 s, 97%, and 129 files with 193 s stay on the merge line. Decision 0536's own text reads the
  other way ("anything outside the process's memory"), so both counts are here. The one-line call
  is in [what this cannot tell us](#what-this-cannot-tell-us).
- **Class 1, a pure driver proof, is empty.** Every shared suite that decision 0062 set up
  (34 modules, among them `WatchersTest`, `StartChildTest`, `RunnerAdmissionTest`) runs on one
  kind of driver only. 26 run only on a SQLite file; the few that run in memory have no real runner
  beside them. No suite runs on both. So every real file that moves takes a check off pull
  requests until a memory layer exists.
- **Class 2 is 132 files.** 92 of them (4,511 s) test our own logic, and the resource is only where
  it runs: they come back to pull requests once their interface has a memory layer. The other 40
  (1,058 s) test the real tool itself (the bundler, a lint run, `ssh-keygen`, the brain end to end),
  so the schedule is their home for good.
- **Class 3 has one candidate:** `exam/commits-git-signatures.test.ts` (61.5 s), the laws that the
  commit check refuses a forged step signature. It needs the owner's call (0536 leaves it open).
- **What a pull request's `next/` legs would cost**, for a change that reaches all of `next/`
  (the worst case; a pull request runs only what its change reaches, 0534):

```text
                                   files  file-seconds  machines  machine-minutes  longest leg
today (run 43630065544)              280         6,025         7             ~59      11.3 min
class 1 moved                        280         6,025         7             ~59      11.3 min
class 1 and 2 moved                  147+1         457         1              ~3      ~3 min
  the same, :memory: SQLite moved    129+1         255         1              ~2      ~2 min
visual files, when a label asks        7           582         2             ~12      ~7 min
the 3-hour schedule, integration     126         5,048         5             ~31      ~7.5 min
```

  The "+1" is the class 3 candidate, which runs only when a change reaches `exam/commits.ts`.
- **The interfaces that need a memory layer for class 2,** by time saved:

```text
interface                                          files  seconds  memory layer
Sql, under Ledger, Referee and the runtime stores     59    3,030  nodeSql(":memory:") where a law never reopens (ticket 643), else Ledger.layerMemory + Referee.layerMemory
the local instance (localInstance)                    17      655  an in-process instance, as cloudflare/*.test.ts already build over Alchemy's DurableObjectState
the git service (RepositoriesGit)                      3      537  GitMemory, the layer 0535 names
git for the commit check (exam/commits.ts)             3      194  a git service; commits.ts calls the git CLI today
Effect's FileSystem                                   10       96  an in-memory FileSystem layer; Effect 4.1.2 ships only FileSystem.layerNoop, a stub
```

- **The mechanism I would pick:** three Vitest projects in `vitest.config.ts`, `next`,
  `next-integration` and `next-visual`, chosen by file name: `*.integration.test.ts` and
  `*.visual.test.ts`. Pull requests and the queue run `--project next`. The schedule runs the other
  two. A pull request runs `next-visual` only when it carries a `visual` label. A lint rule holds
  the names. Why, and the other options, are in [the mechanism](#the-mechanism).

```ts
// The whole idea, as a sketch: the name says which layer a file is in, and each place runs its layers.
//   Watchers.test.ts              laws on Watchers' memory layer      pull request, queue, schedule
//   Watchers.integration.test.ts  the same suite on node:sqlite      the 3-hour schedule only
//   first-window.visual.test.ts   Chromium over the real brain       the schedule; a PR with the `visual` label
WatchersTest.suite(Watchers.layerMemory); // in Watchers.test.ts: does not exist yet (class 2)
WatchersTest.suite(nodeSql);              // in Watchers.integration.test.ts: today's Watchers.test.ts
```

## How this was measured

- **Pinned:** `origin/main` at `4120e0500de6927c86ab0a521c865a26af9f5e96` (2026-11-14). Nothing ran:
  no test, no type check. Searches ran under `nice -n 19`.
- **Which files:** `git ls-files 'next/**'` ending in `.test.ts` or `.test.tsx`: 280 files. Every one
  appears in the timed run, and no timed file is gone.
- **Real or not, statically.** A small reader built the import graph of every `.ts` and `.tsx` under
  `next/` (relative imports and the workspace packages' export maps). For each test file it read
  the file's own code and every test-side file it reaches through test-side imports (`*.test-support.ts`,
  the `*Test.ts` suites, `Testing.ts`, `*.fixture.ts`). It tags what that code drives, by the calls
  that open a resource, not by the words: `new DatabaseSync(path)`, `ChildProcess.make("git", ...)`,
  `spawn`, `chromium.launch`, `rolldown(`, `createServer`, `makeTempDirectory`, `localInstance(`,
  and so on. A helper counts only when the file calls the part that opens the resource: importing
  `record-wire.test-support.ts` for `settingsFixture` is not real, calling `recordWire(` is.
- **By hand.** I read every file the scan could not settle. Five overrides came from that read
  (named in the tables); the git and network word matches that are only strings (a job capability
  named `"git"`, a signed URL `http://127.0.0.1:18787`) were dropped by the call-based rule.
- **Times:** the seven `next` job logs of push run
  [43630065544](https://github.com/kamp-us/tea-fabrika/actions/runs/43630065544) (`59c063bce`), the
  run experiment 291 used, through `gh api --allow-escape-sequences .../actions/jobs/<id>/logs`. A
  file's seconds are the larger of its tests' sum and its first-to-last span, as 291 did, from this
  one run, not a median of three. A leg runs 3 files at once, so the file-seconds are about three
  times a leg's wall time. Machine-minutes in the table above add about 41 s of setup per vitest leg
  and 62 s per end-to-end leg, from 291's medians.
- **Shared suites:** every `XTest.suite(` and `XTest.discoverySuite(` call under `next/`, mapped to
  the files that make it.

### How each kind of resource is treated

| Kind | Treated as | Why |
|---|---|---|
| A SQLite file (`new DatabaseSync(path)`, a temp folder under `nodeSql`) | real | a file on disk, outside the process (0536) |
| SQLite on `:memory:` (`nodeSql(new DatabaseSync(":memory:"))`) | memory, counted apart | inside the process's memory, 0536's own line; the brief counts it real, so a second total is given |
| git (`git init`, `ChildProcess.make("git")`, `spawnSync("git")`) | real | a spawned process and a repo on disk |
| workerd, Miniflare, Alchemy's local runtime (`localInstance`, `dev.ts`, `alchemy/State/LocalState`) | real | a separate process with its own storage |
| Alchemy's in-process pieces (`DurableObjectState`, `RpcCallError`, `RuntimeLifecycle` with a fake spawner) | memory | plain objects in the test's process |
| A spawned process (`spawn`, `execFile`, `spawnSync`, `ChildProcess.make` on `NodeServices`) | real | outside the process; a `ChildProcessSpawner.make` fake is memory |
| A browser or Electron (Playwright, Chromium) | real, visual | the opt-in group the owner named |
| A real bundler (rolldown, `@kampus/libfabrika/build`) | real | it reads and writes files and is the slowest unit work here |
| A real socket (`createServer`, `listen`, `node:net`, a `WebSocket` to a live server, `heldPort`) | real | a port on the machine |
| Temp files (`mkdtemp`, `makeTempDirectory`, `NodeServices.layer` writing) | real | the file system beyond reading repo text |
| Reading repo files as text (`readFileSync`, `readFileString`, `NodeFileSystem` reads) | memory, reader | 0534's reader tests |
| WebCrypto (`crypto.subtle`) | memory | it runs on the thread pool, but no file here is slow for it; the slow files are slow for SQLite, git or workerd |

## The three classes

**Class 1, pure driver proof: none.** A real file is class 1 when the same shared suite already runs
on a memory layer, so moving its real run loses nothing on pull requests. The suites are there, as
0062 asked: 31 suite names (`XTest.suite(` or `XTest.discoverySuite(`; 34 modules, since four
programs each have a `RunnerTest`) are called from 30 runner files. But no suite runs on both a memory layer and a real one. Each runs where its one runner puts
it:

```text
on a SQLite file    WatchersTest, RunnerWatchersTest (node/Watchers.test.ts), StartChildTest, RunnerAdmissionTest,
                    ProjectAuditTest, ProgramMailTest (two runners, both on files), JobsTest, and the rest: 26 modules
on a temp folder    BrainFilesTest (node/launchd/BrainControlLaunchd.laws.test.ts)
on :memory: SQLite  SettingsTest, StartsTest, GatewayCauseTest, LedgerCauseTest, RuntimeCauseTest: no real runner beside them
on memory fakes     CiTest, CodeHostTest: never run on anything else
```

So 0062's "one set of laws with a driver per runtime" has one driver per suite today. That is the
whole reason class 1 is empty, under either reading of `:memory:`.

**Class 2a, real-only law, comes back with a memory layer: 92 files, 4,511 s.** The law is about
our logic, and the resource is only where it happens to run. Moving it takes the check off pull
requests until its interface gets a `layerMemory`. The interfaces are in the answer above. Two
notes on the biggest one, `Sql`:

- The cheap layer already exists and is proven. `nodeSql(new DatabaseSync(":memory:"))` is how 18
  files already run, and pull request
  [1202](https://github.com/kamp-us/tea-fabrika/pull/1202) moved `runtime.laws.test.ts`'s L4 from a
  temp file to `:memory:` after a profile put about half its time in SQLite's `COMMIT` syncing to
  disk. 0062's own consequence names this as ticket 643: "SQLite tests that never reopen use an
  in-memory database."
- It counts as a memory layer only under 0536's reading. Under the brief's, `:memory:` is still
  real SQLite, and the memory layer has to be a hand-written `Ledger.layerMemory` and
  `Referee.layerMemory` (and the stores under the runtime), which is far more work. A law that
  reopens its database (the recovery laws: `RecoveryJournal`, `StartChild`'s restart walks) needs
  that, or one handle kept open across the "reopen". Which laws reopen is not read here, file by
  file: that is a guess to settle in the plan.

**Class 2b, the real tool is the subject: 40 files, 1,058 s.** A memory layer would test nothing:

- the bundler: `build.test.ts`, `build-one-file.test.ts`, `build-assets.test.ts`, `css.test.ts`,
  `bytes.test.ts`, `deps.test.ts`, `client-manager-contract.test.ts`, `node/build/error-cause.test.ts`;
- the exam's lint runs, which plant files and spawn oxlint (`plant.ts`): `no-of`, `no-hand-tag`,
  `react-rules`, `clock`, `effect-functions`, `edge-comment`, `no-effect-run-outside-edge`,
  `object-imports`, `one-store-hook`, `no-promises`, `ledger-sql`, plus `layers`, `twin`, `ratchet`,
  `edges`, `build-command`;
- `ssh-keygen` as the reference: `Sshsig.test.ts` (p44) and `SshsigWebauthn.test.ts` (the OpenSSH
  control vector); their saved vectors stay on pull requests;
- the port helper itself (`app/src/port.test.ts`, which opens real sockets to find a free port);
- the SQL driver itself: `ledger/Ledger.test.ts`, `Log.test.ts`, `LedgerSpans.test.ts`,
  `Rings.test.ts`;
- every end-to-end file in `next/apps/fabrika/e2e/` and Tuval's `key.laws.test.ts`; 7 of these 9 are
  visual (a browser or Electron), and `chaos-revoke.test.ts` and `stored.test.ts` are integration
  only.

**Class 3, must stay real on pull requests: one candidate, `exam/commits-git-signatures.test.ts`.**
My lean is to keep it, about 65% sure:

- The commit check (`exam/commits.ts`) is what the lead's `land.ts` trusts to tell a step's signed
  commit from a forged one. These laws make real git notes and verify them with `ssh-keygen -Y
  verify`. A memory git would hold the chain, but the signature half is the reference tool itself.
- What makes the 3-hour gap matter here, and not elsewhere: if a pull request breaks the check so a
  forged chain passes, every merge in the next 3 hours is checked by the broken gate. Other real
  laws that break show up later, but nothing passes through them in the meantime.
- It costs little on the merge line: under 0534 it runs only when a change reaches
  `exam/commits.ts`, a few pull requests a week.
- The doubt: `commits-git-person`, `-steps` and `-chain` guard the same gate, and I put them in
  class 2a. If the owner wants the gate whole on pull requests, it is 4 files and 255 s, still only
  when `commits.ts` is reached. What would settle it: the owner's call, as 0536 says.

Considered and not class 3: `door.test.ts` and `GatewayRevocation.test.ts` (access laws, but over
SQL that `:memory:` keeps), `first-window.test.ts`'s generated sentinel credentials (L17; a leak a
browser shows, visual and opt-in), and `Sshsig.test.ts` p44 (its saved vectors already pin the
bytes on every pull request).

## Mixed files

A file is mixed when only some of its tests drive the resource. I read the top files and the ones
the scan hinted at; the other real files are counted as wholly real.

```text
file                                  real part                                     split
transport/Sshsig.test.ts              p44, 3 scenarios with real ssh-keygen          clean: one describe block moves
transport/SshsigWebauthn.test.ts      1 test, the OpenSSH control vector             clean
app/src/build.test.ts                 all but the first test (a format check)        clean
node/repositories/Sources.test.ts     one generated law builds real git repos        not clean: the law mixes 20 real runs with injected ones (291's fix 5); it needs cutting in two
```

## Found on the way

- **Six memory files make a temp folder when they are imported.**
  `processes/Process.test-support.ts:160` runs `mkdtempSync` at module scope, so
  `processTable.laws.test.ts`, `supervisor.laws.test.ts`, `processes/ExitReason.test.ts`,
  `internal/programMail.test.ts`, `runtime/internal/exitReason.test.ts` and `node/ErrorCause.test.ts`
  touch the disk although they only use its constants. `door.test.ts:255` does the same. That breaks
  [0061](../.decisions/0061-resources-are-acquired-in-a-scope.md) (a temp folder is acquired in a
  scope), and with the file-name split it would put file system work on the merge line. The fix is
  to move `storage()` and its folder into a scope, or into an integration helper. I counted the six
  as memory.
- **The scan's own false alarms.** Matching words, not calls, marks 182 files; matching calls marks
  137, and the hand read took 5 more off (`alchemy-lifecycle` mocks `spawn`, `error-cause` builds on
  a fake disk, `settings/Command.test.ts` is a fake `FileSystem`, `instance-watch.laws` reads through
  a stub, and `node-kinds` reads the tracked list through `git ls-files`, which I count as a reader).
  So a lint rule that holds the names must read calls, and its false alarms need measuring before
  it blocks (the Checks section of `AGENTS.md`). This table is the baseline to measure it against.

## The mechanism

**My pick: three Vitest projects, chosen by file name.** About 80% sure. Vitest is 5.0.5 here
(`node_modules/vitest/package.json`), which has inline `projects` with `name` and `include`,
inherits the root config by default (`extends`, "@default true", in its own types), and filters by
`--project` with `*` wildcards and `!` exclusions
([Vitest, projects](https://vitest.dev/guide/projects)).

```ts
// vitest.config.ts, a sketch of the next/ part only; the tooling globs stay as they are.
const unit = ["next/packages/*/src/**/*.test.{ts,tsx}", "next/programs/*/src/**/*.test.{ts,tsx}", "next/apps/*/src/**/*.test.{ts,tsx}"];
const real = ["**/*.integration.test.{ts,tsx}", "**/*.visual.test.{ts,tsx}"];

projects: [
  { test: { name: "next", include: unit, exclude: [...configDefaults.exclude, ...real] } },
  { test: { name: "next-integration", include: ["next/**/*.integration.test.{ts,tsx}"] } },
  // today's vitest.e2e.config.ts moves here: one file at a time, the 120 s limit
  { test: { name: "next-visual", include: ["next/**/*.visual.test.{ts,tsx}"], maxWorkers: 1, fileParallelism: false, testTimeout: 120_000, hookTimeout: 120_000 } },
  // plus a "tooling" project for the globs outside next/, unchanged
],
```

```yaml
# check.yaml, a sketch. Pull request and merge queue: the memory layer only.
- run: pnpm exec vitest run --project next $FILTER --shard "$SHARD" ...
# The visual legs start on a pull request only when it asks, never in the queue.
on:
  pull_request:
    types: [opened, synchronize, reopened, ready_for_review, labeled]
visual:
  if: github.event_name == 'pull_request' && contains(github.event.pull_request.labels.*.name, 'visual')

# scheduled.yaml (fabrikalfa/ci-runs-where), a sketch: the legs it already has, split by project.
- run: pnpm exec vitest run --project next --project next-integration --shard "$SHARD" ...   # legs 1 to 5
- run: pnpm exec vitest run --project next-visual --shard "${SHARD#e2e-}" ...                 # legs e2e-1, e2e-2
```

Why a file name, and not the other ways:

- **Against a folder** (`integration/`, `e2e/`): 0062 already puts a suite's runner in the module
  that owns the driver, and 0032 keeps a test beside its module. A folder would move 133 files away
  from what they test. Today's `e2e/` folder also mixes the two kinds: `stored.test.ts` and
  `chaos-revoke.test.ts` drive no browser.
- **Against Vitest's test tags** (`tags`, `--tags-filter`, also in 5.0.5): a tag lives inside the
  file, so the merge line still loads every file to filter it, and the module-level folders above
  would still run. Shards and `--changed` also work by file. A tag fits a mixed file better, which
  is the one thing it does better; the split into `X.test.ts` and `X.integration.test.ts` beside it
  does the same job.
- **Against a hand-kept list** in `check.yaml`: 0536 says a file says its kind "in a way code reads,
  so CI picks it without a list", and 0524 rules out lists that let code pass.
- **For the name:** Vitest's `include` reads it with no config per file, `--changed` still works per
  project, a reader sees the kind in the file tree, and a lint rule can check it both ways: a file
  whose own code or test-side helpers open a resource must carry the name, and a file with the name
  must open one.

What it costs: `git mv` of about 130 files (history follows), the split of the 4 mixed ones,
`vitest.shards.ts` rows renamed, `e2e.ts` and `vitest.e2e.config.ts` folded into the visual project,
the lint rule, and the `visual` label. The doubt: whether a pull request that only renames a file
to `.integration.test.ts` should still run it once on the merge line, as a smoke test. I would say
no, since the schedule runs it within 3 hours.

## Every real file

`lf/` is `next/packages/libfabrika/src/`, `app/` is `next/apps/fabrika/`, `prog/` is `next/programs/`,
`tuval/` is `next/packages/tuval/src/`. Seconds are from run 43630065544. "Suite" is the shared suite
the file runs; none of them has a memory runner. "Needs" is the interface whose memory layer would
bring a class 2a law back to pull requests, or why none would.

| File | s | Kind | Resources | Suite | Class | Needs |
|---|---|---|---|---|---|---|
| `lf/node/repositories/RepositoriesGit.test.ts` | 401.9 | real | temp files, git, process | - | 2a | git service (`GitMemory`) |
| `lf/node/Watchers.test.ts` | 382.5 | real | temp files, SQLite file | WatchersTest, RunnerWatchersTest | 2a | `Sql` (Ledger, Referee, stores) |
| `lf/node/StartChild.test.ts` | 376.8 | real | temp files, SQLite file | StartChildTest | 2a | `Sql` (Ledger, Referee, stores) |
| `app/e2e/resources.laws.test.ts` | 328.9 | real | browser, temp files, socket, process, workerd | - | 2b | none: visual |
| `lf/node/RunnerAdmission.test.ts` | 318.7 | real | temp files, SQLite file | RunnerAdmissionTest, ProjectAuditTest | 2a | `Sql` (Ledger, Referee, stores) |
| `lf/node/ProgramMailRuntime.test.ts` | 235.2 | real | temp files, SQLite file | ProgramMailTest | 2a | `Sql` (Ledger, Referee, stores) |
| `app/src/build.test.ts` | 206.4 | mixed | bundler, temp files | - | 2b | none: the tool is the subject. the first test is a format check on source text; the rest bundle. Clean split |
| `app/e2e/first-window.test.ts` | 181.8 | real | browser, temp files, socket, process, SQLite file, workerd | - | 2b | none: visual |
| `app/src/door.test.ts` | 180.5 | real | temp files, SQLite file, SQLite :memory: | - | 2a | `Sql` (Ledger, Referee, stores) |
| `lf/runtime/Runner.test.ts` | 166.7 | real | temp files, SQLite file | - | 2a | `Sql` (Ledger, Referee, stores) |
| `lf/node/gateway/Jobs.test.ts` | 154.7 | real | temp files, SQLite file | - | 2a | `Sql` (Ledger, Referee, stores) |
| `app/src/start-child.laws.test.ts` | 139.6 | real | bundler, temp files, socket, workerd | - | 2a | local instance |
| `app/src/runtime-recovery.laws.test.ts` | 136.8 | real | temp files, SQLite file, SQLite :memory: | - | 2a | `Sql` (Ledger, Referee, stores) |
| `app/src/instance-wire.test.ts` | 133.9 | real | temp files, socket, process, SQLite file, workerd | - | 2a | local instance |
| `app/src/chaos.laws.test.ts` | 124.2 | real | temp files, SQLite file | RunnerTest, TargetsTest | 2a | `Sql` (Ledger, Referee, stores) |
| `app/src/instance-records.test.ts` | 105.8 | real | bundler, temp files, socket, process, SQLite :memory:, workerd | - | 2a | local instance |
| `lf/node/repositories/OpenRepository.test.ts` | 97.5 | real | temp files, git, process, SQLite :memory: | - | 2a | git service (`GitMemory`) |
| `lf/runtime/RunnerSupervision.test.ts` | 91.8 | real | temp files, SQLite file | - | 2a | `Sql` (Ledger, Referee, stores) |
| `app/src/checklist-instance.laws.test.ts` | 90.9 | real | temp files, SQLite file, SQLite :memory: | - | 2a | `Sql` (Ledger, Referee, stores) |
| `app/src/exam/commits-git-steps.test.ts` | 86.3 | real | temp files, git, process | - | 2a | git for the commit check |
| `lf/node/jobs/JobsLedger.test.ts` | 79.9 | real | temp files, SQLite file | JobsTest | 2a | `Sql` (Ledger, Referee, stores) |
| `lf/node/build/build-one-file.test.ts` | 76.6 | real | bundler, temp files, process | - | 2b | none: the tool is the subject |
| `lf/node/IsolateUsage.test.ts` | 73.4 | real | temp files, SQLite file | IsolateUsageTest | 2a | `Sql` (Ledger, Referee, stores) |
| `lf/node/launchd/BrainControlLaunchd.laws.test.ts` | 69.7 | real | temp files | FilesTest | 2a | `FileSystem` |
| `app/src/exam/commits-git-signatures.test.ts` | 61.5 | real | temp files, git, process | - | 3 | none: stays real |
| `lf/node/Children.test.ts` | 59.6 | real | temp files, SQLite file | ChildrenTest | 2a | `Sql` (Ledger, Referee, stores) |
| `app/src/exam/commits-git-person.test.ts` | 55.5 | real | temp files, git, process | - | 2a | git for the commit check |
| `lf/node/ledger/LedgerStreams.test.ts` | 55.5 | real | temp files, SQLite file | - | 2a | `Sql` (Ledger, Referee, stores) |
| `lf/node/RecoveryJournal.test.ts` | 52.8 | real | temp files, SQLite file | RecoveryJournalTest | 2a | `Sql` (Ledger, Referee, stores) |
| `app/src/exam/commits-git-chain.test.ts` | 52.4 | real | temp files, git, process | - | 2a | git for the commit check |
| `prog/pipeline/src/node/queue.laws.test.ts` | 51.6 | real | temp files, SQLite file | QueueRunnerTest | 2a | `Sql` (Ledger, Referee, stores) |
| `lf/node/Replies.test.ts` | 47.2 | real | temp files, SQLite file | RepliesTest, RunnerRepliesTest | 2a | `Sql` (Ledger, Referee, stores) |
| `app/e2e/chaos-revoke.test.ts` | 43.5 | real | bundler, temp files, socket, SQLite file, workerd | - | 2b | none: visual |
| `app/src/instance-one-file.test.ts` | 39.8 | real | temp files, socket, process, workerd | - | 2a | local instance |
| `lf/node/build/build-assets.test.ts` | 37.2 | real | bundler, temp files | - | 2b | none: the tool is the subject |
| `lf/node/repositories/Sources.test.ts` | 37.2 | mixed | temp files, git, process | - | 2a | git service (`GitMemory`). one generated law makes real git repos; the injected-run part is memory. Split needs the law cut in two |
| `app/src/worker-mail.test.ts` | 36.7 | real | bundler, temp files, socket, workerd | - | 2a | local instance |
| `app/src/runtime.laws.test.ts` | 35.8 | real | temp files, SQLite file, SQLite :memory: | - | 2a | `Sql` (Ledger, Referee, stores) |
| `app/e2e/client-protocol.test.ts` | 35.7 | real | browser, temp files, socket, process, workerd | - | 2b | none: visual |
| `app/src/brain-life.test.ts` | 34.5 | real | temp files, socket, process, workerd | - | 2a | local instance |
| `app/src/worker-supervision.test.ts` | 34 | real | temp files, socket, process, workerd | - | 2a | local instance |
| `app/src/repository-open.test.ts` | 32.1 | real | temp files, git, socket, process, SQLite file, workerd | - | 2a | local instance |
| `lf/node/RecoveryStoreReads.test.ts` | 29.7 | real | temp files, SQLite file | RecoveryStoreReadsTest | 2a | `Sql` (Ledger, Referee, stores) |
| `lf/node/ProgramMail.test.ts` | 29.2 | real | temp files, SQLite file | ProgramMailTest | 2a | `Sql` (Ledger, Referee, stores) |
| `app/src/exam/no-promises.test.ts` | 29 | real | temp files, process | - | 2b | none: the tool is the subject |
| `lf/node/ExitReason.test.ts` | 29 | real | temp files, SQLite file | ExitReasonTest | 2a | `Sql` (Ledger, Referee, stores) |
| `app/src/input-recording.test.ts` | 28.5 | real | bundler, temp files, socket, SQLite file, workerd | - | 2a | local instance |
| `app/src/door-recovery.test.ts` | 22.5 | real | temp files, SQLite file | - | 2a | `Sql` (Ledger, Referee, stores) |
| `app/src/settings-start.test.ts` | 21.1 | real | bundler, temp files, socket, process, workerd | - | 2a | local instance |
| `app/e2e/instance.test.ts` | 20.4 | real | browser, temp files, socket, process, workerd | - | 2b | none: visual |
| `app/src/checklist-runner.laws.test.ts` | 19.8 | real | temp files, SQLite file | RunnerTest | 2a | `Sql` (Ledger, Referee, stores) |
| `lf/cloudflare/supervision.laws.test.ts` | 18.8 | real | temp files, SQLite file | - | 2a | `Sql` (Ledger, Referee, stores) |
| `lf/access/ClientManager.test.ts` | 17.6 | real | temp files, SQLite file | - | 2a | `Sql` (Ledger, Referee, stores) |
| `app/src/file-services.laws.test.ts` | 17.2 | real | bundler, temp files, workerd | - | 2a | local instance |
| `lf/access/Authorization.test.ts` | 15.9 | real | temp files, SQLite file | - | 2a | `Sql` (Ledger, Referee, stores) |
| `app/src/exam/twin.test.ts` | 15.2 | real | temp files, process | - | 2b | none: the tool is the subject |
| `lf/node/repositories/RepositoryTrust.test.ts` | 12.7 | real | temp files, SQLite file | RepositoryTrustTest | 2a | `Sql` (Ledger, Referee, stores) |
| `app/src/exam/client-manager-contract.test.ts` | 12.6 | real | bundler | - | 2b | none: the tool is the subject |
| `lf/processes/ProcessMonitors.test.ts` | 11.2 | real | temp files, SQLite file | - | 2a | `Sql` (Ledger, Referee, stores) |
| `lf/node/dev/dev-control.laws.test.ts` | 11.1 | real | temp files | - | 2a | `FileSystem` |
| `app/e2e/one-file.test.ts` | 10.3 | real | browser, temp files, socket, workerd | - | 2b | none: visual |
| `lf/telemetry/Sink.test.ts` | 9.8 | real | temp files, SQLite file | - | 2a | `Sql` (span sink) |
| `prog/pipeline/src/node/runner.laws.test.ts` | 9.6 | real | temp files, SQLite file | RunnerTest | 2a | `Sql` (Ledger, Referee, stores) |
| `app/src/exam/ledger-sql.test.ts` | 8.1 | real | temp files, process | - | 2b | none: the tool is the subject |
| `app/src/sibling.laws.test.ts` | 8.1 | real | temp files, socket, workerd | - | 2a | local instance |
| `lf/node/access/SessionManager.test.ts` | 8.1 | real | temp files, SQLite file | SessionManagerTest | 2a | `Sql` (Ledger, Referee, stores) |
| `app/src/exam/bytes.test.ts` | 7.9 | real | bundler, temp files | - | 2b | none: the tool is the subject |
| `lf/gateway/GatewayRevocation.test.ts` | 7.8 | real | temp files, SQLite file | - | 2a | `Sql` (Ledger, Referee, stores) |
| `lf/node/build/css.test.ts` | 7.3 | real | bundler, temp files | - | 2b | none: the tool is the subject |
| `app/src/record.laws.test.ts` | 7.2 | real | bundler, temp files, socket, SQLite :memory:, workerd | - | 2a | local instance |
| `lf/node/Nemesis.laws.test.ts` | 7 | real | temp files, SQLite file | NemesisTest | 2a | `Sql` (Ledger, Referee, stores) |
| `app/src/exam/layers.test.ts` | 6.6 | real | temp files, process | - | 2b | none: the tool is the subject |
| `app/src/scheduled-job-alarm.test.ts` | 6.2 | real | temp files, socket, workerd | - | 2a | local instance |
| `app/src/exam/deps.test.ts` | 6.1 | real | bundler, temp files | - | 2b | none: the tool is the subject |
| `app/src/inbox-runner.laws.test.ts` | 5.5 | real | temp files, SQLite file | RunnerTest | 2a | `Sql` (Ledger, Referee, stores) |
| `lf/access/AccessSpans.test.ts` | 5.2 | real | temp files, SQLite file | - | 2a | `Sql` (Ledger, Referee, stores) |
| `lf/processes/ProcessTextCaps.test.ts` | 5.1 | real | temp files, SQLite file | - | 2a | `Sql` (Ledger, Referee, stores) |
| `lf/processes/ProcessLifecycle.test.ts` | 4.8 | real | temp files, SQLite file | - | 2a | `Sql` (Ledger, Referee, stores) |
| `tuval/browser/key.laws.test.ts` | 4.6 | real | browser, bundler | - | 2b | none: visual |
| `app/src/exam/ratchet.test.ts` | 4.5 | real | temp files, git, process | - | 2b | none: the tool is the subject |
| `app/src/port-home.laws.test.ts` | 4.5 | real | bundler, temp files, socket, SQLite file, workerd | - | 2a | local instance |
| `lf/node/dev/supervision-spans.test.ts` | 4.5 | real | temp files, SQLite file | - | 2a | `Sql` (Ledger, Referee, stores) |
| `lf/runtime/RecoveryGaps.test.ts` | 4.2 | real | temp files, SQLite file | - | 2a | `Sql` (Ledger, Referee, stores) |
| `app/src/exam/secret-types.test.ts` | 3.8 | real | temp files | - | 2a | `FileSystem` |
| `app/src/local-instance.test.ts` | 3.7 | real | temp files | - | 2a | `FileSystem` |
| `lf/processes/ProcessStreams.test.ts` | 3.7 | real | temp files, SQLite file | - | 2a | `Sql` (Ledger, Referee, stores) |
| `lf/node/dev/dev-secrets.laws.test.ts` | 3.6 | real | temp files, SQLite file, SQLite :memory: | - | 2a | `Sql` (Ledger, Referee, stores) |
| `app/src/jobs-wire.test.ts` | 3.5 | real | bundler, temp files, socket, workerd | - | 2a | local instance |
| `lf/telemetry/Records.test.ts` | 3.5 | real | temp files, SQLite file | - | 2a | `Sql` (span sink) |
| `lf/node/gateway/RateLimit.test.ts` | 3.4 | real | temp files, SQLite file | RateLimitTest | 2a | `Sql` (Ledger, Referee, stores) |
| `lf/node/ProgramMailReads.test.ts` | 3.3 | real | temp files, SQLite file | ProgramMailReadsTest | 2a | `Sql` (Ledger, Referee, stores) |
| `app/src/build-command.test.ts` | 3.2 | real | temp files, process | - | 2b | none: the tool is the subject |
| `lf/node/runtime/RunnerInit.test.ts` | 3.2 | real | temp files, SQLite file | RunnerInitTest | 2a | `Sql` (Ledger, Referee, stores) |
| `lf/telemetry/internal/measurements.test.ts` | 3.2 | real | temp files, SQLite file | - | 2a | `Sql` (span sink) |
| `app/src/exam/edges.test.ts` | 2.9 | real | temp files, git, process | - | 2b | none: the tool is the subject |
| `app/src/port-home-guard.test.ts` | 2.9 | real | temp files, SQLite file | - | 2a | `Sql` (Ledger, Referee, stores) |
| `prog/counter/src/runner.laws.test.ts` | 2.8 | real | temp files, SQLite file, SQLite :memory: | - | 2a | `Sql` (Ledger, Referee, stores) |
| `lf/node/dev/local-dev.test.ts` | 2.4 | real | temp files | - | 2a | `FileSystem` |
| `app/src/worker-usage.test.ts` | 2.2 | real | bundler, temp files, socket, SQLite file, workerd | - | 2a | local instance |
| `lf/node/dev/dev.laws.test.ts` | 2.2 | real | temp files | - | 2a | `FileSystem` |
| `app/src/exam/object-imports.test.ts` | 1.5 | real | temp files, process | - | 2b | none: the tool is the subject |
| `lf/ledger/Ledger.test.ts` | 1.5 | real | temp files, SQLite file | - | 2b | none: the tool is the subject |
| `lf/ledger/Log.test.ts` | 1.5 | real | temp files, SQLite file | - | 2b | none: the tool is the subject |
| `lf/node/dev/dev-errors.laws.test.ts` | 1.5 | real | temp files | - | 2a | `FileSystem` |
| `lf/node/settings/Load.test.ts` | 1.5 | real | temp files | - | 2a | `FileSystem` |
| `lf/ledger/LedgerSpans.test.ts` | 1.4 | real | temp files, SQLite file | - | 2b | none: the tool is the subject |
| `lf/transport/Sshsig.test.ts` | 1.4 | mixed | temp files, process | - | 2b | none: the tool is the subject. 3 of its tests (p44) run real ssh-keygen; the rest are saved vectors. Clean split |
| `lf/processes/ProcessSpans.test.ts` | 1.1 | real | temp files, SQLite file | - | 2a | `Sql` (Ledger, Referee, stores) |
| `lf/runtime/internal/recovery.test.ts` | 1.1 | real | temp files, SQLite file | - | 2a | `Sql` (Ledger, Referee, stores) |
| `lf/runtime/ProcessStore.test.ts` | 1 | real | temp files, SQLite file | - | 2a | `Sql` (Ledger, Referee, stores) |
| `lf/node/RecordPartResources.test.ts` | 0.9 | real | temp files, SQLite file | - | 2a | `Sql` (Ledger, Referee, stores) |
| `lf/node/RecordPart.test.ts` | 0.8 | real | temp files, SQLite file | RecordPartTest | 2a | `Sql` (Ledger, Referee, stores) |
| `lf/presence/Connections.test.ts` | 0.6 | real | temp files, SQLite file | - | 2a | `Sql` (Ledger, Referee, stores) |
| `lf/processes/ProcessManager.test.ts` | 0.6 | real | temp files, SQLite file | - | 2a | `Sql` (Ledger, Referee, stores) |
| `app/e2e/electron-launchd.test.ts` | 0.4 | real | browser, bundler, temp files, socket, process | - | 2b | none: visual |
| `app/src/exam/one-store-hook.test.ts` | 0.4 | real | temp files, process | - | 2b | none: the tool is the subject |
| `lf/node/build/error-cause.test.ts` | 0.4 | real | bundler | - | 2b | none: the tool is the subject |
| `lf/processes/ProcessWindow.test.ts` | 0.4 | real | temp files, SQLite file | - | 2a | `Sql` (Ledger, Referee, stores) |
| `lf/transport/SshsigWebauthn.test.ts` | 0.4 | mixed | temp files, process | - | 2b | none: the tool is the subject. one test (the OpenSSH control vector) runs ssh-keygen. Clean split |
| `app/e2e/stored.test.ts` | 0.3 | real | temp files, SQLite file | - | 2b | none: visual |
| `lf/runtime/RecoveryStore.test.ts` | 0.3 | real | temp files, SQLite file | - | 2a | `Sql` (Ledger, Referee, stores) |
| `lf/ledger/Rings.test.ts` | 0.1 | real | temp files, SQLite file | - | 2b | none: the tool is the subject |
| `lf/node/dev/dev-recording.laws.test.ts` | 0.1 | real | temp files | - | 2a | `FileSystem` |
| `app/src/exam/clock.test.ts` | 0 | real | temp files, process | - | 2b | none: the tool is the subject |
| `app/src/exam/edge-comment.test.ts` | 0 | real | temp files, process | - | 2b | none: the tool is the subject |
| `app/src/exam/effect-functions.test.ts` | 0 | real | temp files, process | - | 2b | none: the tool is the subject |
| `app/src/exam/laws-scan.test.ts` | 0 | real | temp files | - | 2a | `FileSystem` |
| `app/src/exam/no-effect-run-outside-edge.test.ts` | 0 | real | temp files, process | - | 2b | none: the tool is the subject |
| `app/src/exam/no-hand-tag.test.ts` | 0 | real | temp files, process | - | 2b | none: the tool is the subject |
| `app/src/exam/no-of.test.ts` | 0 | real | temp files, process | - | 2b | none: the tool is the subject |
| `app/src/exam/react-rules.test.ts` | 0 | real | temp files, process | - | 2b | none: the tool is the subject |
| `app/src/port.test.ts` | 0 | real | socket | - | 2b | none: the tool is the subject |
| `lf/runtime/RunnerOptions.test.ts` | 0 | real | temp files, SQLite file | - | 2a | `Sql` (Ledger, Referee, stores) |

## Every memory file

These stay on pull requests and the merge queue. "SQLite :memory:" marks the 18 that move too if
`:memory:` counts as real.

| File | s | Drives | Note |
|---|---|---|---|
| `lf/cloudflare/readers.laws.test.ts` | 65 | SQLite :memory: |  |
| `app/src/exam/runner-contract.test.ts` | 61.5 | SQLite :memory: |  |
| `lf/jobs/internal/job.test.ts` | 20.6 | none |  |
| `lf/runtime/internal/watchers.test.ts` | 18.8 | none |  |
| `lf/cloudflare/connection.test.ts` | 15.5 | SQLite :memory: |  |
| `lf/cloudflare/SettingsStarts.test.ts` | 13.4 | SQLite :memory: |  |
| `lf/desktop/BrainLife.laws.test.ts` | 13.3 | none |  |
| `lf/client/WindowMachine.laws.test.ts` | 11.5 | none |  |
| `app/src/exam/alchemy-lifecycle.test.ts` | 11.1 | none | spawn is mocked; reads Alchemy's package as text |
| `lf/client/WindowStart.laws.test.ts` | 10.6 | none |  |
| `lf/packs/internal/open.test.ts` | 9 | none |  |
| `lf/cloudflare/runner-reply.laws.test.ts` | 8.8 | SQLite :memory: |  |
| `app/src/door-spans.test.ts` | 8.6 | SQLite :memory: |  |
| `app/src/exam/agents.test.ts` | 8.2 | none |  |
| `prog/pipeline/src/Queue.laws.test.ts` | 8.2 | none |  |
| `lf/runtime/EffectFunctions.test.ts` | 8.1 | SQLite :memory: |  |
| `lf/settings/TomlEdit.test.ts` | 7.5 | none |  |
| `lf/processes/Mailbox.test.ts` | 7.1 | SQLite :memory: |  |
| `lf/cloudflare/fetch.test.ts` | 6.8 | none |  |
| `lf/jobs/Job.test.ts` | 6.4 | none |  |
| `lf/desktop/BrainServiceManaged.laws.test.ts` | 3.5 | none |  |
| `app/src/settings-generated.test.ts` | 3.3 | none |  |
| `lf/transport/internal/connection.test.ts` | 3.3 | none |  |
| `lf/node/ErrorCause.test.ts` | 3.1 | SQLite :memory:; makes an empty temp folder on import |  |
| `lf/Id.test.ts` | 3 | none |  |
| `app/src/exam/agent-may.test.ts` | 2.9 | SQLite :memory: |  |
| `prog/pipeline/src/Merger.laws.test.ts` | 2.9 | none |  |
| `lf/runtime/Gateway.laws.test.ts` | 2.3 | SQLite :memory: |  |
| `lf/gateway/internal/waiting.test.ts` | 2.1 | none |  |
| `lf/runtime/Built.test.ts` | 2 | none |  |
| `lf/processes/ProcessIdGenerator.test.ts` | 1.8 | none |  |
| `lf/access/AccessMachine.laws.test.ts` | 1.7 | none |  |
| `lf/cloudflare/SettingsRecorded.test.ts` | 1.7 | none |  |
| `lf/desktop/Menu.laws.test.ts` | 1.6 | none |  |
| `lf/runtime/RunnerRecovery.laws.test.ts` | 1.6 | SQLite :memory: |  |
| `prog/chaos/src/program.laws.test.ts` | 1.6 | none |  |
| `lf/access/Access.test.ts` | 1.5 | none |  |
| `lf/processes/internal/processTable.laws.test.ts` | 1.4 | none; makes an empty temp folder on import |  |
| `lf/runtime/internal/supervisor.laws.test.ts` | 1.4 | none; makes an empty temp folder on import |  |
| `lf/ledger/LedgerTurnReads.test.ts` | 1.3 | SQLite :memory: |  |
| `lf/transport/Connection.test.ts` | 1.2 | none |  |
| `lf/transport/Handshake.laws.test.ts` | 1.2 | none |  |
| `lf/runtime/Audit.test.ts` | 1.1 | none |  |
| `lf/settings/Snapshot.test.ts` | 1.1 | none |  |
| `lf/telemetry/internal/sums.test.ts` | 1.1 | SQLite :memory: |  |
| `lf/cloudflare/p14.test.ts` | 1 | none |  |
| `lf/runtime/Client.laws.test.ts` | 1 | none |  |
| `lf/runtime/Program.test.ts` | 1 | none |  |
| `lf/cloudflare/ObjectService.test.ts` | 0.9 | none |  |
| `lf/cloudflare/alarm.laws.test.ts` | 0.9 | none |  |
| `lf/ledger/LedgerCallSpans.test.ts` | 0.9 | none |  |
| `app/src/grant-readers.laws.test.ts` | 0.8 | none |  |
| `lf/node/settings/Command.test.ts` | 0.8 | none | a fake FileSystem; the temp-folder names are its methods |
| `lf/runtime/Execution.test.ts` | 0.8 | none |  |
| `lf/cloudflare/SettingsInput.test.ts` | 0.7 | none |  |
| `lf/ledger/TraceId.test.ts` | 0.7 | SQLite :memory: |  |
| `lf/transport/Hello.test.ts` | 0.7 | none |  |
| `app/src/exam/commits.test.ts` | 0.6 | none |  |
| `lf/schedules/ScheduledJob.test.ts` | 0.6 | none |  |
| `prog/checklist/src/window.laws.test.ts` | 0.6 | none |  |
| `lf/cloudflare/error-cause.test.ts` | 0.5 | none |  |
| `app/src/instance-watch.laws.test.ts` | 0.4 | none | NodeServices for paths; the read is a stub (not run, read only) |
| `app/src/runtime.decode.test.ts` | 0.4 | none |  |
| `lf/cloudflare/SettingsRuntime.test.ts` | 0.4 | none |  |
| `lf/cloudflare/mail.test.ts` | 0.4 | none |  |
| `lf/cloudflare/platform.test.ts` | 0.4 | none |  |
| `lf/runtime/Patch.test.ts` | 0.4 | none |  |
| `lf/telemetry/internal/sink.test.ts` | 0.4 | none |  |
| `prog/pipeline/src/Change.test.ts` | 0.4 | none |  |
| `lf/cloudflare/Watchers.test.ts` | 0.3 | none |  |
| `lf/cloudflare/tail.test.ts` | 0.3 | none |  |
| `lf/node/dev/error-cause.test.ts` | 0.3 | none |  |
| `lf/processes/ExitReason.test.ts` | 0.3 | none; makes an empty temp folder on import |  |
| `lf/processes/MailboxHistory.test.ts` | 0.3 | SQLite :memory: |  |
| `lf/settings/DesktopBrain.test.ts` | 0.3 | none |  |
| `lf/settings/Files.test.ts` | 0.3 | none |  |
| `lf/settings/JsonSchema.test.ts` | 0.3 | none |  |
| `lf/settings/Print.test.ts` | 0.3 | none |  |
| `lf/settings/Reference.test.ts` | 0.3 | none |  |
| `lf/telemetry/P12Readers.laws.test.ts` | 0.3 | SQLite :memory: |  |
| `prog/checklist/src/tile.laws.test.ts` | 0.3 | none |  |
| `prog/counter/src/program.laws.test.ts` | 0.3 | none |  |
| `lf/ci/Ci.test.ts` | 0.2 | none |  |
| `lf/cloudflare/index.test.ts` | 0.2 | none |  |
| `lf/cloudflare/reach.laws.test.ts` | 0.2 | none |  |
| `lf/codehost/CodeHost.test.ts` | 0.2 | none |  |
| `lf/ledger/LedgerTransaction.test.ts` | 0.2 | SQLite :memory: |  |
| `lf/node/launchd/LaunchdStatus.laws.test.ts` | 0.2 | none |  |
| `lf/runtime/ErrorCause.test.ts` | 0.2 | none |  |
| `lf/settings/DesktopLink.test.ts` | 0.2 | none |  |
| `lf/settings/Setting.test.ts` | 0.2 | none |  |
| `lf/telemetry/ErrorCause.test.ts` | 0.2 | none |  |
| `lf/transport/Answer.test.ts` | 0.2 | none |  |
| `lf/transport/ErrorCause.test.ts` | 0.2 | none |  |
| `lf/transport/Link.laws.test.ts` | 0.2 | none |  |
| `prog/pipeline/src/Settings.test.ts` | 0.2 | none |  |
| `app/src/error-cause.test.ts` | 0.1 | none | build runs on a fake disk |
| `app/src/exam/node-kinds.test.ts` | 0.1 | reader | reads the repo's tracked list through `git ls-files`: a reader that spawns git |
| `app/src/settings.test.ts` | 0.1 | none |  |
| `lf/Id.cause.test.ts` | 0.1 | none |  |
| `lf/Testing.test.ts` | 0.1 | none |  |
| `lf/access/Passkey.test.ts` | 0.1 | none |  |
| `lf/access/Text.test.ts` | 0.1 | none |  |
| `lf/gateway/JobAccess.test.ts` | 0.1 | none |  |
| `lf/gateway/internal/rateLimit.test.ts` | 0.1 | none |  |
| `lf/node/Chaos.laws.test.ts` | 0.1 | none |  |
| `lf/node/dev/DevLife.laws.test.ts` | 0.1 | none |  |
| `lf/node/launchd/ProcessGroups.laws.test.ts` | 0.1 | none |  |
| `lf/packs/ProgramName.test.ts` | 0.1 | none |  |
| `lf/processes/internal/programMail.test.ts` | 0.1 | none; makes an empty temp folder on import |  |
| `lf/runtime/BrainLife.laws.test.ts` | 0.1 | none |  |
| `lf/runtime/Chaos.laws.test.ts` | 0.1 | none |  |
| `lf/runtime/IsolateUsage.test.ts` | 0.1 | none |  |
| `lf/runtime/Program.types.test.ts` | 0.1 | none |  |
| `lf/runtime/State.test.ts` | 0.1 | none |  |
| `lf/runtime/internal/reply.test.ts` | 0.1 | none |  |
| `lf/settings/Codec.test.ts` | 0.1 | none |  |
| `lf/settings/Sources.test.ts` | 0.1 | none |  |
| `lf/settings/Start.test.ts` | 0.1 | none |  |
| `lf/settings/TomlParser.test.ts` | 0.1 | none |  |
| `prog/checklist/src/client.laws.test.ts` | 0.1 | none |  |
| `prog/checklist/src/program.laws.test.ts` | 0.1 | none |  |
| `prog/inbox/src/program.laws.test.ts` | 0.1 | none |  |
| `prog/pipeline/src/handlers.test.ts` | 0.1 | none |  |
| `app/src/exam/compiler.test.ts` | 0 | none |  |
| `app/src/exam/effect-checks.test.ts` | 0 | none |  |
| `lf/Id.types.test.ts` | 0 | none |  |
| `lf/access/Access.types.test.ts` | 0 | none |  |
| `lf/access/ClientManager.types.test.ts` | 0 | none |  |
| `lf/client/Start.types.test.ts` | 0 | none |  |
| `lf/desktop/BrainService.types.test.ts` | 0 | none |  |
| `lf/desktop/Menu.types.test.ts` | 0 | none |  |
| `lf/gateway/Gateway.types.test.ts` | 0 | none |  |
| `lf/jobs/Jobs.types.test.ts` | 0 | none |  |
| `lf/ledger/Ledger.types.test.ts` | 0 | none |  |
| `lf/ledger/LedgerStreams.types.test.ts` | 0 | none |  |
| `lf/node/ErrorCause.types.test.ts` | 0 | none |  |
| `lf/repositories/Repositories.types.test.ts` | 0 | none |  |
| `lf/runtime/Entry.test.ts` | 0 | none |  |
| `lf/runtime/Runtime.types.test.ts` | 0 | none |  |
| `lf/runtime/internal/exitReason.test.ts` | 0 | none; makes an empty temp folder on import |  |
| `lf/settings/Toml.types.test.ts` | 0 | none |  |
| `lf/telemetry/ArchiveCryptoFailure.test.ts` | 0 | none |  |
| `lf/telemetry/Trace.types.test.ts` | 0 | none |  |
| `lf/transport/internal/binaryCryptoFailure.test.ts` | 0 | none |  |
| `prog/checklist/src/window.types.test.ts` | 0 | none |  |
| `prog/counter/src/window.types.test.ts` | 0 | none |  |

## What this cannot tell us

- **The `:memory:` call.** Is SQLite on `:memory:` a memory layer of `Sql`, as 0536's text says, or
  a real resource, as the brief says? It moves 18 files and 202 s, and it decides whether class 2a's
  biggest group is a small switch (ticket 643) or new `Ledger` and `Referee` layers.
- **Times are one run,** not a median, and a file's number misses most of its `beforeAll` work. The
  e2e times run one file at a time and the vitest ones three at a time, so the two do not add as
  wall time.
- **The scan reads code, it does not run it.** A helper that opens a resource only on some paths, or
  a resource opened through a product module the test calls without naming it, could be missed.
  The 147 memory files were not each read by hand; the 133 real ones were checked against their
  helpers.
- **Which `Sql` laws reopen their database,** and so need more than `:memory:`, is a guess.
- **Pull request [1252](https://github.com/kamp-us/tea-fabrika/pull/1252)** splits `StartChild.test.ts`
  and `JobsLedger.test.ts` into more files. It changes the file count, not the classes.
- Tooling tests (`.agents/`, `.github/ci/`, `oxlint-plugins/`) are out of scope; several of them
  are real too (`boxrm.test.ts`, `box.test.ts`).
