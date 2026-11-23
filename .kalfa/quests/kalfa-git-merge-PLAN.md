Approved by the lead agent, builds issues 1750, 1932, 2012, 1934; body 3c77b67157fc
Plancheck-Version: 3

# Plan: @kalfa/git, write a merge commit with no working copy (ticket 1934)

This is the kalfa packages (`kalfa/`), new work: not today's frozen version and not `next/`. The ticket is
https://github.com/kamp-us/tea-fabrika/issues/1934, a GitHub issue, so the last slice's pull request says
`Closes #1934` and the first says `Refs #1934`. It builds on two landed pull requests, as they are: the read package
(https://github.com/kamp-us/tea-fabrika/pull/1977, plan `.kalfa/quests/kalfa-git-read-PLAN.md`) and trees
(https://github.com/kamp-us/tea-fabrika/pull/2013, issue 2012, plan `.kalfa/quests/kalfa-git-trees-PLAN.md`). Two
slices, each its own pull request from main, the second after the first lands.

```ts
// The whole idea, a sketch. The store gets three raw calls; the merge commit helper is written once over them.
import * as MergeCommit from "@kalfa/git/MergeCommit";
import * as Repository from "@kalfa/git/Repository";

const candidate = Effect.gen(function* () {
  const repo = yield* Repository.Repository;
  // ours is the line the merge is made on (main), theirs the line that joins it. Parents: [ours, theirs].
  const merge = yield* MergeCommit.mergeCommit({ ours: main, theirs: branchTip, author, message });
  // The committer came from the settings. Nothing moved yet; the caller moves a ref only if it is where it read it.
  yield* repo.moveRef({ ref: candidateRef, from: Option.none(), to: merge.id });
  return merge;
});

// The three raw calls, which every adapter writes:
repo.writeCommit({ tree, parents, author, message }) // Commit; its committer is the settings' one, at the clock's time
repo.moveRef({ ref, from, to }) // void, or RefMoved { ref } and the ref stays as it was
repo.mergeTrees({ mergeBase, ours, theirs }) // TreeId, or Conflict { paths }
```

## Doubts, read first

Three calls are under 80%. Each lean is taken, as the lead asked, and stays here so a reader sees the doubt.

- **Several merge bases fail, 75%.** `mergeCommit` fails with `SeveralMergeBases { bases }` when the two commits have
  two or more best common ancestors (a criss-cross). git's own merge first merges the bases into a virtual one;
  `/memory` cannot match what git writes into that virtual base when the bases conflict, so the shared laws could not
  hold both adapters to one answer. Delivery marks such a change request Failed ("could not be built"), and a person
  can land it another way. What would settle it: how often Delivery's real queue meets a criss-cross.
- **The caller gives the merge commit's author, 75%.** The ticket names only the message. 1935's `commitEdit` takes an
  author, and the owner's line on 1750 keeps authors as their writers gave them, so the helper takes one too. The other
  choice was the settings' committer as the author.
- **A merge whose theirs is already in ours still makes a commit, 75%.** git's own `merge` says "Already up to date"
  and makes none. The helper does not ask, since Delivery checks `isAncestor` first (ruling 17). The tree is then ours'
  tree.

## What changes, in one paragraph

Slice 1 adds two raw calls, `writeCommit` and `moveRef`, and the `committer` setting, a plain record of a name and an
email (decision 0089). `Repository.make` writes the committer into every commit, from the settings and Effect's
clock, so the rule lives in one place for every adapter. Slice 2 adds the raw call `mergeTrees` and the helper
`MergeCommit.mergeCommit`. `/memory` merges by whole file, comparing each path's landed `Tree.Entry` (mode and blob),
and builds the result with the landed `MemoryRepository.tree`. `/process` runs `git merge-tree --write-tree
--merge-base`, which needs git 2.40, so that one call fails with a clear refusal on older git while the layer still
opens on 2.38. No call sends anything to a remote. The trees pull request's `Tree.ts`, `MemoryRepository.ts` (its
`tree`, `add`, `Store`) and `internal/object.ts` stay as they landed. Out of scope: diff and patch id (1933), read a
file and edit a tree (1935), rebase (1936), squash (1937), fetch and push (1938 to 1940), and the five-second kill
wait (https://github.com/kamp-us/tea-fabrika/issues/2011).

## Searched first

- The ticket, its parent https://github.com/kamp-us/tea-fabrika/issues/1750 with every comment, the ticket's own
  comment (the committer is a plain record), and the siblings 1933, 1935, 1936 and 1937, so this plan leaves them
  their calls and gives 1935 what it builds on.
- The landed package on main, read whole: `Repository.ts`, `MemoryRepository.ts` (with `File`, `Store.trees` flat by
  path, `Store.blobs`, `tree`, `add`, `BadStore` reasons `missing-tree` and `path-conflict`), `Tree.ts` (`TreeId`,
  `BlobId`, `Path`, `Mode` of `100644`, `100755`, `120000`, `Entry`), `internal/object.ts` (`OBJECT_ID`, `bytes`,
  `hashed`, `byBytes`, `treeBytes`), `ProcessRepository.ts`, `Settings.ts`, `Commit.ts`, `internal/parse.ts`,
  `README.md`, `GLOSSARY.md`; the tests `RepositoryTest.ts`, `History.test-support.ts`, `ProcessSeed.test-support.ts`,
  `StandIn.test-support.ts`, `MemoryRepository.test.ts`, `ProcessRepository.integration.test.ts`; and both landed
  plans. The trees plan's table names what 1934 takes from it: `TreeId`, `MemoryRepository.tree` for a merged tree,
  `Entry` equality for the whole-file merge, `Commit.tree`.
- Decisions 0060 (Delivery builds the candidate with git, a merge commit by default), 0071 (squash's author and
  co-authors), 0089 (a setting's value is plain data); Delivery's glossary (Change candidate, Landing style, Failed:
  "could not be built"); patterns `effect-crypto-through-services.md` (the `Digest` service) and
  `effect-tagged-value-is-matched.md`. `rg -il` over `.kalfa/decisions`, `.kalfa/glossary`, `.kalfa/patterns`,
  `.kalfa/runbooks` and every kalfa glossary for "merge commit|merge-tree|three-way", "conflict", "committer",
  "compare-and-swap|lease|update-ref|move a ref", "working copy", "whole file|by line", "time zone|offset|UTC". No
  decision answers the merge style of `/memory`, several merge bases or the committer's offset.
- Installed versions in the lockfile: `effect` and `@effect/vitest` 4.1.3 (its patch touches only `TestConsole` and
  the arbitrary model), `vitest` 5.0.5. Read in the installed source: `Clock.currentTimeMillis`,
  `Schema.NonEmptyArray`, `Ref.modify`, `effect/crypto/Digest`.
- Facts from git 2.40.1 and Apple's git 2.39.3, run by hand in a scratch folder outside the repo, with no user or
  system config. Not a test; the tests step records the `vector:` file again with its own run.
  - `merge-tree --write-tree --merge-base=<c>` takes commits only: a tree as the base or as a side exits 128 or 1
    ("expected commit type"). git 2.39.3 refuses `--merge-base` (exit 129). git's release notes say it came in
    2.40.0 (`RelNotes/2.40.0.txt`, line 6) and `--write-tree` in 2.38.0.
  - With `--no-messages --name-only -z`, a clean merge prints `<tree>` and a NUL and exits 0. A conflict prints the
    tree, a NUL, then each conflicting path and a NUL, and exits 1. A path holding a line break comes out whole. A
    missing base exits 128.
  - git merges a file by line: two sides changing line 1 and line 3 of one file merge clean. One-line files changed
    differently on both sides conflict; so do modify against delete and add against add with different contents.
  - `hash-object -t commit -w --stdin` writes the bytes given and prints git's id. It does not check that the tree
    or the parents exist. It refuses a NUL in the message (`nulInCommit`) and in the author line (`nulInHeader`), and
    accepts an empty name (two spaces before `<`), a leading space, a tab, an empty email, seconds 0 and
    9007199254740991, offsets `-0000`, `+1400`, `+9959`, an empty message, a message with no trailing newline, CR
    and CRLF, and duplicate parents.
  - `update-ref --no-deref <ref> <new> <old>` is a compare and swap: a wrong old value, an old value of forty zeros
    while the ref exists, and a ref beside a ref below or above it (`refs/x/a` and `refs/x/a/b`) each exit 128 and
    leave the ref as it was. A tree to a ref under `refs/heads/` and a missing object exit 128. On a symbolic ref
    whose target matches the old value it replaces the symbolic ref with a plain one and leaves the target alone.
  - git's config documents `merge.renames` (defaults to `diff.renames`, true), `merge.directoryRenames` (defaults to
    "conflict") and `merge.renormalize`; a bare repository's own config file can set each.

## How others do it

- **git's plumbing** is the known way to merge and commit with no working copy: `merge-tree --write-tree` (the ort
  merge in memory, git 2.38), `--merge-base` to name the base (2.40), `commit-tree` or `hash-object -t commit` to
  write a commit, and `update-ref <ref> <new> <old>` to move a ref only if it is where the caller read it. Run by hand
  above. Hosts' server-side merges use `merge-tree` the same way (from memory, not fetched).
- **libgit2**: `git_merge_trees(ancestor, ours, theirs)` gives an index whose conflicts name paths,
  `git_commit_create` takes the committer as a `git_signature`, and `git_reference_create_matching` moves a ref only
  if it matches the old id. From memory, not fetched.
- **JGit**: `ThreeWayMerger.merge(base, ours, theirs)`, `RefUpdate` with `setExpectedOldObjectId`, which answers
  `LOCK_FAILURE` when the ref moved. From memory, not fetched.
- **isomorphic-git** (git in JavaScript): `merge` merges by line with its own diff3 and says in its docs that it
  differs from git in some cases. That is the cost a line merge in `/memory` would carry. From memory, not fetched.
- **Effect**: `Repository.make` already wraps an adapter's raw calls once, as `ChildProcessSpawner.make` does; the
  committer rule joins the span and the time limit there. `Clock` gives the time, so `TestClock` sets it in a law.
- **Elm and Erlang/OTP** have nothing to say: no state lives between calls. A ref move is a compare and swap, the
  same answer an OTP process gives with a version check on its state.

## The shape

### Slice 1: write a commit and move a ref

```ts
// kalfa/git/src/Settings.ts, a sketch. Required, no default. Plain data (0089).
export const Settings = Schema.Struct({
  limits: Limits,
  committer: Schema.Struct({ name: Commit.Name, email: Commit.Email }),   // Name and Email now exported, and they refuse NUL
});
```

```ts
// kalfa/git/src/Repository.ts, a sketch of what slice 1 adds.
export class NoSuchTree extends Schema.TaggedError<NoSuchTree>()("NoSuchTree", { id: TreeId }) {}       // missing, or not a tree
export class NulInMessage extends Schema.TaggedError<NulInMessage>()("NulInMessage", {}) {}             // git refuses to write it
export class TooLargeToWrite extends Schema.TaggedError<TooLargeToWrite>()("TooLargeToWrite", { most: Schema.Int }) {}
export class RefMoved extends Schema.TaggedError<RefMoved>()("RefMoved", { ref: RefName }) {}           // not where the caller said
export class RefInTheWay extends Schema.TaggedError<RefInTheWay>()("RefInTheWay", { ref: RefName, other: RefName }) {}

type Written = { readonly tree: TreeId; readonly parents: ReadonlyArray<CommitId>; readonly author: Signature; readonly message: string };
// Added to the Repository service:
readonly writeCommit: (commit: Written) =>
  Effect.Effect<Commit, NoSuchTree | NoSuchCommit | NulInMessage | TooLargeToWrite | Fails>;
readonly moveRef: (move: { readonly ref: RefName; readonly from: Option.Option<CommitId>; readonly to: CommitId }) =>
  Effect.Effect<void, NoSuchCommit | RefMoved | RefInTheWay | Fails>;

// What an adapter writes: the same calls, except that writeCommit is handed the committer.
export type Raw = Omit<Repository["Service"], "writeCommit"> & {
  readonly writeCommit: (commit: Written & { readonly committer: Signature }) => ReturnType<Repository["Service"]["writeCommit"]>;
};
export const make: (raw: Raw, settings: Settings) => Repository["Service"];
```

`make`'s `writeCommit` takes the committer's name and email from the settings and the time from `Clock`, in whole
seconds at offset `+0000`. It builds the object's bytes with the landed `internal/object.ts` `bytes` and fails before
the adapter runs: `NulInMessage` when the message holds a NUL byte, `TooLargeToWrite` when the object is past
`limits.bytes`, so every commit written can be read back. `from: Option.none()` means the ref must not exist yet.

- **`/memory`**: `writeCommit` checks the tree is in `Store.trees` and each parent in `Store.commits`, then makes the
  commit with the landed `MemoryRepository.commit` and puts it in with the landed `add`. `moveRef` runs in one
  `Ref.modify` of the store, so two moves never interleave: `to` is a commit of the store, the ref is where `from`
  says, and no other ref is its folder or sits in it (the landed `isBeside` rule). The layer now needs `Digest`:
  `Layer<Repository | MemoryStore, never, Digest.Digest>`.
- **`/process`**: `writeCommit` asks `cat-file --batch-check` that the tree is a `tree` and each parent a `commit`
  (the landed `known` check, grown to take the type it wants), then writes the same bytes with `hash-object -t commit
  -w --stdin` and reads git's id. So both adapters give one commit one id, byte for byte. `moveRef` asks that `to` is
  a commit, then runs `update-ref --no-deref <ref> <to> <from, or forty zeros>`. Exit 0 is done. On any other exit it
  reads the ref again with `for-each-ref`: not at `from` is `RefMoved`; at `from`, with a ref below it or a ref at one
  of its folders (`for-each-ref --count=1` on each folder), is `RefInTheWay`; else `GitUnavailable`. No stderr is read
  for meaning. A time limit that ends the call during `update-ref` may leave the ref moved or not (git's lock and
  rename is atomic), so a caller reads the ref again after `TimedOut`.

### Slice 2: merge three commits' trees, and the merge commit helper

```ts
// kalfa/git/src/Repository.ts, a sketch of what slice 2 adds.
// The trees of the two sides could not be combined. Each path once, sorted by UTF-8 bytes.
export class Conflict extends Schema.TaggedError<Conflict>()("Conflict", { paths: Schema.NonEmptyArray(Path) }) {}
// GitTooOld gains `needs`: "2.38" when the layer opens, "2.40" for mergeTrees, where it is a GitUnavailable reason.
export class GitTooOld ... { found: Schema.String, needs: Schema.String }
// GitUnavailable's reason becomes Union([NotStarted, Exited, Unreadable, GitTooOld]).

// Added to the Repository service and to Raw. It reads no history, so a shallow repository answers.
readonly mergeTrees: (merge: { readonly mergeBase: CommitId; readonly ours: CommitId; readonly theirs: CommitId }) =>
  Effect.Effect<TreeId, NoSuchCommit | Conflict | Fails>;
```

```ts
// kalfa/git/src/MergeCommit.ts, a sketch: the helper, written once over the store.
export class UnrelatedHistories extends Schema.TaggedError<UnrelatedHistories>()("UnrelatedHistories", {}) {}
export class SeveralMergeBases extends Schema.TaggedError<SeveralMergeBases>()("SeveralMergeBases", { bases: Schema.Array(CommitId) }) {}

export const mergeCommit = Effect.fn("git.mergeCommit")(function* (merge: {
  readonly ours: CommitId; readonly theirs: CommitId; readonly author: Signature; readonly message: string;
}) {
  const repo = yield* Repository.Repository;
  const bases = yield* repo.mergeBases(merge.ours, merge.theirs);
  if (bases.length === 0) return yield* new UnrelatedHistories();
  if (bases.length > 1) return yield* new SeveralMergeBases({ bases });
  const tree = yield* repo.mergeTrees({ mergeBase: bases[0], ours: merge.ours, theirs: merge.theirs });
  return yield* repo.writeCommit({ tree, parents: [merge.ours, merge.theirs], author: merge.author, message: merge.message });
});
// Effect<Commit, UnrelatedHistories | SeveralMergeBases | Conflict | NoSuchCommit | NoSuchTree | TooMany |
//        HistoryTooShort | NulInMessage | TooLargeToWrite | GitUnavailable | TimedOut, Repository>
```

- **`/memory` merges by whole file** (the ticket asks this be written down). For each path in the three trees'
  `Store.trees` maps, with `b`, `o` and `t` its `Tree.Entry` (mode and blob) or absent: `o` equals `t` gives `o`; `o`
  equals `b` gives `t`; `t` equals `b` gives `o`; else the path conflicts. A result where one path is a folder of
  another conflicts on both paths, checked before any tree is made. Otherwise the result's files, with their bytes
  from `Store.blobs`, go to the landed `MemoryRepository.tree`, which gives git's id and puts the tree in the store.
  This is the level git's ort merge decides first.
- **Where `/memory` and git differ**, so the shared laws avoid each case and law I7 pins git's side:
  1. Both sides change one file in places that do not overlap: git merges the lines, `/memory` conflicts.
  2. One side changes a file's mode and the other its content: git takes both, `/memory` conflicts.
  3. Renames: one side deletes a path and adds another with the same or like content while the other side changes
     the old path, or adds a file to a folder the first side moved. git follows the rename (and reports a folder
     move as a conflict); `/memory` sees a change against a delete.
  4. A file on one side where the other side has a folder: git moves the file to a new name and conflicts;
     `/memory` conflicts on both paths and writes no tree.
  5. A `.gitattributes` file with a merge driver or text rules: a newer git may read it from the trees. Submodules:
     `/memory` holds none.
- **`/process`**: on git older than 2.40 it fails `GitUnavailable { reason: GitTooOld { found, needs: "2.40" } }`
  and runs nothing (the version is kept from opening). Else it asks `cat-file --batch-check` that the three are
  commits, then runs `merge-tree --write-tree --no-messages --name-only -z --merge-base=<mergeBase> <ours>
  <theirs>`. Exit 0: the tree. Exit 1: `Conflict` with the paths after the tree, each once, sorted. Anything else:
  `GitUnavailable`. Every command now also starts with `-c merge.renames=true -c merge.directoryRenames=conflict -c
  merge.renormalize=false`, git's defaults written out, so a repository's own config never steers a merge.
- **Nothing public**: `/memory` has no remote at all. `/process` runs only `version`, `rev-parse`, `cat-file`,
  `for-each-ref`, `rev-list`, `merge-base`, `merge-tree`, `hash-object` and `update-ref` (law P11).

### The spans

`make` wraps each new call in `Effect.fn("git.<call>")`, and the helper is `Effect.fn("git.mergeCommit")`.
OpenTelemetry's names first, `kalfa.git.*` where the registry has none. No message, name, email, path or repository
path is ever an attribute.

| Call | Span | Attributes |
|---|---|---|
| writeCommit | `git.writeCommit` | `kalfa.git.tree` = the tree, `kalfa.git.parents` = the parent ids, `kalfa.git.commit` = the id written |
| moveRef | `git.moveRef` | `vcs.ref.head.name` = the ref, `vcs.ref.head.revision` = to, `kalfa.git.from` = the id expected, when there is one |
| mergeTrees | `git.mergeTrees` | `vcs.ref.base.revision` = ours, `vcs.ref.head.revision` = theirs, `kalfa.git.merge_base`, then `kalfa.git.tree` or `kalfa.git.conflicts` = how many paths |
| mergeCommit | `git.mergeCommit` | `vcs.ref.base.revision` = ours, `vcs.ref.head.revision` = theirs, `kalfa.git.commit` = the merge commit's id |

### What 1935 builds on

1935 adds `readFile` and `editTree` to `Raw` and the service, and writes its commit with the public `writeCommit`,
whose committer `make` already sets; it fails with this plan's `NoSuchTree`. It can branch from main once slice 1
lands. 1933 also adds raw calls to `Repository.ts`, `Raw` and the shared laws' list of keys, so whichever of the two
lands second rebases on one line there.

## One value traced: a merge commit candidate

The store: `M1` on main with files `a` = `1\n` and `b` = `x\n`, both mode `100644`. `F1` (parent `M1`) changes `a` to
`2\n`, on `refs/heads/feature`. `M2` (parent `M1`) changes `b` to `y\n`, on `refs/heads/main`. Settings: committer
`Bot <bot@example.test>`, limits as the landed plan's trace. The clock reads 1700000000 seconds.

1. `mergeCommit({ ours: M2, theirs: F1, author, message: "Merge feature\n" })` opens span `git.mergeCommit`.
2. `mergeBases(M2, F1)` answers `[M1]`: one base, so the helper goes on.
3. `mergeTrees({ mergeBase: M1, ours: M2, theirs: F1 })`. `/memory`: `a`'s entries are blob `1`, `1`, `2`, so `2`;
   `b`'s are `x`, `y`, `x`, so `y`; no path is a folder of another, so `MemoryRepository.tree` makes `{ a: "2\n", b:
   "y\n" }` with git's id `T`. `/process`: `cat-file --batch-check` on the three (all `commit`), then `merge-tree ...
   --merge-base=M1 M2 F1` exits 0 and prints `T` and a NUL. Both give the same `T`.
4. `writeCommit({ tree: T, parents: [M2, F1], author, message })`. `make` adds the committer `Bot
   <bot@example.test> 1700000000 +0000`, checks the message has no NUL and the object is within `limits.bytes`.
   `/memory` finds `T`, `M2` and `F1`, hashes the bytes, adds commit `C`. `/process` checks the types, then
   `hash-object -t commit -w --stdin` with the same bytes prints `C`.
5. The helper answers `Commit C` with parents `[M2, F1]`, `M2` first. No ref moved.
6. Delivery: `moveRef({ ref: "refs/kalfa/candidates/01J", from: Option.none(), to: C })`. `/process`: `update-ref
   --no-deref refs/kalfa/candidates/01J C 0000...` exits 0.
7. Had another hand made that ref first: `update-ref` exits 128, the read-back finds it at another commit, so
   `RefMoved { ref }`, and the ref still points where that hand put it.
8. Had `F1` changed `b` too, to `z\n`: `b` is `x`, `y`, `z`, so `Conflict { paths: ["b"] }`, no commit is written,
   and Delivery marks the change request Failed.

## What fact is lost if not recorded now

- **The committer's time, in each commit written**: it goes into the commit itself, from the clock. A commit made
  later cannot get it back, so `make` writes it on every commit.
- **The merge base a merge used**: it shapes the tree and is not in the merge commit. It goes in the `git.mergeTrees`
  span (`kalfa.git.merge_base`), so a later reader can see what a candidate was built from.
- **The conflict's paths**: the caller gets them in `Conflict`; Delivery records them where it marks a change request
  Failed. This package stores nothing of its own.

## Generators

Each class is reached in every run: a run takes its drawn value and makes one case per class from it, and a law
fails when the generator's list of classes reached is short, as the landed laws do (`everyShape`). The landed history
shapes ("two unrelated roots", "a criss-cross"), pair kinds ("ancestor", "self") and file classes (modes, links,
binary content, paths named `__proto__`) serve these laws as they are.

Slice 1:

- (a) A committer setting with `<`, `>`, a line break or a NUL in its name or email, and settings with no committer.
- (b) A message with a NUL byte at its start, middle or end.
- (c) A commit object of exactly `limits.bytes` bytes and one of one byte more, with a character past U+024F at the
  edge.
- (d) A tree the store does not hold, and a commit's id given as the tree.
- (e) A parent the store does not hold, a tree's id given as a parent, and the bad parent second of two.
- (f) Ref moves that succeed: making `refs/kalfa/candidates/<part>` and `refs/remotes/origin/<part>`, moving a branch
  forward, moving it back to an older commit, and moving it to the commit it is at.
- (g) A stale move: `from` none while the ref exists; `from` x while the ref is at y; `from` x while the ref is gone.
- (h) A ref in the way: making `refs/heads/main/x` beside `refs/heads/main`, and `refs/kalfa/candidates` beside
  `refs/kalfa/candidates/<part>`.
- (i) A move to a commit the store does not hold, and to a tree's id.

Slice 2:

- (j) Clean merges, every case where `/memory` and git agree: only ours changes a path; only theirs does; both make
  the same change; ours deletes a path theirs leaves; theirs adds a file two folders deep; both delete; ours is the
  merge base; every file deleted (the empty tree); binary content changed on one side; a mode made executable on one
  side; a link's target changed on one side. One side never both deletes a path and adds another (so git finds no
  rename), no path changes mode on one side and content on the other, and no path one side adds is a folder of one
  the other adds.
- (k) Conflicts git and `/memory` both see: both change a one-line file to different lines; ours deletes what theirs
  changes; both add one path with different one-line contents. Each has clean paths beside it.
- (l) `/memory` alone: ours adds file `a`, theirs adds `a/b`.
- (m) git versions for merges: 2.38.0 to 2.39.x (Apple's `2.39.3 (Apple Git-146)` form included) and 2.40.0 and
  newer.
- (n) Conflict paths, from real `merge-tree -z` output: a line break, a space, a leading `"`, characters past U+024F.

