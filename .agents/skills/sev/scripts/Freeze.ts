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
//
// Every agent on the login shares GitHub's rate limit, so the loop spends it with care. A run
// GitHub refuses to cancel is asked once a sev0: on 2026-11-18 twelve runs stuck in `queued` since
// 2026-11-11 answered every cancel with a 409, "has not been queued yet", and asking again each
// beat spent the whole limit. A rate limit ends the beat, and the loop asks nothing until GitHub
// takes calls again. Both are read from the log, so a loop started again keeps them too.
import { Console, DateTime, Duration, Effect, Schema, Array as Arr, Option } from "effect";
import * as Level from "./Level.ts";
import type { RateLimited, Run, WorkflowRunsError } from "./WorkflowRuns.ts";
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

/** The runs a sev0's lines say GitHub refused to cancel, for any reason but its rate limit. */
const refused = (lines: ReadonlyArray<Level.Entry>): ReadonlySet<number> =>
  new Set(Arr.flatMap(lines, (e) => (e._tag === "failed" && e.call === "cancel" && e.id !== null ? [e.id] : [])));

/** When GitHub takes calls again, by a sev0's latest rate limit; `null` when it hit none. */
const retryAt = (lines: ReadonlyArray<Level.Entry>): DateTime.Utc | null =>
  Option.match(Arr.findLast(lines, Level.Entry.guards.limited), { onNone: () => null, onSome: (e) => e.until });

/** How long the loop rests: one beat, or until GitHub takes calls again when that is later. */
export const delay = (every: Duration.Duration, until: DateTime.Utc | null, now: DateTime.Utc): Duration.Duration =>
  until === null ? every : Duration.max(every, DateTime.distance(now, until));

// ---------------------------------------------------------------- the loop

/** The open sev0 as the loop reads it before each call; `null` once it closed. */
const open = Effect.fnUntraced(function* (home: string) {
  const { entries, sev0 } = yield* Level.read(home);

  if (sev0._tag === "closed") {
    return null;
  }

  const lines = entries.slice(sev0.index);

  return { allow: sev0.allow, refused: refused(lines), retryAt: retryAt(lines) };
});

const runLine = (run: Run) => `${run.id} ${run.workflow} ${run.event} ${run.branch}`;

/** Adds a line the loop writes; those follow any log, so this never refuses. */
const note = (home: string, entry: Level.Entry) => Effect.asVoid(Level.write(home, entry));

/**
 * Logs one failed call, once: the list when `run` is `null`, else that run's cancel. A rate limit is
 * `limited`, so the loop waits it out; anything else is `failed`, so a refused cancel is not asked
 * again.
 */
const failed = Effect.fnUntraced(function* (home: string, run: Run | null, error: WorkflowRunsError | RateLimited) {
  const at = yield* Level.now;
  const call = run === null ? "unfinished" : "cancel";
  const id = run === null ? null : run.id;
  const tried = run === null ? "list the runs" : `cancel ${runLine(run)}`;

  if (error._tag === "RateLimited") {
    yield* note(home, Level.Entry.cases.limited.make({ at, call, id, until: error.until, reason: error.reason }));

    return yield* Console.log(
      `sev: could not ${tried}: GitHub's rate limit; nothing is asked before ${DateTime.formatIso(error.until)}`,
    );
  }

  yield* note(home, Level.Entry.cases.failed.make({ at, call, id, reason: error.reason }));
  yield* Console.log(`sev: could not ${tried}: ${error.reason}${run === null ? "" : "; not asked again in this sev0"}`);
});

/**
 * One beat: list what has not finished, then cancel each run the verdict cancels and GitHub has not
 * refused. A rate limit ends the beat at once.
 */
const beat = Effect.fn("Freeze.beat")(function* (home: string) {
  const github = yield* WorkflowRuns;
  const listed = yield* Effect.result(github.unfinished);

  if (listed._tag === "Failure") {
    return yield* failed(home, null, listed.failure);
  }

  for (const run of listed.success) {
    const sev0 = yield* open(home);

    if (sev0 === null) {
      return;
    }

    if (verdict(run, sev0.allow)._tag === "keep" || sev0.refused.has(run.id)) {
      continue;
    }

    const done = yield* Effect.result(github.cancel(run.id));

    if (done._tag === "Success") {
      yield* note(home, Level.Entry.cases.canceled.make({ at: yield* Level.now, run }));
      yield* Console.log(`sev: canceled ${runLine(run)}`);
      continue;
    }

    yield* failed(home, run, done.failure);

    if (done.failure._tag === "RateLimited") {
      return;
    }
  }
});

/**
 * Waits one beat, or until GitHub takes calls again when that is later, a second at a time, and
 * ends early once the sev0 closed.
 */
const rest = Effect.fn("Freeze.rest")(function* (home: string, every: Duration.Duration) {
  const sev0 = yield* open(home);

  if (sev0 === null) {
    return;
  }

  const wait = delay(every, sev0.retryAt, yield* DateTime.now);

  for (let left = Duration.toSeconds(wait); left > 0; left -= 1) {
    yield* Effect.sleep(Duration.seconds(1));

    if ((yield* open(home)) === null) {
      return;
    }
  }
});

/** Cancels every run the verdict cancels, a beat at a time, until the sev0 closes. */
export const loop = Effect.fn("Freeze.loop")(function* (home: string, every: Duration.Duration, pid: number) {
  if ((yield* open(home)) === null) {
    return yield* Level.Refused.make({ reason: "no sev0 is open" });
  }

  yield* note(home, Level.Entry.cases.looping.make({ at: yield* Level.now, pid }));
  // A loop started again inside a rate limit waits it out before its first call.
  yield* rest(home, Duration.zero);

  while ((yield* open(home)) !== null) {
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
