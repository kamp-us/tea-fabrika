// P39 slice 4a, next/: the hands start's laws H2 and H5, on the real start over Effect's own socket,
// the real journal on Effect's memory `KeyValueStore`, and the fake `Commands`.
//
// What these laws hold `client/HandsStart.ts` to, from the approved plan (the build may add more):
// - `start({ origin, build, label })` boots `handsMachine` on tea's Effect engine with the dial Sub
//   the window shares and its Cmd handlers, and returns tea's booting run, whose `ready` is the run,
//   as `WindowStart.start` does. It needs `ClientKey`, `Journal`, `Commands`, `Id.Generator`,
//   `Socket.WebSocketConstructor` and a `Scope`: closing the scope stops the run and its sockets,
//   which is how these laws crash a client.
// - Its hello is `initialize` with `has` from `Commands.has`, `platform: "headless"` and `build`.
//   Its calls are JSON-RPC 2.0 `tasks.list {}`, `tasks.wait { after }`, `tasks.take { process }`,
//   `tasks.started` and `tasks.finish`, answered as `gateway/Tasks.ts` answers them.
// - `journal_read`, `journal_write` and `execute` go to `Journal.read`, `Journal.write` and
//   `Commands.execute`, and nothing else reads or writes the journal or runs a command.
//
// The door is the scripted brain (`HandsDoor.test-support.ts`) on one in-memory socket per dial. The
// walk reads the run's state and the timeline the fakes keep, and picks its next move from there: a
// request for the client's key, a cut at the next journal write, call or command the state is about
// to make, a crash and restart over the same journal and brain, a socket drop while local work is in
// flight, or time passing. The oracle is the timeline: what really ran, what was really saved, and
// where each crash fell (`expectedResults`).
//
// Plants (after build): H2, read `executing` without a result as nothing, so the command runs
// again. H5, move every work state to `offline` on a drop, losing the result.
import { describe, expect, it } from "@effect/vitest";
import { Deferred, Effect, Exit, Layer, Schema, Scope, String as Str, pipe } from "effect";
import * as KeyValueStore from "effect/persistence/KeyValueStore";
import { TestClock } from "effect/testing";
import * as fc from "fast-check";
import * as Id from "../Id.ts";
import { fcTypeId } from "../tasks/TasksTest.ts";
import { property } from "../Testing.test-support.ts";
import { ClientKey } from "../transport/ClientKey.ts";
import { KeyLine } from "../transport/Sshsig.ts";
import { Hello } from "../transport/Wire.ts";
import {
  type Armed,
  crashed,
  cutJournal,
  expectedResults,
  fakeCommands,
  resumed,
  seen,
  type Seen,
} from "./Commands.test-support.ts";
import { brain, door } from "./HandsDoor.test-support.ts";
import { start } from "./HandsStart.ts";
import * as JournalStore from "./JournalStore.ts";

const ORIGIN = "http://127.0.0.1:18787";
const KEY = "SHA256:hands-own-key-0000000000000000000000000000";

/** A made-up Ed25519 public key line: the scripted door checks no signature, so nothing signs for real. */
const identity = (() => {
  const raw = new Uint8Array(32).fill(7);
  const field = (bytes: Uint8Array) => [...new Uint8Array(new Uint32Array([bytes.length]).buffer).reverse(), ...bytes];
  const blob = new Uint8Array([...field(new TextEncoder().encode("ssh-ed25519")), ...field(raw)]);
  return {
    fingerprint: KEY,
    raw: pipe(
      btoa(String.fromCharCode(...raw)),
      Str.replaceAll("+", "-"),
      Str.replaceAll("/", "_"),
      Str.replace(/=+$/, ""),
    ),
    line: Schema.decodeUnknownSync(KeyLine)(`ssh-ed25519 ${btoa(String.fromCharCode(...blob))}`),
    found: "reused" as const,
    sign: () => Effect.succeed(new Uint8Array(64)),
  };
})();

const keys = Layer.succeed(ClientKey, {
  current: () => Effect.succeed(identity),
  claimPersist: Effect.succeed(false),
  persist: Effect.succeed(true),
});

/** Lets the run go on: virtual time moves `ms`, and real work (the hello's hashing) gets its turn. */
const pass = (ms: number) =>
  TestClock.adjust(ms).pipe(
    Effect.andThen(TestClock.withLive(Effect.sleep("1 millis"))),
    Effect.andThen(Effect.yieldNow),
  );

const Cell = fc.record({ move: fc.nat(), pick: fc.nat(), ms: fc.integer({ min: 0, max: 40_000 }) });
type Cell = typeof Cell extends fc.Arbitrary<infer A> ? A : never;

