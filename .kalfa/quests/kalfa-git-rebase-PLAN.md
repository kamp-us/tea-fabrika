Approved by the lead agent, builds issues 1750, 1936; body f8a93aa9e9d4
Plancheck-Version: 3

# Plan: @kalfa/git, rebase a branch's own commits onto a new base (ticket 1936)

This is the kalfa packages (`kalfa/`), new work. It is not today's frozen version and not `next/`. The ticket is
https://github.com/kamp-us/tea-fabrika/issues/1936, a GitHub issue, so the first pull request says `Refs #1936`, the
last `Closes #1936`, and neither carries a `fabrika close ticket` line. Its blocker, ticket 1934 (write a commit, merge
trees, move a ref), is closed. Two slices, each its own pull request. Slice 1 branches from main after ticket 1935's
slice 2 (https://github.com/kamp-us/tea-fabrika/pull/2052) lands, since both change `Repository.ts`'s service and
`Raw`. Slice 2 branches from main after slice 1 lands.

```ts
// The whole idea, a sketch. Delivery lands a change request by rebase: its own commits go onto main as new commits.
const repo = yield* Repository.Repository;
const made = yield* repo.rebase({ upstream: main, commit: branchTip, onto: main });
// ReadonlyArray<Commit>, oldest first; [] when the branch has no own commits. Each keeps its author and message;
// the committer is the settings' one. The old commits stay as they were, and no ref moves.
// Fails CannotRebase { reason: "merge", commits } when an own commit is a merge commit: Delivery picks the merge
//   commit style for that change. Fails Conflict { paths } when a commit's files cannot be combined.
const tip = made.at(-1)?.id ?? main;
yield* repo.moveRef({ ref: candidate, from: Option.none(), to: tip });
```

## Doubts, read first

Four calls are under 80%. Each lean is taken, and each stays here so a reader sees the doubt.

- **`git replay` needs a ref, so slice 2 makes a short-lived one, 70%.** Read in git's source (v2.44.0 to v2.52.0,
  `builtin/replay.c`): `--onto` prints a new commit only for a branch under `refs/heads/` that points into the range, and
  `--advance <ref>` needs a ref for the new base. Our call takes commit ids. So slice 2 writes
  `refs/kalfa/rebase/<random>` at `onto`, runs `replay --advance` on it, and deletes it, in a scope that deletes it on
  failure and interruption too. A process killed in between leaves that ref behind. The other choice is to drop replay
  and always merge commit by commit, which the ticket does not ask. What would settle it: the owner's word, or the
  slice 2 proof run's timings (replay is about 10 git commands for any length; the merge path is about 5 plus 4 per
  commit).
- **Replay's commits are used only when their bytes are the merge path's, 75%.** git's own ident code rewrites a
  committer name with a space or a dot at either end and refuses an empty one, and replay drops leading blank lines of
  a message and copies extra headers. So `/process` reads back what replay wrote and compares each commit's bytes with
  the bytes `writeCommit` would write; any difference, a conflict or any failed command falls back to the merge path,
  which gives the answer. Both adapters then give the same ids for every input. The cost: replay's commits are thrown
  away when they differ (unreachable objects).
- **Own commits leave out what `onto` already holds, 75%.** The own commits are `walk({ include: [commit], exclude:
  [upstream, onto] })`, so a commit the new base already reaches is not made again. `git rebase --onto` and `git replay`
  exclude only the upstream. What would settle it: Delivery's stacked candidates in ticket 2260, or the owner's word.
- **"On git 2.40" and "this repo's history" are met by a study, not by CI, 70%.** CI's git is newer than 2.40 and the
  laptop refuses the real-git file. So this plan step ran the comparison by hand on git 2.40.1 over this repo's own
  history (results below), and the CI law I14 compares with `git rebase` on CI's git, with a version stand-in that makes
  `/process` take the 2.40 path. What would settle it: the owner accepting the study as the record, or a git 2.40 job in
  CI.

## What changes, in one paragraph

Slice 1 adds one call, `rebase({ upstream, commit, onto })`, to the service. `Repository.make` writes it once over
the raw calls, as it writes `rangePatchId`: `walk` finds the own commits, they must be one line with no merge commit
and no root (`CannotRebase`), each new commit passes `writeCommit`'s two checks before anything is written, and then
one tree merge per commit (`mergeTrees` with the old parent as merge base, the new tip as ours and the commit as
theirs) and one `writeCommit` per commit. Both adapters get it with no adapter code. `/process` also pins two more
inputs that change a merge: `merge.renameLimit`, and the tree git reads attributes from (`GIT_ATTR_SOURCE`). Slice 2
gives `Raw` a `rebase` that answers new commits or none. `/memory` answers none; `/process` on git 2.44 or newer runs
`git replay`, checks its bytes, and answers them, else none, and `make` then merges commit by commit. Out of scope:
squash (1937), fetch and push (1938 to 1940), rebasing merge commits, and dropping commits that become empty.

## Searched first

- The ticket and its parent https://github.com/kamp-us/tea-fabrika/issues/1750; the closed blocker 1934; ticket 1935
  and its plan `.kalfa/quests/kalfa-git-edit-PLAN.md` on branch `fabrikalfa/kalfa-git-edit` (pull request 2052) with
  that branch's last commits, which cut the real-git draws to 6 runs and the reads per law so the real-git file ends
  inside CI's 17-minute step on a slow runner; Delivery's ticket https://github.com/kamp-us/tea-fabrika/issues/2258,
  which this blocks (`CannotRebase`, `delivery.rebase.merge-commit`).
