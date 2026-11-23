Approved by the lead agent, builds issues 1750, 1932, 2012, 1933; body 009a62c2e1b1
Plancheck-Version: 3

# Plan: @kalfa/git, give a patch id and diff two commits, in memory and with the git binary (ticket 1933)

This is the kalfa packages (`kalfa/`), new work. It is not today's frozen version and not `next/`. The ticket is
https://github.com/kamp-us/tea-fabrika/issues/1933, a GitHub issue, so the first pull request says `Refs #1933`, the
last `Closes #1933`, and neither carries a `fabrika close ticket` line. Two slices, each its own pull request that
branches from main once the one under it has landed. They build on `@kalfa/git` as tickets 1932
(https://github.com/kamp-us/tea-fabrika/pull/1977) and 2012 (trees, https://github.com/kamp-us/tea-fabrika/pull/2013,
plan `.kalfa/quests/kalfa-git-trees-PLAN.md`) left it.

```ts
// The whole idea, a sketch. A caller yields the store and asks what changed between two commits.
const program = Effect.gen(function* () {
  const repo = yield* Repository.Repository;
  const id = yield* repo.patchId(base, tip);          // Option<PatchId>: none means git proved nothing changed (slice 1)
  // Delivery's carry rule: a changeset's own changes, measured from its merge base with main (slice 2).
  const approved = yield* repo.rangePatchId({ upstream: mainThen, commit: approvedTip });
  const now = yield* repo.rangePatchId({ upstream: mainNow, commit: newTip });
  const files = yield* repo.diff(base, tip);          // FileChange[]: each file, its added and removed lines (slice 2)
  return Option.isSome(now) && Equal.equals(approved, now) ? "kept" : "stale";
});
```

## Doubts, read first

- **What the size limit counts, 75%.** The ticket says a diff over the size limit fails and is never cut. This plan
  counts the bytes of every changed file's content, before and after, and checks that before any content is read,
  beside a limit on how many files one diff names. Counting only the answer's lines would need git's whole patch read
  first, which is the memory the limit exists to protect. The doubt: a one-line change to a large file (a lockfile)
  counts the whole file twice, so the app must set the limit high enough for its biggest file. What would settle it:
  the owner's word, or Delivery's first real run on this repo.

## What changes, in one paragraph

Slice 1 adds the raw call `patchId(from, to)` to both adapters, and two required limits: `files`, the most files one
diff names, and `diff`, the most bytes of file content one diff compares. `/process` asks git: `diff-tree` lists the
files and prints the patch, and `patch-id` names it. `/memory` diffs each changed file by line with its own Myers and
hashes the result, so its ids are its own. Slice 2 adds `rangePatchId`, a helper `Repository.make` writes once over
the raw calls for every adapter, and the raw call `diff(from, to)`, whose lines in `/process` are git's own. Out of
scope: the push plan and its remerge diff (1939), merge trees, writing a commit and moving a ref (1934), reading a file
and editing a tree (1935), renames and copies (never: every diff here runs with `--no-renames`).

## What 2013 left, and what this plan uses of it

- `Commit.tree`, and `Tree.ts`'s `TreeId`, `BlobId`, `Path`, `Mode` (`100644`, `100755`, `120000`; a submodule is not
  a mode) and `Entry` (a mode and a blob id).
- `MemoryRepository.Store.trees` holds each root tree's files flat by path, `Store.blobs` each blob's bytes, and
  `tree(store, files)` builds both. `/memory`'s diff compares two such maps by path.
