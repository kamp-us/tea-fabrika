import { it } from "@effect/vitest";
import { Duration, Effect, Fiber, Option, Schema } from "effect";
import { TestClock } from "effect/testing";
import { expect } from "vitest";
import { memory } from "./gate.test-support.ts";
import { inLine, join, waiting } from "./gatequeue.ts";
import type { Line, Note } from "./gatequeue.ts";

// Today's tooling: the line for the one mutation box. Time is the test clock; the files are in memory.
const run = { arbitrary: { seed: 119120, runs: 60 } };

const OUTSIDER = 999;

const small = (minimum: number, maximum: number) => Schema.Int.check(Schema.isBetween({ minimum, maximum }));

/** Lets the fibers the test started do all they can without time passing. */
const settle = Effect.gen(function* () {
  for (let i = 0; i < 40; i += 1) {
    yield* Effect.yieldNow;
  }
});

/** The machine as a law sees it: who holds the box, who is alive, and what the line said. */
const world = (live: (pid: number) => boolean, held: number | null = null) => {
  const notes: Array<Note> = [];
  const state = { held, notes };

  const line = (pid: number, over: Partial<Line> = {}): Line => ({
    dir: "/queue",
    pid,
    label: `run ${pid}`,
    holder: Effect.sync(() => state.held),
    alive: (owner) => Effect.succeed(live(owner)),
    say: (note) => Effect.sync(() => void state.notes.push(note)),
    poll: 5,
    every: 60,
    limit: 100_000,
    ...over,
  });

  return { state, line };
};

const nothing = Effect.succeed(Option.none<number>());

/** A run that joins the line and then waits there for good, as one ahead that is still running does. */
const parked = (line: Line) => Effect.scoped(Effect.andThen(join(line), Effect.never));

/** Moves the clock five seconds at a time until the fiber ends, at most `most` times. */
const until = Effect.fnUntraced(function* (fibers: ReadonlyArray<Fiber.Fiber<unknown, unknown>>, most = 400) {
  for (let left = most; left > 0; left -= 1) {
    yield* settle;

    if (fibers.every((fiber) => fiber.pollUnsafe() !== undefined)) {
      return;
    }

    yield* TestClock.adjust(Duration.seconds(5));
  }

  return yield* Effect.die("the runs were still waiting");
});

/** Starts a run and lets it take its place before the next one starts. */
const start = <A, E>(effect: Effect.Effect<A, E, never>) =>
  Effect.gen(function* () {
    const fiber = yield* Effect.forkChild(effect);
    yield* settle;

    return fiber;
  });

it.effect.prop(
  "waiting runs take the box one at a time in the order they arrived, and one that finds it taken in that moment keeps its place",
  { n: small(2, 5), hold: small(1, 40), bounces: small(0, 3) },
  ({ n, hold, bounces }) =>
    Effect.gen(function* () {
      const disk = memory();
      const { state, line } = world(() => true, OUTSIDER);
      const took: Array<number> = [];
      let running = 0;
      let most = 0;
      let bounced = 0;
      let early = 0;

      const use = (pid: number) =>
        Effect.gen(function* () {
          if (pid === 100 && bounced < bounces) {
            bounced += 1;

            return Option.none<number>();
          }

          early += state.held === null ? 0 : 1;
          state.held = pid;
          running += 1;
          most = Math.max(most, running);
          took.push(pid);
          yield* settle;
          running -= 1;
          state.held = null;

          return Option.some(pid);
        });

      yield* Effect.forkChild(
        Effect.andThen(
          // oxlint-disable-next-line fabrika/no-sleep-on-test-clock -- `until` above moves the test clock for this body, which the rule cannot see
          Effect.sleep(Duration.seconds(hold)),
          Effect.sync(() => void (state.held = null)),
        ),
      );

      const fibers: Array<Fiber.Fiber<unknown, unknown>> = [];

      for (let i = 0; i < n; i += 1) {
        // Each later run looks at the line sooner than the one before it, so only the line can put the first one first.
        fibers.push(
          yield* start(inLine(line(100 + i, { poll: 5 - i }), nothing, use(100 + i)).pipe(Effect.provide(disk.layer))),
        );
      }

      yield* until(fibers);

      expect(took, "the order they arrived in").toEqual(Array.from({ length: n }, (_, i) => 100 + i));
      expect(most, "never two boxes").toBe(1);
      expect(early, "never a start while another run held the box").toBe(0);
      expect([...disk.files.keys()], "every place given back").toEqual([]);
    }),
  run,
);

