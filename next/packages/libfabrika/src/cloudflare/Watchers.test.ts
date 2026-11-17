// next/, W5: Project route absence is evidence of departure; RPC failure is not.
//
// Ticket 1053 slice 1, L7 of the plan (docs/plan/quests/t1053-PLAN.md), written before the build.
// The contract L7 pins, in cloudflare/Publish.ts: `make(sql, send)` gives two fronts over one route
// lookup. `publish(client, update)` takes a `Published`, sends it as one `view` news and answers
// `sent`, or `gone` with no route. `notify(client, news)` sends its `News` as it is, and sends
// nothing with no route. L7 replaces the old part of W5 that sent any object through `publish`
// unchanged: nothing is sent raw now.
import { describe, expect, it } from "@effect/vitest";
import { Arbitrary, Cause, Context, Effect, Exit, Layer, Schema } from "effect";
import { News, Published } from "../runtime/News.ts";
import { nth } from "../runtime/RepliesTest.ts";
import { Publication, WatcherManager, WatcherManagerError } from "../runtime/WatcherManager.ts";
import type { Sql } from "../Sql.ts";
import * as Publish from "./Publish.ts";
import * as WatcherManagerRemote from "./WatcherManagerRemote.ts";

const Step = Arbitrary.all({
  pick: Arbitrary.schema(Schema.Int.check(Schema.isGreaterThanOrEqualTo(0))),
  client: Arbitrary.schema(Schema.NonEmptyString.check(Schema.isMaxLength(240))),
});

const Walk = Arbitrary.array(Step, { minLength: 6, maxLength: 30 });

const patch = { type: "patch", base: 4, rev: 5, patch: [] } as const;
/** The same update as the Project is handed it: with the pid of the process it came from. */
const PID = "process_01m6v5270hetdrt4r8h9vvjwjs";
const published = { ...patch, pid: PID };

/** The route port `Publish.make` reads: one Connection object's name per client. */
const routed = (routes: ReadonlyMap<string, string>): Sql => ({
  exec: (_query, client) => {
    const connection = routes.get(String(client));
    return connection === undefined ? [] : [{ connection }];
  },
  transaction: (f) => f(),
  size: () => 0,
});

const anyPublished = Arbitrary.schema(Published);