- `internal/object.ts` exports `OBJECT_ID` (the id form, in one place) and `byBytes` (git's byte order). `PatchId`
  takes the first; path order takes the second.
- The history generator's files (`TREE_CLASSES`, `treeArb`, `treeCarrier`), the seeder that writes files with
  fast-import, and `Seeded.trees`.

This plan changes none of 2013's code: not `Tree.ts`, not `internal/object.ts`, and not `MemoryRepository.ts`'s
`tree`, `commit` or `add`. It adds calls beside them. `Mode` stays without `160000`: a submodule only ever reaches
these calls from git's raw list in `/process`, where the reader keeps it apart (below).

## Searched first

- The ticket, its parent https://github.com/kamp-us/tea-fabrika/issues/1750 with every comment, and the siblings
  1934, 1935 and 1939 whole, so this plan leaves them their calls. 1939's push plan reads this ticket's `diff`.
- `kalfa/git/GLOSSARY.md`, `kalfa/git/README.md`, `kalfa/AGENTS.md`, the landed plans
  `.kalfa/quests/kalfa-git-read-PLAN.md` and `.kalfa/quests/kalfa-git-trees-PLAN.md`, and every file in
  `kalfa/git/src/` as built on main: `Repository.ts` (`make` wraps five calls with a span and the time limit),
  `MemoryRepository.ts`, `ProcessRepository.ts` (the runner, `known`, `whole`, `firstBytes`), `internal/parse.ts`,
  `internal/object.ts`, `Tree.ts`, `Settings.ts`, `RepositoryTest.ts` (S9 wants one `git.` span per call; S10 pins
  the service's keys), `History.test-support.ts`, `ProcessSeed.test-support.ts`, `StandIn.test-support.ts`.
- Delivery's words and rulings: `kalfa/delivery/GLOSSARY.md` (**Carry rule**, **Kept**: "the approved changes apply to
  the base unchanged"), decision 0066 (the carry rule's default is `kept`: "an old approval must not cover different
  changes") and decision 0060 (Delivery builds the candidate with git).
- `rg -il` over `.kalfa/decisions`, `.kalfa/glossary`, `.kalfa/patterns`, `.kalfa/runbooks` and every kalfa
  glossary for "patch.id|patchId", "diff", "carry rule|carries approval", "remerge". Only the hits above bear on this.
- Effect 4.1.3 (the lockfile's version) in the installed source: `effect/process` (`ChildProcess.pipeTo`, and the
  Node spawner in `@effect/platform-node-shared`'s `NodeChildProcessSpawner.ts`), `effect/crypto/Digest` (`sha1`,
  `digestHex`), `Stream.runFold`, `Stream.takeUntil`, `Stream.mkUint8Array`.
- Facts from git 2.40.1, run by hand in a scratch folder outside the repo, not a test:
  - `diff-tree -r -z --no-renames A B` prints `:<mode> <mode> <id> <id> <status>\0<path>\0` with full ids and the
    path verbatim (a space, `é`); its patch output quotes the same `é` path as `"a/\303\251t\303\251"`.
  - A type change (a file made a link) is one raw entry with status `T` and two patch sections, a delete then a new
    file. A hunk header can carry text after its second `@@` (`@@ -2 +1,0 @@ a`). A last line with no newline is
    followed by `\ No newline at end of file`. A binary file prints `Binary files /dev/null and b/bin differ`.
  - `patch-id --stable --verbatim` is refused ("option `verbatim' is incompatible with --stable"). `--verbatim`
    alone works and depends on file order; `diff-tree` always lists files in path order, so the order is fixed.
  - With `-U0` and `--verbatim`: the same one-line edit on two bases that differ on the line next to it gives one id;
    a trailing space gives another (without `--verbatim` the two are equal); a last line with and without its newline
    give two ids; a file that is executable on the base but unchanged in mode gives the same id; a mode-only change
    gives an id; no change prints nothing.
  - A bare repository's own config (`diff.noprefix`, `diff.orderFile`, `diff.algorithm=patience`,
    `patchid.stable=true`) changed no `diff-tree` output and no id.

## How others do it

- **git's own plumbing** is the known way with no working copy: `git diff-tree` compares two commits' trees, and
  `git diff-tree -p A B | git patch-id` names the change. `git cherry` and `git rebase` use patch ids to find a
  commit that is already upstream. Run by hand above.
- **Gerrit** carries a vote across a new patch set when the change is a trivial rebase: the same edit on a new parent.
  Decision 0066 picked that for Delivery. From memory, not fetched.
- **GitHub** keeps an approval when a pull request's diff against its merge base did not change. From memory, not
  fetched; it is why the range here is measured from the merge base.
- **Gitaly** (GitLab's git service) parses git's own diff output and stops at limits on files, lines and bytes. From
  memory, not fetched. Here, as there, git makes the lines; unlike Gitaly, an answer over a limit is an error, never a
  shortened diff.
- **libgit2, JGit, go-git, isomorphic-git** compute diffs themselves (Myers, histogram). The memory adapter does
  that, with Myers, git's default. From memory, not fetched.
- **Elm and Erlang/OTP** have nothing to say here: no state lives between calls.

## The shape

### Slice 1: the patch id

```ts
// kalfa/git/src/Diff.ts, slice 1's part, a sketch.
// The name of a change: 40 lowercase hex. It is comparable only with ids the same adapter gave: /process's come from
// git's `patch-id`, /memory's from its own hash, and the two never match.
export const PatchId = Schema.String.check(Schema.isPattern(OBJECT_ID)).pipe(Schema.brand("@kalfa/git/PatchId"));

// kalfa/git/src/Settings.ts: Limits gains two required keys, no default.
//   files: Count   the most files one diff names; a type change counts once
//   diff:  Count   the most bytes of file content one diff compares: each changed file's content before and after
```

```ts
// kalfa/git/src/Repository.ts, a sketch of what slice 1 adds.
export class DiffTooLarge extends Schema.TaggedError<DiffTooLarge>()("DiffTooLarge", { most: Schema.Int }) {}
// TooMany's `limit` gains "files".

type Changes = NoSuchCommit | TooMany | DiffTooLarge | Fails;
// The calls an adapter writes. `make` wraps each and, from slice 2, adds the helpers, as Effect's
// ChildProcessSpawner.make derives its helpers from the one call an adapter writes.
export interface Raw {
  readCommit; readRefs; walk; mergeBases; isAncestor;                          // as 1932 left them
  readonly patchId: (from: CommitId, to: CommitId) => Effect.Effect<Option.Option<PatchId>, Changes>;
}
export class Repository extends Context.Service<Repository, Raw>()("@kalfa/git/Repository") {}
export const make: (raw: Raw, settings: Settings) => Repository["Service"];
```

- **patchId(from, to)**: the patch id of the changes from `from`'s tree to `to`'s, or none when the two trees are the
  same. A commit's own patch id is `patchId(parent, commit)`. It reads no history, so it answers in a shallow
  repository. The checks run in this order: both ids are commits the store holds (`NoSuchCommit`); the changed files
  are at most `limits.files` (`TooMany` with `limit: "files"`); their content, before and after, is at most
  `limits.diff` bytes (`DiffTooLarge`). All of it before any content is read.
- **What makes two ids equal.** The lines added and removed, each with its own line end, the file's path, and a mode
  only where it changes (a new or deleted file's mode, or both modes of a mode change). Not where a line sits, not the
  lines around it, not the blob ids of a text file. Whitespace counts. A binary file counts by its blob ids before and
  after.
- **/process**: `known` on both ids, then `diff-tree -r -z --no-renames <from> <to>` read through a fold that stops
  at `limits.files + 1` entries, then one `cat-file --batch-check` on the blob ids for their sizes, then `diff-tree -r
  -p -U0 --no-renames --no-ext-diff --no-textconv --full-index <from> <to>` read whole (its size is now bounded), and
  its bytes given as input to `patch-id --verbatim`. Two commands one after the other, never `ChildProcess.pipeTo`
  (Calls taken). An empty raw list is none, and `patch-id` is not run. A raw list with entries and a `patch-id` that
  prints nothing is `GitUnavailable` with reason `Unreadable`, never none. The runner's input becomes bytes, since a
  patch need not be UTF-8. A submodule entry (`160000`) in the raw list counts as a changed file of 0 bytes and its id
  is not asked about: `patch-id` hashes its `Subproject commit` lines as git does.
- **/memory**: compares the two commits' `Store.trees` maps by path, applies the same checks in the same order, and
  diffs each changed text file's bytes by line with Myers (`internal/lines.ts`). A file is binary when either side has
  a NUL in its first 8000 bytes, git's own rule. When a file's kind changes (a file becomes a link), every old line is
  removed and every new line added, as git prints it. The id is the sha-1 of each changed file, in path order
  (`byBytes`), written as its kind, its path, the modes that change, then each line as `-` or `+` and its bytes, or a
  binary file's two blob ids. Line bytes are hashed as they are, so a file that is not UTF-8 has an id.

### Slice 2: the range and the diff

```ts
// kalfa/git/src/Repository.ts, slice 2 adds the helper and the raw diff.
export class UnclearBase extends Schema.TaggedError<UnclearBase>()("UnclearBase", { bases: Schema.Array(CommitId) }) {}
export class NotUtf8 extends Schema.TaggedError<NotUtf8>()("NotUtf8", { path: Tree.Path }) {}
export class NotAFile extends Schema.TaggedError<NotAFile>()("NotAFile", { path: Schema.String }) {}  // a submodule; its path is git's raw text
// Raw gains:
readonly diff: (from: CommitId, to: CommitId) => Effect.Effect<Diff.Diff, NotUtf8 | NotAFile | Changes>;
// Repository's service is Raw plus what make writes once:
readonly rangePatchId: (range: { readonly upstream: CommitId; readonly commit: CommitId })
  => Effect.Effect<Option.Option<PatchId>, UnclearBase | HistoryTooShort | Changes>;
```

```ts
// kalfa/git/src/Diff.ts, slice 2's part, a sketch.
// A line keeps its own end ("b\n", "b\r\n"); a last line with no newline has none. `at` counts from 1, in the old
// file for a removed line and in the new file for an added one.
export const Line = Schema.Union([
  Schema.TaggedStruct("Removed", { at: Schema.Int, text: Schema.String }),
  Schema.TaggedStruct("Added", { at: Schema.Int, text: Schema.String }),
]);
export const Content = Schema.Union([
  Schema.TaggedStruct("Text", { lines: Schema.Array(Line) }),   // in file order; in each change block, removed first
  Schema.TaggedStruct("Binary", {}),
]);
export const FileChange = Schema.Union([
  Schema.TaggedStruct("New", { path: Tree.Path, after: Tree.Entry, content: Content }),
  Schema.TaggedStruct("Deleted", { path: Tree.Path, before: Tree.Entry, content: Content }),
  Schema.TaggedStruct("Modified", { path: Tree.Path, before: Tree.Entry, after: Tree.Entry, content: Content }),
]);
export type Diff = ReadonlyArray<typeof FileChange.Type>;   // sorted by the path's UTF-8 bytes, git's order
```

- **rangePatchId({ upstream, commit })**: `mergeBases(commit, upstream)` through the raw call; exactly one base `b`
  gives `patchId(b, commit)`; none or two and more fail with `UnclearBase` naming them, never a guess. It is one call:
  one span and one time limit around both raw calls.
- **diff(from, to)**: every file the two trees differ in, with its added and removed lines; `[]` when they are the
  same. The checks are `patchId`'s, in its order, with two more: after the files limit, a submodule entry fails with
  `NotAFile`; after the size limit, a text file whose lines are not UTF-8 fails with `NotUtf8` naming the first such
  file in path order. A mode-only change and an empty new file are `Text` with no lines. A type change is one
  `Modified` entry.
- **/process** reads the raw list and sizes as slice 1 does, then the `-U0` patch, and matches each raw entry to its
  patch section in order: one section each, two for a `T` entry. Paths come from the raw list only, so no quoted
  path is ever parsed. A section count that does not match is `Unreadable`. The binary answer is git's.
- **/memory** answers from slice 1's line diff, decoded as UTF-8 with no replacement.

### Where the two adapters may differ

The owner allowed this for merges on 1934 ("the shared laws avoid the cases where it and git differ, and the ticket
names those cases"), and the same holds here. The diff's lines can differ in two cases, and the shared laws draw
neither:

- **More than one smallest diff.** A change block among repeated lines can be shown with other lines; git also moves
  blocks by its indent heuristic. The generator makes every edit with one smallest diff (kept lines in order, every
  inserted line new to the file).
- **Binary by attributes.** git may read a `.gitattributes` file and call a text file binary; `/memory` uses only the
  NUL rule. Our bare repositories hold no attribute file in `info/`. Whether a newer git reads a commit's
  `.gitattributes` in a bare repository is not known here (below).

Patch ids never match across adapters, so no law compares them across adapters; each law relates ids from one adapter.

### The spans (decision 0063)

| Call | Span | Attributes |
|---|---|---|
| patchId | `git.patchId` | `vcs.ref.base.revision` = from, `vcs.ref.head.revision` = to, `kalfa.git.patch` = the id, only when there is one |
| rangePatchId | `git.rangePatchId` | `vcs.ref.base.revision` = upstream, `vcs.ref.head.revision` = commit, `kalfa.git.base` = the merge base when there is one, `kalfa.git.patch` |
| diff | `git.diff` | `vcs.ref.base.revision` = from, `vcs.ref.head.revision` = to, `kalfa.git.files` and `kalfa.git.lines` = how many |

No path, line text or file content is ever an attribute: a path can hold a person's name and a line can hold
anything. `rangePatchId` makes one `git.` span; its raw calls are not wrapped again.

## One value traced: a change rebased onto a newer main

The store: `M0` has `src/a.ts` (`a\nb\nc\n`) and `README`. `M1` is `M0` with `README` changed. The change request's
first changeset is `B1`, on `M0`, with line 2 of `src/a.ts` made `B`. Its second changeset `B2` is the same edit
rebased onto `M1`. Limits: `files` 100, `diff` 1000000.

1. Slice 1: `repo.patchId(M0, B1)` in `/process`: `cat-file --batch-check` says both are commits; the raw list has
   one entry, `M src/a.ts`; sizes 6 and 6, so 12 bytes, under the limit; `diff-tree -p -U0` prints one hunk
   `@@ -2 +2 @@`, `-b`, `+B`; `patch-id --verbatim` prints `p1 0000...`. Answer `Some(p1)`.
2. `repo.patchId(M1, B2)`: the same two lines on the same path, so `patch-id` prints `p1` again.
3. Had the author changed line 2 to `B ` (a trailing space) instead, the id would be `p2`. Without `--verbatim` git
   would call these the same.
4. Slice 2, approval time: `repo.rangePatchId({ upstream: M0, commit: B1 })`. `mergeBases(B1, M0)` is `[M0]`, so the
   answer is step 1's `Some(p1)`. Delivery stores `p1` with the approval. One span, `git.rangePatchId`, with
   `kalfa.git.base` = M0 and `kalfa.git.patch` = p1.
5. New changeset: `repo.rangePatchId({ upstream: M1, commit: B2 })` is step 2's `p1`. Delivery: kept.
6. If the author merged `M1` into the branch instead of rebasing (`B3`, parents `B1` and `M1`), `mergeBases(B3, M1)`
   is `[M1]` and the diff from `M1` to `B3` is the same edit, so the id is `p1` and the approval is kept.
7. `repo.diff(M1, B2)` answers `[Modified { path: "src/a.ts", before, after, content: Text [Removed { at: 2, text:
   "b\n" }, Added { at: 2, text: "B\n" }] }]`. `/memory` with the same store gives the same value: one smallest diff
   exists.
8. With `limits.diff` 11, `patchId`, `rangePatchId` and `diff` all fail with `DiffTooLarge { most: 11 }` before git
   prints a patch.

## What fact is lost if not recorded now

A patch id is derived: it can be computed again from the two commits as long as they exist. Two facts are kept now:

- **What a patch id means** (no context lines, whitespace kept, path order, a mode only where it changes). Delivery
  will store ids with approvals. If the rule changed later, every stored id would compare as stale. The README and the
  glossary write the rule down, and the ids carry no version.
- **A line's own end and each file's blob ids** stay in the `Diff` value, so a pre-push hook can tell a lost newline
  from no change and can read a binary file later (1935's `readFile`).

## Generators

The generators live in `kalfa/git/src/History.test-support.ts`, beside 2013's tree classes. An edit turns one set of
files into another; each is drawn with one smallest diff, from files 2013's `treeArb` draws. Each class below is
checked in every run, made from the run's drawn value, as 1932's and 2013's classes are.

Edits (both slices):

- (a) a new file, a deleted file, a changed file, and a file made a link.
- (b) a mode-only change.
- (c) binary: a NUL in the first 8000 bytes on one side; and a NUL at byte 8001, which is text.
- (d) line ends: a last line that loses its newline and one that gains it; CRLF lines; a change of whitespace only.
- (e) a text file in latin-1 bytes, after files that pass every check.
- (f) no change: `from` equal to `to`; and an empty file added.
- (g) several change blocks in one file, at its first line and at its last.
- (h) limits: changed files exactly `limits.files` and one more; content exactly `limits.diff` bytes and one more; and
  a case over both.
- (i) an id the store lacks on either side, and a tree's id given as a commit.
- (j) a submodule entry (mode 160000) in git's raw output.
- (k) 2013's path classes in an edit: the sort traps (`a.b`, `a/b`, `a-b`, `a0`), characters past U+024F and from
  U+E000 to U+FFFF, and `__proto__`.

Patch ids (slice 1) and ranges (slice 2):

- (l) the same edit on two bases that differ: in another file, on the line next to the edit, and where the edited
  file is executable on one base.
- (m) one line changed from the drawn edit: other text, a trailing space, its line end only.
- (n) a binary edit with other bytes, and the drawn edit with a mode change added.
- (o) the upstream merged into the branch, so a merge commit is among the branch's own commits.
- (p) no common history, and a criss-cross with two merge bases.
- (q) a shallow repository.
- (r) a range whose own changes are none: the branch's tip is its merge base.

## Laws

Laws use `it.effect.prop` from `@effect/vitest` 4.1.3 with Effect's own `Arbitrary`, as 1932's do. S laws are in
`RepositoryTest.suite`, so they run on `/memory` in `MemoryRepository.test.ts` (100 runs) and on `/process` in
`ProcessRepository.integration.test.ts` (10 runs, law I1).

| Law | Kind (lint, type or test?) | Generator | Plant | Where |
|---|---|---|---|---|
| G5, settings, now with `files` and `diff` (slice 1): both required whole counts of 1 or more; limits without either do not decode | test | Effect Arbitrary: limits | give `diff` a default: red; accept `files: 0`: red | kalfa/git/src/Values.test.ts |
| G9, patch ids (slice 1): `PatchId` accepts and refuses as `CommitId` does. 200 runs | test | Effect Arbitrary: commitIdArb | accept uppercase hex: red | kalfa/git/src/Values.test.ts |
| T4, the brand (slice 1): a `PatchId` is not a `CommitId`, a `TreeId` or a `BlobId`, and a plain string is not a `PatchId` | type | type | drop the brand on `PatchId`: an `@ts-expect-error` is unused, red | kalfa/git/src/Values.types.test.ts |
| M5, memory's line diff is a smallest one (slice 1): for any two byte texts, applying the answer to the first gives the second, and it holds `n + m - 2 * LCS` lines, the LCS from a plain table in the test. 300 runs | test | Effect Arbitrary: linesArb | match lines greedily from the top: red | kalfa/git/src/internal/lines.test.ts |
| S11, the same edit gives the same id (slice 1): for each base pair the class draws, `patchId(base, base + edit)` is equal on both. memory 100 runs, process 10 | test | Effect Arbitrary: rebaseArb | hash each line's number, (l) red; hash the base's mode where it does not change, (l) red | kalfa/git/src/RepositoryTest.ts |
| S20, a different edit gives a different id (slice 1): each changed edit the classes draw gives an id unlike the drawn edit's | test | Effect Arbitrary: rebaseArb | strip whitespace before hashing, (m) red; drop each line's end, (m) red; hash a binary file by its path alone, (n) red; leave modes out, (n) red | kalfa/git/src/RepositoryTest.ts |
| S21, none means no change (slice 1): `patchId(x, x)` is none; a mode-only change, an empty new file and a latin-1 file each have an id. memory 100 runs, process 10 | test | Effect Arbitrary: editArb | answer an id for no change, (f) red; answer none for a mode-only change, (b) red; fail on bytes that are not UTF-8, (e) red | kalfa/git/src/RepositoryTest.ts |
| S15, limits never cut (slice 1, and `diff` in slice 2): at exactly `limits.files` files and exactly `limits.diff` bytes the call answers; one more fails with `TooMany` (`limit: "files"`) or `DiffTooLarge`; over both is `TooMany`. memory 100 runs, process 10 | test | Effect Arbitrary: limits | delete the files check, (h) red; delete the size check, (h) red; count `>=` for `>`: red; check the size before the files: red | kalfa/git/src/RepositoryTest.ts |
| S16, unknown ids (slice 1, and `diff` in slice 2): an id the store lacks, or a tree's id, on either side fails with `NoSuchCommit` naming it, never none or `[]`. memory 100 runs, process 10 | test | Effect Arbitrary: range | answer none for an unknown `from`, (i) red | kalfa/git/src/RepositoryTest.ts |
| S9 and S10, spans and keys, extended (both slices): each new call ends one `git.` span with the attributes the spans table gives, and none holds a seeded path, line or content; the service's keys are the five, `patchId`, then `rangePatchId` and `diff` | test | Effect Arbitrary: history | annotate the path, (k) red; let `rangePatchId` call the wrapped calls, three spans: red | kalfa/git/src/RepositoryTest.ts |
| P13, the raw list (slice 1): `parse.changes` reads each entry of a recorded `diff-tree -r -z` output: statuses A, D, M and T, a path with a space, a tab and `é`, and a submodule entry kept apart as a gitlink | test | vector: git 2.40.1 diff-tree raw output | split entries on spaces, not NUL: the spaced path red; read 160000 as a file and ask `cat-file` its size, (j) red | kalfa/git/src/internal/parse.test.ts |
| P14, `/process`'s patch id on the stand-in (slice 1): the commands are exactly `cat-file --batch-check`, `diff-tree -r -z --no-renames`, `cat-file --batch-check`, `diff-tree -r -p -U0 --no-renames --no-ext-diff --no-textconv --full-index`, `patch-id --verbatim`, and the patch reaches `patch-id` byte for byte; an empty raw list answers none with no later command; `files + 1` entries is `TooMany` with no size check run; sizes over the limit are `DiffTooLarge` with no `diff-tree -p` run; `patch-id` printing nothing after a raw list with entries is `GitUnavailable` reason `Unreadable`. 100 runs | test | Effect Arbitrary: patchScript | read empty `patch-id` output as none: red; add `--stable`: red; run `diff-tree -p` before the size check: red; pipe `diff-tree` into `patch-id`: the stand-in sees one piped command, red | kalfa/git/src/ProcessRepository.test.ts |
| T5, the calls' types (both slices): `patchId`, `rangePatchId` and `diff` have exactly the answer and error unions this plan's sketch gives, with `never` as their requirement; `Raw` has no `rangePatchId` | type | type | add `NotUtf8` to `patchId`'s errors: red; require `rangePatchId` of an adapter: red | kalfa/git/src/Repository.types.test.ts |
| I5, a repository's config steers nothing (slice 1, and `diff` in slice 2): with `diff.noprefix`, `diff.orderFile`, `diff.algorithm=patience` and `patchid.stable=true` in the bare repository's config, each call answers what it answers without it | test | scenario: one bare repository, its config with and without those four lines | run porcelain `git diff`, which reads them, in place of `diff-tree`: red | kalfa/git/src/ProcessRepository.integration.test.ts |
| I8, a submodule on real git (slice 1, and `diff` in slice 2): a commit with a gitlink entry, made with fast-import, gets a patch id, and `diff` over it fails with `NotAFile` naming it | test | scenario: one fast-import commit with a 160000 entry, since `/memory` cannot hold one | ask `cat-file` the gitlink's size: `patchId` fails, red; read 160000 as a file in `diff`: red | kalfa/git/src/ProcessRepository.integration.test.ts |
| K1, the manifest (slice 1): `kalfa/git/package.json` exports `./Diff`, and still has no `dependencies` | test | scenario: the package's own manifest at head | add a `diff` package from npm to `dependencies`: red | kalfa/git/src/Package.test.ts |
| S14, the range (slice 2): `rangePatchId` equals `patchId(base, commit)` for the one merge base; a branch with the upstream merged in gives the rebased branch's id; a tip that is its own merge base is none; no common history and a criss-cross fail with `UnclearBase` naming the bases; a shallow store fails with `HistoryTooShort`. memory 100 runs, process 10 | test | Effect Arbitrary: rangeArb | use `upstream` itself as the base, (o) red; take the first of two merge bases, (p) red; read the merge bases without the shallow check, (q) red; refuse a merge base equal to the commit, (r) red | kalfa/git/src/RepositoryTest.ts |
| S17, the diff (slice 2): for every edit the classes draw, `diff(base, base + edit)` is the model's answer exactly: the files in path byte order, each tag, entries and lines with their `at`, and `[]` for no change. memory 100 runs, process 10 | test | Effect Arbitrary: editArb | report a type change as two files, (a) red; drop mode-only changes, (b) red; strip each line's end, (d) red; fail on an empty new file, (f) red; join two change blocks into one, (g) red; sort paths with JavaScript's `<`, (k) red | kalfa/git/src/RepositoryTest.ts |
| S18, binary and text (slice 2): a NUL in the first 8000 bytes on either side is `Binary`; a NUL only past byte 8000 is `Text`. memory 100 runs, process 10 | test | Effect Arbitrary: editArb | drop the binary check, (c) red; look for a NUL in the whole file, (c) red | kalfa/git/src/RepositoryTest.ts |
| S19, not UTF-8 (slice 2): `diff` over the latin-1 file fails with `NotUtf8` naming it, while `patchId` over the same edit answers an id. memory 100 runs, process 10 | test | Effect Arbitrary: editArb | decode with replacement, (e) red | kalfa/git/src/RepositoryTest.ts |
| P12, the patch reader (slice 2): `parse.patch` reads every section of a recorded `diff-tree -p -U0` output to the value its note gives: text after a hunk header's second `@@`, `\ No newline at end of file`, a binary file, a `T` entry's two sections, an empty new file, a mode-only change; a section count unlike the raw list's is `Unreadable` | test | vector: git 2.40.1 diff-tree patch output | read the text after the second `@@` as a line: red; delete the section count check: red | kalfa/git/src/internal/parse.test.ts |

**Every check that guards data has its class and its plant.** In call order: `NoSuchCommit` (i), the files limit
(h), `NotAFile` (j), the size limit (h), `NotUtf8` (e), `UnclearBase` (p), the shallow check (q). Each class passes
every check before its own, and each plant deletes that check. 2013's checks (paths, `missing-tree`,
`path-conflict`) keep their own laws and are not touched.

**Where each law runs.**

- G, T, M, P and K laws, and every S law on `/memory`: plain files, on every pull request their change reaches, and on
  the laptop with a narrow path. T laws run under `pnpm typecheck`.
- I1 (the S laws on `/process`), I5 and I8 run the real git binary in temp folders, so they are
  `ProcessRepository.integration.test.ts`. A stand-in cannot do their job: they are the thin proof that real git
  answers what the stand-in and `/memory` answer, and every behavior they check has a plain law above. The laptop
  refuses that file by name, and pull requests and the merge queue run no `.integration.` law, so the lead starts a
  proof run for each slice, which runs the integration laws its changed files reach, after the build and before the
  review.
- No law is host-only: none needs launchd, Electron, a real signal or the owner's Mac.
- No secret flows through these calls, so no law is a `[secrets]` law. The span laws check that no path, line or
  content reaches an attribute.

## Files

Slice 2 branches from main after slice 1 lands. A file touched in both slices has a row for each.

| Slice | File | Owner | Product lines expected | Change |
|---|---|---|---|---|
| 1 | kalfa/git/src/Diff.ts | build | 15 | new: `PatchId` |
| 1 | kalfa/git/src/Settings.ts | build | 12 | `limits.files`, `limits.diff` |
| 1 | kalfa/git/src/Repository.ts | build | 40 | `Raw`, `patchId` in the contract and its span in `make`, `DiffTooLarge`, `TooMany`'s `files` |
| 1 | kalfa/git/src/internal/lines.ts | build | 70 | new: split bytes into lines with their ends, git's NUL rule, Myers on lines, change blocks with removed lines first |
| 1 | kalfa/git/src/MemoryRepository.ts | build | 55 | the tree compare over `Store.trees`, the checks in order, the patch id hash; 2013's code unchanged |
| 1 | kalfa/git/src/internal/parse.ts | build | 35 | `changes` (the raw `-z` list, a gitlink kept apart), the `patch-id` line |
| 1 | kalfa/git/src/ProcessRepository.ts | build | 60 | bytes as input, the counting fold for the raw list, the checks before content, `patchId` |
| 1 | kalfa/git/README.md | build | docs | `patchId`, what makes two ids equal, ids compare within one adapter, the two limits |
| 1 | kalfa/git/GLOSSARY.md | build | docs | **Binary file**; **Patch id** gains its rule |
| 1 | kalfa/git/package.json | tests | tests | export `./Diff` |
| 1 | kalfa/git/src/History.test-support.ts | tests | tests | edits with one smallest diff, classes (a) to (n), the model's patch id relation |
| 1 | kalfa/git/src/RepositoryTest.ts | tests | tests | S9, S10, S11, S20, S21, S15, S16; `settings()` gains `files` and `diff` |
| 1 | kalfa/git/src/ProcessSeed.test-support.ts | tests | tests | a gitlink entry for I8, if fast-import's `M 160000` needs a helper |
| 1 | kalfa/git/src/internal/lines.test.ts | tests | tests | new: M5 |
| 1 | kalfa/git/src/internal/parse.test.ts | tests | tests | P13 |
| 1 | kalfa/git/src/ProcessRepository.test.ts | tests | tests | P14 |
| 1 | kalfa/git/src/StandIn.test-support.ts | tests | tests | records each command's input bytes, and a piped command as one |
| 1 | kalfa/git/src/Repository.types.test.ts | tests | tests | T5 for `patchId` |
| 1 | kalfa/git/src/Values.test.ts | tests | tests | G5, G9 |
| 1 | kalfa/git/src/Values.types.test.ts | tests | tests | T4 |
| 1 | kalfa/git/src/ProcessRepository.integration.test.ts | tests | tests | I5, I8 for `patchId` |
| 1 | kalfa/git/src/Package.test.ts | tests | tests | K1's export list |
| 1 | kalfa/git/src/fixtures/diff-tree-raw-2.40.1.json | tests | tests | new: `vector:` raw `-z` output with a note per entry |
| 2 | kalfa/git/src/Repository.ts | build | 60 | `rangePatchId` written once in `make` with its span and one time limit, `UnclearBase`; `diff` in the contract and its span, `NotUtf8`, `NotAFile` |
| 2 | kalfa/git/src/Diff.ts | build | 70 | `Line`, `Content`, `FileChange`, `Diff` |
| 2 | kalfa/git/src/MemoryRepository.ts | build | 30 | `diff`: lines decoded, entries built |
| 2 | kalfa/git/src/internal/parse.ts | build | 75 | `patch`: the `-U0` sections matched to the raw list |
| 2 | kalfa/git/src/ProcessRepository.ts | build | 35 | `diff`, its gitlink check |
| 2 | kalfa/git/README.md | build | docs | `rangePatchId`, `diff`, the two cases where the adapters may differ |
| 2 | kalfa/git/GLOSSARY.md | build | docs | **Upstream**, **Diff** |
| 2 | kalfa/git/src/RepositoryTest.ts | tests | tests | S10's keys, S14, S15 and S16 for `diff`, S17 to S19 |
| 2 | kalfa/git/src/History.test-support.ts | tests | tests | the model's diff, classes (o) to (r) |
| 2 | kalfa/git/src/internal/parse.test.ts | tests | tests | P12 |
| 2 | kalfa/git/src/Repository.types.test.ts | tests | tests | T5 for `rangePatchId` and `diff` |
| 2 | kalfa/git/src/ProcessRepository.integration.test.ts | tests | tests | I5, I8 for `diff` |
| 2 | kalfa/git/src/fixtures/diff-tree-patch-2.40.1.json | tests | tests | new: `vector:` `-U0` patch output with a note per section |
| both | package.json | tests | tests | no change: the root manifest; `@kalfa/git` is already a root dev dependency |

**Files 1934 may touch too.** `Repository.ts` (its contract, `Raw`, `make`, a helper of its own), `Settings.ts` (1934
adds `committer`, this plan adds two limits), `MemoryRepository.ts`, `ProcessRepository.ts` (the runner's input as
bytes is the likeliest overlap), `internal/parse.ts`, `README.md`, `GLOSSARY.md`, `package.json`, and the test files
`History.test-support.ts`, `RepositoryTest.ts` (S9, S10 and `settings()`), `StandIn.test-support.ts`,
`Repository.types.test.ts`, `Package.test.ts`, `ProcessRepository.test.ts`, `ProcessRepository.integration.test.ts`.
The second to land rebases. No root file changes: no new package, no lockfile, no lint row (`kalfa/git/src/**` is
already held by the overrides and the Effect block).

## Existing tools

- `kalfa/git/src/Diff.ts`: searched Effect 4.1.3 for a diff or hunk schema (none; `Differ` diffs data values) and npm's
  `parse-diff` types (its file and chunk shape keeps line numbers and context, and is no Effect Schema). New tagged
  unions on `Schema.TaggedStruct`; `PatchId` on 2013's `OBJECT_ID`.
- `kalfa/git/src/internal/lines.ts`: searched the repo (`rg -il "myers|longest common subsequence"`: one e2e script,
  no line diff), the installed packages (no `diff` or Myers package), npm's `diff` (jsdiff) and `fast-myers-diff`
  (either would be the package's first dependency, which K1 refuses, and neither works on bytes), and Effect's
  `Differ` (it diffs data values, not lines). About 70 lines of Myers, written from the paper.
- `kalfa/git/src/Settings.ts`, the two limits: searched `kalfa/config` and Code hosting's `codehost.list.most` for a
  diff limit's shape (none); two keys on the `Limits` 1932 built, as `commits` and `refs` are.
- `kalfa/git/src/internal/parse.ts`, its `changes` and `patch` readers: searched npm for a parser of git's raw and
  patch output that is Effect (none; `parse-diff` and `gitdiff-parser` read quoted paths from headers, which this plan
  never does).
- `kalfa/git/src/MemoryRepository.ts`, its tree compare and patch id hash: searched the package (2013's `Store.trees`,
  `byBytes` and `commit` are used as they are) and Effect's `Digest` (`sha1`, `digestHex`, used as 1932 uses them).
- `kalfa/git/src/ProcessRepository.ts`, its counting fold and `patchId`: searched the package (the runner, `known` and
  `firstBytes` are the models) and Effect's `Stream.takeUntil` and `Stream.runFold`, used for the fold.
  `ChildProcess.pipeTo` was searched and not used (Calls taken).
- `kalfa/git/src/Repository.ts`, `Raw` and `rangePatchId`: searched Effect's `ChildProcessSpawner.make`, which derives
  helpers from the one call an adapter writes, the model for writing the helper once in `make`.

## Calls taken

- **Two commands, never `ChildProcess.pipeTo`, 90%.** In Effect 4.1.3 the Node spawner runs a piped command and
  returns a handle whose `exitCode` is the last command's alone (`@effect/platform-node-shared`
  `src/NodeChildProcessSpawner.ts`, the `PipedCommand` case: `exitCode: handle.exitCode` of
  `handles[handles.length - 1]`). So with `diff-tree | patch-id`, a failing `diff-tree` hands `patch-id` empty input,
  `patch-id` exits 0 and prints nothing, and the call would answer "no change" from a failure. `/process` runs
  `diff-tree`, keeps its output (bounded by the limits), and gives it to `patch-id` as input. P14's plant holds it.
  The proof is a read of the source, not a run, so no upstream issue yet; a repro would show whether it is a bug or a
  shell's choice without `pipefail`.
- **The range is measured from its one merge base, 80%.** The glossary's patch id names "a range's changes", and
  Delivery's kept means "the approved changes apply to the base unchanged": one edit, not a list of commits. So a
  squash, a reorder or a merge of main into the branch keeps the approval when the edit is the same. A list of
  per-commit ids would call those stale.
- **The raw `patchId` takes two commits, as `diff` does, 80%.** "The patch id of a commit" is `patchId(parent,
  commit)`, still one raw call, and rebase (1936) can use it to skip a commit already upstream. A root commit has no
  parent and no patch id here.
- **No context lines and whitespace kept: `-U0` and `--verbatim`, 80%.** The glossary says a patch id comes "from
  the lines added and removed and not from where they sit", which is `-U0`. Decision 0066 says an old approval must
  not cover different changes, and an indentation change is a different change, so whitespace counts. Run by hand:
  `--stable` cannot join `--verbatim`, and `diff-tree`'s fixed path order makes that safe.
- **`/process` asks git for the lines, and `/memory` has its own Myers, 80%.** The owner put diff among the raw calls
  each adapter makes, and `/process` is the git binary. The laws avoid the cases where the two may differ, and the
  README names them, as the owner allowed for merges on 1934.
- **`/memory`'s patch ids are its own and never equal git's, 80%.** Matching git byte for byte would mean writing
  git's patch text and its `patch-id` parser over again; no caller mixes ids of two adapters. M1 still holds memory's
  commit ids to git's.
- **The size limit counts content before and after, with a files limit beside it, 75%** (doubt at the top).
- **Patch id first, then the range with the diff, 80%.** The patch id is the smallest call that needs the line diff,
  the raw list and the limits, so it lands that core under 300 lines; the range and the diff then add about 30 and
  240 lines on it. Delivery's carry rule can use `patchId` with its own merge base after slice 1 and `rangePatchId`
  after slice 2.
- **A submodule gets a patch id but fails `diff` with `NotAFile`, 80%.** `patch-id` hashes a gitlink's
  `Subproject commit` lines, so the id is git's own; a diff answers files and lines, and a submodule is neither.
  `Tree.Mode` stays as 2013 left it, without `160000`.
- **A line keeps its own end, 85%.** "x" and "x\n" are two edits to git, so the value must tell them apart.
- **`diff` fails on a text file that is not UTF-8, and `patchId` hashes bytes and does not, 80%.** A diff gives text,
  and git's text is UTF-8 or it is not text, as 1932's parser says. A patch id needs no text.
- **`rangePatchId` is one call made in `make`, 80%.** One span and one time limit around its two raw calls, so S9's
  one-span rule holds and a slow helper still ends. 1934's merge commit helper can take the same shape.
- **No change is none, never an empty id, 85%.** git's `patch-id` prints nothing then, and none says git proved it.
- **Is any of this a setting?** The two limits are, required and with no default. Not settings: `-U0`, `--verbatim`
  and what makes two ids equal (a change would make every stored id mean something else); git's 8000-byte binary rule
  (a setting would let `/memory` disagree with git); `--no-renames` (a rename is a delete and a new file to every
  caller here); the merge-base rule.

## Validation

- tests step, per slice: each plain law file alone, `nice -n 15 pnpm exec vitest run kalfa/git/src/<file>.test.ts`,
  red on the missing calls. The `vector:` files are recorded once with real git commands, and each file's header names
  the git version and the command. The integration file is written and not run: the laptop refuses it.
- build step, per slice: each plain law file green, `pnpm format`, `pnpm lint`, and each plant in the laws table run
  once and undone. The integration file is not run on the laptop.
- The lead, per slice: a proof run of `kalfa/git/src/ProcessRepository.integration.test.ts` before the review.
- The lead runs its own typecheck per slice, for T4 and T5.

## Size

1. Slice 1, the patch id: 287 lines (`internal/lines.ts` 70, `ProcessRepository.ts` 60, `MemoryRepository.ts` 55,
   `Repository.ts` 40, `internal/parse.ts` 35, `Diff.ts` 15, `Settings.ts` 12). It lands whole: two commits get a
   patch id in both adapters, within both limits. It cannot be cut by adapter, since the contract gains `patchId` for
   both.
2. Slice 2, the range and the diff: 270 lines (`internal/parse.ts` 75, `Diff.ts` 70, `Repository.ts` 60,
   `ProcessRepository.ts` 35, `MemoryRepository.ts` 30). It lands whole: Delivery's carry rule calls `rangePatchId`,
   and 1939's push plan can read `diff`.

About 557 product lines in all, plus the laws, two `vector:` files, the README and the glossary terms. About 7 agent
hours across the steps, 70% sure. The doubt: the edit generator with one smallest diff, the largest test piece. Priced
at about $10 a step at list price, a little under 1932's $12 for a larger slice: tests, build and review for each
slice, and one send-back each.

Estimate: 8 steps, $80

## New names

- `Diff`, `FileChange` with `New`, `Deleted`, `Modified`; `Line` with `Removed`, `Added`; `Content` with `Text`,
  `Binary`; `PatchId`.
- `diff`, `patchId`, `rangePatchId`, `Raw`; `upstream` (git's word, as `git cherry` and `git rebase` use it).
- `limits.files`, `limits.diff`; `DiffTooLarge`, `NotAFile`, `NotUtf8`, `UnclearBase`; `TooMany`'s `files`.
- Spans `git.diff`, `git.patchId`, `git.rangePatchId`; attributes `kalfa.git.files`, `kalfa.git.lines`,
  `kalfa.git.patch`, `kalfa.git.base`.

## Records

- `kalfa/git/GLOSSARY.md` gains these terms, each in its slice's build (2013 already added Tree id, Blob, Mode and
  Path):

  **Binary file** (slice 1):
  A file git does not split into lines: one with a NUL byte in its first 8000 bytes. A diff names it and its blobs,
  with no lines.
  _Avoid_: blob (every file is one), non-text

  **Upstream** (slice 2):
  The commits a branch's own changes are measured against, such as main, in git's own word.
  _Avoid_: target, base (a branch's own), parent branch

  **Diff** (slice 2):
  The files two commits differ in, each with the lines added and removed.
  _Avoid_: patch, change set, delta, changes

- **Patch id** keeps its words and gains one sentence in slice 1: "Whitespace and a line's end count; the lines around
  a change do not; a patch id compares only with ids the same adapter gave."
- No new decision: the owner's answers on 1750 and decision 0066 hold the design, and every call above is cheap to
  change before the first release. No pattern doc.

## What this cannot tell us

- Whether a git newer than 2.40 reads a commit's own `.gitattributes` in a bare repository and calls a text file
  binary. I recall git 2.43 began reading attributes from HEAD in a bare repository, and did not check it. If so,
  `/process` can answer `Binary` where `/memory` answers `Text` on a repository with such a file.
- Whether git 2.38 and 2.39 take `patch-id --verbatim` as 2.40.1 does. I recall `--verbatim` came in 2.33, and did not
  check it; the laws run on whatever git CI and the proof run hold.
- Whether the content limit's numbers fit real changes: no caller is built, and this repo's own lockfile size is the
  first real test.
- How fast Myers is on two large files with many changes: no law measures time; the time limit stops a slow call.
- Whether the indent heuristic makes git's diff differ from `/memory`'s on real code: the laws draw only edits with
  one smallest diff.
- Whether Delivery wants a squashed changeset kept: this plan says yes (the same edit), and Delivery's own tests will
  show it.

## Open questions

None.

The one call under 80% is taken and listed at the top as a doubt.

## Findings

None new. The `pipeTo` exit code is now a call above, since the plan works around it.
