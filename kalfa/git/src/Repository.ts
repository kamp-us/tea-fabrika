/**
 * The service that reads commits and refs from one repository with no working copy, writes a commit, moves a ref and fetches from a remote, the failures it names, and `make`.
 *
 * **Details**
 *
 * This file holds the contract and the one wrap every adapter gets, and nothing that runs git. A call never reads HEAD and never changes the files of a working copy. `writeCommit` adds one commit and `moveRef` moves one ref, and `fetch` adds the objects of a remote's refs; no other call writes. Each adapter is its own entry point, `memory` and `process`, and `test` holds the laws they all pass.
 */
import { Clock, Context, Effect, Option, Order, Predicate, Schema } from "effect";
import { isReadonlyArrayNonEmpty, sort, type NonEmptyReadonlyArray } from "effect/Array";
import * as Commit from "./Commit.ts";
import { CommitId } from "./CommitId.ts";
import * as Credentials from "./Credentials.ts";
import type { Diff, PatchId } from "./Diff.ts";
import { byBytes, bytes } from "./internal/object.ts";
import * as Ref from "./Ref.ts";
import type * as Remote from "./Remote.ts";
import * as Settings from "./Settings.ts";
import { Path, TreeId } from "./Tree.ts";

/**
 * The repository holds no commit with that id: it is missing, or it names a tree, a blob or a tag.
 *
 * @category errors
 */
export class NoSuchCommit extends Schema.TaggedError<NoSuchCommit, { readonly brand: unique symbol }>()(
  "NoSuchCommit",
  { id: CommitId },
) {}

/**
 * The repository holds no tree with that id: it is missing, or it names a commit, a blob or a tag.
 *
 * @category errors
 */
export class NoSuchTree extends Schema.TaggedError<NoSuchTree, { readonly brand: unique symbol }>()("NoSuchTree", {
  id: TreeId,
}) {}

/**
 * A ref under the asked name points at something that is not a commit.
 *
 * **Details**
 *
 * `points` says what: a symbolic ref, a tag object, a tree or a blob. A call that skipped it would answer a list that leaves out a ref git holds.
 *
 * @category errors
 */
export class RefNotCommit extends Schema.TaggedError<RefNotCommit, { readonly brand: unique symbol }>()(
  "RefNotCommit",
  {
    ref: Ref.RefName,
    points: Schema.Literals(["symbolic", "tag", "tree", "blob"]),
  },
) {}

/**
 * A commit could not be read as text: git holds its message, author or committer in bytes that are not UTF-8, or a header is malformed.
 *
 * @category errors
 */
export class UnreadableCommit extends Schema.TaggedError<UnreadableCommit, { readonly brand: unique symbol }>()(
  "UnreadableCommit",
  {
    id: CommitId,
    reason: Schema.Literals(["message", "author", "committer", "header"]),
  },
) {}

/**
 * The repository is shallow, so a call that reads history cannot know its answer.
 *
 * **Details**
 *
 * A shallow commit hides its parents. The call fails and never guesses what is new.
 *
 * @category errors
 */
export class HistoryTooShort extends Schema.TaggedError<HistoryTooShort, { readonly brand: unique symbol }>()(
  "HistoryTooShort",
  {},
) {}

/**
 * An answer would hold more than a limit allows: more commits (a walk or a merge-base answer), more refs or more changed files than the setting.
 *
 * @category errors
 */
export class TooMany extends Schema.TaggedError<TooMany, { readonly brand: unique symbol }>()("TooMany", {
  limit: Schema.Literals(["commits", "refs", "files"]),
  most: Schema.Int,
}) {}

/**
 * The files of a diff hold more content than `limits.diff` allows, counting each changed file's bytes before and after.
 *
 * **Details**
 *
 * It is checked before any content is read, so a diff is never cut.
 *
 * @category errors
 */
export class DiffTooLarge extends Schema.TaggedError<DiffTooLarge, { readonly brand: unique symbol }>()(
  "DiffTooLarge",
  { most: Schema.Int },
) {}

/**
 * A range has no one merge base to measure from: `bases` holds none (the two share no history) or more than one (a criss-cross).
 *
 * **Details**
 *
 * It names the merge bases, sorted by id, and never picks one.
 *
 * @category errors
 */
export class UnclearBase extends Schema.TaggedError<UnclearBase, { readonly brand: unique symbol }>()("UnclearBase", {
  bases: Schema.Array(CommitId),
}) {}

/**
 * A changed text file has a line that is not UTF-8, so a diff cannot give its lines as text.
 *
 * **Details**
 *
 * `path` is the first such file in path order. `patchId` needs no text and answers for the same change.
 *
 * @category errors
 */