describe("watcher delivery evidence, next/", () => {
  it.live.prop(
    "W5: only missing routes give gone; normal notify returns sent, including no socket",
    [Walk],
    ([steps]) =>
      Effect.scoped(
        Effect.gen(function* () {
          const routes = new Map<string, string>();
          const delivered: Array<{ connection: string; client: string; news: News }> = [];
          let failSend = false;

          // Typed synchronous route port. No platform or Connection implementation is replaced here.
          const { publish } = Publish.make(routed(routes), (connection: string, client: string, news: News) =>
            Effect.suspend(() => {
              if (failSend) {
                return Effect.fail(new Error("unknown send failure"));
              }

              delivered.push({ connection, client, news });

              // Deliberately no socket: Connection.notify's unchanged normal return is still sent.
              return Effect.void;
            }),
          );

          let rpc: "ok" | "throw" | "malformed" = "ok";

          const context = yield* Layer.build(
            WatcherManagerRemote.layer((client, update) =>
              Effect.suspend((): Effect.Effect<unknown, Error> => {
                if (rpc === "throw") {
                  return Effect.fail(new Error("RPC unreachable"));
                }

                if (rpc === "malformed") {
                  return Effect.succeed({ unexpected: true });
                }

                // As the Process object calls the Project: the update with its pid.
                return publish(client, { ...update, pid: PID });
              }),
            ),
          );

          const remote = Context.get(context, WatcherManager);

          const reason = Effect.fnUntraced(function* (client: string) {
            const exit = yield* Effect.exit(remote.publish(client, patch));
            expect(Exit.isFailure(exit)).toBe(true);

            if (!Exit.isFailure(exit)) {
              return "unexpected success";
            }

            expect(Cause.hasFails(exit.cause)).toBe(true);
            const error = Schema.decodeUnknownSync(Schema.toType(WatcherManagerError))(Cause.squash(exit.cause));
            expect(error._tag).toBe("WatcherManagerError");
            expect(error.reason.cause).toBeDefined();

            return error.reason._tag;
          });

          for (const step of steps) {
            const held = [...routes.keys()];
            const client = held.length && step.pick % 2 ? nth(held, step.pick) : step.client;
            routes.delete(client);
            expect(yield* publish(client, published)).toEqual(Publication.cases.gone.make({}));
            expect(yield* reason(client)).toBe("Gone");
            routes.set(client, `connection-${step.pick}`);
            delivered.length = 0;
            expect(yield* publish(client, published)).toEqual(Publication.cases.sent.make({}));
            expect(delivered).toEqual([
              { connection: routes.get(client), client, news: News.cases.view.make({ update: published }) },
            ]);
            yield* remote.publish(client, patch);
            failSend = true;
            expect(yield* reason(client)).toBe("Unreachable");
            failSend = false;

            for (const mode of ["throw", "malformed"] as const) {
              rpc = mode;
              expect(yield* reason(client)).toBe("Unreachable");
            }

            rpc = "ok";
            // Unknown failure of one route must not poison subsequent live delivery.
            yield* remote.publish(client, patch);
          }
        }),
      ),
    { arbitrary: { seed: 119120, runs: 100 } },
  );

  // Generator contract: every run draws one news of each case from the case's own Schema and one
  // update of each `type`, so each case and each kind of update goes through both fronts in every run.
  // Plant: `publish` hands its update on as it came, with no `view` news around it.
  it.effect.prop(
    "L7: with a route, publish sends exactly one view news holding its update and answers sent, and notify sends its news unchanged; with no route both send nothing and publish answers gone",
    {
      client: Schema.NonEmptyString.check(Schema.isMaxLength(240)),
      other: Schema.NonEmptyString.check(Schema.isMaxLength(240)),
      connection: Schema.NonEmptyString.check(Schema.isMaxLength(64)),
      close: News.cases.close,
      granted: News.cases.granted,
      whole: anyPublished.pipe(Arbitrary.filter((u) => u.type === "whole")),
      patch: anyPublished.pipe(Arbitrary.filter((u) => u.type === "patch")),
    },
    ({ client, other, connection, close, granted, whole, patch }) =>
      Effect.gen(function* () {
        const routes = new Map<string, string>();
        const delivered: Array<{ connection: string; client: string; news: News }> = [];
        const told = Publish.make(routed(routes), (connection: string, client: string, news: News) =>
          Effect.sync(() => {
            delivered.push({ connection, client, news });
          }),
        );
        const updates = [whole, patch];
        const all = [close, granted, ...updates.map((update) => News.cases.view.make({ update }))];

        // No route, or only another client's: nothing is sent, and a publish learns the client is gone.
        for (const held of [[], other === client ? [] : [other]]) {
          routes.clear();

          for (const name of held) {
            routes.set(name, `not-${connection}`);
          }

          for (const update of updates) {
            expect(yield* told.publish(client, update), "no route answers gone").toEqual(
              Publication.cases.gone.make({}),
            );
          }

          for (const news of all) {
            expect(yield* told.notify(client, news), "notify answers nothing").toBeUndefined();
          }

          expect(delivered, "no route sends nothing").toEqual([]);
        }

        routes.set(client, connection);

        for (const update of updates) {
          delivered.length = 0;
          expect(yield* told.publish(client, update), "a route answers sent").toEqual(Publication.cases.sent.make({}));
          expect(delivered, "one view news holding the update, to the client's own Connection object").toEqual([
            { connection, client, news: News.cases.view.make({ update }) },
          ]);
          expect(News.guards.view(delivered[0]?.news), "what publish sends is a view").toBe(true);
        }

        for (const news of all) {
          delivered.length = 0;
          expect(yield* told.notify(client, news), "notify answers nothing").toBeUndefined();
          expect(delivered, "the news as it was given, once").toEqual([{ connection, client, news }]);
          expect(delivered[0]?.news, "the very value, not a copy with a new shape").toBe(news);
        }
      }),
    { arbitrary: { seed: 119120, runs: 100 } },
  );
});
