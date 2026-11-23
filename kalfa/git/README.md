# @kalfa/git

Read commits, refs and changes from a git repository that has no working copy, write a commit, move a ref and merge trees.
One service, `Repository`, with six read calls and three write calls, a helper that writes a merge commit, two adapters
that answer the calls, and the laws both adapters pass.

It never reads HEAD and never touches a working copy. Only `writeCommit`, `moveRef` and `mergeTrees` change the
repository, and none sends anything to a remote. It imports no other package of its repo, no Node module and no GitHub entry point,
so anything can import it.

## The six calls

```ts
import { Effect, Schema } from "effect";
import * as CommitId from "@kalfa/git/CommitId";
import * as Ref from "@kalfa/git/Ref";
import * as Repository from "@kalfa/git/Repository";

const program = Effect.gen(function* () {
  const repo = yield* Repository.Repository;
  const [main] = yield* repo.readRefs(Schema.decodeSync(Ref.RefName)("refs/heads/main")); // [{ name, commit }] or []
  const branch = Schema.decodeSync(CommitId.CommitId)("d944ba0024149807151b00b4f819c9d16f454bc1");
  const own = yield* repo.walk({ include: [branch], exclude: main === undefined ? [] : [main.commit] }); // Commit[], oldest first
  const bases = yield* repo.mergeBases(branch, branch); // CommitId[], [] = no common history
  const landed = yield* repo.isAncestor(branch, branch); // boolean, true: a commit is its own ancestor
  const patch = yield* repo.patchId(branch, branch); // Option<PatchId>, none: the two commits hold the same files
  return { own, bases, landed, patch };
});
```

- `readCommit(id)` answers the commit, or `NoSuchCommit` when the repository holds no commit with that id.
- `readRefs(under)` answers the ref `under` and every ref below `under/`, sorted by UTF-8 bytes, as git sorts. A ref
  that only shares text (`refs/heads/main-2`) is not below `refs/heads/main`.
- `walk({ include, exclude })` answers every commit an `include` commit reaches that no `exclude` commit reaches,
  oldest first. Each commit comes after its parents.
- `mergeBases(a, b)` answers the best common ancestors, sorted by id.
- `isAncestor(ancestor, descendant)` answers whether `descendant` reaches `ancestor`. A commit is its own ancestor.
- `patchId(from, to)` answers the patch id of the changes from `from`'s files to `to`'s, or none when the two hold
  the same files. A commit's own patch id is `patchId(parent, commit)`. It reads no history, so it answers in a shallow
  repository too.

A call never answers a guess. A shallow repository fails `walk`, `mergeBases` and `isAncestor` with
`HistoryTooShort`. An answer past a limit fails with `TooMany`, `TooLarge` or `DiffTooLarge`, never a cut list. A ref that is
symbolic, or points at a tag, a tree or a blob, fails `readRefs` with `RefNotCommit`.

## Write a commit and move a ref

```ts
const program = Effect.gen(function* () {
  const repo = yield* Repository.Repository;
  const commit = yield* repo.writeCommit({ tree, parents: [parent], author, message: "Add a file\n" }); // Commit
  const none = Option.none<CommitId.CommitId>(); // the ref must not exist yet
  yield* repo.moveRef({ ref: candidate, from: none, to: commit.id }); // void
  return commit;
});
```

- `writeCommit({ tree, parents, author, message })` writes one commit and answers it. Its committer is the setting's
  name and email, at the clock's whole second and offset `+0000`, so a caller never gives one. It moves no ref. It fails
  `NoSuchTree` when `tree` is no tree of the repository, `NoSuchCommit` naming the first parent that is no commit,
  `NulInMessage` when the message holds a NUL byte (git refuses to write it) and `TooLargeToWrite` when the object
  would pass `limits.bytes`, so every commit written can be read back.
- `moveRef({ ref, from, to })` points `ref` at the commit `to`, making the ref or moving it, only if the ref is at
  `from` now. `Option.none()` means the ref must not exist. It is a compare and swap: a ref anywhere else fails
  `RefMoved`, and a ref that git cannot hold beside another ref (`refs/heads/a/b` beside `refs/heads/a`) fails
  `RefInTheWay` naming the other ref. A failed call leaves every ref as it was. A call that ends in `TimedOut` may have
  moved the ref, so read it again. In the git adapter, a symbolic ref whose target is at `from` becomes a plain ref, and its target stays where it was.

