/**
 * Paged stream discovery on the ledger's SQL tables.
 */
import { Effect, Layer, Option, Stream } from "effect";
import type { Sql } from "../Sql.ts";
import { ledgerStore } from "./internal/ledgerStore.ts";
import { BadRow, LedgerStreams, LedgerStreamsError, Storage } from "./LedgerStreams.ts";
import { PAGE } from "./Log.ts";

/**
 * Supplies discovery using the ledger's table setup and page size.
 *
 * @category layers
 */
export const layer = (sql: Sql): Layer.Layer<LedgerStreams> =>
  Layer.sync(LedgerStreams, () => {
    const store = ledgerStore(sql, { ring: () => Effect.void });

    return {
      list: (prefix: string) =>
        Stream.paginate(null as string | null, (after) =>
          store.streams(prefix, after).pipe(
            Effect.mapBoth({
              onFailure: (error) =>
                new LedgerStreamsError({
                  reason:
                    error.reason === "bad_row"
                      ? new BadRow({ cause: error.cause })
                      : new Storage({ cause: error.cause }),
                }),
              onSuccess: (names) =>
                [names, names.length < PAGE ? Option.none() : Option.fromUndefinedOr(names.at(-1))] as const,
            }),
          ),
        ),
    };
  });
