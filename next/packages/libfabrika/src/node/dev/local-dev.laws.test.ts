// The memory restart plan (docs/plan/quests/memory-restart-PLAN.md), next/, L5, L6 and L12. `terminate`
// is the brain's bounded stop: SIGTERM once, a grace, then SIGKILL, each sent in one step on the
// brain's real life state, and only while that state still says the pid is being replaced. These laws
// run it on a real `lifeCell` with a stand-in process on the test clock and record every signal with
// its moment and what the state said as it went out. No law here reaches the real `process.kill`:
// the signals are a stand-in, and L6's `signal` runs against a spy.
import { describe, expect, it } from "@effect/vitest";
import * as Clock from "effect/Clock";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as Fiber from "effect/Fiber";
import * as Match from "effect/Match";
import * as Schema from "effect/Schema";
import * as SubscriptionRef from "effect/SubscriptionRef";
import * as TestClock from "effect/testing/TestClock";
import { vi } from "vitest";
import type { devLife } from "./DevLife.ts";
import { lifeCell, signal, terminate } from "./local-dev.ts";

/** The state a step moves from, as the life machine holds it. */
type Life = typeof devLife.model.Type;

const SEED = 119120;

const between = (minimum: number, maximum: number) => Schema.Int.check(Schema.isBetween({ minimum, maximum }));

type Signal = "SIGTERM" | "SIGKILL";

type Entry = {
  readonly step: Signal | "replacing" | "killed";
  readonly at: number;
  // For a signal: the life state, as it went out, said this pid was being replaced with this signal.
  readonly vouched: boolean;
};

// A running process the brain samples: started and listening, so `replacing` may fold.
const running = Effect.fnUntraced(function* (pid: number) {
  const life = yield* lifeCell(null);
  yield* life.send({ type: "started", start: "start-1", pid, build: "build-1", at: 0 });
  yield* life.send({ type: "listened", port: 40_001 });
  const log: Array<Entry> = [];
  const now = Clock.currentTimeMillis;

  const vouches = (name: Signal) =>
    SubscriptionRef.get(life.state).pipe(
      Effect.map((s) => s._tag === "replacing" && s.pid === pid && s.signal === name),
    );

  // What the brain records once a step moved the state: the fact its new signal names.
  const record = (_prev: Life, next: { readonly signal: Signal }) =>
    Effect.gen(function* () {
      log.push({ step: next.signal === "SIGTERM" ? "replacing" : "killed", at: yield* now, vouched: true });
    });

  const heard = (name: Signal) =>
    Effect.gen(function* () {
      log.push({ step: name, at: yield* now, vouched: yield* vouches(name) });
    });

  // The runtime reports the exit, and the brain folds it, as its event fiber does.
  const exits = life.send({ type: "exited", replacement: "start-1" });

  return { life, log, record, heard, exits };
});

const sample = (pid: number) => ({ pid, bytes: 600_000_000, at: 0, replacement: "start-1" });

// What `process.kill` does when the OS refuses: it throws an error with the OS code, ESRCH for a pid
// with no process.
const refuses = (code: string) => (): true => {
  throw Object.assign(new Error(`kill ${code}`), { code, syscall: "kill" });
};

