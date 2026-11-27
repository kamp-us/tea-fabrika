// Laws R5 to R10, R18 and R19, for `Recorder.layer` and `Recorder.calls`, on the made-up `Shelf` service beside it, and V5.
//
// The shape these laws hold the module to: `Recorder.layer(Service, impl, { fails })` provides the
// service from `impl` and records each run of an effectful member as `{ method, args }`, in run
// order; a method in `fails` is recorded, then fails with the value given, and its implementation
// does not run. `Recorder.calls(Service)` reads every record, and `Recorder.calls(Service, m)` reads
// one method's argument lists. Each build of the layer starts with no calls.
import { describe, expect, it } from "@effect/vitest";
import * as Cause from "effect/Cause";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as Fiber from "effect/Fiber";
import * as Layer from "effect/Layer";
import * as Match from "effect/Match";
import * as Order from "effect/Order";
import * as Predicate from "effect/Predicate";
import * as Schema from "effect/Schema";
import * as Sink from "effect/Sink";
import * as Stream from "effect/Stream";
import * as TestClock from "effect/testing/TestClock";
import * as Tracer from "effect/Tracer";
import * as Recorder from "./Recorder.ts";
import { Full, Shelf, ShelfId } from "./Shelf.test-support.ts";

type Service = Shelf["Service"];

/**
 * A whole Shelf that writes the name of each member it runs into `ran`, at the run, so a law can
 * tell whether the implementation ran. Its answers come only from the arguments.
 */
const shelf = (ran: Array<string>): Service => ({
  [ShelfId]: ShelfId,
  label: "the made-up shelf",
  put: (name, count) =>
    Effect.suspend(() => {
      ran.push("put");

      return count < 0 ? Effect.fail(Full.make({ item: name })) : Effect.succeed(count * 2);
    }),
  count: (name) =>
    Effect.sync(() => {
      ran.push("count");

      return name.length;
    }),
  size: Effect.sync(() => {
    ran.push("size");

    return 12;
  }),
  watch: (name) =>
    Stream.unwrap(
      Effect.sync(() => {
        ran.push("watch");

        return name === "" ? Stream.fail(Full.make({ item: name })) : Stream.make(name.length, 0);
      }),
    ),
  drain: () => Sink.drain,
});

const Name = Schema.Literals(["a", "jar", "shelf", ""]);

/** A sort key, so the four kinds of call come in any order. */
const At = Schema.Int.check(Schema.isBetween({ minimum: 0, maximum: 40 }));

const Put = Schema.TaggedStruct("put", {
  name: Name,
  count: Schema.Int.check(Schema.isBetween({ minimum: 0, maximum: 9 })),
  at: At,
});

/** A put whose count is under zero, which the made-up shelf answers with `Full`. */
const Overfull = Schema.TaggedStruct("put", {
  name: Name,
  count: Schema.Int.check(Schema.isBetween({ minimum: -9, maximum: -1 })),
  at: At,
});

const Count = Schema.TaggedStruct("count", { name: Name, at: At });

const Size = Schema.TaggedStruct("size", { at: At });

const Watch = Schema.TaggedStruct("watch", { name: Name, at: At });

/**
 * A run of Shelf calls with every kind in it: two puts at least (so a method is called again), one
 * the shelf refuses, and one count, size and watch at least, mixed by their sort keys.
 */
const Moves = Schema.Struct({
  puts: Schema.Array(Put).check(Schema.isMinLength(2)),
  overfull: Overfull,
  counts: Schema.NonEmptyArray(Count),
  sizes: Schema.NonEmptyArray(Size),
  watches: Schema.NonEmptyArray(Watch),
});

type Move = typeof Put.Type | typeof Count.Type | typeof Size.Type | typeof Watch.Type;

type Failing = "put" | "size" | "watch";

/** The moves in the order they run. The sort is stable, so equal keys keep their kind's order. */
const ordered = (m: typeof Moves.Type): ReadonlyArray<Move> =>
  [...m.puts, m.overfull, ...m.counts, ...m.sizes, ...m.watches].toSorted((x, y) => x.at - y.at);

