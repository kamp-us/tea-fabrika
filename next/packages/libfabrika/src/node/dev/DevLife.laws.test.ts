// T708, next/. The dev server's life is one tea machine; every law walks its real reducer from init.
// The walk reads the folded state before it picks each move (0093), and an independent reference
// written from the plan's transition table checks each step. The memory restart plan
// (docs/plan/quests/memory-restart-PLAN.md) adds `replacing` and its laws L1 to L4.
import { applyCell } from "@demlik/tea";
import { Predicate, Schema } from "effect";
import * as Rec from "effect/Record";
import * as fc from "fast-check";
import { describe, expect, expectTypeOf, it } from "vitest";
import type { DevState } from "./DevLife.ts";
import { address, devLife, pending, reachable, target } from "./DevLife.ts";

const SEED = 119120;
type State = typeof DevState.Type;
type Msg = typeof devLife.msg.Type;
type Phase = State["_tag"];
type Case<T extends Phase> = Extract<State, { readonly _tag: T }>;
type Pending = { readonly _tag: "pending"; readonly id: string };

// L4, a type law checked by tsc. A replace holds the old pid and a replacement that is always
// pending from its first signal, and its Msg carries what the sampler saw and when.
// Plant: type the field as `Replacement` (both cases): the `toBeNever` check on the none case fails.
expectTypeOf<Case<"replacing">>().toHaveProperty("pid");
expectTypeOf<Case<"replacing">>().toHaveProperty("listener");
expectTypeOf<Case<"replacing">>().toHaveProperty("signal");
expectTypeOf<Case<"replacing">["replacement"]>().toMatchTypeOf<Pending>();
expectTypeOf<Extract<Case<"replacing">["replacement"], { readonly _tag: "none" }>>().toBeNever();
expectTypeOf<Case<"replacing">["signal"]>().toEqualTypeOf<"SIGTERM" | "SIGKILL">();
expectTypeOf<Extract<Msg, { readonly type: "replacing" }>>().toHaveProperty("bytes");
expectTypeOf<Extract<Msg, { readonly type: "replacing" }>>().toHaveProperty("at");
expectTypeOf<Extract<Msg, { readonly type: "replacing" }>>().toHaveProperty("replacement");
// A replace and its kill each name the pid they are about, so a fold can refuse another process's.
expectTypeOf<Extract<Msg, { readonly type: "replacing" }>>().toHaveProperty("pid");
expectTypeOf<Extract<Msg, { readonly type: "killed" }>>().toHaveProperty("pid");
expectTypeOf(reachable).returns.toEqualTypeOf<number | null>();

// Type law, checked by tsc: only a running process holds a pid, and a replacement token lives only
// where an exit put it. The negative checks are not vacuous: the positive ones name the same fields.
expectTypeOf<Case<"spawned">>().toHaveProperty("pid");
expectTypeOf<Case<"online">>().toHaveProperty("pid");
expectTypeOf<Case<"starting">>().not.toHaveProperty("pid");
expectTypeOf<Case<"listening">>().not.toHaveProperty("pid");
expectTypeOf<Case<"exited">>().not.toHaveProperty("pid");
expectTypeOf<Case<"waiting">>().not.toHaveProperty("pid");
expectTypeOf<Case<"braked">>().not.toHaveProperty("pid");
expectTypeOf<Case<"stopping">>().not.toHaveProperty("pid");
expectTypeOf<Case<"stopped">>().not.toHaveProperty("pid");
expectTypeOf<Parameters<typeof DevState.cases.exited.make>[0]>().not.toHaveProperty("pid");
expectTypeOf<Parameters<typeof DevState.cases.waiting.make>[0]>().not.toHaveProperty("pid");
expectTypeOf<Parameters<typeof DevState.cases.braked.make>[0]>().not.toHaveProperty("pid");
expectTypeOf<Case<"exited">>().toHaveProperty("replacement");
expectTypeOf<Case<"waiting">>().toHaveProperty("replacement");
expectTypeOf<Case<"starting">>().not.toHaveProperty("replacement");
expectTypeOf<Case<"listening">>().not.toHaveProperty("replacement");
expectTypeOf<Case<"braked">>().not.toHaveProperty("replacement");
expectTypeOf<Case<"stopped">>().not.toHaveProperty("replacement");
expectTypeOf(address).returns.toEqualTypeOf<number | null>();
expectTypeOf(target).returns.toEqualTypeOf<number | null>();
expectTypeOf(pending).returns.toEqualTypeOf<string | null>();

