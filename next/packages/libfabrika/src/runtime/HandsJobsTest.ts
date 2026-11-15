// P39 slice 3 (ticket 1040), next/, S1 on the Project's half of a hands Cmd: `HandsJobsLive.layer`
// over a real job store, and no driver (0062). A runner in the module that owns a driver calls
// `HandsJobsTest.suite(open)`; `open` acquires one store in a scope and gives it back when that scope
// closes.
//
// The walk reads the jobs it has saved so far and picks its next move from what is possible there: an
// ask for a Cmd nobody saved or for a saved one, a change of the person's `hands.target` between two
// asks, the hands finishing a job that is really waiting, or a restart of the Project, which builds
// the layer again over the same store. The oracle is this file's own record of what each ask was
// given and answered, never the product's machine.
//
// The contract this law pins, from the plan:
//   HandsJobs.ts: `Ask`, `Reply` (`waiting`, `finished`, `refused` with `no_hands` or `id_reused`),
//   `HandsJobsError`, `HandsJobs`.
//   HandsJobsLive.ts: `layer({ target, settings })`, read first, then request or collect, over `Jobs`.
//
// Plants (after build): fall back to the first live hands key when `hands.target` is unset; rebuild
// the request on a retry, so a changed target answers `id_reused`.
//
// S2, added in the fix round: a saved job's id asked by another process is refused `id_reused` in
// every state the job can be in. The job machine refuses `wrong_process` only for a finished or
// collected job, so for a requested, assigned or started one the layer's own check is what keeps
// another process's waiting receipt out of the reply. Plant: drop that check in `HandsJobsLive.ts`.
import { describe, expect, it } from "@effect/vitest";
import { runsFor } from "@kampus/vitest";
import { Effect, Layer, Result as R, type Scope } from "effect";
import * as fc from "fast-check";
import { Command, type Job, type Result, State } from "../jobs/Job.ts";
import { Jobs } from "../jobs/Jobs.ts";
import { choose, copied, fcFingerprint, fcRecorded, fcRequest, fcResult } from "../jobs/JobsTest.ts";
import type { From } from "../processes/Mailbox.ts";
import { type Ask, HandsJobs, Reply } from "./HandsJobs.ts";
import * as HandsJobsLive from "./HandsJobsLive.ts";

/** One real job store, for the life of one walk. `reopen` closes it and opens the same rows again. */
export type Store = { readonly jobs: Layer.Layer<Jobs>; readonly reopen: Effect.Effect<void> };

const fcHash = fc.stringMatching(/^[0-9a-f]{16}$/);

/** A Cmd a program dispatched: the request's own facts, as the runner gives them to `ask`. */
const fcAsk = (keys: ReadonlyArray<string>): fc.Arbitrary<typeof Ask.Type> =>
  fcRequest(keys).map(({ id, process, name, program, build, parent, traceId }) => ({
    id,
    process,
    name,
    program,
    build,
    command: Command.cases.git_version.make({}),
    parent,
    traceId,
  }));

const Cell = fc.record({ move: fc.nat(), pick: fc.nat(), said: fcRecorded, result: fcResult });
type Cell = typeof Cell extends fc.Arbitrary<infer A> ? A : never;

/**
 * A tape: the person's `hands.target` over the walk (unset is `null`), each life's settings hash,
 * the Cmds a program may dispatch, and the cells. A target may repeat, and may go from set to unset.
 */
const Tape = fc.uniqueArray(fcFingerprint, { minLength: 2, maxLength: 2 }).chain((keys) =>
  fc.record({
    targets: fc.array(fc.option(fc.constantFrom(...keys), { nil: null, freq: 3 }), { minLength: 2, maxLength: 4 }),
    hashes: fc.array(fcHash, { minLength: 4, maxLength: 4 }),
    asks: fc.uniqueArray(fcAsk(keys), { minLength: 2, maxLength: 4, selector: (a) => a.id }),
    cells: fc.array(Cell, { minLength: 8, maxLength: 30, size: "max" }),
  }),
);
type Tape = typeof Tape extends fc.Arbitrary<infer A> ? A : never;

type Move = "ask" | "change" | "finish" | "reopen";