/** The coverage every case must reach, or the law fails loudly rather than pass on less. */
const covered = (moves: ReadonlyArray<Move>) => {
  expect(new Set(moves.map((m) => m._tag))).toEqual(new Set(["put", "count", "size", "watch"]));
  expect(moves.filter((m) => Predicate.isTagged(m, "put")).length).toBeGreaterThanOrEqual(3);
  expect(moves.some((m) => Predicate.isTagged(m, "put") && m.count < 0)).toBe(true);
};

/** Runs one move on a shelf, to its end, and keeps how it ended. */
const run = (s: Service, m: Move): Effect.Effect<Exit.Exit<unknown, Full>> =>
  Match.valueTags(m, {
    put: (put) => Effect.exit(s.put(put.name, put.count)),
    count: (count) => Effect.exit(s.count(count.name)),
    size: () => Effect.exit(s.size),
    watch: (watch) => Effect.exit(Stream.runCollect(s.watch(watch.name))),
  });

/** The record a move must leave: its method and exactly its args, `[]` for the Effect member. */
const recorded: (m: Move) => Recorder.Call<Service> = Match.type<Move>().pipe(
  Match.withReturnType<Recorder.Call<Service>>(),
  Match.tagsExhaustive({
    put: (put) => ({ method: "put", args: [put.name, put.count] }),
    count: (count) => ({ method: "count", args: [count.name] }),
    size: () => ({ method: "size", args: [] }),
    watch: (watch) => ({ method: "watch", args: [watch.name] }),
  }),
);

/** What a run answered, as plain data a law can compare: the value, the error, or the defect. */
const answer = (exit: Exit.Exit<unknown, Full>) =>
  Exit.isSuccess(exit) ? { value: exit.value } : { error: Cause.squash(exit.cause) };

/** The value each failing method raises, one object each, so a law can see it is that very value. */
const refusals: Readonly<Record<Failing, Full>> = {
  put: Full.make({ item: "refused put" }),
  size: Full.make({ item: "refused size" }),
  watch: Full.make({ item: "refused watch" }),
};

const failsFor = (failing: ReadonlyArray<Failing>): Recorder.Fails<Service> => ({
  ...(failing.includes("put") ? { put: refusals.put } : {}),
  ...(failing.includes("size") ? { size: refusals.size } : {}),
  ...(failing.includes("watch") ? { watch: refusals.watch } : {}),
});

