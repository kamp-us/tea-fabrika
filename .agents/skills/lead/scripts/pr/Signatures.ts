// Signatures: the one git question the merge gate (./Gate.ts) asks about a pull request's commits, whether each is signed. This
// file is the contract only (a service file holds only its contract, and each layer is its own file): `SignaturesGit.layer` asks real git,
// `SignaturesTest.layer` answers from memory. Today's lead tooling, run on our own laptop; it is not product.
import { Context, Schema } from "effect";
import type { Effect } from "effect";

/** git could not be asked, so the check cannot tell; it never reads a failure as "every commit is signed". */
export class SignaturesError extends Schema.TaggedError<SignaturesError, { readonly brand: unique symbol }>()(
  "SignaturesError",
  { reason: Schema.String },
) {}

export class Signatures extends Context.Service<
  Signatures,
  {
    /**
     * Each commit of `main..head` that is not signed, oldest first, as `<8 hex> <subject>`: no note on refs/notes/fabrika,
     * no signature of a person's own, and not made by `stepcommit.sh` (whose commits are signed later or sign nothing by
     * design). Fetches main and, when `head` is not in the checkout `dir`, `head`.
     */
    readonly unsigned: (dir: string, head: string) => Effect.Effect<ReadonlyArray<string>, SignaturesError>;
  }
>()("lead/pr/Signatures") {}
