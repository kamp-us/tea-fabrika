/**
 * The service that reads commits and refs from one repository with no working copy, writes a commit and moves a ref, the failures it names, and `make`.
 *
 * **Details**
 *
 * This file holds the contract and the one wrap every adapter gets, and nothing that runs git. A call never reads HEAD and never changes the files of a working copy. `writeCommit` adds one commit and `moveRef` moves one ref, and no other call writes. Each adapter is its own entry point, `memory` and `process`, and `test` holds the laws they all pass.
 */
import { Clock, Context, Effect, Option, Schema } from "effect";
import type { NonEmptyReadonlyArray } from "effect/Array";
import * as Commit from "./Commit.ts";
import { CommitId } from "./CommitId.ts";
import { bytes } from "./internal/object.ts";
import * as Ref from "./Ref.ts";
import * as Settings from "./Settings.ts";
import { TreeId } from "./Tree.ts";

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
 * An answer would hold more than a limit allows: more commits (a walk or a merge-base answer) or more refs than the setting.
 *
 * @category errors
 */
export class TooMany extends Schema.TaggedError<TooMany, { readonly brand: unique symbol }>()("TooMany", {
  limit: Schema.Literals(["commits", "refs"]),
  most: Schema.Int,
}) {}

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
 * Git could not answer. The `reason` says how.
 *
 * @category errors
 */
export class GitUnavailable extends Schema.TaggedError<GitUnavailable, { readonly brand: unique symbol }>()(
  "GitUnavailable",
  {
    reason: Schema.Union([NotStarted, Exited, Unreadable]),
  },
) {}

/**
 * The git binary is older than 2.38. `found` holds the version it printed, as numbers.
 *
 * **Details**
 *
 * It fails only when a layer is built.
 *
 * @category errors
 */
export class GitTooOld extends Schema.TaggedError<GitTooOld, { readonly brand: unique symbol }>()("GitTooOld", {
  found: Schema.String,
}) {}

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
 *
 * - `writeCommit` writes one commit and answers it. Its committer is the settings' one, at the clock's second and offset `+0000`. It fails when the message holds a NUL byte, when the object would pass `limits.bytes`, and when the tree is no tree or a parent is no commit. It moves no ref.
 * - `moveRef` points `ref` at `to`, making it or moving it, only if the ref is at `from` now: `Option.none()` means it must not exist. It fails `RefMoved` when it is elsewhere and `RefInTheWay` when another ref is in the way, and then leaves every ref as it was. A call that ends in `TimedOut` may have moved the ref, so read it again.
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
    readonly writeCommit: (
      commit: NewCommit,
    ) => Effect.Effect<Commit.Commit, NoSuchTree | NoSuchCommit | NulInMessage | TooLargeToWrite | Fails>;
    readonly moveRef: (move: {
      readonly ref: Ref.RefName;
      readonly from: Option.Option<CommitId>;
      readonly to: CommitId;
    }) => Effect.Effect<void, NoSuchCommit | RefMoved | RefInTheWay | Fails>;
  }
>()("@kalfa/git/Repository") {}

/**
 * What an adapter writes: the service's calls, except that `writeCommit` is handed the committer, which `make` sets.
 *
 * @category models
 */
export type Raw = Omit<Repository["Service"], "writeCommit"> & {
  readonly writeCommit: (
    commit: NewCommit & { readonly committer: Commit.Signature },
  ) => ReturnType<Repository["Service"]["writeCommit"]>;
};

/**
 * Wraps an adapter's seven calls with a span each and the time limit, and gives each commit written its committer.
 *
 * **When to use**
 *
 * Use when building an adapter's service, so each names its spans alike and stops a call at `limits.time`.
 *
 * **Details**
 *
 * A span is named `git.<call>`. Its attributes follow OpenTelemetry's version control names where they exist and `kalfa.git.*` where they do not. No message, name, email or path is ever an attribute. A call that runs past the time limit is interrupted and fails with `TimedOut`. `writeCommit` fails before the adapter runs when the message holds a NUL byte or the object would pass `limits.bytes`, so every commit written can be read back, and it hands the adapter the settings' committer at the clock's whole second and offset `+0000`.
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
    writeCommit: Effect.fn("git.writeCommit")(function* (commit: NewCommit) {
      yield* Effect.annotateCurrentSpan({ "kalfa.git.tree": commit.tree, "kalfa.git.parents": commit.parents });

      if (commit.message.includes("\0")) {
        return yield* new NulInMessage();
      }

      const seconds = Math.floor((yield* Clock.currentTimeMillis) / 1000);

      const signed = {
        ...commit,
        committer: new Commit.Signature({ ...settings.committer, at: { seconds, offset: "+0000" } }),
      };

      if (bytes(signed).length > settings.limits.bytes) {
        return yield* new TooLargeToWrite({ most: settings.limits.bytes });
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
  };
};
