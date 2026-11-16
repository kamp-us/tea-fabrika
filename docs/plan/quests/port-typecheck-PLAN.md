Approved by the lead agent, builds 0113, 0410, 0033; body 828a36a9ee43
Plancheck-Version: 3

```ts
// scripts/typecheck.ts and scripts/typecheck/Typecheck.ts, sketch: the whole run, in today's tooling.
const program = Effect.gen(function* () {
  const settings = yield* Settings; // FABRIKA_TYPECHECK_LOCK, FABRIKA_TYPECHECK_COMPILER, CI: read as today
  const modules = yield* NodeModules;
  if ((yield* modules.shape) === "other") return yield* refuse(noFolderLine); // before the lock, exit 1

  return yield* Effect.scoped(
    Effect.gen(function* () {
      const held = yield* (yield* Locks).hold(settings.lock); // one label file holding our pid
      yield* waitForCompiler(settings); // 1419's wait: laptop only, skips --lsp, one line if pgrep is refused
      const linked = (yield* modules.shape) === "link";
      if (linked) yield* modules.unlink; // only the link, never its target
      for (const command of commandsFor(linked)) {
        const ended = yield* (yield* Commands).run(command, held.running); // the running pid is written down
        if (exitOf(ended) !== 0) return yield* failed(command, ended); // install line, 128 + signal
      }
      return 0;
    }),
  ); // the scope ends: the child is waited for first, then the label is removed
});
```

# Port typecheck.sh to TypeScript and Effect

ticket: 766 (the 0113 ports), this slice: `scripts/typecheck.sh`

Writer: the plan step. Version: **today's tooling** (`scripts/`, the root `package.json`, `.github/ci`,
lead scripts and skills). `next/` is not touched. Lead tooling is fast-tracked, and its code
follows `next/`'s rules ([0033](../../../.decisions/0033-agents-code-follows-next-rules.md)).

Base read: `origin/main` at `59910b0a4`, which holds pull request
https://github.com/kamp-us/tea-fabrika/pull/1419 (merged as `5c1e6b0`, after the brief was written).
So this plans against 1419's merged script, its six laws in `scripts/typecheck.integration.test.ts`,
and its `FABRIKA_TYPECHECK_COMPILER` lines in `scripts/caps.test.ts`. Every line cited is read there.

