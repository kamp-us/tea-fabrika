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
 * process, and `wake` is a new runner over the same stores, as an object's wake makes one. `start_child`
 * and `stop_child` are inputs that make the program ask the host for the built-in Cmd of that name: the
 * start makes a child under a new name, and the stop ends the child the last start made.
 */
export type Move =
  | "inc"
  | "work"
  | "stop"
  | "crash"
  | "due"
  | "open"
  | "restart"
  | "shutdown"
  | "wake"
  | "start_child"
  | "stop_child"
  | "overlap"
  | "successor"
  | "replaced"
  | "schedule";

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
  /** The alarm the runner saved last. */
  readonly alarm: Effect.Effect<number | null>;
  /** Each time the runner armed or cleared the alarm since the last `reset`, with the table's state then. */
  readonly armings: Effect.Effect<
    ReadonlyArray<{ readonly at: number | null; readonly state: string; readonly reason: string | null }>
  >;
}

/** The table's state as the walk knows it, from the moves it made. */
type Model = "live" | "ended_normal" | "ended_shutdown" | "ended_crashed";

/** The moves possible in a state: those whose answer today's runner gives the same way every time. */
const LIVE: ReadonlyArray<Move> = ["inc", "work", "stop", "crash", "due", "open", "restart", "shutdown", "wake"];

