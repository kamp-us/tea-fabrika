// Reviews: what the lead tooling reads and writes of a review record on GitHub (pr/Review.ts holds the record itself). The record is a
// commit status with the context `review`, plus one pull request comment that holds the wide facts. This file is the contract only (a
// service file holds only its contract, and each layer is its own file): `ReviewsGh.layer` runs `gh api`, `ReviewsTest.layer` answers
// from memory. Today's lead tooling, run on our own laptop; it is not product.
import { Context, Schema } from "effect";
import type { Effect, Option, Result } from "effect";
import type { Core, Record } from "./Review.ts";

/** GitHub could not be read, refused a write, or answered in a shape we do not read. It never reads as "no statuses". */
export class ReviewsError extends Schema.TaggedError<ReviewsError, { readonly brand: unique symbol }>()(
  "ReviewsError",
  { reason: Schema.String },
) {}

/** One status of context `review` on a head, as GitHub gave it. A status we cannot read is its own case, so it never counts as a pass. */
export type Seen = {
  readonly id: number;
  /** The login that posted it. Kept and shown; this tooling does not judge it. */
  readonly creator: string;
  /** `success`, `failure`, `error` or `pending`, as GitHub says. */
  readonly state: string;
  /** What the state and the description say together; the failure says why not. */
  readonly core: Result.Result<Core, string>;
  /** The status's `target_url`: the comment that holds the first record. */
  readonly url: string | null;
};

export class Reviews extends Context.Service<
  Reviews,
  {
    /** Every status of context `review` on the full 40-character `head`, oldest first. Fails when GitHub cannot be read, never answers none for that. */
    readonly read: (head: string) => Effect.Effect<ReadonlyArray<Seen>, ReviewsError>;
    /**
     * Posts one status on `record.head`. With `url` none it posts the comment first and points the status at it, and posts no
     * status when the comment fails; with `url` some (a carry) it posts the status alone, pointing at that comment.
     */
    readonly write: (pr: number, record: Record, url: Option.Option<string>) => Effect.Effect<void, ReviewsError>;
  }
>()("lead/pr/Reviews") {}