## Merge two commits

```ts
import * as MergeCommit from "@kalfa/git/MergeCommit";

const candidate = Effect.gen(function* () {
  const repo = yield* Repository.Repository;
  // ours is the line the merge is made on, theirs the line that joins it. Parents: [ours, theirs].
  const merge = yield* MergeCommit.mergeCommit({ ours: main, theirs: branchTip, author, message: "Merge feature\n" });
  // Nothing has moved yet: the caller points a ref at the commit, only if it is where it read it.
  yield* repo.moveRef({ ref: candidateRef, from: Option.none(), to: merge.id });
  return merge;
});
```

- `mergeTrees({ mergeBase, ours, theirs })` merges the trees of two commits over the tree of a third, and answers the id
  of the merged tree, which the repository then holds. It fails `Conflict` naming each path that could not be combined
  (each once, sorted by UTF-8 bytes, never empty). It reads no history, so a shallow repository answers, and it moves no
  ref.
- `MergeCommit.mergeCommit({ ours, theirs, author, message })` finds the merge base with `mergeBases`, merges, and
  writes the commit with `writeCommit`: parents `[ours, theirs]`, the caller's author and message as given, the
  settings' committer. It fails `UnrelatedHistories` when the two commits share no history, `SeveralMergeBases` (naming
  the bases) on a criss-cross, and `Conflict` when a path cannot be combined. A `theirs` that `ours` already reaches
  still makes a commit, on `ours`' tree. It moves no ref.

The git adapter merges with `git merge-tree --write-tree --merge-base`, which needs git 2.40. On older git `mergeTrees`
fails with `GitUnavailable` whose reason is `GitTooOld { found, needs: "2.40" }` and runs no command; every other call
still works on 2.38 and newer. Each command starts with `-c merge.renames=true -c merge.directoryRenames=conflict -c
merge.renormalize=false`, git's defaults written out, so a repository's own config never steers a merge.

**The memory adapter merges by whole file.** For each path it compares the entries (mode and blob) of the merge base,
ours and theirs: if ours and theirs are the same, that is the answer; if theirs is the merge base's, ours is; if ours is
the merge base's, theirs is; else the path conflicts. A merged path that is a folder of another merged path conflicts
on both. This is the level git decides first, so the memory adapter is stricter than git, never looser. Where the two
differ, a caller's law that needs git's answer runs on the git adapter:

1. Both sides change one file in places that do not overlap: git merges the lines, memory conflicts.
2. One side changes a file's mode and the other its content: git takes both, memory conflicts.
3. Renames: one side moves a file while the other changes it, or adds a file to a folder the first side moved. git
   follows the rename, memory sees a change against a delete.
4. A file on one side where the other side has a folder: git moves the file to a new name and conflicts, memory
   conflicts on both paths and writes no tree.
5. A `.gitattributes` file with a merge driver or text rules: a newer git may read it from the trees. Memory holds no
   submodules either.

## Two adapters

- `@kalfa/git/memory` keeps a store as a plain value of commits, trees, blobs, refs and shallow commits. A commit's id
  and a tree's id are computed as git computes them, so the same commit with the same files has the same id here and
  in a real repository.
- `@kalfa/git/process` runs the git binary (2.38 or newer) on a bare repository, through Effect's
  `ChildProcessSpawner`. It writes a commit with `hash-object -t commit -w --stdin`, from the same bytes the memory
  adapter hashes, so one commit has one id in both, moves a ref with `update-ref --no-deref`, and merges with
  `merge-tree` (git 2.40 for that call only). The app provides the Node spawner at the top. Every command runs with `--git-dir`, with no
  replacement objects, no hooks and no config of the machine, and with only `PATH` and a pinned set of variables.

```ts
ProcessRepository.layer({ path: "repo.git", settings });
// Layer<Repository, GitTooOld | NoRepository | GitUnavailable | TimedOut, ChildProcessSpawner>
MemoryRepository.layer(store, settings);
// Layer<Repository | MemoryStore, never, Digest>
```

## Commits hold trees

A commit has a `tree`, the id of its files, as git writes it on the commit's first line. `readCommit` and `walk` answer
it. In the memory store, `MemoryRepository.tree(store, files)` puts files in a store and answers the store and the
tree's id. `files` is a `Map` from a `Tree.Path` to a `File`, a `Tree.Mode` and its bytes, which are kept exactly and
never read as text. `MemoryRepository.commit` takes that `tree` among its fields.