## Laws

Laws use `it.prop` and `it.effect.prop` from `@effect/vitest` 4.1.3, with inputs from Effect's `Arbitrary`, as the
landed laws do. The S laws join `RepositoryTest.suite`, so each adapter's runner runs them: memory at 100 runs,
process at 10. Law ids continue the landed ones.

| Law | Kind (lint, type or test?) | Generator | Plant | Where |
|---|---|---|---|---|
| G8, the committer setting (slice 1): `committer` is required, and its name and email take what `Signature` takes and refuse `<`, `>`, a line break and NUL; `Signature` refuses NUL too. 100 runs | test | Effect Arbitrary: settingsArb | (a) drop NUL from the name's rule: red; (a) give `committer` a default: `{ limits }` decodes, red | kalfa/git/src/Values.test.ts |
| T5, the calls' types (slices 1 and 2): `writeCommit`, `moveRef` and `mergeTrees` have exactly the sketch's answers and errors, with `never` as requirement; the public `writeCommit` takes no `committer`; `Conflict.paths` is non-empty; `mergeCommit` needs only `Repository` | type | type | add `committer` to the public `writeCommit`: the `@ts-expect-error` is unused, red | kalfa/git/src/Repository.types.test.ts |
| T6, the layers' types (slice 1): `MemoryRepository.layer` is `Layer<Repository \| MemoryStore, never, Digest>`; `ProcessRepository.layer` keeps its type | type | type | require `FileSystem` in `/process`: red | kalfa/git/src/Repository.types.test.ts |
| S12, write a commit (slice 1): `writeCommit` of drawn fields gives a commit that `readCommit` gives back field for field, its committer the settings' name and email at the clock's second and `+0000`; writing a seeded commit's own fields, with the clock and settings at its committer, gives its seeded id; no ref moves. memory 100 runs, process 10 | test | Effect Arbitrary: history | (b) delete the NUL check in `make`: memory writes it, red; (c) delete the size check: red; (c) count characters, not bytes: the wide row passes at one byte over, red; (d) delete the tree check: red; (e) check only the first parent: red; take the committer from the author: red | kalfa/git/src/RepositoryTest.ts |
| S13, move a ref (slice 1): each success class leaves the ref at `to` and every other ref as it was; each failure class fails with its error (`RefMoved`, `RefInTheWay` naming the other ref, `NoSuchCommit`) and leaves every ref as it was. memory 100 runs, process 10 | test | Effect Arbitrary: history | (f) refuse a ref outside `refs/heads/`: red; (f) refuse a move that drops commits: red; (g) delete the compare: red; (g) compare only when `from` is some: the first stale form passes, red; (h) delete the clash check: red; (i) delete the check on `to`: red | kalfa/git/src/RepositoryTest.ts |
| P9, a failed `update-ref` (slice 1): on the stand-in, exit 0 is done; a non-zero exit whose read-back shows another commit is `RefMoved`; one whose read-back shows `from` and a ref in the way is `RefInTheWay`; else `Exited` with the code. 200 runs | test | Effect Arbitrary: exitCode | read every failed `update-ref` as `RefMoved`: the third case is red; drop `--no-deref`: the recorded arguments differ, red | kalfa/git/src/ProcessRepository.test.ts |
| P10, the bytes written (slice 1): the stand-in records `hash-object -t commit -w --stdin` with stdin byte for byte what `internal/object.ts` writes for the same fields; output that is not one commit id is `Unreadable` | test | Effect Arbitrary: commitFields | add a newline at the message's end: red; drop `-w`: the recorded arguments differ, red | kalfa/git/src/ProcessRepository.test.ts |
| P11, nothing public (slice 1, grown in 2): across every call, the verbs the stand-in records are within `version`, `rev-parse`, `cat-file`, `for-each-ref`, `rev-list`, `merge-base`, `merge-tree`, `hash-object`, `update-ref` | test | scenario: one stand-in session that makes each call once | run `push` after `update-ref`: red | kalfa/git/src/ProcessRepository.test.ts |
| S9, spans (slices 1 and 2): each new call, and `mergeCommit`, ends one span of its name with the table's attributes; no attribute holds a seeded message, name, email, path or the repository path | test | Effect Arbitrary: history | name the span `Repository.writeCommit`: red; put the conflict's paths in `kalfa.git.conflicts`: red | kalfa/git/src/RepositoryTest.ts |
| S10, no working copy (slices 1 and 2): the service's keys are exactly the read calls plus `writeCommit`, `moveRef` and `mergeTrees`; after any drawn list of read calls the store is as it was; after any drawn writes and merges every ref is as the history says | test | Effect Arbitrary: history | let `mergeTrees` move `refs/heads/main` to a commit of the result: red | kalfa/git/src/RepositoryTest.ts |
| S14, merge trees (slice 2): for each clean case, `mergeTrees` gives the tree of a seeded commit whose files are the model's answer; for each conflict case, `Conflict` with the model's paths; a shallow store answers too. memory 100 runs, process 10 | test | Effect Arbitrary: mergeCases | (j) take ours whenever the sides differ: red; (j) compare blobs and not modes: the executable case comes back non-executable, red; (k) treat a change on both sides as theirs: red; (k) name every changed path, not only the conflicting ones: red | kalfa/git/src/RepositoryTest.ts |
| S15, the merge commit helper (slice 2): for a clean case, `mergeCommit` gives a commit with parents `[ours, theirs]`, the merge's tree, the caller's author and message byte for byte, and the settings' committer; theirs already in ours still gives a commit, with ours' tree; for unrelated roots `UnrelatedHistories`; for a criss-cross `SeveralMergeBases` with both bases; a conflict comes back as `Conflict`; no ref moves. memory 100 runs, process 10 | test | Effect Arbitrary: mergeCases | put the parents in the other order: red; take the first of several bases: the criss-cross merges, red; merge unrelated roots on the empty tree: red | kalfa/git/src/RepositoryTest.ts |
| M6, a file against a folder (slice 2): `/memory`'s `mergeTrees` gives `Conflict` naming both paths, and the store is as it was. 100 runs | test | Effect Arbitrary: mergeCases | (l) delete the folder check: `tree` fails `path-conflict` and the call dies, red | kalfa/git/src/MemoryRepository.test.ts |
| P12, merge-tree's output (slice 2): on the stand-in, exit 0 with the recorded clean output is the tree; exit 1 with the recorded conflict output is `Conflict` with its paths once each, sorted by bytes; any other code is `Exited`; output with no tree is `Unreadable` | test | vector: git 2.40.1 merge-tree -z output | (n) split the output on line breaks: the path with a line break is cut, red; read exit 1 with no paths as a clean merge: red | kalfa/git/src/ProcessRepository.test.ts |
| P13, the version for merges (slice 2): a layer opened on a drawn git below 2.40 fails `mergeTrees` with `GitUnavailable` reason `GitTooOld { needs: "2.40" }` and records no `merge-tree`; on 2.40 and newer it runs. Opening on 2.38 still works. 200 runs | test | Effect Arbitrary: gitVersion | (m) delete the gate: `merge-tree` is recorded on 2.39, red; compare the version as text: 2.100 reads as older, red | kalfa/git/src/ProcessRepository.test.ts |
| P5, git's environment (slice 2): every command's start now holds the three `-c merge.*` pins as well | test | Effect Arbitrary: gitEnv | drop `merge.renames=true`: red | kalfa/git/src/ProcessRepository.test.ts |
| I1, the shared laws on real git (each slice): the suite's new S laws run on `/process` over a bare repository the seeder fills | test | Effect Arbitrary: history | each S law's plant, run once on `/process` | kalfa/git/src/ProcessRepository.integration.test.ts |
| I6, a symbolic ref (slice 1): on real git, `moveRef` of a symbolic ref whose target is at `from` makes it a plain ref at `to` and leaves the target where it was | test | scenario: one symbolic ref made with `git symbolic-ref`, which `/memory` cannot hold | drop `--no-deref`: the target moves, red | kalfa/git/src/ProcessRepository.integration.test.ts |
| I7, where git and memory differ (slice 2): on real git, the four cases under "Where `/memory` and git differ" that git can show (a by-line merge, a mode and a content change, a rename followed, a file against a folder) each give what the list says | test | scenario: one bare repository per case, written with fast-import | set `merge.renames=false` in the repository's own config and drop the pin: the rename case changes, red | kalfa/git/src/ProcessRepository.integration.test.ts |
| K1, the manifest (slice 2): the exports gain exactly `./MergeCommit` | test | scenario: the package's own manifest at head | export `./internal/object`: red | kalfa/git/src/Package.test.ts |