const POSSIBLE: Record<Model, ReadonlyArray<Move>> = {
  live: [...LIVE, "start_child", "stop_child"],
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

/** B2's states: the table's, and `other_live`, where the name is live under a process this runner does not
 *  run, because a writer outside it replaced that process. A new runner is not built there: an outside start
 *  skips the object's own journal, which a real object keeps in step with its table. */
type Standing = Model | "other_live";

/** B2's moves. Beside the others it has the timer the program asks for (`schedule`), a stop Cmd that exits
 *  while another call's step holds a snapshot (`overlap`), and the replacements by a writer outside the
 *  runner: while a Cmd is in its handler (`replaced`), or after the process ended (`successor`). */
const WALK: Record<Standing, ReadonlyArray<Move>> = {
  live: [...LIVE, "schedule", "overlap", "replaced"],
  ended_normal: POSSIBLE.ended_normal,
  ended_shutdown: [...POSSIBLE.ended_shutdown, "successor"],
  ended_crashed: POSSIBLE.ended_crashed,
  other_live: ["due", "open"],
};

/** How each of B2's walks begins, so no walk leaves a case to the generator's luck: an exit and the input after
 *  it; a crash, a restart and a shutdown; a timer and then a replacement (and the stale runner's first calls),
 *  a shutdown with an outside successor, or an overlap. The generated tape goes on from where each leaves the
 *  table. */
const PREFIXES: ReadonlyArray<ReadonlyArray<Move>> = [
  ["work", "stop", "inc"],
  ["crash", "restart", "shutdown"],
  ["schedule", "replaced", "due"],
  ["schedule", "shutdown", "successor", "open"],
  ["schedule", "overlap"],
];

/** Where a B2 move leaves the walk. */
const TO: Partial<Record<Move, Standing>> = {
  stop: "ended_normal",
  overlap: "ended_normal",
  crash: "ended_crashed",
  shutdown: "ended_shutdown",
  restart: "live",
  replaced: "other_live",
  successor: "other_live",
};

/** The state a move leaves the walk in: its exit, or a restart's new process. */
const leaves = (model: Model, move: Move): Model => AFTER[move]?.to ?? (move === "restart" ? "live" : model);

const Pick = Schema.Int.check(Schema.isBetween({ minimum: 0, maximum: 10_000 }));

const Tape = Schema.Array(Pick).check(Schema.isMinLength(4), Schema.isMaxLength(14));

const options = { arbitrary: { seed: 119120, runs: runsFor({ fast: 10, full: 100 }) } };

/** What each law's walk reached, checked once the file's laws have run. */
const reached = new Map<string, Set<string>>();

const reach = (law: string, kind: string) => reached.set(law, (reached.get(law) ?? new Set<string>()).add(kind));

const REQUIRED: Record<string, ReadonlyArray<string>> = {
  B1: ["inc", "work", "stop", "crash", "due", "open", "restart", "start_child", "stop_child", "wake"],
  B2: [
    "inc",
    "work",
    "stop",
    "crash",
    "shutdown",
    "restart",
    "refused after exit",
    "overlap",
    "replaced",
    "successor",
    "stale runner with a timer",
  ],
  B3: ["stop", "crash", "shutdown", "restart from live", "stop_child"],
};

/** A call's budget of lifecycle reads: one lifecycle read and the reads for `at` in each serial step. A
 *  step is one turn, and a Cmd's answer is a second. A crash's recovery and a restart each walk three
 *  journal steps after their turn (`writing_exit`, `waiting_start`, `checkpointing`), and each reads the
 *  status for `at` once, so each is a step: the driver sees only the call's total, and a call's steps add. */
const STEPS: Partial<Record<Move, number>> = {
  inc: 1,
  due: 1,
  open: 1,
  work: 2,
  stop: 2,
  crash: 4,
  restart: 4,
  start_child: 2,
  stop_child: 2,
};

const BUDGET_PER_STEP = 3;

/** What `overlap` answers: the stop Cmd's call, then the call that held a snapshot. */
const Overlap = Schema.Struct({ stop: Sent });

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
            let model: Model = "live";

            for (const pick of tape) {
              const choices = POSSIBLE[model].filter((one) => one !== "shutdown");
              const move: Move = choices[pick % choices.length] ?? "due";
              reach("B1", move);
              yield* w.reset;
              yield* w.call(move);
              const reads = yield* w.reads;
              const steps = STEPS[move] ?? 0;
              expect(
                reads.status + reads.isLive,
                `${move} read the lifecycle ${reads.status + reads.isLive} times (status ${reads.status}, isLive ${reads.isLive}), over ${steps} step(s) of ${BUDGET_PER_STEP}`,
              ).toBeLessThanOrEqual(steps * BUDGET_PER_STEP);
              model = leaves(model, move);
            }
          }),
        ),
      options,
    );

    // Plants, each applied once to Runner.ts and undone: the runner's own exit does not drop a step's snapshot
    // (red on the overlap: an alarm is armed for a process that exited normally); `living` is derived
    // without the process id (red on a replaced process: the old runner arms its program's timer); and `ended`
    // keeps its first answer for the runner's life (red on the Cmd listed after an exit). A Reading carried
    // across steps turns B2 red through the runner's own exit. A Reading merely not cleared at its own step's
    // end is out of reach: each step makes a new one on its own fiber, so nothing reads the old one again.
    it.effect.prop(
      "B2 what a runner does follows the process table after its own exit, a crash, an outside shutdown, a restart and a replaced process",
      { tape: Tape },
      ({ tape }) =>
        Effect.forEach(
          PREFIXES,
          (prefix) =>
            Effect.scoped(
              Effect.gen(function* () {
                const w = yield* open;
                let standing: Standing = "live";
                let scheduled = false;

                for (const step of [...prefix, ...tape]) {
                  const choices: ReadonlyArray<Move> = WALK[standing];
                  const move: Move = typeof step === "string" ? step : (choices[step % choices.length] ?? "due");
                  expect(choices, `${move} is possible in ${standing}`).toContain(move);
                  reach("B2", move);
                  const before = yield* w.table;
                  const model: Model = standing === "other_live" ? "live" : standing;
                  expect(
                    before.state === "live" ? null : before.reason,
                    `the table is ${standing} before ${move}`,
                  ).toBe(REASONS[model]);
                  const worked = yield* w.worked;
                  yield* w.reset;
                  const done = yield* w.call(move);
                  const armed = yield* w.armings;
                  scheduled = scheduled || move === "schedule";

                  if (move === "stop") {
                    expect(
                      yield* w.worked,
                      "a Cmd listed after the program's own exit never runs, so the runner sees its exit at once",
                    ).toBe(worked);
                  }

                  if (move === "inc" || move === "work") {
                    const sent = answer(done);

                    if (standing === "ended_normal") {
                      reach("B2", "refused after exit");
                      expect(sent, "an input after the program's own exit is refused").toEqual(
                        Sent.cases.refused.make({ reason: "ended" }),
                      );
                    } else {
                      expect(sent._tag, "an input to a live process is accepted").toBe("accepted");
                    }
                  }

                  if (move === "overlap") {
                    expect(Schema.decodeUnknownSync(Overlap)(done).stop._tag, "the stop Cmd is accepted").toBe(
                      "accepted",
                    );
                  }

                  const next: Standing = TO[move] ?? standing;
                  const table = yield* w.table;
                  const after: Model = next === "other_live" ? "live" : next;
                  expect(table.state === "live" ? null : table.reason, `the table after ${move}`).toBe(REASONS[after]);
                  expect(
                    armed.filter(({ at, reason }) => at !== null && reason === "normal"),
                    `${move} armed an alarm while the table said its process exited normally`,
                  ).toEqual([]);

                  if (standing === "other_live" && (move === "due" || move === "open")) {
                    if (scheduled) {
                      reach("B2", "stale runner with a timer");
                    }

                    expect(
                      armed.filter(({ at }) => at !== null),
                      `${move} armed the program's timer for a life the table no longer calls live`,
                    ).toEqual([]);
                  }

                  standing = next;
                }
              }),
            ),
          { concurrency: 1, discard: true },
        ),
      options,
    );

    // Plants: the manual restart's exit line writes `normal`; the runner's crash exit writes `normal`; and
    // `ChildrenLedger`'s stop writes `normal` (ChildrenLedger.ts, the exit it asks of the manager in `stop`).
    it.effect.prop(
      "B3 a process's normal exit is written only by its own runner's built-in exit",
      { tape: Tape },
      ({ tape }) =>
        Effect.scoped(
          Effect.gen(function* () {
            const w = yield* open;
            let model: Model = "live";
            // The child the last `start_child` made: a new life has none, and a stopped one is gone.
            let child: "none" | "live" | "stopped" = "none";
            const expected: Array<{ reason: string; by: string }> = [];

            for (const pick of tape) {
              const choices: ReadonlyArray<Move> = POSSIBLE[model];
              const move: Move = choices[pick % choices.length] ?? "due";
              yield* w.call(move);
              const ended: (typeof AFTER)[Move] = AFTER[move];

              if (move === "start_child") {
                child = "live";
              } else if (move === "stop_child" && child === "live") {
                // The runner's stop_child ends its own live child with shutdown, never normal. Another life's
                // child is `not_child` and an ended one `noproc`: neither writes a line.
                reach("B3", "stop_child");
                expected.push({ reason: "shutdown", by: "SHA256:brain" });
                child = "stopped";
              } else if (ended !== undefined || move === "restart") {
                child = "none";
              }

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
