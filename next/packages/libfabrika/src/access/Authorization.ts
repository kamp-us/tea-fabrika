/**
 * Checks that a key belongs, then writes, in one synchronous ledger transaction.
 */
import * as Effect from "effect/Effect";
import * as Result from "effect/Result";
import * as Schema from "effect/Schema";
import * as Rec from "effect/Record";
import { LedgerError } from "../ledger/Ledger.ts";
import { LedgerTransaction } from "../ledger/LedgerTransaction.ts";
import { Appended, type Line, valueFor } from "../ledger/Log.ts";
import { short } from "../telemetry/Trace.ts";
import { admitted, MemberEvent } from "./Access.ts";
import { foldAccess } from "./AccessFold.ts";
import { NotGranted } from "./SessionManager.ts";

const known: ReadonlySet<string> = new Set(Rec.keys(MemberEvent.cases));
const decodeEventResult = Schema.decodeUnknownResult(MemberEvent);

/**
 * Appends a line to a stream only if the key is admitted by the membership as it stands now.
 *
 * **Details**
 *
 * Inside one transaction it reads every row of `gateway/access` from the start, skips rows whose
 * tag is not a membership event, folds the rest, and asks `admitted` about the key. If the key may
 * dial, it appends the line and returns it as `placed`. The check and the write share the
 * transaction, so membership cannot change between them. It needs `LedgerTransaction`, and adds
 * span fields for the id, the stream and the outcome (`placed`, `not_granted` or the ledger
 * error's reason).
 *
 * **Gotchas**
 *
 * A membership row that does not decode fails the write with a `LedgerError` of reason `bad_row`.
 * A key that is not admitted fails with `NotGranted` and nothing is written.
 *
 * @category combinators
 */
export const appendAdmitted = Effect.fn("authorization.appendAdmitted")(
  function* (key: string, write: { readonly stream: string; readonly id: string; readonly line: Line }) {
    yield* Effect.annotateCurrentSpan(
      short({ "fab.authorization.id": write.id, "fab.authorization.stream": write.stream }),
    );
    const transaction = yield* LedgerTransaction;

    const result = yield* transaction.transact((turn): Result.Result<Appended, LedgerError | NotGranted> => {
      const events: MemberEvent[] = [];

      for (const row of turn.read("gateway/access", 0)) {
        if (!known.has(row._tag)) {
          continue;
        }

        const event = decodeEventResult(valueFor(row));

        if (Result.isFailure(event)) {
          return Result.fail(LedgerError.make({ reason: "bad_row", cause: event.failure }));
        }

        events.push(event.success);
      }

      if ("reason" in admitted(foldAccess(events), key)) {
        return Result.fail(NotGranted.make({}));
      }

      return Result.succeed(Appended.cases.placed.make(turn.append(write.stream, write.id, write.line)));
    });

    const appended = yield* Effect.fromResult(result);
    yield* Effect.annotateCurrentSpan("fab.authorization.outcome", "placed");

    return appended;
  },
  Effect.tapError((error) =>
    Effect.annotateCurrentSpan("fab.authorization.outcome", error._tag === "NotGranted" ? "not_granted" : error.reason),
  ),
);