export class NotUtf8 extends Schema.TaggedError<NotUtf8, { readonly brand: unique symbol }>()("NotUtf8", {
  path: Path,
}) {}

/**
 * A path holds no file, so it has no bytes and no lines: `holds` says what it holds, a folder, a link or a submodule.
 *
 * **Details**
 *
 * `readFile` names the path it was asked, or the link or submodule above it that a path would pass through. `diff` fails it for a submodule, with the path as git prints it, so `path` is plain text.
 *
 * @category errors
 */
export class NotAFile extends Schema.TaggedError<NotAFile, { readonly brand: unique symbol }>()("NotAFile", {
  path: Schema.String,
  holds: Schema.Literals(["folder", "link", "submodule"]),
}) {}

/**
 * A file holds more bytes than `limits.blob`: too large to read, or, given to `editTree`, too large to read back.
 *
 * **Details**
 *
 * It is checked before any content is read or written, so a file is never cut.
 *
 * @category errors
 */
export class FileTooLarge extends Schema.TaggedError<FileTooLarge, { readonly brand: unique symbol }>()(
  "FileTooLarge",
  { path: Path, most: Schema.Int },
) {}

/**
 * A file cannot be made at `path` because `other` is in the way: a file the edit keeps, or a file the edit adds, sits where `path` needs a folder.
 *
 * **Details**
 *
 * `path` is the first such new file by UTF-8 bytes, and `other` the shortest path in its way. A link or a submodule in the way fails `NotAFile` first.
 *
 * @category errors
 */
export class PathInTheWay extends Schema.TaggedError<PathInTheWay, { readonly brand: unique symbol }>()(
  "PathInTheWay",
  { path: Path, other: Path },
) {}

/**
 * A commit object is larger than `limits.bytes`.
 *
 * @category errors
 */
export class TooLarge extends Schema.TaggedError<TooLarge, { readonly brand: unique symbol }>()("TooLarge", {
  id: CommitId,
  most: Schema.Int,
}) {}

/**
 * A commit's message holds a NUL byte, which git refuses to write.
 *
 * @category errors
 */
export class NulInMessage extends Schema.TaggedError<NulInMessage, { readonly brand: unique symbol }>()(
  "NulInMessage",
  {},
) {}

/**
 * A commit to write would be larger than `limits.bytes`, so it could not be read back.
 *
 * @category errors
 */
export class TooLargeToWrite extends Schema.TaggedError<TooLargeToWrite, { readonly brand: unique symbol }>()(
  "TooLargeToWrite",
  { most: Schema.Int },
) {}

/**
 * A ref is not where the caller said it was: it is at another commit, it is gone, or it exists when the caller said it did not.
 *
 * @category errors
 */
export class RefMoved extends Schema.TaggedError<RefMoved, { readonly brand: unique symbol }>()("RefMoved", {
  ref: Ref.RefName,
}) {}

/**
 * A ref cannot be made because another ref is in the way: git holds a ref as a file, so a ref cannot sit below a ref or be a folder of one.
 *
 * **Details**
 *
 * `other` is a ref that is in the way: one below `ref`, or one that `ref` would sit below.
 *
 * @category errors
 */
export class RefInTheWay extends Schema.TaggedError<RefInTheWay, { readonly brand: unique symbol }>()("RefInTheWay", {
  ref: Ref.RefName,
  other: Ref.RefName,
}) {}

/**
 * The trees of the two sides of a merge could not be combined: each path in `paths` was changed on both sides, in ways that do not agree.
 *
 * **Details**
 *
 * `paths` holds each conflicting path once, sorted by its UTF-8 bytes, and is never empty.
 *
 * @category errors
 */
export class Conflict extends Schema.TaggedError<Conflict, { readonly brand: unique symbol }>()("Conflict", {
  paths: Schema.NonEmptyArray(Path),
}) {}

/**
 * The own commits of a rebase cannot be rebased: `commits` are the merge commits among them, or, when there is no merge commit, the commits with no parent.
 *
 * **Details**
 *
 * `reason` says which. A merge commit has no one line to move, and a commit with no parent means the branch shares no history with the upstream or the new base. `commits` names every such commit, sorted by id, so both adapters name the same ones.
 *
 * @category errors
 */
export class CannotRebase extends Schema.TaggedError<CannotRebase, { readonly brand: unique symbol }>()(
  "CannotRebase",
  { reason: Schema.Literals(["merge", "root"]), commits: Schema.NonEmptyArray(CommitId) },
) {}

/**
 * A call took longer than `limits.time`.
 *
 * @category errors
 */
export class TimedOut extends Schema.TaggedError<TimedOut, { readonly brand: unique symbol }>()("TimedOut", {
  after: Schema.Duration,
}) {}

