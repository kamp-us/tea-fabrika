Approved by the lead agent, builds 0089; body 250dcc2acb98
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
`rmdir`. Effect's `FileSystem` has no such call, so Config gets one small edge function of its own,
`removeEmptyDir`, that calls Node's `fs.promises.rmdir` and reads "not empty" and "not there" as "left in place".
Effect's own packages are not patched. The upstream issue asks Effect for the call; when Effect has it, the edge
function goes. One pull request, about 40 product lines.

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
const remove = yield* RemoveEmptyDir
yield* remove(dir)
//   A: rmdir(dir) -> ENOTEMPTY -> "left"; A logs nothing and moves on
//   B's lock stays, B finishes, and A still fails with its own first error
```

## Calls under 80%, read these first

None is under 80%. The lowest, at 85%, is how laws reach the edge function: through a `Context.Reference` whose
default is the Node edge, so no caller's requirements change. The cost is that a law running a failing set on the
in-memory disk must provide the stand-in's edge, or the Node edge runs against a path that is not on the real disk
(it answers "left", harmlessly, but a law would then see the folder stay). `MemoryFiles.writable(...).layer` provides
it; the two harnesses that build their own layer (`run` in `SettingGroup.disk.test.ts` and in `Cli.test-support.ts`)
get one line each.

## How others do it

- **POSIX `rmdir(2)`** removes a folder only when it is empty, in one system call. For a folder that is not empty,
  POSIX lets it fail `ENOTEMPTY` or `EEXIST`; Linux and macOS give `ENOTEMPTY`. Read from memory; not fetched.
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
- **Node**: `fs.rm(dir)` without `recursive` refuses every folder, an empty one too; `fs.rmdir` is the call. I ran it
  on the laptop's Node 22: `rm` on an empty folder fails `ERR_FS_EISDIR`; `rmdir` on a folder with a file fails
  `ENOTEMPTY`; `rmdir` on an empty folder removes it; `rmdir` on a missing path fails `ENOENT`.
- **Effect 4.1.3**, as installed (`pnpm-lock.yaml`: `effect@4.1.3` patched, `@effect/platform-node-shared@4.1.3`
  held by `overrides`): `FileSystem.remove`'s only options are `recursive` and `force`
  (`effect/dist/FileSystem.d.ts:258-267`). The Node backend calls `NFS.rm(path, { recursive, force })` and nothing else
  (`@effect/platform-node-shared/src/NodeFileSystem.ts:180-192`). Effect's main branch has the same `remove`
  (`packages/effect/src/FileSystem.ts`, last changed by Effect-TS/effect-smol commit `1caab3cc3`), and a search of
  Effect's issues for `rmdir` found none.
- **This repo's way for a platform call Effect lacks** is
  [a platform API wrapped once, at its edge](../patterns/effect-platform-wrapped-once.md): one wrapper, one marked
  edge line, an error mapper that keeps the cause, as `kalfa/cli/src/internal/packages.ts` does for `import()` and
  `findPackageJSON`. The lead chose this over patching Effect: a patched dependency is carried through every Effect
  upgrade, and a patch to `remove` changes it for every caller in the repo.

## The shape

### The edge function: `kalfa/config/src/internal/removeEmptyDir.ts`

```ts
// A sketch. Nothing here was type-checked.
import { Context, Effect, PlatformError, Predicate } from "effect";

/** What a removal of an empty folder did: took the folder away, or left it in place, because it holds something or is gone. */
export type Removal = "removed" | "left";

/** The `code` Node puts on a failed call, as `ENOTEMPTY`. */
const code = (cause: unknown) =>
  Predicate.hasProperty(cause, "code") && Predicate.isString(cause.code) ? cause.code : undefined;

/** Not empty (POSIX allows either code) or not there: the folder is left as it is, and that is no failure. */
const LEFT: ReadonlySet<string> = new Set(["ENOTEMPTY", "EEXIST", "ENOENT"]);

const reason = (found: string | undefined): PlatformError.SystemErrorTag =>
  found === "EACCES" || found === "EPERM"
    ? "PermissionDenied"
    : found === "EBUSY"
      ? "Busy"
      : found === "ENOTDIR"
        ? "BadResource"
        : "Unknown";

