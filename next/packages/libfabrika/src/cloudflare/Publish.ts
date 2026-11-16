import { Effect, Predicate, Function } from "effect";
import { Publication } from "../runtime/WatcherManager.ts";
import type { Sql } from "../Sql.ts";

/** Slice 1 checks the Project route only; Connection.notify keeps its void result. */
export const make: {
  <E>(
    notify: (connection: string, client: string, news: unknown) => Effect.Effect<void, E>,
  ): (sql: Sql) => (client: string, update: unknown) => Effect.Effect<typeof Publication.Type, E>;
  <E>(
    sql: Sql,
    notify: (connection: string, client: string, news: unknown) => Effect.Effect<void, E>,
  ): (client: string, update: unknown) => Effect.Effect<typeof Publication.Type, E>;
} = Function.dual(
  2,
  <E>(sql: Sql, notify: (connection: string, client: string, news: unknown) => Effect.Effect<void, E>) =>
    Effect.fn("project.publish")(function* (client: string, update: unknown) {
      const row = yield* Effect.sync(() => sql.exec("SELECT connection FROM dev_clients WHERE client=?", client)[0]);

      if (row === undefined) {
        return Publication.cases.gone.make({});
      }

      const news =
        Predicate.isObject(update) && "type" in update
          ? { method: update.type === "whole" ? "view.whole" : "view.patch", params: update }
          : update;
      yield* notify(String(row.connection), client, news);
      return Publication.cases.sent.make({});
    }),
);