/**
 * The git binary could not start.
 *
 * @category errors
 */
export class NotStarted extends Schema.TaggedError<NotStarted, { readonly brand: unique symbol }>()("NotStarted", {
  cause: Schema.Defect(),
}) {}

/**
 * The git binary ended with a code no call reads as an answer, and kept at most `limits.bytes` of what it said on stderr.
 *
 * @category errors
 */
export class Exited extends Schema.TaggedError<Exited, { readonly brand: unique symbol }>()("Exited", {
  code: Schema.Int,
  stderr: Schema.String,
}) {}

/**
 * What the git binary printed could not be read.
 *
 * @category errors
 */
export class Unreadable extends Schema.TaggedError<Unreadable, { readonly brand: unique symbol }>()("Unreadable", {
  cause: Schema.Defect(),
}) {}

/**
 * The git binary is older than a call needs. `found` holds the version it printed, as numbers, and `needs` the oldest the call takes.
 *
 * **Details**
 *
 * When a layer is built it fails with `needs` of `"2.38"`, the oldest the calls are held to. `mergeTrees` needs `"2.40"` and fails as a `GitUnavailable` reason before it runs a command.
 *
 * @category errors
 */
export class GitTooOld extends Schema.TaggedError<GitTooOld, { readonly brand: unique symbol }>()("GitTooOld", {
  found: Schema.String,
  needs: Schema.String,
}) {}

/**
 * Git could not answer. The `reason` says how.
 *
 * **Details**
 *
 * The reason is also the error's JavaScript `cause`, so a printed error and a failed span's exception name the reason and what is under it. The wire holds the reason alone.
 *
 * @category errors
 */
export class GitUnavailable extends Schema.TaggedError<GitUnavailable, { readonly brand: unique symbol }>()(
  "GitUnavailable",
  {
    reason: Schema.Union([NotStarted, Exited, Unreadable, GitTooOld]),
  },
) {
  override readonly cause = this.reason;
}

/**
 * The path holds no git repository.
 *
 * **Details**
 *
 * It fails only when a layer is built.
 *
 * @category errors
 */
export class NoRepository extends Schema.TaggedError<NoRepository, { readonly brand: unique symbol }>()(
  "NoRepository",
  { path: Schema.String },
) {}

type Fails = GitUnavailable | TimedOut;

const isConflict = Schema.is(Conflict);

// UTF-8 or nothing: a byte that is not valid is a failure, never a replacement character. A leading BOM is kept.
const utf8 = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true });

// A read's span says whether there is a file and, for one, how many bytes it holds. The file itself and its path are never an attribute.
const found = (file: Option.Option<Uint8Array>): Effect.Effect<Option.Option<Uint8Array>> =>
  Effect.as(
    Effect.annotateCurrentSpan({
      "kalfa.git.found": Option.isSome(file),
      ...(Option.isSome(file) ? { "kalfa.git.bytes": file.value.length } : {}),
    }),
    file,
  );

/**
 * The files an edit replaces or removes, by path: new bytes, or `"absent"`, the word for a file that should not exist.
 *
 * @category models
 */
export type Edit = ReadonlyMap<Path, Uint8Array | "absent">;

// What a caller says to write a commit: the committer is the settings' and the clock's, never the caller's.
type NewCommit = {
  readonly tree: TreeId;
  readonly parents: ReadonlyArray<CommitId>;
  readonly author: Commit.Signature;
  readonly message: string;
};

