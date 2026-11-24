
Plancheck-Version: 3

# Plan: a failed set's folder clean-up never removes another writer's file (ticket 2014)

This is the kalfa packages, `kalfa/config`, new work. It is neither today's frozen version nor `next/`. The ticket is
https://github.com/kamp-us/tea-fabrika/issues/2014, found while building
https://github.com/kamp-us/tea-fabrika/pull/2009 (ticket 1843), under
[Configuration's protocol](https://github.com/kamp-us/tea-fabrika/issues/1749). Words: `kalfa/config/GLOSSARY.md`,
unchanged. The pull request is https://github.com/kamp-us/tea-fabrika/pull/2326.

When `SettingGroup.set` makes the `.<app>/` folder and then fails, it takes the folder away again (`unmake` in
`kalfa/config/src/internal/disk.ts`). Today that is two calls: list the folder, and when the list is empty, remove it
with `recursive: true`. A second writer that puts its lock or its finished file in the folder between the two calls
loses it. This plan makes the clean-up one call that the operating system refuses for a folder that holds anything:
`rmdir`. Effect's `FileSystem` has no such call, so the plan patches Effect's Node backend so that `remove` without
`recursive` takes away an empty folder, as C's `remove(3)`, Go's `os.Remove` and `Deno.remove` do, and files the
upstream issue. One pull request, about 55 product lines.

```ts
// The whole idea, a sketch. Nothing here was type-checked.

// Today (kalfa/config/src/internal/disk.ts:51-55): two calls, with a gap between them.
fs.readDirectory(dir).pipe(
  Effect.flatMap((entries) => (entries.length === 0 ? fs.remove(dir, { recursive: true }) : Effect.void)),
)
//   A: readDirectory(dir) -> []
//   B: writeFileString(dir/demo.toml.lock, "", { flag: "wx" })   <- B's lock lands in the gap
//   A: remove(dir, { recursive: true })                          <- B's lock is deleted

// After: one call. The kernel checks "empty" and removes in one step.
fs.remove(dir)
//   A: remove(dir) -> rmdir(dir) -> ENOTEMPTY, a PlatformError with reason Unknown; A logs it and moves on
//   B's lock stays, B finishes, and A still fails with its own first error
```

## Calls under 80%, read these first

None is under 80%. The lowest is the patch itself, at 85%: it changes `FileSystem.remove` for every caller in this
repo that runs on Node, not only Config. I read every `remove(` call without `recursive` in `kalfa/` and
`next/packages/`: each removes a file, which the patch leaves alone. I did not read today's frozen `apps/` and
`packages/`. The lead's proof run of the whole main run settles it; a caller that removed a folder on purpose and
counted on the refusal would show there.

## How others do it

- **POSIX `rmdir(2)`** removes a folder only when it is empty and fails `ENOTEMPTY` otherwise, in one system call.
  C's `remove(3)` calls it for a folder. Read from memory; not fetched this turn.
- **Go**: "Remove removes the named file or (empty) directory. RemoveAll removes path and any children it contains."
  (https://pkg.go.dev/os#Remove, fetched.)
- **Deno**, whose API Effect's `FileSystem` copies (`remove(path, { recursive })`): `Deno.remove` throws when "path is
  a non-empty directory and the `recursive` option isn't set to `true`", and its example removes an empty folder with
  no option (https://docs.deno.com/api/deno/~/Deno.remove, fetched).
- **Erlang/OTP**: `file:del_dir/1` deletes a folder that must be empty; `file:del_dir_r/1` is the recursive one. Read
  from memory; not fetched.
- **git**, the model `disk.ts` already follows: after it deletes a loose ref, `try_remove_empty_parents` in
  `refs/files-backend.c` calls `rmdir` on each parent and treats a refusal as "someone else is using it". Its
  `raceproof_create_file` handles the other half of the race (a folder removed between its `mkdir` and its create)
  by trying again. Read from memory; not fetched. That other half is Findings 1.
- **Node** does not do this. `fs.rm(dir)` without `recursive` refuses every folder, an empty one too. I ran it on the
  laptop's Node 22: `rm` on an empty folder fails `ERR_FS_EISDIR`; `rmdir` on a folder with a file fails `ENOTEMPTY`;
  `rmdir` on an empty folder removes it.
- **Effect 4.1.3**, as installed (`pnpm-lock.yaml`: `effect@4.1.3` patched, `@effect/platform-node-shared@4.1.3`
  held by `overrides`): `FileSystem.remove`'s only options are `recursive` and `force`
  (`effect/dist/FileSystem.d.ts:258-267`), and its doc says "Remove a file or directory." The Node backend calls
  `NFS.rm(path, { recursive: options?.recursive ?? false, force })` and nothing else
  (`@effect/platform-node-shared/src/NodeFileSystem.ts:180-192`). `handleErrnoException`
  (`src/internal/utils.ts`) maps `ENOTEMPTY` and `ERR_FS_EISDIR` to reason `Unknown`. Effect's main branch has the
  same `remove` (`packages/effect/src/FileSystem.ts`, last changed by Effect-TS/effect-smol commit `1caab3cc3`), and a
  search of Effect's issues for `rmdir` found none.

The repo's rule for a gap like this is [the design reference](../../.agents/skills/plan/references/design.md), "Never
wait on upstream": patch with `pnpm patch`, file the upstream issue the same day, and the bump that takes the fix
deletes the patch. Effect is already patched twice here (`pnpm-workspace.yaml`, `patchedDependencies`).

## The shape

### The patch: `remove` without `recursive` takes away an empty folder

A new patch, `patches/@effect__platform-node-shared@4.1.3.patch`, changes `removeFactory` in both
`dist/NodeFileSystem.js` and `src/NodeFileSystem.ts`, as the `@effect/platform-node` patch does both. No type, no
option and no other call changes.

```ts
// A sketch of the patched removeFactory. Nothing here was type-checked.
const removeFactory = (method: string): FileSystem.FileSystem["remove"] => {
  // rm as before; when it refuses a folder because `recursive` is off, rmdir it, which only an empty folder
  // passes. `force` keeps its meaning: a path that is gone by then is no failure.
  const rmOrRmdir = (path: string, options: NFS.RmOptions, cb: (err: NodeJS.ErrnoException | null) => void) =>
    NFS.rm(path, options, (err) =>
      err?.code === "ERR_FS_EISDIR"
        ? NFS.rmdir(path, (again) => cb(again?.code === "ENOENT" && options.force === true ? null : again))
        : cb(err)
    )
  const nodeRm = effectify(rmOrRmdir, handleErrnoException("FileSystem", method), handleBadArgument(method))
  return (path, options) =>
    nodeRm(path, { recursive: options?.recursive ?? false, force: options?.force ?? false })
}
```

What callers see after the patch, on Node:

| Call | Before | After |
|---|---|---|
| `remove(file)` | removes it | the same |
| `remove(dir, { recursive: true })` | removes it with all it holds | the same |
| `remove(emptyDir)` | fails `Unknown` (`ERR_FS_EISDIR`) | removes it |
| `remove(dirWithAnything)` | fails `Unknown` (`ERR_FS_EISDIR`) | fails `Unknown` (`ENOTEMPTY`), and nothing is removed |

`makeTempDirectoryScoped` and `makeTempFileScoped` use `removeFactory` with `recursive: true`, so they do not change.
`pnpm-workspace.yaml` gets the entry under `patchedDependencies`, with a comment that names the upstream issue and
says to drop it at the release that has the fix. `pnpm-lock.yaml` changes with it.

### `disk.ts`: one call

```ts
// A sketch. Nothing here was type-checked.
/**
 * Takes a folder this call made away again, only while it is empty: one `remove` without `recursive`, which the
 * system refuses for a folder that holds anything, so a lock or a file another writer has put in it since stays.
 *
 * It needs Effect's Node backend as this repo patches it: an unpatched one refuses every folder, and the folder
 * stays, which loses nothing.
 */
const unmake = (fs: FileSystem.FileSystem, call: Call, path: string) =>
  fs.remove(path).pipe(Effect.ignore({ log: "Warn", message: `${call.name}'s folder was not removed.` }));
```

The "Known race" paragraph goes. Every refusal still logs the one `Warn` line: a folder another writer is using is
the common case, and "was not removed" is true then too. Telling `ENOTEMPTY` apart would mean reading the platform's
cause, which the refusals work (https://github.com/kamp-us/tea-fabrika/pull/2319) is hiding. Nothing else in
`disk.ts` changes: `folder` still says which folder this call made, and the release still runs `unmake` only for that
folder and only when the call failed.

### The stand-in: the same rule, and a hook between calls

`MemoryFiles.writable` (`kalfa/config/src/MemoryFiles.test-support.ts`) changes in two ways.

- **Its `remove` copies the patched backend.** Today a folder without `recursive` fails `BadResource` whatever it
  holds, which matches neither Node before the patch (`Unknown`) nor after. After: an empty folder is removed, and a
  folder with any entry below it fails `Unknown`, method `remove`, and nothing is removed. CU4 checks this against a
  real temp folder.
- **A new `hooked`** wraps any `FileSystem` so that a law can act between two calls. It serves the stand-in and the
  real disk alike, which is what lets CU3 run the same race on both.

```ts
// A sketch. Nothing here was type-checked.
/** One call as a hook sees it: the method, the path it names first (for `rename`, the path it moves from), and a write's flag. */
export interface Step {
  readonly method: Call;
  readonly path: string;
  readonly flag?: "w" | "wx" | undefined;
}

/**
 * `fs`, with `before` run at the start of each call of a `Call` method, before its work. A failure of `before` is the
 * call's failure, so a hook can plant a fault; a hook that waits holds the call until it is let go.
 */
export const hooked = (
  fs: FileSystem.FileSystem,
  before: (step: Step) => Effect.Effect<void, PlatformError.PlatformError>,
): FileSystem.FileSystem
```

### The race, written once

A new `kalfa/config/src/SettingGroup.cleanup.test-support.ts` holds the draws, the classes and one function that runs
two writers on one base `FileSystem` in a forced order.

```ts
// A sketch. Nothing here was type-checked.
type Fault = "create" | "write" | "rename";                    // (c) (w) (r): where writer A fails
type Arrival = "lock" | "file" | "other" | "folder" | "none";  // (l) (f) (o) (d) (n): what is in A's folder at its clean-up
type Turn = "inside" | "finished" | "after";                   // (i) (j) (a): where writer B is at A's clean-up

/** What one race left: each writer's answer, every call in the order it started, and the disk after. */
interface Raced {
  readonly a: Answer;
  readonly b: Answer;
  readonly order: ReadonlyArray<{ readonly writer: "a" | "b"; readonly step: MemoryFiles.Step }>;
  readonly between?: State;   // the disk after A ended and before B started, for turn (a) only
  readonly after: State;
}

const race: (base: FileSystem.FileSystem, scene: Scene, fault: Fault, turn: Turn) => Effect.Effect<Raced>
```

**How the order is forced.** Each writer gets its own `hooked` view of the one base disk and its own fiber. Three
`Deferred`s set the order; nothing sleeps and nothing reads a clock, so no run depends on timing:

1. A runs alone. Its hook fails A's planted step (`fault`), and at A's `remove(dir)` its hook completes `aWaits` and
   then awaits `go`. By then A has made the folder and let go of its lock, since the lock's release runs before the
   folder's.
2. The law awaits `aWaits`, so B starts only while A's folder is there: B's `makeDirectory` answers `AlreadyExists`
   and B does not own the folder.
3. Turn (i): B's hook, at B's `readFileString` of the file (the first call after B made its lock), completes `go`
   and then awaits `aDone`. A's `remove(dir)` runs with B's lock in the folder. When A ends, the law completes
   `aDone`, and B writes and renames. Turn (j): the law runs B to its end, then completes `go`. Turn (a): the law
   completes `go` at once, waits for A to end, reads `between`, then runs B.
4. Each race runs under `Effect.timeout("10 seconds")`, so a wrong gate fails with a name, not a hung test. That is
   why CU2 and CU3 are `it.live` laws.

The `order` record proves the order happened: CU2 checks where A's `remove(dir)` falls among B's calls.

## One value traced

App `demo`, repo `/work`, setting `net.port`, so the file is `/work/.demo/demo.toml` and the folder `/work/.demo`.
Writer A sets `net.port = 8080`, and its lock write is refused (`PermissionDenied`). Writer B sets `net.port = 9090`.
Turn (i).

1. A: `realPath(/work/.demo/demo.toml)` fails `NotFound`, so A uses the path as it is.
2. A: `makeDirectory(/work/.demo)` makes the folder. `folder` answers `/work/.demo`: A made it.
3. A: `writeFileString(/work/.demo/demo.toml.lock, "", { flag: "wx" })` makes A's lock.
4. A: `readFileString(/work/.demo/demo.toml)` fails `NotFound`, read as "".
5. A: `writeFileString(/work/.demo/demo.toml.lock, "[net]\nport = 8080\n")`: the hook fails it with
   `PermissionDenied`. This is A's first error: `write`, "`.demo/demo.toml`: could not be written."
6. A's lock release: `remove(/work/.demo/demo.toml.lock, { force: true })` removes A's lock.
7. A's folder release, `unmake`: A's hook, before `remove(/work/.demo)`, completes `aWaits` and waits.
8. B starts: `realPath` fails `NotFound`; `makeDirectory(/work/.demo)` fails `AlreadyExists`, so B made no folder;
   `writeFileString(/work/.demo/demo.toml.lock, "", { flag: "wx" })` makes B's lock.
9. B's hook, before `readFileString(/work/.demo/demo.toml)`, completes `go` and waits for `aDone`.
10. A: `remove(/work/.demo)`. Patched Node: `rm` fails `ERR_FS_EISDIR`, then `rmdir` fails `ENOTEMPTY`, so
    `Unknown`. The stand-in: the folder holds `demo.toml.lock`, so `Unknown`. `unmake` logs
    "`.demo/demo.toml`'s folder was not removed." at `Warn` and succeeds. A ends with step 5's error, unchanged.
11. The law completes `aDone`. B reads "", writes `[net]\nport = 9090\n` into its lock, and renames it over
    `/work/.demo/demo.toml`. B ends `done`.
12. The disk holds `/work/.demo` and `/work/.demo/demo.toml` = `[net]\nport = 9090\n`, and no lock. With today's
    code, step 10 is a `readDirectory` that saw an empty folder at step 7 and a recursive remove that deletes B's lock,
    so B's rename at step 11 fails `NotFound` and B fails too.

## Generators

Every law draws the disk draw the disk laws already use (`DiskDraw` in
`kalfa/config/src/SettingGroup.disk.test-support.ts`: app, setting, values, the refusal tags and a held text), and
`CleanupDraw` adds two names of three to six lower-case letters (one for (o), one for (d)) and a held text for what
arrives. Each run builds every class below; a law keeps the ids it reached with `Reach`
(`kalfa/config/src/SettingGroup.edit.test-support.ts`) and fails when one is missing. Both places a set makes a folder
are in every run: the repo's `.<app>/` and `$HOME/.<app>/` (ids `u:repo` and `u:home`). `$<APP>_HOME` is never made
(law D5), so it is not a place here.

Where writer A fails, after it made the folder:

- (c) its lock's create is refused (`createRefused`): A never holds a lock.
- (w) its lock's write is refused (`writeRefused`): A held a lock and let it go.
- (r) its rename is refused (`renameRefused`): A held a written lock and let it go.

What is in A's folder at its clean-up (CU1, written by the hook just before A's `remove(dir)`):

- (l) a lock, `<file>.lock`, holding the drawn text.
- (f) a finished file, `<file>`, holding the drawn text.
- (o) a file of another drawn name, `<w>.<w>`.
- (d) an empty folder of a drawn name.
- (n) nothing: the folder is empty and goes.

Where writer B is at A's clean-up (CU2 and CU3):

- (i) B holds its lock, before its read, write and rename.
- (j) B has finished: its file is in the folder and its lock is gone.
- (a) B starts only after A has ended: the folder is gone, and B makes it again.

## Laws

Test laws in memory run `runsFor({ fast: 25, full: 100 })` runs. The `.integration.` laws run
`runsFor({ fast: 5, full: 20 })`, each run on its own temp folder, in main's full run.

| Law | Kind (lint, type or test?) | Generator | Plant | Where |
|---|---|---|---|---|
| CU1, a failed set's clean-up leaves what another writer put in the folder: in each run, for each place (`u:repo`, `u:home`), each fault (c), (w), (r) and each arrival (l), (f), (o), (d), (n), a set into a place with no folder runs on `hooked(writable)`; the hook fails A's planted step, and just before A's `remove(dir)` it writes the arrival through the base disk, once. Each case holds exactly: the answer equals the answer of the same set with arrival (n) (`toEqual` on `Answer`), which is `failed`, reason `write`, naming the file; for (l), (f) and (o) the files after are exactly `{ <arrived path>: <drawn text> }` and the folders are those before plus `dir`; for (d) the files are `{}` and the folders are those before plus `dir` and `dir/<name>`; for (n) the files and folders are exactly those before; the recorded calls hold exactly one `remove` whose path is `dir`, its options without `recursive: true`, and no `readDirectory` or `readDirectoryEntries` call; the log holds exactly one line with `<file>'s folder was not removed.` for (l), (f), (o), (d) and none for (n). 100 runs | test | Effect Arbitrary: CleanupDraw | today's `unmake` (list, then `recursive: true`): (l), (f), (o), (d) lose the entry, red. (l) leave out names ending `.lock` when deciding the folder is empty: red; (f) leave out the file's own name: red; (o) keep the folder only when it holds the lock or the file: red; (d) count only plain files (`readDirectoryEntries`, `type === "File"`): red; (n) drop `unmake`: the folder is left, red; (c) skip the clean-up when the lock was never taken: with (n) the folder is left, red; (w) on a refused lock write, remove the folder with `recursive: true` inside `replace`: the entry is lost, red; (r) the same on a refused rename: red | kalfa/config/src/SettingGroup.cleanup.test.ts |
| CU2, two writers, in a forced order: in each run, for each place, each fault (c), (w), (r) and each turn (i), (j), (a), `race` runs A (a set that fails at its fault) and B (a set of another drawn value, no fault) on one `writable` through two `hooked` views, under `it.live` and a 10-second timeout. Each race holds exactly: A's answer equals A's answer alone; B's answer is `done`; the files after are exactly `{ <file>: <B's text> }`, where B's text is the in-memory edit's answer for an empty file (`doSet`); the folders after are those before plus `dir`; no `.lock` is left. The order record holds: for (i), A's `remove(dir)` is after B's `wx` create of the lock and before B's `rename`; for (j), it is after B's `rename`; for (a), every call of B is after it, and `between` holds exactly the folders and files before the race. 100 runs | test | Effect Arbitrary: CleanupDraw | today's `unmake`: (i) deletes B's lock, so B's rename fails `NotFound` and B fails, red. (i) keep the folder only when it holds the file: red; (j) keep the folder only when it holds a `.lock`: red; (a) drop `unmake`: `between` still holds `dir`, red; a gate removed from `race` (B's hook does not wait for `aDone`): the order check fails, red | kalfa/config/src/SettingGroup.cleanup.test.ts |
| CU3, the race on a real disk: in each run, on a fresh temp folder through `NodeServices` (patched backend), the place `u:repo`, a drawn fault of (c), (w), (r), and each turn (i), (j), (a) and each arrival (l), (o), (n) of CU1, the same `race` and the same CU1 runner run on `hooked(real)` and on `hooked(writable)`. The real disk's state after, with the temp folder's path taken off, holds exactly what CU1 and CU2 say, and equals the stand-in's (`toEqual` on answers and states). 20 runs | test | Effect Arbitrary: CleanupDraw | drop the patch's `rmdir` (or the `patchedDependencies` line): on the real disk (n) and (a) keep the folder, so real and stand-in differ, red; today's `unmake`: (i) and (l) lose B's lock on the real disk, red | kalfa/config/src/SettingGroup.cleanup.integration.test.ts |
| CU4 scenario: the stand-in's `remove` is the patched backend's: on a temp folder through `NodeServices` and on `writable`, the same six calls give the same answer tag and leave the same entries: `remove` of a file; of an empty folder; of a folder with one file; of a folder with one empty folder; of a missing path, with and without `force`; and `remove(dir, { recursive: true })` of a folder with a file. Expected: removed; removed; fails `Unknown`, nothing removed; fails `Unknown`, nothing removed; no failure and `NotFound`; removed with all it holds | test | scenario: six fixed calls on a temp folder, then in memory | the patch removes recursively when `recursive` is off: the folder with a file goes, red; the stand-in keeps today's `BadResource` for any folder: tags differ, red | kalfa/config/src/SettingGroup.cleanup.integration.test.ts |
| CU5, the rest holds: D1 to D10 in `SettingGroup.disk.test.ts` (D2 and D5 take a folder away through the new `remove`), R2 in `SettingGroup.disk.integration.test.ts`, and the type laws T5 and T9 stay green with no edit | test | pinned: their own generators and cases, unchanged | (already planted in their own files) | kalfa/config/src/SettingGroup.disk.test.ts |

No public type changes: `SettingGroup.set` and `SettingGroup.remove` keep `Effect<void, SettingsError, FileSystem |
Path>`, so no new `type:` law; T5 and T9 pin it.

**Where they run.** CU1 and CU2 run in memory on every pull request. CU3 and CU4 write to a temp folder, so they are
`*.integration.test.ts`: the laptop refuses them by name (`vitest.hostrun.ts`), pull requests and the merge queue run
none, and main's full run does. No stand-in will do for them: their one job is to show that Node's real `rmdir`,
through the patch, behaves as the stand-in does, so CU1 and CU2 are as true as a law on a disk. No law is host-only:
a temp folder is not launchd, the Electron app, a signal or a socket. The lead's proof run before merge runs CU3, CU4
and R2.

**Run time.** CU1 is 30 in-memory calls a run and CU2 is 18 races, about the size of D5's parts. If either passes
20 s at full depth, the tests step splits it by place, as `SettingGroup.disk.test.ts` splits D1 into `PARTS`.

## Files

| File | Owner | Product lines expected | Change |
|---|---|---|---|
| kalfa/config/src/internal/disk.ts | build | 10 | `unmake` is one `remove` without `recursive`; its doc comment, with the "Known race" paragraph gone and the patch named |
| patches/ patches/@effect__platform-node-shared@4.1.3.patch | tests | 40 | new, written with `pnpm patch` and `pnpm patch-commit`: `removeFactory` in `dist/NodeFileSystem.js` and `src/NodeFileSystem.ts` falls back to `rmdir` on `ERR_FS_EISDIR` |
| pnpm-workspace.yaml | tests | 4 | the `patchedDependencies` entry, with a comment naming the upstream issue and when to drop it |
| pnpm-lock.yaml | tests | lockfile | the patch's hash, written by one `pnpm install --offline` after the patch |
| kalfa/config/README.md | build | docs | one sentence in "The folder" bullet: a failed set takes away a folder it made only while it is empty |
| kalfa/config/src/MemoryFiles.test-support.ts | tests | tests | `writable`'s `remove` of a folder without `recursive` copies the patched backend; new `Step` and `hooked` |
| kalfa/config/src/SettingGroup.cleanup.test-support.ts | tests | tests | new: `CleanupDraw`, the classes, the CU1 runner and `race` |
| kalfa/config/src/SettingGroup.cleanup.test.ts | tests | tests | new: CU1 and CU2 |
| kalfa/config/src/SettingGroup.cleanup.integration.test.ts | tests | tests | new: CU3 and CU4 |
| kalfa/config/src/SettingGroup.disk.test-support.ts | tests | tests | no change expected: its draws, places and faults are reused |
| kalfa/config/src/SettingGroup.edit.test-support.ts | tests | tests | no change expected: `Reach`, `valued`, `doSet` and the rest are reused |
| kalfa/config/src/SettingGroup.disk.test.ts | tests | tests | CU5: no change, stays green |
| kalfa/config/src/SettingGroup.disk.integration.test.ts | tests | tests | CU5: no change, stays green |

No change to `kalfa/config/GLOSSARY.md`: no new domain word. "Another writer" and "the app's own folder" are plain
words the README already uses.

**Beside the refusals work.** https://github.com/kamp-us/tea-fabrika/pull/2319
(`.kalfa/quests/kalfa-config-refusals-PLAN.md` on its branch) changes `Cli.ts`, `SettingGroup.ts`,
`internal/change.ts`, `internal/check.ts`, `internal/error.ts`, `internal/place.ts`, `internal/read.ts`,
`SettingGroup.types.test.ts`, `Cli.test.ts`, two new `Cli.refusals.*` files and `README.md`. Its plan lists
`MemoryFiles.test-support.ts` and `SettingGroup.disk.test-support.ts` as "no change expected". The one shared file is
`kalfa/config/README.md`: it adds a paragraph about the two refusals, and this plan adds one sentence to "The folder"
bullet (line 172 on main), a different section, so a merge should not conflict. `disk.ts` calls `stop` from
`internal/error.ts`, which 2319 changes inside; this plan calls it as it is and changes no message. CU1 and CU2
compare a failed answer with the same call's answer alone, never with a fixed text, so 2319's wording does not touch
them. Whichever lands second rebases; the lead reruns CU1 and CU2 then.

## Existing tools

- `hooked` in kalfa/config/src/MemoryFiles.test-support.ts: searched `@kampus/vitest` (`next/packages/vitest/src`:
  `Recorder.ts`, `Stub.ts`), Effect 4.1.3's `FileSystem.ts` and `Layer.ts`, and the package's own test support
  (`rg -n "makeNoop|Proxy|beforeReady" kalfa/config/src`). `Recorder.layer` wraps a service with a `Proxy` but only
  records and fails, and cannot wait; `LiveDisk.beforeReady` hooks only `watch`; `writable`'s `faults` are fixed at the
  seed and cannot wait or write. None runs an Effect before a call, so `hooked` is new, shaped like `Recorder`'s
  `watch`.
- `race` and the CU1 runner in kalfa/config/src/SettingGroup.cleanup.test-support.ts: searched the package's laws for
  two disk calls in one test (`rg -n "fork|Deferred|Fiber" kalfa/config/src`). The live laws fork a watcher, and no law
  runs two writers. `run` in `SettingGroup.disk.test.ts` is the model for one call (its tracer, logger and `Recorder`),
  and is copied, not imported, since it is not exported. Effect's `Deferred`, `Effect.forkChild` and `Fiber.join` do
  the gating; no helper is written for them.
- kalfa/config/src/SettingGroup.cleanup.test.ts and kalfa/config/src/SettingGroup.cleanup.integration.test.ts: new
  law files, named for what they check, as `SettingGroup.fileOnly.test.ts` is. Searched for an existing home: CU1 and
  CU2 could go in `SettingGroup.disk.test.ts`, which is already 1073 lines and split into parts for time; a new file
  also keeps clear of 2319's files.
- patches/@effect__platform-node-shared@4.1.3.patch: searched Effect 4.1.3 for any call that removes only an empty
  folder (`FileSystem.d.ts`, the Node backend's `NodeFileSystem.ts`), Effect's main branch, and Effect's issues for
  `rmdir`. None. A Config service of its own or a direct `node:fs/promises` import were the other ways; see Calls
  taken.
- The draws reuse `DiskDraw`, `placeFor`, `seedFor`, `createRefused`, `writeRefused`, `renameRefused`, `Answer`,
  `answer` and `names` (`SettingGroup.disk.test-support.ts`), and `Reach`, `valued`, `valuesFor`, `groupFor`,
  `targetSetting`, `doSet` and `mustText` (`SettingGroup.edit.test-support.ts`). CU3 and CU4 take a temp folder with
  `makeTempDirectoryScoped` and `realPath`, as R2 does.

## Calls taken

- **Patch Effect's Node backend, not a Config service and not a Node import.** 85% sure. A Config service for "remove
  an empty folder" adds a requirement to `SettingGroup.set`, `SettingGroup.remove` and the `config` command, and a
  Layer every caller must join, for a gap that is Effect's. A `node:fs/promises` import in `disk.ts` would be the first
  Node import in `kalfa/config/src`, ties the package to Node, and no stand-in can see it, so no law could plant the
  arrival. The patch keeps the interface, matches Effect's own doc ("Remove a file or directory") and the API it copies
  (Deno), and is what the repo's rule says to do. The doubt is the repo-wide effect; see the top.
- **Change `remove`'s behavior rather than add a call such as `removeDirectory`.** 85% sure. A new member changes
  `FileSystem`'s type, `makeNoop` and every hand-made stand-in, and needs a patch to `effect` as well as to the Node
  backend. The behavior change is smaller, keeps every type, and is the upstream fix most likely to land, since Go and
  Deno already work this way.
- **Rename-to-a-private-name is out.** 95% sure. Moving the folder away and checking it there is safe for A, but it
  carries B's lock away with it, so B's rename fails: it breaks the other writer instead.
- **Keep the one `Warn` line for every refused clean-up.** 85% sure. See the shape.
- **The other half of the race stays out.** 85% sure. B can see the folder, then lose it to A's clean-up before it
  makes its lock, and fail "its folder is not there." Nothing is lost and B can be run again, and git's answer (try the
  `mkdir` again) changes which folder B made and so what B cleans up. It is Findings 1, a ticket of its own.
- **Is this a setting?** No. Whether a failed set cleans up after itself is settled by the approved edit plan (law D5),
  and the 10-second race timeout is a test guard, not a value a person picks for a repo.

## Validation

- Tests step: the patch, its `pnpm-workspace.yaml` entry and the lockfile are the tests step's, since the patched
  backend is what CU3 and CU4 check (the patch files are exam paths). It writes them with `pnpm patch` and
  `pnpm patch-commit`, or by hand and one `pnpm install --offline`, then runs the Node calls of CU4 once by hand in its
  scratch folder (`remove` of an empty and of a full folder through `NodeServices`) to see the patch work.
  `nice -n 15 pnpm exec vitest run kalfa/config/src/SettingGroup.cleanup.test.ts
  kalfa/config/src/SettingGroup.disk.test.ts` shows CU1 and CU2 red on the branch head through the classes the plant
  cells name for today's `unmake`, and D1 to D10 green with the stand-in's new `remove`. CU3 and CU4 are not run on the
  laptop.
- Build step: the same two files green after the `disk.ts` change; each plant run once and undone.
- The lead runs `--changed origin/main`, one `pnpm typecheck`, and a proof run of CU3, CU4 and R2 before merge.

## Size

1. One pull request: 54 lines (the patch 40, `disk.ts` 10, `pnpm-workspace.yaml` 4), plus the lockfile, one README
   sentence, three new test files and an edit to `MemoryFiles.test-support.ts`. The tests step writes the patch (an
   exam path), the build writes `disk.ts` and the README. It lands whole: the patch without the
   one-call `unmake` changes nothing a person sees, and the `unmake` without the patch never removes a folder, which
   would turn D5 red.

About 2 agent hours across tests, build and review, 80% sure. The doubt is `race`'s gating on the real disk, which may
take a round to get right. Basis: the refusals plan prices its Opus steps at about $9; this one has fewer laws and
fewer product lines, so about $8 a step: tests, build and review, plus one likely send-back of tests and build.

Estimate: 5 steps, $40

## New names

- `hooked` and `Step`, in `kalfa/config/src/MemoryFiles.test-support.ts`: a file system with a hook before each call,
  and one call as the hook sees it. Test support.
- `race`, `CleanupDraw`, `Fault`, `Arrival` and `Turn`, in `kalfa/config/src/SettingGroup.cleanup.test-support.ts`.
  Test support.
- `SettingGroup.cleanup.test.ts` and `SettingGroup.cleanup.integration.test.ts`: test files named for what they check.

## Records

- **The upstream issue**, filed by the lead the day the plan is approved and before the tests step starts, so the tests
  step writes its URL into `pnpm-workspace.yaml`'s comment and the lead links it on ticket 2014 (its third criterion). It
  goes to Effect-TS/effect, the repository the installed package names. A draft:
  - Title: `FileSystem.remove` on Node cannot remove an empty directory without `recursive`
  - Body: `FileSystem.remove(path)` says "Remove a file or directory." On Node it calls `fs.rm(path, { recursive:
    false })`, which refuses every directory with `ERR_FS_EISDIR`, an empty one too, so no call removes a directory
    only when it is empty. That is the one safe way to clean up a folder another process may write into: a list then
    a recursive remove deletes what lands in between. `Deno.remove`, Go's `os.Remove` and C's `remove(3)` remove an
    empty directory and refuse a non-empty one. Repro: `fs.makeDirectory(d)` then `fs.remove(d)` fails `Unknown`.
    Proposed fix: on `ERR_FS_EISDIR` without `recursive`, call `fs.rmdir(path)`, which fails `ENOTEMPTY` for a
    non-empty one; the patch is attached. The issue carries the patch, never this repo's paths or names.
- No glossary term and no decision record: the patch is undone by a version bump, and the rule it follows is already
  written ("Never wait on upstream").

## What fact is lost if it is not recorded now

Why `remove` is called without `recursive`, and that it relies on a patch. Without the doc comment in `disk.ts` and
the comment in `pnpm-workspace.yaml`, a later agent who sees an empty folder left behind on an unpatched Effect, or
who drops the patch at a bump, would put the list and the recursive remove back, and the race with it. Both comments
are in the files table.

## What this cannot tell us

- Whether a real Node on Linux and on macOS gives `ERR_FS_EISDIR` from `rm` and `ENOTEMPTY` from `rmdir` alike: I ran
  only the laptop's Node 22 on macOS. CI's run of CU3 and CU4 on its own system answers it. The package's `engines`
  says Node 26 or newer; I did not run 26.
- Whether some caller in today's frozen `apps/` or `packages/` removed a folder without `recursive` and counted on the
  refusal. I did not read them; main's full run would show it.
- What a person sees when the folder stays: only the `Warn` log line. Whether an empty `.<app>/` folder left behind on
  an unpatched Effect, outside this repo, bothers anyone is not known.
- Whether Effect takes the change as a behavior change or asks for a new option: the issue will say.

## Open questions

None.

Each choice picks how the code does what the ticket's criteria and the repo's patch rule already say.

## Findings

1. **The other half of the race: a writer can lose the folder it saw.** In `kalfa/config/src/internal/disk.ts`,
   `folder` treats `AlreadyExists` as "the folder is there, not mine". If A's clean-up removes the empty folder after
   B's `makeDirectory` saw it and before B makes its lock, B's `wx` create fails `NotFound`, and `take` answers
   "`.<app>/<app>.toml`: its folder is not there." for a set whose folder was there a moment before. Nothing is lost,
   and the set can be run again. git's `raceproof_create_file` makes the folder again and tries once more; doing that
   here means B then owns the folder it made and cleans it up on failure. A ready ticket: "Config: a set whose folder
   is taken away before its lock tries again", acceptance: a CU2-style forced race (B's hook holds B between its
   `makeDirectory` and its lock until A's `remove(dir)` has run) shows B ends `done` and the folder holds B's file.