```ts
const files = new Map([
  [path("a.b"), { mode: mode("100644"), content: utf8("x\n") }],
  [path("a/c"), { mode: mode("100644"), content: utf8("y\n") }],
  [path("a0"), { mode: mode("120000"), content: utf8("a.b") }], // a link: its content is its target
]);
const { store, id: tree } = yield* MemoryRepository.tree(MemoryRepository.empty, files); // Effect<..., BadStore, Digest>
const made = yield* MemoryRepository.commit({ tree, parents: [], author, committer, message });
```

`Tree.Path` refuses an empty part, `.` and `..`, and every name git's `fsck` reads as `.git` (any
letter case, trailing spaces and dots, a `:` stream, the characters an HFS volume ignores, `git~1`). `tree` fails
`BadStore` with `path-conflict` when one path is a folder of another, and `add` fails with `missing-tree` when the
store lacks a commit's tree. `empty` already holds git's empty tree. A host may refuse a tree for another reason, such as a
link at `.gitmodules`: that check is not here.

## Patch ids

`patchId` names a change by the lines it adds and removes. Two ids are equal when the changes have the same paths and the
same lines added and removed, each line with its own end, and the same mode changes. A mode counts only where it is new,
gone or changed. Where a line sits, the lines around it and the blob ids of a text file do not count, so one edit gives one
id on any base. Whitespace counts, and so does a line's end: `x` and `x\n` are two edits. A binary file counts by its
blobs before and after, and a file that changes kind (a file made a link) counts once. The names of paths are compared by
their UTF-8 bytes.

```ts
const edit = yield* repo.patchId(base, tip); // Option<PatchId>: 40 lowercase hex, or none for no change
```

An id compares only with ids the same adapter gave. `@kalfa/git/process` takes it from git's own `patch-id --verbatim`,
fed the output of `diff-tree -p -U0 --no-renames`. `@kalfa/git/memory` finds the lines with its own diff and hashes the
change, so its ids never equal git's. A change that git calls a binary file (a NUL byte in the first 8000 bytes) is one
here too.

Two limits keep a call small: `files` and `diff`. Both are checked before any content is read, in this order: the commits
exist (`NoSuchCommit`), the changed files are at most `limits.files` (`TooMany` with `limit: "files"`), and their
content, each changed file's bytes before and after, is at most `limits.diff` (`DiffTooLarge`). A diff over a limit
fails and is never cut. A submodule counts as a changed file of no bytes.

## Settings

The limits are required and have no default. The app gives each one where it builds the layer.

```toml
[limits]
commits = 1000
refs = 1000
bytes = 1000000
files = 1000
diff = 10000000
time = "10 seconds"

[committer]
name = "Delivery Bot"
email = "bot@example.test"
```

`commits` is the most commits a walk or a merge-base answer holds. `refs` is the most refs one `readRefs` answer
holds. `bytes` is the most bytes one commit object holds, to read or to write, and the most stderr an error keeps.
`files` is the most files one diff names, and `diff` is the most bytes of file content one diff compares. `time` is the
longest one call may take. `committer` is the name and email every commit the package writes names as its
committer. A name takes what a signature's name takes (no `<`, `>`, line break or NUL) and an email what its email
takes. A setting's value is plain data, so the time is duration text, which the package decodes. When a
call runs out of time, git is asked to stop, and a git that ignores that is killed a fixed five seconds later, so the
call always ends.

## The laws

`@kalfa/git/test` holds `RepositoryTest.suite`, the laws every adapter passes, with its `Subject`, `Seeded` and
`SuiteOptions` types and `settings`. `@kalfa/git/test/History` holds the `History` and `Node` types and the `textureArb`
and `shapes` that draw the histories. A new adapter writes a `Subject` that seeds a history into its own kind of store,
with each node's `files` in each commit's tree, answers each commit's tree id in `Seeded.trees`, and runs
`RepositoryTest.suite("name", subject, { runs, timeout })` in its own test file. `@effect/vitest` and `vitest` are
optional peers, needed only by `/test`.

## What it never does

It has no working copy and no HEAD. It writes only the one commit and the one ref a caller asks for, and sends nothing
to a remote. It imports no Node module and no package of its repo. It puts no message, name, email, path, line or file
content in a span. The range's patch id, the diff itself, reading a file, rebase, squash, fetch and push come in later
tickets of this package.