// Disjoint ranges, so a number found in a state names what it is.
const PIDS = { min: 30_000, max: 39_999 };
const PORTS = { min: 40_000, max: 49_999 };

const Choice = fc.record({
  pick: fc.nat(),
  // One move in ten is a late message of any kind, legal in this state or not.
  late: fc.integer({ min: 0, max: 9 }),
  port: fc.oneof(fc.constant(0), fc.integer(PORTS)),
  pid: fc.integer(PIDS),
  build: fc.string({ maxLength: 6 }).map((text) => `build:${text}`),
  at: fc.integer({ min: 1_000_000_000, max: 1_999_999_999 }),
  until: fc.integer({ min: 2_000_000_000, max: 2_999_999_999 }),
  reason: fc.constantFrom("intensity", "restart_failed", "stop"),
  // What the memory sampler saw: bytes at or over a limit, and its clock.
  bytes: fc.integer({ min: 50_000_000, max: 4_000_000_000 }),
  // L2: how many `replacing` Msgs arrive in a row once a replace has begun.
  burst: fc.integer({ min: 1, max: 5 }),
  // One replace or kill in four names a pid other than the one the state holds: the sampler read an
  // older process, and the fold must refuse it.
  stale: fc.integer({ min: 0, max: 3 }),
  // One start in ten reports a pid that is no process: zero, below zero, or not whole. `kill` sends
  // to a whole process group for zero and below, so the fold refuses each.
  refused: fc.oneof(
    { arbitrary: fc.constant(null), weight: 9 },
    {
      arbitrary: fc.oneof(
        fc.constant(0),
        fc.integer({ min: -99_999, max: -1 }),
        fc.integer(PIDS).map((pid) => pid + 0.5),
      ),
      weight: 1,
    },
  ),
});
type Choice = typeof Choice extends fc.Arbitrary<infer A> ? A : never;

const Walk = fc.record({
  last: fc.option(
    fc.integer({ min: 0, max: 99 }).map((n) => `last-${n}`),
    { nil: null },
  ),
  choices: fc.array(Choice, { minLength: 1, maxLength: 60 }),
});
type Walk = typeof Walk extends fc.Arbitrary<infer A> ? A : never;

type Kind = Msg["type"];

const kinds: ReadonlyArray<Kind> = [
  "listened",
  "started",
  "exited",
  "waiting",
  "braked",
  "stop",
  "stopped",
  "replacing",
  "killed",
];

// The plan's table, as the moves each state can really receive. Stop and brake are rarer, so a walk
// reaches deep states before it ends. The memory sampler replaces only a running process, and a
// replace ends in its exit, its kill, a brake or a stop.
const legal: Record<Phase, ReadonlyArray<readonly [Kind, number]>> = {
  starting: [
    ["listened", 4],
    ["started", 4],
    ["braked", 1],
    ["stop", 1],
  ],
  listening: [
    ["listened", 4],
    ["started", 4],
    ["braked", 1],
    ["stop", 1],
  ],
  spawned: [
    ["listened", 4],
    ["started", 1],
    ["exited", 4],
    ["replacing", 2],
    ["braked", 1],
    ["stop", 1],
  ],
  online: [
    ["listened", 2],
    ["started", 1],
    ["exited", 4],
    ["replacing", 3],
    ["braked", 1],
    ["stop", 1],
  ],
  replacing: [
    ["killed", 2],
    ["exited", 4],
    ["replacing", 1],
    ["listened", 1],
    ["started", 1],
    ["braked", 1],
    ["stop", 1],
  ],
  exited: [
    ["listened", 3],
    ["started", 3],
    ["waiting", 4],
    ["braked", 2],
    ["stop", 1],
  ],
  waiting: [
    ["listened", 3],
    ["started", 4],
    ["braked", 2],
    ["stop", 1],
  ],
  braked: [
    ["listened", 2],
    ["stop", 2],
  ],
  stopping: [
    ["listened", 1],
    ["stopped", 3],
  ],
  stopped: [],
};

// The pid a state holds, or null where it holds none.
const held = (s: State): number | null => (Predicate.hasProperty(s, "pid") && Predicate.isNumber(s.pid) ? s.pid : null);

