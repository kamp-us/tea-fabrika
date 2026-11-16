/**
 * The relation store in memory, for tests: the same fold as the ledger's, over the changes it holds.
 *
 * @stability unstable
 */
import { Effect, Equal, Layer, Result } from "effect";
import { fold } from "./internal/relationsTable.ts";
import type { Change } from "./Relation.ts";
import { Relations, RelationsError } from "./Relations.ts";

/**
 * Layer that provides `Relations` in memory, starting from `changes`.
 *
 * **Details**
 *
 * It keeps each change once, by its id, in the order first written, as the referee does: a resend
 * of a change adds nothing, and an id used before for another row fails the whole write `storage`,
 * with nothing kept. `within` ignores the turn it is given and folds what it holds. Every change it
 * holds counts: there is no other writer to skip.
 *
 * @stability unstable
 * @category layers
 */
export const layer = (changes: ReadonlyArray<Change>): Layer.Layer<Relations> =>
  Layer.effect(
    Relations,
    Effect.gen(function* () {
      const held = new Map<string, Change>();
      const add = (batch: ReadonlyArray<Change>): Result.Result<void, RelationsError> => {
        const next = new Map(held);

        for (const change of batch) {
          const first = next.get(change.id);

          if (first === undefined) {
            next.set(change.id, change);
          } else if (!Equal.equals(first.row, change.row)) {
            return Result.fail(
              RelationsError.make({ reason: "storage", cause: `the id ${change.id} holds another row` }),
            );
          }
        }

        for (const [id, change] of next) {
          held.set(id, change);
        }

        return Result.succeed(undefined);
      };
      // A test that hands in two rows under one id has a broken fixture, not a refusal to answer.
      yield* Effect.fromResult(add(changes)).pipe(Effect.orDie);
      return Relations.of({
        within: () => Result.succeed(fold([...held.values()].map(({ row }) => row))),
        write: (batch) => Effect.fromResult(add(batch)),
      });
    }),
  );