**Where each law runs.**

- G, T, M, P and K laws, and the S laws on `/memory`, are plain files: they run on every pull request their change
  reaches, and on the laptop with a narrow path. T laws run under the lead's typecheck.
- I1, I6 and I7 run the real git binary in temp folders, in the one `.integration.` file the laptop refuses by name.
  A stand-in cannot do their job: I1 proves `/process` answers what `/memory` answers, I6 shows a ref kind `/memory`
  cannot hold, and I7 pins git's own behavior where the stand-in would only repeat this plan's guess. No pull request
  run includes them, so for each slice the lead starts a proof run that reaches this file before the review.
- No law is host-only: none needs launchd, Electron, a real signal or the owner's Mac. No secret flows through these
  calls, so no law is a `[secrets]` law.

## Files

The trees pull request's `Tree.ts` and `internal/object.ts` are not in this table: the merge needs no change to them.
`MemoryRepository.ts` gains new code beside its landed `tree`, `add` and `Store`, which stay as they are.

| File | Owner | Slice | Product lines expected | Change |
|---|---|---|---|---|
| kalfa/git/src/Commit.ts | build | 1 | 4 | `Name` and `Email` exported and refusing NUL |
| kalfa/git/src/Settings.ts | build | 1 | 12 | `committer` |
| kalfa/git/src/Repository.ts | build | 1, 2 | 145 | slice 1: `Raw`, two calls, five errors, `make`'s committer, checks and spans; slice 2: `mergeTrees`, `Conflict`, `GitTooOld.needs` and the reason |
| kalfa/git/src/MemoryRepository.ts | build | 1, 2 | 110 | slice 1: `writeCommit`, `moveRef`, the `Digest` need; slice 2: the whole-file merge over entries, the folder check |
| kalfa/git/src/ProcessRepository.ts | build | 1, 2 | 110 | slice 1: `hash-object`, `update-ref` with its read-back, `known` asking for a type; slice 2: `merge-tree`, the version gate, the merge pins |
| kalfa/git/src/internal/parse.ts | build | 2 | 20 | `merge-tree -z` output |
| kalfa/git/src/MergeCommit.ts | build | 2 | 55 | new: `mergeCommit`, `UnrelatedHistories`, `SeveralMergeBases` |
| kalfa/git/README.md | build | 1, 2 | docs | the two write calls and the committer setting; merging, the whole-file rule and its differing cases, git 2.40 for merges; "What it never does" no longer says it never writes |
| kalfa/git/GLOSSARY.md | build | 2 | docs | the terms under Records |
| kalfa/git/package.json | tests | 2 | tests | exports `./MergeCommit` |
| kalfa/git/src/History.test-support.ts | tests | 1, 2 | tests | write and move cases; `mergeCases` and the merge model |
| kalfa/git/src/RepositoryTest.ts | tests | 1, 2 | tests | S9, S10, S12 to S15; `settings()` gains a committer |
| kalfa/git/src/Values.test.ts | tests | 1 | tests | G8 |
| kalfa/git/src/Repository.types.test.ts | tests | 1, 2 | tests | T5, T6 |
| kalfa/git/src/MemoryRepository.test.ts | tests | 1, 2 | tests | M6; the memory runner provides `Digest` to the layer |
| kalfa/git/src/ProcessRepository.test.ts | tests | 1, 2 | tests | P5, P9 to P13 |
| kalfa/git/src/StandIn.test-support.ts | tests | 1, 2 | tests | scripts for `hash-object`, `update-ref` and `merge-tree` |
| kalfa/git/src/ProcessRepository.integration.test.ts | tests | 1, 2 | tests | I1 grows with the suite; I6, I7 |
| kalfa/git/src/Package.test.ts | tests | 2 | tests | K1 |
| kalfa/git/src/fixtures/merge-tree-2.40.1.json | tests | 2 | tests | new: `vector:` raw `merge-tree -z` output, clean and conflicted, from a real run |