/**
 * Service that reads commits and refs from one repository, writes a commit and moves a ref.
 *
 * **Details**
 *
 * - `readCommit` answers the commit, or `NoSuchCommit`.
 * - `readRefs` answers the ref `under` and every ref below `under/`, sorted by their UTF-8 bytes, as git sorts. `[]` means there is none.
 * - `walk` answers every commit an `include` commit reaches, itself included, that no `exclude` commit reaches, oldest first: each commit comes after its parents.
 * - `mergeBases` answers the best common ancestors of two commits, sorted by id. `[]` means the two share no history.
 * - `isAncestor` answers whether `descendant` reaches `ancestor`. A commit is its own ancestor.
 * - `patchId` answers the name of the changes from the files of `from` to the files of `to`, or none when the two hold the same files. It reads no history, so it answers in a shallow repository. It fails with `NoSuchCommit` for an id the repository lacks, then with `TooMany` (`files`) and `DiffTooLarge`, each before any content is read.
 * - `rangePatchId` answers the patch id of a branch's own changes: from the one merge base of `commit` and `upstream` to `commit`, or none when there are none. It fails with `UnclearBase` naming the merge bases when there is none or more than one, and with `HistoryTooShort` in a shallow repository, as `mergeBases` does. It is one call of the service, with one span and one time limit.
 * - `readFile` answers the bytes of the file at `path` in the files of `commit`, kept exactly, or none when git proved no file is there. An empty file is `Some` of no bytes. It fails with `NoSuchCommit`, then `NotAFile` when the path holds a folder, a link or a submodule, or passes through a link or a submodule, then `FileTooLarge` when the file holds more than `limits.blob` bytes. It reads no history, so it answers in a shallow repository. The bytes are the caller's: a call never hands out its own copy.
 * - `readText` is `readFile` read as UTF-8 with no replacement: a byte that is not UTF-8 fails `NotUtf8` naming the path. A BOM, a CR and a NUL byte are text and are kept. It is one call, with one span and one time limit.
 * - `diff` answers every file the files of `from` and `to` differ in, sorted by path, with the lines added and removed, or `[]` when the two hold the same files. It fails as `patchId` does, with `NotAFile` for a submodule after the files limit and `NotUtf8` for a text file whose lines are not UTF-8 after the size limit.
 *
 * - `editTree` answers the id of the tree of `base`'s files with each change of the edit applied, which the repository then holds. Every other path keeps its entry, byte for byte. A replaced file keeps its mode, a new file is `100644`, a folder left with no files goes, and an edit that changes nothing gives back `base`'s own tree. `"absent"` on a path that holds nothing is no change. It reads no history, so it answers in a shallow repository, and it moves no ref. It fails with `FileTooLarge` when a new content holds more than `limits.blob` bytes, naming the first such path by UTF-8 bytes, before anything else, then `NoSuchCommit`, then `NotAFile` for a path `readFile` refuses (removal included, so a link is never replaced or removed), then `PathInTheWay`. Nothing is written when it fails.
 * - `writeCommit` writes one commit and answers it. Its committer is the settings' one, at the clock's second and offset `+0000`. It fails when the message holds a NUL byte, when the object would pass `limits.bytes`, and when the tree is no tree or a parent is no commit. It moves no ref.
 * - `rebase` makes a new commit for each of the own commits of a branch, on `onto`, and answers them oldest first. The own commits are those `commit` reaches that neither `upstream` nor `onto` reaches. Each new commit keeps the old one's author and message and has the settings' committer at one whole second for all. It fails `CannotRebase` naming every merge commit among the own commits, else every root, `Conflict` naming the paths of the first commit whose files cannot be combined, and `NulInMessage` or `TooLargeToWrite` before any commit is written. The old commits stay as they were and no ref moves. It is one call of the service, with one span and one time limit.
 * - `mergeTrees` merges the trees of `ours` and `theirs` over the tree of `mergeBase`, file by file, and answers the id of the merged tree, which the repository then holds. It fails `Conflict` naming each path that cannot be combined. It reads no history, so a shallow repository answers, and it moves no ref. Merging needs git 2.40 in the git adapter.
 * - `moveRef` points `ref` at `to`, making it or moving it, only if the ref is at `from` now: `Option.none()` means it must not exist. It fails `RefMoved` when it is elsewhere and `RefInTheWay` when another ref is in the way, and then leaves every ref as it was. A call that ends in `TimedOut` may have moved the ref, so read it again.
 * - `fetch` reads the refs of a remote at `under` and below `under/`, by the remote's name or by its URL, and answers them sorted by their UTF-8 bytes. The repository then holds each answered commit and its history. No ref of this repository moves, and its config, refs and `shallow` file are as they were. `[]` means git proved the remote holds none. It asks the `Credentials` slot once, with the URL git will use (the configured one for a named remote), so its requirement is the slot. It fails with `NoSuchRemote`, `BadRemoteUrl`, `NoCredential`, `FetchFailed`, `HistoryTooShort` (this repository is shallow, or the remote's history is cut below an answered ref), `TooMany` and `RefNotCommit`, and never answers `[]` for a failure.
 *
 * In a shallow repository `walk`, `mergeBases` and `isAncestor` fail with `HistoryTooShort`.
 *
 * @category services
 */
