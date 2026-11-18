// T753 L16 full-depth fix, next/. B1 to B3 of the plan (docs/plan/quests/t753-l16-full-depth-PLAN.md): a
// runner reads its process's lifecycle once per serial step, and what it does follows the process table.
// The driver owns SQLite and the process table (0062); this suite owns the laws, over the runner's public
// calls: `msg`, `due`, `open` and `restart`, and the process table's own lines. The driver counts the
// lifecycle reads (`status` and `isLive`) the runner makes of its ProcessManager.
//
// The walk: each law reads the table's state it has reached and picks the next move from what is
// possible there, so no hand-written list of cases stands in for a state.
import { describe, expect, it } from "@effect/vitest";
import { runsFor } from "@kampus/vitest";
import { Effect, Schema, type Scope } from "effect";
import { Sent } from "./Runner.ts";

/** What the table says about the runner's name now, read outside the runner's counted manager. */
export interface Table {
  readonly state: "live" | "ended";
  readonly process: string;
  /** The exit reason's tag when the state is `ended`. */
  readonly reason: string | null;
}

/** One `exited` line of the process table: who ended, how, and the writer's own key. */
export interface Exit {
  readonly process: string;
  readonly reason: string;
  readonly by: string;
}

/**
 * One call into the runner, or one outside event. `inc` and `work` are inputs (`work` asks one Cmd), `stop`
 * is the program's built-in exit Cmd, `crash` is an input the program throws on, `due`, `open` and
 * `restart` are the runner's other calls, `shutdown` is a writer outside the runner ending the live
 * process, and `wake` is a new runner over the same stores, as an object's wake makes one.
 */
export type Move = "inc" | "work" | "stop" | "crash" | "due" | "open" | "restart" | "shutdown" | "wake";

export interface World {
  /** One move, as the object's own call or an outside writer would make it. */
  readonly call: (move: Move) => Effect.Effect<unknown, unknown>;
  /** The process table's own answer now. */
  readonly table: Effect.Effect<Table, unknown>;
  /** Every `exited` line the table has, oldest first. */
  readonly exits: Effect.Effect<ReadonlyArray<Exit>, unknown>;
  /** The lifecycle reads the runner made since the last `reset`: `status` and `isLive`. */
  readonly reads: Effect.Effect<{ readonly status: number; readonly isLive: number }>;
  readonly reset: Effect.Effect<void>;
  /** How many times a `work` Cmd's handler has run. */
  readonly worked: Effect.Effect<number>;
}

/** The table's state as the walk knows it, from the moves it made. */
type Model = "live" | "ended_normal" | "ended_shutdown" | "ended_crashed";

/** The moves possible in a state: those whose answer today's runner gives the same way every time. */
const POSSIBLE: Record<Model, ReadonlyArray<Move>> = {
  live: ["inc", "work", "stop", "crash", "due", "open", "restart", "shutdown", "wake"],
  ended_normal: ["inc", "due", "open", "wake"],
  ended_shutdown: ["due", "open", "wake", "restart"],
  ended_crashed: ["due", "restart"],
};

/** The state a move leaves, and the exit line it writes (a live process ends once). */
const AFTER: Partial<Record<Move, { readonly to: Model; readonly exit: string | null }>> = {
  stop: { to: "ended_normal", exit: "normal" },
  crash: { to: "ended_crashed", exit: "crashed" },
  shutdown: { to: "ended_shutdown", exit: "shutdown" },
};

const REASONS: Record<Model, string | null> = {
  live: null,
  ended_normal: "normal",
  ended_shutdown: "shutdown",
  ended_crashed: "crashed",
};

const Pick = Schema.Int.check(Schema.isBetween({ minimum: 0, maximum: 10_000 }));

const Tape = Schema.Array(Pick).check(Schema.isMinLength(4), Schema.isMaxLength(14));

const options = { arbitrary: { seed: 119120, runs: runsFor({ fast: 10, full: 100 }) } };

/** What each law's walk reached, checked once the file's laws have run. */
const reached = new Map<string, Set<string>>();

const reach = (law: string, kind: string) => reached.set(law, (reached.get(law) ?? new Set<string>()).add(kind));

const REQUIRED: Record<string, ReadonlyArray<string>> = {
  B1: ["inc", "work", "due", "open", "wake"],
  B2: ["inc", "work", "stop", "crash", "shutdown", "restart", "refused after exit"],
  B3: ["stop", "crash", "shutdown", "restart from live"],
};

/** A call's budget of lifecycle reads: one lifecycle read and the reads for `at` in each serial step. A
 *  step is one turn, and a Cmd's answer is a second. */
const STEPS: Partial<Record<Move, number>> = { inc: 1, due: 1, open: 1, work: 2 };

const BUDGET_PER_STEP = 3;

const answer = (value: unknown) => Schema.decodeUnknownSync(Sent)(value);