## Existing tools

- `kalfa/git/src/MergeCommit.ts`: searched isomorphic-git's `merge` (Promises, and its own line merge) and the landed
  `Repository.make`. New, about 20 lines over the store.
- `kalfa/git/src/Commit.ts`, `Name` and `Email` exported: searched the landed file (both exist, unexported) and
  `Settings.ts` (no name rule of its own). Reused, not copied.
- `kalfa/git/src/Repository.ts`, `Raw` and the new errors: searched the landed `make` (it already wraps every raw
  call) and Effect's `ChildProcessSpawner.make`, its model. Grown in place.
- `kalfa/git/src/Settings.ts`, `committer`: searched `kalfa/config` (no committer shape) and decision 0089 (plain
  data). A plain record on the existing `Settings` schema.
- `kalfa/git/src/MemoryRepository.ts`, its new calls: searched the landed `tree` (used for the merged tree), `commit`
  and `add` (used to write a commit), `isBeside` (the ref rule) and `hasFolderOfAnother` (it says only whether, and the
  conflict must name the paths, so the merge has its own small check), and npm for a three-way merge (`node-diff3`,
  `three-way-merge`: both merge by line, which this plan does not do).
- `kalfa/git/src/internal/parse.ts`, its new `merge-tree` reader: searched the landed parser (it splits on newlines
  for objects; `merge-tree -z` needs NUL) and npm (no parser for this output). New, beside the others.