export class Repository extends Context.Service<
  Repository,
  {
    readonly readCommit: (
      id: CommitId,
    ) => Effect.Effect<Commit.Commit, NoSuchCommit | TooLarge | UnreadableCommit | Fails>;
    readonly readRefs: (under: Ref.RefName) => Effect.Effect<ReadonlyArray<Ref.Ref>, TooMany | RefNotCommit | Fails>;
    readonly walk: (range: {
      readonly include: NonEmptyReadonlyArray<CommitId>;
      readonly exclude: ReadonlyArray<CommitId>;
    }) => Effect.Effect<
      ReadonlyArray<Commit.Commit>,
      NoSuchCommit | TooMany | TooLarge | UnreadableCommit | HistoryTooShort | Fails
    >;
    readonly mergeBases: (
      a: CommitId,
      b: CommitId,
    ) => Effect.Effect<ReadonlyArray<CommitId>, NoSuchCommit | TooMany | HistoryTooShort | Fails>;
    readonly isAncestor: (
      ancestor: CommitId,
      descendant: CommitId,
    ) => Effect.Effect<boolean, NoSuchCommit | HistoryTooShort | Fails>;
    readonly patchId: (
      from: CommitId,
      to: CommitId,
    ) => Effect.Effect<Option.Option<PatchId>, NoSuchCommit | TooMany | DiffTooLarge | Fails>;
    readonly readFile: (
      commit: CommitId,
      path: Path,
    ) => Effect.Effect<Option.Option<Uint8Array>, NoSuchCommit | NotAFile | FileTooLarge | Fails>;
    readonly readText: (
      commit: CommitId,
      path: Path,
    ) => Effect.Effect<Option.Option<string>, NotUtf8 | NoSuchCommit | NotAFile | FileTooLarge | Fails>;
    readonly diff: (
      from: CommitId,
      to: CommitId,
    ) => Effect.Effect<Diff, NotUtf8 | NotAFile | NoSuchCommit | TooMany | DiffTooLarge | Fails>;
    readonly rangePatchId: (range: {
      readonly upstream: CommitId;
      readonly commit: CommitId;
    }) => Effect.Effect<
      Option.Option<PatchId>,
      UnclearBase | HistoryTooShort | NoSuchCommit | TooMany | DiffTooLarge | Fails
    >;
    readonly editTree: (
      base: CommitId,
      changes: Edit,
    ) => Effect.Effect<TreeId, FileTooLarge | NoSuchCommit | NotAFile | PathInTheWay | Fails>;
    readonly writeCommit: (
      commit: NewCommit,
    ) => Effect.Effect<Commit.Commit, NoSuchTree | NoSuchCommit | NulInMessage | TooLargeToWrite | Fails>;
    readonly moveRef: (move: {
      readonly ref: Ref.RefName;
      readonly from: Option.Option<CommitId>;
      readonly to: CommitId;
    }) => Effect.Effect<void, NoSuchCommit | RefMoved | RefInTheWay | Fails>;
    readonly mergeTrees: (merge: {
      readonly mergeBase: CommitId;
      readonly ours: CommitId;
      readonly theirs: CommitId;
    }) => Effect.Effect<TreeId, NoSuchCommit | Conflict | Fails>;
    readonly fetch: (request: {
      readonly remote: Remote.Remote;
      readonly under: Ref.RefName;
    }) => Effect.Effect<
      ReadonlyArray<Ref.Ref>,
      | Remote.NoSuchRemote
      | Remote.BadRemoteUrl
      | Credentials.NoCredential
      | Remote.FetchFailed
      | HistoryTooShort
      | TooMany
      | RefNotCommit
      | Fails,
      Credentials.Credentials
    >;
    readonly rebase: (rebase: {
      readonly upstream: CommitId;
      readonly commit: CommitId;
      readonly onto: CommitId;
    }) => Effect.Effect<
      ReadonlyArray<Commit.Commit>,
      | CannotRebase
      | Conflict
      | NulInMessage
      | TooLargeToWrite
      | NoSuchCommit
      | TooMany
      | TooLarge
      | UnreadableCommit
      | HistoryTooShort
      | Fails
    >;
  }
>()("@kalfa/git/Repository") {}

/**
 * What an adapter writes: the service's calls, except that `writeCommit` is handed the committer, which `make` sets, `rangePatchId`, which `make` writes once from `mergeBases` and `patchId`, `readText`, which `make` writes once from `readFile`, and `rebase`, which `make` writes once from `walk`, `mergeTrees` and `writeCommit`. `fetch` is two calls, since `make` asks the slot between them: `remoteUrl` finds the URL git would use, and `fetch` reads from it with the credential the slot gave. Neither holds the slot.
 *
 * @category models
 */
export type Raw = Omit<Repository["Service"], "writeCommit" | "rangePatchId" | "readText" | "rebase" | "fetch"> & {
  readonly writeCommit: (
    commit: NewCommit & { readonly committer: Commit.Signature },
  ) => ReturnType<Repository["Service"]["writeCommit"]>;
  /** The URL git would use for the remote: a named one's from config, and a URL as given, each checked. */
  readonly remoteUrl: (
    remote: Remote.Remote,
  ) => Effect.Effect<Remote.Url, Remote.NoSuchRemote | Remote.BadRemoteUrl | Fails>;
  readonly fetch: (request: {
    readonly url: Remote.Url;
    readonly under: Ref.RefName;
    readonly credential: Option.Option<Credentials.Credential>;
  }) => Effect.Effect<ReadonlyArray<Ref.Ref>, Remote.FetchFailed | HistoryTooShort | TooMany | RefNotCommit | Fails>;
};

