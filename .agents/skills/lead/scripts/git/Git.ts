// Git: the shared git service of the lead scripts (S2 of docs/plan/quests/port-scripts-0113-PLAN.md).
// This file is the contract only (0095): `GitProcess.layer` runs real git, `GitTest.layer` answers
// from a model in memory, and git.integration.test.ts holds the two to the same answers. It holds
// only the calls a port makes; a later port adds its call here, in both layers, with its law.
// Today's lead tooling, run on our own laptop; it is not product.
import { Context, Schema } from "effect";
import type { Effect, Option } from "effect";

/** A git call failed, so the caller cannot tell; a failure is never read as an empty answer. */
export class GitError extends Schema.TaggedError<GitError>()("GitError", {
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
    /**
     * The git folder every worktree of the repository shares, absolute, as
     * `git rev-parse --path-format=absolute --git-common-dir` prints it (S6).
     */
    readonly commonDir: Effect.Effect<string, GitError>;
    /** The URL of the remote `name`, as `git remote get-url <name>` prints it; none when no such remote. */
    readonly remote: (name: string) => Effect.Effect<Option.Option<string>, GitError>;
    /** The value of `key` in the person's global config, as `git config --global --get`; none when unset. */
    readonly globalConfig: (key: string) => Effect.Effect<Option.Option<string>, GitError>;
  }
>()("lead/git/Git") {}