- `kalfa/git/src/ProcessRepository.ts`, its new calls: searched `effect/process` (used as is) and the landed `known`
  check, which grows to ask for a tree as well as a commit.

## Calls taken

- **Several merge bases fail with `SeveralMergeBases`, 75%** (doubt at the top).
- **The caller gives the merge commit's author, 75%** (doubt at the top).
- **A merge whose theirs is already in ours still makes a commit, 75%** (doubt at the top).
- **`/memory` merges by whole file, over each path's mode and blob, 85%.** A line merge would have to match git's own
  line merge to the byte, and it still could not follow renames, so the laws would avoid cases either way. Whole file
  is the level git decides first. Delivery's own tests then see a conflict where git would merge: a stricter
  stand-in, never a looser one.
- **The landed trees code stays as it is, 90%.** The merge reads `Store.trees` and `Store.blobs` and makes its tree
  with `MemoryRepository.tree`; `tree`'s own `path-conflict` refusal is never reached, because the merge checks for a
  file against a folder first and names both paths.
- **The raw call takes three commits, not three trees, 90%.** git 2.40's `merge-tree` refuses trees (run above); 1936
  merges per commit and the helper has commits. It still answers a tree.
- **`writeCommit` sends our own bytes to `hash-object`, not `commit-tree`, 85%.** Both adapters then write one commit
  byte for byte, so one commit has one id. `commit-tree` would need the author and committer in `GIT_*` variables,
  which the pinned environment keeps out, and its strict ident refuses an empty name a read commit can hold.
