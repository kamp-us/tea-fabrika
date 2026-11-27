// Changes: the one git question the merge gate's review check asks (./Gate.ts): which paths a pull request's head changes. This file is the
// contract only (a service file holds only its contract, and each layer is its own file): `ChangesGit.layer` asks real git,
// `ChangesTest.layer` answers from memory. Today's lead tooling, run on our own laptop; it is not product.
import { Context, Schema } from "effect";
import type { Effect } from "effect";

/** git could not be asked, so the check cannot tell; it never reads a failure as "no path changed". */
export class ChangesError extends Schema.TaggedError<ChangesError, { readonly brand: unique symbol }>()(
  "ChangesError",
  { reason: Schema.String },
) {}

export class Changes extends Context.Service<
  Changes,
  {
    /**
     * Every path `origin/main...head` changes in the checkout `dir`, both halves of a move, as `git diff --name-only -z --no-renames`
     * prints them. Never cut; a git that cannot answer fails.
     */
    readonly paths: (dir: string, head: string) => Effect.Effect<ReadonlyArray<string>, ChangesError>;
  }
>()("lead/pr/Changes") {}
