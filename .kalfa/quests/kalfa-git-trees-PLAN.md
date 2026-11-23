Approved by the lead agent, builds issues 1750, 1932, 2012; body f72424b87678
Plancheck-Version: 3

# Plan: @kalfa/git, commits hold trees, and the memory store holds files (ticket 2012)

This is the kalfa packages (`kalfa/`), new work: not today's frozen version and not `next/`. The ticket is
https://github.com/kamp-us/tea-fabrika/issues/2012, a GitHub issue, so the pull request says `Closes #2012` and
carries no `fabrika close ticket` line. One pull request from main. It builds on `@kalfa/git` as ticket 1932 left it
(https://github.com/kamp-us/tea-fabrika/pull/1977, plan `.kalfa/quests/kalfa-git-read-PLAN.md` with both amendments).
Tickets 1933 (diff), 1934 (merge commit) and 1935 (a file at a commit) each branch from main after this lands, and
add to it without changing it.

This plan merges slice 1 of two drafts that each planned the same piece: `.kalfa/quests/kalfa-git-diff-PLAN.md` on
branch `fabrikalfa/kalfa-git-diff` (ticket 1933) and `.kalfa/quests/kalfa-git-merge-PLAN.md` on branch
`fabrikalfa/kalfa-git-merge` (ticket 1934). "Where the two drafts differed" names each point and the one taken.

```ts
// The whole idea, a sketch. A test (or a later adapter call) puts files in a memory store and commits them.
const program = Effect.gen(function* () {
  const files = new Map([
    [path("a.b"), { mode: "100644", content: utf8("x\n") }],
    [path("a/c"), { mode: "100644", content: utf8("y\n") }],
    [path("a0"), { mode: "120000", content: utf8("a.b") }],        // a link: its content is the target
  ]);
  const { store, id: tree } = yield* MemoryRepository.tree(MemoryRepository.empty, files);  // git's tree id
  const commit = yield* MemoryRepository.commit({ tree, parents: [], author, committer, message });
  // commit.id is the id git gives the same commit. /process's readCommit answers the same `tree`.
});
```

## Doubts, read first

- **`Path` refuses `.git` in any letter case, and not git's other look-alikes, 70%.** git's `fsck` (which a host
  runs on a push it receives) also refuses names that some file systems read as `.git`, such as `git~1` and `.git`
  with an ignorable Unicode character inside. I recall this from git's `fsck.c` and did not check it on 2.40.1. If it
  holds, a tree `/memory` accepts could be refused by a host; no ticket before 1940 (push) sends a tree anywhere.
  What would settle it: one hand run of `git fsck` on such a tree, or 1940's own laws. Tightening `Path` later only
  refuses more, so nothing built here has to change.

Every other call is 80% or more, under "Calls taken".

## What changes, in one paragraph

`Commit` gains `tree: TreeId`, git's first header line. A new module `Tree` holds the values a tree is made of:
`TreeId`, `BlobId`, `Path`, `Mode` and `Entry`. `/memory`'s `Store` gains `trees` (each tree's files by path, flat)
and `blobs` (each file's bytes by id), and a new `MemoryRepository.tree` puts files in the store and gives the tree's
id as git computes it, so a commit with files has the same id in memory and in a real repository. `internal/object.ts`
writes blob and tree bytes beside the commit bytes. `internal/parse.ts` reads the `tree` header it skipped:
`/process` needs no other change, since `readCommit` and `walk` now answer the tree git wrote. The shared history
generator gives every commit files, the fast-import seeder writes them, and `Seeded` gains each commit's tree id. No
new call, no span change, no new setting. Out of scope: diff and patch id (1933), merge trees, write a commit, move a
ref (1934), read a file and edit a tree (1935).

## Searched first

- The ticket https://github.com/kamp-us/tea-fabrika/issues/2012, its siblings 1933, 1934 and 1935 whole (so this plan
  gives each what it builds on), and the parent https://github.com/kamp-us/tea-fabrika/issues/1750.