describe("Recorder.layer records each run of a watched member", () => {
  // Each case runs the drawn moves twice, each time on a fresh layer: one after another, where the record is exactly the
  // moves in order, and at once through `Effect.forEach` at the drawn concurrency, where it is the same moves in any order.
  // Plants: record only a method's first call; drop a call's last arg; write the record as a read, a pause and a write
  // in place of `Ref.update`, so two calls that overlap lose one (red only in the run at once).
  it.effect.prop(
    "R5 property: every run of every watched member is recorded with exactly its args, in run order when one after another and as the same calls when at once, and an Effect member records []",
    { moves: Moves, concurrency: Schema.Literals([2, 4, "unbounded"]) },
    ({ moves, concurrency }) =>
      Effect.gen(function* () {
        const list = ordered(moves);
        covered(list);

        const kept = (runAll: (s: Service) => Effect.Effect<unknown>) =>
          Effect.gen(function* () {
            yield* runAll(yield* Shelf);

            return yield* Recorder.calls(Shelf);
          }).pipe(Effect.provide(Recorder.layer(Shelf, shelf([]))));

        const inOrder = yield* kept((s) => Effect.forEach(list, (m) => run(s, m), { concurrency: 1 }));
        expect(inOrder).toEqual(list.map(recorded));

        const atOnce = yield* kept((s) => Effect.forEach(list, (m) => run(s, m), { concurrency }));

        const byText = Order.mapInput(Order.String, (call: Recorder.Call<Service>) => JSON.stringify(call));
        expect(atOnce.toSorted(byText)).toEqual(list.map(recorded).toSorted(byText));
      }),
  );

  // Plants: run the implementation before failing; map the implementation's answer.
  it.effect.prop(
    "R6 property: a method in fails is recorded, fails with exactly the given value and its implementation does not run; any other answers what the implementation answers",
    { moves: Moves, failing: Schema.NonEmptyArray(Schema.Literals(["put", "size", "watch"])) },
    ({ moves, failing }) => {
      const ran: Array<string> = [];
      const plain = shelf([]);

      const failed = (m: Move): Failing | null =>
        !Predicate.isTagged(m, "count") && failing.includes(m._tag) ? m._tag : null;

      return Effect.gen(function* () {
        const list = ordered(moves);
        covered(list);
        const s = yield* Shelf;

        for (const m of list) {
          const got = yield* run(s, m);
          const refusal = failed(m);
          const want = refusal === null ? answer(yield* run(plain, m)) : { error: refusals[refusal] };
          expect(answer(got), JSON.stringify(m)).toEqual(want);
          // The very value given, not one equal to it.
          expect(refusal === null || (Exit.isFailure(got) && Cause.squash(got.cause) === refusals[refusal])).toBe(true);
        }

        expect(ran).toEqual(list.flatMap((m) => (failed(m) === null ? [m._tag] : [])));
        expect(yield* Recorder.calls(Shelf)).toEqual(list.map(recorded));
      }).pipe(Effect.provide(Recorder.layer(Shelf, shelf(ran), { fails: failsFor(failing) })));
    },
  );

  // Plant: answer one method's list reversed.
  it.effect.prop(
    "R7 property: calls(Service, m) is the args of the calls whose method is m, in the same order",
    { moves: Moves },
    ({ moves }) =>
      Effect.gen(function* () {
        const list = ordered(moves);
        covered(list);
        const s = yield* Shelf;

        for (const m of list) {
          yield* run(s, m);
        }

        const all = yield* Recorder.calls(Shelf);
        expect(yield* Recorder.calls(Shelf, "put")).toEqual(all.flatMap((c) => (c.method === "put" ? [c.args] : [])));
        expect(yield* Recorder.calls(Shelf, "count")).toEqual(
          all.flatMap((c) => (c.method === "count" ? [c.args] : [])),
        );
        expect(yield* Recorder.calls(Shelf, "size")).toEqual(all.flatMap((c) => (c.method === "size" ? [c.args] : [])));
        expect(yield* Recorder.calls(Shelf, "watch")).toEqual(
          all.flatMap((c) => (c.method === "watch" ? [c.args] : [])),
        );
      }).pipe(Effect.provide(Recorder.layer(Shelf, shelf([])))),
  );
});