const Tape = fc.record({
  processes: fc.uniqueArray(fcTypeId("process"), { minLength: 2, maxLength: 4 }),
  cells: fc.array(Cell, { minLength: 20, maxLength: 60, size: "max" }),
});
type Tape = typeof Tape extends fc.Arbitrary<infer A> ? A : never;

type Focus = "H2" | "H5";

/**
 * H2's boundaries: a pause armed before or after the next journal read, journal write or command
 * holds the client there, in `recalling`, `saving` or `executing`, and a crash while it is held is
 * the cut. With the memory journal and the fake command those states end within one tick, so only a
 * held call lets a cut land in them.
 */
const PAUSES: ReadonlyArray<Armed> = [
  { op: "write", at: "before", mode: "pause" },
  { op: "write", at: "after", mode: "pause" },
  { op: "execute", at: "before", mode: "pause" },
  { op: "execute", at: "after", mode: "pause" },
  { op: "read", at: "before", mode: "pause" },
];

const walk = (tape: Tape, focus: Focus, done: Set<string>) =>
  Effect.gen(function* () {
    const b = brain();
    const d = door(b, KEY);
    const s: Seen = seen();
    // The journal's store outlives every process, as a file would: one memory store for the walk.
    const store = yield* Layer.build(KeyValueStore.layerMemory);
    const layers = Layer.mergeAll(
      d.socket,
      keys,
      fakeCommands(s),
      cutJournal(s).pipe(Layer.provide(JournalStore.layer), Layer.provide(Layer.succeedContext(store))),
      Id.Generator.layer,
    );
    const boot = Effect.gen(function* () {
      const scope = yield* Scope.make();
      const booting = yield* start({ origin: ORIGIN, build: "hands-build", label: "hands" }).pipe(
        Effect.provide(layers),
        Scope.provide(scope),
      );
      const run = yield* booting.ready;
      return { scope, run };
    });
    let live = yield* boot;
    const crash = Effect.gen(function* () {
      yield* Scope.close(live.scope, Exit.void);
      crashed(s);
      done.add("restart");
      live = yield* boot;
    });
    const work = () => live.run.getState().work._tag;
    let n = 0;
    /** H2: the pause armed last, so a crash while it holds names the boundary it cut. */
    let pending: Armed | null = null;

    for (const cell of tape.cells) {
      yield* pass(0);
      const now = work();
      const stopped = yield* Deferred.isDone(s.stopped);
      const held = yield* Deferred.isDone(s.paused);
      const open = b.all().filter((j) => j.phase !== "finished");
      // A new task is asked for a process only when that process has no open task (0093): two open
      // tasks of one process wedge `tasks.take` (finding 2026-11-15-jobs-take-ambiguous-wedges).
      const free = tape.processes.filter((p) => !open.some((j) => j.request.process === p));
      const asks = free.length === 0 ? [] : open.length === 0 ? ["request", "request"] : ["request"];
      const options: Array<string> =
        focus === "H2" && held
          ? ["cut", "cut", "resume"]
          : [
              ...(stopped ? ["restart", "restart"] : []),
              ...asks,
              "time",
              "time",
              ...(focus === "H2"
                ? ["pause", "pause", "pause", "fail", "call", "restart"]
                : ["pause", "pause", "drop", "resume"]),
            ];
      const move = options[cell.move % options.length] ?? "time";

      if (move === "request") {
        d.request(free[cell.pick % free.length] ?? "", ++n);
        done.add("request");
      } else if (move === "time") {
        yield* pass(cell.ms);
      } else if (move === "restart") {
        done.add(`restart@${now}`);
        yield* crash;
      } else if (move === "cut") {
        // The client is held at the boundary the pause names: a crash there is the cut.
        done.add(`cut:${pending?.op ?? ""}:${pending?.at ?? ""}@${now}`);
        pending = null;
        yield* crash;
      } else if (move === "fail") {
        s.armed = { op: "write", at: cell.pick % 2 === 0 ? "before" : "after", mode: "fail" };
        done.add("fail:write");
      } else if (move === "call") {
        d.state.cut = cell.pick % 2 === 0 ? "before" : "after";
        done.add(`cut:call:${d.state.cut}`);
      } else if (move === "pause" && focus === "H2") {
        pending = PAUSES[cell.pick % PAUSES.length] ?? null;
        s.armed = pending;
      } else if (move === "pause") {
        if (now === "executing" || now === "saving") {
          s.armed = {
            op: now === "executing" ? "execute" : "write",
            at: cell.pick % 2 === 0 ? "before" : "after",
            mode: "pause",
          };
        } else {
          s.armed = { op: cell.pick % 2 === 0 ? "execute" : "write", at: "before", mode: "pause" };
        }
      } else if (move === "drop") {
        const paused = yield* Deferred.isDone(s.paused);
        d.drop();
        yield* pass(0);

        if (paused) {
          // H5: the link went down with local work in flight; the work goes on and is not lost.
          expect(["executing", "saving"], `H5: a drop in ${now} keeps the local work`).toContain(work());
          done.add(`drop@${now}`);
        }
      } else if (move === "resume") {
        yield* resumed(s);
        done.add("resume");
      }
    }

    // Quiet now: no cut, no pause, and the client runs until the brain has every task finished.
    s.armed = null;
    d.state.cut = null;
    yield* resumed(s);

    if (yield* Deferred.isDone(s.stopped)) {
      yield* crash;
    }

    for (let i = 0; i < 400 && b.all().some((j) => j.phase !== "finished"); i++) {
      yield* pass(i % 10 === 0 ? 30_000 : 1_000);
    }

    const { runs, results } = expectedResults(s.events);

    for (const task of b.all()) {
      const id = task.request.id;
      expect(task.phase, `${focus}: ${id} ends finished`).toBe("finished");
      expect(runs.get(id) ?? 0, `H2: ${id}'s command ran at most once across every restart`).toBeLessThanOrEqual(1);
      expect(task.result, `H2: ${id} ends with the result its journal held`).toEqual(results.get(id));
      done.add(task.result?._tag === "unknown" ? "ended:unknown" : "ended:result");
    }

    expect(runs.get("") ?? 0, "a command ran with no `executing` entry saved before it").toBe(0);
    yield* Scope.close(live.scope, Exit.void);
  });

