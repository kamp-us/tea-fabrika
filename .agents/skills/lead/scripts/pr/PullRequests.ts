// PullRequests: what the lead tooling asks GitHub about pull requests, and the few writes it makes
// (0134: a draft at a branch's first commit, marked ready when its steps passed; 0162: one pinned
// squash that adds it to GitHub's merge queue; 0530: merge when ready, which pr/Arm.ts turns on;
// 0183 and 0532: an admin merge, which pr/Merge.ts alone asks; ticket 1115: a native stack's
// merge, which pr/Stack.ts alone asks, after its layer gates pass).
// This file is the
// contract only (0095): `PullRequestsGh.layer` asks GitHub through `gh`, `PullRequestsTest.layer`
// answers from a list in memory. Today's lead tooling, run on our own laptop; it is not product.
import { Context, Schema } from "effect";
import type { Effect, Option } from "effect";

/** GitHub could not be asked, refused, or answered in a shape we do not read. */
export class PullRequestsError extends Schema.TaggedError<PullRequestsError, { readonly brand: unique symbol }>()(
  "PullRequestsError",
  {
    reason: Schema.String,
  },
) {}

/** One pull request as GitHub lists it: its branch, the head it holds, and how it stands. */
export const PullRequest = Schema.Struct({
  number: Schema.Finite,
  head: Schema.String,
  /** The commit the branch pointed at when GitHub last read it; for a merged one, the merged head. */
  oid: Schema.String,
  state: Schema.Literals(["OPEN", "CLOSED", "MERGED"]),
  draft: Schema.Boolean,
});

export type PullRequest = typeof PullRequest.Type;

/** One pull request read alone, with the words a squash puts on main and where it merged. */
export const Detail = Schema.Struct({
  ...PullRequest.fields,
  /** The branch it merges into. */
  base: Schema.String,
  title: Schema.String,
  body: Schema.String,
  /** The commit its base holds for it once merged; `null` until then. */
  mergeCommit: Schema.NullOr(Schema.String),
});

export type Detail = typeof Detail.Type;

/**
 * One file a pull request changes, as GitHub's files list gives it: its path, and its unified diff
 * hunks, `null` where GitHub shows none (a binary file, or one too big to show).
 */
export const Patch = Schema.Struct({ path: Schema.String, patch: Schema.NullOr(Schema.String) });

export type Patch = typeof Patch.Type;

/** A pull request head as GitHub lists it in a native stack, in bottom-first order. */
const StackHead = Schema.Struct({ number: Schema.Finite, oid: Schema.String });

/**
 * One native stack as GitHub's stacks list gives it (`GET repos/{repo}/stacks`): its number, which
 * shares the pull requests' number sequence, the branch it lands on, and each pull request's head,
 * bottom first.
 */
export const Stack = Schema.Struct({
  number: Schema.Finite,
  base: Schema.String,
  prs: Schema.Array(StackHead),
});

export type Stack = typeof Stack.Type;

/** The selected stack prefix, with the exact PR facts each layer's gates read. */
export const StackSelection = Schema.Struct({
  number: Schema.Finite,
  base: Schema.String,
  layers: Schema.Array(Detail),
});

export type StackSelection = typeof StackSelection.Type;

/** What GitHub says happened to an async native stack merge request. */
export const StackMerge = Schema.TaggedUnion({
  merged: { commit: Schema.String },
  enqueued: {},
  pending: {
    uuid: Schema.String,
    expectedHeadSha: Schema.String,
    mergeAction: Schema.Literals(["direct_merge", "merge_queue"]),
    mergeMethod: Schema.Literals(["default", "squash"]),
  },
});

export type StackMerge = typeof StackMerge.Type;

/** A branch's effective merge queue, as GitHub's branch queue object and any queue rule agree. */
export const MergeQueue = Schema.Struct({
  build: Schema.Finite,
  merge: Schema.Finite,
  method: Schema.Literals(["MERGE", "SQUASH", "REBASE"]),
});

export type MergeQueue = typeof MergeQueue.Type;

/** What a new or edited pull request says: its title and its description. */
export type Text = { readonly title: string; readonly body: string };

export class PullRequests extends Context.Service<
  PullRequests,
  {
    /** The open pull request whose head is `branch`; none when the branch has none. */
    readonly openOn: (branch: string) => Effect.Effect<Option.Option<PullRequest>, PullRequestsError>;
    /** Every pull request of the repo, open, closed and merged. Fails when one read cannot hold all. */
    readonly all: Effect.Effect<ReadonlyArray<PullRequest>, PullRequestsError>;
    /** Opens a draft pull request from `branch` into main, and answers its number. */
    readonly draft: (branch: string, text: Text, head: string) => Effect.Effect<number, PullRequestsError>;
    /** Sets the title and description of pull request `number`. */
    readonly edit: (number: number, text: Text) => Effect.Effect<void, PullRequestsError>;
    /** Marks draft pull request `number` ready for review. */
    readonly ready: (number: number) => Effect.Effect<void, PullRequestsError>;
    /** Pull request `number` as GitHub has it now, in any state. */
    readonly view: (number: number) => Effect.Effect<Detail, PullRequestsError>;
    /**
     * Asks GitHub to squash-merge pull request `number`, pinned to the head `oid`. On a branch with
     * a merge queue this adds it to the queue: GitHub tests it on newest main and merges it later.
     */
    readonly enqueue: (number: number, oid: string) => Effect.Effect<void, PullRequestsError>;
    /** The path of every file pull request `number` changes. */
    readonly files: (number: number) => Effect.Effect<ReadonlyArray<string>, PullRequestsError>;
    /** Each file pull request `number` changes, with its diff hunks (pr/Names.ts reads them, 0587). */
    readonly patches: (number: number) => Effect.Effect<ReadonlyArray<Patch>, PullRequestsError>;
    /**
     * Turns on GitHub's merge when ready for pull request `number`, as a squash, pinned to the head
     * `oid` (0530): GitHub queues it once `ci-required` is green there, and never on another head.
     */
    readonly arm: (number: number, oid: string) => Effect.Effect<void, PullRequestsError>;
    /**
     * Squash-merges pull request `number` past the merge queue, pinned to the head `oid`: an admin
     * merge, which only pr/Merge.ts asks, for a docs-only pull request (0183) or a sev0 fix (0532).
     */
    readonly admin: (number: number, oid: string) => Effect.Effect<void, PullRequestsError>;
    /** The open native stack pull request `number` is in; none when it is in none. */
    readonly stack: (number: number) => Effect.Effect<Option.Option<Stack>, PullRequestsError>;
    /** The merge queue the rules on `branch` turn on; none when the branch has no queue. */
    readonly mergeQueue: (branch: string) => Effect.Effect<Option.Option<MergeQueue>, PullRequestsError>;
    /**
     * Asks GitHub to merge the exact selected native stack prefix after rereading its identity,
     * links and heads. It rereads layer readiness and text immediately before submission. GitHub
     * pins only the top SHA; lower heads still need source, queue and writer coordination through
     * submission. The result says whether GitHub merged it, queued it, or left it pending. Only
     * pr/Stack.ts asks, after each open layer passed its gates.
     */
    readonly mergeStack: (selection: StackSelection) => Effect.Effect<StackMerge, PullRequestsError>;
  }
>()("lead/pr/PullRequests") {}