- **The committer rule, the NUL check and the size check live in `make`, 85%.** One place for every adapter, as the
  ticket and 1935 ask. A NUL in the message fails `NulInMessage` because git refuses to write it (run above); the
  size check keeps every written commit readable by `readCommit`.
- **The committer's offset is `+0000`, 85%.** The bot's commits read the same wherever it runs, and a local zone
  would say where. Not a setting: no caller has asked for a zone.
- **`Signature` refuses a NUL in a name or an email, 80%.** git's own check refuses one in the header; a commit read
  with one is now `UnreadableCommit`, reason `author` or `committer`. The committer setting then reuses the same rule.
- **A conflict is a failure, `Conflict` in the error channel, 80%.** It ends the merge, and rebase (1936) stops at the
  first one; the glossary says a conflict "stops and names the files".
- **The merge needs git 2.40, and the layer still opens on 2.38, 80%.** 1750 says both 2.38 and `--merge-base`, which
  needs 2.40. Gating the one call keeps every read working on Apple's git 2.39.3, and below 2.40 the call refuses with
  `GitTooOld { found, needs: "2.40" }` before it runs anything.
- **A clash between refs is `RefInTheWay`, 80%.** `/memory` must refuse it either way; naming it costs two reads on
  the failure path of `/process` only.