/** What the oracle knows of one ask's job, from its own calls only. */
type Saved = {
  readonly target: string;
  readonly settings: string;
  readonly requested: { readonly rev: number; readonly arrivedAt: number };
  phase: "requested" | "finished" | "collected";
  result?: Result;
  collected?: { readonly rev: number; readonly arrivedAt: number };
};

const answered = <A>(answer: R.Result<A, unknown>, message: string): A => {
  if (R.isFailure(answer)) {
    expect.fail(`${message}: ${String(answer.failure)}`);
  }

  return answer.success;
};

const walk = (open: Effect.Effect<Store, never, Scope.Scope>, done: Set<string>) =>
  Effect.fnUntraced(function* (tape: Tape) {
    const store = yield* open;
    let jobsLife = yield* Layer.build(store.jobs);
    let life = 0;
    const saved = new Map<string, Saved>();
    const target = () => choose(tape.targets, life);
    const settings = () => choose(tape.hashes, life);
    const ask = (a: typeof Ask.Type, from: From) =>
      HandsJobs.use((h) => h.ask(copied(a), from)).pipe(
        Effect.provide(
          HandsJobsLive.layer({ target: target(), settings: settings() }).pipe(
            Layer.provide(Layer.succeedContext(jobsLife)),
          ),
        ),
        Effect.result,
      );
    const jobs = <A, E>(call: (j: Jobs["Service"]) => Effect.Effect<A, E>) =>
      Jobs.use(call).pipe(Effect.provide(jobsLife), Effect.result);
    const read = (id: string) => jobs((j) => j.read(id));

    for (const cell of tape.cells) {
      const waiting = [...saved.entries()].filter(([, s]) => s.phase === "requested");
      const can: Record<Move, boolean> = {
        ask: true,
        change: life + 1 < tape.targets.length,
        finish: waiting.length > 0,
        reopen: true,
      };
      const move = choose(
        (["ask", "change", "finish", "reopen"] as const).filter((m) => can[m]),
        cell.move,
      );
      const from: From = { ...cell.said, seen: 0 };

      if (move === "ask") {
        const a = choose(tape.asks, cell.pick);
        const kept = saved.get(a.id);
        const reply = answered(yield* ask(a, from), "an ask answers, whatever the job's state");

        if (kept === undefined && target() === null) {
          // S1: no hands key is set: nothing is written, and the answer is a refusal the program reads.
          expect(reply, "S1: an unset hands.target refuses no_hands").toEqual(
            Reply.cases.refused.make({ reason: "no_hands" }),
          );
          const job = yield* read(a.id);
          expect(R.isFailure(job) && job.failure.reason, "S1: an unset hands.target writes no job").toBe("not_found");
          done.add("refused");
        } else if (kept === undefined) {
          const job = answered(yield* read(a.id), "a waiting ask saved its job");
          const first = job.events[0];
          expect(
            job.events.map((e) => e.event),
            "one request is saved",
          ).toEqual(["requested"]);
          expect(reply, "S1: a new job answers waiting with its request's receipt").toEqual(
            Reply.cases.waiting.make({ rev: first?.rev ?? -1, arrivedAt: first?.arrivedAt ?? -1 }),
          );
          // The request is the Cmd's own facts, the trusted needs of its command, the target and the hash.
          expect(job.state).toEqual(
            State.cases.requested.make({
              request: { ...a, needs: ["git"], target: target() ?? "", settings: settings() },
            }),
          );
          expect(first, "the writer's record is the runner's").toMatchObject({
            by: from.by,
            for: from.for,
            sentAt: from.sentAt,
            traceId: from.traceId,
            build: from.build,
          });
          saved.set(a.id, {
            target: target() ?? "",
            settings: settings(),
            requested: { rev: first?.rev ?? -1, arrivedAt: first?.arrivedAt ?? -1 },
            phase: "requested",
          });
          done.add("waiting:new");
        } else if (kept.phase === "requested") {
          // A retry reads the saved job, whatever the person changed since: no other bytes under its id.
          expect(reply, "S1: a retry of a waiting job answers its first receipt").toEqual(
            Reply.cases.waiting.make(kept.requested),
          );
          done.add(target() === kept.target ? "waiting:again" : target() === null ? "waiting:unset" : "waiting:moved");
        } else {
          const result = kept.result ?? expect.fail("a finished job has its result");
          const job = answered(yield* read(a.id), "a finished job reads back");
          const collected = job.events.filter((e) => e.event === "collected");
          expect(collected, "one collect is saved, however often the Cmd asks").toHaveLength(1);
          const receipt = { rev: collected[0]?.rev ?? -1, arrivedAt: collected[0]?.arrivedAt ?? -1 };
          expect(reply, "a finished job answers its result and the collect's receipt").toEqual(
            Reply.cases.finished.make({ result, ...receipt }),
          );
          expect(job.state._tag, "the asking process collected it").toBe("collected");
          expect(job.state, "into the Cmd's answer letter").toMatchObject({
            collection: { process: a.process, letter: `${a.id}/answer` },
          });
          done.add(kept.phase === "finished" ? "finished" : "finished:again");

          if (kept.collected !== undefined) {
            expect(receipt, "a repeated collect answers the first").toEqual(kept.collected);
          }

          kept.phase = "collected";
          kept.collected = receipt;
        }

        // Whatever the target is now, a saved request keeps the target and hash it was first made with.
        const after = yield* read(a.id);

        if (R.isSuccess(after) && after.success.state._tag !== "absent") {
          const first = saved.get(a.id);
          expect(after.success.state.request.target, "S1: the request's target is the first one").toBe(first?.target);
          expect(after.success.state.request.settings, "S1: the request's settings hash is the first one").toBe(
            first?.settings,
          );
        }
      } else if (move === "change") {
        life++;
        done.add(target() === null ? "change:unset" : "change:set");
      } else if (move === "finish") {
        // The hands the person chose take, start and finish the job, as slice 2's methods do.
        const [id, kept] = choose(waiting, cell.pick);
        const executor = { key: kept.target, connection: "hands-law", has: ["git"], build: "hands-build" };
        const by = { ...from, by: kept.target };
        const taken = answered(yield* jobs((j) => j.take(id, executor, by)), "the target takes its job");
        answered(yield* jobs((j) => j.started(id, taken.execution, by)), "the target starts its job");
        answered(yield* jobs((j) => j.finish(id, taken.execution, cell.result, by)), "the target finishes its job");
        kept.phase = "finished";
        kept.result = cell.result;
        done.add("finish");
      } else {
        yield* store.reopen;
        jobsLife = yield* Layer.build(store.jobs);
        done.add("reopen");
      }

      // Every ask nobody answered waiting stays unsaved.
      for (const a of tape.asks) {
        if (!saved.has(a.id)) {
          const job: R.Result<Job, unknown> = yield* read(a.id);
          expect(R.isFailure(job), "an ask that was refused or never made saves no job").toBe(true);
        }
      }
    }
  });

