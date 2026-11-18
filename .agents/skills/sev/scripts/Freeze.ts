// Freeze: what a sev0 does to CI, as code (decision 0532). Today's lead tooling, run on our own
// laptop; it is not product.
//
//   loop   every beat, cancel each unfinished run that is not the merge queue's and not on a branch
//          the allow list names, until the log says the sev0 closed. In a sev0 the owner has
//          emptied the queue, so its runs are none, and keeping them is harmless
//   ended  after a close, wait until the loop has said it ended, so no cancel comes after
//
// The loop reads the log again before each cancel, so a close, a `next` or an `allow` counts at
// once, never a beat late. It never asks for a rerun: the service has none.
import { Console, Duration, Effect, Schema, Array as Arr, Option } from "effect";
import * as Level from "./Level.ts";
import type { Run } from "./WorkflowRuns.ts";
import { WorkflowRuns } from "./WorkflowRuns.ts";

// ---------------------------------------------------------------- the deciding part

/** Why a run is kept: it is the merge queue's, or its branch fixes the emergency. */
export const Verdict = Schema.TaggedUnion({
  keep: { reason: Schema.Literals(["queue", "allowed"]) },
  cancel: {},
});

export type Verdict = typeof Verdict.Type;

/**
 * What the freeze does with one unfinished run. A merge queue run is kept: in a sev0 the owner has
 * emptied the queue first, so there is none, and canceling one would take its pull request out of
 * the queue behind the owner's back. A push run on main is canceled too.
 */
export const verdict = (run: Run, allow: ReadonlyArray<string>): Verdict =>
  run.event === "merge_group"
    ? Verdict.cases.keep.make({ reason: "queue" })
    : allow.includes(run.branch)
      ? Verdict.cases.keep.make({ reason: "allowed" })
      : Verdict.cases.cancel.make({});

/**
 * How many cancel loops of the latest sev0 have not said they ended. A close that no loop answered
 * writes one `ended` by `close`, which ends them all.
 */
export const running = (entries: ReadonlyArray<Level.Entry>): number => {
  const from = Arr.findLastIndex(entries, (e) => e._tag === "opened");
  const latest = entries.slice(Option.getOrElse(from, () => 0));

  if (Arr.some(latest, (e) => e._tag === "ended" && e.by === "close")) {
    return 0;
  }

  return Arr.filter(latest, (e) => e._tag === "looping").length - Arr.filter(latest, (e) => e._tag === "ended").length;
};

// ---------------------------------------------------------------- the loop

/** The allow list while a sev0 is open; `null` once it closed. */
const allowed = Effect.fnUntraced(function* (home: string) {
  const { sev0 } = yield* Level.read(home);

  return sev0._tag === "open" ? sev0.allow : null;
});

const runLine = (run: Run) => `${run.id} ${run.workflow} ${run.event} ${run.branch}`;

/** Adds a line the loop writes; those follow any log, so this never refuses. */
const note = (home: string, entry: Level.Entry) => Effect.asVoid(Level.write(home, entry));

/** One beat: list what has not finished, then cancel each run the verdict cancels. */
const beat = Effect.fn("Freeze.beat")(function* (home: string) {
  const github = yield* WorkflowRuns;
  const listed = yield* Effect.result(github.unfinished);

  if (listed._tag === "Failure") {
    const reason = listed.failure.reason;
    yield* note(home, Level.Entry.cases.failed.make({ at: yield* Level.now, call: "unfinished", id: null, reason }));

    return yield* Console.log(`sev: could not list the runs: ${reason}`);
  }

  for (const run of listed.success) {
    const allow = yield* allowed(home);

    if (allow === null) {
      return;
    }

    if (verdict(run, allow)._tag === "keep") {
      continue;
    }

    const done = yield* Effect.result(github.cancel(run.id));

    if (done._tag === "Failure") {
      const reason = done.failure.reason;
      yield* note(home, Level.Entry.cases.failed.make({ at: yield* Level.now, call: "cancel", id: run.id, reason }));
      yield* Console.log(`sev: could not cancel ${runLine(run)}: ${reason}`);
    } else {
      yield* note(home, Level.Entry.cases.canceled.make({ at: yield* Level.now, run }));
      yield* Console.log(`sev: canceled ${runLine(run)}`);
    }
  }
});

/** Waits one beat, a second at a time, and ends early once the sev0 closed. */
const rest = Effect.fn("Freeze.rest")(function* (home: string, every: Duration.Duration) {
  for (let left = Duration.toSeconds(every); left > 0; left -= 1) {
    yield* Effect.sleep(Duration.seconds(1));

    if ((yield* allowed(home)) === null) {
      return;
    }
  }
});

/** Cancels every run the verdict cancels, a beat at a time, until the sev0 closes. */
export const loop = Effect.fn("Freeze.loop")(function* (home: string, every: Duration.Duration, pid: number) {
  if ((yield* allowed(home)) === null) {
    return yield* Level.Refused.make({ reason: "no sev0 is open" });
  }

  yield* note(home, Level.Entry.cases.looping.make({ at: yield* Level.now, pid }));

  while ((yield* allowed(home)) !== null) {
    yield* beat(home);
    yield* rest(home, every);
  }

  yield* note(home, Level.Entry.cases.ended.make({ at: yield* Level.now, by: "loop" }));
  yield* Console.log("sev: the cancel loop ended");
});

/** How the wait after a close ended: every loop said it ended, or one did not in time. */
export const Ended = Schema.Literals(["answered", "unanswered"]);

export type Ended = typeof Ended.Type;

/**
 * After a close: waits up to `wait` for each loop of this sev0 to say it ended. When one does not
 * (it died with its shell), this writes the end itself: a late loop reads the log before each
 * cancel, so it cancels nothing more.
 */
export const ended = Effect.fn("Freeze.ended")(function* (home: string, wait: Duration.Duration) {
  const left = Effect.map(Level.log(home), running);

  for (let seconds = Duration.toSeconds(wait); seconds > 0 && (yield* left) > 0; seconds -= 1) {
    yield* Effect.sleep(Duration.seconds(1));
  }

  if ((yield* left) <= 0) {
    return "answered" satisfies Ended;
  }

  yield* note(home, Level.Entry.cases.ended.make({ at: yield* Level.now, by: "close" }));

  return "unanswered" satisfies Ended;
});