// What a commit to write must pass before any command, so every commit written can be read back: no NUL byte in its message, and
// no more than `limits.bytes` bytes. `writeCommit` and `rebase` both ask it.
const refusal = (
  commit: NewCommit & { readonly committer: Commit.Signature },
  most: number,
): NulInMessage | TooLargeToWrite | undefined => {
  if (commit.message.includes("\0")) {
    return new NulInMessage();
  }

  return bytes(commit).length > most ? new TooLargeToWrite({ most }) : undefined;
};

// The settings' committer at the clock's whole second, offset `+0000`.
const committerAt = (settings: Settings.Settings): Effect.Effect<Commit.Signature> =>
  Effect.map(
    Clock.currentTimeMillis,
    (millis) =>
      new Commit.Signature({ ...settings.committer, at: { seconds: Math.floor(millis / 1000), offset: "+0000" } }),
  );

/**
 * Wraps an adapter's calls with a span each and the time limit, writes `rangePatchId` from two of them, `readText` from one, `rebase` from three and `fetch` from two, asks the `Credentials` slot once on each fetch, checks the size of an edit's contents, and gives each commit written its committer.
 *
 * **When to use**
 *
 * Use when building an adapter's service, so each names its spans alike and stops a call at `limits.time`.
 *
 * **Details**
 *
 * A span is named `git.<call>`. Its attributes follow OpenTelemetry's version control names where they exist and `kalfa.git.*` where they do not. No message, name, email or path is ever an attribute. A call that runs past the time limit is interrupted and fails with `TimedOut`. `writeCommit` fails before the adapter runs when the message holds a NUL byte or the object would pass `limits.bytes`, so every commit written can be read back, and it hands the adapter the settings' committer at the clock's whole second and offset `+0000`. `rebase` does the same checks for every new commit before it writes any, with the committer's time read once.
 *
 * @category constructors
 */