/** The states a saved job can be in when another process asks under its id. */
const STATES = ["requested", "assigned", "started", "finished", "collected"] as const;

/**
 * A tape for S2: the asking process's Cmd, another process, the state its job is brought to, the
 * hands' result, and what each writer says.
 */
const Foreign = fc.uniqueArray(fcFingerprint, { minLength: 1, maxLength: 1 }).chain((keys) =>
  fc
    .record({
      key: fc.constant(keys[0] ?? ""),
      mine: fcAsk(keys),
      theirs: fcAsk(keys),
      state: fc.constantFrom(...STATES),
      result: fcResult,
      said: fcRecorded,
      asked: fcRecorded,
    })
    .filter(({ mine, theirs }) => mine.process !== theirs.process),
);
type Foreign = typeof Foreign extends fc.Arbitrary<infer A> ? A : never;

/**
 * S2: a saved job is only ever its own process's. Brings one process's job to a state, then asks
 * under the same id as another process, and reads the job back before and after.
 */
const foreign = (open: Effect.Effect<Store, never, Scope.Scope>, done: Set<string>) =>
  Effect.fnUntraced(function* (tape: Foreign) {
    const store = yield* open;
    const jobsLife = yield* Layer.build(store.jobs);
    const ask = (a: typeof Ask.Type, from: From) =>
      HandsJobs.use((h) => h.ask(copied(a), from)).pipe(
        Effect.provide(
          HandsJobsLive.layer({ target: tape.key, settings: "0123456789abcdef" }).pipe(
            Layer.provide(Layer.succeedContext(jobsLife)),
          ),
        ),
        Effect.result,
      );
    const jobs = <A, E>(call: (j: Jobs["Service"]) => Effect.Effect<A, E>) =>
      Jobs.use(call).pipe(Effect.provide(jobsLife), Effect.result);
    const from: From = { ...tape.said, seen: 0 };
    const id = tape.mine.id;
    const reached = STATES.indexOf(tape.state);

    answered(yield* ask(tape.mine, from), "the asking process saves its job");

    if (reached >= 1) {
      const executor = { key: tape.key, connection: "hands-law", has: ["git"], build: "hands-build" };
      const by = { ...from, by: tape.key };
      const taken = answered(yield* jobs((j) => j.take(id, executor, by)), "the target takes the job");

      if (reached >= 2) {
        answered(yield* jobs((j) => j.started(id, taken.execution, by)), "the target starts the job");
      }

      if (reached >= 3) {
        answered(yield* jobs((j) => j.finish(id, taken.execution, tape.result, by)), "the target finishes the job");
      }

      if (reached >= 4) {
        answered(yield* ask(tape.mine, from), "the asking process collects its result");
      }
    }

    const before = answered(yield* jobs((j) => j.read(id)), "the saved job reads back");
    expect(before.state._tag, `the job is ${tape.state}`).toBe(tape.state);

    // Another process asks under the same id: its own Cmd's facts, the id it does not own.
    const reply = answered(
      yield* ask({ ...tape.mine, process: tape.theirs.process }, { ...tape.asked, seen: 0 }),
      "an ask from another process answers",
    );
    // The answer is the bare refusal, for good: no receipt and no result, the asker's to read.
    expect(reply, `S2: another process's ask is refused id_reused and nothing else (${tape.state})`).toEqual(
      Reply.cases.refused.make({ reason: "id_reused" }),
    );
    expect(Object.keys(reply).sort(), "S2: the refusal carries no receipt or result").toEqual(["_tag", "reason"]);

    const after = answered(yield* jobs((j) => j.read(id)), "the saved job still reads back");
    expect(after, `S2: another process's ask writes nothing (${tape.state})`).toEqual(before);
    done.add(tape.state);
  });

