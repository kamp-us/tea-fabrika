// P39 slice 4a, next/: the hands client's fake `Commands`, the only `Commands` layer in 4a, and the
// cut points the laws put around `Commands` and `Journal`. A cut fails, stops or pauses a call
// before or after it delegates: before, the command never ran or the entry was never saved; after,
// it ran or was saved and the caller has not heard yet. A stop is the process dying there: the call
// never returns, and the law closes the client's scope to end it, as a crash would. A pause holds the
// call until the law resumes it, so a law can drop the socket while local work is in flight. The
// fakes keep their own timeline of what really ran and what was really saved, the oracle the laws
// read; they never read the client's state.
import * as Deferred from "effect/Deferred";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Schema from "effect/Schema";
import { Command, Result } from "../tasks/Task.ts";
import { Commands } from "./Commands.ts";
import { fakeResult } from "./HandsDoor.test-support.ts";
import { Entry, Journal, JournalError } from "./Journal.ts";

/** Where a cut lands, around the call it cuts. */
export type Cut = "before" | "after";

/** What one cut does there: the call fails with the service's own error, never returns, or waits. */
export type CutMode = "fail" | "stop" | "pause";

/** A planted cut, armed for the next call of `op`, and then spent. */
export type Armed = { readonly op: "execute" | "read" | "write"; readonly at: Cut; readonly mode: CutMode };

/** One thing that really happened below the client: a command run, an entry saved, or a crash. */
export const Event = Schema.TaggedUnion({
  ran: { command: Command, result: Result },
  saved: { task: Schema.String, entry: Schema.Unknown },
  crash: {},
});
export type Event = typeof Event.Type;

/** What the fakes saw, and the cut armed now. */
export type Seen = {
  readonly events: Array<Event>;
  armed: Armed | null;
  /** Done once a stop is reached: the law then ends the client's scope, as a crash would. */
  stopped: Deferred.Deferred<void>;
  /** Done once a pause is reached, with the call it holds. */
  paused: Deferred.Deferred<Armed["op"]>;
  /** The law completes it to let a paused call go on. */
  resume: Deferred.Deferred<void>;
};

export const seen = (): Seen => ({
  events: [],
  armed: null,
  stopped: Deferred.makeUnsafe<void>(),
  paused: Deferred.makeUnsafe<Armed["op"]>(),
  resume: Deferred.makeUnsafe<void>(),
});

/** A new process: the next stop, pause and resume are its own. The events stay, with a crash between. */
export const crashed = (s: Seen): void => {
  s.events.push(Event.cases.crash.make({}));
  s.armed = null;
  s.stopped = Deferred.makeUnsafe<void>();
  s.paused = Deferred.makeUnsafe<Armed["op"]>();
  s.resume = Deferred.makeUnsafe<void>();
};

/** The held call goes on, and the next pause is a new one. */
export const resumed = (s: Seen) =>
  Deferred.succeed(s.resume, undefined).pipe(
    Effect.andThen(
      Effect.sync(() => {
        s.paused = Deferred.makeUnsafe<Armed["op"]>();
        s.resume = Deferred.makeUnsafe<void>();
      }),
    ),
  );

/** The cut armed for `op` at `at`, spent as it is read. */
const take = (s: Seen, op: Armed["op"], at: Cut): CutMode | null => {
  const armed = s.armed;

  if (armed === null || armed.op !== op || armed.at !== at) {
    return null;
  }

  s.armed = null;
  return armed.mode;
};

/** What a stop or a pause does: a stop never returns, a pause waits for the law. */
const hold = (s: Seen, op: Armed["op"], mode: CutMode) =>
  mode === "pause"
    ? Deferred.succeed(s.paused, op).pipe(Effect.andThen(Deferred.await(s.resume)))
    : Deferred.succeed(s.stopped, undefined).pipe(Effect.andThen(Effect.never));

/**
 * The fake `Commands`: it says it `has` git, keeps each command it really runs and answers the
 * fake's result for it. A cut before it delegates runs nothing yet; a cut after it ran has not
 * answered yet. A cut that fails is a stop here: `execute` has no error, and a failure to start is a
 * Result.
 */
export const fakeCommands = (s: Seen) =>
  Layer.succeed(Commands, {
    has: ["git"],
    execute: (command: Command) =>
      Effect.gen(function* () {
        const before = take(s, "execute", "before");

        if (before !== null) {
          yield* hold(s, "execute", before === "fail" ? "stop" : before);
        }

        const result = fakeResult(s.events.filter((e) => e._tag === "ran").length + 1);
        s.events.push(Event.cases.ran.make({ command, result }));
        const after = take(s, "execute", "after");

        if (after !== null) {
          yield* hold(s, "execute", after === "fail" ? "stop" : after);
        }

        return result;
      }),
  });

/**
 * The real journal with cuts around it: the layer needs the `Journal` under test
 * (`JournalStore.layer` on a store the law keeps across restarts), and each call may fail, stop or
 * pause before or after it delegates.
 */
export const cutJournal = (s: Seen) =>
  Layer.effect(
    Journal,
    Effect.gen(function* () {
      const inner = yield* Journal;
      const around = <A>(op: "read" | "write", work: Effect.Effect<A, JournalError>, saved: () => void) =>
        Effect.gen(function* () {
          const before = take(s, op, "before");

          if (before === "fail") {
            return yield* new JournalError({ reason: "storage" });
          }

          if (before !== null) {
            yield* hold(s, op, before);
          }

          const value = yield* work;
          saved();
          const after = take(s, op, "after");

          if (after === "fail") {
            return yield* new JournalError({ reason: "storage" });
          }

          if (after !== null) {
            yield* hold(s, op, after);
          }

          return value;
        });
      return {
        read: (task: string) => around("read", inner.read(task), () => {}),
        write: (task: string, entry: Parameters<typeof inner.write>[1]) =>
          around("write", inner.write(task, entry), () => void s.events.push(Event.cases.saved.make({ task, entry }))),
      };
    }),
  );

const isEntry = Schema.is(Entry);
const interrupted = Result.cases.unknown.make({ reason: "interrupted" });

/**
 * What the oracle expects each task to end with, read off the timeline: the fake's result when the
 * command ran and its `result` entry was saved before the next crash, else `unknown interrupted`.
 * It also counts how often each task's command ran: a run belongs to the task whose `executing` entry
 * was saved last before it, and a run with none is counted under the empty id.
 */
export const expectedResults = (events: ReadonlyArray<Event>) => {
  const runs = new Map<string, number>();
  const results = new Map<string, Result>();
  let executing: string | null = null;
  let pending: { readonly task: string; readonly result: Result } | null = null;

  for (const e of events) {
    if (e._tag === "crash") {
      pending = null;
      executing = null;
    } else if (e._tag === "ran") {
      const task = executing ?? "";
      runs.set(task, (runs.get(task) ?? 0) + 1);
      pending = { task, result: e.result };
    } else {
      const step = isEntry(e.entry) ? e.entry._tag : "";

      if (step === "executing") {
        executing = e.task;
      } else if (step === "result" && !results.has(e.task)) {
        results.set(e.task, pending?.task === e.task ? pending.result : interrupted);
      }
    }
  }

  return { runs, results };
};