describe("the memory restart's bounded stop, next/", () => {
  // L5. Plant: sleep half the grace, or drop the SIGKILL step, or record the kill after its signal,
  // or send the SIGKILL whatever the `killed` step answers.
  it.effect.prop(
    "L5 terminate sends SIGTERM once, and SIGKILL once exactly at the grace only when no exit was folded, each recorded first and sent while the state vouches for the pid",
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
        const ends = honors && moment !== null && moment !== grace ? moment : null;
        const w = yield* running(pid);

        // The stand-in: it may end some time after its SIGTERM, and a SIGKILL ends it at once.
        const stand = (target: number, name: Signal) =>
          Effect.gen(function* () {
            expect(target).toBe(pid);
            yield* w.heard(name);

            if (name === "SIGKILL") {
              yield* Effect.forkScoped(w.exits);
            } else if (ends !== null) {
              yield* Effect.forkScoped(Effect.sleep(ends).pipe(Effect.andThen(w.exits)));
            }
          });

        const began = yield* Clock.currentTimeMillis;

        const fiber = yield* Effect.forkChild(
          terminate({ life: w.life, sample: sample(pid), grace, signal: stand, record: w.record }),
        );

        yield* TestClock.adjust(grace * 2 + 1);
        const ended = yield* Fiber.join(fiber);
        const log = w.log.map(({ step, at, vouched }) => ({ step, at: at - began, vouched }));
        const itself = ends !== null && ends < grace;
        // Each fact is recorded before its signal, so a log reads in the order things happened.
        expect({ ended: ended._tag, log }).toEqual(
          itself
            ? {
                ended: "itself",
                log: [
                  { step: "replacing", at: 0, vouched: true },
                  { step: "SIGTERM", at: 0, vouched: true },
                ],
              }
            : {
                ended: "killed",
                log: [
                  { step: "replacing", at: 0, vouched: true },
                  { step: "SIGTERM", at: 0, vouched: true },
                  { step: "killed", at: grace, vouched: true },
                  { step: "SIGKILL", at: grace, vouched: true },
                ],
              },
        );
      }).pipe(Effect.scoped),
    { arbitrary: { seed: SEED, runs: 100 } },
  );

  // L6. Plant: let the ESRCH escape `signal`, or swallow every error in place of ESRCH alone.
  it.effect.prop(
    "L6 a signal that finds no process (ESRCH) succeeds as already gone, for SIGTERM and SIGKILL alike, and any other refusal is a defect",
    {
      pid: between(30_000, 39_999),
      name: Schema.Literals(["SIGTERM", "SIGKILL"]),
      code: Schema.Literals(["ESRCH", "EPERM", "EINVAL"]),
    },
    ({ pid, name, code }) =>
      Effect.gen(function* () {
        // A spy, never the real `process.kill`: it throws as Node does for this code.
        const kill = yield* Effect.acquireRelease(
          Effect.sync(() => vi.spyOn(process, "kill").mockImplementation(refuses(code))),
          (spy) => Effect.sync(() => spy.mockRestore()),
        );

        const exit = yield* signal(pid, name).pipe(Effect.exit);
        expect(kill.mock.calls).toEqual([[pid, name]]);

        if (code === "ESRCH") {
          expect(exit).toEqual(Exit.void);
        } else {
          expect(Exit.isFailure(exit) && exit.cause.reasons.every((reason) => reason._tag === "Die")).toBe(true);
        }
      }).pipe(Effect.scoped),
    { arbitrary: { seed: SEED, runs: 50 } },
  );

  // L12. Plant: fold outside the step's turn, so an exit folds between a check and its signal; or
  // send the SIGKILL whatever the `killed` step answers; or let `replacing` ignore the sample's pid.
  it.effect.prop(
    "L12 wherever an exit, a stop or a new start lands in a replace, no signal goes out once it is folded, and each signal goes out while the state vouches for the pid",
    {
      pid: between(30_000, 39_999),
      grace: between(1, 10_000),
      event: Schema.Literals(["exited", "stop", "started"]),
      // Between which two steps it lands: before the sample's fold, inside each fact's write, after
      // each signal, or during the grace.
      point: Schema.Literals([
        "before",
        "replacing-start",
        "replacing-end",
        "after-SIGTERM",
        "grace",
        // Once the grace ran out: between the timeout and the `killed` fold.
        "timeout",
        "killed-start",
        "killed-end",
        "after-SIGKILL",
      ]),
      // Where in the grace it lands, in ten-thousandths, when it lands there.
      share: between(0, 9_999),
      // The sample read an older process, whose pid the state no longer holds.
      stale: Schema.Boolean,
    },
    ({ pid, grace, event, point, share, stale }) =>
      Effect.gen(function* () {
        const w = yield* running(pid);

        const msg = Match.value(event).pipe(
          Match.when("exited", () => ({ type: "exited", replacement: "start-1" }) as const),
          Match.when("stop", () => ({ type: "stop" }) as const),
          Match.orElse(() => ({ type: "started", start: "start-2", pid: pid + 1, build: "build-1", at: 0 }) as const),
        );

        const landed: Array<Fiber.Fiber<unknown>> = [];

        // It lands as the runtime's event fiber or the scope's close sends it: in a fiber of its own,
        // which waits its turn on the life state.
        const land = (at: string) =>
          point === at ? Effect.forkScoped(w.life.send(msg)).pipe(Effect.map((f) => landed.push(f))) : Effect.void;

        // A fact's write takes a while, as a synced file write does: other fibers run meanwhile.
        const write = Effect.yieldNow.pipe(Effect.repeat({ times: 5 }));

        const record = (prev: Life, next: { readonly signal: Signal }) =>
          Effect.gen(function* () {
            const fact = next.signal === "SIGTERM" ? "replacing" : "killed";
            yield* land(`${fact}-start`);
            yield* write;
            yield* w.record(prev, next);
            yield* land(`${fact}-end`);
            yield* write;
          });

        // The stand-in ignores SIGTERM, and only what lands moves the state.
        const stand = (target: number, name: Signal) =>
          Effect.gen(function* () {
            expect(target).toBe(pid);
            yield* w.heard(name);
            yield* land(`after-${name}`);

            if (name === "SIGTERM" && point === "grace") {
              const moment = Math.floor((share * grace) / 10_000);
              landed.push(yield* Effect.forkScoped(Effect.sleep(moment).pipe(Effect.andThen(w.life.send(msg)))));
            }
          });

        // The real life cell, with one seam: once the grace ran out, what lands is folded just before
        // the `killed` Msg asks its turn, as an exit that the event fiber folds in that gap.
        const life: typeof w.life = {
          ...w.life,
          step: (next, moved, then) =>
            (point === "timeout" && next.type === "killed" ? w.life.send(msg) : Effect.void).pipe(
              Effect.andThen(w.life.step(next, moved, then)),
            ),
        };

        if (point === "before") {
          yield* w.life.send(msg);
        }

        const fiber = yield* Effect.forkChild(
          terminate({ life, sample: sample(stale ? pid + 2 : pid), grace, signal: stand, record }),
        );

        // The SIGTERM's step and every timer it sets run before the clock moves.
        yield* write.pipe(Effect.repeat({ times: 5 }));
        yield* TestClock.adjust(grace * 2 + 1);
        const ended = yield* Fiber.join(fiber);

        for (const f of landed) {
          yield* Fiber.join(f);
        }

        // How many signals the replace sends: none for a sample the state does not vouch for, the
        // SIGTERM alone when the process went before the `killed` fold, else both.
        const sent = stale || point === "before" ? 0 : point.startsWith("killed") || point === "after-SIGKILL" ? 2 : 1;

        const steps = [
          ["replacing", "SIGTERM"],
          ["killed", "SIGKILL"],
        ];

        expect(w.log.map(({ step }) => step)).toEqual(steps.slice(0, sent).flat());
        // No signal went out on a pid the state had stopped vouching for.
        expect(w.log.filter(({ vouched }) => !vouched)).toEqual([]);
        expect(ended._tag).toBe(["refused", "itself", "killed"][sent]);
        // Whatever landed was folded in the end, so no replace of this pid is left.
        const last = yield* SubscriptionRef.get(w.life.state);
        expect(last._tag).not.toBe("replacing");
      }).pipe(Effect.scoped),
    { arbitrary: { seed: SEED, runs: 200 } },
  );
});