const message = (kind: Kind, c: Choice, index: number, s: State): Msg => {
  // A sample reads the running process, or now and then one that has already gone.
  const sampled = c.stale === 0 ? c.pid : (held(s) ?? c.pid);

  if (kind === "listened") {
    return { type: "listened", port: c.port };
  }

  if (kind === "started") {
    return { type: "started", start: `start-${index}`, pid: c.refused ?? c.pid, build: c.build, at: c.at };
  }

  if (kind === "exited") {
    return { type: "exited", replacement: `token-${index}` };
  }

  if (kind === "waiting") {
    return { type: "waiting", until: c.until, reason: c.reason };
  }

  if (kind === "braked") {
    return { type: "braked", reason: c.reason };
  }

  if (kind === "replacing") {
    return { type: "replacing", pid: sampled, replacement: `replace-${index}`, bytes: c.bytes, at: c.at };
  }

  if (kind === "killed") {
    return { type: "killed", pid: sampled };
  }

  return { type: kind };
};

const choose = (s: State, c: Choice, index: number): Msg => {
  const moves = legal[s._tag];

  if (c.late === 0 || moves.length === 0) {
    return message(kinds[c.pick % kinds.length]!, c, index, s);
  }

  const total = moves.reduce((sum, [, weight]) => sum + weight, 0);
  let left = c.pick % total;

  for (const [kind, weight] of moves) {
    if (left < weight) {
      return message(kind, c, index, s);
    }

    left -= weight;
  }

  return message(moves[0]![0], c, index, s);
};

// The reference: what each state means, written from the plan's table and main's behavior.
type Ref = {
  readonly phase: Phase;
  readonly port: number | null;
  readonly pid: number | null;
  readonly token: string | null;
  readonly start: string | null;
  readonly after: string | null;
  readonly last: string | null;
  // The last signal a replace sent, held only while the phase is `replacing`.
  readonly signal: "SIGTERM" | "SIGKILL" | null;
};

type Settled = "completed" | "failed" | "discarded" | null;

const active = (phase: Phase) => phase !== "braked" && phase !== "stopping" && phase !== "stopped";
const known = (port: number) => (port === 0 ? null : port);

// The plan's rows for a replace: the sampler replaces only a running process, once; its kill marks
// the second signal; its exit is an ordinary exit; the old process already listened, so a listener
// changes nothing until the exit. Every other Msg follows main's rows below.
const reference = (ref: Ref, msg: Msg): readonly [Ref, Settled] => {
  const { phase } = ref;

  // A sample or a kill of a pid the state does not hold is about another process: refused.
  if (msg.type === "replacing") {
    return (phase === "spawned" || phase === "online") && ref.pid === msg.pid
      ? [{ ...ref, phase: "replacing", token: msg.replacement, signal: "SIGTERM" }, null]
      : [ref, null];
  }

  if (msg.type === "killed") {
    return phase === "replacing" && ref.pid === msg.pid && ref.signal === "SIGTERM"
      ? [{ ...ref, signal: "SIGKILL" }, null]
      : [ref, null];
  }

  // A start whose pid is not a whole number above zero names no one process.
  if (msg.type === "started" && !(Number.isInteger(msg.pid) && msg.pid > 0)) {
    return [ref, null];
  }

  if (msg.type === "listened" && phase === "replacing") {
    return [ref, null];
  }

  if (msg.type === "exited" && phase === "replacing") {
    return [{ ...ref, phase: "exited", pid: null, token: msg.replacement, signal: null }, null];
  }

  const [next, settled] = main(ref, msg);
  return [{ ...next, signal: next.phase === "replacing" ? next.signal : null }, settled];
};

