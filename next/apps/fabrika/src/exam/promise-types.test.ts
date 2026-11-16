// Ticket 1101, the box-memory ticket: `lint:promise-types` reports the real error when its TypeScript
// API child dies mid-run (finding 2026-11-16-ts-api-epipe-hides-the-oom-kill). The box's memory
// cgroup kills the child; the next request fails with the child's EOF, and the old `finally` then
// sent the snapshot's `release` to the dead pipe, so its EPIPE replaced the EOF. A test, not lint or
// type: what is held is an order of failures at run time, which no shape check or type can see.
//
// The law runs the lint's own run, `lintPromiseTypes`, on a stand-in TypeScript API: no child is
// started and no signal is sent. After the kill every request the stand-in gets fails with EPIPE, as
// a write to the dead child's stdin does (typescript 7.0.2 dist/api/syncChannel.js:495).
import { expect, it } from "@effect/vitest";
import { runsFor } from "@kampus/vitest";
import { Cause, Effect, Exit, Path, Predicate, Schema } from "effect";
import { lintPromiseTypes } from "./promise-types.ts";

const options = { arbitrary: { seed: 119120, runs: runsFor({ fast: 10, full: 100 }), concurrency: 1 } };

/** The requests of the lint's run where the child can die, in the order the run makes them. */
const KILL_POINTS = ["updateSnapshot", "getProjects"] as const;

type KillPoint = (typeof KILL_POINTS)[number];

const Case = Schema.Struct({
  // Made-up words that mark each error, so the law tells them apart by identity, never by wording.
  token: Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(40)),
  // After the kill, a release can fail or not: the snapshot's dispose and the session's close.
  disposeFails: Schema.Boolean,
  closeFails: Schema.Boolean,
});

/** A stand-in API session whose child dies at `at`; it records the releases it was asked for. */
const standIn = (at: KillPoint, c: typeof Case.Type) => {
  const kill = new Error(`Unexpected EOF while reading from child process (killed by signal SIGKILL) ${c.token}`);
  const pipe = (request: string) =>
    Object.assign(new Error(`EPIPE: broken pipe, write (${request}) ${c.token}`), { code: "EPIPE" });
  const released: Array<"dispose" | "close"> = [];
  const session = {
    updateSnapshot: () => {
      if (at === "updateSnapshot") {
        throw kill;
      }

      return {
        getProjects: () => {
          throw kill;
        },
        dispose: () => {
          released.push("dispose");

          if (c.disposeFails) {
            throw pipe("release");
          }
        },
      };
    },
    close: () => {
      released.push("close");

      if (c.closeFails) {
        throw pipe("close");
      }
    },
  };
  return { kill, released, session };
};

/** Every error a cause holds, its failures and defects, each with the chain of its `cause`. */
const errorsIn = (cause: Cause.Cause<unknown>): ReadonlyArray<unknown> =>
  cause.reasons.flatMap((reason) => {
    const chain: Array<unknown> = [];
    let next: unknown = Cause.isFailReason(reason) ? reason.error : Cause.isDieReason(reason) ? reason.defect : null;

    while (next !== null && next !== undefined && !chain.includes(next)) {
      chain.push(next);
      next = Predicate.hasProperty(next, "cause") ? next.cause : null;
    }

    return chain;
  });

it.effect.prop(
  "a TypeScript API child killed mid-run fails lint:promise-types with the kill, never the release's EPIPE",
  { c: Case },
  ({ c }) =>
    Effect.gen(function* () {
      const reached = new Set<KillPoint>();

      // Every kill point in every case, so each is reached whatever the case count (coverage).
      for (const at of KILL_POINTS) {
        const { kill, released, session } = standIn(at, c);
        const exit = yield* Effect.exit(
          lintPromiseTypes({ open: () => session, root: "/", configs: ["/tsconfig.json"] }),
        );
        expect(Exit.isFailure(exit)).toBe(true);

        if (Exit.isFailure(exit)) {
          const errors = errorsIn(exit.cause);
          // The run reports the kill.
          expect(errors).toContain(kill);
          // A release's own failure is logged or dropped, never part of what the run reports.
          expect(errors.filter((e) => Predicate.hasProperty(e, "code") && e.code === "EPIPE")).toEqual([]);
        }

        // Each resource is still released once, the snapshot before the session that opened it.
        expect(released).toEqual(at === "updateSnapshot" ? ["close"] : ["dispose", "close"]);
        reached.add(at);
      }

      expect([...reached]).toEqual([...KILL_POINTS]);
    }).pipe(Effect.provide(Path.layer)),
  options,
);