export const make = (raw: Raw, settings: Settings.Settings): Repository["Service"] => {
  const after = Settings.timeLimit(settings);

  const limited = <A, E, R>(call: Effect.Effect<A, E, R>): Effect.Effect<A, E | TimedOut, R> =>
    Effect.timeoutOrElse(call, { duration: after, orElse: () => Effect.fail(new TimedOut({ after })) });

  return {
    readCommit: Effect.fn("git.readCommit")(function* (id: CommitId) {
      yield* Effect.annotateCurrentSpan({ "vcs.ref.head.revision": id });

      return yield* limited(raw.readCommit(id));
    }),
    readRefs: Effect.fn("git.readRefs")(function* (under: Ref.RefName) {
      yield* Effect.annotateCurrentSpan({ "kalfa.git.under": under });
      const refs = yield* limited(raw.readRefs(under));
      yield* Effect.annotateCurrentSpan({ "kalfa.git.refs": refs.length });

      return refs;
    }),
    walk: Effect.fn("git.walk")(function* (range: {
      readonly include: NonEmptyReadonlyArray<CommitId>;
      readonly exclude: ReadonlyArray<CommitId>;
    }) {
      yield* Effect.annotateCurrentSpan({ "kalfa.git.include": range.include, "kalfa.git.exclude": range.exclude });
      const commits = yield* limited(raw.walk(range));
      yield* Effect.annotateCurrentSpan({ "kalfa.git.commits": commits.length });

      return commits;
    }),
    mergeBases: Effect.fn("git.mergeBases")(function* (a: CommitId, b: CommitId) {
      yield* Effect.annotateCurrentSpan({ "vcs.ref.head.revision": a, "vcs.ref.base.revision": b });
      const bases = yield* limited(raw.mergeBases(a, b));
      yield* Effect.annotateCurrentSpan({ "kalfa.git.bases": bases.length });

      return bases;
    }),
    isAncestor: Effect.fn("git.isAncestor")(function* (ancestor: CommitId, descendant: CommitId) {
      yield* Effect.annotateCurrentSpan({ "vcs.ref.base.revision": ancestor, "vcs.ref.head.revision": descendant });
      const answer = yield* limited(raw.isAncestor(ancestor, descendant));
      yield* Effect.annotateCurrentSpan({ "kalfa.git.ancestor": answer });

      return answer;
    }),
    patchId: Effect.fn("git.patchId")(function* (from: CommitId, to: CommitId) {
      yield* Effect.annotateCurrentSpan({ "vcs.ref.base.revision": from, "vcs.ref.head.revision": to });
      const patch = yield* limited(raw.patchId(from, to));

      if (Option.isSome(patch)) {
        yield* Effect.annotateCurrentSpan({ "kalfa.git.patch": patch.value });
      }

      return patch;
    }),
    rangePatchId: Effect.fn("git.rangePatchId")(function* (range: {
      readonly upstream: CommitId;
      readonly commit: CommitId;
    }) {
      yield* Effect.annotateCurrentSpan({
        "vcs.ref.base.revision": range.upstream,
        "vcs.ref.head.revision": range.commit,
      });

      // One time limit around both raw calls, so a slow helper still ends, and one span, so the raw calls are not wrapped again.
      const patch = yield* limited(
        Effect.gen(function* () {
          const bases = yield* raw.mergeBases(range.commit, range.upstream);
          const [base, ...others] = bases;

          if (base === undefined || others.length > 0) {
            return yield* new UnclearBase({ bases });
          }

          yield* Effect.annotateCurrentSpan({ "kalfa.git.base": base });

          return yield* raw.patchId(base, range.commit);
        }),
      );

      if (Option.isSome(patch)) {
        yield* Effect.annotateCurrentSpan({ "kalfa.git.patch": patch.value });
      }

      return patch;
    }),
    readFile: Effect.fn("git.readFile")(function* (commit: CommitId, path: Path) {
      yield* Effect.annotateCurrentSpan({ "vcs.ref.head.revision": commit });
      const file = yield* limited(raw.readFile(commit, path));

      return yield* found(file);
    }),
    readText: Effect.fn("git.readText")(function* (commit: CommitId, path: Path) {
      yield* Effect.annotateCurrentSpan({ "vcs.ref.head.revision": commit });
      const file = yield* found(yield* limited(raw.readFile(commit, path)));

      if (Option.isNone(file)) {
        return Option.none();
      }

      const text = yield* Effect.try({ try: () => utf8.decode(file.value), catch: () => new NotUtf8({ path }) });

      return Option.some(text);
    }),
    diff: Effect.fn("git.diff")(function* (from: CommitId, to: CommitId) {
      yield* Effect.annotateCurrentSpan({ "vcs.ref.base.revision": from, "vcs.ref.head.revision": to });
      const files = yield* limited(raw.diff(from, to));

      yield* Effect.annotateCurrentSpan({
        "kalfa.git.files": files.length,
        "kalfa.git.lines": files.reduce(
          (total, file) => total + (Predicate.isTagged(file.content, "Text") ? file.content.lines.length : 0),
          0,
        ),
      });

      return files;
    }),
    editTree: Effect.fn("git.editTree")(function* (base: CommitId, changes: Edit) {
      yield* Effect.annotateCurrentSpan({ "vcs.ref.base.revision": base, "kalfa.git.changes": changes.size });

      // What the caller gave is checked before any command, as `writeCommit`'s are, so every file written can be read back.
      for (const [path, change] of [...changes].toSorted(([a], [b]) => byBytes(a, b))) {
        if (change !== "absent" && change.length > settings.limits.blob) {
          return yield* new FileTooLarge({ path, most: settings.limits.blob });
        }
      }

      const tree = yield* limited(raw.editTree(base, changes));
      yield* Effect.annotateCurrentSpan({ "kalfa.git.tree": tree });

      return tree;
    }),
    writeCommit: Effect.fn("git.writeCommit")(function* (commit: NewCommit) {
      yield* Effect.annotateCurrentSpan({ "kalfa.git.tree": commit.tree, "kalfa.git.parents": commit.parents });
      const signed = { ...commit, committer: yield* committerAt(settings) };
      const refused = refusal(signed, settings.limits.bytes);

      if (refused !== undefined) {
        return yield* refused;
      }

      const made = yield* limited(raw.writeCommit(signed));
      yield* Effect.annotateCurrentSpan({ "kalfa.git.commit": made.id });

      return made;
    }),
    moveRef: Effect.fn("git.moveRef")(function* (move: {
      readonly ref: Ref.RefName;
      readonly from: Option.Option<CommitId>;
      readonly to: CommitId;
    }) {
      yield* Effect.annotateCurrentSpan({ "vcs.ref.head.name": move.ref, "vcs.ref.head.revision": move.to });

      if (Option.isSome(move.from)) {
        yield* Effect.annotateCurrentSpan({ "kalfa.git.from": move.from.value });
      }

      return yield* limited(raw.moveRef(move));
    }),
    mergeTrees: Effect.fn("git.mergeTrees")(function* (merge: {
      readonly mergeBase: CommitId;
      readonly ours: CommitId;
      readonly theirs: CommitId;
    }) {
      yield* Effect.annotateCurrentSpan({
        "vcs.ref.base.revision": merge.ours,
        "vcs.ref.head.revision": merge.theirs,
        "kalfa.git.merge_base": merge.mergeBase,
      });

      // A conflict is how a merge ends, so its span says how many paths and the paths are kept out of it.
      const tree = yield* limited(raw.mergeTrees(merge)).pipe(
        Effect.tapError((error) =>
          isConflict(error) ? Effect.annotateCurrentSpan({ "kalfa.git.conflicts": error.paths.length }) : Effect.void,
        ),
      );

      yield* Effect.annotateCurrentSpan({ "kalfa.git.tree": tree });

      return tree;
    }),
    fetch: Effect.fn("git.fetch")(function* (request: { readonly remote: Remote.Remote; readonly under: Ref.RefName }) {
      // Neither the URL, the name nor the user name is an attribute: a URL can be a local path, and the user name is half of the credential.
      yield* Effect.annotateCurrentSpan({
        "kalfa.git.remote": Predicate.isTagged(request.remote, "Named") ? "named" : "url",
        "kalfa.git.under": request.under,
      });

      // One time limit around the whole call, the slot's answer included, so a slow filler still ends.
      const refs = yield* limited(
        Effect.gen(function* () {
          const url = yield* raw.remoteUrl(request.remote);
          const slot = yield* Credentials.Credentials;
          const credential = yield* slot.ask(url);
          yield* Effect.annotateCurrentSpan({ "kalfa.git.credential": Option.isSome(credential) });

          return yield* raw.fetch({ url, under: request.under, credential });
        }),
      );

      yield* Effect.annotateCurrentSpan({ "kalfa.git.refs": refs.length });

      return refs;
    }),
    rebase: Effect.fn("git.rebase")(function* (rebase: {
      readonly upstream: CommitId;
      readonly commit: CommitId;
      readonly onto: CommitId;
    }) {
      yield* Effect.annotateCurrentSpan({
        "vcs.ref.base.revision": rebase.upstream,
        "vcs.ref.head.revision": rebase.commit,
        "kalfa.git.onto": rebase.onto,
      });

      // One time limit around every raw call, and one span, so the raw calls are not wrapped again.
      const made = yield* limited(
        Effect.gen(function* () {
          const own = yield* raw.walk({ include: [rebase.commit], exclude: [rebase.upstream, rebase.onto] });

          // Each own commit is a line of one parent, or it is a merge commit or a root, which the call refuses.
          const line: Array<{ readonly commit: Commit.Commit; readonly parent: CommitId }> = [];
          const merges: Array<CommitId> = [];
          const roots: Array<CommitId> = [];

          for (const commit of own) {
            const [parent, ...others] = commit.parents;

            if (others.length > 0) {
              merges.push(commit.id);
            } else if (parent === undefined) {
              roots.push(commit.id);
            } else {
              line.push({ commit, parent });
            }
          }

          if (isReadonlyArrayNonEmpty(merges)) {
            return yield* new CannotRebase({ reason: "merge", commits: sort(Order.String)(merges) });
          }

          if (isReadonlyArrayNonEmpty(roots)) {
            return yield* new CannotRebase({ reason: "root", commits: sort(Order.String)(roots) });
          }

          // Every new commit is checked before any is written. A tree id and a parent id are 40 characters, so the old ones weigh what the new ones will.
          const committer = yield* committerAt(settings);

          for (const { commit } of line) {
            const refused = refusal({ ...commit, parents: [commit.id], committer }, settings.limits.bytes);

            if (refused !== undefined) {
              return yield* refused;
            }
          }

          let tip = rebase.onto;
          const made: Array<Commit.Commit> = [];

          for (const { commit, parent } of line) {
            const tree = yield* raw
              .mergeTrees({ mergeBase: parent, ours: tip, theirs: commit.id })
              .pipe(
                Effect.tapError((error) =>
                  isConflict(error)
                    ? Effect.annotateCurrentSpan({ "kalfa.git.conflicts": error.paths.length })
                    : Effect.void,
                ),
              );

            // The tree was just made, so a tree the repository lacks is a defect of the adapter and no failure of the call.
            const written = yield* raw
              .writeCommit({ tree, parents: [tip], author: commit.author, message: commit.message, committer })
              .pipe(Effect.catchTag("NoSuchTree", Effect.die));

            made.push(written);
            tip = written.id;
          }

          return made;
        }),
      );

      yield* Effect.annotateCurrentSpan({ "kalfa.git.commits": made.length });
      const last = made.at(-1);

      if (last !== undefined) {
        yield* Effect.annotateCurrentSpan({ "kalfa.git.commit": last.id });
      }

      return made;
    }),
  };
};
