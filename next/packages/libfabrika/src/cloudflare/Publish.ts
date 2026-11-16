import { Effect, Function, Predicate } from "effect";
import { Publication } from "../runtime/WatcherManager.ts";
import type { Sql } from "../Sql.ts";

type Notify<E> = (connection: string, client: string, news: unknown) => Effect.Effect<void, E>;

type Publish<E> = (client: string, update: unknown) => Effect.Effect<typeof Publication.Type, E>;

const makeBody = <E>(sql: Sql, notify: Notify<E>) =>
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
  });

/** Slice 1 checks the Project route only; Connection.notify keeps its void result. */
export const make: {
  <E>(notify: Notify<E>): (sql: Sql) => Publish<E>;
  <E>(sql: Sql, notify: Notify<E>): Publish<E>;
} = Function.dual(2, makeBody);