export const suite = (open: Effect.Effect<World, unknown, Scope.Scope>) =>
  describe("T753 L16 a runner reads its lifecycle once per step", () => {
    // Plant: the per-check reads come back, which is main before the fix: a counter step reads the
    // lifecycle 12 times, so every move is over its budget.
    it.effect.prop(
      "B1 each serial step of a runner call makes at most one lifecycle read beyond the reads for `at`",
      { tape: Tape },
      ({ tape }) =>
        Effect.scoped(
          Effect.gen(function* () {
            const w = yield* open;
            const moves: ReadonlyArray<Move> = ["inc", "work", "due", "open", "wake"];

            for (const pick of tape) {
              const move = moves[pick % moves.length] ?? "inc";
              reach("B1", move);
              yield* w.reset;
              yield* w.call(move);
              const reads = yield* w.reads;
              const steps = STEPS[move] ?? 0;
              expect(
                reads.status + reads.isLive,
                `${move} read the lifecycle ${reads.status + reads.isLive} times (status ${reads.status}, isLive ${reads.isLive}), over ${steps} step(s) of ${BUDGET_PER_STEP}`,
              ).toBeLessThanOrEqual(steps * BUDGET_PER_STEP);
            }
          }),
        ),
      options,
    );

    // Plants: `ended` keeps its first answer for the runner's life, so an input after the program's own exit
    // is not refused (red after an exit); the build's own plants for the snapshot are named in the report.
    it.effect.prop(
      "B2 what a runner answers follows the process table after its own exit, a crash, an outside shutdown and a restart",
      { tape: Tape },
      ({ tape }) =>
        Effect.scoped(
          Effect.gen(function* () {
            const w = yield* open;
            let model: Model = "live";

            for (const pick of tape) {
              const choices: ReadonlyArray<Move> = POSSIBLE[model];
              const move: Move = choices[pick % choices.length] ?? "due";
              reach("B2", move);
              const before = yield* w.table;
              expect(before.state === "live" ? null : before.reason, `the table is ${model} before ${move}`).toBe(
                REASONS[model],
              );
              const worked = yield* w.worked;
              const done = yield* w.call(move);

              if (move === "stop") {
                expect(
                  yield* w.worked,
                  "a Cmd listed after the program's own exit never runs, so the runner sees its exit at once",
                ).toBe(worked);
              }

              if (move === "inc" || move === "work") {
                const sent = answer(done);

                if (model === "ended_normal") {
                  reach("B2", "refused after exit");
                  expect(sent, "an input after the program's own exit is refused").toEqual(
                    Sent.cases.refused.make({ reason: "ended" }),
                  );
                } else {
                  expect(sent._tag, "an input to a live process is accepted").toBe("accepted");
                }
              }

              const next: Model = AFTER[move]?.to ?? (move === "restart" ? "live" : model);
              model = next;
              const table = yield* w.table;
              expect(table.state === "live" ? null : table.reason, `the table after ${move}`).toBe(REASONS[model]);
            }
          }),
        ),
      options,
    );

    // Plants: the manual restart's exit line writes `normal`; the runner's crash exit writes `normal`.
    it.effect.prop(
      "B3 a process's normal exit is written only by its own runner's built-in exit",
      { tape: Tape },
      ({ tape }) =>
        Effect.scoped(
          Effect.gen(function* () {
            const w = yield* open;
            let model: Model = "live";
            const expected: Array<{ reason: string; by: string }> = [];

            for (const pick of tape) {
              const choices: ReadonlyArray<Move> = POSSIBLE[model];
              const move: Move = choices[pick % choices.length] ?? "due";
              yield* w.call(move);
              const ended: (typeof AFTER)[Move] = AFTER[move];

              if (ended !== undefined) {
                reach("B3", move);
                expected.push({ reason: ended.exit ?? "", by: "SHA256:brain" });
                model = ended.to;
              } else if (move === "restart") {
                if (model === "live") {
                  reach("B3", "restart from live");
                  // A person's restart ends the live process with shutdown, never normal.
                  expected.push({ reason: "shutdown", by: "SHA256:brain" });
                }

                model = "live";
              }
            }

            const exits = yield* w.exits;
            expect(
              exits.map(({ reason, by }) => ({ reason, by })),
              "each exit line is the one its move writes, in order, by the brain's own key",
            ).toEqual(expected);
            expect(new Set(exits.map(({ process }) => process)).size, "each process ends once").toBe(exits.length);
          }),
        ),
      options,
    );
    it("scenario: every move the laws name was reached by their generated walks", () => {
      const missing = Object.entries(REQUIRED).flatMap(([law, kinds]) =>
        kinds.filter((kind) => !(reached.get(law)?.has(kind) ?? false)).map((kind) => `${law}: ${kind}`),
      );
      expect(missing, "moves a law's walk never reached").toEqual([]);
    });
  });
