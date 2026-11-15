// The memory restart plan (docs/plan/lanes/memory-restart-PLAN.md), next/, L5 and L6. `terminate` is
// the brain's bounded stop: SIGTERM once, a grace, then SIGKILL. Its effects are arguments, so these
// laws run it with a stand-in process on the test clock and record every signal with its moment.
import { describe, expect, it } from "@effect/vitest";
import { Clock, Deferred, Effect, Exit, Fiber, Schema } from "effect";
import { TestClock } from "effect/testing";
import { terminate } from "./local-dev.ts";

const SEED = 119120;
const between = (minimum: number, maximum: number) => Schema.Int.check(Schema.isBetween({ minimum, maximum }));

type Signal = "SIGTERM" | "SIGKILL";
type Entry = { readonly step: Signal | "killing"; readonly at: number };

// What `process.kill` does for a pid that no longer exists: it throws ESRCH. dev.ts sends a signal
// inside `Effect.sync`, so the throw reaches `terminate` as that Effect's defect.
const missing = (): void => {
  throw Object.assign(new Error("kill ESRCH"), { code: "ESRCH", errno: -3, syscall: "kill" });
};

// A stand-in process for one pid: it hears signals, may end by itself, and ends at once on SIGKILL
// unless it is already gone, when the kill finds nothing (ESRCH).
const standIn = Effect.fnUntraced(function* (options: {
  readonly pid: number;
  // When it ends by itself after the SIGTERM, or null when it ignores the SIGTERM.
  readonly ends: number | null;
  // How long the brain's record of the kill takes, the gap between the timeout and the SIGKILL.
  readonly gap: number;
}) {
  const log: Array<Entry> = [];
  const exited = yield* Deferred.make<void>();
  const gone = { now: false };
  const end = Effect.sync(() => {
    gone.now = true;
  }).pipe(Effect.andThen(Deferred.succeed(exited, undefined)));
  const signal = (pid: number, step: Signal) =>
    Effect.gen(function* () {
      expect(pid).toBe(options.pid);
      log.push({ step, at: yield* Clock.currentTimeMillis });

      if (step === "SIGKILL") {
        return yield* gone.now ? Effect.sync(missing) : end;
      }

      if (options.ends !== null) {
        yield* Effect.forkScoped(Effect.sleep(options.ends).pipe(Effect.andThen(end)));
      }
    });
  const killing = Effect.gen(function* () {
    log.push({ step: "killing", at: yield* Clock.currentTimeMillis });
    yield* Effect.sleep(options.gap);
  });
  return { log, signal, killing, gone: Deferred.await(exited) };
});

describe("the memory restart's bounded stop, next/", () => {
  // L5. Plant: sleep half the grace, or drop the SIGKILL branch, or run `killing` after the signal.
  it.effect.prop(
    "L5 terminate sends SIGTERM once, and SIGKILL once exactly at the grace only when the process has not gone",
    {
      pid: between(30_000, 39_999),
      grace: between(1, 10_000),
      honors: Schema.Boolean,
      // Where in twice the grace the process ends by itself, in ten-thousandths, if it ever does.
      share: Schema.NullOr(between(0, 20_000)),
    },
    ({ pid, grace, honors, share }) =>
      Effect.gen(function* () {
        const moment = share === null ? null : Math.floor((share * grace) / 10_000);
        // The exact grace is a tie between two clocks; the law asks only either side of it.
        const c = { pid, grace, ends: honors && moment !== null && moment !== grace ? moment : null };
        const child = yield* standIn({ pid: c.pid, ends: c.ends, gap: 0 });
        const began = yield* Clock.currentTimeMillis;
        const fiber = yield* Effect.forkChild(
          terminate({
            pid: c.pid,
            grace: c.grace,
            signal: child.signal,
            gone: child.gone,
            killing: child.killing,
          }),
        );
        yield* TestClock.adjust(c.grace * 2 + 1);
        const ended = yield* Fiber.join(fiber);
        const log = child.log.map(({ step, at }) => ({ step, at: at - began }));
        const itself = c.ends !== null && c.ends < c.grace;
        // The kill is recorded before it is sent, so a log reads in the order things happened.
        expect({ ended: ended._tag, log }).toEqual(
          itself
            ? { ended: "itself", log: [{ step: "SIGTERM", at: 0 }] }
            : {
                ended: "killed",
                log: [
                  { step: "SIGTERM", at: 0 },
                  { step: "killing", at: c.grace },
                  { step: "SIGKILL", at: c.grace },
                ],
              },
        );
      }).pipe(Effect.scoped),
    { arbitrary: { seed: SEED, runs: 100 } },
  );

  // L6. Plant: let the ESRCH error escape: terminate fails or dies.
  it.effect.prop(
    "L6 a SIGKILL that finds the process already gone ends terminate as killed with no failure",
    {
      pid: between(30_000, 39_999),
      grace: between(1, 10_000),
      gap: between(2, 500),
      share: between(0, 10_000),
    },
    ({ pid, grace, gap, share }) =>
      Effect.gen(function* () {
        // The drain ends inside the gap: after the timeout, before the SIGKILL goes out.
        const c = { pid, grace, gap, ends: grace + 1 + Math.floor((share * (gap - 2)) / 10_000) };
        const child = yield* standIn({ pid: c.pid, ends: c.ends, gap: c.gap });
        const began = yield* Clock.currentTimeMillis;
        const fiber = yield* Effect.forkChild(
          terminate({
            pid: c.pid,
            grace: c.grace,
            signal: child.signal,
            gone: child.gone,
            killing: child.killing,
          }),
        );
        yield* TestClock.adjust(c.grace + c.gap + 1);
        const exit = yield* Fiber.await(fiber);
        expect(Exit.isSuccess(exit)).toBe(true);
        expect(Exit.isSuccess(exit) ? exit.value._tag : exit).toBe("killed");
        expect(child.log.map(({ step, at }) => ({ step, at: at - began }))).toEqual([
          { step: "SIGTERM", at: 0 },
          { step: "killing", at: c.grace },
          { step: "SIGKILL", at: c.grace + c.gap },
        ]);
      }).pipe(Effect.scoped),
    { arbitrary: { seed: SEED, runs: 50 } },
  );
});