- **`RefMoved` holds only the ref, 80%.** A caller reads the ref again anyway; `/process` would need a racy third
  read to say where it found it.
- **Spans hold how many conflict paths, not the paths, 80%.** A path can hold a person's name or a project name.
- **Is any of this a setting?** The committer is, required with no default, given where the layer is built. Not
  settings: the merge style of `/memory` (a stand-in has one behavior, held by the laws); the `-c merge.*` pins (a
  setting would let config steer a merge, as the landed plan says of the read pins); the offset (above); git 2.40 for
  merges (a fact of git). No new limit: a conflict names every path, as git does, bounded by the time limit.

## Validation

- tests step, per slice: no dependency changes, so no install. Each plain law file alone, `nice -n 15 pnpm exec
  vitest run kalfa/git/src/<file>.test.ts`, red on the missing calls. The `vector:` file is recorded once with real
  git commands outside the repo, naming the git version and the command. The integration file is written and not
  run: the laptop refuses it.
- build step, per slice: each plain law file green, `pnpm format`, `pnpm lint`, and each plant in the laws table run
  once and undone. The integration file is not run on the laptop.
- The lead, per slice: a proof run that reaches `kalfa/git/src/ProcessRepository.integration.test.ts` before the
  review. The lead also runs its own typecheck for T5, T6 and the doc blocks.