const main = (ref: Ref, msg: Msg): readonly [Ref, Settled] => {
  const { phase } = ref;

  if (msg.type === "listened") {
    const port = known(msg.port);
    // Main's callback completes any pending replacement, whatever the phase, zero port included.
    const done = ref.token === null ? null : "completed";

    if (phase === "starting" || phase === "listening") {
      return [{ ...ref, phase: port === null ? "starting" : "listening", port }, null];
    }

    if (phase === "spawned" || phase === "online") {
      return [{ ...ref, phase: port === null ? "spawned" : "online", port, token: null }, done];
    }

    if (phase === "stopped") {
      return [ref, null];
    }

    return [{ ...ref, port, token: null }, done];
  }

  if (msg.type === "started") {
    if (!active(phase)) {
      return [ref, null];
    }

    // The event links to the start before it, or to the last durable start the driver read.
    const up = ref.port === null ? "spawned" : "online";
    return [{ ...ref, phase: up, pid: msg.pid, start: msg.start, after: ref.start ?? ref.last }, null];
  }

  if (msg.type === "exited") {
    return phase === "spawned" || phase === "online"
      ? [{ ...ref, phase: "exited", pid: null, token: msg.replacement }, null]
      : [ref, null];
  }

  if (msg.type === "waiting") {
    return phase === "exited" ? [{ ...ref, phase: "waiting" }, null] : [ref, null];
  }

  if (msg.type === "braked") {
    return active(phase)
      ? [{ ...ref, phase: "braked", pid: null, token: null }, ref.token === null ? null : "failed"]
      : [ref, null];
  }

  if (msg.type === "stop") {
    return phase === "stopping" || phase === "stopped" ? [ref, null] : [{ ...ref, phase: "stopping", pid: null }, null];
  }

  return phase === "stopping"
    ? [{ ...ref, phase: "stopped", token: null }, ref.token === null ? null : "discarded"]
    : [ref, null];
};

// Every number and string a state holds, whatever its field names.
const leaves = (value: unknown): ReadonlyArray<unknown> =>
  Predicate.isObject(value) ? Rec.values(value).flatMap(leaves) : [value];

const pids = (s: State) => leaves(s).filter((v) => Predicate.isNumber(v) && v >= PIDS.min && v <= PIDS.max);

type Step = {
  readonly index: number;
  readonly prev: State;
  readonly msg: Msg;
  readonly next: State;
  readonly before: Ref;
  readonly ref: Ref;
  readonly settled: Settled;
  readonly choice: Choice;
};

const isState = Schema.is(devLife.model);

// The one shared walk: each move is chosen from the state the fold has reached.
const walk = (w: Walk, visit: (step: Step) => void) => {
  const [initial, cmds] = devLife.init(null, { last: w.last });
  expect(cmds).toEqual([]);
  expect(isState(initial)).toBe(true);
  let s = initial;
  let ref: Ref = {
    phase: "starting",
    port: null,
    pid: null,
    token: null,
    start: null,
    after: null,
    last: w.last,
    signal: null,
  };

  for (const [index, choice] of w.choices.entries()) {
    const msg = choose(s, choice, index);
    const [next, out] = applyCell(devLife, s, msg);
    expect(out).toEqual([]);
    const [after, settled] = reference(ref, msg);
    visit({ index, prev: s, msg, next, before: ref, ref: after, settled, choice });
    s = next;
    ref = after;
  }
};

const coverage = () => ({
  partial: 0,
  callback: 0,
  failed: 0,
  late: 0,
  stopped: 0,
  replacing: 0,
  killed: 0,
  replaced: 0,
  // A sample or kill of another pid, and a start with no process's pid, each reached a state they
  // could have moved.
  stale: 0,
  refused: 0,
});

const covered = (seen: ReturnType<typeof coverage>) => {
  for (const [name, count] of Rec.toEntries(seen)) {
    expect(count, `walks reached ${name}`).toBeGreaterThan(0);
  }
};

const count = (seen: ReturnType<typeof coverage>, step: Step) => {
  if (step.ref.phase === "listening" || step.ref.phase === "spawned") {
    seen.partial++;
  }

  if (step.settled === "completed") {
    seen.callback++;
  }

  if (step.settled === "failed") {
    seen.failed++;
  }

  if (step.before.phase === "stopping" && step.msg.type !== "stopped" && step.msg.type !== "listened") {
    seen.late++;
  }

  if (step.ref.phase === "stopped") {
    seen.stopped++;
  }

  if (step.ref.phase === "replacing" && step.before.phase !== "replacing") {
    seen.replacing++;
  }

  if (step.ref.signal === "SIGKILL" && step.before.signal === "SIGTERM") {
    seen.killed++;
  }

  if (step.before.phase === "replacing" && step.ref.phase === "exited") {
    seen.replaced++;
  }

  const running = step.before.phase === "spawned" || step.before.phase === "online";
  const sampled = step.msg.type === "replacing" || step.msg.type === "killed" ? step.msg.pid : null;

  if (sampled !== null && sampled !== step.before.pid && (running || step.before.phase === "replacing")) {
    seen.stale++;
  }

  if (step.msg.type === "started" && step.choice.refused !== null && active(step.before.phase)) {
    seen.refused++;
  }
};

