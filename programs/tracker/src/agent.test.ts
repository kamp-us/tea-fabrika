import { Ledger, listed, memoryStorage, offer, Shell, start } from "@kampus/fabrika-old";
import { driveFor } from "@kampus/fabrika-old/mcp";
import { memoryService } from "@kampus/fabrika-old/memory";
import { Effect, Layer, type Scope } from "effect";
import { describe, expect, it } from "vitest";
import { Author, pullRequestsOf, tracker } from "./index.ts";
import type { Shown } from "./machine.ts";

// An agent's calls on the tracker, as the MCP door makes them (`tracker_query`, `tracker_file`):
// each call answers with the view of its own query, never the view an earlier call left. The
// tracker is the real one, on a ledger in memory, driven through `driveFor` as the host drives it.
//
//   drive.call("tracker_query", {value: {ticket: 1}})   // view.page.number 1, opened.ticket "A"
//   drive.call("tracker_query", {value: {ticket: 2}})   // view.page.number 2, opened.ticket "B"
//   drive.call("tracker_file", {value: {title: "C", body: ""}})   // view.filed 3

const OWNER = { kind: "user", id: "owner" } as const;

const services = (ledger: Ledger["Service"]) =>
  Layer.mergeAll(Layer.succeed(Ledger, ledger), Layer.succeed(Author, OWNER), pullRequestsOf([]));

/** A ledger that already holds tickets 1 and 2, "A" and "B", filed by a tracker run of the person's. */
const seeded = Effect.gen(function* () {
  const ledger = memoryService();
  yield* Effect.gen(function* () {
    const started = yield* start(tracker, {}, {}, { id: "tracker:seed", storage: memoryStorage() });

    if (started.kind !== "running") {
      return yield* Effect.die("the tracker did not start");
    }

    const { run } = started;
    yield* offer(run, "file", { title: "A", body: "" });
    yield* offer(run, "file", { title: "B", body: "" });
    yield* offer(run, "quit", null);
    yield* run.ended;
  }).pipe(Effect.provide(services(ledger)), Effect.scoped);
  return ledger;
});

/** The agent's door on `ledger`: the tracker only, its own run started on the first call. */
const doorOn = (ledger: Ledger["Service"]) =>
  driveFor({
    list: Shell.programList([listed(tracker, services(ledger))]),
    tiles: () => [],
  }).pipe(Effect.map(({ drive }) => drive));

const go = <A, E>(test: Effect.Effect<A, E, Scope.Scope>) => Effect.runPromise(Effect.scoped(test));

/** What a call answered with: its view, as the window's `Shown`. */
const viewOf = (answer: { readonly kind: string; readonly data?: unknown }): Shown => {
  const data = answer.data as { readonly view: Shown };
  return data.view;
};

describe("an agent's call on the tracker answers with its own view", () => {
  it("answers each ticket query with that ticket's page, two in a row", async () => {
    const pages = await go(
      Effect.gen(function* () {
        const drive = yield* doorOn(yield* seeded);
        const a = viewOf(yield* drive.call("tracker_query", { value: { ticket: 1 } }));
        const b = viewOf(yield* drive.call("tracker_query", { value: { ticket: 2 } }));
        const c = viewOf(yield* drive.call("tracker_query", { value: { ticket: 1 } }));
        return [a, b, c].map((v) => (v.page.kind === "ticket" ? [v.page.number, v.page.opened?.ticket.title] : null));
      }),
    );
    expect(pages).toEqual([
      [1, "A"],
      [2, "B"],
      [1, "A"],
    ]);
  });

  it("answers each list query with its own filter, and the tickets that filter picks", async () => {
    const lists = await go(
      Effect.gen(function* () {
        const drive = yield* doorOn(yield* seeded);
        const all = viewOf(yield* drive.call("tracker_query", { value: { status: "all" } }));
        const found = viewOf(yield* drive.call("tracker_query", { value: { status: "open", find: "B" } }));
        const closed = viewOf(yield* drive.call("tracker_query", { value: { status: "closed" } }));
        return [all, found, closed].map((v) => [
          v.filter,
          v.page.kind === "list" ? v.page.tickets.map((t) => t.title) : null,
        ]);
      }),
    );
    expect(lists).toEqual([
      [{ show: "all", find: "" }, ["B", "A"]],
      [{ show: "open", find: "B" }, ["B"]],
      [{ show: "closed", find: "" }, []],
    ]);
  });

  it("answers a file with the number of the ticket it filed, each of three in a row", async () => {
    const filed = await go(
      Effect.gen(function* () {
        const drive = yield* doorOn(yield* seeded);
        const numbers: unknown[] = [];

        for (const title of ["C", "D", "E"]) {
          const view = viewOf(yield* drive.call("tracker_file", { value: { title, body: "" } }));
          numbers.push([view.filed, view.saving.length]);
        }

        return numbers;
      }),
    );
    expect(filed).toEqual([
      [3, 0],
      [4, 0],
      [5, 0],
    ]);
  });
});