## Size

1. Slice 1, write a commit and move a ref: about 251 lines (`Repository.ts` 110, `ProcessRepository.ts` 75,
   `MemoryRepository.ts` 50, `Settings.ts` 12, `Commit.ts` 4). It lands whole: a caller writes a commit with the
   settings' committer and moves a ref safely. 1935 can start after it.
2. Slice 2, merge and the merge commit helper: about 205 lines (`MemoryRepository.ts` 60, `MergeCommit.ts` 55,
   `Repository.ts` 35, `ProcessRepository.ts` 35, `internal/parse.ts` 20). It closes 1934.

About 456 product lines in all, and about 7 agent hours across the steps, 70% sure. The doubt is the tests' share:
the history file is the largest test file and grows a merge model. Priced at about $8 a step at list price: the
landed read plan priced $12 a step for a package five times a slice's size, and the shared test files stay large.
Four steps per slice: tests, build, review and one likely send-back.

Estimate: 8 steps, $65

## New names

- `mergeTrees`, `writeCommit`, `moveRef`: the raw calls the owner named on 1750 ("merge three trees", "write a
  commit", "move a ref only if it still points where the caller expects").
- `mergeBase`, `ours`, `theirs`: git's own words for a three-way merge (`--merge-base`, `--ours`, `--theirs`).
- `mergeCommit`, `MergeCommit`: the glossary's Merge commit.
- `Raw`: 1750's "raw calls".
- `Conflict`: the glossary's word. `NoSuchTree`, as `NoSuchCommit`. `NulInMessage`, `TooLargeToWrite`, `RefMoved`,
  `RefInTheWay`. `UnrelatedHistories`, git's own words ("refusing to merge unrelated histories").
  `SeveralMergeBases`. `GitTooOld.needs`.
- Span names `git.writeCommit`, `git.moveRef`, `git.mergeTrees`, `git.mergeCommit`; attributes `kalfa.git.tree`,
  `kalfa.git.parents`, `kalfa.git.commit`, `kalfa.git.from`, `kalfa.git.merge_base`, `kalfa.git.conflicts`.

## Records

- `kalfa/git/GLOSSARY.md` gains these terms, in slice 2's build:

  **Ours and theirs**:
  The two sides a merge joins. Ours is the line the merge is made on, and becomes the merge commit's first parent;
  theirs is the line that joins it.
  _Avoid_: left and right, source and target, head and base

  **Unrelated histories**:
  Two commits with no merge base. A merge commit of them is refused.
  _Avoid_: orphan, disjoint

- `kalfa/git/README.md`, as the files table says.
- On https://github.com/kamp-us/tea-fabrika/issues/1934, the lead posts, when slice 2 lands, that `/memory` merges by
  whole file and the five cases where it and git differ, as "Where `/memory` and git differ" lists them (an
  acceptance item), and the three calls at the top with their percentages.
- No new decision: the owner's answers on 1750 hold the design, and the calls are cheap to change before the first
  release. No pattern doc yet.

## What this cannot tell us

- Whether a whole-file `/memory` is close enough for Delivery's own tests: it conflicts where git merges by line, so a
  caller's law that needs a by-line merge must run on `/process`.
- How often Delivery meets several merge bases, which decides whether failing them is the right first answer.
- Whether a newer git (2.42 and up) reads a `.gitattributes` from the trees in a bare repository and merges
  differently; the laws run on whatever git CI and the proof run hold, and the vector comes from 2.40.1.
- A path git holds that is not UTF-8: a conflict naming one fails `Unreadable`, and no law draws one.
- How `update-ref` behaves under a held lock from another writer: it fails, and the read-back turns it into
  `GitUnavailable`, but no law makes a lock.
- Whether a time limit that ends a call during `update-ref` leaves the ref moved: git's lock and rename is atomic, so
  it is one or the other, and no law shows which.
- Speed: a merge on a large repository, or a ref move that fails and reads back, starts several git processes. No law
  measures time.

## Open questions

None.

## Findings

1. **1750's resolution asks for two things that do not fit.** It says `/process` runs "the git binary, 2.38 or
   newer" and merges with "`merge-tree --write-tree --merge-base` per commit", but `--merge-base` came in git 2.40.0
   (git's `RelNotes/2.40.0.txt`, line 6), and Apple's git 2.39.3 refuses it with exit 129 (run by hand). This plan
   gates the one call; 1936's rebase meets the same limit.
