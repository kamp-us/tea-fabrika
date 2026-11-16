import { Option, Result, Function } from "effect";
import type { Sender, SendersError } from "../../permissions/Senders.ts";
import type { Life } from "./processTable.ts";

/**
 * The member a life was started for, its process owner (0172): the member its first start was
 * checked against. A restarted life's start is `again`, which records none.
 *
 * @internal
 */
export const recorded = (life: Life): Sender | undefined =>
  life.request._tag === "first" ? life.request.member : undefined;

/**
 * Picks the member a call is checked against (0170, 0531): the sender of the input that caused it,
 * as `Senders` answered, else the caller's recorded member, else none. A `Senders` failure stays
 * the caller's to judge: `ended` and `removed` are refusals, `storage` is not.
 *
 * @internal
 */
export const pick: {
  (
    member: Sender | undefined,
  ): (sender: Result.Result<Option.Option<Sender>, SendersError>) => Result.Result<Option.Option<Sender>, SendersError>;
  (
    sender: Result.Result<Option.Option<Sender>, SendersError>,
    member: Sender | undefined,
  ): Result.Result<Option.Option<Sender>, SendersError>;
} = Function.dual(
  2,
  (
    sender: Result.Result<Option.Option<Sender>, SendersError>,
    member: Sender | undefined,
  ): Result.Result<Option.Option<Sender>, SendersError> =>
    Result.map(sender, (asked) => Option.orElse(asked, () => Option.fromUndefinedOr(member))),
);