/**
 * Removes the folder at `path` only when it is empty, in one `rmdir`, which the system refuses for a folder that
 * holds anything. Answers `"left"` for a folder that is not empty or not there, and fails for anything else, with
 * Node's error kept as the cause. Effect's `FileSystem` has no such call (the upstream issue); when it has, this goes.
 */
export const removeEmptyDir = (path: string): Effect.Effect<Removal, PlatformError.PlatformError> =>
  // oxlint-disable-next-line fabrika/no-promises -- edge: Effect's FileSystem cannot remove only an empty folder, and Node's rmdir answers a Promise
  Effect.tryPromise({ try: () => import("node:fs/promises").then((fs) => fs.rmdir(path)), catch: (cause) => cause }).pipe( // edge: rmdir is the one call that removes a folder only when it is empty
    Effect.as<Removal>("removed"),
    Effect.catch((cause) =>
      LEFT.has(code(cause) ?? "")
        ? Effect.succeed<Removal>("left")
        : Effect.fail(
            // oxlint-disable-next-line fabrika/no-hand-tag -- edge: Effect PlatformError requires its own system error tag
            PlatformError.systemError({ _tag: reason(code(cause)), module: "FileSystem", method: "removeEmptyDir", pathOrDescriptor: path, cause }),
          ),
    ),
  );

/** The edge `disk.ts` calls. Its default is Node's; a law gives the in-memory disk's in its place. */
export const RemoveEmptyDir = Context.Reference<(path: string) => Effect.Effect<Removal, PlatformError.PlatformError>>(
  "@kalfa/config/internal/removeEmptyDir.RemoveEmptyDir",
  { defaultValue: () => removeEmptyDir },
);
```

Three points the build holds to, whatever the final spelling:

- **The Node module is loaded on the call, not at import.** A Worker imports `@kalfa/config` (the glossary's loading
  process, and ticket https://github.com/kamp-us/tea-fabrika/issues/2055, which keeps the root entry free of work at
  load). A static `import ... from "node:fs/promises"` would put a Node module in that graph. The dynamic `import()`
  carries the `// edge:` reason on its own line, which `fabrika/no-node-imports` reads (it checks `ImportExpression`
  too), and `fabrika/no-promises` takes one marked line. Both rules already apply to `kalfa/config/src/**`
  (`.oxlintrc.json`), and both allow exactly this edge shape. 85% sure the lazy load is right; a static import is the
  fallback if the build finds the dynamic one fights the bundle (`rslib`).
- **The error mapper keeps the cause**, as the pattern says. The error never reaches a person: `unmake` logs and
  drops it.
- **The service id** follows `fabrika/service-id`: the package, the file's path, then `.RemoveEmptyDir`. It is not
  exported from `index.ts` or any entry; laws reach it by its internal path.

### `disk.ts`: one call

```ts
// A sketch. Nothing here was type-checked.
/**
 * Takes a folder this call made away again, only while it is empty: one `rmdir` through `RemoveEmptyDir`, which the
 * system refuses for a folder that holds anything, so a lock or a file another writer has put in it since stays.
 * A folder left in place is no failure; any other refusal is logged.
 */
const unmake = Effect.fnUntraced(function* (call: Call, path: string) {
  const remove = yield* RemoveEmptyDir;

  yield* remove(path).pipe(Effect.ignore({ log: "Warn", message: `${call.name}'s folder was not removed.` }));
});
```

The "Known race" paragraph goes. "Left" logs nothing: a folder another writer is using is the normal case, not a
problem. Only a real refusal (permission, a busy folder) logs the `Warn` line, as today. Nothing else in `disk.ts`
changes: `folder` still says which folder this call made, and the release still runs `unmake` only for that folder
and only when the call failed. `SettingGroup.set` and `SettingGroup.remove` keep
`Effect<void, SettingsError, FileSystem | Path>`: a `Context.Reference` adds no requirement.

### The stand-in: the same rule, and a hook between calls

`MemoryFiles.writable` (`kalfa/config/src/MemoryFiles.test-support.ts`) changes in three ways. Its `FileSystem` does
not change.

- **A new `removeEmptyDir`** on `Writable` copies the edge: an empty folder is removed (`"removed"`); a folder with any
  entry below it, or a path that is not there, is left (`"left"`); a file fails `BadResource`, as `ENOTDIR` maps.
  CU4 checks it against Node's real `rmdir` on a temp folder.
- **`writable(...).layer`** provides `RemoveEmptyDir` with that function beside `FileSystem` and `Path`, so a law that
  uses the layer gets the stand-in's edge with no edit.
- **A new `hooked`** wraps a file system and an edge so that a law can act between two calls. It serves the stand-in
  and the real disk alike, which is what lets CU3 run the same race on both.

```ts
// A sketch. Nothing here was type-checked.
/** One call as a hook sees it: the method, the path it names first (for `rename`, the path it moves from), and a write's flag. */
export interface Step {
  readonly method: Call | "removeEmptyDir";
  readonly path: string;
  readonly flag?: "w" | "wx" | undefined;
}