describe("a call is a run, a Stream is watched, and each build starts empty", () => {
  // scenario: the plan's three runs of one put, each the edge of "a call is a run".
  // Plant: record when the function is called.
  it.effect(
    "R8 scenario: an Effect built and dropped is not recorded, one retried once is recorded twice, and one that never ends is recorded at its start",
    () =>
      Effect.gen(function* () {
        const dropped = yield* Effect.gen(function* () {
          const s = yield* Shelf;
          const built = [s.put("a", 1)];
          expect(built).toHaveLength(1);

          return yield* Recorder.calls(Shelf);
        }).pipe(Effect.provide(Recorder.layer(Shelf, shelf([]))));

        expect(dropped).toEqual([]);

        const retried = yield* Effect.gen(function* () {
          const s = yield* Shelf;
          const exit = yield* Effect.exit(s.put("jar", -1).pipe(Effect.retry({ times: 1 })));
          expect(Exit.isFailure(exit)).toBe(true);

          return yield* Recorder.calls(Shelf);
        }).pipe(Effect.provide(Recorder.layer(Shelf, shelf([]))));

        expect(retried).toEqual([
          { method: "put", args: ["jar", -1] },
          { method: "put", args: ["jar", -1] },
        ]);

        const endless = yield* Effect.gen(function* () {
          const s = yield* Shelf;
          const fiber = yield* s.put("shelf", 2).pipe(Effect.timeoutOption("1 second"), Effect.forkChild);
          yield* TestClock.adjust("1 second");
          const ended = yield* Fiber.join(fiber);
          expect(ended._tag).toBe("None");

          return yield* Recorder.calls(Shelf);
        }).pipe(Effect.provide(Recorder.layer(Shelf, { ...shelf([]), put: () => Effect.never })));

        expect(endless).toEqual([{ method: "put", args: ["shelf", 2] }]);
      }),
  );

  // scenario: one stream run to its end and one failing, the two ways a Stream method answers.
  // Plant: pass Stream members through unwatched.
  it.effect(
    "R9 scenario: a Stream method is recorded when its stream runs, and one in fails answers a failing stream with the given value",
    () =>
      Effect.gen(function* () {
        const ran: Array<string> = [];

        const flowing = yield* Effect.gen(function* () {
          const s = yield* Shelf;
          const stream = s.watch("jar");
          const before = yield* Recorder.calls(Shelf);
          const counts = yield* Stream.runCollect(stream);

          return { before, counts, after: yield* Recorder.calls(Shelf) };
        }).pipe(Effect.provide(Recorder.layer(Shelf, shelf(ran))));

        expect(flowing).toEqual({ before: [], counts: [3, 0], after: [{ method: "watch", args: ["jar"] }] });
        expect(ran).toEqual(["watch"]);

        const held: Array<string> = [];

        const refused = yield* Effect.gen(function* () {
          const s = yield* Shelf;
          const exit = yield* Effect.exit(Stream.runCollect(s.watch("jar")));

          return { exit, after: yield* Recorder.calls(Shelf) };
        }).pipe(Effect.provide(Recorder.layer(Shelf, shelf(held), { fails: { watch: refusals.watch } })));

        expect(Exit.isFailure(refused.exit) ? Cause.squash(refused.exit.cause) : refused.exit).toBe(refusals.watch);
        expect(refused.after).toEqual([{ method: "watch", args: ["jar"] }]);
        expect(held).toEqual([]);
      }),
  );

  // scenario: one layer provided to two runs in turn, then a member the law left out.
  // Plant: keep the store at module level.
  it.effect(
    "R10 scenario: each build of the layer starts with no calls, and a member left out of impl dies with UnimplementedError and is not recorded",
    () =>
      Effect.gen(function* () {
        const layer = Recorder.layer(Shelf, shelf([]));

        const once = Effect.gen(function* () {
          const s = yield* Shelf;
          yield* s.count("jar");

          return yield* Recorder.calls(Shelf);
        }).pipe(Effect.provide(layer));

        expect(yield* once).toEqual([{ method: "count", args: ["jar"] }]);
        expect(yield* once).toEqual([{ method: "count", args: ["jar"] }]);

        const part = yield* Effect.gen(function* () {
          const s = yield* Shelf;
          const exit = yield* Effect.exit(s.count("jar"));

          return { exit, after: yield* Recorder.calls(Shelf), label: s.label };
        }).pipe(
          Effect.provide(
            Recorder.layer(Shelf, { [ShelfId]: ShelfId, label: "a part of a shelf", drain: shelf([]).drain }),
          ),
        );

        const defect =
          Exit.isFailure(part.exit) && Cause.hasDies(part.exit.cause) ? Cause.squash(part.exit.cause) : null;

        expect(defect).toBeInstanceOf(Error);
        expect(defect instanceof Error ? defect.name : null).toBe("UnimplementedError");
        expect(part.after).toEqual([]);
        expect(part.label).toBe("a part of a shelf");
      }),
  );

  // scenario: the call as a law writes it, impl inline on Shelf, which has a symbol member. Its
  // type half is read by the typecheck: the directive goes unused if the left-out put compiles.
  // Plant: type fails as Fails<S>, every method again.
  it.effect(
    "R18 scenario: in the inferred call on a service with a symbol member, fails names only a method impl gives, and impl only the service's own members",
    () =>
      Effect.gen(function* () {
        const given = Recorder.layer(
          Shelf,
          {
            [ShelfId]: ShelfId,
            label: "a part of a shelf",
            drain: () => Sink.drain,
            put: (name, count) => Effect.succeed(name.length + count),
          },
          { fails: { put: refusals.put } },
        );

        const left = Recorder.layer(
          Shelf,
          { [ShelfId]: ShelfId, label: "a part of a shelf", drain: () => Sink.drain },
          // @ts-expect-error R18: put is left out of impl, so fails may not name it
          { fails: { put: refusals.put } },
        );

        const exit = yield* Effect.gen(function* () {
          const s = yield* Shelf;

          return { exit: yield* Effect.exit(s.put("jar", 1)), after: yield* Recorder.calls(Shelf) };
        }).pipe(Effect.provide(given));

        expect(Exit.isFailure(exit.exit) ? Cause.squash(exit.exit.cause) : exit.exit).toBe(refusals.put);
        expect(exit.after).toEqual([{ method: "put", args: ["jar", 1] }]);

        const stray = Recorder.layer(Shelf, {
          [ShelfId]: ShelfId,
          label: "a part of a shelf",
          drain: () => Sink.drain,
          // @ts-expect-error R18: nope is no member of Shelf, so impl may not give it
          nope: () => Effect.void,
        });

        expect(Layer.isLayer(left)).toBe(true);
        expect(Layer.isLayer(stray)).toBe(true);
      }),
  );
});