- Decisions 0060 ("a merge commit or a rebase" is Delivery's setting) and 0071 (with rebase "the commits that land are
  new"); `kalfa/delivery/GLOSSARY.md` (**Landing style**: "a rebase puts each on main as a new commit");
  `kalfa/git/GLOSSARY.md` (**Rebase**, **Upstream**, **Base**, **Conflict**, _Avoid_: replay).
- Every product file in `kalfa/git/src/` on main and on the edit branch: `Repository.ts` (`make`, `Raw`,
  `rangePatchId` written once in `make`, `writeCommit`'s NUL and size checks), `MergeCommit.ts`, `CommitEdit.ts`,
  `ProcessRepository.ts` (`start`, `MERGE_PINS`, `PINNED`, `known`, `held`, `mergeTrees` and its 2.40 gate),
  `internal/parse.ts` (`commit` keeps only `tree`, `parent`, `author`, `committer` and drops every other header);
  the tests `RepositoryTest.ts` (S9, S10), `MergeCommit.test-support.ts`, `History.test-support.ts` (`mergeModel`,
  `MERGE_CLASSES`, `MESSAGE_CLASSES`, `SIGNATURE_CLASSES`), `StandIn.test-support.ts` (the version is a scripted
  reply), `ProcessSeed.test-support.ts` (the layer reads `PATH` through `Config`), and the real-git file.
- Law ids in use on the edit branch: G1 to G9, I2 to I12, K1 to K4, M1 to M7, P1 to P23, S1 to S36, T1 to T7. This
  plan's ids: S37 to S41, P24 to P26, I13 to I15, T8.
- `rg -il` over `.kalfa/decisions`, `.kalfa/glossary`, `.kalfa/patterns`, `.kalfa/runbooks` and the kalfa glossaries
  for "rebase", "replay", "merge commit". Only the hits above bear on this.
- Installed versions in the lockfile: `effect` and `@effect/vitest` 4.1.3, `vitest` 5.0.5. The APIs used are the ones
  the package already uses: `Effect.fn`, `Effect.acquireRelease`, `Schema.TaggedError`, `Option`, `Clock`.
- git's source, fetched as plain files from the git project at tags v2.44.0 to v2.52.0: `builtin/replay.c`,
  `merge-recursive.c` (`init_merge_options` reads `merge.renameLimit`, `diff.renameLimit`, `diff.renames`,
  `merge.renames`, `merge.directoryRenames`, `merge.renormalize`), `merge-ort.c` (a rename limit of 0 or less means
  7000), `builtin/merge-tree.c` (it calls `init_merge_options` too), `attr.c` (2.43 adds `GIT_ATTR_SOURCE` and
  `attr.tree`; 2.44 reads a bare repository's attributes from `HEAD`'s tree when neither is set; 2.46 drops that).

## How others do it

- **git rebase** (the merge backend, git 2.26 and newer) picks each commit with merge-ort, the commit's parent as merge
  base, the new tip as ours, the commit as theirs, then writes a commit with the old author and message. By default it
  keeps the commits when the branch already sits on the base, skips a commit whose patch the upstream already has, and
  drops a commit that becomes empty; it linearizes merge commits unless `--rebase-merges`. Read in its documentation;
  each default was seen in the study below.
- **git replay** (2.44, experimental) does the same picks in memory, with no index and no working copy, and works in a
  bare repository. It keeps a commit that becomes empty, stops on a merge commit ("replaying merge commits is not
  supported yet") and on a root commit, prints nothing on a conflict (exit 1), and prints only `update <ref> <new>
  <old>` lines for refs. Read in `builtin/replay.c`, unchanged in what it does from v2.44.0 to v2.52.0, except that 2.47
  or later stopped reading merge config (`init_basic_merge_options`).
- **GitHub's "rebase and merge"** recreates each commit on the base with GitHub as committer, and refuses a pull
  request it cannot rebase. Decision 0071 rejects using it. From its documentation, not fetched.
- **libgit2** (`git_rebase_init`, `git_rebase_next`, `git_rebase_commit`) and **JGit** (`RebaseCommand`) rebase one
  commit at a time with a three-way merge per commit. From memory, not fetched.
- **Effect**: `make` already writes `rangePatchId` once over two raw calls; `rebase` takes that shape, so the merge
  path and the committer rule live once, in `make`.
- **Elm and Erlang/OTP** have nothing to say: no state lives between calls.

### The study: this repo's history on git 2.40.1

Run by hand by this plan step on the laptop's git 2.40.1, in a scratch clone of this repo with no user or system
config, a pinned committer and a pinned date. It ran the merge path's exact commands (`merge-tree --write-tree
--merge-base`, then `hash-object -t commit` of the bytes `writeCommit` writes) against `git rebase --onto` on 105 real
ranges: the second-parent line of each of the 75 merge commits on main's first-parent line (onto the main it merged
into), 20 windows of five of main's squash commits moved down past the two below them, and 10 old pull requests moved
onto a much later main.

| Ranges | What happened |
|---|---|
| 31 | skipped: a merge commit among the own commits; the call fails `CannotRebase` there |
| 48 | pull requests onto the main they merged into: with `--force-rebase` the same commit ids, byte for byte; without it git keeps the old commits, since the branch already sits on its base |
| 11 | squash windows that rebase clean: the same commit ids, with GitHub's `gpgsig` headers dropped by both and messages with no final newline kept by both; one range holds a rename |
| 13 | conflicts: the same paths in both |
| 2 | differ: `field/runs.jsonl` and `field/notes.jsonl` are `merge=union` in this repo's `.gitattributes`. git in a working copy reads it and merges them; a bare repository with no attribute source does not, so the call conflicts on them. In one of the two, the union made the commit empty and git dropped it |

In all, 74 ranges and 192 commits were compared, and every difference is one of: git keeps commits already on the base
(the call always makes new ones, as Delivery's glossary asks), git drops a commit that becomes empty (the call keeps
it, as `git replay` does), and git reads `.gitattributes` from a working copy (the call reads none). The study did not
reach a commit that starts empty or a patch the upstream already holds; the CI law I14 draws both.

## The shape

### Slice 1: the call, written once in `make`

```ts
// kalfa/git/src/Repository.ts, a sketch of what slice 1 adds.

// The own commits cannot be rebased: `commits` are the merge commits among them, sorted by id, or, when there is no
// merge commit, the root commits (a commit with no parent: the branch shares no history with the upstream or the base).
export class CannotRebase extends Schema.TaggedError<CannotRebase, { readonly brand: unique symbol }>()(
  "CannotRebase",
  { reason: Schema.Literals(["merge", "root"]), commits: Schema.NonEmptyArray(CommitId) },
) {}

// The service gains:
readonly rebase: (rebase: {
  readonly upstream: CommitId;
  readonly commit: CommitId;
  readonly onto: CommitId;
}) => Effect.Effect<
  ReadonlyArray<Commit.Commit>,
  | CannotRebase | Conflict | NulInMessage | TooLargeToWrite
  | NoSuchCommit | TooMany | TooLarge | UnreadableCommit | HistoryTooShort
  | Fails
>;
// Raw leaves it out in slice 1: make writes it, as it writes rangePatchId and readText.
export type Raw = Omit<Repository["Service"], "writeCommit" | "rangePatchId" | "readText" | "rebase"> & { /* as now */ };
```

`rebase`, in `make`, one span `git.rebase` and one time limit around everything below. Each step runs only when the one
before it passed:

1. `raw.walk({ include: [commit], exclude: [upstream, onto] })` gives the own commits, oldest first. Its checks come
   first and name what they name now: `NoSuchCommit` for the first of `commit`, `upstream`, `onto` the store lacks,
   `HistoryTooShort` in a shallow store, `TooMany` past `limits.commits`, `TooLarge` and `UnreadableCommit` for an own
   commit. No own commits answers `[]`, writes nothing.
2. A merge commit among them fails `CannotRebase { reason: "merge" }` naming every one, sorted by id. Else a root
   commit fails `CannotRebase { reason: "root" }` the same way. With neither, every own commit has one parent, so they
   are one line from the oldest to `commit`.
3. The committer is the settings' name and email at the clock's whole second, offset `+0000`, read once: every commit
   of one rebase has the same committer time.
4. Each new commit, oldest first, passes `writeCommit`'s checks before any commit is written: a NUL in its message
   fails `NulInMessage`, and its bytes past `limits.bytes` fail `TooLargeToWrite`. Its size is known before its tree:
   a tree id and a parent id are always 40 characters. The two checks move out of `writeCommit` into one function
   both use.
5. For each own commit `c`, oldest first, with `tip` starting at `onto`: `raw.mergeTrees({ mergeBase: c.parents[0],
   ours: tip, theirs: c.id })`, then `raw.writeCommit({ tree, parents: [tip], author: c.author, message: c.message,
   committer })`, and `tip` becomes the new commit. A `Conflict` from any merge ends the call with it; the commits
   written before it stay as unreachable objects, as a refused merge commit's do. `NoSuchTree` from `writeCommit`
   cannot happen (the tree was just made), so it is a defect, not part of the error union.
6. The answer is the new commits, oldest first. No ref moves, and the old commits are not touched.

A commit that starts empty, and one that becomes empty because `onto` already has its change, each make a new commit
with the tree of the tip it sits on. The call never drops one, as `git replay` never does.

**What `/process` pins in slice 1.** Every command gains `-c merge.renameLimit=7000` (git's default written out:
merge-ort reads a value of 0 or less as 7000), and every command's environment gains
`GIT_ATTR_SOURCE=4b825dc642cb6eb9a060e54bf8d69288fbee4904`, the empty tree, so no tree's `.gitattributes` and no
`attr.tree` steers a merge. git before 2.43 ignores the variable and reads no tree's attributes in a bare repository.
Both pins change the landed `mergeTrees` too, for the better: on git 2.44 and 2.45 it read `HEAD`'s `.gitattributes`.

| Command | Could change what it does | Pinned on the call |
|---|---|---|
| `merge-tree --write-tree` | `merge.renames`, `diff.renames`, `merge.directoryRenames`, `merge.renormalize` | the landed `-c` pins |
| `merge-tree --write-tree` | `merge.renameLimit`, `diff.renameLimit` | new: `-c merge.renameLimit=7000`, which `diff.renameLimit` cannot override |
| `merge-tree --write-tree` | `attr.tree`, and on git 2.44 and 2.45 a bare repository's `HEAD` tree's `.gitattributes` (a merge driver such as `union`) | new: `GIT_ATTR_SOURCE` set to the empty tree |
| `merge-tree --write-tree` | `$GIT_DIR/info/attributes` with a merge driver | nothing can pin it; the README names it as a case where the adapters differ |
| `hash-object -t commit` | none: it hashes the bytes given | nothing more |

### Slice 2: `git replay` on git 2.44 or newer

```ts
// kalfa/git/src/Repository.ts, a sketch of what slice 2 changes. Raw gains its own rebase: the new commits when the
// adapter can make them at once, exactly as the merge path would, or none, and make then merges commit by commit.
export type Raw = Omit<Repository["Service"], "writeCommit" | "rangePatchId" | "readText" | "rebase"> & {
  readonly writeCommit: /* as now */;
  readonly rebase: (rebase: {
    readonly onto: CommitId;
    readonly commits: NonEmptyReadonlyArray<Commit.Commit>; // the own commits, oldest first, checked by make
    readonly committer: Commit.Signature;                   // with its time
  }) => Effect.Effect<Option.Option<NonEmptyReadonlyArray<Commit.Commit>>, Fails>;
};
```

- `make` calls `raw.rebase` between steps 4 and 5. Some is the answer; none runs step 5.
- **/memory** answers none, always.
- **/process** answers none on git older than 2.44, with no command run. On 2.44 or newer:
  1. `update-ref --no-deref refs/kalfa/rebase/<r> <onto> <zeros>`, `<r>` 16 random hex digits, in a scope whose
     release runs `update-ref --no-deref -d refs/kalfa/rebase/<r> <onto>` on success, failure and interruption. A
     refused create is none.
  2. `replay --advance refs/kalfa/rebase/<r> ^<oldest's parent> <commit>`, with `-c i18n.commitEncoding=UTF-8 -c
     i18n.logOutputEncoding=UTF-8` beside the landed pins, and `GIT_COMMITTER_NAME`, `GIT_COMMITTER_EMAIL` and
     `GIT_COMMITTER_DATE=@<seconds> +0000` from `committer` in that one command's environment. Exit 1 (a conflict),
     any other code but 0, or output that is not exactly one line `update refs/kalfa/rebase/<r> <new> <onto>` is none.
  3. `rev-list --reverse --topo-order <onto>..<new>`: not exactly as many ids as own commits is none.
  4. `cat-file --batch` of those ids, each read as raw bytes. Each must equal, byte for byte, what `writeCommit` writes
     for that commit: its own tree as printed, parents `[the one before, or onto]`, the old commit's author and
     message, the committer. Equal: the answer is these commits. Any byte different: none.
- So the answer of slice 2 is always what step 5 would write, and the ids are the same on both adapters. On a conflict
  `/process` runs step 5 after replay, which names the paths.
- The `git.rebase` span gains `kalfa.git.replayed`: whether the adapter's own rebase gave the answer.

| Command | Could change what it does | Pinned on the call |
|---|---|---|
| `replay` | the merge keys above (read from config by 2.44 to 2.46, ignored by 2.47 and newer) | the same `-c` pins and `GIT_ATTR_SOURCE` |
| `replay` | `i18n.commitEncoding` (adds an `encoding` header), `i18n.logOutputEncoding` (re-encodes the message) | new: both set to UTF-8 on the command |
| `replay` | the committer: `user.*` config, the host name, `GIT_COMMITTER_*` | the three variables, set on the command; no user or system config is read |
| `replay` | an own commit's extra headers, leading blank lines, a committer git's ident rewrites | not pinnable: the byte check sees each, and the merge path answers |
| `update-ref`, `rev-list`, `cat-file --batch` | none that changes what they print here | the landed pins |

### Where the two adapters may differ

The shared laws draw none of these, and the README names them beside the landed merge cases:

1. **Renames and line merges.** `/memory` merges by whole file, so every case the README lists for `mergeTrees` holds
   for each commit of a rebase.
2. **`$GIT_DIR/info/attributes` with a merge driver.** git reads it in a bare repository; `/memory` reads none.

### The span (decision 0063)

| Call | Span | Attributes |
|---|---|---|
| rebase | `git.rebase` | `vcs.ref.base.revision` = upstream, `vcs.ref.head.revision` = commit, `kalfa.git.onto` = onto, `kalfa.git.commits` = how many new commits, `kalfa.git.commit` = the last one when there is one, `kalfa.git.conflicts` = how many paths on a conflict; slice 2 adds `kalfa.git.replayed` |

No message, name, email or path is ever an attribute. The raw calls inside are not wrapped again, so the call ends one
span, as `rangePatchId` does.

## One value traced: Delivery lands a change request by rebase

The store: `M0`, then main moved to `M1` (it changed `README`). The branch: `B1` (adds `a.txt`) and `B2` (changes
`a.txt`), on `M0`. Settings' committer: the bot, the clock at second 1700000000.

1. Slice 1, `/process` on git 2.43: `repo.rebase({ upstream: M1, commit: B2, onto: M1 })`. `walk` runs `cat-file
   --batch-check` (all three known), `rev-parse --is-shallow-repository`, `rev-list ... B2 --not M1 M1`, `cat-file
   --batch-check` and `cat-file --batch`: own commits `[B1, B2]`, each with one parent. The committer is the bot at
   1700000000 +0000. Both new commits pass the NUL and size checks.
2. `mergeTrees({ mergeBase: M0, ours: M1, theirs: B1 })`: `cat-file --batch-check`, then `merge-tree --write-tree
   --merge-base=M0 M1 B1`, which prints `T1` (README from M1, `a.txt` from B1). `writeCommit({ tree: T1, parents:
   [M1], author: B1.author, message: B1.message, committer })`: `cat-file --batch-check`, `hash-object -t commit -w
   --stdin`, which prints `N1`.
3. `mergeTrees({ mergeBase: B1, ours: N1, theirs: B2 })` gives `T2`; `writeCommit` gives `N2`. Answer `[N1, N2]`. 14
   commands in all. One span `git.rebase` with `kalfa.git.commits` = 2 and `kalfa.git.commit` = N2. No ref moved; `B1`
   and `B2` are as they were.
4. `/memory`, seeded with the same commits, answers the same `N1` and `N2`: tree ids and commit ids are git's in both.
5. Slice 2, the same call on git 2.52: after the same `walk`, `update-ref refs/kalfa/rebase/9f... M1`; `replay
   --advance refs/kalfa/rebase/9f... ^M0 B2` prints `update refs/kalfa/rebase/9f... N2 M1`; the ref is deleted;
   `rev-list --reverse --topo-order M1..N2` prints `N1 N2`; `cat-file --batch` gives both commits' bytes, each equal
   to what `writeCommit` writes. Answer `[N1, N2]`, `kalfa.git.replayed` = true. 10 commands in all, for any number of
   commits.
6. The same call with the committer name `"Bot "`: git's ident writes `Bot`, so the bytes differ, the answer is none,
   and step 5 writes `N1'` and `N2'` with `"Bot "`, as `/memory` does. `kalfa.git.replayed` = false.
7. If `B2` were a merge of `B1` and another line: `CannotRebase { reason: "merge", commits: [B2] }` after the `walk`,
   and nothing is written.

## What fact is lost if not recorded now

- **Where the call differs from `git rebase`, and why.** The ticket asks for it, and Delivery's users will compare a
  landing with a local `git rebase`. The study above, the README and the lead's ticket comment hold it.
- **Which git inputs change a merge, by version.** Learned from git's source in this plan: `HEAD`'s attributes on 2.44
  and 2.45, `attr.tree` on 2.43 and newer, the rename limit. The pins and I13 hold it.
- **Why replay's answer is checked byte for byte.** The next person to touch it would otherwise trust replay's commits
  and lose equal ids. The README says it.
- Nothing else: a rebase's commits can be made again from the store.

## Generators

The generators live in `kalfa/git/src/History.test-support.ts`, beside `mergeCarrier`. A rebase case is three commits
of a history by index (`upstream`, `commit`, `onto`) and what the model answers: the new commits' trees, as nodes of
the history whose files are the model's answer (so the law reads their tree ids from `Seeded.trees`, as the edit laws
do), or the failure the model names. The model is `mergeModel` run once per own commit, the parent as base. One
carrier history holds every class of a run, so each process run seeds one repository per law. Each class is checked in
every run, made from the run's drawn value, as the landed classes are.

The rebase (slice 1, both adapters):

- (a) clean lines: one commit; three commits; a commit that adds a file three folders deep; one that deletes the last
  file of a folder; a mode made executable; binary content; a link's target; names on the object prototype; a commit
  that changes a path `onto` also changed to the same bytes.
- (b) nothing to do: `commit` already reached by `upstream`; `commit` reached by `onto` only.
- (c) empty commits: one that starts empty (its tree is its parent's), one that becomes empty (`onto` already has its
  change).
- (d) what is kept: every message class but the NUL, and every author signature class, one per commit; the old
  commits read back unchanged after the call.
- (e) conflicts: at the first own commit; at the third, after two clean ones; every conflict class of `MERGE_CLASSES`.
- (f) merge commits: one merge among the own commits; two, named sorted by id; a merge commit below `upstream`, which
  is not an own commit, so the rebase goes on.
- (g) roots: own commits that reach a root (the branch shares no history); a merge and a root together, which names
  the merge.
- (h) unknown ids: each of `commit`, `upstream` and `onto` missing, and a tree's id given as `onto`.
- (i) a shallow store.
- (j) the commits limit: exactly `limits.commits` own commits, and one more.
- (k) the bytes limit: a new commit of exactly `limits.bytes` bytes, and one byte more, where the old commit was
  within it (the committer is longer).
- (l) a NUL in an own commit's message.
- (n) `onto` already reaches one of the branch's commits, which is left out.

The adapter's own rebase (slice 2):

- (m) committers: a clean one; a name with a space at the start, one with a space at the end, an empty name, a name
  ending in a dot: each one git's ident rewrites or refuses.
- (o) replay's answers, on the stand-in: bytes equal; a committer that differs; an extra header; a message missing its
  leading blank line; exit 1; exit 128; a refused ref create; output with no line, two lines, another ref's name or a
  bad id; fewer or more ids from `rev-list`.
- (p) versions, on the stand-in: 2.39 (no merge, `GitTooOld`), 2.43 (merge path only), 2.44 and 2.52 (replay first).

On real git only:

- (q) against `git rebase`: a commit that starts empty, one that becomes empty, a patch the upstream already holds, a
  rename on one side and a change on the other, the same rename on both, a file added in a folder the other side
  renamed, a message with no final newline, leading blank lines.
- (r) a repository's own inputs: `merge.renameLimit=1`, `diff.renameLimit=1`, `diff.renames=false`, `attr.tree` naming
  a tree with `* merge=union`, `HEAD` on a commit whose `.gitattributes` says `* merge=union`, and
  `i18n.commitEncoding=ISO-8859-1`.

## Laws

Laws use `it.effect.prop` from `@effect/vitest` 4.1.3 with Effect's own `Arbitrary`, as the landed laws do. S37 to
S41 are in a new file `kalfa/git/src/Rebase.test-support.ts`, whose `laws` `RepositoryTest.suite` calls, so every
adapter that runs `/test` runs them: on `/memory` in `MemoryRepository.test.ts` at 100 runs, and on `/process` in the
real-git file (I1) at 6 runs.

| Law | Kind (lint, type or test?) | Generator | Plant | Where |
|---|---|---|---|---|
| S37, rebase (slice 1): for every case of (a) to (d) and (n), the call answers one new commit per own commit the model keeps, oldest first, each with parents `[the one before, or onto]`, the model's tree, the old commit's author and message byte for byte, and the settings' committer at the clock's second, the same second for all; `[]` when there are none; the old commits read back as before, and no ref moves. memory 100 runs, process 6 | test | Effect Arbitrary: textureArb | give each commit `onto` as its parent, (a) red; merge over `onto` and not over the old parent, (a) red; take the committer from the old commit, (d) red; drop a commit whose tree is its tip's tree, (c) red; exclude only `upstream`, (n) red; answer `[commit]` when there is nothing to do, (b) red; read the clock once per commit while the clock moves, (d) red | kalfa/git/src/Rebase.test-support.ts |
| S38, conflicts (slice 1): each conflict case fails `Conflict` with the model's paths, sorted by bytes; no ref moves; the old commits read back as before. memory 100 runs, process 6 | test | Effect Arbitrary: textureArb | return the commits made before the conflict as an answer, (e) red; name only the first path, (e) red; merge the third commit over the first commit's parent, (e) red | kalfa/git/src/Rebase.test-support.ts |
| S39, cannot rebase (slice 1): a merge commit among the own commits fails `CannotRebase` `merge` naming every one sorted by id; a root fails it with `root`; both name the merges; a merge below `upstream` rebases; each refusal leaves the store's fingerprint as it was. memory 100 runs, process 6 | test | Effect Arbitrary: textureArb | delete the merge check, so its first parent is used, (f) red; name the merges in walk order, (f) red; check the root before the merge, (g) red; delete the root check, so a root merges over nothing, (g) red; read merge commits below `upstream`, (f) red | kalfa/git/src/Rebase.test-support.ts |
| S40, the order of the checks (slice 1): unknown ids fail `NoSuchCommit` naming the first missing of `commit`, `upstream`, `onto`; a shallow store fails `HistoryTooShort`; one commit past `limits.commits` fails `TooMany`, exactly the limit rebases; a NUL fails `NulInMessage`; one byte past `limits.bytes` fails `TooLargeToWrite`, exactly the limit rebases; every one of these writes nothing, so the fingerprint is as it was. memory 100 runs, process 6 | test | Effect Arbitrary: textureArb | leave `onto` out of the walk, so an unknown `onto` fails later or not at all, (h) red; check the size after the first write, (k) red; count `>=` for `>`, (k) red; let the NUL reach `writeCommit` after two commits were written, (l) red; check sizes with the old committer, (k) red; walk before the shallow check, (i) red; answer a cut list at the limit, (j) red | kalfa/git/src/Rebase.test-support.ts |
| S41, the span (slice 1, `kalfa.git.replayed` in slice 2): each call ends one `git.rebase` span with the spans table's attributes and no child span of a raw call; no attribute holds a seeded message, name, email or path. memory 100 runs, process 6 | test | Effect Arbitrary: textureArb | call the wrapped `walk`, so a child span shows: red; annotate the first conflict path, (e) red; leave `kalfa.git.commit` out: red | kalfa/git/src/Rebase.test-support.ts |
| S9 and S10, extended (slice 1): the service's keys gain `rebase`; `rebase` among the writes moves no ref | test | Effect Arbitrary: textureArb | leave `rebase` out of the service: red; let `rebase` point `refs/heads/main` at its tip: red | kalfa/git/src/RepositoryTest.ts |
| T8, the call's types (both slices): `rebase` has exactly this plan's answer and error union and needs nothing; `NoSuchTree` is not in it; `Raw` has no `rebase` in slice 1, and in slice 2 has one whose answer is an `Option` of a non-empty list with only `Fails` as errors; `CannotRebase`'s `reason` is the two literals | type | type | add `NoSuchTree` to the union: red; require `rebase` of a slice 1 adapter: red; type `reason` as a string: red | kalfa/git/src/Repository.types.test.ts |
| P24, the merge path on the stand-in (slice 1): after the walk's commands, exactly `cat-file --batch-check`, `merge-tree --write-tree --merge-base=<parent> <tip> <commit>`, `cat-file --batch-check`, `hash-object -t commit -w --stdin` per own commit, oldest first; every command carries `-c merge.renameLimit=7000` and `GIT_ATTR_SOURCE` set to the empty tree; on git 2.39 the call fails `GitTooOld` needing 2.40 before any `merge-tree`. 100 runs | test | Effect Arbitrary: rebaseScriptArb | drop the rename limit pin: red; set `GIT_ATTR_SOURCE` only on `merge-tree`, so another command lacks it: red; run `merge-tree` on 2.39, (p) red | kalfa/git/src/ProcessRepository.test.ts |
| I13, a repository's own inputs steer no rebase (slice 1, replay in slice 2): with every input of (r) set on a bare repository, a rename-against-change rebase and a both-change-one-line rebase answer what the repository answers without them: the same commit ids, and the same `Conflict` | test | scenario: one fast-import history with a rename and a one-line clash, the two cases git's attributes and rename limit decide, since `/memory` merges no renames | delete the rename limit pin, (r) red; delete `GIT_ATTR_SOURCE`, (r) red; delete the i18n pins on `replay`, (r) red | kalfa/git/src/ProcessRepository.integration.test.ts |
| I14, against `git rebase` (slice 1, run again in slice 2): for each case of (q), in a temporary clone with a working copy and the same pinned committer and date, the call's commit ids equal `git rebase --force-rebase --empty=keep --reapply-cherry-picks --onto <onto> <upstream>`'s, and against `git rebase --force-rebase` alone they differ only where git drops a commit that becomes empty or a patch the upstream holds; in slice 2 it runs twice, as git is and with a `git` on `PATH` that says version 2.40.1, so both paths run. 3 runs | test | Effect Arbitrary: textureArb | drop a commit that becomes empty, (q) red; drop a commit whose tree is its parent's, (q) red; strip a message's leading blank lines, (q) red; let the version stand-in reach the replay path, (p) red | kalfa/git/src/ProcessRepository.integration.test.ts |
| P25, the adapter's own rebase on the stand-in (slice 2): on 2.44 and newer the commands are exactly `update-ref` (create), `replay --advance` with the committer's three variables and the i18n pins, `update-ref -d`, `rev-list --reverse --topo-order`, `cat-file --batch`, and the answer is the read commits when every byte matches; every case of (o) but the first answers none, and the merge path's commands follow; the ref is deleted after every outcome, interruption included; on 2.43 no `replay` runs. 100 runs | test | Effect Arbitrary: replayScriptArb | trust replay's commits with no byte check, (o) red; compare the parsed commits and not the bytes, so an extra header passes, (o) red; skip the delete when `replay` exits 1, (o) red; read `update` lines for any ref, (o) red; gate replay at 2.43, (p) red | kalfa/git/src/ProcessRepository.test.ts |
| P26, the replay line reader (slice 2): for any drawn ref and ids, `update <ref> <new> <old>\n` reads back; a cut, a second line, a short id or a missing space reads as no answer and never throws. 300 runs | test | Effect Arbitrary: replayLineArb | split on any whitespace, so a tab passes: red; take the first of two lines, (o) red | kalfa/git/src/internal/parse.test.ts |
| I15, both paths on real git (slice 2): for each committer of (m), S37's cases on `/process` answer `/memory`'s commit ids; `kalfa.git.replayed` is true for the clean committer when git is 2.44 or newer, false for the others; `for-each-ref` after every call lists no `refs/kalfa/rebase/` ref | test | Effect Arbitrary: textureArb | trust replay's commits with no byte check, (m) red; skip the delete on success: red | kalfa/git/src/ProcessRepository.integration.test.ts |

**Every check that guards data has its class and its plant.** In call order: the walk's `NoSuchCommit` with `onto` in
it (h), the shallow check (i), the commits limit (j), the merge check (f), the root check (g), the NUL check (l), the
size check with the new committer (k), the merge over the old parent (a, e), the committer read once (d); in slice 2
the version gate (p), the refused ref create (o), the exit code (o), the one `update` line (o), the id count (o), the
byte check (o, m), and the ref delete (o). Each class passes every check before its own, and each plant deletes or
bends that check. The landed checks keep their own laws.

**Which files hold the guarding checks**, for the mutation gate: slice 1's are all in `kalfa/git/src/Repository.ts`
(`make`'s `rebase` and the shared write checks), and its pins are in `kalfa/git/src/ProcessRepository.ts`. Slice 2's
are in `kalfa/git/src/ProcessRepository.ts` (the replay path) and `kalfa/git/src/internal/parse.ts` (the line
reader), with the one `Option` branch in `Repository.ts`.

**Where each law runs.**

- T, P and every S law on `/memory`: plain files, on every pull request their change reaches, and on the laptop with a
  narrow path. T8 runs under `pnpm typecheck`.
- I1 (S37 to S41 on `/process`), I13, I14 and I15 run the real git binary in temp folders, so they are in
  `ProcessRepository.integration.test.ts`. A stand-in cannot do their job: they are the thin proof that real git
  answers what the stand-in and `/memory` answer, and every behavior has a plain law above. The laptop refuses that
  file by name, and pull requests and the merge queue run no `.integration.` law, so the lead starts a proof run for
  each slice, after the build and before the review.
- No law is host-only: none needs launchd, Electron, a real signal or the owner's Mac.
- No secret flows through this call, so no law is a `[secrets]` law. S41 checks that no message, name, email or path
  reaches a span.

**Each acceptance criterion and its laws.**

1. New commits on the new base, the old ones as they were: S37.
2. Author and message kept, the committer from the settings: S37, classes (d) and (m), and I15.
3. A conflict names the files: S38.
4. A merge commit fails with a named error: S39.
5. `git replay` on 2.44 or newer, the merge path on older git, one call and one set of laws: P24, P25, I14 run on both
   paths, I15, and S37 to S41 on both adapters.
6. The comparison with `git rebase`, empty commits and renames, each difference written down: I14, the study above,
   and the lead's ticket comment.
7. Both adapters pass the same laws: S37 to S41 in `/test`, on `/memory` and on `/process` (I1).
8. One span `git.rebase` through `Effect.fn`: S41.

## Real-git time budget

The file came to about 550 s on a slow runner after the edit slice's cuts, against the step's 1020 s. This plan adds at
most 250 s there, so the file stays under about 800 s:

| Law on real git | Runs | Commands per run, about | Why that few |
|---|---|---|---|
| S37 | 6 | 200 | one carrier history per run, about 12 cases of 1 to 3 commits; the merge path costs 5 plus 4 per commit |
| S38, S39, S40, S41 | 6 | 100 each | one case per class; refusals stop after the walk's 5 commands |
| I13 | 1 | 40 | a scenario: two rebases on two repositories |
| I14 | 3 | 150, plus two `git rebase` runs per case | 8 cases of 1 or 2 commits; slice 2 doubles it |
| I15 | 6 | 120 | five committers on the S37 history's three cases |

The tests step counts the commands with a counting stand-in, as the edit slice did, and cuts draws, not checks, when a
law passes its row. The lead's proof run is the measure; past 850 s on its runner, cut runs before the review.

## Files

Slice 2 branches from main after slice 1 lands. A file touched in both slices has a row for each.

| Slice | File | Owner | Product lines expected | Change |
|---|---|---|---|---|
| 1 | kalfa/git/src/Repository.ts | build | 85 | `CannotRebase`, `rebase` in the service, `Raw` leaves it out, `rebase` written once in `make`, the NUL and size checks shared with `writeCommit` |
| 1 | kalfa/git/src/ProcessRepository.ts | build | 6 | `merge.renameLimit` in `MERGE_PINS`, `GIT_ATTR_SOURCE` in `PINNED`, the doc lines |
| 1 | kalfa/git/README.md | build | docs | "Rebase": the call, its checks, what it keeps, the study, where it differs from `git rebase`, the two cases where the adapters differ; the pins table; "What it never does" leaves rebase out of later tickets |
| 1 | kalfa/git/GLOSSARY.md | build | docs | **Own commits** |
| 1 | kalfa/git/src/History.test-support.ts | tests | tests | `rebaseCarrier`, classes (a) to (l) and (n), the model |
| 1 | kalfa/git/src/Rebase.test-support.ts | tests | tests | new: S37 to S41 |
| 1 | kalfa/git/src/RepositoryTest.ts | tests | tests | `suite` calls the rebase laws; S9 and S10 extended |
| 1 | kalfa/git/src/ProcessRepository.test.ts | tests | tests | P24; landed stand-in laws that list `start`'s arguments or the environment gain the two pins |
| 1 | kalfa/git/src/StandIn.test-support.ts | tests | tests | `gitTable` answers `merge-tree` per own commit, only if P24's script needs it |
| 1 | kalfa/git/src/Repository.types.test.ts | tests | tests | T8 for slice 1 |
| 1 | kalfa/git/src/ProcessSeed.test-support.ts | tests | tests | a temporary clone with a working copy for `git rebase`, the inputs of (r) on a bare repository |
| 1 | kalfa/git/src/ProcessRepository.integration.test.ts | tests | tests | I13, I14 |
| 2 | kalfa/git/src/Repository.ts | build | 15 | `Raw.rebase`; `make` tries it before the merge path; `kalfa.git.replayed` |
| 2 | kalfa/git/src/MemoryRepository.ts | build | 3 | `rebase` answers none |
| 2 | kalfa/git/src/ProcessRepository.ts | build | 120 | the 2.44 gate, the scratch ref in a scope, `replay` with its environment, the read back, the byte check; the runner takes an environment per command |
| 2 | kalfa/git/src/internal/parse.ts | build | 30 | the `update` line reader; raw bodies from `cat-file --batch` |
| 2 | kalfa/git/README.md | build | docs | how `/process` uses `git replay`, the scratch ref and what a killed process leaves, why the bytes are checked |
| 2 | kalfa/git/src/History.test-support.ts | tests | tests | committer classes (m) |
| 2 | kalfa/git/src/Rebase.test-support.ts | tests | tests | S41's `kalfa.git.replayed` |
| 2 | kalfa/git/src/ProcessRepository.test.ts | tests | tests | P25 |
| 2 | kalfa/git/src/StandIn.test-support.ts | tests | tests | replies for `replay`, `update-ref` and `rev-list`, only if P25's script needs them |
| 2 | kalfa/git/src/internal/parse.test.ts | tests | tests | P26 |
| 2 | kalfa/git/src/Repository.types.test.ts | tests | tests | T8 for `Raw.rebase` |
| 2 | kalfa/git/src/ProcessSeed.test-support.ts | tests | tests | the `PATH` with a `git` that says version 2.40.1 |
| 2 | kalfa/git/src/ProcessRepository.integration.test.ts | tests | tests | I14 on both paths, I15 |

No root file changes: no new package, no lockfile, no new export (`rebase` is a service call), no lint row.

## Existing tools

- `kalfa/git/src/Rebase.test-support.ts`: searched the package's test files. `MergeCommit.test-support.ts` is the model
  (a suite beside `RepositoryTest.ts` that takes a `Subject`); `RepositoryTest.ts` is already 2900 lines, so the rebase
  laws get their own file, called from `suite` so `/test` runs them.
- `rebase` in `make`: searched the package (`rangePatchId` is the model of a call written once over raw calls;
  `MergeCommit.mergeCommit` and `CommitEdit.commitEdit` are helpers over the public service, which cannot let
  `/process` answer at once) and npm (`isomorphic-git` has no rebase; `simple-git` runs `git rebase` in a working
  copy, which this package never has).
- The shared write checks: `writeCommit`'s NUL and size checks in `make`, moved into one function `rebase` uses too.
- `/process`'s replay path: searched the package (`known`, `held`, `succeeded`, `stdoutText`, `Parse.ids`, `bytes()` in
  `internal/object.ts` are used as they are; `moveRef`'s `update-ref --no-deref` form for the scratch ref) and git's
  commands (`replay`, chosen by the ticket; `rebase`, `cherry-pick` and `sequencer` need a working copy).
- `internal/parse.ts`'s line reader: searched it (`Parse.refIds`, `Parse.ids` read other lines; `Parse.commits` parses
  `cat-file --batch` into commits and drops the raw bytes the byte check needs, so it gains a raw body reader beside
  it).

## Calls taken

- **The four doubts at the top**, at 70%, 75%, 75% and 70%.
- **`rebase` is a service call that `make` writes, not a helper module, 85%.** The ticket wants `/process` to answer
  with `git replay` behind the same call, so an adapter must be able to answer it; a helper over the public service
  could not. `make` keeps the merge path and the committer rule in one place.
- **The input is `{ upstream, commit, onto }`, 85%.** `rangePatchId` already names a branch's own commits by
  `upstream` and `commit`, and git's own `rebase --onto <onto> <upstream>` takes the same three. Delivery's stacked
  candidates need `onto` apart from `upstream`.
- **The answer is the new commits, oldest first, 85%.** The ticket says "gets the new commits back"; the caller takes
  the last one's id as the new tip, or `onto` when there is none.
- **One error `CannotRebase` with a `reason`, 80%.** Delivery's own failure is named `CannotRebase`; a root commit is
  the same kind of refusal with another reason, as `UnreadableCommit` has its `reason`. It names every merge commit,
  sorted by id, as `UnclearBase` names its bases, so both adapters name the same ones.
- **`Conflict` stays as landed, with no commit in it, 80%.** The glossary's Conflict "stops and names the files";
  Delivery fails the change either way. A field can be added later with no data lost: nothing is stored.
- **One committer time per rebase, 80%.** `git rebase` reads the clock per commit, but one rebase is one landing, and
  one time keeps the replay path's single command able to write the same bytes.
- **Commits that start or become empty are kept, 85%.** `git replay` keeps them, Delivery's glossary says "each on main
  as a new commit", and a dropped commit would hide a change request's commit from its landing.
- **A commit already on its base is made again, 85%.** Decision 0071 and Delivery's glossary: with rebase the commits
  that land are new. This is `git rebase --force-rebase`.
- **No cherry-pick skip, 85%.** A patch the upstream already has is rebased like any other, as `git replay` does;
  `rangePatchId` lets Delivery find one first.
- **Pin `merge.renameLimit` and `GIT_ATTR_SOURCE` on every command, 80%.** git's source shows both change a merge from
  a repository's own data; both pins are git's defaults or no attributes, so no landed answer changes except on git
  2.44 and 2.45 with a `.gitattributes` at `HEAD`, which was a gap. They go on every command, as the landed merge pins
  do, so one start serves every call.
- **The merge path on git 2.40 to 2.43, `GitTooOld` below 2.40, 90%.** `mergeTrees` already needs 2.40.
- **A scratch ref name with 16 random hex digits under `refs/kalfa/rebase/`, 80%.** Two rebases at once never share
  one, and a create that finds one there is none, so the merge path answers.
- **Is any of this a setting?** No new setting. `limits.commits`, `limits.bytes` and `limits.time` bound a rebase as
  they bound its parts. Not settings: the 2.44 gate (a fact of git), the pins and the scratch ref's prefix (a setting
  would let config steer a rebase, as the landed plans say of the other pins), dropping empty commits (Delivery may ask
  for it in a later ticket; the call keeps every commit today), and the check order (both adapters must agree).

## Validation

- tests step, per slice: no dependency changes, so no install. Each plain law file alone,
  `nice -n 15 pnpm exec vitest run kalfa/git/src/<file>.test.ts`, red on the missing call. The integration file is
  written and not run: the laptop refuses it. The commands each real-git law asks are counted on a counting stand-in,
  against the time budget's rows.
- build step, per slice: each plain law file green, `pnpm format`, `pnpm lint` (its law id check too), and each plant
  in the laws table run once and undone. The integration file is not run on the laptop.
- The lead, per slice: a proof run of `kalfa/git/src/ProcessRepository.integration.test.ts` before the review, read
  for the file's total time against the budget.
- The lead runs its own typecheck per slice, for T8.
- After slice 1 lands, the lead posts one comment on https://github.com/kamp-us/tea-fabrika/issues/1936 with the study
  and each case where the call differs from `git rebase`, as the ticket asks.

## Size

1. Slice 1, the call on the merge path: 91 lines (`Repository.ts` 85, `ProcessRepository.ts` 6). It lands whole:
   Delivery's rebase landing style can use it on both adapters and on any git from 2.40.
2. Slice 2, `git replay` on git 2.44 or newer: 168 lines (`ProcessRepository.ts` 120, `internal/parse.ts` 30,
   `Repository.ts` 15, `MemoryRepository.ts` 3). It lands whole: the same call, faster on long branches, with the same
   answers.

About 259 product lines in all, plus the laws, the README and one glossary term. About 6 agent hours across the steps,
70% sure. The doubt: the rebase carrier, which must seed the model's trees as history nodes, is the largest test piece,
and the real-git budget may force a second cut of draws after the proof run. Priced at about $10 a step at list
price, as the edit plan's were: tests, build and review for each slice, and one send-back each.

Estimate: 8 steps, $80

## New names

- `rebase`, its fields `upstream`, `commit`, `onto`; `Raw.rebase` (slice 2).
- `CannotRebase` with `reason` `merge` or `root` and `commits`.
- Span `git.rebase`; attributes `kalfa.git.onto`, `kalfa.git.replayed`.
- The scratch ref prefix `refs/kalfa/rebase/`.
- Test names: `rebaseCarrier`, `rebaseScriptArb`, `replayScriptArb`, `replayLineArb`.

## Records

- `kalfa/git/GLOSSARY.md` gains one term in slice 1's build:

  **Own commits**:
  The commits a branch holds that its upstream and its new base do not reach. A rebase makes one new commit for each.
  _Avoid_: range, branch commits, the branch

- No new decision: the ticket and decisions 0060 and 0071 hold the design, and every call above is cheap to change
  before the first release. No pattern doc.

## What this cannot tell us

- Whether the owner wants replay at the price of a scratch ref, and whether own commits should leave out what `onto`
  holds (the doubts at the top).
- How much faster replay is on CI's runner: no law measures time. The proof run's per-law times are the first measure.
- Whether git 2.40 to 2.43 merge exactly as the study's 2.40.1 did: CI's git is newer, and the version stand-in only
  picks the path.
- Whether a git newer than 2.52 changes `replay`'s output: the byte check turns any change into the merge path, never
  into a wrong answer, and I15 would show `kalfa.git.replayed` false.
- Whether a repository's own `info/attributes` with a merge driver matters to Delivery: git reads it and nothing pins
  it; the app owns its bare repository.
- Whether sha-256 repositories work: the package's ids are sha-1 only.

## Open questions

None.

The four calls under 80% are taken and listed at the top as doubts.

## Lead's calls at signing (2026-11-23)

- Kept, each with its law: replay's short-lived ref `refs/kalfa/rebase/<random>` (70%); replay's commits are used only on an exact byte match with the merge path, else the merge path runs (75%); own commits leave out what `onto` already reaches (75%); the git 2.40 study stands as recorded (70%).
- Slice 1 fixes the two findings (`.gitattributes` read from a bare repo's `HEAD` on git 2.44 and 2.45, and the unpinned `merge.renameLimit`), each with a law.
- Tests start after ticket 1935 slice 2 (https://github.com/kamp-us/tea-fabrika/pull/2052) lands, since both touch `RepositoryTest.ts`.

## Findings

- **`mergeTrees` on git 2.44 and 2.45 read a bare repository's `HEAD` tree's `.gitattributes`, and on 2.43 and newer
  `attr.tree`; `merge.renameLimit` was not pinned.** Proof: `attr.c` at v2.44.0 sets the attribute source to `HEAD`
  when the repository is bare and neither `GIT_ATTR_SOURCE` nor `attr.tree` is set; `merge-recursive.c`'s
  `init_merge_options`, which `builtin/merge-tree.c` calls, reads `merge.renameLimit`. Slice 1 fixes both, since the
  rebase needs them, so it is in the plan and not a ticket.
- **The law id step of `pnpm lint` lists no free ids.** Run with no argument, it exits 0 when no two laws share an id
  and prints nothing, so the free ids above come from the test names on the edit branch.