const law = (name: string, focus: Focus, required: ReadonlyArray<string>, runs: number) =>
  it.effect(
    name,
    () =>
      Effect.gen(function* () {
        const done = new Set<string>();
        // The shared runner: each walk in a scope of its own, from the shared seed 119120.
        yield* property(Tape, (tape) => walk(tape, focus, done).pipe(Effect.provide(TestClock.layer())), {
          numRuns: runs,
        });
        // An empty walk cannot pass: every transition the law is about ran at least once.
        expect([...done]).toEqual(expect.arrayContaining([...required]));
      }),
    300_000,
  );

/** Every `os` the hello's wire schema accepts. */
const OSES: ReadonlyArray<(typeof Hello.Type)["os"]> = ["macos", "windows", "linux", "android", "ios", "unknown"];

describe("P39 slice 4b: the host's os in the hello", () => {
  // O1, from the approved plan (docs/plan/quests/p39-s5-PLAN.md): `start` takes the host's `os` and its
  // hello sends it, in place of `unknown`. Plant, run once and undone (recorded in the tests step's
  // field row): keep `os: "unknown"`.
  it.effect(
    "O1: the hello carries the os the start was given, for every value the wire accepts",
    () =>
      Effect.gen(function* () {
        const reached = new Set<string>();
        yield* property(
          fc.constantFrom(...OSES),
          (os) =>
            Effect.gen(function* () {
              const d = door(brain(), KEY);
              const s: Seen = seen();
              const store = yield* Layer.build(KeyValueStore.layerMemory);
              const layers = Layer.mergeAll(
                d.socket,
                keys,
                fakeCommands(s),
                JournalStore.layer.pipe(Layer.provide(Layer.succeedContext(store))),
                Id.Generator.layer,
              );
              const booting = yield* start({ origin: ORIGIN, build: "hands-build", label: "hands", os }).pipe(
                Effect.provide(layers),
              );
              yield* booting.ready;

              for (let i = 0; i < 50 && d.state.hellos.length === 0; i++) {
                yield* pass(100);
              }

              expect(d.state.hellos.length, "O1: the start says hello").toBeGreaterThan(0);

              for (const hello of d.state.hellos) {
                expect(Schema.decodeUnknownSync(Hello)(hello).os, "O1: every hello carries the os it was given").toBe(
                  os,
                );
              }

              reached.add(os);
            }).pipe(Effect.provide(TestClock.layer())),
          { numRuns: 30 },
        );
        expect([...reached]).toEqual(expect.arrayContaining([...OSES]));
      }),
    120_000,
  );
});

describe("P39 slice 4a: the hands start", () => {
  law(
    "H2: after a cut at any journal or call boundary and a restart, the task ends finished with the fake's result when the journal held one, and with unknown interrupted when it held executing and no result",
    "H2",
    [
      "request",
      "restart",
      // The closing reach check: each state the plan cuts in was really cut, at each boundary.
      "cut:write:before@saving",
      "cut:write:after@saving",
      "cut:execute:before@executing",
      "cut:execute:after@executing",
      "cut:read:before@recalling",
      "fail:write",
      "cut:call:before",
      "cut:call:after",
      "ended:unknown",
      "ended:result",
    ],
    100,
  );
  law(
    "H5: a dropped link during executing or saving lets the local work finish; on reconnect the client lists, takes and reports it, and runs nothing again",
    "H5",
    ["request", "drop@executing", "drop@saving", "resume", "ended:result"],
    60,
  );
});
