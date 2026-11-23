Approved by the lead agent, builds issues 1750, 1935; body 869cf2e6975f
Plancheck-Version: 3

# Plan: @kalfa/git, read a file at a commit and commit an edit, with no working copy (ticket 1935)

This is the kalfa packages (`kalfa/`), new work. It is not today's frozen version and not `next/`. The ticket is
https://github.com/kamp-us/tea-fabrika/issues/1935, a GitHub issue, so the first pull request says `Refs #1935`, the
last `Closes #1935`, and neither carries a `fabrika close ticket` line. Two slices, each its own pull request that
branches from main once the one under it has landed. They build on `@kalfa/git` as tickets 2012 (trees,
https://github.com/kamp-us/tea-fabrika/pull/2013), 1934 (write a commit and merge,
https://github.com/kamp-us/tea-fabrika/pull/2015 and https://github.com/kamp-us/tea-fabrika/pull/2025) and 1933 (diff,
https://github.com/kamp-us/tea-fabrika/pull/2016 and https://github.com/kamp-us/tea-fabrika/pull/2037) left it.

```ts
// The whole idea, a sketch. Reconciliation reads its config at main, and adopts a live value as a new commit.
import * as CommitEdit from "@kalfa/git/CommitEdit";
import * as Repository from "@kalfa/git/Repository";

const adopt = Effect.gen(function* () {
  const repo = yield* Repository.Repository;
  const raw = yield* repo.readFile(main, path(".kalfa/kalfa.toml"));    // Option<Uint8Array>; none: git proved no file (slice 1)
  const text = yield* repo.readText(main, path(".kalfa/kalfa.toml"));   // Option<string>, or NotUtf8 (slice 1)
  const changes = new Map([[path(".kalfa/kalfa.toml"), utf8(next)], [path("old.toml"), "absent" as const]]);
  const tree = yield* repo.editTree(main, changes);                      // TreeId; the same tree when nothing changes (slice 2)
  // One parent, the caller's author and message, the settings' committer. NoChange when the edit changes nothing (slice 2).
  const commit = yield* CommitEdit.commitEdit({ parent: main, changes, message: "Adopt the live value\n", author });
  return commit; // nothing moved: the caller moves a ref with moveRef, only if it is where it read it
});
```

## Doubts, read first

Two calls are under 80%. Each lean is taken and stays here so a reader sees the doubt.

- **A new required limit, `limits.blob`, 75%.** `readFile` must fail on a file over a size limit, and the ticket does
  not say which limit. This plan adds `blob`, the most bytes of one file `readFile` reads or `editTree` writes,
  required with no default, beside `bytes` (one commit object) and `diff` (one diff's content). The other choice was
  to stretch `bytes` to cover a file too, which saves a setting but ties two limits together. What would settle it: the
  owner's word. Changing it later is one rename in `Settings.ts` and the app's settings.
- **A link above the path fails, 75%.** `readFile(c, "a/b")` where `a` is a link fails `NotAFile { path: "a", holds:
  "link" }`, never none. git's tree has no `a/b`, but a checkout would reach a file through the link, so "no file" would
  be a guess, and a failure is never an empty answer (the owner's rule on 1750). A path below a file is still none: git
  can hold nothing there. What would settle it: Reconciliation's first real use, or the owner's word.

## What changes, in one paragraph

Slice 1 adds the raw call `readFile(commit, path)` to both adapters, `readText`, which `Repository.make` writes once
over it as it writes `rangePatchId`, one required limit `blob`, the error `FileTooLarge`, and a field `holds` on the
landed `NotAFile`, so one error says a path holds a folder, a link or a submodule. A small shared rule,
`internal/lookup.ts`, says what a path holds, so both adapters refuse the same paths. `/process` walks the tree one
folder at a time with `ls-tree -z`, and never passes a path to git. Slice 2 adds the raw call `editTree(base,
changes)`, the error `PathInTheWay`, the type `Edit`, and the helper `CommitEdit.commitEdit`, written once over the
service as `MergeCommit.mergeCommit` is, which fails `NoChange` and writes nothing when the edit changes nothing.
`/process` makes the tree with `git mktree`, one folder at a time, deepest first, from the folders `ls-tree -z` printed;
it uses no temporary index (the ticket asks this plan to say which). Out of scope: rebase (1936), squash (1937),
fetch and push (1938 to 1940), a mode or a link written by an edit, and sha-256 repositories.

## Searched first

- The ticket and its parent https://github.com/kamp-us/tea-fabrika/issues/1750 with every comment, the owner's answer
  on https://github.com/kamp-us/tea-fabrika/issues/1869 (the two calls, the helper, "absent", `NoChange`, and the
  sketch's placeholder error names), and the closed groundwork 2012.
- `kalfa/git/README.md` (both adapters, "where the two adapters may differ", the settings), `kalfa/git/GLOSSARY.md`,
  `kalfa/AGENTS.md`, `kalfa/reconciliation/GLOSSARY.md` (**Absent**: "a desired state that says a managed item should
  not exist"), and the landed plans `.kalfa/quests/kalfa-git-trees-PLAN.md`, `.kalfa/quests/kalfa-git-merge-PLAN.md`
  and `.kalfa/quests/kalfa-git-diff-PLAN.md`, with the bodies of pull requests 2016 and 2037.
- Every product file in `kalfa/git/src/` as built on main: `Repository.ts` (`Raw` omits `writeCommit` and
  `rangePatchId`; `make` wraps each call and writes `rangePatchId` once), `MergeCommit.ts`, `MemoryRepository.ts`
  (`Store.trees` flat by path, `Store.blobs`, `entriesTree`, `hasFolderOfAnother`, `mergeTrees` adding its tree with
  `Cell.update`), `ProcessRepository.ts` (`start`, `PINNED`, the runner, `known`, `blobSizes`, `patchBytes` and its two
  `-c` pins), `internal/parse.ts` (`checks`, `lossless`, `changes`, `isGitlink`), `internal/object.ts`, `Tree.ts`,
  `Settings.ts`; and the tests `RepositoryTest.ts` (S9 spans, S10 keys and the read-then-write order of its fingerprint
  check), `History.test-support.ts` (`FileSpec`, `treeClasses`, `editCarrier`), `ProcessSeed.test-support.ts` (its
  fingerprint is `for-each-ref` and `count-objects -v`), `StandIn.test-support.ts`, `ProcessRepository.integration.test.ts`.
- Law ids in use, from the test names in `kalfa/git/src` (the law id check in `pnpm lint` passes on main):
  G1 to G9, I2 to I9 (I1 is the suite on real git), K1 to K4, M1 to M7, P1 to P18, S1 to S24 with S11b, T1 to T6. This
  plan's new ids start after them: S25 to S35, P19 to P22, I10 to I12, T7.
- `rg -il` over `.kalfa/decisions`, `.kalfa/glossary`, `.kalfa/patterns`, `.kalfa/runbooks` and every kalfa glossary
  for "readFile|read a file", "editTree|commitEdit", "mktree|index", "absent", "limits". Only the hits above bear on
  this. The pattern `.kalfa/patterns/settings.md` is `next/`'s and does not apply here.
- Installed versions in the lockfile: `effect` and `@effect/vitest` 4.1.3, `vitest` 5.0.5. The APIs used are the ones
  the package already uses: `Effect.fn`, `Schema.TaggedError`, `Result`, `Option`, `effect/crypto/Digest`.
- Facts from git 2.40.1, run by hand in a scratch folder outside the repo with no user or system config. Not a test;
  the tests step records the `vector:` file again with its own run.
  - `ls-tree -z <commit-or-tree>` with no path argument prints `<mode> <type> <id>\t<name>\0` per entry, modes as six
    digits (`040000` for a folder, `160000 commit` for a submodule), names verbatim, a byte `0xff` included.
  - A path argument is a pathspec, so its magic acts: `ls-tree <c> -- :foo` printed the file `foo`, not the file
    `:foo`. `:(literal):foo` printed `:foo`. So `/process` gives `ls-tree` no path at all.
  - `mktree -z` reads that same line form, sorts in git's tree order (`a.b`, the folder `a`, `a0`), keeps a name of
    any bytes as given, writes the empty tree for empty input (`4b825dc...`), refuses a name with `/` (exit 128), a
    missing object (exit 128) and an object of the wrong type (exit 128), allows a submodule's commit to be missing,
    and does not refuse two entries with one name. Fed `ls-tree -z` output unchanged it gave back the same tree id.
  - `hash-object -t tree` runs git's fsck on the tree in 2.40.1 ("object fails fsck: hasDotgit"), so `fsck.*` config
    can change what it accepts. `mktree` runs no fsck.
  - With `core.autocrlf=true`, `core.eol=crlf`, `core.safecrlf=true`, `core.attributesFile` and `info/attributes`
    marking every file `text eol=crlf filter=up`, `filter.up.clean` and `.smudge` set, `core.bigFileThreshold=1`,
    `core.precomposeUnicode=true` and `core.ignoreCase=true` in the bare repository's config:
    `hash-object -t blob --stdin`, with and without `--no-filters`, gave the id of the bytes as given; only `--path`
    changed it. `cat-file blob` printed the stored bytes; only `cat-file --filters --path` converted them. `ls-tree -z`
    printed the same bytes as with no config.

## How others do it

- **git's plumbing** is the known way with no working copy: read a file with `cat-file blob <commit>:<path>` or
  `ls-tree` then `cat-file blob <id>`; write content with `hash-object -w`, a tree with `mktree` or with `read-tree`
  into a temporary index, `update-index --index-info` and `write-tree`; then a commit. Run by hand above.
- **GitHub's Git Data API** makes a commit with no checkout from blobs, a new tree built on a `base_tree` with entries
  replaced or removed (`sha: null` removes one), a commit, then a ref update. `editTree` is that tree call; "absent" is
  its removal. From memory, not fetched.
- **libgit2** reads with `git_tree_entry_bypath`, which walks one folder at a time, and edits with
  `git_tree_create_updated(base, updates)`, upserts and removals applied to a base tree. **JGit** reads with
  `TreeWalk.forPath`. **isomorphic-git**'s `readBlob({ oid, filepath })` walks the trees. From memory, not fetched.
- **Gitaly** (GitLab's git service) answers a file at a revision, and `UserCommitFiles` makes a commit from a list of
  create, update and delete actions on the server, with no worktree. From memory, not fetched.
- **Effect**: `Repository.make` already writes `rangePatchId` once over two raw calls; `readText` takes that shape.
  `MergeCommit.mergeCommit` is a helper over the public service; `commitEdit` takes that one, so the committer rule
  stays in `make`'s `writeCommit`.
- **Elm and Erlang/OTP** have nothing to say here: no state lives between calls.

## The shape

### Slice 1: read a file, and read it as text

```ts
// kalfa/git/src/Settings.ts: Limits gains one required key, no default.
//   blob: Count   the most bytes of one file that readFile reads or editTree writes

// kalfa/git/src/Repository.ts, a sketch of what slice 1 adds.
// A path holds no file. `holds` says what it holds. `path` is a Tree.Path for readFile and editTree, and the raw text
// git printed for a submodule in a diff, so it stays a string.
export class NotAFile extends Schema.TaggedError<NotAFile>()("NotAFile", {
  path: Schema.String,
  holds: Schema.Literals(["folder", "link", "submodule"]),   // new; diff gives "submodule"
}) {}
// A file holds more than limits.blob: too large to read, or, given to editTree, too large to read back.
export class FileTooLarge extends Schema.TaggedError<FileTooLarge>()("FileTooLarge", { path: Path, most: Schema.Int }) {}

// The service gains:
readonly readFile: (commit: CommitId, path: Path)
  => Effect.Effect<Option.Option<Uint8Array>, NoSuchCommit | NotAFile | FileTooLarge | Fails>;
readonly readText: (commit: CommitId, path: Path)                  // make writes it once; Raw leaves it out
  => Effect.Effect<Option.Option<string>, NotUtf8 | NoSuchCommit | NotAFile | FileTooLarge | Fails>;
export type Raw = Omit<Repository["Service"], "writeCommit" | "rangePatchId" | "readText"> & { /* writeCommit as now */ };
```

```ts
// kalfa/git/src/internal/lookup.ts, a sketch. The one rule both adapters use for what a path holds.
export type Kind = "file" | "folder" | "link" | "submodule";       // "file" is mode 100644 or 100755
export type At = (path: string) => Kind | undefined;               // what the base tree holds at a path; each adapter gives one
// readFile's rule, part by part from the top: nothing at a part, or a file above the last part, is none; a link or a
// submodule above the last part fails NotAFile naming that part; at the last part a folder, a link or a submodule
// fails NotAFile naming the path; a file is the answer.
export const find: (path: Path, at: At) => Result.Result<"file" | "none", NotAFile>;
```

- **readFile(commit, path)** answers the file's bytes, kept exactly, or none when git proved no file is there. The
  checks run in this order, each before any content is read: the commit is one the store holds (`NoSuchCommit`), then
  `find` (`NotAFile`, or none), then the file's size is at most `limits.blob` (`FileTooLarge`). It reads no history, so
  it answers in a shallow repository. An empty file is `Some` of no bytes, never none. The bytes are the caller's: the
  memory adapter answers a copy.
- **readText(commit, path)** is `readFile` and then UTF-8 with no replacement: a byte that is not UTF-8 fails
  `NotUtf8` naming the path (the landed error). A BOM, a CR and a NUL byte are text and are kept. None stays none. It is
  one call: one span and one time limit, and the raw `readFile` is not wrapped again.
- **/memory**: the commit's flat file map gives `At`: a path's entry (`120000` is a link, else a file), else a folder
  when some path starts with it and `/`, else nothing. It never says submodule.
- **/process**: `known` on the commit; then `ls-tree -z <commit>` for the top folder and `ls-tree -z <tree id>` for
  each folder on the path, top down, stopping at the first part that is missing or is not a folder; `At` reads those
  listings, matching a part to a listed name by its UTF-8 bytes, exactly; `find`; for a file, one
  `cat-file --batch-check` on its blob id for the size (the landed `blobSizes`), then `cat-file blob <id>`, whose bytes
  must be exactly that many (else `GitUnavailable` reason `Unreadable`). No path ever reaches git's command line or
  stdin, so no pathspec magic, quoting or path config can act.

### Slice 2: edit a tree, and commit the edit

```ts
// kalfa/git/src/Repository.ts, a sketch of what slice 2 adds.
// The files an edit replaces or removes, by path: new bytes, or "absent", Reconciliation's word for "should not exist".
export type Edit = ReadonlyMap<Path, Uint8Array | "absent">;
// A file cannot be made at `path` because `other` is in the way: a file the edit keeps, or a file the edit adds, sits
// where `path` needs a folder. A link or a submodule there fails NotAFile first, by find.
export class PathInTheWay extends Schema.TaggedError<PathInTheWay>()("PathInTheWay", { path: Path, other: Path }) {}
// The service and Raw gain:
readonly editTree: (base: CommitId, changes: Edit)
  => Effect.Effect<TreeId, FileTooLarge | NoSuchCommit | NotAFile | PathInTheWay | Fails>;

// kalfa/git/src/internal/lookup.ts gains editTree's rule over the same At:
export const check: (changes: Edit, at: At) => Result.Result<void, NotAFile | PathInTheWay>;
```

```ts
// kalfa/git/src/CommitEdit.ts, a sketch, written once over the service as MergeCommit.ts is.
export class NoChange extends Schema.TaggedError<NoChange>()("NoChange", {}) {}
export const commitEdit: (edit: {
  readonly parent: CommitId;
  readonly changes: Repository.Edit;
  readonly message: string;
  readonly author: Commit.Signature;
}) => Effect.Effect<
  Commit.Commit,
  | NoChange | NoSuchCommit | TooLarge | UnreadableCommit                       // readCommit(parent)
  | FileTooLarge | NotAFile | PathInTheWay                                     // editTree
  | NulInMessage | TooLargeToWrite | NoSuchTree | GitUnavailable | TimedOut,  // writeCommit
  Repository.Repository
>;
```

- **editTree(base, changes)** answers the tree of `base`'s files with each change applied, which the repository then
  holds. Nothing else changes: every other path keeps its entry, byte for byte. A replaced file keeps its mode; a new
  file is `100644`. A folder left with no files goes, as git has no empty folder, and an edit that removes every file
  gives git's empty tree. An edit that changes nothing gives back `base`'s own tree. It moves no ref and reads no
  history. The checks run in this order, and nothing is written before the last passes:
  1. in `make`, before the adapter, as `writeCommit`'s checks are: each new content is at most `limits.blob`
     (`FileTooLarge` naming the first such path by UTF-8 bytes), so every file written can be read back;
  2. `base` is a commit the store holds (`NoSuchCommit`);
  3. `find` on each changed path, in path byte order: a path `readFile` refuses, `editTree` refuses too (`NotAFile`),
     removal included, so a link is never replaced or removed;
  4. in the result, no new file sits below a file the edit keeps, or below another new file
     (`PathInTheWay` naming the first such new path by bytes and the shortest path in its way). A file removed and a file
     added below it, a file made a folder, is allowed.
- **"absent" on a path that holds nothing is no change.** Absent is a state ("should not exist"), not an action that
  needs something to remove.
- **/memory**: the base's flat map with each change applied, the shared `check`, the id from the landed
  `entriesTree`, then one `Cell.update` adds the tree's map and the new blobs (copied) to the store, as `mergeTrees`
  does.
- **/process**, how it makes the tree: `known`; `ls-tree -z` of every folder on a changed path that the base has, top
  down; the shared `check`; then `hash-object -t blob -w --no-filters --stdin` for each new content, in path byte
  order; then, deepest folder first, `mktree -z` on that folder's entries: each entry no change touches is passed as
  the exact bytes `ls-tree` printed, a changed or new file as `<mode> blob <id>\t<name>`, a changed folder with its new
  id, an emptied folder left out. A folder whose entries come out the same keeps its id and is never written again, so
  an edit that changes nothing runs no `mktree`. The top folder's id is the answer.
- **Why `mktree`, and not a temporary index or `hash-object -t tree`.** A temporary index needs a file and a
  `GIT_INDEX_FILE` per call, reads the whole tree of the commit, and reads index config (`core.ignoreCase`,
  `index.*`, `core.splitIndex`). `hash-object -t tree` would reuse the memory adapter's bytes, but it runs git's fsck in
  2.40.1, which `fsck.*` config can steer, and it would need every name as text, so a name that is not UTF-8 could not
  pass through. `mktree` reads no config for its output, sorts as git does, keeps each name's bytes, and checks every
  object it names exists.
- **commitEdit({ parent, changes, message, author })**: `readCommit(parent)` for its tree, then `editTree`, then
  `NoChange` when the tree is the parent's (nothing written: no blob is new, no folder was rewritten), else
  `writeCommit({ tree, parents: [parent], author, message })`, whose committer `make` sets from the settings and the
  clock. So `NoChange` comes before `writeCommit`'s `NulInMessage`. It moves no ref. A refusal after `editTree` (a NUL
  in the message) can leave the edit's unreachable objects behind, as a refused merge commit can.

### What git prints, and the config that could change it

Each command these calls run, every config key or variable found that could change what it prints, and what pins it.
The global pins (`--no-replace-objects`, no hooks, no user or system config, `PINNED`) already hold for all of them.

| Command | Could change what it prints | Pinned on the call |
|---|---|---|
| `ls-tree -z <tree-ish>` | `core.quotePath` (quoting), `core.precomposeUnicode`, `core.ignoreCase`, pathspec magic and `GIT_LITERAL_PATHSPECS`, `GIT_GLOB_PATHSPECS`, `GIT_ICASE_PATHSPECS`: each acts only on quoting or on path arguments | `-z`, and no path argument is ever given |
| `cat-file --batch-check` | none: it prints the stored object's type and size | nothing more |
| `cat-file blob <id>` | `core.autocrlf`, `core.eol`, `core.safecrlf`, `filter.<driver>.smudge`, `core.attributesFile`, `info/attributes`, `core.bigFileThreshold`: each acts only with `--filters`, `--textconv` or `--path` | none of those three flags is given |
| `hash-object -t blob -w --stdin` | the same keys, through `--path` or a file read from disk, and `filter.<driver>.clean` | `--no-filters`, and no `--path` |
| `mktree -z` | none: it reads no config for the tree it writes | `-z`, and no `--missing`, so every object it names must exist |

I10 sets every key in the table on a bare repository and holds each call to the answer it gives without them.

### Where the two adapters may differ

The shared laws draw none of these, and the README names them beside the landed cases:

1. **Submodules.** The memory adapter holds none. `readFile` at or below one, and an edit at one, fail `NotAFile` with
   `holds: "submodule"` on git, and an edit beside one keeps its entry (I11).
2. **Names that are not UTF-8.** A `Path` is text, so the memory adapter holds none; on git a folder that an edit
   rewrites keeps such a name byte for byte (I12).
3. **Trees git wrote in an odd form** (a zero-padded mode, an unsorted folder, from old tools): `/process` keeps a
   folder no change touches as it is, and writes a changed folder again in git's normal form. The memory adapter holds
   only normal trees.

### The spans (decision 0063)

| Call | Span | Attributes |
|---|---|---|
| readFile | `git.readFile` | `vcs.ref.head.revision` = commit, `kalfa.git.found` = whether there is a file, `kalfa.git.bytes` = its size, only when there is one |
| readText | `git.readText` | the same as `readFile` |
| editTree | `git.editTree` | `vcs.ref.base.revision` = base, `kalfa.git.changes` = how many changes, `kalfa.git.tree` = the tree made |
| commitEdit | `git.commitEdit` | `vcs.ref.base.revision` = parent, `kalfa.git.changes` = how many changes, `kalfa.git.commit` = the commit made |

No path and no content is ever an attribute: a path can hold a person's name and a file can hold anything.

## One value traced: Reconciliation adopts a live value

The store: commit `M` on `refs/heads/main`, tree `R0`, with `.kalfa/kalfa.toml` = `[limits]\nfiles = 10\n` (21 bytes,
mode 100644, blob `B1`, in folder tree `T1`), `README` and an executable `bin/run`. Limits: `blob` 1000000. Settings'
committer: the bot, the clock at second 1700000000.

1. Slice 1: `repo.readText(M, ".kalfa/kalfa.toml")` on `/process`: `cat-file --batch-check` says `M` is a commit;
   `ls-tree -z M` lists `.kalfa` as `040000 tree T1`; `ls-tree -z T1` lists `kalfa.toml` as `100644 blob B1`; `find`
   says file; `cat-file --batch-check` says `B1` is 21 bytes; `cat-file blob B1` prints 21 bytes; they decode as UTF-8.
   Answer `Some("[limits]\nfiles = 10\n")`. One span, `git.readText`, with `vcs.ref.head.revision` = M,
   `kalfa.git.found` = true and `kalfa.git.bytes` = 21.
2. `repo.readFile(M, ".kalfa")` fails `NotAFile { path: ".kalfa", holds: "folder" }` after the two listings.
   `repo.readFile(M, ".kalfa/other.toml")` answers none after the same two listings and runs no `cat-file blob`.
3. Slice 2: `commitEdit({ parent: M, changes: { ".kalfa/kalfa.toml": "[limits]\nfiles = 20\n" }, author, message })`:
   `readCommit(M)` gives tree `R0`. `editTree`: `make` checks 21 bytes against the limit; `known`; `ls-tree -z M`;
   `ls-tree -z T1`; `check` passes; `hash-object -t blob -w --no-filters --stdin` prints `B2`; folder `.kalfa` gets
   `100644 blob B2\tkalfa.toml` (the mode kept) through `mktree -z`, which prints `T2`; the top folder passes the
   `README` and `bin` lines as `ls-tree` printed them, with `040000 tree T2\t.kalfa`, through `mktree -z`, which prints
   `R1`. `R1` is not `R0`, so `writeCommit` writes `C1` with parents `[M]`. No ref moved. Spans: `git.commitEdit` with
   `kalfa.git.changes` = 1 and `kalfa.git.commit` = C1, around `git.readCommit`, `git.editTree` and `git.writeCommit`.
4. The same commitEdit with content `[limits]\nfiles = 10\n`: `hash-object` prints `B1`, the entry `.kalfa` already
   has, so `.kalfa` and the top folder keep their ids and no `mktree` runs; the tree is `R0`, and commitEdit fails
   `NoChange`. `count-objects` is as it was.
5. `/memory`, seeded with the same files, answers the same text, the same `R1` and the same `C1`: tree ids and commit
   ids are git's in both.
6. With `limits.blob` 20, step 1 fails `FileTooLarge { path, most: 20 }` before `cat-file blob` runs, and step 3 fails
   `FileTooLarge` in `make` before any command runs.

## What fact is lost if not recorded now

- **How `/process` makes a tree, and why** (`mktree` over the `ls-tree` lines, no index, no `hash-object -t tree`).
  The ticket asks for it, and the next person to touch it would otherwise try the index and meet its config. The
  README says it, and so does this plan.
- **Which config keys can change each command's output.** The diff pull request learned in review that a repository's
  own config can change what git prints. The table above is the list for these commands, and I10 holds it.
- Nothing else: a file read and a tree made are derived from the repository and can be made again.

## Generators

The generators live in `kalfa/git/src/History.test-support.ts`, beside the landed tree classes and `editCarrier`. A
read case is a commit of the history and a path; an edit case is a base commit, an `Edit`, and either the node of the
history whose files are the model's answer (so the law reads its tree id from `Seeded.trees`) or the failure the model
names. Each class below is checked in every run, made from the run's drawn value, as the landed classes are.

Reads (slice 1):

- (a) every file of every tree class 2013 draws reads back: both file modes, an empty file, a NUL byte, bytes that are
  not UTF-8, CRLF, past 1000 bytes, the same bytes at two paths, the sort traps (`a.b`, `a/b`, `a-b`, `a0`), names past
  U+024F and from U+E000 to U+FFFF, and `__proto__` as a file and as a folder.
- (b) no file there: a path no tree has; a name that only shares its start or its end with a file (`a` beside `a.b`,
  `a-b` and `a0`, and `b` beside `ab`); a path below a file; a path in a folder that does not exist; a commit with no
  files.
- (c) a folder at the path, at the top and three folders deep.
- (d) a link at the path, and a path below a link, which names the link.
- (e) a file of exactly `limits.blob` bytes, and one of one byte more.
- (f) an id the store lacks, and a tree's or a blob's id given as the commit.
- (g) text: UTF-8 with a BOM, a CR and a NUL kept; latin-1 bytes; a UTF-8 sequence cut short at the end of the file.
- (h) a shallow store.
- (i) a submodule at the path and above it, on git only.
- (j) the caller changes the bytes `readFile` answered, or (slice 2) the bytes it gave `editTree`, after the call.

Edits (slice 2):

- (k) edits that change: one file replaced; several files in several folders in one call; a new file in a new folder
  three deep; a file removed; the last file of a folder removed, so the folder goes; every file removed, the empty tree;
  a file made a folder (the file removed and a file below it added).
- (l) no change: an empty edit; a file, also an executable one, replaced with its own bytes; "absent" on a path that
  holds nothing.
- (m) modes: an executable file replaced stays `100755`; a new file is `100644` beside an executable one.
- (n) refused: a changed path that is a folder; a link replaced; a link removed; a change below a link; a new file below
  a file the edit keeps; two new files, one below the other.
- (o) new content of exactly `limits.blob` bytes, and of one byte more.
- (p) the order of the checks: content too large at a folder's path (`FileTooLarge`); an unknown base with a change at
  a folder (`NoSuchCommit`); a change at a folder beside a new file in the way (`NotAFile`); two folders changed (the
  first by bytes named); two new files in the way (the first by bytes named).
- (q) the sort traps among the changed names of one folder (`a.b`, `a/b`, `a-b`, `a0`) and `__proto__`.

The edit commit (slice 2):

- (r) a real change: one parent, the tree `editTree` gives, the author and the message byte for byte through the landed
  signature and message classes, the settings' committer at the clock's second.
- (s) no change: `NoChange` and nothing written; and no change with a NUL in the message, which is still `NoChange`.
- (t) refusals passed on: an unknown parent with content too large (`NoSuchCommit`, read first); a real change with a
  NUL in the message (`NulInMessage`); a refused edit (`NotAFile`).

On git and the stand-in only:

- (u) a `cat-file blob` that prints fewer bytes than its size, or more.
- (v) listings: names with a tab, a line break, a space, a backslash, a double quote and bytes that are not UTF-8, each
  mode and type `ls-tree` prints, and a listing cut at any byte or bent (a lost NUL, a short id, a missing tab).
- (w) a bare repository whose config and `info/attributes` set every key of the config table.
- (x) a folder an edit rewrites that also holds a name that is not UTF-8, or a submodule.

## Laws

Laws use `it.effect.prop` from `@effect/vitest` 4.1.3 with Effect's own `Arbitrary`, as the landed laws do. S25 to S33
are in `RepositoryTest.suite`, so they run on `/memory` in `MemoryRepository.test.ts` (100 runs) and on `/process` in
`ProcessRepository.integration.test.ts` (10 runs, I1). S34 and S35 are in the commit edit suite, run the same two ways,
as the merge commit suite is.

| Law | Kind (lint, type or test?) | Generator | Plant | Where |
|---|---|---|---|---|
| G5, settings, now with `blob` (slice 1): a required whole count of 1 or more; limits without it do not decode | test | Effect Arbitrary: limitsArb | give `blob` a default: red; accept `blob: 0`: red | kalfa/git/src/Values.test.ts |
| S25, read a file (slice 1): every path of every commit's tree reads back as its bytes, exactly; each path of the no-file classes is none, never `[]` bytes and never an error; an empty file is `Some` of no bytes. memory 100 runs, process 10 | test | Effect Arbitrary: textureArb | answer none for an empty file, (a) red; pass the bytes through a UTF-8 decode and encode, (a) red; match a listed name by its start, (b) red; answer the file above for a path below a file, (b) red | kalfa/git/src/RepositoryTest.ts |
| S26, not a file (slice 1): a folder fails `NotAFile` with `holds: "folder"` naming the path; a link fails with `holds: "link"`; a path below a link fails naming the link. memory 100 runs, process 10 | test | Effect Arbitrary: textureArb | delete the folder check, so a folder answers none, (c) red; read a link's target as its content, (d) red; answer none below a link, (d) red | kalfa/git/src/RepositoryTest.ts |
| S27, the blob limit never cuts (both slices): a file of exactly `limits.blob` bytes reads and is written; one more fails `FileTooLarge` naming it, from `readFile`, `readText` and `editTree`, and the refused edit leaves the fingerprint as it was. memory 100 runs, process 10 | test | Effect Arbitrary: textureArb | delete the read's size check, (e) red; count `>=` for `>`, (e) red; delete the write's size check, (o) red | kalfa/git/src/RepositoryTest.ts |
| S28, unknown commits and shallow stores (slice 1, and `editTree` in slice 2): an id the store lacks, or a tree's or blob's id, fails `NoSuchCommit` naming it, never none; a shallow store answers every read and edit. memory 100 runs, process 10 | test | Effect Arbitrary: textureArb | answer none for an unknown commit, (f) red; check for a shallow store first, (h) red | kalfa/git/src/RepositoryTest.ts |
| S29, text (slice 1): `readText` is `readFile` decoded as UTF-8 exactly, BOM, CR and NUL kept; bytes that are not UTF-8 fail `NotUtf8` naming the path; none stays none. memory 100 runs, process 10 | test | Effect Arbitrary: textureArb | decode with replacement, (g) red; drop a leading BOM, (g) red | kalfa/git/src/RepositoryTest.ts |
| S30, the caller's bytes (slice 1, and `editTree` in slice 2): changing the bytes an answer gave, or the bytes given to `editTree`, after the call changes nothing read later. memory 100 runs, process 10 | test | Effect Arbitrary: textureArb | answer the store's own array, (j) red; keep the caller's array in the store, (j) red | kalfa/git/src/RepositoryTest.ts |
| S9 and S10, spans and keys, extended (both slices): each new call ends one `git.` span with the spans table's attributes, and none holds a seeded path or content; `readText` is one span; the service's keys gain `editTree`, `readFile` and `readText`; reads change no store, and `editTree` among the writes moves no ref | test | Effect Arbitrary: textureArb | annotate the path, (a) red; let `readText` call the wrapped `readFile`, two spans: red; let `editTree` move `refs/heads/main`: red | kalfa/git/src/RepositoryTest.ts |
| T7, the calls' types (both slices): `readFile`, `readText`, `editTree` and `commitEdit` have exactly the answers and error unions of this plan's sketches; the service calls need nothing, `commitEdit` needs `Repository`; `Raw` has `readFile` and `editTree` and no `readText`; `NotAFile`'s `holds` is the three literals | type | type | add `NotUtf8` to `readFile`'s errors: red; require `readText` of an adapter: red; type `holds` as a string: red | kalfa/git/src/Repository.types.test.ts |
| P19, `readFile` on the stand-in (slice 1): the commands are exactly `cat-file --batch-check`, one `ls-tree -z` per folder on the path, `cat-file --batch-check`, `cat-file blob`, and no argument and no stdin holds the path; a missing part ends with no later command; a file over the limit runs no `cat-file blob`; a `cat-file blob` that prints fewer or more bytes than its size is `GitUnavailable` reason `Unreadable`. 100 runs | test | Effect Arbitrary: readScriptArb | trust `cat-file blob`'s bytes without the length check, (u) red; give `ls-tree` the path as a pathspec: the stand-in sees it, red; read before the size check: red | kalfa/git/src/ProcessRepository.test.ts |
| P20, the listing reader (slice 1): for any drawn folder, its `ls-tree -z` bytes read back to the same entries, each with its raw line; a listing cut at any byte or bent reads as `Unreadable` or a shorter reading, and never throws. 300 runs | test | Effect Arbitrary: listingArb | split a line at its last space before the tab, so a name with a space is cut, (v) red; decode names as UTF-8, (v) red | kalfa/git/src/internal/parse.test.ts |
| P21, vector: `ls-tree -z` output from git 2.40.1 reads to the entries each row's note gives: each mode and type, names with a space, a tab, a line break, `é` and a byte `0xff` | test | vector: git 2.40.1 ls-tree -z output | read the mode as a number, so `040000` comes back as `40000`: red | kalfa/git/src/internal/parse.test.ts |
| I10, a repository's config steers nothing (slice 1, and `editTree` and `commitEdit` in slice 2): for drawn reads and edits, a bare repository with every key of the config table set answers each call as one without them, and as `/memory` does. 10 runs | test | Effect Arbitrary: textureArb | run `cat-file --filters --path=<path>`, (w) red; run `hash-object` with `--path=<path>` and no `--no-filters`, (w) red | kalfa/git/src/ProcessRepository.integration.test.ts |
| I11, a submodule on real git (slice 1, and `editTree` in slice 2): with a gitlink made by fast-import, `readFile` at it and below it fails `NotAFile` with `holds: "submodule"`, an edit at it fails the same, and an edit beside it keeps its entry, so the tree equals fast-import's tree of the expected files | test | scenario: one fast-import commit with a 160000 entry, since `/memory` cannot hold one | read a gitlink as nothing at the path, (i) red; drop a gitlink from a rewritten folder, (x) red | kalfa/git/src/ProcessRepository.integration.test.ts |
| S31, edit a tree (slice 2): for every edit the classes draw, `editTree` answers the tree id of the history's node that holds the model's files; `readFile` of each changed path gives its new bytes or none; every other path reads as before. memory 100 runs, process 10 | test | Effect Arbitrary: textureArb | keep a folder left with no files, (k) red; drop the untouched files of a rewritten folder, (k) red; give a replaced file mode 100644, (m) red; give a new file a sibling's mode, (m) red; match a changed name to a listed one by its start, (q) red | kalfa/git/src/RepositoryTest.ts |
| S32, no change gives back the same tree (slice 2): an empty edit, a file replaced with its own bytes and "absent" on a path that holds nothing each answer the base's own tree, and the store's fingerprint is as it was. memory 100 runs, process 10 | test | Effect Arbitrary: textureArb | refuse "absent" on a path that holds nothing, (l) red; give a file replaced with its own bytes mode 100644, (l) red; answer a new empty tree for an empty edit, (l) red | kalfa/git/src/RepositoryTest.ts |
| S33, refused edits (slice 2): each refusal class fails with the error and the paths the model names, in the check order this plan gives, and leaves the fingerprint as it was. memory 100 runs, process 10 | test | Effect Arbitrary: textureArb | delete the check on a removed link, (n) red; delete the path-in-the-way check, (n) red; refuse a file made a folder, (n) red; check the way before `NotAFile`, (p) red; name the last path by bytes, (p) red; check the size after `NoSuchCommit`, (p) red | kalfa/git/src/RepositoryTest.ts |
| P22, `editTree` on the stand-in (slice 2): the commands are exactly `cat-file --batch-check`, the `ls-tree -z` listings top down, one `hash-object -t blob -w --no-filters --stdin` per new content with its bytes byte for byte, then one `mktree -z` per changed folder, deepest first, whose stdin holds each untouched listed line byte for byte; a refused edit runs no `hash-object` and no `mktree`; an edit that changes nothing runs no `mktree`. 100 runs | test | Effect Arbitrary: editScriptArb | pass an untouched line decoded and encoded again, (v) red; run `hash-object` before the checks: a refused edit writes, red; write the top folder before the folder below it: red; write a folder whose entries came out the same, so an edit that changes nothing runs `mktree`, (l) red | kalfa/git/src/ProcessRepository.test.ts |
| I12, a name that is not UTF-8 on real git (slice 2): an edit of a file beside such a name, made with fast-import, keeps it byte for byte, so the tree equals fast-import's tree of the expected files | test | scenario: one fast-import commit with a name holding a byte 0xff, since a `Path` cannot hold one | rebuild a rewritten folder from decoded names, (x) red | kalfa/git/src/ProcessRepository.integration.test.ts |
| S34, commit an edit (slice 2): a real change makes a commit with parents `[parent]`, `editTree`'s tree, the caller's author and message byte for byte and the settings' committer at the clock's second, and no ref moves; no change fails `NoChange` and leaves the fingerprint as it was, before a NUL in the message is checked; an unknown parent fails `NoSuchCommit` before the size check; a refused edit and a NUL in the message pass through. memory 100 runs, process 10 | test | Effect Arbitrary: textureArb | take the committer from the author, (r) red; give the commit no parent, (r) red; write the commit before the no-change check, (s) red; check the message before no change, (s) red; read the parent after `editTree`, (t) red | kalfa/git/src/CommitEdit.test-support.ts |
| S35, the edit commit's spans (slice 2): `commitEdit` ends one span named `git.commitEdit` with the parent, the count of changes and the commit made, and no span of it holds a path, content, message, name or email | test | Effect Arbitrary: textureArb | annotate a changed path, (r) red; leave `kalfa.git.commit` out: red | kalfa/git/src/CommitEdit.test-support.ts |
| K1, the manifest (slice 2): `kalfa/git/package.json` exports `./CommitEdit`, and still has no `dependencies` | test | scenario: the package's own manifest at head | leave `./CommitEdit` out of the exports: red | kalfa/git/src/Package.test.ts |

**Every check that guards data has its class and its plant.** In call order. `readFile`: `NoSuchCommit` (f), a link
above the path (d), the exact name match (b), a folder (c), a link at the path (d), a submodule (i), the size (e), the
byte count read (u); `readText`'s UTF-8 (g). `editTree`: the size in `make` (o), `NoSuchCommit` (f), `NotAFile` (n),
`PathInTheWay` (n), a folder kept when its entries are the same (l). `commitEdit`: `NoChange` (s). Each class passes
every check before its own, and each plant deletes that check. The landed checks keep their own laws.

**Where each law runs.**

- G, T, P and K laws, and every S law on `/memory`: plain files, on every pull request their change reaches, and on
  the laptop with a narrow path. T7 runs under `pnpm typecheck`.
- I1 (the S laws on `/process`, with the commit edit suite beside the merge commit suite), I10, I11 and I12 run the
  real git binary in temp folders, so they are `ProcessRepository.integration.test.ts`. A stand-in cannot do their
  job: they are the thin proof that real git answers what the stand-in and `/memory` answer, and every behavior they
  check has a plain law above. The laptop refuses that file by name, and pull requests and the merge queue run no
  `.integration.` law, so the lead starts a proof run for each slice, after the build and before the review.
- No law is host-only: none needs launchd, Electron, a real signal or the owner's Mac.
- No secret flows through these calls, so no law is a `[secrets]` law. S9 and S35 check that no path or content
  reaches a span.

## Files

Slice 2 branches from main after slice 1 lands. A file touched in both slices has a row for each.

| Slice | File | Owner | Product lines expected | Change |
|---|---|---|---|---|
| 1 | kalfa/git/src/Settings.ts | build | 4 | `limits.blob` |
| 1 | kalfa/git/src/Repository.ts | build | 60 | `FileTooLarge`, `NotAFile.holds`, `readFile` and `readText` in the service, `Raw` leaves out `readText`, `readFile`'s span, `readText` written once in `make` |
| 1 | kalfa/git/src/internal/lookup.ts | build | 30 | new: `Kind`, `At`, `find` |
| 1 | kalfa/git/src/MemoryRepository.ts | build | 30 | `readFile`: its `At` over the flat map, the size check, a copy of the bytes |
| 1 | kalfa/git/src/internal/parse.ts | build | 40 | `listing`: the `ls-tree -z` reader, each entry with its raw line |
| 1 | kalfa/git/src/ProcessRepository.ts | build | 65 | the folder walk, `readFile`, the blob read with its length check; `holds: "submodule"` in `diff` |
| 1 | kalfa/git/README.md | build | docs | `readFile`, `readText`, `limits.blob`, the config table, the first two cases where the adapters differ |
| 1 | kalfa/git/src/History.test-support.ts | tests | tests | read cases, classes (a) to (j), the model's `find` |
| 1 | kalfa/git/src/RepositoryTest.ts | tests | tests | S25 to S30, S9 and S10 extended; `settings()` gains `blob` |
| 1 | kalfa/git/src/ProcessRepository.test.ts | tests | tests | P19; P16's `NotAFile` gains `holds` |
| 1 | kalfa/git/src/StandIn.test-support.ts | tests | tests | only if P19's script needs a reply that prints bytes of a set length |
| 1 | kalfa/git/src/internal/parse.test.ts | tests | tests | P20, P21 |
| 1 | kalfa/git/src/fixtures/ls-tree-2.40.1.json | tests | tests | new: `vector:` `ls-tree -z` output with a note per row |
| 1 | kalfa/git/src/Values.test.ts | tests | tests | G5 with `blob` |
| 1 | kalfa/git/src/Repository.types.test.ts | tests | tests | T7 for `readFile`, `readText`, `NotAFile` |
| 1 | kalfa/git/src/ProcessSeed.test-support.ts | tests | tests | a bare repository with the config table's keys set, for I10 |
| 1 | kalfa/git/src/ProcessRepository.integration.test.ts | tests | tests | I10 and I11 for reads; I9's `NotAFile` gains `holds` |
| 2 | kalfa/git/src/Repository.ts | build | 45 | `Edit`, `PathInTheWay`, `editTree` in the service and `Raw`, its span, the size check in `make` |
| 2 | kalfa/git/src/internal/lookup.ts | build | 35 | `check`: `NotAFile` for each changed path, then `PathInTheWay` on the result |
| 2 | kalfa/git/src/MemoryRepository.ts | build | 45 | `editTree`: the edit applied to the flat map, `entriesTree`, the tree and blobs added |
| 2 | kalfa/git/src/ProcessRepository.ts | build | 90 | `editTree`: listings, `hash-object` per content, `mktree` per changed folder deepest first, a folder kept when unchanged |
| 2 | kalfa/git/src/CommitEdit.ts | build | 55 | new: `NoChange`, `commitEdit` over the service |
| 2 | kalfa/git/README.md | build | docs | `editTree`, how `/process` makes a tree and why, `CommitEdit`, the third case where the adapters differ; "Reading a file" leaves the list of later tickets |
| 2 | kalfa/git/GLOSSARY.md | build | docs | **Edit** |
| 2 | kalfa/git/package.json | tests | tests | export `./CommitEdit` |
| 2 | kalfa/git/src/History.test-support.ts | tests | tests | edit cases, classes (k) to (t), the model's edit |
| 2 | kalfa/git/src/RepositoryTest.ts | tests | tests | S31 to S33; S27, S28, S30, S9 and S10 for `editTree` |
| 2 | kalfa/git/src/CommitEdit.test-support.ts | tests | tests | new: the commit edit suite, S34 and S35 |
| 2 | kalfa/git/src/CommitEdit.test.ts | tests | tests | new: the suite on `/memory`, 100 runs |
| 2 | kalfa/git/src/ProcessRepository.test.ts | tests | tests | P22 |
| 2 | kalfa/git/src/ProcessSeed.test-support.ts | tests | tests | fast-import of a name that is not UTF-8, for I12 |
| 2 | kalfa/git/src/ProcessRepository.integration.test.ts | tests | tests | the commit edit suite on real git; I10 and I11 for edits; I12 |
| 2 | kalfa/git/src/Repository.types.test.ts | tests | tests | T7 for `editTree`, `commitEdit`, `PathInTheWay` |
| 2 | kalfa/git/src/Package.test.ts | tests | tests | K1's export list |

No root file changes: no new package, no lockfile, no lint row (`kalfa/git/src/**` is already held by the overrides
and the Effect block). No other package builds `@kalfa/git`'s settings, so the new required limit breaks no caller
(searched: `rg -l "@kalfa/git"` outside the package finds only `kalfa/github`, which imports no settings).

## Existing tools

- `kalfa/git/src/internal/lookup.ts`: searched the package (`MemoryRepository.ts`'s `hasFolderOfAnother` and
  `isBeside` answer "is one path a folder of another" over a whole set, not "what does this path hold"; `Parse.changes`
  reads diff entries), Effect 4.1.3 (no tree or path lookup), and npm's `isomorphic-git` (its `readBlob` walks trees
  but is a whole git, which K1's no-dependency rule refuses). About 65 lines over both slices, so the two adapters
  refuse the same paths in the same order.
- `kalfa/git/src/CommitEdit.ts`: searched the package (`MergeCommit.ts` is the model: a helper over the public
  service, with `Effect.fn` and its own errors) and `Repository.make` (where `rangePatchId` lives; `commitEdit` writes,
  so it goes over the public `writeCommit` and its committer rule instead).
- `kalfa/git/src/internal/parse.ts`, its `listing` reader: searched the package (`Parse.changes` reads `diff-tree -z`
  entries, a different line; `Parse.checks` reads batch-check lines) and npm (no Effect reader of `ls-tree -z`).
- `kalfa/git/src/ProcessRepository.ts`, its folder walk and `editTree`: searched the package (`known`, `blobSizes`,
  the runner with bytes on stdin, `succeeded`, `stdoutText` are used as they are) and git's own commands (`mktree`,
  chosen above; `read-tree` with a temporary index and `hash-object -t tree`, both refused above).
- `kalfa/git/src/MemoryRepository.ts`, its `readFile` and `editTree`: searched the package (`entriesTree`, `found`,
  `Store.blobs`, `Cell.update` as `mergeTrees` uses them; `Digest.sha1` and `hashed("blob", ...)` for a new blob's
  id, as `tree` does).
- `kalfa/git/src/Repository.ts`, `readText`: searched the package for a UTF-8 decoder (`MemoryRepository.ts` and
  `internal/parse.ts` each hold a fatal `TextDecoder`); `Repository.ts` holds its own, as each file does.

## Calls taken

- **A new limit `blob`, 75%** (doubt at the top).
- **A link above the path fails `NotAFile`, 75%** (doubt at the top).
- **`/process` walks folders with `ls-tree -z` and gives git no path, 85%.** A path argument is a pathspec, and run by
  hand `ls-tree <c> -- :foo` read the file `foo`. `:(literal)` would fix that one case, but `core.precomposeUnicode`
  still rewrites a path argument on a Mac. With no path given, no path rule of git acts, and the name match is ours,
  exact on bytes. The cost: one `ls-tree` per folder on the path.
- **`mktree`, not a temporary index and not `hash-object -t tree`, 85%** (the reasons are in the shape above).
- **A folder whose entries come out the same keeps its id, 85%.** So an edit that changes nothing gives back the very
  tree, even one git wrote in an odd form, and writes nothing, which `NoChange`'s "writes nothing" needs.
- **`editTree` refuses every path `readFile` refuses, removal included, 80%.** One rule for both calls, and a link
  is never silently replaced or removed.
- **"absent" on a path that holds nothing is no change, 85%.** It is Reconciliation's state word, and a repeated adopt
  must not fail.
- **A file made a folder in one edit is allowed, 80%.** The rule is on the result, as git's own tree rule is: no path
  is a folder of another.
- **A replaced file keeps its mode and a new file is `100644`, 85%.** The ticket's changes carry content only, and
  an executable script that gets new content stays executable.
- **The size of new content is checked in `make`, first, 80%.** As `writeCommit`'s NUL and size checks are: a check on
  what the caller gave, written once for every adapter, before any command.
- **One error per meaning, 80%.** `NotAFile` gains `holds` and serves `diff`, `readFile` and `editTree`; `FileTooLarge`
  serves a read and a write; `NotUtf8` serves `diff` and `readText`. The 1869 sketch's names were placeholders.
- **`readText` is written once in `make`, as `rangePatchId` is; `commitEdit` is its own module, as `mergeCommit` is,
  80%.** `readText` derives from one raw read and keeps one span; `commitEdit` writes, so it uses the public
  `writeCommit`, and the committer rule stays in one place, as the ticket asks.
- **`commitEdit` answers the `Commit`, 80%.** `writeCommit` and `mergeCommit` answer one; the caller takes `.id`.
- **`commitEdit` reads the parent with `readCommit`, 80%.** It needs the parent's tree to see no change. The cost: a
  parent over `limits.bytes` or with a message that is not UTF-8 fails it, as it fails `readCommit`.
- **Folder listings are read whole, bounded by the time limit only, 80%.** A folder is one git object, and an edit
  must read a folder whole to write it again. No limit on how many changes one edit holds, 80%: the caller already
  holds them all, and the time limit bounds the commands.
- **Is any of this a setting?** `limits.blob` is, required and with no default. Not settings: the new file's mode (a
  caller with a need asks for a mode in a later ticket), the commands and their pins (a setting would let config steer
  a read, as the landed plans say of the other pins), the check order (both adapters must agree).

## Validation

- tests step, per slice: no dependency changes, so no install. Each plain law file alone,
  `nice -n 15 pnpm exec vitest run kalfa/git/src/<file>.test.ts`, red on the missing calls. The `vector:` file is
  recorded once with real git, and its header names the git version and the command. The integration file is written
  and not run: the laptop refuses it.
- build step, per slice: each plain law file green, `pnpm format`, `pnpm lint` (its law id check too), and each plant in
  the laws table run once and undone. The integration file is not run on the laptop.
- The lead, per slice: a proof run of `kalfa/git/src/ProcessRepository.integration.test.ts` before the review.
- The lead runs its own typecheck per slice, for T7.
- After slice 2 lands, the lead posts one comment on https://github.com/kamp-us/tea-fabrika/issues/1935 naming how
  `/process` makes the tree, as the ticket asks.

## Size

1. Slice 1, read a file: 229 lines (`ProcessRepository.ts` 65, `Repository.ts` 60, `internal/parse.ts` 40,
   `internal/lookup.ts` 30, `MemoryRepository.ts` 30, `Settings.ts` 4). It lands whole: Reconciliation's check that
   the kalfa config matches main can read with `readText` on both adapters.
2. Slice 2, edit a tree and commit it: 270 lines (`ProcessRepository.ts` 90, `CommitEdit.ts` 55, `Repository.ts` 45,
   `MemoryRepository.ts` 45, `internal/lookup.ts` 35). It lands whole: adopt commits its edit with `commitEdit`. Slice
   1 owns the shared pieces both use: `internal/lookup.ts`'s `At` and `find`, the folder walk in `ProcessRepository.ts`,
   the `ls-tree` reader, `NotAFile.holds` and `limits.blob`.

About 499 product lines in all, plus the laws, one `vector:` file, the README and one glossary term. About 6 agent hours
across the steps, 70% sure. The doubt: `/process`'s `editTree` at 90 lines is the largest piece, and the edit
generator that seeds the model's answer as a node of the history is the largest test piece. Priced at about $10 a step
at list price, as the diff plan's were: tests, build and review for each slice, and one send-back each.

Estimate: 8 steps, $80

## New names

- `readFile`, `readText`, `editTree`, `commitEdit`; `Edit`; `limits.blob`.
- `FileTooLarge`, `PathInTheWay`, `NoChange`; `NotAFile`'s `holds` with `folder`, `link`, `submodule`.
- `internal/lookup.ts`'s `Kind`, `At`, `find`, `check`; `Parse.listing`.
- Spans `git.readFile`, `git.readText`, `git.editTree`, `git.commitEdit`; attributes `kalfa.git.found`,
  `kalfa.git.bytes`, `kalfa.git.changes`.

## Records

- `kalfa/git/GLOSSARY.md` gains one term in slice 2's build:

  **Edit**:
  Files of a commit to replace or remove, each by its path: new content, or absent. Committing an edit makes a new
  commit with that one commit as its parent.
  _Avoid_: patch, change set, diff, update

- No new decision: the owner's answers on 1869 and 1750 hold the design, and every call above is cheap to change
  before the first release. No pattern doc.

## What this cannot tell us

- Whether `limits.blob` and a link above the path are what the owner wants (the two doubts at the top).
- How slow the folder walk is on a deep path in a large repository: no law measures time, and the time limit stops a
  slow call. Reconciliation's paths are two folders deep.
- Whether a newer git than 2.40.1 changes `ls-tree -z` or `mktree -z` in a way the vector misses: the laws run on the
  git CI and the proof run hold.
- Whether a sha-256 repository works: the package's ids are sha-1 only (`OBJECT_ID`), so its listings would read as
  `Unreadable`, never as a guess.
- Whether git 2.38 and 2.39 run these commands as 2.40.1 does: every flag used is older than 2.38, from memory, not
  checked.

## Open questions

None.

The two calls under 80% are taken and listed at the top as doubts.

## Lead's calls at signing (2026-11-23)

- Kept: a new required limit, `limits.blob`, for a file read, so `bytes` keeps one meaning.
- Kept: a link above the asked path fails `NotAFile`, not none. A none answer would tell the caller the path is free, and an edit there would then meet the link.

## Findings

None new.