/** A file system and an edge, as one disk. */
export interface Disk {
  readonly fileSystem: FileSystem.FileSystem;
  readonly removeEmptyDir: (path: string) => Effect.Effect<Removal, PlatformError.PlatformError>;
}

/**
 * `disk`, with `before` run at the start of each call of a `Call` method and of `removeEmptyDir`, before its work.
 * A failure of `before` is the call's failure, so a hook can plant a fault; a hook that waits holds the call.
 * `layer` provides both, as `writable(...).layer` does.
 */
export const hooked = (
  disk: Disk,
  before: (step: Step) => Effect.Effect<void, PlatformError.PlatformError>,
): Disk & { readonly layer: Layer.Layer<FileSystem.FileSystem | Path.Path> }
```

The real disk for CU3 and CU4 is `{ fileSystem: <NodeServices' FileSystem>, removeEmptyDir }`, the product's own
edge function.

### The race, written once

A new `kalfa/config/src/SettingGroup.cleanup.test-support.ts` holds the draws, the classes and one function that runs
two writers on one base disk in a forced order.

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

const race: (base: MemoryFiles.Disk, scene: Scene, fault: Fault, turn: Turn) => Effect.Effect<Raced>
```

**How the order is forced.** Each writer gets its own `hooked` view of the one base disk and its own fiber. Three
`Deferred`s set the order; nothing sleeps and nothing reads a clock, so no run depends on timing:

1. A runs alone. Its hook fails A's planted step (`fault`), and at A's `removeEmptyDir(dir)` its hook completes
   `aWaits` and then awaits `go`. By then A has made the folder and let go of its lock, since the lock's release runs
   before the folder's.
2. The law awaits `aWaits`, so B starts only while A's folder is there: B's `makeDirectory` answers `AlreadyExists`
   and B does not own the folder.
3. Turn (i): B's hook, at B's `readFileString` of the file (the first call after B made its lock), completes `go`
   and then awaits `aDone`. A's `removeEmptyDir(dir)` runs with B's lock in the folder. When A ends, the law
   completes `aDone`, and B writes and renames. Turn (j): the law runs B to its end, then completes `go`. Turn (a):
   the law completes `go` at once, waits for A to end, reads `between`, then runs B.
4. Each race runs under `Effect.timeout("10 seconds")`, so a wrong gate fails with a name, not a hung test. That is
   why CU2 and CU3 are `it.live` laws.

The `order` record proves the order happened: CU2 checks where A's `removeEmptyDir(dir)` falls among B's calls.

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
7. A's folder release, `unmake`: A's hook, before `removeEmptyDir(/work/.demo)`, completes `aWaits` and waits.
8. B starts: `realPath` fails `NotFound`; `makeDirectory(/work/.demo)` fails `AlreadyExists`, so B made no folder;
   `writeFileString(/work/.demo/demo.toml.lock, "", { flag: "wx" })` makes B's lock.
9. B's hook, before `readFileString(/work/.demo/demo.toml)`, completes `go` and waits for `aDone`.
10. A: `removeEmptyDir(/work/.demo)`. On Node, `rmdir` fails `ENOTEMPTY`, so `"left"`. The stand-in: the folder holds
    `demo.toml.lock`, so `"left"`. `unmake` logs nothing. A ends with step 5's error, unchanged.
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

What is in A's folder at its clean-up (CU1, written by the hook just before A's `removeEmptyDir(dir)`):

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
| CU1, a failed set's clean-up leaves what another writer put in the folder: in each run, for each place (`u:repo`, `u:home`), each fault (c), (w), (r) and each arrival (l), (f), (o), (d), (n), a set into a place with no folder runs on `hooked(writable)`; the hook fails A's planted step, and just before A's `removeEmptyDir(dir)` it writes the arrival through the base disk, once. Each case holds exactly: the answer equals the answer of the same set with arrival (n) (`toEqual` on `Answer`), which is `failed`, reason `write`, naming the file; for (l), (f) and (o) the files after are exactly `{ <arrived path>: <drawn text> }` and the folders are those before plus `dir`; for (d) the files are `{}` and the folders are those before plus `dir` and `dir/<name>`; for (n) the files and folders are exactly those before; the order record holds exactly one `removeEmptyDir` step, on `dir`; the `Recorder` holds no `remove`, `readDirectory` or `readDirectoryEntries` call on `dir`; no log line holds `<file>'s folder was not removed.` 100 runs | test | Effect Arbitrary: CleanupDraw | today's `unmake` (list, then `recursive: true`): (l), (f), (o), (d) lose the entry, red. (l) leave out names ending `.lock` when deciding the folder is empty: red; (f) leave out the file's own name: red; (o) keep the folder only when it holds the lock or the file: red; (d) count only plain files (`readDirectoryEntries`, `type === "File"`): red; (n) drop `unmake`: the folder is left, red; (c) skip the clean-up when the lock was never taken: with (n) the folder is left, red; (w) on a refused lock write, remove the folder with `recursive: true` inside `replace`: the entry is lost, red; (r) the same on a refused rename: red; log "left" at `Warn`: the line shows, red | kalfa/config/src/SettingGroup.cleanup.test.ts |
| CU2, two writers, in a forced order: in each run, for each place, each fault (c), (w), (r) and each turn (i), (j), (a), `race` runs A (a set that fails at its fault) and B (a set of another drawn value, no fault) on one `writable` through two `hooked` views, under `it.live` and a 10-second timeout. Each race holds exactly: A's answer equals A's answer alone; B's answer is `done`; the files after are exactly `{ <file>: <B's text> }`, where B's text is the in-memory edit's answer for an empty file (`doSet`); the folders after are those before plus `dir`; no `.lock` is left. The order record holds: for (i), A's `removeEmptyDir(dir)` is after B's `wx` create of the lock and before B's `rename`; for (j), it is after B's `rename`; for (a), every call of B is after it, and `between` holds exactly the folders and files before the race. 100 runs | test | Effect Arbitrary: CleanupDraw | today's `unmake`: (i) deletes B's lock, so B's rename fails `NotFound` and B fails, red. (i) keep the folder only when it holds the file: red; (j) keep the folder only when it holds a `.lock`: red; (a) drop `unmake`: `between` still holds `dir`, red; a gate removed from `race` (B's hook does not wait for `aDone`): the order check fails, red | kalfa/config/src/SettingGroup.cleanup.test.ts |
| CU3, the race on a real disk: in each run, on a fresh temp folder through `NodeServices` and the product's `removeEmptyDir`, the place `u:repo`, a drawn fault of (c), (w), (r), and each turn (i), (j), (a) and each arrival (l), (o), (n) of CU1, the same `race` and the same CU1 runner run on `hooked(real)` and on `hooked(writable)`. The real disk's state after, with the temp folder's path taken off, holds exactly what CU1 and CU2 say, and equals the stand-in's (`toEqual` on answers and states). 20 runs | test | Effect Arbitrary: CleanupDraw | in `removeEmptyDir`, call `rm(path, { recursive: true })` in place of `rmdir`: (i) and (l) lose B's lock on the real disk, red; call `rm(path)` without `recursive`: Node refuses every folder, so (n) and (a) keep the folder on the real disk while the stand-in removes it, red | kalfa/config/src/SettingGroup.cleanup.integration.test.ts |
| CU4 scenario: the stand-in's `removeEmptyDir` is the edge's: on a temp folder with the product's `removeEmptyDir` and on `writable`'s, the same five calls give the same answer and leave the same entries: an empty folder; a folder with one file; a folder with one empty folder; a missing path; a file. Expected: `"removed"`, the folder gone; `"left"`, nothing removed; `"left"`, nothing removed; `"left"`; fails with reason `BadResource`, the file kept | test | scenario: five fixed calls on a temp folder, then in memory | map `ENOTEMPTY` to a failure in the edge: the second case fails, red; map `ENOENT` to a failure: the fourth fails, red; the stand-in answers `"removed"` for a folder with a file: the answers differ, red | kalfa/config/src/SettingGroup.cleanup.integration.test.ts |
| CU5, the rest holds: D1 to D10 in `SettingGroup.disk.test.ts` (D2 and D5 take a folder away through the stand-in's edge, which its `run` now provides), R2 in `SettingGroup.disk.integration.test.ts`, the `config` command's laws in `Cli.test.ts`, and the type laws T5 and T9 stay green | test | pinned: their own generators and cases, unchanged | (already planted in their own files) | kalfa/config/src/SettingGroup.disk.test.ts |

No public type changes: `SettingGroup.set` and `SettingGroup.remove` keep `Effect<void, SettingsError, FileSystem |
Path>`, so no new `type:` law; T5 and T9 pin it.

**Where they run.** CU1 and CU2 run in memory on every pull request. CU3 and CU4 write to a temp folder, so they are
`*.integration.test.ts`: the laptop refuses them by name (`vitest.hostrun.ts`), pull requests and the merge queue run
none, and main's full run does. No stand-in will do for them: their one job is to show that Node's real `rmdir`,
through the edge function, behaves as the stand-in does, so CU1 and CU2 are as true as a law on a disk. No law is
host-only: a temp folder is not launchd, the Electron app, a signal or a socket. The lead's proof run before merge
runs CU3, CU4 and R2.

**Run time.** CU1 is 30 in-memory calls a run and CU2 is 18 races, about the size of D5's parts. If either passes
20 s at full depth, the tests step splits it by place, as `SettingGroup.disk.test.ts` splits D1 into `PARTS`.

## Files

| File | Owner | Product lines expected | Change |
|---|---|---|---|
| kalfa/config/src/internal/removeEmptyDir.ts | build | 30 | new: `Removal`, `removeEmptyDir` (the one Node edge) and the `RemoveEmptyDir` reference |
| kalfa/config/src/internal/disk.ts | build | 8 | `unmake` calls `RemoveEmptyDir` once; its doc comment, with the "Known race" paragraph gone |
| kalfa/config/README.md | build | docs | one sentence in "The folder" bullet: a failed set takes away a folder it made only while it is empty |
| kalfa/config/src/MemoryFiles.test-support.ts | tests | tests | `Writable.removeEmptyDir`; `writable(...).layer` provides it; new `Step`, `Disk` and `hooked` |
| kalfa/config/src/SettingGroup.cleanup.test-support.ts | tests | tests | new: `CleanupDraw`, the classes, the CU1 runner and `race` |
| kalfa/config/src/SettingGroup.cleanup.test.ts | tests | tests | new: CU1 and CU2 |
| kalfa/config/src/SettingGroup.cleanup.integration.test.ts | tests | tests | new: CU3 and CU4 |
| kalfa/config/src/SettingGroup.disk.test.ts | tests | tests | CU5: `run` provides the stand-in's `RemoveEmptyDir` beside its `Recorder` layer, one line |
| kalfa/config/src/Cli.test-support.ts | tests | tests | CU5: `run` provides the stand-in's `RemoveEmptyDir`, one line, so a failed `config set` never calls Node's `rmdir` |
| kalfa/config/src/SettingGroup.disk.test-support.ts | tests | tests | no change expected: its draws, places and faults are reused; `runCase` uses `writable().layer`, which now carries the edge |
| kalfa/config/src/SettingGroup.edit.test-support.ts | tests | tests | no change expected: `Reach`, `valued`, `doSet` and the rest are reused |
| kalfa/config/src/SettingGroup.disk.integration.test.ts | tests | tests | CU5: no change, stays green |
| kalfa/config/src/Cli.test.ts | tests | tests | CU5: no change, stays green |
| .oxlintrc.json package.json pnpm-lock.yaml pnpm-workspace.yaml patches/ | tests | none | not changed: the edge uses the lint rules as they are, and no dependency or patch is added |

No change to `kalfa/config/GLOSSARY.md`: no new domain word. "Another writer" and "the app's own folder" are plain
words the README already uses. No change to `package.json`, `pnpm-lock.yaml`, `pnpm-workspace.yaml` or `patches/`.

**Beside the refusals work.** https://github.com/kamp-us/tea-fabrika/pull/2319
(`.kalfa/quests/kalfa-config-refusals-PLAN.md` on its branch) changes `Cli.ts`, `SettingGroup.ts`,
`internal/change.ts`, `internal/check.ts`, `internal/error.ts`, `internal/place.ts`, `internal/read.ts`,
`SettingGroup.types.test.ts`, `Cli.test.ts`, two new `Cli.refusals.*` files and `README.md`, and lists
`MemoryFiles.test-support.ts`, `Cli.test-support.ts`, `SettingGroup.disk.test-support.ts` and
`SettingGroup.disk.test.ts` as "no change expected". Two files overlap:

- `kalfa/config/README.md`: 2319 adds a paragraph about the two refusals; this plan adds one sentence to "The folder"
  bullet (line 172 on main), a different section.
- `kalfa/config/src/Cli.test-support.ts`: this plan adds one line to `run`'s `Layer.mergeAll`; 2319 plans no change
  there, and its new `Cli.refusals.test-support.ts` builds its own runner. If 2319's runner runs a failing `config set`
  that makes a folder, it calls Node's `rmdir` on an in-memory path, which answers `"left"` and changes no law of
  2319's (none checks folders). Its review may add the same line.

`disk.ts` calls `stop` from `internal/error.ts`, which 2319 changes inside; this plan calls it as it is and changes no
message. CU1 and CU2 compare a failed answer with the same call's answer alone, never with a fixed text, so 2319's
wording does not touch them. Whichever lands second rebases; the lead reruns CU1, CU2 and CU5 then.

## Existing tools

- kalfa/config/src/internal/removeEmptyDir.ts: searched Effect 4.1.3 for any call that removes only an empty folder
  (`FileSystem.d.ts`, the Node backend's `NodeFileSystem.ts`), Effect's main branch, Effect's issues for `rmdir`, and
  the repo (`rg -n "rmdir" kalfa next/packages --glob '!**/node_modules/**'`, no hit). None. The shape copies
  `kalfa/cli/src/internal/packages.ts` (one marked Promise edge, a `code` reader) and
  `.kalfa/patterns/effect-platform-wrapped-once.md`. A patch to Effect's backend was the other way; the lead ruled it
  out.
- `RemoveEmptyDir`, a `Context.Reference` in the same file: searched the package for a seam that a law can swap
  without changing a caller's requirements. `Context.Service` would add a requirement to `SettingGroup.set`; a
  `Context.Reference` (Effect 4.1.3, `Context.d.ts:1741`, stable) carries a default and adds none.
- `hooked`, `Step` and `Disk` in kalfa/config/src/MemoryFiles.test-support.ts: searched `@kampus/vitest`
  (`next/packages/vitest/src`: `Recorder.ts`, `Stub.ts`), Effect 4.1.3's `FileSystem.ts` and `Layer.ts`, and the
  package's own test support (`rg -n "makeNoop|Proxy|beforeReady" kalfa/config/src`). `Recorder.layer` wraps a
  service with a `Proxy` but only records and fails, and cannot wait; `LiveDisk.beforeReady` hooks only `watch`;
  `writable`'s `faults` are fixed at the seed and cannot wait or write. None runs an Effect before a call, so
  `hooked` is new, shaped like `Recorder`'s `watch`.
- `Writable.removeEmptyDir` in kalfa/config/src/MemoryFiles.test-support.ts: the stand-in's copy of the edge, beside
  its `remove`, which it reuses for the entry checks (`below`).
- `race` and the CU1 runner in kalfa/config/src/SettingGroup.cleanup.test-support.ts: searched the package's laws for
  two disk calls in one test (`rg -n "fork|Deferred|Fiber" kalfa/config/src`). The live laws fork a watcher, and no law
  runs two writers. `run` in `SettingGroup.disk.test.ts` is the model for one call (its tracer, logger and `Recorder`),
  and is copied, not imported, since it is not exported. Effect's `Deferred`, `Effect.forkChild` and `Fiber.join` do
  the gating; no helper is written for them.
- kalfa/config/src/SettingGroup.cleanup.test.ts and kalfa/config/src/SettingGroup.cleanup.integration.test.ts: new
  law files, named for what they check, as `SettingGroup.fileOnly.test.ts` is. Searched for an existing home: CU1 and
  CU2 could go in `SettingGroup.disk.test.ts`, which is already 1073 lines and split into parts for time; a new file
  also keeps clear of 2319's files.
- The draws reuse `DiskDraw`, `placeFor`, `seedFor`, `createRefused`, `writeRefused`, `renameRefused`, `Answer`,
  `answer` and `names` (`SettingGroup.disk.test-support.ts`), and `Reach`, `valued`, `valuesFor`, `groupFor`,
  `targetSetting`, `doSet` and `mustText` (`SettingGroup.edit.test-support.ts`). CU3 and CU4 take a temp folder with
  `makeTempDirectoryScoped` and `realPath`, as R2 does.

## Calls taken

- **One edge function at Config's platform edge, not a patch to Effect.** The lead's call, recorded here: a patched
  dependency is carried through every Effect upgrade, and a patch to `remove` changes it for every caller in the
  repo. The edge is one file, and it goes when Effect has the call.
- **A `Context.Reference` as the seam.** 85% sure; see the top.
- **Load `node:fs/promises` on the call.** 85% sure; see the shape. The doubt is the bundle: `rslib` may want a
  static import, which the build may take with the same edge comment if the dynamic one fights it.
- **"Left" covers `ENOTEMPTY`, `EEXIST` and `ENOENT`, and logs nothing.** 85% sure. POSIX allows either code for a
  folder that is not empty, and a folder already gone is already what the clean-up wanted. Every other refusal keeps
  today's `Warn` line.
- **Rename-to-a-private-name is out.** 95% sure. Moving the folder away and checking it there is safe for A, but it
  carries B's lock away with it, so B's rename fails: it breaks the other writer instead.
- **The other half of the race stays out.** 85% sure. B can see the folder, then lose it to A's clean-up before it
  makes its lock, and fail "its folder is not there." Nothing is lost and B can be run again. It is Findings 1; the
  lead tickets it.
- **Is this a setting?** No. Whether a failed set cleans up after itself is settled by the approved edit plan (law D5),
  and the 10-second race timeout is a test guard, not a value a person picks for a repo.

## Validation

- Tests step: `nice -n 15 pnpm exec vitest run kalfa/config/src/SettingGroup.cleanup.test.ts
  kalfa/config/src/SettingGroup.disk.test.ts kalfa/config/src/Cli.test.ts` shows CU1 and CU2 red on the branch head
  through the classes the plant cells name for today's `unmake`, and D1 to D10 and the command's laws green. CU3 and
  CU4 are not run on the laptop. Until the build adds `internal/removeEmptyDir.ts`, the test files' import of it does
  not resolve; the tests step says so in its plant record, as a red law.
- Build step: the same three files green after `removeEmptyDir.ts` and the `disk.ts` change; each plant run once and
  undone. The build runs `removeEmptyDir` once by hand in its scratch folder on an empty and on a full folder to see
  the edge work on Node.
- The lead runs `--changed origin/main`, one `pnpm typecheck`, and a proof run of CU3, CU4 and R2 before merge.

## Size

1. One pull request: 38 lines (`removeEmptyDir.ts` 30, `disk.ts` 8), plus one README sentence, three new test files
   and small edits to three test files. It lands whole: the edge without the one-call `unmake` changes nothing, and
   the `unmake` without the edge cannot remove a folder.

About 2 agent hours across tests, build and review, 80% sure. The doubt is `race`'s gating on the real disk, which may
take a round to get right. Basis: the refusals plan prices its Opus steps at about $9; this one has fewer laws and
fewer product lines, so about $8 a step: tests, build and review, plus one likely send-back of tests and build.

Estimate: 5 steps, $40

## New names

- `removeEmptyDir`, `Removal` and `RemoveEmptyDir`, in `kalfa/config/src/internal/removeEmptyDir.ts`: the edge, what
  it did, and the seam a law swaps. Internal; `Removal`'s two words are `"removed"` and `"left"`.
- `hooked`, `Step` and `Disk`, in `kalfa/config/src/MemoryFiles.test-support.ts`: a disk with a hook before each
  call, one call as the hook sees it, and a file system with its edge. Test support.
- `race`, `CleanupDraw`, `Fault`, `Arrival` and `Turn`, in `kalfa/config/src/SettingGroup.cleanup.test-support.ts`.
  Test support.
- `SettingGroup.cleanup.test.ts` and `SettingGroup.cleanup.integration.test.ts`: test files named for what they check.

## Records

- **The upstream issue**, which the lead may file, to Effect-TS/effect, the repository the installed package names.
  When it is filed, the lead links it on ticket 2014 (its third criterion) and the build or the review puts its URL in
  `removeEmptyDir`'s doc comment. A draft:
  - Title: `FileSystem` has no way to remove a directory only when it is empty
  - Body: `FileSystem.remove(path)` says "Remove a file or directory." On Node it calls `fs.rm(path, { recursive:
    false })`, which refuses every directory with `ERR_FS_EISDIR`, an empty one too, so no call removes a directory
    only when it is empty. That is the one safe way to clean up a folder another process may write into: a list then
    a recursive remove deletes what lands in between. `Deno.remove`, Go's `os.Remove` and C's `remove(3)` remove an
    empty directory and refuse a non-empty one. Repro: `fs.makeDirectory(d)` then `fs.remove(d)` fails `Unknown`.
    Ask: let `remove` without `recursive` take away an empty directory (on Node, `fs.rmdir` after `ERR_FS_EISDIR`), or
    add a call that does. The issue carries a repro, never this repo's paths or names.
- No glossary term and no decision record: the edge is undone when Effect has the call, and the rule it follows is the
  platform-edge pattern.

## What fact is lost if it is not recorded now

Why the clean-up goes through `RemoveEmptyDir` and not `fs.remove`. Without the doc comments in
`removeEmptyDir.ts` and `disk.ts`, a later agent who sees a Node import in `kalfa/config` would swap it back for
Effect's `FileSystem`: `fs.remove(dir)` refuses every folder, and `fs.remove(dir, { recursive: true })` after a list
brings the race back. Both comments are in the files table.

## What this cannot tell us

- Whether a real Node on Linux gives `ENOTEMPTY` from `rmdir` as macOS does: I ran only the laptop's Node 22 on macOS.
  CI's run of CU3 and CU4 answers it, and `EEXIST` is "left" too. The package's `engines` says Node 26 or newer; I did
  not run 26.
- Whether `rslib` bundles the dynamic `import("node:fs/promises")` as Node's own module and leaves it lazy: the build's
  `pnpm --filter @kalfa/config pack` in CI shows it, and `test/consumer.mjs` loads the packed root entry.
- What a person sees when the folder stays because another writer uses it: nothing, by design.
- Whether Effect takes the change as a behavior change or adds a new call: the issue will say.

## Open questions

None.

Each choice picks how the code does what the ticket's criteria, the platform-edge pattern and the lead's ruling
already say.

## Findings

1. **The other half of the race: a writer can lose the folder it saw.** In `kalfa/config/src/internal/disk.ts`,
   `folder` treats `AlreadyExists` as "the folder is there, not mine". If A's clean-up removes the empty folder after
   B's `makeDirectory` saw it and before B makes its lock, B's `wx` create fails `NotFound`, and `take` answers
   "`.<app>/<app>.toml`: its folder is not there." for a set whose folder was there a moment before. Nothing is lost,
   and the set can be run again. git's `raceproof_create_file` makes the folder again and tries once more; doing that
   here means B then owns the folder it made and cleans it up on failure. A forced race shows it: B's hook holds B
   between its `makeDirectory` and its lock until A's `removeEmptyDir(dir)` has run. The lead tickets it.