export const suite = (open: Effect.Effect<Store, never, Scope.Scope>) =>
  describe("P39 slice 3: the Project's half of a hands Cmd", () => {
    it.effect(
      "S1: an unset hands.target writes no job and answers refused no_hands; a set one is the request's target, and the snapshot hash its settings",
      () =>
        Effect.gen(function* () {
          const done = new Set<string>();
          const law = walk(open, done);
          // oxlint-disable-next-line fabrika/no-effect-run-outside-edge -- edge: fast-check awaits each tape
          const property = fc.asyncProperty(Tape, (tape) => Effect.runPromise(Effect.scoped(law(tape))));
          const options = { seed: 119120, numRuns: runsFor({ fast: 20, full: 100 }), includeErrorInReport: true };
          // oxlint-disable-next-line fabrika/no-promises -- edge: fast-check's async property answers a Promise
          yield* Effect.promise(() => fc.assert(property, options));
          // An empty walk cannot pass: every case the law is about ran at least once.
          expect([...done].sort()).toEqual(
            expect.arrayContaining(
              [
                "refused",
                "waiting:new",
                "waiting:again",
                "waiting:moved",
                "waiting:unset",
                "finish",
                "finished",
                "finished:again",
                "change:set",
                "change:unset",
                "reopen",
              ].sort(),
            ),
          );
        }),
    );
    it.effect(
      "S2: an ask under a saved job's id from another process is refused id_reused in every state of the job, writes nothing, and reveals no receipt or result",
      () =>
        Effect.gen(function* () {
          const done = new Set<string>();
          const law = foreign(open, done);
          // oxlint-disable-next-line fabrika/no-effect-run-outside-edge -- edge: fast-check awaits each tape
          const property = fc.asyncProperty(Foreign, (tape) => Effect.runPromise(Effect.scoped(law(tape))));
          const options = { seed: 119120, numRuns: runsFor({ fast: 20, full: 60 }), includeErrorInReport: true };
          // oxlint-disable-next-line fabrika/no-promises -- edge: fast-check's async property answers a Promise
          yield* Effect.promise(() => fc.assert(property, options));
          // An empty walk cannot pass: every state a job can be in when another process asks ran.
          expect([...done].sort()).toEqual([...STATES].sort());
        }),
    );
  });