/** A second made-up service, so a run can record two at once. */
class Rack extends Context.Service<Rack, { readonly hang: (name: string) => Effect.Effect<number> }>()(
  "@kalfa/quality/vitest/Rack",
) {}

describe("two recorded services keep their own calls", () => {
  // Plant: give every service's store the same id, so the second layer's record replaces the first's.
  it.effect.prop(
    "R19 property: a run that records two services reads each one's own calls, whatever each was handed",
    { shelved: Schema.NonEmptyArray(Name), racked: Schema.NonEmptyArray(Name) },
    ({ shelved, racked }) =>
      Effect.gen(function* () {
        const s = yield* Shelf;
        const r = yield* Rack;

        for (const name of shelved) {
          yield* s.count(name);
        }

        for (const name of racked) {
          yield* r.hang(name);
        }

        expect(yield* Recorder.calls(Shelf, "count")).toEqual(shelved.map((name) => [name]));
        expect(yield* Recorder.calls(Rack, "hang")).toEqual(racked.map((name) => [name]));
      }).pipe(
        Effect.provide(
          Layer.mergeAll(
            Recorder.layer(Shelf, shelf([])),
            Recorder.layer(Rack, { hang: (name) => Effect.succeed(name.length) }),
          ),
        ),
      ),
  );
});

describe("the Recorder makes no span of its own", () => {
  // scenario: one layer with no failing method and one with every failing method, each run through every kind of member
  // once, under a tracer that keeps every span it is asked to start. The runs are checked too, so the law reads the paths
  // it means to.
  // Plants: wrap the record's write in Effect.withSpan("Recorder.write"), which starts one span a call; make calls an
  // Effect.fn("Recorder.calls"), which starts one a read.
  it.effect(
    "V5 scenario: put, count, size, watch and a method in fails run once each, then calls reads them back, and the tracer was asked for no span",
    () =>
      Effect.gen(function* () {
        const delegate = yield* Tracer.Tracer;
        const spans: Array<Tracer.Span> = [];

        const tracer = Tracer.make({
          span(options) {
            const span = delegate.span(options);
            spans.push(span);

            return span;
          },
        });

        const everyMember = (fails: Recorder.Fails<Service>) =>
          Effect.gen(function* () {
            const s = yield* Shelf;
            yield* Effect.exit(s.put("jar", 1));
            yield* Effect.exit(s.count("jar"));
            yield* Effect.exit(s.size);
            yield* Effect.exit(Stream.runCollect(s.watch("jar")));

            return (yield* Recorder.calls(Shelf)).map((call) => call.method);
          }).pipe(Effect.provide(Recorder.layer(Shelf, shelf([]), { fails })), Effect.withTracer(tracer));

        const answering = yield* everyMember({});
        const refusing = yield* everyMember(failsFor(["put", "size", "watch"]));

        expect(answering).toEqual(["put", "count", "size", "watch"]);
        expect(refusing).toEqual(["put", "count", "size", "watch"]);
        expect(spans.map((span) => span.name)).toEqual([]);
      }),
  );
});