it.effect.prop(
  "a waiting run whose process is gone is skipped and its place dropped, wherever it stands in the line",
  {
    before: Schema.Array(Schema.Literals(["live", "dead"])).check(Schema.isMaxLength(3)),
    after: Schema.Array(Schema.Literals(["live", "dead"])).check(Schema.isMaxLength(3)),
    hold: small(1, 40),
  },
  ({ before, after, hold }) =>
    Effect.gen(function* () {
      // One run at least is live to look at the line; the dead ones stand before it, beside it or after it.
      const stands = [...before, "live", ...after];
      const disk = memory();
      const pid = (i: number) => (stands[i] === "live" ? 100 + i : 500 + i);
      const gone = new Set(stands.flatMap((s, i) => (s === "dead" ? [pid(i)] : [])));

      const { state, line } = world((owner) => !gone.has(owner), OUTSIDER);

      const took: Array<number> = [];

      yield* Effect.forkChild(
        Effect.andThen(
          // oxlint-disable-next-line fabrika/no-sleep-on-test-clock -- `until` above moves the test clock for this body, which the rule cannot see
          Effect.sleep(Duration.seconds(hold)),
          Effect.sync(() => void (state.held = null)),
        ),
      );

      const fibers: Array<Fiber.Fiber<unknown, unknown>> = [];

      for (let i = 0; i < stands.length; i += 1) {
        if (stands[i] === "dead") {
          yield* start(parked(line(pid(i))).pipe(Effect.provide(disk.layer)));
        } else {
          fibers.push(
            yield* start(
              inLine(
                line(pid(i)),
                nothing,
                Effect.sync(() => {
                  took.push(pid(i));

                  return Option.some(pid(i));
                }),
              ).pipe(Effect.provide(disk.layer)),
            ),
          );
        }
      }

      yield* until(fibers);

      expect(took, "the live runs in the order they arrived").toEqual(
        stands.flatMap((s, i) => (s === "live" ? [pid(i)] : [])),
      );

      expect([...disk.files.keys()], "every place is given back, and a dead run's once it is looked at").toEqual([]);
    }),
  run,
);

it.effect.prop(
  "a run behind others says its place and the run ahead when it joins and each minute, and gives up its place after its limit",
  { ahead: small(0, 3), limit: small(130, 400) },
  ({ ahead, limit }) =>
    Effect.gen(function* () {
      const disk = memory();
      const { state, line } = world(() => true, OUTSIDER);
      const used: Array<number> = [];

      for (let i = 0; i < ahead; i += 1) {
        yield* start(parked(line(100 + i)).pipe(Effect.provide(disk.layer)));
      }

      const mine = line(200, { limit });

      const fiber = yield* start(
        inLine(
          mine,
          nothing,
          Effect.sync(() => {
            used.push(1);

            return Option.none<number>();
          }),
        ).pipe(Effect.provide(disk.layer)),
      );

      yield* TestClock.adjust(Duration.seconds(120));
      yield* settle;

      expect(
        state.notes.map((note) => note.waited),
        "once on joining and once each minute",
      ).toEqual([0, 60, 120]);

      for (const note of state.notes) {
        expect(note.place).toBe(ahead + 1);
        expect(note.total).toBe(ahead + 1);
        expect(note.ahead?.pid ?? null).toBe(ahead === 0 ? null : 100 + ahead - 1);
        expect(note.holder).toBe(OUTSIDER);
      }

      yield* until([fiber]);
      const gaveUp = yield* Effect.flip(Fiber.join(fiber));

      expect(gaveUp._tag).toBe("Waited");
      expect(gaveUp._tag === "Waited" && gaveUp.seconds >= limit).toBe(true);
      expect(used, "the box is never taken while it is held").toEqual([]);

      const names = yield* waiting(line(1)).pipe(Effect.provide(disk.layer));
      expect(names.map((ticket) => ticket.pid).sort(), "its place is given up, the others stay").toEqual(
        Array.from({ length: ahead }, (_, i) => 100 + i),
      );
    }),
  run,
);

it.effect.prop(
  "a run that waits leaves the line, and starts no box, once the run ahead has saved the answer it needs",
  { ahead: small(1, 3), after: small(0, 30) },
  ({ ahead, after }) =>
    Effect.gen(function* () {
      const disk = memory();
      const { line } = world(() => true, OUTSIDER);
      let there = false;
      let started = 0;

      for (let i = 0; i < ahead; i += 1) {
        yield* start(parked(line(100 + i)).pipe(Effect.provide(disk.layer)));
      }

      const fiber = yield* start(
        inLine(
          line(200),
          Effect.sync(() => (there ? Option.some(7) : Option.none<number>())),
          Effect.sync(() => {
            started += 1;

            return Option.some(8);
          }),
        ).pipe(Effect.provide(disk.layer)),
      );

      yield* TestClock.adjust(Duration.seconds(after));
      there = true;
      yield* until([fiber]);

      expect(yield* Fiber.join(fiber)).toBe(7);
      expect(started).toBe(0);

      const names = yield* waiting(line(1)).pipe(Effect.provide(disk.layer));
      expect(names.length, "its place is given up, the others stay").toBe(ahead);
    }),
  run,
);

it.effect.prop(
  "a run whose place was removed by hand writes it back at its own place once it looks at the line, and still goes first",
  { hold: small(10, 40) },
  ({ hold }) =>
    Effect.gen(function* () {
      const disk = memory();
      const { state, line } = world(() => true, OUTSIDER);
      const took: Array<number> = [];

      const use = (pid: number) =>
        Effect.sync(() => {
          took.push(pid);

          return Option.some(pid);
        });

      const first = yield* start(inLine(line(100, { poll: 5 }), nothing, use(100)).pipe(Effect.provide(disk.layer)));
      const second = yield* start(inLine(line(101, { poll: 1 }), nothing, use(101)).pipe(Effect.provide(disk.layer)));

      const mine = [...disk.files].filter(([, text]) => text.includes('"pid":100'));
      expect(mine.length).toBe(1);

      for (const [path] of mine) {
        disk.files.delete(path);
      }

      yield* Effect.forkChild(
        Effect.andThen(
          // oxlint-disable-next-line fabrika/no-sleep-on-test-clock -- `until` above moves the test clock for this body, which the rule cannot see
          Effect.sleep(Duration.seconds(hold)),
          Effect.sync(() => void (state.held = null)),
        ),
      );

      yield* until([first, second]);

      expect(took).toEqual([100, 101]);
    }),
  run,
);
