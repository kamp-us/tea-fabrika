// Git: the shared git service of the lead scripts (S2 of docs/plan/quests/port-scripts-0113-PLAN.md).
// This file is the contract only (0095): `GitProcess.layer` runs real git, `GitTest.layer` answers
// from a model in memory, and git.integration.test.ts holds the two to the same answers. It holds
// only the calls a port makes; a later port adds its call here, in both layers, with its law.
// Today's lead tooling, run on our own laptop; it is not product.
import { Context, Schema } from "effect";
import type { Effect } from "effect";

/** A git call failed, so the caller cannot tell; a failure is never read as an empty answer. */
export class GitError extends Schema.TaggedError<GitError, { readonly brand: unique symbol }>()("GitError", {
  /** The git subcommand, such as `diff`. */
  command: Schema.String,
  reason: Schema.String,
}) {}

export class Git extends Context.Service<
  Git,
  {
    /** The repository's top folder, as `git rev-parse --show-toplevel` prints it. */
    readonly top: Effect.Effect<string, GitError>;
    /** What `git diff <args>` writes to stdout, whole. */
    readonly diff: (args: ReadonlyArray<string>) => Effect.Effect<string, GitError>;
  }
>()("lead/git/Git") {}
