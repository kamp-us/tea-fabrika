// PullRequests: what the lead tooling asks GitHub about pull requests, and the few writes it makes
// (the push-every-commit rule: a draft at a branch's first commit, marked ready when its steps passed;
// the no-friction-before-merge rule: one pinned squash that adds it to GitHub's merge queue; the
// merge-when-ready rule: merge when ready, which pr/Arm.ts turns on; the docs-only admin-merge rule and
// the sev0 rule: an admin merge, which pr/Merge.ts alone asks). This file is the contract only (a
// service file holds only its contract, and each layer is its own file): `PullRequestsGh.layer` asks
// GitHub through `gh`, `PullRequestsTest.layer`
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
  /** Whether it merges into its base cleanly: `CONFLICTING` when it does not, `UNKNOWN` while GitHub is still working it out. */
  mergeable: Schema.Literals(["MERGEABLE", "CONFLICTING", "UNKNOWN"]),
});

export type Detail = typeof Detail.Type;

/**
 * One file a pull request changes, as GitHub's files list gives it: its path, and its unified diff
 * hunks, `null` where GitHub shows none (a binary file, or one too big to show).
 */
export const Patch = Schema.Struct({ path: Schema.String, patch: Schema.NullOr(Schema.String) });

export type Patch = typeof Patch.Type;

/**
 * One entry of the merge queue for main, as GitHub's `mergeQueue` lists it: the pull request in it
 * and how it stands there (`AWAITING_CHECKS`, `QUEUED`, `LOCKED`, `MERGEABLE`, `UNMERGEABLE`). Any
 * entry has a build running or about to, which an admin merge to main restarts.
 */
export const QueueEntry = Schema.Struct({ number: Schema.Finite, state: Schema.String });

export type QueueEntry = typeof QueueEntry.Type;

/**
 * One merged pull request as the recent-merges list gives it: its number, its description, the commit
 * it merged at (the commit the close note names), and when it merged.
 */
export const Merged = Schema.Struct({
  number: Schema.Finite,
  body: Schema.String,
  mergeCommit: Schema.String,
  mergedAt: Schema.String,
});

export type Merged = typeof Merged.Type;

/** What a new or edited pull request says: its title and its description. */
export type Text = { readonly title: string; readonly body: string };

export class PullRequests extends Context.Service<
  PullRequests,
  {
    /** The open pull request whose head is `branch`; none when the branch has none. */
    readonly openOn: (branch: string) => Effect.Effect<Option.Option<PullRequest>, PullRequestsError>;
    /** Every pull request of the repo, open, closed and merged. Fails when one read cannot hold all. */
    readonly all: Effect.Effect<ReadonlyArray<PullRequest>, PullRequestsError>;
    /**
     * The `scan` pull requests merged into main that were most recently updated, in update order, not merge
     * order. A merge is an update, and so is a late comment on an old merge, so a merge can fall out of the
     * scan once more than `scan` merged pull requests were updated after it. GitHub's search answers at most
     * 1000. A caller that wants the newest merges sorts by `mergedAt` itself.
     */
    readonly merged: (scan: number) => Effect.Effect<ReadonlyArray<Merged>, PullRequestsError>;
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
    /** Every entry of the merge queue for main now, first in line first; none when the queue is empty or main has no queue. */
    readonly queue: Effect.Effect<ReadonlyArray<QueueEntry>, PullRequestsError>;
    /** The numbers of the GitHub issues that are open now, pull requests left out (a body closes one with `Closes #<n>`, never with `fabrika close ticket`). */
    readonly openIssues: Effect.Effect<ReadonlyArray<number>, PullRequestsError>;
    /** The path of every file pull request `number` changes. */
    readonly files: (number: number) => Effect.Effect<ReadonlyArray<string>, PullRequestsError>;
    /** Each file pull request `number` changes, with its diff hunks (pr/Names.ts reads them, a new helper names the tools it searched, and a new name cites the industry's word). */
    readonly patches: (number: number) => Effect.Effect<ReadonlyArray<Patch>, PullRequestsError>;
    /**
     * Turns on GitHub's merge when ready for pull request `number`, as a squash, pinned to the head
     * `oid` (the lead turns on merge when ready once the steps passed, and GitHub queues it on green): GitHub queues it once `ci-required` is green there, and never on another head.
     */
    readonly arm: (number: number, oid: string) => Effect.Effect<void, PullRequestsError>;
    /**
     * Squash-merges pull request `number` past the merge queue, pinned to the head `oid`: an admin
     * merge, which only pr/Merge.ts asks, for a docs-only pull request (the lead admin-merges a docs-only pull request after checking it is not broken), a sev fix at either
     * level (a sev fix is admin-merged one at a time on current main), or a ready pull request in a sev0 (no pull request is in a stack, and in a sev0 the lead admin-merges ready ones in order).
     */
    readonly admin: (number: number, oid: string) => Effect.Effect<void, PullRequestsError>;
  }
>()("lead/pr/PullRequests") {}
