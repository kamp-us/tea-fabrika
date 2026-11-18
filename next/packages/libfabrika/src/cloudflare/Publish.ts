/**
 * How the Project reaches one client's Connection object: through the client's route row, with
 * what the client is told as `News`.
 */
import { Effect } from "effect";
import { News, type Published } from "../runtime/News.ts";
import { Publication } from "../runtime/WatcherManager.ts";
import type { Sql } from "../Sql.ts";

/**
 * Returns the Project's two ways to reach one client's Connection object, over one route lookup:
 * `publish` sends a view update as `view` news, and `notify` sends any news as it is.
 *
 * **Details**
 *
 * Only the Project's route is checked: no route answers `gone` and sends nothing, and
 * Connection.notify keeps its void result.
 *
 * @category constructors
 */
export const make = <E>(sql: Sql, send: (connection: string, client: string, news: News) => Effect.Effect<void, E>) => {
  const deliver = Effect.fn("project.publish")(function* (client: string, news: News) {
    const row = yield* Effect.sync(() => sql.exec("SELECT connection FROM dev_clients WHERE client=?", client)[0]);

    if (row === undefined) {
      return Publication.cases.gone.make({});
    }

    yield* send(String(row.connection), client, news);

    return Publication.cases.sent.make({});
  });

  return {
    publish: (client: string, update: Published) => deliver(client, News.cases.view.make({ update })),
    notify: (client: string, news: News) => deliver(client, news).pipe(Effect.asVoid),
  };
};