Builds three decisions: [0113](../../../.decisions/0113-no-shell-or-python-scripts.md) (port
behind services, each with a real layer and a test layer),
[0410](../../../.decisions/0410-the-machine-caps-live-in-code.md) with its 2026-11-15 amendment
(the caps are code, and the typecheck lock may be a pid lock at the same single path, merged in
https://github.com/kamp-us/tea-fabrika/pull/1509), and
[0033](../../../.decisions/0033-agents-code-follows-next-rules.md) (lead tooling follows `next/`'s
rules). `records.ts resolve 0113 0410 0033` (2026-11-16): all three accepted; 0033 is amended by
0070 and 0113. It holds [0012](../../../.decisions/0012-twelve-agents-at-once.md) (one typecheck at
a time). Reads
[0040](../../../.decisions/0040-existing-tools-before-hand-written.md) with
[0587](../../../.decisions/0587-new-helpers-and-names-cite-sources.md),
[0054](../../../.decisions/0054-read-upstream-before-patching-it.md),
[0061](../../../.decisions/0061-resources-are-acquired-in-a-scope.md),
[0062](../../../.decisions/0062-test-files-keep-the-floors.md),
[0095](../../../.decisions/0095-a-service-file-holds-only-its-contract.md),
[0250](../../../.decisions/0250-effect-modules-first-node-at-an-edge.md),
[0029](../../../.decisions/0029-format-and-names-follow-effect.md),
[0069](../../../.decisions/0069-choices-are-settings.md),
[0178](../../../.decisions/0178-host-only-laws-run-first.md),
[0536](../../../.decisions/0536-real-resource-tests-run-only-on-the-schedule.md) and
[0585](../../../.decisions/0585-kalfa-is-six-domain-packages.md). Each resolves as accepted
(`records.ts resolve`, 2026-11-16).

## Doubts, at the top

The two questions this plan once held open are answered (see "Answered questions"): the lock is a
pid lock at the same single path, by 0410's amendment, and a worktree whose `node_modules` is a
broken link gets one line and exit 1.

1. **A wrapper stopped with SIGTERM now ends its compile.** Today the compiler keeps the lock and
   runs on alone when the Python wrapper is stopped. Effect's scoped child is stopped and waited for
   when the program is interrupted. No law covers SIGTERM to the holder. Call: take the Effect
   behavior, 75%, since an orphaned 8-core compile is the very thing the lock exists to stop.

## The answer first

- **The lock:** a label file at the same path, `/tmp/fabrika-typecheck.lock` (or
  `FABRIKA_TYPECHECK_LOCK`), made atomically with `link()` from a temp file that already holds
  `<pid>\n`. A holder is alive while `kill(pid, 0)` does not say ESRCH and the process started before
  the label was written. A dead holder's lock is broken only under a second lock,
  `<lock>.break`, as Mercurial's `lock.py` does, which 0410's 2026-11-15 amendment allows. While a command runs, its pid is written in
  `<lock>.child`, so a compiler that outlives a killed wrapper still holds the lock. Source:
  Mercurial 7.2.4, `mercurial/lock.py` (`_trylock`, `_testlock`) and `posix.py` (`testpid`), read
  from the PyPI source tarball on 2026-11-16.
- **Not proper-lockfile.** It is not in `pnpm-lock.yaml`. Read from its npm tarball (4.1.2,
  `lib/lockfile.js`), it makes a folder at `<file>.lock` and keeps its mtime fresh; a lock is stale
  only after `stale` (10 s by default, 2 s at least). Three laws go red on it: a killed holder's lock
  is not taken "at once" (1419's stale law, caps' "recovers a killed typecheck holder" at 3 s), and a
  compiler that outlives its wrapper loses the lock once the refresh stops (caps' "keeps the
  compiler lock after its wrapper dies"). Its stale removal is also a `stat` then `rmdir` with
  nothing between, which can remove a fresh lock.
- **Four services, each with a real and a test layer:** `Locks` (the machine-wide lock),
  `Commands` (`pnpm install`, `effect-tsgo patch`, `pnpm -r typecheck`), `Processes` (`pgrep`,
  `ps`, `kill(pid, 0)`) and `NodeModules` (the folder check and the link's removal).
- **Every law stays green.** All eleven of `scripts/caps.test.ts`'s typecheck laws and 1419's six
  keep what they hold; sixteen change only how they start the script. One, "R4 gives every shell
  one fixed lock file", changes how it reads the path, since its stand-in `python3` no longer has
  anything to stand in for (see "Laws").
- **An old-branch typecheck can run beside a new one.** See "Old branches beside the new lock".

## How others do it

- **Mercurial's repository lock** (read, 7.2.4, `mercurial/lock.py:298-386`, `util.py:2247`,
  `posix.py:573`): the lock is made atomically (`os.symlink`, or `O_CREAT | O_EXCL` where symlinks
  are missing) and names its holder, `host:pid`. `_lockshouldbebroken` breaks it only when the host
  is this one and `testpid(pid)` is false; `testpid` is `os.kill(pid, 0)` and answers "dead" only on
  ESRCH. `_testlock` breaks it under `lock(self.f + b'.break', timeout=0)`, re-reading inside, with
  the comment "if locker dead, break lock. must do this with another lock held, or can race and
  break valid lock". This plan takes that algorithm whole.
- **proper-lockfile** (read, 4.1.2, `lib/lockfile.js:25-90`): `mkdir` as the atomic step, staleness
  by mtime, a holder that keeps touching it. Right for a lock whose holder keeps running; wrong here,
  as "The answer first" says.
- **An exclusive create with a pid** (`open(path, 'wx')`, POSIX `O_CREAT | O_EXCL`): the same
  family as Mercurial's fallback. Its gap is the moment between create and write, when the file is
  empty; 1419's `take` already retries 20 times for that window. A `link()` of a temp file that
  already holds the pid closes it, so a label is never seen empty. POSIX `link()` fails with EEXIST
  when the name exists (the POSIX spec, not fetched).
- **git's `index.lock`** (from memory, not fetched): `O_CREAT | O_EXCL` with no pid; a stale one is
  left for a person to delete. Too weak here: 1419's law takes a stale lock at once.
- **This repo, experiment 71** (`experiments/71-builder-stops.md:75-78`): for builders, a pid lock
  file was ruled out ("a reused PID or an empty file and the next start waits for good", demlik
  #689), sqlite's lock wedged after a `kill -9`, and a port or a socket file races. It took `flock`
  through perl. The pick here answers both pid-file failures in code: a label is never empty
  (`link`), and a reused pid is told apart by its start time, as experiment 71's own guard does
  (`:56-58`). An empty or unreadable label left by today's scripts is read as stale.
- **Erlang/OTP:** a lock tied to a process is `global:set_lock`, released when its holder dies
  because the holder is monitored. The pid label plus `kill(pid, 0)` is the OS-level form of that
  monitor. No tea machine: the lock's states live for one process run and nothing sends them
  messages, so the states are one tagged union decided by one pure function (below), as `drive.ts`'s
  waits are plain loops. Call, 80%.

## The shape

### Files and names

```text
scripts/typecheck.ts                 the entry: `node scripts/typecheck.ts`, NodeRuntime.runMain, the exit code
scripts/typecheck/Typecheck.ts       the program: settings, the order of steps, every line it prints
scripts/typecheck/Look.ts            domain: what one look at the lock found, and `judge`, pure
scripts/typecheck/Locks.ts           contract: Locks, Held, LockError
scripts/typecheck/LocksFile.ts       layer: the label file, `.break` and `.child`, on Effect's FileSystem
scripts/typecheck/Commands.ts        contract: Commands, Command, Ended, CommandError
scripts/typecheck/CommandsProcess.ts layer: Effect's ChildProcess, output inherited, same process group
scripts/typecheck/Processes.ts       contract: Processes, Listing
scripts/typecheck/ProcessesPs.ts     layer: pgrep -x, ps -o args= and etime=, kill(pid, 0)
scripts/typecheck/NodeModules.ts     contract: NodeModules, Shape, NodeModulesError
scripts/typecheck/NodeModulesFs.ts   layer: lstat and unlink of ./node_modules
scripts/typecheck/*Test.ts           the test layers (tests step)
```

A service file holds only its contract and each layer is a sibling file, as
`.agents/skills/lead/scripts/pr/Pushes.ts`, `PushesProcess.ts` and `PushesTest.ts` do (0095,
`.patterns/effect-services-and-layers.md`). Names follow 0029: a service that holds many is plural
(`Locks`, `Commands`, `Processes`); `NodeModules` is the folder's own name.

### The lock

```ts
// scripts/typecheck/Look.ts, sketch: one look at the lock, decided by a pure function.
export const Liveness = Schema.TaggedUnion({
  gone: {}, // kill(pid, 0) said ESRCH
  running: { startedAt: Schema.optional(Schema.Number) }, // ms; absent where ps cannot read it
});

/** What a waiter read: the label and the running command, each with its file's mtime. */
export type Look = {
  readonly label: Option.Option<{ readonly text: string; readonly at: number }>;
  readonly child: Option.Option<{ readonly text: string; readonly at: number }>;
  readonly liveness: (pid: number) => Liveness;
};

export const Seen = Schema.TaggedUnion({
  free: {},
  held: { pid: Schema.Int, by: Schema.Literals(["label", "child"]) },
  stale: { reason: Schema.Literals(["gone", "reused", "empty", "unreadable"]) },
});

// held when the label's pid, or else the child's, is running and started before its file was
// written (2 s of slack for ps's one-second clock); stale otherwise; free with no label.
export const judge = (look: Look): Seen => /* ... */;
```

```ts
// scripts/typecheck/Locks.ts, sketch: the contract.
export class LockError extends Schema.TaggedError<LockError>()("LockError", {
  path: Schema.String,
  reason: Schema.String,
  cause: Schema.optional(Schema.Defect()),
}) {}

export interface Held {
  /** Writes `pid` to `<lock>.child` while that command runs, or removes it with `none`. */
  readonly running: (pid: Option.Option<number>) => Effect.Effect<void, LockError>;
}

export class Locks extends Context.Service<
  Locks,
  {
    /**
     * Holds the lock at `path` until the scope ends. While another holds it, prints one line naming
     * that holder and waits; a stale lock is broken at once and in silence. On release the label is
     * removed only if it still names this process.
     */
    readonly hold: (path: string) => Effect.Effect<Held, LockError, Scope.Scope>;
  }
>()("scripts/typecheck/Locks") {}
```

`LocksFile.layer` steps, each one atomic on a local disk:

1. Write `<lock>.<pid>.tmp` holding `<pid>\n`, then `link` it to `<lock>`; remove the temp file
   either way. Success: held.
2. EEXIST: read the label and `<lock>.child`, ask `Processes` for each pid's liveness, `judge`.
3. `held`: print `typecheck: waiting for pid <n> (<args>), which holds <lock>` once (1419's words;
   `pid <n>` alone when `ps` cannot read the args), sleep 250 ms, go to 1.
4. `stale`: take `<lock>.break` by the same `link` step. Inside it, look and `judge` again; if still
   stale, remove `<lock>` and `<lock>.child`, then release `.break` and go to 1 at once. If
   `.break` is held by a live process, go to 3 without a line. A dead `.break` is broken the same
   way, under `<lock>.break.break`: Mercurial's `_testlock` (`mercurial/lock.py`, read at 7.2.4)
   takes `.break` as a lock itself, `lock(self.vfs, self.f + b'.break', timeout=0)`, so that lock's
   own `_trylock` breaks a dead `.break` under its own `.break`, and `timeout=0` means a held one is
   never waited on. (Amended 2026-11-16, fix round; see the amendment below.)

   **Wrong** (the plan's first text, kept as a record): "A `.break` whose holder is gone is removed
   directly: that only races if two breakers both died inside a few milliseconds." One dead breaker
   is enough for two live holders; the review found it on 2026-11-16
   (`field/runs/2026-11-16-t766-port-typecheck-review.json`).
5. The scope's finalizer (after the child is waited for): remove `<lock>.child`, then read the
   label and remove it only if it is `<pid>\n`.

The holder's identity is `Processes.self`, not a read of `process.pid` inside the layer, so a law can
run two holders as two fibers with two pids.

### The other three services

```ts
// scripts/typecheck/Processes.ts, sketch.
export const Listing = Schema.TaggedUnion({ listed: { pids: Schema.Array(Schema.Int) }, refused: {} });

export class Processes extends Context.Service<
  Processes,
  {
    readonly self: number; // this process's pid
    readonly named: (name: string) => Effect.Effect<Listing>; // pgrep -x: exit 1 is listed [], 2+ refused
    readonly args: (pid: number) => Effect.Effect<string>; // ps -o args= -p, "" where ps cannot read it
    readonly liveness: (pid: number) => Effect.Effect<Liveness>; // kill(pid, 0), then ps -o etime=
  }
>()("scripts/typecheck/Processes") {}

// scripts/typecheck/Commands.ts, sketch.
export type Command = { readonly cmd: string; readonly args: ReadonlyArray<string> };
export const Ended = Schema.TaggedUnion({ exited: { code: Schema.Int }, signaled: { signal: Schema.String } });
export class Commands extends Context.Service<
  Commands,
  {
    /** Runs one command to its end, its output on ours; `started` hears its pid first. */
    readonly run: (
      command: Command,
      started: (pid: Option.Option<number>) => Effect.Effect<void, LockError>,
    ) => Effect.Effect<Ended, CommandError | LockError>;
  }
>()("scripts/typecheck/Commands") {}

// scripts/typecheck/NodeModules.ts, sketch.
export const Shape = Schema.Literals(["folder", "link", "missing", "other"]); // a broken link is "link"
export class NodeModules extends Context.Service<
  NodeModules,
  {
    readonly shape: Effect.Effect<Shape, NodeModulesError>;
    readonly unlink: Effect.Effect<void, NodeModulesError>; // the link only, never its target
  }
>()("scripts/typecheck/NodeModules") {}
```

- **`CommandsProcess.layer`** runs each command with `stdin: "ignore"`, `stdout` and `stderr`
  `"inherit"`, and **`detached: false`**. Effect's spawner detaches by default
  (`effect/src/process/ChildProcess.ts:525-535`), which would put the compiler in a group of its own:
  caps' "recovers a killed typecheck holder" law kills the holder's group with SIGKILL and expects
  the compiler gone with it, as today's `subprocess.call` children are. With `detached: false` a
  Ctrl-C in a terminal still reaches the compiler too, as today.
- **A signal:** the spawner fails `exitCode` with the signal's name in the message
  (`@effect/platform-node-shared/src/NodeChildProcessSpawner.ts:743-756`). The layer turns it into
  `signaled`, and the program exits 128 plus the signal's number (`node:os` `constants.signals`, an
  edge), as Python's `128 - status` does. A failure the layer cannot read is exit 1 with one line.
- **Edges** (0250, each one line with its reason): `process.kill(pid, 0)` and `process.pid`, which
  Effect has no form of; `node:os` for the signal numbers. Lint's lead-tooling block holds the rest:
  no `node:fs`, no Promises.
- **The commands**, unchanged, and the buildinfo path stays on adjacent array items, so caches.ts's
  regex `/"--tsBuildInfoFile",\s*"([^"]+)"/` still reads it after oxfmt splits the line:

```ts
const INSTALL = { cmd: "pnpm", args: ["install", "--offline", "--frozen-lockfile"] };
const PATCH = { cmd: "pnpm", args: ["exec", "effect-tsgo", "patch", "--typescript"] };
const CHECK = {
  cmd: "pnpm",
  args: ["-r", "typecheck", "--incremental", "--tsBuildInfoFile", "node_modules/.cache/tsc/typecheck.tsbuildinfo"],
};
```

### What carries over, line by line

| Today (`scripts/typecheck.sh` on main) | Port |
|---|---|
| `:6-9` a `node_modules` that exists and is neither link nor folder is refused with one line, exit 1, before the lock | `Typecheck.ts`, before `hold`, same line |
| `:14-18` the lock path and the compiler name from the environment, defaults `/tmp/fabrika-typecheck.lock` and `tsgo`, never under `TMPDIR` | `Settings` from Effect `Config`, the same names and defaults |
| `:46-68` `take`: one line naming the holder's pid and args, then wait; a stale lock taken at once and in silence; our pid written | `Locks.hold` |
| `:71-98` `wait_for_compiler`: skipped when `CI` is set; `pgrep -x` once a second; `--lsp` left out by `ps -o args=`; one line naming the first; one line and no wait where pgrep is refused | `Typecheck.ts`'s `waitForCompiler` on `Processes`, same lines, same one-second poll |
| `:113-127` under the lock: a link is removed, never its target, and the offline install runs first | the same, under `hold` |
| `:128-137` each command in turn; the first non-zero status ends the run with it; an install that exits 0 but leaves no folder is status 1; the install line on an install failure | the same, in `Typecheck.ts` |
| `pass_fds`: a compiler keeps the lock if the wrapper dies first | `<lock>.child`, judged by `judge` |

The process environment the children see is inherited, as today; the two variables keep being set
for them with their defaults, as `export` does at `:18`.

## Old branches beside the new lock

Yes, a typecheck still in `flock` form (a branch from before this lands) can run at the same time as
the new one. The new one does not `flock`, and the old one never reads the label as a lock.

| Who starts first | What happens |
|---|---|
| new, then an old pre-1419 script | the old one `flock`s the label file and runs at once, beside the new compile |
| new, then an old 1419 script | the same; it also writes its pid over our label, so our release leaves the file, and the next new run waits on the old pid, then breaks it once it is gone |
| old 1419, then new | the new one reads the old pid in the label, sees it running, and waits: correct |
| old pre-1419, then new | the label is empty, read as stale, so the new one takes it; on the laptop 1419's compiler wait then holds the new compile until the old `tsgo` ends |
| two old runs, one before and one after a new run removed the file | they can `flock` two different files and run together |

The cost: on the laptop, two compilers at once, about 16 cores, the freeze 0012 guards against, for
as long as old branches still run `pnpm typecheck`. In CI and in a box there is one job per machine,
so nothing changes there. It ends once each branch in use has merged main past this pull request;
step agents start from main, and `drive.ts`'s step-start wait (`pgrep -x tsgo`, `drive.ts:2256`)
still holds a new step while any `tsgo` runs. Call: no shim for old branches, 85%; the pull request
says to merge main into a branch before its next typecheck.

## One value traced

Two runs on the laptop, A (pid 4101) and B (pid 4102), `/tmp/fabrika-typecheck.lock`, no `CI`.

1. A: `shape` is `folder`. `hold` writes `/tmp/fabrika-typecheck.lock.4101.tmp` = `4101\n`, `link`
   succeeds, the temp file goes. A prints nothing.
2. B: `link` fails with EEXIST. Look: label `4101\n` written at T, `liveness(4101)` is running,
   started before T. `judge` says `held { pid: 4101, by: "label" }`. B prints
   `typecheck: waiting for pid 4101 (node scripts/typecheck.ts), which holds /tmp/fabrika-typecheck.lock`
   and polls every 250 ms.
3. A: `named("tsgo")` is `listed { pids: [] }`: no wait. `Commands.run(PATCH)` spawns pid 4110,
   `running(some(4110))` writes `.child` = `4110\n`, it exits 0, `running(none)` removes `.child`.
   `CHECK` runs as pid 4111 the same way.
4. A is killed with SIGKILL while 4111 runs. No finalizer runs (0061 says so; this is the guard
   outside the process).
5. B's next look: label pid 4101 is `gone`; `.child` pid 4111 is running and started before
   `.child` was written: `held { pid: 4111, by: "child" }`. B waits, printing nothing more.
6. 4111 ends. B's look: both `gone`, so `stale { reason: "gone" }`. B links its temp file to
   `.break`, looks again (still stale), removes the label and `.child`, removes `.break`, links its
   own label: held. Its stderr held one line in all.
7. B runs its commands and exits 0; its finalizer removes `.child` and the label, which still says
   `4102\n`.

## Laws

Every caps law below runs as it does today (plain `.test.ts`, real processes, stand-in compilers).
"Invocation" means only `spawn("sh", [".../typecheck.sh"])` becomes
`spawn(process.execPath, [".../typecheck.ts"])` and the path in an `existsSync` or a comment changes;
the stand-ins, timings and assertions do not.

| Law | Kind (lint, type or test?) | Generator | Plant | Where |
|---|---|---|---|---|
| E1, "R4 gives every shell one fixed lock file, whatever its TMPDIR": with no lock named, the lock the run takes is `/tmp/fabrika-typecheck.lock`, whatever `TMPDIR` is; 2 runs. Changed how it reads: the program runs in the test process on `LocksTest`, with `TMPDIR` set in `process.env` and the config's environment, and the law reads the path `hold` was given | test | fc.stringMatching: the `TMPDIR` suffix, as today, 2 runs | default the lock to `os.tmpdir()`: the path differs and E1 is red | scripts/caps.test.ts |
| E2, "R4 shares the typecheck lock across temp roots"; invocation | test | fc.stringMatching: temp root suffix, 2 runs | take the lock under `TMPDIR`: the compilers overlap | scripts/caps.test.ts |
| E3, "R4 recovers a killed typecheck holder"; invocation | test | fc.stringMatching: temp root suffix, 2 runs | never break a gone holder's lock: b never starts | scripts/caps.test.ts |
| E4, "R4 keeps the compiler lock after its wrapper dies"; invocation | test | fc.stringMatching: temp root suffix, 2 runs | skip `.child` in `judge`: b starts while a's compiler runs | scripts/caps.test.ts |
| E5, the six "a <shape> node_modules ends as <outcome>" scenarios; invocation | test | scenario: link, broken link, link with a failed install, file, folder, missing | patch before the link goes, remove the target, or go on after a failed install | scripts/caps.test.ts |
| E6, "holds one typecheck lock through success, failure and an interrupted waiter"; invocation, and its `existsSync` names `typecheck.ts`; 4 runs | test | fc.record: exit code 0, 1 or 2 and cancel, 4 runs | release the label while the compiler is alive | scripts/caps.test.ts |
| I1 to I6, 1419's six laws: two at once run one after the other and the waiter names the holder; waits on an uncovered compiler with one line; takes a stale lock at once and in silence (and the label reads `<pid>\n`); no wait on `--lsp`; CI never waits; one line where pgrep is refused; invocation | test | scenario: 1419's stand-ins, a node linked under the law's compiler name | 1419's plants, each as written above its law | scripts/typecheck.integration.test.ts |
| N1, on the test layers, the program's outcome for any run: the commands in order (install only after a link), every line printed, the exit code (first non-zero, 128 plus a signal, 1 for an install that leaves no folder), and the lock held from before the first command until after the last; 100 runs | test | fc.record: shape from `Shape`, each command's `Ended`, `CI` set or not, a `Listing` with or without `--lsp` args, refused or not | release before the last command; print the wait for an `--lsp` process; read `refused` as none in silence; patch before `unlink` | scripts/typecheck.test.ts |
| N2, `judge` over generated looks: held exactly when the label's or the child's pid is running and started before its file's mtime plus 2 s; `empty`, `unreadable`, `gone` and `reused` each stale; no label is free; 200 runs | test | fc.record: label absent, empty, junk or a pid; child absent or a pid; each pid gone, running before or after its file, or with no start time | read an empty label as held (today's left-over file waits for good); drop the start-time check | scripts/typecheck-lock.test.ts |
| N3, `LocksFile.layer` on an in-memory FileSystem (`FileSystem.layerNoop` over a map) and `ProcessesTest`: any sequence of takes, releases, kills and pid reuses never has two live holders, and a take after its holder is gone holds at once; 100 runs | test | fc.commands: take, release, kill with or without a running child, reuse a pid | release a label that names another pid; break without re-reading | scripts/typecheck-lock.test.ts |
| N4, the break race, fixed order: two takers both read a gone holder's label, then A removes it and links its own, then B removes and links. With `.break`, B finds A holding and waits | test | scenario: Mercurial's race, ordered by latches in the in-memory FileSystem | break without `.break`: two holders | scripts/typecheck-lock.test.ts |
| N5, `CommandsProcess.layer` spawns with `detached: false`, inherited output and no stdin, and maps a signal to `signaled` | test | scenario: one real `node -e` child that exits 3, and one that kills itself with SIGTERM | leave Effect's default `detached`: the child's group differs from ours | scripts/typecheck.test.ts |
| N6, `ProcessesPs.layer` reads pgrep's exits 0, 1 and 2+ as listed, listed empty and refused, and `ps`'s args and etime | test | vector: pgrep and ps output saved from a real run on Linux and on macOS | read exit 2 as listed: refused is lost | scripts/typecheck.test.ts |
| L1, the new files are under lint's lead-tooling block (no Promises, no `node:fs`, edges marked) | lint | lint | a `node:fs` import in `LocksFile.ts`: `pnpm lint` fails | .oxlintrc.json |
| T1, the new files are type-checked, with Effect's checks, by `.agents`' `tsc` run inside `pnpm typecheck` | type | type | a wrong return type in `Locks.ts`: the typecheck fails | .agents/tsconfig.json |
| C0, C4, the cache lint reads the buildinfo path from `scripts/typecheck.ts`; caches.test.ts's planted folder change still turns C4 red | test | pinned: the checked-in files | read `typecheck.sh` after it is gone: the read fails | .github/ci/workflow-lint/caches.test.ts |
| S1, skillscheck's caps sentence names `typecheck.ts` in the build, tests and mutation skills | test | pinned: the sentence in skillscheck.sh and skillscheck.test.ts | leave one skill on `typecheck.sh`: skillscheck fails | .agents/skills/lead/scripts/skillscheck.test.ts |

Notes:

- **No law is loosened, and none moves.** E1 is the one whose body changes beyond the path. Its
  stand-in `python3` showed only that the shell resolved and exported the default; the new body
  shows that the path reaches `hold`, which also answers
  `field/findings/2026-11-14-typecheck-lock-path-has-no-law.json` (I3 already reads the file at the
  named path). A process-level form would take the machine's real lock and wait behind a real
  typecheck mid-law, which is ticket 1008's flake. The lead checked this change to E1 ("R4 gives
  every shell one fixed lock file") by hand: it is not a loosening.
- **0113's "laws run on the test layer without a real process":** N1 to N4 do. E2 to E6, I1 to I6,
  N5 and N6 are the small real set. N5 and N6 start real processes but only short `node`, `pgrep`
  and `ps` runs; if the tests step finds they need the `.integration.` name under
  `fabrika/integration-test-name`, they move to `scripts/typecheck.integration.test.ts`.
- **Host-only laws:** I1 to I6 (real processes, real signals, `pgrep` and `ps`). They run before the
  first review: in the build's box on Linux, then CI's full run on the branch
  (`gh workflow run scheduled.yaml --ref fabrikalfa/port-typecheck`). On the owner's Mac they run
  only after the lead's read of their signal lines and the owner's yes (0178). The local host-only
  guard refuses them otherwise.
- **Every plant** is run once by the step that owns the law and recorded in its run row, never
  committed.
- **A `--changed` run does not pick the caps laws** when only `scripts/typecheck.ts` changes: they
  start the script by path, which Vitest's graph cannot see, and the script-reads plugin covers only
  skill scripts. That is so today for `typecheck.sh` too. Each step runs them by path; N1 to N6
  import the files, so `--changed` finds those.

## Existing tools

- `scripts/typecheck/LocksFile.ts`: searched `pnpm-lock.yaml` and npm for `proper-lockfile`,
  `lockfile`, `fs-ext` and `os-lock`; only `signal-exit` is installed. Read proper-lockfile 4.1.2
  (rejected, above) and Mercurial 7.2.4's lock (its algorithm is taken). `fs-ext`'s native `flock`
  would add a native build; not taken. The file is hand-written on Effect's FileSystem.
- `scripts/typecheck/ProcessesPs.ts`: searched the repo; `.agents/skills/lead/scripts/pgrep.ts`
  reads a pgrep exit as a count, and `mutbox.ts:645` and `drive.ts:1891` use `process.kill(pid, 0)`.
  pgrep.ts keeps a count, not pids, and sits in the `.agents` package, which `scripts/` may not
  import by path; its exit rule (0 and 1 listed, else refused) is copied with a comment naming it.
  npm's `ps-list` and `find-process` are not installed; `pgrep` and `ps` are on every machine here.
- `scripts/typecheck/CommandsProcess.ts`: `.agents/skills/lead/scripts/pr/command.ts` runs a command
  and reads its output whole; here the output is inherited and the pid is needed, so its shape is
  followed, not imported. Effect's `ChildProcess` does the work.
- `scripts/typecheck/NodeModulesFs.ts`: Effect's `FileSystem.stat` with symlinks not followed and
  `remove`; no helper exists.
- `scripts/typecheck/Look.ts`, `Typecheck.ts`, `Locks.ts`, `Commands.ts`, `Processes.ts`,
  `NodeModules.ts`, `scripts/typecheck.ts`: this port's own contracts and program; nothing to reuse.

## Is anything here a setting?

- The lock path and the compiler name stay environment overrides that only a test sets, as ticket
  1008 and 1419 decided; they are not `fabrika.toml` settings, since no person picks them (0069).
  0585 says no tooling name takes `FABRIKA_`. The brief keeps the names and every law sets them, so
  the rename belongs with 0585's sweep of `FABRIKA_` tooling names, not here. Call, 80%.
- The 250 ms lock poll, the one-second compiler poll and the 2 s start-time slack are constants:
  timings of a correct lock, which no person tunes.

## Every caller that names typecheck.sh

`rg -n "typecheck\.sh"` from the repo root on `59910b0a4`:

| Hit | Planned change |
|---|---|
| `package.json:8` | `"typecheck": "node scripts/typecheck.ts"` |
| `scripts/caps.test.ts:25, 169, 230, 886, 943-944, 972` | invocation (E1 to E6) |
| `scripts/typecheck.integration.test.ts:14` | invocation (I1 to I6) |
| `.github/ci/workflow-lint/caches.ts:34, 139, 151, 184` | reads `scripts/typecheck.ts`; the three comments and the message name it |
| `.github/workflows/check.yaml:357` | the comment names `scripts/typecheck.ts` |
| `.agents/tsconfig.json:2` | the comment names it, and `include` gains the new files |
| `.agents/skills/lead/scripts/drive.ts:2258` | the comment names it |
| `.agents/skills/build/SKILL.md:57, 62`, `tests/SKILL.md:130`, `mutation/SKILL.md:192` | `typecheck.ts`; line 62 says it takes the one lock |
| `.agents/skills/lead/scripts/skillscheck.sh:19`, `skillscheck.test.ts:415` | the pinned caps sentence names `typecheck.ts` |
| `docs/direction/skills-hold-only-judgment.md:30` | names `typecheck.ts` and "one fixed lock" instead of "one fixed OS lock" |
| `.decisions/0410-the-machine-caps-live-in-code.md:24` | not edited: its 2026-11-15 amendment (pull request 1509) already allows the pid lock at the same single path |
| `.decisions/0113-no-shell-or-python-scripts.md:28, 80` | not edited: a count on a date |
| `experiments/272`, `282`, `283`, `296` | not edited: records of what was true then |
| `field/runs/2026-11-15-typecheck-lock-linux-fix1.json`, `field/findings/2026-11-14-typecheck-lock-path-has-no-law.json` | not edited: rows are only added |
| `pr758-typecheck.out:1` | not edited: a stray log in git, a finding below |

`.github/ci/changes.mjs` needs no change: `scripts/typecheck.ts` is no quiet path, so it starts the
typecheck and check jobs and all of `next/`, as `typecheck.sh` does. The tooling Vitest project
already includes `scripts/*.test.ts`, so both new test files run with no config change.

## Files

| File | Owner | Product lines expected | Change |
|---|---|---|---|
| `scripts/typecheck.ts` | build | 30 | the entry, `NodeRuntime.runMain`, exit code |
| `scripts/typecheck/Typecheck.ts` | build | 120 | settings, order, lines, the compiler wait |
| `scripts/typecheck/Look.ts` | build | 50 | `Liveness`, `Seen`, `judge` |
| `scripts/typecheck/Locks.ts` | build | 30 | contract |
| `scripts/typecheck/LocksFile.ts` | build | 140 | label, `.break`, `.child` |
| `scripts/typecheck/Commands.ts` | build | 25 | contract |
| `scripts/typecheck/CommandsProcess.ts` | build | 50 | Effect `ChildProcess`, `detached: false` |
| `scripts/typecheck/Processes.ts` | build | 25 | contract |
| `scripts/typecheck/ProcessesPs.ts` | build | 60 | pgrep, ps, `kill(pid, 0)` |
| `scripts/typecheck/NodeModules.ts` | build | 20 | contract |
| `scripts/typecheck/NodeModulesFs.ts` | build | 30 | lstat, unlink |
| `scripts/typecheck.sh` | build | -137 | deleted with `git rm` |
| `scripts/typecheck/LocksTest.ts` | tests | tests | records the path and holds in memory |
| `scripts/typecheck/CommandsTest.ts` | tests | tests | answers each command's `Ended` as told |
| `scripts/typecheck/ProcessesTest.ts` | tests | tests | pids, args, liveness from a map |
| `scripts/typecheck/NodeModulesTest.ts` | tests | tests | a shape and its unlink in memory |
| `scripts/typecheck.test.ts` | tests | tests | N1, N5, N6 |
| `scripts/typecheck-lock.test.ts` | tests | tests | N2, N3, N4 |
| `scripts/caps.test.ts` | tests | tests | E1 to E6 |
| `scripts/typecheck.integration.test.ts` | tests | tests | I1 to I6, invocation |
| `package.json` | tests | 1 | the `typecheck` script |
| `.oxlintrc.json` | tests | 4 | the lead-tooling and lead-test blocks name `scripts/typecheck.ts`, `scripts/typecheck/**` and the two test files (L1) |
| `.github/ci/workflow-lint/caches.ts` | tests | 5 | reads `scripts/typecheck.ts` |
| `.github/workflows/check.yaml` | tests | 1 | the comment |
| `.agents/skills/lead/scripts/skillscheck.sh` | tests | 1 | the caps sentence |
| `.agents/skills/lead/scripts/skillscheck.test.ts` | tests | tests | the pinned sentence |
| `.agents/tsconfig.json` | build | 6 | the comment, and `include` gains the new files (T1) |
| `.agents/skills/lead/scripts/drive.ts` | build | 1 | the comment |
| `.agents/skills/build/SKILL.md` | build | docs | lines 57 and 62 |
| `.agents/skills/tests/SKILL.md` | build | docs | line 130 |
| `.agents/skills/mutation/SKILL.md` | build | docs | line 192 |
| `docs/direction/skills-hold-only-judgment.md` | build | docs | line 30 |
| `pnpm-lock.yaml`, `pnpm-workspace.yaml`, `.github/ci`, `.github/ci/changes.mjs`, `.github/ci/workflow-lint/caches.test.ts`, `scripts/*.test.ts` | tests | none | not changed: no dependency is added, no package, no path rule; the cache laws read the new file through `cacheFiles` |

Where the type check comes from: `scripts/` is in no workspace package, and no tsconfig covers it
today. `.agents` is a workspace package whose `tsc` runs inside `pnpm -r typecheck` and whose imports
resolve from the root's, so its `include` takes `../scripts/typecheck.ts`, `../scripts/typecheck/*.ts`
and the two new test files. A new `scripts/` workspace package would add a package glob, and with
it a cache path in check.yaml that caches.ts checks. Call, 75%.

## Validation

- The tests step: `pnpm format`, then `nice -n 15 pnpm exec vitest run --maxWorkers=3` on
  `scripts/typecheck.test.ts`, `scripts/typecheck-lock.test.ts`, `scripts/caps.test.ts` and
  `.agents/skills/lead/scripts/skillscheck.test.ts`, then `pnpm lint`. N1 to N4 are red before the
  build; E2 to E6 go red once their invocation names a file that does not exist yet.
- The build: the same narrow paths, then `.github/ci/workflow-lint/caches.test.ts`, then
  `scripts/typecheck.integration.test.ts` in its box on Linux, then `pnpm lint` with
  `NODE_OPTIONS=--max-old-space-size=6144`.
- The lead, not a boxed step: one real `pnpm typecheck` through the new script, the leak grep, and
  CI's full run on the branch before the review.

## Size

One pull request: the port cannot land in parts, since the old script and the new one must not both
be what `pnpm typecheck` runs.

1. The port, its four services, their test layers and laws, the callers: 600 lines.

Priced from `docs/plan/quests/t1041-PLAN.md` (lead tooling, six steps for $43) and this
plan's size: tests about $14 (two new files and three test layers), build about $12, the host-only
run in the box about $3, review about $5, one likely fix round and its recheck about $8. Confidence
70%: the doubt is the lock's laws N3 and N4, whose in-memory FileSystem and latches may cost the
tests step more than priced.

Estimate: 6 steps, $42

## Records

- What is lost if not written now: nothing new. The label must read `<pid>\n` (I3), so the holder's
  start time is read from `ps` when needed, not stored. The wait lines are only for the person
  watching.
- `field/runs/` rows for each step, the plan's included.
- No new word for `.glossary/TERMS.md`: lock, stale lock, break a lock and holder are the industry's
  words (Mercurial's, above).
- 0410's lock line already has its amendment (2026-11-15, pull request 1509); this pull request
  writes no decision.

## What this cannot tell us

- Whether `link()` stays atomic on every `/tmp` an agent uses. It is on a local disk; a network
  folder is not expected (experiment 71 notes the same for `flock`).
- How `kill(pid, 0)` behaves inside the laptop's sandbox for a process outside it. Mercurial's rule
  reads anything but ESRCH as alive, so a refusal waits rather than breaks; a dead pid is ESRCH
  before any permission check on Linux. macOS is reasoned, not run.
- Whether `@effect/platform-node` loads anything lazily after `node_modules` is unlinked in the link
  case. E5 runs the main checkout's script from another folder, so it cannot see that; only a run in
  a real linked worktree would.
- The old-branch overlap is reasoned from the code, not measured.

## Answered questions

1. **May the typecheck lock stop being an OS lock?** Yes. 0410's amendment of 2026-11-15, merged in
   https://github.com/kamp-us/tea-fabrika/pull/1509, records the lead's ruling: "one fixed OS lock"
   may become a pid lock at the same single path, following Mercurial's repository lock
   (`mercurial/lock.py`, read at 7.2.4). The lock is made atomically and names its holder's pid, and
   a dead holder's lock is broken only while a `.break` lock is held. 0410's rule holds as written,
   one type check at a time across shells, held in code; only the mechanism changes, and a branch
   still on the old lock does not wait on the new one until it merges main. This plan builds that
   lock, with the running command's pid in `.child`. What it gives up against `flock`, accepted with
   the ruling: release is the next taker's, after a `kill(pid, 0)` and a start-time read, not the
   kernel's; a pid reused within 2 s of its label is not told apart; a command's own children that
   outlive both it and the wrapper are not covered (on the laptop the compiler wait still sees a
   `tsgo`); and old-branch `flock` runs do not see it. Experiment 71's perl `flock` road is not
   taken.
2. **A worktree whose `node_modules` is a broken link:** the lead's answer keeps today's form for a
   `node_modules` the script cannot use: one line, exit 1. Today the script removes the link and
   installs offline, but the port cannot load Effect there. `scripts/typecheck.ts` loads the program
   with one dynamic import, marked as an edge, and on a failed load prints
   `typecheck: cannot load the typecheck's modules from node_modules; run pnpm install --offline --frozen-lockfile`
   and exits 1. The working-link repair stays automatic. No node-only first stage is built.

## Open questions

None.

## Amendment, 2026-11-16: `scripts/typecheck*` gets a tsconfig program of its own

**Why.** Law T1 above put the new files into the `.agents/tsconfig.json` program. The build
(`8172034`) found that cannot pass: in that program every `scripts/` file gets TS377051
`duplicatePackage`, because the program holds two `@demlik/tea` versions, and the only allowance is
the `tsconfig.base.json` override whose `include` is `[".agents/**/*.ts"]`. Law E3 of the tea-msg-tag
plan, `oxlint-plugins/duplicate-packages.test.ts`, holds that include to `.agents/**` globs alone.
Proof: `field/findings/2026-11-16-typecheck-port-t1-cannot-pass.json` and the build's row
`field/runs/2026-11-16-t766-port-typecheck-build.json`.

**The lead's ruling (option b).** E3 stays as it is. The second tea version stays too: today's
`programs/` pin 0.25.0 (one place 0.23.0) and `next/` is on 0.27.0, so the base allowance (ticket
1065) stays scoped to `.agents/**` alone. `scripts/typecheck*` is type-checked in a tsconfig program of
its own, outside `.agents/`. That program reaches only `effect`, `@effect/platform-node`, node and the
test libraries, with no `@demlik/tea` import, so it needs no duplicate-package allowance. A new plant:
an import of `@demlik/tea` from `scripts/typecheck.ts` must turn a check red.

This amendment replaces what the plan says above where they differ: T1, the "Where the type check
comes from" call under "Files", and the `.agents/tsconfig.json` rows. Everything else stands.

### A call, at the top: the tea plant is held by lint, 85%

A tea import alone does **not** turn the new program's type check red. Checked on 2026-11-16 at
`0ec6ba3`: a scratch tsconfig that extends `tsconfig.base.json` and includes the 18 `scripts/typecheck*`
files plus one file with `import { Cmd } from "@demlik/tea"` ran `tsc --noEmit` with exit 0. Its
file list held `@demlik/tea@0.27.0` only, and the same run did report Effect's TS377001
`floatingEffect` on a planted floating Effect, so Effect's checks were on. One tea version in a
program is no duplicate. So the plant's law is a lint law, L2 below: oxlint's own
`eslint/no-restricted-imports` names `@demlik/tea` for the typecheck files, and `pnpm lint` goes red.
That is the repo's rule for a check on an import (AGENTS.md, "Checks": "A check on the shape of code
is a lint rule, never a test: oxlint's own rule where one exists (`no-restricted-imports`)"). The type
check still catches the case the ruling is about: if `scripts/typecheck*` ever reaches today's code on
tea 0.25.0, the program holds two versions and TS377051 fires, with no allowance to stop it. The doubt
(15%): the lead may want the plant to turn `pnpm typecheck` itself red. That needs a fake module or a
`paths` entry that shadows tea, a trick no other program here uses; if the lead wants it, it is one
more line in `scripts/tsconfig.json` and one more plant.

### The new program, the way `.agents` gets its own

`pnpm typecheck` runs `scripts/typecheck.ts`, which runs `pnpm -r typecheck --incremental
--tsBuildInfoFile node_modules/.cache/tsc/typecheck.tsbuildinfo`, so a folder is type-checked when it
is a workspace package with a `typecheck` script. `.agents`, `.github/ci` and `oxlint-plugins` are each
reached that way: a `pnpm-workspace.yaml` glob, a `package.json` whose script is `tsc --noEmit -p .`,
and a `tsconfig.json` that extends `../tsconfig.base.json`. `.agents` is the closest match: a package
"only so `pnpm typecheck` reads the quest scripts", naming no dependency because its imports resolve
from the root's, and reached for `pnpm lint:reach` by the root's `devDependencies`. `scripts/` takes
the same shape. Call, 90%: it is the known way here three times over, and a root-level program that
another package's script runs would be a fourth way.

```jsonc
// scripts/package.json, sketch.
{
  "name": "@tea-fabrika/scripts",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "description": "Today's tooling scripts. A package only so `pnpm typecheck` reads the typecheck's port (ticket 766) in a program of its own; its imports resolve from the root's dependencies.",
  "scripts": { "typecheck": "tsc --noEmit -p ." },
  "volta": { "extends": "../package.json" }
}
```

```jsonc
// scripts/tsconfig.json, sketch.
{
  // The typecheck's port (0113, ticket 766), lead tooling, in a program of its own. It imports no
  // @demlik/tea, so it needs no duplicate-package allowance: the base's one is `.agents/**` alone
  // (oxlint-plugins/duplicate-packages.test.ts). The other scripts here are not checked yet.
  "extends": "../tsconfig.base.json",
  "include": ["typecheck.ts", "typecheck/*.ts", "typecheck.test.ts", "typecheck-lock.test.ts"]
}
```

```yaml
# pnpm-workspace.yaml, the new glob right after `.agents`, sketch.
  - .agents
  # scripts: today's tooling scripts, so far the typecheck's port, type-checked in a program of
  # its own (ticket 766). It names no dependency: its imports resolve from the root's.
  - scripts
```

The rest that follows from it:

- The root `package.json` names `"@tea-fabrika/scripts": "workspace:*"` in `devDependencies`, as it
  names `@tea-fabrika/agents`, so `pnpm lint:reach` finds the package reached. `pnpm-lock.yaml` gains
  the importer `scripts: {}` and that link. Both are workspace-only, so `pnpm install --offline` writes
  them with no download.
- `.github/workflows/check.yaml`'s tsc cache gains `scripts/node_modules/.cache/tsc` right after
  `.agents/node_modules/.cache/tsc`: caches.ts's C4 wants one path per workspace glob, in the
  workspace's order, in both the restore and the save step (they share the `*tsc` anchor).
- `.agents/tsconfig.json` loses the four `../scripts/...` include lines and the comment's last
  sentence the build added. Its comment keeps naming `scripts/typecheck.ts`.
- `scripts/tsconfig.json` holds no `allowedDuplicatedPackages`; E3 already fails if any tsconfig
  but the base does.
- Lint already treats these files as lead tooling: `.oxlintrc.json`'s lead-tooling and lead-test
  blocks name them (L1, already green). Becoming a package changes no lint glob.
- `scripts/typecheck.integration.test.ts`, `scripts/caps.test.ts` and the other `scripts/` files stay
  out of the new program, as they were out of `.agents`' include.
- Is this a setting? No: which files a tsconfig checks is the build's shape, which no person picks
  (0069).

### One run traced

1. `pnpm typecheck` runs `node scripts/typecheck.ts`, which takes the lock and runs `CHECK`.
2. `pnpm -r typecheck --incremental --tsBuildInfoFile node_modules/.cache/tsc/typecheck.tsbuildinfo`
   reaches `@tea-fabrika/scripts` as it reaches `@tea-fabrika/agents`.
3. In `scripts/`, `tsc --noEmit -p . --incremental --tsBuildInfoFile ...` builds one program: the base
   config's options and Effect checks, the 18 typecheck files, and what they import: `effect`,
   `@effect/platform-node`, `vitest`, `@effect/vitest`, `fast-check`, `@kampus/vitest` (whose
   manifest names no tea) and node. No `@demlik/tea` is in it, so TS377051 has nothing to fire on.
4. `.agents`' program no longer holds the 18 files, so its own run is back to its own files.
5. A tea import planted in `scripts/typecheck.ts` passes step 3 but fails `pnpm lint` (L2).

### Laws, changed and new

| Law | Kind (lint, type or test?) | Generator | Plant | Where |
|---|---|---|---|---|
| T1, changed: the 18 `scripts/typecheck*` files are type-checked, with Effect's checks, by the `@tea-fabrika/scripts` workspace package's `tsc`, which `pnpm -r typecheck` runs inside `pnpm typecheck`; a program of their own, outside `.agents`, with no duplicate-package allowance | type | type | (a) a wrong return type in `scripts/typecheck/Locks.ts`: `pnpm typecheck` fails in `scripts/`; (b) drop the `scripts` glob from `pnpm-workspace.yaml`: the same wrong type passes | scripts/tsconfig.json |
| L2, new: no `scripts/typecheck*` file imports `@demlik/tea` or a subpath of it; the block repeats every `no-restricted-imports` path and pattern those files got before, since an oxlint override replaces a rule's options whole | lint | lint | (a) `import { Cmd } from "@demlik/tea"` in `scripts/typecheck.ts`: `pnpm lint` fails; (b) the same from `@demlik/tea/effect` in `scripts/typecheck/Look.ts`: fails; (c) an `@radix-ui/colors` import in `Look.ts` still fails, so the repeated list lost nothing | .oxlintrc.json |
| E3 of the tea-msg-tag plan, unchanged: the one tea allowance stays in `tsconfig.base.json`, scoped to `.agents/**` | test | format: the checker reads the setting by its exact key and place | E3's own plants; and an `allowedDuplicatedPackages` in `scripts/tsconfig.json` turns it red | oxlint-plugins/duplicate-packages.test.ts |
| C4, unchanged: check.yaml's tsc cache names one path per workspace glob, in order | test | pinned: the checked-in files | caches.test.ts's planted folder change; and the new glob with no cache path is red | .github/ci/workflow-lint/caches.test.ts |

No law is loosened: T1 holds the same files to the same base checks, in another program. E3 and C4
are not edited.

### Who does what next

- **The tests step** writes L2 (the new block in `.oxlintrc.json`, after every block that sets
  `no-restricted-imports` for those files) and T1's law: the `scripts` glob in `pnpm-workspace.yaml`,
  `scripts/package.json`, the root `devDependencies` line, `pnpm-lock.yaml` through
  `pnpm install --offline`, and the cache path in `check.yaml`. With no `scripts/tsconfig.json` yet,
  `pnpm -r typecheck` is red in `scripts/`: that is T1 red before the build. It runs L2's plants and
  T1's plant (b) once each, and records them in its row. It runs `pnpm lint` (L2, `lint:reach`,
  C4 through the workflow lint) and `caches.test.ts` by path.
- **The build** moves the type check: it writes `scripts/tsconfig.json` and takes the four
  `../scripts/...` lines and the added sentence out of `.agents/tsconfig.json`. Then it runs the
  `scripts` package's own `tsc --noEmit -p .` and `.agents`' one, and T1's plant (a) once.
- **The lead**, not a boxed step: one real `pnpm typecheck`, and CI's run, before the review.

### Files, amended

These rows replace the earlier rows for the same paths; every other row above stands.

| File | Owner | Product lines expected | Change |
|---|---|---|---|
| `scripts/package.json` | tests | 12 | new: `@tea-fabrika/scripts`, the `typecheck` script, no dependency |
| `pnpm-workspace.yaml` | tests | 3 | the `scripts` glob after `.agents`, with its comment |
| `package.json` | tests | 2 | the `typecheck` script as above, and `"@tea-fabrika/scripts": "workspace:*"` |
| `pnpm-lock.yaml` | tests | 4 | the `scripts` importer and the root's link, from `pnpm install --offline` |
| `.github/workflows/check.yaml` | tests | 2 | the comment as above, and `scripts/node_modules/.cache/tsc` in the tsc cache |
| `.oxlintrc.json` | tests | 60 | L1's names as above, and L2's block |
| `scripts/tsconfig.json` | build | 10 | new: the program, its comment, its four include globs (T1) |
| `.agents/tsconfig.json` | build | 2 | the comment names `scripts/typecheck.ts`; the four `../scripts/...` include lines and the added sentence come out |
| `tsconfig.base.json`, `oxlint-plugins/duplicate-packages.test.ts`, `oxlint-plugins/workspace-reach.ts`, `.github/ci/workflow-lint/caches.test.ts` | tests | none | not changed: E3, `lint:reach` and C4 hold the new shape as written |

About 95 product lines more than "Size" says, most of them L2's repeated list. The quest's budget
line is not changed: the new work is one more lint block and two small files.

### Callers, amended

| Hit | Planned change |
|---|---|
| `.agents/tsconfig.json:2` | the comment names `scripts/typecheck.ts`; `include` gains nothing, and the build's four lines come out |
| `scripts/tsconfig.json` (new) | includes the 18 files |
| `pnpm-workspace.yaml`, `package.json` | the `scripts` glob and the root's `@tea-fabrika/scripts` link |
| `.github/workflows/check.yaml:377` | the tsc cache path line after `.agents`' |

### What this amendment cannot tell us

- Whether `pnpm lint:dead` (code-graph) reads the new package the way it reads `.agents`, which also
  has no `exports`. The tests step's `pnpm lint` shows it.
- The scratch run proved a one-tea program passes; it did not run `pnpm -r typecheck` with the new
  package, which the build and the lead do.

## Amendment, 2026-11-16 (fix round): a dead `.break` is broken under its own `.break`

**Why.** The one review, at `abfac52`, sent the quest back
(`field/runs/2026-11-16-t766-port-typecheck-review.json`). Step 4 of "The lock" said a `.break`
whose holder is gone may be removed directly, because "that only races if two breakers both died
inside a few milliseconds". That is wrong: one dead breaker is enough. The review's order, with
breaker D killed by SIGKILL while it held `<lock>.break`, the old holder gone, and two live takers
B and C:

1. C reads the dead `.break`: stale.
2. B reads it too, removes it, and links its own `.break`.
3. C removes B's live `.break` (the direct remove) and links its own.
4. Under their own `.break`, each looks and sees the old label stale.
5. B removes the label and links its own: B holds the lock.
6. C removes B's live label and links its own: C holds it too. Two type checks run at once,
   against 0410's rule.

The review ran this on the tests' in-memory disk, ordered by `Deferred` gates: both `hold` calls
returned. Law N3 kills only holders, never a breaker, so it cannot reach the case. The comment at
`scripts/typecheck/LocksFile.ts:100` repeats the wrong claim; the build fixes it.

**The lead's ruling.** Step 4's sentence becomes "a dead `.break` is broken the same way, under
`<lock>.break.break`", as Mercurial does. In `mercurial/lock.py` at 7.2.4, `_testlock` (lines
374-386) breaks a dead lock only inside `with lock(self.vfs, self.f + b'.break', timeout=0):`. That
inner `lock` is a lock like any other, so its own `_trylock` (lines 297-343) meets a dead `.break`
with EEXIST, calls its own `_testlock`, and breaks it under `.break.break`. `timeout=0` means a
`.break` held by a live process is never waited on: the caller reports the lock held and tries
again later. The old sentence stays in step 4, marked **Wrong**. Decision 0567 also covers these
files: `records.ts resolve 0567 0033 0410` (2026-11-16) prints all three accepted. 0567 holds in
"our tooling", 0033 puts lead tooling under `next/`'s rules, and the lead-tooling lint block
already names `scripts/typecheck*`. The lead accepted that scope.

This amendment replaces step 4 and the `LocksFile.ts` row where they differ. Everything else
stands.

```ts
// scripts/typecheck/LocksFile.ts, sketch: breaking is the same step at every depth.
// breakStale(path) takes `<path>.break` by the link step and, under it, removes `path` if it is
// still stale. A dead `.break` is broken by breakStale(`<path>.break`), under `<path>.break.break`.
const breakStale = (path: string): Effect.Effect<"busy" | "again", LockError> =>
  Effect.gen(function* () {
    const breaker = `${path}.break`;
    if (!(yield* link(path, breaker))) {
      return yield* Seen.match(yield* look(breaker, false), {
        held: () => Effect.succeed("busy" as const), // a live breaker: never waited on, never removed
        stale: () => breakStale(breaker).pipe(Effect.as("again" as const)), // was fs.remove(breaker)
        free: () => Effect.succeed("again" as const),
      });
    }
    // under our own `.break`: look again, remove `path` (and `.child` for the lock) if still stale;
    // on the way out, remove `breaker` only if it still names this process, as step 5 does.
  });
```

Traced on the fixed code, the same start: C and B both read the dead `.break`. B takes
`.break.break`, looks at `.break` again (still stale), removes it, releases `.break.break`, and goes
to step 1 of "The lock". C takes `.break.break` next and looks at `.break` again: it is now free or
B's live one, so C removes nothing and goes back to step 1. Only one of them can link `.break`, so
only one breaks the old label and only one holds the lock.

### Laws, changed and new

| Law | Kind (lint, type or test?) | Generator | Plant | Where |
|---|---|---|---|---|
| N7, new: a `.break` left by a dead breaker, a gone holder's label, and two live takers B and C, run in the review's order by `Deferred` gates on the in-memory FileSystem, never give two live holders: one `hold` returns, the other waits until it is released, then holds. Red on today's code at `e63d54c` | test | scenario: the review's order, 1 to 6 above | on the fixed code, put back `fs.remove(breaker)` for a stale `.break`: both hold, red | scripts/typecheck-lock.test.ts |
| L3, new: no `scripts/typecheck*` file compares `_tag` by hand (0567); `anti-slop-effect/no-manual-tag-comparison` covers them | lint | lint | a `seen._tag === "held"` put back in `LocksFile.ts`: `pnpm lint` fails | .oxlintrc.json |

No law is loosened or moved. N3 and N4 stay as written.

### Who does what next

- **The tests step** writes N7 in `scripts/typecheck-lock.test.ts` and shows it red on today's code.
  It turns the 16 hand `_tag` comparisons in `scripts/typecheck.test.ts` (6) and
  `scripts/typecheck-lock.test.ts` (10) into the unions' matchers or `Predicate.isTagged`. It adds
  `scripts/typecheck.ts`, `scripts/typecheck/**`, `scripts/typecheck.test.ts` and
  `scripts/typecheck-lock.test.ts` to the
  `anti-slop-effect/no-manual-tag-comparison` block in `.oxlintrc.json` (L3). L3 is then red on
  the 8 product hits, which are the build's. It runs L3's plant on a test file once and records it
  in its row.
- **The build** calls `breakStale(breaker)` in place of `fs.remove(breaker)` for a dead `.break`,
  and never removes a live `.break` that is not its own: the release of `.break` removes it only
  when it still names this process. It fixes the comment at `LocksFile.ts:100`. It turns the 8
  product `_tag` comparisons into the unions' matchers (`Seen.match`, `Liveness.match`,
  `Listing.match`) or `Predicate.isTagged`: `LocksFile.ts:19, 104, 108, 117, 168, 175`,
  `Look.ts:84` and `Typecheck.ts:69`. `NodeModulesFs.ts:20` sits inside `Effect.catchIf`, which the
  rule skips, and may stay. Then N7, N3, N4 and `pnpm lint` are green, and the build runs N7's
  plant once and records it in its row.
- **The same reviewer** rechecks (0177).

### Files, amended

| File | Owner | Product lines expected | Change |
|---|---|---|---|
| `scripts/typecheck-lock.test.ts` | tests | tests | N7, and its 10 comparisons matched |
| `scripts/typecheck.test.ts` | tests | tests | its 6 comparisons matched |
| `.oxlintrc.json` | tests | 3 | the `scripts/typecheck*` globs in the 0567 block (L3) |
| `scripts/typecheck/LocksFile.ts` | build | 20 | `breakStale` at every depth, `.break` released only when its own, 6 comparisons matched |
| `scripts/typecheck/Look.ts`, `scripts/typecheck/Typecheck.ts` | build | 4 | one comparison each matched |

About 27 product lines more than "Size" says. The quest's budget line is not changed: this is the
one fix round it priced.

### What this amendment cannot tell us

- Whether a chain of dead breakers deeper than one (`.break.break` left by a second SIGKILL) shows
  up in practice. The recursion handles any depth; N7 runs one.
- The Mercurial reading is from its source, not a run of Mercurial.

## Findings

```json
{"_tag":"finding","id":"2026-11-16-stray-typecheck-log-in-git","date":"2026-11-16","by":"plan","model":"claude-opus-5-5","rule":"dead_code","location":{"path":"pr758-typecheck.out","line":1},"says":"Today's repo root tracks pr758-typecheck.out, a saved pnpm typecheck log that no program, test or doc reads, added by a pull request about decision 0569.","proof":"git ls-files pr758-typecheck.out prints the path; git log -- pr758-typecheck.out shows only 30f9e07 (pull request 1384, decision 0569 amended); its first line is '$ sh scripts/typecheck.sh' and the next a Node version warning; rg -n pr758 finds no reader.","cost":"A raw run output in git, against 0027's rule that results stay out of it, and one more stale hit for every search of typecheck.sh.","head":"59910b0a4c84a36d4088d961dac3fdf756222d01","ticket":766,"pr":null}
```
