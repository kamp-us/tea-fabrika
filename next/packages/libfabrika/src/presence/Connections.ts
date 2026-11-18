/**
 * Which clients of a key are connected now, kept in the project's Sql.
 */
import * as Arr from "effect/Array";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Schema from "effect/Schema";
import { LedgerError } from "../ledger/Ledger.ts";
import { ProcessId } from "../ProcessId.ts";
import type { Sql } from "../Sql.ts";
import { short } from "../telemetry/Trace.ts";

/**
 * Schema for one client's connection: its key, client, Connection object, session and join time.
 *
 * @category schemas
 */
export const Connection = Schema.Struct({
  key: Schema.NonEmptyString,
  client: Schema.NonEmptyString,
  gateway: Schema.NonEmptyString,
  session: ProcessId,
  at: Schema.Int,
});

type Connection = typeof Connection.Type;

const Online = Schema.Struct({
  ...Connection.fields,
  state: Schema.Literals(["online", "away", "unknown"]),
});

type Online = typeof Online.Type;

type Adapter<P, A> = {
  readonly probe: (gateway: string, session: string) => Effect.Effect<number | null, LedgerError, P>;
  readonly admitted: (key: string) => Effect.Effect<boolean, LedgerError, A>;
};

const decodeConnection = Schema.decodeUnknownSync(Connection);

// T6's 30-second ping tolerates a missing reply before the 75-second away boundary.
const AWAY = 75_000;

/**
 * Service that records one connection per client and lists a key's connections, each with its state.
 *
 * **Details**
 *
 * `join` saves a connection by client, so a second join from the same client replaces the first.
 * `leave` removes a connection only when the client and session both match. `online` answers an
 * empty list when the key is not admitted. Otherwise it probes each saved connection through the
 * adapter and marks it `online`, `away` (the last reply is at least 75 seconds old) or `unknown`
 * (the probe failed). A connection with no reply time counts from its join time.
 *
 * @category services
 */
export class Connections extends Context.Service<
  Connections,
  {
    readonly join: (connection: Connection) => Effect.Effect<void, LedgerError>;
    readonly leave: (client: string, session: string) => Effect.Effect<void, LedgerError>;
    readonly online: (key: string) => Effect.Effect<ReadonlyArray<Online>, LedgerError>;
  }
>()("@kampus/libfabrika/presence/Connections") {
  static readonly layer = <P, A>(sql: Sql, adapter: Adapter<P, A>): Layer.Layer<Connections, never, P | A> =>
    Layer.effect(
      Connections,
      Effect.gen(function* () {
        // Capture the adapters' services once. Calling a method still does all its work lazily.
        const context = yield* Effect.context<P | A>();

        const stored = Effect.fnUntraced(function* <T>(step: () => T) {
          return yield* Effect.try({
            try: () =>
              sql.transaction(() => {
                sql.exec(`CREATE TABLE IF NOT EXISTS process_connections (
							client TEXT PRIMARY KEY, "key" TEXT NOT NULL, connection TEXT NOT NULL,
							session TEXT NOT NULL, at INTEGER NOT NULL)`);

                return step();
              }),
            catch: (error) =>
              LedgerError.make({ reason: Schema.isSchemaError(error) ? "bad_row" : "storage", cause: error }),
          });
        });

        const probe = Effect.fn("connections.probe")(function* (connection: Connection) {
          yield* Effect.annotateCurrentSpan(
            short({ "fab.connection": connection.gateway, "fab.connection.session": connection.session }),
          );

          return yield* Effect.suspend(() => adapter.probe(connection.gateway, connection.session)).pipe(
            Effect.provideContext(context),
          );
        });

        return {
          join: Effect.fn("connections.join")(function* (connection: Connection) {
            yield* Effect.annotateCurrentSpan(
              short({
                "fab.connection.client": connection.client,
                "fab.connection.session": connection.session,
              }),
            );
            yield* stored(() => {
              const row = decodeConnection(connection);
              sql.exec(
                `INSERT INTO process_connections ("key", client, connection, session, at) VALUES (?, ?, ?, ?, ?)
							ON CONFLICT(client) DO UPDATE SET "key" = excluded."key", connection = excluded.connection,
							session = excluded.session, at = excluded.at`,
                row.key,
                row.client,
                row.gateway,
                row.session,
                row.at,
              );
            });
          }),
          leave: Effect.fn("connections.leave")(function* (client: string, session: string) {
            yield* Effect.annotateCurrentSpan(
              short({ "fab.connection.client": client, "fab.connection.session": session }),
            );
            yield* stored(() => {
              sql.exec(`DELETE FROM process_connections WHERE client = ? AND session = ?`, client, session);
            });
          }),
          online: Effect.fn("connections.online")(function* (key: string) {
            yield* Effect.annotateCurrentSpan(short({ "fab.connection.key": key }));

            if (!(yield* Effect.suspend(() => adapter.admitted(key)).pipe(Effect.provideContext(context)))) {
              return [];
            }

            const connections = yield* stored(() =>
              Arr.map(sql.exec(`SELECT * FROM process_connections WHERE "key" = ? ORDER BY client`, key), (row) =>
                decodeConnection({ ...row, gateway: row.connection }),
              ),
            );

            return yield* Effect.forEach(
              connections,
              (connection) =>
                Effect.gen(function* () {
                  const ping = yield* Effect.result(probe(connection));
                  const now = yield* Effect.clockWith((clock) => clock.currentTimeMillis);

                  return Online.make({
                    ...connection,
                    state:
                      ping._tag === "Failure"
                        ? "unknown"
                        : now - (ping.success ?? connection.at) >= AWAY
                          ? "away"
                          : "online",
                  });
                }),
              { concurrency: "unbounded" },
            );
          }),
        };
      }),
    );
}
