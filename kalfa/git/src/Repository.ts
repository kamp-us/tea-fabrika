/**
 * The service that reads commits and refs from one repository with no working copy, the failures it names, and `make`.
 *
 * **Details**
 *
 * This file holds the contract and the one wrap every adapter gets, and nothing that runs git. A call never reads HEAD, never writes and never changes the repository. Each adapter is its own entry point, `memory` and `process`, and `test` holds the laws they all pass.
 */
import { Context, Effect, Schema } from "effect";
import type { NonEmptyReadonlyArray } from "effect/Array";
import type * as Commit from "./Commit.ts";
import { CommitId } from "./CommitId.ts";
import * as Ref from "./Ref.ts";
import * as Settings from "./Settings.ts";

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

/**
 * Service that reads commits and refs from one repository.
 *
 * **Details**
 *
 * - `readCommit` answers the commit, or `NoSuchCommit`.
 * - `readRefs` answers the ref `under` and every ref below `under/`, sorted by their UTF-8 bytes, as git sorts. `[]` means there is none.
 * - `walk` answers every commit an `include` commit reaches, itself included, that no `exclude` commit reaches, oldest first: each commit comes after its parents.
 * - `mergeBases` answers the best common ancestors of two commits, sorted by id. `[]` means the two share no history.
 * - `isAncestor` answers whether `descendant` reaches `ancestor`. A commit is its own ancestor.
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
  }
>()("@kalfa/git/Repository") {}

/**
 * Wraps an adapter's five calls with a span each and the time limit.
 *
 * **When to use**
 *
 * Use when building an adapter's service, so each names its spans alike and stops a call at `limits.time`.
 *
 * **Details**
 *
 * A span is named `git.<call>`. Its attributes follow OpenTelemetry's version control names where they exist and `kalfa.git.*` where they do not. No message, name, email or path is ever an attribute. A call that runs past the time limit is interrupted and fails with `TimedOut`.
 *
 * @category constructors
 */
export const make = (raw: Repository["Service"], settings: Settings.Settings): Repository["Service"] => {
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
  };
};