describe("T708 dev life laws", () => {
  // L1. Plant: let `replacing` from `spawned` be ignored, or let `listened` end a `replacing`, or let
  // `replacing` or `killed` move a state whose pid differs from the Msg's, or let `started` take a pid
  // of zero: the walk and the reference differ.
  it("L1 every transition, replacing and killed included, preserves the state-specific fields and sampling eligibility", () => {
    const seen = coverage();
    fc.assert(
      fc.property(Walk, (w) => {
        walk(w, (step) => {
          count(seen, step);
          const { next, ref } = step;
          expect(isState(next)).toBe(true);
          expect(next._tag).toBe(ref.phase);

          // A finished stop may forget its listener; every other state answers calls with it.
          if (ref.phase !== "stopped") {
            expect(address(next)).toBe(ref.port);
          }

          expect(pending(next)).toBe(ref.token);
          // Only a live process is a sample target. A replace still holds the old pid for its kill, and
          // no other state hides a pid.
          const holds = ref.phase === "spawned" || ref.phase === "online" || ref.phase === "replacing";
          expect(target(next)).toBe(ref.phase === "spawned" || ref.phase === "online" ? ref.pid : null);
          expect(pids(next)).toEqual(holds ? [ref.pid] : []);
          expect(next._tag === "replacing" ? next.signal : null).toBe(ref.signal);

          // A process keeps its start and the start before it for the driver's events.
          if (ref.start !== null && ref.phase !== "stopped") {
            expect(leaves(next)).toContain(ref.start);
          }

          if (holds && ref.after !== null) {
            expect(leaves(next)).toContain(ref.after);
          }
        });
      }),
      { seed: SEED, numRuns: 200 },
    );
    covered(seen);
  });

  // L2. Plant: `target(replacing)` returns the pid: the sampler could reach a second `replacing`.
  it("L2 a replace happens once per start: target is null and another replacing changes nothing until a new start", () => {
    const seen = { repeats: 0, again: 0 };
    fc.assert(
      fc.property(Walk, (w) => {
        // Set by a replace, cleared only by a start that gave a running process again.
        let armed = false;
        let replaces = 0;
        walk(w, ({ prev, msg, next, choice }) => {
          // No state but a running process is a sample target, and a replace is not one.
          expect(next._tag === "replacing" ? target(next) : null).toBeNull();
          // Once replaced, a sample over the limit changes nothing until a new start.
          expect(armed && msg.type === "replacing" ? next : prev).toEqual(prev);
          const began = msg.type === "replacing" && next._tag === "replacing" && prev._tag !== "replacing";
          // A second replace in one walk came after a new start re-armed the sampler.
          seen.again += began && replaces > 0 ? 1 : 0;
          replaces += began ? 1 : 0;
          armed = armed || began;
          // One to five more samples over the limit while the old process drains.
          const sample = began && msg.type === "replacing" ? msg : null;
          const repeats =
            sample === null
              ? []
              : Array.from({ length: choice.burst - 1 }, (_, n) =>
                  applyCell(devLife, next, { ...sample, replacement: `${sample.replacement}-${n + 1}` }),
                );
          seen.repeats += repeats.length;
          expect(repeats).toEqual(repeats.map(() => [next, []]));

          if (msg.type === "started" && (next._tag === "spawned" || next._tag === "online")) {
            armed = false;
          }
        });
      }),
      { seed: SEED, numRuns: 200 },
    );
    expect(seen.repeats, "walks sent a replacing to a replace").toBeGreaterThan(0);
    expect(seen.again, "walks replaced a later start too").toBeGreaterThan(0);
  });

  // L3. Plant: `reachable` returns the port of an `online` with a pending replacement: it fails on the
  // walk whose replacement starts before it listens.
  it("L3 reachable is a port only in listening or online with no pending replacement, and equals address there", () => {
    const seen = { early: 0, reachable: 0 };
    fc.assert(
      fc.property(Walk, (w) => {
        walk(w, ({ next, ref }) => {
          const open = (ref.phase === "listening" || ref.phase === "online") && ref.token === null;
          expect(reachable(next)).toBe(open ? ref.port : null);

          if (open) {
            seen.reachable++;
            expect(reachable(next)).toBe(address(next));
          }

          if (ref.phase === "online" && ref.token !== null) {
            // A replacement that started before its listener: the old port is known, not reachable.
            seen.early++;
          }
        });
      }),
      { seed: SEED, numRuns: 200 },
    );
    expect(seen.early, "walks reached an online replacement before its listener").toBeGreaterThan(0);
    expect(seen.reachable).toBeGreaterThan(0);
  });

  it("either startup order yields the same usable process and listener", () => {
    let both = 0;
    fc.assert(
      fc.property(Walk, (w) => {
        walk(w, ({ index, prev, choice }) => {
          // A replacing process already listened, so its listener is not a startup's: the plan's
          // `replacing` ignores it until the exit.
          if (!active(prev._tag) || prev._tag === "replacing") {
            return;
          }

          both++;
          // A start with no process's pid is refused, as L1 holds; this law is about real starts.
          const real = { ...choice, refused: null };
          const started = message("started", real, index, prev);
          const listened = message("listened", real, index, prev);
          const [first] = applyCell(devLife, applyCell(devLife, prev, started)[0], listened);
          const [second] = applyCell(devLife, applyCell(devLife, prev, listened)[0], started);
          const usable = (s: State) => ({ _tag: s._tag, address: address(s), target: target(s), pending: pending(s) });
          expect(usable(first)).toEqual(usable(second));
          expect(usable(first)).toEqual({
            _tag: choice.port === 0 ? "spawned" : "online",
            address: known(choice.port),
            target: choice.pid,
            pending: null,
          });
        });
      }),
      { seed: SEED, numRuns: 100 },
    );
    expect(both).toBeGreaterThan(0);
  });

  it("replacement completion belongs to the listener callback; braking fails the pending wait once", () => {
    const seen = coverage();
    fc.assert(
      fc.property(Walk, (w) => {
        const settled = new Set<string>();
        walk(w, (step) => {
          count(seen, step);
          const { prev, msg, next } = step;
          const was = pending(prev);
          const now = pending(next);
          expect(now).toBe(step.ref.token);

          if (msg.type === "started" || msg.type === "waiting" || msg.type === "stop") {
            // A start notification is not the replacement's listener.
            expect(now).toBe(was);
          }

          if (was !== null && now !== was) {
            // Only the listener completes, a brake fails, a finished stop discards, and a new exit
            // replaces the token as main does.
            const ways: Partial<Record<Kind, Settled>> = {
              listened: "completed",
              braked: "failed",
              stopped: "discarded",
              exited: null,
              // A replace of a process whose own replacement had not listened yet takes its place.
              replacing: null,
            };
            const way = ways[msg.type];
            expect(way).not.toBeUndefined();
            expect(step.settled).toBe(way);
            // One settlement per token: a late brake or listener finds nothing left to settle.
            expect(settled.has(was)).toBe(false);
            settled.add(was);
          }

          if (msg.type === "braked" && active(prev._tag)) {
            expect(now).toBeNull();
          }
        });
      }),
      { seed: SEED, numRuns: 100 },
    );
    covered(seen);
  });

  it("shutdown blocks queued lifecycle work and sampling while preserving final recording", () => {
    const seen = coverage();
    fc.assert(
      fc.property(Walk, (w) => {
        walk(w, (step) => {
          count(seen, step);
          const { prev, msg, next, before } = step;
          // Only a stop enters shutdown, and nothing leaves it but its own finish.
          expect(next._tag === "stopping" || next._tag === "stopped").toBe(
            msg.type === "stop" || before.phase === "stopping" || before.phase === "stopped",
          );

          if (msg.type === "stop" && before.phase !== "stopping" && before.phase !== "stopped") {
            expect(next._tag).toBe("stopping");
            // The final stopped event needs the last start and the listener the calls still use.
            expect(address(next)).toBe(address(prev));

            if (before.start !== null) {
              expect(leaves(next)).toContain(before.start);
            }
          }

          if (prev._tag === "stopping" || prev._tag === "stopped") {
            expect(target(next)).toBeNull();

            if (msg.type !== "listened" && !(prev._tag === "stopping" && msg.type === "stopped")) {
              // Queued lifecycle work and a second stop change nothing.
              expect(next).toEqual(prev);
            }
          }
        });
      }),
      { seed: SEED, numRuns: 100 },
    );
    covered(seen);
  });
});