- Both drafts above, whole, and the landed read plan with its two amendments.
- `kalfa/git/GLOSSARY.md` (it already has **Tree** and **Commit id**), `kalfa/git/README.md`, and every file in
  `kalfa/git/src/` as built on main: `Commit.ts` ("A commit has no tree yet"), `CommitId.ts` (`FORMATS`, the one
  place an id's length lives), `internal/object.ts` (the empty tree is fixed), `internal/parse.ts` (the header loop
  skips `tree`), `MemoryRepository.ts` (`Store`, `commit`, `add`, `point`, `BadStore`'s `ref-conflict`),
  `ProcessRepository.ts`, `Repository.ts`, `Settings.ts`, and the test files `History.test-support.ts` (`Node`,
  `shapes`, `carrier`, `objectSize`, `TREE_ID`), `RepositoryTest.ts` (`Seeded`, `expectedCommit`, S1, S2, S10),
  `ProcessSeed.test-support.ts` (the fast-import stream), `MemoryRepository.test.ts` (the memory seeder, M1, M2),
  `Values.test.ts` (G1 to G5), `Values.types.test.ts` (T1), `Repository.types.test.ts` (T2 to T4),
  `internal/parse.test.ts` (P1), `ProcessRepository.integration.test.ts` (I1 to I4), `Package.test.ts` (K1), and
  the fixtures `cat-file-2.40.1.json` (its recorded output already holds each commit's `tree` line) and
  `fast-import-2.40.1.json`.
- `rg -il` over `.kalfa/decisions`, `.kalfa/glossary`, `.kalfa/patterns`, `.kalfa/runbooks` and every kalfa glossary
  for "tree id|blob", "path", "file mode|mode", "working copy". No decision speaks to a tree's shape. Decision 0089 (a
  setting's value is plain data) and the pattern `effect-crypto-through-services.md` (`Digest` as a service) hold.
- Installed versions in the lockfile: `effect` and `@effect/vitest` 4.1.3 (patched; the patch touches neither
  `Schema` nor `Digest`), `vitest` 5.0.5. Read in the installed source: `Schema.makeFilter`, `Schema.brand`,
  `Schema.Literals`, `Schema.Class`, `effect/crypto/Digest` (`sha1`, `digestHex`, as `commit` already uses them), and
  `node_modules/effect/AGENTS.md`.
- Lessons only, never imported: `next/packages/libfabrika/src/node/repositories/internal/gitMemory.ts`, a tree writer
  with git's entry order (`treeOrder`); `kalfa/` may not import `next/`.
- git's object format, checked by computing ids by hand with a sha-1 (not a test): the empty tree is
  `4b825dc642cb6eb9a060e54bf8d69288fbee4904`, matching `internal/object.ts`; the trace below gives the rest.

## How others do it

- **git** names a file's bytes as a blob (`blob <size>\0<bytes>`), a folder as a tree (entries of `<mode> <name>\0`
  and the 20 raw id bytes, sorted by name with a folder's name read as if it ended in `/`, folder mode `40000`), and
  a commit by its bytes, whose first line is `tree <id>`. `fast-import` writes a commit's files with `deleteall` and
  one `M <mode> inline <path>` each. Both drafts ran these by hand on git 2.40.1.
- **libgit2, JGit, go-git, isomorphic-git** keep trees as nested objects with their own ids, and each has a tree
  builder that sorts entries git's way. From memory, not fetched. `/memory` keeps only a root tree's files, flat by
  path, and computes the nested ids when it hashes: no caller of the three tickets names a folder's own tree.
- **Effect**: values are `Schema` brands and `Schema.Class`, as `CommitId` and `Commit` are; hashing goes through
  the `Digest` service.
- **Elm and Erlang/OTP** have nothing to say: these are plain values, with no state between calls.

## The shape

```ts
// kalfa/git/src/Tree.ts, a sketch. Doc blocks left out.
// The id form lives in internal/object.ts with FORMATS, still one place for an id's length (see Calls taken).
export const TreeId = Schema.String.check(Schema.isPattern(OBJECT_ID)).pipe(Schema.brand("@kalfa/git/TreeId"));
export const BlobId = Schema.String.check(Schema.isPattern(OBJECT_ID)).pipe(Schema.brand("@kalfa/git/BlobId"));

// Where a file sits in a tree: parts joined by "/"; no part empty, "." or ".."; no part ".git" in any letter case;
// no NUL; well-formed UTF-16, so it has UTF-8 bytes. Everything else git allows is allowed: a space, a line break,
// a leading "-" or '"', a part "__proto__".
export const Path = Schema.String.check(Schema.makeFilter(isPath, { title: "a path in a git tree" }))
  .pipe(Schema.brand("@kalfa/git/Path"));

// A file's kind as git writes it in a tree: a file, an executable file, a link. A submodule (160000) is not a file.
export const Mode = Schema.Literals(["100644", "100755", "120000"]);

// What a tree holds at one path: the file's kind and its blob.
export class Entry extends Schema.Class<Entry, { readonly brand: unique symbol }>("@kalfa/git/Entry")({
  mode: Mode,
  blob: BlobId,
}) {}
```

```ts
// kalfa/git/src/Commit.ts gains one field, in git's order.
export class Commit extends Schema.Class<Commit, { readonly brand: unique symbol }>("@kalfa/git/Commit")({
  id: CommitId, tree: TreeId, parents: Schema.Array(CommitId), author: Signature, committer: Signature, message: Schema.String,
}) {}
```

```ts
// kalfa/git/src/MemoryRepository.ts, a sketch of what changes.
export interface File { readonly mode: Tree.Mode; readonly content: Uint8Array }
export interface Store {
  readonly commits: ReadonlyMap<CommitId, Commit.Commit>;
  readonly trees: ReadonlyMap<Tree.TreeId, ReadonlyMap<Tree.Path, Tree.Entry>>;  // a root tree's files, flat by path
  readonly blobs: ReadonlyMap<Tree.BlobId, Uint8Array>;
  readonly refs: ReadonlyMap<Ref.RefName, CommitId>;
  readonly shallow: ReadonlySet<CommitId>;
}
// `empty.trees` holds git's empty tree with no files, so a commit with no files needs no `tree` call.
export const empty: Store;

// Puts the files and their blobs in the store and gives the tree's id as git computes it: a blob per content (one
// blob for two paths with the same bytes), a tree object per folder, entries in git's order. A Map in, never a
// plain object, so a path named `__proto__` is a path like any other.
export const tree: (store: Store, files: ReadonlyMap<Tree.Path, File>)
  => Effect.Effect<{ readonly store: Store; readonly id: Tree.TreeId }, BadStore, Digest.Digest>;

// Now takes `tree` among its fields and writes it into the commit's bytes.
export const commit: (fields: Omit<Commit.Commit, "id">) => Effect.Effect<Commit.Commit, never, Digest.Digest>;

// `add` checks, in order: the parents (`missing-parent`, as today), then the tree (`missing-tree`).
// `tree` fails `path-conflict` when one path is a folder of another (a file `a` beside a file `a/b`).
export class BadStore ... { reason: Schema.Literals(["missing-parent", "missing-commit", "ref-conflict", "missing-tree", "path-conflict"]) }
```

- **`internal/object.ts`** gains `FORMATS` and `OBJECT_ID` (moved from `CommitId.ts`), `blob` and `treeBytes` (one
  folder's entries in git's order), and `hashed` takes the object's type word. `bytes` writes the commit's own
  `tree` line in place of the fixed empty tree; `EMPTY_TREE` stays as the id `empty.trees` holds.
- **`internal/parse.ts`** reads the `tree` header: the first header line must be `tree <id>` with a `TreeId`, and no
  other line may be `tree`. Else `UnreadableCommit`, reason `header`, as git's own parser refuses it.
- **`/process`** changes no file: `known`, `objects` and every call stay as they are.

### What the three tickets build on

| Ticket | Uses, unchanged | Adds of its own |
|---|---|---|
| 1933 diff | `Entry` (a file's mode and blob, before and after), `Store.trees` flat by path, `Store.blobs`, `Mode` with links (a type change), `Path`, the seeder's files | `Diff.ts`, `patchId`, `diff`, its limits |
| 1934 merge commit | `TreeId`, `MemoryRepository.tree` for a merged tree, `Entry` equality for the whole-file merge, `Commit.tree` | `writeCommit`, `moveRef`, `mergeTrees`, the committer setting |
| 1935 a file at a commit | `Store.trees` and `Store.blobs` to read a file, `Mode` to tell a link, `MemoryRepository.tree` for an edited tree, `Path` | `readFile`, `editTree`, `commitEdit` |

The history value is the other piece they share: `Node.files` and `Seeded.trees` (below) are fixed here, so later
laws draw edits over them without changing their shape.

### The history value

```ts
// kalfa/git/src/History.test-support.ts, a sketch: Node gains its files, as plain data.
export interface Node {
  readonly parents: ReadonlyArray<number>;
  readonly author: FlatSignature;
  readonly committer: FlatSignature;
  readonly message: string;
  // No two the same path, and no path a folder of another. [] is git's empty tree.
  readonly files: ReadonlyArray<{ readonly path: string; readonly mode: "100644" | "100755" | "120000"; readonly content: Uint8Array }>;
}

// kalfa/git/src/RepositoryTest.ts: Seeded gains the tree id of each commit, by index, as the seeder's store has it.
export interface Seeded { ...; readonly trees: ReadonlyArray<Tree.TreeId> }
```

The memory seeder makes each tree with `MemoryRepository.tree`. The fast-import seeder writes `deleteall` and one
`M <mode> inline <path>` per file, quoting a path in fast-import's C style when it starts with `"` or holds a line
break, and reads the tree ids back from git in one call. In `shapes`, a commit's files are its first parent's with one
drawn edit, so equal trees on different commits and trees one change apart both come up in every run.
`objectSize` keeps working unchanged: every tree id has 40 characters, as the empty tree's does.

## One value traced: three files, through both adapters

The files of the sketch at the top: `a.b` = `x\n`, `a/c` = `y\n`, and `a0`, a link to `a.b`.

1. `MemoryRepository.tree` hashes each content as a blob: `x\n` is `587be6b4c3f93f93c489c0111bba5596147a26cb`, `y\n`
   is `975fbec8256d3e8a3797e7a3611380f27c49f4ac`, the link's `a.b` is `f6f28df96c2b40c951164286e08be7c38ec74851`.
2. Folder `a` is a tree of one entry, `100644 c`: `ba540554778146d37d80d0019c6bdfe4cb8548ba`.
3. The root's entries in git's order: `a.b` (`.` is 0x2e), then folder `a` (read as `a/`, 0x2f), then `a0` (`0` is
   0x30). Its id is `5612ceec9425bdadff0883f93afa96a94c4cd9cf`. A plain string sort puts `a` first and gives another
   id; a flat tree with `a/c` as one name gives another again (laws M3 and I5).
4. The store now holds that tree as three entries by path, `a.b`, `a/c`, `a0`, and three blobs.
5. `MemoryRepository.commit({ tree: 5612ce..., ... })` writes `tree 5612ce...` as the commit's first line; `add`
   finds the parents, then the tree, and keeps it.
6. The fast-import seeder writes the same three files; `/process`'s `readCommit` reads the `tree` line back as
   `5612ce...`, and the commit id is the one memory gave.
7. Had the files held `a` (a file) and `a/b`, `tree` fails `BadStore` `path-conflict` and the store is unchanged.

## What fact is lost if not recorded now

Nothing is written once and lost: every id is computed again from its bytes. One fact must be kept whole now, or later
tickets read the wrong thing: `/memory` keeps each file's mode and its bytes exactly, never decoded as text, since
1933's diff reads a mode change and a binary file, and 1935's `readFile` answers bytes.

## Generators

The generators live in `kalfa/git/src/History.test-support.ts`, as 1932's do. Each class is reached in every run,
made from the run's drawn value, and a law fails when its list of classes reached is short, as `everyShape` and
`carrier` do today. Tree classes come in a new carrier history, a line of commits that each hold one class.

Values:

- (a) a path with an empty part: the empty text, a leading `/`, a trailing `/`, `//` inside.
- (b) a path with a part `.` or `..`.
- (c) a path with a part `.git`, `.GIT` or `.Git`, at the top and three folders deep.
- (d) a path with a NUL inside a part.
- (e) a path with a lone surrogate: high, low, and one at the end.
- (f) accepted paths near each rule: characters past U+024F inside the Basic Multilingual Plane, outside it, and from
  U+E000 to U+FFFF; a space, a line break, a leading `-` and a leading `"`; the parts `.gitx`, `git`, `..a` and `a.`.
- (g) paths that are names on JavaScript's object prototype: `__proto__`, `constructor`, `hasOwnProperty`,
  `toString`, each also as a folder.
- (h) ids of the wrong form: each of the commit id's refuse classes, given as a `TreeId` and as a `BlobId`.
- (i) modes: `100644`, `100755` and `120000` accepted; `160000`, `040000`, `40000`, `644`, `100664` and the empty
  text refused.

Trees:

- (j) order and nesting: a folder `a` holding `c`, beside the files `a-b`, `a.b` and `a0`; a file three folders deep
  beside a file at the top.
- (k) contents: empty, no trailing newline, a NUL byte, bytes that are not UTF-8 (`0xff`), CRLF lines, past 1000
  bytes; the same bytes at two paths, once with two modes.
- (l) kinds: an executable file and a link.
- (m) path conflicts, every path a good `Path`: a file `a` beside a file `a/b`, and `x/y` beside `x/y/z`.
- (n) a commit whose tree the store lacks, its parents all in the store.
- (o) histories with files: two commits with the same files on different parents; commits whose files differ by one
  byte, one path, one folder level or one mode; a commit with no files.

Git's output:

- (p) commit objects recorded from a real run (`hash-object --literally -t commit`), each well formed but for its
  tree line: no `tree` line, two `tree` lines, `tree` after `author`, and a tree id in uppercase hex.
- (q) a seeded commit's own tree id, a real tree with files, given where a commit id is asked.

## Laws

Laws use `it.prop` and `it.effect.prop` from `@effect/vitest` 4.1.3 with Effect's own `Arbitrary`, as 1932's do.
The S laws are in `RepositoryTest.suite`, so they run on `/memory` in `MemoryRepository.test.ts` (100 runs) and on
`/process` in `ProcessRepository.integration.test.ts` (10 runs, law I1).

| Law | Kind (lint, type or test?) | Generator | Plant | Where |
|---|---|---|---|---|
| G6, paths: `Path` accepts every path (f) and (g) draw and refuses each of (a) to (e). 200 runs | test | Effect Arbitrary: pathArb | delete the empty-part rule, (a) red; delete the dot-part rule, (b) red; delete the `.git` rule, (c) red, and compare it case by case so `.GIT` passes, (c) red; delete the NUL rule, (d) red; delete the surrogate check, (e) red; refuse characters past U+024F, (f) red; refuse a part that starts with `.`, so `.gitx` is refused, (f) red; refuse a part that starts with `_`, (g) red | kalfa/git/src/Values.test.ts |
| G7, ids, modes and a commit's tree: `TreeId` and `BlobId` accept 40 lowercase hex and refuse each class of (h); `Mode` accepts and refuses as (i) says; G4's commits now carry a tree and round-trip, and a commit whose `tree` is no `TreeId` does not decode. 200 runs | test | Effect Arbitrary: commitIdArb | drop the pattern from `BlobId` and keep its brand, (h) red; drop it from `TreeId`, (h) red; accept `644`, (i) red; accept `160000`, (i) red; type `Commit.tree` as `Schema.String`: red | kalfa/git/src/Values.test.ts |
| T5, the brands: a `TreeId`, a `BlobId` and a `CommitId` are not each other; a plain string is none of them and no `Path` | type | type | give `BlobId` the brand `@kalfa/git/TreeId`: an `@ts-expect-error` is unused, red | kalfa/git/src/Values.types.test.ts |
| M3, memory's ids are git's: for each row of a list recorded from a real `git fast-import` run with files (its files, and the tree id and commit id git gave), `MemoryRepository.tree` and `commit` give those ids; the row with no files gives git's empty tree | test | vector: git 2.40.1 fast-import with files, its tree and commit ids | sort a tree's entries as plain strings, (j) red; write every path into one flat tree, (j) red; write a link as `100644`, (l) red; hash a file's content after decoding it as text, the `0xff` row (k) red; keep a tree's files in a plain object, the `__proto__` row (g) red; write the empty tree in a commit's bytes whatever `tree` says: red | kalfa/git/src/MemoryRepository.test.ts |
| M4, the store refuses what git cannot hold: `tree` of (m) fails `BadStore` `path-conflict` and leaves the store as it was; `add` of (n) fails `missing-tree`; every tree the generators draw builds. 100 runs | test | Effect Arbitrary: treeArb | delete the path-conflict check, (m) red; check only a file beside its direct child, so `x/y/z` passes, (m) red; delete the missing-tree check in `add`, (n) red | kalfa/git/src/MemoryRepository.test.ts |
| M5, a tree reads back: after `tree(store, files)`, `store.trees.get(id)` names exactly the paths given, each with its mode, and `store.blobs` gives each path's bytes back byte for byte; the same bytes at two paths are one blob. 100 runs | test | Effect Arbitrary: treeArb | leave out an empty file, (k) red; keep the first mode seen for one blob, so the second path takes it, (k) red; key `blobs` by path, so two paths with one content give two blobs, (k) red | kalfa/git/src/MemoryRepository.test.ts |
| S1, read back, now with trees: beside S1's checks, `readCommit` of each commit gives the tree id `Seeded.trees` has for it. memory 100 runs, process 10 | test | Effect Arbitrary: history | `commit` leaves `tree` out of the value it returns, so it reads back as the empty tree, (o) red; in the parser, read the tree from the second header line: red | kalfa/git/src/RepositoryTest.ts |
| S11, same files, same tree: two commits of a seeded history have one tree id exactly when their files are equal (paths, modes and bytes); a commit with no files has git's empty tree. memory 100 runs, process 10 | test | Effect Arbitrary: history | mix the parents into a tree's id, (o) red; leave the mode out of a tree's bytes, (o) red; give every commit the empty tree, (o) red | kalfa/git/src/RepositoryTest.ts |
| S2, unknown and wrong-type ids, grown: a seeded commit's real tree id, given to each call that takes a commit, fails `NoSuchCommit` naming it. memory 100 runs, process 10 | test | Effect Arbitrary: history | in `/process`'s `known`, accept an object of any type, (q) red | kalfa/git/src/RepositoryTest.ts |
| P1, the tree header: beside P1's checks, every recorded object reads with its `tree`; each object of (p) is `UnreadableCommit` reason `header` | test | vector: git 2.40.1 cat-file output, with the objects of (p) from a real run | keep the first of two `tree` lines, (p) red; take a `tree` line anywhere in the header, (p) red; skip the `TreeId` decode, (p) red | kalfa/git/src/internal/parse.test.ts |
| K1, the manifest: the exports gain exactly `./Tree`, and there are still no `dependencies` | test | scenario: the package's own manifest at head | export `./internal/object`, red | kalfa/git/src/Package.test.ts |
| I5, memory and git agree on generated histories: for every shape and the tree carrier of a drawn texture, the memory seeder and the fast-import seeder give each commit the same commit id and the same tree id. 10 runs | test | Effect Arbitrary: history | each M3 plant, run once | kalfa/git/src/ProcessRepository.integration.test.ts |
| I1, the shared laws on real git: S1, S2 and S11 run on `/process` over bare repositories the seeder fills, now with files | test | Effect Arbitrary: history | each S law's plant, run once on `/process` | kalfa/git/src/ProcessRepository.integration.test.ts |

**Every check that guards data has its class and its plant.** In `Path`: each rule, (a) to (e), with (f) and (g)
passing all of them. In `TreeId`, `BlobId` and `Mode`: (h) and (i). In `tree`: the path-conflict check, (m), whose
paths all pass `Path`. In `add`: the missing-tree check, (n), whose parents pass the missing-parent check before it.
In the parser: the one, first, well-formed `tree` line, (p), whose objects are otherwise well formed. The own-key
read: every map keyed by a path is a `Map`, (g). In `/process`: the type check in `known`, (q). Each plant deletes or
weakens that check.

**Where each law runs.**

- G, T, M, P and K laws, and every S law on `/memory`: plain files, on every pull request their change reaches, and
  on the laptop with a narrow path. T5 runs when the lead checks the types.
- I1 and I5 run the real git binary in temp folders, so they are in `ProcessRepository.integration.test.ts`. A
  stand-in cannot do their job: the point is that git's own hashing and its own parser agree with `/memory`. Every
  behavior they check has a plain law above (M3 holds memory to recorded git ids, P1 holds the parser to recorded git
  output), so I1 and I5 are the thin proof on the real binary. The laptop refuses that file by name, and pull requests
  and the merge queue run no `.integration.` law, so the lead starts a proof run that reaches it after the build and
  before the review.
- No law is host-only: none needs launchd, Electron, a real signal or the owner's Mac. No secret flows here, so no law
  is a `[secrets]` law. No span changes, so S9 is unchanged; S10's five keys are unchanged, since no call is added.

## Files

| File | Owner | Product lines expected | Change |
|---|---|---|---|
| kalfa/git/src/Tree.ts | build | 60 | new: `TreeId`, `BlobId`, `Path` and its rule, `Mode`, `Entry` |
| kalfa/git/src/CommitId.ts | build | 5 | the id form moves to `internal/object.ts`; `CommitId` imports it |
| kalfa/git/src/Commit.ts | build | 4 | `tree: TreeId`; the module doc drops "A commit has no tree yet" |
| kalfa/git/src/internal/object.ts | build | 50 | `FORMATS` and `OBJECT_ID`; blob and tree bytes in git's order; `hashed` takes the type; the commit's own `tree` line |
| kalfa/git/src/internal/parse.ts | build | 15 | the one `tree` header, first, as a `TreeId` |
| kalfa/git/src/MemoryRepository.ts | build | 70 | `File`, `Store.trees` and `Store.blobs`, `empty` with git's empty tree, `tree`, `commit` with its tree, `add`'s missing-tree check, the two `BadStore` reasons |
| kalfa/git/README.md | build | docs | commits hold trees; the memory store's trees and blobs and `MemoryRepository.tree`; `Node.files` and `Seeded.trees` for a new adapter's runner; the last line on what comes later |
| kalfa/git/GLOSSARY.md | build | docs | **Tree id**, **Blob**, **Mode**, **Path**, under Records |
| kalfa/git/package.json | tests | tests | export `./Tree` |
| kalfa/git/src/History.test-support.ts | tests | tests | `Node.files`; the path, mode and content arbitraries; classes (a) to (q); the tree carrier; files on every shape; the model's equal-files relation |
| kalfa/git/src/RepositoryTest.ts | tests | tests | `Seeded.trees`; `expectedCommit` with its tree; S1, S2 and S11 |
| kalfa/git/src/ProcessSeed.test-support.ts | tests | tests | `deleteall` and one `M <mode> inline <path>` per file, quoted as fast-import needs; the tree ids read back |
| kalfa/git/src/MemoryRepository.test.ts | tests | tests | the memory seeder builds trees and fills `Seeded.trees`; M1 gives each row git's empty tree; M3, M4, M5 |
| kalfa/git/src/Values.test.ts | tests | tests | G6, G7; G4's commits carry a tree |
| kalfa/git/src/Values.types.test.ts | tests | tests | T5 |
| kalfa/git/src/internal/parse.test.ts | tests | tests | P1's expected values carry `tree`; the (p) rows |
| kalfa/git/src/Package.test.ts | tests | tests | K1's export list |
| kalfa/git/src/ProcessRepository.integration.test.ts | tests | tests | I5; I1 runs the grown suite |
| kalfa/git/src/fixtures/tree-ids-2.40.1.json | tests | tests | new: `vector:` files, with paths as a list (never object keys), and the tree and commit ids git gave, from a real fast-import run |
| kalfa/git/src/fixtures/cat-file-2.40.1.json | tests | tests | each row's expected value gains its tree (its recorded output already holds it); new rows for (p) from a real run |

`kalfa/git/src/fixtures/fast-import-2.40.1.json` does not change: its rows were recorded with git's empty tree, and
M1 supplies that id. No root file changes: no new package, no lockfile, no lint row (`kalfa/git/src/**` is already
held by the package's lint blocks). `ProcessRepository.ts`, `Repository.ts`, `Settings.ts`, `HistoryTest.ts` and the
stand-in tests do not change; if a stand-in's recorded commit body lacks a `tree` line, the tests step adds one.

## Existing tools

- `kalfa/git/src/Tree.ts`: searched Effect 4.1.3 for a path or git object schema (none), the repo (`rg "TreeId|isPath"`
  under `kalfa/` and `next/packages/libfabrika/src/node/repositories/`: `next/` checks paths as plain strings) and npm
  (no Effect Schema for a git path). New, on `Schema.makeFilter`, `Schema.brand` and `Schema.Literals`, as `Ref.ts`
  and `CommitId.ts` are.
- `kalfa/git/src/internal/object.ts`, its blob and tree bytes: searched Effect's encoding modules (nothing for git
  objects), npm's `isomorphic-git` (its tree writer is internal and Promise based), and
  `next/packages/libfabrika/src/node/repositories/internal/gitMemory.ts` (git's entry order; read as a lesson, since
  `kalfa/` may not import `next/`). Grown in place beside `bytes` and `hashed`.
- `kalfa/git/src/internal/object.ts`, `OBJECT_ID`: searched the package for a second copy of the id form (none). Moved
  from `CommitId.ts`, so `FORMATS` stays the one place an id's length lives.
- `kalfa/git/src/MemoryRepository.ts`, its `tree`: searched the package (`commit`, `add`, `point` and `byBytes` are
  the models) and Effect's `Digest` (`sha1`, `digestHex`, used as `commit` uses them). New, beside `commit`.
- `kalfa/git/src/internal/parse.ts`, the tree header: searched the landed header loop, which already reads `parent`,
  `author` and `committer`. Grown in place.
- `kalfa/git/src/History.test-support.ts`, the path arbitrary: searched the landed `partArb` and `alphabetText`, which
  draw ref name parts. Reused for the drawn part of a path.

## Calls taken

- **Modes and blobs now, not regular files only, 85%.** 1933 reads a mode change and a binary file by its blob ids,
  and 1935 must fail on a link, so a store of regular files only would make both change it. The ticket also says
  "trees and blobs".
- **`Store.trees` keeps a root tree's files flat by path, 85%.** Every caller in 1933, 1934 and 1935 asks by path.
  Folder ids are computed when hashing and not kept, since no planned call names a folder's tree. A later call that
  does can add a map beside it.
- **One `tree(store, files)` call puts the blobs and the tree in together, 85%.** A tree cannot enter the store
  without its blobs through the module's calls.
- **`path-conflict`, 80%.** It mirrors `BadStore`'s `ref-conflict` for the same kind of fault, and git calls it a
  directory/file conflict. The glossary's **Conflict** avoids "clash".
- **The id form moves to `internal/object.ts`, 80%.** An export on `CommitId.ts` would be public, since
  `./CommitId` is an entry point. `internal/object.ts` already holds what git's objects are.
- **The parser wants `tree` first and once, 80%.** That is git's own commit format; a header in another order is not
  a commit git wrote, and failing never guesses.
- **"A shared law run in memory and against real git" is S11 and S1 in the suite plus I5, 80%.** The suite compares
  each adapter with the model, never with another adapter, so the cross-check that memory's ids are git's is I5 in
  the integration file. M3 holds the same on every pull request with recorded ids.
- **`Path` is a string, so a path that is not UTF-8 cannot be one, 85%.** As a message is a `string` today. A real
  repository holding such a path fails a later read with a named error, never a guess.
- **Recorded vectors stay as recorded, 85%.** M1's fixture rows had git's empty tree, and the test supplies that id,
  so no recorded file is edited to say what the run did not print.
- **Is any of this a setting?** No. No call in this pull request reads a tree or a blob from git, so no size or count
  needs a limit yet: 1933 adds its file and byte limits and 1935 its file size limit, each required with no default.
  `MemoryRepository.tree` takes the files its caller holds. The path rules and git's entry order are facts of git's
  format, and a setting would let `/memory` disagree with git.

## Where the two drafts differed

| Point | 1933's draft | 1934's draft | Taken |
|---|---|---|---|
| What the store holds | blobs and modes (`Entry`) | contents only, regular files only | 1933's: the later tickets need modes and blob ids |
| Building a tree | `tree(store, files)` | `tree(files)`, then `addTree` | 1933's: no tree without its blobs |
| The conflict reason | `path-conflict` | `path-clash` | 1933's, by `ref-conflict` and the glossary |
| Path classes | grouped refusals in one class | one class per rule | 1934's, so each rule has its own plant; plus 1933's wide characters |
| M1's fixture | unchanged | rows gain `tree` | 1933's: a recorded vector stays as recorded |
| The tree vector | tree and commit ids | tree ids only | 1933's: it pins a commit with files too |
| Parser law | new P9 | P1 grown | 1934's: one law for the cat-file vector; this plan adds the "first" rule and the bad id |
| The id form | exported from `CommitId.ts` | exported from `CommitId.ts`, marked internal | neither: moved to `internal/object.ts` |
| Tree read-back | S1 against the seeder's tree ids | S1 with "same files, same tree" | both: S1 and S11; plus I5 and M5, which neither had |
| Glossary | Blob, Mode, Path | Tree id, Path | all four |

## Validation

- tests step: no dependency changes, so no install. Each plain law file alone, `nice -n 15 pnpm exec vitest run
  kalfa/git/src/<file>.test.ts`, red on the missing values. The `vector:` rows are recorded once with real git
  commands outside the repo, and each file's header names the git version and the command. The integration file is
  written and not run: the laptop refuses it.
- build step: each plain law file green, `pnpm format`, `pnpm lint`, and each plant in the laws table run once and
  undone. The integration file is not run on the laptop.
- The lead: a proof run that reaches `kalfa/git/src/ProcessRepository.integration.test.ts` before the
  review. The lead also checks the types, for T5 and the doc blocks.

## Size

1. Commits hold trees, and the memory store holds files: 204 lines (`MemoryRepository.ts` 70, `Tree.ts` 60,
   `internal/object.ts` 50, `internal/parse.ts` 15, `CommitId.ts` 5, `Commit.ts` 4). It lands whole: commits read
   back their trees in both adapters, and a test can build a memory store with files.

Plus the laws, one new `vector:` file, the grown cat-file vector, the README and four glossary terms. About 4 agent
hours, 75% sure; the doubt is the tests' share, since the history file grows a tree carrier and files on every shape.
Priced at about $10 a step at list price, as both drafts priced theirs: tests, build, review, and one likely send-back.

Estimate: 4 steps, $40

## New names

- `Tree` (the module), `TreeId`, `BlobId`, `Path`, `Mode`, `Entry`: git's own words (tree, tree id, blob, path, file
  mode, tree entry).
- `File`, `Store.trees`, `Store.blobs`, `MemoryRepository.tree`; `BadStore` reasons `missing-tree` and
  `path-conflict`.
- `Node.files`, `Seeded.trees` in the test entries.
- `OBJECT_ID`, `blob`, `treeBytes` in `internal/object.ts`.

## Records

- `kalfa/git/GLOSSARY.md` gains these terms in the build, after **Tree**:

  **Tree id**:
  The name git gives a tree from its content, as a commit id is a commit's.
  _Avoid_: tree hash, snapshot id

  **Blob**:
  A file's content as git stores it, named by its own id. Two files with the same bytes share one blob.
  _Avoid_: file content, object

  **Mode**:
  A file's kind in a tree, as git writes it: a file (100644), an executable file (100755) or a link (120000).
  _Avoid_: permissions, type, flags

  **Path**:
  Where a file sits in a tree: its folders and its name, joined by `/`.
  _Avoid_: file name, location, key

- `kalfa/git/README.md`: "Diffs, trees, writing a commit, moving a ref, fetch and push belong to other packages"
  becomes "Diffs, writing a commit, moving a ref, reading a file, fetch and push come in later tickets of this
  package".
- On https://github.com/kamp-us/tea-fabrika/issues/1933 and https://github.com/kamp-us/tea-fabrika/issues/1934, the
  lead notes when this lands that their plans drop slice 1 and branch from main.
- No new decision: the values follow git's format, and every call above is cheap to change before the first release.
  No pattern doc.

## What this cannot tell us

- Whether git's `fsck` refuses more `.git` look-alikes than `Path` does (the doubt at the top).
- Whether git releases after 2.40.1 hash or sort a tree differently: they should not, since ids are git's format, but
  the vectors come from 2.40.1 and I5 runs on whatever git the proof run holds.
- Whether a flat map per tree is fast enough for a large repository's tree in `/memory`: no law measures time, and
  `/memory` holds test stores only.
- Whether fast-import accepts every path `Path` accepts, such as a line break inside a part: I1 and I5 on the proof
  run will show it; a path it refuses would be a seeder fix or a narrower `Path`.

## Open questions

None.

The one call under 80% is taken and listed at the top as a doubt; tightening `Path` later changes nothing else.

## Findings

1. **A limit is fixed in code.** `kalfa/git/src/ProcessRepository.ts` holds `KILL_AFTER = Duration.seconds(5)`, the
   time a child that ignores the first signal gets before it is killed. The read plan's Amendment 2 chose a named
   constant unless a law needs it to change; today's rule that every limit is a setting says it should be a required
   value in `Limits`, beside `time`. 1934's draft found this too. Not changed here: a ticket for `@kalfa/git`.
2. **S10's closed list of keys is edited by every new call.** `kalfa/git/src/RepositoryTest.ts` lists the service's
   keys by name, so 1933, 1934 and 1935 each change one line there, and land near each other. The check is right; the
   lead resolves it by rebase. This pull request does not touch it.

## Lead's call at signing (2026-11-22): `Path` refuses what git's fsck refuses

The doubt at the top is settled by a run. On git 2.40.1, `git mktree` accepts and `git fsck --strict` refuses, as
`hasDotgit`, each of these names: `git~1` and `GIT~1`, `.git ` (a trailing space), `.GIT.` (a trailing dot), `.Git`,
and `.git` with a zero-width non-joiner inside (U+200C). `gitx` passes. So `Path` refuses a part that git's own
`verify_path` checks name as `.git` (`is_hfs_dotgit` and `is_ntfs_dotgit` in git's `utf8.c` and `path.c`): any
letter case; trailing spaces and dots dropped; the characters HFS ignores (U+200C to U+200F, U+202A to U+202E, U+206A
to U+206F, U+FEFF) dropped; and the short name `git~1`. G6's class (c) draws each of these forms, and its plant list
gains one plant per form. A path git refuses can never reach a commit, so the memory store and git agree on every id.
